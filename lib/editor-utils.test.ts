import { describe, expect, it } from 'vitest';
import {
  duplicateClip,
  getProjectDuration,
  locateProjectTime,
  moveClipToIndex,
  projectTimeForClip,
  splitClipAt,
  getProjectDurationSpeedAware,
  locateProjectTimeSpeedAware,
  projectTimeForClipSpeedAware,
  computeCanvasDimensions,
  buildRotationTransformCSS,
  buildAtempoChain,
} from './editor-utils';

const clips = [
  { id: 'a', trimStart: 1, trimEnd: 4, marker: 'first' },
  { id: 'b', trimStart: 10, trimEnd: 14, marker: 'second' },
];

describe('clip editing', () => {
  it('splits one clip into adjacent source ranges without mutating it', () => {
    const result = splitClipAt(clips, 'b', 12.5, 'b-split');
    expect(result).toEqual([
      clips[0],
      { ...clips[1], trimEnd: 12.5 },
      { ...clips[1], id: 'b-split', trimStart: 12.5 },
    ]);
    expect(clips[1]).toEqual({ id: 'b', trimStart: 10, trimEnd: 14, marker: 'second' });
  });

  it('does not split at or too close to a trim boundary', () => {
    expect(splitClipAt(clips, 'a', 1, 'new')).toBe(clips);
    expect(splitClipAt(clips, 'a', 3.995, 'new')).toBe(clips);
  });

  it('duplicates directly after the source and reorders by target index', () => {
    const duplicated = duplicateClip(clips, 'a', 'a-copy');
    expect(duplicated.map((clip) => clip.id)).toEqual(['a', 'a-copy', 'b']);
    expect(duplicated[1]).toEqual({ ...clips[0], id: 'a-copy' });
    expect(moveClipToIndex(duplicated, 'a-copy', 2).map((clip) => clip.id)).toEqual(['a', 'b', 'a-copy']);
  });
});

describe('project timeline mapping', () => {
  it('calculates trimmed project duration', () => {
    expect(getProjectDuration(clips)).toBe(7);
  });

  it('locates project time across clip boundaries and clamps the project end', () => {
    expect(locateProjectTime(clips, 2)).toEqual({ clipId: 'a', clipIndex: 0, sourceTime: 3, projectTime: 2 });
    expect(locateProjectTime(clips, 3)).toEqual({ clipId: 'b', clipIndex: 1, sourceTime: 10, projectTime: 3 });
    expect(locateProjectTime(clips, 99)).toEqual({ clipId: 'b', clipIndex: 1, sourceTime: 14, projectTime: 7 });
  });

  it('maps a source playhead back onto project time', () => {
    expect(projectTimeForClip(clips, 'b', 11.5)).toBe(4.5);
    expect(projectTimeForClip(clips, 'a', -10)).toBe(0);
  });
});

describe('speed-aware project timeline', () => {
  const speedClips = [
    { id: 'a', trimStart: 0, trimEnd: 4, speed: 2.0 },   // plays in 2s
    { id: 'b', trimStart: 0, trimEnd: 6, speed: 0.5 },   // plays in 12s
    { id: 'c', trimStart: 0, trimEnd: 3, speed: 1.0 },   // plays in 3s
  ];

  it('calculates total playback duration considering speed', () => {
    expect(getProjectDurationSpeedAware(speedClips)).toBe(17); // 2 + 12 + 3
  });

  it('returns plain sum when all clips are speed 1.0', () => {
    const normalClips = [
      { id: 'a', trimStart: 0, trimEnd: 4, speed: 1.0 },
      { id: 'b', trimStart: 0, trimEnd: 6, speed: 1.0 },
    ];
    expect(getProjectDurationSpeedAware(normalClips)).toBe(10);
  });

  it('locates project time within speed-adjusted clips', () => {
    // At t=1s, we're in clip A (plays at 2x, so source offset = 1*2 = 2)
    const pos = locateProjectTimeSpeedAware(speedClips, 1);
    expect(pos).not.toBeNull();
    expect(pos!.clipId).toBe('a');
    expect(pos!.sourceTime).toBeCloseTo(2); // 1s * 2.0 speed = 2s source

    // At t=2s exactly, we transition to clip B
    const pos2 = locateProjectTimeSpeedAware(speedClips, 2);
    expect(pos2!.clipId).toBe('b');
    expect(pos2!.sourceTime).toBeCloseTo(0);

    // At t=8s, we're 6s into clip B (plays at 0.5x, so source offset = 6*0.5 = 3)
    const pos3 = locateProjectTimeSpeedAware(speedClips, 8);
    expect(pos3!.clipId).toBe('b');
    expect(pos3!.sourceTime).toBeCloseTo(3);
  });

  it('maps a source playhead back onto the speed-adjusted project timeline', () => {
    expect(projectTimeForClipSpeedAware(speedClips, 'a', 2)).toBe(1);
    expect(projectTimeForClipSpeedAware(speedClips, 'b', 3)).toBe(8);
    expect(projectTimeForClipSpeedAware(speedClips, 'c', 1)).toBe(15);
  });

  it('handles clips with default speed (undefined treated as 1.0)', () => {
    const mixedClips = [
      { id: 'a', trimStart: 0, trimEnd: 5 },             // no speed field = 1.0
      { id: 'b', trimStart: 0, trimEnd: 4, speed: 2.0 }, // plays in 2s
    ];
    expect(getProjectDurationSpeedAware(mixedClips)).toBe(7);
  });
});

