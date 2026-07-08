import { describe, expect, it } from 'vitest';
import {
  buildAverageSummaryRow,
  buildRunAnalysis,
  filterRunAnalysisByRange,
  makeLoadedRunWithId,
  makeLoadedSummary,
  percentDelta,
  selectPipelineSnapshotForShard,
  selectStableShardId,
  STAGE_DEFINITIONS,
  UNACCOUNTED_STAGE,
  upsertLoadedRun,
} from './derive';
import { SYNTHETIC_ARTIFACTS } from './sample';
import type { BenchmarkIteration } from './types';

function attachPipeline(iteration: BenchmarkIteration, overrides: Partial<NonNullable<BenchmarkIteration['pipeline']>> = {}) {
  iteration.pipeline = {
    snapshotAtUtc: iteration.completedAtUtc,
    shardId: iteration.shardId,
    windowStartUtc: iteration.windowStartUtc,
    windowEndUtc: iteration.windowEndUtc,
    currentTimeUtc: iteration.completedAtUtc,
    watermarkUtc: iteration.windowEndUtc,
    candidateWatermarkUtc: null,
    checkpointAdvancedToUtc: iteration.windowEndUtc,
    totalShardMessages: iteration.counts.rowsFetched,
    currentWindowMessages: iteration.counts.rowsFetched,
    backlogMessages: iteration.counts.backlogMessages,
    blockedMessages: iteration.counts.blockedMessages,
    statusCounts: {
      pending: 0,
      done: iteration.counts.messagesProcessed,
      skipped: Math.max(0, iteration.counts.rowsFetched - iteration.counts.messagesProcessed),
      duplicateAcknowledged: 0,
      poisoned: 0,
    },
    messages: [],
    events: [],
    ...overrides,
  };
}

describe('buildRunAnalysis', () => {
  it('creates stage segments and chart series from a benchmark artifact', () => {
    const analysis = buildRunAnalysis(SYNTHETIC_ARTIFACTS[0], 'sample.json');

    expect(analysis.timelineSegments).toHaveLength(SYNTHETIC_ARTIFACTS[0].iterations.length * STAGE_DEFINITIONS.length);
    expect(analysis.throughputPoints[0].value).toBeGreaterThan(0);
    expect(analysis.checkpointPoints.some((point) => point.upper !== null && point.advancedTo !== null && point.upper > point.advancedTo)).toBe(true);
    expect(analysis.memoryPoints.length).toBeGreaterThan(SYNTHETIC_ARTIFACTS[0].iterations.length);
    expect(analysis.timelineSegments[0].startAtMs).toBeGreaterThan(Date.parse('2025-01-01T00:00:00Z'));
  });

  it('adds an unaccounted residual lane when total exceeds named stages', () => {
    const artifact = structuredClone(SYNTHETIC_ARTIFACTS[0]);
    artifact.iterations[0].timingsMs.total += 1000;
    const analysis = buildRunAnalysis(artifact, 'sample.json');

    expect(analysis.timelineSegments.some((segment) => segment.stageKey === UNACCOUNTED_STAGE.key)).toBe(true);
  });

  it('filters chart points and clips stage segments to the selected time range', () => {
    const analysis = buildRunAnalysis(SYNTHETIC_ARTIFACTS[0], 'sample.json');
    const filtered = filterRunAnalysisByRange(analysis, 'last-5m');

    expect(filtered.timelineEndAtMs).toBe(analysis.latestObservedAtMs);
    expect(filtered.timelineStartAtMs).toBeGreaterThanOrEqual(analysis.latestObservedAtMs - 5 * 60 * 1000);
    expect(filtered.throughputPoints.length).toBeLessThan(analysis.throughputPoints.length);
    expect(filtered.timelineSegments.every((segment) => segment.startAtMs >= filtered.timelineStartAtMs && segment.endAtMs <= filtered.timelineEndAtMs)).toBe(true);
  });

  it('derives aggregate fallback snapshots for old artifacts without message cells', () => {
    const analysis = buildRunAnalysis(SYNTHETIC_ARTIFACTS[0], 'old.json');
    const snapshot = selectPipelineSnapshotForShard(analysis, 'shard-1');

    expect(analysis.pipelineSnapshots).toHaveLength(SYNTHETIC_ARTIFACTS[0].iterations.length);
    expect(snapshot?.source).toBe('aggregate');
    expect(snapshot?.messages).toHaveLength(0);
    expect(snapshot?.rawCheckpointAdvancedTo).toBe(SYNTHETIC_ARTIFACTS[0].iterations[8].checkpoint.advancedTo);
    expect(analysis.shardOptions.map((option) => option.shardId)).toEqual(['shard-1', 'shard-2', 'shard-3', 'shard-4']);
  });

  it('keeps shard selection stable and prefers the latest incomplete pipeline window when needed', () => {
    const artifact = structuredClone(SYNTHETIC_ARTIFACTS[0]);
    attachPipeline(artifact.iterations[0]);
    attachPipeline(artifact.iterations[4], {
      snapshotAtUtc: '2026-01-15T17:04:30.000Z',
      currentTimeUtc: '2026-01-15T17:04:30.000Z',
      watermarkUtc: null,
      checkpointAdvancedToUtc: null,
      backlogMessages: 4,
      blockedMessages: 1,
      statusCounts: {
        pending: 3,
        done: 1,
        skipped: 0,
        duplicateAcknowledged: 0,
        poisoned: 0,
      },
      messages: [
        {
          ordinal: 1,
          rowId: 'row-1',
          sessionId: 'session-1',
          enqueuedTimeUtc: '2026-01-15T16:54:00.000Z',
          status: 'pending',
        },
      ],
      events: [{ atUtc: '2026-01-15T17:04:29.000Z', kind: 'blocked', label: 'Checkpoint blocked', messageCount: 3 }],
    });

    const analysis = buildRunAnalysis(artifact, 'pipeline.json');
    const selected = selectPipelineSnapshotForShard(analysis, 'shard-1');

    expect(selectStableShardId(analysis.shardOptions, 'shard-2')).toBe('shard-2');
    expect(selectStableShardId(analysis.shardOptions, 'missing-shard')).toBe('shard-1');
    expect(selected?.iterationId).toBe(artifact.iterations[4].iterationId);
    expect(selected?.source).toBe('pipeline');
    expect(selected?.messages[0].status).toBe('pending');
  });

  it('retains pipeline snapshots when chart data is filtered by time range', () => {
    const artifact = structuredClone(SYNTHETIC_ARTIFACTS[0]);
    attachPipeline(artifact.iterations[0], { checkpointAdvancedToUtc: null, statusCounts: { pending: 1, done: 0, skipped: 0, duplicateAcknowledged: 0, poisoned: 0 } });

    const analysis = buildRunAnalysis(artifact, 'pipeline.json');
    const filtered = filterRunAnalysisByRange(analysis, 'last-5m');

    expect(filtered.pipelineSnapshots).toHaveLength(analysis.pipelineSnapshots.length);
    expect(selectPipelineSnapshotForShard(filtered, 'shard-1')?.source).toBe('pipeline');
  });
});

