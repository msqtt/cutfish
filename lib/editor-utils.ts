export interface EditableClip {
  id: string;
  trimStart: number;
  trimEnd: number;
}

export interface SpeedAwareClip extends EditableClip {
  speed?: number;
}

export interface ProjectPosition {
  clipId: string;
  clipIndex: number;
  sourceTime: number;
  projectTime: number;
}

export type CanvasAspect = '16:9' | '9:16' | '4:3' | '1:1' | 'auto';
export type ExportResolution = '480p' | '720p' | '1080p';
export type CanvasFit = 'contain' | 'cover' | 'stretch';

const MIN_CLIP_DURATION = 0.01;

function clipDuration(clip: EditableClip) {
  const duration = clip.trimEnd - clip.trimStart;
  if (!Number.isFinite(clip.trimStart) || !Number.isFinite(clip.trimEnd) || clip.trimStart < 0 || duration <= 0) {
    throw new Error(`Invalid trim range for ${clip.id}`);
  }
  return duration;
}

function getClipSpeed(clip: SpeedAwareClip): number {
  return clip.speed != null && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1.0;
}

function assertNewId<T extends EditableClip>(clips: T[], newId: string) {
  if (!newId || clips.some((clip) => clip.id === newId)) throw new Error('New clip id must be unique');
}

export function getProjectDuration<T extends EditableClip>(clips: T[]) {
  return clips.reduce((total, clip) => total + clipDuration(clip), 0);
}

/** Calculate total playback duration accounting for per-clip speed. */
export function getProjectDurationSpeedAware<T extends SpeedAwareClip>(clips: T[]): number {
  return clips.reduce((total, clip) => {
    const dur = clipDuration(clip);
    const speed = getClipSpeed(clip);
    return total + dur / speed;
  }, 0);
}

/** Locate a project time position within speed-adjusted clips. */
export function locateProjectTimeSpeedAware<T extends SpeedAwareClip>(clips: T[], requestedTime: number): ProjectPosition | null {
  if (!clips.length || !Number.isFinite(requestedTime)) return null;
  const total = getProjectDurationSpeedAware(clips);
  const projectTime = Math.max(0, Math.min(total, requestedTime));
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const dur = clipDuration(clip);
    const speed = getClipSpeed(clip);
    const playbackDur = dur / speed;
    const isLast = index === clips.length - 1;
    if (projectTime < cursor + playbackDur || isLast) {
      const elapsed = Math.min(playbackDur, projectTime - cursor);
      const sourceOffset = elapsed * speed;
      return {
        clipId: clip.id,
        clipIndex: index,
        sourceTime: Math.min(clip.trimEnd, clip.trimStart + sourceOffset),
        projectTime,
      };
    }
    cursor += playbackDur;
  }
  return null;
}

