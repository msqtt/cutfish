import { splitClipAt, type EditableClip } from './editor-utils';
import type { AudioTrackSegment } from './audio-track-utils';

export type EditorSelection =
  | { kind: 'video'; id: string }
  | { kind: 'source-audio'; id: string }
  | { kind: 'background-audio'; id: string }
  | { kind: 'subtitle'; id: string }
  | { kind: 'image'; id: string }
  | { kind: 'effect'; id: string }
  | null;

export type ContextualInspectorTab = 'clip' | 'project' | 'audio' | 'effects' | 'subtitles';

export function inspectorTabForSelection(selection: EditorSelection): ContextualInspectorTab {
  if (!selection) return 'project';
  switch (selection.kind) {
    case 'video': return 'clip';
    case 'source-audio':
    case 'background-audio': return 'audio';
    case 'subtitle':
    case 'image': return 'subtitles';
    case 'effect': return selection.id.startsWith('overlay:') ? 'subtitles' : 'effects';
  }
}

export interface ClipTransition {
  afterClipId: string;
}

/** Split a clip and keep an outgoing transition attached to the original material end. */
export function splitClipWithTransition<
  TClip extends EditableClip,
  TTransition extends ClipTransition,
>(
  clips: TClip[],
  transitions: TTransition[],
  clipId: string,
  sourceTime: number,
  rightId: string,
): { clips: TClip[]; transitions: TTransition[] } {
  const nextClips = splitClipAt(clips, clipId, sourceTime, rightId);
  if (nextClips === clips) return { clips, transitions };
  const nextTransitions = transitions.map((transition) => (
    transition.afterClipId === clipId
      ? { ...transition, afterClipId: rightId }
      : transition
  ));
  return { clips: nextClips, transitions: nextTransitions };
}

/** Resolve a pointer position to the nearest clip midpoint/reorder index. */
export function reorderTargetFromCenters(centers: number[], pointerX: number, sourceIndex: number): number | null {
  if (centers.length === 0 || !Number.isFinite(pointerX)) return null;
  const remaining = centers.filter((_, index) => index !== sourceIndex);
  if (remaining.length === 0) return 0;
  for (let index = 0; index < remaining.length; index += 1) {
    const center = remaining[index];
    if (Number.isFinite(center)) {
      if (pointerX < center) return index;
      continue;
    }
    const nextFinite = remaining.slice(index + 1).find(Number.isFinite);
    if (nextFinite == null || pointerX < nextFinite) return index;
  }
  return remaining.length;
}

/** Segment gain in [0, 2], including its fade-in/out envelope. */
export function backgroundAudioGainAtTime(segment: AudioTrackSegment, projectTime: number): number {
  if (!Number.isFinite(projectTime)) return 0;
  const duration = Math.max(0, segment.trimEnd - segment.trimStart);
  const elapsed = projectTime - segment.projectStart;
  if (elapsed < 0 || elapsed >= duration || duration <= 0) return 0;
  const base = Math.max(0, Math.min(2, segment.volume / 100));
  const fadeInGain = segment.fadeIn > 0 ? Math.min(1, elapsed / segment.fadeIn) : 1;
  const remaining = duration - elapsed;
  const fadeOutGain = segment.fadeOut > 0 ? Math.min(1, remaining / segment.fadeOut) : 1;
  return base * Math.max(0, Math.min(fadeInGain, fadeOutGain));
}
