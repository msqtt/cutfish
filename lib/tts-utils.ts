/**
 * TTS utility layer: curated Piper voice list, backward-compatible config normalization,
 * synthesis cache keys, and export cue selection with time mapping.
 */

import type { SubtitleCue } from './visual-overlay-utils';

// --- Voice ID type and voice list ---

export type LocalTtsVoiceId =
  | 'zh_CN-huayan-x_low'
  | 'zh_CN-huayan-medium'
  | 'en_US-hfc_female-medium'
  | 'en_US-hfc_male-medium'
  | 'en_US-amy-medium'
  | 'en_US-ryan-medium';

export interface LocalTtsVoice {
  id: LocalTtsVoiceId;
  name: string;
  lang: string;
  quality: 'low' | 'medium' | 'high';
  sizeMB: number;
}

export const LOCAL_TTS_VOICES: readonly LocalTtsVoice[] = [
  { id: 'zh_CN-huayan-x_low', name: 'Huayan (Fast)', lang: 'zh-CN', quality: 'low', sizeMB: 20.6 },
  { id: 'zh_CN-huayan-medium', name: 'Huayan (Quality)', lang: 'zh-CN', quality: 'medium', sizeMB: 63.2 },
  { id: 'en_US-hfc_female-medium', name: 'HFC Female', lang: 'en-US', quality: 'medium', sizeMB: 63.2 },
  { id: 'en_US-hfc_male-medium', name: 'HFC Male', lang: 'en-US', quality: 'medium', sizeMB: 63.2 },
  { id: 'en_US-amy-medium', name: 'Amy', lang: 'en-US', quality: 'medium', sizeMB: 63.2 },
  { id: 'en_US-ryan-medium', name: 'Ryan', lang: 'en-US', quality: 'medium', sizeMB: 63.2 },
] as const;

const VOICE_MAP = new Map<string, LocalTtsVoice>(LOCAL_TTS_VOICES.map((v) => [v.id, v]));

/**
 * Get the default local voice for a language or inferred from text content.
 * Falls back to zh_CN-huayan-x_low for Chinese text, en_US-hfc_female-medium for English.
 */
export function getDefaultLocalVoice(langOrText?: string): LocalTtsVoice {
  if (!langOrText) return LOCAL_TTS_VOICES[0]; // zh_CN-huayan-x_low

  const lower = langOrText.toLowerCase();

  // Direct language match
  if (lower.startsWith('zh') || lower.startsWith('cmn')) {
    return LOCAL_TTS_VOICES[0]; // zh_CN-huayan-x_low (fast)
  }
  if (lower.startsWith('en')) {
    return LOCAL_TTS_VOICES[2]; // en_US-hfc_female-medium
  }

  // Heuristic: detect CJK characters for Chinese
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(langOrText);
  if (hasCJK) {
    return LOCAL_TTS_VOICES[0];
  }

  // Default to English
  return LOCAL_TTS_VOICES[2];
}

// --- Backward-compatible TTS config normalization ---

export interface NormalizedTtsConfig {
  enabled: boolean;
  voiceURI: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  exportVoiceId: string;
  includeInExport: boolean;
}

/**
 * Normalize a possibly-incomplete tts config to a fully-populated config object.
 * Backward compatible: if exportVoiceId/includeInExport are missing, fills defaults.
 */
export function normalizeTtsConfig(
  tts: Record<string, unknown> | null | undefined,
): NormalizedTtsConfig | null {
  if (!tts) return null;

  const enabled = tts.enabled === true;
  const voiceURI = typeof tts.voiceURI === 'string' ? tts.voiceURI : '';
  const lang = typeof tts.lang === 'string' ? tts.lang : 'zh-CN';
  const rate = typeof tts.rate === 'number' && Number.isFinite(tts.rate) ? tts.rate : 1;
  const pitch = typeof tts.pitch === 'number' && Number.isFinite(tts.pitch) ? tts.pitch : 1;
  const volume = typeof tts.volume === 'number' && Number.isFinite(tts.volume) ? tts.volume : 1;

  // New fields: backward-compatible with old cues that lack them
  const defaultVoice = getDefaultLocalVoice(lang);
  const exportVoiceId = typeof tts.exportVoiceId === 'string' && tts.exportVoiceId
    ? tts.exportVoiceId
    : defaultVoice.id;
  const includeInExport = typeof tts.includeInExport === 'boolean'
    ? tts.includeInExport
    : true;

  return { enabled, voiceURI, lang, rate, pitch, volume, exportVoiceId, includeInExport };
}

