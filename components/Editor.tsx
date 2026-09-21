'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Edit2,
  FileVideo, Globe, HelpCircle, Maximize, Menu, Minimize, MonitorPlay, Moon,
  MoreVertical, Music, Pause, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, SlidersHorizontal,
  Sun, Trash2, Undo2, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import ExportPanel from '@/components/ExportPanel';
import RangeControl from '@/components/RangeControl';
import Timeline, { type TimelineTimedItem, type TimelineTimedTrack } from '@/components/Timeline';
import {
  buildFFmpegCommandExtended, resolveExportProfile,
  selectClipsForExportSpeedAware,
  type AudioFadeSettings, type ExportSettings,
  type ExtendedClipMetadata, type TransitionConfig, type TextOverlay,
  type TtsAudioInput,
  type AudioTrackInput,
} from '@/lib/ffmpeg-utils';
import { LOCAL_TTS_VOICES, getTtsCacheKey, selectTtsCuesForExport, getVoiceById, getDefaultLocalVoice } from '@/lib/tts-utils';
import type { LocalTtsVoiceId } from '@/lib/tts-utils';
import {
  duplicateClip, getProjectDurationSpeedAware, projectTimeForClipSpeedAware,
  moveClipToIndex,
  buildRotationTransformCSS, type CanvasAspect, type CanvasFit,
} from '@/lib/editor-utils';
import { useHistory } from '@/lib/history';
import {
  backgroundAudioGainAtTime, inspectorTabForSelection, resolveInspectorTabs, splitClipWithTransition,
  type EditorSelection,
} from '@/lib/editor-workflow';
import {
  createDraft, listDrafts, loadDraft, saveDraft, deleteDraft, renameDraft,
  migrateFromV1, applyStateDefaults,
  type DraftProject, type DraftState, type DraftClip,
} from '@/lib/draft-store';
import { PRESETS, getPresetNames, applyPreset, loadCustomPresets, saveCustomPreset, deleteCustomPreset, applyCustomPreset, type CustomPreset } from '@/lib/preset-utils';
import { selectTextOverlaysForExport } from '@/lib/text-overlay-utils';
import {
  selectAudioSegmentsForExport, splitAudioSegment, clampAudioSegmentToSource,
  type AudioTrackSegment,
} from '@/lib/audio-track-utils';
import { computeTransitionAdjustedDuration, type TransitionClip } from '@/lib/transition-utils';
import {
  type SubtitleCue, type VisualOverlay, type DrawingOverlay, type ImageOverlay,
  createDefaultSubtitleCue, createDefaultDrawingOverlay, createDefaultRectangleOverlay,
  createDefaultImageOverlay, normalizeDrawingPoints, computeDrawingBounds,
  rebaseDrawingPoints, getActiveTtsCue, computeOverlayCssTransform,
} from '@/lib/visual-overlay-utils';
import { renderOverlaysToPng } from '@/lib/overlay-renderer';
import { clampWorkspaceSize, formatEditorTime, moveTimedRange, resizeWorkspacePanel, stepTimelineZoom } from '@/lib/workspace-utils';
import { getFfmpegCoreAssetUrls } from '@/lib/ffmpeg-runtime';
import '@/lib/i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Clip {
  id: string;
  url: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file: File;
  volume: number;
  muted: boolean;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  speed: number;
  displayName: string;
}

export interface EditorState {
  clips: Clip[];
  activeClipId: string | null;
  audioDelay: number;
  audioFade: AudioFadeSettings;
  filters: { brightness: number; contrast: number; saturation: number };
  exportSettings: ExportSettings;
  masterVolume: number;
  canvasAspect: CanvasAspect;
  canvasFit: CanvasFit;
  playbackSpeed: number;
  transitions: TransitionConfig[];
  textOverlays: TextOverlay[];
  backgroundMusic: { name: string; file?: File; url?: string; duration: number; replaceOriginalAudio: boolean; segments: AudioTrackSegment[] } | null;
  presetName: string | null;
  subtitles: SubtitleCue[];
  visualOverlays: VisualOverlay[];
}

type InspectorTab = 'clip' | 'project' | 'audio' | 'effects' | 'subtitles';
type MobilePanel = 'media' | 'inspector' | null;
type WorkspacePanel = 'media' | 'inspector' | 'timeline';
type Toast = { kind: 'success' | 'error'; message: string } | null;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type OverlayTool = 'select' | 'pen' | 'rect';

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 0, rangeEnd: null,
};
const DEFAULT_STATE: EditorState = {
  clips: [], activeClipId: null, audioDelay: 0,
  audioFade: { fadeIn: 0, fadeOut: 0 },
  filters: { brightness: 100, contrast: 100, saturation: 100 },
  exportSettings: DEFAULT_EXPORT_SETTINGS,
  masterVolume: 100, canvasAspect: '16:9', canvasFit: 'contain',
  playbackSpeed: 1, transitions: [], textOverlays: [],
  backgroundMusic: null, presetName: null,
  subtitles: [], visualOverlays: [],
};
const iconButton = 'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md p-2 text-[var(--muted)] transition-colors hover:bg-[var(--raised)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVideoDuration(url: string) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    const cleanup = () => { video.removeAttribute('src'); video.load(); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('Invalid duration'));
    };
    video.onerror = () => { cleanup(); reject(new Error('Unreadable video')); };
    video.src = url;
  });
}

function getAudioDuration(url: string) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement('audio');
    const cleanup = () => { audio.removeAttribute('src'); audio.load(); };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('Invalid duration'));
    };
    audio.onerror = () => { cleanup(); reject(new Error('Unreadable audio')); };
    audio.src = url;
  });
}

