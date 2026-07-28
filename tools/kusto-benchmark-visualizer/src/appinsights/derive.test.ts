import { describe, expect, it } from 'vitest';
import {
  computeBacklogStats,
  computeCosmosStats,
  computeFocusedKpis,
  computeFocusedThroughput,
  computeKustoStats,
  computeShardFleet,
  computeSummary,
  computeThroughputStats,
  describeDistribution,
} from './derive';
import { normalizeRows } from './normalize';
import {
  bandCommitRow,
  bulkWriteModeRow,
  cancelledRow,
  continuedBandFirstPageRow,
  continuedBandResumedRow,
  leaseContentionRow,
  missingOptionalFieldsRow,
  observedZeroRow,
  shardValidationFailureRow,
  shardedLaneRow,
  singletonLaneRow,
} from './sample';





describe('computeSummary', () => {
  it('counts outcomes correctly', () => {
    const rows = normalizeRows([
      singletonLaneRow({ Outcome: 'success' }),
      singletonLaneRow({ RunId: 'r2', Outcome: 'failed' }),
      singletonLaneRow({ RunId: 'r3', Outcome: 'skipped' }),
      singletonLaneRow({ RunId: 'r4', Outcome: 'cancelled' }),
      shardValidationFailureRow(),
    ]);
    const stats = computeSummary(rows, 100);
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.validationFailureSweeps).toBe(1);
    expect(stats.laneAttempts).toBe(4);
  });

  it('computes fleet throughput as sum(records)/wallClockSeconds — not avg(recordsPerSec)', () => {
    // Two lanes with very different sizes: naive averaging would give wrong result.
    // Lane A: 1000 records, lane B: 100 records.
    // Sum = 1100; wall clock = 10s → correct throughput = 110/s
    // Naive avg of recordsPerSec (100 and 1000): would give 550/s — WRONG
    const rows = normalizeRows([
      singletonLaneRow({ RunId: 'lane-a', Records: 1000, RecordsPerSec: 100 }),
      singletonLaneRow({ RunId: 'lane-b', Records: 100, RecordsPerSec: 1000 }),
    ]);
    const stats = computeSummary(rows, 10);
    expect(stats.totalRecords).toBe(1100);
    expect(stats.fleetThroughputPerSec).toBeCloseTo(110, 1);
    // Verify this differs from naive avg(recordsPerSec) = (100+1000)/2 = 550
    expect(stats.fleetThroughputPerSec).not.toBeCloseTo(550, 0);
  });

  it('uses rawScanRows directly with no rowsReturned fallback', () => {
    const rows = normalizeRows([
      shardedLaneRow({ RawScanRows: 1200, RowsScanned: 0, RowsReturned: 9999 }),
      shardedLaneRow({ RunId: 'r2', RawScanRows: null, RowsScanned: 0, RowsReturned: 800 }),
    ]);

    const stats = computeSummary(rows, 10);
    expect(stats.totalInputRows).toBe(1200);
  });

  it('returns null throughput when wallClockSeconds is 0', () => {
    const rows = normalizeRows([singletonLaneRow({ Records: 500 })]);
    const stats = computeSummary(rows, 0);
    expect(stats.fleetThroughputPerSec).toBeNull();
  });

  it('returns null throughput when no records are observed', () => {
    const rows = normalizeRows([singletonLaneRow({ Records: null })]);
    const stats = computeSummary(rows, 60);
    expect(stats.fleetThroughputPerSec).toBeNull();
  });

  it('sums partialTotalRu only when non-null', () => {
    const rows = normalizeRows([
      bulkWriteModeRow({ TotalCosmosRu: 1000 }),
      bulkWriteModeRow({ RunId: 'r2', TotalCosmosRu: 500 }),
      singletonLaneRow({ RunId: 'r3', TotalCosmosRu: null, InteractionWriteRu: null, InteractionWriteRuComplete: undefined }),
    ]);
    const stats = computeSummary(rows, 10);
    expect(stats.partialTotalRu).toBe(1500);
    expect(stats.ruObservedCycleCount).toBe(2);
  });

  it('dedupes rawBandRows by bandId for interval aggregates', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow(),
      continuedBandResumedRow(),
      bandCommitRow(),
    ]);
    const stats = computeSummary(rows, 60);
    expect(stats.totalInputRows).toBe(3050);
    expect(stats.totalRawBandRows).toBe(2330);
  });

  it('sums interactionWriteRu separately from partial Cosmos RU', () => {
    const rows = normalizeRows([
      singletonLaneRow({ InteractionWriteRu: 3000, TotalCosmosRu: null }),
      bulkWriteModeRow({ RunId: 'r2', InteractionWriteRu: 4200, TotalCosmosRu: 4200 }),
      cancelledRow({ RunId: 'r3', InteractionWriteRu: 580, TotalCosmosRu: 580 }),
    ]);
    const stats = computeSummary(rows, 30);
    expect(stats.totalInteractionWriteRu).toBe(7780);
    expect(stats.partialTotalRu).toBe(4780);
  });

  it('counts finalized records only on successful rows', () => {
    const rows = normalizeRows([
      singletonLaneRow({ Records: 100 }),
      cancelledRow({ RunId: 'r2', Records: 999 }),
      shardedLaneRow({ RunId: 'r3', Outcome: 'failed', Records: 500 }),
    ]);
    const stats = computeSummary(rows, 30);
    expect(stats.totalRecords).toBe(100);
  });

  it('tracks max cursor lag and progress-kind counts', () => {
    const rows = normalizeRows([
      bandCommitRow({ CursorLagAfterSeconds: 12, ProgressKind: 'bandCommit' }),
      continuedBandFirstPageRow({ CursorLagAfterSeconds: 20, ProgressKind: 'continuation' }),
      observedZeroRow({ CursorLagAfterSeconds: 0, ProgressKind: 'noWork' }),
      cancelledRow({ RunId: 'r4', ProgressKind: undefined }),
    ]);
    const stats = computeSummary(rows, 60);
    expect(stats.maxCursorLagAfterSeconds).toBe(20);
    expect(stats.progressKindCounts).toEqual({
      bandCommit: 1,
      continuation: 1,
      noWork: 1,
      unknown: 1,
    });
  });

  it('counts continuation saves and band commits as durable checkpoints', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow({ ProgressKind: 'continuation', Outcome: 'success' }),
      continuedBandResumedRow({ ProgressKind: 'continuation', Outcome: 'success' }),
      bandCommitRow({ ProgressKind: 'bandCommit', Outcome: 'success' }),
      cancelledRow({ RunId: 'r4', ProgressKind: 'continuation' }),
    ]);

    expect(computeSummary(rows, 60).checkpointCount).toBe(3);
  });

  it('uses max-not-sum for backlog (fleet worst case, not aggregate)', () => {
    const rows = normalizeRows([
      shardedLaneRow({ ShardId: '0', BacklogAfterSeconds: 300 }),
      shardedLaneRow({ RunId: 'r2', ShardId: '1', BacklogAfterSeconds: 900 }),
      shardedLaneRow({ RunId: 'r3', ShardId: '2', BacklogAfterSeconds: 150 }),
    ]);
    const stats = computeSummary(rows, 60);
    expect(stats.maxBacklogAfterSeconds).toBe(900);
    expect(stats.minBacklogAfterSeconds).toBe(150);
    // Sum would be 1350 — must NOT be 1350
    expect(stats.maxBacklogAfterSeconds).not.toBe(1350);
  });
});

