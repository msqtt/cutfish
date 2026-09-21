import { describe, expect, it } from 'vitest';
import {
  clampWorkspaceSize,
  resizeWorkspacePanel,
  moveTimedRange,
  resolveVisibleTimelineTracks,
  stepTimelineZoom,
  formatEditorTime,
  clipPointerToSourceTime,
  clampProjectItemStart,
  hasPassedDragThreshold,
  timelineSelectionState,
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


describe('timeline presentation controls', () => {
  it('steps zoom consistently and clamps to the supported range', () => {
    expect(stepTimelineZoom(1, 1)).toBe(1.25);
    expect(stepTimelineZoom(1, -1)).toBe(0.75);
    expect(stepTimelineZoom(4.9, 1)).toBe(5);
    expect(stepTimelineZoom(0.35, -1)).toBe(0.3);
    expect(stepTimelineZoom(Number.NaN, 1)).toBe(1.25);
  });

  it('formats stable project timecodes and sanitizes invalid values', () => {
    expect(formatEditorTime(0)).toBe('0:00.0');
    expect(formatEditorTime(65.28)).toBe('1:05.3');
    expect(formatEditorTime(600.04)).toBe('10:00.0');
    expect(formatEditorTime(-2)).toBe('0:00.0');
    expect(formatEditorTime(Number.NaN)).toBe('0:00.0');
  });
});


describe('timeline pointer and boundary contract', () => {
  it('maps V1 and A1 pointer positions through the same clamped source-time rule', () => {
    expect(clipPointerToSourceTime(150, 100, 200, 10, 20)).toBe(12.5);
    expect(clipPointerToSourceTime(50, 100, 200, 10, 20)).toBe(10);
    expect(clipPointerToSourceTime(400, 100, 200, 10, 20)).toBe(20);
    expect(clipPointerToSourceTime(150, 100, 0, 10, 20)).toBe(10);
  });

  it('clamps independent items to the editable project duration', () => {
    expect(clampProjectItemStart(8, 3, 10)).toBe(7);
    expect(clampProjectItemStart(-2, 3, 10)).toBe(0);
    expect(clampProjectItemStart(4, 12, 10)).toBe(0);
    expect(clampProjectItemStart(Number.NaN, 3, 10)).toBe(0);
  });

  it('starts drag only after the configured two-axis movement threshold', () => {
    expect(hasPassedDragThreshold(10, 10, 15, 13, 6)).toBe(false);
    expect(hasPassedDragThreshold(10, 10, 16, 10, 6)).toBe(true);
    expect(hasPassedDragThreshold(10, 10, 14, 15, 6)).toBe(true);
    expect(hasPassedDragThreshold(10, 10, Number.NaN, 20, 6)).toBe(false);
  });
});

describe('timeline linked selection', () => {
  const videoSelection = { track: 'video' as const, linkedTrack: 'source-audio' as const, id: 'clip-1' };
  const subtitleSelection = { track: 'subtitle' as const, linkedTrack: 'tts' as const, id: 'cue-1' };

  it('distinguishes the exact V1/A1 context from its linked counterpart', () => {
    expect(timelineSelectionState(videoSelection, 'video', 'clip-1')).toBe('selected');
    expect(timelineSelectionState(videoSelection, 'source-audio', 'clip-1')).toBe('linked');
    expect(timelineSelectionState(videoSelection, 'source-audio', 'clip-2')).toBe('none');
  });

  it('co-selects A3/S1 only for the same shared cue', () => {
    expect(timelineSelectionState(subtitleSelection, 'subtitle', 'cue-1')).toBe('selected');
    expect(timelineSelectionState(subtitleSelection, 'tts', 'cue-1')).toBe('linked');
    expect(timelineSelectionState(subtitleSelection, 'tts', 'cue-2')).toBe('none');
    expect(timelineSelectionState(null, 'subtitle', 'cue-1')).toBe('none');
  });
});


describe('complete timeline track stack', () => {
  it('keeps the stable V/A/TTS/caption/image/effect order when all content exists', () => {
    const tracks = resolveVisibleTimelineTracks({
      hasVideo: true,
      hasBackgroundAudio: true,
      hasSubtitles: true,
      hasTts: true,
      hasImages: true,
      hasEffects: true,
    });
    expect(tracks).toEqual([
      'video', 'source-audio', 'background-audio', 'tts-audio', 'subtitle', 'image', 'effect',
    ]);
    expect(tracks).toHaveLength(7);
  });
});
