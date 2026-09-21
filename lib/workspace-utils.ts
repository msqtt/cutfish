/** Browser-independent workspace layout and timeline movement helpers. */

export function clampWorkspaceSize(value: number, min: number, max: number): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? Math.max(safeMin, max) : safeMin;
  if (!Number.isFinite(value)) return safeMin;
  return Math.max(safeMin, Math.min(safeMax, value));
}

/**
 * Resize a panel from its starting size. Direction is `1` when positive pointer
 * movement grows the panel and `-1` when it shrinks it (right and top edges).
 */
export function resizeWorkspacePanel(
  startSize: number,
  pointerDelta: number,
  direction: 1 | -1,
  min: number,
  max: number,
): number {
  return clampWorkspaceSize(startSize + pointerDelta * direction, min, max);
}

export function stepTimelineZoom(current: number, direction: -1 | 1): number {
  const safeCurrent = Number.isFinite(current) ? current : 1;
  const next = safeCurrent + direction * 0.25;
  return Math.max(0.3, Math.min(5, Math.round(next * 100) / 100));
}

export function formatEditorTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalTenths = Math.round(safeSeconds * 10);
  const minutes = Math.floor(totalTenths / 600);
  const remaining = (totalTenths % 600) / 10;
  return `${minutes}:${remaining.toFixed(1).padStart(4, '0')}`;
}

/** Move a project-time range while preserving its duration. */
export function moveTimedRange(
  startTime: number,
  endTime: number,
  targetStart: number,
  projectDuration: number,
): { startTime: number; endTime: number } {
  const duration = Math.max(0.01, endTime - startTime);
  const finiteTarget = Number.isFinite(targetStart) ? targetStart : 0;
  const maxStart = Math.max(0, projectDuration - duration);
  const nextStart = duration > projectDuration
    ? 0
    : Math.max(0, Math.min(maxStart, finiteTarget));
  return { startTime: nextStart, endTime: nextStart + duration };
}

export type VisibleTimelineTrack = 'video' | 'source-audio' | 'background-audio' | 'tts-audio' | 'subtitle' | 'image' | 'effect';

export interface TimelineTrackAvailability {
  hasVideo: boolean;
  hasBackgroundAudio: boolean;
  hasSubtitles: boolean;
  hasTts?: boolean;
  hasImages: boolean;
  hasEffects: boolean;
}

/** Resolve timeline rows from current project content; empty optional rows stay hidden. */
export function resolveVisibleTimelineTracks(availability: TimelineTrackAvailability): VisibleTimelineTrack[] {
  if (!availability.hasVideo) return [];
  const tracks: VisibleTimelineTrack[] = ['video', 'source-audio'];
  if (availability.hasBackgroundAudio) tracks.push('background-audio');
  if (availability.hasTts) tracks.push('tts-audio');
  if (availability.hasSubtitles) tracks.push('subtitle');
  if (availability.hasImages) tracks.push('image');
  if (availability.hasEffects) tracks.push('effect');
  return tracks;
}
