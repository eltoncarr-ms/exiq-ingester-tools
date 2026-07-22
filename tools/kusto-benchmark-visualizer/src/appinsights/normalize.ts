/**
 * Pure normalization from raw KQL-export shapes to CompletedCycleRow[].
 *
 * Supported input shapes:
 *   1. RawCycleRow[] — array of flat objects with PascalCase keys, as produced
 *      by the checked-in fixture (sample.ts) and the loopback query server.
 *   2. TabularQueryExport — { tables: [{ columns: [{name,type}], rows: [[…]] }] }
 *      as produced by Azure Monitor Log Analytics exported-query JSON files.
 *
 * All paths enforce:
 *   - Missing stays null — never coerced to 0 or false.
 *   - String dimensions stay as empty strings (matching KQL tostring()).
 *   - shardId is always a string; combined with shardCount it distinguishes
 *     singleton "" from sharded contexts where shardId might also be "0".
 *   - Unknown additive fields are preserved in the optional `facts` bag only;
 *     no typed field is added or removed.
 */

import type { CompletedCycleRow, ExecutionMode, RawCycleRow, RowKind, TabularQueryExport } from './types';

/** Known PascalCase keys from the KQL | project list. Anything else is additive. */
const KNOWN_KEYS = new Set<string>([
  'RowKind', 'EventTimeUtc', 'IngestionTimeUtc', 'IngestionDelaySeconds',
  'AppRoleName', 'AppRoleInstance', 'Source', 'SchemaVersion', 'Build',
  'RunId', 'SweepId', 'FunctionInvocationId', 'ShardId', 'ShardCount', 'HashVersion',
  'BandId', 'PageNumber',
  'Outcome', 'ProgressKind', 'SkipReason', 'Error', 'FailingStage',
  'LeaseAcquired', 'LeaseAcquireOutcome', 'LeaseLost',
  'ShardValidationOutcome', 'ExpectedShardCount', 'MissingShardCount', 'MismatchedShardCount',
  'QueryCompleteness', 'ExecutionMode',
  'StartedAtUtc', 'CompletedAtUtc',
  'TotalMs', 'LeaseMs', 'CursorReadMs', 'KustoMs', 'MapMs', 'WriteMs', 'AdvanceMs', 'RawInputProbeMs',
  'KustoThrottleRetryCount', 'KustoThrottleDelayMs', 'KustoThrottleOutcome',
  'Records', 'RecordsPerSec', 'RowsScanned', 'RowsReturned', 'RowsMapped',
  'DuplicateCollapsed', 'ContractInvalid', 'MaxRows',
  'HasMore', 'BandDrained', 'ResumedPending', 'CaughtUp',
  'CursorBeforeUtc', 'CursorAfterUtc', 'CommittedSourceVersionUtc',
  'CommittedProgressSeconds', 'EligibleThroughUtc',
  'BacklogBeforeSeconds', 'BacklogAfterSeconds', 'CursorLagAfterSeconds',
  'SealAfterUtc', 'SealBeforeUtc', 'RawFromUtc', 'RawToUtc',
  'IdleGapSeconds', 'RereadCandidates', 'RawScanRows', 'RawBandRows',
  'EnableRawInputCountProbe', 'RawInputCountProbeTimeoutSeconds',
  'SafetyLagSeconds', 'KustoThrottleRetryBudgetSeconds',
  'MaxCatchUpWindow', 'LeaseDuration',
  'MaxConcurrentShards', 'EffectiveConcurrentShards',
  'MaxConcurrentUserWrites', 'MaxConcurrentBulkWrites', 'MaxConcurrentDestinationWrites',
  'ActiveWriteMode', 'CosmosWriteMode',
  'SnapshotWrites', 'EnableBulkInteractionWrites', 'EnableContentResponseOnWrite',
  'CosmosAttempted', 'CosmosSucceeded', 'CosmosFailed', 'CosmosCancelled',
  'WriteInteractionsSuccessRu', 'WriteInteractionsRu', 'InteractionWriteRu', 'InteractionWriteRuComplete',
  'GetSnapshotRu', 'UpsertSnapshotRu', 'TotalCosmosRu',
  'SdkFailedServiceRequestCount', 'Terminal429OperationCount', 'TerminalRetryAfterMs',
  'CheckpointOutcome', 'DefinitionPairHash', 'DefinitionHash', 'KqlHash', 'PairVersion', 'EventType',
  'ManagedBytes', 'WorkingSetBytes', 'GcHeapBytes',
]);

// ── Primitive extractors ────────────────────────────────────────────────────

function str(raw: unknown, fallback = ''): string {
  if (raw === null || raw === undefined) return fallback;
  return String(raw);
}

function nullableStr(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  return s === '' ? null : s;
}

