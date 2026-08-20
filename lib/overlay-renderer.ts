/**
 * Browser-side transparent PNG renderer for visual overlays AND subtitles.
 * Each overlay/subtitle produces a full-resolution transparent PNG for FFmpeg overlay filter.
 * Uses OffscreenCanvas with 2D context.
 * Loads DejaVu fonts from /fonts/ and fails fast on load error.
 */

import type { SubtitleCue, VisualOverlay, DrawingOverlay, RectangleOverlay, ImageOverlay } from './visual-overlay-utils';
import { selectAndShiftOverlaysForExport } from './visual-overlay-utils';

export interface RenderedPng {
  filename: string;
  data: Uint8Array;
  startTime: number;
  endTime: number;
}

export interface RenderContext {
  width: number;
  height: number;
  rangeStart: number;
  rangeEnd: number;
}

// Font family to public path mapping
const FONT_PATHS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: '/fonts/DejaVuSans.ttf',
  serif: '/fonts/DejaVuSerif.ttf',
  mono: '/fonts/DejaVuSansMono.ttf',
};

const FONT_FACE_NAMES: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'CutfishSans',
  serif: 'CutfishSerif',
  mono: 'CutfishMono',
};

let fontsLoaded = false;

/**
 * Load bundled DejaVu fonts into the document/worker font set.
 * Fail-fast: throws if any font cannot be loaded.
 */
async function ensureFontsLoaded(): Promise<void> {
  if (fontsLoaded) return;
  const families: Array<'sans' | 'serif' | 'mono'> = ['sans', 'serif', 'mono'];
  for (const family of families) {
    const path = FONT_PATHS[family];
    const faceName = FONT_FACE_NAMES[family];
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load font ${family} from ${path}: HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const face = new FontFace(faceName, buffer);
    await face.load();
    const fontSet = typeof document !== 'undefined'
      ? document.fonts
      : (self as unknown as { fonts?: FontFaceSet }).fonts;
    if (!fontSet) throw new Error('FontFaceSet is unavailable in this browser');
    fontSet.add(face);
  }
  fontsLoaded = true;
}

/**
 * Get the canvas font string for a given family.
 */
function getCanvasFont(family: 'sans' | 'serif' | 'mono', fontSize: number): string {
  return `${fontSize}px ${FONT_FACE_NAMES[family]}`;
}

/**
 * Render visual overlays AND subtitles that intersect the export range into transparent PNGs.
 * Each item produces one full-canvas PNG.
 * Throws on image/font load failure (fail-fast).
 */
