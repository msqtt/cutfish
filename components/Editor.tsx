'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { del, get, set } from 'idb-keyval';
import {
  ChevronLeft, ChevronRight, FileVideo, Moon, MonitorPlay, Pause,
  Play, Plus, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Sun, Trash2,
  Undo2, Upload, X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import ExportPanel from '@/components/ExportPanel';
import {
  buildFFmpegCommand, resolveExportProfile, selectClipsForExport,
  type AudioFadeSettings, type ExportSettings,
} from '@/lib/ffmpeg-utils';
import { useHistory } from '@/lib/history';
import '@/lib/i18n';

export interface Clip {
  id: string;
  url: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  file: File;
}

export interface EditorState {
  clips: Clip[];
  activeClipId: string | null;
  audioDelay: number;
  audioFade: AudioFadeSettings;
  filters: { brightness: number; contrast: number; saturation: number };
  exportSettings: ExportSettings;
}

type DraftState = Omit<EditorState, 'clips' | 'exportSettings' | 'audioFade'> & {
  clips: Array<Omit<Clip, 'url'>>;
  exportSettings?: Partial<ExportSettings>;
  audioFade?: Partial<AudioFadeSettings>;
};
type MobilePanel = 'media' | 'inspector' | null;
type Toast = { kind: 'success' | 'error'; message: string } | null;

const DRAFT_KEY = 'cutfish-draft-v1';
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolution: '720p', frameRate: 30, quality: 'balanced', rangeStart: 0, rangeEnd: null,
};
const DEFAULT_STATE: EditorState = {
  clips: [], activeClipId: null, audioDelay: 0,
  audioFade: { fadeIn: 0, fadeOut: 0 },
  filters: { brightness: 100, contrast: 100, saturation: 100 },
  exportSettings: DEFAULT_EXPORT_SETTINGS,
};
const iconButton = 'rounded-md p-2 text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30';

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
  return (
    <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">
      <span className="flex justify-between gap-3"><span>{label}</span><output>{value.toFixed(step < 1 ? 1 : 0)}{unit}</output></span>
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        onPointerDown={onEditStart} onPointerUp={onEditEnd} onKeyDown={onEditStart}
        onKeyUp={onEditEnd} onBlur={onEditEnd} onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}

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

function toDraftClip(clip: Clip): Omit<Clip, 'url'> {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    file: clip.file,
  };
}

