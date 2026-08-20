/**
 * Local TTS synthesis wrapper using @diffusionstudio/vits-web (Piper ONNX).
 * This module dynamically imports vits-web to avoid SSR execution.
 * All operations are browser-only and return Blob results.
 */

import type { LocalTtsVoiceId } from './tts-utils';

export interface TtsProgressEvent {
  /** Progress fraction 0–1 for model download */
  progress: number;
  /** Total bytes (may be 0 if unknown) */
  total: number;
  /** Loaded bytes so far */
  loaded: number;
}

export type TtsProgressCallback = (event: TtsProgressEvent) => void;

/**
 * Lazy-load the vits-web module. Throws if executed in a non-browser environment.
 */
async function loadVitsWeb() {
  if (typeof window === 'undefined') {
    throw new Error('local-tts: vits-web requires a browser environment');
  }
  return await import('@diffusionstudio/vits-web');
}

/**
 * Synthesize text to a WAV Blob using a Piper VITS voice.
 * On first use of a voice, the model (~20–65 MB) is downloaded and cached
 * in the browser Origin Private File System.
 *
 * @param text - Text to synthesize
 * @param voiceId - Curated Piper voice identifier
 * @param onProgress - Optional progress callback for model download
 * @returns WAV audio Blob
 */
export async function synthesize(
  text: string,
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
): Promise<Blob> {
  const vits = await loadVitsWeb();

  // Predict returns a Blob (WAV)
  const blob = await vits.predict({ text, voiceId }, onProgress
    ? (ev: { loaded: number; total: number }) => {
        const total = ev.total || 0;
        const loaded = ev.loaded || 0;
        onProgress({ progress: total > 0 ? loaded / total : 0, total, loaded });
      }
    : undefined);

  return blob;
}

/**
 * Download (pre-cache) a voice model without generating speech.
 * Useful for pre-warming the model before export.
 *
 * @param voiceId - Curated Piper voice identifier
 * @param onProgress - Optional progress callback for model download
 */
export async function downloadVoiceModel(
  voiceId: LocalTtsVoiceId,
  onProgress?: TtsProgressCallback,
): Promise<void> {
  const vits = await loadVitsWeb();

  await vits.download(voiceId, (ev: { loaded: number; total: number }) => {
    if (onProgress) {
      const total = ev.total || 0;
      const loaded = ev.loaded || 0;
      onProgress({ progress: total > 0 ? loaded / total : 0, total, loaded });
    }
  });
}

/**
 * Check if a voice model is already cached (stored) in the browser.
 *
 * @param voiceId - Curated Piper voice identifier
 * @returns true if model is available locally
 */
export async function isVoiceModelStored(voiceId: LocalTtsVoiceId): Promise<boolean> {
  const vits = await loadVitsWeb();
  const stored = await vits.stored();
  return stored.includes(voiceId);
}

/**
 * List all locally stored (cached) voice model IDs.
 */
export async function listStoredVoiceModels(): Promise<string[]> {
  const vits = await loadVitsWeb();
  return await vits.stored();
}
