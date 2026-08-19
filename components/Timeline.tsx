'use client';

import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface TimelineItem {
  id: string;
  name: string;
  trimStart: number;
  trimEnd: number;
}

interface TimelineProps {
  clips: TimelineItem[];
  activeClipId: string | null;
  currentTime: number;
  onSeek: (clipId: string, sourceTime: number) => void;
  onReorder: (clipId: string, targetIndex: number) => void;
}

export default function Timeline({ clips, activeClipId, currentTime, onSeek, onReorder }: TimelineProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const seekFromPointer = (event: MouseEvent<HTMLButtonElement>, clip: TimelineItem) => {
    if (draggedId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(clip.id, clip.trimStart + ratio * (clip.trimEnd - clip.trimStart));
  };

  return (
    <div role="list" aria-label={t('project_timeline')} className="flex flex-1 items-center gap-2 overflow-x-auto p-3">
      {clips.map((clip, index) => {
        const duration = Math.max(0.01, clip.trimEnd - clip.trimStart);
        const active = activeClipId === clip.id;
        const playhead = active
          ? Math.max(0, Math.min(100, (currentTime - clip.trimStart) / duration * 100))
          : 0;
        return (
          <div
            key={clip.id}
            role="listitem"
            className={`relative shrink-0 rounded-md ${dropIndex === index && draggedId !== clip.id ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-[var(--panel)]' : ''}`}
            style={{ width: `${Math.max(120, duration * 14)}px` }}
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
              onClick={(event) => seekFromPointer(event, clip)}
              aria-current={active ? 'true' : undefined}
              aria-label={t('timeline_clip_label', {
                name: clip.name, index: index + 1, total: clips.length, duration: duration.toFixed(2),
              })}
              className={`relative h-16 w-full cursor-grab overflow-hidden rounded-md border bg-[var(--raised)] text-left transition active:cursor-grabbing ${active ? 'border-indigo-500' : 'border-[var(--border)] hover:border-indigo-400'} ${draggedId === clip.id ? 'opacity-50' : ''}`}
            >
              <span className="absolute inset-0 bg-gradient-to-r from-indigo-500/15 via-transparent to-cyan-500/10" />
              {active && <span className="absolute inset-y-0 z-10 w-0.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" style={{ left: `${playhead}%` }} aria-hidden="true" />}
              <span className="relative block truncate px-3 pt-3 text-[10px] font-medium">{clip.name}</span>
              <span className="relative block px-3 pt-1 font-mono text-[9px] text-[var(--muted)]">{duration.toFixed(2)}s</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