describe('computeThroughputStats', () => {
  it('computes all five gauges from drain-safe cycle facts', () => {
    const rows = normalizeRows([
      shardedLaneRow({
        RawScanRows: 2000,
        RowsScanned: 2000,
        Records: 1000,
        KustoMs: 3000,
        MapMs: 1000,
        TotalMs: 10000,
        CommittedProgressSeconds: 0,
        CheckpointProgressSeconds: 20,
      }),
      shardedLaneRow({
        RunId: 'run-sharded-2',
        RawScanRows: 1000,
        RowsScanned: 1000,
        Records: 500,
        KustoMs: 1500,
        MapMs: 500,
        TotalMs: 5000,
        CommittedProgressSeconds: 0,
        CheckpointProgressSeconds: 5,
      }),
    ]);

    const stats = computeThroughputStats(rows);

    expect(stats.metrics.kustoReadThroughputRowsPerSec).toBeCloseTo(500, 1);
    expect(stats.metrics.processingThroughputRowsPerSec).toBeCloseTo(200, 1);
    expect(stats.metrics.eventThroughputEventsPerSec).toBeCloseTo(100, 1);
    expect(stats.metrics.compressionRateRowsPerEvent).toBeCloseTo(2, 1);
    expect(stats.metrics.checkpointVelocitySourcePerWall).toBeCloseTo(25 / 15, 2);
    expect(stats.iterationMetrics).toHaveLength(2);
  });

  it('uses rawScanRows for gauges even when rowsReturned contradicts rowsScanned', () => {
    const rows = normalizeRows([
      shardedLaneRow({
        RawScanRows: 2000,
        RowsScanned: 0,
        RowsReturned: 9999,
        Records: 1000,
        KustoMs: 3000,
        MapMs: 1000,
        TotalMs: 10000,
      }),
    ]);

    const stats = computeThroughputStats(rows);

    expect(stats.metrics.kustoReadThroughputRowsPerSec).toBe(500);
    expect(stats.metrics.processingThroughputRowsPerSec).toBe(200);
    expect(stats.metrics.compressionRateRowsPerEvent).toBe(2);
  });

  it('keeps throughput unknown when rawScanRows is absent', () => {
    const rows = normalizeRows([
      singletonLaneRow({
        RawScanRows: null,
        RowsScanned: null,
        MapMs: null,
        Records: 1000,
        RowsReturned: 1250,
        TotalMs: 10000,
        CommittedProgressSeconds: 20,
      }),
    ]);

    const stats = computeThroughputStats(rows);

    expect(stats.metrics.kustoReadThroughputRowsPerSec).toBeNull();
    expect(stats.metrics.processingThroughputRowsPerSec).toBeNull();
    expect(stats.metrics.compressionRateRowsPerEvent).toBeNull();
    expect(stats.metrics.eventThroughputEventsPerSec).toBe(100);
    expect(stats.metrics.checkpointVelocitySourcePerWall).toBe(2);
  });

  it('uses all lane wall time for checkpoint velocity and zero progress for failures', () => {
    const rows = normalizeRows([
      shardedLaneRow({ TotalMs: 5000, CommittedProgressSeconds: 10 }),
      shardedLaneRow({
        RunId: 'failed-run',
        Outcome: 'failed',
        TotalMs: 5000,
        CommittedProgressSeconds: 100,
      }),
    ]);

    const stats = computeThroughputStats(rows);

    expect(stats.metrics.checkpointAdvanceSeconds).toBe(10);
    expect(stats.metrics.checkpointVelocitySourcePerWall).toBe(1);
  });
});

