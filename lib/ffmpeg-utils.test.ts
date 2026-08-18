import { describe, expect, it } from 'vitest';
import { buildFFmpegCommand } from './ffmpeg-utils';

const filters = { brightness: 110, contrast: 95, saturation: 120 };
const clips = [
  { id: 'a', filename: 'a.mp4', trimStart: 1, trimEnd: 4 },
  { id: 'b', filename: 'b.webm', trimStart: 0, trimEnd: 2.5 },
];

describe('buildFFmpegCommand', () => {
  it('normalizes, concatenates, filters, and maps all clips', () => {
    const args = buildFFmpegCommand(clips, filters, 250, 'mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args.slice(0, 5)).toEqual(['-y', '-i', 'a.mp4', '-i', 'b.webm']);
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(graph).toContain('adelay=delays=250:all=1');
    expect(args).toContain('+faststart');
    expect(args.at(-1)).toBe('output.mp4');
  });

  it('advances audio for a negative delay', () => {
    const args = buildFFmpegCommand([clips[0]], filters, -1500, 'webm');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=1.5,asetpts=PTS-STARTPTS[synceda]');
    expect(args).toContain('libvpx-vp9');
  });

  it('rejects empty and invalid trim input', () => {
    expect(() => buildFFmpegCommand([], filters, 0, 'mp4')).toThrow('At least one clip');
    expect(() => buildFFmpegCommand([{ ...clips[0], trimEnd: 1 }], filters, 0, 'mp4')).toThrow('Invalid trim range');
  });
});
