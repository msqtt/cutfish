# Cutfish

[中文](README.zh-CN.md) · [Live site](https://cutfish.msqt.fun)

Cutfish is a private, browser-based video editor powered by FFmpeg WebAssembly. Trim and reorder clips, merge multiple videos, adjust color, synchronize audio, and export MP4 or WebM without uploading media to a server.

## Highlights

- **Private by design** — editing and rendering happen locally in the browser.
- **Multi-clip workflow** — guarded multi-file import with progress and duplicate detection; split, duplicate, drag-reorder, remove, continuously preview, and export clips.
- **Interactive timeline** — trimmed-duration blocks, a live playhead, click-to-seek across clips, and accessible ordering fallbacks.
- **Flexible export** — use a dedicated responsive dialog to select any project timeline range, then choose 480p/720p/1080p, 24/30/60 fps, and compact/balanced/high quality with an estimated output size.
- **Audio-compatible merging** — mix videos with or without audio; silent tracks are synthesized locally when needed.
- **Precise editing** — 0.01-second trim controls, numeric inputs, filter reset, configurable audio sync and global fade-in/fade-out, plus coarse and fine seeking.
- **Local drafts** — source `File` objects and editor state are restored from IndexedDB; continuous edits defer writes until the interaction ends.
- **Fast startup** — the FFmpeg engine is loaded only when an export is requested.
- **Accessible and responsive** — keyboard shortcuts, focus states, reduced-motion support, mobile panels, dark/light themes, and English/Chinese UI.
- **Safe history** — undo/redo is capped and continuous slider edits create a single history entry.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Play / pause | `Space` |
| Seek | `←` / `→` (5 seconds) |
| Fine seek | `Shift + ←` / `Shift + →` (1 second) |
| Split at playhead | `S` |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |
| Export MP4 | `Ctrl/Cmd + E` |
| Delete selected clip | `Delete` |

## Requirements

- Node.js 20.9 or newer (Node.js 22 is used on Netlify)
- A current Chromium, Firefox, or Safari browser

The first export downloads the FFmpeg core (roughly 30 MB) from unpkg by default. Set `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` to a directory containing the matching `ffmpeg-core.js` and `ffmpeg-core.wasm` files if you prefer to self-host it.

## Development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No account, database, server-side media processor, or API key is required.

Quality checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Architecture

- **Next.js App Router + React** for the application shell and responsive UI
- **FFmpeg.wasm** for client-side trim, normalize, concatenate, filter, audio sync, and encode
- **IndexedDB (`idb-keyval`)** for debounced local draft persistence
- **Pure command/history modules** under `lib/`, covered by Vitest
- **COOP/COEP headers** in both Next.js and Netlify configuration for WebAssembly isolation

Media never leaves the device. The only runtime network request after loading the app is the FFmpeg core download unless you self-host it.

## Deployment

`netlify.toml` configures automatic Next.js builds and the required isolation/security headers. Connect the GitHub repository in Netlify and deploy the `main` branch; pushes then trigger production builds automatically.

Production: <https://cutfish.msqt.fun>

## Known limitations

Very large projects remain constrained by browser memory because FFmpeg.wasm processes media locally. Export speed and codec compatibility depend on the browser, device, and FFmpeg.wasm build; the size estimate is advisory rather than an exact target.
