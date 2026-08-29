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
