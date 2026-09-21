'use client';

import { useId } from 'react';

export interface RangeControlProps {
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

/**
 * One numeric-input + slider interaction contract shared by the Inspector and
 * the Export panel. Both controls stay clamped to [min, max]; pointer, keyboard,
 * and blur all funnel through the same onEditStart/onEditEnd lifecycle so the
 * caller can bracket a continuous (transient) history edit.
 */
export default function RangeControl({
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
            className="w-20 rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-1 text-right font-mono text-xs text-[var(--text)] disabled:opacity-40"
          />
          <span className="min-w-4 text-xs">{unit}</span>
        </div>
      </div>
      <input
        id={`${id}-range`} type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        onPointerDown={onEditStart} onPointerUp={onEditEnd} onPointerCancel={onEditEnd} onKeyDown={onEditStart}
        onKeyUp={onEditEnd} onBlur={onEditEnd} onChange={(event) => updateValue(Number(event.target.value))}
        className="h-5 w-full touch-pan-y cursor-pointer appearance-none rounded-full accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
}
