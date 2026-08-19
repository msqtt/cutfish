import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  PRESETS,
  applyPreset,
  getPresetNames,
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  applyCustomPreset,
  type PresetName,
  type PresetTarget,
  type CustomPreset,
} from './preset-utils';

describe('getPresetNames', () => {
  it('returns all defined preset names', () => {
    const names = getPresetNames();
    expect(names).toContain('social-reel');
    expect(names).toContain('youtube');
    expect(names).toContain('quick-share');
    expect(names).toContain('cinematic');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});

describe('PRESETS', () => {
  it('social-reel uses 9:16 aspect and 1080p resolution', () => {
    const preset = PRESETS['social-reel'];
    expect(preset.canvasAspect).toBe('9:16');
    expect(preset.exportSettings.resolution).toBe('1080p');
    expect(preset.exportSettings.frameRate).toBe(30);
  });

  it('youtube uses 16:9 and 1080p at 60fps', () => {
    const preset = PRESETS['youtube'];
    expect(preset.canvasAspect).toBe('16:9');
    expect(preset.exportSettings.resolution).toBe('1080p');
    expect(preset.exportSettings.frameRate).toBe(60);
  });

  it('quick-share uses 720p compact', () => {
    const preset = PRESETS['quick-share'];
    expect(preset.exportSettings.resolution).toBe('720p');
    expect(preset.exportSettings.quality).toBe('compact');
  });

  it('cinematic uses 24fps and high quality', () => {
    const preset = PRESETS['cinematic'];
    expect(preset.exportSettings.frameRate).toBe(24);
    expect(preset.exportSettings.quality).toBe('high');
  });
});

describe('applyPreset', () => {
  const baseState: PresetTarget = {
    canvasAspect: '16:9',
    canvasFit: 'contain',
    exportSettings: {
      resolution: '720p',
      frameRate: 30,
      quality: 'balanced',
      rangeStart: 5,
      rangeEnd: 20,
    },
    presetName: null,
  };

  it('applies preset settings while preserving rangeStart and rangeEnd', () => {
    const result = applyPreset(baseState, 'social-reel');
    expect(result.canvasAspect).toBe('9:16');
    expect(result.exportSettings.resolution).toBe('1080p');
    expect(result.exportSettings.rangeStart).toBe(5); // preserved
    expect(result.exportSettings.rangeEnd).toBe(20);   // preserved
    expect(result.presetName).toBe('social-reel');
  });

  it('applies different presets independently', () => {
    const resultYT = applyPreset(baseState, 'youtube');
    const resultCine = applyPreset(baseState, 'cinematic');
    expect(resultYT.exportSettings.frameRate).toBe(60);
    expect(resultCine.exportSettings.frameRate).toBe(24);
    expect(resultYT.canvasAspect).toBe('16:9');
    expect(resultCine.canvasAspect).toBe('16:9');
  });

  it('returns the original state reference for unknown preset', () => {
    const result = applyPreset(baseState, 'nonexistent' as PresetName);
    expect(result).toBe(baseState);
  });
});

// Mock localStorage for custom presets
const mockStorage: Record<string, string> = {};
beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => { mockStorage[key] = value; },
    removeItem: (key: string) => { delete mockStorage[key]; },
  });
});

describe('custom presets (M5)', () => {
  const customPreset: CustomPreset = {
    name: 'My Preset',
    canvasAspect: '4:3',
    canvasFit: 'stretch',
    exportSettings: { resolution: '480p', frameRate: 24, quality: 'compact' },
  };

  it('loadCustomPresets returns empty when nothing stored', () => {
    expect(loadCustomPresets()).toEqual([]);
  });

  it('saveCustomPreset persists and returns updated list', () => {
    const result = saveCustomPreset(customPreset);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('My Preset');
    // Verify it's persisted by checking localStorage directly
    const stored = JSON.parse(mockStorage['cutfish-custom-presets'] ?? '[]');
    expect(stored).toHaveLength(1);
  });

  it('saveCustomPreset replaces existing preset with same name', () => {
    saveCustomPreset(customPreset);
    const updated: CustomPreset = { ...customPreset, canvasAspect: '1:1' };
    const result = saveCustomPreset(updated);
    expect(result).toHaveLength(1);
    expect(result[0].canvasAspect).toBe('1:1');
  });

  it('deleteCustomPreset removes by name', () => {
    saveCustomPreset(customPreset);
    const result = deleteCustomPreset('My Preset');
    expect(result).toHaveLength(0);
    expect(loadCustomPresets()).toHaveLength(0);
  });

  it('applyCustomPreset applies settings preserving range', () => {
    const baseState: PresetTarget = {
      canvasAspect: '16:9',
      canvasFit: 'contain',
      exportSettings: { resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 2, rangeEnd: 10 },
      presetName: null,
    };
    const result = applyCustomPreset(baseState, customPreset);
    expect(result.canvasAspect).toBe('4:3');
    expect(result.canvasFit).toBe('stretch');
    expect(result.exportSettings.resolution).toBe('480p');
    expect(result.exportSettings.rangeStart).toBe(2);
    expect(result.exportSettings.rangeEnd).toBe(10);
    expect(result.presetName).toBe('My Preset');
  });
});
