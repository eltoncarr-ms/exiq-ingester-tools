import { describe, expect, it } from 'vitest';
import type { PollCycleAnalysis, PollStageTimelineEntry } from '../../poll/derive';
import {
  DEFAULT_PLAYBACK_FREQUENCY,
  PLAYBACK_FREQUENCIES,
  STAGE_LANES,
  frameIntervalMs,
  nextCycleIndex,
  orderCyclesChronologically,
  replayDurationMs,
  resolveLaneFrames,
  stageDisplayName,
  stageEndMs,
  stageMetricDescription,
} from './timeline';

const stage = (overrides: Partial<PollStageTimelineEntry> = {}): PollStageTimelineEntry => ({
  stage: 'seal',
  startMs: 0,
  durMs: 100,
  completed: true,
  ...overrides,
});

const cycle = (overrides: Partial<PollCycleAnalysis> = {}): PollCycleAnalysis => ({
  runId: 'run-1',
  source: 'portal',
  outcome: 'success',
  startedAtMs: 0,
  completedAtMs: 5000,
  totalMs: 5000,
  records: 100,
  recordsPerSec: 20,
  stages: [],
  ...overrides,
});

describe('static timeline helpers', () => {
  it('calculates stage ends and cycle duration', () => {
    expect(stageEndMs(stage({ startMs: 10, durMs: 40 }))).toBe(50);
    expect(replayDurationMs(cycle({ totalMs: null, stages: [stage({ startMs: 10, durMs: 40 })] }))).toBe(50);
  });

  it('describes what each poll stage measures', () => {
    expect(stageMetricDescription('cursorRead')).toContain('cached watermark');
    expect(stageMetricDescription('kusto')).toContain('Kusto query');
    expect(stageMetricDescription('map')).toContain('maps them into message batches');
    expect(stageMetricDescription('seal')).toContain('input-row counting');
    expect(stageMetricDescription('write')).toContain('reads existing Cosmos snapshots');
    expect(stageMetricDescription('advance')).toContain('blob storage');
  });

  it('provides dashboard labels for each poll stage', () => {
    expect(stageDisplayName('cursorRead')).toBe('Blob Read Watermark');
    expect(stageDisplayName('kusto')).toBe('Get Kusto Messages');
    expect(stageDisplayName('map')).toBe('Map Messages');
    expect(stageDisplayName('seal')).toBe('Seal Messages');
    expect(stageDisplayName('write')).toBe('Flush to Cosmos');
    expect(stageDisplayName('advance')).toBe('Advance Cursor');
  });
});

describe('STAGE_LANES', () => {
  it('is the fixed canonical lane order', () => {
    expect(STAGE_LANES).toEqual(['cursorRead', 'kusto', 'map', 'seal', 'write', 'advance']);
  });
});

