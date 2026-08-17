# Development Guidelines

## Software Design Document (SDD) & Test-Driven Development (TDD)
Future agents MUST adhere to the following development lifecycle:

1. **SDD First**: Before implementing any complex feature (e.g., video trimming logic, timeline sync, WebAssembly integration), outline the component architecture, state shape, and data flow.
2. **TDD Methodology**: Write unit tests or strictly isolate logic for pure functions (e.g., timecode formatting, FFmpeg command generation, state mutations) before connecting them to the React UI.
3. **Pure Frontend & Wasm**: All heavy video/audio processing MUST leverage WebAssembly (e.g., FFmpeg.wasm). No server-side video processing is allowed to ensure absolute user privacy.
4. **Draft Persistence**: Use `IndexedDB` (via `idb-keyval` or similar) for auto-saving drafts to prevent accidental data loss.
5. **Responsive & Accessible**: All UI components must be fully responsive (mobile-first scaling up to desktop bento grids). Text strings must use the i18n system. Theme context (dark/light) must be respected.
6. **Keyboard Navigation**: Critical actions (Play/Pause, Cut, Undo, Redo, Export) must have keyboard shortcuts.
