/**
 * Contract for the raw `PollTelemetry__Sink=jsonl` stream produced by
 * `JsonlPollSink`/`PollRun` in the CursorPoller. It is an append-only mixture
 * of `stage` (progressive span boundaries) and `cycle` (final rollup) events,
 * joined by `runId` — one poll cycle per `runId`. This contract intentionally
 * differs from the benchmark JSONL contract and is not shared with it.
 */

export type PollOutcome = 'success' | 'skipped' | 'failed';

export type PollStageEventKind = 'start' | 'end';

/** One closed span in a cycle's reconstructable stage timeline. */
export interface PollTimelineEntry {
  stage: string;
  startMs: number;
  durMs: number;
}

/** A progressive per-stage span boundary, emitted at `Stage()`/scope dispose. */
export interface PollStageEvent {
  type: 'stage';
  ts: string;
  runId: string;
  stage: string;
  ev: PollStageEventKind;
  atMs: number;
  /** Present only when `ev` is `'end'`. */
  durMs?: number;
}

/**
 * The final rollup for one poll cycle. Only the fields the visualizer's
 * required metrics depend on are modeled explicitly; every other producer
 * fact (e.g. `caughtUp`, `scanWidthSec`, `getSnapshotRu`, `selectivity`,
 * `cursorReadMs`, `sealMs`) is preserved verbatim in `facts` so consumers can
 * opt into it without this contract needing to enumerate every dimension the
 * producer may add or omit.
 */
export interface PollCycleEvent {
  type: 'cycle';
  ts: string;
  runId: string;
  source: string;
  outcome: PollOutcome;
  startedAtUtc: string;
  completedAtUtc: string;
  totalMs: number;
  records: number;
  recordsPerSec: number;
  timeline: PollTimelineEntry[];
  /** Batches sealed this cycle (a.k.a. users); absent for skipped/early-failed cycles. */
  users?: number;
  /** Seconds the seal watermark trails wall clock at the start of the cycle. */
  cursorLagSec?: number;
  /** Kusto seal-query duration in ms, when the seal stage ran. */
  kustoMs?: number;
  /** Row-mapping duration in ms, when the seal stage ran. */
  mapMs?: number;
  /** `write` stage duration in ms. */
  writeMs?: number;
  /** `advance` stage duration in ms. */
  advanceMs?: number;
  /** Request units spent writing interactions, when the sink reports RU. */
  writeInteractionsRu?: number;
  /** Cosmos SDK retries observed during the write stage. */
  cosmosRetryCount?: number;
  /** Cosmos HTTP 429 responses observed during the write stage. */
  cosmos429Count?: number;
  /** Cosmos write operations attempted during the write stage. */
  cosmosWriteAttempted?: number;
  /** Cosmos write operations that succeeded during the write stage. */
  cosmosWriteSucceeded?: number;
  /** Cosmos write operations that failed during the write stage. */
  cosmosWriteFailed?: number;
  /** Cosmos write operations cancelled during the write stage. */
  cosmosWriteCancelled?: number;
  /** Stage active when a failed cycle faulted; may be absent if disposed outside any stage. */
  failingStage?: string;
  /** Exception type name for a failed cycle. */
  error?: string;
  /** The raw, validated JSON object for this line, including every producer fact. */
  facts: Record<string, unknown>;
}

export type PollEvent = PollStageEvent | PollCycleEvent;

/** A non-fatal issue found while parsing one line of the poll JSONL stream. */
export interface PollParseWarning {
  line: number;
  message: string;
  raw: string;
}

export interface PollParseResult {
  events: PollEvent[];
  warnings: PollParseWarning[];
}
