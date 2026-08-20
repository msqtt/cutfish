import { describe, expect, it } from 'vitest';
import {
  buildFFmpegCommand,
  estimateOutputSizeMB,
  resolveExportProfile,
  selectClipsForExport,
  selectClipsForExportSpeedAware,
  buildFFmpegCommandExtended,
  computeVolumeFilter,
  buildRotationFilters,
  buildSpeedFilters,
  type ExtendedClipMetadata,
  type TransitionConfig,
  type TextOverlay,
  type BgMusicExport,
  type PngOverlayInput,
  type TtsAudioInput,
} from './ffmpeg-utils';

const filters = { brightness: 110, contrast: 95, saturation: 120 };
const noFade = { fadeIn: 0, fadeOut: 0 };
const clips = [
  { id: 'a', filename: 'a.mp4', trimStart: 1, trimEnd: 4, hasAudio: true },
  { id: 'b', filename: 'b.webm', trimStart: 10, trimEnd: 14, hasAudio: false },
];
const settings = {
  resolution: '720p' as const,
  frameRate: 30 as const,
  quality: 'balanced' as const,
  rangeStart: 0,
  rangeEnd: null,
};

describe('selectClipsForExport', () => {
  it('maps a project interval across source clip boundaries', () => {
    expect(selectClipsForExport(clips, { start: 2, end: 5 })).toEqual([
      { ...clips[0], trimStart: 3, trimEnd: 4 },
      { ...clips[1], trimStart: 10, trimEnd: 12 },
    ]);
  });

  it('rejects an invalid or empty interval', () => {
    expect(() => selectClipsForExport(clips, { start: 3, end: 3 })).toThrow('Invalid export range');
    expect(() => selectClipsForExport(clips, { start: 8, end: 9 })).toThrow('outside the project');
  });
});

describe('export profiles', () => {
  it('scales bitrate by resolution and quality', () => {
    expect(resolveExportProfile(settings)).toEqual({
      width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 2500, audioBitrateKbps: 128,
    });
    expect(resolveExportProfile({ ...settings, resolution: '1080p', quality: 'high' }).videoBitrateKbps).toBe(9000);
  });

  it('estimates output size from duration and bitrate', () => {
    expect(estimateOutputSizeMB(60, resolveExportProfile(settings))).toBeCloseTo(19.72, 1);
  });
});

describe('buildFFmpegCommand', () => {
  it('normalizes with selected parameters and synthesizes missing audio', () => {
    const profile = resolveExportProfile(settings);
    const args = buildFFmpegCommand(clips, filters, 250, noFade, 'mp4', profile);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args.slice(0, 5)).toEqual(['-y', '-i', 'a.mp4', '-i', 'b.webm']);
    expect(graph).toContain('scale=1280:720');
    expect(graph).toContain('fps=30');
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=4');
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(args).toContain('2500k');
    expect(args).toContain('+faststart');
  });

  it('advances audio without shortening selected video', () => {
    const args = buildFFmpegCommand([clips[0]], filters, -1500, noFade, 'webm', resolveExportProfile(settings));
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=1.5,asetpts=PTS-STARTPTS,apad,atrim=duration=3[timeda]');
    expect(args).toContain('libvpx-vp9');
  });

  it('applies fade-in at the start and fade-out at the selected output end', () => {
    const args = buildFFmpegCommand(
      clips, filters, 0, { fadeIn: 1.25, fadeOut: 2 }, 'mp4', resolveExportProfile(settings),
    );
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[timeda]afade=t=in:st=0:d=1.25,afade=t=out:st=5:d=2[synceda]');
  });

  it('clamps fades to output duration and rejects invalid values', () => {
    const profile = resolveExportProfile(settings);
    const args = buildFFmpegCommand([clips[0]], filters, 0, { fadeIn: 10, fadeOut: 10 }, 'mp4', profile);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('afade=t=in:st=0:d=3,afade=t=out:st=0:d=3[synceda]');
    expect(() => buildFFmpegCommand(clips, filters, 0, { fadeIn: -1, fadeOut: 0 }, 'mp4', profile)).toThrow('fadeIn');
    expect(() => buildFFmpegCommand(clips, filters, 0, { fadeIn: 0, fadeOut: Number.NaN }, 'mp4', profile)).toThrow('finite');
  });

  it('rejects empty and invalid trim input', () => {
    const profile = resolveExportProfile(settings);
    expect(() => buildFFmpegCommand([], filters, 0, noFade, 'mp4', profile)).toThrow('At least one clip');
    expect(() => buildFFmpegCommand([{ ...clips[0], trimEnd: 1 }], filters, 0, noFade, 'mp4', profile)).toThrow('Invalid trim range');
  });
});

