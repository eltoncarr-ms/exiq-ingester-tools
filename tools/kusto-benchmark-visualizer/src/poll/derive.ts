/**
 * Derives the poll telemetry UI model from parsed `stage`/`cycle` events.
 * Stage records are joined to their cycle by `runId`; a source is assigned
 * to a cycle only once its `cycle` rollup arrives (see
 * docs/plans/poll-telemetry-visualizer.md, "Review-cycle resolutions").
 * Every optional metric is genuinely omitted (never a zero-shaped fallback
 * or NaN) when its inputs are absent, per the visualizer's acceptance
 * criteria.
 */
import type { PollCycleEvent, PollEvent, PollOutcome, PollStageEvent } from './types';

/** One reconstructed span in a cycle's stage timeline. */
export interface PollStageTimelineEntry {
  stage: string;
  startMs: number;
  /** `null` while the stage is still open (no matching `end` event yet). */
  durMs: number | null;
  completed: boolean;
}

export type PollCycleOutcome = PollOutcome | 'in-progress';

/** One poll cycle, either rolled up from a `cycle` event or still in progress. */
export interface PollCycleAnalysis {
  runId: string;
  /** `null` until the cycle's rollup event arrives and assigns a source. */
  source: string | null;
  outcome: PollCycleOutcome;
  startedAtMs: number;
  /** `null` for a cycle with no rollup event yet. */
  completedAtMs: number | null;
  /** `null` for a cycle with no rollup event yet. */
  totalMs: number | null;
  /** `null` for a cycle with no rollup event yet. */
  records: number | null;
  /** `null` for a cycle with no rollup event yet. */
  recordsPerSec: number | null;
  /** Kusto query execution within the seal stage, when reported by the cycle rollup. */
  kustoMs?: number;
  /** Reading and mapping Kusto rows within the seal stage, when reported by the cycle rollup. */
  mapMs?: number;
  cosmosRetryCount?: number;
  cosmos429Count?: number;
  cosmosWriteAttempted?: number;
  cosmosWriteSucceeded?: number;
  cosmosWriteFailed?: number;
  cosmosWriteCancelled?: number;
  stages: PollStageTimelineEntry[];
  error?: string;
  failingStage?: string;
}

/** One point in a wall-clock trend series. */
export interface PollTrendPoint {
  atMs: number;
  value: number;
}

export interface PollOutcomeCounts {
  success: number;
  skipped: number;
  failed: number;
}

/**
 * Aggregate metrics for one source's completed cycles. Every field beyond
 * the always-known counts/totals is optional and is omitted (not zeroed or
 * NaN'd) when no contributing cycle reports the underlying fact.
 */
export interface PollSourceMetrics {
  cycleCount: number;
  outcomeCounts: PollOutcomeCounts;
  totalRecords: number;
  /** Sum of the `inputRows` fact (source messages read this cycle) across every cycle that reports a finite value, regardless of outcome. `undefined` only when no cycle reports it. */
  totalInputRows?: number;
  /** Count of successful cycles whose `windowStartUtc`→`windowEndUtc` facts advance by a positive amount — an actual cursor/checkpoint movement. Skipped/failed cycles and cycles with a missing, unparsable, or non-positive window never count, but this is always a defined number (0, not omitted, when no cycle qualifies). */
  checkpointCount: number;
  totalUsers?: number;
  avgSuccessfulRecordsPerSec?: number;
  avgCycleMs?: number;
  latestCursorLagSec?: number;
  totalWriteInteractionsRu?: number;
  totalCosmosRetryCount?: number;
  totalCosmos429Count?: number;
  totalCosmosWriteAttempted?: number;
  totalCosmosWriteSucceeded?: number;
  totalCosmosWriteFailed?: number;
  totalCosmosWriteCancelled?: number;
  /** Cycles reporting Cosmos metrics with at least one retry, 429, failed write, or cancelled write. */
  cosmosAffectedCycleCount?: number;
  /** Full-run elapsed wall-clock time for this source: latest cycle completion minus earliest cycle start. `undefined` only when no cycle has a parsable timestamp. */
  durationMs?: number;
}