function num(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function bool(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

function rowKind(raw: unknown): RowKind {
  const s = str(raw);
  if (s === 'shardSetValidationFailedSweep') return 'shardSetValidationFailedSweep';
  return 'laneAttempt';
}

function executionMode(raw: unknown): ExecutionMode {
  const s = str(raw);
  if (s === 'legacy') return 'legacy';
  if (s === 'drainSafe') return 'drainSafe';
  return 'unknown';
}

// ── Additive facts bag ─────────────────────────────────────────────────────

function extractFacts(raw: RawCycleRow): Record<string, unknown> | undefined {
  const bag: Record<string, unknown> = {};
  let hasExtra = false;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      bag[key] = raw[key];
      hasExtra = true;
    }
  }
  return hasExtra ? bag : undefined;
}

// ── Row normalization ──────────────────────────────────────────────────────

function normalizeRow(raw: RawCycleRow): CompletedCycleRow {
  return {
    rowKind: rowKind(raw['RowKind']),
    eventTimeUtc: str(raw['EventTimeUtc']),
    ingestionTimeUtc: nullableStr(raw['IngestionTimeUtc']),
    ingestionDelaySeconds: num(raw['IngestionDelaySeconds']),
    appRoleName: str(raw['AppRoleName']),
    appRoleInstance: str(raw['AppRoleInstance']),
    source: str(raw['Source']),
    schemaVersion: str(raw['SchemaVersion']),
    build: str(raw['Build']),
    runId: str(raw['RunId']),
    sweepId: str(raw['SweepId']),
    functionInvocationId: str(raw['FunctionInvocationId']),
    shardId: str(raw['ShardId']),
    shardCount: num(raw['ShardCount']),
    hashVersion: num(raw['HashVersion']),
    bandId: str(raw['BandId']),
    pageNumber: num(raw['PageNumber']),
    outcome: str(raw['Outcome']),
    progressKind: str(raw['ProgressKind']),
    skipReason: str(raw['SkipReason']),
    error: str(raw['Error']),
    failingStage: str(raw['FailingStage']),
    leaseAcquired: bool(raw['LeaseAcquired']),
    leaseAcquireOutcome: str(raw['LeaseAcquireOutcome']),
    leaseLost: bool(raw['LeaseLost']),
    shardValidationOutcome: str(raw['ShardValidationOutcome']),
    expectedShardCount: num(raw['ExpectedShardCount']),
    missingShardCount: num(raw['MissingShardCount']),
    mismatchedShardCount: num(raw['MismatchedShardCount']),
    queryCompleteness: str(raw['QueryCompleteness']),
    executionMode: executionMode(raw['ExecutionMode']),
    startedAtUtc: nullableStr(raw['StartedAtUtc']),
    completedAtUtc: nullableStr(raw['CompletedAtUtc']),
    totalMs: num(raw['TotalMs']),
    leaseMs: num(raw['LeaseMs']),
    cursorReadMs: num(raw['CursorReadMs']),
    kustoMs: num(raw['KustoMs']),
    mapMs: num(raw['MapMs']),
    writeMs: num(raw['WriteMs']),
    advanceMs: num(raw['AdvanceMs']),
    rawInputProbeMs: num(raw['RawInputProbeMs']),
    kustoThrottleRetryCount: num(raw['KustoThrottleRetryCount']),
    kustoThrottleDelayMs: num(raw['KustoThrottleDelayMs']),
    kustoThrottleOutcome: str(raw['KustoThrottleOutcome']),
    records: num(raw['Records']),
    recordsPerSec: num(raw['RecordsPerSec']),
    rowsScanned: num(raw['RowsScanned']),
    rowsReturned: num(raw['RowsReturned']),
    rowsMapped: num(raw['RowsMapped']),
    duplicateCollapsed: num(raw['DuplicateCollapsed']),
    contractInvalid: num(raw['ContractInvalid']),
    maxRows: num(raw['MaxRows']),
    hasMore: bool(raw['HasMore']),
    bandDrained: bool(raw['BandDrained']),
    resumedPending: bool(raw['ResumedPending']),
    caughtUp: bool(raw['CaughtUp']),
    cursorBeforeUtc: nullableStr(raw['CursorBeforeUtc']),
    cursorAfterUtc: nullableStr(raw['CursorAfterUtc']),
    committedSourceVersionUtc: nullableStr(raw['CommittedSourceVersionUtc']),
    committedProgressSeconds: num(raw['CommittedProgressSeconds']),
    eligibleThroughUtc: nullableStr(raw['EligibleThroughUtc']),
    backlogBeforeSeconds: num(raw['BacklogBeforeSeconds']),
    backlogAfterSeconds: num(raw['BacklogAfterSeconds']),
    cursorLagAfterSeconds: num(raw['CursorLagAfterSeconds']),
    sealAfterUtc: nullableStr(raw['SealAfterUtc']),
    sealBeforeUtc: nullableStr(raw['SealBeforeUtc']),
    rawFromUtc: nullableStr(raw['RawFromUtc']),
    rawToUtc: nullableStr(raw['RawToUtc']),
    idleGapSeconds: num(raw['IdleGapSeconds']),
    rereadCandidates: num(raw['RereadCandidates']),
    rawScanRows: num(raw['RawScanRows']),
    rawBandRows: num(raw['RawBandRows']),
    enableRawInputCountProbe: bool(raw['EnableRawInputCountProbe']),
    rawInputCountProbeTimeoutSeconds: num(raw['RawInputCountProbeTimeoutSeconds']),
    safetyLagSeconds: num(raw['SafetyLagSeconds']),
    kustoThrottleRetryBudgetSeconds: num(raw['KustoThrottleRetryBudgetSeconds']),
    maxCatchUpWindow: str(raw['MaxCatchUpWindow']),
    leaseDuration: str(raw['LeaseDuration']),
    maxConcurrentShards: num(raw['MaxConcurrentShards']),
    effectiveConcurrentShards: num(raw['EffectiveConcurrentShards']),
    maxConcurrentUserWrites: num(raw['MaxConcurrentUserWrites']),
    maxConcurrentBulkWrites: num(raw['MaxConcurrentBulkWrites']),
    maxConcurrentDestinationWrites: num(raw['MaxConcurrentDestinationWrites']),
    activeWriteMode: str(raw['ActiveWriteMode']),
    cosmosWriteMode: str(raw['CosmosWriteMode']),
    snapshotWrites: bool(raw['SnapshotWrites']),
    enableBulkInteractionWrites: bool(raw['EnableBulkInteractionWrites']),
    enableContentResponseOnWrite: bool(raw['EnableContentResponseOnWrite']),
    cosmosAttempted: num(raw['CosmosAttempted']),
    cosmosSucceeded: num(raw['CosmosSucceeded']),
    cosmosFailed: num(raw['CosmosFailed']),
    cosmosCancelled: num(raw['CosmosCancelled']),
    writeInteractionsSuccessRu: num(raw['WriteInteractionsSuccessRu']),
    writeInteractionsRu: num(raw['WriteInteractionsRu']),
    interactionWriteRu: num(raw['InteractionWriteRu']),
    interactionWriteRuComplete: str(raw['InteractionWriteRuComplete']),
    getSnapshotRu: num(raw['GetSnapshotRu']),
    upsertSnapshotRu: num(raw['UpsertSnapshotRu']),
    totalCosmosRu: num(raw['TotalCosmosRu']),
    sdkFailedServiceRequestCount: num(raw['SdkFailedServiceRequestCount']),
    terminal429OperationCount: num(raw['Terminal429OperationCount']),
    terminalRetryAfterMs: num(raw['TerminalRetryAfterMs']),
    checkpointOutcome: str(raw['CheckpointOutcome']),
    definitionPairHash: str(raw['DefinitionPairHash']),
    definitionHash: str(raw['DefinitionHash']),
    kqlHash: str(raw['KqlHash']),
    pairVersion: num(raw['PairVersion']),
    eventType: str(raw['EventType']),
    managedBytes: num(raw['ManagedBytes']),
    workingSetBytes: num(raw['WorkingSetBytes']),
    gcHeapBytes: num(raw['GcHeapBytes']),
    facts: extractFacts(raw),
  };
}

