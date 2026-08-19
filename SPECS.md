# Cutfish Software Design & Product Specification

## 1. Product boundary

Cutfish is a privacy-first browser video editor. Source files, drafts, and rendered output remain on the user's device. No server-side media processing or account system is permitted.

## 2. Implemented capabilities

- Multi-file import by picker or drag and drop
- Media library with selection, button/drag ordering, deletion, duplication, splitting, and undo/redo
- Per-clip trim ranges with 0.01-second numeric precision and playback bounds
- Trimmed-duration timeline with a project playhead, click-to-seek mapping, draggable playhead, zoom controls (Ctrl+wheel), and collapsible panel
- Auto-follow scrolling: timeline auto-scrolls to keep playhead visible during playback
- Guarded sequential import with duplicate detection and per-file progress
- Global brightness, contrast, saturation, audio delay, and configurable fade-in/fade-out
- Multi-clip normalization and concatenation through FFmpeg.wasm
- MP4 and WebM download with project-range selection, quality profiles, size estimates, progress, and cancellation
- Audio-stream probing with duration-matched silence synthesis for video-only inputs
- Sequential import and MEMFS preparation, with lightweight static media cards
- Multi-project IndexedDB persistence (create, switch, rename, duplicate, delete) with v1→v2 migration, `File` structured cloning, fresh object URLs on restore, and URL safety (revoke on project switch and teardown)
- English/Chinese UI (full i18n coverage), system/light/dark themes, mobile drawers, keyboard navigation
- Continuous playback across the ordered trimmed clips
- Per-clip volume (0–200%) and mute toggle with master volume control
- Per-clip playback speed (0.25–4.0×) with speed-aware timeline mapping and FFmpeg atempo chains
- Per-clip rotation (0/90/180/270°), horizontal/vertical flip with CSS preview and FFmpeg transpose/hflip/vflip at export
- Canvas aspect ratio (16:9, 9:16, 4:3, 1:1, auto) and fit mode (contain, cover, stretch)
  - Cover mode scales up (force_original_aspect_ratio=increase) then crops to canvas
  - Contain mode scales down then pads
  - Stretch forces exact dimensions
  - Preview reflects canvas aspect ratio and object-fit mode in real-time (H5)
- Inter-clip transitions (fade, dissolve, wipe variants, slide variants) via FFmpeg xfade/acrossfade
  - Mixed transition/non-transition graph produces valid FFmpeg filter chain (M7)
- Timed text overlays rendered at export via drawtext filter with bundled DejaVu-licensed DejaVu Sans font (B3); live preview in browser via positioned spans
- Background audio mixing with import, volume, loop, fade-in, fade-out, File persistence in IndexedDB, and URL recreation on restore (B2)
- One-click project presets (Social Reel, YouTube, Quick Share, Cinematic)
- Custom named preset save/apply/delete with localStorage persistence (M5)
- Inline clip rename (displayName) with accessible edit flow; input moved outside button to avoid invalid HTML nesting (M6)
- Inspector panel with tabbed UI (Clip, Project, Audio, Effects) and sticky export button
- Preview playbackRate uses per-clip speed × global multiplier (H1)
- Preview volume reflects clip volume × master volume (capped at HTML max 1.0) and clip mute (H4)
- Speed-aware project duration, timeline display, ExportPanel range max, and selectClipsForExport (H1)
- Transition-adjusted output duration displayed alongside editing duration when applicable (M1)
- Live save status indicator with localized last-saved timestamp (M3)
- Force-save before new/switch/delete project operations; immediate flush after continuous edits (H2/H3)
- Clip removal does not revoke object URL, preserving undo capability (B1)
- '?' shortcut help modal with full keyboard shortcuts reference, focus trap, and initial focus (M2)
- Project manager modal with focus trap and initial focus (M2)
- Fullscreen preview (F key or button) using Fullscreen API
- Press-and-hold before/after filter comparison (hold button to view original)
- Mobile inspector as bottom-sheet overlay from bottom of screen (M4), desktop unchanged
- Per-clip accessible disclosure/menu for operations (M8)
- Transition editor between clips with type/duration selection
- Text overlay CRUD with font family, size, color, position, timing, and live preview; export uses real bundled DejaVu Sans/Serif/Sans Mono assets and shifts overlays into partial-export-relative time
- Background audio import/volume/loop/fades/mix with File persistence and object URL management
- Project presets UI with apply and visual selection
- Export wired to `buildFFmpegCommandExtended` with all features: per-clip volume/mute, master volume, rotation, flips, speed, transitions, text overlays, background audio mixing
- Bundled DejaVu Sans font (permissively licensed) under `public/fonts/` written to FFmpeg MEMFS before drawtext filter execution (B3)

## 3. Component architecture

