'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Edit2,
  FileVideo, HelpCircle, Maximize, Menu, Minimize, MonitorPlay, Moon,
  Music, Pause, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, SlidersHorizontal,
  Sun, Trash2, Undo2, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import ExportPanel from '@/components/ExportPanel';
import Timeline from '@/components/Timeline';
import {
  buildFFmpegCommandExtended, resolveExportProfile,
  selectClipsForExportSpeedAware,
  type AudioFadeSettings, type ExportSettings,
  type ExtendedClipMetadata, type TransitionConfig, type TextOverlay,
  type BgMusicExport,
} from '@/lib/ffmpeg-utils';
import {
  duplicateClip, getProjectDurationSpeedAware, projectTimeForClipSpeedAware,
  moveClipToIndex, splitClipAt,
  buildRotationTransformCSS, type CanvasAspect, type CanvasFit,
} from '@/lib/editor-utils';
import { useHistory } from '@/lib/history';
import {
  createDraft, listDrafts, loadDraft, saveDraft, deleteDraft, renameDraft,
  migrateFromV1, applyStateDefaults,
  type DraftProject, type DraftState, type DraftClip,
} from '@/lib/draft-store';
import { PRESETS, getPresetNames, applyPreset, loadCustomPresets, saveCustomPreset, deleteCustomPreset, applyCustomPreset, type CustomPreset } from '@/lib/preset-utils';
import { selectTextOverlaysForExport } from '@/lib/text-overlay-utils';
import { computeTransitionAdjustedDuration, type TransitionClip } from '@/lib/transition-utils';
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
  backgroundMusic: { name: string; file?: File; url?: string; volume: number; loop: boolean; fadeIn: number; fadeOut: number } | null;
  presetName: string | null;
}

type InspectorTab = 'clip' | 'project' | 'audio' | 'effects';
type MobilePanel = 'media' | 'inspector' | null;
type Toast = { kind: 'success' | 'error'; message: string } | null;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
};
const iconButton = 'rounded-md p-2 text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30';

// ─── RangeControl ────────────────────────────────────────────────────────────

interface RangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}

