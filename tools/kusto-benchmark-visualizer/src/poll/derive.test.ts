import { describe, expect, it } from 'vitest';
import { buildPollAnalysis, computeDescriptiveStats } from './derive';
import { parsePollJsonlText } from './parse';
import { cycleEventLine, SAMPLE_FAILED_CYCLE_LINE, SAMPLE_POLL_JSONL, SAMPLE_SKIPPED_CYCLE_LINE, stageEventLine } from './sample';

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
    expect(portal.metrics.latestCursorLagSec).toBeCloseTo(31.4);
    expect(portal.metrics.totalWriteInteractionsRu).toBeCloseTo(615.2);
  });

  it('omits every optional metric when no cycle for a source defines the underlying fact', () => {
    const analysis = analyzeLines([SAMPLE_SKIPPED_CYCLE_LINE]);
    const source = analysis.sources[0];

    expect(source.metrics.cycleCount).toBe(1);
    expect(source.metrics.totalRecords).toBe(0);
    expect(source.metrics.totalInputRows).toBeUndefined();
    expect(source.metrics.checkpointCount).toBe(0);
    expect(source.metrics.totalUsers).toBeUndefined();
    expect(source.metrics.avgSuccessfulRecordsPerSec).toBeUndefined();
    expect(source.metrics.latestCursorLagSec).toBeUndefined();
    expect(source.metrics.totalWriteInteractionsRu).toBeUndefined();
    expect(source.durationStats.kustoMs).toBeUndefined();
    expect(source.durationStats.mapMs).toBeUndefined();
    expect(source.durationStats.writeMs).toBeUndefined();
    expect(source.durationStats.advanceMs).toBeUndefined();
  });

  it('restricts throughput and records trend points to successful cycles only', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // run-success-1's default fixture is inputRows: 6000, totalMs: 5000, so
    // raw msg/sec is 6000 / (5000 / 1000) = 1200 — not the producer's
    // recordsPerSec (240), which is finalized-event throughput, not raw
    // message throughput. See the dedicated distinguishing test below.
    expect(portal.throughputPoints).toHaveLength(1);
    expect(portal.throughputPoints[0]).toEqual({ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 1200 });
    expect(portal.recordsPoints).toHaveLength(1);
    expect(portal.recordsPoints[0]).toEqual({ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 1200 });
  });

  it('derives throughputPoints from inputRows/totalMs, not the producer recordsPerSec field, distinguishing raw message throughput from finalized-event throughput', () => {
    const analysis = analyzeLines([
      cycleEventLine({ inputRows: 9000, totalMs: 3000, records: 1500, recordsPerSec: 240 }),
    ]);
    const portal = findSource(analysis, 'portal-firehose');

    // Raw msg/sec = 9000 / (3000 / 1000) = 3000, deliberately far from both
    // the producer's recordsPerSec (240) and records/cycle (1500), proving
    // the first chart is not just relabeled recordsPerSec.
    expect(portal.throughputPoints).toEqual([{ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 3000 }]);
    expect(portal.recordsPoints).toEqual([{ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 1500 }]);
  });

  it('excludes a successful cycle missing a finite inputRows fact from throughputPoints, but still includes it in recordsPoints', () => {
    const analysis = analyzeLines([cycleEventLine({ inputRows: undefined })]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.throughputPoints).toEqual([]);
    expect(portal.recordsPoints).toEqual([{ atMs: Date.parse('2026-02-01T00:00:05.000Z'), value: 1200 }]);
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
        inputRows: 1000,
        totalMs: 5000,
      }),
      cycleEventLine({
        runId: 'run-earlier',
        startedAtUtc: '2026-04-01T00:00:00.000Z',
        completedAtUtc: '2026-04-01T00:00:05.000Z',
        records: 300,
        recordsPerSec: 60,
        inputRows: 600,
        totalMs: 5000,
      }),
      stageEventLine({ runId: 'run-unresolved-later', ts: '2026-04-01T00:20:00.000Z', atMs: 0, ev: 'start' }),
      stageEventLine({ runId: 'run-unresolved-earlier', ts: '2026-04-01T00:01:00.000Z', atMs: 0, ev: 'start' }),
    ]);

    const portal = findSource(analysis, 'portal-firehose');
    expect(portal.cycles.map((cycle) => cycle.runId)).toEqual(['run-earlier', 'run-later']);
    // Raw msg/sec (inputRows / (totalMs / 1000)): 600/5=120, 1000/5=200 —
    // deliberately different from the producer recordsPerSec (60, 100) to
    // keep this test honest about what throughputPoints actually derives from.
    expect(portal.throughputPoints.map((point) => point.value)).toEqual([120, 200]);
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