describe('canvas dimensions', () => {
  it('computes 16:9 dimensions for standard resolutions', () => {
    expect(computeCanvasDimensions('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(computeCanvasDimensions('16:9', '720p')).toEqual({ width: 1280, height: 720 });
    expect(computeCanvasDimensions('16:9', '480p')).toEqual({ width: 854, height: 480 });
  });

  it('computes 9:16 portrait dimensions', () => {
    expect(computeCanvasDimensions('9:16', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(computeCanvasDimensions('9:16', '720p')).toEqual({ width: 720, height: 1280 });
  });

  it('computes 4:3 dimensions', () => {
    expect(computeCanvasDimensions('4:3', '1080p')).toEqual({ width: 1440, height: 1080 });
  });

  it('computes 1:1 square dimensions', () => {
    expect(computeCanvasDimensions('1:1', '1080p')).toEqual({ width: 1080, height: 1080 });
    expect(computeCanvasDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 });
  });

  it('auto aspect defaults to 16:9', () => {
    expect(computeCanvasDimensions('auto', '1080p')).toEqual({ width: 1920, height: 1080 });
  });
});

describe('buildRotationTransformCSS', () => {
  it('returns empty string for no transforms', () => {
    expect(buildRotationTransformCSS(0, false, false)).toBe('');
  });

  it('applies rotation', () => {
    expect(buildRotationTransformCSS(90, false, false)).toBe('rotate(90deg)');
    expect(buildRotationTransformCSS(180, false, false)).toBe('rotate(180deg)');
    expect(buildRotationTransformCSS(270, false, false)).toBe('rotate(270deg)');
  });

  it('applies horizontal flip', () => {
    expect(buildRotationTransformCSS(0, true, false)).toBe('scaleX(-1)');
  });

  it('applies vertical flip', () => {
    expect(buildRotationTransformCSS(0, false, true)).toBe('scaleY(-1)');
  });

  it('combines rotation and flips', () => {
    const result = buildRotationTransformCSS(90, true, true);
    expect(result).toContain('rotate(90deg)');
    expect(result).toContain('scaleX(-1)');
    expect(result).toContain('scaleY(-1)');
  });
});

describe('buildAtempoChain', () => {
  it('returns empty string for speed 1.0', () => {
    expect(buildAtempoChain(1.0)).toBe('');
  });

  it('returns single atempo for speeds in [0.5, 2.0]', () => {
    expect(buildAtempoChain(2.0)).toBe('atempo=2');
    expect(buildAtempoChain(0.5)).toBe('atempo=0.5');
    expect(buildAtempoChain(1.5)).toBe('atempo=1.5');
  });

  it('chains atempo filters for speed > 2.0', () => {
    // 4.0 = 2.0 * 2.0
    expect(buildAtempoChain(4.0)).toBe('atempo=2,atempo=2');
    // 3.0 = 2.0 * 1.5
    expect(buildAtempoChain(3.0)).toBe('atempo=2,atempo=1.5');
  });

  it('chains atempo filters for speed < 0.5', () => {
    // 0.25 = 0.5 * 0.5
    expect(buildAtempoChain(0.25)).toBe('atempo=0.5,atempo=0.5');
  });
});
