/**
 * Pure derivation functions for the App Insights completed-cycle dashboard.
 *
 * Semantic rules enforced here (never in React components):
 *   - Fleet throughput = sum(records) / wallClockSeconds, NOT average of recordsPerSec.
 *   - Rows Processed reads rawScanRows directly. There is no rowsReturned/rowsScanned fallback.
 *   - Interval-level non-overlapping raw rows come from rawBandRows deduped by bandId.
 *   - Source-time backlog is never summed across shards: fleet health uses
 *     the maximum remaining backlog and the slowest effective drain rate.
 *   - legacy and drainSafe kustoMs have different timing boundaries and are
 *     never compared or blended as equivalent.
 *   - Legacy mapMs and rowsScanned placeholders remain null (unknown), not 0.
 *   - sdkFailedServiceRequestCount is NOT labeled "retries".
 *   - terminal429OperationCount is NOT labeled "total 429s".
 *   - cosmosAttempted/Succeeded/Failed/Cancelled are partition-batch outcomes.
 *   - interactionWriteRu is the complete primary write-RU metric for interaction
 *     writes across bulk + transactional modes; totalCosmosRu remains a partial
 *     diagnostic total because snapshot success RU is still unavailable.
 */

import type { CompletedCycleRow, ExecutionMode } from './types';
import type {
  ThroughputGaugeIterationMetrics,
  ThroughputGaugeMetrics,
} from '../components/RunThroughputGauges';

// ── Summary stats ──────────────────────────────────────────────────────────

export interface SummaryStats {
  /** Total count of laneAttempt rows. */
  laneAttempts: number;
  /** Count of rows with outcome = "success". */
  succeeded: number;
  /** Count of rows with outcome = "skipped". */
  skipped: number;
  /** Count of rows with outcome = "failed". */
  failed: number;
  /** Count of rows with outcome = "cancelled". */
  cancelled: number;
  /** Count of shardSetValidationFailedSweep rows. */
  validationFailureSweeps: number;
  /**
   * Sum of finalized records across successful rows where records is non-null.
   * Represents total work committed during the selected interval.
   */
  totalRecords: number;
  /**
   * Sum of rawScanRows across rows where observed.
   * This is the physical per-iteration raw scan fact and may double-count
   * resumed pages of the same band.
   */
  totalInputRows: number | null;
  /**
   * Non-overlapping raw rows deduped by bandId.
   * Even though the producer emits rawBandRows on at most one row per band,
   * the client still dedupes defensively by bandId to prevent double counting.
   */
  totalRawBandRows: number | null;
  /** Successful cycles that durably committed positive source-time progress. */
  checkpointCount: number;
  /** Average total cycle duration across lane attempts with an observed totalMs. */
  avgCycleMs: number | null;
  /**
   * Fleet wall-clock throughput: sum(records) / wallClockSeconds.
   * This is the correct fleet-level throughput — NOT the average of recordsPerSec.
   * null if wallClockSeconds is 0 or no records were observed.
   */
  fleetThroughputPerSec: number | null;
  /**
   * Sum of committedProgressSeconds across all rows where the fact is non-null.
   * Represents total source-time committed during the interval.
   */
  totalCommittedProgressSeconds: number | null;
  /**
   * Latest (most recent by eventTimeUtc) committed source-time progress.
   * null when no row has committedProgressSeconds.
   */
  latestCommittedProgressSeconds: number | null;
  /**
   * Maximum backlogAfterSeconds observed across all rows.
   * Never summed — backlog is per-shard and summing would be meaningless.
   * null when no row has backlogAfterSeconds.
   */
  maxBacklogAfterSeconds: number | null;
  /**
   * Minimum backlogAfterSeconds observed (the most-caught-up lane).
   * null when no row has backlogAfterSeconds.
   */
  minBacklogAfterSeconds: number | null;
  /** Maximum cursorLagAfterSeconds observed across all rows. */
  maxCursorLagAfterSeconds: number | null;
  /** Sum of complete interaction-write RU across rows where observed. */
  totalInteractionWriteRu: number | null;
  /** Counts of progressKind values across lane attempts. */
  progressKindCounts: {
    bandCommit: number;
    continuation: number;
    noWork: number;
    unknown: number;
  };
  /**
   * Count of rows with at least one non-null RU field.
   * Accompany with "partial observed RU" label (see RU completeness gap).
   */
  ruObservedCycleCount: number;
  /**
   * Sum of totalCosmosRu across rows where it is non-null.
   * PARTIAL: missing successful transactional and snapshot RU. Always label
   * as "partial observed" when displayed.
   */
  partialTotalRu: number | null;
}

