# Cutfish Software Design & Product Specification

## 1. Product boundary

Cutfish is a privacy-first browser video editor. Source files, drafts, and rendered output remain on the user's device. No server-side media processing or account system is permitted.

## 2. Implemented capabilities

- Multi-file import by picker or drag and drop
- Media library with selection, ordering, deletion, and undo/redo
- Per-clip trim ranges and playback bounds
- Global brightness, contrast, saturation, audio delay, and configurable fade-in/fade-out
- Multi-clip normalization and concatenation through FFmpeg.wasm
- MP4 and WebM download with project-range selection, quality profiles, size estimates, progress, and cancellation
- Audio-stream probing with duration-matched silence synthesis for video-only inputs
- Sequential import and MEMFS preparation, with lightweight static media cards
- IndexedDB draft persistence with `File` structured cloning and fresh object URLs on restore
- English/Chinese UI, system/light/dark themes, mobile drawers, keyboard navigation
- Continuous playback across the ordered trimmed clips

## 3. Component architecture

```text
app/layout.tsx             metadata, theme provider, global shell
app/page.tsx               client-only editor boundary and loading state
components/Editor.tsx      workflow orchestration and accessible UI
components/ExportPanel.tsx project range, profile controls, and size estimate
lib/history.ts             pure bounded history transitions + React adapter
lib/ffmpeg-utils.ts        pure validated FFmpeg argument generation
lib/i18n.ts                English and Chinese resources
IndexedDB                  debounced draft state and source File objects
FFmpeg.wasm MEMFS          temporary inputs and rendered output
```

## 4. State and data flow

```ts
interface Clip {
  id: string;
  url: string;       // session-only object URL; never persisted
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file: File;        // structured-cloned into IndexedDB
}

interface EditorState {
  clips: Clip[];
  activeClipId: string | null;
  audioDelay: number;
  audioFade: {
    fadeIn: number;  // seconds, global export effect
    fadeOut: number; // seconds, global export effect
  };
  filters: { brightness: number; contrast: number; saturation: number };
  exportSettings: {
    resolution: '480p' | '720p' | '1080p';
    frameRate: 24 | 30 | 60;
    quality: 'compact' | 'balanced' | 'high';
    rangeStart: number;
    rangeEnd: number | null; // null tracks the current full project length
  };
}
```

Import creates one object URL and reads one duration at a time before committing clips, then requests persistent browser storage when available. Draft persistence strips URLs; restoration creates fresh URLs from persisted files and merges export defaults for older drafts. All created URLs are revoked on app teardown. Export lazily loads FFmpeg, maps the project range to source trims, sequentially writes only selected files, probes their audio streams, runs a deterministic profile-aware command, downloads output, and deletes temporary MEMFS files.

## 5. History policy

Discrete actions are pushed immediately. Slider movement uses transient replacement and commits one checkpoint when the interaction ends. History is capped at 50 entries. Selection-only changes do not pollute undo history.

## 6. Export policy

### 6.1 Project range

Each clip keeps its own source trim range. The ordered trimmed clips form a project timeline starting at zero. Export settings add a second, project-level `[rangeStart, rangeEnd]` interval. Before files enter FFmpeg, a pure range-selection function intersects that interval with clip timeline spans, drops clips outside the interval, and translates boundary intersections back to source timestamps. This limits work and memory to media that contributes to the output.

### 6.2 Quality and size controls

Users can choose:

- Resolution: 480p, 720p, or 1080p (16:9 normalization)
- Frame rate: 24, 30, or 60 fps
- Quality preset: compact, balanced, or high

A pure profile resolver maps resolution and quality to explicit video/audio bitrates. The UI shows an approximate output size computed from selected duration and aggregate bitrate. This estimate is advisory because codec content complexity and container overhead vary.

### 6.3 Audio compatibility and sync

Inputs are probed after being written to FFmpeg MEMFS. Clips without an audio stream receive a duration-matched stereo silent source before concatenation. Positive audio delay pads the beginning. Negative delay trims the beginning and pads the end back to the selected video duration, preventing `-shortest` from truncating the picture.

Users can independently configure global audio fade-in and fade-out durations in seconds. Fades are applied after concatenation and audio-delay correction, against the final selected export duration: fade-in starts at zero and fade-out ends at the selected output boundary. Each duration is clamped to the output duration; zero disables that fade. Fade-in and fade-out may overlap intentionally on very short selections, while negative and non-finite values are rejected by the pure command builder. Slider edits follow the bounded-history checkpoint policy and older drafts restore zero-duration defaults.

Inputs are loaded, probed, and written sequentially to reduce transient browser memory. Only files intersecting the project export range are written. MP4 uses H.264/AAC with `faststart`; WebM uses VP9/Opus.

## 7. Performance and security

- FFmpeg core is lazy-loaded only on export.
- Draft writes are debounced by 500 ms.
- COOP/COEP and baseline security headers are applied by Next.js and Netlify.
- No analytics, trackers, media uploads, or API keys.
- Browser memory is the project-size ceiling.

## 8. Accessibility and responsive behavior

All icon buttons have accessible names, controls are keyboard reachable, focus is visible, reduced-motion is honored, and status changes use live regions. On screens below the desktop breakpoint, media and inspector panels become dismissible drawers while preview and timeline remain usable.

## 9. Verification

Pure history transitions and FFmpeg argument generation require unit tests. Every release must pass:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
