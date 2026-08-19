# Cutfish 🐟

**Private, browser-based video editor powered by FFmpeg WebAssembly.**

All processing happens locally—your media never leaves your device.

## Features

- **Multi-file import** with drag-and-drop, duplicate detection, and progress tracking
- **Per-clip trim** with 0.01s precision, split, duplicate, reorder, and inline rename
- **Per-clip volume/mute** (0–200%) with master volume control; preview reflects clip×master (capped at 1.0)
- **Per-clip speed** (0.25×–4.0×) with speed-aware timeline, duration, and export range mapping
- **Per-clip rotation** (0/90/180/270°) and horizontal/vertical flip
- **Canvas aspect ratio** (16:9, 9:16, 4:3, 1:1, auto) with contain/cover/stretch fit modes; preview mirrors the selected aspect and fit
- **Inter-clip transitions** (fade, dissolve, wipe, slide variants) with configurable duration; mixed transition/non-transition chains produce valid FFmpeg graphs
- **Text overlays** with font family, size, color, position, timing—live preview and FFmpeg export with bundled DejaVu Sans, Serif, and Sans Mono fonts (written to MEMFS)
- **Background audio** import with volume, loop, fade-in, fade-out, mixing, and File persistence in IndexedDB (restored with tracked URL on project switch)
- **Global filters** (brightness, contrast, saturation) with real-time CSS preview
- **Audio sync** adjustment (±5000ms) and global fade-in/fade-out
- **Project range export** with speed-aware duration, resolution (480p–1080p), frame rate (24/30/60), and quality presets
- **One-click presets** (Social Reel, YouTube, Quick Share, Cinematic) + custom named preset save/apply/delete (localStorage)
- **Multi-project management** (create, switch, rename, duplicate, delete) with IndexedDB persistence; force-save before switch/new/delete to prevent stale state
- **Legacy migration** from v1 single-draft to v2 multi-project format
- **Timeline** with zoom controls, draggable playhead, auto-follow, speed-aware widths, and collapsible panel; shows editing + output duration when transitions reduce total
- **Inspector** with tabbed UI (Clip, Project, Audio, Effects) and sticky export button; mobile bottom-sheet on small screens
- **Fullscreen preview** (F key or button) with press-and-hold before/after filter comparison
- **Keyboard shortcuts** with `?` help modal, focus trapping, and initial focus on open
- **Localized last-saved timestamp** in save status indicator
- **Undo/redo** (50-level bounded history); clip removal preserves undo by not revoking URLs
- **Dark/light/system theme** with English/Chinese i18n
- **Responsive design** with mobile bottom-sheet inspector and accessible close
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
4. Text overlays: drawtext filters
5. Audio: delay → fade → background music mix (amix)

Canvas cover mode correctly scales up then crops (not pads).

## License

Private project. All rights reserved.
