import { describe, expect, it } from 'vitest';
import {
  LOCAL_TTS_VOICES,
  getDefaultLocalVoice,
  normalizeTtsConfig,
  getTtsCacheKey,
  selectTtsCuesForExport,
  getVoiceById,
  type LocalTtsVoiceId,
} from './tts-utils';
import type { SubtitleCue } from './visual-overlay-utils';

// Helper to create a minimal subtitle cue with TTS
function makeCue(overrides: Partial<SubtitleCue> & { id: string; startTime: number; endTime: number; text: string }): SubtitleCue {
  return {
    fontFamily: 'sans',
    fontSize: 48,
    lineHeight: 1.3,
    color: '#ffffff',
    backgroundColor: '',
    position: { x: 50, y: 50 },
    width: 80,
    align: 'center',
    rotation: 0,
    tts: {
      enabled: true,
      voiceURI: '',
      lang: 'zh-CN',
      rate: 1,
      pitch: 1,
      volume: 1,
      exportVoiceId: 'zh_CN-huayan-x_low',
      includeInExport: true,
    },
    ...overrides,
  };
}

describe('LOCAL_TTS_VOICES', () => {
  it('has at least 6 curated voices', () => {
    expect(LOCAL_TTS_VOICES.length).toBeGreaterThanOrEqual(6);
  });

  it('includes required voices', () => {
    const ids = LOCAL_TTS_VOICES.map((v) => v.id);
    expect(ids).toContain('zh_CN-huayan-x_low');
    expect(ids).toContain('zh_CN-huayan-medium');
    expect(ids).toContain('en_US-hfc_female-medium');
    expect(ids).toContain('en_US-hfc_male-medium');
    expect(ids).toContain('en_US-amy-medium');
    expect(ids).toContain('en_US-ryan-medium');
  });

  it('each voice has name, lang, quality, and sizeMB', () => {
    for (const voice of LOCAL_TTS_VOICES) {
      expect(voice.name).toBeTruthy();
      expect(voice.lang).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(voice.quality);
      expect(voice.sizeMB).toBeGreaterThan(0);
    }
  });

  it('zh_CN-huayan-x_low is 20.6MB fast voice', () => {
    const voice = LOCAL_TTS_VOICES.find((v) => v.id === 'zh_CN-huayan-x_low')!;
    expect(voice.sizeMB).toBe(20.6);
    expect(voice.quality).toBe('low');
    expect(voice.lang).toBe('zh-CN');
  });

  it('zh_CN-huayan-medium is 63.2MB quality voice', () => {
    const voice = LOCAL_TTS_VOICES.find((v) => v.id === 'zh_CN-huayan-medium')!;
    expect(voice.sizeMB).toBe(63.2);
    expect(voice.quality).toBe('medium');
    expect(voice.lang).toBe('zh-CN');
  });
});

describe('getDefaultLocalVoice', () => {
  it('returns zh_CN-huayan-x_low for Chinese language codes', () => {
    expect(getDefaultLocalVoice('zh-CN').id).toBe('zh_CN-huayan-x_low');
    expect(getDefaultLocalVoice('zh').id).toBe('zh_CN-huayan-x_low');
    expect(getDefaultLocalVoice('cmn').id).toBe('zh_CN-huayan-x_low');
  });

  it('returns en_US-hfc_female-medium for English language codes', () => {
    expect(getDefaultLocalVoice('en-US').id).toBe('en_US-hfc_female-medium');
    expect(getDefaultLocalVoice('en').id).toBe('en_US-hfc_female-medium');
  });

  it('detects Chinese from CJK characters in text', () => {
    expect(getDefaultLocalVoice('你好世界').id).toBe('zh_CN-huayan-x_low');
    expect(getDefaultLocalVoice('测试').id).toBe('zh_CN-huayan-x_low');
  });

  it('defaults to English for non-CJK text', () => {
    expect(getDefaultLocalVoice('Hello world').id).toBe('en_US-hfc_female-medium');
  });

  it('defaults to zh_CN-huayan-x_low when no argument', () => {
    expect(getDefaultLocalVoice().id).toBe('zh_CN-huayan-x_low');
    expect(getDefaultLocalVoice('').id).toBe('zh_CN-huayan-x_low');
  });
});