```text
app/layout.tsx             metadata, theme provider, global shell
app/page.tsx               client-only editor boundary and loading state
components/Editor.tsx      workflow orchestration, tabbed inspector, project manager, modals, all UI
components/ExportPanel.tsx modal content for project range, profile controls, and size estimate
components/Timeline.tsx    trimmed timeline, playhead, seek, drag ordering, zoom, auto-follow, collapse
lib/editor-utils.ts        pure split, duplicate, reorder, speed-aware project-time mapping, rotation CSS, canvas dimensions, atempo chains
lib/history.ts             pure bounded history transitions + React adapter
lib/ffmpeg-utils.ts        pure validated FFmpeg argument generation (basic + extended with volume, speed, rotation, transitions, text, bgmusic, cover crop fix)
lib/transition-utils.ts    pure xfade/acrossfade filter chain builder
lib/text-overlay-utils.ts  drawtext filter builder + PNG overlay fallback strategy
lib/preset-utils.ts        preset definitions and applicator
lib/draft-store.ts         multi-project IndexedDB CRUD with v1→v2 migration, clip defaults, state defaults
lib/i18n.ts                English and Chinese resources (complete coverage of all UI strings)
IndexedDB                  multi-project draft state and source File objects
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
  volume: number;       // 0–200, default 100
  muted: boolean;       // default false
  rotation: 0 | 90 | 180 | 270;  // degrees CW, default 0
  flipH: boolean;       // default false
  flipV: boolean;       // default false
  speed: number;        // 0.25–4.0, default 1.0
  displayName: string;  // editable alias, defaults to file.name
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
  masterVolume: number;         // 0–200, default 100
  canvasAspect: '16:9' | '9:16' | '4:3' | '1:1' | 'auto';  // default '16:9'
  canvasFit: 'contain' | 'cover' | 'stretch';                // default 'contain'
  playbackSpeed: number;        // preview speed 0.25–4.0, default 1.0
  transitions: TransitionConfig[];
  textOverlays: TextOverlay[];
  backgroundMusic: BgMusic | null;
  presetName: string | null;    // applied preset identifier
}

interface TransitionConfig {
  id: string;
  afterClipId: string;
  type: 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideright' | 'slideleft';
  duration: number;             // 0.2–3.0 seconds
}

interface TextOverlay {
  id: string;
  text: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  fontSize: number;             // 12–200
  color: string;                // hex
  position: { x: number; y: number };  // 0–100 percent
  startTime: number;
  endTime: number;
}

interface BgMusic {
  file?: File;
  url?: string;
  name: string;
  volume: number;               // 0–200
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
}

interface DraftProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  state: DraftState;            // EditorState minus URLs + File fields intact
}
```

Import creates one object URL and reads one duration at a time before committing clips, then requests persistent browser storage when available. Concurrent import requests are blocked, duplicate source files are skipped by stable file metadata, and UI progress reports the current file. Draft persistence strips URLs; restoration creates fresh URLs from persisted files and merges export defaults for older drafts. All created URLs are revoked on app teardown or project switch. Export lazily loads FFmpeg, maps the project range to source trims, sequentially writes only selected files plus background audio, probes their audio streams, runs the extended deterministic profile-aware command (with correct input indices for video sources and bg audio), downloads output, and deletes temporary MEMFS files.

### 4.1 Editing and timeline semantics

Split, duplicate, reorder, project-time lookup, speed-aware duration/position mapping, and source-to-project-time mapping live in a pure tested module. Splitting at the active source playhead replaces one clip with two adjacent clips that share the same source `File` and URL but have non-overlapping trim ranges; boundary splits are no-ops. Duplication inserts an independently editable clip immediately after its source. Every discrete operation is one undoable state transition.

Timeline widths represent each clip's trimmed duration rather than raw source duration. The timeline supports zoom (0.3× to 5×) via buttons or Ctrl+wheel. A draggable playhead allows seeking by pointer drag across the full timeline. Auto-follow scrolling keeps the playhead visible during playback. The timeline can be collapsed to a compact summary.

Clicking within a clip maps the horizontal ratio to its source trim interval, activates that clip, and seeks after metadata is ready. The active clip renders a playhead at the same normalized position. Native drag and drop reorders clips as one history action, while earlier/later buttons remain available for keyboard and touch users.

### 4.2 Precision, import, and persistence

Range controls expose both a slider and bounded numeric input. Trim uses 0.01-second steps and audio synchronization uses 10-millisecond steps. Import remains sequential to avoid opening many media decoders at once, but reports per-file progress, blocks overlapping imports, skips duplicate file identities, and summarizes skipped/failed items. Draft writes are delayed while a continuous slider edit is active and committed once the interaction ends. Draft restoration is announced to the user.

### 4.3 Multi-project management

Projects are stored in IndexedDB under a v2 schema (array of `DraftProject`). The manager modal allows:
- **New project**: creates with user-provided or default name, switches to empty state
- **Switch**: loads project state, revokes previous URLs, creates fresh URLs
- **Rename**: updates project name in place
- **Duplicate**: deep copies state under a new name
- **Delete**: with confirmation dialog; switches to next available or resets to empty

