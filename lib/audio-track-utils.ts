export interface AudioTrackSegment {
  id: string;
  projectStart: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface AudioTrackExportSegment {
  id: string;
  startTime: number;
  endTime: number;
  sourceTrimStart: number;
  sourceTrimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export function getAudioSegmentDuration(segment: AudioTrackSegment) {
  return Math.max(0, segment.trimEnd - segment.trimStart);
}

export function selectAudioSegmentsForExport(
  segments: AudioTrackSegment[],
  rangeStart: number,
  rangeEnd: number,
): AudioTrackExportSegment[] {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < 0 || rangeEnd <= rangeStart) {
    throw new Error('Invalid export range');
  }

  return segments.flatMap((segment) => {
    const duration = getAudioSegmentDuration(segment);
    if (!Number.isFinite(segment.projectStart) || segment.projectStart < 0 || duration <= 0) return [];
    const projectEnd = segment.projectStart + duration;
    const visibleStart = Math.max(segment.projectStart, rangeStart);
    const visibleEnd = Math.min(projectEnd, rangeEnd);
    if (visibleEnd <= visibleStart) return [];

    const cutFromStart = visibleStart - segment.projectStart;
    const visibleDuration = visibleEnd - visibleStart;
    const includesStart = cutFromStart <= 1e-6;
    const includesEnd = Math.abs(visibleEnd - projectEnd) <= 1e-6;

    return [{
      id: segment.id,
      startTime: visibleStart - rangeStart,
      endTime: visibleEnd - rangeStart,
      sourceTrimStart: segment.trimStart + cutFromStart,
      sourceTrimEnd: segment.trimStart + cutFromStart + visibleDuration,
      volume: Math.max(0, Math.min(2, segment.volume / 100)),
      fadeIn: includesStart ? Math.min(Math.max(0, segment.fadeIn), visibleDuration) : 0,
      fadeOut: includesEnd ? Math.min(Math.max(0, segment.fadeOut), visibleDuration) : 0,
    }];
  });
}

export function splitAudioSegment(
  segment: AudioTrackSegment,
  projectTime: number,
  rightId: string,
): [AudioTrackSegment, AudioTrackSegment] | null {
  const duration = getAudioSegmentDuration(segment);
  const offset = projectTime - segment.projectStart;
  if (!rightId || !Number.isFinite(projectTime) || offset <= 0.01 || offset >= duration - 0.01) return null;

  const sourceSplit = segment.trimStart + offset;
  return [
    { ...segment, trimEnd: sourceSplit, fadeOut: 0 },
    { ...segment, id: rightId, projectStart: projectTime, trimStart: sourceSplit, fadeIn: 0 },
  ];
}

export function clampAudioSegmentToSource(
  segment: AudioTrackSegment,
  sourceDuration: number,
): AudioTrackSegment {
  const duration = Number.isFinite(sourceDuration) ? Math.max(0.01, sourceDuration) : 0.01;
  const trimStart = Math.max(0, Math.min(duration - 0.01, segment.trimStart));
  const trimEnd = Math.max(trimStart + 0.01, Math.min(duration, segment.trimEnd));
  return {
    ...segment,
    projectStart: Math.max(0, Number.isFinite(segment.projectStart) ? segment.projectStart : 0),
    trimStart,
    trimEnd,
    volume: Math.max(0, Math.min(200, segment.volume)),
    fadeIn: Math.max(0, Math.min(segment.fadeIn, trimEnd - trimStart)),
    fadeOut: Math.max(0, Math.min(segment.fadeOut, trimEnd - trimStart)),
  };
}

/**
 * A single video-clip's layout contribution on the timeline, expressed as its
 * project-time playback duration (seconds, speed-adjusted) and its rendered
 * pixel width (already clamped to the min-width + zoom the video row uses).
 */
export interface TimelineClipLayout {
  playbackDuration: number;
  clipPx: number;
}

/**
 * Map a project-time (seconds) to a pixel offset within the timeline scroll
 * surface, walking the same per-clip layout the video row renders (min-width
 * clamp + inter-clip gaps). Keeps the audio (A1) row pixel-aligned with the
 * video (V1) row even though clip widths are not strictly proportional to time.
 * Times past the project end extrapolate linearly at `pxPerSecond`.
 */
export function projectTimeToPixel(
  layout: TimelineClipLayout[],
  projectTime: number,
  pxPerSecond: number,
  gapPx: number,
): number {
  const target = Math.max(0, projectTime);
  let cursor = 0;
  let accPx = 0;
  for (let i = 0; i < layout.length; i++) {
    const { playbackDuration, clipPx } = layout[i];
    if (target <= cursor + playbackDuration || i === layout.length - 1) {
      const ratio = playbackDuration > 0 ? Math.max(0, Math.min(1, (target - cursor) / playbackDuration)) : 0;
      const overshoot = target > cursor + playbackDuration ? (target - cursor - playbackDuration) * pxPerSecond : 0;
      return accPx + ratio * clipPx + overshoot;
    }
    cursor += playbackDuration;
    accPx += clipPx + gapPx;
  }
  return target * pxPerSecond;
}

/** Inverse of {@link projectTimeToPixel}: pixel offset → project-time seconds. */
export function pixelToProjectTime(
  layout: TimelineClipLayout[],
  px: number,
  pxPerSecond: number,
  gapPx: number,
): number {
  const target = Math.max(0, px);
  let cursor = 0;
  let accPx = 0;
  for (let i = 0; i < layout.length; i++) {
    const { playbackDuration, clipPx } = layout[i];
    if (target <= accPx + clipPx || i === layout.length - 1) {
      if (target > accPx + clipPx) {
        return cursor + playbackDuration + (target - accPx - clipPx) / pxPerSecond;
      }
      const ratio = clipPx > 0 ? Math.max(0, Math.min(1, (target - accPx) / clipPx)) : 0;
      return cursor + ratio * playbackDuration;
    }
    cursor += playbackDuration;
    accPx += clipPx + gapPx;
  }
  return target / pxPerSecond;
}
