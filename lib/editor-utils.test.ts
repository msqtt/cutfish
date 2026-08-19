import { describe, expect, it } from 'vitest';
import {
  duplicateClip,
  getProjectDuration,
  locateProjectTime,
  moveClipToIndex,
  projectTimeForClip,
  splitClipAt,
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
