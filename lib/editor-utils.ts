export interface EditableClip {
  id: string;
  trimStart: number;
  trimEnd: number;
}

export interface ProjectPosition {
  clipId: string;
  clipIndex: number;
  sourceTime: number;
  projectTime: number;
}

const MIN_CLIP_DURATION = 0.01;

function clipDuration(clip: EditableClip) {
  const duration = clip.trimEnd - clip.trimStart;
  if (!Number.isFinite(clip.trimStart) || !Number.isFinite(clip.trimEnd) || clip.trimStart < 0 || duration <= 0) {
    throw new Error(`Invalid trim range for ${clip.id}`);
  }
  return duration;
}

function assertNewId<T extends EditableClip>(clips: T[], newId: string) {
  if (!newId || clips.some((clip) => clip.id === newId)) throw new Error('New clip id must be unique');
}

export function getProjectDuration<T extends EditableClip>(clips: T[]) {
  return clips.reduce((total, clip) => total + clipDuration(clip), 0);
}

export function splitClipAt<T extends EditableClip>(clips: T[], id: string, sourceTime: number, newId: string): T[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0 || !Number.isFinite(sourceTime)) return clips;
  const clip = clips[index];
  clipDuration(clip);
  if (sourceTime - clip.trimStart < MIN_CLIP_DURATION || clip.trimEnd - sourceTime < MIN_CLIP_DURATION) {
    return clips;
  }
  assertNewId(clips, newId);
  const first = { ...clip, trimEnd: sourceTime };
  const second = { ...clip, id: newId, trimStart: sourceTime };
  return [...clips.slice(0, index), first, second, ...clips.slice(index + 1)];
}

export function duplicateClip<T extends EditableClip>(clips: T[], id: string, newId: string): T[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;
  assertNewId(clips, newId);
  const duplicate = { ...clips[index], id: newId };
  return [...clips.slice(0, index + 1), duplicate, ...clips.slice(index + 1)];
}

export function moveClipToIndex<T extends EditableClip>(clips: T[], id: string, targetIndex: number): T[] {
  const sourceIndex = clips.findIndex((clip) => clip.id === id);
  if (sourceIndex < 0 || !Number.isFinite(targetIndex)) return clips;
  const destination = Math.max(0, Math.min(clips.length - 1, Math.trunc(targetIndex)));
  if (sourceIndex === destination) return clips;
  const reordered = [...clips];
  const [clip] = reordered.splice(sourceIndex, 1);
  reordered.splice(destination, 0, clip);
  return reordered;
}

export function locateProjectTime<T extends EditableClip>(clips: T[], requestedTime: number): ProjectPosition | null {
  if (!clips.length || !Number.isFinite(requestedTime)) return null;
  const total = getProjectDuration(clips);
  const projectTime = Math.max(0, Math.min(total, requestedTime));
  let cursor = 0;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const duration = clipDuration(clip);
    const isLast = index === clips.length - 1;
    if (projectTime < cursor + duration || isLast) {
      return {
        clipId: clip.id,
        clipIndex: index,
        sourceTime: Math.min(clip.trimEnd, clip.trimStart + projectTime - cursor),
        projectTime,
      };
    }
    cursor += duration;
  }
  return null;
}

export function projectTimeForClip<T extends EditableClip>(clips: T[], id: string, sourceTime: number): number | null {
  if (!Number.isFinite(sourceTime)) return null;
  let cursor = 0;
  for (const clip of clips) {
    const duration = clipDuration(clip);
    if (clip.id === id) {
      const clampedSourceTime = Math.max(clip.trimStart, Math.min(clip.trimEnd, sourceTime));
      return cursor + clampedSourceTime - clip.trimStart;
    }
    cursor += duration;
  }
  return null;
}
