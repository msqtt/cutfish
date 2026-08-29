# Editor workspace upgrade SDD

## Goal

Expose video, audio, subtitle, image, and effect elements on one project-time timeline; make the desktop media/inspector panels and timeline resizable, collapsible, and maximizable; make preview fullscreen target only the visual canvas.

## Component architecture

- `Editor` owns persisted edit data and ephemeral workspace layout state. Layout state is intentionally not added to `DraftState`.
- `Timeline` always renders V1 plus an aligned A1 source-audio row when clips exist. A2 background audio, subtitle, image, and effect rows are created only while they contain project elements. Video remains reorderable; background audio and timed overlay items can be selected and moved while preserving duration.
- `workspace-utils` contains browser-independent clamping/resizing, timed-range movement, and the content-driven visible-track resolver. React pointer handlers only translate pointer deltas and call these functions.
- The preview canvas element, not the center workspace section, owns `previewCanvasRef` and receives `requestFullscreen()`. `fullscreenchange` derives UI state from that exact element.

## State shape

Ephemeral `Editor` state:

```ts
type WorkspacePanel = 'media' | 'inspector' | 'timeline';
leftPanelWidth: number;
rightPanelWidth: number;
timelineHeight: number;
leftPanelCollapsed: boolean;
rightPanelCollapsed: boolean;
maximizedPanel: WorkspacePanel | null;
```

Timeline timed items use `{ id, name, startTime, endTime, movable? }`. Selection/move callbacks include a track discriminator so `Editor` can update subtitles, image overlays, text overlays, or visual effects without duplicating drag mechanics.

## Data flow

1. `Editor` maps clips, audio segments, subtitles, image overlays, and effects to timeline props.
2. `Timeline` maps project seconds through the same speed-aware video layout used by V1.
3. A timed-item drag calculates a target project start and emits it. `Editor` preserves item duration, clamps to the project, records one undo checkpoint per gesture, updates selection, and opens the relevant inspector tab.
4. Panel separators emit pointer deltas; pure utilities clamp dimensions. Keyboard arrows resize by 16 px (Shift: 48 px).
5. Collapse retains the previous expanded size. Maximize overlays the chosen panel across the viewport; restore returns to the prior layout.

## Accessibility and responsive behavior

- Separators use `role="separator"`, orientation/value ARIA attributes, focus, and arrow-key resizing.
- Panel controls have localized labels and pressed state where applicable.
- Desktop resize/maximize controls appear at `lg`; existing mobile drawers remain unchanged.
- Track blocks are buttons with selection state, descriptive labels, arrow-key nudging, and a shared hidden help description.

## Verification

- Unit-test clamping, directional resizing, and duration-preserving timed moves before UI integration.
- Run Vitest, TypeScript, ESLint, and production build after integration.
