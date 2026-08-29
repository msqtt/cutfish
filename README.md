# Cutfish 🐟

**Private, browser-based video editor powered by FFmpeg WebAssembly.**

All processing happens locally—your media never leaves your device.

## Features

- **Unified media import** for video, audio, and images with drag-and-drop, video duplicate detection, and progress tracking
- **Per-clip trim** with 0.01s precision, split, duplicate, reorder, and inline rename
- **Per-clip volume/mute** (0–200%) with master volume control; preview reflects clip×master (capped at 1.0)
- **Per-clip speed** (0.25×–4.0×) with speed-aware timeline, duration, and export range mapping
- **Per-clip rotation** (0/90/180/270°) and horizontal/vertical flip
- **Canvas aspect ratio** (16:9, 9:16, 4:3, 1:1, auto) with contain/cover/stretch fit modes; preview mirrors the selected aspect and fit
- **Inter-clip transitions** (fade, dissolve, wipe, slide variants) with configurable duration; mixed transition/non-transition chains produce valid FFmpeg graphs
- **Text overlays** with font family, size, color, position, timing—live preview and FFmpeg export with bundled DejaVu Sans, Serif, and Sans Mono fonts (written to MEMFS)
- **Subtitles** with multiline textarea (real line breaks + auto word/char wrap by cue.width), position x/y, width, font family/size/line-height, color/transparent background (with clear button), alignment, rotation, start/end (clamped, end>start), and delete; exported as pre-rendered transparent PNGs via OffscreenCanvas (loads DejaVu fonts, fail-fast), composited by FFmpeg overlay filter with `shortest=1`/`eof_action=pass`; inserted at current project frame time
- **Audible timeline TTS narration** — enabling TTS on a non-empty subtitle creates a dynamic A3 narration block and pre-generates the local Piper WAV; playback entering the cue uses the same cached/generated voice as export through an unlocked Web Audio engine, with cancellation tokens preventing stale playback after seek, pause, project switch, or unload
- **Exportable local TTS** — per-subtitle export voice selection from curated Piper VITS voices (Chinese/English, 20–65 MB models), include-in-export toggle (default on), rate/volume controls; validated models download through a same-origin mirror proxy with configured/official fallbacks, corrupted OPFS entries are repaired automatically, and all inference runs locally; preview plays the exact generated WAV (export-consistent); generated speech is burned into the final audio track via FFmpeg amix at cue project time; subtitle text and media are never uploaded
- **Visual overlays** (drawing, rectangle, image): pen tool draws freehand on preview with real-time draft line; rectangle tool drag-draws with live dashed preview; image import inserts at current frame time; all support x/y, width/height, rotation, opacity, time range (clamped, end>start), stroke/fill/lineWidth (where applicable), and delete; drawing uses `rebaseDrawingPoints` for consistent preview/export local coordinates; `touch-action:none` in draw mode; `pointercancel`/`lostpointercapture` handled to prevent stuck state
- **Transparent PNG renderer** for export: drawing/rectangle/image overlays AND subtitles rendered to full-resolution PNGs via `selectAndShiftOverlaysForExport`, written to MEMFS, passed to `buildFFmpegCommandExtended` overlay chain with `shortest=1:eof_action=pass`; export range filters to intersecting items only; font/image load failures are fail-fast; temp files cleaned after export
- **Image overlay persistence**: `File` stored in IndexedDB via structured clone; `url` is runtime-only (recreated from File on load); deletion does not revoke URL (preserves undo); project switch/teardown revokes all tracked URLs
- **Editable background audio track (A2)** — import audio through Media Assets, then add it at the playhead or drag it onto A2 at a specific project time. Segments have independent project start, source trim, volume, and fades, and are audible during timeline preview; replacement mode also mutes video source audio in preview. Importing a new source requires confirmation. Legacy drafts migrate automatically and files persist in IndexedDB
- **Global filters** (brightness, contrast, saturation) with real-time CSS preview
- **Audio sync** adjustment (±5000ms) and global fade-in/fade-out
- **Project range export** with speed-aware duration, resolution (480p–1080p), frame rate (24/30/60), and quality presets
- **One-click presets** (Social Reel, YouTube, Quick Share, Cinematic) + custom named preset save/apply/delete (localStorage)
- **Multi-project management** (create, switch, rename, duplicate, delete) with IndexedDB persistence; force-save before switch/new/delete to prevent stale state
- **Legacy migration** from v1 single-draft to v2 multi-project format
- **Content-driven multitrack timeline** — V1 video and A1 source audio are a linked pair: dragging either row with Pointer Events reorders both, with visible handles and Alt+Arrow fallback. A2 background audio, A3 local TTS narration, S1 subtitles, I1 images, and FX effects appear only when material exists. Selection drives contextual Inspector settings, and Cut/Delete act on the selected material at the playhead
- **Contextual Inspector** — selecting V1, A1, A2, A3/S1, I1, or FX opens the relevant clip, source-audio, segment, subtitle/TTS, overlay, or effect settings; project/global controls remain explicit tabs, and mobile selection opens the bottom sheet
- **Fullscreen preview** (F key or button) with press-and-hold before/after filter comparison
- **Keyboard shortcuts** with `?` help modal, focus trapping, and initial focus on open
- **Localized last-saved timestamp** in save status indicator
- **Undo/redo** (50-level bounded history); clip removal preserves undo by not revoking URLs
- **Dark/light/system theme** with English/Chinese i18n
- **Responsive design** with mobile bottom-sheet inspector and accessible close
- **Unified UI system** with a minimum 12px compact type scale, 14px primary actions/headings, consistent 36px form controls and icon targets, full focus-visible coverage, larger mobile touch targets, and 16px mobile inputs to prevent browser zoom
- **Improved editor interaction** with ARIA tab semantics and arrow-key navigation, horizontally scrollable inspector tabs, pressed-state overlay tools, cancellable range edits, a dedicated keyboard/touch playhead handle, and independently pannable mobile timeline
- **Accessible** (ARIA labels, keyboard navigation, focus management, live regions, disclosure menus for clip operations, no nested interactive elements)
- **Zero dependencies** on external servers—fully offline after initial load

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Run unit tests (Vitest) |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript check |

