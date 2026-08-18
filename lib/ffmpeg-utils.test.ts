import { describe, expect, it } from 'vitest';
import {
  buildFFmpegCommand,
  estimateOutputSizeMB,
  resolveExportProfile,
  selectClipsForExport,
} from './ffmpeg-utils';

const filters = { brightness: 110, contrast: 95, saturation: 120 };
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
    const args = buildFFmpegCommand(clips, filters, 250, 'mp4', profile);
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
    const args = buildFFmpegCommand([clips[0]], filters, -1500, 'webm', resolveExportProfile(settings));
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=1.5,asetpts=PTS-STARTPTS,apad,atrim=duration=3[synceda]');
    expect(args).toContain('libvpx-vp9');
  });

  it('rejects empty and invalid trim input', () => {
    const profile = resolveExportProfile(settings);
    expect(() => buildFFmpegCommand([], filters, 0, 'mp4', profile)).toThrow('At least one clip');
    expect(() => buildFFmpegCommand([{ ...clips[0], trimEnd: 1 }], filters, 0, 'mp4', profile)).toThrow('Invalid trim range');
  });
});
