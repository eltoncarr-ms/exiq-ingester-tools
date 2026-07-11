import { describe, expect, it } from 'vitest';
import { buildPollAnalysis } from './derive';
import { parsePollJsonlText } from './parse';
import { cycleEventLine, SAMPLE_POLL_JSONL, SAMPLE_SKIPPED_CYCLE_LINE, stageEventLine } from './sample';

function analyzeLines(lines: string[]) {
  return buildPollAnalysis(parsePollJsonlText(lines.join('\n')).events);
}

function findSource(analysis: ReturnType<typeof buildPollAnalysis>, source: string) {
  const found = analysis.sources.find((entry) => entry.source === source);
  if (!found) throw new Error(`expected a "${source}" source in the analysis`);

  return found;
}

describe('buildPollAnalysis', () => {
  it('groups completed cycles by source from an interleaved mixed stream', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);

    expect(analysis.sources.map((entry) => entry.source).sort()).toEqual(['audit-firehose', 'portal-firehose']);
    expect(findSource(analysis, 'portal-firehose').cycles.map((cycle) => cycle.runId).sort()).toEqual([
      'run-failed-1',
      'run-skipped-1',
      'run-success-1',
    ]);
    expect(findSource(analysis, 'audit-firehose').cycles.map((cycle) => cycle.runId)).toEqual(['run-success-2']);
  });

  it('computes guarded outcome counts and total records/users per source', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.cycleCount).toBe(3);
    expect(portal.metrics.outcomeCounts).toEqual({ success: 1, skipped: 1, failed: 1 });
    expect(portal.metrics.totalRecords).toBe(1200);
    // Only the successful cycle defines `users`; skipped/failed omit it, so
    // the total reflects only the defined contributions, never a zero fallback.
    expect(portal.metrics.totalUsers).toBe(42);
  });

  it('restricts averaged/latest optional metrics to cycles that define the underlying fact', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.avgSuccessfulRecordsPerSec).toBe(240);
    expect(portal.metrics.avgCycleMs).toBeCloseTo((5000 + 4 + 3305) / 3);
    expect(portal.metrics.avgKustoMs).toBe(3100);
    expect(portal.metrics.avgWriteMs).toBe(1700);
    expect(portal.metrics.avgAdvanceMs).toBe(90);
    expect(portal.metrics.latestCursorLagSec).toBeCloseTo(31.4);
    expect(portal.metrics.totalWriteInteractionsRu).toBeCloseTo(615.2);
  });

  it('omits every optional metric when no cycle for a source defines the underlying fact', () => {
    const analysis = analyzeLines([SAMPLE_SKIPPED_CYCLE_LINE]);
    const source = analysis.sources[0];

    expect(source.metrics.cycleCount).toBe(1);
    expect(source.metrics.totalRecords).toBe(0);
    expect(source.metrics.totalUsers).toBeUndefined();
    expect(source.metrics.avgSuccessfulRecordsPerSec).toBeUndefined();
    expect(source.metrics.avgKustoMs).toBeUndefined();
    expect(source.metrics.avgMapMs).toBeUndefined();
    expect(source.metrics.avgWriteMs).toBeUndefined();
    expect(source.metrics.avgAdvanceMs).toBeUndefined();
    expect(source.metrics.latestCursorLagSec).toBeUndefined();
    expect(source.metrics.totalWriteInteractionsRu).toBeUndefined();
  });

  it('restricts throughput and records trend points to successful cycles only', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.throughputPoints).toHaveLength(1);
    expect(portal.throughputPoints[0]).toEqual({ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 240 });
    expect(portal.recordsPoints).toHaveLength(1);
    expect(portal.recordsPoints[0]).toEqual({ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 1200 });
  });

  it('joins a resolved cycle stage timeline from the final cycle.timeline, marking every stage completed', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const cycle = findSource(analysis, 'portal-firehose').cycles.find((entry) => entry.runId === 'run-success-1');

    expect(cycle?.stages).toEqual([
      { stage: 'cursorRead', startMs: 0, durMs: 10, completed: true },
      { stage: 'seal', startMs: 10, durMs: 3200, completed: true },
      { stage: 'write', startMs: 3210, durMs: 1700, completed: true },
      { stage: 'advance', startMs: 4910, durMs: 90, completed: true },
    ]);
    expect(cycle?.outcome).toBe('success');
    expect(cycle?.error).toBeUndefined();
  });

  it('carries failingStage and error for a resolved failed cycle without stage metrics leaking in', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const failed = findSource(analysis, 'portal-firehose').cycles.find((entry) => entry.runId === 'run-failed-1');

    expect(failed?.outcome).toBe('failed');
    expect(failed?.failingStage).toBe('seal');
    expect(failed?.error).toBe('KustoServiceException');
    expect(failed?.records).toBe(0);
  });

  it('reports a cycle with only stage events as unresolved and in-progress, with no source assigned', () => {
    const analysis = analyzeLines([
      stageEventLine({ runId: 'run-in-progress-1', stage: 'cursorRead', ev: 'start', ts: '2026-03-01T00:00:00.000Z', atMs: 0 }),
      stageEventLine({ runId: 'run-in-progress-1', stage: 'cursorRead', ev: 'end', ts: '2026-03-01T00:00:00.010Z', atMs: 10, durMs: 10 }),
      stageEventLine({ runId: 'run-in-progress-1', stage: 'seal', ev: 'start', ts: '2026-03-01T00:00:00.010Z', atMs: 10 }),
    ]);

    expect(analysis.sources).toHaveLength(0);
    expect(analysis.unresolvedCycles).toHaveLength(1);
    const [cycle] = analysis.unresolvedCycles;

    expect(cycle.runId).toBe('run-in-progress-1');
    expect(cycle.source).toBeNull();
    expect(cycle.outcome).toBe('in-progress');
    expect(cycle.completedAtMs).toBeNull();
    expect(cycle.totalMs).toBeNull();
    expect(cycle.records).toBeNull();
    expect(cycle.recordsPerSec).toBeNull();
    expect(cycle.startedAtMs).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(cycle.stages).toEqual([
      { stage: 'cursorRead', startMs: 0, durMs: 10, completed: true },
      { stage: 'seal', startMs: 10, durMs: null, completed: false },
    ]);
  });

  it('sorts cycles, unresolved cycles, and trend points by wall-clock time', () => {
    const analysis = analyzeLines([
      cycleEventLine({
        runId: 'run-later',
        startedAtUtc: '2026-04-01T00:10:00.000Z',
        completedAtUtc: '2026-04-01T00:10:05.000Z',
        records: 500,
        recordsPerSec: 100,
      }),
      cycleEventLine({
        runId: 'run-earlier',
        startedAtUtc: '2026-04-01T00:00:00.000Z',
        completedAtUtc: '2026-04-01T00:00:05.000Z',
        records: 300,
        recordsPerSec: 60,
      }),
      stageEventLine({ runId: 'run-unresolved-later', ts: '2026-04-01T00:20:00.000Z', atMs: 0, ev: 'start' }),
      stageEventLine({ runId: 'run-unresolved-earlier', ts: '2026-04-01T00:01:00.000Z', atMs: 0, ev: 'start' }),
    ]);

    const portal = findSource(analysis, 'portal-firehose');
    expect(portal.cycles.map((cycle) => cycle.runId)).toEqual(['run-earlier', 'run-later']);
    expect(portal.throughputPoints.map((point) => point.value)).toEqual([60, 100]);
    expect(portal.recordsPoints.map((point) => point.value)).toEqual([300, 500]);
    expect(analysis.unresolvedCycles.map((cycle) => cycle.runId)).toEqual(['run-unresolved-earlier', 'run-unresolved-later']);
  });

  it('orders sources by each source\'s earliest cycle start time', () => {
    const analysis = analyzeLines([
      cycleEventLine({ startedAtUtc: '2026-05-01T01:00:00.000Z', completedAtUtc: '2026-05-01T01:00:05.000Z' }),
      cycleEventLine({
        runId: 'run-audit-earliest',
        source: 'audit-firehose',
        startedAtUtc: '2026-04-01T00:00:00.000Z',
        completedAtUtc: '2026-04-01T00:00:05.000Z',
      }),
    ]);

    expect(analysis.sources.map((entry) => entry.source)).toEqual(['audit-firehose', 'portal-firehose']);
  });
});