// ── Tabular unwrap ─────────────────────────────────────────────────────────

function isTabularExport(value: unknown): value is TabularQueryExport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tables' in value &&
    Array.isArray((value as TabularQueryExport).tables)
  );
}

function unwrapTabular(tabular: TabularQueryExport): RawCycleRow[] {
  const table = tabular.tables[0];
  if (!table) return [];
  const { columns, rows } = table;
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    throw new Error(
      'normalize: tabular export has malformed structure (columns or rows is not an array).',
    );
  }
  const colNames = columns.map((c) => c.name);
  return rows.map((row) => {
    if (!Array.isArray(row)) {
      throw new Error('normalize: tabular export row is not an array.');
    }
    const obj: RawCycleRow = {};
    for (let i = 0; i < colNames.length; i++) {
      const name = colNames[i];
      if (name !== undefined) obj[name] = row[i] ?? null;
    }
    return obj;
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Normalize raw input to CompletedCycleRow[].
 *
 * Accepts:
 *   - `RawCycleRow[]` — flat array of PascalCase objects (fixture or server response)
 *   - `TabularQueryExport` — Azure Monitor tabular export `{ tables: [...] }`
 *
 * Throws a descriptive Error for any other input shape.
 */
export function normalizeRows(input: unknown): CompletedCycleRow[] {
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(
          'normalize: expected each element of the input array to be a plain object.',
        );
      }
      return normalizeRow(item as RawCycleRow);
    });
  }

  if (isTabularExport(input)) {
    const rawRows = unwrapTabular(input);
    return rawRows.map(normalizeRow);
  }

  throw new Error(
    'normalize: unsupported input shape. Expected RawCycleRow[] (flat array of objects) ' +
    'or TabularQueryExport ({ tables: [...] }). Got: ' +
    (input === null ? 'null' : typeof input) + '.',
  );
}