Legacy v1 single-draft data is automatically migrated on first load. File fields are preserved through IndexedDB structured cloning. Object URLs are safely revoked on every project switch and on component teardown.

## 5. History policy

Discrete actions are pushed immediately. Slider movement uses transient replacement and commits one checkpoint when the interaction ends. History is capped at 50 entries. Selection-only changes do not pollute undo history.

## 6. Export policy

### 6.1 Project range

Each clip keeps its own source trim range. The ordered trimmed clips form a project timeline starting at zero. Export settings add a second, project-level `[rangeStart, rangeEnd]` interval. Before files enter FFmpeg, a pure range-selection function intersects that interval with clip timeline spans, drops clips outside the interval, and translates boundary intersections back to source timestamps. This limits work and memory to media that contributes to the output.

### 6.2 Extended export pipeline

Export uses `buildFFmpegCommandExtended` which applies:
1. Per-clip volume (×master), mute (volume=0), atempo speed filters, rotation (transpose/hflip/vflip)
2. Canvas scaling: contain (scale+pad), cover (scale+crop), stretch (force scale)
3. Inter-clip transitions via xfade/acrossfade chain or simple concat
4. Global EQ filters (brightness/contrast/saturation)
5. Text overlays via drawtext (with font path mapping)
6. Audio delay and fade processing
7. Background music mixing via amix (with loop, trim, fade, volume)

Input indices are managed correctly: video sources are inputs 0..N-1, background audio (if present) is input N.

### 6.3 Quality and size controls

Users can choose:

- Resolution: 480p, 720p, or 1080p
- Frame rate: 24, 30, or 60 fps
- Quality preset: compact, balanced, or high
- Canvas aspect: 16:9, 9:16, 4:3, 1:1, auto
- Fit mode: contain, cover, stretch

A pure profile resolver maps resolution and quality to explicit video/audio bitrates. The UI shows an approximate output size computed from selected duration and aggregate bitrate. Presets can configure aspect, fit, resolution, frame rate, and quality together.

### 6.4 Audio compatibility and sync

Inputs are probed after being written to FFmpeg MEMFS. Clips without an audio stream receive a duration-matched stereo silent source before concatenation. Positive audio delay pads the beginning. Negative delay trims the beginning and pads the end back to the selected video duration, preventing `-shortest` from truncating the picture.

Users can independently configure global audio fade-in and fade-out durations in seconds. Fades are applied after concatenation and audio-delay correction, against the final selected export duration. Each duration is clamped to the output duration; zero disables that fade. Negative and non-finite values are rejected by the pure command builder.

Background audio (if present) is written as an additional MEMFS file, then mixed via amix after the main audio pipeline. It supports volume scaling, looping (aloop), trim to project duration, and independent fade-in/fade-out.

MP4 uses H.264/AAC with `faststart`; WebM uses VP9/Opus.

## 7. Performance and security

- FFmpeg core is lazy-loaded only on export.
- Draft writes are debounced by 800 ms, suppressed during continuous edits, and forced after the final checkpoint.
- COOP/COEP and baseline security headers are applied by Next.js and Netlify.
- No analytics, trackers, media uploads, or API keys.
- Browser memory is the project-size ceiling.
- Object URLs are tracked and revoked on project switch and component teardown.

## 8. Accessibility and responsive behavior

All icon buttons have accessible names, controls are keyboard reachable, focus is visible, reduced-motion is honored, and status changes use live regions. On screens below the desktop breakpoint, media and inspector panels become dismissible drawers while preview and timeline remain usable.

Inspector uses a tabbed layout (Clip, Project, Audio, Effects) with `aria-current` tab indicators. Export settings are accessible via a sticky button at the bottom of the inspector (always visible regardless of scroll position).

Export configuration is opened from the sticky inspector button into a dedicated responsive modal. The modal has an accessible name and `aria-modal` semantics, receives focus on open, traps `Tab` navigation, closes via its named button, backdrop, or `Escape`, and restores focus to the inspector trigger. Its body scrolls independently on small screens; starting an export closes it before the rendering status dialog appears.

Help modal (`?` key) provides a keyboard shortcuts reference with focus trap. Project manager modal provides multi-project CRUD. Both modals follow the same focus management pattern.

## 9. Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| S | Split clip at playhead |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+E | Quick export (MP4) |
| Delete | Delete active clip |
| ← | Back 5 seconds |
| → | Forward 5 seconds |
| Shift+← | Back 1 second |
| Shift+→ | Forward 1 second |
| F | Toggle fullscreen preview |
| M | Mute/unmute active clip |
| ? | Show shortcuts help |
| Escape | Close active modal/panel |

## 10. Verification

Pure history transitions, editor timeline operations, FFmpeg argument generation, transition chain building, text overlay filter building, preset application, and draft store CRUD require unit tests. Every release must pass:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
