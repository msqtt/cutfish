/**
 * Browser-only Piper VITS wrapper.
 * Models are downloaded through validated fallback sources and stored in the
 * same OPFS directory used by @diffusionstudio/vits-web.
 */

import { LOCAL_TTS_VOICES, type LocalTtsVoiceId } from './tts-utils';
import {
  TtsModelDownloadError,
  fetchFirstValidModelAsset,
  getModelAssetCandidates,
  getVoiceModelPath,
  validateModelAsset,
} from './tts-model-utils';

export interface TtsProgressEvent {
  progress: number;
  total: number;
  loaded: number;
}

export type TtsProgressCallback = (event: TtsProgressEvent) => void;

const activeModelDownloads = new Map<LocalTtsVoiceId, Promise<{ downloaded: boolean; modelSize: number }>>();

async function loadVitsWeb() {
  if (typeof window === 'undefined') {
    throw new Error('local-tts: vits-web requires a browser environment');
  }
  return await import('@diffusionstudio/vits-web');
}

function requireOpfs(): StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> } {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
  if (typeof storage?.getDirectory !== 'function') {
    throw new TtsModelDownloadError('This browser does not support Origin Private File System storage');
  }
  return storage as StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> };
}

async function getPiperDirectory(): Promise<FileSystemDirectoryHandle> {
  try {
    const root = await requireOpfs().getDirectory();
    return await root.getDirectoryHandle('piper', { create: true });
  } catch (error) {
    if (error instanceof TtsModelDownloadError) throw error;
    throw new TtsModelDownloadError(`Unable to access browser model storage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function voiceFilenames(voiceId: LocalTtsVoiceId) {
  const modelPath = getVoiceModelPath(voiceId);
  const model = modelPath.split('/').at(-1)!;
  return { model, config: `${model}.json` };
}

async function readStoredFile(directory: FileSystemDirectoryHandle, name: string): Promise<File | undefined> {
  try {
    return await (await directory.getFileHandle(name)).getFile();
  } catch {
    return undefined;
  }
}

async function removeStoredFile(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch {
    // Missing files are already in the desired state.
  }
}

async function writeStoredFile(directory: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function getStoredVoiceModel(
  voiceId: LocalTtsVoiceId,
): Promise<{ valid: boolean; modelSize: number }> {
  const directory = await getPiperDirectory();
  const names = voiceFilenames(voiceId);
  const [model, config] = await Promise.all([
    readStoredFile(directory, names.model),
    readStoredFile(directory, names.config),
  ]);
  if (!model || !config) return { valid: false, modelSize: 0 };

  try {
    await Promise.all([
      validateModelAsset(model, 'model'),
      validateModelAsset(config, 'config'),
    ]);
    return { valid: true, modelSize: model.size };
  } catch {
    return { valid: false, modelSize: 0 };
  }
}

async function downloadAndStoreVoiceModel(
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
): Promise<{ downloaded: boolean; modelSize: number }> {
  const configuredBase = process.env.NEXT_PUBLIC_TTS_MODEL_BASE_URL;
  const configResult = await fetchFirstValidModelAsset(
    getModelAssetCandidates(voiceId, 'config', configuredBase),
    'config',
  );
  const modelResult = await fetchFirstValidModelAsset(
    getModelAssetCandidates(voiceId, 'model', configuredBase),
    'model',
    ({ loaded, total }) => onProgress?.({
      loaded,
      total,
      progress: total > 0 ? Math.min(1, loaded / total) : 0,
    }),
  );

  const directory = await getPiperDirectory();
  const names = voiceFilenames(voiceId);
  try {
    // The model is written last: a partial pair is never considered cached.
    await writeStoredFile(directory, names.config, configResult.blob);
    await writeStoredFile(directory, names.model, modelResult.blob);
  } catch (error) {
    await Promise.all([
      removeStoredFile(directory, names.model),
      removeStoredFile(directory, names.config),
    ]);
    throw new TtsModelDownloadError(`Unable to cache TTS model in browser storage: ${error instanceof Error ? error.message : String(error)}`);
  }

  onProgress?.({ loaded: modelResult.blob.size, total: modelResult.blob.size, progress: 1 });
  return { downloaded: true, modelSize: modelResult.blob.size };
}

async function ensureVoiceModel(
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
  force = false,
): Promise<{ downloaded: boolean; modelSize: number }> {
  if (!force) {
    const stored = await getStoredVoiceModel(voiceId);
    if (stored.valid) {
      onProgress?.({ loaded: stored.modelSize, total: stored.modelSize, progress: 1 });
      return { downloaded: false, modelSize: stored.modelSize };
    }
  }

  const existing = activeModelDownloads.get(voiceId);
  if (existing) return existing;

  const promise = downloadAndStoreVoiceModel(voiceId, onProgress).catch((error) => {
    if (error instanceof TtsModelDownloadError && error.attempts.length > 0) {
      console.error('TTS model download sources failed', error.attempts);
    }
    throw error;
  }).finally(() => {
    activeModelDownloads.delete(voiceId);
  });
  activeModelDownloads.set(voiceId, promise);
  return promise;
}

async function removeVoiceModel(voiceId: LocalTtsVoiceId): Promise<void> {
  const directory = await getPiperDirectory();
  const names = voiceFilenames(voiceId);
  await Promise.all([
    removeStoredFile(directory, names.model),
    removeStoredFile(directory, names.config),
  ]);
}

export async function synthesize(
  text: string,
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
): Promise<Blob> {
  const model = await ensureVoiceModel(voiceId, onProgress);
  const vits = await loadVitsWeb();

  try {
    return await vits.predict({ text, voiceId });
  } catch (error) {
    // A size-valid legacy cache may still contain damaged bytes. Refresh it once.
    if (!model.downloaded) {
      console.warn('Cached TTS model failed inference; refreshing once', error);
      await removeVoiceModel(voiceId);
      await ensureVoiceModel(voiceId, onProgress, true);
      return await vits.predict({ text, voiceId });
    }
    throw error;
  }
}

export async function downloadVoiceModel(
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
): Promise<void> {
  await ensureVoiceModel(voiceId, onProgress);
}

export async function isVoiceModelStored(voiceId: LocalTtsVoiceId): Promise<boolean> {
  return (await getStoredVoiceModel(voiceId)).valid;
}

export async function listStoredVoiceModels(): Promise<string[]> {
  const checks = await Promise.all(LOCAL_TTS_VOICES.map(async (voice) => ({
    id: voice.id,
    stored: await isVoiceModelStored(voice.id),
  })));
  return checks.filter((entry) => entry.stored).map((entry) => entry.id);
}
