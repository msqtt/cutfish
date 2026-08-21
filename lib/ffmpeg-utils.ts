import { buildAtempoChain, computeCanvasDimensions, type CanvasAspect } from './editor-utils';
import { buildXfadeChain, buildAcrossfadeChain, computeTransitionAdjustedDuration, getXfadeFinalLabel, type TransitionClip } from './transition-utils';
import { buildDrawtextFilters, type FontMap } from './text-overlay-utils';

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

export interface ExtendedClipMetadata extends ClipMetadata {
  volume: number;       // 0–200
  muted: boolean;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  speed: number;        // 0.25–4.0
}

export interface TransitionConfig {
  id: string;
  afterClipId: string;
  type: 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideright' | 'slideleft';
  duration: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  fontSize: number;
  color: string;
  position: { x: number; y: number };
  startTime: number;
  endTime: number;
}

export interface BgMusicExport {
  filename: string;
  volume: number;   // 0–200
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  replaceOriginalAudio?: boolean; // defaults to false for backward compatibility
}

export interface PngOverlayInput {
  filename: string;
  startTime: number;
  endTime: number;
}

export interface TtsAudioInput {
  filename: string;
  startTime: number;   // export-range-relative start (seconds)
  endTime: number;     // export-range-relative end (seconds)
  sourceTrimStart: number; // trim from beginning of source WAV (seconds)
  rate: number;        // 0.5–2.0
  volume: number;      // 0–1
}

