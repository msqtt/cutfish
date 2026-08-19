import { get, set, del } from 'idb-keyval';

export const LEGACY_KEY_V1 = 'cutfish-draft-v1';
export const DRAFTS_KEY_V2 = 'cutfish-drafts-v2';

export interface DraftClip {
  id: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file?: File;
  url?: string;
  // Extended fields
  volume: number;
  muted: boolean;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  speed: number;
  displayName: string;
}

export interface DraftState {
  clips: DraftClip[];
  activeClipId: string | null;
  audioDelay: number;
  audioFade: { fadeIn: number; fadeOut: number };
  filters: { brightness: number; contrast: number; saturation: number };
  exportSettings: {
    resolution: '480p' | '720p' | '1080p';
    frameRate: 24 | 30 | 60;
    quality: 'compact' | 'balanced' | 'high';
    rangeStart: number;
    rangeEnd: number | null;
  };
  masterVolume: number;
  canvasAspect: '16:9' | '9:16' | '4:3' | '1:1' | 'auto';
  canvasFit: 'contain' | 'cover' | 'stretch';
  playbackSpeed: number;
  transitions: Array<{ id: string; afterClipId: string; type: string; duration: number }>;
  textOverlays: Array<{ id: string; text: string; fontFamily: string; fontSize: number; color: string; position: { x: number; y: number }; startTime: number; endTime: number }>;
  backgroundMusic: { name: string; volume: number; loop: boolean; fadeIn: number; fadeOut: number; file?: File } | null;
  presetName: string | null;
  customPresets?: Array<{ name: string; canvasAspect: string; canvasFit: string; exportSettings: { resolution: string; frameRate: number; quality: string } }>;
}

export interface DraftProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  state: DraftState;
}

/**
 * Apply backward-compatible defaults to a clip that may be missing new fields.
 */
export function applyClipDefaults(clip: Partial<DraftClip> & { id: string; name: string }): DraftClip {
  return {
    duration: 0,
    trimStart: 0,
    trimEnd: 0,
    ...clip,
    volume: clip.volume ?? 100,
    muted: clip.muted ?? false,
    rotation: clip.rotation ?? 0,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    speed: clip.speed ?? 1.0,
    displayName: clip.displayName ?? clip.name,
  };
}

/**
 * Apply backward-compatible defaults to a state that may be missing new fields.
 */
export function applyStateDefaults(state: Record<string, unknown>): DraftState {
  const base = state as Partial<DraftState>;
  return {
    clips: (base.clips ?? []).map((c: Partial<DraftClip> & { id: string; name: string }) => applyClipDefaults(c)),
    activeClipId: (base.activeClipId as string | null) ?? null,
    audioDelay: (base.audioDelay as number) ?? 0,
    audioFade: (base.audioFade as { fadeIn: number; fadeOut: number }) ?? { fadeIn: 0, fadeOut: 0 },
    filters: (base.filters as { brightness: number; contrast: number; saturation: number }) ?? { brightness: 100, contrast: 100, saturation: 100 },
    exportSettings: (base.exportSettings as DraftState['exportSettings']) ?? { resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 0, rangeEnd: null },
    masterVolume: base.masterVolume ?? 100,
    canvasAspect: base.canvasAspect ?? '16:9',
    canvasFit: base.canvasFit ?? 'contain',
    playbackSpeed: base.playbackSpeed ?? 1,
    transitions: base.transitions ?? [],
    textOverlays: base.textOverlays ?? [],
    backgroundMusic: base.backgroundMusic ?? null,
    presetName: base.presetName ?? null,
  };
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readDrafts(): Promise<DraftProject[]> {
  const data = await get(DRAFTS_KEY_V2);
  if (!Array.isArray(data)) return [];
  return data as DraftProject[];
}

async function writeDrafts(drafts: DraftProject[]): Promise<void> {
  await set(DRAFTS_KEY_V2, drafts);
}

/**
 * Create a new draft project.
 */
export async function createDraft(name: string, state: DraftState): Promise<DraftProject> {
  const now = Date.now();
  const project: DraftProject = {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    state,
  };
  const drafts = await readDrafts();
  drafts.push(project);
  await writeDrafts(drafts);
  return project;
}

/**
 * List all drafts sorted by updatedAt (most recent first), then by createdAt as tiebreaker.
 */
export async function listDrafts(): Promise<DraftProject[]> {
  const drafts = await readDrafts();
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/**
 * Load a specific draft by ID.
 */
export async function loadDraft(id: string): Promise<DraftProject | null> {
  const drafts = await readDrafts();
  return drafts.find((d) => d.id === id) ?? null;
}

/**
 * Save (update) the state of an existing draft.
 */
export async function saveDraft(id: string, state: DraftState): Promise<void> {
  const drafts = await readDrafts();
  const index = drafts.findIndex((d) => d.id === id);
  if (index < 0) return;
  drafts[index] = { ...drafts[index], state, updatedAt: Date.now() };
  await writeDrafts(drafts);
}

/**
 * Delete a draft by ID.
 */
export async function deleteDraft(id: string): Promise<void> {
  const drafts = await readDrafts();
  const filtered = drafts.filter((d) => d.id !== id);
  await writeDrafts(filtered);
}

/**
 * Rename a draft.
 */
export async function renameDraft(id: string, newName: string): Promise<void> {
  const drafts = await readDrafts();
  const index = drafts.findIndex((d) => d.id === id);
  if (index < 0) return;
  drafts[index] = { ...drafts[index], name: newName, updatedAt: Date.now() };
  await writeDrafts(drafts);
}

/**
 * Migrate from legacy cutfish-draft-v1 single-project format to v2 multi-project format.
 * Returns true if migration was performed, false if no legacy data exists.
 */
export async function migrateFromV1(): Promise<boolean> {
  const legacyState = await get(LEGACY_KEY_V1);
  if (!legacyState) return false;

  const migratedState = applyStateDefaults(legacyState as Record<string, unknown>);
  const now = Date.now();
  const project: DraftProject = {
    id: generateId(),
    name: 'Migrated Project',
    createdAt: now,
    updatedAt: now,
    state: migratedState,
  };

  const existingDrafts = await readDrafts();
  existingDrafts.push(project);
  await writeDrafts(existingDrafts);
  await del(LEGACY_KEY_V1);

  return true;
}
