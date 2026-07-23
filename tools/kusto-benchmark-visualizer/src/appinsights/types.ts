/**
 * Typed DTO for one completed CursorPoll.Cycle row from the App Insights
 * canonical dashboard query (cursor-poll-app-insights-dashboard.kql).
 *
 * Field names are camelCase mirrors of the KQL `| project` PascalCase column
 * names (e.g. RowKind → rowKind, TotalMs → totalMs). Do NOT import
 * src/poll/types.ts here — the two sources have materially different contracts.
 *
 * Absence contract:
 *   - String dimension fields are empty strings when absent, matching
 *     KQL's tostring() behaviour. Never null for string fields.
 *   - Nullable booleans: boolean | null (null = unobserved).
 *   - Numeric facts: number | null (null = unobserved; 0 = observed zero).
 *     Calculations must NEVER coerce null to 0.
 *   - UTC datetime strings: string | null (null when the underlying tick was
 *     missing or non-positive, as produced by PositiveTicksToUtc in KQL).
 */

/** Identifies the row classification from the KQL RowKind case() expression. */
export type RowKind = 'laneAttempt' | 'shardSetValidationFailedSweep';

/**
 * Kusto paging mode derived from the producer's enableDrainSafePaging property.
 * "unknown" means the property was absent from the event.
 */
export type ExecutionMode = 'legacy' | 'drainSafe' | 'unknown';

/**
 * Raw row shape produced by the KQL export and the loopback server.
 * Keys are PascalCase matching the `| project` column list.
 * Values are JSON-serialised: strings, numbers, booleans, null.
 */
export type RawCycleRow = Record<string, unknown>;

/**
 * Azure Monitor / Log Analytics tabular query-export shape.
 * Accepted as an alternative input to normalize alongside RawCycleRow[].
 */
export interface TabularQueryExport {
  tables: Array<{
    name?: string;
    columns: Array<{ name: string; type?: string }>;
    rows: unknown[][];
  }>;
}

/**
 * One completed CursorPoll.Cycle event, normalized from the KQL
 * cursor-poll-app-insights-dashboard.kql output.
 *
 * The optional `facts` bag holds additive fields present in the raw row that
 * are not part of the typed contract. Calculations MUST NOT read `facts`.
 */
export interface CompletedCycleRow {
  // ── Row classification ────────────────────────────────────────────────────

  /** "laneAttempt" for a completed lane attempt; "shardSetValidationFailedSweep" for a topology-validation failure sweep (no shardId for those rows). */
  rowKind: RowKind;

  // ── Event timing ──────────────────────────────────────────────────────────

  /** App Insights event time (UTC string). Always present. */
  eventTimeUtc: string;
  /** Log Analytics ingestion time (UTC string); null when unavailable. */
  ingestionTimeUtc: string | null;
  /** Seconds from event emission to Log Analytics ingestion; null when unavailable. */
  ingestionDelaySeconds: number | null;

  // ── Deployment identity ────────────────────────────────────────────────────

  /** Application role name (e.g. "eiq-test-row-wus3-api-xnmmvm"). */
  appRoleName: string;
  /** Host instance identity from the App Insights role-instance dimension. */
  appRoleInstance: string;
  /** Logical cursor-lane source identifier. */
  source: string;
  /**
   * Producer schema version. "pre-schema" is substituted by KQL for blank
   * values emitted before the schemaVersion field was added.
   */
  schemaVersion: string;
  /** Build identifier. */
  build: string;

  // ── Run, sweep, shard, and band identity ──────────────────────────────────

  /** Run identifier. */
  runId: string;
  /** Sweep identifier (worker-wake correlation). */
  sweepId: string;
  /** Azure Functions invocation identifier (compatibility alias for sweepId). */
  functionInvocationId: string;
  /**
   * Shard identifier as a STRING property (never a metric, per the KQL bag contract).
   * Empty string for singleton (non-sharded) lanes and for validation-failure sweep rows.
   * Non-empty for sharded lanes. Pair with shardCount to distinguish singleton ""
   * from sharded contexts where shardId could also be "0".
   */
  shardId: string;
  /**
   * Number of shards in the current topology; null when not a sharded run.
   * Use shardCount + shardId together to distinguish singleton from sharded contexts.
   */
  shardCount: number | null;
  /** Hash version for the shard topology. */
  hashVersion: number | null;
  /** Stable opaque band identity shared by every page of one band. Blank when absent. */
  bandId: string;
  /** 1-based page ordinal within a band; null when unknown or absent. */
  pageNumber: number | null;

