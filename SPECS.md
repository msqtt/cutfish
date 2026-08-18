# Cutfish Software Design & Product Specification

## 1. Product boundary

Cutfish is a privacy-first browser video editor. Source files, drafts, and rendered output remain on the user's device. No server-side media processing or account system is permitted.

## 2. Implemented capabilities

- Multi-file import by picker or drag and drop
- Media library with selection, ordering, deletion, and undo/redo
- Per-clip trim ranges and playback bounds
- Global brightness, contrast, saturation, and audio delay
- Multi-clip normalization and concatenation through FFmpeg.wasm
- MP4 and WebM download, progress display, and cancellation
- IndexedDB draft persistence with `File` structured cloning and fresh object URLs on restore
- English/Chinese UI, system/light/dark themes, mobile drawers, keyboard navigation

## 3. Component architecture

```text
app/layout.tsx             metadata, theme provider, global shell
app/page.tsx               client-only editor boundary and loading state
components/Editor.tsx      workflow orchestration and accessible UI
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
  filters: { brightness: number; contrast: number; saturation: number };
}
```

Import creates an object URL and reads duration before committing clips. Draft persistence strips URLs; restoration creates fresh URLs from persisted files. All created URLs are revoked on app teardown. Export lazily loads FFmpeg, writes files to MEMFS, runs a deterministic command, downloads output, and deletes temporary MEMFS files.

## 5. History policy

Discrete actions are pushed immediately. Slider movement uses transient replacement and commits one checkpoint when the interaction ends. History is capped at 50 entries. Selection-only changes do not pollute undo history.

## 6. Export policy

Inputs are trimmed, normalized to 1280×720 / 30 fps / stereo 48 kHz, concatenated, filtered, audio-shifted, and encoded. Positive delay pads audio; negative delay trims its start. MP4 uses H.264/AAC with `faststart`; WebM uses VP9/Opus.

Current constraint: every input must include an audio stream. A future optional-audio design requires reliable stream probing before graph construction and must be specified/tested before implementation.

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
