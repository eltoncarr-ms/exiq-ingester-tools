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
  totalUsers?: number;
  avgSuccessfulRecordsPerSec?: number;
  avgCycleMs?: number;
  avgKustoMs?: number;
  avgMapMs?: number;
  avgWriteMs?: number;
  avgAdvanceMs?: number;
  latestCursorLagSec?: number;
  totalWriteInteractionsRu?: number;
}

export interface PollSourceAnalysis {
  source: string;
  /** Completed cycles for this source, sorted by wall-clock start time. */
  cycles: PollCycleAnalysis[];
  metrics: PollSourceMetrics;
  /** Successful-cycle records/sec, plotted at cycle completion time. */
  throughputPoints: PollTrendPoint[];
  /** Successful-cycle record counts, plotted at cycle completion time. */
  recordsPoints: PollTrendPoint[];
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

function buildSourceMetrics(cycles: PollCycleEvent[]): PollSourceMetrics {
  const successCycles = cycles.filter((cycle) => cycle.outcome === 'success');

  return {
    cycleCount: cycles.length,
    outcomeCounts: {
      success: successCycles.length,
      skipped: cycles.filter((cycle) => cycle.outcome === 'skipped').length,
      failed: cycles.filter((cycle) => cycle.outcome === 'failed').length,
    },
    totalRecords: cycles.reduce((sum, cycle) => sum + cycle.records, 0),
    ...withDefined('totalUsers', sumDefined(cycles.map((cycle) => cycle.users))),
    ...withDefined('avgSuccessfulRecordsPerSec', average(successCycles.map((cycle) => cycle.recordsPerSec))),
    ...withDefined('avgCycleMs', average(cycles.map((cycle) => cycle.totalMs))),
    ...withDefined('avgKustoMs', average(definedNumbers(cycles.map((cycle) => cycle.kustoMs)))),
    ...withDefined('avgMapMs', average(definedNumbers(cycles.map((cycle) => cycle.mapMs)))),
    ...withDefined('avgWriteMs', average(definedNumbers(cycles.map((cycle) => cycle.writeMs)))),
    ...withDefined('avgAdvanceMs', average(definedNumbers(cycles.map((cycle) => cycle.advanceMs)))),
    ...withDefined('latestCursorLagSec', latestDefinedBy(cycles, (cycle) => cycle.cursorLagSec)),
    ...withDefined('totalWriteInteractionsRu', sumDefined(cycles.map((cycle) => cycle.writeInteractionsRu))),
  };
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
        .map((cycle) => ({ atMs: toEpochMs(cycle.completedAtUtc) ?? 0, records: cycle.records, recordsPerSec: cycle.recordsPerSec }))
        .sort((a, b) => a.atMs - b.atMs);

      return {
        source,
        cycles,
        metrics: buildSourceMetrics(sourceCycleEvents),
        throughputPoints: successEventsByCompletion.map((entry) => ({ atMs: entry.atMs, value: entry.recordsPerSec })),
        recordsPoints: successEventsByCompletion.map((entry) => ({ atMs: entry.atMs, value: entry.records })),
      };
    })
    .sort((a, b) => (a.cycles[0]?.startedAtMs ?? 0) - (b.cycles[0]?.startedAtMs ?? 0));

  unresolvedCycles.sort((a, b) => a.startedAtMs - b.startedAtMs);

  return { sources, unresolvedCycles };
}
