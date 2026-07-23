/**
 * Azure Monitor query client — the ONLY file that imports @azure/identity
 * and @azure/monitor-query. Isolated so that npm test, npm run build, and
 * npm run typecheck:test all pass without these packages installed.
 *
 * Prerequisites (not installable in the sandbox — see README for instructions):
 *   npm install @azure/identity @azure/monitor-query
 *
 * Required role on the target workspace/resource:
 *   Log Analytics Reader  OR  Monitoring Reader
 *
 * Authentication: uses the current Azure CLI login identity.
 *   Run "az login" (or "az login --tenant <tenantId>") before starting the server.
 */

// These imports intentionally fail if the packages aren't installed.
// The rest of the codebase never imports this file, so tests still pass.
import { AzureCliCredential } from '@azure/identity';
import { LogsQueryClient } from '@azure/monitor-query';

import type { AppInsightsQueryClient, QueryParams } from './queryEngine.js';
import type { RawCycleRow } from '../src/appinsights/types.js';

const COMPLETED_CYCLE_KQL = `
let ToNullableBool = (value:dynamic) { case(tolower(tostring(value)) == 'true', true, tolower(tostring(value)) == 'false', false, bool(null)) };
let PositiveTicksToUtc = (ticks:long) { iif(isnull(ticks) or ticks <= 0, datetime(null), datetime(0001-01-01) + (ticks * 1tick)) };
let TicksToSeconds = (ticks:long) { iif(isnull(ticks), real(null), ticks / 1e7) };
AppEvents
| where TimeGenerated > ago({LOOKBACK} * 1h)
| where AppRoleName == '{APP_ROLE}'
| where Name == 'CursorPoll.Cycle'
| extend IngestionTimeUtc = ingestion_time()
| extend IngestionDelaySeconds = iif(isnull(IngestionTimeUtc), real(null), datetime_diff('millisecond', IngestionTimeUtc, TimeGenerated) / 1000.0)
| extend RawShardId = tostring(Properties['shardId'])
| extend SkipReason = tostring(Properties['skipReason'])
| extend RowKind = case(isempty(RawShardId) and SkipReason == 'shardValidationFailed', 'shardSetValidationFailedSweep', 'laneAttempt')
| extend EventTimeUtc = TimeGenerated
| extend Source = tostring(Properties['source'])
| extend SchemaVersion = case(isempty(tostring(Properties['schemaVersion'])), 'pre-schema', tostring(Properties['schemaVersion']))
| extend Build = tostring(Properties['build'])
| extend RunId = tostring(Properties['runId'])
| extend SweepId = tostring(Properties['sweepId'])
| extend FunctionInvocationId = tostring(Properties['functionInvocationId'])
| extend ShardId = iif(isempty(RawShardId), '', RawShardId)
| extend BandId = tostring(Properties['bandId'])
| extend PageNumber = tolong(Measurements['pageNumber'])
| extend ShardCount = tolong(Measurements['shardCount'])
| extend HashVersion = tolong(Measurements['hashVersion'])
| extend Outcome = tostring(Properties['outcome'])
| extend ProgressKind = tostring(Properties['progressKind'])
| extend Error = tostring(Properties['error'])
| extend FailingStage = tostring(Properties['failingStage'])
| extend LeaseAcquireOutcome = tostring(Properties['leaseAcquireOutcome'])
| extend LeaseAcquired = ToNullableBool(Properties['leaseAcquired'])
| extend LeaseLost = ToNullableBool(Properties['leaseLost'])
| extend ShardValidationOutcome = tostring(Properties['shardValidationOutcome'])
| extend ExpectedShardCount = tolong(Measurements['expectedShardCount'])
| extend MissingShardCount = tolong(Measurements['missingShardCount'])
| extend MismatchedShardCount = tolong(Measurements['mismatchedShardCount'])
| extend QueryCompleteness = tostring(Properties['queryCompleteness'])
| extend ExecutionMode = case(ToNullableBool(Properties['enableDrainSafePaging']) == true, 'drainSafe', ToNullableBool(Properties['enableDrainSafePaging']) == false, 'legacy', 'unknown')
| extend StartedAtUtc = todatetime(Properties['startedAtUtc'])
| extend CompletedAtUtc = todatetime(Properties['completedAtUtc'])
| extend TotalMs = todouble(Measurements['totalMs'])
| extend LeaseMs = todouble(Measurements['leaseMs'])
| extend CursorReadMs = todouble(Measurements['cursorReadMs'])
| extend KustoMs = todouble(Measurements['kustoMs'])
| extend MapMs = todouble(Measurements['mapMs'])
| extend WriteMs = todouble(Measurements['writeMs'])
| extend AdvanceMs = todouble(Measurements['advanceMs'])
| extend RawInputProbeMs = todouble(Measurements['rawInputProbeMs'])
| extend KustoThrottleRetryCount = tolong(Measurements['kustoThrottleRetryCount'])
| extend KustoThrottleDelayMs = todouble(Measurements['kustoThrottleDelayMs'])
| extend KustoThrottleOutcome = tostring(Properties['kustoThrottleOutcome'])
| extend Records = tolong(Measurements['records'])
| extend RecordsPerSec = todouble(Measurements['recordsPerSec'])
| extend RowsScanned = tolong(Measurements['rowsScanned'])
| extend RowsReturned = tolong(Measurements['rowsReturned'])
| extend RowsMapped = tolong(Measurements['rowsMapped'])
| extend DuplicateCollapsed = tolong(Measurements['duplicateCollapsed'])
| extend ContractInvalid = tolong(Measurements['contractInvalid'])
| extend MaxRows = tolong(Measurements['maxRows'])
| extend HasMore = ToNullableBool(Properties['hasMore'])
| extend BandDrained = ToNullableBool(Properties['bandDrained'])
| extend ResumedPending = ToNullableBool(Properties['resumedPending'])
| extend CaughtUp = ToNullableBool(Properties['caughtUp'])
| extend CursorBeforeTicks = tolong(Measurements['cursorBefore'])
| extend CursorAfterTicks = tolong(Measurements['cursorAfter'])
| extend CommittedProgressTicks = tolong(Measurements['committedProgressTicks'])
| extend CheckpointProgressTicks = tolong(Measurements['checkpointProgressTicks'])
| extend EligibleThroughTicks = tolong(Measurements['eligibleThroughTicks'])
| extend BacklogBeforeTicks = tolong(Measurements['backlogBeforeTicks'])
| extend BacklogAfterTicks = tolong(Measurements['backlogAfterTicks'])
| extend CursorBeforeUtc = PositiveTicksToUtc(CursorBeforeTicks)
| extend CursorAfterUtc = PositiveTicksToUtc(CursorAfterTicks)
| extend CommittedSourceVersionUtc = PositiveTicksToUtc(tolong(Measurements['committedSourceVersion']))
| extend EligibleThroughUtc = PositiveTicksToUtc(EligibleThroughTicks)
| extend CommittedProgressSeconds = TicksToSeconds(CommittedProgressTicks)
| extend CheckpointProgressSeconds = TicksToSeconds(CheckpointProgressTicks)
| extend BacklogBeforeSeconds = TicksToSeconds(BacklogBeforeTicks)
| extend BacklogAfterSeconds = TicksToSeconds(BacklogAfterTicks)
| extend CursorLagAfterSeconds = todouble(Measurements['cursorLagAfterSeconds'])
| extend SealAfterUtc = PositiveTicksToUtc(tolong(Measurements['sealAfterTicks']))
| extend SealBeforeUtc = PositiveTicksToUtc(tolong(Measurements['sealBeforeTicks']))
| extend RawFromUtc = PositiveTicksToUtc(tolong(Measurements['rawFromTicks']))
| extend RawToUtc = PositiveTicksToUtc(tolong(Measurements['rawToTicks']))
| extend IdleGapSeconds = todouble(Measurements['idleGapSeconds'])
| extend RereadCandidates = tolong(Measurements['rereadCandidates'])
| extend RawScanRows = tolong(Measurements['rawScanRows'])
| extend RawBandRows = tolong(Measurements['rawBandRows'])
| extend EnableRawInputCountProbe = ToNullableBool(Properties['enableRawInputCountProbe'])
| extend RawInputCountProbeTimeoutSeconds = todouble(Measurements['rawInputCountProbeTimeoutSeconds'])
| extend SafetyLagSeconds = todouble(Measurements['safetyLagSeconds'])
| extend KustoThrottleRetryBudgetSeconds = todouble(Measurements['kustoThrottleRetryBudgetSeconds'])
| extend MaxCatchUpWindow = tostring(Properties['maxCatchUpWindow'])
| extend LeaseDuration = tostring(Properties['leaseDuration'])
| extend MaxConcurrentShards = tolong(Measurements['maxConcurrentShards'])
| extend EffectiveConcurrentShards = tolong(Measurements['effectiveConcurrentShards'])
| extend MaxConcurrentUserWrites = tolong(Measurements['maxConcurrentUserWrites'])
| extend MaxConcurrentBulkWrites = tolong(Measurements['maxConcurrentBulkWrites'])
| extend MaxConcurrentDestinationWrites = tolong(Measurements['maxConcurrentDestinationWrites'])
| extend ActiveWriteMode = tostring(Properties['activeWriteMode'])
| extend CosmosWriteMode = tostring(Properties['cosmosWriteMode'])
| extend SnapshotWrites = ToNullableBool(Properties['snapshotWrites'])
| extend EnableBulkInteractionWrites = ToNullableBool(Properties['enableBulkInteractionWrites'])
| extend EnableContentResponseOnWrite = ToNullableBool(Properties['enableContentResponseOnWrite'])
| extend CosmosAttempted = tolong(Measurements['cosmosAttempted'])
| extend CosmosSucceeded = tolong(Measurements['cosmosSucceeded'])
| extend CosmosFailed = tolong(Measurements['cosmosFailed'])
| extend CosmosCancelled = tolong(Measurements['cosmosCancelled'])
| extend WriteInteractionsSuccessRu = todouble(Measurements['writeInteractionsSuccessRu'])
| extend WriteInteractionsRu = todouble(Measurements['writeInteractionsRu'])
| extend InteractionWriteRu = todouble(Measurements['interactionWriteRu'])
| extend InteractionWriteRuComplete = tostring(Properties['interactionWriteRuComplete'])
| extend GetSnapshotRu = todouble(Measurements['getSnapshotRu'])
| extend UpsertSnapshotRu = todouble(Measurements['upsertSnapshotRu'])
| extend TotalCosmosRu = todouble(Measurements['totalCosmosRu'])
| extend SdkFailedServiceRequestCount = tolong(Measurements['sdkFailedServiceRequestCount'])
| extend Terminal429OperationCount = tolong(Measurements['terminal429OperationCount'])
| extend TerminalRetryAfterMs = todouble(Measurements['terminalRetryAfterMs'])
| extend CheckpointOutcome = tostring(Properties['checkpointOutcome'])
| extend DefinitionPairHash = tostring(Properties['definitionPairHash'])
| extend DefinitionHash = tostring(Properties['definitionHash'])
| extend KqlHash = tostring(Properties['kqlHash'])
| extend PairVersion = tolong(Measurements['pairVersion'])
| extend EventType = tostring(Properties['eventType'])
| extend ManagedBytes = todouble(Measurements['managedBytes'])
| extend WorkingSetBytes = todouble(Measurements['workingSetBytes'])
| extend GcHeapBytes = todouble(Measurements['gcHeapBytes'])
| project RowKind, EventTimeUtc, IngestionTimeUtc, IngestionDelaySeconds,
    AppRoleName, AppRoleInstance, Source, SchemaVersion, Build,
    RunId, SweepId, FunctionInvocationId, ShardId, BandId, PageNumber, ShardCount, HashVersion,
    Outcome, ProgressKind, SkipReason, Error, FailingStage,
    LeaseAcquired, LeaseAcquireOutcome, LeaseLost,
    ShardValidationOutcome, ExpectedShardCount, MissingShardCount, MismatchedShardCount,
    QueryCompleteness, ExecutionMode, StartedAtUtc, CompletedAtUtc,
    TotalMs, LeaseMs, CursorReadMs, KustoMs, MapMs, WriteMs, AdvanceMs, RawInputProbeMs,
    KustoThrottleRetryCount, KustoThrottleDelayMs, KustoThrottleOutcome,
    Records, RecordsPerSec, RowsScanned, RowsReturned, RowsMapped,
    DuplicateCollapsed, ContractInvalid, MaxRows,
    HasMore, BandDrained, ResumedPending, CaughtUp,
    CursorBeforeUtc, CursorAfterUtc, CommittedSourceVersionUtc, CommittedProgressSeconds, CheckpointProgressSeconds,
    EligibleThroughUtc, BacklogBeforeSeconds, BacklogAfterSeconds, CursorLagAfterSeconds,
    SealAfterUtc, SealBeforeUtc, RawFromUtc, RawToUtc,
    IdleGapSeconds, RereadCandidates, RawScanRows, RawBandRows,
    EnableRawInputCountProbe, RawInputCountProbeTimeoutSeconds,
    SafetyLagSeconds, KustoThrottleRetryBudgetSeconds,
    MaxCatchUpWindow, LeaseDuration,
    MaxConcurrentShards, EffectiveConcurrentShards,
    MaxConcurrentUserWrites, MaxConcurrentBulkWrites, MaxConcurrentDestinationWrites,
    ActiveWriteMode, CosmosWriteMode, SnapshotWrites, EnableBulkInteractionWrites, EnableContentResponseOnWrite,
    CosmosAttempted, CosmosSucceeded, CosmosFailed, CosmosCancelled,
    WriteInteractionsSuccessRu, WriteInteractionsRu, InteractionWriteRu, InteractionWriteRuComplete,
    GetSnapshotRu, UpsertSnapshotRu, TotalCosmosRu,
    SdkFailedServiceRequestCount, Terminal429OperationCount, TerminalRetryAfterMs,
    CheckpointOutcome, DefinitionPairHash, DefinitionHash, KqlHash, PairVersion, EventType,
    ManagedBytes, WorkingSetBytes, GcHeapBytes
| order by EventTimeUtc desc
`;