export interface AudioFadeSettings {
  fadeIn: number;
  fadeOut: number;
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

function formatFilterNumber(value: number) {
  return Number(value.toFixed(6)).toString();
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

export interface SpeedAwareTimelineClip extends TimelineClip {
  speed?: number;
}

/** Speed-aware export selection: range is in playback time, accounting for per-clip speed. */
export function selectClipsForExportSpeedAware<T extends SpeedAwareTimelineClip>(clips: T[], range: ExportRange): T[] {
  const start = safeNumber(range.start, 'range.start');
  const end = safeNumber(range.end, 'range.end');
  if (start < 0 || end <= start) throw new Error('Invalid export range');

  const projectDuration = clips.reduce((total, clip) => {
    const duration = safeNumber(clip.trimEnd, 'trimEnd') - safeNumber(clip.trimStart, 'trimStart');
    if (clip.trimStart < 0 || duration <= 0) throw new Error(`Invalid trim range for ${clip.id}`);
    const speed = (clip.speed != null && Number.isFinite(clip.speed) && clip.speed > 0) ? clip.speed : 1.0;
    return total + duration / speed;
  }, 0);
  if (start >= projectDuration || end > projectDuration + 1e-6) {
    throw new Error('Export range is outside the project');
  }

  const selected: T[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const clipSourceDuration = clip.trimEnd - clip.trimStart;
    const speed = (clip.speed != null && Number.isFinite(clip.speed) && clip.speed > 0) ? clip.speed : 1.0;
    const clipPlaybackDuration = clipSourceDuration / speed;
    const intersectionStart = Math.max(start, cursor);
    const intersectionEnd = Math.min(end, cursor + clipPlaybackDuration);
    if (intersectionEnd > intersectionStart) {
      // Convert playback offsets back to source offsets
      const sourceStart = (intersectionStart - cursor) * speed;
      const sourceEnd = (intersectionEnd - cursor) * speed;
      selected.push({
        ...clip,
        trimStart: clip.trimStart + sourceStart,
        trimEnd: clip.trimStart + sourceEnd,
      });
    }
    cursor += clipPlaybackDuration;
  }
  if (!selected.length) throw new Error('Export range is outside the project');
  return selected;
}

/** Build deterministic FFmpeg arguments for trimmed, normalized clip concatenation. */
export function buildFFmpegCommand(
  clips: ClipMetadata[],
  filters: FilterState,
  audioDelayMs: number,
  audioFade: AudioFadeSettings,
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
    filterComplex += `[concata]adelay=delays=${delay}:all=1[timeda];`;
  } else if (delay < 0) {
    filterComplex += `[concata]atrim=start=${Math.abs(delay) / 1000},asetpts=PTS-STARTPTS,`;
    filterComplex += `apad,atrim=duration=${outputDuration}[timeda];`;
  } else {
    filterComplex += '[concata]anull[timeda];';
  }

  const requestedFadeIn = safeNumber(audioFade.fadeIn, 'fadeIn');
  const requestedFadeOut = safeNumber(audioFade.fadeOut, 'fadeOut');
  if (requestedFadeIn < 0) throw new Error('fadeIn must not be negative');
  if (requestedFadeOut < 0) throw new Error('fadeOut must not be negative');
  const fadeIn = Math.min(requestedFadeIn, outputDuration);
  const fadeOut = Math.min(requestedFadeOut, outputDuration);
  const fadeFilters: string[] = [];
  if (fadeIn > 0) fadeFilters.push(`afade=t=in:st=0:d=${formatFilterNumber(fadeIn)}`);
  if (fadeOut > 0) {
    fadeFilters.push(`afade=t=out:st=${formatFilterNumber(outputDuration - fadeOut)}:d=${formatFilterNumber(fadeOut)}`);
  }
  filterComplex += fadeFilters.length
    ? `[timeda]${fadeFilters.join(',')}[synceda]`
    : '[timeda]anull[synceda]';

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

/** Compute the volume filter expression for a clip. */
export function computeVolumeFilter(clipVolume: number, masterVolume: number, muted: boolean): string {
  if (muted) return 'volume=0';
  const effective = (clipVolume * masterVolume) / 10000;
  return `volume=${Number(effective.toFixed(6))}`;
}

/** Build FFmpeg rotation/flip filter string for a clip. */
export function buildRotationFilters(rotation: 0 | 90 | 180 | 270, flipH: boolean, flipV: boolean): string {
  const parts: string[] = [];
  if (rotation === 90) parts.push('transpose=1');
  else if (rotation === 180) parts.push('transpose=1,transpose=1');
  else if (rotation === 270) parts.push('transpose=2');

  if (flipH) parts.push('hflip');
  if (flipV) parts.push('vflip');

  return parts.join(',');
}

/** Build speed filter expressions for video and audio. */
export function buildSpeedFilters(speed: number): { video: string; audio: string } {
  if (speed === 1.0) return { video: '', audio: '' };
  const video = `setpts=PTS/${speed}`;
  const audio = buildAtempoChain(speed);
  return { video, audio };
}

const DEFAULT_FONT_MAP: FontMap = {
  sans: '/fonts/DejaVuSans.ttf',
  serif: '/fonts/DejaVuSerif.ttf',
  mono: '/fonts/DejaVuSansMono.ttf',
};

/**
 * Build extended FFmpeg command with all new features:
 * volume, mute, master volume, rotation, flips, speed, transitions, text overlays, bg music,
 * and optional PNG overlay inputs for subtitle/annotation burn-in.
 *
 * Preserves backward compatibility: all original buildFFmpegCommand parameters remain the same,
 * with new parameters added after.
 */
export function buildFFmpegCommandExtended(
  clips: ExtendedClipMetadata[],
  filters: FilterState,
  audioDelayMs: number,
  audioFade: AudioFadeSettings,
  outputFormat: 'mp4' | 'webm',
  profile: ExportProfile,
  masterVolume: number,
  canvasAspect: CanvasAspect,
  canvasFit: 'contain' | 'cover' | 'stretch',
  transitions: TransitionConfig[],
  textOverlays: TextOverlay[],
  bgMusic: BgMusicExport | null,
  fontMap: FontMap = DEFAULT_FONT_MAP,
  overlayPngs: PngOverlayInput[] = [],
  ttsAudioInputs: TtsAudioInput[] = [],
): string[] {
  if (clips.length === 0) throw new Error('At least one clip is required');

  // Compute canvas dimensions based on aspect
  const canvas = computeCanvasDimensions(canvasAspect, profile.height === 1080 ? '1080p' : profile.height === 720 ? '720p' : '480p');

  const args: string[] = ['-y'];
  clips.forEach((clip) => {
    if (!clip.filename) throw new Error('Clip filename is required');
    if (safeNumber(clip.trimStart, 'trimStart') < 0 || clip.trimEnd <= clip.trimStart) {
      throw new Error(`Invalid trim range for ${clip.filename}`);
    }
    args.push('-i', clip.filename);
  });

  // Add bg music input
  if (bgMusic) {
    args.push('-i', bgMusic.filename);
  }

  // Add PNG overlay inputs (after clips and optional bgMusic)
  for (const png of overlayPngs) {
    args.push('-loop', '1', '-i', png.filename);
  }

  // Add TTS WAV inputs (after PNGs)
  for (const tts of ttsAudioInputs) {
    args.push('-i', tts.filename);
  }

  let filterComplex = '';
  let outputDuration = 0;

  // Per-clip normalization with volume, rotation, flip, speed
  clips.forEach((clip, index) => {
    const start = safeNumber(clip.trimStart, 'trimStart');
    const end = safeNumber(clip.trimEnd, 'trimEnd');
    const rawDuration = end - start;
    const speed = clip.speed || 1.0;
    const effectiveDuration = rawDuration / speed;
    outputDuration += effectiveDuration;

    // Video pipeline
    let videoChain = `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS`;

    // Speed
    const speedFilters = buildSpeedFilters(speed);
    if (speedFilters.video) {
      videoChain += `,${speedFilters.video}`;
    }

    // Rotation/flips
    const rotationFilter = buildRotationFilters(clip.rotation || 0, clip.flipH || false, clip.flipV || false);
    if (rotationFilter) {
      videoChain += `,${rotationFilter}`;
    }

    // Scale and fit based on fit mode
    if (canvasFit === 'cover') {
      // Cover: scale up to fill, then crop to exact canvas
      videoChain += `,scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase`;
      videoChain += `,crop=${canvas.width}:${canvas.height}`;
    } else if (canvasFit === 'stretch') {
      // Stretch: force exact dimensions (no aspect preservation)
      videoChain += `,scale=${canvas.width}:${canvas.height}`;
    } else {
      // Contain: scale down preserving aspect, then pad to fill canvas
      videoChain += `,scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease`;
      videoChain += `,pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2`;
    }
    videoChain += `,fps=${profile.frameRate},setsar=1[v${index}]`;
    filterComplex += `${videoChain};`;

    // Audio pipeline
    const volumeFilter = computeVolumeFilter(clip.volume ?? 100, masterVolume, clip.muted ?? false);
    if (clip.hasAudio) {
      let audioChain = `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`;
      if (speedFilters.audio) {
        audioChain += `,${speedFilters.audio}`;
      }
      audioChain += `,${volumeFilter}`;
      audioChain += `,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`;
      filterComplex += `${audioChain};`;
    } else {
      filterComplex += `anullsrc=r=48000:cl=stereo,atrim=duration=${effectiveDuration},asetpts=PTS-STARTPTS,${volumeFilter}[a${index}];`;
    }
  });

  // Transition or concat
  const transitionClips: TransitionClip[] = clips.map((clip) => ({
    id: clip.id,
    trimmedDuration: (clip.trimEnd - clip.trimStart) / (clip.speed || 1.0),
  }));

  const validTransitions = transitions.filter((t) => {
    const idx = clips.findIndex((c) => c.id === t.afterClipId);
    return idx >= 0 && idx < clips.length - 1;
  });

  const hasTransitions = validTransitions.length > 0;
  let videoOut: string;
  let audioOut: string;

  if (hasTransitions && clips.length > 1) {
    const xfadeChain = buildXfadeChain(transitionClips, validTransitions, profile.frameRate);
    const acrossfadeChain = buildAcrossfadeChain(transitionClips, validTransitions);
    filterComplex += `${xfadeChain};`;
    filterComplex += `${acrossfadeChain};`;
    videoOut = getXfadeFinalLabel(transitionClips, validTransitions, 'xf');
    audioOut = getXfadeFinalLabel(transitionClips, validTransitions, 'af');
    outputDuration = computeTransitionAdjustedDuration(transitionClips, validTransitions);
  } else {
    // Simple concat
    const normalizedStreams = clips.map((_, i) => `[v${i}][a${i}]`).join('');
    filterComplex += `${normalizedStreams}concat=n=${clips.length}:v=1:a=1[concatv][concata];`;
    videoOut = '[concatv]';
    audioOut = '[concata]';
  }

  // Visual filters (brightness/contrast/saturation)
  const brightness = (safeNumber(filters.brightness, 'brightness') - 100) / 100;
  const contrast = safeNumber(filters.contrast, 'contrast') / 100;
  const saturation = safeNumber(filters.saturation, 'saturation') / 100;
  filterComplex += `${videoOut}eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}[eqv];`;

  // Text overlays via drawtext
  let finalVideoLabel = '[eqv]';
  if (textOverlays.length > 0) {
    const drawtextChain = buildDrawtextFilters(textOverlays, fontMap);
    filterComplex += `[eqv]${drawtextChain}[filteredv];`;
    finalVideoLabel = '[filteredv]';
  } else {
    filterComplex += '[eqv]null[filteredv];';
    finalVideoLabel = '[filteredv]';
  }

  // PNG overlay chain (subtitle/annotation burn-in)
  if (overlayPngs.length > 0) {
    // Compute first PNG overlay input index: clips + (bgMusic ? 1 : 0)
    const pngBaseIndex = clips.length + (bgMusic ? 1 : 0);
    let prevLabel = finalVideoLabel;
    for (let i = 0; i < overlayPngs.length; i++) {
      const png = overlayPngs[i];
      const inputIdx = pngBaseIndex + i;
      const outLabel = i === overlayPngs.length - 1 ? '[overlayv]' : `[ov${i}]`;
      filterComplex += `${prevLabel}[${inputIdx}:v]overlay=0:0:shortest=1:eof_action=pass:enable='between(t,${formatFilterNumber(png.startTime)},${formatFilterNumber(png.endTime)})'${outLabel};`;
      prevLabel = outLabel;
    }
    finalVideoLabel = '[overlayv]';
  }

  const replaceOriginalAudio = bgMusic?.replaceOriginalAudio === true;

  // Validate global source-audio timing settings even when replacement mode bypasses them.
  const delay = Math.round(safeNumber(audioDelayMs, 'audioDelayMs'));
  const requestedFadeIn = safeNumber(audioFade.fadeIn, 'fadeIn');
  const requestedFadeOut = safeNumber(audioFade.fadeOut, 'fadeOut');
  if (requestedFadeIn < 0) throw new Error('fadeIn must not be negative');
  if (requestedFadeOut < 0) throw new Error('fadeOut must not be negative');

  let finalAudioLabel: string;
  if (replaceOriginalAudio) {
    // Consume the concatenated source audio without allowing it into the output.
    filterComplex += `${audioOut}anullsink;`;
    finalAudioLabel = '[bgaudio]';
  } else {
    // Audio delay
    if (delay > 0) {
      filterComplex += `${audioOut}adelay=delays=${delay}:all=1[timeda];`;
    } else if (delay < 0) {
      filterComplex += `${audioOut}atrim=start=${Math.abs(delay) / 1000},asetpts=PTS-STARTPTS,`;
      filterComplex += `apad,atrim=duration=${outputDuration}[timeda];`;
    } else {
      filterComplex += `${audioOut}anull[timeda];`;
    }

    // Audio fades
    const fadeIn = Math.min(requestedFadeIn, outputDuration);
    const fadeOut = Math.min(requestedFadeOut, outputDuration);
    const fadeFilters: string[] = [];
    if (fadeIn > 0) fadeFilters.push(`afade=t=in:st=0:d=${formatFilterNumber(fadeIn)}`);
    if (fadeOut > 0) {
      fadeFilters.push(`afade=t=out:st=${formatFilterNumber(outputDuration - fadeOut)}:d=${formatFilterNumber(fadeOut)}`);
    }
    filterComplex += fadeFilters.length
      ? `[timeda]${fadeFilters.join(',')}[synceda];`
      : '[timeda]anull[synceda];';
    finalAudioLabel = '[synceda]';
  }

  // Background music: mix with source audio, or use it as the replacement baseline.
  if (bgMusic) {
    const bgInputIdx = clips.length;
    const bgVolNorm = (bgMusic.volume ?? 100) / 100;
    let bgAudioChain = `[${bgInputIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;

    if (bgMusic.loop) {
      bgAudioChain += `,aloop=loop=-1:size=2e+09`;
    }
    bgAudioChain += `,apad,atrim=duration=${outputDuration}`;

    const bgFadeIn = Math.min(Math.max(0, bgMusic.fadeIn), outputDuration);
    const bgFadeOut = Math.min(Math.max(0, bgMusic.fadeOut), outputDuration);
    if (bgFadeIn > 0) {
      bgAudioChain += `,afade=t=in:st=0:d=${formatFilterNumber(bgFadeIn)}`;
    }
    if (bgFadeOut > 0) {
      bgAudioChain += `,afade=t=out:st=${formatFilterNumber(outputDuration - bgFadeOut)}:d=${formatFilterNumber(bgFadeOut)}`;
    }
    bgAudioChain += `,volume=${bgVolNorm}[bgaudio]`;

    if (replaceOriginalAudio) {
      filterComplex += bgAudioChain;
      finalAudioLabel = '[bgaudio]';
    } else {
      filterComplex += `${bgAudioChain};`;
      filterComplex += `[synceda][bgaudio]amix=inputs=2:duration=first[bgmixed]`;
      finalAudioLabel = '[bgmixed]';
    }
  } else {
    filterComplex = filterComplex.replace(/;\s*$/, '');
  }

  // TTS audio mixing
  if (ttsAudioInputs.length > 0) {
    // TTS input index: clips + (bgMusic ? 1 : 0) + overlayPngs.length
    const ttsBaseIndex = clips.length + (bgMusic ? 1 : 0) + overlayPngs.length;

    // Ensure trailing semicolon before TTS filters
    if (!filterComplex.endsWith(';')) {
      filterComplex += ';';
    }

    const ttsLabels: string[] = [];
    for (let i = 0; i < ttsAudioInputs.length; i++) {
      const tts = ttsAudioInputs[i];
      const inputIdx = ttsBaseIndex + i;
      const label = `[tts${i}]`;
      const duration = tts.endTime - tts.startTime;
      const delayMs = Math.round(tts.startTime * 1000);

      // Build TTS audio filter chain:
      // atrim source → asetpts → aresample/aformat stereo 48k → atempo chain → volume → atrim duration → adelay
      let chain = `[${inputIdx}:a]atrim=start=${formatFilterNumber(tts.sourceTrimStart)},asetpts=PTS-STARTPTS`;
      chain += `,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;

      // Rate via atempo chain
      if (tts.rate !== 1.0) {
        const atempoChain = buildAtempoChain(tts.rate);
        if (atempoChain) {
          chain += `,${atempoChain}`;
        }
      }

      // Volume
      chain += `,volume=${formatFilterNumber(tts.volume)}`;

      // Limit duration to visible cue duration
      chain += `,atrim=duration=${formatFilterNumber(duration)}`;

      // Delay to start position
      if (delayMs > 0) {
        chain += `,adelay=delays=${delayMs}:all=1`;
      }

      chain += label;
      filterComplex += `${chain};`;
      ttsLabels.push(label);
    }

    // Mix all TTS streams with the current audio using amix duration=first
    const amixInputs = ttsLabels.length + 1;
    filterComplex += `${finalAudioLabel}${ttsLabels.join('')}amix=inputs=${amixInputs}:duration=first[finala]`;
    finalAudioLabel = '[finala]';
  } else if (bgMusic && !replaceOriginalAudio) {
    // Rename bgmixed to finala for backward compatibility in -map
    filterComplex = filterComplex.replace('[bgmixed]', '[finala]');
    finalAudioLabel = '[finala]';
  }

  args.push('-filter_complex', filterComplex, '-map', finalVideoLabel, '-map', finalAudioLabel);
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
