import { describe, expect, it } from 'vitest';
import {
  createDefaultSubtitleCue,
  createDefaultDrawingOverlay,
  createDefaultRectangleOverlay,
  createDefaultImageOverlay,
  clampTimeRange,
  filterOverlaysByTimeRange,
  shiftOverlayTimes,
  selectAndShiftOverlaysForExport,
  rebaseDrawingPoints,
  getActiveTtsCue,
  normalizeDrawingPoints,
  computeDrawingBounds,
  computeOverlayCssTransform,
  buildOverlayInputDescription,
  type SubtitleCue,
} from './visual-overlay-utils';

describe('createDefaultSubtitleCue', () => {
  it('creates a cue with startTime = provided projectTime', () => {
    const cue = createDefaultSubtitleCue(5.5);
    expect(cue.id).toBeTruthy();
    expect(cue.startTime).toBe(5.5);
    expect(cue.endTime).toBe(10.5); // startTime + 5
    expect(cue.text).toBe('');
    expect(cue.fontFamily).toBe('sans');
    expect(cue.fontSize).toBe(48);
    expect(cue.color).toBe('#ffffff');
    expect(cue.backgroundColor).toBe('');
    expect(cue.position).toEqual({ x: 50, y: 85 });
    expect(cue.width).toBe(80);
    expect(cue.align).toBe('center');
    expect(cue.rotation).toBe(0);
    expect(cue.tts).toBeNull();
  });

  it('clamps startTime to 0 if negative', () => {
    const cue = createDefaultSubtitleCue(-1);
    expect(cue.startTime).toBe(0);
    expect(cue.endTime).toBe(5);
  });
});

describe('createDefaultDrawingOverlay', () => {
  it('creates a drawing overlay at provided projectTime', () => {
    const overlay = createDefaultDrawingOverlay(3);
    expect(overlay.id).toBeTruthy();
    expect(overlay.type).toBe('drawing');
    expect(overlay.startTime).toBe(3);
    expect(overlay.endTime).toBe(8);
    expect(overlay.position).toEqual({ x: 50, y: 50 });
    expect(overlay.size).toEqual({ w: 30, h: 30 });
    expect(overlay.rotation).toBe(0);
    expect(overlay.opacity).toBe(1);
    expect(overlay.points).toEqual([]);
    expect(overlay.strokeColor).toBe('#ff0000');
    expect(overlay.strokeWidth).toBe(0.3);
  });
});

describe('createDefaultRectangleOverlay', () => {
  it('creates a rectangle overlay at provided projectTime', () => {
    const overlay = createDefaultRectangleOverlay(2);
    expect(overlay.id).toBeTruthy();
    expect(overlay.type).toBe('rectangle');
    expect(overlay.startTime).toBe(2);
    expect(overlay.endTime).toBe(7);
    expect(overlay.position).toEqual({ x: 50, y: 50 });
    expect(overlay.size).toEqual({ w: 30, h: 20 });
    expect(overlay.strokeColor).toBe('#ff0000');
    expect(overlay.strokeWidth).toBe(2);
    expect(overlay.fillColor).toBe('');
    expect(overlay.borderRadius).toBe(0);
  });
});

describe('createDefaultImageOverlay', () => {
  it('creates an image overlay at provided projectTime', () => {
    const overlay = createDefaultImageOverlay(1);
    expect(overlay.id).toBeTruthy();
    expect(overlay.type).toBe('image');
    expect(overlay.startTime).toBe(1);
    expect(overlay.endTime).toBe(6);
    expect(overlay.position).toEqual({ x: 50, y: 50 });
    expect(overlay.size).toEqual({ w: 30, h: 30 });
  });
});

describe('clampTimeRange', () => {
  it('clamps start/end to the given bounds', () => {
    expect(clampTimeRange(2, 8, 3, 6)).toEqual({ startTime: 3, endTime: 6 });
  });

  it('returns original values when within bounds', () => {
    expect(clampTimeRange(3, 5, 0, 10)).toEqual({ startTime: 3, endTime: 5 });
  });

  it('handles start beyond max', () => {
    expect(clampTimeRange(12, 15, 0, 10)).toEqual({ startTime: 10, endTime: 10 });
  });

  it('handles end before min', () => {
    expect(clampTimeRange(-5, -2, 0, 10)).toEqual({ startTime: 0, endTime: 0 });
  });
});

