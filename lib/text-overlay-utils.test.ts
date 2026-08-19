import { describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import {
  buildDrawtextFilters,
  buildOverlayImageFilter,
  selectTextOverlaysForExport,
  type TextOverlay,
  type FontMap,
} from './text-overlay-utils';

const fontMap: FontMap = {
  sans: '/fonts/sans.ttf',
  serif: '/fonts/serif.ttf',
  mono: '/fonts/mono.ttf',
};

const overlays: TextOverlay[] = [
  {
    id: 'o1',
    text: 'Hello World',
    fontFamily: 'sans',
    fontSize: 48,
    color: '#ffffff',
    position: { x: 50, y: 50 },
    startTime: 2,
    endTime: 5,
  },
  {
    id: 'o2',
    text: "It's a test",
    fontFamily: 'mono',
    fontSize: 24,
    color: '#ff0000',
    position: { x: 10, y: 90 },
    startTime: 0,
    endTime: 3.5,
  },
];

describe('buildDrawtextFilters', () => {
  it('returns empty string for empty overlays', () => {
    expect(buildDrawtextFilters([], fontMap)).toBe('');
  });

  it('generates a single drawtext filter with correct parameters', () => {
    const result = buildDrawtextFilters([overlays[0]], fontMap);
    expect(result).toContain('drawtext=');
    expect(result).toContain("fontfile='/fonts/sans.ttf'");
    expect(result).toContain("fontcolor='#ffffff'");
    expect(result).toContain('fontsize=48');
    expect(result).toContain("enable='between(t,2,5)'");
    // Position: x=50% → x=(w*50/100), y=50% → y=(h*50/100)
    expect(result).toContain('x=(w*50/100)');
    expect(result).toContain('y=(h*50/100)');
  });

  it('escapes special characters in text', () => {
    const result = buildDrawtextFilters([overlays[1]], fontMap);
    // Single quotes in text need escaping for ffmpeg drawtext
    expect(result).toContain("It\\'s a test");
  });

  it('chains multiple drawtext filters with commas', () => {
    const result = buildDrawtextFilters(overlays, fontMap);
    // Two drawtext filters separated by comma
    const parts = result.split('drawtext=');
    expect(parts.length).toBe(3); // '' + first + second
  });

  it('uses correct font file path for each family', () => {
    const result = buildDrawtextFilters(overlays, fontMap);
    expect(result).toContain("fontfile='/fonts/sans.ttf'");
    expect(result).toContain("fontfile='/fonts/mono.ttf'");
  });
});

describe('buildOverlayImageFilter', () => {
  it('generates overlay filter with correct timing and input reference', () => {
    const result = buildOverlayImageFilter('text_overlay.png', 2, 5, 0);
    expect(result).toContain('overlay=');
    expect(result).toContain("enable='between(t,2,5)'");
    expect(result).toContain('[0:v]');
  });

  it('handles input index offset', () => {
    const result = buildOverlayImageFilter('text.png', 1, 4, 2);
    expect(result).toContain('[2:v]');
  });
});

describe('selectTextOverlaysForExport', () => {
  it('clips intersecting overlays and shifts them into output-relative time', () => {
    const result = selectTextOverlaysForExport(overlays, 2.5, 4);
    expect(result).toEqual([
      { ...overlays[0], startTime: 0, endTime: 1.5 },
      { ...overlays[1], startTime: 0, endTime: 1 },
    ]);
  });

  it('excludes overlays that only touch the range boundary', () => {
    expect(selectTextOverlaysForExport(overlays, 5, 6)).toEqual([]);
  });

  it('rejects invalid export ranges', () => {
    expect(() => selectTextOverlaysForExport(overlays, 3, 3)).toThrow('Invalid text overlay export range');
    expect(() => selectTextOverlaysForExport(overlays, Number.NaN, 4)).toThrow('Invalid text overlay export range');
  });
});

describe('bundled font assets', () => {
  it.each(['DejaVuSans.ttf', 'DejaVuSerif.ttf', 'DejaVuSansMono.ttf'])(
    'contains a real, non-placeholder %s font',
    (filename) => {
      expect(statSync(`public/fonts/${filename}`).size).toBeGreaterThan(100_000);
    },
  );
});
