# Editor interaction unification SDD

## Goal
Replace the editor's scattered panel-first interaction model with one predictable task flow:

`import -> arrange/select -> edit when requested -> preview -> export`

The redesign must make primary commands visible everywhere, keep timeline work uninterrupted on mobile, show only relevant Inspector destinations, and use one control/touch/focus system across desktop and mobile.

## Scope

### 1. Global command bar
`components/Editor.tsx` becomes the single location for global commands.

- Export is always visible in the header and opens the existing export dialog.
- Mobile keeps explicit Media and Inspector buttons.
- Project management, shortcut help, language, and theme move into one overflow menu.
- Undo/redo remain visible keyboard-backed editing commands.
- The Inspector-only sticky export footer is removed so export has one canonical entry point.

### 2. Selection and Inspector navigation
Selection remains UI-only and keeps the existing `EditorSelection` data model.

`resolveInspectorTabs(selection)` is a pure derived-state helper:

- no selection: Project, Effects, Overlays;
- video selection: Clip first, then the global destinations;
- source/background audio selection: Audio first, then the global destinations;
- effect selection: Effects first;
- subtitle/image selection: Overlays first.

Timeline selection updates context but does not automatically open the mobile Inspector. This separates arrangement from editing: users select freely, then explicitly open Inspector when they want controls. Desktop selection still expands a collapsed Inspector.

### 3. Workspace state simplification
Remove `maximizedPanel`. Media and Inspector retain normal/collapsed desktop states and explicit mobile sheets; Timeline retains normal/collapsed plus resize. Fullscreen remains exclusive to Preview.

All three resizers keep pointer and keyboard behavior but receive visible handles and focus/hover states through the shared `.workspace-resizer` style.

### 4. Shared controls and visual scale
Extract `RangeControl` to `components/RangeControl.tsx` and reuse it in Editor and ExportPanel. Form controls use a 36px baseline and primary actions use a 44px mobile target.

Add semantic accent variables in `app/globals.css` for focus, range thumbs, primary actions, and resizers. Track colors remain semantic by material type.

### 5. Timeline interaction
Pure helpers in `lib/workspace-utils.ts` provide:

- `stepTimelineZoom(current, direction)` with one 0.25 step for buttons and Ctrl/Meta+wheel;
- `formatEditorTime(seconds)` for a stable project timecode.

Timeline text has a 12px minimum. Track labels use one exported gutter constant. Touch drag handles grow to 44px, while the rest of a clip remains a seek/select target. Transport shows project time / duration. The 100% control is labelled Reset zoom rather than Fit.

### 6. Canvas selection parity
Legacy text, subtitle, drawing, rectangle, and image overlays all become selectable from Preview in Select mode. Each exposes button semantics, keyboard activation with Enter/Space, a localized accessible name, and the same selected outline.

### 7. Dialog and sheet focus
Export, Help, and Project dialogs restore focus to their triggering command. Mobile Media and Inspector sheets receive dialog semantics, initial focus, focus trapping, Escape/backdrop close, and focus restoration to their header buttons.

## State and data flow

No persisted state changes.

- Removed UI state: `maximizedPanel`.
- Existing UI state: `mobilePanel`, `selection`, `inspectorTab`, collapse flags, widths/heights.
- Derived state: `visibleInspectorTabs = resolveInspectorTabs(selection)`.
- New refs are trigger/panel refs only; they are never persisted.
- Export, media, project, overlay, TTS, and draft data continue through existing functions unchanged.

## Components

- `components/Editor.tsx`: command bar, explicit sheet opening, contextual Inspector tabs, focus restoration, canvas selection.
- `components/Timeline.tsx`: unified zoom helper, readable scale, touch handles.
- `components/ExportPanel.tsx`: consumes shared RangeControl.
- `components/RangeControl.tsx`: one numeric + slider interaction contract.
- `lib/editor-workflow.ts`: pure Inspector tab derivation.
- `lib/workspace-utils.ts`: pure zoom/time formatting.
- `app/globals.css`: semantic tokens, resizer and coarse-pointer rules.
- `lib/i18n.ts`: all new labels in English and Chinese.

## Non-goals

- No IndexedDB/draft schema changes.
- No FFmpeg, export graph, TTS, overlay rendering, media import semantics, or URL lifecycle changes.
- No timeline time-mapping or transition semantics changes.
- No new dependency or server-side processing.
- No drag-to-resize handles for timed-item duration in this iteration.

## Test strategy

Write tests before implementation for:

1. contextual Inspector tab ordering and irrelevant-tab removal;
2. zoom stepping, clamping, and parity between input methods;
3. project timecode formatting and invalid input handling.

Then run focused tests, all Vitest tests, ESLint, TypeScript, production build, and local production HTTP/bundle smoke checks. An independent review must inspect state/focus/keyboard regressions before deployment.

## Acceptance criteria

- Export and Import are reachable without opening Inspector on desktop; Export is visible on mobile.
- Selecting/repositioning timeline items never opens a mobile sheet.
- Inspector shows at most four destinations and puts selected context first.
- No workspace panel maximize state or controls remain.
- All resizers are visible and keyboard operable.
- Button zoom and Ctrl/Meta+wheel use the same tested step.
- Timeline and material metadata use no text below 12px.
- Every visible canvas overlay is mouse/touch/keyboard selectable in Select mode.
- Help/Project/Export and mobile sheets trap focus and restore it on close.
- Existing persistence and export tests remain green.
