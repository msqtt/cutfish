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

export function clipPointerToSourceTime(
  clientX: number,
  left: number,
  width: number,
  trimStart: number,
  trimEnd: number,
): number {
  const start = Number.isFinite(trimStart) ? trimStart : 0;
  const end = Number.isFinite(trimEnd) ? Math.max(start, trimEnd) : start;
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return start;
  const ratio = Math.max(0, Math.min(1, (clientX - left) / width));
  return start + ratio * (end - start);
}

export function clampProjectItemStart(targetStart: number, itemDuration: number, projectDuration: number): number {
  const target = Number.isFinite(targetStart) ? targetStart : 0;
  const duration = Number.isFinite(itemDuration) ? Math.max(0, itemDuration) : 0;
  const project = Number.isFinite(projectDuration) ? Math.max(0, projectDuration) : 0;
  return Math.max(0, Math.min(Math.max(0, project - duration), target));
}

export function hasPassedDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 6,
): boolean {
  if (![startX, startY, currentX, currentY, threshold].every(Number.isFinite)) return false;
  return Math.hypot(currentX - startX, currentY - startY) >= Math.max(0, threshold);
}

export type TimelineSelectionTrack = 'video' | 'source-audio' | 'background-audio' | 'tts' | 'subtitle' | 'image' | 'effect';
export interface TimelineSelection {
  track: TimelineSelectionTrack;
  linkedTrack?: TimelineSelectionTrack;
  id: string;
}
export type TimelineSelectionState = 'selected' | 'linked' | 'none';

export function timelineSelectionState(
  selection: TimelineSelection | null,
  candidateTrack: TimelineSelectionTrack,
  candidateId: string,
): TimelineSelectionState {
  if (!selection || selection.id !== candidateId) return 'none';
  if (selection.track === candidateTrack) return 'selected';
  if (selection.linkedTrack === candidateTrack) return 'linked';
  return 'none';
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
