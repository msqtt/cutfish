'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  projectTimeToPixel as computeProjectTimeToPixel,
  pixelToProjectTime as computePixelToProjectTime,
  type TimelineClipLayout,
} from '@/lib/audio-track-utils';
import { resolveVisibleTimelineTracks } from '@/lib/workspace-utils';

export interface TimelineItem {
  id: string;
  name: string;
  trimStart: number;
  trimEnd: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
}

export interface TimelineAudioSegment {
  id: string;
  name: string;
  projectStart: number;
  trimStart: number;
  trimEnd: number;
}

export type TimelineTimedTrack = 'subtitle' | 'image' | 'effect';

export interface TimelineTimedItem {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  movable?: boolean;
}

const PX_PER_SECOND = 14;
const CLIP_MIN_PX = 120;
const CLIP_GAP_PX = 8;
const SURFACE_PAD_PX = 8;
const TRACK_LABEL_PX = 76;

function getPlaybackDuration(clip: TimelineItem) {
  return Math.max(0.01, (clip.trimEnd - clip.trimStart) / (clip.speed && clip.speed > 0 ? clip.speed : 1));
}

function getAudioSegmentDuration(segment: TimelineAudioSegment) {
  return Math.max(0, segment.trimEnd - segment.trimStart);
}

interface TimelineProps {
  clips: TimelineItem[];
  activeClipId: string | null;
  currentTime: number;
  onSeek: (clipId: string, sourceTime: number) => void;
  onReorder: (clipId: string, targetIndex: number) => void;
  collapsed?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  audioSegments?: TimelineAudioSegment[];
  selectedAudioSegmentId?: string | null;
  onSelectAudioSegment?: (segmentId: string | null) => void;
  onAudioSegmentMove?: (segmentId: string, projectStart: number) => void;
  onAudioEditStart?: () => void;
  onAudioEditEnd?: () => void;
  subtitleItems?: TimelineTimedItem[];
  imageItems?: TimelineTimedItem[];
  effectItems?: TimelineTimedItem[];
  selectedTimedItem?: { track: TimelineTimedTrack; id: string } | null;
  onSelectTimedItem?: (track: TimelineTimedTrack, id: string | null) => void;
  onTimedItemMove?: (track: TimelineTimedTrack, id: string, projectStart: number) => void;
  onTimedEditStart?: () => void;
  onTimedEditEnd?: () => void;
}