export default function Editor() {
  const { t, i18n } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const {
    state, set: updateState, replace: replaceState, checkpoint, undo, redo,
    canUndo, canRedo, reset,
  } = useHistory<EditorState>(DEFAULT_STATE);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'loading' | 'preparing' | 'rendering'>('loading');
  const [progress, setProgress] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [isDragging, setIsDragging] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const continuousEditRef = useRef<EditorState | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadRef = useRef<Promise<FFmpeg> | null>(null);
  const cancelRequestedRef = useRef(false);
  const continuePlaybackRef = useRef(false);

  const activeClip = state.clips.find((clip) => clip.id === state.activeClipId);
  const projectDuration = state.clips.reduce(
    (total, clip) => total + Math.max(0, clip.trimEnd - clip.trimStart), 0,
  );

  const createTrackedUrl = useCallback((file: Blob) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    ffmpegRef.current?.terminate();
  }, []);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en';
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const draft = await get<DraftState>(DRAFT_KEY);
        if (!draft?.clips?.length || cancelled) return;
        const clips = draft.clips
          .filter((clip) => clip.file instanceof Blob)
          .map((clip) => ({ ...clip, url: createTrackedUrl(clip.file) }));
        if (clips.length && !cancelled) {
          const activeClipId = clips.some((clip) => clip.id === draft.activeClipId)
            ? draft.activeClipId : clips[0].id;
          reset({
            ...DEFAULT_STATE,
            ...draft,
            filters: { ...DEFAULT_STATE.filters, ...draft.filters },
            audioFade: { ...DEFAULT_STATE.audioFade, ...draft.audioFade },
            exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...draft.exportSettings },
            clips,
            activeClipId,
          });
        }
      } catch (error) {
        console.error('Draft restore failed', error);
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [createTrackedUrl, reset]);

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      if (!state.clips.length) {
        void del(DRAFT_KEY);
        return;
      }
      const draft: DraftState = {
        ...state,
        clips: state.clips.map(toDraftClip),
      };
      void set(DRAFT_KEY, draft).catch((error) => {
        console.error('Draft save failed', error);
        setToast({ kind: 'error', message: t('draft_error') });
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftReady, state, t]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const beginContinuousEdit = useCallback(() => {
    if (!continuousEditRef.current) continuousEditRef.current = state;
  }, [state]);

  const finishContinuousEdit = useCallback(() => {
    if (!continuousEditRef.current) return;
    checkpoint(continuousEditRef.current);
    continuousEditRef.current = null;
  }, [checkpoint]);

  const importFiles = useCallback(async (files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(file.name));
    if (!videos.length) {
      setToast({ kind: 'error', message: t('invalid_file') });
      return;
    }

    const validClips: Clip[] = [];
    for (const file of videos) {
      const url = createTrackedUrl(file);
      try {
        const duration = await getVideoDuration(url);
        validClips.push({
          id: crypto.randomUUID(), url, name: file.name, duration,
          trimStart: 0, trimEnd: duration, file,
        });
      } catch {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(url);
      }
    }
    if (!validClips.length) {
      setToast({ kind: 'error', message: t('invalid_file') });
      return;
    }
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
    updateState((current) => ({
      ...current,
      clips: [...current.clips, ...validClips],
      activeClipId: validClips[0].id,
    }));
    setMobilePanel(null);
  }, [createTrackedUrl, t, updateState]);

  const removeClip = useCallback((id: string) => {
    updateState((current) => {
      const index = current.clips.findIndex((clip) => clip.id === id);
      if (index < 0) return current;
      const clips = current.clips.filter((clip) => clip.id !== id);
      const activeClipId = current.activeClipId === id
        ? (clips[Math.min(index, clips.length - 1)]?.id ?? null)
        : current.activeClipId;
      return { ...current, clips, activeClipId };
    });
  }, [updateState]);

  const moveClip = useCallback((id: string, direction: -1 | 1) => {
    updateState((current) => {
      const index = current.clips.findIndex((clip) => clip.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.clips.length) return current;
      const clips = [...current.clips];
      [clips[index], clips[nextIndex]] = [clips[nextIndex], clips[index]];
      return { ...current, clips };
    });
  }, [updateState]);

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
    const effectiveEnd = Math.min(state.exportSettings.rangeEnd ?? projectDuration, projectDuration);
    const requestedStart = Math.max(0, Math.min(state.exportSettings.rangeStart, projectDuration));
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

      const selectedClips = selectClipsForExport(state.clips, {
        start: effectiveStart,
        end: effectiveEnd,
      });
      const metadata: Array<{
        id: string; filename: string; trimStart: number; trimEnd: number; hasAudio: boolean;
      }> = [];

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
        metadata.push({
          id: clip.id, filename, trimStart: clip.trimStart, trimEnd: clip.trimEnd, hasAudio,
        });
      }

      if (cancelRequestedRef.current) return;
      setProcessingStage('rendering');
      const profile = resolveExportProfile(state.exportSettings);
      const outputName = `output.${format}`;
      temporaryFiles.push(outputName);
      const exitCode = await engine.exec(
        buildFFmpegCommand(
          metadata, state.filters, state.audioDelay, state.audioFade, format, profile,
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
      }
      setProcessing(false);
      setProgress(0);
    }
  }, [ensureFfmpeg, processing, projectDuration, state, t]);

  const cancelExport = useCallback(() => {
    cancelRequestedRef.current = true;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    ffmpegLoadRef.current = null;
    setProcessing(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, button, [contenteditable="true"]');
      if (event.code === 'Escape') setMobilePanel(null);
      if (editing) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyE') { event.preventDefault(); void handleExport('mp4'); }
      if ((event.code === 'Delete' || event.code === 'Backspace') && activeClip) removeClip(activeClip.id);
      if (event.code === 'ArrowLeft') seek(-5);
      if (event.code === 'ArrowRight') seek(5);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeClip, handleExport, redo, removeClip, seek, togglePlay, undo]);

  const updateFilter = (key: keyof EditorState['filters'], value: number) => {
    replaceState((current) => ({ ...current, filters: { ...current.filters, [key]: value } }));
  };

  const updateTrim = (key: 'trimStart' | 'trimEnd', value: number) => {
    if (!activeClip) return;
    if (key === 'trimStart') {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = value;
      }
      setIsPlaying(false);
      setCurrentTime(value);
    }
    replaceState((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === activeClip.id ? { ...clip, [key]: value } : clip),
    }));
  };

  const processingLabel = processingStage === 'loading'
    ? t('loading_engine')
    : processingStage === 'preparing' ? t('preparing_media') : t('exporting');

  const previewStyle = {
    filter: `brightness(${state.filters.brightness}%) contrast(${state.filters.contrast}%) saturate(${state.filters.saturation}%)`,
  };

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[var(--app)] text-[var(--text)]">
      <input
        ref={fileInputRef} type="file" accept="video/*" multiple className="sr-only"
        onChange={(event) => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}
      />

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
          <span className="hidden items-center gap-2 text-[11px] text-[var(--muted)] md:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('auto_save')}</span>
          <button onClick={() => setMobilePanel('media')} className={`${iconButton} lg:hidden`} aria-label={t('media_assets')}><FileVideo className="h-4 w-4" /></button>
          <button onClick={() => setMobilePanel('inspector')} className={`${iconButton} lg:hidden`} aria-label={t('inspector')}><SlidersHorizontal className="h-4 w-4" /></button>
          <button onClick={() => void i18n.changeLanguage(i18n.resolvedLanguage?.startsWith('zh') ? 'en' : 'zh')} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--raised)]" aria-label={t('language')}>{i18n.resolvedLanguage?.startsWith('zh') ? 'EN' : '中文'}</button>
          <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className={iconButton} aria-label={resolvedTheme === 'dark' ? t('light_mode') : t('dark_mode')} title={resolvedTheme === 'dark' ? t('light_mode') : t('dark_mode')}>{resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {mobilePanel && <button className="absolute inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setMobilePanel(null)} aria-label={t('close')} />}

        <aside className={`absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] transition-transform lg:static lg:w-64 lg:translate-x-0 ${mobilePanel === 'media' ? 'translate-x-0' : '-translate-x-full'}`} aria-label={t('media_assets')}>
          <div className="flex h-11 items-center justify-between border-b border-[var(--border)] px-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{t('media_assets')}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-500/10"><Plus className="h-3.5 w-3.5" />{t('import')}</button>
              <button onClick={() => setMobilePanel(null)} className={`${iconButton} lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {state.clips.map((clip, index) => (
              <div key={clip.id} className={`group relative rounded-lg border p-1.5 transition ${state.activeClipId === clip.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[var(--border)] bg-[var(--raised)] hover:border-indigo-400'}`}>
                <button onClick={() => { replaceState((current) => ({ ...current, activeClipId: clip.id })); setMobilePanel(null); }} className="block w-full rounded text-left" aria-pressed={state.activeClipId === clip.id}>
                  <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded bg-gradient-to-br from-indigo-500/20 via-[var(--canvas)] to-cyan-500/10">
                    <FileVideo className="h-7 w-7 text-indigo-500/60" aria-hidden="true" />
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{t('duration', { value: clip.duration.toFixed(1) })}</span>
                  </span>
                  <span className="mt-1 block truncate px-0.5 text-[11px]">{clip.name}</span>
                </button>
                <div className="mt-1 flex justify-end gap-0.5 border-t border-[var(--border)] pt-1">
                  <button onClick={() => moveClip(clip.id, -1)} disabled={index === 0} className={iconButton} aria-label={t('move_left')} title={t('move_left')}><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <button onClick={() => moveClip(clip.id, 1)} disabled={index === state.clips.length - 1} className={iconButton} aria-label={t('move_right')} title={t('move_right')}><ChevronRight className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeClip(clip.id)} className={`${iconButton} hover:text-red-500`} aria-label={`${t('delete')} ${clip.name}`} title={t('delete')}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
            {!state.clips.length && <p className="m-2 rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-xs leading-5 text-[var(--muted)]">{t('no_assets')}</p>}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col bg-[var(--canvas)]" aria-label={t('preview')}>
          <div
            className={`flex min-h-0 flex-1 items-center justify-center p-3 transition sm:p-5 lg:p-8 ${isDragging ? 'bg-indigo-500/15' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setIsDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }}
          >
            {!activeClip ? (
              <button onClick={() => fileInputRef.current?.click()} className="group relative flex aspect-video w-full max-w-3xl flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl transition hover:border-indigo-500" aria-label={t('upload_media')}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--raised)] transition group-hover:border-indigo-500"><Upload className="h-6 w-6 text-indigo-500" /></span>
                <span className="text-center"><strong className="block text-sm">{t('upload_media')}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{t('drop_here')}</span></span>
              </button>
            ) : (
              <div className="relative flex aspect-video w-full max-w-3xl items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-2xl">
                <video
                  key={activeClip.id} ref={videoRef} src={activeClip.url} playsInline
                  className="relative z-10 max-h-full max-w-full object-contain" style={previewStyle}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = activeClip.trimStart;
                    setCurrentTime(activeClip.trimStart);
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
                <span className="absolute left-3 top-3 z-20 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-white" aria-live="off">{currentTime.toFixed(2)}s / {activeClip.duration.toFixed(2)}s</span>
              </div>
            )}
          </div>

          <div className="flex h-14 shrink-0 items-center justify-center gap-5 border-t border-[var(--border)] bg-[var(--panel)]">
            <button onClick={() => seek(-5)} disabled={!activeClip} className={iconButton} aria-label={t('back_five')} title={t('back_five')}><RotateCcw className="h-4 w-4" /></button>
            <button onClick={togglePlay} disabled={!activeClip} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--text)] text-[var(--panel)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" aria-label={isPlaying ? t('pause') : t('play')}>{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}</button>
            <button onClick={() => seek(5)} disabled={!activeClip} className={iconButton} aria-label={t('forward_five')} title={t('forward_five')}><RotateCw className="h-4 w-4" /></button>
          </div>

          {processing && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 px-4 text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={processingLabel}>
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
              <p className="mb-3 text-lg font-medium">{processingLabel}</p>
              {processingStage === 'rendering' && <><div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/20"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 font-mono text-sm text-white/70">{progress.toFixed(0)}%</p></>}
              <button onClick={cancelExport} className="mt-5 rounded-md border border-white/30 px-4 py-2 text-sm hover:bg-white/10">{t('cancel')}</button>
            </div>
          )}
        </section>

        <aside className={`absolute inset-y-0 right-0 z-30 flex w-80 shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] transition-transform lg:static lg:w-72 lg:translate-x-0 ${mobilePanel === 'inspector' ? 'translate-x-0' : 'translate-x-full'}`} aria-label={t('inspector')}>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"><span>{t('inspector')}</span><button onClick={() => setMobilePanel(null)} className={`${iconButton} lg:hidden`} aria-label={t('close')}><X className="h-4 w-4" /></button></div>
          <div className="flex-1 space-y-7 p-4">
            <section aria-labelledby="trim-heading">
              <h2 id="trim-heading" className="mb-3 text-xs font-medium">{t('trim')}</h2>
              <div className="space-y-4">
                <RangeControl label={t('trim_start')} value={activeClip?.trimStart ?? 0} min={0} max={Math.max(0, (activeClip?.trimEnd ?? 0) - 0.1)} step={0.1} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimStart', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <RangeControl label={t('trim_end')} value={activeClip?.trimEnd ?? 0} min={Math.min(activeClip?.duration ?? 0, (activeClip?.trimStart ?? 0) + 0.1)} max={activeClip?.duration ?? 0} step={0.1} unit="s" disabled={!activeClip} onChange={(value) => updateTrim('trimEnd', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
              </div>
            </section>
            <section aria-labelledby="filters-heading">
              <h2 id="filters-heading" className="mb-3 text-xs font-medium">{t('filters')} <span className="text-[var(--muted)]">· {t('global')}</span></h2>
              <div className="space-y-4">
                <RangeControl label={t('brightness')} value={state.filters.brightness} min={0} max={200} onChange={(value) => updateFilter('brightness', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <RangeControl label={t('contrast')} value={state.filters.contrast} min={0} max={200} onChange={(value) => updateFilter('contrast', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <RangeControl label={t('saturation')} value={state.filters.saturation} min={0} max={200} onChange={(value) => updateFilter('saturation', value)} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
              </div>
            </section>
            <section aria-labelledby="audio-heading">
              <h2 id="audio-heading" className="mb-3 text-xs font-medium">{t('audio')} <span className="text-[var(--muted)]">· {t('global')}</span></h2>
              <div className="space-y-4">
                <RangeControl label={t('audio_sync')} value={state.audioDelay} min={-5000} max={5000} step={100} unit="ms" onChange={(value) => replaceState((current) => ({ ...current, audioDelay: value }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <RangeControl label={t('fade_in')} value={state.audioFade.fadeIn} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeIn: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <RangeControl label={t('fade_out')} value={state.audioFade.fadeOut} min={0} max={30} step={0.1} unit="s" onChange={(value) => replaceState((current) => ({ ...current, audioFade: { ...current.audioFade, fadeOut: value } }))} onEditStart={beginContinuousEdit} onEditEnd={finishContinuousEdit} />
                <p className="text-[10px] leading-4 text-[var(--muted)]">{t('fade_hint')}</p>
              </div>
            </section>
            <ExportPanel
              settings={state.exportSettings}
              projectDuration={projectDuration}
              disabled={!state.clips.length || processing}
              onChange={(settings, transient) => {
                const apply = (current: EditorState) => ({ ...current, exportSettings: settings });
                if (transient) replaceState(apply);
                else updateState(apply);
              }}
              onEditStart={beginContinuousEdit}
              onEditEnd={finishContinuousEdit}
              onExport={(format) => void handleExport(format)}
            />
          </div>
        </aside>
      </div>

      <footer className="flex h-40 shrink-0 flex-col border-t border-[var(--border)] bg-[var(--panel)] sm:h-48 lg:h-52">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 text-[10px] text-[var(--muted)] sm:px-4">
          <span><strong className="text-[var(--text)]">V1</strong> {t('video_track')}</span><span className="hidden sm:inline"><strong className="text-[var(--text)]">A1</strong> {t('audio_track')}</span><span className="ml-auto hidden font-mono sm:inline">{t('project_duration', { value: projectDuration.toFixed(1) })}</span><span className="truncate font-mono text-indigo-500">{activeClip ? `${t('active_trim')}: ${activeClip.trimStart.toFixed(1)}s – ${activeClip.trimEnd.toFixed(1)}s` : t('no_clip')}</span>
        </div>
        {state.clips.length ? (
          <div className="flex flex-1 items-center gap-2 overflow-x-auto p-3">
            {state.clips.map((clip) => {
              const duration = Math.max(clip.duration, 0.1);
              return (
                <button key={clip.id} onClick={() => replaceState((current) => ({ ...current, activeClipId: clip.id }))} className={`relative h-16 shrink-0 overflow-hidden rounded-md border bg-[var(--raised)] text-left ${state.activeClipId === clip.id ? 'border-indigo-500' : 'border-[var(--border)]'}`} style={{ width: `${Math.max(160, clip.duration * 12)}px` }} aria-label={clip.name}>
                  <span className="absolute inset-y-0 bg-indigo-500/25" style={{ left: `${clip.trimStart / duration * 100}%`, right: `${100 - clip.trimEnd / duration * 100}%` }} />
                  <span className="absolute inset-y-0 w-1 bg-indigo-500" style={{ left: `${clip.trimStart / duration * 100}%` }} />
                  <span className="absolute inset-y-0 w-1 bg-indigo-500" style={{ left: `calc(${clip.trimEnd / duration * 100}% - 4px)` }} />
                  <span className="relative block truncate px-3 text-[10px]">{clip.name}</span>
                </button>
              );
            })}
          </div>
        ) : <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted)]">{t('no_media')}</div>}
      </footer>

      {toast && <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm text-white shadow-xl ${toast.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`} role="status" aria-live="polite">{toast.message}</div>}
    </div>
  );
}
