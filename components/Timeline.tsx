'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  projectTimeToPixel as computeProjectTimeToPixel,
  pixelToProjectTime as computePixelToProjectTime,
  type TimelineClipLayout,
} from '@/lib/audio-track-utils';

export interface TimelineItem {
  id: string;
  name: string;
  trimStart: number;
  trimEnd: number;
  speed?: number;
}

/**
 * A timeline audio segment expressed in project-time coordinates. `projectStart`
 * is where the segment begins on the shared project timeline; its rendered
 * length is `trimEnd - trimStart` (source-time span played at 1x).
 */
export interface TimelineAudioSegment {
  id: string;
  name: string;
  projectStart: number;
  trimStart: number;
  trimEnd: number;
}

const PX_PER_SECOND = 14;
const CLIP_MIN_PX = 120;
const CLIP_GAP_PX = 8;
/** Left padding of the scroll surface (matches container `p-3`). */
const SURFACE_PAD_PX = 12;

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
  // ── Audio track (A1) ──────────────────────────────────────────────────────
  audioSegments?: TimelineAudioSegment[];
  selectedAudioSegmentId?: string | null;
  onSelectAudioSegment?: (segmentId: string | null) => void;
  /** Persist a segment's new project start (in project seconds, not pixels). */
  onAudioSegmentMove?: (segmentId: string, projectStart: number) => void;
  /** Signal the start of a continuous drag/keyboard move (single history checkpoint). */
  onAudioEditStart?: () => void;
  /** Signal the end of a continuous drag/keyboard move. */
  onAudioEditEnd?: () => void;
}