/**
 * Compute fleet-level summary statistics.
 * @param rows Normalized rows to aggregate.
 * @param wallClockSeconds The selected wall-clock interval in seconds (for throughput denominator).
 */
export function computeSummary(rows: CompletedCycleRow[], wallClockSeconds: number): SummaryStats {
  let laneAttempts = 0, succeeded = 0, skipped = 0, failed = 0, cancelled = 0, validationFailureSweeps = 0;
  let totalRecords = 0;
  let totalInputRows: number | null = null;
  let totalRawBandRows: number | null = null;
  let checkpointCount = 0;
  let totalCycleMs = 0;
  let observedCycleDurations = 0;
  let totalCommittedProgress: number | null = null;
  let latestCommittedProgress: number | null = null;
  let latestEventMs = -Infinity;
  let maxBacklog: number | null = null;
  let minBacklog: number | null = null;
  let maxCursorLag: number | null = null;
  let totalInteractionWriteRu: number | null = null;
  let ruCount = 0;
  let partialRu: number | null = null;
  const seenBandIds = new Set<string>();
  const progressKindCounts = {
    bandCommit: 0,
    continuation: 0,
    noWork: 0,
    unknown: 0,
  };

  for (const row of rows) {
    if (row.rowKind === 'shardSetValidationFailedSweep') {
      validationFailureSweeps++;
      continue;
    }
    laneAttempts++;
    if (row.outcome === 'success') succeeded++;
    else if (row.outcome === 'skipped') skipped++;
    else if (row.outcome === 'failed') failed++;
    else if (row.outcome === 'cancelled') cancelled++;

    switch (row.progressKind) {
      case 'bandCommit':
        progressKindCounts.bandCommit++;
        break;
      case 'continuation':
        progressKindCounts.continuation++;
        break;
      case 'noWork':
        progressKindCounts.noWork++;
        break;
      default:
        progressKindCounts.unknown++;
        break;
    }

    if (row.outcome === 'success' && row.records !== null) totalRecords += row.records;
    const inputRows = effectiveInputRows(row);
    if (inputRows !== null) totalInputRows = (totalInputRows ?? 0) + inputRows;
    if (row.bandId !== '' && row.rawBandRows !== null && !seenBandIds.has(row.bandId)) {
      seenBandIds.add(row.bandId);
      totalRawBandRows = (totalRawBandRows ?? 0) + row.rawBandRows;
    }
    if (row.outcome === 'success' &&
      row.committedProgressSeconds !== null &&
      row.committedProgressSeconds > 0) {
      checkpointCount++;
    }
    if (row.totalMs !== null) {
      totalCycleMs += row.totalMs;
      observedCycleDurations++;
    }

    if (row.committedProgressSeconds !== null) {
      totalCommittedProgress = (totalCommittedProgress ?? 0) + row.committedProgressSeconds;
      const tMs = row.eventTimeUtc ? Date.parse(row.eventTimeUtc) : NaN;
      if (Number.isFinite(tMs) && tMs > latestEventMs) {
        latestEventMs = tMs;
        latestCommittedProgress = row.committedProgressSeconds;
      }
    }

    if (row.backlogAfterSeconds !== null) {
      maxBacklog = maxBacklog === null ? row.backlogAfterSeconds : Math.max(maxBacklog, row.backlogAfterSeconds);
      minBacklog = minBacklog === null ? row.backlogAfterSeconds : Math.min(minBacklog, row.backlogAfterSeconds);
    }
    if (row.cursorLagAfterSeconds !== null) {
      maxCursorLag = maxCursorLag === null ? row.cursorLagAfterSeconds : Math.max(maxCursorLag, row.cursorLagAfterSeconds);
    }
    if (row.interactionWriteRu !== null) {
      totalInteractionWriteRu = (totalInteractionWriteRu ?? 0) + row.interactionWriteRu;
    }

    const hasRu = row.totalCosmosRu !== null || row.writeInteractionsSuccessRu !== null ||
      row.writeInteractionsRu !== null || row.interactionWriteRu !== null ||
      row.getSnapshotRu !== null || row.upsertSnapshotRu !== null;
    if (hasRu) {
      ruCount++;
      if (row.totalCosmosRu !== null) {
        partialRu = (partialRu ?? 0) + row.totalCosmosRu;
      }
    }
  }

  const fleetThroughputPerSec =
    wallClockSeconds > 0 && totalRecords > 0
      ? totalRecords / wallClockSeconds
      : null;

  return {
    laneAttempts,
    succeeded,
    skipped,
    failed,
    cancelled,
    validationFailureSweeps,
    totalRecords,
    totalInputRows,
    totalRawBandRows,
    checkpointCount,
    avgCycleMs: observedCycleDurations > 0 ? totalCycleMs / observedCycleDurations : null,
    fleetThroughputPerSec,
    totalCommittedProgressSeconds: totalCommittedProgress,
    latestCommittedProgressSeconds: latestCommittedProgress,
    maxBacklogAfterSeconds: maxBacklog,
    minBacklogAfterSeconds: minBacklog,
    maxCursorLagAfterSeconds: maxCursorLag,
    totalInteractionWriteRu,
    progressKindCounts,
    ruObservedCycleCount: ruCount,
    partialTotalRu: partialRu,
  };
}