/** Guarded descriptive statistics across a set of cycle-level duration samples. Never constructed for an empty sample set (see `computeDescriptiveStats`), so consumers never see a NaN'd average or a fabricated min/max. */
export interface PollDescriptiveStats {
  avg: number;
  min: number;
  /** Standard median: for an even sample count, the average of the two middle values. */
  p50: number;
  /** Nearest-rank 95th percentile, matching the gauge grid's own percentile formula (`RunThroughputGauges.tsx`). */
  p95: number;
  max: number;
  count: number;
}

/** Per-stage descriptive duration stats across a source's completed cycles. A stage key is omitted entirely when no cycle reports a finite value for it. */
export interface PollSourceDurationStats {
  /** Seal-query duration (`kustoMs`): the Kusto query that seals/reads this cycle's window. */
  kustoMs?: PollDescriptiveStats;
  /** Row-mapping duration (`mapMs`): mapping sealed Kusto rows into records. */
  mapMs?: PollDescriptiveStats;
  /** Write-stage duration (`writeMs`): `_sink.WriteAsync(batches)`, the destination interaction/snapshot writes. */
  writeMs?: PollDescriptiveStats;
  /** Advance-stage duration (`advanceMs`): `_cursor.WriteAsync(...)`, persisting the cursor/watermark after writes complete. */
  advanceMs?: PollDescriptiveStats;
}

/**
 * Weighted full-run throughput dials for one source, matching the benchmark
 * page's `RunThroughputMetrics` shape structurally (field-for-field) so it
 * can be passed directly to `ThroughputGaugeGrid` without importing the
 * benchmark module. See `buildPollThroughputMetrics` for the exact formulas.
 */
export interface PollRunThroughputMetrics {
  kustoReadThroughputRowsPerSec: number;
  processingThroughputRowsPerSec: number;
  eventThroughputEventsPerSec: number;
  compressionRateRowsPerEvent: number | null;
  checkpointAdvanceSeconds: number;
  checkpointVelocitySourcePerWall: number;
  cosmosWriteThroughputBatchesPerSec: number | null;
}

/**
 * Per-cycle throughput dial values, structurally compatible with the
 * benchmark page's `IterationThroughputMetrics`. Only cycles that qualify
 * for the first four weighted dials (successful with a valid `inputRows`
 * fact — see `qualifiesForWeightedThroughput`) are represented at all; a
 * non-qualifying cycle is omitted entirely rather than contributing a
 * zero-valued entry, so reused gauge range/p95 inputs are not skewed by
 * invalid zeros.
 */
export interface PollIterationThroughputMetrics extends PollRunThroughputMetrics {
  iterationId: string;
}

export interface PollSourceAnalysis {
  source: string;
  /** Completed cycles for this source, sorted by wall-clock start time. */
  cycles: PollCycleAnalysis[];
  metrics: PollSourceMetrics;
  /** Descriptive stage-duration stats (avg/min/p50/p95/max/count) across this source's completed cycles, for the dedicated Poll Duration Stats section. */
  durationStats: PollSourceDurationStats;
  /**
   * Raw source-message throughput (msg/sec), plotted at cycle completion
   * time: `inputRows / (totalMs / 1000)` for each successful cycle that
   * reports a finite `inputRows` fact and a positive `totalMs`. This is
   * deliberately distinct from the producer's own `recordsPerSec` field,
   * which is finalized-output-events-per-second, not raw message
   * throughput — see `cycleRawMessageThroughputPerSec`.
   */
  throughputPoints: PollTrendPoint[];
  /** Successful-cycle finalized-record (event) counts, plotted at cycle completion time. */
  recordsPoints: PollTrendPoint[];
  /** Weighted full-run throughput dials, aggregated across every cycle for this source. */
  throughputMetrics: PollRunThroughputMetrics;
  /**
   * Per-cycle throughput dial values, used to size each dial's range/p95.
   * Only cycles qualifying for the first four weighted dials (successful
   * with a valid `inputRows` fact) are included; skipped/failed/missing-
   * `inputRows` cycles are excluded rather than zeroed. Checkpoint velocity
   * fields on the remaining entries therefore reflect qualifying cycles
   * only, not every completed cycle — an accepted narrowing for this
   * gauge-sizing reuse (the source-level `throughputMetrics.checkpoint*`
   * aggregate is unaffected and still spans every cycle).
   */
  iterationThroughputMetrics: PollIterationThroughputMetrics[];
}