describe('computeVolumeFilter', () => {
  it('returns correct volume expression for normal clip', () => {
    expect(computeVolumeFilter(100, 100, false)).toBe('volume=1');
  });

  it('applies clip volume percentage', () => {
    expect(computeVolumeFilter(150, 100, false)).toBe('volume=1.5');
  });

  it('applies master volume', () => {
    expect(computeVolumeFilter(100, 50, false)).toBe('volume=0.5');
  });

  it('combines clip and master volume', () => {
    expect(computeVolumeFilter(150, 80, false)).toBe('volume=1.2');
  });

  it('returns volume=0 when muted', () => {
    expect(computeVolumeFilter(150, 100, true)).toBe('volume=0');
  });
});

describe('buildRotationFilters', () => {
  it('returns empty for no rotation or flips', () => {
    expect(buildRotationFilters(0, false, false)).toBe('');
  });

  it('applies transpose for 90 degrees', () => {
    const result = buildRotationFilters(90, false, false);
    expect(result).toContain('transpose=1');
  });

  it('applies transpose for 270 degrees', () => {
    const result = buildRotationFilters(270, false, false);
    expect(result).toContain('transpose=2');
  });

  it('applies double transpose for 180 degrees', () => {
    const result = buildRotationFilters(180, false, false);
    expect(result).toContain('transpose=1,transpose=1');
  });

  it('applies hflip', () => {
    const result = buildRotationFilters(0, true, false);
    expect(result).toBe('hflip');
  });

  it('applies vflip', () => {
    const result = buildRotationFilters(0, false, true);
    expect(result).toBe('vflip');
  });

  it('combines rotation and flips', () => {
    const result = buildRotationFilters(90, true, false);
    expect(result).toContain('transpose=1');
    expect(result).toContain('hflip');
  });
});

describe('buildSpeedFilters', () => {
  it('returns empty for speed 1.0', () => {
    expect(buildSpeedFilters(1.0)).toEqual({ video: '', audio: '' });
  });

  it('applies setpts for video speed', () => {
    const result = buildSpeedFilters(2.0);
    expect(result.video).toBe('setpts=PTS/2');
  });

  it('applies atempo for audio speed', () => {
    const result = buildSpeedFilters(2.0);
    expect(result.audio).toBe('atempo=2');
  });

  it('chains atempo for speeds > 2.0', () => {
    const result = buildSpeedFilters(4.0);
    expect(result.video).toBe('setpts=PTS/4');
    expect(result.audio).toBe('atempo=2,atempo=2');
  });

  it('handles slow motion', () => {
    const result = buildSpeedFilters(0.5);
    expect(result.video).toBe('setpts=PTS/0.5');
    expect(result.audio).toBe('atempo=0.5');
  });

  it('chains atempo for speeds < 0.5', () => {
    const result = buildSpeedFilters(0.25);
    expect(result.video).toBe('setpts=PTS/0.25');
    expect(result.audio).toBe('atempo=0.5,atempo=0.5');
  });
});