describe('resolveLaneFrames', () => {
  it('resolves six lane frames and expands the seal stage into Kusto, mapping, and remaining seal work', () => {
    const frames = resolveLaneFrames(
      cycle({
        kustoMs: 100,
        mapMs: 30,
        stages: [
          stage({ stage: 'write', startMs: 200, durMs: 50 }),
          stage({ stage: 'cursorRead', startMs: 0, durMs: 20 }),
          stage({ stage: 'seal', startMs: 20, durMs: 150 }),
          stage({ stage: 'advance', startMs: 250, durMs: 10 }),
        ],
      }),
    );

    expect(frames).toHaveLength(6);
    expect(frames.map((frame) => frame.stage)).toEqual(['cursorRead', 'kusto', 'map', 'seal', 'write', 'advance']);
    expect(frames.every((frame) => frame.recorded)).toBe(true);
    expect(frames.find((frame) => frame.stage === 'kusto')).toEqual({
      stage: 'kusto',
      recorded: true,
      open: false,
      startMs: 20,
      durMs: 100,
    });
    expect(frames.find((frame) => frame.stage === 'map')).toEqual({
      stage: 'map',
      recorded: true,
      open: false,
      startMs: 120,
      durMs: 30,
    });
    expect(frames.find((frame) => frame.stage === 'seal')).toEqual({
      stage: 'seal',
      recorded: true,
      open: false,
      startMs: 150,
      durMs: 20,
    });
  });

  it('renders a zero-duration marker lane for any stage the cycle never recorded', () => {
    const frames = resolveLaneFrames(cycle({ stages: [stage({ stage: 'seal', startMs: 10, durMs: 40 })] }));

    expect(frames).toHaveLength(6);
    expect(frames.find((frame) => frame.stage === 'cursorRead')).toEqual({
      stage: 'cursorRead',
      recorded: false,
      open: false,
      startMs: 0,
      durMs: 0,
    });
    expect(frames.find((frame) => frame.stage === 'write')).toEqual({
      stage: 'write',
      recorded: false,
      open: false,
      startMs: 0,
      durMs: 0,
    });
    expect(frames.find((frame) => frame.stage === 'advance')).toEqual({
      stage: 'advance',
      recorded: false,
      open: false,
      startMs: 0,
      durMs: 0,
    });
    expect(frames.find((frame) => frame.stage === 'seal')).toEqual({
      stage: 'seal',
      recorded: true,
      open: false,
      startMs: 10,
      durMs: 40,
    });
  });

  it('marks a still-open stage (no end event yet) with a zero-duration fallback', () => {
    const frames = resolveLaneFrames(cycle({ stages: [stage({ stage: 'write', startMs: 100, durMs: null, completed: false })] }));

    expect(frames.find((frame) => frame.stage === 'write')).toEqual({
      stage: 'write',
      recorded: true,
      open: true,
      startMs: 100,
      durMs: 0,
    });
  });

  it('renders all six empty lanes for a cycle with no stage data at all', () => {
    const frames = resolveLaneFrames(cycle({ stages: [] }));

    expect(frames).toHaveLength(6);
    expect(frames.every((frame) => !frame.recorded && frame.durMs === 0)).toBe(true);
  });
});

describe('orderCyclesChronologically', () => {
  it('orders cycles oldest first regardless of input order', () => {
    const ordered = orderCyclesChronologically([
      cycle({ runId: 'run-3', startedAtMs: 3000 }),
      cycle({ runId: 'run-1', startedAtMs: 1000 }),
      cycle({ runId: 'run-2', startedAtMs: 2000 }),
    ]);

    expect(ordered.map((candidate) => candidate.runId)).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('does not mutate the input array', () => {
    const input = [cycle({ runId: 'run-2', startedAtMs: 2000 }), cycle({ runId: 'run-1', startedAtMs: 1000 })];
    const ordered = orderCyclesChronologically(input);

    expect(input.map((candidate) => candidate.runId)).toEqual(['run-2', 'run-1']);
    expect(ordered.map((candidate) => candidate.runId)).toEqual(['run-1', 'run-2']);
  });

  it('returns an empty array for an empty list', () => {
    expect(orderCyclesChronologically([])).toEqual([]);
  });
});

describe('playback frequencies', () => {
  it('exposes exactly 10/sec and 20/sec, defaulting to 10/sec', () => {
    expect(PLAYBACK_FREQUENCIES).toEqual([10, 20]);
    expect(DEFAULT_PLAYBACK_FREQUENCY).toBe(10);
  });
});

describe('frameIntervalMs', () => {
  it('derives the frame interval from cycles/frames per second', () => {
    expect(frameIntervalMs(10)).toBe(100);
    expect(frameIntervalMs(20)).toBe(50);
  });
});

describe('nextCycleIndex', () => {
  it('advances by one frame by default', () => {
    expect(nextCycleIndex(0, 5)).toBe(1);
    expect(nextCycleIndex(3, 5)).toBe(4);
  });

  it('wraps from the newest cycle back to the oldest', () => {
    expect(nextCycleIndex(4, 5)).toBe(0);
  });

  it('advances by multiple skipped frames at once', () => {
    expect(nextCycleIndex(0, 5, 3)).toBe(3);
    expect(nextCycleIndex(3, 5, 4)).toBe(2);
  });

  it('always resolves to zero for an empty list', () => {
    expect(nextCycleIndex(0, 0)).toBe(0);
    expect(nextCycleIndex(2, 0, 5)).toBe(0);
  });

  it('always resolves to zero for a single-cycle list', () => {
    expect(nextCycleIndex(0, 1)).toBe(0);
    expect(nextCycleIndex(0, 1, 7)).toBe(0);
  });
});