/**
 * Rows Processed is the producer's rawScanRows physical per-iteration fact.
 * Do not fall back to rowsReturned or rowsScanned.
 */
function effectiveInputRows(row: CompletedCycleRow): number | null {
  return row.rawScanRows;
}

export interface AppInsightsThroughputStats {
  metrics: ThroughputGaugeMetrics;
  iterationMetrics: ThroughputGaugeIterationMetrics[];
}

/**
 * Derive the shared throughput gauges from completed cycle facts.
 *
 * The first, second, and fourth gauges use rawScanRows directly with no
 * rowsReturned fallback. Rows without rawScanRows stay unknown rather than being
 * substituted with zero. Event throughput uses finalized records, and checkpoint
 * velocity uses durable committed source-time progress across every lane-attempt
 * wall-clock duration.
 */
export function computeThroughputStats(rows: CompletedCycleRow[]): AppInsightsThroughputStats {
  const laneRows = rows.filter((row) => row.rowKind === 'laneAttempt');

  let kustoRows = 0;
  let kustoMs = 0;
  let processingRows = 0;
  let processingMs = 0;
  let eventRecords = 0;
  let eventMs = 0;
  let compressionRows = 0;
  let compressionRecords = 0;
  let checkpointAdvanceSeconds = 0;
  let checkpointWallMs = 0;

  const iterationMetrics = laneRows.map((row) => {
    const successful = row.outcome === 'success';
    const totalMs = row.totalMs !== null && row.totalMs > 0 ? row.totalMs : null;
    const scanned = successful ? effectiveInputRows(row) : null;
    const records = successful && row.records !== null ? row.records : null;
    const queryAndMapMs =
      scanned !== null && row.kustoMs !== null && row.mapMs !== null && row.kustoMs + row.mapMs > 0
        ? row.kustoMs + row.mapMs
        : null;
    const advanceSeconds =
      successful && row.committedProgressSeconds !== null
        ? Math.max(0, row.committedProgressSeconds)
        : 0;

    if (queryAndMapMs !== null && scanned !== null) {
      kustoRows += scanned;
      kustoMs += queryAndMapMs;
    }
    if (totalMs !== null && scanned !== null) {
      processingRows += scanned;
      processingMs += totalMs;
    }
    if (totalMs !== null && records !== null) {
      eventRecords += records;
      eventMs += totalMs;
    }
    if (scanned !== null && records !== null && records > 0) {
      compressionRows += scanned;
      compressionRecords += records;
    }
    if (totalMs !== null) {
      checkpointWallMs += totalMs;
      checkpointAdvanceSeconds += advanceSeconds;
    }

    return {
      iterationId: row.runId,
      kustoReadThroughputRowsPerSec:
        queryAndMapMs !== null && scanned !== null ? scanned / (queryAndMapMs / 1000) : null,
      processingThroughputRowsPerSec:
        totalMs !== null && scanned !== null ? scanned / (totalMs / 1000) : null,
      eventThroughputEventsPerSec:
        totalMs !== null && records !== null ? records / (totalMs / 1000) : null,
      compressionRateRowsPerEvent:
        scanned !== null && records !== null && records > 0 ? scanned / records : null,
      checkpointAdvanceSeconds: advanceSeconds,
      checkpointVelocitySourcePerWall:
        totalMs !== null ? advanceSeconds / (totalMs / 1000) : null,
    };
  });

  return {
    metrics: {
      kustoReadThroughputRowsPerSec: kustoMs > 0 ? kustoRows / (kustoMs / 1000) : null,
      processingThroughputRowsPerSec:
        processingMs > 0 ? processingRows / (processingMs / 1000) : null,
      eventThroughputEventsPerSec: eventMs > 0 ? eventRecords / (eventMs / 1000) : null,
      compressionRateRowsPerEvent:
        compressionRecords > 0 ? compressionRows / compressionRecords : null,
      checkpointAdvanceSeconds,
      checkpointVelocitySourcePerWall:
        checkpointWallMs > 0 ? checkpointAdvanceSeconds / (checkpointWallMs / 1000) : null,
    },
    iterationMetrics,
  };
}

