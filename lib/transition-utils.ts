export type TransitionType = 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideright' | 'slideleft';

export interface TransitionConfig {
  id: string;
  afterClipId: string;
  type: TransitionType;
  duration: number; // 0.2–3.0 seconds
}

export interface TransitionClip {
  id: string;
  trimmedDuration: number;
}

/**
 * Clamp transition duration to be at most the minimum of adjacent clip durations minus a small epsilon.
 */
function clampTransitionDuration(duration: number, leftDuration: number, rightDuration: number): number {
  const maxAllowed = Math.min(leftDuration, rightDuration) - 0.01;
  return Math.max(0.1, Math.min(duration, maxAllowed));
}

/**
 * Find the effective transition between each pair of clips.
 * Returns a map from clip index → transition config (where clip index is the left clip).
 */
function resolveTransitions(clips: TransitionClip[], transitions: TransitionConfig[]): Map<number, TransitionConfig> {
  const map = new Map<number, TransitionConfig>();
  for (const t of transitions) {
    const index = clips.findIndex((c) => c.id === t.afterClipId);
    // Must have a next clip (not the last one)
    if (index >= 0 && index < clips.length - 1) {
      map.set(index, t);
    }
  }
  return map;
}

/**
 * Compute the total output duration after accounting for transitions.
 * Each transition removes `duration` seconds from the naive sum.
 */
export function computeTransitionAdjustedDuration(clips: TransitionClip[], transitions: TransitionConfig[]): number {
  const naiveSum = clips.reduce((sum, c) => sum + c.trimmedDuration, 0);
  const resolved = resolveTransitions(clips, transitions);
  let totalReduction = 0;
  for (const [index, t] of resolved) {
    const clamped = clampTransitionDuration(t.duration, clips[index].trimmedDuration, clips[index + 1].trimmedDuration);
    totalReduction += clamped;
  }
  return naiveSum - totalReduction;
}

/**
 * Build the xfade filter chain for video.
 * Uses pairwise xfade between consecutive clips that have transitions.
 * For clips without transitions between them, they are concatenated first.
 *
 * Input labels: [v0], [v1], [v2], ...
 * Output: final video label is the last xfade output or concat output.
 *
 * Returns the filter_complex segment (without trailing semicolon) and the final label.
 * Returns empty string if no transitions exist.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildXfadeChain(clips: TransitionClip[], transitions: TransitionConfig[], _fps: number): string {
  if (clips.length < 2) return '';
  const resolved = resolveTransitions(clips, transitions);
  if (resolved.size === 0) return '';

  const segments: string[] = [];
  let accumulatedDuration = clips[0].trimmedDuration;
  let prevLabel = '[v0]';
  let xfadeCount = 0;

  for (let i = 1; i < clips.length; i++) {
    const transition = resolved.get(i - 1);
    const nextLabel = `[v${i}]`;

    if (transition) {
      const clamped = clampTransitionDuration(transition.duration, clips[i - 1].trimmedDuration, clips[i].trimmedDuration);
      const offset = Number((accumulatedDuration - clamped).toFixed(6));
      const outLabel = `[xf${xfadeCount}]`;
      segments.push(`${prevLabel}${nextLabel}xfade=transition=${transition.type}:duration=${Number(clamped.toFixed(6))}:offset=${offset}${outLabel}`);
      accumulatedDuration = accumulatedDuration + clips[i].trimmedDuration - clamped;
      prevLabel = outLabel;
      xfadeCount++;
    } else {
      // No transition: use xfade with duration=0 offset=accumulatedDuration for seamless concat in filter chain
      const offset = Number(accumulatedDuration.toFixed(6));
      const outLabel = `[xf${xfadeCount}]`;
      segments.push(`${prevLabel}${nextLabel}xfade=transition=fade:duration=0:offset=${offset}${outLabel}`);
      accumulatedDuration += clips[i].trimmedDuration;
      prevLabel = outLabel;
      xfadeCount++;
    }
  }

  return segments.join(';');
}

/**
 * Build the acrossfade filter chain for audio.
 * Mirrors the xfade chain structure for video.
 *
 * Input labels: [a0], [a1], [a2], ...
 * Returns empty string if no transitions exist.
 */
export function buildAcrossfadeChain(clips: TransitionClip[], transitions: TransitionConfig[]): string {
  if (clips.length < 2) return '';
  const resolved = resolveTransitions(clips, transitions);
  if (resolved.size === 0) return '';

  const segments: string[] = [];
  let prevLabel = '[a0]';
  let crossfadeCount = 0;

  for (let i = 1; i < clips.length; i++) {
    const transition = resolved.get(i - 1);
    const nextLabel = `[a${i}]`;

    if (transition) {
      const clamped = clampTransitionDuration(transition.duration, clips[i - 1].trimmedDuration, clips[i].trimmedDuration);
      const outLabel = `[af${crossfadeCount}]`;
      segments.push(`${prevLabel}${nextLabel}acrossfade=d=${Number(clamped.toFixed(6))}:c1=tri:c2=tri${outLabel}`);
      prevLabel = outLabel;
      crossfadeCount++;
    } else {
      // No transition: concat audio streams for seamless join
      const outLabel = `[af${crossfadeCount}]`;
      segments.push(`${prevLabel}${nextLabel}concat=n=2:v=0:a=1${outLabel}`);
      prevLabel = outLabel;
      crossfadeCount++;
    }
  }

  return segments.join(';');
}

/**
 * Get the final output label from the xfade/acrossfade chain.
 */
export function getXfadeFinalLabel(clips: TransitionClip[], transitions: TransitionConfig[], prefix: 'xf' | 'af'): string {
  if (clips.length < 2) return prefix === 'xf' ? '[v0]' : '[a0]';
  const resolved = resolveTransitions(clips, transitions);
  if (resolved.size === 0) return '';
  const chainLength = clips.length - 1;
  return `[${prefix}${chainLength - 1}]`;
}