describe('buildPollAnalysis weighted throughput dials', () => {
  it('sums the first four weighted dials over successful cycles with a valid inputRows fact, excluding skipped/failed cycles', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // Only run-success-1 qualifies (success outcome + defined inputRows):
    // run-skipped-1 has no inputRows fact, and run-failed-1 is excluded by
    // outcome despite carrying the same default inputRows/kustoMs/mapMs as
    // the successful cycle — if it were wrongly included, every sum below
    // would double.
    expect(portal.throughputMetrics.kustoReadThroughputRowsPerSec).toBeCloseTo(6000 / (3200 / 1000));
    expect(portal.throughputMetrics.processingThroughputRowsPerSec).toBeCloseTo(6000 / (5000 / 1000));
    expect(portal.throughputMetrics.eventThroughputEventsPerSec).toBeCloseTo(1200 / (5000 / 1000));
    expect(portal.throughputMetrics.compressionRateRowsPerEvent).toBeCloseTo(6000 / 1200);
  });

  it('computes checkpoint velocity from source-seconds-advanced on successful cycles over wall time across every completed cycle', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // Only run-success-1 advances the checkpoint window (5 minutes = 300s);
    // run-failed-1 carries the same window facts but is gated to 0 by its
    // outcome, and run-skipped-1 has no window facts at all. All three
    // cycles' totalMs (5000 + 4 + 3305 = 8309ms) count toward wall time.
    expect(portal.throughputMetrics.checkpointAdvanceSeconds).toBeCloseTo(300);
    expect(portal.throughputMetrics.checkpointVelocitySourcePerWall).toBeCloseTo(300 / (8309 / 1000));
  });

  it('excludes skipped and failed cycles from iterationThroughputMetrics entirely, leaving only the qualifying successful cycle with correct per-cycle values', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // run-skipped-1 (no inputRows fact) and run-failed-1 (wrong outcome,
    // despite carrying the same default inputRows/kustoMs/mapMs/window facts
    // as the successful cycle) must be absent rather than contributing a
    // zero-valued entry that would otherwise skew the gauge grid's
    // range/p95 inputs.
    expect(portal.iterationThroughputMetrics.map((entry) => entry.iterationId)).toEqual(['run-success-1']);

    const successIteration = portal.iterationThroughputMetrics[0];
    expect(successIteration.kustoReadThroughputRowsPerSec).toBeCloseTo(6000 / (3200 / 1000));
    expect(successIteration.processingThroughputRowsPerSec).toBeCloseTo(6000 / (5000 / 1000));
    expect(successIteration.eventThroughputEventsPerSec).toBeCloseTo(1200 / (5000 / 1000));
    expect(successIteration.compressionRateRowsPerEvent).toBeCloseTo(6000 / 1200);
    expect(successIteration.checkpointVelocitySourcePerWall).toBeCloseTo(300 / (5000 / 1000));
  });

  it('treats a missing inputRows fact as "not reported" rather than 0, excluding the cycle from the first four dials without rejecting the rest of the log', () => {
    const analysis = analyzeLines([
      cycleEventLine({ runId: 'run-no-input-rows', inputRows: undefined }),
    ]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.cycleCount).toBe(1);
    expect(portal.throughputMetrics.kustoReadThroughputRowsPerSec).toBe(0);
    expect(portal.throughputMetrics.processingThroughputRowsPerSec).toBe(0);
    expect(portal.throughputMetrics.eventThroughputEventsPerSec).toBe(0);
    expect(portal.throughputMetrics.compressionRateRowsPerEvent).toBeNull();
    // The window facts are still present and the cycle still succeeded, so
    // checkpoint velocity — which never depends on inputRows — is unaffected.
    expect(portal.throughputMetrics.checkpointAdvanceSeconds).toBeCloseTo(300);
  });

  it('reports the full source duration as the latest cycle completion minus the earliest cycle start', () => {
    const analysis = analyzeLines([
      cycleEventLine({
        runId: 'run-earlier',
        startedAtUtc: '2026-06-01T00:00:00.000Z',
        completedAtUtc: '2026-06-01T00:00:05.000Z',
      }),
      cycleEventLine({
        runId: 'run-later',
        startedAtUtc: '2026-06-01T00:10:00.000Z',
        completedAtUtc: '2026-06-01T00:10:05.000Z',
      }),
    ]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.durationMs).toBe(
      Date.parse('2026-06-01T00:10:05.000Z') - Date.parse('2026-06-01T00:00:00.000Z'),
    );
  });
});

