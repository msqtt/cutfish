import { describe, expect, it } from 'vitest';
import {
  buildXfadeChain,
  buildAcrossfadeChain,
  computeTransitionAdjustedDuration,
  type TransitionConfig,
  type TransitionClip,
} from './transition-utils';

const clips: TransitionClip[] = [
  { id: 'a', trimmedDuration: 5 },
  { id: 'b', trimmedDuration: 4 },
  { id: 'c', trimmedDuration: 6 },
];

const twoClips: TransitionClip[] = [
  { id: 'a', trimmedDuration: 5 },
  { id: 'b', trimmedDuration: 4 },
];

describe('computeTransitionAdjustedDuration', () => {
  it('returns sum of trimmed durations when no transitions', () => {
    expect(computeTransitionAdjustedDuration(clips, [])).toBe(15);
  });

  it('subtracts transition durations from total', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
      { id: 't2', afterClipId: 'b', type: 'dissolve', duration: 1.0 },
    ];
    expect(computeTransitionAdjustedDuration(clips, transitions)).toBe(13.5);
  });

  it('ignores transitions referencing non-existent or last clip', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'c', type: 'fade', duration: 0.5 }, // last clip - no next
      { id: 't2', afterClipId: 'z', type: 'fade', duration: 0.5 }, // non-existent
    ];
    expect(computeTransitionAdjustedDuration(clips, transitions)).toBe(15);
  });

  it('clamps transition duration to minimum of adjacent clips', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 10 }, // exceeds both clips
    ];
    // Should clamp to min(5, 4) - small epsilon = effective max
    const result = computeTransitionAdjustedDuration(clips, transitions);
    expect(result).toBeLessThan(15);
    expect(result).toBeGreaterThan(11); // 15 - 4 = 11 at most
  });
});

describe('buildXfadeChain', () => {
  it('returns empty string for single clip', () => {
    expect(buildXfadeChain([clips[0]], [], 30)).toBe('');
  });

  it('returns empty when no transitions between clips (use concat)', () => {
    expect(buildXfadeChain(twoClips, [], 30)).toBe('');
  });

  it('builds a pairwise xfade for two clips with one transition', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
    ];
    const result = buildXfadeChain(twoClips, transitions, 30);
    expect(result).toContain('xfade=transition=fade:duration=0.5:offset=4.5');
    expect(result).toContain('[v0][v1]');
  });

  it('chains xfade pairwise for 3 clips with 2 transitions', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
      { id: 't2', afterClipId: 'b', type: 'dissolve', duration: 1.0 },
    ];
    const result = buildXfadeChain(clips, transitions, 30);
    // First xfade: offset = dur_a - transition_duration = 5 - 0.5 = 4.5
    expect(result).toContain('xfade=transition=fade:duration=0.5:offset=4.5');
    // Second xfade: accumulated output after first xfade = 5+4-0.5 = 8.5, minus duration = 8.5-1.0 = 7.5
    expect(result).toContain('xfade=transition=dissolve:duration=1:offset=7.5');
  });

  it('uses correct output labels for chaining', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'wipeleft', duration: 0.5 },
      { id: 't2', afterClipId: 'b', type: 'wiperight', duration: 0.5 },
    ];
    const result = buildXfadeChain(clips, transitions, 30);
    expect(result).toContain('[xf0]');
    expect(result).toContain('[xf1]');
  });

  it('handles five clips with mixed transitions', () => {
    const fiveClips: TransitionClip[] = [
      { id: '1', trimmedDuration: 3 },
      { id: '2', trimmedDuration: 4 },
      { id: '3', trimmedDuration: 5 },
      { id: '4', trimmedDuration: 2 },
      { id: '5', trimmedDuration: 6 },
    ];
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: '1', type: 'fade', duration: 0.5 },
      { id: 't3', afterClipId: '3', type: 'slideright', duration: 1.0 },
      { id: 't4', afterClipId: '4', type: 'slideleft', duration: 0.5 },
    ];
    const result = buildXfadeChain(fiveClips, transitions, 24);
    expect(result).toContain('xfade=transition=fade');
    expect(result).toContain('xfade=transition=slideright');
    expect(result).toContain('xfade=transition=slideleft');
    // No transition between clips 2 and 3 - those should be concat-joined
  });
});

describe('buildAcrossfadeChain', () => {
  it('returns empty string when no transitions', () => {
    expect(buildAcrossfadeChain(twoClips, [])).toBe('');
  });

  it('builds acrossfade for two clips with one transition', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
    ];
    const result = buildAcrossfadeChain(twoClips, transitions);
    expect(result).toContain('acrossfade=d=0.5');
    expect(result).toContain('[a0]');
    expect(result).toContain('[a1]');
  });

  it('chains acrossfade pairwise for 3 clips', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
      { id: 't2', afterClipId: 'b', type: 'dissolve', duration: 1.0 },
    ];
    const result = buildAcrossfadeChain(clips, transitions);
    expect(result).toContain('acrossfade=d=0.5');
    expect(result).toContain('acrossfade=d=1');
  });
});

describe('mixed transition/non-transition FFmpeg graph (M7)', () => {
  const fiveClips: TransitionClip[] = [
    { id: '1', trimmedDuration: 3 },
    { id: '2', trimmedDuration: 4 },
    { id: '3', trimmedDuration: 5 },
    { id: '4', trimmedDuration: 2 },
    { id: '5', trimmedDuration: 6 },
  ];

  it('produces valid xfade chain with mixed transitions and non-transitions', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: '1', type: 'fade', duration: 0.5 },
      // No transition between 2 and 3
      { id: 't3', afterClipId: '3', type: 'dissolve', duration: 1.0 },
      // No transition between 4 and 5
    ];
    const videoResult = buildXfadeChain(fiveClips, transitions, 30);
    const audioResult = buildAcrossfadeChain(fiveClips, transitions);

    // Video chain should have xfade for all pairs (using fade:duration=0 for non-transition)
    expect(videoResult).toContain('xfade=transition=fade:duration=0.5');
    expect(videoResult).toContain('xfade=transition=fade:duration=0');
    expect(videoResult).toContain('xfade=transition=dissolve:duration=1');

    // Audio chain should use concat for non-transition pairs
    expect(audioResult).toContain('acrossfade=d=0.5');
    expect(audioResult).toContain('concat=n=2:v=0:a=1');
    expect(audioResult).toContain('acrossfade=d=1');

    // Both should produce the final label [xf3]/[af3] for 5 clips
    expect(videoResult).toContain('[xf3]');
    expect(audioResult).toContain('[af3]');
  });

  it('all pairs without transitions still produce valid graph', () => {
    // Only one transition in the middle
    const transitions: TransitionConfig[] = [
      { id: 't2', afterClipId: '2', type: 'wipeleft', duration: 0.8 },
    ];
    const videoResult = buildXfadeChain(fiveClips, transitions, 30);
    const audioResult = buildAcrossfadeChain(fiveClips, transitions);

    expect(videoResult).toContain('xfade=transition=wipeleft:duration=0.8');
    // Non-transition pairs should use xfade with duration=0
    const xfadeParts = videoResult.split(';');
    expect(xfadeParts.length).toBe(4); // 5 clips = 4 operations

    // Audio: only one acrossfade, rest are concat
    expect(audioResult).toContain('acrossfade=d=0.8');
    const audioParts = audioResult.split(';');
    expect(audioParts.length).toBe(4);
  });
});