describe('filterOverlaysByTimeRange', () => {
  const overlays: Array<{ startTime: number; endTime: number; id: string }> = [
    { id: 'a', startTime: 0, endTime: 3 },
    { id: 'b', startTime: 2, endTime: 5 },
    { id: 'c', startTime: 5, endTime: 8 },
    { id: 'd', startTime: 7, endTime: 10 },
  ];

  it('returns overlays that intersect the given time range', () => {
    const result = filterOverlaysByTimeRange(overlays, 2.5, 6);
    expect(result.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes overlays that only touch the boundary', () => {
    const result = filterOverlaysByTimeRange(overlays, 3, 5);
    expect(result.map((o) => o.id)).toEqual(['b']);
  });

  it('returns empty for no intersection', () => {
    const result = filterOverlaysByTimeRange(overlays, 10, 12);
    expect(result).toEqual([]);
  });
});

describe('shiftOverlayTimes', () => {
  it('shifts start and end times by the given offset', () => {
    const items = [
      { startTime: 5, endTime: 10 },
      { startTime: 8, endTime: 12 },
    ];
    const result = shiftOverlayTimes(items, -3);
    expect(result).toEqual([
      { startTime: 2, endTime: 7 },
      { startTime: 5, endTime: 9 },
    ]);
  });

  it('clamps start to 0 after shift', () => {
    const items = [{ startTime: 1, endTime: 5 }];
    const result = shiftOverlayTimes(items, -3);
    expect(result).toEqual([{ startTime: 0, endTime: 2 }]);
  });
});

describe('getActiveTtsCue', () => {
  const cues: SubtitleCue[] = [
    {
      id: 'c1', text: 'Hello', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3, color: '#fff',
      backgroundColor: '', position: { x: 50, y: 50 }, width: 0, align: 'center',
      rotation: 0, startTime: 1, endTime: 4,
      tts: { enabled: true, voiceURI: 'v1', lang: 'en', rate: 1, pitch: 1, volume: 1, exportVoiceId: 'en_US-hfc_female-medium', includeInExport: true },
    },
    {
      id: 'c2', text: 'World', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3, color: '#fff',
      backgroundColor: '', position: { x: 50, y: 50 }, width: 0, align: 'center',
      rotation: 0, startTime: 5, endTime: 8,
      tts: { enabled: true, voiceURI: 'v1', lang: 'en', rate: 1, pitch: 1, volume: 1, exportVoiceId: 'en_US-hfc_female-medium', includeInExport: true },
    },
    {
      id: 'c3', text: 'No TTS', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3, color: '#fff',
      backgroundColor: '', position: { x: 50, y: 50 }, width: 0, align: 'center',
      rotation: 0, startTime: 1, endTime: 4,
      tts: null,
    },
  ];

  it('returns the first active TTS cue at given time', () => {
    const result = getActiveTtsCue(cues, 2);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('c1');
  });

  it('returns null when no cue is active', () => {
    expect(getActiveTtsCue(cues, 4.5)).toBeNull();
  });

  it('ignores cues with tts disabled or null', () => {
    // At time 2, c3 is also in range but has tts: null
    const onlyNullTts: SubtitleCue[] = [cues[2]];
    expect(getActiveTtsCue(onlyNullTts, 2)).toBeNull();
  });

  it('returns cue when time equals startTime (inclusive)', () => {
    expect(getActiveTtsCue(cues, 1)).not.toBeNull();
    expect(getActiveTtsCue(cues, 1)!.id).toBe('c1');
  });

  it('returns null when time equals endTime (exclusive)', () => {
    expect(getActiveTtsCue(cues, 4)).toBeNull();
  });
});

describe('normalizeDrawingPoints', () => {
  it('normalizes pixel coordinates to 0–1 relative to bounds', () => {
    const points = [
      { x: 100, y: 200 },
      { x: 300, y: 400 },
    ];
    const result = normalizeDrawingPoints(points, 400, 600);
    expect(result[0]).toEqual({ x: 0.25, y: 1 / 3 });
    expect(result[1]).toEqual({ x: 0.75, y: 2 / 3 });
  });

  it('returns empty array for empty input', () => {
    expect(normalizeDrawingPoints([], 400, 600)).toEqual([]);
  });

  it('clamps values to 0–1', () => {
    const points = [{ x: -10, y: 700 }];
    const result = normalizeDrawingPoints(points, 400, 600);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(1);
  });
});

describe('computeDrawingBounds', () => {
  it('computes bounding box from normalized points', () => {
    const points = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.9 },
      { x: 0.5, y: 0.1 },
    ];
    const bounds = computeDrawingBounds(points);
    expect(bounds.minX).toBeCloseTo(0.2);
    expect(bounds.maxX).toBeCloseTo(0.8);
    expect(bounds.minY).toBeCloseTo(0.1);
    expect(bounds.maxY).toBeCloseTo(0.9);
  });

  it('returns zero bounds for empty points', () => {
    const bounds = computeDrawingBounds([]);
    expect(bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  it('returns equal min/max for single point', () => {
    const bounds = computeDrawingBounds([{ x: 0.5, y: 0.5 }]);
    expect(bounds.minX).toBe(0.5);
    expect(bounds.maxX).toBe(0.5);
    expect(bounds.minY).toBe(0.5);
    expect(bounds.maxY).toBe(0.5);
  });
});

describe('computeOverlayCssTransform', () => {
  it('generates CSS transform for positioned and rotated overlay', () => {
    const transform = computeOverlayCssTransform({ x: 50, y: 50 }, 45);
    expect(transform).toContain('translate(-50%, -50%)');
    expect(transform).toContain('rotate(45deg)');
  });

  it('omits rotation when zero', () => {
    const transform = computeOverlayCssTransform({ x: 30, y: 70 }, 0);
    expect(transform).toContain('translate(-50%, -50%)');
    expect(transform).not.toContain('rotate');
  });
});

describe('selectAndShiftOverlaysForExport', () => {
  const items = [
    { id: 'a', startTime: 1, endTime: 4 },
    { id: 'b', startTime: 3, endTime: 7 },
    { id: 'c', startTime: 8, endTime: 10 },
  ];

  it('selects intersecting items and shifts to export-relative times', () => {
    const result = selectAndShiftOverlaysForExport(items, 2, 6);
    expect(result).toEqual([
      { id: 'a', startTime: 0, endTime: 2 },   // max(2,1)-2=0, min(6,4)-2=2
      { id: 'b', startTime: 1, endTime: 4 },   // max(2,3)-2=1, min(6,7)-2=4
    ]);
  });

  it('excludes items that do not intersect', () => {
    const result = selectAndShiftOverlaysForExport(items, 8, 12);
    expect(result).toEqual([
      { id: 'c', startTime: 0, endTime: 2 },
    ]);
  });

  it('returns empty for no intersection', () => {
    expect(selectAndShiftOverlaysForExport(items, 11, 15)).toEqual([]);
  });

  it('throws on invalid range', () => {
    expect(() => selectAndShiftOverlaysForExport(items, 5, 5)).toThrow('Invalid export range');
    expect(() => selectAndShiftOverlaysForExport(items, -1, 5)).toThrow('Invalid export range');
    expect(() => selectAndShiftOverlaysForExport(items, NaN, 5)).toThrow('Invalid export range');
  });

  it('handles items that fully contain the range', () => {
    const big = [{ id: 'x', startTime: 0, endTime: 20 }];
    const result = selectAndShiftOverlaysForExport(big, 5, 10);
    expect(result).toEqual([{ id: 'x', startTime: 0, endTime: 5 }]);
  });

  it('produces valid intervals (end > start)', () => {
    // Item that barely touches start boundary: endTime === rangeStart should be excluded
    const edge = [{ id: 'e', startTime: 0, endTime: 3 }];
    const result = selectAndShiftOverlaysForExport(edge, 3, 5);
    expect(result).toEqual([]);
  });
});

describe('rebaseDrawingPoints', () => {
  it('rebases full-preview points to local bounds', () => {
    const points = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.9 },
    ];
    const bounds = { minX: 0.2, maxX: 0.8, minY: 0.3, maxY: 0.9 };
    const result = rebaseDrawingPoints(points, bounds);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 1, y: 1 });
  });

  it('clamps out-of-bounds points to 0..1', () => {
    const points = [{ x: 0.1, y: 0.5 }];
    const bounds = { minX: 0.2, maxX: 0.8, minY: 0.3, maxY: 0.9 };
    const result = rebaseDrawingPoints(points, bounds);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBeCloseTo(1 / 3);
  });

  it('handles zero-sized bounds gracefully', () => {
    const points = [{ x: 0.5, y: 0.5 }];
    const bounds = { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 };
    const result = rebaseDrawingPoints(points, bounds);
    expect(result[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('works with mid-range points', () => {
    const points = [{ x: 0.5, y: 0.5 }];
    const bounds = { minX: 0.25, maxX: 0.75, minY: 0.25, maxY: 0.75 };
    const result = rebaseDrawingPoints(points, bounds);
    expect(result[0]).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('buildOverlayInputDescription', () => {
  it('generates input description for PNG overlay with timing', () => {
    const desc = buildOverlayInputDescription('overlay_0.png', 2.5, 7.3, 3);
    expect(desc.inputArgs).toEqual(['-loop', '1', '-i', 'overlay_0.png']);
    expect(desc.filterExpr).toContain('[3:v]');
    expect(desc.filterExpr).toContain("overlay=0:0:enable='between(t,2.5,7.3)'");
  });

  it('formats time values with reasonable precision', () => {
    const desc = buildOverlayInputDescription('x.png', 1.123456789, 3.987654321, 5);
    expect(desc.filterExpr).toContain('1.123457');
    expect(desc.filterExpr).toContain('3.987654');
  });
});
