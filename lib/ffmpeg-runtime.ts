export const FFMPEG_WRAPPER_VERSION = '0.12.15';
export const FFMPEG_CORE_VERSION = '0.12.10';
export const DEFAULT_FFMPEG_CORE_BASE_URL =
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export function getFfmpegCoreAssetUrls(configuredBaseURL?: string): {
  coreURL: string;
  wasmURL: string;
} {
  const baseURL = (configuredBaseURL?.trim() || DEFAULT_FFMPEG_CORE_BASE_URL)
    .replace(/\/+$/, '');
  return {
    coreURL: `${baseURL}/ffmpeg-core.js`,
    wasmURL: `${baseURL}/ffmpeg-core.wasm`,
  };
}