function RangeControl({
  label, value, min, max, step = 1, unit = '%', disabled,
  onChange, onEditStart, onEditEnd,
}: RangeControlProps) {
  const id = useId();
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const updateValue = (next: number) => {
    if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
  };
  return (
    <div className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-range`}>{label}</label>
        <div className="flex items-center gap-1">
          <label htmlFor={`${id}-number`} className="sr-only">{label}</label>
          <input
            id={`${id}-number`} type="number" min={min} max={max} step={step}
            value={Number(value.toFixed(digits))} disabled={disabled} aria-label={`${label} (${unit})`}
            onFocus={onEditStart}
            onChange={(event) => updateValue(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => { onEditStart(); if (event.key === 'Enter') event.currentTarget.blur(); }}
            onBlur={onEditEnd}
            className="w-20 rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-1 text-right font-mono text-[11px] text-[var(--text)] disabled:opacity-40"
          />
          <span className="min-w-4 text-[10px]">{unit}</span>
        </div>
      </div>
      <input
        id={`${id}-range`} type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        onPointerDown={onEditStart} onPointerUp={onEditEnd} onKeyDown={onEditStart}
        onKeyUp={onEditEnd} onBlur={onEditEnd} onChange={(event) => updateValue(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
}

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

function fileIdentity(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
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
      volume: state.backgroundMusic.volume,
      loop: state.backgroundMusic.loop,
      fadeIn: state.backgroundMusic.fadeIn,
      fadeOut: state.backgroundMusic.fadeOut,
      file: state.backgroundMusic.file,
    } : null,
    presetName: state.presetName,
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
      ...draft.backgroundMusic,
      file: draft.backgroundMusic.file instanceof Blob ? draft.backgroundMusic.file as File : undefined,
      url: draft.backgroundMusic.file instanceof Blob ? createUrl(draft.backgroundMusic.file as File) : undefined,
    } : null,
    presetName: draft.presetName ?? null,
  };
}

// ─── Editor Component ────────────────────────────────────────────────────────

export default function Editor() {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const {
    state, set: updateState, replace: replaceState, checkpoint, undo, redo,
    canUndo, canRedo, reset,
  } = useHistory<EditorState>(DEFAULT_STATE);

  // UI state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'loading' | 'preparing' | 'rendering'>('loading');
  const [progress, setProgress] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('clip');
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [holdingCompare, setHoldingCompare] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedTime, setLastSavedTime] = useState<number | null>(null);
  const [renamingClipId, setRenamingClipId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Project manager state
  const [projects, setProjects] = useState<DraftProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const helpDialogRef = useRef<HTMLDivElement>(null);
  const projectDialogRef = useRef<HTMLDivElement>(null);
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

  const activeClip = state.clips.find((clip) => clip.id === state.activeClipId);
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

  const createTrackedUrl = useCallback((file: Blob) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  // ─── Lifecycle & Draft ───────────────────────────────────────────────────

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    ffmpegRef.current?.terminate();
  }, []);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en';
  }, [i18n.resolvedLanguage]);

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
    // H2/H3: Flush an immediate save when a continuous edit finishes
    if (currentProjectId && draftReady) {
      savingRef.current = true;
      setSaveStatus('saving');
      void persistProject(currentProjectId, editorStateToDraft(state)).then(() => {
        setSaveStatus('saved');
        setLastSavedTime(Date.now());
      }).catch(() => {
        setSaveStatus('error');
      }).finally(() => {
        savingRef.current = false;
      });
    }
  }, [checkpoint, currentProjectId, draftReady, persistProject, state]);

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
      setMobilePanel(null);
    } finally {
      importingRef.current = false;
      setImportProgress(null);
    }
  }, [createTrackedUrl, currentProjectId, state.clips, t, updateState]);

  // ─── Background Audio Import ─────────────────────────────────────────────

  const importBackgroundAudio = useCallback(async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.name)) {
      setToast({ kind: 'error', message: t('invalid_audio') });
      return;
    }
    const url = createTrackedUrl(file);
    updateState((current) => ({
      ...current,
      backgroundMusic: {
        name: file.name, file, url,
        volume: 80, loop: false, fadeIn: 0, fadeOut: 0,
      },
    }));
  }, [createTrackedUrl, t, updateState]);

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
  }, [updateState]);

  const moveClip = useCallback((id: string, direction: -1 | 1) => {
    updateState((current) => {
      const index = current.clips.findIndex((clip) => clip.id === id);
      const clips = moveClipToIndex(current.clips, id, index + direction);
      return clips === current.clips ? current : { ...current, clips };
    });
  }, [updateState]);

  const reorderClip = useCallback((id: string, targetIndex: number) => {
    updateState((current) => {
      const clips = moveClipToIndex(current.clips, id, targetIndex);
      return clips === current.clips ? current : { ...current, clips };
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
    setIsPlaying(false);
    const newId = crypto.randomUUID();
    updateState((current) => {
      if (current.activeClipId !== activeClip.id) return current;
      const clips = splitClipAt(current.clips, activeClip.id, currentTime, newId);
      return clips === current.clips ? current : { ...current, clips, activeClipId: newId };
    });
  }, [activeClip, canSplit, currentTime, t, updateState]);

  const renameClip = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    updateState((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === id ? { ...clip, displayName: newName.trim() } : clip),
    }));
    setRenamingClipId(null);
  }, [updateState]);

  // ─── Playback ────────────────────────────────────────────────────────────

  const seekTimeline = useCallback((clipId: string, sourceTime: number) => {
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
  }, [activeClip?.id, isPlaying, replaceState, state.clips]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    if (video.paused) {
      if (video.currentTime < activeClip.trimStart || video.currentTime >= activeClip.trimEnd) {
        video.currentTime = activeClip.trimStart;
      }
      void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [activeClip]);

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.currentTime = Math.min(activeClip.trimEnd, Math.max(activeClip.trimStart, video.currentTime + seconds));
    setCurrentTime(video.currentTime);
  }, [activeClip]);

  // ─── Fullscreen ──────────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    if (!previewContainerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void previewContainerRef.current.requestFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // H4: Apply clip volume * master volume to preview (HTML volume caps at 1.0)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    if (activeClip.muted) {
      video.volume = 0;
    } else {
      const effective = (activeClip.volume / 100) * (state.masterVolume / 100);
      video.volume = Math.min(1.0, Math.max(0, effective));
    }
  }, [activeClip, state.masterVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    video.playbackRate = Math.max(0.0625, Math.min(16, (activeClip.speed || 1) * state.playbackSpeed));
  }, [activeClip, state.playbackSpeed]);

  // ─── FFmpeg & Export ─────────────────────────────────────────────────────

  const ensureFfmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (ffmpegLoadRef.current) return ffmpegLoadRef.current;

    const instance = new FFmpeg();
    ffmpegRef.current = instance;
    instance.on('progress', ({ progress: value }) => setProgress(Math.max(0, Math.min(100, value * 100))));

    const loadPromise = (async () => {
      const baseURL = process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL
        ?? 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await instance.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
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

      // Write background audio if present
      let bgMusicExport: BgMusicExport | null = null;
      if (state.backgroundMusic?.file) {
        const bgExt = state.backgroundMusic.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'mp3';
        const bgFilename = `bg-audio.${bgExt}`;
        temporaryFiles.push(bgFilename);
        await engine.writeFile(bgFilename, await fetchFile(state.backgroundMusic.file));
        bgMusicExport = {
          filename: bgFilename,
          volume: state.backgroundMusic.volume,
          loop: state.backgroundMusic.loop,
          fadeIn: state.backgroundMusic.fadeIn,
          fadeOut: state.backgroundMusic.fadeOut,
        };
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
          bgMusicExport,
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

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    if (event.key !== 'Tab') return;
    const focusable = ref.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
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

  // ─── Project Manager ─────────────────────────────────────────────────────

  const refreshProjects = useCallback(async () => {
    const all = await listDrafts();
    setProjects(all);
  }, []);

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
    setProjectNameInput('');
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_created') });
  }, [forceSaveCurrentProject, projectNameInput, refreshProjects, reset, t]);

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
    setToast({ kind: 'success', message: t('project_switched') });
    setShowProjectManager(false);
  }, [createTrackedUrl, currentProjectId, forceSaveCurrentProject, reset, t]);

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
      }
    }
    await refreshProjects();
    setToast({ kind: 'success', message: t('project_deleted') });
  }, [currentProjectId, forceSaveCurrentProject, handleSwitchProject, refreshProjects, reset, t]);

  // ─── Keyboard Shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, button, summary, [contenteditable="true"]');

      if (event.code === 'Escape') {
        if (showHelpModal) { event.preventDefault(); setShowHelpModal(false); return; }
        if (showProjectManager) { event.preventDefault(); setShowProjectManager(false); return; }
        if (exportModalOpen) { event.preventDefault(); closeExportModal(); return; }
        if (mobilePanel) { event.preventDefault(); setMobilePanel(null); return; }
      }
      if (exportModalOpen || showHelpModal || showProjectManager || editing) return;

      if (event.key === '?') { event.preventDefault(); setShowHelpModal(true); return; }
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (!event.ctrlKey && !event.metaKey && event.code === 'KeyS') { event.preventDefault(); splitActiveClip(); }
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
      if (event.code === 'Delete' && activeClip) { event.preventDefault(); removeClip(activeClip.id); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); seek(event.shiftKey ? -1 : -5); }
      if (event.code === 'ArrowRight') { event.preventDefault(); seek(event.shiftKey ? 1 : 5); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeClip, closeExportModal, exportModalOpen, handleExport, mobilePanel, redo, removeClip, seek, showHelpModal, showProjectManager, splitActiveClip, toggleFullscreen, togglePlay, undo, updateState]);

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
    setEditingTextId(overlay.id);
  }, [projectDurationSpeedAware, updateState]);

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
    if (editingTextId === id) setEditingTextId(null);
  }, [editingTextId, updateState]);

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

  const previewProjectTime = activeClip
    ? (projectTimeForClipSpeedAware(state.clips, activeClip.id, currentTime) ?? 0)
    : 0;

  const processingLabel = processingStage === 'loading'
    ? t('loading_engine')
    : processingStage === 'preparing' ? t('preparing_media') : t('exporting');

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[var(--app)] text-[var(--text)]">
      <input ref={fileInputRef} type="file" accept="video/*" multiple className="sr-only" onChange={(event) => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="sr-only" onChange={(event) => { const f = event.target.files?.[0]; if (f) void importBackgroundAudio(f); event.target.value = ''; }} />

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 font-semibold">
            <MonitorPlay className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden="true" />
            <h1 className="truncate text-sm">{t('app_title')}</h1>
            <span className="hidden rounded border border-indigo-500/30 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500 sm:inline">{t('wasm_powered')}</span>
          </div>
          <div className="flex items-center border-l border-[var(--border)] pl-2 sm:pl-4">
            <button onClick={undo} disabled={!canUndo} className={iconButton} aria-label={`${t('undo')} (Ctrl+Z)`} title={`${t('undo')} (Ctrl+Z)`}><Undo2 className="h-4 w-4" /></button>
            <button onClick={redo} disabled={!canRedo} className={iconButton} aria-label={`${t('redo')} (Ctrl+Y)`} title={`${t('redo')} (Ctrl+Y)`}><Redo2 className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Save status */}
          <span className="hidden items-center gap-2 text-[11px] text-[var(--muted)] md:flex">
            <span className={`h-2 w-2 rounded-full ${saveStatus === 'error' ? 'bg-red-500' : saveStatus === 'saving' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            {saveStatus === 'saving' ? t('saving') : saveStatus === 'error' ? t('save_error') : lastSavedTime ? t('last_saved', { time: new Date(lastSavedTime).toLocaleTimeString(i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : t('auto_save')}
          </span>
          <button onClick={() => { void refreshProjects(); setShowProjectManager(true); }} className={`${iconButton} hidden sm:inline-flex`} aria-label={t('projects')} title={t('projects')}><Menu className="h-4 w-4" /></button>
          <button onClick={() => setShowHelpModal(true)} className={`${iconButton} hidden sm:inline-flex`} aria-label={t('keyboard_shortcuts')} title={t('shortcut_help')}><HelpCircle className="h-4 w-4" /></button>
          <button onClick={() => setMobilePanel('media')} className={`${iconButton} lg:hidden`} aria-label={t('media_assets')}><FileVideo className="h-4 w-4" /></button>
          <button onClick={() => setMobilePanel('inspector')} className={`${iconButton} lg:hidden`} aria-label={t('inspector')}><SlidersHorizontal className="h-4 w-4" /></button>
          <button onClick={() => void i18n.changeLanguage(i18n.resolvedLanguage?.startsWith('zh') ? 'en' : 'zh')} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--raised)]" aria-label={t('language')}>{i18n.resolvedLanguage?.startsWith('zh') ? 'EN' : '中文'}</button>
          <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className={iconButton} aria-label={resolvedTheme === 'dark' ? t('light_mode') : t('dark_mode')}>{resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
        </div>
      </header>

      {/* ─── Main Area ───────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {mobilePanel && <button className="absolute inset-0 z-20 bg-black/50 transition active:bg-black/60 lg:hidden" onClick={() => setMobilePanel(null)} aria-label={t('close')} />}

        {/* ─── Media Panel (Left) ──────────────────────────────────────── */}
        <aside className={`absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] transition-transform lg:static lg:w-64 lg:translate-x-0 ${mobilePanel === 'media' ? 'translate-x-0' : '-translate-x-full'}`} aria-label={t('media_assets')}>
          <div className="flex h-11 items-center justify-between border-b border-[var(--border)] px-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{t('media_assets')}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => { void refreshProjects(); setShowProjectManager(true); setMobilePanel(null); }} className={`${iconButton} sm:hidden`} aria-label={t('projects')} title={t('projects')}><Menu className="h-4 w-4" /></button>
              <button onClick={() => { setShowHelpModal(true); setMobilePanel(null); }} className={`${iconButton} sm:hidden`} aria-label={t('keyboard_shortcuts')} title={t('shortcut_help')}><HelpCircle className="h-4 w-4" /></button>
              <button onClick={() => fileInputRef.current?.click()} disabled={Boolean(importProgress)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />{t('import')}</button>
              <button onClick={() => setMobilePanel(null)} className={`${iconButton} lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div role="list" className="flex-1 space-y-2 overflow-y-auto p-2">
            {state.clips.map((clip, index) => (
              <div key={clip.id} role="listitem" className={`group relative rounded-lg border p-1.5 transition ${state.activeClipId === clip.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] bg-[var(--raised)] hover:border-indigo-400'}`}>
                <button onClick={() => { replaceState((current) => ({ ...current, activeClipId: clip.id })); setMobilePanel(null); }} className="block w-full rounded text-left" aria-current={state.activeClipId === clip.id ? 'true' : undefined}>
                  <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded bg-gradient-to-br from-indigo-500/20 via-[var(--canvas)] to-cyan-500/10">
                    <FileVideo className="h-7 w-7 text-indigo-500/60" aria-hidden="true" />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{t('duration', { value: clip.duration.toFixed(1) })}</span>
                    {clip.muted && <span className="absolute left-1.5 top-1.5"><VolumeX className="h-3 w-3 text-red-400" /></span>}
                  </span>
                  {renamingClipId !== clip.id && (
                    <span className="mt-1 block truncate px-0.5 text-[11px]">{clip.displayName}</span>
                  )}
                </button>
                {/* M6: Input outside button to avoid invalid nesting */}
                {renamingClipId === clip.id && (
                  <input
                    autoFocus
                    defaultValue={clip.displayName}
                    className="mt-1 block w-full rounded border border-indigo-500 bg-[var(--panel)] px-1 text-[11px]"
                    onBlur={(e) => renameClip(clip.id, e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameClip(clip.id, e.currentTarget.value); if (e.key === 'Escape') setRenamingClipId(null); }}
                  />
                )}
                {/* M8: Accessible per-clip disclosure/menu */}
                <details className="mt-1 border-t border-[var(--border)] pt-1">
                  <summary className={`${iconButton} flex w-full cursor-pointer items-center justify-center gap-1 text-[10px]`} aria-label={t('more_actions')}><Menu className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">{t('actions')}</span></summary>
                  <div className="mt-1 flex flex-wrap justify-end gap-0.5" role="menu">
                    <button role="menuitem" onClick={() => setRenamingClipId(clip.id)} className={iconButton} aria-label={t('rename_clip')} title={t('rename')}><Edit2 className="h-3.5 w-3.5" /></button>
                    <button role="menuitem" onClick={() => duplicateClipById(clip.id)} className={iconButton} aria-label={`${t('duplicate')} ${clip.displayName}`} title={t('duplicate')}><Copy className="h-3.5 w-3.5" /></button>
                    <button role="menuitem" onClick={() => moveClip(clip.id, -1)} disabled={index === 0} className={iconButton} aria-label={t('move_left')} title={t('move_left')}><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <button role="menuitem" onClick={() => moveClip(clip.id, 1)} disabled={index === state.clips.length - 1} className={iconButton} aria-label={t('move_right')} title={t('move_right')}><ChevronRight className="h-3.5 w-3.5" /></button>
                    <button role="menuitem" onClick={() => removeClip(clip.id)} className={`${iconButton} hover:text-red-500`} aria-label={`${t('delete')} ${clip.displayName}`} title={t('delete')}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </details>
              </div>
            ))}
            {!state.clips.length && <p className="m-2 rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-xs leading-5 text-[var(--muted)]">{t('no_assets')}</p>}
          </div>
        </aside>

        {/* ─── Preview (Center) ────────────────────────────────────────── */}
        <section ref={previewContainerRef} className="relative flex min-w-0 flex-1 flex-col bg-[var(--canvas)]" aria-label={t('preview')}>
          {importProgress && (
            <div className="absolute left-1/2 top-3 z-30 w-[min(90%,24rem)] -translate-x-1/2 rounded-lg border border-indigo-400/30 bg-[var(--panel)] p-3 shadow-xl" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-[11px]"><span className="truncate">{t('importing_file', { name: importProgress.name })}</span><span className="font-mono">{importProgress.current}/{importProgress.total}</span></div>
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
            onDrop={(event) => { if (!Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); setIsDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }}
          >
            {!activeClip ? (
              <button onClick={() => fileInputRef.current?.click()} disabled={Boolean(importProgress)} className="group relative flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl transition hover:border-indigo-500 disabled:opacity-50" aria-label={t('upload_media')}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--raised)] transition group-hover:border-indigo-500"><Upload className="h-6 w-6 text-indigo-500" /></span>
                <span className="text-center"><strong className="block text-sm">{t('upload_media')}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{t('drop_here')}</span></span>
              </button>
            ) : (
              <div className="relative flex w-full max-w-3xl touch-manipulation items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-2xl" style={{ aspectRatio: previewAspectRatio }}>
                <video
                  key={activeClip.id} ref={videoRef} src={activeClip.url} playsInline
                  muted={activeClip.muted}
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
                  onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onClick={togglePlay}
                />
                {/* Text overlay preview */}
                {state.textOverlays.map((overlay) => {
                  const visible = previewProjectTime >= overlay.startTime && previewProjectTime <= overlay.endTime;
                  if (!visible) return null;
                  return (
                    <span key={overlay.id} className="pointer-events-none absolute z-20" style={{
                      left: `${overlay.position.x}%`, top: `${overlay.position.y}%`,
                      transform: 'translate(-50%,-50%)',
                      fontSize: `${overlay.fontSize * 0.5}px`,
                      color: overlay.color,
                      fontFamily: overlay.fontFamily === 'mono' ? 'monospace' : overlay.fontFamily === 'serif' ? 'serif' : 'sans-serif',
                      textShadow: '0 2px 4px rgba(0,0,0,0.7)',
                    }}>{overlay.text}</span>
                  );
                })}
                <span className="absolute left-3 top-3 z-20 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white" aria-live="off">{currentTime.toFixed(2)}s / {activeClip.duration.toFixed(2)}s</span>
                {/* Fullscreen button */}
                <button onClick={toggleFullscreen} className="absolute right-3 top-3 z-20 rounded bg-black/50 p-1.5 text-white/80 hover:text-white" aria-label={isFullscreen ? t('exit_fullscreen') : t('fullscreen')}>
                  {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          {/* ─── Transport Controls ──────────────────────────────────────── */}
          <div className="flex h-14 shrink-0 items-center justify-center gap-3 border-t border-[var(--border)] bg-[var(--panel)] sm:gap-5">
            <button onClick={() => seek(-5)} disabled={!activeClip} className={iconButton} aria-label={t('back_five')} title={t('back_five')}><RotateCcw className="h-4 w-4" /></button>
            <button onClick={splitActiveClip} disabled={!canSplit} className={iconButton} aria-label={`${t('split_clip')} (S)`} title={`${t('split_clip')} (S)`}><Scissors className="h-4 w-4" /></button>
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
              {processingStage === 'rendering' && <><div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/20"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 font-mono text-sm text-white/70">{progress.toFixed(0)}%</p></>}
              <button autoFocus onClick={cancelExport} className="mt-5 rounded-md border border-white/30 px-4 py-2 text-sm hover:bg-white/10">{t('cancel')}</button>
            </div>
          )}
        </section>

        {/* ─── Inspector (Right) ───────────────────────────────────────── */}
        <aside className={`fixed inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--panel)] transition-transform lg:static lg:inset-auto lg:max-h-none lg:w-72 lg:rounded-none lg:border-l lg:border-t-0 ${mobilePanel === 'inspector' ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}`} aria-label={t('inspector')} role={mobilePanel === 'inspector' ? 'dialog' : undefined} aria-modal={mobilePanel === 'inspector' ? true : undefined}>
          {/* Tab Bar */}
          <div className="flex h-11 shrink-0 items-center border-b border-[var(--border)] px-1">
            {(['clip', 'project', 'audio', 'effects'] as const).map((tab) => (
              <button key={tab} onClick={() => setInspectorTab(tab)} className={`flex-1 px-1 py-2 text-[10px] font-medium transition ${inspectorTab === tab ? 'border-b-2 border-indigo-500 text-indigo-500' : 'text-[var(--muted)] hover:text-[var(--text)]'}`} aria-current={inspectorTab === tab ? 'page' : undefined}>{t(`tab_${tab}`)}</button>
            ))}
            <button onClick={() => setMobilePanel(null)} className={`${iconButton} lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* ── Clip Tab ─────────────────────────────────────────────── */}
            {inspectorTab === 'clip' && (
              <>
                <section aria-labelledby="trim-heading">
                  <h2 id="trim-heading" className="mb-3 text-xs font-medium">{t('trim')}</h2>
                  <div className="space-y-4">
                    <RangeControl label={t('trim_start')} value={activeClip?.trimStart ?? 0} min={0} max={Math.max(0, (activeClip?.trimEnd ?? 0) - 0.01)} step={0.01} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimStart', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('trim_end')} value={activeClip?.trimEnd ?? 0} min={Math.min(activeClip?.duration ?? 0, (activeClip?.trimStart ?? 0) + 0.01)} max={activeClip?.duration ?? 0} step={0.01} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimEnd', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                  </div>
                </section>
                {/* Volume / Mute */}
                <section aria-labelledby="clip-vol-heading">
                  <h2 id="clip-vol-heading" className="mb-3 text-xs font-medium">{t('clip_volume')}</h2>
                  <div className="space-y-3">
                    <RangeControl label={t('volume')} value={activeClip?.volume ?? 100} min={0} max={200} disabled={!activeClip} onChange={(v) => activeClip && updateClipField(activeClip.id, 'volume', v)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <button disabled={!activeClip} onClick={() => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, muted: !cl.muted } : cl) }))} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${activeClip?.muted ? 'text-red-500' : 'text-[var(--muted)]'} hover:bg-[var(--raised)] disabled:opacity-40`}>
                      {activeClip?.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {activeClip?.muted ? t('unmute') : t('mute')}
                    </button>
                  </div>
                </section>
                {/* Rotation / Flip */}
                <section aria-labelledby="transform-heading">
                  <h2 id="transform-heading" className="mb-3 text-xs font-medium">{t('rotation')}</h2>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-[var(--muted)] w-16">{t('rotation')}</label>
                      <select disabled={!activeClip} value={activeClip?.rotation ?? 0} onChange={(e) => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, rotation: Number(e.target.value) as 0 | 90 | 180 | 270 } : cl) }))} className="flex-1 rounded border border-[var(--border)] bg-[var(--raised)] px-2 py-1 text-xs">
                        <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={!activeClip} onClick={() => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, flipH: !cl.flipH } : cl) }))} className={`flex-1 rounded border px-2 py-1.5 text-[10px] ${activeClip?.flipH ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'} disabled:opacity-40`}>{t('flip_h')}</button>
                      <button disabled={!activeClip} onClick={() => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, flipV: !cl.flipV } : cl) }))} className={`flex-1 rounded border px-2 py-1.5 text-[10px] ${activeClip?.flipV ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'} disabled:opacity-40`}>{t('flip_v')}</button>
                    </div>
                  </div>
                </section>
                {/* Speed */}
                <section aria-labelledby="speed-heading">
                  <h2 id="speed-heading" className="mb-3 text-xs font-medium">{t('speed')}</h2>
                  <RangeControl label={t('speed')} value={activeClip?.speed ?? 1} min={0.25} max={4} step={0.25} unit="×" disabled={!activeClip} onChange={(v) => activeClip && updateState((c) => ({ ...c, clips: c.clips.map((cl) => cl.id === activeClip.id ? { ...cl, speed: v } : cl) }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
              </>
            )}

            {/* ── Project Tab ──────────────────────────────────────────── */}
            {inspectorTab === 'project' && (
              <>
                {/* Canvas Aspect */}
                <section aria-labelledby="aspect-heading">
                  <h2 id="aspect-heading" className="mb-3 text-xs font-medium">{t('aspect')}</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['16:9', '9:16', '4:3', '1:1', 'auto'] as CanvasAspect[]).map((a) => (
                      <button key={a} onClick={() => updateState((c) => ({ ...c, canvasAspect: a, presetName: null }))} className={`rounded border px-2 py-1.5 text-[10px] ${state.canvasAspect === a ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'}`}>{a}</button>
                    ))}
                  </div>
                </section>
                {/* Fit Mode */}
                <section aria-labelledby="fit-heading">
                  <h2 id="fit-heading" className="mb-3 text-xs font-medium">{t('fit')}</h2>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['contain', 'cover', 'stretch'] as CanvasFit[]).map((f) => (
                      <button key={f} onClick={() => updateState((c) => ({ ...c, canvasFit: f, presetName: null }))} className={`rounded border px-2 py-1.5 text-[10px] ${state.canvasFit === f ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' : 'border-[var(--border)] text-[var(--muted)]'}`}>{t(f)}</button>
                    ))}
                  </div>
                </section>
                {/* Master Volume */}
                <section aria-labelledby="master-vol-heading">
                  <h2 id="master-vol-heading" className="mb-3 text-xs font-medium">{t('master_volume')}</h2>
                  <RangeControl label={t('volume')} value={state.masterVolume} min={0} max={200} onChange={(v) => replaceState((c) => ({ ...c, masterVolume: v }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
                {/* Presets */}
                <section aria-labelledby="presets-heading">
                  <h2 id="presets-heading" className="mb-3 text-xs font-medium">{t('presets')}</h2>
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
                      }} className={`w-full rounded border px-3 py-2 text-left text-[11px] ${state.presetName === name ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] hover:border-indigo-400'}`}>
                        <strong className="block">{t(`preset_${name.replace('-', '_')}` as string)}</strong>
                        <span className="text-[var(--muted)]">{PRESETS[name].description[i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en']}</span>
                      </button>
                    ))}
                  </div>
                </section>
                {/* M5: Custom presets */}
                <section aria-labelledby="custom-presets-heading">
                  <h2 id="custom-presets-heading" className="mb-3 text-xs font-medium">{t('custom_presets')}</h2>
                  <div className="space-y-1.5">
                    {customPresets.map((cp) => (
                      <div key={cp.name} className={`flex items-center gap-1 rounded border px-3 py-2 text-[11px] ${state.presetName === cp.name ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)]'}`}>
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
                    }} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-[var(--border)] px-3 py-2 text-[10px] text-[var(--muted)] hover:border-indigo-500 hover:text-indigo-500">
                      <Plus className="h-3 w-3" />{t('save_preset')}
                    </button>
                  </div>
                </section>
                {/* Playback Speed (preview) */}
                <section aria-labelledby="playback-speed-heading">
                  <h2 id="playback-speed-heading" className="mb-3 text-xs font-medium">{t('speed')} ({t('preview')})</h2>
                  <RangeControl label={t('speed')} value={state.playbackSpeed} min={0.25} max={4} step={0.25} unit="×" onChange={(v) => replaceState((c) => ({ ...c, playbackSpeed: v }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                </section>
              </>
            )}

            {/* ── Audio Tab ────────────────────────────────────────────── */}
            {inspectorTab === 'audio' && (
              <>
                <section aria-labelledby="audio-heading">
                  <h2 id="audio-heading" className="mb-3 text-xs font-medium">{t('audio')} <span className="text-[var(--muted)]">· {t('global')}</span></h2>
                  <div className="space-y-4">
                    <RangeControl label={t('audio_sync')} value={state.audioDelay} min={-5000} max={5000} step={10} unit="ms" onChange={(value) => replaceState((current) => ({ ...current, audioDelay: value }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('fade_in')} value={state.audioFade.fadeIn} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeIn: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('fade_out')} value={state.audioFade.fadeOut} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeOut: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <p className="text-[10px] leading-4 text-[var(--muted)]">{t('fade_hint')}</p>
                  </div>
                </section>
                {/* Background Audio */}
                <section aria-labelledby="bg-audio-heading">
                  <h2 id="bg-audio-heading" className="mb-3 text-xs font-medium">{t('background_audio')}</h2>
                  {state.backgroundMusic ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--raised)] p-2">
                        <Music className="h-4 w-4 text-indigo-500 shrink-0" />
                        <span className="flex-1 truncate text-[11px]">{state.backgroundMusic.name}</span>
                        <button onClick={() => updateState((c) => ({ ...c, backgroundMusic: null }))} className="text-red-500 hover:text-red-400" aria-label={t('remove_audio')}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <RangeControl label={t('audio_volume')} value={state.backgroundMusic.volume} min={0} max={200} onChange={(v) => replaceState((c) => ({ ...c, backgroundMusic: c.backgroundMusic ? { ...c.backgroundMusic, volume: v } : null }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                      <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                        <input type="checkbox" checked={state.backgroundMusic.loop} onChange={(e) => updateState((c) => ({ ...c, backgroundMusic: c.backgroundMusic ? { ...c.backgroundMusic, loop: e.target.checked } : null }))} className="accent-indigo-500" />
                        {t('audio_loop')}
                      </label>
                      <RangeControl label={t('audio_fade_in')} value={state.backgroundMusic.fadeIn} min={0} max={10} step={0.1} unit="s" onChange={(v) => replaceState((c) => ({ ...c, backgroundMusic: c.backgroundMusic ? { ...c.backgroundMusic, fadeIn: v } : null }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                      <RangeControl label={t('audio_fade_out')} value={state.backgroundMusic.fadeOut} min={0} max={10} step={0.1} unit="s" onChange={(v) => replaceState((c) => ({ ...c, backgroundMusic: c.backgroundMusic ? { ...c.backgroundMusic, fadeOut: v } : null }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    </div>
                  ) : (
                    <button onClick={() => audioInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted)] hover:border-indigo-500 hover:text-indigo-500">
                      <Music className="h-4 w-4" />{t('import_audio')}
                    </button>
                  )}
                </section>
              </>
            )}

            {/* ── Effects Tab ──────────────────────────────────────────── */}
            {inspectorTab === 'effects' && (
              <>
                {/* Filters */}
                <section aria-labelledby="filters-heading">
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 id="filters-heading" className="text-xs font-medium">{t('filters')} <span className="text-[var(--muted)]">· {t('global')}</span></h2><button type="button" onClick={() => updateState((current) => ({ ...current, filters: { brightness: 100, contrast: 100, saturation: 100 } }))} disabled={state.filters.brightness === 100 && state.filters.contrast === 100 && state.filters.saturation === 100} className="rounded px-2 py-1 text-[10px] text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30">{t('reset')}</button></div>
                  <div className="space-y-4">
                    <RangeControl label={t('brightness')} value={state.filters.brightness} min={0} max={200} onChange={(value) => updateFilter('brightness', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('contrast')} value={state.filters.contrast} min={0} max={200} onChange={(value) => updateFilter('contrast', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                    <RangeControl label={t('saturation')} value={state.filters.saturation} min={0} max={200} onChange={(value) => updateFilter('saturation', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                  </div>
                </section>
                {/* Transitions */}
                <section aria-labelledby="transitions-heading">
                  <h2 id="transitions-heading" className="mb-3 text-xs font-medium">{t('transitions')}</h2>
                  {state.clips.length > 1 ? (
                    <div className="space-y-2">
                      {state.clips.slice(0, -1).map((clip, idx) => {
                        const existing = state.transitions.find((tr) => tr.afterClipId === clip.id);
                        return (
                          <div key={clip.id} className="rounded border border-[var(--border)] bg-[var(--raised)] p-2">
                            <div className="flex items-center justify-between text-[10px] text-[var(--muted)] mb-1">
                              <span>{clip.displayName} → {state.clips[idx + 1]?.displayName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <select value={existing?.type ?? ''} onChange={(e) => {
                                const val = e.target.value;
                                if (!val) removeTransition(clip.id);
                                else addTransition(clip.id, val as TransitionConfig['type'], existing?.duration ?? 0.5);
                              }} className="flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-1 text-[11px]">
                                <option value="">{t('no_transition')}</option>
                                {(['fade', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideright', 'slideleft'] as const).map((type) => (
                                  <option key={type} value={type}>{t(`transition_${type}`)}</option>
                                ))}
                              </select>
                              {existing && (
                                <input type="number" min={0.2} max={3} step={0.1} value={existing.duration} onChange={(e) => addTransition(clip.id, existing.type, Number(e.target.value) || 0.5)} className="w-14 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('transition_duration')} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-[var(--muted)]">{t('no_transition')}</p>
                  )}
                </section>
                {/* Text Overlays */}
                <section aria-labelledby="text-heading">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 id="text-heading" className="text-xs font-medium">{t('text_overlays')}</h2>
                    <button onClick={addTextOverlay} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-indigo-500 hover:bg-indigo-500/10"><Plus className="h-3 w-3" />{t('add_text')}</button>
                  </div>
                  <div className="space-y-2">
                    {state.textOverlays.map((overlay) => (
                      <div key={overlay.id} className={`rounded border p-2 ${editingTextId === overlay.id ? 'border-indigo-500' : 'border-[var(--border)]'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <button onClick={() => setEditingTextId(editingTextId === overlay.id ? null : overlay.id)} className="text-[11px] text-indigo-500 hover:underline truncate flex-1 text-left">{overlay.text || t('text_content')}</button>
                          <button onClick={() => removeTextOverlay(overlay.id)} className="text-red-500 hover:text-red-400" aria-label={t('remove_text')}><Trash2 className="h-3 w-3" /></button>
                        </div>
                        {editingTextId === overlay.id && (
                          <div className="mt-2 space-y-2">
                            <input value={overlay.text} onChange={(e) => updateTextOverlay(overlay.id, { text: e.target.value })} className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[11px]" placeholder={t('text_content')} />
                            <div className="grid grid-cols-2 gap-2">
                              <select value={overlay.fontFamily} onChange={(e) => updateTextOverlay(overlay.id, { fontFamily: e.target.value as 'sans' | 'serif' | 'mono' })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px]">
                                <option value="sans">{t('font_sans')}</option>
                                <option value="serif">{t('font_serif')}</option>
                                <option value="mono">{t('font_mono')}</option>
                              </select>
                              <input type="number" min={12} max={200} value={overlay.fontSize} onChange={(e) => updateTextOverlay(overlay.id, { fontSize: Number(e.target.value) || 48 })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('font_size')} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input type="color" value={overlay.color} onChange={(e) => updateTextOverlay(overlay.id, { color: e.target.value })} className="h-7 w-full rounded border border-[var(--border)]" aria-label={t('text_color')} />
                              <div className="flex gap-1">
                                <input type="number" min={0} max={100} value={overlay.position.x} onChange={(e) => updateTextOverlay(overlay.id, { position: { ...overlay.position, x: Number(e.target.value) || 0 } })} className="w-1/2 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('text_x')} />
                                <input type="number" min={0} max={100} value={overlay.position.y} onChange={(e) => updateTextOverlay(overlay.id, { position: { ...overlay.position, y: Number(e.target.value) || 0 } })} className="w-1/2 rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('text_y')} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input type="number" min={0} step={0.1} value={overlay.startTime} onChange={(e) => updateTextOverlay(overlay.id, { startTime: Number(e.target.value) || 0 })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('text_start')} />
                              <input type="number" min={0} step={0.1} value={overlay.endTime} onChange={(e) => updateTextOverlay(overlay.id, { endTime: Number(e.target.value) || 5 })} className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-[10px] font-mono" aria-label={t('text_end')} />
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

          {/* ─── Sticky Export Button ──────────────────────────────────── */}
          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--panel)] p-3">
            <p className="mb-1.5 text-[10px] text-[var(--muted)]">
              {state.exportSettings.resolution} · {state.exportSettings.frameRate} fps · {t(`quality_${state.exportSettings.quality}`)}
            </p>
            <button
              ref={exportTriggerRef} type="button" onClick={() => setExportModalOpen(true)} disabled={processing || !state.clips.length}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('open_export_settings')}
            </button>
          </div>
        </aside>
      </div>

      {/* ─── Timeline ────────────────────────────────────────────────────── */}
      <footer className={`flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--panel)] transition-all ${timelineCollapsed ? 'h-10' : 'sm:h-48 lg:h-52 h-40'}`}>
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-[10px] text-[var(--muted)] sm:px-4">
          <button onClick={() => setTimelineCollapsed(!timelineCollapsed)} className={iconButton} aria-label={timelineCollapsed ? t('expand_timeline') : t('collapse_timeline')}>
            {timelineCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <span><strong className="text-[var(--text)]">V1</strong> {t('video_track')}</span>
          <span className="hidden sm:inline"><strong className="text-[var(--text)]">A1</strong> {t('audio_track')}</span>
          <span className="ml-auto hidden font-mono sm:inline">{t('project_duration', { value: projectDurationSpeedAware.toFixed(1) })}{state.transitions.length > 0 && outputDuration < projectDurationSpeedAware - 0.01 ? ` · ${t('output_duration', { value: outputDuration.toFixed(1) })}` : ''}</span>
          {/* Zoom controls */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => setTimelineZoom(Math.max(0.3, timelineZoom - 0.3))} className={iconButton} aria-label={t('zoom_out')} title={t('zoom_out')}><ZoomOut className="h-3.5 w-3.5" /></button>
            <button onClick={() => setTimelineZoom(1)} className="rounded px-1.5 py-0.5 text-[9px] font-mono hover:bg-[var(--raised)]" aria-label={t('zoom_fit')} title={t('zoom_fit')}>{(timelineZoom * 100).toFixed(0)}%</button>
            <button onClick={() => setTimelineZoom(Math.min(5, timelineZoom + 0.3))} className={iconButton} aria-label={t('zoom_in')} title={t('zoom_in')}><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
          <span className="truncate font-mono text-indigo-500">{activeClip ? `${t('active_trim')}: ${activeClip.trimStart.toFixed(1)}s – ${activeClip.trimEnd.toFixed(1)}s` : t('no_clip')}</span>
        </div>
        {!timelineCollapsed && (
          state.clips.length ? (
            <Timeline
              clips={state.clips.map((c) => ({ id: c.id, name: c.displayName, trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed }))}
              activeClipId={state.activeClipId}
              currentTime={currentTime}
              onSeek={seekTimeline}
              onReorder={reorderClip}
              zoom={timelineZoom}
              onZoomChange={setTimelineZoom}
            />
          ) : <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted)]">{t('no_media')}</div>
        )}
      </footer>

      {/* ─── Export Modal ─────────────────────────────────────────────────── */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) closeExportModal(); }}>
          <div ref={exportDialogRef} role="dialog" aria-modal="true" aria-labelledby="export-modal-heading" aria-describedby="export-modal-description" tabIndex={-1} onKeyDown={(e) => trapFocus(e, exportDialogRef)} className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div><h2 id="export-modal-heading" className="text-sm font-semibold">{t('export_settings')}</h2><p id="export-modal-description" className="mt-0.5 text-[10px] text-[var(--muted)]">{t('export_settings_hint')}</p></div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowHelpModal(false); }}>
          <div ref={helpDialogRef} role="dialog" aria-modal="true" aria-labelledby="help-heading" tabIndex={-1} onKeyDown={(e) => trapFocus(e, helpDialogRef)} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 id="help-heading" className="text-sm font-semibold">{t('keyboard_shortcuts')}</h2>
              <button onClick={() => setShowHelpModal(false)} className={iconButton} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 text-[11px]">
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
                  <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-2 py-0.5 font-mono text-[10px]">{key}</kbd>
                  <span className="text-[var(--muted)]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Project Manager Modal ───────────────────────────────────────── */}
      {showProjectManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowProjectManager(false); }}>
          <div ref={projectDialogRef} role="dialog" aria-modal="true" aria-labelledby="pm-heading" tabIndex={-1} onKeyDown={(e) => trapFocus(e, projectDialogRef)} className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 id="pm-heading" className="text-sm font-semibold">{t('projects')}</h2>
              <button onClick={() => setShowProjectManager(false)} className={iconButton} aria-label={t('close')}><X className="h-4 w-4" /></button>
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
                      <span className="block text-[10px] text-[var(--muted)]">{new Date(project.updatedAt).toLocaleString()}</span>
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
