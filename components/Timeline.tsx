'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface TimelineItem {
  id: string;
  name: string;
  trimStart: number;
  trimEnd: number;
  speed?: number;
}

function getPlaybackDuration(clip: TimelineItem) {
  return Math.max(0.01, (clip.trimEnd - clip.trimStart) / (clip.speed && clip.speed > 0 ? clip.speed : 1));
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
}

export default function Timeline({
  clips, activeClipId, currentTime, onSeek, onReorder,
  collapsed = false, zoom = 1, onZoomChange,
}: TimelineProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);

  const projectDuration = clips.reduce((sum, clip) => sum + getPlaybackDuration(clip), 0);

  // Auto-follow: scroll to keep playhead visible
  useEffect(() => {
    if (!autoFollowRef.current || draggingPlayhead || !containerRef.current) return;
    const container = containerRef.current;
    let pixelOffset = 0;
    for (const clip of clips) {
      const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
      const clipPx = Math.max(120, getPlaybackDuration(clip) * 14 * zoom);
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
      pixelOffset += clipPx + 8;
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
        const clipPx = Math.max(120, getPlaybackDuration(clip) * 14 * zoom);
        if (x <= accPx + clipPx) {
          const ratio = Math.max(0, Math.min(1, (x - accPx) / clipPx));
          onSeek(clip.id, clip.trimStart + ratio * sourceDuration);
          return;
        }
        accPx += clipPx + 8; // gap
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
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // Fire initial
    onMove(event.nativeEvent as unknown as globalThis.PointerEvent);
  }, [clips, onSeek, zoom]);

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
      <div className="flex h-8 items-center justify-center text-[10px] text-[var(--muted)]">
        {clips.length} {t('video_track').toLowerCase()} · {projectDuration.toFixed(1)}s
      </div>
    );
  }

  // Compute global playhead pixel position
  let playheadPx = 0;
  let accPx = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const sourceDuration = Math.max(0.01, clip.trimEnd - clip.trimStart);
    const clipPx = Math.max(120, getPlaybackDuration(clip) * 14 * zoom);
    if (clip.id === activeClipId) {
      const ratio = Math.max(0, Math.min(1, (currentTime - clip.trimStart) / sourceDuration));
      playheadPx = accPx + ratio * clipPx;
      break;
    }
    accPx += clipPx + 8;
  }

  return (
    <div
      ref={containerRef}
      role="list"
      aria-label={t('project_timeline')}
      className="relative flex flex-1 items-center gap-2 overflow-x-auto p-3"
      onPointerDown={handlePlayheadDrag}
      style={{ cursor: draggingPlayhead ? 'col-resize' : undefined }}
    >
      {/* Global playhead indicator */}
      {clips.length > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)] transition-[left]"
          style={{ left: `${playheadPx + 12}px` }}
          aria-hidden="true"
        />
      )}
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
            style={{ width: `${Math.max(120, duration * 14 * zoom)}px` }}
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
              className={`relative h-16 w-full cursor-grab overflow-hidden rounded-md border bg-[var(--raised)] text-left transition active:cursor-grabbing ${active ? 'border-indigo-500' : 'border-[var(--border)] hover:border-indigo-400'} ${draggedId === clip.id ? 'opacity-50' : ''}`}
            >
              <span className="absolute inset-0 bg-gradient-to-r from-indigo-500/15 via-transparent to-cyan-500/10" />
              {active && <span className="absolute inset-y-0 z-10 w-0.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" style={{ left: `${localPlayhead}%` }} aria-hidden="true" />}
              <span className="relative block truncate px-3 pt-3 text-[10px] font-medium">{clip.name}</span>
              <span className="relative block px-3 pt-1 font-mono text-[9px] text-[var(--muted)]">{duration.toFixed(2)}s</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
