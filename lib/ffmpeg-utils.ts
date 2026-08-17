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

/**
 * Pure function to build the FFmpeg complex filter command for merging multiple clips
 * and applying global filters & audio sync.
 */
export function buildFFmpegCommand(
  clips: ClipMetadata[],
  filters: FilterState,
  audioDelayMs: number,
  outputFormat: 'mp4' | 'webm'
): string[] {
  const args: string[] = [];
  
  // 1. Input files and trimming
  clips.forEach(clip => {
    args.push('-i', clip.filename);
  });

  // 2. Filter Complex setup
  let filterComplex = '';
  
  // Normalize each input to a standard resolution/framerate to ensure concat works smoothly
  // We'll use 720p as a safe default for web wasm rendering
  const normalizedStreams: string[] = [];
  
  clips.forEach((clip, index) => {
    const start = clip.trimStart;
    const end = clip.trimEnd;
    
    // Trim and scale video
    filterComplex += `[${index}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v${index}];`;
    
    // Trim audio
    filterComplex += `[${index}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}];`;
    
    normalizedStreams.push(`[v${index}][a${index}]`);
  });

  // Concat all normalized streams
  const concatInput = normalizedStreams.join('');
  filterComplex += `${concatInput}concat=n=${clips.length}:v=1:a=1[concatv][concata];`;

  // Apply color filters to the concatenated video
  // eq filter expects: brightness -1.0 to 1.0 (default 0), contrast -2.0 to 2.0 (default 1), saturation 0.0 to 3.0 (default 1)
  const b = (filters.brightness - 100) / 100;
  const c = filters.contrast / 100;
  const s = filters.saturation / 100;
  
  filterComplex += `[concatv]eq=brightness=${b}:contrast=${c}:saturation=${s}[filteredv];`;

  // Apply audio delay (sync)
  if (audioDelayMs !== 0) {
    const delay = audioDelayMs > 0 ? audioDelayMs : 0;
    // For adelay, input is in milliseconds. We apply it to all channels (delay|delay)
    filterComplex += `[concata]adelay=${delay}|${delay}[synceda]`;
  } else {
    filterComplex += `[concata]anull[synceda]`;
  }

  args.push('-filter_complex', filterComplex);
  args.push('-map', '[filteredv]', '-map', '[synceda]');
  
  // Encoding settings based on format
  if (outputFormat === 'mp4') {
    // Fast encoding for WASM
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac');
  } else {
    args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus');
  }

  args.push(`output.${outputFormat}`);
  
  return args;
}
