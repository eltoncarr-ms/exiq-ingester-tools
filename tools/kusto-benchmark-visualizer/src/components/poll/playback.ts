/**
 * Pure playback helpers for `PollTimelineReplay`. Kept dependency-free and
 * DOM-free so they can be unit tested directly; the component wraps these
 * with `requestAnimationFrame` and React state.
 */
import type { PollCycleAnalysis, PollStageTimelineEntry } from '../../poll/derive';

export type PollPlaybackSpeed = 0.5 | 1 | 2 | 4;

export const POLL_PLAYBACK_SPEEDS: PollPlaybackSpeed[] = [0.5, 1, 2, 4];

/** End offset (ms from cycle start) of one stage span, or `null` while still open. */
export function stageEndMs(stage: PollStageTimelineEntry): number | null {
  return stage.durMs === null ? null : stage.startMs + stage.durMs;
}

/**
 * Total replay duration for a cycle, in ms from cycle start. Prefers the
 * rolled-up `totalMs`; falls back to the furthest known stage end (or start,
 * for a still-open stage) so an in-progress cycle still has a scrubbable
 * range. Never negative.
 */
export function replayDurationMs(cycle: PollCycleAnalysis): number {
  if (cycle.totalMs !== null && Number.isFinite(cycle.totalMs) && cycle.totalMs > 0) return cycle.totalMs;

  let max = 0;
  for (const stage of cycle.stages) {
    const end = stageEndMs(stage);
    max = Math.max(max, end ?? stage.startMs);
  }

  return max;
}

/** Clamps `elapsedMs` to the closed range `[0, durationMs]`. */
export function clampElapsedMs(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;

  return Math.min(Math.max(elapsedMs, 0), Math.max(durationMs, 0));
}

/**
 * Advances `elapsedMs` by `deltaMs` scaled by `speed`, clamped to
 * `durationMs`. Returns the new elapsed time plus whether it reached the end
 * (so the caller can stop playback there instead of looping).
 */
export function advanceElapsedMs(
  elapsedMs: number,
  deltaMs: number,
  speed: number,
  durationMs: number,
): { elapsedMs: number; finished: boolean } {
  const next = clampElapsedMs(elapsedMs + Math.max(0, deltaMs) * speed, durationMs);
  return { elapsedMs: next, finished: durationMs > 0 && next >= durationMs };
}

/**
 * The stage active at `elapsedMs`, or `null` if none contains that instant.
 * An open stage (no `end` yet) is considered active from its start onward.
 * When spans overlap, the later-starting stage wins.
 */
export function activeStageAt(stages: PollStageTimelineEntry[], elapsedMs: number): PollStageTimelineEntry | null {
  let active: PollStageTimelineEntry | null = null;
  for (const stage of stages) {
    const end = stageEndMs(stage);
    const withinOpenSpan = end === null && elapsedMs >= stage.startMs;
    const withinClosedSpan = end !== null && elapsedMs >= stage.startMs && elapsedMs < end;
    if ((withinOpenSpan || withinClosedSpan) && (active === null || stage.startMs >= active.startMs)) {
      active = stage;
    }
  }

  return active;
}

/** Stage names in first-seen (chronological) order, for stable lane ordering. */
export function orderedStageNames(stages: PollStageTimelineEntry[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const stage of [...stages].sort((a, b) => a.startMs - b.startMs)) {
    if (!seen.has(stage.stage)) {
      seen.add(stage.stage);
      ordered.push(stage.stage);
    }
  }

  return ordered;
}
