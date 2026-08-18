export interface FilterState {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface TimelineClip {
  id: string;
  trimStart: number;
  trimEnd: number;
}

export interface ClipMetadata extends TimelineClip {
  filename: string;
  hasAudio: boolean;
}

export type ExportResolution = '480p' | '720p' | '1080p';
export type ExportFrameRate = 24 | 30 | 60;
export type ExportQuality = 'compact' | 'balanced' | 'high';

export interface ExportSettings {
  resolution: ExportResolution;
  frameRate: ExportFrameRate;
  quality: ExportQuality;
  rangeStart: number;
  rangeEnd: number | null;
}

export interface ExportProfile {
  width: number;
  height: number;
  frameRate: ExportFrameRate;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

export interface ExportRange {
  start: number;
  end: number;
}

const RESOLUTIONS: Record<ExportResolution, { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const VIDEO_BITRATES: Record<ExportResolution, Record<ExportQuality, number>> = {
  '480p': { compact: 600, balanced: 1200, high: 2500 },
  '720p': { compact: 1200, balanced: 2500, high: 5000 },
  '1080p': { compact: 2500, balanced: 5000, high: 9000 },
};

const AUDIO_BITRATES: Record<ExportQuality, number> = {
  compact: 96,
  balanced: 128,
  high: 192,
};

function safeNumber(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

export function resolveExportProfile(settings: ExportSettings): ExportProfile {
  const dimensions = RESOLUTIONS[settings.resolution];
  if (!dimensions) throw new Error('Unsupported export resolution');
  if (![24, 30, 60].includes(settings.frameRate)) throw new Error('Unsupported frame rate');
  const videoBitrateKbps = VIDEO_BITRATES[settings.resolution]?.[settings.quality];
  const audioBitrateKbps = AUDIO_BITRATES[settings.quality];
  if (!videoBitrateKbps || !audioBitrateKbps) throw new Error('Unsupported quality preset');
  return { ...dimensions, frameRate: settings.frameRate, videoBitrateKbps, audioBitrateKbps };
}

export function estimateOutputSizeMB(durationSeconds: number, profile: ExportProfile) {
  const duration = Math.max(0, safeNumber(durationSeconds, 'durationSeconds'));
  return duration * (profile.videoBitrateKbps + profile.audioBitrateKbps) / 8 / 1000;
}

/** Map a project-level export interval back to each contributing source clip. */
export function selectClipsForExport<T extends TimelineClip>(clips: T[], range: ExportRange): T[] {
  const start = safeNumber(range.start, 'range.start');
  const end = safeNumber(range.end, 'range.end');
  if (start < 0 || end <= start) throw new Error('Invalid export range');

  const projectDuration = clips.reduce((total, clip) => {
    const duration = safeNumber(clip.trimEnd, 'trimEnd') - safeNumber(clip.trimStart, 'trimStart');
    if (clip.trimStart < 0 || duration <= 0) throw new Error(`Invalid trim range for ${clip.id}`);
    return total + duration;
  }, 0);
  if (start >= projectDuration || end > projectDuration + 1e-6) {
    throw new Error('Export range is outside the project');
  }

  const selected: T[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const clipDuration = clip.trimEnd - clip.trimStart;
    const intersectionStart = Math.max(start, cursor);
    const intersectionEnd = Math.min(end, cursor + clipDuration);
    if (intersectionEnd > intersectionStart) {
      selected.push({
        ...clip,
        trimStart: clip.trimStart + intersectionStart - cursor,
        trimEnd: clip.trimStart + intersectionEnd - cursor,
      });
    }
    cursor += clipDuration;
  }
  if (!selected.length) throw new Error('Export range is outside the project');
  return selected;
}

/** Build deterministic FFmpeg arguments for trimmed, normalized clip concatenation. */
export function buildFFmpegCommand(
  clips: ClipMetadata[],
  filters: FilterState,
  audioDelayMs: number,
  outputFormat: 'mp4' | 'webm',
  profile: ExportProfile,
): string[] {
  if (clips.length === 0) throw new Error('At least one clip is required');

  const args: string[] = ['-y'];
  clips.forEach((clip) => {
    if (!clip.filename) throw new Error('Clip filename is required');
    if (safeNumber(clip.trimStart, 'trimStart') < 0 || clip.trimEnd <= clip.trimStart) {
      throw new Error(`Invalid trim range for ${clip.filename}`);
    }
    args.push('-i', clip.filename);
  });

  const normalizedStreams: string[] = [];
  let filterComplex = '';
  let outputDuration = 0;

  clips.forEach((clip, index) => {
    const start = safeNumber(clip.trimStart, 'trimStart');
    const end = safeNumber(clip.trimEnd, 'trimEnd');
    const duration = end - start;
    outputDuration += duration;
    filterComplex += `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,`;
    filterComplex += `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,`;
    filterComplex += `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,fps=${profile.frameRate},setsar=1[v${index}];`;
    if (clip.hasAudio) {
      filterComplex += `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,`;
      filterComplex += `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}];`;
    } else {
      filterComplex += `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}];`;
    }
    normalizedStreams.push(`[v${index}][a${index}]`);
  });

  filterComplex += `${normalizedStreams.join('')}concat=n=${clips.length}:v=1:a=1[concatv][concata];`;

  const brightness = (safeNumber(filters.brightness, 'brightness') - 100) / 100;
  const contrast = safeNumber(filters.contrast, 'contrast') / 100;
  const saturation = safeNumber(filters.saturation, 'saturation') / 100;
  filterComplex += `[concatv]eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}[filteredv];`;

  const delay = Math.round(safeNumber(audioDelayMs, 'audioDelayMs'));
  if (delay > 0) {
    filterComplex += `[concata]adelay=delays=${delay}:all=1[synceda]`;
  } else if (delay < 0) {
    filterComplex += `[concata]atrim=start=${Math.abs(delay) / 1000},asetpts=PTS-STARTPTS,`;
    filterComplex += `apad,atrim=duration=${outputDuration}[synceda]`;
  } else {
    filterComplex += '[concata]anull[synceda]';
  }

  args.push('-filter_complex', filterComplex, '-map', '[filteredv]', '-map', '[synceda]');
  const videoBitrate = `${profile.videoBitrateKbps}k`;
  const audioBitrate = `${profile.audioBitrateKbps}k`;

  if (outputFormat === 'mp4') {
    args.push(
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-b:v', videoBitrate, '-maxrate', `${Math.round(profile.videoBitrateKbps * 1.25)}k`,
      '-bufsize', `${profile.videoBitrateKbps * 2}k`,
      '-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart',
    );
  } else {
    args.push(
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', videoBitrate,
      '-c:a', 'libopus', '-b:a', audioBitrate,
    );
  }

  args.push('-shortest', `output.${outputFormat}`);
  return args;
}