export interface PollAnalysis {
  sources: PollSourceAnalysis[];
  /** Cycles with stage activity but no rollup event yet; no source assigned. */
  unresolvedCycles: PollCycleAnalysis[];
}

/** Parses an ISO timestamp to epoch ms, guarding against an unparsable value. */
function toEpochMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Average of `values`, or `undefined` for an empty input (never NaN from 0/0). */
function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sum of the defined entries in `values`, or `undefined` if none are defined. */
function sumDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) return undefined;

  return defined.reduce((sum, value) => sum + value, 0);
}

/** The value of `select` from whichever cycle completed most recently, skipping cycles where it is absent. */
function latestDefinedBy<T>(cycles: PollCycleEvent[], select: (cycle: PollCycleEvent) => T | undefined): T | undefined {
  const byRecency = [...cycles].sort((a, b) => (Date.parse(b.completedAtUtc) || 0) - (Date.parse(a.completedAtUtc) || 0));
  for (const cycle of byRecency) {
    const value = select(cycle);
    if (value !== undefined) return value;
  }

  return undefined;
}

/**
 * Reconstructs a stage timeline from progressive `stage` events for one
 * still-in-progress runId (no `cycle` rollup yet, so there is no producer
 * `timeline` to trust). `start`/`end` pairs are matched by stage name in
 * first-in-first-out order so repeated stage names still pair up correctly;
 * an unmatched `start` stays open (`durMs: null`, `completed: false`), and an
 * `end` with no matching `start` (e.g. a truncated log) still yields a
 * completed span computed from its own `atMs`/`durMs`.
 */
function buildStagesFromEvents(stageEvents: PollStageEvent[]): PollStageTimelineEntry[] {
  const sorted = [...stageEvents].sort((a, b) => a.atMs - b.atMs);
  const entries: PollStageTimelineEntry[] = [];
  const openIndexesByStage = new Map<string, number[]>();

  for (const event of sorted) {
    if (event.ev === 'start') {
      const index = entries.length;
      entries.push({ stage: event.stage, startMs: event.atMs, durMs: null, completed: false });
      const queue = openIndexesByStage.get(event.stage) ?? [];
      queue.push(index);
      openIndexesByStage.set(event.stage, queue);
      continue;
    }

    // ev === 'end'; parsePollLine guarantees durMs is present for 'end' events.
    const queue = openIndexesByStage.get(event.stage);
    const openIndex = queue?.shift();
    if (openIndex !== undefined) {
      entries[openIndex] = { ...entries[openIndex], durMs: event.durMs ?? null, completed: event.durMs !== undefined };
    } else if (event.durMs !== undefined) {
      entries.push({ stage: event.stage, startMs: event.atMs - event.durMs, durMs: event.durMs, completed: true });
    }
  }

  return entries;
}

/** The wall-clock cycle start estimated from every stage event's `ts` minus its `atMs` offset. */
function estimateUnresolvedStartMs(stageEvents: PollStageEvent[]): number {
  const estimates = stageEvents
    .map((event) => {
      const ts = toEpochMs(event.ts);
      return ts === null ? null : ts - event.atMs;
    })
    .filter((value): value is number => value !== null);

  return estimates.length > 0 ? Math.min(...estimates) : 0;
}

