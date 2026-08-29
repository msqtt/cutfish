import type { LocalTtsVoiceId } from './tts-utils';

export type TtsModelAssetKind = 'model' | 'config';

export interface ModelDownloadProgress {
  url: string;
  loaded: number;
  total: number;
}

export type ModelDownloadProgressCallback = (progress: ModelDownloadProgress) => void;
export type ModelFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OFFICIAL_MODEL_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
const MIN_MODEL_BYTES = 1_000_000;

const VOICE_MODEL_PATHS: Record<LocalTtsVoiceId, string> = {
  'zh_CN-huayan-x_low': 'zh/zh_CN/huayan/x_low/zh_CN-huayan-x_low.onnx',
  'zh_CN-huayan-medium': 'zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx',
  'en_US-hfc_female-medium': 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
  'en_US-hfc_male-medium': 'en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx',
  'en_US-amy-medium': 'en/en_US/amy/medium/en_US-amy-medium.onnx',
  'en_US-ryan-medium': 'en/en_US/ryan/medium/en_US-ryan-medium.onnx',
};

export class TtsModelDownloadError extends Error {
  readonly attempts: readonly string[];

  constructor(message: string, attempts: string[] = []) {
    super(message);
    this.name = 'TtsModelDownloadError';
    this.attempts = attempts;
  }
}

export function getVoiceModelPath(voiceId: LocalTtsVoiceId): string {
  const path = VOICE_MODEL_PATHS[voiceId];
  if (!path) throw new TtsModelDownloadError(`Unsupported TTS voice: ${voiceId}`);
  return path;
}

function joinBase(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}

export function isCuratedModelAssetPath(path: string): boolean {
  if (!path || path.includes('..') || path.startsWith('/')) return false;
  return Object.values(VOICE_MODEL_PATHS).some((modelPath) => path === modelPath || path === `${modelPath}.json`);
}

export function getModelAssetCandidates(
  voiceId: LocalTtsVoiceId,
  kind: TtsModelAssetKind,
  configuredBase?: string,
): string[] {
  const modelPath = getVoiceModelPath(voiceId);
  const assetPath = kind === 'config' ? `${modelPath}.json` : modelPath;
  const candidates = [
    `/tts-models/${assetPath}`,
    configuredBase ? joinBase(configuredBase, assetPath) : '',
    joinBase(OFFICIAL_MODEL_BASE, assetPath),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

export async function validateModelAsset(blob: Blob, kind: TtsModelAssetKind): Promise<void> {
  if (kind === 'model') {
    const type = blob.type.toLowerCase();
    if (type.includes('text/') || type.includes('html') || type.includes('json')) {
      throw new TtsModelDownloadError(`TTS model response has invalid content type: ${blob.type || 'unknown'}`);
    }
    if (blob.size < MIN_MODEL_BYTES) {
      throw new TtsModelDownloadError(`TTS model response is too small (${blob.size} bytes)`);
    }
    return;
  }

  try {
    const parsed = JSON.parse(await blob.text()) as {
      audio?: { sample_rate?: unknown };
      espeak?: { voice?: unknown };
      inference?: { noise_scale?: unknown; length_scale?: unknown; noise_w?: unknown };
    };
    if (
      typeof parsed.audio?.sample_rate !== 'number'
      || typeof parsed.espeak?.voice !== 'string'
      || typeof parsed.inference?.noise_scale !== 'number'
      || typeof parsed.inference?.length_scale !== 'number'
      || typeof parsed.inference?.noise_w !== 'number'
    ) {
      throw new Error('missing Piper fields');
    }
  } catch (error) {
    throw new TtsModelDownloadError(`Invalid TTS model config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function responseToBlob(response: Response, url: string, onProgress?: ModelDownloadProgressCallback): Promise<Blob> {
  const total = Number(response.headers.get('Content-Length')) || 0;
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({ url, loaded: blob.size, total: total || blob.size });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk.buffer);
    loaded += value.byteLength;
    onProgress?.({ url, loaded, total });
  }
  return new Blob(chunks, { type: contentType });
}

export async function fetchFirstValidModelAsset(
  candidates: readonly string[],
  kind: TtsModelAssetKind,
  onProgress?: ModelDownloadProgressCallback,
  fetcher: ModelFetcher = fetch,
): Promise<{ blob: Blob; sourceUrl: string }> {
  const attempts: string[] = [];

  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetcher(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await responseToBlob(response, url, onProgress);
      await validateModelAsset(blob, kind);
      return { blob, sourceUrl: url };
    } catch (error) {
      attempts.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new TtsModelDownloadError(
    `Unable to download a valid TTS ${kind} from ${candidates.length} source${candidates.length === 1 ? '' : 's'}`,
    attempts,
  );
}
