/**
 * Hand-built fixture builder functions for the App Insights completed-cycle
 * contract. Follows the same convention as src/poll/sample.ts: every builder
 * returns a raw row object with PascalCase keys matching the KQL | project
 * column list, ready to pass through normalize.ts.
 *
 * Overrides: pass `undefined` for a key to omit it from the raw row (simulating
 * an unobserved/missing field). Pass `null` for an explicitly-null JSON value.
 */
import type { RawCycleRow } from './types';

/**
 * Base raw row for a successfully-completed, singleton (non-sharded), legacy
 * lane attempt with a representative set of filled-in fields. All scenarios
 * override from this base.
 */
function base(overrides: RawCycleRow = {}): RawCycleRow {
  const row: RawCycleRow = {
    RowKind: 'laneAttempt',
    EventTimeUtc: '2026-06-01T12:00:00.0000000Z',
    IngestionTimeUtc: '2026-06-01T12:00:05.0000000Z',
    IngestionDelaySeconds: 5.0,
    AppRoleName: 'eiq-test-row-wus3-api-xnmmvm',
    AppRoleInstance: 'RoleInstance_1',
    Source: 'portal-firehose',
    SchemaVersion: '4',
    Build: 'build-abc123',
    RunId: 'run-singleton-success-1',
    SweepId: 'sweep-abc',
    FunctionInvocationId: 'func-abc',
    ShardId: '',
    ShardCount: null,
    HashVersion: null,
    BandId: '1/singleton/h1:638844336000000000:638844372000000000',
    PageNumber: 1,
    Outcome: 'success',
    ProgressKind: 'bandCommit',
    SkipReason: '',
    Error: '',
    FailingStage: '',
    LeaseAcquired: true,
    LeaseAcquireOutcome: 'acquired',
    LeaseLost: false,
    ShardValidationOutcome: '',
    ExpectedShardCount: null,
    MissingShardCount: null,
    MismatchedShardCount: null,
    QueryCompleteness: 'complete',
    ExecutionMode: 'legacy',
    StartedAtUtc: '2026-06-01T11:59:50.0000000Z',
    CompletedAtUtc: '2026-06-01T12:00:00.0000000Z',
    TotalMs: 10000,
    LeaseMs: 50,
    CursorReadMs: 20,
    KustoMs: 7500,
    MapMs: null,
    WriteMs: 1800,
    AdvanceMs: 100,
    RawInputProbeMs: null,
    KustoThrottleRetryCount: 0,
    KustoThrottleDelayMs: 0,
    KustoThrottleOutcome: '',
    Records: 1200,
    RecordsPerSec: 120.0,
    RowsScanned: null,
    RowsReturned: 1250,
    RowsMapped: 1210,
    DuplicateCollapsed: 5,
    ContractInvalid: 5,
    MaxRows: 50000,
    HasMore: false,
    BandDrained: true,
    ResumedPending: false,
    CaughtUp: true,
    CursorBeforeUtc: '2026-06-01T11:00:00.0000000Z',
    CursorAfterUtc: '2026-06-01T11:59:50.0000000Z',
    CommittedSourceVersionUtc: '2026-06-01T11:59:50.0000000Z',
    CommittedProgressSeconds: 3590.0,
    EligibleThroughUtc: '2026-06-01T12:00:00.0000000Z',
    BacklogBeforeSeconds: 3600.0,
    BacklogAfterSeconds: 10.0,
    CursorLagAfterSeconds: 10.0,
    SealAfterUtc: '2026-06-01T12:00:00.0000000Z',
    SealBeforeUtc: '2026-06-01T11:00:00.0000000Z',
    RawFromUtc: null,
    RawToUtc: null,
    IdleGapSeconds: 2.0,
    RereadCandidates: 0,
    RawScanRows: null,
    RawBandRows: null,
    EnableRawInputCountProbe: false,
    RawInputCountProbeTimeoutSeconds: null,
    SafetyLagSeconds: 60.0,
    KustoThrottleRetryBudgetSeconds: 30.0,
    MaxCatchUpWindow: '01:00:00',
    LeaseDuration: '00:01:00',
    MaxConcurrentShards: null,
    EffectiveConcurrentShards: null,
    MaxConcurrentUserWrites: 4,
    MaxConcurrentBulkWrites: null,
    MaxConcurrentDestinationWrites: 4,
    ActiveWriteMode: 'transactional',
    CosmosWriteMode: 'transactional',
    SnapshotWrites: true,
    EnableBulkInteractionWrites: false,
    EnableContentResponseOnWrite: false,
    CosmosAttempted: 1200,
    CosmosSucceeded: 1200,
    CosmosFailed: 0,
    CosmosCancelled: 0,
    WriteInteractionsSuccessRu: null,
    WriteInteractionsRu: null,
    InteractionWriteRu: 3100.0,
    InteractionWriteRuComplete: 'complete',
    GetSnapshotRu: null,
    UpsertSnapshotRu: null,
    TotalCosmosRu: null,
    SdkFailedServiceRequestCount: 0,
    Terminal429OperationCount: 0,
    TerminalRetryAfterMs: null,
    CheckpointOutcome: 'committed',
    DefinitionPairHash: 'pair-hash-abc',
    DefinitionHash: 'def-hash-abc',
    KqlHash: 'kql-hash-abc',
    PairVersion: 7,
    EventType: 'CursorPoll.Cycle',
    ManagedBytes: 120_000_000,
    WorkingSetBytes: 250_000_000,
    GcHeapBytes: 80_000_000,
    ...overrides,
  };

  for (const key of Object.keys(row)) {
    if (row[key] === undefined) delete row[key];
  }

  return row;
}