  // ── Outcome and failure ────────────────────────────────────────────────────

  /** Cycle outcome string from the producer (e.g. "success", "skipped", "failed", "cancelled"). */
  outcome: string;
  /** Durable cursor-mutation progress kind (continuation | bandCommit | noWork). Blank when absent. */
  progressKind: string;
  /** Skip reason (e.g. "shardValidationFailed"). Present on shardSetValidationFailedSweep rows. */
  skipReason: string;
  /** Error type name for a failed cycle. */
  error: string;
  /** Stage active when the cycle faulted. */
  failingStage: string;

  // ── Lease and shard topology validation ───────────────────────────────────

  /** Whether the lease was acquired; null when not yet attempted or not applicable. */
  leaseAcquired: boolean | null;
  /** Lease acquisition outcome descriptor. */
  leaseAcquireOutcome: string;
  /** Whether the lease was lost during the cycle. */
  leaseLost: boolean | null;
  /** Shard topology validation outcome descriptor. */
  shardValidationOutcome: string;
  /** Expected shard count from the topology manifest. */
  expectedShardCount: number | null;
  /** Number of shards missing from the actual topology. */
  missingShardCount: number | null;
  /** Number of shards mismatched in the actual topology. */
  mismatchedShardCount: number | null;
  /** Kusto query completeness descriptor. */
  queryCompleteness: string;

  // ── Execution mode ─────────────────────────────────────────────────────────

  /**
   * Paging mode for this cycle. "legacy" = snapshot-on; "drainSafe" =
   * snapshot-off with safe drain semantics; "unknown" = enableDrainSafePaging
   * property absent from the event.
   *
   * IMPORTANT: legacy and drainSafe kustoMs have different timing boundaries.
   * Do not compare or blend kustoMs across execution modes.
   */
  executionMode: ExecutionMode;

  // ── Cycle timing ───────────────────────────────────────────────────────────

  /** Cycle start time (UTC string); null when absent. */
  startedAtUtc: string | null;
  /** Cycle completion time (UTC string); null when absent. */
  completedAtUtc: string | null;

  // ── Stage durations (milliseconds) ────────────────────────────────────────
  // null means the stage did not run or the fact was unavailable.
  // Never substitute 0 for null — missing is unknown, not fast.

  /** Total cycle wall-clock duration (ms). */
  totalMs: number | null;
  /** Lease acquisition duration (ms). */
  leaseMs: number | null;
  /** Cursor read duration (ms). */
  cursorReadMs: number | null;
  /**
   * Kusto execution duration (ms). Timing boundary differs between legacy and
   * drain-safe modes — do not compare or blend across execution modes.
   * On legacy rows mapMs was unavailable; kustoMs may also be partial or null.
   */
  kustoMs: number | null;
  /**
   * Row-mapping duration (ms). Null on legacy rows where mapMs was unavailable.
   * Do not substitute 0 — null means unknown/unavailable, not fast.
   */
  mapMs: number | null;
  /** Cosmos write stage duration (ms). */
  writeMs: number | null;
  /** Checkpoint advance duration (ms). */
  advanceMs: number | null;
  /** Raw-input count probe duration (ms); null when the probe did not run. */
  rawInputProbeMs: number | null;

  // ── Kusto throttling ───────────────────────────────────────────────────────

  /** Number of Kusto throttle retries observed this cycle. */
  kustoThrottleRetryCount: number | null;
  /** Total delay injected by Kusto throttle back-off (ms). */
  kustoThrottleDelayMs: number | null;
  /** Kusto throttle outcome descriptor. */
  kustoThrottleOutcome: string;

  // ── Record funnel ──────────────────────────────────────────────────────────

  /**
   * Records finalized (destination interactions committed) this cycle.
   * 0 = observed zero (lane ran, no records); null = unobserved.
   */
  records: number | null;
  /** Records per second as reported by the producer (not derived client-side). */
  recordsPerSec: number | null;
  /**
   * Rows scanned by Kusto. Null on legacy rows where this fact was unavailable.
   * Do not substitute 0 — null means unavailable, not "no rows scanned".
   */
  rowsScanned: number | null;
  /** Rows returned from Kusto after server-side filtering. */
  rowsReturned: number | null;
  /** Rows successfully mapped from returned rows. */
  rowsMapped: number | null;
  /** Rows collapsed as duplicates. */
  duplicateCollapsed: number | null;
  /** Rows rejected as contract-invalid. */
  contractInvalid: number | null;
  /** Maximum rows configured for this cycle's Kusto query band. */
  maxRows: number | null;

