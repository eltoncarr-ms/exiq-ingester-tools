import { describe, expect, it } from 'vitest';
import type { PollCycleAnalysis, PollStageTimelineEntry } from '../../poll/derive';
import { activeStageAt, advanceElapsedMs, clampElapsedMs, orderedStageNames, replayDurationMs, stageEndMs } from './playback';

function stage(overrides: Partial<PollStageTimelineEntry> = {}): PollStageTimelineEntry {
  return { stage: 'seal', startMs: 0, durMs: 100, completed: true, ...overrides };
}

function cycle(overrides: Partial<PollCycleAnalysis> = {}): PollCycleAnalysis {
  return {
    runId: 'run-1',
    source: 'portal-firehose',
    outcome: 'success',
    startedAtMs: 0,
    completedAtMs: 5000,
    totalMs: 5000,
    records: 100,
    recordsPerSec: 20,
    stages: [],
    ...overrides,
  };
}

describe('stageEndMs', () => {
  it('adds startMs and durMs for a closed stage', () => {
    expect(stageEndMs(stage({ startMs: 10, durMs: 40 }))).toBe(50);
  });

  it('is null for a still-open stage', () => {
    expect(stageEndMs(stage({ durMs: null }))).toBeNull();
  });
});

describe('replayDurationMs', () => {
  it('prefers the rolled-up totalMs when present', () => {
    expect(replayDurationMs(cycle({ totalMs: 5000, stages: [stage({ startMs: 0, durMs: 100 })] }))).toBe(5000);
  });

  it('falls back to the furthest known stage end when totalMs is null', () => {
    const analysis = cycle({
      totalMs: null,
      stages: [stage({ stage: 'cursorRead', startMs: 0, durMs: 10 }), stage({ stage: 'seal', startMs: 10, durMs: 3200 })],
    });
    expect(replayDurationMs(analysis)).toBe(3210);
  });

  it('falls back to the open stage start when it has no end yet', () => {
    const analysis = cycle({ totalMs: null, stages: [stage({ startMs: 500, durMs: null })] });
    expect(replayDurationMs(analysis)).toBe(500);
  });

  it('is zero for a cycle with no totalMs and no stages', () => {
    expect(replayDurationMs(cycle({ totalMs: null, stages: [] }))).toBe(0);
  });
});

describe('clampElapsedMs', () => {
  it('clamps to the [0, durationMs] range', () => {
    expect(clampElapsedMs(-10, 1000)).toBe(0);
    expect(clampElapsedMs(2000, 1000)).toBe(1000);
    expect(clampElapsedMs(500, 1000)).toBe(500);
  });

  it('treats a non-finite value as zero', () => {
    expect(clampElapsedMs(Number.NaN, 1000)).toBe(0);
  });
});

describe('advanceElapsedMs', () => {
  it('advances by delta scaled by speed', () => {
    expect(advanceElapsedMs(0, 100, 2, 1000)).toEqual({ elapsedMs: 200, finished: false });
  });

  it('clamps at the end and reports finished', () => {
    expect(advanceElapsedMs(950, 100, 1, 1000)).toEqual({ elapsedMs: 1000, finished: true });
  });

  it('ignores a negative delta rather than moving backwards', () => {
    expect(advanceElapsedMs(500, -100, 1, 1000)).toEqual({ elapsedMs: 500, finished: false });
  });

  it('never reports finished for a zero-duration cycle', () => {
    expect(advanceElapsedMs(0, 100, 1, 0)).toEqual({ elapsedMs: 0, finished: false });
  });
});

describe('activeStageAt', () => {
  const stages = [
    stage({ stage: 'cursorRead', startMs: 0, durMs: 10 }),
    stage({ stage: 'seal', startMs: 10, durMs: 3200 }),
    stage({ stage: 'write', startMs: 3210, durMs: null }),
  ];

  it('finds the closed stage containing the instant', () => {
    expect(activeStageAt(stages, 20)?.stage).toBe('seal');
  });

  it('treats an open stage as active from its start onward', () => {
    expect(activeStageAt(stages, 5000)?.stage).toBe('write');
  });

  it('returns null before any stage has started', () => {
    expect(activeStageAt([stage({ startMs: 100, durMs: 50 })], 0)).toBeNull();
  });

  it('returns null exactly at a closed stage end (half-open interval)', () => {
    expect(activeStageAt([stage({ startMs: 0, durMs: 100 })], 100)).toBeNull();
  });
});

describe('orderedStageNames', () => {
  it('orders stage names by first occurrence, deduplicated', () => {
    const stages = [
      stage({ stage: 'seal', startMs: 10 }),
      stage({ stage: 'cursorRead', startMs: 0 }),
      stage({ stage: 'seal', startMs: 3300 }),
      stage({ stage: 'write', startMs: 3210 }),
    ];
    expect(orderedStageNames(stages)).toEqual(['cursorRead', 'seal', 'write']);
  });

  it('is empty for no stages', () => {
    expect(orderedStageNames([])).toEqual([]);
  });
});