describe('buildPollAnalysis totalInputRows vs totalRecords', () => {
  it('sums totalInputRows from the finite `inputRows` fact across every outcome, independently of totalRecords', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // run-success-1 (6000) and run-failed-1 (6000, kept default per
    // SAMPLE_FAILED_CYCLE_LINE) both report a finite inputRows fact;
    // run-skipped-1 omits it entirely and is excluded rather than zeroed.
    expect(portal.metrics.totalInputRows).toBe(12000);
    // totalRecords (Events Finalized) sums the unrelated producer `records`
    // field across every cycle instead, and is not derived from inputRows.
    expect(portal.metrics.totalRecords).toBe(1200);
  });

  it('omits totalInputRows when no cycle for a source reports a finite inputRows fact', () => {
    const analysis = analyzeLines([SAMPLE_SKIPPED_CYCLE_LINE]);
    const source = analysis.sources[0];

    expect(source.metrics.totalInputRows).toBeUndefined();
    expect(source.metrics.totalRecords).toBe(0);
  });
});

describe('buildPollAnalysis checkpointCount', () => {
  it('counts only successful cycles with a positive windowStartUtc-to-windowEndUtc advancement', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // Only run-success-1 both succeeded and reports a positive window
    // advance (5 minutes); run-skipped-1 has no window facts at all, and
    // run-failed-1 carries the identical window facts but is excluded
    // purely by its "failed" outcome.
    expect(portal.metrics.checkpointCount).toBe(1);
  });

  it('excludes skipped and failed cycles from the count regardless of any window facts they carry', () => {
    const analysis = analyzeLines([SAMPLE_SKIPPED_CYCLE_LINE, SAMPLE_FAILED_CYCLE_LINE]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.checkpointCount).toBe(0);
  });

  it('excludes a successful cycle missing either window fact from the count', () => {
    const analysis = analyzeLines([cycleEventLine({ runId: 'run-missing-window', windowStartUtc: undefined })]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.checkpointCount).toBe(0);
  });

  it('excludes a successful cycle whose window did not actually advance (zero-width window) from the count', () => {
    const analysis = analyzeLines([
      cycleEventLine({
        runId: 'run-zero-window',
        windowStartUtc: '2026-02-01T00:00:00.000Z',
        windowEndUtc: '2026-02-01T00:00:00.000Z',
      }),
    ]);
    const portal = findSource(analysis, 'portal-firehose');

    expect(portal.metrics.checkpointCount).toBe(0);
  });
});

describe('buildPollAnalysis per-stage duration stats', () => {
  it('computes guarded descriptive stats per stage, excluding cycles that omit the fact', () => {
    const analysis = analyzeLines([SAMPLE_POLL_JSONL]);
    const portal = findSource(analysis, 'portal-firehose');

    // writeMs/advanceMs are reported only by run-success-1 (skipped/failed
    // cycles omit them per sample.ts).
    expect(portal.durationStats.writeMs).toEqual({ avg: 1700, min: 1700, p50: 1700, p95: 1700, max: 1700, count: 1 });
    expect(portal.durationStats.advanceMs).toEqual({ avg: 90, min: 90, p50: 90, p95: 90, max: 90, count: 1 });
    // kustoMs/mapMs are reported by both run-success-1 and run-failed-1
    // (identical default value in sample.ts), so both contribute a sample.
    expect(portal.durationStats.kustoMs).toEqual({ avg: 3100, min: 3100, p50: 3100, p95: 3100, max: 3100, count: 2 });
    expect(portal.durationStats.mapMs).toEqual({ avg: 100, min: 100, p50: 100, p95: 100, max: 100, count: 2 });
  });

  it('omits every stage key when no cycle for a source reports it', () => {
    const analysis = analyzeLines([SAMPLE_SKIPPED_CYCLE_LINE]);
    const source = analysis.sources[0];

    expect(source.durationStats.kustoMs).toBeUndefined();
    expect(source.durationStats.mapMs).toBeUndefined();
    expect(source.durationStats.writeMs).toBeUndefined();
    expect(source.durationStats.advanceMs).toBeUndefined();
  });
});

describe('computeDescriptiveStats', () => {
  it('returns undefined for an empty input, never a NaN-shaped stats object', () => {
    expect(computeDescriptiveStats([])).toBeUndefined();
  });

  it('computes avg/min/p50 (standard median)/p95 (nearest-rank)/max/count for an odd sample count', () => {
    expect(computeDescriptiveStats([10, 30, 20, 50, 40])).toEqual({ avg: 30, min: 10, p50: 30, p95: 50, max: 50, count: 5 });
  });

  it('averages the two middle values for an even sample count (standard median)', () => {
    const stats = computeDescriptiveStats([10, 20, 30, 40]);

    expect(stats?.p50).toBe(25);
    expect(stats?.count).toBe(4);
  });

  it('excludes non-finite values (NaN, +/-Infinity) from every statistic rather than propagating them', () => {
    expect(computeDescriptiveStats([10, Number.NaN, 20, Number.POSITIVE_INFINITY, 30])).toEqual({
      avg: 20,
      min: 10,
      p50: 20,
      p95: 30,
      max: 30,
      count: 3,
    });
  });

  it('returns undefined when every value is non-finite', () => {
    expect(computeDescriptiveStats([Number.NaN, Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});