  // ── Paging and backlog flags ───────────────────────────────────────────────

  /** Whether the Kusto result band had more rows than maxRows (not fully drained). */
  hasMore: boolean | null;
  /** Whether the current source-time band was fully drained. */
  bandDrained: boolean | null;
  /** Whether this cycle resumed a previously pending (partially-drained) state. */
  resumedPending: boolean | null;
  /** Whether the cycle caught up to the eligible-through watermark. */
  caughtUp: boolean | null;

  // ── Source-time watermarks (UTC strings) ──────────────────────────────────
  // Derived from .NET ticks by the KQL PositiveTicksToUtc helper.
  // null when the underlying tick was missing or ≤0.

  /** Cursor watermark before this cycle advanced it. */
  cursorBeforeUtc: string | null;
  /** Cursor watermark after this cycle advanced it. */
  cursorAfterUtc: string | null;
  /** Committed source version UTC. */
  committedSourceVersionUtc: string | null;
  /**
   * Source-time progress committed by this cycle (seconds).
   * 0 = observed no-progress (cycle ran but committed nothing).
   * null = fact was unavailable.
   */
  committedProgressSeconds: number | null;
  /**
   * Source-time progress between durable page checkpoints. Unlike committed
   * progress, continuation pages can report a positive value.
   */
  checkpointProgressSeconds: number | null;
  /** Eligible-through watermark for this cycle's source window. */
  eligibleThroughUtc: string | null;
  /**
   * Backlog before this cycle, in seconds of source-time not yet committed.
   * Do NOT sum backlogBeforeSeconds across shards — use max for fleet health.
   */
  backlogBeforeSeconds: number | null;
  /**
   * Backlog after this cycle, in seconds of source-time not yet committed.
   * Do NOT sum backlogAfterSeconds across shards — use max for fleet health.
   */
  backlogAfterSeconds: number | null;
  /** Raw wall-clock cursor lag after cycle completion; distinct from backlogAfterSeconds. */
  cursorLagAfterSeconds: number | null;
  /** Seal watermark upper bound (UTC). */
  sealAfterUtc: string | null;
  /** Seal watermark lower bound (UTC). */
  sealBeforeUtc: string | null;
  /** Raw-input window start (UTC). */
  rawFromUtc: string | null;
  /** Raw-input window end (UTC). */
  rawToUtc: string | null;

  // ── Paging metadata ────────────────────────────────────────────────────────

  /** Seconds elapsed since the previous cycle for this lane. */
  idleGapSeconds: number | null;
  /** Rows that are candidates for re-read in the next cycle. */
  rereadCandidates: number | null;
  /** Physical per-iteration raw scan count from the raw-input probe. */
  rawScanRows: number | null;
  /** Non-overlapping per-band raw count from the raw-input probe; populated on at most one row per band. */
  rawBandRows: number | null;
  /** Whether the raw-input count probe is enabled. */
  enableRawInputCountProbe: boolean | null;
  /** Timeout configured for the raw-input count probe (seconds). */
  rawInputCountProbeTimeoutSeconds: number | null;
  /** Safety lag threshold (seconds). */
  safetyLagSeconds: number | null;
  /** Kusto throttle retry budget (seconds). */
  kustoThrottleRetryBudgetSeconds: number | null;

  // ── Configuration strings (raw .NET TimeSpan from Properties) ─────────────

  /** Max catch-up window as a .NET TimeSpan string. */
  maxCatchUpWindow: string;
  /** Lease duration as a .NET TimeSpan string. */
  leaseDuration: string;

  // ── Concurrency configuration ──────────────────────────────────────────────

  /** Maximum concurrent shards configured. */
  maxConcurrentShards: number | null;
  /** Effective concurrent shards for this cycle. */
  effectiveConcurrentShards: number | null;
  /** Maximum concurrent user-write operations configured. */
  maxConcurrentUserWrites: number | null;
  /** Maximum concurrent bulk-write operations configured. */
  maxConcurrentBulkWrites: number | null;
  /** Maximum concurrent destination-write operations configured. */
  maxConcurrentDestinationWrites: number | null;