describe('buildFFmpegCommandExtended', () => {
  const extClips: ExtendedClipMetadata[] = [
    { id: 'a', filename: 'a.mp4', trimStart: 1, trimEnd: 4, hasAudio: true, volume: 100, muted: false, rotation: 0, flipH: false, flipV: false, speed: 1.0 },
    { id: 'b', filename: 'b.webm', trimStart: 10, trimEnd: 14, hasAudio: false, volume: 150, muted: false, rotation: 90, flipH: false, flipV: false, speed: 1.0 },
  ];

  it('applies per-clip volume in filter graph', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=1'); // clip a: 100*100/10000 = 1
    expect(graph).toContain('volume=1.5'); // clip b: 150*100/10000 = 1.5
  });

  it('applies rotation filter for rotated clip', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('transpose=1'); // 90 degrees
  });

  it('mutes clip audio with volume=0', () => {
    const mutedClips: ExtendedClipMetadata[] = [
      { ...extClips[0], muted: true },
    ];
    const args = buildFFmpegCommandExtended(mutedClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=0');
  });

  it('applies speed filters when speed != 1.0', () => {
    const speedClips: ExtendedClipMetadata[] = [
      { ...extClips[0], speed: 2.0 },
    ];
    const args = buildFFmpegCommandExtended(speedClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('setpts=PTS/2');
    expect(graph).toContain('atempo=2');
  });

  it('applies master volume scaling', () => {
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 50, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=0.5'); // 100*50/10000 = 0.5
  });

  it('includes transition xfade when transitions provided', () => {
    const transitions: TransitionConfig[] = [
      { id: 't1', afterClipId: 'a', type: 'fade', duration: 0.5 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', transitions, [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('xfade=transition=fade');
  });

  it('includes drawtext filter when text overlays provided', () => {
    const overlays: TextOverlay[] = [
      { id: 'o1', text: 'Hello', fontFamily: 'sans', fontSize: 48, color: '#ffffff', position: { x: 50, y: 50 }, startTime: 1, endTime: 3 },
    ];
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], overlays, null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('drawtext=');
    expect(graph).toContain("enable='between(t,1,3)'");
  });

  it('includes amix when background music provided', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 80, loop: false, fadeIn: 1, fadeOut: 2 };
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('amix=inputs=2');
    expect(args).toContain('bg.mp3');
  });

  it('adjusts canvas dimensions for 9:16 aspect', () => {
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '9:16', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('scale=720:1280');
  });

  it('cover mode uses crop instead of pad after scale', () => {
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'cover', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('force_original_aspect_ratio=increase');
    expect(graph).toContain('crop=1280:720');
    expect(graph).not.toContain('pad=1280:720');
  });

  it('contain mode uses pad after scale', () => {
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('force_original_aspect_ratio=decrease');
    expect(graph).toContain('pad=1280:720');
  });

  it('stretch mode does not use force_original_aspect_ratio', () => {
    const args = buildFFmpegCommandExtended([extClips[0]], filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'stretch', [], [], null);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('force_original_aspect_ratio');
    expect(graph).not.toContain('pad=');
    expect(graph).not.toContain('crop=');
  });

  it('preserves backward compatibility - old buildFFmpegCommand still works', () => {
    const profile = resolveExportProfile(settings);
    const args = buildFFmpegCommand(clips, filters, 0, noFade, 'mp4', profile);
    expect(args).toContain('-y');
    expect(args).toContain('output.mp4');
  });
});