/** Scenario A: Singleton lane, legacy mode, success. */
export function singletonLaneRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base(overrides);
}

/** Scenario B: Sharded lane (shard 1 of 3), drain-safe mode, success. */
export function shardedLaneRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-sharded-1',
    ShardId: '1',
    ShardCount: 3,
    HashVersion: 2,
    BandId: '3/1/h2:638844336000000000:638844372000000000',
    PageNumber: 1,
    ExecutionMode: 'drainSafe',
    KustoMs: 6000,
    MapMs: 500,
    RowsScanned: 1300,
    RawInputProbeMs: 120,
    RawScanRows: 1300,
    RawBandRows: 1250,
    EnableRawInputCountProbe: true,
    RawInputCountProbeTimeoutSeconds: 15,
    CursorLagAfterSeconds: 18,
    MaxConcurrentShards: 3,
    EffectiveConcurrentShards: 3,
    InteractionWriteRu: 3900.0,
    InteractionWriteRuComplete: 'complete',
    ...overrides,
  });
}

/** Scenario C: New single-page band with both rawScanRows and rawBandRows populated. */
export function bandCommitRow(overrides: RawCycleRow = {}): RawCycleRow {
  return shardedLaneRow({
    RunId: 'run-band-commit-1',
    EventTimeUtc: '2026-06-01T12:03:00.0000000Z',
    ShardId: '2',
    BandId: '3/2/h2:638844372000000000:638844378000000000',
    PageNumber: 1,
    ProgressKind: 'bandCommit',
    ResumedPending: false,
    HasMore: false,
    BandDrained: true,
    RawScanRows: 1500,
    RawBandRows: 1450,
    Records: 1400,
    CursorLagAfterSeconds: 12,
    InteractionWriteRu: 4100.0,
    InteractionWriteRuComplete: 'complete',
    ...overrides,
  });
}

/** Scenario D: First page of a multi-page band; rawBandRows appears only here. */
export function continuedBandFirstPageRow(overrides: RawCycleRow = {}): RawCycleRow {
  return shardedLaneRow({
    RunId: 'run-band-page-1',
    EventTimeUtc: '2026-06-01T12:04:00.0000000Z',
    ShardId: '0',
    BandId: '3/0/h2:638844378000000000:638844384000000000',
    PageNumber: 1,
    ProgressKind: 'continuation',
    HasMore: true,
    BandDrained: false,
    ResumedPending: false,
    RawScanRows: 900,
    RawBandRows: 880,
    Records: 600,
    CursorLagAfterSeconds: 20,
    InteractionWriteRu: 1800.0,
    InteractionWriteRuComplete: 'complete',
    ...overrides,
  });
}

/** Scenario E: Resumed continuation on the same band; rawBandRows must stay absent. */
export function continuedBandResumedRow(overrides: RawCycleRow = {}): RawCycleRow {
  return shardedLaneRow({
    RunId: 'run-band-page-2',
    EventTimeUtc: '2026-06-01T12:05:00.0000000Z',
    ShardId: '0',
    BandId: '3/0/h2:638844378000000000:638844384000000000',
    PageNumber: 2,
    ProgressKind: 'continuation',
    HasMore: true,
    BandDrained: false,
    ResumedPending: true,
    RawScanRows: 650,
    RawBandRows: undefined,
    Records: 420,
    CursorLagAfterSeconds: 24,
    InteractionWriteRu: 1200.0,
    InteractionWriteRuComplete: 'complete',
    ...overrides,
  });
}

