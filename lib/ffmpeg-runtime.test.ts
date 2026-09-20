import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import {
  DEFAULT_FFMPEG_CORE_BASE_URL,
  FFMPEG_CORE_VERSION,
  FFMPEG_WRAPPER_VERSION,
  getFfmpegCoreAssetUrls,
} from './ffmpeg-runtime';

describe('FFmpeg runtime compatibility', () => {
  it('pairs the installed wrapper with a core build that includes ffprobe', () => {
    expect(packageJson.dependencies['@ffmpeg/ffmpeg']).toBe(FFMPEG_WRAPPER_VERSION);
    expect(FFMPEG_WRAPPER_VERSION).toBe('0.12.15');
    expect(FFMPEG_CORE_VERSION).toBe('0.12.10');
    expect(DEFAULT_FFMPEG_CORE_BASE_URL).toBe(
      'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd',
    );
  });

  it('builds both core asset URLs from a configured base without duplicate slashes', () => {
    expect(getFfmpegCoreAssetUrls('https://cdn.example.com/ffmpeg/')).toEqual({
      coreURL: 'https://cdn.example.com/ffmpeg/ffmpeg-core.js',
      wasmURL: 'https://cdn.example.com/ffmpeg/ffmpeg-core.wasm',
    });
  });
});