describe('selectClipsForExportSpeedAware (H1)', () => {
  const speedClips = [
    { id: 'a', trimStart: 0, trimEnd: 4, speed: 2.0 },   // plays in 2s
    { id: 'b', trimStart: 0, trimEnd: 6, speed: 0.5 },   // plays in 12s
    { id: 'c', trimStart: 0, trimEnd: 3, speed: 1.0 },   // plays in 3s
  ];
  // Total playback duration: 2 + 12 + 3 = 17s

  it('selects full range correctly', () => {
    const result = selectClipsForExportSpeedAware(speedClips, { start: 0, end: 17 });
    expect(result).toHaveLength(3);
    expect(result[0].trimStart).toBeCloseTo(0);
    expect(result[0].trimEnd).toBeCloseTo(4);
    expect(result[1].trimStart).toBeCloseTo(0);
    expect(result[1].trimEnd).toBeCloseTo(6);
    expect(result[2].trimStart).toBeCloseTo(0);
    expect(result[2].trimEnd).toBeCloseTo(3);
  });

  it('selects partial range within first clip', () => {
    // First clip plays at 2x: 1s playback = 2s source
    const result = selectClipsForExportSpeedAware(speedClips, { start: 0.5, end: 1.5 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
    expect(result[0].trimStart).toBeCloseTo(1); // 0.5s * 2.0 speed = 1s source
    expect(result[0].trimEnd).toBeCloseTo(3);   // 1.5s * 2.0 speed = 3s source
  });

  it('selects range crossing clip boundary (speed-adjusted)', () => {
    // Clip A ends at playback time 2s, clip B starts at playback time 2s
    const result = selectClipsForExportSpeedAware(speedClips, { start: 1, end: 4 });
    expect(result).toHaveLength(2);
    // In clip A: 1s playback offset * 2.0 speed = 2s source offset from start
    expect(result[0].id).toBe('a');
    expect(result[0].trimStart).toBeCloseTo(2);
    expect(result[0].trimEnd).toBeCloseTo(4);
    // In clip B: 2s playback into B at 0.5x speed = 1s source offset
    expect(result[1].id).toBe('b');
    expect(result[1].trimStart).toBeCloseTo(0);
    expect(result[1].trimEnd).toBeCloseTo(1);
  });

  it('throws on out-of-range', () => {
    expect(() => selectClipsForExportSpeedAware(speedClips, { start: 0, end: 20 })).toThrow('outside');
  });

  it('works with clips missing speed field (defaults to 1.0)', () => {
    const noSpeedClips = [
      { id: 'x', trimStart: 0, trimEnd: 5 },
      { id: 'y', trimStart: 0, trimEnd: 3 },
    ];
    const result = selectClipsForExportSpeedAware(noSpeedClips, { start: 2, end: 6 });
    expect(result).toHaveLength(2);
    expect(result[0].trimStart).toBeCloseTo(2);
    expect(result[0].trimEnd).toBeCloseTo(5);
    expect(result[1].trimStart).toBeCloseTo(0);
    expect(result[1].trimEnd).toBeCloseTo(1);
  });
});

describe('buildFFmpegCommandExtended with overlayPngs', () => {
  const extClips: ExtendedClipMetadata[] = [
    { id: 'a', filename: 'a.mp4', trimStart: 0, trimEnd: 5, hasAudio: true, volume: 100, muted: false, rotation: 0, flipH: false, flipV: false, speed: 1.0 },
    { id: 'b', filename: 'b.mp4', trimStart: 0, trimEnd: 5, hasAudio: true, volume: 100, muted: false, rotation: 0, flipH: false, flipV: false, speed: 1.0 },
  ];

  const pngs: PngOverlayInput[] = [
    { filename: 'sub_0.png', startTime: 1, endTime: 4 },
    { filename: 'sub_1.png', startTime: 5, endTime: 8 },
  ];

  it('adds -loop 1 -i for each PNG overlay', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, pngs);
    // PNG inputs should come after clip inputs
    const argStr = args.join(' ');
    expect(argStr).toContain('-loop 1 -i sub_0.png');
    expect(argStr).toContain('-loop 1 -i sub_1.png');
  });

  it('computes correct input indices for PNG overlays (no bgMusic)', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, pngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips, no bgMusic → PNG inputs start at index 2
    expect(graph).toContain('[2:v]overlay=0:0:shortest=1:eof_action=pass');
    expect(graph).toContain('[3:v]overlay=0:0:shortest=1:eof_action=pass');
  });

  it('computes correct input indices for PNG overlays (with bgMusic)', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, pngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips + 1 bgMusic → PNG inputs start at index 3
    expect(graph).toContain('[3:v]overlay=0:0:shortest=1:eof_action=pass');
    expect(graph).toContain('[4:v]overlay=0:0:shortest=1:eof_action=pass');
  });

  it('includes enable between(t,start,end) for each PNG overlay', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, pngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("shortest=1:eof_action=pass:enable='between(t,1,4)'");
    expect(graph).toContain("shortest=1:eof_action=pass:enable='between(t,5,8)'");
  });

  it('chains overlay filters sequentially with intermediate labels', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, pngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // First overlay outputs [ov0], second outputs [overlayv]
    expect(graph).toContain('[ov0]');
    expect(graph).toContain('[overlayv]');
  });

  it('maps final video to [overlayv] when PNGs are present', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, pngs);
    expect(args).toContain('[overlayv]');
    // Should not map [filteredv] since overlayv is the final
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 1]).toBe('[overlayv]');
  });

  it('does not break existing behavior when overlayPngs is empty', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, []);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('[overlayv]');
    expect(graph).not.toContain('-loop 1');
    // Should still produce valid output
    expect(args).toContain('output.mp4');
  });

  it('does not break when overlayPngs param is omitted (default)', () => {
    // Call without the overlayPngs argument — should use default []
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    expect(args).toContain('output.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('[overlayv]');
  });

  it('works with both text overlays and PNG overlays', () => {
    const textOverlays: TextOverlay[] = [
      { id: 'o1', text: 'Hello', fontFamily: 'sans', fontSize: 48, color: '#ffffff', position: { x: 50, y: 50 }, startTime: 0, endTime: 3 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], textOverlays, null, undefined, pngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // Should have drawtext chain producing [filteredv], then overlay chain on top
    expect(graph).toContain('drawtext=');
    expect(graph).toContain('[filteredv]');
    expect(graph).toContain('[overlayv]');
    // The overlay chain should start from [filteredv]
    expect(graph).toContain("[filteredv][2:v]overlay=0:0:shortest=1:eof_action=pass:enable='between(t,1,4)'[ov0]");
  });

  it('handles single PNG overlay correctly', () => {
    const singlePng: PngOverlayInput[] = [{ filename: 'only.png', startTime: 2, endTime: 5 }];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, singlePng);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // Single overlay goes directly to [overlayv]
    expect(graph).toContain("[filteredv][2:v]overlay=0:0:shortest=1:eof_action=pass:enable='between(t,2,5)'[overlayv]");
    expect(graph).not.toContain('[ov0]');
  });

  it('preserves correct -map order with bgMusic + multiple PNGs', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 80, loop: true, fadeIn: 1, fadeOut: 2 };
    const manyPngs: PngOverlayInput[] = [
      { filename: 'a.png', startTime: 0, endTime: 2 },
      { filename: 'b.png', startTime: 2, endTime: 4 },
      { filename: 'c.png', startTime: 4, endTime: 6 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, manyPngs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips + 1 bg → pngs start at index 3
    expect(graph).toContain('[3:v]overlay=0:0:shortest=1:eof_action=pass');
    expect(graph).toContain('[4:v]overlay=0:0:shortest=1:eof_action=pass');
    expect(graph).toContain('[5:v]overlay=0:0:shortest=1:eof_action=pass');
    // Final video should be [overlayv], audio should be [finala]
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 1]).toBe('[overlayv]');
    expect(args[mapIdx + 3]).toBe('[finala]');
    // Should include amix
    expect(graph).toContain('amix=inputs=2');
  });

  it('works with bgMusic but no PNGs - final map is [filteredv] and [finala]', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, []);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('[overlayv]');
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 1]).toBe('[filteredv]');
    expect(args[mapIdx + 3]).toBe('[finala]');
  });
});