describe('normalizeTtsConfig', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeTtsConfig(null)).toBeNull();
    expect(normalizeTtsConfig(undefined)).toBeNull();
  });

  it('normalizes a complete config', () => {
    const config = {
      enabled: true,
      voiceURI: 'test-voice',
      lang: 'en-US',
      rate: 1.5,
      pitch: 0.8,
      volume: 0.7,
      exportVoiceId: 'en_US-amy-medium',
      includeInExport: false,
    };
    const result = normalizeTtsConfig(config);
    expect(result).toEqual(config);
  });

  it('fills defaults for missing fields (backward compatible)', () => {
    const legacy = { enabled: true, voiceURI: '', lang: 'zh-CN', rate: 1, pitch: 1, volume: 1 };
    const result = normalizeTtsConfig(legacy as Record<string, unknown>);
    expect(result!.exportVoiceId).toBe('zh_CN-huayan-x_low');
    expect(result!.includeInExport).toBe(true);
  });

  it('fills English default voice for en lang', () => {
    const config = { enabled: true, voiceURI: '', lang: 'en-US', rate: 1, pitch: 1, volume: 1 };
    const result = normalizeTtsConfig(config as Record<string, unknown>);
    expect(result!.exportVoiceId).toBe('en_US-hfc_female-medium');
  });

  it('defaults rate/pitch/volume to 1 for non-numeric values', () => {
    const config = { enabled: true, voiceURI: '', lang: 'zh', rate: NaN, pitch: undefined, volume: Infinity };
    const result = normalizeTtsConfig(config as unknown as Record<string, unknown>);
    expect(result!.rate).toBe(1);
    expect(result!.pitch).toBe(1);
    expect(result!.volume).toBe(1);
  });
});

describe('getTtsCacheKey', () => {
  it('produces stable key for same inputs', () => {
    const k1 = getTtsCacheKey('Hello world', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('Hello world', 'en_US-amy-medium', 1.0);
    expect(k1).toBe(k2);
  });

  it('different text produces different key', () => {
    const k1 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('World', 'en_US-amy-medium', 1.0);
    expect(k1).not.toBe(k2);
  });

  it('different voice produces different key', () => {
    const k1 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('Hello', 'en_US-ryan-medium', 1.0);
    expect(k1).not.toBe(k2);
  });

  it('different rate produces different key', () => {
    const k1 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.5);
    expect(k1).not.toBe(k2);
  });

  it('normalizes whitespace in text', () => {
    const k1 = getTtsCacheKey('Hello   world', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('Hello world', 'en_US-amy-medium', 1.0);
    expect(k1).toBe(k2);
  });

  it('trims leading/trailing whitespace', () => {
    const k1 = getTtsCacheKey('  Hello  ', 'en_US-amy-medium', 1.0);
    const k2 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0);
    expect(k1).toBe(k2);
  });

  it('rounds rate to 3 decimal places', () => {
    const k1 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0001);
    const k2 = getTtsCacheKey('Hello', 'en_US-amy-medium', 1.0);
    expect(k1).toBe(k2);
  });
});

