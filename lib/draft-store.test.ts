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
  DRAFTS_KEY_V2,
  type DraftState,
  applyClipDefaults,
  applyStateDefaults,
  migrateBackgroundMusic,
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
        duration: 12,
        replaceOriginalAudio: false,
        segments: [
          { id: 'seg1', projectStart: 0, trimStart: 0, trimEnd: 12, volume: 80, fadeIn: 1, fadeOut: 2 },
        ],
        file: new File(['audio'], 'track.mp3', { type: 'audio/mpeg' }),
      },
    };
    const draft = await createDraft('BG Music Test', stateWithBgMusic);
    const loaded = await loadDraft(draft.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.backgroundMusic).not.toBeNull();
    expect(loaded!.state.backgroundMusic!.name).toBe('track.mp3');
    expect(loaded!.state.backgroundMusic!.file).toBeInstanceOf(File);
    expect(loaded!.state.backgroundMusic!.segments).toHaveLength(1);
  });

  it('handles null backgroundMusic gracefully', async () => {
    const draft = await createDraft('No Music', minimalState);
    const loaded = await loadDraft(draft.id);
    expect(loaded!.state.backgroundMusic).toBeNull();
  });
});

describe('migrateBackgroundMusic (audio track model)', () => {
  it('returns null for null/invalid input', () => {
    expect(migrateBackgroundMusic(null)).toBeNull();
    expect(migrateBackgroundMusic(undefined)).toBeNull();
    expect(migrateBackgroundMusic('nope')).toBeNull();
  });

  it('migrates a legacy single-background-music draft into one segment', () => {
    const file = new File(['audio'], 'bg.mp3', { type: 'audio/mpeg' });
    const track = migrateBackgroundMusic({
      name: 'bg.mp3', volume: 60, loop: true, fadeIn: 2, fadeOut: 3,
      replaceOriginalAudio: true, file,
    });
    expect(track).not.toBeNull();
    expect(track!.name).toBe('bg.mp3');
    expect(track!.replaceOriginalAudio).toBe(true);
    expect(track!.file).toBe(file);
    expect(track!.segments).toHaveLength(1);
    const seg = track!.segments[0];
    expect(seg.projectStart).toBe(0);
    expect(seg.trimStart).toBe(0);
    expect(seg.volume).toBe(60);
    expect(seg.fadeIn).toBe(2);
    expect(seg.fadeOut).toBe(3);
    // No duration known → trimEnd 0, to be hydrated later.
    expect(seg.trimEnd).toBe(0);
  });

  it('uses legacy duration for trimEnd when available and drops loop from timeline', () => {
    const track = migrateBackgroundMusic({
      name: 'bg.mp3', volume: 80, loop: true, fadeIn: 0, fadeOut: 0,
      replaceOriginalAudio: false, duration: 15,
    });
    expect(track!.duration).toBe(15);
    expect(track!.segments[0].trimEnd).toBe(15);
    // Loop is not represented on the new track/segment shape.
    expect(track as unknown as Record<string, unknown>).not.toHaveProperty('loop');
    expect(track!.segments[0] as unknown as Record<string, unknown>).not.toHaveProperty('loop');
  });

  it('defaults legacy replaceOriginalAudio to false', () => {
    const track = migrateBackgroundMusic({
      name: 'bg.mp3', volume: 80, loop: false, fadeIn: 0, fadeOut: 0,
    });
    expect(track!.replaceOriginalAudio).toBe(false);
  });

  it('normalizes an already-migrated track shape', () => {
    const track = migrateBackgroundMusic({
      name: 'bg.mp3', duration: 20, replaceOriginalAudio: true,
      segments: [
        { id: 's1', projectStart: 3, trimStart: 1, trimEnd: 10, volume: 90, fadeIn: 1, fadeOut: 2 },
        { id: 's2', projectStart: 12, trimStart: 10, trimEnd: 20, volume: 100, fadeIn: 0, fadeOut: 0 },
      ],
    });
    expect(track!.segments).toHaveLength(2);
    expect(track!.duration).toBe(20);
    expect(track!.segments[1].projectStart).toBe(12);
  });

  it('applyStateDefaults migrates legacy backgroundMusic into a track', () => {
    const result = applyStateDefaults({
      clips: [],
      backgroundMusic: { name: 'x.mp3', volume: 70, loop: false, fadeIn: 0, fadeOut: 0 },
    } as unknown as Record<string, unknown>);
    expect(result.backgroundMusic).not.toBeNull();
    expect(result.backgroundMusic!.segments).toHaveLength(1);
    expect(result.backgroundMusic!.segments[0].volume).toBe(70);
  });

  it('migrates a legacy v2 project through the real draft read path', async () => {
    store[DRAFTS_KEY_V2] = [{
      id: 'old-v2', name: 'Old', createdAt: 1, updatedAt: 1,
      state: {
        ...minimalState,
        backgroundMusic: { name: 'legacy.mp3', volume: 65, loop: false, fadeIn: 1, fadeOut: 2, replaceOriginalAudio: true },
      },
    }];
    const [project] = await listDrafts();
    expect(project.state.backgroundMusic?.replaceOriginalAudio).toBe(true);
    expect(project.state.backgroundMusic?.segments).toHaveLength(1);
    expect(project.state.backgroundMusic?.segments[0].volume).toBe(65);
  });
});