function fileIdentity(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function clampNumber(value: string | number, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clipToExtendedMetadata(clip: Clip, filename: string, hasAudio: boolean): ExtendedClipMetadata {
  return {
    id: clip.id, filename, trimStart: clip.trimStart, trimEnd: clip.trimEnd, hasAudio,
    volume: clip.volume, muted: clip.muted, rotation: clip.rotation,
    flipH: clip.flipH, flipV: clip.flipV, speed: clip.speed,
  };
}

function editorStateToDraft(state: EditorState): DraftState {
  return applyStateDefaults({
    clips: state.clips.map((clip): DraftClip => ({
      id: clip.id, name: clip.name, duration: clip.duration,
      trimStart: clip.trimStart, trimEnd: clip.trimEnd, file: clip.file,
      volume: clip.volume, muted: clip.muted, rotation: clip.rotation,
      flipH: clip.flipH, flipV: clip.flipV, speed: clip.speed,
      displayName: clip.displayName,
    })),
    activeClipId: state.activeClipId,
    audioDelay: state.audioDelay,
    audioFade: state.audioFade,
    filters: state.filters,
    exportSettings: state.exportSettings,
    masterVolume: state.masterVolume,
    canvasAspect: state.canvasAspect,
    canvasFit: state.canvasFit,
    playbackSpeed: state.playbackSpeed,
    transitions: state.transitions,
    textOverlays: state.textOverlays,
    backgroundMusic: state.backgroundMusic ? {
      name: state.backgroundMusic.name,
      duration: state.backgroundMusic.duration,
      replaceOriginalAudio: state.backgroundMusic.replaceOriginalAudio,
      segments: state.backgroundMusic.segments,
      file: state.backgroundMusic.file,
    } : null,
    presetName: state.presetName,
    subtitles: state.subtitles,
    visualOverlays: state.visualOverlays,
  });
}

function draftToEditorState(draft: DraftState, createUrl: (file: Blob) => string): EditorState {
  const clips = draft.clips
    .filter((c) => c.file instanceof Blob)
    .map((c): Clip => ({
      id: c.id, name: c.name, duration: c.duration,
      trimStart: c.trimStart, trimEnd: c.trimEnd, file: c.file!,
      url: createUrl(c.file!),
      volume: c.volume ?? 100, muted: c.muted ?? false,
      rotation: c.rotation ?? 0, flipH: c.flipH ?? false, flipV: c.flipV ?? false,
      speed: c.speed ?? 1.0, displayName: c.displayName ?? c.name,
    }));
  // Restore object URLs for image overlays that have a File
  const visualOverlays: VisualOverlay[] = (draft.visualOverlays ?? []).map((o) => {
    if (o.type === 'image' && o.file instanceof Blob) {
      return { ...o, url: createUrl(o.file) } as VisualOverlay;
    }
    return o;
  });
  return {
    clips,
    activeClipId: clips.some((c) => c.id === draft.activeClipId) ? draft.activeClipId : (clips[0]?.id ?? null),
    audioDelay: draft.audioDelay ?? 0,
    audioFade: draft.audioFade ?? { fadeIn: 0, fadeOut: 0 },
    filters: draft.filters ?? { brightness: 100, contrast: 100, saturation: 100 },
    exportSettings: draft.exportSettings ?? DEFAULT_EXPORT_SETTINGS,
    masterVolume: draft.masterVolume ?? 100,
    canvasAspect: draft.canvasAspect ?? '16:9',
    canvasFit: draft.canvasFit ?? 'contain',
    playbackSpeed: draft.playbackSpeed ?? 1,
    transitions: (draft.transitions ?? []) as TransitionConfig[],
    textOverlays: (draft.textOverlays ?? []) as TextOverlay[],
    backgroundMusic: draft.backgroundMusic ? {
      name: draft.backgroundMusic.name,
      duration: draft.backgroundMusic.duration ?? 0,
      replaceOriginalAudio: draft.backgroundMusic.replaceOriginalAudio ?? false,
      segments: draft.backgroundMusic.segments ?? [],
      file: draft.backgroundMusic.file instanceof Blob ? draft.backgroundMusic.file as File : undefined,
      url: draft.backgroundMusic.file instanceof Blob ? createUrl(draft.backgroundMusic.file as File) : undefined,
    } : null,
    presetName: draft.presetName ?? null,
    subtitles: (draft.subtitles ?? []) as SubtitleCue[],
    visualOverlays,
  };
}

// ─── Editor Component ────────────────────────────────────────────────────────

export default function Editor() {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const {
    state, set: updateState, replace: replaceState, checkpoint, undo: undoHistoryAction, redo: redoHistoryAction,
    canUndo, canRedo, reset,
  } = useHistory<EditorState>(DEFAULT_STATE);

  // UI state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'loading' | 'preparing' | 'tts' | 'rendering'>('loading');
  const [progress, setProgress] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('project');
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [leftPanelWidth, setLeftPanelWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(288);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [holdingCompare, setHoldingCompare] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedTime, setLastSavedTime] = useState<number | null>(null);
  const [renamingClipId, setRenamingClipId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // Audio timeline: currently selected segment (UI-only, not persisted to draft).
  const [selectedAudioSegmentId, setSelectedAudioSegmentId] = useState<string | null>(null);

  // Subtitle/overlay state
  const [editingSubtitleId, setEditingSubtitleId] = useState<string | null>(null);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<'tts' | 'subtitle'>('subtitle');
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [overlayTool, setOverlayTool] = useState<OverlayTool>('select');
  const [ttsPlaying, setTtsPlaying] = useState(false);

  // Local TTS generation state
  const [localTtsProgress, setLocalTtsProgress] = useState(0);
  const [localTtsCueId, setLocalTtsCueId] = useState<string | null>(null);
  const [localTtsPhase, setLocalTtsPhase] = useState<'idle' | 'downloading' | 'generating'>('idle');
  const localTtsCacheRef = useRef(new Map<string, Blob>());
  const localTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const localTtsUrlRef = useRef<string | null>(null);
  const ttsAudioContextRef = useRef<AudioContext | null>(null);
  const ttsBufferSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Project manager state
  const [projects, setProjects] = useState<DraftProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const backgroundAudioPoolRef = useRef(new Map<string, HTMLAudioElement>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const helpDialogRef = useRef<HTMLDivElement>(null);
  const projectDialogRef = useRef<HTMLDivElement>(null);
  const mediaSheetRef = useRef<HTMLElement>(null);
  const inspectorSheetRef = useRef<HTMLElement>(null);
  const mediaTriggerRef = useRef<HTMLButtonElement>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
  const refreshProjectsRef = useRef<(() => Promise<void>) | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const continuousEditRef = useRef<EditorState | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadRef = useRef<Promise<FFmpeg> | null>(null);
  const cancelRequestedRef = useRef(false);
  const continuePlaybackRef = useRef(false);
  const importingRef = useRef(false);
  const pendingSeekRef = useRef<{ clipId: string; sourceTime: number } | null>(null);
  const savingRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const drawingRef = useRef<{ points: Array<{ x: number; y: number }>; active: boolean }>({ points: [], active: false });
  const rectDrawRef = useRef<{ startX: number; startY: number; active: boolean }>({ startX: 0, startY: 0, active: false });
  const [draftPenPoints, setDraftPenPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const ttsModeRef = useRef<'auto' | 'manual' | null>(null);
  const lastTtsCueIdRef = useRef<string | null>(null);
  const ttsRequestIdRef = useRef(0);

  const activeClip = state.clips.find((clip) => clip.id === state.activeClipId);
  // Effective (validated) audio selection: falls back to null when the selected
  // segment no longer exists (deleted/undone). Derived to avoid setState-in-effect.
  const effectiveSelectedAudioSegmentId =
    selectedAudioSegmentId && (state.backgroundMusic?.segments ?? []).some((s) => s.id === selectedAudioSegmentId)
      ? selectedAudioSegmentId
      : null;
  const projectDurationSpeedAware = getProjectDurationSpeedAware(state.clips);
  // M1: Compute transition-adjusted output duration
  const transitionClips: TransitionClip[] = state.clips.map((clip) => ({
    id: clip.id,
    trimmedDuration: (clip.trimEnd - clip.trimStart) / (clip.speed || 1.0),
  }));
  const outputDuration = state.transitions.length > 0
    ? computeTransitionAdjustedDuration(transitionClips, state.transitions as TransitionConfig[])
    : projectDurationSpeedAware;
  const canSplit = Boolean(activeClip
    && currentTime - activeClip.trimStart >= 0.01
    && activeClip.trimEnd - currentTime >= 0.01);

  const previewProjectTime = activeClip
    ? (projectTimeForClipSpeedAware(state.clips, activeClip.id, currentTime) ?? 0)
    : 0;

  const selectedBackgroundAudioSegment = selection?.kind === 'background-audio'
    ? state.backgroundMusic?.segments.find((segment) => segment.id === selection.id) ?? null
    : null;
  const canContextSplit = selectedBackgroundAudioSegment
    ? previewProjectTime - selectedBackgroundAudioSegment.projectStart > 0.01
      && selectedBackgroundAudioSegment.projectStart + selectedBackgroundAudioSegment.trimEnd - selectedBackgroundAudioSegment.trimStart - previewProjectTime > 0.01
    : (!selection || selection.kind === 'video' || selection.kind === 'source-audio') && canSplit;
  const timelineSubtitleItems: TimelineTimedItem[] = state.subtitles.map((cue, index) => ({
    id: cue.id, name: cue.text.trim() || `${t('subtitles')} ${index + 1}`,
    startTime: cue.startTime, endTime: cue.endTime,
  }));
  const timelineTtsItems: TimelineTimedItem[] = state.subtitles
    .filter((cue) => cue.tts?.enabled && cue.text.trim())
    .map((cue, index) => ({
      id: cue.id, name: cue.text.trim() || `${t('tts_audio_track')} ${index + 1}`,
      startTime: cue.startTime, endTime: cue.endTime,
    }));
  const timelineImageItems: TimelineTimedItem[] = state.visualOverlays.filter((overlay) => overlay.type === 'image').map((overlay, index) => ({
    id: overlay.id, name: `${t('image_track')} ${index + 1}`,
    startTime: overlay.startTime, endTime: overlay.endTime,
  }));
  const filtersActive = state.filters.brightness !== 100 || state.filters.contrast !== 100 || state.filters.saturation !== 100;
  const timelineEffectItems: TimelineTimedItem[] = [
    ...state.textOverlays.map((overlay, index) => ({
      id: `text:${overlay.id}`, name: overlay.text.trim() || `${t('text_overlays')} ${index + 1}`,
      startTime: overlay.startTime, endTime: overlay.endTime,
    })),
    ...state.visualOverlays.filter((overlay) => overlay.type !== 'image').map((overlay, index) => ({
      id: `overlay:${overlay.id}`, name: `${t('visual_overlays')} ${index + 1}`,
      startTime: overlay.startTime, endTime: overlay.endTime,
    })),
    ...(filtersActive && projectDurationSpeedAware > 0 ? [{
      id: 'filters:global', name: t('filters'), startTime: 0, endTime: projectDurationSpeedAware, movable: false,
    }] : []),
    ...state.transitions.flatMap((transition) => {
      const clipIndex = state.clips.findIndex((clip) => clip.id === transition.afterClipId);
      if (clipIndex < 0) return [];
      const boundary = state.clips.slice(0, clipIndex + 1).reduce((sum, clip) => sum + Math.max(0.01, (clip.trimEnd - clip.trimStart) / (clip.speed || 1)), 0);
      return [{ id: `transition:${transition.afterClipId}`, name: t(`transition_${transition.type}`), startTime: Math.max(0, boundary - transition.duration), endTime: boundary, movable: false }];
    }),
  ];
  const selectedTimelineItem = selection?.kind === 'subtitle'
    ? { track: selectedSubtitleTrack as TimelineTimedTrack, id: selection.id }
    : selection?.kind === 'image'
      ? { track: 'image' as const, id: selection.id }
      : selection?.kind === 'effect'
        ? { track: 'effect' as const, id: selection.id }
        : null;

  // Contextual Inspector destinations: selected material first, then the stable
  // global destinations, capped at four (derived, never persisted).
  const visibleInspectorTabs = resolveInspectorTabs(selection) as InspectorTab[];
  // The active tab must always be one of the visible destinations; fall back to
  // the contextual first tab when a stale selection removed the current one.
  const effectiveInspectorTab: InspectorTab = visibleInspectorTabs.includes(inspectorTab)
    ? inspectorTab
    : visibleInspectorTabs[0];

  const createTrackedUrl = useCallback((file: Blob) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  // ─── Lifecycle & Draft ───────────────────────────────────────────────────

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    ffmpegRef.current?.terminate();
    backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
    backgroundAudioPoolRef.current.clear();
    // Clean up local TTS audio and invalidate pending async synthesis.
    ttsRequestIdRef.current += 1;
    ttsBufferSourceRef.current?.stop();
    ttsBufferSourceRef.current = null;
    void ttsAudioContextRef.current?.close();
    ttsAudioContextRef.current = null;
    if (localTtsAudioRef.current) { localTtsAudioRef.current.pause(); localTtsAudioRef.current = null; }
    if (localTtsUrlRef.current) { URL.revokeObjectURL(localTtsUrlRef.current); localTtsUrlRef.current = null; }
  }, []);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en';
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
    backgroundAudioPoolRef.current.clear();
  }, [state.backgroundMusic?.url]);

  // Timeline auto-preview is wired below the local Piper WAV preview helpers so
  // manual preview, timeline playback, and export use the same voice pipeline.

  // A project switch always terminates speech from the previous project.
  useEffect(() => {
    ttsRequestIdRef.current += 1;
    ttsBufferSourceRef.current?.stop();
    ttsBufferSourceRef.current = null;
    localTtsAudioRef.current?.pause();
    localTtsAudioRef.current = null;
    ttsModeRef.current = null;
    lastTtsCueIdRef.current = null;
    const timer = window.setTimeout(() => setTtsPlaying(false), 0);
    return () => window.clearTimeout(timer);
  }, [currentProjectId]);

  // Initialize: migrate from v1, load projects
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await migrateFromV1();
        const allProjects = await listDrafts();
        if (cancelled) return;
        setProjects(allProjects);
        if (allProjects.length > 0) {
          const project = allProjects[0];
          setCurrentProjectId(project.id);
          const editorState = draftToEditorState(project.state, createTrackedUrl);
          reset(editorState);
          setToast({ kind: 'success', message: t('restored') });
        }
      } catch (error) {
        console.error('Draft restore failed', error);
      } finally {
        if (!cancelled) {
          setDraftReady(true);
          setCustomPresets(loadCustomPresets());
        }
      }
    })();
    return () => { cancelled = true; };
  }, [createTrackedUrl, reset, t]);

  const persistProject = useCallback((projectId: string, draft: DraftState) => {
    const next = saveQueueRef.current.catch(() => undefined).then(() => saveDraft(projectId, draft));
    saveQueueRef.current = next;
    return next;
  }, []);

  // Auto-save
  useEffect(() => {
    if (!draftReady || !currentProjectId) return;
    const timer = window.setTimeout(async () => {
      if (continuousEditRef.current) return;
      savingRef.current = true;
      setSaveStatus('saving');
      try {
        await persistProject(currentProjectId, editorStateToDraft(state));
        setSaveStatus('saved');
        setLastSavedTime(Date.now());
      } catch (error) {
        console.error('Draft save failed', error);
        setSaveStatus('error');
        setToast({ kind: 'error', message: t('draft_error') });
      } finally {
        savingRef.current = false;
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftReady, currentProjectId, persistProject, state, t]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ─── Continuous Edit ─────────────────────────────────────────────────────

  const beginContinuousEdit = useCallback(() => {
    if (!continuousEditRef.current) continuousEditRef.current = state;
  }, [state]);

  const finishContinuousEdit = useCallback(() => {
    if (!continuousEditRef.current) return;
    checkpoint(continuousEditRef.current);
    continuousEditRef.current = null;
    // The committed render triggers the normal autosave with the latest state.
    // Saving here would serialize the stale pointer-down closure.
  }, [checkpoint]);


  const startWorkspaceResize = useCallback((event: React.PointerEvent<HTMLElement>, panel: WorkspacePanel) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = panel === 'media' ? leftPanelWidth : panel === 'inspector' ? rightPanelWidth : timelineHeight;
    const onMove = (moveEvent: PointerEvent) => {
      if (panel === 'media') {
        setLeftPanelWidth(resizeWorkspacePanel(startSize, moveEvent.clientX - startX, 1, 180, Math.min(640, window.innerWidth - 420)));
      } else if (panel === 'inspector') {
        setRightPanelWidth(resizeWorkspacePanel(startSize, moveEvent.clientX - startX, -1, 220, Math.min(720, window.innerWidth - 420)));
      } else {
        setTimelineHeight(resizeWorkspacePanel(startSize, moveEvent.clientY - startY, -1, 180, Math.max(220, window.innerHeight - 160)));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [leftPanelWidth, rightPanelWidth, timelineHeight]);

  const resizeWorkspaceFromKeyboard = useCallback((panel: WorkspacePanel, delta: number) => {
    if (panel === 'media') setLeftPanelWidth((size) => clampWorkspaceSize(size + delta, 180, Math.min(640, window.innerWidth - 420)));
    else if (panel === 'inspector') setRightPanelWidth((size) => clampWorkspaceSize(size + delta, 220, Math.min(720, window.innerWidth - 420)));
    else setTimelineHeight((size) => clampWorkspaceSize(size + delta, 180, Math.max(220, window.innerHeight - 160)));
  }, []);

  const selectEditorItem = useCallback((next: EditorSelection, subtitleTrack: 'tts' | 'subtitle' = 'subtitle') => {
    setSelection(next);
    setInspectorTab(inspectorTabForSelection(next));
    // Selection is arrangement, not editing: desktop expands a collapsed Inspector
    // so context is visible, but the mobile sheet only opens on an explicit request.
    if (next) setRightPanelCollapsed(false);
    setSelectedAudioSegmentId(next?.kind === 'background-audio' ? next.id : null);
    setEditingSubtitleId(next?.kind === 'subtitle' ? next.id : null);
    if (next?.kind === 'subtitle') setSelectedSubtitleTrack(subtitleTrack);
    setSelectedOverlayId(next?.kind === 'image'
      ? next.id
      : next?.kind === 'effect' && next.id.startsWith('overlay:') ? next.id.slice(8) : null);
    setEditingTextId(next?.kind === 'effect' && next.id.startsWith('text:') ? next.id.slice(5) : null);
  }, []);


  const undo = useCallback(() => {
    undoHistoryAction();
    selectEditorItem(null);
  }, [selectEditorItem, undoHistoryAction]);

  const redo = useCallback(() => {
    redoHistoryAction();
    selectEditorItem(null);
  }, [redoHistoryAction, selectEditorItem]);
  const selectVideoClip = useCallback((clipId: string, kind: 'video' | 'source-audio' = 'video') => {
    replaceState((current) => current.activeClipId === clipId ? current : { ...current, activeClipId: clipId });
    selectEditorItem({ kind, id: clipId });
  }, [replaceState, selectEditorItem]);

  const selectTimelineTimedItem = useCallback((track: TimelineTimedTrack, id: string | null) => {
    if (!id) {
      selectEditorItem(null);
      return;
    }
    if (track === 'subtitle' || track === 'tts') {
      selectEditorItem({ kind: 'subtitle', id }, track);
      return;
    }
    if (track === 'image') {
      selectEditorItem({ kind: 'image', id });
      return;
    }
    selectEditorItem({ kind: 'effect', id });
  }, [selectEditorItem]);

  const moveTimelineTimedItem = useCallback((track: TimelineTimedTrack, id: string, targetStart: number) => {
    replaceState((current) => {
      const duration = getProjectDurationSpeedAware(current.clips);
      if (track === 'subtitle' || track === 'tts') return {
        ...current,
        subtitles: current.subtitles.map((cue) => cue.id === id ? { ...cue, ...moveTimedRange(cue.startTime, cue.endTime, targetStart, duration) } : cue),
      };
      const rawId = id.startsWith('text:') ? id.slice(5) : id.startsWith('overlay:') ? id.slice(8) : id;
      if (track === 'effect' && id.startsWith('text:')) return {
        ...current,
        textOverlays: current.textOverlays.map((overlay) => overlay.id === rawId ? { ...overlay, ...moveTimedRange(overlay.startTime, overlay.endTime, targetStart, duration) } : overlay),
      };
      return {
        ...current,
        visualOverlays: current.visualOverlays.map((overlay) => overlay.id === rawId ? { ...overlay, ...moveTimedRange(overlay.startTime, overlay.endTime, targetStart, duration) } as VisualOverlay : overlay),
      };
    });
  }, [replaceState]);

  // ─── Import ──────────────────────────────────────────────────────────────

  const importFiles = useCallback(async (files: File[]) => {
    if (importingRef.current) {
      setToast({ kind: 'error', message: t('import_in_progress') });
      return;
    }
    const videos = files.filter((file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(file.name));
    if (!videos.length) {
      setToast({ kind: 'error', message: t('invalid_file') });
      return;
    }
    const seen = new Set(state.clips.map((clip) => fileIdentity(clip.file)));
    const uniqueFiles = videos.filter((file) => {
      const identity = fileIdentity(file);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const skipped = videos.length - uniqueFiles.length;
    if (!uniqueFiles.length) {
      setToast({ kind: 'error', message: t('duplicate_files') });
      return;
    }

    const validClips: Clip[] = [];
    let failed = 0;
    importingRef.current = true;
    setImportProgress({ current: 0, total: uniqueFiles.length, name: uniqueFiles[0].name });
    try {
      for (const [index, file] of uniqueFiles.entries()) {
        setImportProgress({ current: index + 1, total: uniqueFiles.length, name: file.name });
        const url = createTrackedUrl(file);
        try {
          const duration = await getVideoDuration(url);
          validClips.push({
            id: crypto.randomUUID(), url, name: file.name, duration,
            trimStart: 0, trimEnd: duration, file,
            volume: 100, muted: false, rotation: 0, flipH: false, flipV: false,
            speed: 1.0, displayName: file.name,
          });
        } catch {
          failed += 1;
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
        }
      }
      if (!validClips.length) {
        setToast({ kind: 'error', message: t('invalid_file') });
        return;
      }
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);

      // If no project exists, create one
      if (!currentProjectId) {
        const newProject = await createDraft(t('untitled'), editorStateToDraft(DEFAULT_STATE));
        setCurrentProjectId(newProject.id);
        setProjects((p) => [newProject, ...p]);
      }

      updateState((current) => ({
        ...current,
        clips: [...current.clips, ...validClips],
        activeClipId: current.activeClipId ?? validClips[0].id,
      }));
      setToast({
        kind: 'success',
        message: t('import_complete', { imported: validClips.length, skipped, failed }),
      });
      setMobilePanel((current) => {
        if (current === 'media') window.requestAnimationFrame(() => mediaTriggerRef.current?.focus());
        return null;
      });
    } finally {
      importingRef.current = false;
      setImportProgress(null);
    }
  }, [createTrackedUrl, currentProjectId, state.clips, t, updateState]);

  // ─── Background Audio Import ─────────────────────────────────────────────

  const importBackgroundAudio = useCallback(async (file: File, replaceSource = false) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.name)) {
      setToast({ kind: 'error', message: t('invalid_audio') });
      return;
    }
    if (state.backgroundMusic && !replaceSource && !window.confirm(t('confirm_replace_audio'))) return;
    videoRef.current?.pause();
    backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
    setIsPlaying(false);
    const url = createTrackedUrl(file);

    // Read the real source duration from local metadata (no upload).
    let duration = 0;
    try {
      duration = await getAudioDuration(url);
    } catch {
      duration = 0; // Unknown; will be hydrated later.
    }
    const effectiveDuration = duration > 0 ? duration : 0;

    // Replace only the source File/duration, keeping every existing segment
    // (re-clamped to the new source length). Used by the "replace source" action.
    if (replaceSource && state.backgroundMusic) {
      updateState((current) => {
        const track = current.backgroundMusic;
        if (!track) return current;
        const clampDuration = effectiveDuration > 0 ? effectiveDuration : (track.duration || 0.01);
        const segments = track.segments.map((s) =>
          effectiveDuration > 0 ? clampAudioSegmentToSource(s, clampDuration) : s,
        );
        return {
          ...current,
          backgroundMusic: { ...track, name: file.name, file, url, duration: effectiveDuration, segments },
        };
      });
      return;
    }

    // Segment starts at the current playhead (project time), clamped so it does
    // not exceed the project timeline. With no clips, start at 0.
    const projectDuration = getProjectDurationSpeedAware(state.clips);
    let projectStart = Math.max(0, previewProjectTime);
    if (projectDuration > 0 && effectiveDuration > 0) {
      projectStart = Math.max(0, Math.min(projectStart, Math.max(0, projectDuration - effectiveDuration)));
    } else if (projectDuration > 0) {
      projectStart = Math.max(0, Math.min(projectStart, projectDuration));
    }

    const segment: AudioTrackSegment = {
      id: crypto.randomUUID(),
      projectStart,
      trimStart: 0,
      trimEnd: effectiveDuration,
      volume: 80,
      fadeIn: 0,
      fadeOut: 0,
    };
    const newTrackId = segment.id;

    updateState((current) => ({
      ...current,
      backgroundMusic: {
        name: file.name, file, url,
        duration: effectiveDuration,
        replaceOriginalAudio: current.backgroundMusic?.replaceOriginalAudio ?? false,
        segments: [segment],
      },
    }));
    selectEditorItem({ kind: 'background-audio', id: newTrackId });
  }, [createTrackedUrl, previewProjectTime, selectEditorItem, state.clips, state.backgroundMusic, t, updateState]);

  // ─── Clip Actions ────────────────────────────────────────────────────────

  const removeClip = useCallback((id: string) => {
    updateState((current) => {
      const index = current.clips.findIndex((clip) => clip.id === id);
      if (index < 0) return current;
      // NOTE (B1): Do NOT revoke the object URL here — the clip may be
      // restored via undo. URLs are revoked on project switch/teardown.
      const clips = current.clips.filter((clip) => clip.id !== id);
      const activeClipId = current.activeClipId === id
        ? (clips[Math.min(index, clips.length - 1)]?.id ?? null)
        : current.activeClipId;
      // Clean up transitions referencing removed clip
      const transitions = current.transitions.filter((tr) => tr.afterClipId !== id);
      return { ...current, clips, activeClipId, transitions };
    });
    if ((selection?.kind === 'video' || selection?.kind === 'source-audio') && selection.id === id) selectEditorItem(null);
  }, [selectEditorItem, selection, updateState]);

  const moveClip = useCallback((id: string, direction: -1 | 1) => {
    updateState((current) => {
      const index = current.clips.findIndex((clip) => clip.id === id);
      const clips = moveClipToIndex(current.clips, id, index + direction);
      return clips === current.clips ? current : {
        ...current,
        clips,
        transitions: current.transitions.filter((transition) => transition.afterClipId !== clips.at(-1)?.id),
      };
    });
  }, [updateState]);

  const reorderClip = useCallback((id: string, targetIndex: number) => {
    videoRef.current?.pause();
    backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
    setIsPlaying(false);
    updateState((current) => {
      const clips = moveClipToIndex(current.clips, id, targetIndex);
      return clips === current.clips ? current : {
        ...current,
        clips,
        transitions: current.transitions.filter((transition) => transition.afterClipId !== clips.at(-1)?.id),
      };
    });
  }, [updateState]);

  const duplicateClipById = useCallback((id: string) => {
    const newId = crypto.randomUUID();
    updateState((current) => {
      const clips = duplicateClip(current.clips, id, newId);
      return clips === current.clips ? current : { ...current, clips, activeClipId: newId };
    });
  }, [updateState]);

  const splitActiveClip = useCallback(() => {
    if (!activeClip || !canSplit) {
      setToast({ kind: 'error', message: t('split_unavailable') });
      return;
    }
    videoRef.current?.pause();
    backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
    setIsPlaying(false);
    const newId = crypto.randomUUID();
    updateState((current) => {
      if (current.activeClipId !== activeClip.id) return current;
      const result = splitClipWithTransition(current.clips, current.transitions, activeClip.id, currentTime, newId);
      return result.clips === current.clips ? current : {
        ...current,
        clips: result.clips,
        transitions: result.transitions,
        activeClipId: newId,
      };
    });
    selectEditorItem({ kind: selection?.kind === 'source-audio' ? 'source-audio' : 'video', id: newId });
  }, [activeClip, canSplit, currentTime, selectEditorItem, selection?.kind, t, updateState]);

  // ─── Audio Track Segment Actions ──────────────────────────────────────────

  /**
   * Split the audio-track segment covering the given project time. The right
   * half reuses the same source File (segments only reference offsets into the
   * one track File), so no additional media is written.
   */
  const splitAudioSegmentAt = useCallback((segmentId: string, projectTime: number) => {
    const source = state.backgroundMusic?.segments.find((segment) => segment.id === segmentId);
    if (!source) return;
    const rightId = crypto.randomUUID();
    const split = splitAudioSegment(source, projectTime, rightId);
    if (!split) return;
    updateState((current) => {
      const track = current.backgroundMusic;
      if (!track || !track.segments.some((segment) => segment.id === segmentId)) return current;
      const segments = track.segments.flatMap((segment) => segment.id === segmentId ? split : [segment]);
      return { ...current, backgroundMusic: { ...track, segments } };
    });
    selectEditorItem({ kind: 'background-audio', id: rightId });
  }, [selectEditorItem, state.backgroundMusic, updateState]);


  const splitAtPlayhead = useCallback(() => {
    if (!canContextSplit) {
      setToast({ kind: 'error', message: t('split_unavailable') });
      return;
    }
    if (selection?.kind === 'background-audio') {
      splitAudioSegmentAt(selection.id, previewProjectTime);
      return;
    }
    splitActiveClip();
  }, [canContextSplit, previewProjectTime, selection, splitActiveClip, splitAudioSegmentAt, t]);
  /** Add another full-source segment at a requested project time. */
  const addAudioSegment = useCallback((requestedStart = previewProjectTime) => {
    const id = crypto.randomUUID();
    updateState((current) => {
      const track = current.backgroundMusic;
      if (!track || track.duration <= 0) return current;
      const projectDuration = getProjectDurationSpeedAware(current.clips);
      const projectStart = Math.max(0, Math.min(requestedStart, projectDuration || requestedStart));
      const segment: AudioTrackSegment = {
        id,
        projectStart,
        trimStart: 0,
        trimEnd: track.duration,
        volume: 80,
        fadeIn: 0,
        fadeOut: 0,
      };
      return { ...current, backgroundMusic: { ...track, segments: [...track.segments, segment] } };
    });
    const currentTrack = state.backgroundMusic;
    if (isPlaying && currentTrack?.url) {
      const audio = new Audio(currentTrack.url);
      audio.loop = true;
      audio.volume = 0;
      audio.currentTime = 0;
      backgroundAudioPoolRef.current.set(id, audio);
      void audio.play().catch(() => setToast({ kind: 'error', message: t('audio_preview_blocked') }));
    }
    selectEditorItem({ kind: 'background-audio', id });
  }, [isPlaying, previewProjectTime, selectEditorItem, state.backgroundMusic, t, updateState]);

  /** Delete a segment from the audio track by id. */
  const deleteAudioSegment = useCallback((segmentId: string) => {
    updateState((current) => {
      const track = current.backgroundMusic;
      if (!track) return current;
      const segments = track.segments.filter((s) => s.id !== segmentId);
      return { ...current, backgroundMusic: { ...track, segments } };
    });
  }, [updateState]);

  /**
   * Move a segment along the project timeline. Persists `projectStart` in
   * project seconds (>= 0), not pixels. Uses replaceState so a continuous drag
   * or a run of keyboard nudges collapses into a single history checkpoint
   * (see beginContinuousEdit/finishContinuousEdit wired on the Timeline).
   */
  const moveAudioSegment = useCallback((segmentId: string, projectStart: number) => {
    const next = Math.max(0, Number.isFinite(projectStart) ? projectStart : 0);
    replaceState((current) => {
      const track = current.backgroundMusic;
      if (!track) return current;
      const segments = track.segments.map((s) =>
        s.id === segmentId ? { ...s, projectStart: next } : s,
      );
      return { ...current, backgroundMusic: { ...track, segments } };
    });
  }, [replaceState]);

  const selectAudioSegment = useCallback((segmentId: string | null) => {
    selectEditorItem(segmentId ? { kind: 'background-audio', id: segmentId } : null);
  }, [selectEditorItem]);

  /**
   * Transient segment edit used by continuous inspector controls (sliders).
   * Uses replaceState so a slider drag collapses into a single history entry
   * via beginContinuousEdit/finishContinuousEdit.
   */
  const editAudioSegmentTransient = useCallback((segmentId: string, patch: Partial<AudioTrackSegment>) => {
    replaceState((current) => {
      const track = current.backgroundMusic;
      if (!track) return current;
      const segments = track.segments.map((s) =>
        s.id === segmentId
          ? clampAudioSegmentToSource({ ...s, ...patch }, track.duration || (s.trimEnd || 0.01))
          : s,
      );
      return { ...current, backgroundMusic: { ...track, segments } };
    });
  }, [replaceState]);

  // Keep the selected segment id valid as segments change (delete/undo).
  // Derived at render (see `effectiveSelectedAudioSegmentId`) rather than via an
  // effect, to avoid a cascading setState-in-effect.

  /**
   * Hydrate legacy/unknown audio tracks whose `duration` is 0 (imported before
   * duration metadata existed, or migrated from the legacy background-music
   * model). Reads the real source duration from the local object URL and patches
   * the track + any zero-length segments via replaceState (no new history entry).
   */
  const hydratingAudioRef = useRef(false);
  useEffect(() => {
    const track = state.backgroundMusic;
    if (!track || hydratingAudioRef.current) return;
    if (track.duration > 0 || !track.url) return;
    hydratingAudioRef.current = true;
    let cancelled = false;
    void getAudioDuration(track.url)
      .then((duration) => {
        if (cancelled || !(duration > 0)) return;
        replaceState((current) => {
          const cur = current.backgroundMusic;
          if (!cur || cur.duration > 0) return current;
          const segments = cur.segments.map((s) =>
            clampAudioSegmentToSource(
              { ...s, trimEnd: s.trimEnd > 0 ? s.trimEnd : duration },
              duration,
            ),
          );
          return { ...current, backgroundMusic: { ...cur, duration, segments } };
        });
      })
      .catch(() => { /* leave duration unknown */ })
      .finally(() => { hydratingAudioRef.current = false; });
    return () => { cancelled = true; };
  }, [state.backgroundMusic, replaceState]);

  const renameClip = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    updateState((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === id ? { ...clip, displayName: newName.trim() } : clip),
    }));
    setRenamingClipId(null);
  }, [updateState]);


  const cancelAutoTtsForSeek = useCallback(() => {
    if (ttsModeRef.current !== 'auto' && !lastTtsCueIdRef.current) return;
    ttsRequestIdRef.current += 1;
    ttsBufferSourceRef.current?.stop();
    ttsBufferSourceRef.current = null;
    localTtsAudioRef.current?.pause();
    localTtsAudioRef.current = null;
    ttsModeRef.current = null;
    lastTtsCueIdRef.current = null;
    setTtsPlaying(false);
  }, []);
  // ─── Playback ────────────────────────────────────────────────────────────

  const seekTimeline = useCallback((clipId: string, sourceTime: number) => {
    cancelAutoTtsForSeek();
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const target = Math.max(clip.trimStart, Math.min(clip.trimEnd, sourceTime));
    if (clipId === activeClip?.id && videoRef.current) {
      videoRef.current.currentTime = target;
      setCurrentTime(target);
      return;
    }
    pendingSeekRef.current = { clipId, sourceTime: target };
    continuePlaybackRef.current = isPlaying;
    replaceState((current) => ({ ...current, activeClipId: clipId }));
  }, [activeClip?.id, cancelAutoTtsForSeek, isPlaying, replaceState, state.clips]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    if (video.paused) {
      if (typeof AudioContext !== 'undefined') {
        const context = ttsAudioContextRef.current ?? new AudioContext();
        ttsAudioContextRef.current = context;
        void context.resume();
      }
      if (video.currentTime < activeClip.trimStart || video.currentTime >= activeClip.trimEnd) {
        video.currentTime = activeClip.trimStart;
      }
      const track = state.backgroundMusic;
      if (track?.url) {
        track.segments.forEach((segment) => {
          const audio = backgroundAudioPoolRef.current.get(segment.id) ?? new Audio(track.url);
          backgroundAudioPoolRef.current.set(segment.id, audio);
          const duration = segment.trimEnd - segment.trimStart;
          const active = previewProjectTime >= segment.projectStart && previewProjectTime < segment.projectStart + duration;
          audio.loop = true;
          audio.currentTime = Math.max(0, active ? segment.trimStart + previewProjectTime - segment.projectStart : segment.trimStart);
          audio.volume = active ? Math.max(0, Math.min(1, backgroundAudioGainAtTime(segment, previewProjectTime) * state.masterVolume / 100)) : 0;
          audio.playbackRate = Math.max(0.25, Math.min(4, state.playbackSpeed));
          void audio.play().catch(() => setToast({ kind: 'error', message: t('audio_preview_blocked') }));
        });
      }
      void video.play().then(() => setIsPlaying(true)).catch(() => {
        backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
        setIsPlaying(false);
      });
    } else {
      video.pause();
      backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
      setIsPlaying(false);
    }
  }, [activeClip, previewProjectTime, state.backgroundMusic, state.masterVolume, state.playbackSpeed, t]);

  const seek = useCallback((seconds: number) => {
    cancelAutoTtsForSeek();
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.currentTime = Math.min(activeClip.trimEnd, Math.max(activeClip.trimStart, video.currentTime + seconds));
    setCurrentTime(video.currentTime);
  }, [activeClip, cancelAutoTtsForSeek]);

  // ─── Fullscreen ──────────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(async () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    try {
      if (document.fullscreenElement === canvas) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) await document.exitFullscreen();
      await canvas.requestFullscreen();
    } catch {
      // Fullscreen may be rejected when it is not initiated by a user gesture.
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === previewCanvasRef.current);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // H4: Apply clip volume * master volume to preview (HTML volume caps at 1.0)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    if (activeClip.muted || state.backgroundMusic?.replaceOriginalAudio) {
      video.volume = 0;
    } else {
      const effective = (activeClip.volume / 100) * (state.masterVolume / 100);
      video.volume = Math.min(1.0, Math.max(0, effective));
    }
  }, [activeClip, state.backgroundMusic?.replaceOriginalAudio, state.masterVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.playbackRate = Math.max(0.0625, Math.min(16, (activeClip.speed || 1) * state.playbackSpeed));
  }, [activeClip, state.playbackSpeed]);



  useEffect(() => {
    const track = state.backgroundMusic;
    if (!isPlaying || !track?.url) {
      backgroundAudioPoolRef.current.forEach((audio) => audio.pause());
      return;
    }

    const validIds = new Set(track.segments.map((segment) => segment.id));
    backgroundAudioPoolRef.current.forEach((audio, id) => {
      if (!validIds.has(id)) {
        audio.pause();
        backgroundAudioPoolRef.current.delete(id);
      }
    });

    track.segments.forEach((segment) => {
      const audio = backgroundAudioPoolRef.current.get(segment.id) ?? new Audio(track.url);
      backgroundAudioPoolRef.current.set(segment.id, audio);
      const duration = segment.trimEnd - segment.trimStart;
      const active = previewProjectTime >= segment.projectStart && previewProjectTime < segment.projectStart + duration;
      audio.loop = true;
      audio.playbackRate = Math.max(0.25, Math.min(4, state.playbackSpeed));
      if (active) {
        const sourceTime = segment.trimStart + (previewProjectTime - segment.projectStart);
        if (!Number.isFinite(audio.duration) || Math.abs(audio.currentTime - sourceTime) > 0.2) audio.currentTime = Math.max(0, sourceTime);
        audio.volume = Math.max(0, Math.min(1, backgroundAudioGainAtTime(segment, previewProjectTime) * state.masterVolume / 100));
      } else {
        audio.volume = 0;
      }
      if (audio.paused) void audio.play().catch(() => undefined);
    });
  }, [isPlaying, previewProjectTime, state.backgroundMusic, state.masterVolume, state.playbackSpeed]);
  // ─── FFmpeg & Export ─────────────────────────────────────────────────────

  const ensureFfmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (ffmpegLoadRef.current) return ffmpegLoadRef.current;

    const instance = new FFmpeg();
    ffmpegRef.current = instance;
    instance.on('progress', ({ progress: value }) => setProgress(Math.max(0, Math.min(100, value * 100))));

    const loadPromise = (async () => {
      const { coreURL, wasmURL } = getFfmpegCoreAssetUrls(
        process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL,
      );
      await instance.load({
        coreURL: await toBlobURL(coreURL, 'text/javascript'),
        wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      });
      return instance;
    })();
    ffmpegLoadRef.current = loadPromise;

    try {
      return await loadPromise;
    } catch (error) {
      if (ffmpegRef.current === instance) ffmpegRef.current = null;
      instance.terminate();
      throw error;
    } finally {
      ffmpegLoadRef.current = null;
    }
  }, []);

  const handleExport = useCallback(async (format: 'mp4' | 'webm') => {
    if (!state.clips.length || processing) return;
    const effectiveEnd = Math.min(state.exportSettings.rangeEnd ?? projectDurationSpeedAware, projectDurationSpeedAware);
    const requestedStart = Math.max(0, Math.min(state.exportSettings.rangeStart, projectDurationSpeedAware));
    const effectiveStart = requestedStart < effectiveEnd ? requestedStart : 0;
    if (effectiveEnd <= effectiveStart) return;

    setProcessing(true);
    setProcessingStage('loading');
    setProgress(0);
    cancelRequestedRef.current = false;
    let engine: FFmpeg | null = null;
    const temporaryFiles: string[] = [];

    try {
      engine = await ensureFfmpeg();
      if (cancelRequestedRef.current) return;
      setProcessingStage('preparing');

      const selectedClips = selectClipsForExportSpeedAware(state.clips, {
        start: effectiveStart,
        end: effectiveEnd,
      });
      const metadata: ExtendedClipMetadata[] = [];

      for (const [index, clip] of selectedClips.entries()) {
        if (cancelRequestedRef.current) return;
        const extension = clip.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'mp4';
        const filename = `input-${index}.${extension}`;
        const probeName = `probe-${index}.txt`;
        temporaryFiles.push(filename, probeName);
        await engine.writeFile(filename, await fetchFile(clip.file));
        const probeCode = await engine.ffprobe([
          '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type',
          '-of', 'default=noprint_wrappers=1:nokey=1', filename, '-o', probeName,
        ]);
        if (probeCode !== 0) throw new Error(`FFprobe exited with code ${probeCode}`);
        let hasAudio = false;
        try {
          const probeData = await engine.readFile(probeName);
          hasAudio = typeof probeData !== 'string'
            && new TextDecoder().decode(probeData).trim() === 'audio';
        } catch {
          // ffprobe can omit the output file when no matching audio stream exists.
        }
        metadata.push(clipToExtendedMetadata(clip, filename, hasAudio));
      }

      // Write background audio-track source (once) and build per-segment inputs.
      let audioTrackInputs: AudioTrackInput[] = [];
      const track = state.backgroundMusic;
      const audioTrackReplaceOriginal = track?.replaceOriginalAudio === true;
      if (track?.file && track.segments.length > 0) {
        const bgExt = track.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'mp3';
        const bgFilename = `bg-audio.${bgExt}`;
        // Source File is written to MEMFS exactly once.
        temporaryFiles.push(bgFilename);
        await engine.writeFile(bgFilename, await fetchFile(track.file));

        const exportSegments = selectAudioSegmentsForExport(
          track.segments,
          effectiveStart,
          effectiveEnd,
        );
        // First audio-track input index is right after the video clips.
        const audioBaseIndex = metadata.length;
        audioTrackInputs = exportSegments.map((seg, i): AudioTrackInput => ({
          filename: bgFilename,
          inputIndex: audioBaseIndex + i,
          startTime: seg.startTime,
          endTime: seg.endTime,
          sourceTrimStart: seg.sourceTrimStart,
          sourceTrimEnd: seg.sourceTrimEnd,
          volume: seg.volume,
          fadeIn: seg.fadeIn,
          fadeOut: seg.fadeOut,
        }));
      }

      if (cancelRequestedRef.current) return;
      setProcessingStage('rendering');
      const profile = resolveExportProfile(state.exportSettings);
      const outputName = `output.${format}`;
      temporaryFiles.push(outputName);
      const exportTextOverlays = selectTextOverlaysForExport(
        state.textOverlays,
        effectiveStart,
        effectiveEnd,
      );

      // Write each required bundled font into MEMFS for drawtext.
      if (exportTextOverlays.length > 0) {
        const fontFiles = {
          sans: '/fonts/DejaVuSans.ttf',
          serif: '/fonts/DejaVuSerif.ttf',
          mono: '/fonts/DejaVuSansMono.ttf',
        } as const;
        await engine.createDir('/fonts').catch(() => undefined);
        for (const family of new Set(exportTextOverlays.map((overlay) => overlay.fontFamily))) {
          const fontPath = fontFiles[family];
          const fontResponse = await fetch(fontPath);
          if (!fontResponse.ok) throw new Error(`Could not load bundled font: ${family}`);
          await engine.writeFile(fontPath, new Uint8Array(await fontResponse.arrayBuffer()));
          temporaryFiles.push(fontPath);
        }
      }

      // Use buildFFmpegCommandExtended with all new features
      // Render visual overlays AND subtitles to PNGs
      const overlayPngs: import('@/lib/ffmpeg-utils').PngOverlayInput[] = [];
      if (state.visualOverlays.length > 0 || state.subtitles.length > 0) {
        const { computeCanvasDimensions } = await import('@/lib/editor-utils');
        const canvasDims = computeCanvasDimensions(state.canvasAspect, state.exportSettings.resolution);
        const rendered = await renderOverlaysToPng(state.visualOverlays, {
          width: canvasDims.width,
          height: canvasDims.height,
          rangeStart: effectiveStart,
          rangeEnd: effectiveEnd,
        }, state.subtitles);
        for (const png of rendered) {
          if (cancelRequestedRef.current) return;
          await engine.writeFile(png.filename, png.data);
          temporaryFiles.push(png.filename);
          overlayPngs.push({ filename: png.filename, startTime: png.startTime, endTime: png.endTime });
        }
      }

      // ─── TTS WAV generation ───────────────────────────────────────────
      const ttsAudioInputs: TtsAudioInput[] = [];
      const ttsCues = selectTtsCuesForExport(state.subtitles, effectiveStart, effectiveEnd);
      if (ttsCues.length > 0) {
        if (cancelRequestedRef.current) return;
        setProcessingStage('tts');
        const { synthesize: synthLocal } = await import('@/lib/local-tts');

        for (let i = 0; i < ttsCues.length; i++) {
          if (cancelRequestedRef.current) return;
          const ttsCue = ttsCues[i];
          setProgress(Math.round(((i) / ttsCues.length) * 100));

          // Check in-memory cache first
          const cacheKey = getTtsCacheKey(ttsCue.text, ttsCue.voiceId, ttsCue.rate);
          let wavBlob = localTtsCacheRef.current.get(cacheKey);
          if (!wavBlob) {
            wavBlob = await synthLocal(ttsCue.text, ttsCue.voiceId as LocalTtsVoiceId, (ev) => {
              const base = (i / ttsCues.length) * 100;
              const slice = (1 / ttsCues.length) * 100;
              setProgress(Math.round(base + ev.progress * slice));
            });
            localTtsCacheRef.current.set(cacheKey, wavBlob);
          }

          const ttsFilename = `tts-${i}.wav`;
          temporaryFiles.push(ttsFilename);
          const wavData = new Uint8Array(await wavBlob.arrayBuffer());
          await engine.writeFile(ttsFilename, wavData);

          ttsAudioInputs.push({
            filename: ttsFilename,
            startTime: ttsCue.startTime,
            endTime: ttsCue.endTime,
            sourceTrimStart: ttsCue.sourceTrimStart,
            rate: ttsCue.rate,
            volume: ttsCue.volume,
          });
        }
        setProgress(100);
      }

      if (cancelRequestedRef.current) return;
      setProcessingStage('rendering');

      const exitCode = await engine.exec(
        buildFFmpegCommandExtended(
          metadata,
          state.filters,
          state.audioDelay,
          state.audioFade,
          format,
          profile,
          state.masterVolume,
          state.canvasAspect,
          state.canvasFit,
          state.transitions,
          exportTextOverlays,
          null,
          undefined,
          overlayPngs,
          ttsAudioInputs,
          audioTrackInputs,
          audioTrackReplaceOriginal,
        ),
      );
      if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
      const data = await engine.readFile(outputName);
      if (typeof data === 'string') throw new Error('Unexpected text output');
      const url = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: `video/${format}` }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cutfish-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setToast({ kind: 'success', message: t('success') });
    } catch (error) {
      if (!cancelRequestedRef.current) {
        console.error('Export failed', error);
        setToast({ kind: 'error', message: engine ? t('error') : t('engine_error') });
      }
    } finally {
      if (engine && !cancelRequestedRef.current) {
        for (const filename of temporaryFiles) {
          await engine.deleteFile(filename).catch(() => undefined);
        }
        await engine.deleteDir('/fonts').catch(() => undefined);
      }
      setProcessing(false);
      setProgress(0);
      window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
    }
  }, [ensureFfmpeg, processing, projectDurationSpeedAware, state, t]);

  const cancelExport = useCallback(() => {
    cancelRequestedRef.current = true;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    ffmpegLoadRef.current = null;
    setProcessing(false);
    setProgress(0);
  }, []);

  // ─── Export Modal ────────────────────────────────────────────────────────

  const closeExportModal = useCallback(() => {
    setExportModalOpen(false);
    window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
  }, []);

  const openHelpModal = useCallback(() => { setOverflowMenuOpen(false); setMobilePanel(null); setShowHelpModal(true); }, []);
  const closeHelpModal = useCallback(() => {
    setShowHelpModal(false);
    window.requestAnimationFrame(() => (helpTriggerRef.current ?? overflowTriggerRef.current)?.focus());
  }, []);
  const openProjectManager = useCallback(() => {
    setOverflowMenuOpen(false); setMobilePanel(null);
    void refreshProjectsRef.current?.();
    setShowProjectManager(true);
  }, []);
  const closeProjectManager = useCallback(() => {
    setShowProjectManager(false);
    window.requestAnimationFrame(() => (projectTriggerRef.current ?? overflowTriggerRef.current)?.focus());
  }, []);

  const openMobilePanel = useCallback((panel: 'media' | 'inspector') => {
    setOverflowMenuOpen(false);
    setMobilePanel(panel);
  }, []);
  const closeMobilePanel = useCallback(() => {
    setMobilePanel((current) => {
      const trigger = current === 'media' ? mediaTriggerRef.current : current === 'inspector' ? inspectorTriggerRef.current : null;
      if (trigger) window.requestAnimationFrame(() => trigger.focus());
      return null;
    });
  }, []);

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLElement>, ref: React.RefObject<HTMLElement | null>) => {
    if (event.key !== 'Tab') return;
    const candidates = ref.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const focusable = candidates
      ? Array.from(candidates).filter((element) => element.getClientRects().length > 0)
      : [];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === ref.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!exportModalOpen) return;
    const frame = window.requestAnimationFrame(() => exportDialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [exportModalOpen]);

  // M2: Initial focus for help modal
  useEffect(() => {
    if (!showHelpModal) return;
    const frame = window.requestAnimationFrame(() => helpDialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showHelpModal]);

  // M2: Initial focus for project manager modal
  useEffect(() => {
    if (!showProjectManager) return;
    const frame = window.requestAnimationFrame(() => projectDialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showProjectManager]);

  // Mobile sheets act as dialogs: move focus into the sheet when it opens.
  useEffect(() => {
    if (!mobilePanel) return;
    const sheet = mobilePanel === 'media' ? mediaSheetRef.current : inspectorSheetRef.current;
    if (!sheet) return;
    const frame = window.requestAnimationFrame(() => sheet.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mobilePanel]);

  // Overflow menu dismisses on outside pointer down.
  useEffect(() => {
    if (!overflowMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!overflowMenuRef.current?.contains(event.target as Node)) setOverflowMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [overflowMenuOpen]);

  // ─── Project Manager ─────────────────────────────────────────────────────

  const refreshProjects = useCallback(async () => {
    const all = await listDrafts();
    setProjects(all);
  }, []);
  useEffect(() => { refreshProjectsRef.current = refreshProjects; }, [refreshProjects]);

  // H2/H3: Force-save current project state to avoid stale data races
  const forceSaveCurrentProject = useCallback(async () => {
    if (!currentProjectId || !draftReady) return;
    if (continuousEditRef.current) {
      checkpoint(continuousEditRef.current);
      continuousEditRef.current = null;
    }
    savingRef.current = true;
    try {
      await persistProject(currentProjectId, editorStateToDraft(state));
      setSaveStatus('saved');
      setLastSavedTime(Date.now());
    } catch {
      setSaveStatus('error');
    } finally {
      savingRef.current = false;
    }
  }, [checkpoint, currentProjectId, draftReady, persistProject, state]);

  const handleNewProject = useCallback(async () => {
    await forceSaveCurrentProject();
    const name = projectNameInput.trim() || t('untitled');
    const project = await createDraft(name, editorStateToDraft(DEFAULT_STATE));
    setCurrentProjectId(project.id);
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    reset(DEFAULT_STATE);
    selectEditorItem(null);
    setProjectNameInput('');
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_created') });
    closeProjectManager();
  }, [closeProjectManager, forceSaveCurrentProject, projectNameInput, refreshProjects, reset, selectEditorItem, t]);

  const handleSwitchProject = useCallback(async (id: string) => {
    if (id === currentProjectId) return;
    await forceSaveCurrentProject();
    const project = await loadDraft(id);
    if (!project) return;
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    setCurrentProjectId(project.id);
    const editorState = draftToEditorState(project.state, createTrackedUrl);
    reset(editorState);
    selectEditorItem(null);
    setToast({ kind: 'success', message: t('project_switched') });
    closeProjectManager();
  }, [closeProjectManager, createTrackedUrl, currentProjectId, forceSaveCurrentProject, reset, selectEditorItem, t]);

  const handleRenameProject = useCallback(async (id: string, newName: string) => {
    if (!newName.trim()) return;
    await renameDraft(id, newName.trim());
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_renamed') });
  }, [refreshProjects, t]);

  const handleDuplicateProject = useCallback(async (id: string) => {
    const source = await loadDraft(id);
    if (!source) return;
    await createDraft(`${source.name} (copy)`, source.state);
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_duplicated') });
  }, [refreshProjects, t]);

  const handleDeleteProject = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete'))) return;
    if (id === currentProjectId) {
      await forceSaveCurrentProject();
    }
    await deleteDraft(id);
    if (id === currentProjectId) {
      const remaining = await listDrafts();
      if (remaining.length > 0) {
        await handleSwitchProject(remaining[0].id);
      } else {
        setCurrentProjectId(null);
        objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        objectUrlsRef.current.clear();
        reset(DEFAULT_STATE);
        selectEditorItem(null);
      }
    }
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_deleted') });
  }, [currentProjectId, forceSaveCurrentProject, handleSwitchProject, refreshProjects, reset, selectEditorItem, t]);

  // ─── Keyboard Shortcuts ──────────────────────────────────────────────────

  const deleteSelectedMaterial = useCallback(() => {
    if (!selection) {
      if (activeClip) removeClip(activeClip.id);
      return;
    }
    updateState((current) => {
      switch (selection.kind) {
        case 'video': {
          const index = current.clips.findIndex((clip) => clip.id === selection.id);
          if (index < 0) return current;
          const clips = current.clips.filter((clip) => clip.id !== selection.id);
          return {
            ...current,
            clips,
            activeClipId: clips[Math.min(index, clips.length - 1)]?.id ?? null,
            transitions: current.transitions.filter((transition) => transition.afterClipId !== selection.id),
          };
        }
        case 'source-audio':
          return { ...current, clips: current.clips.map((clip) => clip.id === selection.id ? { ...clip, muted: true } : clip) };
        case 'background-audio':
          return current.backgroundMusic ? { ...current, backgroundMusic: { ...current.backgroundMusic, segments: current.backgroundMusic.segments.filter((segment) => segment.id !== selection.id) } } : current;
        case 'subtitle':
          return selectedSubtitleTrack === 'tts'
            ? { ...current, subtitles: current.subtitles.map((cue) => cue.id === selection.id && cue.tts ? { ...cue, tts: { ...cue.tts, enabled: false } } : cue) }
            : { ...current, subtitles: current.subtitles.filter((cue) => cue.id !== selection.id) };
        case 'image':
          return { ...current, visualOverlays: current.visualOverlays.filter((overlay) => overlay.id !== selection.id) };
        case 'effect': {
          if (selection.id.startsWith('text:')) return { ...current, textOverlays: current.textOverlays.filter((overlay) => overlay.id !== selection.id.slice(5)) };
          if (selection.id.startsWith('overlay:')) return { ...current, visualOverlays: current.visualOverlays.filter((overlay) => overlay.id !== selection.id.slice(8)) };
          if (selection.id.startsWith('transition:')) return { ...current, transitions: current.transitions.filter((transition) => transition.afterClipId !== selection.id.slice(11)) };
          if (selection.id === 'filters:global') return { ...current, filters: { brightness: 100, contrast: 100, saturation: 100 } };
          return current;
        }
      }
    });
    selectEditorItem(null);
  }, [activeClip, removeClip, selectEditorItem, selectedSubtitleTrack, selection, updateState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, button, summary, [role="slider"], [contenteditable="true"]');

      if (event.code === 'Escape') {
        if (showHelpModal) { event.preventDefault(); closeHelpModal(); return; }
        if (showProjectManager) { event.preventDefault(); closeProjectManager(); return; }
        if (exportModalOpen) { event.preventDefault(); closeExportModal(); return; }
        if (overflowMenuOpen) { event.preventDefault(); setOverflowMenuOpen(false); window.requestAnimationFrame(() => overflowTriggerRef.current?.focus()); return; }
        if (mobilePanel) { event.preventDefault(); closeMobilePanel(); return; }
        if (overlayTool !== 'select') {
          event.preventDefault();
          drawingRef.current = { points: [], active: false };
          rectDrawRef.current = { startX: 0, startY: 0, active: false };
          setDraftPenPoints([]);
          setDraftRect(null);
          setOverlayTool('select');
          return;
        }
      }
      if (exportModalOpen || showHelpModal || showProjectManager) return;
      const timelineItemFocused = Boolean(target?.closest('[data-timeline-item]'));
      if (timelineItemFocused && !event.ctrlKey && !event.metaKey && event.code === 'KeyS') {
        event.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (timelineItemFocused && event.code === 'Delete') {
        event.preventDefault();
        deleteSelectedMaterial();
        return;
      }
      if (editing) return;

      if (event.key === '?') { event.preventDefault(); openHelpModal(); return; }
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyS') { event.preventDefault(); splitAtPlayhead(); }
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyF') { event.preventDefault(); toggleFullscreen(); }
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyM' && activeClip) {
        event.preventDefault();
        updateState((current) => ({
          ...current,
          clips: current.clips.map((c) => c.id === activeClip.id ? { ...c, muted: !c.muted } : c),
        }));
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyE') { event.preventDefault(); void handleExport('mp4'); }
      if (event.code === 'Delete') { event.preventDefault(); deleteSelectedMaterial(); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); seek(event.shiftKey ? -1 : -5); }
      if (event.code === 'ArrowRight') { event.preventDefault(); seek(event.shiftKey ? 1 : 5); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeClip, closeExportModal, closeHelpModal, closeMobilePanel, closeProjectManager, deleteSelectedMaterial, exportModalOpen, handleExport, mobilePanel, openHelpModal, overflowMenuOpen, overlayTool, redo, removeClip, seek, showHelpModal, showProjectManager, splitAtPlayhead, toggleFullscreen, togglePlay, undo, updateState]);

  // ─── State Updaters ──────────────────────────────────────────────────────

  const updateFilter = (key: keyof EditorState['filters'], value: number) => {
    replaceState((current) => ({ ...current, filters: { ...current.filters, [key]: value } }));
  };

  const updateTrim = (key: 'trimStart' | 'trimEnd', value: number) => {
    if (!activeClip) return;
    if (key === 'trimStart') {
      const video = videoRef.current;
      if (video) { video.pause(); video.currentTime = value; }
      setIsPlaying(false);
      setCurrentTime(value);
    }
    replaceState((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === activeClip.id ? { ...clip, [key]: value } : clip),
    }));
  };

  const updateClipField = useCallback((clipId: string, field: string, value: unknown) => {
    replaceState((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === clipId ? { ...clip, [field]: value } : clip),
    }));
  }, [replaceState]);

  // ─── Transition CRUD ─────────────────────────────────────────────────────

  const addTransition = useCallback((afterClipId: string, type: TransitionConfig['type'], duration: number) => {
    updateState((current) => ({
      ...current,
      transitions: [
        ...current.transitions.filter((t) => t.afterClipId !== afterClipId),
        { id: crypto.randomUUID(), afterClipId, type, duration },
      ],
    }));
  }, [updateState]);

  const removeTransition = useCallback((afterClipId: string) => {
    updateState((current) => ({
      ...current,
      transitions: current.transitions.filter((t) => t.afterClipId !== afterClipId),
    }));
  }, [updateState]);

  // ─── Text Overlay CRUD ───────────────────────────────────────────────────

  const addTextOverlay = useCallback(() => {
    const overlay: TextOverlay = {
      id: crypto.randomUUID(),
      text: 'Text',
      fontFamily: 'sans',
      fontSize: 48,
      color: '#ffffff',
      position: { x: 50, y: 50 },
      startTime: 0,
      endTime: Math.min(5, projectDurationSpeedAware),
    };
    updateState((current) => ({
      ...current,
      textOverlays: [...current.textOverlays, overlay],
    }));
    selectEditorItem({ kind: 'effect', id: `text:${overlay.id}` });
  }, [projectDurationSpeedAware, selectEditorItem, updateState]);

  const updateTextOverlay = useCallback((id: string, updates: Partial<TextOverlay>) => {
    replaceState((current) => ({
      ...current,
      textOverlays: current.textOverlays.map((o) => o.id === id ? { ...o, ...updates } : o),
    }));
  }, [replaceState]);

  const removeTextOverlay = useCallback((id: string) => {
    updateState((current) => ({
      ...current,
      textOverlays: current.textOverlays.filter((o) => o.id !== id),
    }));
    if (selection?.kind === 'effect' && selection.id === `text:${id}`) selectEditorItem(null);
  }, [selectEditorItem, selection, updateState]);

  // ─── Subtitle CRUD ───────────────────────────────────────────────────────

  const addSubtitle = useCallback(() => {
    const cue = createDefaultSubtitleCue(previewProjectTime);
    updateState((current) => ({
      ...current,
      subtitles: [...current.subtitles, cue],
    }));
    selectEditorItem({ kind: 'subtitle', id: cue.id });
  }, [previewProjectTime, selectEditorItem, updateState]);

  const updateSubtitle = useCallback((id: string, updates: Partial<SubtitleCue>) => {
    replaceState((current) => ({
      ...current,
      subtitles: current.subtitles.map((s) => s.id === id ? { ...s, ...updates } : s),
    }));
  }, [replaceState]);

  const removeSubtitle = useCallback((id: string) => {
    updateState((current) => ({
      ...current,
      subtitles: current.subtitles.filter((s) => s.id !== id),
    }));
    if (selection?.kind === 'subtitle' && selection.id === id) selectEditorItem(null);
  }, [selectEditorItem, selection, updateState]);

  // ─── Visual Overlay CRUD ─────────────────────────────────────────────────

  const addVisualOverlay = useCallback((overlay: VisualOverlay) => {
    updateState((current) => ({
      ...current,
      visualOverlays: [...current.visualOverlays, overlay],
    }));
    selectEditorItem({
      kind: overlay.type === 'image' ? 'image' : 'effect',
      id: overlay.type === 'image' ? overlay.id : `overlay:${overlay.id}`,
    });
  }, [selectEditorItem, updateState]);

  const updateVisualOverlay = useCallback((id: string, updates: Partial<VisualOverlay>) => {
    replaceState((current) => ({
      ...current,
      visualOverlays: current.visualOverlays.map((o) => o.id === id ? { ...o, ...updates } as VisualOverlay : o),
    }));
  }, [replaceState]);

  const removeVisualOverlay = useCallback((id: string) => {
    updateState((current) => ({
      ...current,
      visualOverlays: current.visualOverlays.filter((o) => o.id !== id),
    }));
    if ((selection?.kind === 'image' && selection.id === id)
      || (selection?.kind === 'effect' && selection.id === `overlay:${id}`)) selectEditorItem(null);
  }, [selectEditorItem, selection, updateState]);

  // ─── Image Import for Overlays ───────────────────────────────────────────

  const importImageOverlay = useCallback((file: File) => {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) return;
    const url = createTrackedUrl(file);
    const overlay = createDefaultImageOverlay(previewProjectTime);
    (overlay as ImageOverlay).file = file;
    (overlay as ImageOverlay).url = url;
    addVisualOverlay(overlay);
  }, [addVisualOverlay, createTrackedUrl, previewProjectTime]);



  const importMediaFiles = useCallback(async (files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(file.name));
    const audios = files.filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.name));
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name));
    if (!videos.length && !audios.length && !images.length) {
      setToast({ kind: 'error', message: t('invalid_file') });
      return;
    }
    if (!currentProjectId && videos.length === 0) {
      const project = await createDraft(t('untitled'), editorStateToDraft(DEFAULT_STATE));
      setCurrentProjectId(project.id);
      setProjects((current) => [project, ...current]);
    }
    if (videos.length) await importFiles(videos);
    if (audios.length) await importBackgroundAudio(audios[0]);
    images.forEach(importImageOverlay);
    if (audios.length > 1) setToast({ kind: 'success', message: t('audio_single_source_notice') });
  }, [currentProjectId, importBackgroundAudio, importFiles, importImageOverlay, t]);
  // ─── Drawing Pointer Handlers ────────────────────────────────────────────

  const handlePreviewPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (overlayTool === 'pen') {
      drawingRef.current = { points: [{ x, y }], active: true };
      setDraftPenPoints([{ x: (x / rect.width) * 100, y: (y / rect.height) * 100 }]);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (overlayTool === 'rect') {
      rectDrawRef.current = { startX: x, startY: y, active: true };
      setDraftRect({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, w: 0, h: 0 });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [overlayTool]);

  const handlePreviewPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (overlayTool === 'pen' && drawingRef.current.active) {
      drawingRef.current.points.push({ x: cx, y: cy });
      setDraftPenPoints((prev) => [...prev, { x: (cx / rect.width) * 100, y: (cy / rect.height) * 100 }]);
    } else if (overlayTool === 'rect' && rectDrawRef.current.active) {
      const sx = rectDrawRef.current.startX;
      const sy = rectDrawRef.current.startY;
      setDraftRect({
        x: (Math.min(sx, cx) / rect.width) * 100,
        y: (Math.min(sy, cy) / rect.height) * 100,
        w: (Math.abs(cx - sx) / rect.width) * 100,
        h: (Math.abs(cy - sy) / rect.height) * 100,
      });
    }
  }, [overlayTool]);

  const handlePreviewPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (overlayTool === 'pen' && drawingRef.current.active) {
      drawingRef.current.active = false;
      const rawPoints = drawingRef.current.points;
      if (rawPoints.length >= 2) {
        // Normalize raw pixel coords to 0..1 over entire preview
        const normalized = normalizeDrawingPoints(rawPoints, w, h);
        const bounds = computeDrawingBounds(normalized);
        // Rebase to local overlay-relative 0..1 coords within the bounding box
        const localPoints = rebaseDrawingPoints(normalized, bounds);
        const overlay = createDefaultDrawingOverlay(previewProjectTime);
        overlay.points = localPoints;
        overlay.position = {
          x: ((bounds.minX + bounds.maxX) / 2) * 100,
          y: ((bounds.minY + bounds.maxY) / 2) * 100,
        };
        overlay.size = {
          w: Math.max(5, (bounds.maxX - bounds.minX) * 100),
          h: Math.max(5, (bounds.maxY - bounds.minY) * 100),
        };
        addVisualOverlay(overlay);
      }
      drawingRef.current.points = [];
      setDraftPenPoints([]);
    } else if (overlayTool === 'rect' && rectDrawRef.current.active) {
      rectDrawRef.current.active = false;
      const sx = rectDrawRef.current.startX;
      const sy = rectDrawRef.current.startY;
      const ex = e.clientX - rect.left;
      const ey = e.clientY - rect.top;
      const rectW = Math.abs(ex - sx);
      const rectH = Math.abs(ey - sy);
      if (rectW > 5 && rectH > 5) {
        const overlay = createDefaultRectangleOverlay(previewProjectTime);
        overlay.position = {
          x: ((Math.min(sx, ex) + rectW / 2) / w) * 100,
          y: ((Math.min(sy, ey) + rectH / 2) / h) * 100,
        };
        overlay.size = { w: (rectW / w) * 100, h: (rectH / h) * 100 };
        addVisualOverlay(overlay);
      }
      setDraftRect(null);
    }
  }, [addVisualOverlay, overlayTool, previewProjectTime]);

  /** Handle pointer cancel / lost capture to avoid stuck drawing state */
  const handlePreviewPointerCancel = useCallback(() => {
    if (drawingRef.current.active) {
      drawingRef.current.active = false;
      drawingRef.current.points = [];
      setDraftPenPoints([]);
    }
    if (rectDrawRef.current.active) {
      rectDrawRef.current.active = false;
      setDraftRect(null);
    }
  }, []);

  // ─── TTS Manual Preview ──────────────────────────────────────────────────

  /** Synthesize local TTS WAV for a cue (with caching). Returns Blob or throws. */
  const synthesizeLocalTts = useCallback(async (cue: SubtitleCue): Promise<Blob> => {
    if (!cue.tts || !cue.text.trim()) throw new Error('No TTS config or empty text');
    const voiceId = cue.tts.exportVoiceId || getDefaultLocalVoice(cue.tts.lang).id;
    const cacheKey = getTtsCacheKey(cue.text, voiceId, cue.tts.rate);
    const cached = localTtsCacheRef.current.get(cacheKey);
    if (cached) return cached;

    setLocalTtsCueId(cue.id);
    setLocalTtsPhase('downloading');
    setLocalTtsProgress(0);

    const { synthesize } = await import('@/lib/local-tts');
    const blob = await synthesize(cue.text.trim(), voiceId as LocalTtsVoiceId, (ev) => {
      if (ev.progress > 0 && ev.progress < 1) {
        setLocalTtsPhase('downloading');
      } else if (ev.progress >= 1) {
        setLocalTtsPhase('generating');
      }
      setLocalTtsProgress(Math.round(ev.progress * 100));
    });

    setLocalTtsPhase('idle');
    setLocalTtsCueId(null);
    setLocalTtsProgress(0);

    localTtsCacheRef.current.set(cacheKey, blob);
    return blob;
  }, []);

  /** Preview using local TTS (export-consistent WAV playback). */
  const previewTts = useCallback(async (cue: SubtitleCue, mode: 'auto' | 'manual' = 'manual') => {
    if (!cue.tts || !cue.text.trim()) return;
    const requestId = ++ttsRequestIdRef.current;
    ttsBufferSourceRef.current?.stop();
    ttsBufferSourceRef.current = null;
    if (localTtsAudioRef.current) {
      localTtsAudioRef.current.pause();
      localTtsAudioRef.current = null;
    }
    if (localTtsUrlRef.current) {
      URL.revokeObjectURL(localTtsUrlRef.current);
      localTtsUrlRef.current = null;
    }
    const audioContext = typeof AudioContext !== 'undefined'
      ? (ttsAudioContextRef.current ?? new AudioContext())
      : null;
    if (audioContext) ttsAudioContextRef.current = audioContext;
    const resumePromise = audioContext?.resume();

    try {
      const blob = await synthesizeLocalTts(cue);
      if (requestId !== ttsRequestIdRef.current) return;
      if (mode === 'auto' && lastTtsCueIdRef.current !== cue.id) return;
      const playbackRate = Math.max(0.5, Math.min(4, cue.tts.rate * (mode === 'auto' ? state.playbackSpeed : 1)));
      const volume = Math.max(0, Math.min(2, cue.tts.volume * state.masterVolume / 100));

      if (audioContext) {
        await resumePromise;
        const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
        if (requestId !== ttsRequestIdRef.current) return;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        gain.gain.value = volume;
        source.connect(gain).connect(audioContext.destination);
        source.onended = () => {
          if (ttsBufferSourceRef.current === source) {
            ttsBufferSourceRef.current = null;
            ttsModeRef.current = null;
            setTtsPlaying(false);
          }
        };
        ttsBufferSourceRef.current = source;
        ttsModeRef.current = mode;
        setTtsPlaying(true);
        source.start();
        return;
      }

      const url = URL.createObjectURL(blob);
      localTtsUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = playbackRate;
      audio.volume = Math.min(1, volume);
      audio.onended = () => { if (localTtsAudioRef.current === audio) { ttsModeRef.current = null; setTtsPlaying(false); } };
      audio.onerror = () => { if (localTtsAudioRef.current === audio) { ttsModeRef.current = null; setTtsPlaying(false); } };
      localTtsAudioRef.current = audio;
      ttsModeRef.current = mode;
      setTtsPlaying(true);
      await audio.play();
    } catch (error) {
      if (requestId !== ttsRequestIdRef.current) return;
      console.error('Local TTS preview failed', error);
      setLocalTtsPhase('idle');
      setLocalTtsCueId(null);
      setLocalTtsProgress(0);
      setTtsPlaying(false);
      const modelDownloadFailed = error instanceof Error && error.name === 'TtsModelDownloadError';
      setToast({ kind: 'error', message: t(modelDownloadFailed ? 'tts_model_download_failed' : 'tts_generation_failed') });
    }
  }, [state.masterVolume, state.playbackSpeed, synthesizeLocalTts, t]);

  const stopTts = useCallback(() => {
    ttsRequestIdRef.current += 1;
    ttsBufferSourceRef.current?.stop();
    ttsBufferSourceRef.current = null;
    if (localTtsAudioRef.current) {
      localTtsAudioRef.current.pause();
      localTtsAudioRef.current = null;
    }
    if (localTtsUrlRef.current) {
      URL.revokeObjectURL(localTtsUrlRef.current);
      localTtsUrlRef.current = null;
    }
    ttsModeRef.current = null;
    setTtsPlaying(false);
  }, []);



  useEffect(() => {
    const activeCue = isPlaying ? getActiveTtsCue(state.subtitles, previewProjectTime) : null;
    if (!activeCue?.tts?.enabled || !activeCue.text.trim()) {
      lastTtsCueIdRef.current = null;
      if (ttsModeRef.current === 'auto') stopTts();
      return;
    }
    if (activeCue.id === lastTtsCueIdRef.current) return;
    lastTtsCueIdRef.current = activeCue.id;
    void previewTts(activeCue, 'auto');
  }, [isPlaying, previewProjectTime, previewTts, state.subtitles, stopTts]);
  // ─── Preview CSS ─────────────────────────────────────────────────────────

  // H5: Compute preview aspect ratio and fit mode CSS
  const previewAspectRatio = (() => {
    switch (state.canvasAspect) {
      case '16:9': return '16/9';
      case '9:16': return '9/16';
      case '4:3': return '4/3';
      case '1:1': return '1/1';
      default: return '16/9';
    }
  })();
  const previewFit: React.CSSProperties['objectFit'] = state.canvasFit === 'cover' ? 'cover' : state.canvasFit === 'stretch' ? 'fill' : 'contain';

  const previewStyle: React.CSSProperties = holdingCompare ? {} : {
    filter: `brightness(${state.filters.brightness}%) contrast(${state.filters.contrast}%) saturate(${state.filters.saturation}%)`,
    transform: activeClip ? buildRotationTransformCSS(activeClip.rotation, activeClip.flipH, activeClip.flipV) : undefined,
    objectFit: previewFit,
  };

  const processingLabel = processingStage === 'loading'
    ? t('loading_engine')
    : processingStage === 'preparing' ? t('preparing_media')
    : processingStage === 'tts' ? t('tts_export_stage')
    : t('exporting');

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[var(--app)] text-[var(--text)]">
      <input ref={fileInputRef} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" onChange={(event) => { void importMediaFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={imageInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => { const f = event.target.files?.[0]; if (f) importImageOverlay(f); event.target.value = ''; }} aria-label={t('add_image')} />

      {/* ─── Header: canonical global command bar ─────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 font-semibold">
            <MonitorPlay className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <h1 className="max-[379px]:sr-only truncate text-sm">{t('app_title')}</h1>
            <span className="hidden rounded border border-[var(--accent)]/30 px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] sm:inline">{t('wasm_powered')}</span>
          </div>
          <div className="flex items-center border-l border-[var(--border)] pl-2 sm:pl-4">
            <button onClick={undo} disabled={!canUndo} className={iconButton} aria-label={`${t('undo')} (Ctrl+Z)`} title={`${t('undo')} (Ctrl+Z)`}><Undo2 className="h-4 w-4" /></button>
            <button onClick={redo} disabled={!canRedo} className={iconButton} aria-label={`${t('redo')} (Ctrl+Y)`} title={`${t('redo')} (Ctrl+Y)`}><Redo2 className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Save status */}
          <span className="hidden items-center gap-2 text-xs text-[var(--muted)] md:flex">
            <span className={`h-2 w-2 rounded-full ${saveStatus === 'error' ? 'bg-red-500' : saveStatus === 'saving' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            {saveStatus === 'saving' ? t('saving') : saveStatus === 'error' ? t('save_error') : lastSavedTime ? t('last_saved', { time: new Date(lastSavedTime).toLocaleTimeString(i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : t('auto_save')}
          </span>
          {/* Desktop import (Inspector is no longer required to import) */}
          <button onClick={() => fileInputRef.current?.click()} disabled={Boolean(importProgress)} className="hidden items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 lg:inline-flex" aria-label={t('import')} title={t('import')}><Upload className="h-3.5 w-3.5" aria-hidden="true" />{t('import')}</button>
          {/* Mobile-only Media / Inspector sheet toggles */}
          <button ref={mediaTriggerRef} onClick={() => openMobilePanel('media')} className={`${iconButton} lg:hidden`} aria-label={t('media_assets')} aria-haspopup="dialog" aria-expanded={mobilePanel === 'media'}><FileVideo className="h-4 w-4" /></button>
          <button ref={inspectorTriggerRef} onClick={() => openMobilePanel('inspector')} className={`${iconButton} lg:hidden`} aria-label={t('inspector')} aria-haspopup="dialog" aria-expanded={mobilePanel === 'inspector'}><SlidersHorizontal className="h-4 w-4" /></button>
          {/* Always-visible canonical Export entry point */}
          <button
            ref={exportTriggerRef} type="button" onClick={() => { setOverflowMenuOpen(false); setExportModalOpen(true); }} disabled={processing || !state.clips.length}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
            aria-label={t('open_export_settings')} title={t('open_export_settings')}
          ><Download className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('export')}</span></button>
          {/* Single overflow: Projects, Help, Language, Theme */}
          <div className="relative" ref={overflowMenuRef}>
            <button
              ref={overflowTriggerRef} type="button" onClick={() => setOverflowMenuOpen((open) => !open)}
              className={iconButton} aria-label={t('more_actions')} title={t('more_actions')}
              aria-expanded={overflowMenuOpen} aria-controls="global-command-menu"
            ><MoreVertical className="h-4 w-4" /></button>
            {overflowMenuOpen && (
              <div id="global-command-menu" className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 shadow-xl">
                <button ref={projectTriggerRef} onClick={openProjectManager} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--raised)]"><Menu className="h-4 w-4 shrink-0" aria-hidden="true" />{t('projects')}</button>
                <button ref={helpTriggerRef} onClick={openHelpModal} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--raised)]"><HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{t('keyboard_shortcuts')}</button>
                <button onClick={() => { void i18n.changeLanguage(i18n.resolvedLanguage?.startsWith('zh') ? 'en' : 'zh'); setOverflowMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--raised)]"><Globe className="h-4 w-4 shrink-0" aria-hidden="true" />{t('language')}<span className="ml-auto font-mono text-[var(--muted)]">{i18n.resolvedLanguage?.startsWith('zh') ? 'EN' : '中文'}</span></button>
                <button onClick={() => { setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); setOverflowMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--raised)]">{resolvedTheme === 'dark' ? <Sun className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />}{resolvedTheme === 'dark' ? t('light_mode') : t('dark_mode')}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main Area ───────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {mobilePanel && <button className="absolute inset-0 z-20 bg-black/50 transition active:bg-black/60 lg:hidden" onClick={closeMobilePanel} aria-label={t('close')} />}

        {/* ─── Media Panel (Left) ──────────────────────────────────────── */}
        <aside
          ref={mediaSheetRef}
          tabIndex={mobilePanel === 'media' ? -1 : undefined}
          onKeyDown={mobilePanel === 'media' ? (event) => trapFocus(event, mediaSheetRef) : undefined}
          role={mobilePanel === 'media' ? 'dialog' : undefined} aria-modal={mobilePanel === 'media' ? true : undefined}
          className={`workspace-side-panel absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] transition-[transform,width,visibility] lg:static lg:w-[var(--media-panel-width)] lg:translate-x-0 lg:visible ${mobilePanel === 'media' ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
          style={{ '--media-panel-width': `${leftPanelCollapsed ? 48 : leftPanelWidth}px` } as React.CSSProperties}
          aria-label={t('media_assets')}
        >
          <div className={`flex h-11 items-center justify-between border-b border-[var(--border)] ${leftPanelCollapsed ? 'lg:px-1' : 'px-3'}`}>
            <span className={`text-xs font-bold uppercase tracking-widest text-[var(--muted)] ${leftPanelCollapsed ? 'lg:hidden' : ''}`}>{t('media_assets')}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setLeftPanelCollapsed((value) => !value)} className={`${iconButton} hidden lg:inline-flex`} aria-label={leftPanelCollapsed ? t('expand_panel') : t('collapse_panel')} title={leftPanelCollapsed ? t('expand_panel') : t('collapse_panel')}>{leftPanelCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
              <button onClick={() => fileInputRef.current?.click()} disabled={Boolean(importProgress)} className={`flex items-center gap-1 rounded ${leftPanelCollapsed ? 'lg:hidden' : ''} px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40`}><Plus className="h-3.5 w-3.5" />{t('import')}</button>
              <button onClick={closeMobilePanel} className={`${iconButton} lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div role="list" className={`flex-1 space-y-2 overflow-y-auto p-2 ${leftPanelCollapsed ? 'lg:hidden' : ''}`}>
            {state.clips.map((clip, index) => (
              <div key={clip.id} role="listitem" className={`group relative rounded-lg border p-1.5 transition ${state.activeClipId === clip.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] bg-[var(--raised)] hover:border-indigo-400'}`}>
                <button onClick={() => { selectVideoClip(clip.id); }} className="block w-full rounded text-left" aria-current={state.activeClipId === clip.id ? 'true' : undefined}>
                  <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded bg-gradient-to-br from-indigo-500/20 via-[var(--canvas)] to-cyan-500/10">
                    <FileVideo className="h-7 w-7 text-indigo-500/60" aria-hidden="true" />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">{t('duration', { value: clip.duration.toFixed(1) })}</span>
                    {clip.muted && <span className="absolute left-1.5 top-1.5"><VolumeX className="h-3 w-3 text-red-400" /></span>}
                  </span>
                  {renamingClipId !== clip.id && (
                    <span className="mt-1 block truncate px-0.5 text-xs">{clip.displayName}</span>
                  )}
                </button>
                {/* M6: Input outside button to avoid invalid nesting */}
                {renamingClipId === clip.id && (
                  <input
                    autoFocus
                    defaultValue={clip.displayName}
                    className="mt-1 block w-full rounded border border-indigo-500 bg-[var(--panel)] px-1 text-xs"
                    onBlur={(e) => renameClip(clip.id, e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameClip(clip.id, e.currentTarget.value); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenamingClipId(null); } }}
                  />
                )}
                {/* M8: Accessible per-clip disclosure/menu */}
                <details className="mt-1 border-t border-[var(--border)] pt-1">
                  <summary className={`${iconButton} flex w-full cursor-pointer items-center justify-center gap-1 text-xs`} aria-label={t('more_actions')}><Menu className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">{t('actions')}</span></summary>
                  <div className="mt-1 flex flex-wrap justify-end gap-0.5">
                    <button onClick={() => setRenamingClipId(clip.id)} className={iconButton} aria-label={t('rename_clip')} title={t('rename')}><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => duplicateClipById(clip.id)} className={iconButton} aria-label={`${t('duplicate')} ${clip.displayName}`} title={t('duplicate')}><Copy className="h-3.5 w-3.5" /></button>
                    <button onClick={() => moveClip(clip.id, -1)} disabled={index === 0} className={iconButton} aria-label={t('move_left')} title={t('move_left')}><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <button onClick={() => moveClip(clip.id, 1)} disabled={index === state.clips.length - 1} className={iconButton} aria-label={t('move_right')} title={t('move_right')}><ChevronRight className="h-3.5 w-3.5" /></button>
                    <button onClick={() => removeClip(clip.id)} className={`${iconButton} hover:text-red-500`} aria-label={`${t('delete')} ${clip.displayName}`} title={t('delete')}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </details>
              </div>
            ))}
            {state.backgroundMusic && (
              <div
                role="listitem"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('application/x-cutfish-audio', state.backgroundMusic!.name);
                }}
                className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 p-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    const first = state.backgroundMusic?.segments[0];
                    selectEditorItem(first ? { kind: 'background-audio', id: first.id } : null);
                    if (!first) setInspectorTab('audio');
                  }}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-emerald-500/15"><Music className="h-5 w-5 text-emerald-400" /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{state.backgroundMusic.name}</strong><span className="text-xs text-[var(--muted)]">A2 · {t('duration', { value: state.backgroundMusic.duration.toFixed(1) })} · {t('drag_to_timeline')}</span></span>
                </button>
                <div className="mt-2 flex gap-1 border-t border-emerald-600/20 pt-2">
                  <button type="button" onClick={() => addAudioSegment()} disabled={state.backgroundMusic.duration <= 0} className="flex flex-1 items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-emerald-400 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />{t('add_to_timeline')}</button>
                  <button type="button" onClick={() => { updateState((current) => ({ ...current, backgroundMusic: null })); selectEditorItem(null); }} className={`${iconButton} hover:text-red-500`} aria-label={t('delete_audio_track')}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
            {!state.clips.length && !state.backgroundMusic && <p className="m-2 rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-xs leading-5 text-[var(--muted)]">{t('no_assets')}</p>}
          </div>
          {!leftPanelCollapsed && <div role="separator" aria-label={t('resize_media_panel')} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={640} aria-valuenow={Math.round(leftPanelWidth)} tabIndex={0} className="workspace-resizer workspace-resizer-x absolute inset-y-0 right-0 z-40 hidden translate-x-1/2 lg:block" onPointerDown={(event) => startWorkspaceResize(event, 'media')} onKeyDown={(event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); resizeWorkspaceFromKeyboard('media', (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 48 : 16)); }} />}
        </aside>

        {/* ─── Preview (Center) ────────────────────────────────────────── */}
        <section className="relative flex min-w-0 flex-1 flex-col bg-[var(--canvas)]" aria-label={t('preview')}>
          {importProgress && (
            <div className="absolute left-1/2 top-3 z-30 w-[min(90%,24rem)] -translate-x-1/2 rounded-lg border border-indigo-400/30 bg-[var(--panel)] p-3 shadow-xl" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate">{t('importing_file', { name: importProgress.name })}</span><span className="font-mono">{importProgress.current}/{importProgress.total}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${importProgress.current / importProgress.total * 100}%` }} /></div>
            </div>
          )}
          {holdingCompare && (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded bg-amber-500/90 px-3 py-1 text-xs text-white" aria-live="polite">{t('comparing')}</div>
          )}
          <div
            className={`flex min-h-0 flex-1 items-center justify-center p-3 transition sm:p-5 lg:p-8 ${isDragging ? 'bg-indigo-500/15' : ''}`}
            onDragEnter={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); setIsDragging(true); } }}
            onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
            onDrop={(event) => { if (!Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); setIsDragging(false); void importMediaFiles(Array.from(event.dataTransfer.files)); }}
          >
            {!activeClip ? (
              <button onClick={() => fileInputRef.current?.click()} disabled={Boolean(importProgress)} className="group relative flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl transition hover:border-indigo-500 disabled:opacity-50" aria-label={t('upload_media')}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--raised)] transition group-hover:border-indigo-500"><Upload className="h-6 w-6 text-indigo-500" /></span>
                <span className="text-center"><strong className="block text-sm">{t('upload_media')}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{t('drop_here')}</span></span>
              </button>
            ) : (
              <div
                ref={previewCanvasRef}
                className={`preview-canvas relative flex w-full max-w-3xl items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-2xl ${overlayTool !== 'select' ? 'cursor-crosshair' : ''}`}
                style={{ aspectRatio: previewAspectRatio, touchAction: overlayTool !== 'select' ? 'none' : undefined }}
                onPointerDown={overlayTool !== 'select' ? handlePreviewPointerDown : undefined}
                onPointerMove={overlayTool !== 'select' ? handlePreviewPointerMove : undefined}
                onPointerUp={overlayTool !== 'select' ? handlePreviewPointerUp : undefined}
                onPointerCancel={overlayTool !== 'select' ? handlePreviewPointerCancel : undefined}
                onLostPointerCapture={overlayTool !== 'select' ? handlePreviewPointerCancel : undefined}
              >
                <video
                  key={activeClip.id} ref={videoRef} src={activeClip.url} playsInline
                  muted={activeClip.muted || state.backgroundMusic?.replaceOriginalAudio === true}
                  className="relative z-10 max-h-full max-w-full object-contain" style={previewStyle}
                  onLoadedMetadata={(event) => {
                    const pending = pendingSeekRef.current?.clipId === activeClip.id ? pendingSeekRef.current : null;
                    const target = pending?.sourceTime ?? activeClip.trimStart;
                    pendingSeekRef.current = null;
                    event.currentTarget.currentTime = target;
                    // H1: Use per-clip speed for preview playback; global playbackSpeed is a multiplier
                    event.currentTarget.playbackRate = (activeClip.speed || 1.0) * state.playbackSpeed;
                    setCurrentTime(target);
                    if (continuePlaybackRef.current) {
                      continuePlaybackRef.current = false;
                      void event.currentTarget.play().catch(() => setIsPlaying(false));
                    } else {
                      setIsPlaying(false);
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const time = event.currentTarget.currentTime;
                    setCurrentTime(time);
                    if (time >= activeClip.trimEnd) {
                      const index = state.clips.findIndex((clip) => clip.id === activeClip.id);
                      const nextClip = state.clips[index + 1];
                      event.currentTarget.pause();
                      if (nextClip) {
                        continuePlaybackRef.current = true;
                        replaceState((current) => ({ ...current, activeClipId: nextClip.id }));
                      } else {
                        event.currentTarget.currentTime = activeClip.trimStart;
                        setIsPlaying(false);
                      }
                    }
                  }}
                  onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onClick={overlayTool === 'select' ? togglePlay : undefined}
                />
                {/* Text overlay preview */}
                {state.textOverlays.map((overlay) => {
                  const visible = previewProjectTime >= overlay.startTime && previewProjectTime <= overlay.endTime;
                  if (!visible) return null;
                  const selectable = overlayTool === 'select';
                  const selected = editingTextId === overlay.id;
                  return (
                    <span
                      key={overlay.id}
                      className={`absolute z-20 ${selectable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                      role={selectable ? 'button' : undefined}
                      tabIndex={selectable ? 0 : undefined}
                      aria-pressed={selectable ? selected : undefined}
                      aria-label={selectable ? t('select_overlay_named', { name: overlay.text || t('text_overlays') }) : undefined}
                      style={{
                        left: `${overlay.position.x}%`, top: `${overlay.position.y}%`,
                        transform: 'translate(-50%,-50%)',
                        fontSize: `${overlay.fontSize * 0.5}px`,
                        color: overlay.color,
                        fontFamily: overlay.fontFamily === 'mono' ? 'monospace' : overlay.fontFamily === 'serif' ? 'serif' : 'sans-serif',
                        textShadow: '0 2px 4px rgba(0,0,0,0.7)',
                        touchAction: selectable ? 'manipulation' : undefined,
                        outline: selected ? '2px solid var(--accent)' : undefined,
                      }}
                      onClick={selectable ? (e) => { e.stopPropagation(); selectEditorItem({ kind: 'effect', id: `text:${overlay.id}` }); } : undefined}
                      onKeyDown={selectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectEditorItem({ kind: 'effect', id: `text:${overlay.id}` }); } } : undefined}
                    >{overlay.text}</span>
                  );
                })}
                {/* Subtitle preview */}
                {state.subtitles.map((cue) => {
                  const visible = previewProjectTime >= cue.startTime && previewProjectTime < cue.endTime;
                  if (!visible) return null;
                  const selectable = overlayTool === 'select';
                  const selected = editingSubtitleId === cue.id;
                  return (
                    <div key={cue.id} className={`absolute z-20 ${selectable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                      role={selectable ? 'button' : undefined}
                      tabIndex={selectable ? 0 : undefined}
                      aria-pressed={selectable ? selected : undefined}
                      aria-label={selectable ? t('select_overlay_named', { name: cue.text || t('subtitles') }) : undefined}
                      style={{
                        left: `${cue.position.x}%`, top: `${cue.position.y}%`,
                        width: `${cue.width}%`, maxWidth: '90%',
                        transform: computeOverlayCssTransform(cue.position, cue.rotation),
                        fontSize: `${cue.fontSize * 0.5}px`,
                        lineHeight: String(cue.lineHeight || 1.3),
                        color: cue.color,
                        backgroundColor: cue.backgroundColor || undefined,
                        fontFamily: cue.fontFamily === 'mono' ? 'monospace' : cue.fontFamily === 'serif' ? 'serif' : 'sans-serif',
                        textAlign: cue.align,
                        textShadow: cue.backgroundColor ? undefined : '0 2px 4px rgba(0,0,0,0.7)',
                        whiteSpace: 'pre-wrap',
                        wordWrap: 'break-word',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        touchAction: selectable ? 'manipulation' : undefined,
                        outline: selected ? '2px solid var(--accent)' : undefined,
                      }}
                      onClick={selectable ? (e) => { e.stopPropagation(); selectEditorItem({ kind: 'subtitle', id: cue.id }); } : undefined}
                      onKeyDown={selectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectEditorItem({ kind: 'subtitle', id: cue.id }); } } : undefined}
                    >{cue.text || '…'}</div>
                  );
                })}
                {/* Visual overlay preview */}
                {state.visualOverlays.map((overlay) => {
                  const visible = previewProjectTime >= overlay.startTime && previewProjectTime < overlay.endTime;
                  if (!visible) return null;
                  const selectable = overlayTool === 'select';
                  const selected = selectedOverlayId === overlay.id;
                  const overlayStyle: React.CSSProperties = {
                    position: 'absolute',
                    left: `${overlay.position.x}%`,
                    top: `${overlay.position.y}%`,
                    width: `${overlay.size.w}%`,
                    height: `${overlay.size.h}%`,
                    transform: computeOverlayCssTransform(overlay.position, overlay.rotation),
                    opacity: overlay.opacity,
                    touchAction: selectable ? 'manipulation' : undefined,
                    outline: selected ? '2px solid var(--accent)' : undefined,
                  };
                  const selectKind: EditorSelection = overlay.type === 'image'
                    ? { kind: 'image', id: overlay.id }
                    : { kind: 'effect', id: `overlay:${overlay.id}` };
                  const accessibleName = t('select_overlay_named', {
                    name: overlay.type === 'rectangle' ? t('add_rectangle')
                      : overlay.type === 'image' ? t('add_image')
                        : t('add_drawing'),
                  });
                  const interactiveProps = selectable ? {
                    role: 'button' as const,
                    tabIndex: 0,
                    'aria-pressed': selected,
                    'aria-label': accessibleName,
                    onClick: (e: React.MouseEvent) => { e.stopPropagation(); selectEditorItem(selectKind); },
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectEditorItem(selectKind); } },
                  } : {};
                  if (overlay.type === 'rectangle') {
                    return (
                      <div key={overlay.id} className={`z-20 ${selectable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                        {...interactiveProps}
                        style={{
                          ...overlayStyle,
                          border: overlay.strokeWidth > 0 ? `${overlay.strokeWidth}px solid ${overlay.strokeColor}` : undefined,
                          backgroundColor: overlay.fillColor || undefined,
                          borderRadius: `${overlay.borderRadius}px`,
                        }}
                      />
                    );
                  }
                  if (overlay.type === 'image' && (overlay as ImageOverlay).url) {
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={overlay.id} src={(overlay as ImageOverlay).url} alt=""
                        className={`z-20 ${selectable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                        {...interactiveProps}
                        style={overlayStyle}
                      />
                    );
                  }
                  if (overlay.type === 'drawing') {
                    return (
                      <svg key={overlay.id}
                        className={`z-20 ${selectable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
                        {...interactiveProps}
                        style={overlayStyle} viewBox="0 0 100 100" preserveAspectRatio="none"
                      >
                        <polyline
                          points={(overlay as DrawingOverlay).points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                          fill="none"
                          stroke={(overlay as DrawingOverlay).strokeColor}
                          strokeWidth={(overlay as DrawingOverlay).strokeWidth}
                          strokeLinecap="round" strokeLinejoin="round"
                        />
                      </svg>
                    );
                  }
                  return null;
                })}
                <span className="absolute left-3 top-3 z-20 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white" aria-live="off">{currentTime.toFixed(2)}s / {activeClip.duration.toFixed(2)}s</span>
                {/* Draft pen/rect drawing preview */}
                {draftPenPoints.length >= 2 && (
                  <svg className="pointer-events-none absolute inset-0 z-25 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <polyline
                      points={draftPenPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="#ff0000" strokeWidth="0.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"
                    />
                  </svg>
                )}
                {draftRect && draftRect.w > 0 && draftRect.h > 0 && (
                  <div className="pointer-events-none absolute z-25" style={{
                    left: `${draftRect.x}%`, top: `${draftRect.y}%`,
                    width: `${draftRect.w}%`, height: `${draftRect.h}%`,
                    border: '2px dashed #ff0000', opacity: 0.7,
                  }} />
                )}
                {/* Overlay tool indicator */}
                {overlayTool !== 'select' && (
                  <span className="absolute left-3 bottom-3 z-30 rounded bg-indigo-600/90 px-2 py-1 text-xs text-white" role="status">
                    {overlayTool === 'pen' ? t('drawing_mode') : t('rect_mode')}
                  </span>
                )}
                {/* Fullscreen button */}
                <button onClick={toggleFullscreen} className="absolute right-3 top-3 z-20 rounded bg-black/50 p-1.5 text-white/80 hover:text-white" aria-label={isFullscreen ? t('exit_fullscreen') : t('fullscreen')}>
                  {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          {/* ─── Transport Controls ──────────────────────────────────────── */}
          <div className="relative flex h-14 shrink-0 items-center justify-center gap-1.5 border-t border-[var(--border)] bg-[var(--panel)] sm:gap-5">
            <output className="absolute left-2 font-mono text-xs text-[var(--muted)] sm:left-3" aria-label={t('timeline_playhead')}>
              {formatEditorTime(previewProjectTime)}<span className="hidden md:inline"> / {formatEditorTime(projectDurationSpeedAware)}</span>
            </output>
            <button onClick={() => seek(-5)} disabled={!activeClip} className={iconButton} aria-label={t('back_five')} title={t('back_five')}><RotateCcw className="h-4 w-4" /></button>
            <button onClick={splitAtPlayhead} disabled={!canContextSplit} className={iconButton} aria-label={`${t('split_at_playhead')} (S)`} title={canContextSplit ? `${t('split_at_playhead')} (S)` : t('split_unavailable')}><Scissors className="h-4 w-4" /></button>
            <button onClick={togglePlay} disabled={!activeClip} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--text)] text-[var(--panel)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" aria-label={isPlaying ? t('pause') : t('play')}>{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}</button>
            <button onClick={() => seek(5)} disabled={!activeClip} className={iconButton} aria-label={t('forward_five')} title={t('forward_five')}><RotateCw className="h-4 w-4" /></button>
            {/* Compare hold */}
            <button
              onPointerDown={() => setHoldingCompare(true)} onPointerUp={() => setHoldingCompare(false)} onPointerLeave={() => setHoldingCompare(false)}
              disabled={!activeClip} className={iconButton} aria-label={t('compare_hold')} title={t('compare_hold')}
            ><SlidersHorizontal className="h-4 w-4" /></button>
          </div>

          {processing && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 px-4 text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={processingLabel}>
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
              <p className="mb-3 text-lg font-medium">{processingLabel}</p>
              {(processingStage === 'rendering' || processingStage === 'tts') && <><div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/20"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 font-mono text-sm text-white/70">{progress.toFixed(0)}%</p></>}
              <button autoFocus onClick={cancelExport} className="mt-5 rounded-md border border-white/30 px-4 py-2 text-sm hover:bg-white/10">{t('cancel')}</button>
            </div>
          )}
        </section>

        {/* ─── Inspector (Right) ───────────────────────────────────────── */}
        <aside
          ref={inspectorSheetRef}
          tabIndex={mobilePanel === 'inspector' ? -1 : undefined}
          onKeyDown={mobilePanel === 'inspector' ? (event) => trapFocus(event, inspectorSheetRef) : undefined}
          className={`workspace-side-panel fixed inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--panel)] transition-[transform,width,visibility] lg:static lg:inset-auto lg:max-h-none lg:w-[var(--inspector-panel-width)] lg:translate-y-0 lg:visible lg:rounded-none lg:border-l lg:border-t-0 ${mobilePanel === 'inspector' ? 'visible translate-y-0' : 'invisible translate-y-full'}`}
          style={{ '--inspector-panel-width': `${rightPanelCollapsed ? 48 : rightPanelWidth}px` } as React.CSSProperties}
          aria-label={t('inspector')} role={mobilePanel === 'inspector' ? 'dialog' : undefined} aria-modal={mobilePanel === 'inspector' ? true : undefined}
        >
          <div className="flex h-3 shrink-0 items-center justify-center lg:hidden" aria-hidden="true"><span className="h-1 w-10 rounded-full bg-[var(--border)]" /></div>
          {/* Tab Bar — contextual destinations, selected material first */}
          <div className="flex min-h-12 shrink-0 items-center border-b border-[var(--border)] px-1">
            <div role="tablist" aria-label={t('inspector')} className={`flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto ${rightPanelCollapsed ? 'lg:hidden' : ''}`}>
              {visibleInspectorTabs.map((tab) => (
                <button
                  key={tab}
                  id={`inspector-tab-${tab}`}
                  role="tab"
                  aria-selected={effectiveInspectorTab === tab}
                  aria-controls="inspector-panel"
                  tabIndex={effectiveInspectorTab === tab ? 0 : -1}
                  onClick={() => setInspectorTab(tab)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const currentIndex = visibleInspectorTabs.indexOf(tab);
                    const nextIndex = event.key === 'Home' ? 0
                      : event.key === 'End' ? visibleInspectorTabs.length - 1
                        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + visibleInspectorTabs.length) % visibleInspectorTabs.length;
                    const nextTab = visibleInspectorTabs[nextIndex];
                    setInspectorTab(nextTab);
                    window.requestAnimationFrame(() => document.getElementById(`inspector-tab-${nextTab}`)?.focus());
                  }}
                  className={`min-h-11 min-w-14 flex-1 whitespace-nowrap rounded-t-md px-2 py-2 text-xs font-medium transition-colors ${effectiveInspectorTab === tab ? 'border-b-2 border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--raised)] hover:text-[var(--text)]'}`}
                >{t(`tab_${tab}`)}</button>
              ))}
            </div>
            <button type="button" onClick={() => setRightPanelCollapsed((value) => !value)} className={`${iconButton} hidden lg:inline-flex`} aria-label={rightPanelCollapsed ? t('expand_panel') : t('collapse_panel')} title={rightPanelCollapsed ? t('expand_panel') : t('collapse_panel')}>{rightPanelCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
            <button onClick={closeMobilePanel} className={`${iconButton} ml-1 lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button>
          </div>

          <div id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${effectiveInspectorTab}`} className={`flex-1 space-y-6 overflow-y-auto p-4 ${rightPanelCollapsed ? 'lg:hidden' : ''}`}>
            {/* ── Clip Tab ─────────────────────────────────────────────── */}
            {effectiveInspectorTab === 'clip' && (
              <>
                <section aria-labelledby="trim-heading">
                  <h2 id="trim-heading" className="mb-3 text-sm font-semibold">{t('trim')}</h2>
                  <div className="space-y-4">
                    <RangeControl label={t('trim_start')} value={activeClip?.trimStart ?? 0} min={0} max={Math.max(0, (activeClip?.trimEnd ?? 0) - 0.01)} step={0.01} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimStart', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('trim_end')} value={activeClip?.trimEnd ?? 0} min={Math.min(activeClip?.duration ?? 0, (activeClip?.trimStart ?? 0) + 0.01)} max={activeClip?.duration ?? 0} step={0.01} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimEnd', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                  </div>
                </section>
                {/* Rotation / Flip */}
                <section aria-labelledby="transform-heading">
                  <h2 id="transform-heading" className="mb-3 text-sm font-semibold">{t('rotation')}</h2>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[var(--muted)] w-16">{t('rotation')}</label>
                      <select disabled={!activeClip} value={activeClip?.rotation ?? 0} onChange={(e) => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, rotation: Number(e.target.value) as 0 | 90 | 180 | 270 } : cl) }))} className="flex-1 rounded border border-[var(--border)] bg-[var(--raised)] px-2 py-1 text-xs">
                        <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={!activeClip} onClick={() => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, flipH: !cl.flipH } : cl) }))} className={`flex-1 rounded border px-2 py-1.5 text-xs ${activeClip?.flipH ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'} disabled:opacity-40`}>{t('flip_h')}</button>
                      <button disabled={!activeClip} onClick={() => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, flipV: !cl.flipV } : cl) }))} className={`flex-1 rounded border px-2 py-1.5 text-xs ${activeClip?.flipV ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'} disabled:opacity-40`}>{t('flip_v')}</button>
                    </div>
                  </div>
                </section>
                {/* Speed */}
                <section aria-labelledby="speed-heading">
                  <h2 id="speed-heading" className="mb-3 text-sm font-semibold">{t('speed')}</h2>
                  <RangeControl label={t('speed')} value={activeClip?.speed ?? 1} min={0.25} max={4} step={0.25} unit="×" disabled={!activeClip} onChange={(v) => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, speed: v } : cl) }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
              </>
            )}

            {/* ── Project Tab ──────────────────────────────────────────── */}
            {effectiveInspectorTab === 'project' && (
              <>
                {/* Canvas Aspect */}
                <section aria-labelledby="aspect-heading">
                  <h2 id="aspect-heading" className="mb-3 text-sm font-semibold">{t('aspect')}</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['16:9', '9:16', '4:3', '1:1', 'auto'] as CanvasAspect[]).map((a) => (
                      <button key={a} onClick={() => updateState((c) => ({ ...c, canvasAspect: a, presetName: null }))} className={`rounded border px-2 py-1.5 text-xs ${state.canvasAspect === a ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'}`}>{a}</button>
                    ))}
                  </div>
                </section>
                {/* Fit Mode */}
                <section aria-labelledby="fit-heading">
                  <h2 id="fit-heading" className="mb-3 text-sm font-semibold">{t('fit')}</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['contain', 'cover', 'stretch'] as CanvasFit[]).map((f) => (
                      <button key={f} onClick={() => updateState((c) => ({ ...c, canvasFit: f, presetName: null }))} className={`rounded border px-2 py-1.5 text-xs ${state.canvasFit === f ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'}`}>{t(f)}</button>
                    ))}
                  </div>
                </section>
                {/* Master Volume */}
                <section aria-labelledby="master-vol-heading">
                  <h2 id="master-vol-heading" className="mb-3 text-sm font-semibold">{t('master_volume')}</h2>
                  <RangeControl label={t('volume')} value={state.masterVolume} min={0} max={200} onChange={(v) => replaceState((c) => ({ ...c, masterVolume: v }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
                {/* Presets */}
                <section aria-labelledby="presets-heading">
                  <h2 id="presets-heading" className="mb-3 text-sm font-semibold">{t('presets')}</h2>
                  <div className="space-y-1.5">
                    {getPresetNames().map((name) => (
                      <button key={name} onClick={() => {
                        const applied = applyPreset({
                          canvasAspect: state.canvasAspect,
                          canvasFit: state.canvasFit,
                          exportSettings: state.exportSettings,
                          presetName: state.presetName,
                        }, name);
                        updateState((c) => ({
                          ...c,
                          canvasAspect: applied.canvasAspect,
                          canvasFit: applied.canvasFit,
                          exportSettings: applied.exportSettings,
                          presetName: applied.presetName,
                        }));
                      }} className={`w-full rounded border px-3 py-2 text-left text-xs ${state.presetName === name ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] hover:border-indigo-400'}`}>
                        <strong className="block">{t(`preset_${name.replace('-', '_')}` as string)}</strong>
                        <span className="text-[var(--muted)]">{PRESETS[name].description[i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en']}</span>
                      </button>
                    ))}
                  </div>
                </section>
                {/* M5: Custom presets */}
                <section aria-labelledby="custom-presets-heading">
                  <h2 id="custom-presets-heading" className="mb-3 text-sm font-semibold">{t('custom_presets')}</h2>
                  <div className="space-y-1.5">
                    {customPresets.map((cp) => (
                      <div key={cp.name} className={`flex items-center gap-1 rounded border px-3 py-2 text-xs ${state.presetName === cp.name ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)]'}`}>
                        <button className="flex-1 text-left" onClick={() => {
                          const applied = applyCustomPreset({
                            canvasAspect: state.canvasAspect,
                            canvasFit: state.canvasFit,
                            exportSettings: state.exportSettings,
                            presetName: state.presetName,
                          }, cp);
                          updateState((c) => ({ ...c, ...applied }));
                        }}><strong>{cp.name}</strong></button>
                        <button onClick={() => { setCustomPresets(deleteCustomPreset(cp.name)); setToast({ kind: 'success', message: t('preset_deleted') }); }} className="text-red-500 hover:text-red-400" aria-label={t('delete_preset')}><Trash2 className="h-3 w-3" /></button>
                      </div>
                    ))}
                    <button onClick={() => {
                      const name = window.prompt(t('preset_name_input'));
                      if (!name?.trim()) return;
                      setCustomPresets(saveCustomPreset({ name: name.trim(), canvasAspect: state.canvasAspect, canvasFit: state.canvasFit, exportSettings: { resolution: state.exportSettings.resolution, frameRate: state.exportSettings.frameRate, quality: state.exportSettings.quality } }));
                      setToast({ kind: 'success', message: t('preset_saved') });
                    }} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:border-indigo-500 hover:text-indigo-500">
                      <Plus className="h-3 w-3" />{t('save_preset')}
                    </button>
                  </div>
                </section>
                {/* Playback Speed (preview) */}
                <section aria-labelledby="playback-speed-heading">
                  <h2 id="playback-speed-heading" className="mb-3 text-sm font-semibold">{t('speed')} ({t('preview')})</h2>
                  <RangeControl label={t('speed')} value={state.playbackSpeed} min={0.25} max={4} step={0.25} unit="×" onChange={(v) => replaceState((c) => ({ ...c, playbackSpeed: v }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
              </>
            )}

            {/* ── Audio Tab ────────────────────────────────────────────── */}
            {effectiveInspectorTab === 'audio' && (
              <>
                {selection?.kind === 'source-audio' && activeClip && (
                  <section aria-labelledby="source-audio-heading" className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
                    <h2 id="source-audio-heading" className="mb-1 text-sm font-semibold">{t('source_audio_track')}</h2>
                    <p className="mb-3 text-xs text-[var(--muted)]">{activeClip.displayName} · {t('linked_to_video')}</p>
                    <div className="space-y-3">
                      <RangeControl label={t('volume')} value={activeClip.volume} min={0} max={200} onChange={(v) => updateClipField(activeClip.id, 'volume', v)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                      <button onClick={() => updateClipField(activeClip.id, 'muted', !activeClip.muted)} className={`flex w-full items-center justify-center gap-2 rounded border px-2 py-2 text-xs ${activeClip.muted ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/30 text-red-400'}`}>
                        {activeClip.muted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                        {activeClip.muted ? t('restore_source_audio') : t('remove_source_audio')}
                      </button>
                    </div>
                  </section>
                )}
                <details className="rounded border border-[var(--border)] p-3">
                  <summary className="cursor-pointer text-sm font-semibold">{t('project_audio_settings')}</summary>
                  <div className="mt-4 space-y-4">
                    <RangeControl label={t('audio_sync')} value={state.audioDelay} min={-5000} max={5000} step={10} unit="ms" onChange={(value) => replaceState((current) => ({ ...current, audioDelay: value }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('fade_in')} value={state.audioFade.fadeIn} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeIn: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('fade_out')} value={state.audioFade.fadeOut} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeOut: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <p className="text-xs leading-4 text-[var(--muted)]">{t('fade_hint')}</p>
                  </div>
                </details>
                {/* Background Audio */}
                <section aria-labelledby="bg-audio-heading">
                  <h2 id="bg-audio-heading" className="mb-3 text-sm font-semibold">{t('background_audio')}</h2>
                  {state.backgroundMusic ? (() => {
                    const track = state.backgroundMusic;
                    const selectedSegment = track.segments.find((s) => s.id === effectiveSelectedAudioSegmentId) ?? null;
                    const sourceDuration = track.duration > 0 ? track.duration : (selectedSegment ? Math.max(0.01, selectedSegment.trimEnd) : 0.01);
                    return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--raised)] p-2">
                        <Music className="h-4 w-4 shrink-0 text-indigo-500" />
                        <span className="flex-1 truncate text-xs" title={track.name}>{track.name}</span>
                        <button type="button" onClick={() => { updateState((c) => ({ ...c, backgroundMusic: null })); selectEditorItem(null); }} className="text-red-500 hover:text-red-400" aria-label={t('remove_audio')}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>

                      <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-2.5">
                        <label className="flex items-start gap-2 text-xs font-medium text-[var(--text)]">
                          <input type="checkbox" checked={track.replaceOriginalAudio} onChange={(e) => updateState((c) => ({ ...c, backgroundMusic: c.backgroundMusic ? { ...c.backgroundMusic, replaceOriginalAudio: e.target.checked } : null }))} aria-describedby="replace-original-audio-hint" className="mt-0.5 accent-indigo-500" />
                          <span>{t('replace_original_audio')}</span>
                        </label>
                        <p id="replace-original-audio-hint" className="mt-1.5 text-xs leading-4 text-[var(--muted)]">{t('replace_original_audio_hint')}</p>
                      </div>

                      {/* Segment list */}
                      <div role="listbox" aria-label={t('audio_segments')} className="space-y-1.5">
                        <p className="text-xs font-medium text-[var(--muted)]">{t('audio_segments')} · {track.segments.length}</p>
                        {track.segments.map((seg, i) => {
                          const dur = Math.max(0, seg.trimEnd - seg.trimStart);
                          const active = selectedSegment?.id === seg.id;
                          return (
                            <div key={seg.id} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${active ? 'border-emerald-400 bg-emerald-500/10' : 'border-[var(--border)] bg-[var(--raised)]'}`}>
                              <button type="button" role="option" aria-selected={active} onClick={() => selectAudioSegment(seg.id)} className="flex-1 truncate text-left">
                                <span className="font-medium">{t('audio_segment_n', { n: i + 1 })}</span>
                                <span className="ml-2 font-mono text-[var(--muted)]">{seg.projectStart.toFixed(1)}s · {dur.toFixed(1)}s</span>
                              </button>
                              <button type="button" onClick={() => { deleteAudioSegment(seg.id); if (selection?.kind === 'background-audio' && selection.id === seg.id) selectEditorItem(null); }} className="text-red-500 hover:text-red-400" aria-label={t('delete_audio_segment', { n: i + 1 })}><Trash2 className="h-3 w-3" /></button>
                            </div>
                          );
                        })}
                        {track.segments.length === 0 && <p className="text-xs text-[var(--muted)]">{t('no_audio_segments')}</p>}
                      </div>

                      {/* Segment tools */}
                      <div className="flex gap-2">
                        <button type="button" disabled={!selectedSegment || previewProjectTime <= selectedSegment.projectStart + 0.01 || previewProjectTime >= selectedSegment.projectStart + (selectedSegment.trimEnd - selectedSegment.trimStart) - 0.01} onClick={() => { if (selectedSegment) splitAudioSegmentAt(selectedSegment.id, previewProjectTime); }} className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--border)] px-2 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('split_audio_segment')} title={t('split_audio_segment')}><Scissors className="h-3.5 w-3.5" />{t('split')}</button>
                        <button type="button" onClick={() => addAudioSegment()} className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--border)] px-2 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-500" aria-label={t('add_audio_segment')} title={t('add_audio_segment')}><Plus className="h-3.5 w-3.5" />{t('add_audio_segment')}</button>
                      </div>

                      {/* Selected segment editor */}
                      {selectedSegment && (
                        <div className="space-y-4 rounded border border-emerald-500/30 bg-emerald-500/5 p-2.5" aria-label={t('selected_segment')}>
                          <p className="text-xs font-semibold text-[var(--text)]">{t('selected_segment')}</p>
                          <RangeControl label={t('audio_project_start')} value={selectedSegment.projectStart} min={0} max={Math.max(projectDurationSpeedAware, selectedSegment.projectStart, 1)} step={0.1} unit="s" onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { projectStart: Math.max(0, v) })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                          <RangeControl label={t('audio_trim_start')} value={selectedSegment.trimStart} min={0} max={Math.max(0, sourceDuration - 0.01)} step={0.1} unit="s" onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { trimStart: Math.min(v, selectedSegment.trimEnd - 0.01) })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                          <RangeControl label={t('audio_trim_end')} value={selectedSegment.trimEnd} min={selectedSegment.trimStart + 0.01} max={sourceDuration} step={0.1} unit="s" onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { trimEnd: Math.max(v, selectedSegment.trimStart + 0.01) })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                          <RangeControl label={t('audio_volume')} value={selectedSegment.volume} min={0} max={200} onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { volume: v })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                          <RangeControl label={t('audio_fade_in')} value={selectedSegment.fadeIn} min={0} max={Math.max(0.1, selectedSegment.trimEnd - selectedSegment.trimStart)} step={0.1} unit="s" onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { fadeIn: v })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                          <RangeControl label={t('audio_fade_out')} value={selectedSegment.fadeOut} min={0} max={Math.max(0.1, selectedSegment.trimEnd - selectedSegment.trimStart)} step={0.1} unit="s" onChange={(v) => editAudioSegmentTransient(selectedSegment.id, { fadeOut: v })} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                        </div>
                      )}
                    </div>
                    );
                  })() : (
                    <p className="rounded border border-dashed border-[var(--border)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">{t('import_audio_from_media')}</p>
                  )}
                </section>
              </>
            )}

            {/* ── Effects Tab ──────────────────────────────────────────── */}
            {effectiveInspectorTab === 'effects' && (
              <>
                {/* Filters */}
                <section aria-labelledby="filters-heading">
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 id="filters-heading" className="text-sm font-semibold">{t('filters')} <span className="text-[var(--muted)]">· {t('global')}</span></h2><button type="button" onClick={() => updateState((current) => ({ ...current, filters: { brightness: 100, contrast: 100, saturation: 100 } }))} disabled={state.filters.brightness === 100 && state.filters.contrast === 100 && state.filters.saturation === 100} className="rounded px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30">{t('reset')}</button></div>
                  <div className="space-y-4">
                    <RangeControl label={t('brightness')} value={state.filters.brightness} min={0} max={200} onChange={(value) => updateFilter('brightness', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('contrast')} value={state.filters.contrast} min={0} max={200} onChange={(value) => updateFilter('contrast', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('saturation')} value={state.filters.saturation} min={0} max={200} onChange={(value) => updateFilter('saturation', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                  </div>
                </section>
                {/* Transitions */}
                <section aria-labelledby="transitions-heading">
                  <h2 id="transitions-heading" className="mb-3 text-sm font-semibold">{t('transitions')}</h2>
                  {state.clips.length > 1 ? (
                    <div className="space-y-2">
                      {state.clips.slice(0, -1).map((clip, idx) => {
                        const existing = state.transitions.find((tr) => tr.afterClipId === clip.id);
                        return (
                          <div key={clip.id} className="rounded border border-[var(--border)] bg-[var(--raised)] p-2">
                            <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                              <span>{clip.displayName} → {state.clips[idx + 1]?.displayName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <select value={existing?.type ?? ''} onChange={(e) => {
                                const val = e.target.value;
                                if (!val) removeTransition(clip.id);
                                else addTransition(clip.id, val as TransitionConfig['type'], existing?.duration ?? 0.5);
                              }} className="flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-1 text-xs">
                                <option value="">{t('no_transition')}</option>
                                {(['fade', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideright', 'slideleft'] as const).map((type) => (
                                  <option key={type} value={type}>{t(`transition_${type}`)}</option>
                                ))}
                              </select>
                              {existing && (
                                <input type="number" min={0.2} max={3} step={0.1} value={existing.duration} onChange={(e) => addTransition(clip.id, existing.type, Number(e.target.value) || 0.5)} className="w-14 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('transition_duration')} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">{t('no_transition')}</p>
                  )}
                </section>
                {/* Text Overlays */}
                <section aria-labelledby="text-heading">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 id="text-heading" className="text-sm font-semibold">{t('text_overlays')}</h2>
                    <button onClick={addTextOverlay} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-500/10"><Plus className="h-3 w-3" />{t('add_text')}</button>
                  </div>
                  <div className="space-y-2">
                    {state.textOverlays.map((overlay) => (
                      <div key={overlay.id} className={`rounded border p-2 ${editingTextId === overlay.id ? 'border-indigo-500' : 'border-[var(--border)]'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <button onClick={() => editingTextId === overlay.id ? selectEditorItem(null) : selectEditorItem({ kind: 'effect', id: `text:${overlay.id}` })} className="text-xs text-indigo-500 hover:underline truncate flex-1 text-left">{overlay.text || t('text_content')}</button>
                          <button onClick={() => removeTextOverlay(overlay.id)} className="text-red-500 hover:text-red-400" aria-label={t('remove_text')}><Trash2 className="h-3 w-3" /></button>
                        </div>
                        {editingTextId === overlay.id && (
                          <div className="mt-2 space-y-2">
                            <input value={overlay.text} onChange={(e) => updateTextOverlay(overlay.id, { text: e.target.value })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs" placeholder={t('text_content')} />
                            <div className="grid grid-cols-2 gap-2">
                              <select value={overlay.fontFamily} onChange={(e) => updateTextOverlay(overlay.id, { fontFamily: e.target.value as 'sans' | 'serif' | 'mono' })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs">
                                <option value="sans">{t('font_sans')}</option>
                                <option value="serif">{t('font_serif')}</option>
                                <option value="mono">{t('font_mono')}</option>
                              </select>
                              <input type="number" min={12} max={200} value={overlay.fontSize} onChange={(e) => updateTextOverlay(overlay.id, { fontSize: clampNumber(e.target.value, 12, 200, 48) })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('font_size')} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input type="color" value={overlay.color} onChange={(e) => updateTextOverlay(overlay.id, { color: e.target.value })} className="h-9 w-full rounded border border-[var(--border)]" aria-label={t('text_color')} />
                              <div className="flex gap-1">
                                <input type="number" min={0} max={100} value={overlay.position.x} onChange={(e) => updateTextOverlay(overlay.id, { position: { ...overlay.position, x: clampNumber(e.target.value, 0, 100, overlay.position.x) } })} className="w-1/2 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('text_x')} />
                                <input type="number" min={0} max={100} value={overlay.position.y} onChange={(e) => updateTextOverlay(overlay.id, { position: { ...overlay.position, y: clampNumber(e.target.value, 0, 100, overlay.position.y) } })} className="w-1/2 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('text_y')} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input type="number" min={0} step={0.1} value={overlay.startTime} onChange={(e) => updateTextOverlay(overlay.id, { startTime: Number(e.target.value) || 0 })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('text_start')} />
                              <input type="number" min={0} step={0.1} value={overlay.endTime} onChange={(e) => updateTextOverlay(overlay.id, { endTime: Number(e.target.value) || 5 })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('text_end')} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* ── Subtitles & Overlays Tab ─────────────────────────────── */}
            {effectiveInspectorTab === 'subtitles' && (
              <>
                {/* Overlay tool bar */}
                <section aria-labelledby="overlay-tools-heading">
                  <h2 id="overlay-tools-heading" className="mb-2 text-sm font-semibold">{t('visual_overlays')}</h2>
                  <div role="toolbar" aria-label={t('visual_overlays')} className="mb-3 flex flex-wrap gap-2">
                    <button type="button" aria-pressed={overlayTool === 'select'} disabled={!activeClip} onClick={() => setOverlayTool('select')} className={`min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${overlayTool === 'select' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)] hover:border-indigo-400 hover:text-[var(--text)]'} disabled:opacity-40`}>{t('overlay_select')}</button>
                    <button type="button" aria-pressed={overlayTool === 'pen'} disabled={!activeClip} onClick={() => setOverlayTool('pen')} className={`min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${overlayTool === 'pen' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)] hover:border-indigo-400 hover:text-[var(--text)]'} disabled:opacity-40`}>{t('overlay_pen')}</button>
                    <button type="button" aria-pressed={overlayTool === 'rect'} disabled={!activeClip} onClick={() => setOverlayTool('rect')} className={`min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${overlayTool === 'rect' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)] hover:border-indigo-400 hover:text-[var(--text)]'} disabled:opacity-40`}>{t('overlay_rect_tool')}</button>
                    <button type="button" disabled={!activeClip} onClick={() => imageInputRef.current?.click()} className="min-h-9 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:border-indigo-500 hover:text-indigo-500 disabled:opacity-40">{t('add_image')}</button>
                  </div>
                  {/* Overlay list */}
                  {state.visualOverlays.length === 0 && <p className="text-xs text-[var(--muted)] mb-3">{t('no_overlays')}</p>}
                  {state.visualOverlays.map((overlay) => (
                    <div key={overlay.id} className={`mb-2 rounded border p-2 ${selectedOverlayId === overlay.id ? 'border-indigo-500' : 'border-[var(--border)]'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <button onClick={() => selectedOverlayId === overlay.id ? selectEditorItem(null) : selectEditorItem({ kind: overlay.type === 'image' ? 'image' : 'effect', id: overlay.type === 'image' ? overlay.id : `overlay:${overlay.id}` })} className="text-xs text-indigo-500 hover:underline capitalize">{overlay.type}</button>
                        <button onClick={() => removeVisualOverlay(overlay.id)} className="text-red-500 hover:text-red-400" aria-label={t('remove_overlay')}><Trash2 className="h-3 w-3" /></button>
                      </div>
                      {selectedOverlayId === overlay.id && (
                        <div className="mt-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-[var(--muted)]">{t('overlay_x')}<input type="number" min={0} max={100} step={1} value={Math.round(overlay.position.x)} onChange={(e) => updateVisualOverlay(overlay.id, { position: { ...overlay.position, x: clampNumber(e.target.value, 0, 100, overlay.position.x) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            <label className="text-xs text-[var(--muted)]">{t('overlay_y')}<input type="number" min={0} max={100} step={1} value={Math.round(overlay.position.y)} onChange={(e) => updateVisualOverlay(overlay.id, { position: { ...overlay.position, y: clampNumber(e.target.value, 0, 100, overlay.position.y) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-[var(--muted)]">{t('overlay_width')}<input type="number" min={1} max={100} step={1} value={Math.round(overlay.size.w)} onChange={(e) => updateVisualOverlay(overlay.id, { size: { ...overlay.size, w: clampNumber(e.target.value, 1, 100, overlay.size.w) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            <label className="text-xs text-[var(--muted)]">{t('overlay_height')}<input type="number" min={1} max={100} step={1} value={Math.round(overlay.size.h)} onChange={(e) => updateVisualOverlay(overlay.id, { size: { ...overlay.size, h: clampNumber(e.target.value, 1, 100, overlay.size.h) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-[var(--muted)]">{t('overlay_rotation')}<input type="number" min={-360} max={360} step={1} value={overlay.rotation} onChange={(e) => updateVisualOverlay(overlay.id, { rotation: clampNumber(e.target.value, -360, 360, 0) })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            <label className="text-xs text-[var(--muted)]">{t('overlay_opacity')}<input type="number" min={0} max={1} step={0.1} value={overlay.opacity} onChange={(e) => updateVisualOverlay(overlay.id, { opacity: clampNumber(e.target.value, 0, 1, overlay.opacity) })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-[var(--muted)]">{t('overlay_start')}<input type="number" min={0} max={Math.max(0, overlay.endTime - 0.1)} step={0.1} value={overlay.startTime} onChange={(e) => { const v = Math.max(0, Math.min(overlay.endTime - 0.01, Number(e.target.value) || 0)); updateVisualOverlay(overlay.id, { startTime: v }); }} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            <label className="text-xs text-[var(--muted)]">{t('overlay_end')}<input type="number" min={overlay.startTime + 0.01} step={0.1} value={overlay.endTime} onChange={(e) => { const v = Math.max(overlay.startTime + 0.01, Number(e.target.value) || overlay.startTime + 1); updateVisualOverlay(overlay.id, { endTime: v }); }} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                          </div>
                          {(overlay.type === 'rectangle' || overlay.type === 'drawing') && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-[var(--muted)]">{t('overlay_stroke')}<input type="color" value={(overlay as DrawingOverlay).strokeColor || '#ff0000'} onChange={(e) => updateVisualOverlay(overlay.id, { strokeColor: e.target.value } as Partial<VisualOverlay>)} className="h-9 w-full rounded border border-[var(--border)]" /></label>
                              {overlay.type === 'rectangle' && (
                                <label className="text-xs text-[var(--muted)]">{t('overlay_fill')}<span className="flex gap-0.5"><input type="color" value={(overlay as import('@/lib/visual-overlay-utils').RectangleOverlay).fillColor || '#000000'} onChange={(e) => updateVisualOverlay(overlay.id, { fillColor: e.target.value } as Partial<VisualOverlay>)} className="h-9 flex-1 rounded border border-[var(--border)]" /><button type="button" onClick={() => updateVisualOverlay(overlay.id, { fillColor: '' } as Partial<VisualOverlay>)} className="min-w-9 rounded border border-[var(--border)] px-1 text-xs text-[var(--muted)] hover:text-red-500" title={t('clear_fill')}>✕</button></span></label>
                              )}
                              <label className="text-xs text-[var(--muted)]">{t('overlay_line_width')}<input type="number" min={0} max={20} step={0.5} value={(overlay as DrawingOverlay).strokeWidth ?? 2} onChange={(e) => updateVisualOverlay(overlay.id, { strokeWidth: clampNumber(e.target.value, 0, 20, (overlay as DrawingOverlay).strokeWidth ?? 2) } as Partial<VisualOverlay>)} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </section>

                {/* Subtitles */}
                <section aria-labelledby="subtitles-heading">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 id="subtitles-heading" className="text-sm font-semibold">{t('subtitles')}</h2>
                    <button onClick={addSubtitle} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-500/10"><Plus className="h-3 w-3" />{t('add_subtitle')}</button>
                  </div>
                  <p className="text-xs text-[var(--muted)] mb-2">{t('tts_media_private')}</p>
                  <div className="space-y-2">
                    {state.subtitles.map((cue) => (
                      <div key={cue.id} className={`rounded border p-2 ${editingSubtitleId === cue.id ? 'border-indigo-500' : 'border-[var(--border)]'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <button onClick={() => editingSubtitleId === cue.id ? selectEditorItem(null) : selectEditorItem({ kind: 'subtitle', id: cue.id })} className="text-xs text-indigo-500 hover:underline truncate flex-1 text-left">{cue.text || t('subtitle_text')}</button>
                          <button onClick={() => removeSubtitle(cue.id)} className="text-red-500 hover:text-red-400" aria-label={t('remove_subtitle')}><Trash2 className="h-3 w-3" /></button>
                        </div>
                        {editingSubtitleId === cue.id && (
                          <div className="mt-2 space-y-2">
                            {/* Multiline text */}
                            <textarea
                              value={cue.text}
                              onChange={(e) => updateSubtitle(cue.id, { text: e.target.value })}
                              rows={3}
                              className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs resize-y"
                              placeholder={t('subtitle_text')}
                            />
                            {/* Font / Size / Align */}
                            <div className="grid grid-cols-3 gap-1.5">
                              <select value={cue.fontFamily} onChange={(e) => updateSubtitle(cue.id, { fontFamily: e.target.value as 'sans' | 'serif' | 'mono' })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs" aria-label={t('subtitle_font')}>
                                <option value="sans">{t('font_sans')}</option>
                                <option value="serif">{t('font_serif')}</option>
                                <option value="mono">{t('font_mono')}</option>
                              </select>
                              <input type="number" min={12} max={200} value={cue.fontSize} onChange={(e) => updateSubtitle(cue.id, { fontSize: clampNumber(e.target.value, 12, 200, 48) })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" aria-label={t('subtitle_size')} />
                              <select value={cue.align} onChange={(e) => updateSubtitle(cue.id, { align: e.target.value as 'left' | 'center' | 'right' })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs" aria-label={t('subtitle_align')}>
                                <option value="left">{t('align_left')}</option>
                                <option value="center">{t('align_center')}</option>
                                <option value="right">{t('align_right')}</option>
                              </select>
                            </div>
                            {/* Color / Bg / lineHeight */}
                            <div className="grid grid-cols-3 gap-2">
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_color')}<input type="color" value={cue.color} onChange={(e) => updateSubtitle(cue.id, { color: e.target.value })} className="h-9 w-full rounded border border-[var(--border)]" /></label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_bg')}
                                <div className="flex gap-0.5">
                                  <input type="color" value={cue.backgroundColor || '#000000'} onChange={(e) => updateSubtitle(cue.id, { backgroundColor: e.target.value })} className="h-9 flex-1 rounded border border-[var(--border)]" />
                                  <button type="button" onClick={() => updateSubtitle(cue.id, { backgroundColor: '' })} className="min-w-9 rounded border border-[var(--border)] px-1 text-xs text-[var(--muted)] hover:text-red-500" title={t('clear_bg')}>✕</button>
                                </div>
                              </label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_line_height')}<input type="number" min={0.8} max={3} step={0.1} value={cue.lineHeight} onChange={(e) => updateSubtitle(cue.id, { lineHeight: Math.max(0.8, Math.min(3, Number(e.target.value) || 1.3)) })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            </div>
                            {/* Position / Width / Rotation */}
                            <div className="grid grid-cols-4 gap-1.5">
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_x')}<input type="number" min={0} max={100} value={cue.position.x} onChange={(e) => updateSubtitle(cue.id, { position: { ...cue.position, x: clampNumber(e.target.value, 0, 100, cue.position.x) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_y')}<input type="number" min={0} max={100} value={cue.position.y} onChange={(e) => updateSubtitle(cue.id, { position: { ...cue.position, y: clampNumber(e.target.value, 0, 100, cue.position.y) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_width')}<input type="number" min={10} max={100} value={cue.width} onChange={(e) => updateSubtitle(cue.id, { width: clampNumber(e.target.value, 10, 100, cue.width) })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_rotation')}<input type="number" min={-360} max={360} value={cue.rotation} onChange={(e) => updateSubtitle(cue.id, { rotation: clampNumber(e.target.value, -360, 360, 0) })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            </div>
                            {/* Start / End time */}
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_start')}<input type="number" min={0} max={Math.max(0, cue.endTime - 0.1)} step={0.1} value={cue.startTime} onChange={(e) => { const v = Math.max(0, Math.min(cue.endTime - 0.01, Number(e.target.value) || 0)); updateSubtitle(cue.id, { startTime: v }); }} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                              <label className="text-xs text-[var(--muted)]">{t('subtitle_end')}<input type="number" min={cue.startTime + 0.01} step={0.1} value={cue.endTime} onChange={(e) => { const v = Math.max(cue.startTime + 0.01, Number(e.target.value) || cue.startTime + 1); updateSubtitle(cue.id, { endTime: v }); }} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                            </div>
                            {/* TTS */}
                            <div className="rounded border border-[var(--border)] p-2 mt-2">
                              <label className="flex items-center gap-2 text-xs mb-2">
                                <input type="checkbox" checked={cue.tts?.enabled ?? false} onChange={(e) => {
                                  const enabled = e.target.checked;
                                  const defVoice = getDefaultLocalVoice(cue.text || undefined);
                                  const nextTts = cue.tts
                                    ? { ...cue.tts, enabled }
                                    : { enabled, voiceURI: '', lang: defVoice.lang, rate: 1, pitch: 1, volume: 1, exportVoiceId: defVoice.id, includeInExport: true };
                                  const nextCue = { ...cue, tts: nextTts };
                                  updateSubtitle(cue.id, { tts: nextTts });
                                  if (enabled && cue.text.trim()) {
                                    void synthesizeLocalTts(nextCue).catch((error) => {
                                      console.error('Local TTS pre-generation failed', error);
                                      setLocalTtsPhase('idle');
                                      setLocalTtsCueId(null);
                                      setToast({ kind: 'error', message: t(error instanceof Error && error.name === 'TtsModelDownloadError' ? 'tts_model_download_failed' : 'tts_generation_failed') });
                                    });
                                  }
                                }} className="accent-indigo-500" />
                                <span className="font-medium">{t('tts_enable')}</span>
                              </label>
                              {cue.tts?.enabled && (
                                <div className="space-y-2">
                                  {/* Export voice select */}
                                  <label className="text-xs text-[var(--muted)]">{t('tts_export_voice')}
                                    <select value={cue.tts.exportVoiceId} onChange={(e) => {
                                      updateSubtitle(cue.id, { tts: { ...cue.tts!, exportVoiceId: e.target.value } });
                                    }} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs mt-0.5" aria-label={t('tts_export_voice')}>
                                      <optgroup label={t('tts_voice_group_zh')}>
                                        {LOCAL_TTS_VOICES.filter((v) => v.lang.startsWith('zh')).map((v) => (
                                          <option key={v.id} value={v.id}>{v.name} ({v.lang} · {v.quality} · {v.sizeMB} MB)</option>
                                        ))}
                                      </optgroup>
                                      <optgroup label={t('tts_voice_group_en')}>
                                        {LOCAL_TTS_VOICES.filter((v) => v.lang.startsWith('en')).map((v) => (
                                          <option key={v.id} value={v.id}>{v.name} ({v.lang} · {v.quality} · {v.sizeMB} MB)</option>
                                        ))}
                                      </optgroup>
                                    </select>
                                  </label>
                                  {/* Include in export checkbox */}
                                  <label className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={cue.tts.includeInExport !== false} onChange={(e) => {
                                      updateSubtitle(cue.id, { tts: { ...cue.tts!, includeInExport: e.target.checked } });
                                    }} className="accent-indigo-500" />
                                    <span>{t('tts_include_export')}</span>
                                  </label>
                                  {/* Piper rate / volume */}
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <label className="text-xs text-[var(--muted)]">{t('tts_rate')}<input type="number" min={0.5} max={2} step={0.1} value={cue.tts.rate} onChange={(e) => updateSubtitle(cue.id, { tts: { ...cue.tts!, rate: clampNumber(e.target.value, 0.5, 2, 1) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                                    <label className="text-xs text-[var(--muted)]">{t('tts_volume')}<input type="number" min={0} max={1} step={0.1} value={cue.tts.volume} onChange={(e) => updateSubtitle(cue.id, { tts: { ...cue.tts!, volume: clampNumber(e.target.value, 0, 1, 1) } })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-xs font-mono" /></label>
                                  </div>
                                  {/* Preview (local WAV) / Stop */}
                                  <div className="flex gap-2 items-center">
                                    <button onClick={() => void previewTts(cue)} disabled={ttsPlaying || localTtsPhase !== 'idle'} className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-40">{t('tts_local_preview')}</button>
                                    <button onClick={stopTts} disabled={!ttsPlaying} className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--raised)] disabled:opacity-40">{t('tts_stop')}</button>
                                    {localTtsCueId === cue.id && localTtsPhase !== 'idle' && (
                                      <span className="text-xs text-[var(--muted)]">
                                        {localTtsPhase === 'downloading' ? t('tts_downloading_model') : t('tts_generating')} {t('tts_progress', { percent: localTtsProgress })}
                                      </span>
                                    )}
                                  </div>
                                  {/* Model info */}
                                  <p className="text-xs text-[var(--muted)]">
                                    {t('tts_model_info', { size: `${(getVoiceById(cue.tts.exportVoiceId)?.sizeMB ?? 63.2).toFixed(1)}` })}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>

          {!rightPanelCollapsed && <div role="separator" aria-label={t('resize_inspector_panel')} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={720} aria-valuenow={Math.round(rightPanelWidth)} tabIndex={0} className="workspace-resizer workspace-resizer-x absolute inset-y-0 left-0 z-40 hidden -translate-x-1/2 lg:block" onPointerDown={(event) => startWorkspaceResize(event, 'inspector')} onKeyDown={(event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); resizeWorkspaceFromKeyboard('inspector', (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 48 : 16)); }} />}
        </aside>
      </div>

      {/* ─── Timeline ────────────────────────────────────────────────────── */}
      <footer
        className="relative flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--panel)] transition-[height]"
        style={{ height: timelineCollapsed ? '2.5rem' : `${timelineHeight}px` }}
      >
        {!timelineCollapsed && <div role="separator" aria-label={t('resize_timeline_panel')} aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={Math.max(220, typeof window === 'undefined' ? 800 : window.innerHeight - 160)} aria-valuenow={Math.round(timelineHeight)} tabIndex={0} className="workspace-resizer workspace-resizer-y absolute inset-x-0 top-0 z-40 -translate-y-1/2" onPointerDown={(event) => startWorkspaceResize(event, 'timeline')} onKeyDown={(event) => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); resizeWorkspaceFromKeyboard('timeline', (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 48 : 16)); }} />}
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs text-[var(--muted)] sm:px-4">
          <button onClick={() => setTimelineCollapsed(!timelineCollapsed)} className={iconButton} aria-label={timelineCollapsed ? t('expand_timeline') : t('collapse_timeline')}>
            {timelineCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <span><strong className="text-[var(--text)]">V1</strong> {t('video_track')}</span>
          <span className="hidden sm:inline"><strong className="text-[var(--text)]">A1</strong> {t('source_audio_track')}</span>
          {!timelineCollapsed && <button type="button" onClick={splitAtPlayhead} disabled={!canContextSplit} className={`${iconButton} gap-1 px-2`} title={canContextSplit ? t('split_at_playhead') : t('split_unavailable')}><Scissors className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t('cut')}</span></button>}
          <span className="ml-auto hidden font-mono sm:inline">{formatEditorTime(previewProjectTime)} / {formatEditorTime(projectDurationSpeedAware)}{state.transitions.length > 0 && outputDuration < projectDurationSpeedAware - 0.01 ? ` · ${t('output_duration', { value: outputDuration.toFixed(1) })}` : ''}</span>
          {/* Zoom controls — one 0.25 step for buttons; Ctrl/Meta+wheel matches */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => setTimelineZoom((z) => stepTimelineZoom(z, -1))} className={iconButton} aria-label={t('zoom_out')} title={t('zoom_out')}><ZoomOut className="h-3.5 w-3.5" /></button>
            <button onClick={() => setTimelineZoom(1)} className="rounded px-1.5 py-0.5 text-xs font-mono hover:bg-[var(--raised)]" aria-label={t('zoom_reset')} title={t('zoom_reset')}>{(timelineZoom * 100).toFixed(0)}%</button>
            <button onClick={() => setTimelineZoom((z) => stepTimelineZoom(z, 1))} className={iconButton} aria-label={t('zoom_in')} title={t('zoom_in')}><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {!timelineCollapsed && (
          state.clips.length ? (
            <Timeline
              clips={state.clips.map((c) => ({ id: c.id, name: c.displayName, trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed, volume: c.volume, muted: c.muted }))}
              activeClipId={state.activeClipId}
              currentTime={currentTime}
              onSeek={seekTimeline}
              onReorder={reorderClip}
              onSelectVideo={(id) => selectVideoClip(id, 'video')}
              onSelectSourceAudio={(id) => selectVideoClip(id, 'source-audio')}
              zoom={timelineZoom}
              onZoomChange={setTimelineZoom}
              hasBackgroundAudioSource={Boolean(state.backgroundMusic)}
              audioSegments={(state.backgroundMusic?.segments ?? []).map((s) => ({
                id: s.id,
                name: state.backgroundMusic!.name,
                projectStart: s.projectStart,
                trimStart: s.trimStart,
                trimEnd: s.trimEnd,
              }))}
              selectedAudioSegmentId={effectiveSelectedAudioSegmentId}
              onSelectAudioSegment={selectAudioSegment}
              onAudioSegmentMove={moveAudioSegment}
              onBackgroundAudioDrop={addAudioSegment}
              onAudioEditStart={beginContinuousEdit}
              onAudioEditEnd={finishContinuousEdit}
              ttsItems={timelineTtsItems}
              subtitleItems={timelineSubtitleItems}
              imageItems={timelineImageItems}
              effectItems={timelineEffectItems}
              selectedTimedItem={selectedTimelineItem}
              onSelectTimedItem={selectTimelineTimedItem}
              onTimedItemMove={moveTimelineTimedItem}
              onTimedEditStart={beginContinuousEdit}
              onTimedEditEnd={finishContinuousEdit}
            />
          ) : <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted)]">{t('no_media')}</div>
        )}
      </footer>

      {/* ─── Export Modal ─────────────────────────────────────────────────── */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) closeExportModal(); }}>
          <div ref={exportDialogRef} role="dialog" aria-modal="true" aria-labelledby="export-modal-heading" aria-describedby="export-modal-description" tabIndex={-1} onKeyDown={(e) => trapFocus(e, exportDialogRef)} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div><h2 id="export-modal-heading" className="text-sm font-semibold">{t('export_settings')}</h2><p id="export-modal-description" className="mt-0.5 text-xs text-[var(--muted)]">{t('export_settings_hint')}</p></div>
              <button type="button" onClick={closeExportModal} className={iconButton} aria-label={t('close_export_settings')}><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <ExportPanel
                settings={state.exportSettings}
                projectDuration={projectDurationSpeedAware}
                disabled={!state.clips.length || processing}
                onChange={(settings, transient) => {
                  const apply = (current: EditorState) => ({ ...current, exportSettings: settings, presetName: null });
                  if (transient) replaceState(apply);
                  else updateState(apply);
                }}
                onEditStart={beginContinuousEdit}
                onEditEnd={finishContinuousEdit}
                onExport={(format) => { setExportModalOpen(false); void handleExport(format); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Help Modal ──────────────────────────────────────────────────── */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) closeHelpModal(); }}>
          <div ref={helpDialogRef} role="dialog" aria-modal="true" aria-labelledby="help-heading" tabIndex={-1} onKeyDown={(e) => trapFocus(e, helpDialogRef)} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="help-heading" className="text-sm font-semibold">{t('keyboard_shortcuts')}</h2>
              <button onClick={closeHelpModal} className={iconButton} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ['Space', t('shortcut_play')],
                ['S', t('shortcut_split')],
                ['Ctrl+Z', t('shortcut_undo')],
                ['Ctrl+Shift+Z', t('shortcut_redo')],
                ['Ctrl+E', t('shortcut_export')],
                ['Delete', t('shortcut_delete')],
                ['←', t('shortcut_back')],
                ['→', t('shortcut_forward')],
                ['Shift+←', t('shortcut_back_fine')],
                ['Shift+→', t('shortcut_forward_fine')],
                ['F', t('shortcut_fullscreen')],
                ['M', t('shortcut_mute')],
                ['?', t('shortcut_help_key')],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-2 py-0.5 font-mono text-xs">{key}</kbd>
                  <span className="text-[var(--muted)]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Project Manager Modal ───────────────────────────────────────── */}
      {showProjectManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) closeProjectManager(); }}>
          <div ref={projectDialogRef} role="dialog" aria-modal="true" aria-labelledby="pm-heading" tabIndex={-1} onKeyDown={(e) => trapFocus(e, projectDialogRef)} className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 id="pm-heading" className="text-sm font-semibold">{t('projects')}</h2>
              <button onClick={closeProjectManager} className={iconButton} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex gap-2">
                <input value={projectNameInput} onChange={(e) => setProjectNameInput(e.target.value)} placeholder={t('project_name')} className="flex-1 rounded border border-[var(--border)] bg-[var(--raised)] px-2 py-1.5 text-xs" onKeyDown={(e) => { if (e.key === 'Enter') void handleNewProject(); }} />
                <button onClick={() => void handleNewProject()} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500">{t('new_project')}</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {projects.length === 0 && <p className="text-center text-xs text-[var(--muted)] py-4">{t('no_projects')}</p>}
              {projects.map((project) => (
                <div key={project.id} className={`rounded-lg border p-3 ${project.id === currentProjectId ? 'border-indigo-500 bg-indigo-500/5' : 'border-[var(--border)]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => void handleSwitchProject(project.id)} className="flex-1 text-left">
                      <span className="block text-xs font-medium truncate">{project.name}</span>
                      <span className="block text-xs text-[var(--muted)]">{new Date(project.updatedAt).toLocaleString()}</span>
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => { const name = window.prompt(t('project_name'), project.name); if (name) void handleRenameProject(project.id, name); }} className={iconButton} aria-label={t('rename_project')} title={t('rename_project')}><Edit2 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => void handleDuplicateProject(project.id)} className={iconButton} aria-label={t('duplicate_project')} title={t('duplicate_project')}><Copy className="h-3.5 w-3.5" /></button>
                      <button onClick={() => void handleDeleteProject(project.id)} className={`${iconButton} hover:text-red-500`} aria-label={t('delete_project')} title={t('delete_project')}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ───────────────────────────────────────────────────────── */}
      {toast && <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm text-white shadow-xl ${toast.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}>{toast.message}</div>}
    </div>
  );
}
