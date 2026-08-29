import { describe, expect, it } from 'vitest';
import {
  clampWorkspaceSize,
  resizeWorkspacePanel,
  moveTimedRange,
  resolveVisibleTimelineTracks,
} from './workspace-utils';

describe('workspace sizing', () => {
  it('clamps persisted and dragged dimensions to usable bounds', () => {
    expect(clampWorkspaceSize(120, 180, 640)).toBe(180);
    expect(clampWorkspaceSize(420, 180, 640)).toBe(420);
    expect(clampWorkspaceSize(900, 180, 640)).toBe(640);
    expect(clampWorkspaceSize(Number.NaN, 180, 640)).toBe(180);
  });

  it('resizes from either edge with a direction multiplier', () => {
    expect(resizeWorkspacePanel(256, 40, 1, 180, 640)).toBe(296);
    expect(resizeWorkspacePanel(288, 40, -1, 180, 640)).toBe(248);
    expect(resizeWorkspacePanel(200, 80, -1, 180, 640)).toBe(180);
  });
});

describe('timed timeline items', () => {
  it('moves an item while preserving duration', () => {
    expect(moveTimedRange(2, 5.5, 6, 20)).toEqual({ startTime: 6, endTime: 9.5 });
  });

  it('clamps movement to the project without shortening the item', () => {
    expect(moveTimedRange(2, 5, -4, 10)).toEqual({ startTime: 0, endTime: 3 });
    expect(moveTimedRange(2, 5, 9, 10)).toEqual({ startTime: 7, endTime: 10 });
  });

  it('keeps long items valid when they exceed the project duration', () => {
    expect(moveTimedRange(1, 13, 5, 10)).toEqual({ startTime: 0, endTime: 12 });
  });
});

describe('timeline track visibility', () => {
  it('shows video and its source audio as the two base tracks', () => {
    expect(resolveVisibleTimelineTracks({
      hasVideo: true,
      hasBackgroundAudio: false,
      hasSubtitles: false,
      hasTts: false,
      hasImages: false,
      hasEffects: false,
    })).toEqual(['video', 'source-audio']);
  });

  it('adds only tracks that currently contain project elements', () => {
    expect(resolveVisibleTimelineTracks({
      hasVideo: true,
      hasBackgroundAudio: true,
      hasSubtitles: true,
      hasImages: false,
      hasEffects: true,
    })).toEqual(['video', 'source-audio', 'background-audio', 'subtitle', 'effect']);
  });

  it('returns no tracks before a video is imported', () => {
    expect(resolveVisibleTimelineTracks({
      hasVideo: false,
      hasBackgroundAudio: true,
      hasSubtitles: true,
      hasImages: true,
      hasEffects: true,
    })).toEqual([]);
  });
});

  it('adds a dynamic TTS audio track for enabled narration cues', () => {
    expect(resolveVisibleTimelineTracks({
      hasVideo: true,
      hasBackgroundAudio: false,
      hasSubtitles: true,
      hasTts: true,
      hasImages: false,
      hasEffects: false,
    })).toEqual(['video', 'source-audio', 'tts-audio', 'subtitle']);
  });
