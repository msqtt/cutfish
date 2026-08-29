# Material-driven editing workflow SDD

## Goal
Make the common path `import material -> arrange timeline -> select material -> edit in Inspector -> preview -> cut/export` reliable without replacing the existing IndexedDB draft or FFmpeg export model.

## Scope and compatibility
This iteration keeps the persisted `Clip[]` and single background-audio source with multiple `AudioTrackSegment`s. It does not introduce a multi-source asset migration or transition-overlap time remapping. These are higher-risk model changes and remain follow-up work. All media stays local in the browser.

The UI treats imported video, the current external-audio source, and imported image overlays as materials. A unified import entry classifies video/audio/image. Video becomes a V1 clip immediately, audio becomes the current external-audio source plus an A2 segment, and image becomes an I1 overlay at the playhead. The A2 material card can add/drag another instance of its source.

## Component architecture

### Pure workflow module (`lib/editor-workflow.ts`)
- `EditorSelection`: UI-only discriminated union for video, linked source audio, background audio, subtitle, image, and effect.
- `inspectorTabForSelection`: deterministic selection-to-Inspector routing.
- `splitClipWithTransition`: splits a clip and migrates its outgoing `afterClipId` transition to the right half.
- `reorderTargetFromCenters`: maps pointer X to an explicit insertion/reorder index.
- `backgroundAudioGainAtTime`: computes segment volume including fade envelopes for preview.

### `components/Timeline.tsx`
- V1 and linked A1 use Pointer Events rather than HTML5 drag/drop. A movement threshold preserves click-to-seek; pointer cancel terminates safely; Alt+Arrow provides keyboard reorder.
- Selecting V1 and A1 are separate contextual selections while both reorder the same clip pair.
- A2 accepts the internal audio-material drag payload and converts pointer X to project time.
- A3 is a dynamic TTS row derived from enabled, non-empty subtitle cues.
- The timeline toolbar exposes Cut at the current project playhead.

### `components/Editor.tsx`
- Owns the single UI-only `selection`; existing edit IDs remain compatibility details and are synchronized through selection handlers.
- Unified media import classifies files and dispatches to existing video/audio/image import paths.
- The Audio Inspector no longer owns audio import. A2 source actions live in Media Assets.
- Contextual Cut splits selected A2; otherwise it splits selected/current V1+A1 and keeps an outgoing transition on the new right half.
- A lightweight background `<audio>` preview follows the project clock, applies trim, segment gain/fades, playback speed, and replacement-mode muting of A1.
- Timeline TTS auto-preview uses the same cached local Piper WAV as manual/export-consistent preview through a persistent Web Audio context unlocked by the Play gesture.

## State and selection
`selection` is not persisted. It is validated against project state after delete/undo/project switch. Selecting an item clears incompatible legacy selection IDs and opens the corresponding Inspector tab:

- video -> Clip
- source audio or A2 segment -> Audio
- subtitle or TTS -> Subtitles
- image -> Subtitles/Overlays
- effect -> Effects
- null -> Project/default global context

V1 and A1 are one persisted clip. Muting/removing A1 sets `clip.muted`; restoring clears it. Reordering either row moves the linked pair.

## Timeline and cut data flow
1. Timeline emits a selection and project playhead.
2. Context Cut resolves the selected material.
3. A2 uses `splitAudioSegment` at project time.
4. V1/A1 maps project playhead to the active clip source time (already maintained by Editor), calls `splitClipAt`, and migrates any outgoing transition from the old ID to the generated right ID.
5. The right half becomes active/selected; project duration is unchanged.

## Audio preview data flow
At each project-clock update, the preview scheduler finds the first A2 segment containing project time and computes:
`sourceTime = trimStart + projectTime - projectStart` and `gain = segmentVolume * fadeIn * fadeOut * masterVolume`.
The audio element is drift-corrected, follows global preview speed, and pauses outside a segment. If A2 replacement mode is enabled, the video element is muted during preview. Overlapping A2 segments remain exportable; this MVP previews the first active segment because the current model has one source and one HTML audio element.

## TTS data flow
Enabled non-empty cues derive A3 blocks. Enabling a cue starts local model/WAV pre-generation. During playback, entering a cue requests its cached/generated Piper WAV; a request token prevents stale async playback after seek/pause/project switch. Leaving the cue stops auto TTS. Manual Piper preview and export use the same voice/rate/volume configuration.

## Accessibility and responsive behavior
Pointer interactions have keyboard fallbacks. A1 exposes mute/restore controls in contextual Inspector. Media audio has an explicit Add button in addition to drag/drop. All user-visible strings use i18n, and dynamic optional tracks remain hidden unless corresponding material exists.

## Test strategy
Pure tests cover selection routing, transition-safe split, pointer reorder target, audio fade gain, and dynamic A3 visibility. Existing editor/audio/TTS/FFmpeg suites remain regression coverage. Validation requires targeted tests, full Vitest, typecheck, ESLint, production build, and local production smoke checks before commit/deploy.