// ── Shard fleet stats ──────────────────────────────────────────────────────

export interface ShardFleetEntry {
  /** The shard identifier (empty string for singleton/non-sharded). */
  shardId: string;
  /** shardCount context; null for singleton. */
  shardCount: number | null;
  /** Number of lane attempts for this shard in the selected interval. */
  attempts: number;
  /** Last outcome for this shard (most recent by eventTimeUtc). */
  lastOutcome: string;
  /** Most recent backlogAfterSeconds for this shard; null if none reported. */
  latestBacklogAfterSeconds: number | null;
  /** Most recent cursorLagAfterSeconds for this shard; null if none reported. */
  latestCursorLagAfterSeconds: number | null;
  /** Sum of records finalized by this shard. */
  totalRecords: number;
  /** Most recent progressKind for this shard. */
  lastProgressKind: string;
  /** Whether any cycle for this shard had leaseLost = true. */
  hadLeaseLoss: boolean;
  /** Whether any attempt for this shard was a contention skip. */
  hadContention: boolean;
  /** List of host instances that ran this shard (unique). */
  hosts: string[];
  /** Most recent executionMode for this shard. */
  latestExecutionMode: ExecutionMode;
}

/**
 * Compute per-shard fleet health entries.
 * Singleton lanes are grouped under shardId="" with shardCount=null.
 */