// ── computeShardFleet ──────────────────────────────────────────────────────

describe('computeShardFleet', () => {
  it('groups singleton and sharded separately', () => {
    const rows = normalizeRows([
      singletonLaneRow(),
      shardedLaneRow({ ShardId: '0', ShardCount: 2 }),
      shardedLaneRow({ RunId: 'r2', ShardId: '1', ShardCount: 2 }),
    ]);
    const fleet = computeShardFleet(rows);
    expect(fleet.length).toBe(3);
    const singleton = fleet.find((e) => e.shardCount === null);
    expect(singleton?.shardId).toBe('');
    const shard0 = fleet.find((e) => e.shardId === '0' && e.shardCount === 2);
    expect(shard0).toBeDefined();
  });

  it('excludes shardSetValidationFailedSweep rows', () => {
    const rows = normalizeRows([singletonLaneRow(), shardValidationFailureRow()]);
    const fleet = computeShardFleet(rows);
    expect(fleet.length).toBe(1);
    expect(fleet[0]!.shardId).toBe('');
  });

  it('records lease loss and contention flags', () => {
    const rows = normalizeRows([
      singletonLaneRow({ LeaseLost: true }),
      leaseContentionRow(),
    ]);
    const fleet = computeShardFleet(rows);
    const entry = fleet.find((e) => e.shardId === '');
    expect(entry?.hadLeaseLoss).toBe(true);
    expect(entry?.hadContention).toBe(true);
  });

  it('tracks latest cursor lag, last progress kind, and success-only finalized records', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow({ ShardId: '0', Records: 600, CursorLagAfterSeconds: 20, ProgressKind: 'continuation' }),
      continuedBandResumedRow({ ShardId: '0', Records: 420, CursorLagAfterSeconds: 24, ProgressKind: 'continuation' }),
      cancelledRow({ ShardId: '0', ShardCount: 3, HashVersion: 2, Records: 999, CursorLagAfterSeconds: null }),
    ]);
    const fleet = computeShardFleet(rows);
    const shard0 = fleet.find((e) => e.shardId === '0' && e.shardCount === 3);
    expect(shard0?.latestCursorLagAfterSeconds).toBe(24);
    expect(shard0?.lastProgressKind).toBe('');
    expect(shard0?.totalRecords).toBe(1020);
  });
});

// ── computeBacklogStats ────────────────────────────────────────────────────

