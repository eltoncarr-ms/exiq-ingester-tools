/**
 * Shard fleet table — shows one row per shard (or singleton lane) with
 * freshness, last outcome/progress, lag, backlog, record totals, and skew indicators.
 * Backlog is shown per-shard (never summed) because summing is semantically wrong.
 */
import { formatNumber } from '../../benchmark/format';
import type { ShardFleetEntry } from '../../appinsights/derive';

interface ShardFleetTableProps {
  entries: ShardFleetEntry[];
}

function outcomeTag(outcome: string): string {
  switch (outcome) {
    case 'success': return '✓';
    case 'skipped': return '⊘';
    case 'failed': return '✗';
    case 'cancelled': return '⊠';
    default: return outcome;
  }
}

function nullableNum(v: number | null, digits = 0): string {
  return v === null ? '—' : formatNumber(v, digits);
}

export function ShardFleetTable({ entries }: ShardFleetTableProps) {
  if (entries.length === 0) {
    return <div className="chart-empty">No shard fleet data</div>;
  }

  return (
    <div className="poll-shard-table-wrap" style={{ overflowX: 'auto' }}>
      <table className="poll-shard-table" style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85em' }}>
        <thead>
          <tr>
            <th>Shard ID</th>
            <th>Shard count</th>
            <th>Attempts</th>
            <th>Last outcome</th>
            <th>Progress</th>
            <th>Mode</th>
            <th>Cursor lag (s)</th>
            <th>Backlog after (s)</th>
            <th>Records finalized</th>
            <th>Lease loss</th>
            <th>Contention</th>
            <th>Hosts</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td>{e.shardId === '' ? '(singleton)' : e.shardId}</td>
              <td>{nullableNum(e.shardCount)}</td>
              <td>{formatNumber(e.attempts, 0)}</td>
              <td>{outcomeTag(e.lastOutcome)} {e.lastOutcome}</td>
              <td>{e.lastProgressKind || '—'}</td>
              <td>{e.latestExecutionMode}</td>
              <td>{nullableNum(e.latestCursorLagAfterSeconds, 1)}</td>
              <td>{nullableNum(e.latestBacklogAfterSeconds, 1)}</td>
              <td>{formatNumber(e.totalRecords, 0)}</td>
              <td>{e.hadLeaseLoss ? '⚠ yes' : 'no'}</td>
              <td>{e.hadContention ? '⚠ yes' : 'no'}</td>
              <td style={{ fontSize: '0.8em' }}>{e.hosts.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