/** Scenario F: Bulk write mode, drain-safe, success with bulk RU. */
export function bulkWriteModeRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-bulk-1',
    ExecutionMode: 'drainSafe',
    BandId: '1/singleton/h1:638844390000000000:638844396000000000',
    ActiveWriteMode: 'bulk',
    CosmosWriteMode: 'bulk',
    EnableBulkInteractionWrites: true,
    WriteInteractionsSuccessRu: 4200.0,
    WriteInteractionsRu: null,
    InteractionWriteRu: 4200.0,
    InteractionWriteRuComplete: 'complete',
    TotalCosmosRu: 4200.0,
    KustoMs: 5500,
    MapMs: 420,
    RowsScanned: 1250,
    RawInputProbeMs: 95,
    RawScanRows: 1250,
    RawBandRows: 1250,
    EnableRawInputCountProbe: true,
    RawInputCountProbeTimeoutSeconds: 15,
    ...overrides,
  });
}

/** Scenario G: Lease contention (skipped — lease not acquired). */
export function leaseContentionRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-contention-1',
    BandId: '',
    PageNumber: null,
    Outcome: 'skipped',
    ProgressKind: undefined,
    SkipReason: 'leaseContention',
    LeaseAcquired: false,
    LeaseAcquireOutcome: 'contention',
    LeaseLost: null,
    TotalMs: 15,
    LeaseMs: 10,
    CursorReadMs: null,
    KustoMs: null,
    MapMs: null,
    WriteMs: null,
    AdvanceMs: null,
    Records: null,
    RecordsPerSec: null,
    RowsReturned: null,
    RowsMapped: null,
    DuplicateCollapsed: null,
    ContractInvalid: null,
    HasMore: null,
    BandDrained: null,
    ResumedPending: null,
    CaughtUp: null,
    CommittedProgressSeconds: null,
    CursorLagAfterSeconds: null,
    RawScanRows: null,
    RawBandRows: null,
    InteractionWriteRu: null,
    InteractionWriteRuComplete: 'none',
    CosmosAttempted: null,
    CosmosSucceeded: null,
    CosmosFailed: null,
    CosmosCancelled: null,
    CheckpointOutcome: '',
    ...overrides,
  });
}

/**
 * Scenario H: Shard-set validation failure sweep.
 * rowKind = 'shardSetValidationFailedSweep'; no shardId.
 */
export function shardValidationFailureRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RowKind: 'shardSetValidationFailedSweep',
    RunId: 'run-validation-fail-1',
    BandId: '',
    PageNumber: null,
    ShardId: '',
    ShardCount: null,
    Outcome: 'skipped',
    ProgressKind: undefined,
    SkipReason: 'shardValidationFailed',
    ShardValidationOutcome: 'missingShards',
    ExpectedShardCount: 3,
    MissingShardCount: 1,
    MismatchedShardCount: 0,
    LeaseAcquired: null,
    TotalMs: 80,
    KustoMs: null,
    MapMs: null,
    WriteMs: null,
    AdvanceMs: null,
    Records: null,
    RecordsPerSec: null,
    RowsReturned: null,
    RowsMapped: null,
    DuplicateCollapsed: null,
    ContractInvalid: null,
    HasMore: null,
    BandDrained: null,
    ResumedPending: null,
    CaughtUp: null,
    CommittedProgressSeconds: null,
    CursorLagAfterSeconds: null,
    RawScanRows: null,
    RawBandRows: null,
    InteractionWriteRu: null,
    InteractionWriteRuComplete: 'none',
    CosmosAttempted: null,
    CosmosSucceeded: null,
    CosmosFailed: null,
    CosmosCancelled: null,
    ...overrides,
  });
}

/** Scenario I: Cancelled cycle. */
export function cancelledRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-cancelled-1',
    Outcome: 'cancelled',
    ProgressKind: undefined,
    FailingStage: 'write',
    TotalMs: 5200,
    WriteMs: 800,
    AdvanceMs: null,
    CursorLagAfterSeconds: null,
    RawScanRows: 700,
    RawBandRows: undefined,
    InteractionWriteRu: 580.0,
    InteractionWriteRuComplete: 'partial',
    CosmosFailed: 10,
    CosmosCancelled: 35,
    CosmosSucceeded: 5,
    TotalCosmosRu: 580.0,
    CheckpointOutcome: '',
    ...overrides,
  });
}

