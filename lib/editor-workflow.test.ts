import { describe, expect, it } from 'vitest';
import { moveClipToIndex } from './editor-utils';
import {
  backgroundAudioGainAtTime,
  inspectorTabForSelection,
  reorderTargetFromCenters,
  splitClipWithTransition,
  type EditorSelection,
} from './editor-workflow';

describe('material workflow selection', () => {
  it.each<[EditorSelection, string]>([
    [{ kind: 'video', id: 'v1' }, 'clip'],
    [{ kind: 'source-audio', id: 'v1' }, 'audio'],
    [{ kind: 'background-audio', id: 'a2' }, 'audio'],
    [{ kind: 'subtitle', id: 's1' }, 'subtitles'],
    [{ kind: 'image', id: 'i1' }, 'subtitles'],
    [{ kind: 'effect', id: 'fx1' }, 'effects'],
    [{ kind: 'effect', id: 'overlay:shape1' }, 'subtitles'],
    [null, 'project'],
  ])('routes %j to the contextual Inspector', (selection, expected) => {
    expect(inspectorTabForSelection(selection)).toBe(expected);
  });
});

describe('transition-safe contextual split', () => {
  const clips = [
    { id: 'a', trimStart: 0, trimEnd: 6, name: 'A' },
    { id: 'b', trimStart: 1, trimEnd: 5, name: 'B' },
  ];

  it('moves the outgoing transition to the right half', () => {
    const result = splitClipWithTransition(
      clips,
      [{ id: 'tr', afterClipId: 'a', type: 'fade' as const, duration: 1 }],
      'a',
      2.5,
      'a-right',
    );
    expect(result.clips.map((clip) => [clip.id, clip.trimStart, clip.trimEnd])).toEqual([
      ['a', 0, 2.5],
      ['a-right', 2.5, 6],
      ['b', 1, 5],
    ]);
    expect(result.transitions[0].afterClipId).toBe('a-right');
  });

  it('returns original references when the split is invalid', () => {
    const transitions = [{ id: 'tr', afterClipId: 'a', type: 'fade' as const, duration: 1 }];
    const result = splitClipWithTransition(clips, transitions, 'a', 0.001, 'a-right');
    expect(result.clips).toBe(clips);
    expect(result.transitions).toBe(transitions);
  });
});

describe('pointer reorder target', () => {
  const centers = [60, 190, 330];
  const clips = [
    { id: 'a', trimStart: 0, trimEnd: 1 },
    { id: 'b', trimStart: 0, trimEnd: 1 },
    { id: 'c', trimStart: 0, trimEnd: 1 },
  ];

  it('uses remaining clip midpoints as stable before/after targets', () => {
    expect(reorderTargetFromCenters(centers, 61, 0)).toBe(0);
    const afterB = reorderTargetFromCenters(centers, 191, 0);
    expect(afterB).toBe(1);
    expect(moveClipToIndex(clips, 'a', afterB! + 0).map((clip) => clip.id)).toEqual(['b', 'a', 'c']);
    expect(reorderTargetFromCenters(centers, 500, 0)).toBe(2);
    expect(reorderTargetFromCenters(centers, 100, 2)).toBe(1);
  });

  it('handles empty and invalid geometry', () => {
    expect(reorderTargetFromCenters([], 10, 0)).toBeNull();
    expect(reorderTargetFromCenters([60, Number.NaN, 330], 200, 0)).toBe(0);
  });
});

describe('background audio preview gain', () => {
  const segment = {
    id: 'a2', projectStart: 10, trimStart: 2, trimEnd: 8,
    volume: 80, fadeIn: 2, fadeOut: 1,
  };

  it('applies segment volume and fade envelopes', () => {
    expect(backgroundAudioGainAtTime(segment, 9.9)).toBe(0);
    expect(backgroundAudioGainAtTime(segment, 10)).toBe(0);
    expect(backgroundAudioGainAtTime(segment, 11)).toBeCloseTo(0.4);
    expect(backgroundAudioGainAtTime(segment, 13)).toBeCloseTo(0.8);
    expect(backgroundAudioGainAtTime(segment, 15.5)).toBeCloseTo(0.4);
    expect(backgroundAudioGainAtTime(segment, 16)).toBe(0);
  });
});