function buildResolvedCycleAnalysis(cycle: PollCycleEvent): PollCycleAnalysis {
  return {
    runId: cycle.runId,
    source: cycle.source,
    outcome: cycle.outcome,
    startedAtMs: toEpochMs(cycle.startedAtUtc) ?? 0,
    completedAtMs: toEpochMs(cycle.completedAtUtc),
    totalMs: cycle.totalMs,
    records: cycle.records,
    recordsPerSec: cycle.recordsPerSec,
    ...(cycle.kustoMs !== undefined ? { kustoMs: cycle.kustoMs } : {}),
    ...(cycle.mapMs !== undefined ? { mapMs: cycle.mapMs } : {}),
    ...(cycle.cosmosRetryCount !== undefined ? { cosmosRetryCount: cycle.cosmosRetryCount } : {}),
    ...(cycle.cosmos429Count !== undefined ? { cosmos429Count: cycle.cosmos429Count } : {}),
    ...(cycle.cosmosWriteAttempted !== undefined ? { cosmosWriteAttempted: cycle.cosmosWriteAttempted } : {}),
    ...(cycle.cosmosWriteSucceeded !== undefined ? { cosmosWriteSucceeded: cycle.cosmosWriteSucceeded } : {}),
    ...(cycle.cosmosWriteFailed !== undefined ? { cosmosWriteFailed: cycle.cosmosWriteFailed } : {}),
    ...(cycle.cosmosWriteCancelled !== undefined ? { cosmosWriteCancelled: cycle.cosmosWriteCancelled } : {}),
    stages: cycle.timeline.map((entry) => ({ stage: entry.stage, startMs: entry.startMs, durMs: entry.durMs, completed: true })),
    ...(cycle.error !== undefined ? { error: cycle.error } : {}),
    ...(cycle.failingStage !== undefined ? { failingStage: cycle.failingStage } : {}),
  };
}

function buildUnresolvedCycleAnalysis(runId: string, stageEvents: PollStageEvent[]): PollCycleAnalysis {
  return {
    runId,
    source: null,
    outcome: 'in-progress',
    startedAtMs: estimateUnresolvedStartMs(stageEvents),
    completedAtMs: null,
    totalMs: null,
    records: null,
    recordsPerSec: null,
    stages: buildStagesFromEvents(stageEvents),
  };
}

/** Latest cycle completion minus earliest cycle start, or `undefined` if no cycle has a parsable timestamp on either end. */
function sourceDurationMs(cycles: PollCycleEvent[]): number | undefined {
  const startedMsValues = cycles.map((cycle) => toEpochMs(cycle.startedAtUtc)).filter((value): value is number => value !== null);
  const completedMsValues = cycles.map((cycle) => toEpochMs(cycle.completedAtUtc)).filter((value): value is number => value !== null);
  if (startedMsValues.length === 0 || completedMsValues.length === 0) return undefined;

  return Math.max(0, Math.max(...completedMsValues) - Math.min(...startedMsValues));
}

