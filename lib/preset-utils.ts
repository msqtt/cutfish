export type PresetName = 'social-reel' | 'youtube' | 'quick-share' | 'cinematic';

export type CanvasAspect = '16:9' | '9:16' | '4:3' | '1:1' | 'auto';
export type CanvasFit = 'contain' | 'cover' | 'stretch';
export type ExportResolution = '480p' | '720p' | '1080p';
export type ExportFrameRate = 24 | 30 | 60;
export type ExportQuality = 'compact' | 'balanced' | 'high';

export interface PresetDefinition {
  canvasAspect: CanvasAspect;
  canvasFit: CanvasFit;
  exportSettings: {
    resolution: ExportResolution;
    frameRate: ExportFrameRate;
    quality: ExportQuality;
  };
  description: {
    en: string;
    zh: string;
  };
}

export interface PresetTarget {
  canvasAspect: CanvasAspect;
  canvasFit: CanvasFit;
  exportSettings: {
    resolution: ExportResolution;
    frameRate: ExportFrameRate;
    quality: ExportQuality;
    rangeStart: number;
    rangeEnd: number | null;
  };
  presetName: string | null;
}

export interface CustomPreset {
  name: string;
  canvasAspect: CanvasAspect;
  canvasFit: CanvasFit;
  exportSettings: {
    resolution: ExportResolution;
    frameRate: ExportFrameRate;
    quality: ExportQuality;
  };
}

const CUSTOM_PRESETS_KEY = 'cutfish-custom-presets';

export const PRESETS: Record<PresetName, PresetDefinition> = {
  'social-reel': {
    canvasAspect: '9:16',
    canvasFit: 'cover',
    exportSettings: {
      resolution: '1080p',
      frameRate: 30,
      quality: 'balanced',
    },
    description: {
      en: 'Social Reel – 9:16 portrait, 1080p, 30fps',
      zh: '社交短视频 – 9:16 竖屏，1080p，30fps',
    },
  },
  'youtube': {
    canvasAspect: '16:9',
    canvasFit: 'contain',
    exportSettings: {
      resolution: '1080p',
      frameRate: 60,
      quality: 'high',
    },
    description: {
      en: 'YouTube – 16:9 landscape, 1080p, 60fps, high quality',
      zh: 'YouTube – 16:9 横屏，1080p，60fps，高质量',
    },
  },
  'quick-share': {
    canvasAspect: '16:9',
    canvasFit: 'contain',
    exportSettings: {
      resolution: '720p',
      frameRate: 30,
      quality: 'compact',
    },
    description: {
      en: 'Quick Share – 720p compact, smallest file',
      zh: '快速分享 – 720p 紧凑，文件最小',
    },
  },
  'cinematic': {
    canvasAspect: '16:9',
    canvasFit: 'contain',
    exportSettings: {
      resolution: '1080p',
      frameRate: 24,
      quality: 'high',
    },
    description: {
      en: 'Cinematic – 16:9, 1080p, 24fps film look',
      zh: '电影感 – 16:9，1080p，24fps 电影风格',
    },
  },
};

/**
 * Get all available built-in preset names.
 */
export function getPresetNames(): PresetName[] {
  return Object.keys(PRESETS) as PresetName[];
}

/**
 * Apply a preset to the current editor state.
 * Preserves rangeStart and rangeEnd (user's export range selection).
 * Returns the original state if the preset name is not found.
 */
export function applyPreset(state: PresetTarget, presetName: PresetName): PresetTarget {
  const preset = PRESETS[presetName];
  if (!preset) return state;

  return {
    ...state,
    canvasAspect: preset.canvasAspect,
    canvasFit: preset.canvasFit,
    exportSettings: {
      ...preset.exportSettings,
      rangeStart: state.exportSettings.rangeStart,
      rangeEnd: state.exportSettings.rangeEnd,
    },
    presetName,
  };
}

// ─── Custom Presets (M5) ─────────────────────────────────────────────────────

/**
 * Load custom presets from localStorage.
 */
export function loadCustomPresets(): CustomPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Save a custom preset. If a preset with the same name exists, it is replaced.
 */
export function saveCustomPreset(preset: CustomPreset): CustomPreset[] {
  const presets = loadCustomPresets().filter((p) => p.name !== preset.name);
  presets.push(preset);
  if (typeof window !== 'undefined') {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  }
  return presets;
}

/**
 * Delete a custom preset by name.
 */
export function deleteCustomPreset(name: string): CustomPreset[] {
  const presets = loadCustomPresets().filter((p) => p.name !== name);
  if (typeof window !== 'undefined') {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  }
  return presets;
}

/**
 * Apply a custom preset to the current state.
 */
export function applyCustomPreset(state: PresetTarget, preset: CustomPreset): PresetTarget {
  return {
    ...state,
    canvasAspect: preset.canvasAspect,
    canvasFit: preset.canvasFit,
    exportSettings: {
      ...preset.exportSettings,
      rangeStart: state.exportSettings.rangeStart,
      rangeEnd: state.exportSettings.rangeEnd,
    },
    presetName: preset.name,
  };
}
