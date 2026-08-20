/**
 * Pure utility functions for subtitle cues and visual overlays.
 * No UI, no side effects, no browser APIs beyond types.
 */

// --- Type definitions ---

export interface SubtitleCue {
  id: string;
  text: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  fontSize: number;
  lineHeight: number;
  color: string;
  backgroundColor: string;
  position: { x: number; y: number };
  width: number;
  align: 'left' | 'center' | 'right';
  rotation: number;
  startTime: number;
  endTime: number;
  tts: {
    enabled: boolean;
    voiceURI: string;
    lang: string;
    rate: number;
    pitch: number;
    volume: number;
  } | null;
}

export type VisualOverlayType = 'drawing' | 'rectangle' | 'image';

export interface VisualOverlayBase {
  id: string;
  type: VisualOverlayType;
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation: number;
  opacity: number;
  startTime: number;
  endTime: number;
}

export interface DrawingOverlay extends VisualOverlayBase {
  type: 'drawing';
  points: Array<{ x: number; y: number }>;
  strokeColor: string;
  strokeWidth: number;
}

export interface RectangleOverlay extends VisualOverlayBase {
  type: 'rectangle';
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  borderRadius: number;
}

export interface ImageOverlay extends VisualOverlayBase {
  type: 'image';
  file?: File;
  url?: string;
}

export type VisualOverlay = DrawingOverlay | RectangleOverlay | ImageOverlay;

// --- ID generation ---

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Factory functions ---

const DEFAULT_CUE_DURATION = 5;

/**
 * Create a default SubtitleCue starting at the given project time.
 */
export function createDefaultSubtitleCue(projectTime: number): SubtitleCue {
  const start = Math.max(0, projectTime);
  return {
    id: generateId(),
    text: '',
    fontFamily: 'sans',
    fontSize: 48,
    lineHeight: 1.3,
    color: '#ffffff',
    backgroundColor: '',
    position: { x: 50, y: 85 },
    width: 80,
    align: 'center',
    rotation: 0,
    startTime: start,
    endTime: start + DEFAULT_CUE_DURATION,
    tts: null,
  };
}

/**
 * Create a default DrawingOverlay at the given project time.
 */
export function createDefaultDrawingOverlay(projectTime: number): DrawingOverlay {
  const start = Math.max(0, projectTime);
  return {
    id: generateId(),
    type: 'drawing',
    position: { x: 50, y: 50 },
    size: { w: 30, h: 30 },
    rotation: 0,
    opacity: 1,
    startTime: start,
    endTime: start + DEFAULT_CUE_DURATION,
    points: [],
    strokeColor: '#ff0000',
    strokeWidth: 0.3,
  };
}

/**
 * Create a default RectangleOverlay at the given project time.
 */
export function createDefaultRectangleOverlay(projectTime: number): RectangleOverlay {
  const start = Math.max(0, projectTime);
  return {
    id: generateId(),
    type: 'rectangle',
    position: { x: 50, y: 50 },
    size: { w: 30, h: 20 },
    rotation: 0,
    opacity: 1,
    startTime: start,
    endTime: start + DEFAULT_CUE_DURATION,
    strokeColor: '#ff0000',
    strokeWidth: 2,
    fillColor: '',
    borderRadius: 0,
  };
}

/**
 * Create a default ImageOverlay at the given project time.
 */
export function createDefaultImageOverlay(projectTime: number): ImageOverlay {
  const start = Math.max(0, projectTime);
  return {
    id: generateId(),
    type: 'image',
    position: { x: 50, y: 50 },
    size: { w: 30, h: 30 },
    rotation: 0,
    opacity: 1,
    startTime: start,
    endTime: start + DEFAULT_CUE_DURATION,
  };
}

// --- Time utilities ---

/**
 * Clamp a start/end time range to the given bounds [min, max].
 */
export function clampTimeRange(
  startTime: number,
  endTime: number,
  min: number,
  max: number,
): { startTime: number; endTime: number } {
  const clampedStart = Math.max(min, Math.min(max, startTime));
  const clampedEnd = Math.max(clampedStart, Math.min(max, endTime));
  return { startTime: clampedStart, endTime: clampedEnd };
}

/**
 * Filter overlays/cues that intersect the time range (startTime, endTime) — exclusive boundaries.
 * An overlay intersects if overlay.endTime > rangeStart AND overlay.startTime < rangeEnd.
 */
export function filterOverlaysByTimeRange<T extends { startTime: number; endTime: number }>(
  items: T[],
  rangeStart: number,
  rangeEnd: number,
): T[] {
  return items.filter((item) => item.endTime > rangeStart && item.startTime < rangeEnd);
}