describe('buildFFmpegCommandExtended with ttsAudioInputs', () => {
  const extClips: ExtendedClipMetadata[] = [
    { id: 'a', filename: 'a.mp4', trimStart: 0, trimEnd: 5, hasAudio: true, volume: 100, muted: false, rotation: 0, flipH: false, flipV: false, speed: 1.0 },
    { id: 'b', filename: 'b.mp4', trimStart: 0, trimEnd: 5, hasAudio: true, volume: 100, muted: false, rotation: 0, flipH: false, flipV: false, speed: 1.0 },
  ];

  const ttsInputs: TtsAudioInput[] = [
    { filename: 'tts_0.wav', startTime: 1, endTime: 4, sourceTrimStart: 0, rate: 1.0, volume: 0.8 },
    { filename: 'tts_1.wav', startTime: 5, endTime: 8, sourceTrimStart: 0.5, rate: 1.5, volume: 1.0 },
  ];

  it('adds -i for each TTS WAV input', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], ttsInputs);
    const argStr = args.join(' ');
    expect(argStr).toContain('-i tts_0.wav');
    expect(argStr).toContain('-i tts_1.wav');
  });

  it('computes correct input indices for TTS (no bgMusic, no PNGs)', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], ttsInputs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips, no bg, no PNGs → TTS starts at index 2
    expect(graph).toContain('[2:a]atrim=start=0');
    expect(graph).toContain('[3:a]atrim=start=0.5');
  });

  it('computes correct input indices for TTS (with bgMusic, no PNGs)', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, [], ttsInputs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips + 1 bg → TTS starts at index 3
    expect(graph).toContain('[3:a]atrim=start=0');
    expect(graph).toContain('[4:a]atrim=start=0.5');
  });

  it('computes correct input indices for TTS (with bgMusic and PNGs)', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const pngs: PngOverlayInput[] = [
      { filename: 'sub.png', startTime: 0, endTime: 5 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, pngs, ttsInputs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 clips + 1 bg + 1 PNG → TTS starts at index 4
    expect(graph).toContain('[4:a]atrim=start=0');
    expect(graph).toContain('[5:a]atrim=start=0.5');
  });

  it('builds correct atrim/asetpts/aresample/aformat chain', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], ttsInputs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // First TTS: sourceTrimStart=0, rate=1.0, volume=0.8, duration=3, delay=1000ms
    expect(graph).toContain('[2:a]atrim=start=0,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.8,atrim=duration=3,adelay=delays=1000:all=1[tts0]');
    // Second TTS: sourceTrimStart=0.5, rate=1.5, volume=1, duration=3, delay=5000ms
    expect(graph).toContain('[3:a]atrim=start=0.5,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atempo=1.5,volume=1,atrim=duration=3,adelay=delays=5000:all=1[tts1]');
  });

  it('applies atempo chain for rate != 1.0', () => {
    const singleTts: TtsAudioInput[] = [
      { filename: 'tts.wav', startTime: 0, endTime: 5, sourceTrimStart: 0, rate: 2.0, volume: 1 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], singleTts);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atempo=2');
  });

  it('omits adelay when startTime is 0', () => {
    const singleTts: TtsAudioInput[] = [
      { filename: 'tts.wav', startTime: 0, endTime: 3, sourceTrimStart: 0, rate: 1, volume: 1 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], singleTts);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=duration=3[tts0]');
    expect(graph).not.toContain('adelay=delays=0');
  });

  it('mixes TTS with synced audio using amix duration=first', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], ttsInputs);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 2 TTS streams + 1 synced audio = amix=inputs=3
    expect(graph).toContain('[synceda][tts0][tts1]amix=inputs=3:duration=first[finala]');
  });

  it('mixes TTS with bgMusic-mixed audio using amix', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const singleTts: TtsAudioInput[] = [
      { filename: 'tts.wav', startTime: 2, endTime: 5, sourceTrimStart: 0, rate: 1, volume: 0.9 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, [], singleTts);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // bg audio produces [bgmixed], then TTS mixes with it
    expect(graph).toContain('[bgmixed][tts0]amix=inputs=2:duration=first[finala]');
  });

  it('final map is [finala] when TTS inputs present', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], ttsInputs);
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 3]).toBe('[finala]');
  });

  it('does not break when ttsAudioInputs is empty (default)', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, []);
    expect(args).toContain('output.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).not.toContain('[tts0]');
  });

  it('backward compatible: no TTS, no bgMusic, maps [synceda]', () => {
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null);
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 3]).toBe('[synceda]');
  });

  it('handles partial range trim via sourceTrimStart', () => {
    const singleTts: TtsAudioInput[] = [
      { filename: 'tts.wav', startTime: 0, endTime: 3, sourceTrimStart: 2.5, rate: 1, volume: 1 },
    ];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], null, undefined, [], singleTts);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[2:a]atrim=start=2.5,asetpts=PTS-STARTPTS');
  });

  it('input order is clips → bgMusic → PNGs → TTS WAVs', () => {
    const bgMusic: BgMusicExport = { filename: 'bg.mp3', volume: 100, loop: false, fadeIn: 0, fadeOut: 0 };
    const pngs: PngOverlayInput[] = [{ filename: 'sub.png', startTime: 0, endTime: 5 }];
    const singleTts: TtsAudioInput[] = [{ filename: 'tts.wav', startTime: 1, endTime: 3, sourceTrimStart: 0, rate: 1, volume: 1 }];
    const args = buildFFmpegCommandExtended(extClips, filters, 0, noFade, 'mp4', resolveExportProfile(settings), 100, '16:9', 'contain', [], [], bgMusic, undefined, pngs, singleTts);

    // Find input positions
    const inputs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-i') inputs.push(args[i + 1]);
    }
    // clips: a.mp4, b.mp4; bg: bg.mp3; PNG: sub.png; TTS: tts.wav
    expect(inputs).toEqual(['a.mp4', 'b.mp4', 'bg.mp3', 'sub.png', 'tts.wav']);
  });
});
