'use client';

import { Download, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RangeControl from '@/components/RangeControl';
import { formatEditorTime } from '@/lib/workspace-utils';
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
    const nextValue = key === 'rangeStart'
      ? Math.max(0, Math.min(Math.max(0, rangeEnd - 0.1), value))
      : Math.max(Math.min(projectDuration, rangeStart + 0.1), Math.min(projectDuration, value));
    onChange({
      ...settings,
      rangeStart,
      rangeEnd: settings.rangeEnd === null ? null : rangeEnd,
      [key]: nextValue,
    }, true);
  };

  return (
    <section aria-label={t('export_settings')} className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChange({ ...settings, rangeStart: 0, rangeEnd: null })}
          disabled={disabled}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />{t('full_project')}
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--raised)] p-3">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>{t('export_range')}</span>
          <output className="font-mono text-[var(--text)]">{formatEditorTime(rangeStart)} – {formatEditorTime(rangeEnd)}</output>
        </div>
        <RangeControl
          label={t('range_start')} value={rangeStart} min={0} max={Math.max(0, rangeEnd - 0.1)} step={0.1} unit="s"
          disabled={disabled || projectDuration <= 0}
          onChange={(value) => updateRange('rangeStart', value)}
          onEditStart={onEditStart} onEditEnd={onEditEnd}
        />
        <RangeControl
          label={t('range_end')} value={rangeEnd} min={Math.min(projectDuration, rangeStart + 0.1)} max={projectDuration} step={0.1} unit="s"
          disabled={disabled || projectDuration <= 0}
          onChange={(value) => updateRange('rangeEnd', value)}
          onEditStart={onEditStart} onEditEnd={onEditEnd}
        />
        <p className="text-xs text-[var(--muted)]">{t('selected_duration', { value: rangeDuration.toFixed(1) })}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-[var(--muted)]">
          <span>{t('resolution')}</span>
          <select
            value={settings.resolution} disabled={disabled}
            onChange={(event) => onChange({ ...settings, resolution: event.target.value as ExportResolution })}
            className={fieldClass}
          >
            <option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--muted)]">
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

      <label className="block space-y-1 text-xs text-[var(--muted)]">
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

      <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-3 text-xs text-[var(--muted)]">
        <div className="flex justify-between"><span>{t('video_bitrate')}</span><strong className="text-[var(--text)]">{(profile.videoBitrateKbps / 1000).toFixed(1)} Mbps</strong></div>
        <div className="mt-1 flex justify-between"><span>{t('estimated_size')}</span><strong className="text-[var(--text)]">≈ {estimatedSize < 1 ? estimatedSize.toFixed(2) : estimatedSize.toFixed(1)} MB</strong></div>
        <p className="mt-1.5 leading-4">{t('size_disclaimer')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onExport('mp4')} disabled={disabled || rangeDuration <= 0} className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised)] p-2.5 text-sm font-medium transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />{t('export_mp4')}</button>
        <button type="button" onClick={() => onExport('webm')} disabled={disabled || rangeDuration <= 0} className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised)] p-2.5 text-sm font-medium transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />{t('export_webm')}</button>
      </div>
    </section>
  );
}
