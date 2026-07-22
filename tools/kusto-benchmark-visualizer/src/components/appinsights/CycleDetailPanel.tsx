/**
 * Renders one completed CursorPoll.Cycle row as a final-duration breakdown
 * and typed fact list. This is NOT a replayable timeline — it shows the
 * final accumulated durations only, as required by the plan (AI-10).
 *
 * Unknown additive facts (from the `facts` bag) are shown separately and
 * are never used in calculations.
 */
import { formatDuration, formatNumber } from '../../benchmark/format';
import { Panel } from '../Panel';
import type { CompletedCycleRow } from '../../appinsights/types';

interface CycleDetailPanelProps {
  row: CompletedCycleRow;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="poll-metric-row">
      <span className="poll-metric-row__label">{label}</span>
      <span className="poll-metric-row__value">{value}</span>
    </div>
  );
}

function nullableMs(v: number | null): string {
  return v === null ? '—' : formatDuration(v);
}

function nullableNum(v: number | null, digits = 0): string {
  return v === null ? '—' : formatNumber(v, digits);
}

function nullableBool(v: boolean | null): string {
  if (v === null) return '—';
  return v ? 'true' : 'false';
}

function nullableStr(v: string): string {
  return v === '' ? '—' : v;
}

export function CycleDetailPanel({ row }: CycleDetailPanelProps) {
  const additiveFacts = row.facts ? Object.entries(row.facts) : [];

  return (
    <Panel
      title="Cycle detail"
      eyebrow={`${row.rowKind} · ${row.runId}`}
      description="Final accumulated durations for this lane attempt. No progressive timeline is synthesised."
    >
      <div className="metrics-grid">
        <section>
          <h3>Identity</h3>
          <FactRow label="Event time (UTC)" value={row.eventTimeUtc} />
          <FactRow label="Row kind" value={row.rowKind} />
          <FactRow label="Source" value={nullableStr(row.source)} />
          <FactRow label="Outcome" value={nullableStr(row.outcome)} />
          <FactRow label="Progress kind" value={nullableStr(row.progressKind)} />
          <FactRow label="Execution mode" value={row.executionMode} />
          <FactRow label="Schema version" value={nullableStr(row.schemaVersion)} />
          <FactRow label="Build" value={nullableStr(row.build)} />
          <FactRow label="Shard ID" value={row.shardId === '' ? 'singleton (non-sharded)' : row.shardId} />
          <FactRow label="Shard count" value={nullableNum(row.shardCount)} />
          <FactRow label="Band ID" value={nullableStr(row.bandId)} />
          <FactRow label="Page number" value={nullableNum(row.pageNumber)} />
          <FactRow label="Run ID" value={nullableStr(row.runId)} />
          <FactRow label="Sweep ID" value={nullableStr(row.sweepId)} />
          <FactRow label="App role" value={nullableStr(row.appRoleName)} />
          <FactRow label="Host instance" value={nullableStr(row.appRoleInstance)} />
        </section>

        <section>
          <h3>Stage durations</h3>
          <FactRow label="Total" value={nullableMs(row.totalMs)} />
          <FactRow label="Lease" value={nullableMs(row.leaseMs)} />
          <FactRow label="Cursor read" value={nullableMs(row.cursorReadMs)} />
          <FactRow label="Kusto" value={row.kustoMs !== null ? `${nullableMs(row.kustoMs)} (${row.executionMode} timing)` : '—'} />
          <FactRow
            label="Map (drain-safe only)"
            value={row.executionMode === 'legacy' ? 'unknown (legacy)' : nullableMs(row.mapMs)}
          />
          <FactRow label="Write" value={nullableMs(row.writeMs)} />
          <FactRow label="Advance" value={nullableMs(row.advanceMs)} />
          <FactRow label="Raw-input probe" value={nullableMs(row.rawInputProbeMs)} />
        </section>

        <section>
          <h3>Record funnel</h3>
          <FactRow label="Rows processed (rawScanRows)" value={nullableNum(row.rawScanRows)} />
          <FactRow label="Band rows (rawBandRows)" value={nullableNum(row.rawBandRows)} />
          <FactRow label="Records finalized" value={nullableNum(row.records)} />
          <FactRow label="Records/sec (reported)" value={nullableNum(row.recordsPerSec, 1)} />
          <FactRow
            label="Rows scanned (drain-safe only)"
            value={row.executionMode === 'legacy' ? 'unknown (legacy)' : nullableNum(row.rowsScanned)}
          />
          <FactRow label="Rows returned" value={nullableNum(row.rowsReturned)} />
          <FactRow label="Rows mapped" value={nullableNum(row.rowsMapped)} />
          <FactRow label="Duplicate collapsed" value={nullableNum(row.duplicateCollapsed)} />
          <FactRow label="Contract invalid" value={nullableNum(row.contractInvalid)} />
          <FactRow label="Max rows" value={nullableNum(row.maxRows)} />
        </section>

        <section>
          <h3>Backlog and paging</h3>
          <FactRow label="Cursor before (UTC)" value={nullableStr(row.cursorBeforeUtc ?? '')} />
          <FactRow label="Cursor after (UTC)" value={nullableStr(row.cursorAfterUtc ?? '')} />
          <FactRow label="Cursor lag after (s)" value={nullableNum(row.cursorLagAfterSeconds, 1)} />
          <FactRow label="Backlog before (s)" value={nullableNum(row.backlogBeforeSeconds, 1)} />
          <FactRow label="Backlog after (s)" value={nullableNum(row.backlogAfterSeconds, 1)} />
          <FactRow label="Committed progress (s)" value={nullableNum(row.committedProgressSeconds, 1)} />
          <FactRow label="Has more" value={nullableBool(row.hasMore)} />
          <FactRow label="Band drained" value={nullableBool(row.bandDrained)} />
          <FactRow label="Resumed pending" value={nullableBool(row.resumedPending)} />
          <FactRow label="Caught up" value={nullableBool(row.caughtUp)} />
          <FactRow label="Reread candidates" value={nullableNum(row.rereadCandidates)} />
        </section>

        <section>
          <h3>Cosmos partition-batch outcomes</h3>
          <FactRow label="Attempted (partition-batch)" value={nullableNum(row.cosmosAttempted)} />
          <FactRow label="Succeeded (partition-batch)" value={nullableNum(row.cosmosSucceeded)} />
          <FactRow label="Failed (partition-batch)" value={nullableNum(row.cosmosFailed)} />
          <FactRow label="Cancelled (partition-batch)" value={nullableNum(row.cosmosCancelled)} />
          <FactRow label="Interaction write RU" value={nullableNum(row.interactionWriteRu, 1)} />
          <FactRow label="Interaction write RU completeness" value={nullableStr(row.interactionWriteRuComplete)} />
          <FactRow label="Bulk success RU (partial)" value={nullableNum(row.writeInteractionsSuccessRu, 1)} />
          <FactRow label="Failed-path write RU" value={nullableNum(row.writeInteractionsRu, 1)} />
          <FactRow label="Total RU (partial observed)" value={nullableNum(row.totalCosmosRu, 1)} />
          <FactRow label="SDK failed service requests (not retries)" value={nullableNum(row.sdkFailedServiceRequestCount)} />
          <FactRow label="Terminal 429 operations (not total 429s)" value={nullableNum(row.terminal429OperationCount)} />
          <FactRow label="Terminal retry-after" value={nullableMs(row.terminalRetryAfterMs)} />
        </section>

        <section>
          <h3>Lease and checkpoint</h3>
          <FactRow label="Lease acquired" value={nullableBool(row.leaseAcquired)} />
          <FactRow label="Lease acquire outcome" value={nullableStr(row.leaseAcquireOutcome)} />
          <FactRow label="Lease lost" value={nullableBool(row.leaseLost)} />
          <FactRow label="Checkpoint outcome" value={nullableStr(row.checkpointOutcome)} />
        </section>

        {additiveFacts.length > 0 && (
          <section>
            <h3>Unknown additive facts (not used in calculations)</h3>
            {additiveFacts.map(([k, v]) => (
              <FactRow key={k} label={k} value={String(v)} />
            ))}
          </section>
        )}
      </div>
    </Panel>
  );
}