/**
 * Shift startTime and endTime of each item by the given offset.
 * Clamps startTime to 0 minimum.
 */
export function shiftOverlayTimes<T extends { startTime: number; endTime: number }>(
  items: T[],
  offset: number,
): T[] {
  return items.map((item) => {
    const newStart = Math.max(0, item.startTime + offset);
    const newEnd = Math.max(newStart, item.endTime + offset);
    return { ...item, startTime: newStart, endTime: newEnd };
  });
}

// --- TTS hit detection ---

/**
 * Find the first subtitle cue with TTS enabled that is active at the given project time.
 * Active means: startTime <= time < endTime.
 */
export function getActiveTtsCue(cues: SubtitleCue[], time: number): SubtitleCue | null {
  for (const cue of cues) {
    if (cue.tts && cue.tts.enabled && time >= cue.startTime && time < cue.endTime) {
      return cue;
    }
  }
  return null;
}

// --- Drawing point utilities ---

/**
 * Normalize pixel coordinates to 0–1 range relative to given width and height.
 * Values are clamped to [0, 1].
 */
export function normalizeDrawingPoints(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  if (width <= 0 || height <= 0) return [];
  return points.map((p) => ({
    x: Math.max(0, Math.min(1, p.x / width)),
    y: Math.max(0, Math.min(1, p.y / height)),
  }));
}

/**
 * Compute the bounding box of normalized drawing points.
 */
export function computeDrawingBounds(
  points: Array<{ x: number; y: number }>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// --- Export selection: intersect and shift overlays to export-relative time ---

/**
 * Select overlays/cues that intersect the export range and shift their times to be
 * relative to the range start. Validates that resulting intervals are legal (end > start).
 * Returns items with start = max(rangeStart, item.start) - rangeStart,
 *                        end = min(rangeEnd, item.end) - rangeStart.
 */
export function selectAndShiftOverlaysForExport<T extends { startTime: number; endTime: number }>(
  items: T[],
  rangeStart: number,
  rangeEnd: number,
): T[] {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < 0 || rangeEnd <= rangeStart) {
    throw new Error('Invalid export range');
  }
  return items
    .filter((item) => item.endTime > rangeStart && item.startTime < rangeEnd)
    .map((item) => {
      const newStart = Math.max(rangeStart, item.startTime) - rangeStart;
      const newEnd = Math.min(rangeEnd, item.endTime) - rangeStart;
      if (newEnd <= newStart) return null;
      return { ...item, startTime: newStart, endTime: newEnd };
    })
    .filter((item): item is T => item !== null);
}

// --- Drawing point rebasing ---

/**
 * Rebase drawing points from full preview-normalized (0..1 over entire preview) coordinates
 * to local overlay-bounds-relative (0..1 within the overlay bounding box) coordinates.
 *
 * bounds: { minX, maxX, minY, maxY } in 0..1 space.
 * Points outside the bounds are clamped to 0..1 local.
 */
export function rebaseDrawingPoints(
  points: Array<{ x: number; y: number }>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Array<{ x: number; y: number }> {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0) return points.map(() => ({ x: 0.5, y: 0.5 }));
  return points.map((p) => ({
    x: Math.max(0, Math.min(1, (p.x - bounds.minX) / w)),
    y: Math.max(0, Math.min(1, (p.y - bounds.minY) / h)),
  }));
}

// --- CSS transform for preview ---

/**
 * Compute a CSS transform string for positioning an overlay in preview.
 * Position is percentage-based (left/top set to x%/y%), transform centers it and applies rotation.
 */
export function computeOverlayCssTransform(
  position: { x: number; y: number },
  rotation: number,
): string {
  let transform = 'translate(-50%, -50%)';
  if (rotation !== 0) {
    transform += ` rotate(${rotation}deg)`;
  }
  return transform;
}

// --- FFmpeg overlay input description ---

function formatTime(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export interface OverlayInputDescription {
  inputArgs: string[];
  filterExpr: string;
}

/**
 * Build the FFmpeg input arguments and overlay filter expression for a single PNG overlay.
 * @param filename - MEMFS filename of the pre-rendered PNG
 * @param startTime - overlay start time in export-relative seconds
 * @param endTime - overlay end time in export-relative seconds
 * @param inputIndex - the FFmpeg input index for this PNG
 */
export function buildOverlayInputDescription(
  filename: string,
  startTime: number,
  endTime: number,
  inputIndex: number,
): OverlayInputDescription {
  return {
    inputArgs: ['-loop', '1', '-i', filename],
    filterExpr: `[${inputIndex}:v]overlay=0:0:enable='between(t,${formatTime(startTime)},${formatTime(endTime)})'`,
  };
}