export function computeShardFleet(rows: CompletedCycleRow[]): ShardFleetEntry[] {
  // Group by (shardId, shardCount) key to distinguish singleton "" from sharded ""
  const byKey = new Map<string, ShardFleetEntry>();

  for (const row of rows) {
    if (row.rowKind !== 'laneAttempt') continue;

    // Key distinguishes singleton (shardId="", shardCount=null) from sharded contexts
    const key = `${row.shardId}::${row.shardCount ?? 'null'}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        shardId: row.shardId,
        shardCount: row.shardCount,
        attempts: 0,
        lastOutcome: '',
        latestBacklogAfterSeconds: null,
        latestCursorLagAfterSeconds: null,
        totalRecords: 0,
        lastProgressKind: '',
        hadLeaseLoss: false,
        hadContention: false,
        hosts: [],
        latestExecutionMode: 'unknown',
      };
      byKey.set(key, entry);
    }

    entry.attempts++;
    entry.lastOutcome = row.outcome;
    if (row.backlogAfterSeconds !== null) entry.latestBacklogAfterSeconds = row.backlogAfterSeconds;
    if (row.cursorLagAfterSeconds !== null) entry.latestCursorLagAfterSeconds = row.cursorLagAfterSeconds;
    if (row.outcome === 'success' && row.records !== null) entry.totalRecords += row.records;
    entry.lastProgressKind = row.progressKind;
    if (row.leaseLost === true) entry.hadLeaseLoss = true;
    if (row.skipReason === 'leaseContention') entry.hadContention = true;
    if (row.appRoleInstance && !entry.hosts.includes(row.appRoleInstance)) {
      entry.hosts.push(row.appRoleInstance);
    }
    entry.latestExecutionMode = row.executionMode;
  }

  return Array.from(byKey.values()).sort((a, b) => {
    // Singleton first, then by shardId numerically
    if (a.shardCount === null && b.shardCount !== null) return -1;
    if (a.shardCount !== null && b.shardCount === null) return 1;
    return a.shardId.localeCompare(b.shardId, undefined, { numeric: true });
  });
}

// ── Backlog and paging stats ───────────────────────────────────────────────

export interface BacklogStats {
  /**
   * Maximum backlogAfterSeconds across all shards (fleet's worst backlog).
   * Use this for fleet health — never sum across shards.
   */
  maxBacklogAfterSeconds: number | null;
  /**
   * Minimum backlogAfterSeconds (the most-caught-up lane).
   * null when no row reports it.
   */
  minBacklogAfterSeconds: number | null;
  /**
   * Maximum backlogBeforeSeconds (shows the largest starting backlog this interval).
   * null when no row reports it.
   */
  maxBacklogBeforeSeconds: number | null;
  /**
   * Slowest effective drain rate: (backlogBefore - backlogAfter) / totalMs * 1000,
   * using the lane with the most remaining backlog.
   * null when insufficient data.
   */
  slowestDrainRateSecondsPerSec: number | null;
  /**
   * Guarded drain estimate: maxBacklogAfterSeconds / abs(slowestDrainRateSecondsPerSec).
   * Null when denominator is zero or either input is null.
   * Label as "estimated seconds to drain at slowest observed rate".
   */
  guardedDrainEstimateSeconds: number | null;
  /** Count of rows where hasMore = true (band not fully drained). */
  hasMoreCount: number;
  /** Count of rows where bandDrained = true. */
  bandDrainedCount: number;
  /** Count of rows where resumedPending = true. */
  resumedPendingCount: number;
  /** Sum of rereadCandidates across rows where it is non-null. */
  totalRereadCandidates: number | null;
}

/**
 * Compute backlog and paging health.
 * Fleet backlog uses max, not sum — summing across shards is semantically wrong.
 */
export function computeBacklogStats(rows: CompletedCycleRow[]): BacklogStats {
  const laneRows = rows.filter((r) => r.rowKind === 'laneAttempt');

  let maxAfter: number | null = null;
  let minAfter: number | null = null;
  let maxBefore: number | null = null;
  let hasMoreCount = 0;
  let bandDrainedCount = 0;
  let resumedPendingCount = 0;
  let totalReread: number | null = null;

  // Track the lane with the worst remaining backlog for drain rate
  let worstBacklogRow: CompletedCycleRow | null = null;

  for (const row of laneRows) {
    if (row.backlogAfterSeconds !== null) {
      if (maxAfter === null || row.backlogAfterSeconds > maxAfter) {
        maxAfter = row.backlogAfterSeconds;
        worstBacklogRow = row;
      }
      minAfter = minAfter === null ? row.backlogAfterSeconds : Math.min(minAfter, row.backlogAfterSeconds);
    }
    if (row.backlogBeforeSeconds !== null) {
      maxBefore = maxBefore === null ? row.backlogBeforeSeconds : Math.max(maxBefore, row.backlogBeforeSeconds);
    }
    if (row.hasMore === true) hasMoreCount++;
    if (row.bandDrained === true) bandDrainedCount++;
    if (row.resumedPending === true) resumedPendingCount++;
    if (row.rereadCandidates !== null) {
      totalReread = (totalReread ?? 0) + row.rereadCandidates;
    }
  }

  // Slowest effective drain rate from the worst backlog lane
  let slowestDrainRate: number | null = null;
  let guardedDrain: number | null = null;
  if (worstBacklogRow !== null &&
    worstBacklogRow.backlogBeforeSeconds !== null &&
    worstBacklogRow.backlogAfterSeconds !== null &&
    worstBacklogRow.totalMs !== null && worstBacklogRow.totalMs > 0) {
    const netDrainSec = worstBacklogRow.backlogBeforeSeconds - worstBacklogRow.backlogAfterSeconds;
    const wallSec = worstBacklogRow.totalMs / 1000;
    if (wallSec > 0) {
      slowestDrainRate = netDrainSec / wallSec;
      if (slowestDrainRate > 0 && maxAfter !== null) {
        guardedDrain = maxAfter / slowestDrainRate;
      }
    }
  }

  return {
    maxBacklogAfterSeconds: maxAfter,
    minBacklogAfterSeconds: minAfter,
    maxBacklogBeforeSeconds: maxBefore,
    slowestDrainRateSecondsPerSec: slowestDrainRate,
    guardedDrainEstimateSeconds: guardedDrain,
    hasMoreCount,
    bandDrainedCount,
    resumedPendingCount,
    totalRereadCandidates: totalReread,
  };
}

// ── Kusto pipeline stats ───────────────────────────────────────────────────

export interface KustoModeStats {
  mode: ExecutionMode;
  count: number;
  /** Average kustoMs for this mode — only comparable within the same mode. */
  avgKustoMs: number | null;
  /** Average mapMs for this mode — null for legacy rows where it was unavailable. */
  avgMapMs: number | null;
  /** Average rowsScanned — null for legacy rows where it was unavailable. */
  avgRowsScanned: number | null;
  avgRowsReturned: number | null;
  avgRowsMapped: number | null;
  totalDuplicateCollapsed: number | null;
  totalContractInvalid: number | null;
  throttleRetryTotal: number | null;
  throttleDelayMsTotal: number | null;
}

export interface KustoPipelineStats {
  /** Per-mode stats — do NOT compare across modes. */
  byMode: KustoModeStats[];
  /**
   * Whether any legacy rows are present. If true, kustoMs from legacy rows
   * must not be compared with drainSafe kustoMs.
   */
  hasLegacyRows: boolean;
  /** Count of rows where kustoThrottleRetryCount > 0. */
  throttledCycleCount: number;
}

/**
 * Compute mode-aware Kusto pipeline stats.
 * Legacy and drain-safe rows are separated and never blended.
 */
export function computeKustoStats(rows: CompletedCycleRow[]): KustoPipelineStats {
  const laneRows = rows.filter((r) => r.rowKind === 'laneAttempt');
  const modeMap = new Map<ExecutionMode, CompletedCycleRow[]>();

  let throttledCycleCount = 0;

  for (const row of laneRows) {
    const group = modeMap.get(row.executionMode) ?? [];
    group.push(row);
    modeMap.set(row.executionMode, group);
    if (row.kustoThrottleRetryCount !== null && row.kustoThrottleRetryCount > 0) {
      throttledCycleCount++;
    }
  }

  const byMode: KustoModeStats[] = [];
  for (const [mode, modeRows] of modeMap) {
    const kustoMsRows = modeRows.filter((r) => r.kustoMs !== null);
    const mapMsRows = modeRows.filter((r) => r.mapMs !== null);
    const scannedRows = modeRows.filter((r) => r.rowsScanned !== null);
    const returnedRows = modeRows.filter((r) => r.rowsReturned !== null);
    const mappedRows = modeRows.filter((r) => r.rowsMapped !== null);

    const sum = (arr: CompletedCycleRow[], fn: (r: CompletedCycleRow) => number | null): number | null => {
      const vals = arr.map(fn).filter((v): v is number => v !== null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
    };

    const avg = (arr: CompletedCycleRow[], fn: (r: CompletedCycleRow) => number | null): number | null => {
      const total = sum(arr, fn);
      return total !== null && arr.length > 0 ? total / arr.length : null;
    };

    const throttleRetryTotal = sum(modeRows, (r) => r.kustoThrottleRetryCount);
    const throttleDelayTotal = sum(modeRows, (r) => r.kustoThrottleDelayMs);
    const dupTotal = sum(modeRows, (r) => r.duplicateCollapsed);
    const invalidTotal = sum(modeRows, (r) => r.contractInvalid);

    byMode.push({
      mode,
      count: modeRows.length,
      avgKustoMs: kustoMsRows.length > 0 ? avg(kustoMsRows, (r) => r.kustoMs) : null,
      // mapMs is null on legacy rows — never substitute 0 for legacy
      avgMapMs: mapMsRows.length > 0 ? avg(mapMsRows, (r) => r.mapMs) : null,
      // rowsScanned is null on legacy rows — never substitute 0
      avgRowsScanned: scannedRows.length > 0 ? avg(scannedRows, (r) => r.rowsScanned) : null,
      avgRowsReturned: returnedRows.length > 0 ? avg(returnedRows, (r) => r.rowsReturned) : null,
      avgRowsMapped: mappedRows.length > 0 ? avg(mappedRows, (r) => r.rowsMapped) : null,
      totalDuplicateCollapsed: dupTotal,
      totalContractInvalid: invalidTotal,
      throttleRetryTotal,
      throttleDelayMsTotal: throttleDelayTotal,
    });
  }

  return {
    byMode,
    hasLegacyRows: modeMap.has('legacy'),
    throttledCycleCount,
  };
}

// ── Cosmos bulk stats ──────────────────────────────────────────────────────

export interface CosmosStats {
  /** Total partition-batch attempts. Partition-batch unit, not document/operation. */
  totalCosmosAttempted: number | null;
  /** Total successful partition-batch writes. */
  totalCosmosSucceeded: number | null;
  /** Total failed partition-batch writes. */
  totalCosmosFailed: number | null;
  /** Total cancelled partition-batch writes. */
  totalCosmosCancelled: number | null;
  /**
   * Sum of writeInteractionsSuccessRu across rows where non-null.
   * Covers BULK interaction writes only — not transactional, not snapshot.
   */
  bulkSuccessRuSum: number | null;
  /**
   * Sum of totalCosmosRu across rows where non-null.
   * PARTIAL OBSERVED TOTAL — missing transactional and snapshot success RU.
   */
  partialTotalRuSum: number | null;
  /**
   * RU per finalized record (partialTotalRuSum / totalRecords).
   * null when either input is missing. Carries the "partial" completeness caveat.
   */
  partialRuPerRecord: number | null;
  /**
   * Total SDK-level failed service requests. NOT a retry count.
   * Do not label as "retries".
   */
  sdkFailedServiceRequestTotal: number | null;
  /**
   * Total terminal 429 operations (reached terminal failure). NOT total 429 responses.
   * Do not label as "total 429s".
   */
  terminal429Total: number | null;
  /** Maximum terminal retry-after duration observed (ms). */
  maxTerminalRetryAfterMs: number | null;
  /** Count of rows with any non-null Cosmos data. */
  affectedCycleCount: number;
}

/** Compute Cosmos bulk stats with correct labels and partial RU completeness. */
export function computeCosmosStats(rows: CompletedCycleRow[]): CosmosStats {
  const laneRows = rows.filter((r) => r.rowKind === 'laneAttempt');

  let attempted: number | null = null;
  let succeeded: number | null = null;
  let failed: number | null = null;
  let cancelled: number | null = null;
  let bulkRu: number | null = null;
  let partialRu: number | null = null;
  let sdkFailed: number | null = null;
  let terminal429: number | null = null;
  let maxRetryAfter: number | null = null;
  let totalRecords = 0;
  let affectedCount = 0;

  for (const row of laneRows) {
    const affected = row.cosmosAttempted !== null || row.cosmosSucceeded !== null ||
      row.cosmosFailed !== null || row.cosmosCancelled !== null ||
      row.writeInteractionsSuccessRu !== null || row.writeInteractionsRu !== null ||
      row.interactionWriteRu !== null || row.getSnapshotRu !== null ||
      row.upsertSnapshotRu !== null || row.totalCosmosRu !== null;
    if (affected) affectedCount++;

    if (row.cosmosAttempted !== null) attempted = (attempted ?? 0) + row.cosmosAttempted;
    if (row.cosmosSucceeded !== null) succeeded = (succeeded ?? 0) + row.cosmosSucceeded;
    if (row.cosmosFailed !== null) failed = (failed ?? 0) + row.cosmosFailed;
    if (row.cosmosCancelled !== null) cancelled = (cancelled ?? 0) + row.cosmosCancelled;
    if (row.writeInteractionsSuccessRu !== null) bulkRu = (bulkRu ?? 0) + row.writeInteractionsSuccessRu;
    if (row.totalCosmosRu !== null) partialRu = (partialRu ?? 0) + row.totalCosmosRu;
    if (row.sdkFailedServiceRequestCount !== null) sdkFailed = (sdkFailed ?? 0) + row.sdkFailedServiceRequestCount;
    if (row.terminal429OperationCount !== null) terminal429 = (terminal429 ?? 0) + row.terminal429OperationCount;
    if (row.terminalRetryAfterMs !== null) {
      maxRetryAfter = maxRetryAfter === null ? row.terminalRetryAfterMs : Math.max(maxRetryAfter, row.terminalRetryAfterMs);
    }
    if (row.outcome === 'success' && row.records !== null) totalRecords += row.records;
  }

  const partialRuPerRecord =
    partialRu !== null && totalRecords > 0 ? partialRu / totalRecords : null;

  return {
    totalCosmosAttempted: attempted,
    totalCosmosSucceeded: succeeded,
    totalCosmosFailed: failed,
    totalCosmosCancelled: cancelled,
    bulkSuccessRuSum: bulkRu,
    partialTotalRuSum: partialRu,
    partialRuPerRecord,
    sdkFailedServiceRequestTotal: sdkFailed,
    terminal429Total: terminal429,
    maxTerminalRetryAfterMs: maxRetryAfter,
    affectedCycleCount: affectedCount,
  };
}