/**
 * Real Azure Monitor client. Uses the current Azure CLI identity.
 * Tokens are obtained lazily and never exposed to the browser.
 */
export class AzureMonitorQueryClient implements AppInsightsQueryClient {
  private readonly client: LogsQueryClient;
  private readonly workspaceId: string;

  constructor(workspaceId: string, tenantId?: string) {
    // AzureCliCredential reads the token from the current Azure CLI session.
    // Pass tenantId to target a specific tenant when the workspace is in a
    // different tenant from the default CLI login.
    const credential = tenantId
      ? new AzureCliCredential({ tenantId })
      : new AzureCliCredential();
    this.client = new LogsQueryClient(credential);
    this.workspaceId = workspaceId;
  }

  async queryCompletedCycles(params: QueryParams): Promise<RawCycleRow[]> {
    const lookbackSeconds = Math.ceil(params.lookbackHours * 60 * 60);
    const kql = COMPLETED_CYCLE_KQL
      .replace('{LOOKBACK}', String(params.lookbackHours))
      .replace('{APP_ROLE}', params.appRoleNameFilter.replace(/'/g, "\\'"));

    const result = await this.client.queryWorkspace(this.workspaceId, kql, {
      duration: `PT${lookbackSeconds}S`,
    });

    if (result.status !== 'Success') {
      throw new Error(`Azure Monitor query did not succeed: ${JSON.stringify(result)}`);
    }

    const table = result.tables[0];
    if (!table) return [];

    const colNames = table.columnDescriptors.map((c) => c.name ?? '');
    return table.rows.map((row) => {
      const obj: RawCycleRow = {};
      for (let i = 0; i < colNames.length; i++) {
        const name = colNames[i]!;
        const val = row[i];
        // Convert Date objects from the SDK to ISO strings
        obj[name] = val instanceof Date ? val.toISOString() : (val ?? null);
      }
      return obj;
    });
  }
}