describe('buildAverageSummaryRow', () => {
  it('averages comparable summary metrics across runs', () => {
    const rows = SYNTHETIC_ARTIFACTS.map((artifact, index) => buildRunAnalysis(artifact, `sample-${index}.json`));
    const average = buildAverageSummaryRow(rows);

    expect(average?.label).toBe('Average baseline (2 runs)');
    expect(average?.throughputEventsPerSecond).toBeGreaterThan(0);
    expect(average?.maxBacklogMessages).toBe(Math.max(...rows.map((row) => row.summaryRow.maxBacklogMessages)));
  });

  describe('makeLoadedSummary', () => {
    it('creates comparison rows from generated summary artifacts', () => {
      const loaded = makeLoadedSummary(
        {
          schemaVersion: 1,
          label: 'baseline-1-client-1-of-500',
          generatedAtUtc: '2026-01-15T17:30:00.000Z',
          runCount: 2,
          runs: [],
          averages: SYNTHETIC_ARTIFACTS[0].summary,
        },
        'kusto-benchmark-summary.json',
        1,
      );

      expect(loaded.summaryRow.source).toBe('summary');
      expect(loaded.summaryRow.label).toContain('2 runs average');
      expect(loaded.summaryRow.throughputEventsPerSecond).toBe(SYNTHETIC_ARTIFACTS[0].summary.throughputEventsPerSecond);
    });
  });

  it('returns null deltas when the baseline is zero', () => {
    expect(percentDelta(10, 0)).toBeNull();
  });

  it('upserts live runs without appending duplicates', () => {
    const first = makeLoadedRunWithId(SYNTHETIC_ARTIFACTS[0], 'kusto-benchmark-run.json', 'live:kusto-benchmark-run.json');
    const second = makeLoadedRunWithId(SYNTHETIC_ARTIFACTS[1], 'kusto-benchmark-run.json', 'live:kusto-benchmark-run.json');

    const runs = upsertLoadedRun(upsertLoadedRun([], first), second);

    expect(runs).toHaveLength(1);
    expect(runs[0].artifact.run.runId).toBe(SYNTHETIC_ARTIFACTS[1].run.runId);
  });
});