  // ── Write mode ─────────────────────────────────────────────────────────────

  /** Active write mode descriptor (e.g. "bulk", "transactional"). */
  activeWriteMode: string;
  /** Cosmos write mode descriptor. */
  cosmosWriteMode: string;
  /** Whether snapshot writes are enabled. */
  snapshotWrites: boolean | null;
  /** Whether bulk interaction writes are enabled. */
  enableBulkInteractionWrites: boolean | null;
  /** Whether content-response-on-write is enabled. */
  enableContentResponseOnWrite: boolean | null;

  // ── Cosmos partition-batch outcomes ───────────────────────────────────────
  // These count PARTITION-BATCH outcomes — not individual document outcomes.
  // Do not label them as document writes, item operations, or SDK operations.

  /** Partition-batch write attempts. */
  cosmosAttempted: number | null;
  /** Successful partition-batch writes. */
  cosmosSucceeded: number | null;
  /** Failed partition-batch writes. */
  cosmosFailed: number | null;
  /** Cancelled partition-batch writes. */
  cosmosCancelled: number | null;

  // ── Cosmos RU ─────────────────────────────────────────────────────────────
  // Interaction-write RU completeness is now CLOSED for the dedicated
  // interactionWriteRu metric across both bulk and transactional modes.
  // Snapshot success RU is still unavailable, so totalCosmosRu remains a partial
  // diagnostic total and must keep an explicit incomplete label.

  /** Successful BULK interaction-write RU. Not transactional; not snapshot. */
  writeInteractionsSuccessRu: number | null;
  /** Failed-path interaction-write RU (writes that ultimately failed or were terminal). */
  writeInteractionsRu: number | null;
  /** Complete interaction-write RU across success + failure paths; excludes snapshot RU. */
  interactionWriteRu: number | null;
  /** Completeness descriptor for interactionWriteRu (none | partial | complete). Blank when absent. */
  interactionWriteRuComplete: string;
  /** Snapshot-read RU (failure-path only; successful snapshot-read RU unavailable). */
  getSnapshotRu: number | null;
  /** Snapshot-upsert RU (failure-path only; successful snapshot-upsert RU unavailable). */
  upsertSnapshotRu: number | null;
  /**
   * Partial observed Cosmos RU total. NOT a complete cross-mode total.
   * Missing: successful transactional interaction-write RU and successful snapshot RU.
   */
  totalCosmosRu: number | null;

  // ── Cosmos error observations ──────────────────────────────────────────────

  /**
   * SDK-level failed service requests observed. NOT a retry count — the SDK
   * may observe failed service requests without an application-level retry.
   * Do not label this as "retries".
   */
  sdkFailedServiceRequestCount: number | null;
  /**
   * Operations that reached TERMINAL 429 (throttling) failure. NOT the total
   * number of 429 responses — transient 429s absorbed by SDK back-off are not
   * counted. Do not label this as "total 429s".
   */
  terminal429OperationCount: number | null;
  /** Retry-after duration for the terminal throttling failure (ms). */
  terminalRetryAfterMs: number | null;

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  /** Checkpoint write outcome descriptor. */
  checkpointOutcome: string;

  // ── Definition and query hashes ────────────────────────────────────────────

  /** Definition pair hash for change detection. */
  definitionPairHash: string;
  /** Definition hash. */
  definitionHash: string;
  /** KQL query hash. */
  kqlHash: string;
  /** Definition pair version. */
  pairVersion: number | null;
  /** Event type string from the producer. */
  eventType: string;

  // ── Memory metrics ─────────────────────────────────────────────────────────

  /** Managed heap bytes at cycle end. */
  managedBytes: number | null;
  /** Working set bytes at cycle end. */
  workingSetBytes: number | null;
  /** GC heap bytes at cycle end. */
  gcHeapBytes: number | null;

  // ── Additive raw facts ─────────────────────────────────────────────────────

  /**
   * Optional bag preserving unknown additive fields from a wider import source.
   * Present only when the raw input contained fields not in the typed contract.
   * Calculations MUST NOT read this bag — it is for cycle-detail display only.
   */
  facts?: Record<string, unknown>;
}
