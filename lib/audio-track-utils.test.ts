import { describe, expect, it } from 'vitest';
import {
  clampAudioSegmentToSource,
  getAudioSegmentDuration,
  selectAudioSegmentsForExport,
  splitAudioSegment,
  projectTimeToPixel,
  pixelToProjectTime,
  type AudioTrackSegment,
  type TimelineClipLayout,
} from './audio-track-utils';

const segment: AudioTrackSegment = {
  id: 'a1', projectStart: 3, trimStart: 2, trimEnd: 10,
  volume: 80, fadeIn: 1, fadeOut: 2,
};

describe('audio track segment helpers', () => {
  it('computes trimmed playback duration', () => {
    expect(getAudioSegmentDuration(segment)).toBe(8);
  });

  it('maps a full segment to export-relative time and source trim', () => {
    expect(selectAudioSegmentsForExport([segment], 0, 15)).toEqual([{
      id: 'a1', startTime: 3, endTime: 11, sourceTrimStart: 2, sourceTrimEnd: 10,
      volume: 0.8, fadeIn: 1, fadeOut: 2,
    }]);
  });

  it('clips a segment at both export boundaries', () => {
    expect(selectAudioSegmentsForExport([segment], 5, 9)).toEqual([{
      id: 'a1', startTime: 0, endTime: 4, sourceTrimStart: 4, sourceTrimEnd: 8,
      volume: 0.8, fadeIn: 0, fadeOut: 0,
    }]);
  });

  it('keeps only a fade whose original segment edge remains visible', () => {
    const [result] = selectAudioSegmentsForExport([segment], 0, 7);
    expect(result.fadeIn).toBe(1);
    expect(result.fadeOut).toBe(0);
  });

  it('excludes segments outside the range and rejects invalid ranges', () => {
    expect(selectAudioSegmentsForExport([segment], 12, 20)).toEqual([]);
    expect(() => selectAudioSegmentsForExport([segment], 5, 5)).toThrow('Invalid export range');
  });

  it('splits at project time while preserving only the outer fades', () => {
    const result = splitAudioSegment(segment, 7, 'a2');
    expect(result).toEqual([
      { ...segment, trimEnd: 6, fadeOut: 0 },
      { ...segment, id: 'a2', projectStart: 7, trimStart: 6, fadeIn: 0 },
    ]);
  });

  it('does not split at or near segment boundaries', () => {
    expect(splitAudioSegment(segment, 3, 'a2')).toBeNull();
    expect(splitAudioSegment(segment, 11, 'a2')).toBeNull();
  });

  it('clamps editable values to source and supported ranges', () => {
    expect(clampAudioSegmentToSource({
      ...segment, projectStart: -2, trimStart: -1, trimEnd: 99,
      volume: 250, fadeIn: 20, fadeOut: -1,
    }, 12)).toEqual({
      ...segment, projectStart: 0, trimStart: 0, trimEnd: 12,
      volume: 200, fadeIn: 12, fadeOut: 0,
    });
  });
});

describe('timeline project-time ↔ pixel mapping', () => {
  // Two clips: 10s at 200px, 20s at 400px. pxPerSecond=20, gap=8.
  const layout: TimelineClipLayout[] = [
    { playbackDuration: 10, clipPx: 200 },
    { playbackDuration: 20, clipPx: 400 },
  ];

  it('maps project start to pixel 0 and back', () => {
    expect(projectTimeToPixel(layout, 0, 20, 8)).toBe(0);
    expect(pixelToProjectTime(layout, 0, 20, 8)).toBe(0);
  });

  it('maps within the first clip proportionally', () => {
    // Halfway (5s) → half of 200px = 100px.
    expect(projectTimeToPixel(layout, 5, 20, 8)).toBe(100);
    expect(pixelToProjectTime(layout, 100, 20, 8)).toBe(5);
  });

  it('maps a clip boundary to the end of the preceding clip', () => {
    // 10s is the boundary: maps to the end of clip 1 (200px), not the gap.
    expect(projectTimeToPixel(layout, 10, 20, 8)).toBe(200);
  });

  it('accounts for the inter-clip gap just inside the second clip', () => {
    // 11s → 1s into clip 2: accPx(208) + (1/20)*400 = 208 + 20 = 228px.
    expect(projectTimeToPixel(layout, 11, 20, 8)).toBe(228);
    expect(pixelToProjectTime(layout, 228, 20, 8)).toBe(11);
  });

  it('maps within the second clip', () => {
    // 20s → 208 + half of 400 = 408px.
    expect(projectTimeToPixel(layout, 20, 20, 8)).toBe(408);
    expect(pixelToProjectTime(layout, 408, 20, 8)).toBe(20);
  });

  it('extrapolates linearly past the project end', () => {
    // 35s = 5s past the 30s end → 608px (208+400) + 5*20 = 708px.
    expect(projectTimeToPixel(layout, 35, 20, 8)).toBe(708);
    expect(pixelToProjectTime(layout, 708, 20, 8)).toBeCloseTo(35, 6);
  });

  it('clamps negative inputs to zero', () => {
    expect(projectTimeToPixel(layout, -5, 20, 8)).toBe(0);
    expect(pixelToProjectTime(layout, -5, 20, 8)).toBe(0);
  });

  it('falls back to a linear scale with no clips', () => {
    expect(projectTimeToPixel([], 3, 20, 8)).toBe(60);
    expect(pixelToProjectTime([], 60, 20, 8)).toBe(3);
  });
});
