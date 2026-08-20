import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createDraft,
  listDrafts,
  loadDraft,
  saveDraft,
  deleteDraft,
  renameDraft,
  migrateFromV1,
  LEGACY_KEY_V1,
  type DraftState,
  applyClipDefaults,
  applyStateDefaults,
} from './draft-store';

// Mock idb-keyval
const store: Record<string, unknown> = {};
vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => Promise.resolve(store[key] ?? undefined)),
  set: vi.fn((key: string, value: unknown) => { store[key] = value; return Promise.resolve(); }),
  del: vi.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
}));

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const minimalState: DraftState = {
  clips: [],
  activeClipId: null,
  audioDelay: 0,
  audioFade: { fadeIn: 0, fadeOut: 0 },
  filters: { brightness: 100, contrast: 100, saturation: 100 },
  exportSettings: { resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 0, rangeEnd: null },
  masterVolume: 100,
  canvasAspect: '16:9',
  canvasFit: 'contain',
  playbackSpeed: 1,
  transitions: [],
  textOverlays: [],
  backgroundMusic: null,
  presetName: null,
  subtitles: [],
  visualOverlays: [],
};

describe('draft-store CRUD', () => {
  it('creates a new draft with generated id', async () => {
    const draft = await createDraft('My Project', minimalState);
    expect(draft.id).toBeTruthy();
    expect(draft.name).toBe('My Project');
    expect(draft.createdAt).toBeGreaterThan(0);
    expect(draft.state).toEqual(minimalState);
  });

  it('lists all drafts sorted by updatedAt desc', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await createDraft('Project A', minimalState);
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await createDraft('Project B', minimalState);
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts[0].name).toBe('Project B');
  });

  it('loads a specific draft by id', async () => {
    const created = await createDraft('Test', minimalState);
    const loaded = await loadDraft(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Test');
  });

  it('returns null when loading non-existent draft', async () => {
    const loaded = await loadDraft('nonexistent');
    expect(loaded).toBeNull();
  });

  it('saves (updates) an existing draft', async () => {
    const created = await createDraft('Test', minimalState);
    const updatedState = { ...minimalState, masterVolume: 150 };
    await saveDraft(created.id, updatedState);
    const loaded = await loadDraft(created.id);
    expect(loaded!.state.masterVolume).toBe(150);
    expect(loaded!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('deletes a draft', async () => {
    const created = await createDraft('ToDelete', minimalState);
    await deleteDraft(created.id);
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(0);
  });

  it('renames a draft', async () => {
    const created = await createDraft('OldName', minimalState);
    await renameDraft(created.id, 'NewName');
    const loaded = await loadDraft(created.id);
    expect(loaded!.name).toBe('NewName');
  });
});

describe('migrateFromV1', () => {
  it('migrates legacy v1 state to v2 format', async () => {
    const legacyState = {
      clips: [{ id: 'c1', name: 'test.mp4', duration: 10, trimStart: 0, trimEnd: 10 }],
      activeClipId: 'c1',
      audioDelay: 0,
      audioFade: { fadeIn: 0, fadeOut: 0 },
      filters: { brightness: 100, contrast: 100, saturation: 100 },
      exportSettings: { resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 0, rangeEnd: null },
    };
    store[LEGACY_KEY_V1] = legacyState;

    const migrated = await migrateFromV1();
    expect(migrated).toBe(true);

    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe('Migrated Project');
    // Legacy key should be deleted
    expect(store[LEGACY_KEY_V1]).toBeUndefined();
  });

  it('returns false when no legacy state exists', async () => {
    const result = await migrateFromV1();
    expect(result).toBe(false);
  });
});

describe('applyClipDefaults', () => {
  it('adds missing fields with backward-compatible defaults', () => {
    const legacyClip = { id: 'c1', name: 'test.mp4', duration: 10, trimStart: 0, trimEnd: 10 };
    const result = applyClipDefaults(legacyClip);
    expect(result.volume).toBe(100);
    expect(result.muted).toBe(false);
    expect(result.rotation).toBe(0);
    expect(result.flipH).toBe(false);
    expect(result.flipV).toBe(false);
    expect(result.speed).toBe(1.0);
    expect(result.displayName).toBe('test.mp4');
  });

  it('preserves existing values when present', () => {
    const clip = { id: 'c1', name: 'test.mp4', duration: 10, trimStart: 0, trimEnd: 10, volume: 150, muted: true, rotation: 90 as const, flipH: true, flipV: false, speed: 2, displayName: 'Custom' };
    const result = applyClipDefaults(clip);
    expect(result.volume).toBe(150);
    expect(result.muted).toBe(true);
    expect(result.rotation).toBe(90);
    expect(result.displayName).toBe('Custom');
  });
});

describe('applyStateDefaults', () => {
  it('adds missing state-level fields with backward-compatible defaults', () => {
    const legacyState = {
      clips: [],
      activeClipId: null,
      audioDelay: 0,
      audioFade: { fadeIn: 0, fadeOut: 0 },
      filters: { brightness: 100, contrast: 100, saturation: 100 },
      exportSettings: { resolution: '720p' as const, frameRate: 30 as const, quality: 'balanced' as const, rangeStart: 0, rangeEnd: null },
    };
    const result = applyStateDefaults(legacyState as unknown as Record<string, unknown>);
    expect(result.masterVolume).toBe(100);
    expect(result.canvasAspect).toBe('16:9');
    expect(result.canvasFit).toBe('contain');
    expect(result.playbackSpeed).toBe(1);
    expect(result.transitions).toEqual([]);
    expect(result.textOverlays).toEqual([]);
    expect(result.backgroundMusic).toBeNull();
    expect(result.presetName).toBeNull();
  });
});

describe('subtitles and visualOverlays in applyStateDefaults', () => {
  it('defaults subtitles to empty array when missing', () => {
    const result = applyStateDefaults({ clips: [] } as unknown as Record<string, unknown>);
    expect(result.subtitles).toEqual([]);
  });

  it('defaults visualOverlays to empty array when missing', () => {
    const result = applyStateDefaults({ clips: [] } as unknown as Record<string, unknown>);
    expect(result.visualOverlays).toEqual([]);
  });

  it('preserves existing subtitles', () => {
    const subtitles = [
      { id: 's1', text: 'Hello', fontFamily: 'sans', fontSize: 48, color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80, align: 'center', rotation: 0, startTime: 0, endTime: 5, tts: null },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles).toHaveLength(1);
    expect(result.subtitles[0].id).toBe('s1');
    expect(result.subtitles[0].text).toBe('Hello');
  });

  it('applies lineHeight default of 1.3 to old subtitles missing the field', () => {
    const subtitles = [
      { id: 's2', text: 'Old', fontFamily: 'sans', fontSize: 48, color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80, align: 'center', rotation: 0, startTime: 0, endTime: 5, tts: null },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].lineHeight).toBe(1.3);
  });

  it('preserves existing lineHeight value', () => {
    const subtitles = [
      { id: 's3', text: 'Custom', fontFamily: 'sans', fontSize: 48, lineHeight: 1.8, color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80, align: 'center', rotation: 0, startTime: 0, endTime: 5, tts: null },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].lineHeight).toBe(1.8);
  });

  it('preserves existing visualOverlays', () => {
    const visualOverlays = [
      { id: 'v1', type: 'rectangle', position: { x: 50, y: 50 }, size: { w: 30, h: 20 }, rotation: 0, opacity: 1, startTime: 1, endTime: 6, strokeColor: '#f00', strokeWidth: 2, fillColor: '', borderRadius: 0 },
    ];
    const result = applyStateDefaults({ clips: [], visualOverlays } as unknown as Record<string, unknown>);
    expect(result.visualOverlays).toHaveLength(1);
    expect(result.visualOverlays[0].id).toBe('v1');
  });

  it('preserves image File in visualOverlays through persistence', async () => {
    const file = new File(['png-data'], 'overlay.png', { type: 'image/png' });
    const visualOverlays = [
      { id: 'v2', type: 'image', position: { x: 50, y: 50 }, size: { w: 30, h: 30 }, rotation: 0, opacity: 1, startTime: 0, endTime: 5, file },
    ];
    const stateWithOverlays = { ...minimalState, subtitles: [], visualOverlays };
    const draft = await createDraft('Overlay Test', stateWithOverlays as unknown as DraftState);
    const loaded = await loadDraft(draft.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.visualOverlays).toHaveLength(1);
    expect(loaded!.state.visualOverlays[0]).toHaveProperty('file');
    expect((loaded!.state.visualOverlays[0] as { file: File }).file).toBeInstanceOf(File);
  });

  it('does not persist url field on image overlays', () => {
    const visualOverlays = [
      { id: 'v3', type: 'image', position: { x: 50, y: 50 }, size: { w: 30, h: 30 }, rotation: 0, opacity: 1, startTime: 0, endTime: 5, file: new File(['x'], 'x.png'), url: 'blob:http://localhost/abc' },
    ];
    const result = applyStateDefaults({ clips: [], visualOverlays } as unknown as Record<string, unknown>);
    // url should be stripped during applyStateDefaults
    const imgOverlay = result.visualOverlays[0] as { url?: string };
    expect(imgOverlay.url).toBeUndefined();
  });

  it('retains textOverlays as empty array for backward compatibility', () => {
    const result = applyStateDefaults({ clips: [] } as unknown as Record<string, unknown>);
    expect(result.textOverlays).toEqual([]);
  });
});

describe('backgroundMusic file persistence (B2)', () => {
  it('persists backgroundMusic.file in DraftState when present', async () => {
    const stateWithBgMusic: DraftState = {
      ...minimalState,
      backgroundMusic: {
        name: 'track.mp3',
        volume: 80,
        loop: true,
        fadeIn: 1,
        fadeOut: 2,
        file: new File(['audio'], 'track.mp3', { type: 'audio/mpeg' }),
      },
    };
    const draft = await createDraft('BG Music Test', stateWithBgMusic);
    const loaded = await loadDraft(draft.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.backgroundMusic).not.toBeNull();
    expect(loaded!.state.backgroundMusic!.name).toBe('track.mp3');
    expect(loaded!.state.backgroundMusic!.file).toBeInstanceOf(File);
  });

  it('handles null backgroundMusic gracefully', async () => {
    const draft = await createDraft('No Music', minimalState);
    const loaded = await loadDraft(draft.id);
    expect(loaded!.state.backgroundMusic).toBeNull();
  });
});