function buildSourceMetrics(cycles: PollCycleEvent[]): PollSourceMetrics {
  const successCycles = cycles.filter((cycle) => cycle.outcome === 'success');
  const cyclesWithCosmosMetrics = cycles.filter((cycle) =>
    [
      cycle.cosmosRetryCount,
      cycle.cosmos429Count,
      cycle.cosmosWriteAttempted,
      cycle.cosmosWriteSucceeded,
      cycle.cosmosWriteFailed,
      cycle.cosmosWriteCancelled,
    ].some((value) => value !== undefined),
  );

  return {
    cycleCount: cycles.length,
    outcomeCounts: {
      success: successCycles.length,
      skipped: cycles.filter((cycle) => cycle.outcome === 'skipped').length,
      failed: cycles.filter((cycle) => cycle.outcome === 'failed').length,
    },
    totalRecords: cycles.reduce((sum, cycle) => sum + cycle.records, 0),
    ...withDefined('totalInputRows', sumDefined(cycles.map((cycle) => cycleInputRows(cycle) ?? undefined))),
    checkpointCount: cycles.filter(cycleAdvancesCheckpoint).length,
    ...withDefined('totalUsers', sumDefined(cycles.map((cycle) => cycle.users))),
    ...withDefined('avgSuccessfulRecordsPerSec', average(successCycles.map((cycle) => cycle.recordsPerSec))),
    ...withDefined('avgCycleMs', average(cycles.map((cycle) => cycle.totalMs))),
    ...withDefined('latestCursorLagSec', latestDefinedBy(cycles, (cycle) => cycle.cursorLagSec)),
    ...withDefined('totalWriteInteractionsRu', sumDefined(cycles.map((cycle) => cycle.writeInteractionsRu))),
    ...withDefined('totalCosmosRetryCount', sumDefined(cycles.map((cycle) => cycle.cosmosRetryCount))),
    ...withDefined('totalCosmos429Count', sumDefined(cycles.map((cycle) => cycle.cosmos429Count))),
    ...withDefined('totalCosmosWriteAttempted', sumDefined(cycles.map((cycle) => cycle.cosmosWriteAttempted))),
    ...withDefined('totalCosmosWriteSucceeded', sumDefined(cycles.map((cycle) => cycle.cosmosWriteSucceeded))),
    ...withDefined('totalCosmosWriteFailed', sumDefined(cycles.map((cycle) => cycle.cosmosWriteFailed))),
    ...withDefined('totalCosmosWriteCancelled', sumDefined(cycles.map((cycle) => cycle.cosmosWriteCancelled))),
    ...(cyclesWithCosmosMetrics.length > 0
      ? {
          cosmosAffectedCycleCount: cyclesWithCosmosMetrics.filter(
            (cycle) =>
              (cycle.cosmosRetryCount ?? 0) > 0 ||
              (cycle.cosmos429Count ?? 0) > 0 ||
              (cycle.cosmosWriteFailed ?? 0) > 0 ||
              (cycle.cosmosWriteCancelled ?? 0) > 0,
          ).length,
        }
      : {}),
    ...withDefined('durationMs', sourceDurationMs(cycles)),
  };
}

/**
 * Guarded descriptive stats (avg/min/p50/p95/max/count) across `rawValues`,
 * or `undefined` for an empty/all-non-finite input — never a NaN'd average
 * or a fabricated min/max from zero samples. `p50` is the standard median
 * (averages the two middle values for an even sample count); `p95` uses the
 * same nearest-rank formula as the gauge grid's own percentile helper
 * (`RunThroughputGauges.tsx`'s `percentile`) so both stay consistent.
 */
export function computeDescriptiveStats(rawValues: number[]): PollDescriptiveStats | undefined {
  const values = rawValues.filter((value) => Number.isFinite(value));
  if (values.length === 0) return undefined;

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const avg = sorted.reduce((sum, value) => sum + value, 0) / count;
  const mid = Math.floor(count / 2);
  const p50 = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const p95Index = Math.min(count - 1, Math.max(0, Math.ceil((95 / 100) * count) - 1));

  return { avg, min: sorted[0], p50, p95: sorted[p95Index], max: sorted[count - 1], count };
}

/** Builds this source's stage-duration descriptive stats; a stage key is omitted when no cycle reports a finite value for it. */
function buildPollDurationStats(cycles: PollCycleEvent[]): PollSourceDurationStats {
  return {
    ...withDefined('kustoMs', computeDescriptiveStats(definedNumbers(cycles.map((cycle) => cycle.kustoMs)))),
    ...withDefined('mapMs', computeDescriptiveStats(definedNumbers(cycles.map((cycle) => cycle.mapMs)))),
    ...withDefined('writeMs', computeDescriptiveStats(definedNumbers(cycles.map((cycle) => cycle.writeMs)))),
    ...withDefined('advanceMs', computeDescriptiveStats(definedNumbers(cycles.map((cycle) => cycle.advanceMs)))),
  };
}

