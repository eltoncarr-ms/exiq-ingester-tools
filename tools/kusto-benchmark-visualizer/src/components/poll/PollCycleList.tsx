import type { PollCycleAnalysis, PollCycleOutcome } from '../../poll/derive';
import { formatAxisDateTime, formatDuration, formatNumber, formatRate } from '../../benchmark/format';
import { Panel } from '../Panel';

interface PollCycleListProps {
  cycles: PollCycleAnalysis[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

function outcomeTagClass(outcome: PollCycleOutcome): string {
  switch (outcome) {
    case 'success':
      return 'tag tag--ok';
    case 'skipped':
      return 'tag tag--warn';
    case 'failed':
      return 'tag tag--danger';
    case 'in-progress':
      return 'tag tag--muted';
  }
}

function outcomeLabel(cycle: PollCycleAnalysis): string {
  if (cycle.outcome === 'failed' && cycle.error) return `failed · ${cycle.error}`;
  return cycle.outcome;
}

export function PollCycleList({ cycles, selectedRunId, onSelect }: PollCycleListProps) {
  const sorted = [...cycles].sort((a, b) => b.startedAtMs - a.startedAtMs);

  return (
    <Panel title="Poll cycles" description="Most recent cycle first. Select a cycle to replay its stage timeline below.">
      {sorted.length === 0 ? (
        <div className="chart-empty">No cycles yet</div>
      ) : (
        <div className="comparison">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Records</th>
                <th>Throughput</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((cycle) => (
                <tr key={cycle.runId} className={cycle.runId === selectedRunId ? 'is-selected' : ''}>
                  <td>
                    <button className="table-link" type="button" onClick={() => onSelect(cycle.runId)}>
                      {cycle.runId}
                    </button>
                  </td>
                  <td>{formatAxisDateTime(cycle.startedAtMs)}</td>
                  <td>{cycle.totalMs !== null ? formatDuration(cycle.totalMs) : '—'}</td>
                  <td>{cycle.records !== null ? formatNumber(cycle.records, 0) : '—'}</td>
                  <td>{cycle.recordsPerSec !== null ? formatRate(cycle.recordsPerSec) : '—'}</td>
                  <td>
                    <span className={outcomeTagClass(cycle.outcome)}>{outcomeLabel(cycle)}</span>
                    {cycle.failingStage && <span className="poll-cycle-list__detail"> at {cycle.failingStage}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
