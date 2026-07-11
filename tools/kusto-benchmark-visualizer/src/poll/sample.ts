/**
 * Compact synthetic fixtures for the poll telemetry contract. These are
 * intentionally hand-built (not generated from the C# producer) so tests can
 * assert on exact shapes; they mirror the fields `PollRun`/`JsonlPollSink`
 * actually emit for each outcome.
 */

function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** Builds one `stage` event line, with sensible defaults for overrides. */
export function stageEventLine(overrides: Record<string, unknown> = {}): string {
  return line({
    type: 'stage',
    ts: '2026-02-01T00:00:00.000Z',
    runId: 'run-success-1',
    stage: 'seal',
    ev: 'start',
    atMs: 12,
    ...overrides,
  });
}

/**
 * Builds one `cycle` event line for a successful cycle, with sensible
 * defaults for overrides (pass `undefined` for a key to omit it entirely).
 */
export function cycleEventLine(overrides: Record<string, unknown> = {}): string {
  const fields: Record<string, unknown> = {
    type: 'cycle',
    ts: '2026-02-01T00:00:05.000Z',
    runId: 'run-success-1',
    source: 'portal-firehose',
    outcome: 'success',
    startedAtUtc: '2026-02-01T00:00:00.000Z',
    completedAtUtc: '2026-02-01T00:00:05.000Z',
    totalMs: 5000,
    records: 1200,
    recordsPerSec: 240,
    timeline: [
      { stage: 'cursorRead', startMs: 0, durMs: 10 },
      { stage: 'seal', startMs: 10, durMs: 3200 },
      { stage: 'write', startMs: 3210, durMs: 1700 },
      { stage: 'advance', startMs: 4910, durMs: 90 },
    ],
    users: 42,
    cursorLagSec: 31.4,
    kustoMs: 3100,
    mapMs: 100,
    writeMs: 1700,
    advanceMs: 90,
    writeInteractionsRu: 615.2,
    // Weighted-throughput facts, preserved verbatim in `facts` (see
    // PollCycleEvent.facts): 6000 input rows read from Kusto this cycle, and
    // a 5-minute source window actually advanced by this (successful) cycle.
    inputRows: 6000,
    windowStartUtc: '2026-01-31T23:55:00.000Z',
    windowEndUtc: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }

  return line(fields);
}

/** A minimal skipped cycle: only the always-present fields, no seal/write/advance facts. */
export const SAMPLE_SKIPPED_CYCLE_LINE = cycleEventLine({
  runId: 'run-skipped-1',
  outcome: 'skipped',
  totalMs: 4,
  records: 0,
  recordsPerSec: 0,
  timeline: [{ stage: 'cursorRead', startMs: 0, durMs: 3 }],
  users: undefined,
  cursorLagSec: undefined,
  kustoMs: undefined,
  mapMs: undefined,
  writeMs: undefined,
  advanceMs: undefined,
  writeInteractionsRu: undefined,
  inputRows: undefined,
  windowStartUtc: undefined,
  windowEndUtc: undefined,
});

/**
 * A cycle that faulted mid-seal: partial facts, failingStage/error present,
 * no write/advance. Deliberately keeps the default `inputRows`,
 * `windowStartUtc`, and `windowEndUtc` facts (as if seal had already read
 * them before the fault) so derive tests can assert the outcome gate alone
 * — not fact absence — excludes a failed cycle from every weighted metric
 * except checkpoint velocity's wall-time (`totalMs`) denominator.
 */
export const SAMPLE_FAILED_CYCLE_LINE = cycleEventLine({
  runId: 'run-failed-1',
  outcome: 'failed',
  totalMs: 3305,
  records: 0,
  recordsPerSec: 0,
  timeline: [
    { stage: 'cursorRead', startMs: 0, durMs: 10 },
  ],
  users: undefined,
  writeMs: undefined,
  advanceMs: undefined,
  writeInteractionsRu: undefined,
  failingStage: 'seal',
  error: 'KustoServiceException',
});

/** A second source's successful cycle, for multi-source parsing tests. */
export const SAMPLE_OTHER_SOURCE_CYCLE_LINE = cycleEventLine({
  runId: 'run-success-2',
  source: 'audit-firehose',
  users: 7,
  cursorLagSec: 4.2,
  writeInteractionsRu: 12.5,
});

/**
 * A compact mixed NDJSON stream: two sources, success/skipped/failed
 * outcomes, matched stage+cycle records, one malformed JSON line, and one
 * unknown record type — enough to exercise every batch-parsing requirement
 * without a large fixture file.
 */
export const SAMPLE_POLL_JSONL = [
  stageEventLine({ runId: 'run-success-1', stage: 'cursorRead', ev: 'start', atMs: 0 }),
  stageEventLine({ runId: 'run-success-1', stage: 'cursorRead', ev: 'end', atMs: 10, durMs: 10 }),
  stageEventLine({ runId: 'run-success-1', stage: 'seal', ev: 'start', atMs: 10 }),
  stageEventLine({ runId: 'run-success-1', stage: 'seal', ev: 'end', atMs: 3210, durMs: 3200 }),
  cycleEventLine(),
  '{not valid json',
  line({ type: 'heartbeat', ts: '2026-02-01T00:00:06.000Z' }),
  SAMPLE_SKIPPED_CYCLE_LINE,
  SAMPLE_FAILED_CYCLE_LINE,
  SAMPLE_OTHER_SOURCE_CYCLE_LINE,
].join('\n');