/** Reads a finite numeric fact from a cycle's raw `facts` payload, or `null` when absent/invalid — never coerced to 0. */
function factNumber(facts: Record<string, unknown>, key: string): number | null {
  const value = facts[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads an ISO-timestamp fact from a cycle's raw `facts` payload as epoch ms, or `null` when absent/unparsable. */
function factEpochMs(facts: Record<string, unknown>, key: string): number | null {
  const value = facts[key];
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The `inputRows` fact for one cycle, read from `facts` — `null` when the producer omitted it (e.g. older logs). */
function cycleInputRows(cycle: PollCycleEvent): number | null {
  return factNumber(cycle.facts, 'inputRows');
}

/**
 * Raw source-message (Kusto row) throughput for one successful cycle:
 * `inputRows / (totalMs / 1000)`. `null` when the cycle did not succeed,
 * omitted a finite `inputRows` fact, or has a non-positive `totalMs` —
 * never the producer's `recordsPerSec`, which counts finalized output
 * events/interactions rather than raw source messages.
 */
function cycleRawMessageThroughputPerSec(cycle: PollCycleEvent): number | null {
  if (cycle.outcome !== 'success') return null;
  const inputRows = cycleInputRows(cycle);
  if (inputRows === null || cycle.totalMs <= 0) return null;

  return inputRows / (cycle.totalMs / 1000);
}

/**
 * Source seconds this cycle actually advanced the checkpoint window:
 * `max(0, windowEndUtc - windowStartUtc)` in seconds, for a successful cycle
 * with both window facts present. Every other outcome (skipped/failed)
 * contributes 0 regardless of any window facts it happens to carry, matching
 * the benchmark page's checkpoint-velocity definition.
 */
function cycleCheckpointAdvanceSeconds(cycle: PollCycleEvent): number {
  if (cycle.outcome !== 'success') return 0;
  const windowStartMs = factEpochMs(cycle.facts, 'windowStartUtc');
  const windowEndMs = factEpochMs(cycle.facts, 'windowEndUtc');
  if (windowStartMs === null || windowEndMs === null) return 0;

  return Math.max(0, (windowEndMs - windowStartMs) / 1000);
}

/** A cycle contributes to the first four weighted throughput dials only when it succeeded and reports a valid `inputRows` fact. */
function qualifiesForWeightedThroughput(cycle: PollCycleEvent): boolean {
  return cycle.outcome === 'success' && cycleInputRows(cycle) !== null;
}

/** A cycle counts as a "checkpoint" (an actual cursor/watermark advancement) only when it strictly advanced its window by a positive amount — reuses `cycleCheckpointAdvanceSeconds`'s success/window-fact gating, so a skipped/failed/missing-window/zero-advancement cycle never counts. */
function cycleAdvancesCheckpoint(cycle: PollCycleEvent): boolean {
  return cycleCheckpointAdvanceSeconds(cycle) > 0;
}

/**
 * Weighted full-run throughput dials for one source's cycles (all
 * outcomes). The first four are summed only over successful cycles that
 * report a valid `inputRows` fact:
 *   - Kusto read = sum(inputRows) / sum(kustoMs + mapMs)
 *   - Processing = sum(inputRows) / sum(totalMs)
 *   - Event = sum(records) / sum(totalMs)
 *   - Compression = sum(inputRows) / sum(records)
 * Checkpoint velocity spans every cycle regardless of outcome: sum of
 * per-cycle source-seconds-advanced (0 for a non-successful cycle) divided
 * by sum(totalMs) across every cycle passed in.
 */
function buildPollThroughputMetrics(cycles: PollCycleEvent[]): PollRunThroughputMetrics {
  let sumInputRows = 0;
  let sumKustoPlusMapMs = 0;
  let sumTotalMsQualifying = 0;
  let sumRecordsQualifying = 0;
  let sumTotalMsAll = 0;
  let sumAdvanceSeconds = 0;

  for (const cycle of cycles) {
    sumTotalMsAll += cycle.totalMs;
    sumAdvanceSeconds += cycleCheckpointAdvanceSeconds(cycle);

    if (!qualifiesForWeightedThroughput(cycle)) continue;

    sumInputRows += cycleInputRows(cycle) ?? 0;
    sumKustoPlusMapMs += (cycle.kustoMs ?? 0) + (cycle.mapMs ?? 0);
    sumTotalMsQualifying += cycle.totalMs;
    sumRecordsQualifying += cycle.records;
  }

  return {
    kustoReadThroughputRowsPerSec: sumKustoPlusMapMs > 0 ? sumInputRows / (sumKustoPlusMapMs / 1000) : 0,
    processingThroughputRowsPerSec: sumTotalMsQualifying > 0 ? sumInputRows / (sumTotalMsQualifying / 1000) : 0,
    eventThroughputEventsPerSec: sumTotalMsQualifying > 0 ? sumRecordsQualifying / (sumTotalMsQualifying / 1000) : 0,
    compressionRateRowsPerEvent: sumRecordsQualifying > 0 ? sumInputRows / sumRecordsQualifying : null,
    checkpointAdvanceSeconds: sumAdvanceSeconds,
    checkpointVelocitySourcePerWall: sumTotalMsAll > 0 ? sumAdvanceSeconds / (sumTotalMsAll / 1000) : 0,
    cosmosWriteThroughputBatchesPerSec: null,
  };
}

/**
 * Per-cycle throughput dial values, used only to size each dial's
 * min/max/p95 range in `ThroughputGaugeGrid`. A cycle that does not qualify
 * for the first four weighted dials (skipped/failed, or missing a valid
 * `inputRows` fact) is excluded from the result entirely rather than
 * contributing a zero-valued entry, so the reused gauge range/p95 inputs
 * are not skewed by invalid zeros. Each remaining entry's checkpoint fields
 * are therefore also scoped to qualifying cycles only — a narrowing
 * accepted for this UI-range-sizing reuse; the source-level
 * `throughputMetrics.checkpoint*` aggregate is unaffected and still spans
 * every cycle regardless of outcome.
 */
function buildPollIterationThroughputMetrics(cycles: PollCycleEvent[]): PollIterationThroughputMetrics[] {
  return cycles.filter(qualifiesForWeightedThroughput).map((cycle) => {
    const advanceSeconds = cycleCheckpointAdvanceSeconds(cycle);
    const totalSec = cycle.totalMs / 1000;
    const inputRows = cycleInputRows(cycle) ?? 0;
    const kustoPlusMapSec = ((cycle.kustoMs ?? 0) + (cycle.mapMs ?? 0)) / 1000;

    return {
      iterationId: cycle.runId,
      kustoReadThroughputRowsPerSec: kustoPlusMapSec > 0 ? inputRows / kustoPlusMapSec : 0,
      processingThroughputRowsPerSec: totalSec > 0 ? inputRows / totalSec : 0,
      eventThroughputEventsPerSec: totalSec > 0 ? cycle.records / totalSec : 0,
      compressionRateRowsPerEvent: cycle.records > 0 ? inputRows / cycle.records : null,
      checkpointAdvanceSeconds: advanceSeconds,
      checkpointVelocitySourcePerWall: totalSec > 0 ? advanceSeconds / totalSec : 0,
      cosmosWriteThroughputBatchesPerSec: null,
    };
  });
}

function definedNumbers(values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined);
}

/** Spreads `{ [key]: value }` only when `value` is defined, so optional metrics are omitted rather than set to `undefined`. */
function withDefined<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value !== undefined ? ({ [key]: value } as Record<K, V>) : {};
}

/**
 * Builds the full poll telemetry analysis from a flat, time-ordered list of
 * parsed events. Cycles are grouped by `runId`; a cycle with a rollup event
 * is grouped by source and joined against completed-cycle metrics/trends,
 * while a cycle with only `stage` events so far is reported in
 * `unresolvedCycles`. Every list is sorted by wall-clock time.
 */
export function buildPollAnalysis(events: PollEvent[]): PollAnalysis {
  const stageEventsByRunId = new Map<string, PollStageEvent[]>();
  const cycleEventByRunId = new Map<string, PollCycleEvent>();

  for (const event of events) {
    if (event.type === 'stage') {
      const list = stageEventsByRunId.get(event.runId) ?? [];
      list.push(event);
      stageEventsByRunId.set(event.runId, list);
    } else {
      // The stream is append-only and a runId should only roll up once; if a
      // duplicate is ever replayed, the last one wins so derivation stays
      // deterministic rather than accumulating stale duplicates.
      cycleEventByRunId.set(event.runId, event);
    }
  }

  const cycleEventsBySource = new Map<string, PollCycleEvent[]>();
  const cycleAnalysesBySource = new Map<string, PollCycleAnalysis[]>();
  const unresolvedCycles: PollCycleAnalysis[] = [];

  const allRunIds = new Set<string>([...stageEventsByRunId.keys(), ...cycleEventByRunId.keys()]);
  for (const runId of allRunIds) {
    const cycleEvent = cycleEventByRunId.get(runId);
    if (cycleEvent) {
      const sourceCycleEvents = cycleEventsBySource.get(cycleEvent.source) ?? [];
      sourceCycleEvents.push(cycleEvent);
      cycleEventsBySource.set(cycleEvent.source, sourceCycleEvents);

      const sourceAnalyses = cycleAnalysesBySource.get(cycleEvent.source) ?? [];
      sourceAnalyses.push(buildResolvedCycleAnalysis(cycleEvent));
      cycleAnalysesBySource.set(cycleEvent.source, sourceAnalyses);
      continue;
    }

    const stageEvents = stageEventsByRunId.get(runId);
    if (stageEvents && stageEvents.length > 0) {
      unresolvedCycles.push(buildUnresolvedCycleAnalysis(runId, stageEvents));
    }
  }

  const sources: PollSourceAnalysis[] = [...cycleAnalysesBySource.entries()]
    .map(([source, analyses]) => {
      const cycles = [...analyses].sort((a, b) => a.startedAtMs - b.startedAtMs);
      const sourceCycleEvents = cycleEventsBySource.get(source) ?? [];
      const successEventsByCompletion = sourceCycleEvents
        .filter((cycle) => cycle.outcome === 'success')
        .map((cycle) => ({
          atMs: toEpochMs(cycle.completedAtUtc) ?? 0,
          records: cycle.records,
          rawMessageThroughputPerSec: cycleRawMessageThroughputPerSec(cycle),
        }))
        .sort((a, b) => a.atMs - b.atMs);

      return {
        source,
        cycles,
        metrics: buildSourceMetrics(sourceCycleEvents),
        durationStats: buildPollDurationStats(sourceCycleEvents),
        // Skipped/failed cycles never reach `successEventsByCompletion`, and a
        // successful cycle missing a finite `inputRows` fact (or with a
        // non-positive `totalMs`) is dropped here rather than contributing a
        // fabricated point.
        throughputPoints: successEventsByCompletion.flatMap((entry) =>
          entry.rawMessageThroughputPerSec === null ? [] : [{ atMs: entry.atMs, value: entry.rawMessageThroughputPerSec }],
        ),
        recordsPoints: successEventsByCompletion.map((entry) => ({ atMs: entry.atMs, value: entry.records })),
        throughputMetrics: buildPollThroughputMetrics(sourceCycleEvents),
        iterationThroughputMetrics: buildPollIterationThroughputMetrics(sourceCycleEvents),
      };
    })
    .sort((a, b) => (a.cycles[0]?.startedAtMs ?? 0) - (b.cycles[0]?.startedAtMs ?? 0));

  unresolvedCycles.sort((a, b) => a.startedAtMs - b.startedAtMs);

  return { sources, unresolvedCycles };
}