export default function Timeline({
  clips, activeClipId, currentTime, onSeek, onReorder,
  collapsed = false, zoom = 1, onZoomChange,
  audioSegments = [], selectedAudioSegmentId = null,
  onSelectAudioSegment, onAudioSegmentMove, onAudioEditStart, onAudioEditEnd,
}: TimelineProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [draggingAudioId, setDraggingAudioId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);

  const projectDuration = clips.reduce((sum, clip) => sum + getPlaybackDuration(clip), 0);

  const clipLayout: TimelineClipLayout[] = clips.map((clip) => {
    const playbackDuration = getPlaybackDuration(clip);
    return { playbackDuration, clipPx: Math.max(CLIP_MIN_PX, playbackDuration * PX_PER_SECOND * zoom) };
  });

  /**
   * Map a project-time (seconds) to a pixel offset within the scroll surface,
   * using the exact same per-clip layout as the video row (min-width + gaps).
   * This keeps the A1 row aligned with V1 even though clip pixel widths are not
   * strictly proportional to their duration.
   */
  const projectTimeToPixel = useCallback((projectTime: number) => {
    return computeProjectTimeToPixel(clipLayout, projectTime, PX_PER_SECOND * zoom, CLIP_GAP_PX);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, zoom]);

  /** Inverse of projectTimeToPixel: pixel offset → project-time (seconds). */
  const pixelToProjectTime = useCallback((px: number) => {
    return computePixelToProjectTime(clipLayout, px, PX_PER_SECOND * zoom, CLIP_GAP_PX);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, zoom]);

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

  // Auto-follow: scroll to keep playhead visible
  useEffect(() => {
    if (!autoFollowRef.current || draggingPlayhead || !containerRef.current) return;
    const container = containerRef.current;
    let pixelOffset = 0;
    for (const clip of clips) {
      const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
      const clipPx = Math.max(CLIP_MIN_PX, getPlaybackDuration(clip) * PX_PER_SECOND * zoom);
      if (clip.id === activeClipId) {
        const ratio = Math.max(0, Math.min(1, (currentTime - clip.trimStart) / sourceDuration));
        const pixelPos = pixelOffset + ratio * clipPx;
        const scrollLeft = container.scrollLeft;
        const width = container.clientWidth;
        if (pixelPos < scrollLeft || pixelPos > scrollLeft + width - 60) {
          container.scrollTo({ left: Math.max(0, pixelPos - width / 3), behavior: 'smooth' });
        }
        break;
      }
      pixelOffset += clipPx + CLIP_GAP_PX;
    }
  }, [currentTime, activeClipId, clips, zoom, draggingPlayhead]);

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
      const containerRect = container.getBoundingClientRect();
      const x = moveEvent.clientX - containerRect.left + container.scrollLeft;
      // Calculate which clip & source time
      let accPx = 0;
      for (const clip of clips) {
        const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
        const clipPx = Math.max(CLIP_MIN_PX, getPlaybackDuration(clip) * PX_PER_SECOND * zoom);
        if (x <= accPx + clipPx) {
          const ratio = Math.max(0, Math.min(1, (x - accPx) / clipPx));
          onSeek(clip.id, clip.trimStart + ratio * sourceDuration);
          return;
        }
        accPx += clipPx + CLIP_GAP_PX; // gap
      }
      // Past end: seek to last clip end
      const last = clips[clips.length - 1];
      if (last) onSeek(last.id, last.trimEnd);
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
    // Fire initial
    onMove(event.nativeEvent as unknown as globalThis.PointerEvent);
  }, [clips, onSeek, zoom]);

  /**
   * Horizontal drag of an audio segment. Persists `projectStart` in project
   * seconds (never pixels) and wraps the whole gesture in a single history
   * checkpoint via onAudioEditStart/onAudioEditEnd.
   */
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
    const containerRect = container.getBoundingClientRect();
    // Pointer offset within the block, in project seconds, so the grab point stays fixed.
    const pointerPx = event.clientX - containerRect.left + container.scrollLeft - SURFACE_PAD_PX;
    const grabProjectOffset = pixelToProjectTime(pointerPx) - segment.projectStart;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const px = moveEvent.clientX - containerRect.left + container.scrollLeft - SURFACE_PAD_PX;
      const projectTime = pixelToProjectTime(px) - grabProjectOffset;
      onAudioSegmentMove(segment.id, Math.max(0, projectTime));
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
  }, [onAudioSegmentMove, onAudioEditStart, onAudioEditEnd, onSelectAudioSegment, pixelToProjectTime]);

  const nudgeAudioSegment = useCallback((segment: TimelineAudioSegment, delta: number) => {
    if (!onAudioSegmentMove) return;
    onAudioEditStart?.();
    onAudioSegmentMove(segment.id, Math.max(0, segment.projectStart + delta));
    // The continuous edit is flushed on blur (see onBlur below), coalescing a
    // run of arrow-key nudges into a single history checkpoint.
  }, [onAudioSegmentMove, onAudioEditStart]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.2 : 0.2;
      const next = Math.max(0.3, Math.min(5, zoom + delta));
      onZoomChange?.(next);
    }
  }, [zoom, onZoomChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  if (collapsed) {
    return (
      <div className="flex h-8 items-center justify-center text-xs text-[var(--muted)]">
        {clips.length} {t('video_track').toLowerCase()} · {projectDuration.toFixed(1)}s
        {audioSegments.length > 0 && ` · ${audioSegments.length} ${t('audio_track').toLowerCase()}`}
      </div>
    );
  }

  // Compute global playhead pixel position
  let playheadPx = 0;
  let accPx = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
    const clipPx = Math.max(CLIP_MIN_PX, getPlaybackDuration(clip) * PX_PER_SECOND * zoom);
    if (clip.id === activeClipId) {
      const ratio = Math.max(0, Math.min(1, (currentTime - clip.trimStart) / sourceDuration));
      playheadPx = accPx + ratio * clipPx;
      break;
    }
    accPx += clipPx + CLIP_GAP_PX;
  }

  // Total video-row pixel width (used to size the A1 row surface).
  const totalClipsPx = clips.reduce(
    (sum, clip) => sum + Math.max(CLIP_MIN_PX, getPlaybackDuration(clip) * PX_PER_SECOND * zoom) + CLIP_GAP_PX,
    0,
  );
  const audioEndPx = audioSegments.reduce((max, seg) => {
    const px = projectTimeToPixel(seg.projectStart + getAudioSegmentDuration(seg));
    return Math.max(max, px);
  }, 0);
  const trackWidth = Math.max(totalClipsPx, audioEndPx + SURFACE_PAD_PX, 0);
  const hasAudio = audioSegments.length > 0;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={t('project_timeline')}
      className="relative flex flex-1 touch-pan-x flex-col justify-center gap-1.5 overflow-x-auto p-3"
    >
      {/* Global playhead: dedicated drag handle keeps the timeline surface touch-scrollable. */}
      {clips.length > 0 && (
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('timeline_playhead')}
          aria-valuemin={0}
          aria-valuemax={Number(projectDuration.toFixed(2))}
          aria-valuenow={Number(activeProjectTime.toFixed(2))}
          className="absolute inset-y-0 z-20 w-5 -translate-x-1/2 cursor-col-resize touch-none rounded focus-visible:bg-amber-400/15"
          style={{ left: `${playheadPx + SURFACE_PAD_PX}px` }}
          onPointerDown={handlePlayheadDrag}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === 'ArrowLeft' ? -1 : 1;
            seekProjectTime(activeProjectTime + direction * (event.shiftKey ? 1 : 0.1));
          }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" aria-hidden="true" />
          <span className="pointer-events-none absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-b bg-amber-400" aria-hidden="true" />
        </div>
      )}

      {/* ── V1 video row ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2" role="list" aria-label={t('video_track')}>
        {clips.map((clip, index) => {
          const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
          const duration = getPlaybackDuration(clip);
          const active = activeClipId === clip.id;
          const localPlayhead = active
            ? Math.max(0, Math.min(100, (currentTime - clip.trimStart) / sourceDuration * 100))
            : 0;
          return (
            <div
              key={clip.id}
              role="listitem"
              className={`relative shrink-0 rounded-md ${dropIndex === index && draggedId !== clip.id ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-[var(--panel)]' : ''}`}
              style={{ width: `${Math.max(CLIP_MIN_PX, duration * PX_PER_SECOND * zoom)}px` }}
              onDragOver={(event) => { event.preventDefault(); setDropIndex(index); }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId) onReorder(draggedId, index);
                setDraggedId(null);
                setDropIndex(null);
              }}
            >
              <button
                type="button"
                draggable
                onDragStart={(event) => {
                  setDraggedId(clip.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', clip.id);
                }}
                onDragEnd={() => { setDraggedId(null); setDropIndex(null); }}
                onClick={(event) => { event.stopPropagation(); seekFromPointer(event, clip); }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-current={active ? 'true' : undefined}
                aria-label={t('timeline_clip_label', {
                  name: clip.name, index: index + 1, total: clips.length, duration: duration.toFixed(2),
                })}
                className={`relative h-12 w-full cursor-grab overflow-hidden rounded-md border bg-[var(--raised)] text-left transition active:cursor-grabbing ${active ? 'border-indigo-500' : 'border-[var(--border)] hover:border-indigo-400'} ${draggedId === clip.id ? 'opacity-50' : ''}`}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-indigo-500/15 via-transparent to-cyan-500/10" />
                {active && <span className="absolute inset-y-0 z-10 w-0.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" style={{ left: `${localPlayhead}%` }} aria-hidden="true" />}
                <span className="relative block truncate px-3 pt-1.5 text-xs font-medium">{clip.name}</span>
                <span className="relative block px-3 pt-0.5 font-mono text-xs text-[var(--muted)]">{duration.toFixed(2)}s</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── A1 audio row (project-time aligned) ──────────────────────────── */}
      {hasAudio && (
        <div
          className="relative h-11 shrink-0"
          role="group"
          aria-label={t('audio_track')}
          style={{ width: `${trackWidth}px`, minWidth: '100%' }}
          onPointerDown={() => onSelectAudioSegment?.(null)}
        >
          {audioSegments.map((segment) => {
            const duration = getAudioSegmentDuration(segment);
            const left = projectTimeToPixel(segment.projectStart);
            const right = projectTimeToPixel(segment.projectStart + duration);
            const width = Math.max(24, right - left);
            const selected = selectedAudioSegmentId === segment.id;
            const dragging = draggingAudioId === segment.id;
            return (
              <button
                key={segment.id}
                type="button"
                aria-pressed={selected}
                aria-label={t('timeline_audio_label', {
                  name: segment.name,
                  start: segment.projectStart.toFixed(2),
                  duration: duration.toFixed(2),
                })}
                aria-describedby="timeline-audio-help"
                title={segment.name}
                style={{ left: `${left}px`, width: `${width}px` }}
                className={`absolute inset-y-0 flex cursor-grab touch-none flex-col justify-center overflow-hidden rounded-md border bg-gradient-to-r from-emerald-500/25 to-teal-500/15 px-2 text-left transition active:cursor-grabbing ${selected ? 'border-emerald-400 ring-2 ring-emerald-400/60' : 'border-emerald-600/50 hover:border-emerald-400'} ${dragging ? 'opacity-70' : ''}`}
                onPointerDown={(event) => handleAudioDrag(event, segment)}
                onClick={(event) => { event.stopPropagation(); onSelectAudioSegment?.(segment.id); }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowLeft' ? -1 : 1;
                    nudgeAudioSegment(segment, direction * (event.shiftKey ? 1 : 0.1));
                  }
                }}
                onBlur={() => onAudioEditEnd?.()}
              >
                <span className="pointer-events-none truncate text-xs font-medium text-emerald-50">{segment.name}</span>
                <span className="pointer-events-none font-mono text-[10px] text-emerald-100/70">{segment.projectStart.toFixed(1)}s · {duration.toFixed(1)}s</span>
              </button>
            );
          })}
          <span id="timeline-audio-help" className="sr-only">{t('timeline_audio_help')}</span>
        </div>
      )}
    </div>
  );
}
