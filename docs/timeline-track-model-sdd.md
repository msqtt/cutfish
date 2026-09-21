# Timeline track model and interaction SDD

## Goal
Make every timeline lane answer three questions without trial and error:

1. What material does this lane represent?
2. Is it independent, linked, derived, or fixed?
3. What will click, drag, keyboard movement, Cut, and Delete affect?

The persisted project model remains unchanged. This iteration changes the timeline view model and interaction contract only.

## Track contract

| Code | User-facing name | Backing data | Relationship | Movement |
|---|---|---|---|---|
| V1 | Video | `Clip[]` | Primary sequence | Reorder linked V1+A1 pair |
| A1 | Source audio | same `Clip[]` | Linked to matching V1 clip | Reorder linked pair; click seeks position |
| A2 | Music & audio | `backgroundMusic.segments[]` | Independent timed segment | Move within project bounds |
| A3 | Voice / TTS | TTS-enabled subtitle cues | Derived from and time-linked to S1 | Moving either A3/S1 moves the shared cue |
| S1 | Captions | `subtitles[]` | Authored cue, optionally linked to A3 | Move within project bounds |
| I1 | Images | image `visualOverlays[]` | Independent overlay | Move within project bounds |
| FX | Visual effects | text/shapes plus filters/transitions | Mixed authored and fixed view items | Authored items move; fixed items select only |

Codes stay stable for editor familiarity. Long labels become concise material names; relationship badges/icons explain linked, derived, and fixed behavior.

## Pure interaction model

Add browser-independent helpers to `lib/workspace-utils.ts`:

- `clipPointerToSourceTime(clientX, left, width, trimStart, trimEnd)` maps V1 and A1 clicks through one contract and clamps malformed geometry.
- `clampProjectItemStart(targetStart, itemDuration, projectDuration)` keeps A2 and timed items inside the editable project. Items longer than the project pin to zero.
- `hasPassedDragThreshold(startX, startY, currentX, currentY, threshold)` prevents click/tap from becoming a drag.
- `timelineSelectionState(selection, candidateTrack, candidateId)` returns `selected`, `linked`, or `none` for V1/A1 and A3/S1 relationships.

## View model

`TimelineTimedItem` gains transient presentation flags only:

- `linked?: boolean` — cue timing is shared with another lane;
- `pinned?: boolean` — view item is fixed to project/clip structure and cannot move.

`selectedTimedItem` gains an optional `linkedTrack`. Selecting A3 or a TTS-enabled S1 cue highlights the selected lane strongly and its counterpart with a linked treatment. `selectedClipItem` similarly distinguishes the exact V1/A1 context from its linked counterpart while `activeClipId` continues to indicate the clip under the playhead.

No flags are persisted or passed to export.

## Interaction behavior

### Click and seek
- V1 and A1 both seek to the clicked position inside the clip.
- Selecting V1 or A1 routes Inspector context as before.
- Clicking fixed FX items selects them but never starts a drag.

### Drag and keyboard
- A2 and movable timed items start continuous editing only after a 6px pointer threshold.
- A click/tap performs selection without creating an empty history checkpoint.
- A2 movement clamps to `max(0, projectDuration - segmentDuration)`.
- Boundary moves return the existing React state object when no value changes.
- Existing Alt+Arrow linked clip reorder, Arrow/Shift+Arrow timed nudging, and playhead keyboard behavior remain.

### Discoverability
The timeline toolbar uses a real “Project timeline” title and a derived visible-track count instead of hard-coded V1/A1 labels. It includes an Add disclosure for:

- Caption
- Text
- Image

These call existing creation/import handlers at the current playhead. On compact layouts, an explicit Add action reveals Inspector after creation. Audio continues to enter through Media Assets because importing/replacing its single source requires confirmation and file selection.

### Visual and accessible relationships
- One `--selection` token provides the strong selected ring across all lanes.
- Linked counterparts receive a secondary linked ring.
- A1 and linked A3/S1 items show a link indicator.
- Fixed FX items show a lock indicator and use fixed-item explanatory text.
- `aria-pressed` reflects selected or linked selection consistently.
- Hidden descriptions explain “linked timing” and “fixed, not movable”.

## Component changes

### `components/Timeline.tsx`
- Use pure click mapping for V1 and A1.
- Add pointer thresholds to A2 and timed-item drag.
- Accept selected clip context and linked timed context.
- Render link/lock indicators and consistent selection rings.
- Keep horizontal geometry and playhead mapping unchanged.

### `components/Editor.tsx`
- Derive linked/pinned transient flags.
- Clamp A2 movement and preserve identity for no-op moves.
- Pass exact selected V1/A1 context and linked A3/S1 context.
- Derive visible track count.
- Replace timeline toolbar hard-coded lane names with title, count, and Add disclosure.

### `lib/workspace-utils.ts`
Own the pure timeline interaction helpers and track-visibility rules.

### `lib/i18n.ts`
Provide concise EN/ZH lane names and relationship/help/add labels.

## State and data flow

1. Persisted project state derives timeline items and availability.
2. `resolveVisibleTimelineTracks` derives visible lanes.
3. Selection derives exact and linked presentation states; it does not modify project state.
4. Pointer movement crosses the pure threshold before `beginContinuousEdit`.
5. Pure clamp resolves a valid project start.
6. Editor returns the current state object for no-op movement; otherwise it updates existing persisted fields exactly as before.
7. Export consumes the same clips, cues, overlays, transitions, filters, and audio segments.

## Non-goals

- No new persisted tracks or schema migration.
- No arbitrary additional V/A tracks.
- No FFmpeg, TTS synthesis, preview renderer, export-range, or transition timing changes.
- No duration resize handles in this iteration.
- No audio source import inside the Add disclosure.
- No change to the rule that export requires video.

## TDD and verification

Write failing tests first for:

1. V1/A1 pointer-to-source-time parity and clamping;
2. A2/timed item project-bound clamping;
3. drag threshold behavior;
4. exact vs linked selection for V1/A1 and A3/S1;
5. visible track resolution/count with dynamic lanes.

Then run focused tests, all Vitest tests, ESLint, TypeScript, production build, local production HTTP/bundle smoke tests, independent review, and production deployment verification.

## Acceptance criteria

- Clicking the same horizontal position in V1 and A1 seeks to the same source/project time.
- A click or tap on A2/A3/S1/I1/FX does not enter drag history until movement exceeds 6px.
- A2 cannot be moved beyond project end and boundary no-ops preserve state identity.
- Selecting V1/A1 highlights the exact lane plus linked counterpart; selecting linked A3/S1 highlights both with a clear primary.
- Fixed filters/transitions are visibly and accessibly non-movable.
- Timeline title/count remain truthful with zero or dynamic tracks.
- Caption, text, and image creation are reachable from the timeline even while their lanes are hidden.
- All existing draft and export tests remain unchanged and green.
