export interface FilterState {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface ClipMetadata {
  id: string;
  filename: string;
  trimStart: number;
  trimEnd: number;
}

function safeNumber(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

/** Build deterministic FFmpeg arguments for trimmed, normalized clip concatenation. */
export function buildFFmpegCommand(
  clips: ClipMetadata[],
  filters: FilterState,
  audioDelayMs: number,
  outputFormat: 'mp4' | 'webm',
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

  clips.forEach((clip, index) => {
    const start = safeNumber(clip.trimStart, 'trimStart');
    const end = safeNumber(clip.trimEnd, 'trimEnd');
    filterComplex += `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,`;
    filterComplex += 'scale=1280:720:force_original_aspect_ratio=decrease,';
    filterComplex += `pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${index}];`;
    filterComplex += `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,`;
    filterComplex += `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}];`;
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
    filterComplex += `[concata]atrim=start=${Math.abs(delay) / 1000},asetpts=PTS-STARTPTS[synceda]`;
  } else {
    filterComplex += '[concata]anull[synceda]';
  }

  args.push('-filter_complex', filterComplex, '-map', '[filteredv]', '-map', '[synceda]');

  if (outputFormat === 'mp4') {
    args.push(
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    );
  } else {
    args.push(
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '160k',
    );
  }

  args.push('-shortest', `output.${outputFormat}`);
  return args;
}
