import { describe, expect, it } from 'vitest';
import {
  computeBacklogStats,
  computeCosmosStats,
  computeKustoStats,
  computeShardFleet,
  computeSummary,
  computeThroughputStats,
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
        CommittedProgressSeconds: 20,
      }),
      shardedLaneRow({
        RunId: 'run-sharded-2',
        RawScanRows: 1000,
        RowsScanned: 1000,
        Records: 500,
        KustoMs: 1500,
        MapMs: 500,
        TotalMs: 5000,
        CommittedProgressSeconds: 5,
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
