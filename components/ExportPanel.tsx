'use client';

import { Download, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  estimateOutputSizeMB,
  resolveExportProfile,
  type ExportFrameRate,
  type ExportQuality,
  type ExportResolution,
  type ExportSettings,
} from '@/lib/ffmpeg-utils';

interface ExportPanelProps {
  settings: ExportSettings;
  projectDuration: number;
  disabled: boolean;
  onChange: (settings: ExportSettings, transient?: boolean) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onExport: (format: 'mp4' | 'webm') => void;
}

const fieldClass = 'w-full rounded-md border border-[var(--border)] bg-[var(--raised)] px-2.5 py-2 text-xs text-[var(--text)]';

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${minutes}:${remaining.toFixed(1).padStart(4, '0')}`;
}

export default function ExportPanel({
  settings, projectDuration, disabled, onChange, onEditStart, onEditEnd, onExport,
}: ExportPanelProps) {
  const { t } = useTranslation();
  const rangeEnd = Math.min(settings.rangeEnd ?? projectDuration, projectDuration);
  const requestedStart = Math.max(0, Math.min(settings.rangeStart, projectDuration));
  const rangeStart = requestedStart < rangeEnd ? requestedStart : 0;
  const rangeDuration = Math.max(0, rangeEnd - rangeStart);
  const profile = resolveExportProfile(settings);
  const estimatedSize = estimateOutputSizeMB(rangeDuration, profile);

  const updateRange = (key: 'rangeStart' | 'rangeEnd', value: number) => {
    onChange({
      ...settings,
      rangeStart,
      rangeEnd: settings.rangeEnd === null ? null : rangeEnd,
      [key]: value,
    }, true);
  };
  const sliderEvents = {
    onPointerDown: onEditStart,
    onPointerUp: onEditEnd,
    onKeyDown: onEditStart,
    onKeyUp: onEditEnd,
    onBlur: onEditEnd,
  };

  return (
    <section aria-label={t('export_settings')} className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChange({ ...settings, rangeStart: 0, rangeEnd: null })}
          disabled={disabled}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />{t('full_project')}
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--raised)] p-3">
        <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
          <span>{t('export_range')}</span>
          <output className="font-mono text-[var(--text)]">{formatTime(rangeStart)} – {formatTime(rangeEnd)}</output>
        </div>
        <label className="block text-[10px] text-[var(--muted)]">
          <span className="mb-1 flex justify-between"><span>{t('range_start')}</span><span>{rangeStart.toFixed(1)}s</span></span>
          <input
            type="range" min={0} max={Math.max(0, rangeEnd - 0.1)} step={0.1} value={rangeStart}
            disabled={disabled || projectDuration <= 0} onChange={(event) => updateRange('rangeStart', Number(event.target.value))}
            {...sliderEvents}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-indigo-600 disabled:opacity-40"
          />
        </label>
        <label className="block text-[10px] text-[var(--muted)]">
          <span className="mb-1 flex justify-between"><span>{t('range_end')}</span><span>{rangeEnd.toFixed(1)}s</span></span>
          <input
            type="range" min={Math.min(projectDuration, rangeStart + 0.1)} max={projectDuration} step={0.1} value={rangeEnd}
            disabled={disabled || projectDuration <= 0} onChange={(event) => updateRange('rangeEnd', Number(event.target.value))}
            {...sliderEvents}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-indigo-600 disabled:opacity-40"
          />
        </label>
        <p className="text-[10px] text-[var(--muted)]">{t('selected_duration', { value: rangeDuration.toFixed(1) })}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[10px] text-[var(--muted)]">
          <span>{t('resolution')}</span>
          <select
            value={settings.resolution} disabled={disabled}
            onChange={(event) => onChange({ ...settings, resolution: event.target.value as ExportResolution })}
            className={fieldClass}
          >
            <option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] text-[var(--muted)]">
          <span>{t('frame_rate')}</span>
          <select
            value={settings.frameRate} disabled={disabled}
            onChange={(event) => onChange({ ...settings, frameRate: Number(event.target.value) as ExportFrameRate })}
            className={fieldClass}
          >
            <option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-[10px] text-[var(--muted)]">
        <span>{t('quality')}</span>
        <select
          value={settings.quality} disabled={disabled}
          onChange={(event) => onChange({ ...settings, quality: event.target.value as ExportQuality })}
          className={fieldClass}
        >
          <option value="compact">{t('quality_compact')}</option>
          <option value="balanced">{t('quality_balanced')}</option>
          <option value="high">{t('quality_high')}</option>
        </select>
      </label>

      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-[10px] text-[var(--muted)]">
        <div className="flex justify-between"><span>{t('video_bitrate')}</span><strong className="text-[var(--text)]">{(profile.videoBitrateKbps / 1000).toFixed(1)} Mbps</strong></div>
        <div className="mt-1 flex justify-between"><span>{t('estimated_size')}</span><strong className="text-[var(--text)]">≈ {estimatedSize < 1 ? estimatedSize.toFixed(2) : estimatedSize.toFixed(1)} MB</strong></div>
        <p className="mt-1.5 leading-4">{t('size_disclaimer')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onExport('mp4')} disabled={disabled || rangeDuration <= 0} className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised)] p-2.5 text-xs transition hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />{t('export_mp4')}</button>
        <button type="button" onClick={() => onExport('webm')} disabled={disabled || rangeDuration <= 0} className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised)] p-2.5 text-xs transition hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />{t('export_webm')}</button>
      </div>
    </section>
  );
}