## Tech Stack

- **Framework**: Next.js 16 (App Router, static export)
- **Video engine**: FFmpeg.wasm 0.12 (lazy-loaded on export)
- **State**: React hooks + pure bounded history
- **Persistence**: IndexedDB via idb-keyval (File structured cloning)
- **Styling**: Tailwind CSS 4
- **i18n**: i18next + react-i18next (EN/ZH)
- **Icons**: Lucide React
- **Deploy**: Netlify (static + edge)

## Architecture

```
components/Editor.tsx      – Main orchestrator with tabbed inspector, project manager, all modals
components/ExportPanel.tsx – Export range/quality/size modal content
components/Timeline.tsx    – Zoomable timeline with draggable playhead and auto-follow
lib/editor-utils.ts        – Pure clip operations and speed-aware time mapping
lib/ffmpeg-utils.ts        – FFmpeg command builders (basic + extended with all features)
lib/transition-utils.ts    – Xfade/acrossfade filter chains
lib/text-overlay-utils.ts  – Drawtext + PNG overlay builders
lib/visual-overlay-utils.ts – SubtitleCue/VisualOverlay types, factories, selectAndShiftOverlaysForExport, rebaseDrawingPoints, time/drawing/FFmpeg utils
lib/overlay-renderer.ts    – Browser-side transparent PNG renderer (OffscreenCanvas) for subtitles + visual overlays
lib/tts-utils.ts           – Curated Piper voice list, TTS config normalization, cache keys, export cue selection
lib/local-tts.ts           – Browser-only VITS synthesis wrapper (dynamic import, OPFS model cache)
lib/preset-utils.ts        – Preset definitions and applicator
lib/draft-store.ts         – Multi-project IndexedDB CRUD with migration
lib/history.ts             – Bounded undo/redo
lib/i18n.ts                – EN/ZH translation resources
```

## Export Pipeline

Export uses `buildFFmpegCommandExtended` which processes:
1. Per-clip: trim → speed → rotation/flip → scale/fit → volume
2. Transitions: xfade/acrossfade between clips (or simple concat)
3. Global: brightness/contrast/saturation EQ
4. Text overlays: drawtext filters (for legacy TextOverlay objects)
5. Visual overlays + Subtitles: pre-rendered to full-resolution transparent PNGs via OffscreenCanvas overlay-renderer → `overlay=0:0:shortest=1:eof_action=pass:enable='between(t,...)'`
6. TTS: enabled cues synthesized to WAV via local Piper VITS (models cached in OPFS), written to MEMFS, mixed with atrim→atempo→volume→adelay→amix
7. Audio: source delay/fade → background music mix, or source discard + duration-padded background replacement → optional subtitle TTS mix

Subtitles are rendered as transparent PNGs (not via drawtext) supporting manual line breaks, auto word/char wrapping, fontFamily, fontSize, lineHeight, color, transparent background, alignment, rotation, and position. Visual overlays (drawing/rectangle/image) are also rendered to PNGs. All overlay PNG inputs use `shortest=1:eof_action=pass` to properly terminate when the main video stream ends. Background music input index accounts for both clip count and optional bgMusic, preserving correct final `-map` references.

TTS audio is generated locally using Piper ONNX via `@diffusionstudio/vits-web`. Voice models (20–65 MB) are fetched through a validated same-origin mirror with fallbacks and cached in the browser Origin Private File System; corrupt entries are repaired automatically. All inference runs entirely in the browser. Subtitle text and media are never uploaded.

## License

Private project. All rights reserved.