describe('selectTtsCuesForExport', () => {
  it('returns empty array for no cues', () => {
    expect(selectTtsCuesForExport([], 0, 10)).toEqual([]);
  });

  it('throws on invalid range', () => {
    expect(() => selectTtsCuesForExport([], -1, 10)).toThrow('Invalid export range');
    expect(() => selectTtsCuesForExport([], 5, 3)).toThrow('Invalid export range');
    expect(() => selectTtsCuesForExport([], 5, 5)).toThrow('Invalid export range');
    expect(() => selectTtsCuesForExport([], NaN, 10)).toThrow('Invalid export range');
  });

  it('excludes cues with tts disabled (null)', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello', tts: null });
    expect(selectTtsCuesForExport([cue], 0, 10)).toEqual([]);
  });

  it('excludes cues with tts.enabled === false', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello' });
    cue.tts!.enabled = false;
    expect(selectTtsCuesForExport([cue], 0, 10)).toEqual([]);
  });

  it('excludes cues with includeInExport === false', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello' });
    cue.tts!.includeInExport = false;
    expect(selectTtsCuesForExport([cue], 0, 10)).toEqual([]);
  });

  it('excludes cues with empty text', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: '' });
    expect(selectTtsCuesForExport([cue], 0, 10)).toEqual([]);
  });

  it('excludes cues with whitespace-only text', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: '   \n  ' });
    expect(selectTtsCuesForExport([cue], 0, 10)).toEqual([]);
  });

  it('excludes cues outside range (before)', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 3, text: 'Hello' });
    expect(selectTtsCuesForExport([cue], 5, 10)).toEqual([]);
  });

  it('excludes cues outside range (after)', () => {
    const cue = makeCue({ id: 'c1', startTime: 12, endTime: 15, text: 'Hello' });
    expect(selectTtsCuesForExport([cue], 5, 10)).toEqual([]);
  });

  it('excludes cues touching range boundary (end === rangeStart)', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello' });
    expect(selectTtsCuesForExport([cue], 5, 10)).toEqual([]);
  });

  it('excludes cues touching range boundary (start === rangeEnd)', () => {
    const cue = makeCue({ id: 'c1', startTime: 10, endTime: 15, text: 'Hello' });
    expect(selectTtsCuesForExport([cue], 5, 10)).toEqual([]);
  });

  it('selects cue fully within range with correct relative times', () => {
    const cue = makeCue({ id: 'c1', startTime: 3, endTime: 7, text: 'Hello' });
    const result = selectTtsCuesForExport([cue], 2, 9);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBeCloseTo(1); // 3-2=1
    expect(result[0].endTime).toBeCloseTo(5);   // 7-2=5
    expect(result[0].sourceTrimStart).toBe(0);  // range starts before cue
    expect(result[0].text).toBe('Hello');
    expect(result[0].cueId).toBe('c1');
  });

  it('clips cue start when range starts inside cue (sourceTrimStart)', () => {
    // Cue: [2, 8], range: [4, 10], rate=1
    // rangeStart (4) > cue.startTime (2) → cue offset = 4-2 = 2s
    // sourceTrimStart = 2 * rate(1) = 2
    const cue = makeCue({ id: 'c1', startTime: 2, endTime: 8, text: 'Hello' });
    const result = selectTtsCuesForExport([cue], 4, 10);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBeCloseTo(0);   // max(2,4)-4 = 0
    expect(result[0].endTime).toBeCloseTo(4);     // min(8,10)-4 = 4
    expect(result[0].sourceTrimStart).toBeCloseTo(2); // (4-2)*1 = 2
  });

  it('applies rate to sourceTrimStart', () => {
    // Cue: [2, 8], range: [5, 10], rate=1.5
    // cue offset = 5-2 = 3s, sourceTrimStart = 3 * 1.5 = 4.5
    const cue = makeCue({ id: 'c1', startTime: 2, endTime: 8, text: 'Hello' });
    cue.tts!.rate = 1.5;
    const result = selectTtsCuesForExport([cue], 5, 10);
    expect(result).toHaveLength(1);
    expect(result[0].sourceTrimStart).toBeCloseTo(4.5);
    expect(result[0].rate).toBe(1.5);
  });

  it('clips cue end when range ends inside cue', () => {
    // Cue: [3, 12], range: [0, 8]
    const cue = makeCue({ id: 'c1', startTime: 3, endTime: 12, text: 'Hello' });
    const result = selectTtsCuesForExport([cue], 0, 8);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBeCloseTo(3);   // max(3,0)-0=3
    expect(result[0].endTime).toBeCloseTo(8);     // min(12,8)-0=8
    expect(result[0].sourceTrimStart).toBe(0);
  });

  it('clamps rate to [0.5, 2]', () => {
    const cue1 = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Fast' });
    cue1.tts!.rate = 5;
    const cue2 = makeCue({ id: 'c2', startTime: 0, endTime: 5, text: 'Slow' });
    cue2.tts!.rate = 0.1;

    const result = selectTtsCuesForExport([cue1, cue2], 0, 10);
    expect(result[0].rate).toBe(2);
    expect(result[1].rate).toBe(0.5);
  });

  it('clamps volume to [0, 1]', () => {
    const cue1 = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Loud' });
    cue1.tts!.volume = 2.5;
    const cue2 = makeCue({ id: 'c2', startTime: 0, endTime: 5, text: 'Negative' });
    cue2.tts!.volume = -0.5;

    const result = selectTtsCuesForExport([cue1, cue2], 0, 10);
    expect(result[0].volume).toBe(1);
    expect(result[1].volume).toBe(0);
  });

  it('uses voiceId from exportVoiceId', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello' });
    cue.tts!.exportVoiceId = 'en_US-ryan-medium';
    const result = selectTtsCuesForExport([cue], 0, 10);
    expect(result[0].voiceId).toBe('en_US-ryan-medium');
  });

  it('defaults voiceId when exportVoiceId is empty', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: 'Hello' });
    cue.tts!.exportVoiceId = '';
    const result = selectTtsCuesForExport([cue], 0, 10);
    expect(result[0].voiceId).toBe('zh_CN-huayan-x_low');
  });

  it('selects multiple cues that intersect range', () => {
    const cues = [
      makeCue({ id: 'c1', startTime: 0, endTime: 3, text: 'First' }),
      makeCue({ id: 'c2', startTime: 4, endTime: 7, text: 'Second' }),
      makeCue({ id: 'c3', startTime: 8, endTime: 12, text: 'Third' }),
    ];
    const result = selectTtsCuesForExport(cues, 2, 9);
    expect(result).toHaveLength(3);
    expect(result[0].cueId).toBe('c1');
    expect(result[1].cueId).toBe('c2');
    expect(result[2].cueId).toBe('c3');
  });

  it('sourceTrimStart is zero when range starts before cue', () => {
    const cue = makeCue({ id: 'c1', startTime: 5, endTime: 8, text: 'Hi' });
    cue.tts!.rate = 1.5;
    const result = selectTtsCuesForExport([cue], 2, 10);
    expect(result[0].sourceTrimStart).toBe(0);
  });

  it('trims text whitespace in output', () => {
    const cue = makeCue({ id: 'c1', startTime: 0, endTime: 5, text: '  Hello World  ' });
    const result = selectTtsCuesForExport([cue], 0, 10);
    expect(result[0].text).toBe('Hello World');
  });
});

describe('getVoiceById', () => {
  it('returns voice for valid ID', () => {
    const voice = getVoiceById('zh_CN-huayan-x_low');
    expect(voice).not.toBeNull();
    expect(voice!.name).toBe('Huayan (Fast)');
  });

  it('returns null for invalid ID', () => {
    expect(getVoiceById('nonexistent')).toBeNull();
  });

  it('returns correct voice for each known ID', () => {
    const ids: LocalTtsVoiceId[] = [
      'zh_CN-huayan-x_low',
      'zh_CN-huayan-medium',
      'en_US-hfc_female-medium',
      'en_US-hfc_male-medium',
      'en_US-amy-medium',
      'en_US-ryan-medium',
    ];
    for (const id of ids) {
      expect(getVoiceById(id)).not.toBeNull();
      expect(getVoiceById(id)!.id).toBe(id);
    }
  });
});