// --- Cache key generation ---

/**
 * Generate a stable cache key for a TTS synthesis result.
 * Key is based on text content, voice ID, and rate.
 */
export function getTtsCacheKey(text: string, voiceId: string, rate: number): string {
  // Normalize: trim whitespace, collapse multiple spaces
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  const normalizedRate = Math.round(rate * 1000) / 1000;
  return `tts:${voiceId}:${normalizedRate}:${normalizedText}`;
}

// --- Export cue selection ---

export interface TtsExportCue {
  /** Export-range-relative start time (seconds) */
  startTime: number;
  /** Export-range-relative end time (seconds) */
  endTime: number;
  /** Source trim start: how much to trim from the beginning of generated audio (seconds) */
  sourceTrimStart: number;
  /** Playback rate, clamped 0.5–2 */
  rate: number;
  /** Volume, clamped 0–1 */
  volume: number;
  /** Selected Piper voice ID */
  voiceId: string;
  /** Original cue text for synthesis */
  text: string;
  /** Original cue ID for tracking */
  cueId: string;
}

/**
 * Select subtitle cues that should be included in TTS export within the given project range.
 *
 * Filters out:
 * - Cues with tts disabled (tts === null or tts.enabled === false)
 * - Cues with includeInExport === false
 * - Cues with empty/whitespace-only text
 * - Cues that don't intersect [rangeStart, rangeEnd]
 *
 * Output times are range-relative (shifted by -rangeStart).
 * sourceTrimStart accounts for when rangeStart cuts into a cue's beginning.
 * rate is clamped to [0.5, 2.0], volume clamped to [0, 1].
 */
export function selectTtsCuesForExport(
  cues: SubtitleCue[],
  rangeStart: number,
  rangeEnd: number,
): TtsExportCue[] {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < 0 || rangeEnd <= rangeStart) {
    throw new Error('Invalid export range');
  }

  const result: TtsExportCue[] = [];

  for (const cue of cues) {
    // Skip cues without TTS enabled
    if (!cue.tts || !cue.tts.enabled) continue;

    // Skip cues with includeInExport === false
    if (cue.tts.includeInExport === false) continue;

    // Skip empty text
    if (!cue.text || !cue.text.trim()) continue;

    // Check range intersection: cue.endTime > rangeStart AND cue.startTime < rangeEnd
    if (cue.endTime <= rangeStart || cue.startTime >= rangeEnd) continue;

    // Compute range-relative times
    const clampedStart = Math.max(cue.startTime, rangeStart);
    const clampedEnd = Math.min(cue.endTime, rangeEnd);
    const relativeStart = clampedStart - rangeStart;
    const relativeEnd = clampedEnd - rangeStart;

    if (relativeEnd <= relativeStart) continue;

    // Compute sourceTrimStart: how much the range cuts into the cue start
    // This is the time offset from cue.startTime to the actual visible start, scaled by rate
    const rate = Math.max(0.5, Math.min(2, cue.tts.rate));
    const cueOffset = Math.max(0, rangeStart - cue.startTime);
    const sourceTrimStart = Math.max(0, cueOffset * rate);

    const volume = Math.max(0, Math.min(1, cue.tts.volume));

    result.push({
      startTime: relativeStart,
      endTime: relativeEnd,
      sourceTrimStart,
      rate,
      volume,
      voiceId: cue.tts.exportVoiceId || 'zh_CN-huayan-x_low',
      text: cue.text.trim(),
      cueId: cue.id,
    });
  }

  return result;
}

/**
 * Validate a voice ID. Returns the voice object or null if not found.
 */
export function getVoiceById(id: string): LocalTtsVoice | null {
  return VOICE_MAP.get(id) ?? null;
}