/** Scenario J: Missing optional fields (bare minimum row — many nulls). */
export function missingOptionalFieldsRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-missing-opts-1',
    IngestionTimeUtc: null,
    IngestionDelaySeconds: null,
    KustoMs: null,
    MapMs: null,
    WriteMs: null,
    AdvanceMs: null,
    Records: null,
    RecordsPerSec: null,
    RowsReturned: null,
    RowsMapped: null,
    DuplicateCollapsed: null,
    ContractInvalid: null,
    MaxRows: null,
    HasMore: null,
    BandDrained: null,
    ResumedPending: null,
    CaughtUp: null,
    CommittedProgressSeconds: null,
    BacklogBeforeSeconds: null,
    BacklogAfterSeconds: null,
    CursorBeforeUtc: null,
    CursorAfterUtc: null,
    CursorLagAfterSeconds: null,
    IdleGapSeconds: null,
    RawScanRows: null,
    RawBandRows: null,
    SafetyLagSeconds: null,
    CosmosAttempted: null,
    CosmosSucceeded: null,
    CosmosFailed: null,
    CosmosCancelled: null,
    WriteInteractionsSuccessRu: null,
    InteractionWriteRu: null,
    InteractionWriteRuComplete: undefined,
    TotalCosmosRu: null,
    SdkFailedServiceRequestCount: null,
    Terminal429OperationCount: null,
    ManagedBytes: null,
    WorkingSetBytes: null,
    GcHeapBytes: null,
    ...overrides,
  });
}

/**
 * Scenario K: Mixed-schema row (pre-schema, blank schemaVersion replaced by
 * the KQL sentinel "pre-schema", missing modern fields).
 */
export function mixedSchemaRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-pre-schema-1',
    SchemaVersion: 'pre-schema',
    BandId: '',
    PageNumber: undefined,
    ExecutionMode: 'unknown',
    ProgressKind: undefined,
    KustoMs: null,
    MapMs: null,
    RowsScanned: null,
    RowsReturned: null,
    RowsMapped: null,
    DuplicateCollapsed: null,
    ContractInvalid: null,
    CursorLagAfterSeconds: undefined,
    RawScanRows: undefined,
    RawBandRows: undefined,
    InteractionWriteRu: undefined,
    InteractionWriteRuComplete: undefined,
    CosmosAttempted: null,
    CosmosSucceeded: null,
    CosmosFailed: null,
    CosmosCancelled: null,
    ...overrides,
  });
}

/** Scenario L: Observed-zero row (records = 0, not null). */
export function observedZeroRow(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-observed-zero-1',
    Outcome: 'success',
    ProgressKind: 'noWork',
    Records: 0,
    RecordsPerSec: 0,
    BacklogBeforeSeconds: 0,
    BacklogAfterSeconds: 0,
    CursorLagAfterSeconds: 0,
    CommittedProgressSeconds: 0,
    RawScanRows: 0,
    RawBandRows: 0,
    InteractionWriteRu: 0,
    InteractionWriteRuComplete: 'none',
    CosmosAttempted: 0,
    CosmosSucceeded: 0,
    CosmosFailed: 0,
    CosmosCancelled: 0,
    SdkFailedServiceRequestCount: 0,
    Terminal429OperationCount: 0,
    ...overrides,
  });
}

/**
 * Scenario M: Row with an unknown additive fact (extra key not in the typed
 * DTO). The extra key should be preserved in the facts bag by normalize.ts
 * and never appear as a typed field.
 */
export function unknownAdditiveFact(overrides: RawCycleRow = {}): RawCycleRow {
  return base({
    RunId: 'run-additive-1',
    ExperimentalThrottleScore: 0.72,
    AnotherUnknownFact: 'some-value',
    ...overrides,
  });
}

/**
 * A compact representative array of raw fixture rows covering the full
 * scenario matrix. Use this as the checked-in sample input for tests and
 * the fixture mode in AppInsightsPage.
 */
export const SAMPLE_RAW_ROWS: RawCycleRow[] = [
  singletonLaneRow(),
  shardedLaneRow({ RunId: 'run-sharded-1', ShardId: '1' }),
  bandCommitRow(),
  continuedBandFirstPageRow(),
  continuedBandResumedRow(),
  bulkWriteModeRow(),
  leaseContentionRow(),
  shardValidationFailureRow(),
  cancelledRow(),
  missingOptionalFieldsRow(),
  mixedSchemaRow(),
  observedZeroRow(),
  unknownAdditiveFact(),
];