describe('computeBacklogStats', () => {
  it('uses max backlog after — never sums across shards', () => {
    const rows = normalizeRows([
      shardedLaneRow({ ShardId: '0', BacklogAfterSeconds: 200, BacklogBeforeSeconds: 1000, TotalMs: 10000 }),
      shardedLaneRow({ RunId: 'r2', ShardId: '1', BacklogAfterSeconds: 500, BacklogBeforeSeconds: 800, TotalMs: 8000 }),
    ]);
    const stats = computeBacklogStats(rows);
    expect(stats.maxBacklogAfterSeconds).toBe(500);
    expect(stats.minBacklogAfterSeconds).toBe(200);
    // Must not be 700 (the sum)
    expect(stats.maxBacklogAfterSeconds).not.toBe(700);
  });

  it('counts hasMore, bandDrained, resumedPending flags', () => {
    const rows = normalizeRows([
      singletonLaneRow({ HasMore: true, BandDrained: false, ResumedPending: true }),
      singletonLaneRow({ RunId: 'r2', HasMore: false, BandDrained: true, ResumedPending: false }),
    ]);
    const stats = computeBacklogStats(rows);
    expect(stats.hasMoreCount).toBe(1);
    expect(stats.bandDrainedCount).toBe(1);
    expect(stats.resumedPendingCount).toBe(1);
  });

  it('computes guarded drain estimate from worst-backlog lane', () => {
    // Lane A: backlogBefore=1000s, backlogAfter=500s, totalMs=5000ms (5s)
    // drainRate = (1000-500)/5 = 100 s/s; guardedDrain = 500/100 = 5s
    const rows = normalizeRows([
      singletonLaneRow({ BacklogBeforeSeconds: 1000, BacklogAfterSeconds: 500, TotalMs: 5000 }),
    ]);
    const stats = computeBacklogStats(rows);
    expect(stats.slowestDrainRateSecondsPerSec).toBeCloseTo(100, 1);
    expect(stats.guardedDrainEstimateSeconds).toBeCloseTo(5, 1);
  });

  it('returns null drain estimate when no drain data', () => {
    const rows = normalizeRows([missingOptionalFieldsRow()]);
    const stats = computeBacklogStats(rows);
    expect(stats.guardedDrainEstimateSeconds).toBeNull();
  });
});

// ── computeKustoStats ──────────────────────────────────────────────────────

describe('computeKustoStats', () => {
  it('separates legacy and drain-safe rows — never blends modes', () => {
    const rows = normalizeRows([
      singletonLaneRow({ ExecutionMode: 'legacy', KustoMs: 8000 }),
      shardedLaneRow({ ExecutionMode: 'drainSafe', KustoMs: 6000 }),
    ]);
    const stats = computeKustoStats(rows);
    expect(stats.hasLegacyRows).toBe(true);
    expect(stats.byMode.length).toBe(2);
    const legacy = stats.byMode.find((m) => m.mode === 'legacy');
    const drainSafe = stats.byMode.find((m) => m.mode === 'drainSafe');
    expect(legacy?.avgKustoMs).toBe(8000);
    expect(drainSafe?.avgKustoMs).toBe(6000);
  });

  it('returns null avgMapMs for legacy mode rows (unavailable, not zero)', () => {
    const rows = normalizeRows([singletonLaneRow({ ExecutionMode: 'legacy', MapMs: null })]);
    const stats = computeKustoStats(rows);
    const legacy = stats.byMode.find((m) => m.mode === 'legacy');
    // mapMs is null on legacy rows — avgMapMs should be null, not 0
    expect(legacy?.avgMapMs).toBeNull();
  });

  it('returns null avgRowsScanned for legacy rows (unavailable, not zero)', () => {
    const rows = normalizeRows([singletonLaneRow({ ExecutionMode: 'legacy', RowsScanned: null })]);
    const stats = computeKustoStats(rows);
    const legacy = stats.byMode.find((m) => m.mode === 'legacy');
    expect(legacy?.avgRowsScanned).toBeNull();
  });

  it('drain-safe has non-null avgMapMs and avgRowsScanned', () => {
    const rows = normalizeRows([shardedLaneRow({ ExecutionMode: 'drainSafe', MapMs: 500, RowsScanned: 1300 })]);
    const stats = computeKustoStats(rows);
    const drainSafe = stats.byMode.find((m) => m.mode === 'drainSafe');
    expect(drainSafe?.avgMapMs).toBe(500);
    expect(drainSafe?.avgRowsScanned).toBe(1300);
  });

  it('counts throttled cycles', () => {
    const rows = normalizeRows([
      singletonLaneRow({ KustoThrottleRetryCount: 3 }),
      singletonLaneRow({ RunId: 'r2', KustoThrottleRetryCount: 0 }),
      singletonLaneRow({ RunId: 'r3', KustoThrottleRetryCount: null }),
    ]);
    const stats = computeKustoStats(rows);
    expect(stats.throttledCycleCount).toBe(1);
  });
});

// ── computeCosmosStats ─────────────────────────────────────────────────────