describe('applyStateDefaults TTS migration', () => {
  it('adds exportVoiceId and includeInExport defaults to old subtitles with tts', () => {
    const subtitles = [
      {
        id: 's1', text: 'Hello', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3,
        color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80,
        align: 'center', rotation: 0, startTime: 0, endTime: 5,
        tts: { enabled: true, voiceURI: '', lang: 'zh-CN', rate: 1, pitch: 1, volume: 1 },
      },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].tts!.exportVoiceId).toBe('zh_CN-huayan-x_low');
    expect(result.subtitles[0].tts!.includeInExport).toBe(true);
  });

  it('preserves existing exportVoiceId when present', () => {
    const subtitles = [
      {
        id: 's2', text: 'Hi', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3,
        color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80,
        align: 'center', rotation: 0, startTime: 0, endTime: 5,
        tts: { enabled: true, voiceURI: '', lang: 'en-US', rate: 1, pitch: 1, volume: 1, exportVoiceId: 'en_US-ryan-medium', includeInExport: false },
      },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].tts!.exportVoiceId).toBe('en_US-ryan-medium');
    expect(result.subtitles[0].tts!.includeInExport).toBe(false);
  });

  it('defaults exportVoiceId based on lang for English', () => {
    const subtitles = [
      {
        id: 's3', text: 'Test', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3,
        color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80,
        align: 'center', rotation: 0, startTime: 0, endTime: 5,
        tts: { enabled: true, voiceURI: '', lang: 'en-US', rate: 1, pitch: 1, volume: 1 },
      },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].tts!.exportVoiceId).toBe('en_US-hfc_female-medium');
  });

  it('preserves null tts on subtitles', () => {
    const subtitles = [
      {
        id: 's4', text: 'No TTS', fontFamily: 'sans', fontSize: 48, lineHeight: 1.3,
        color: '#fff', backgroundColor: '', position: { x: 50, y: 50 }, width: 80,
        align: 'center', rotation: 0, startTime: 0, endTime: 5, tts: null,
      },
    ];
    const result = applyStateDefaults({ clips: [], subtitles } as unknown as Record<string, unknown>);
    expect(result.subtitles[0].tts).toBeNull();
  });
});


describe('applyStateDefaults background audio replacement migration', () => {
  it('defaults old background music to mixing with original audio', () => {
    const result = applyStateDefaults({
      clips: [],
      backgroundMusic: { name: 'legacy.mp3', volume: 80, loop: false, fadeIn: 0, fadeOut: 0 },
    });
    expect(result.backgroundMusic?.replaceOriginalAudio).toBe(false);
  });

  it('preserves replacement mode from newer drafts', () => {
    const result = applyStateDefaults({
      clips: [],
      backgroundMusic: { name: 'new.mp3', volume: 100, loop: true, fadeIn: 1, fadeOut: 2, replaceOriginalAudio: true },
    });
    expect(result.backgroundMusic?.replaceOriginalAudio).toBe(true);
  });
});