export async function renderOverlaysToPng(
  overlays: VisualOverlay[],
  ctx: RenderContext,
  subtitles: SubtitleCue[] = [],
): Promise<RenderedPng[]> {
  const { width, height, rangeStart, rangeEnd } = ctx;

  // Select and shift overlays to export-relative time
  const shiftedOverlays = selectAndShiftOverlaysForExport(overlays, rangeStart, rangeEnd);
  const shiftedSubtitles = selectAndShiftOverlaysForExport(subtitles, rangeStart, rangeEnd);

  if (shiftedOverlays.length === 0 && shiftedSubtitles.length === 0) return [];

  // Load fonts if any subtitle exists
  if (shiftedSubtitles.length > 0) {
    await ensureFontsLoaded();
  }

  const results: RenderedPng[] = [];
  let index = 0;

  // Render visual overlays
  for (const overlay of shiftedOverlays) {
    const canvas = new OffscreenCanvas(width, height);
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Cannot get 2d context from OffscreenCanvas');

    switch (overlay.type) {
      case 'drawing':
        renderDrawing(c, overlay, width, height);
        break;
      case 'rectangle':
        renderRectangle(c, overlay, width, height);
        break;
      case 'image':
        await renderImage(c, overlay, width, height);
        break;
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    results.push({
      filename: `overlay-${index}.png`,
      data: new Uint8Array(buffer),
      startTime: overlay.startTime,
      endTime: overlay.endTime,
    });
    index++;
  }

  // Render subtitles
  for (const cue of shiftedSubtitles) {
    const canvas = new OffscreenCanvas(width, height);
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Cannot get 2d context from OffscreenCanvas');

    renderSubtitle(c, cue, width, height);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    results.push({
      filename: `overlay-${index}.png`,
      data: new Uint8Array(buffer),
      startTime: cue.startTime,
      endTime: cue.endTime,
    });
    index++;
  }

  return results;
}

// ─── Subtitle Rendering ──────────────────────────────────────────────────────

/**
 * Render a subtitle cue onto the canvas as a transparent PNG.
 * Supports: manual newlines (\n), auto word/char wrap based on cue.width,
 * fontFamily, fontSize, lineHeight, color, transparent background,
 * align, position, rotation.
 */
function renderSubtitle(
  c: OffscreenCanvasRenderingContext2D,
  cue: SubtitleCue,
  width: number,
  height: number,
): void {
  const fontSize = cue.fontSize;
  const lineHeight = cue.lineHeight || 1.3;
  const lineSpacing = fontSize * lineHeight;
  const font = getCanvasFont(cue.fontFamily, fontSize);
  c.font = font;

  // Compute the max width in pixels (cue.width is % of canvas)
  const maxWidth = (cue.width / 100) * width;

  // Split text into lines: first by explicit newlines, then auto-wrap
  const rawLines = cue.text.split('\n');
  const wrappedLines: string[] = [];
  for (const rawLine of rawLines) {
    const wrapped = wrapLine(c, rawLine, maxWidth);
    wrappedLines.push(...wrapped);
  }

  // Compute total text block size
  const blockHeight = wrappedLines.length * lineSpacing;

  // Position: cue.position x/y are percentage of canvas (center of text block)
  const cx = (cue.position.x / 100) * width;
  const cy = (cue.position.y / 100) * height;

  c.save();
  c.translate(cx, cy);
  if (cue.rotation !== 0) {
    c.rotate((cue.rotation * Math.PI) / 180);
  }

  // Background
  if (cue.backgroundColor && cue.backgroundColor !== 'transparent' && cue.backgroundColor !== '') {
    c.fillStyle = cue.backgroundColor;
    const padding = fontSize * 0.2;
    // Measure max line width for background
    let maxLineW = 0;
    for (const line of wrappedLines) {
      const m = c.measureText(line);
      if (m.width > maxLineW) maxLineW = m.width;
    }
    const bgW = Math.min(maxWidth, maxLineW) + padding * 2;
    const bgH = blockHeight + padding * 2;
    let bgX = -bgW / 2;
    if (cue.align === 'left') bgX = -maxWidth / 2;
    else if (cue.align === 'right') bgX = maxWidth / 2 - bgW;
    c.fillRect(bgX, -blockHeight / 2 - padding, bgW, bgH);
  }

  // Text
  c.fillStyle = cue.color || '#ffffff';
  c.font = font;
  c.textBaseline = 'top';
  c.textAlign = cue.align;

  let textX = 0;
  if (cue.align === 'left') textX = -maxWidth / 2;
  else if (cue.align === 'right') textX = maxWidth / 2;
  // center: x=0 works with textAlign='center'

  const startY = -blockHeight / 2;
  for (let i = 0; i < wrappedLines.length; i++) {
    c.fillText(wrappedLines[i], textX, startY + i * lineSpacing);
  }

  c.restore();
}

/**
 * Wrap a single line of text to fit within maxWidth.
 * Attempts word-wrap first; if a single word exceeds maxWidth, falls back to character wrap.
 */
function wrapLine(
  c: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (text === '') return [''];
  if (c.measureText(text).width <= maxWidth) return [text];

  const lines: string[] = [];
  // Try word wrap first
  const words = text.split(/(\s+)/);
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + word;
    if (c.measureText(testLine).width <= maxWidth || currentLine === '') {
      currentLine = testLine;
    } else {
      // Current line is full, push it
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = word;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  // Check if any line still exceeds maxWidth (a single word was too long) → char wrap
  const finalLines: string[] = [];
  for (const line of lines) {
    if (c.measureText(line).width <= maxWidth) {
      finalLines.push(line);
    } else {
      // Character wrap
      let charLine = '';
      for (const ch of line) {
        const test = charLine + ch;
        if (c.measureText(test).width <= maxWidth || charLine === '') {
          charLine = test;
        } else {
          finalLines.push(charLine);
          charLine = ch;
        }
      }
      if (charLine) finalLines.push(charLine);
    }
  }

  return finalLines.length > 0 ? finalLines : [''];
}

// ─── Visual Overlay Rendering ────────────────────────────────────────────────

function renderDrawing(c: OffscreenCanvasRenderingContext2D, overlay: DrawingOverlay, width: number, height: number) {
  if (overlay.points.length < 2) return;
  c.save();
  c.globalAlpha = overlay.opacity;

  const cx = (overlay.position.x / 100) * width;
  const cy = (overlay.position.y / 100) * height;
  const w = (overlay.size.w / 100) * width;
  const h = (overlay.size.h / 100) * height;

  c.translate(cx, cy);
  if (overlay.rotation !== 0) {
    c.rotate((overlay.rotation * Math.PI) / 180);
  }

  // Points are normalized 0-1 relative to overlay size
  c.strokeStyle = overlay.strokeColor;
  c.lineWidth = (overlay.strokeWidth / 100) * Math.min(width, height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  const startX = overlay.points[0].x * w - w / 2;
  const startY = overlay.points[0].y * h - h / 2;
  c.moveTo(startX, startY);
  for (let i = 1; i < overlay.points.length; i++) {
    c.lineTo(overlay.points[i].x * w - w / 2, overlay.points[i].y * h - h / 2);
  }
  c.stroke();
  c.restore();
}

function renderRectangle(c: OffscreenCanvasRenderingContext2D, overlay: RectangleOverlay, width: number, height: number) {
  c.save();
  c.globalAlpha = overlay.opacity;

  const cx = (overlay.position.x / 100) * width;
  const cy = (overlay.position.y / 100) * height;
  const w = (overlay.size.w / 100) * width;
  const h = (overlay.size.h / 100) * height;

  c.translate(cx, cy);
  if (overlay.rotation !== 0) {
    c.rotate((overlay.rotation * Math.PI) / 180);
  }

  const x = -w / 2;
  const y = -h / 2;
  const radius = overlay.borderRadius;

  if (overlay.fillColor) {
    c.fillStyle = overlay.fillColor;
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.fill();
  }
  if (overlay.strokeColor && overlay.strokeWidth > 0) {
    c.strokeStyle = overlay.strokeColor;
    c.lineWidth = overlay.strokeWidth;
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.stroke();
  }
  c.restore();
}

async function renderImage(c: OffscreenCanvasRenderingContext2D, overlay: ImageOverlay, width: number, height: number) {
  const source = overlay.file ?? overlay.url;
  if (!source) return;

  let bitmap: ImageBitmap;
  try {
    if (source instanceof Blob) {
      bitmap = await createImageBitmap(source);
    } else {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
      const blob = await response.blob();
      bitmap = await createImageBitmap(blob);
    }
  } catch (err) {
    throw new Error(`Failed to load image overlay: ${err instanceof Error ? err.message : String(err)}`);
  }

  c.save();
  c.globalAlpha = overlay.opacity;

  const cx = (overlay.position.x / 100) * width;
  const cy = (overlay.position.y / 100) * height;
  const w = (overlay.size.w / 100) * width;
  const h = (overlay.size.h / 100) * height;

  c.translate(cx, cy);
  if (overlay.rotation !== 0) {
    c.rotate((overlay.rotation * Math.PI) / 180);
  }
  c.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  c.restore();
}