describe('computeCosmosStats', () => {
  it('sums partition-batch outcomes', () => {
    const rows = normalizeRows([
      singletonLaneRow({ CosmosAttempted: 10, CosmosSucceeded: 8, CosmosFailed: 1, CosmosCancelled: 1 }),
      singletonLaneRow({ RunId: 'r2', CosmosAttempted: 5, CosmosSucceeded: 5, CosmosFailed: 0, CosmosCancelled: 0 }),
    ]);
    const stats = computeCosmosStats(rows);
    expect(stats.totalCosmosAttempted).toBe(15);
    expect(stats.totalCosmosSucceeded).toBe(13);
    expect(stats.totalCosmosFailed).toBe(1);
    expect(stats.totalCosmosCancelled).toBe(1);
  });

  it('sums bulk success RU separately from partial total RU', () => {
    const rows = normalizeRows([
      bulkWriteModeRow({ WriteInteractionsSuccessRu: 2000, TotalCosmosRu: 2000 }),
      bulkWriteModeRow({ RunId: 'r2', WriteInteractionsSuccessRu: 1500, TotalCosmosRu: 1500 }),
    ]);
    const stats = computeCosmosStats(rows);
    expect(stats.bulkSuccessRuSum).toBe(3500);
    expect(stats.partialTotalRuSum).toBe(3500);
  });

  it('computes partialRuPerRecord (partial completeness)', () => {
    const rows = normalizeRows([
      bulkWriteModeRow({ Records: 1000, TotalCosmosRu: 5000 }),
    ]);
    const stats = computeCosmosStats(rows);
    expect(stats.partialRuPerRecord).toBeCloseTo(5, 1);
  });

  it('sdkFailedServiceRequestCount is summed not labeled as retries (verify field identity)', () => {
    const rows = normalizeRows([
      singletonLaneRow({ SdkFailedServiceRequestCount: 3 }),
    ]);
    const stats = computeCosmosStats(rows);
    // The stat is present and correctly named — test verifies it is not zero-coerced
    expect(stats.sdkFailedServiceRequestTotal).toBe(3);
  });

  it('terminal429OperationCount is summed not labeled as total 429s (verify field identity)', () => {
    const rows = normalizeRows([
      singletonLaneRow({ Terminal429OperationCount: 2 }),
    ]);
    const stats = computeCosmosStats(rows);
    expect(stats.terminal429Total).toBe(2);
  });

  it('RU completeness — null partialTotalRuSum when no RU fields present', () => {
    const rows = normalizeRows([singletonLaneRow({ TotalCosmosRu: null })]);
    const stats = computeCosmosStats(rows);
    expect(stats.partialTotalRuSum).toBeNull();
    expect(stats.partialRuPerRecord).toBeNull();
  });

  it('excludes validation-failure rows from Cosmos stats', () => {
    const rows = normalizeRows([shardValidationFailureRow()]);
    const stats = computeCosmosStats(rows);
    expect(stats.totalCosmosAttempted).toBeNull();
    expect(stats.affectedCycleCount).toBe(0);
  });

  it('uses observedZeroRow to verify 0 is counted, not treated as absent', () => {
    const rows = normalizeRows([observedZeroRow()]);
    const stats = computeCosmosStats(rows);
    expect(stats.totalCosmosAttempted).toBe(0);
    expect(stats.totalCosmosSucceeded).toBe(0);
  });

  it('cancelled rows contribute to partition-batch totals', () => {
    const rows = normalizeRows([cancelledRow()]);
    const stats = computeCosmosStats(rows);
    expect(stats.totalCosmosFailed).toBe(10);
    expect(stats.totalCosmosCancelled).toBe(35);
    expect(stats.totalCosmosSucceeded).toBe(5);
  });

  it('counts transactional interactionWriteRu-only rows as affected cycles', () => {
    const rows = normalizeRows([
      singletonLaneRow({ TotalCosmosRu: null, WriteInteractionsSuccessRu: null, InteractionWriteRu: 3100 }),
    ]);
    const stats = computeCosmosStats(rows);
    expect(stats.affectedCycleCount).toBe(1);
  });
});

    // ── describeDistribution ───────────────────────────────────────────────────

    describe('describeDistribution', () => {
      it('empty array → count 0, all stats null', () => {
        const d = describeDistribution([]);
        expect(d.count).toBe(0);
        expect(d.mean).toBeNull();
        expect(d.stdDev).toBeNull();
        expect(d.median).toBeNull();
        expect(d.p95).toBeNull();
        expect(d.min).toBeNull();
        expect(d.max).toBeNull();
      });

      it('single value [42] → count 1, all stats 42, stdDev 0', () => {
        const d = describeDistribution([42]);
        expect(d.count).toBe(1);
        expect(d.mean).toBe(42);
        expect(d.stdDev).toBe(0);
        expect(d.median).toBe(42);
        expect(d.p95).toBe(42);
        expect(d.min).toBe(42);
        expect(d.max).toBe(42);
      });

      it('[null, null, 10, null] → only 10 is finite → same as single-value 10', () => {
        const d = describeDistribution([null, null, 10, null]);
        expect(d.count).toBe(1);
        expect(d.mean).toBe(10);
        expect(d.stdDev).toBe(0);
        expect(d.median).toBe(10);
        expect(d.p95).toBe(10);
        expect(d.min).toBe(10);
        expect(d.max).toBe(10);
      });

      it('even n [1,2,3,4] → mean 2.5, median 2.5, p95 4, min 1, max 4', () => {
        const d = describeDistribution([1, 2, 3, 4]);
        expect(d.count).toBe(4);
        expect(d.mean).toBe(2.5);
        expect(d.median).toBe(2.5);
        // p95: ceil(0.95*4)-1 = ceil(3.8)-1 = 4-1 = 3 → finite[3] = 4
        expect(d.p95).toBe(4);
        expect(d.min).toBe(1);
        expect(d.max).toBe(4);
      });

      it('population stdDev: [2,4,4,4,5,5,7,9] → mean 5, stdDev 2', () => {
        const d = describeDistribution([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(d.mean).toBe(5);
        expect(d.stdDev).toBeCloseTo(2, 10);
      });

      it('null and NaN values are filtered out (NaN is not finite)', () => {
        const d = describeDistribution([null, NaN, 3, null, NaN, 7]);
        expect(d.count).toBe(2);
        expect(d.min).toBe(3);
        expect(d.max).toBe(7);
      });

      it('p95 with n=20 → idx = ceil(0.95*20)-1 = 18, i.e. the 19th element', () => {
        const values = Array.from({ length: 20 }, (_, i) => i + 1); // [1..20]
        const d = describeDistribution(values);
        // p95Idx = ceil(0.95*20)-1 = ceil(19)-1 = 19-1 = 18 → value at index 18 = 19
        expect(d.p95).toBe(19);
      });

      it('n=1: stdDev === 0, not NaN', () => {
        const d = describeDistribution([100]);
        expect(d.stdDev).toBe(0);
        expect(Number.isNaN(d.stdDev)).toBe(false);
      });
    });

// ── computeFocusedThroughput ───────────────────────────────────────────────

describe('computeFocusedThroughput', () => {
  it('excludes non-laneAttempt rows', () => {
    const rows = normalizeRows([
      shardedLaneRow({ RawScanRows: 1000, KustoMs: 2000, MapMs: 500, TotalMs: 8000, Records: 400 }),
      shardValidationFailureRow(),
    ]);
    const stats = computeFocusedThroughput(rows);
    expect(stats.iterationMetrics).toHaveLength(1);
  });

  it('metrics are mean of per-cycle values, not ratio-of-sums', () => {
    // Cycle A: rawScanRows=1000, kustoMs+mapMs=2000ms → 500 rows/sec
    // Cycle B: rawScanRows=3000, kustoMs+mapMs=1000ms → 3000 rows/sec
    // Mean = (500 + 3000) / 2 = 1750
    // Ratio-of-sums = 4000 / 3000ms = 1333.3 — WRONG
    const rows = normalizeRows([
      shardedLaneRow({ RawScanRows: 1000, KustoMs: 1500, MapMs: 500, TotalMs: 5000, Records: 500 }),
      shardedLaneRow({ RunId: 'r2', EventTimeUtc: '2026-06-01T12:01:00.0000000Z', RawScanRows: 3000, KustoMs: 800, MapMs: 200, TotalMs: 6000, Records: 600 }),
    ]);
    const stats = computeFocusedThroughput(rows);
    expect(stats.metrics.kustoReadThroughputRowsPerSec).toBeCloseTo(1750, 0);
    // ratio-of-sums would be 4000/3s ≈ 1333
    expect(stats.metrics.kustoReadThroughputRowsPerSec).not.toBeCloseTo(1333, 0);
  });

  it('produces unique iterationId including runId, eventTimeUtc, and index', () => {
    const rows = normalizeRows([
      shardedLaneRow({ RawScanRows: 500, KustoMs: 1000, MapMs: 200, TotalMs: 4000, Records: 200 }),
      shardedLaneRow({ RunId: 'run-sharded-1', EventTimeUtc: '2026-06-01T12:02:00.0000000Z', RawScanRows: 600, KustoMs: 1000, MapMs: 200, TotalMs: 4000, Records: 300 }),
    ]);
    const stats = computeFocusedThroughput(rows);
    const ids = stats.iterationMetrics.map((m) => m.iterationId);
    // All IDs must be unique
    expect(new Set(ids).size).toBe(ids.length);
    // Format: runId|eventTimeUtc|index
    expect(ids[0]).toContain('|');
    expect(ids[0]!.split('|')).toHaveLength(3);
    expect(ids[0]!.endsWith('|0')).toBe(true);
    expect(ids[1]!.endsWith('|1')).toBe(true);
  });

  it('null guard: null rawScanRows yields null kustoReadThroughputRowsPerSec, not 0', () => {
    const rows = normalizeRows([
      shardedLaneRow({ RawScanRows: null, KustoMs: 2000, MapMs: 500, TotalMs: 8000, Records: 400 }),
    ]);
    const stats = computeFocusedThroughput(rows);
    expect(stats.iterationMetrics[0]!.kustoReadThroughputRowsPerSec).toBeNull();
    expect(stats.metrics.kustoReadThroughputRowsPerSec).toBeNull();
  });

  it('null guard: null writeMs yields null cosmosWriteThroughputBatchesPerSec, not 0', () => {
    const rows = normalizeRows([
      shardedLaneRow({ CosmosSucceeded: 100, WriteMs: null }),
    ]);
    const stats = computeFocusedThroughput(rows);
    expect(stats.iterationMetrics[0]!.cosmosWriteThroughputBatchesPerSec).toBeNull();
  });

  it('checkpointVelocitySourcePerWall fallback chain: checkpointProgressSeconds ?? committedProgressSeconds ?? 0', () => {
    // When checkpointProgressSeconds is null, falls back to committedProgressSeconds
    const rows1 = normalizeRows([
      shardedLaneRow({
        TotalMs: 10000,
        CheckpointProgressSeconds: null,
        CommittedProgressSeconds: 30,
        RawScanRows: 500, KustoMs: 1000, MapMs: 200, Records: 200,
      }),
    ]);
    const s1 = computeFocusedThroughput(rows1);
    expect(s1.iterationMetrics[0]!.checkpointVelocitySourcePerWall).toBeCloseTo(3, 5); // 30/10

    // When both null, defaults to 0 → velocity = 0
    const rows2 = normalizeRows([
      shardedLaneRow({
        TotalMs: 10000,
        CheckpointProgressSeconds: null,
        CommittedProgressSeconds: null,
        RawScanRows: 500, KustoMs: 1000, MapMs: 200, Records: 200,
      }),
    ]);
    const s2 = computeFocusedThroughput(rows2);
    expect(s2.iterationMetrics[0]!.checkpointVelocitySourcePerWall).toBe(0);

    // checkpointProgressSeconds takes precedence over committedProgressSeconds
    const rows3 = normalizeRows([
      shardedLaneRow({
        TotalMs: 10000,
        CheckpointProgressSeconds: 50,
        CommittedProgressSeconds: 10,
        RawScanRows: 500, KustoMs: 1000, MapMs: 200, Records: 200,
      }),
    ]);
    const s3 = computeFocusedThroughput(rows3);
    expect(s3.iterationMetrics[0]!.checkpointVelocitySourcePerWall).toBeCloseTo(5, 5); // 50/10
  });

  it('checkpointAdvanceSeconds sums across iterations (not mean)', () => {
    const rows = normalizeRows([
      shardedLaneRow({ TotalMs: 5000, CheckpointProgressSeconds: 20 }),
      shardedLaneRow({ RunId: 'r2', EventTimeUtc: '2026-06-01T12:01:00.0000000Z', TotalMs: 5000, CheckpointProgressSeconds: 15 }),
    ]);
    const stats = computeFocusedThroughput(rows);
    expect(stats.metrics.checkpointAdvanceSeconds).toBe(35);
  });
});

// ── computeFocusedKpis ────────────────────────────────────────────────────

describe('computeFocusedKpis', () => {
  it('level split: continuation → intraBand, bandCommit → band, others excluded from level splits', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow({ ProgressKind: 'continuation', KustoMs: 1000 }),
      bandCommitRow({ ProgressKind: 'bandCommit', KustoMs: 2000 }),
      observedZeroRow({ ProgressKind: 'noWork', KustoMs: 500 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    const intraBandEntry = kpis.kustoLatency.find((e) => e.level === 'intraBand');
    const bandEntry = kpis.kustoLatency.find((e) => e.level === 'band');
    expect(intraBandEntry).toBeDefined();
    expect(bandEntry).toBeDefined();
    // noWork rows are excluded from level splits (not intraBand or band)
    expect(intraBandEntry!.distribution.count).toBe(1);
    expect(bandEntry!.distribution.count).toBe(1);
  });

  it('kustoLatency only emits entries where count >= 1 (skips empty combos)', () => {
    // Only drainSafe continuation rows — no legacy or band rows
    const rows = normalizeRows([
      shardedLaneRow({ ExecutionMode: 'drainSafe', ProgressKind: 'continuation', KustoMs: 3000 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    // Should only have intraBand/drainSafe — all other combos are empty
    expect(kpis.kustoLatency).toHaveLength(1);
    expect(kpis.kustoLatency[0]!.level).toBe('intraBand');
    expect(kpis.kustoLatency[0]!.mode).toBe('drainSafe');
  });

  it('mode segregation: rows of different modes produce separate KustoLatencyEntry items', () => {
    const rows = normalizeRows([
      shardedLaneRow({ ExecutionMode: 'drainSafe', ProgressKind: 'continuation', KustoMs: 4000 }),
      singletonLaneRow({ ExecutionMode: 'legacy', ProgressKind: 'continuation', KustoMs: 7000 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    const drainSafe = kpis.kustoLatency.find((e) => e.mode === 'drainSafe');
    const legacy = kpis.kustoLatency.find((e) => e.mode === 'legacy');
    expect(drainSafe).toBeDefined();
    expect(legacy).toBeDefined();
    expect(drainSafe!.distribution.mean).toBe(4000);
    expect(legacy!.distribution.mean).toBe(7000);
    // Modes are never merged: no single entry with count=2
    for (const entry of kpis.kustoLatency) {
      expect(entry.distribution.count).toBe(1);
    }
  });

  it('checkpointVelocity and iterationSpeed use all success laneAttempt rows regardless of progressKind', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow({ CheckpointProgressSeconds: 10, TotalMs: 5000 }),
      bandCommitRow({ CheckpointProgressSeconds: 20, TotalMs: 8000 }),
      observedZeroRow({ CheckpointProgressSeconds: 0, TotalMs: 2000 }),
      // non-success row should be excluded
      cancelledRow({ RunId: 'r-cancelled', CheckpointProgressSeconds: 999, TotalMs: 9999 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    // 3 success rows: checkpointProgressSeconds 10, 20, 0
    expect(kpis.checkpointVelocity.count).toBe(3);
    // totalMs 5000, 8000, 2000
    expect(kpis.iterationSpeed.count).toBe(3);
  });

  it('cosmosLatencyByLevel uses writeMs per level', () => {
    const rows = normalizeRows([
      continuedBandFirstPageRow({ ProgressKind: 'continuation', WriteMs: 300 }),
      bandCommitRow({ ProgressKind: 'bandCommit', WriteMs: 600 }),
      bandCommitRow({ RunId: 'r2', EventTimeUtc: '2026-06-01T12:06:00.0000000Z', ProgressKind: 'bandCommit', WriteMs: 800 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    expect(kpis.cosmosLatencyByLevel.intraBand.count).toBe(1);
    expect(kpis.cosmosLatencyByLevel.intraBand.mean).toBe(300);
    expect(kpis.cosmosLatencyByLevel.band.count).toBe(2);
    expect(kpis.cosmosLatencyByLevel.band.mean).toBe(700);
  });

  it('kustoLatency label format matches spec', () => {
    const rows = normalizeRows([
      shardedLaneRow({ ExecutionMode: 'drainSafe', ProgressKind: 'continuation', KustoMs: 1000 }),
      shardedLaneRow({ RunId: 'r2', EventTimeUtc: '2026-06-01T12:01:00.0000000Z', ExecutionMode: 'legacy', ProgressKind: 'bandCommit', KustoMs: 1500 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    const intraBandDrain = kpis.kustoLatency.find((e) => e.level === 'intraBand' && e.mode === 'drainSafe');
    const bandLegacy = kpis.kustoLatency.find((e) => e.level === 'band' && e.mode === 'legacy');
    expect(intraBandDrain!.label).toBe('Intra-band (drainSafe)');
    expect(bandLegacy!.label).toBe('Band (legacy)');
  });

  it('ordering: drainSafe before legacy before unknown; intraBand before band', () => {
    const rows = normalizeRows([
      singletonLaneRow({ ExecutionMode: 'unknown', ProgressKind: 'continuation', KustoMs: 100 }),
      singletonLaneRow({ RunId: 'r2', EventTimeUtc: '2026-06-01T12:01:00.0000000Z', ExecutionMode: 'legacy', ProgressKind: 'continuation', KustoMs: 200 }),
      shardedLaneRow({ ExecutionMode: 'drainSafe', ProgressKind: 'continuation', KustoMs: 300 }),
      shardedLaneRow({ RunId: 'r4', EventTimeUtc: '2026-06-01T12:02:00.0000000Z', ExecutionMode: 'drainSafe', ProgressKind: 'bandCommit', KustoMs: 400 }),
    ]);
    const kpis = computeFocusedKpis(rows);
    const levels = kpis.kustoLatency.map((e) => e.level);
    const modes = kpis.kustoLatency.map((e) => e.mode);
    // intraBand entries come before band
    const firstBandIdx = levels.indexOf('band');
    const lastIntraBandIdx = levels.lastIndexOf('intraBand');
    expect(lastIntraBandIdx).toBeLessThan(firstBandIdx);
    // Within same level: drainSafe before legacy before unknown
    const intraBandModes = kpis.kustoLatency.filter((e) => e.level === 'intraBand').map((e) => e.mode);
    const drainSafeIdx = intraBandModes.indexOf('drainSafe');
    const legacyIdx = intraBandModes.indexOf('legacy');
    const unknownIdx = intraBandModes.indexOf('unknown');
    expect(drainSafeIdx).toBeLessThan(legacyIdx);
    expect(legacyIdx).toBeLessThan(unknownIdx);
    void modes; // used for ordering check only
  });
});