/** Compute output canvas dimensions from aspect ratio and resolution. */
export function computeCanvasDimensions(aspect: CanvasAspect, resolution: ExportResolution): { width: number; height: number } {
  // Standard resolution dimensions, pre-computed for accuracy
  const DIMENSIONS: Record<CanvasAspect, Record<ExportResolution, { width: number; height: number }>> = {
    '16:9': {
      '480p': { width: 854, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
    },
    '9:16': {
      '480p': { width: 480, height: 854 },
      '720p': { width: 720, height: 1280 },
      '1080p': { width: 1080, height: 1920 },
    },
    '4:3': {
      '480p': { width: 640, height: 480 },
      '720p': { width: 960, height: 720 },
      '1080p': { width: 1440, height: 1080 },
    },
    '1:1': {
      '480p': { width: 480, height: 480 },
      '720p': { width: 720, height: 720 },
      '1080p': { width: 1080, height: 1080 },
    },
    'auto': {
      '480p': { width: 854, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
    },
  };

  return DIMENSIONS[aspect]?.[resolution] ?? DIMENSIONS['16:9'][resolution];
}

/** Build CSS transform string for rotation and flips (preview use). */
export function buildRotationTransformCSS(rotation: 0 | 90 | 180 | 270, flipH: boolean, flipV: boolean): string {
  const parts: string[] = [];
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
  if (flipH) parts.push('scaleX(-1)');
  if (flipV) parts.push('scaleY(-1)');
  return parts.join(' ');
}

/**
 * Build FFmpeg atempo filter chain for a given speed.
 * atempo only supports values in [0.5, 2.0], so we chain multiple filters.
 */
export function buildAtempoChain(speed: number): string {
  if (speed === 1.0) return '';
  const filters: string[] = [];
  let remaining = speed;
  if (speed > 1.0) {
    while (remaining > 2.0 + 1e-9) {
      filters.push('atempo=2');
      remaining /= 2.0;
    }
    filters.push(`atempo=${Number(remaining.toFixed(6))}`);
  } else {
    while (remaining < 0.5 - 1e-9) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    filters.push(`atempo=${Number(remaining.toFixed(6))}`);
  }
  return filters.join(',');
}

export function splitClipAt<T extends EditableClip>(clips: T[], id: string, sourceTime: number, newId: string): T[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0 || !Number.isFinite(sourceTime)) return clips;
  const clip = clips[index];
  clipDuration(clip);
  if (sourceTime - clip.trimStart < MIN_CLIP_DURATION || clip.trimEnd - sourceTime < MIN_CLIP_DURATION) {
    return clips;
  }
  assertNewId(clips, newId);
  const first = { ...clip, trimEnd: sourceTime };
  const second = { ...clip, id: newId, trimStart: sourceTime };
  return [...clips.slice(0, index), first, second, ...clips.slice(index + 1)];
}

export function duplicateClip<T extends EditableClip>(clips: T[], id: string, newId: string): T[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;
  assertNewId(clips, newId);
  const duplicate = { ...clips[index], id: newId };
  return [...clips.slice(0, index + 1), duplicate, ...clips.slice(index + 1)];
}

export function moveClipToIndex<T extends EditableClip>(clips: T[], id: string, targetIndex: number): T[] {
  const sourceIndex = clips.findIndex((clip) => clip.id === id);
  if (sourceIndex < 0 || !Number.isFinite(targetIndex)) return clips;
  const destination = Math.max(0, Math.min(clips.length - 1, Math.trunc(targetIndex)));
  if (sourceIndex === destination) return clips;
  const reordered = [...clips];
  const [clip] = reordered.splice(sourceIndex, 1);
  reordered.splice(destination, 0, clip);
  return reordered;
}

export function locateProjectTime<T extends EditableClip>(clips: T[], requestedTime: number): ProjectPosition | null {
  if (!clips.length || !Number.isFinite(requestedTime)) return null;
  const total = getProjectDuration(clips);
  const projectTime = Math.max(0, Math.min(total, requestedTime));
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const duration = clipDuration(clip);
    const isLast = index === clips.length - 1;
    if (projectTime < cursor + duration || isLast) {
      return {
        clipId: clip.id,
        clipIndex: index,
        sourceTime: Math.min(clip.trimEnd, clip.trimStart + projectTime - cursor),
        projectTime,
      };
    }
    cursor += duration;
  }
  return null;
}

export function projectTimeForClip<T extends EditableClip>(clips: T[], id: string, sourceTime: number): number | null {
  if (!Number.isFinite(sourceTime)) return null;
  let cursor = 0;
  for (const clip of clips) {
    const duration = clipDuration(clip);
    if (clip.id === id) {
      const clampedSourceTime = Math.max(clip.trimStart, Math.min(clip.trimEnd, sourceTime));
      return cursor + clampedSourceTime - clip.trimStart;
    }
    cursor += duration;
  }
  return null;
}

/** Map a source playhead onto the speed-adjusted project timeline. */
export function projectTimeForClipSpeedAware<T extends SpeedAwareClip>(clips: T[], id: string, sourceTime: number): number | null {
  if (!Number.isFinite(sourceTime)) return null;
  let cursor = 0;
  for (const clip of clips) {
    const duration = clipDuration(clip);
    const speed = getClipSpeed(clip);
    if (clip.id === id) {
      const clampedSourceTime = Math.max(clip.trimStart, Math.min(clip.trimEnd, sourceTime));
      return cursor + (clampedSourceTime - clip.trimStart) / speed;
    }
    cursor += duration / speed;
  }
  return null;
}