export default function Timeline({
  clips, activeClipId, currentTime, onSeek, onReorder,
  collapsed = false, zoom = 1, onZoomChange,
  audioSegments = [], selectedAudioSegmentId = null,
  onSelectAudioSegment, onAudioSegmentMove, onAudioEditStart, onAudioEditEnd,
  subtitleItems = [], imageItems = [], effectItems = [], selectedTimedItem = null,
  onSelectTimedItem, onTimedItemMove, onTimedEditStart, onTimedEditEnd,
}: TimelineProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [draggingAudioId, setDraggingAudioId] = useState<string | null>(null);
  const [draggingTimedId, setDraggingTimedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);

  const projectDuration = clips.reduce((sum, clip) => sum + getPlaybackDuration(clip), 0);
  const visibleTracks = resolveVisibleTimelineTracks({
    hasVideo: clips.length > 0,
    hasBackgroundAudio: audioSegments.length > 0,
    hasSubtitles: subtitleItems.length > 0,
    hasImages: imageItems.length > 0,
    hasEffects: effectItems.length > 0,
  });
  const clipLayout: TimelineClipLayout[] = clips.map((clip) => {
    const playbackDuration = getPlaybackDuration(clip);
    return { playbackDuration, clipPx: Math.max(CLIP_MIN_PX, playbackDuration * PX_PER_SECOND * zoom) };
  });

  const projectTimeToPixel = useCallback((projectTime: number) => (
    computeProjectTimeToPixel(clipLayout, projectTime, PX_PER_SECOND * zoom, CLIP_GAP_PX)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [clips, zoom]);

  const pixelToProjectTime = useCallback((px: number) => (
    computePixelToProjectTime(clipLayout, px, PX_PER_SECOND * zoom, CLIP_GAP_PX)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [clips, zoom]);

  let activeProjectTime = 0;
  if (activeClipId) for (const clip of clips) {
    if (clip.id === activeClipId) {
      const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
      const ratio = Math.max(0, Math.min(1, (currentTime - clip.trimStart) / sourceDuration));
      activeProjectTime += ratio * getPlaybackDuration(clip);
      break;
    }
    activeProjectTime += getPlaybackDuration(clip);
  }

  const seekProjectTime = useCallback((projectTime: number) => {
    let cursor = 0;
    const target = Math.max(0, Math.min(projectDuration, projectTime));
    for (const clip of clips) {
      const playbackDuration = getPlaybackDuration(clip);
      if (target <= cursor + playbackDuration || clip === clips[clips.length - 1]) {
        const ratio = Math.max(0, Math.min(1, (target - cursor) / playbackDuration));
        onSeek(clip.id, clip.trimStart + ratio * (clip.trimEnd - clip.trimStart));
        return;
      }
      cursor += playbackDuration;
    }
  }, [clips, onSeek, projectDuration]);

  useEffect(() => {
    if (!autoFollowRef.current || draggingPlayhead || !containerRef.current) return;
    const container = containerRef.current;
    const pixelPos = TRACK_LABEL_PX + projectTimeToPixel(activeProjectTime);
    const scrollLeft = container.scrollLeft;
    const width = container.clientWidth;
    if (pixelPos < scrollLeft + TRACK_LABEL_PX || pixelPos > scrollLeft + width - 60) {
      container.scrollTo({ left: Math.max(0, pixelPos - width / 3), behavior: 'smooth' });
    }
  }, [activeProjectTime, draggingPlayhead, projectTimeToPixel]);

  const seekFromPointer = (event: MouseEvent<HTMLButtonElement>, clip: TimelineItem) => {
    if (draggedId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(clip.id, clip.trimStart + ratio * (clip.trimEnd - clip.trimStart));
  };

  const handlePlayheadDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || clips.length === 0) return;
    event.preventDefault();
    setDraggingPlayhead(true);
    autoFollowRef.current = false;
    const container = containerRef.current;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left + container.scrollLeft - SURFACE_PAD_PX - TRACK_LABEL_PX;
      seekProjectTime(pixelToProjectTime(x));
    };
    const onUp = () => {
      setDraggingPlayhead(false);
      autoFollowRef.current = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    onMove(event.nativeEvent as unknown as globalThis.PointerEvent);
  }, [clips.length, pixelToProjectTime, seekProjectTime]);

  const pointerProjectTime = useCallback((clientX: number, container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect();
    return pixelToProjectTime(clientX - rect.left + container.scrollLeft - SURFACE_PAD_PX - TRACK_LABEL_PX);
  }, [pixelToProjectTime]);

  const handleAudioDrag = useCallback((event: ReactPointerEvent<HTMLElement>, segment: TimelineAudioSegment) => {
    if (!containerRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectAudioSegment?.(segment.id);
    if (!onAudioSegmentMove) return;
    setDraggingAudioId(segment.id);
    autoFollowRef.current = false;
    onAudioEditStart?.();
    const container = containerRef.current;
    const grabOffset = pointerProjectTime(event.clientX, container) - segment.projectStart;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      onAudioSegmentMove(segment.id, Math.max(0, pointerProjectTime(moveEvent.clientX, container) - grabOffset));
    };
    const onUp = () => {
      setDraggingAudioId(null);
      autoFollowRef.current = true;
      onAudioEditEnd?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onAudioEditEnd, onAudioEditStart, onAudioSegmentMove, onSelectAudioSegment, pointerProjectTime]);

  const handleTimedDrag = useCallback((event: ReactPointerEvent<HTMLElement>, track: TimelineTimedTrack, item: TimelineTimedItem) => {
    if (!containerRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectTimedItem?.(track, item.id);
    if (item.movable === false || !onTimedItemMove) return;
    setDraggingTimedId(`${track}:${item.id}`);
    autoFollowRef.current = false;
    onTimedEditStart?.();
    const container = containerRef.current;
    const grabOffset = pointerProjectTime(event.clientX, container) - item.startTime;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      onTimedItemMove(track, item.id, Math.max(0, pointerProjectTime(moveEvent.clientX, container) - grabOffset));
    };
    const onUp = () => {
      setDraggingTimedId(null);
      autoFollowRef.current = true;
      onTimedEditEnd?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onSelectTimedItem, onTimedEditEnd, onTimedEditStart, onTimedItemMove, pointerProjectTime]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      onZoomChange?.(Math.max(0.3, Math.min(5, zoom + (event.deltaY > 0 ? -0.2 : 0.2))));
    }
  }, [onZoomChange, zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  if (collapsed) {
    return <div className="flex h-8 items-center justify-center text-xs text-[var(--muted)]">{clips.length} {t('video_track').toLowerCase()} · {projectDuration.toFixed(1)}s</div>;
  }

  const playheadPx = projectTimeToPixel(activeProjectTime);
  const totalClipsPx = clips.reduce((sum, clip) => sum + Math.max(CLIP_MIN_PX, getPlaybackDuration(clip) * PX_PER_SECOND * zoom) + CLIP_GAP_PX, 0);
  const allTimedItems = [...subtitleItems, ...imageItems, ...effectItems];
  const furthestProjectTime = Math.max(
    projectDuration,
    ...audioSegments.map((item) => item.projectStart + getAudioSegmentDuration(item)),
    ...allTimedItems.map((item) => item.endTime),
  );
  const trackWidth = Math.max(totalClipsPx, projectTimeToPixel(furthestProjectTime) + SURFACE_PAD_PX, 1);

  const trackLabel = (code: string, label: string) => (
    <div className="sticky left-0 z-30 flex h-full w-[76px] shrink-0 items-center gap-1 border-r border-[var(--border)] bg-[var(--panel)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
      <strong className="text-[var(--text)]">{code}</strong><span className="truncate">{label}</span>
    </div>
  );

  const renderTimedTrack = (track: TimelineTimedTrack, code: string, label: string, items: TimelineTimedItem[], palette: string) => (
    <div className="flex h-10 shrink-0" role="group" aria-label={label}>
      {trackLabel(code, label)}
      <div className="relative h-full shrink-0 border-b border-[var(--border)]/60" style={{ width: `${trackWidth}px`, minWidth: `calc(100% - ${TRACK_LABEL_PX}px)` }} onPointerDown={() => onSelectTimedItem?.(track, null)}>
        {items.length === 0 && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]/70">{t('empty_track')}</span>}
        {items.map((item) => {
          const left = projectTimeToPixel(item.startTime);
          const width = Math.max(24, projectTimeToPixel(item.endTime) - left);
          const selected = selectedTimedItem?.track === track && selectedTimedItem.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              aria-label={t('timeline_timed_label', { name: item.name, track: label, start: item.startTime.toFixed(2), duration: Math.max(0, item.endTime - item.startTime).toFixed(2) })}
              aria-describedby="timeline-timed-help"
              style={{ left: `${left}px`, width: `${width}px` }}
              className={`absolute inset-y-1 flex touch-none items-center overflow-hidden rounded border px-2 text-left text-[10px] font-medium transition ${palette} ${item.movable === false ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'ring-2 ring-white/60' : ''} ${draggingTimedId === `${track}:${item.id}` ? 'opacity-70' : ''}`}
              onPointerDown={(event) => handleTimedDrag(event, track, item)}
              onClick={(event) => { event.stopPropagation(); onSelectTimedItem?.(track, item.id); }}
              onKeyDown={(event) => {
                if (item.movable === false || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                event.preventDefault();
                event.stopPropagation();
                onTimedEditStart?.();
                const direction = event.key === 'ArrowLeft' ? -1 : 1;
                onTimedItemMove?.(track, item.id, Math.max(0, item.startTime + direction * (event.shiftKey ? 1 : 0.1)));
              }}
              onBlur={() => onTimedEditEnd?.()}
              title={item.name}
            ><span className="truncate">{item.name}</span></button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} role="group" aria-label={t('project_timeline')} className="relative flex flex-1 touch-pan-x flex-col overflow-auto p-2">
      {clips.length > 0 && (
        <div
          role="slider" tabIndex={0} aria-label={t('timeline_playhead')}
          aria-valuemin={0} aria-valuemax={Number(projectDuration.toFixed(2))} aria-valuenow={Number(activeProjectTime.toFixed(2))}
          className="absolute inset-y-0 z-40 w-5 -translate-x-1/2 cursor-col-resize touch-none rounded focus-visible:bg-amber-400/15"
          style={{ left: `${SURFACE_PAD_PX + TRACK_LABEL_PX + playheadPx}px` }}
          onPointerDown={handlePlayheadDrag}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            seekProjectTime(activeProjectTime + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
          }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" aria-hidden="true" />
          <span className="pointer-events-none absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-b bg-amber-400" aria-hidden="true" />
        </div>
      )}

      <div className="flex h-14 shrink-0" role="group" aria-label={t('video_track')}>
        {trackLabel('V1', t('video_track'))}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)]/60" role="list" style={{ width: `${trackWidth}px`, minWidth: `calc(100% - ${TRACK_LABEL_PX}px)` }}>
          {clips.map((clip, index) => {
            const duration = getPlaybackDuration(clip);
            const active = activeClipId === clip.id;
            return (
              <div key={clip.id} role="listitem" className={`relative shrink-0 rounded-md ${dropIndex === index && draggedId !== clip.id ? 'ring-2 ring-indigo-400' : ''}`} style={{ width: `${Math.max(CLIP_MIN_PX, duration * PX_PER_SECOND * zoom)}px` }} onDragOver={(event) => { event.preventDefault(); setDropIndex(index); }} onDrop={(event) => { event.preventDefault(); if (draggedId) onReorder(draggedId, index); setDraggedId(null); setDropIndex(null); }}>
                <button
                  type="button" draggable
                  onDragStart={(event) => { setDraggedId(clip.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', clip.id); }}
                  onDragEnd={() => { setDraggedId(null); setDropIndex(null); }}
                  onClick={(event) => { event.stopPropagation(); seekFromPointer(event, clip); }}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-current={active ? 'true' : undefined}
                  aria-label={t('timeline_clip_label', { name: clip.name, index: index + 1, total: clips.length, duration: duration.toFixed(2) })}
                  className={`relative h-12 w-full cursor-grab overflow-hidden rounded-md border bg-[var(--raised)] text-left transition active:cursor-grabbing ${active ? 'border-indigo-500' : 'border-[var(--border)] hover:border-indigo-400'} ${draggedId === clip.id ? 'opacity-50' : ''}`}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-indigo-500/15 via-transparent to-cyan-500/10" />
                  <span className="relative block truncate px-3 pt-1.5 text-xs font-medium">{clip.name}</span>
                  <span className="relative block px-3 pt-0.5 font-mono text-[10px] text-[var(--muted)]">{duration.toFixed(2)}s</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {visibleTracks.includes('source-audio') && (
        <div className="flex h-10 shrink-0" role="group" aria-label={t('source_audio_track')}>
          {trackLabel('A1', t('source_audio_track'))}
          <div className="flex h-full shrink-0 items-center gap-2 border-b border-[var(--border)]/60" role="list" style={{ width: `${trackWidth}px`, minWidth: `calc(100% - ${TRACK_LABEL_PX}px)` }}>
            {clips.map((clip) => {
              const duration = getPlaybackDuration(clip);
              const muted = clip.muted === true || (clip.volume ?? 100) <= 0;
              return (
                <button
                  key={clip.id}
                  type="button"
                  role="listitem"
                  aria-label={t('timeline_source_audio_label', { name: clip.name, volume: clip.volume ?? 100, state: muted ? t('muted_state') : t('audible_state') })}
                  title={`${clip.name} · ${muted ? t('muted_state') : `${clip.volume ?? 100}%`}`}
                  style={{ width: `${Math.max(CLIP_MIN_PX, duration * PX_PER_SECOND * zoom)}px` }}
                  className={`relative h-8 shrink-0 overflow-hidden rounded border px-2 text-left text-[10px] transition ${activeClipId === clip.id ? 'border-amber-300 ring-1 ring-amber-300/60' : 'border-amber-600/50 hover:border-amber-400'} ${muted ? 'bg-amber-950/20 text-amber-200/45' : 'bg-gradient-to-r from-amber-500/30 via-orange-500/20 to-amber-500/30 text-amber-100'}`}
                  onClick={() => onSeek(clip.id, clip.trimStart)}
                >
                  <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-current opacity-30" aria-hidden="true" />
                  <span className="relative flex items-center justify-between gap-2"><span className="truncate">{clip.name}</span><span className="shrink-0 font-mono">{muted ? t('muted_state') : `${clip.volume ?? 100}%`}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visibleTracks.includes('background-audio') && (
        <div className="flex h-10 shrink-0" role="group" aria-label={t('background_audio_track')}>
          {trackLabel('A2', t('background_audio_track'))}
          <div className="relative h-full shrink-0 border-b border-[var(--border)]/60" style={{ width: `${trackWidth}px`, minWidth: `calc(100% - ${TRACK_LABEL_PX}px)` }} onPointerDown={() => onSelectAudioSegment?.(null)}>
            {audioSegments.map((segment) => {
              const duration = getAudioSegmentDuration(segment);
              const left = projectTimeToPixel(segment.projectStart);
              const width = Math.max(24, projectTimeToPixel(segment.projectStart + duration) - left);
              const selected = selectedAudioSegmentId === segment.id;
              return (
                <button key={segment.id} type="button" aria-pressed={selected} aria-label={t('timeline_audio_label', { name: segment.name, start: segment.projectStart.toFixed(2), duration: duration.toFixed(2) })} aria-describedby="timeline-audio-help" title={segment.name} style={{ left: `${left}px`, width: `${width}px` }} className={`absolute inset-y-1 flex cursor-grab touch-none items-center overflow-hidden rounded border bg-gradient-to-r from-emerald-500/35 to-teal-500/20 px-2 text-left text-[10px] font-medium text-emerald-100 transition active:cursor-grabbing ${selected ? 'border-emerald-300 ring-2 ring-emerald-300/60' : 'border-emerald-600/50 hover:border-emerald-400'} ${draggingAudioId === segment.id ? 'opacity-70' : ''}`} onPointerDown={(event) => handleAudioDrag(event, segment)} onClick={(event) => { event.stopPropagation(); onSelectAudioSegment?.(segment.id); }} onKeyDown={(event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); event.stopPropagation(); onAudioEditStart?.(); onAudioSegmentMove?.(segment.id, Math.max(0, segment.projectStart + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1))); }} onBlur={() => onAudioEditEnd?.()}><span className="truncate">{segment.name}</span></button>
              );
            })}
          </div>
        </div>
      )}

      {visibleTracks.includes('subtitle') && renderTimedTrack('subtitle', 'S1', t('subtitle_track'), subtitleItems, 'border-sky-500/60 bg-sky-500/25 text-sky-100 hover:border-sky-300')}
      {visibleTracks.includes('image') && renderTimedTrack('image', 'I1', t('image_track'), imageItems, 'border-fuchsia-500/60 bg-fuchsia-500/25 text-fuchsia-100 hover:border-fuchsia-300')}
      {visibleTracks.includes('effect') && renderTimedTrack('effect', 'FX', t('effect_track'), effectItems, 'border-violet-500/60 bg-violet-500/25 text-violet-100 hover:border-violet-300')}
      <span id="timeline-audio-help" className="sr-only">{t('timeline_audio_help')}</span>
      <span id="timeline-timed-help" className="sr-only">{t('timeline_timed_help')}</span>
    </div>
  );
}
