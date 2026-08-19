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

export type FontMap = Record<'sans' | 'serif' | 'mono', string>;

/**
 * Escape text for FFmpeg drawtext filter.
 * In drawtext, single quotes need to be escaped as '\'' (end quote, escaped quote, start quote)
 * but within a filter_complex string, we use backslash escaping.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Build a chain of drawtext filters for all text overlays.
 * Returns a comma-separated filter chain string ready for filter_complex insertion.
 * Returns empty string for empty overlays.
 *
 * Position uses percentage-based expressions: x=(w*X/100), y=(h*Y/100)
 * Timing uses enable='between(t,start,end)'
 */
export function buildDrawtextFilters(overlays: TextOverlay[], fontMap: FontMap): string {
  if (overlays.length === 0) return '';

  const filters = overlays.map((overlay) => {
    const fontPath = fontMap[overlay.fontFamily];
    const escapedText = escapeDrawtext(overlay.text);
    const x = `x=(w*${overlay.position.x}/100)`;
    const y = `y=(h*${overlay.position.y}/100)`;
    const enable = `enable='between(t,${overlay.startTime},${overlay.endTime})'`;

    return `drawtext=fontfile='${fontPath}':text='${escapedText}':fontsize=${overlay.fontSize}:fontcolor='${overlay.color}':${x}:${y}:${enable}`;
  });

  return filters.join(',');
}

/**
 * Build an overlay filter for using a pre-rendered PNG image as text overlay.
 * This is the fallback strategy when drawtext is unreliable in FFmpeg.wasm.
 *
 * @param pngFilename - The MEMFS filename of the rendered PNG
 * @param startTime - When to show the overlay
 * @param endTime - When to hide the overlay
 * @param inputIndex - The input stream index for the PNG file
 * @returns Filter string segment
 */
export function buildOverlayImageFilter(pngFilename: string, startTime: number, endTime: number, inputIndex: number): string {
  return `[${inputIndex}:v]overlay=0:0:enable='between(t,${startTime},${endTime})'`;
}

/**
 * Generate an overlay filter chain using multiple PNG images (one per text overlay).
 * Each PNG is an additional input to FFmpeg.
 *
 * @param overlays - Array of overlay configs with their corresponding PNG filenames
 * @param baseInputCount - Number of video/audio inputs before the PNG inputs
 * @returns Filter chain segment
 */
export function buildPngOverlayChain(
  overlays: Array<{ filename: string; startTime: number; endTime: number }>,
  baseInputCount: number,
): string {
  if (overlays.length === 0) return '';

  const filters: string[] = [];
  let prevLabel = '[textbase]';

  overlays.forEach((overlay, i) => {
    const inputIdx = baseInputCount + i;
    const outLabel = i === overlays.length - 1 ? '[textout]' : `[txt${i}]`;
    filters.push(`${prevLabel}[${inputIdx}:v]overlay=0:0:enable='between(t,${overlay.startTime},${overlay.endTime})'${outLabel}`);
    prevLabel = outLabel;
  });

  return filters.join(';');
}

/**
 * Get the list of unique font families needed for a set of overlays.
 */
export function getRequiredFonts(overlays: TextOverlay[]): Array<'sans' | 'serif' | 'mono'> {
  const families = new Set<'sans' | 'serif' | 'mono'>();
  for (const overlay of overlays) {
    families.add(overlay.fontFamily);
  }
  return Array.from(families);
}

/** Select overlays intersecting an export range and shift them to output-relative time. */
export function selectTextOverlaysForExport(
  overlays: TextOverlay[],
  startTime: number,
  endTime: number,
): TextOverlay[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime) {
    throw new Error('Invalid text overlay export range');
  }
  return overlays
    .filter((overlay) => overlay.endTime > startTime && overlay.startTime < endTime)
    .map((overlay) => ({
      ...overlay,
      startTime: Math.max(0, overlay.startTime - startTime),
      endTime: Math.min(endTime, overlay.endTime) - startTime,
    }));
}
