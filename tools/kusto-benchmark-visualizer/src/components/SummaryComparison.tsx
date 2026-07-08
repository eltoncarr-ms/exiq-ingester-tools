import { buildAverageSummaryRow, percentDelta, type RunAnalysis, type SummaryRow } from '../benchmark/derive';
import { formatDuration, formatNumber, formatPercent, formatRate } from '../benchmark/format';
import { Panel } from './Panel';

interface SummaryComparisonProps {
  runs: RunAnalysis[];
  summaryRows?: SummaryRow[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__hint">{hint}</div>
    </div>
  );
}

function rowDelta(row: SummaryRow, average: SummaryRow | null): number | null {
  return average ? percentDelta(row.throughputEventsPerSecond, average.throughputEventsPerSecond) : null;
}

export function SummaryComparison({ runs, summaryRows = [], selectedRunId, onSelectRun }: SummaryComparisonProps) {
  const average = buildAverageSummaryRow(runs);
  const selected = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const totalEvents = runs.reduce((sum, run) => sum + run.summaryRow.eventsFinalized, 0);
  const totalFlushes = runs.reduce((sum, run) => sum + run.summaryRow.fullFlushes + run.summaryRow.partialFlushes, 0);

  return (
    <Panel title="Run comparison" eyebrow="averaged baseline summary">
      <div className="metric-strip">
        <MetricCard label="Loaded runs" value={formatNumber(runs.length, 0)} hint="JSON artifacts in memory" />
        <MetricCard label="Loaded summaries" value={formatNumber(summaryRows.length, 0)} hint="averaged baseline artifacts" />
        <MetricCard label="Average throughput" value={average ? formatRate(average.throughputEventsPerSecond) : '—'} hint="mean across loaded runs" />
        <MetricCard label="Events finalized" value={formatNumber(totalEvents, 0)} hint="sum across loaded runs" />
        <MetricCard label="Flushes" value={formatNumber(totalFlushes, 0)} hint="partial + full flush count" />
      </div>

      <div className="comparison">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Source</th>
              <th>Iterations</th>
              <th>Duration</th>
              <th>Throughput</th>
              <th>Δ vs avg</th>
              <th>Avg total</th>
              <th>Backlog avg/max</th>
              <th>Blocked</th>
              <th>Partial / full</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const row = run.summaryRow;
              return (
                <tr key={run.id} className={selected?.id === run.id ? 'is-selected' : undefined} onClick={() => onSelectRun(run.id)}>
                  <td>
                    <button className="table-link" type="button">
                      {row.label}
                    </button>
                  </td>
                  <td>{row.source}</td>
                  <td>{formatNumber(row.iterationCount, 0)}</td>
                  <td>{formatDuration(row.durationMs)}</td>
                  <td>{formatRate(row.throughputEventsPerSecond)}</td>
                  <td>{formatPercent(rowDelta(row, average))}</td>
                  <td>{formatDuration(row.averageTotalMs)}</td>
                  <td>
                    {formatNumber(row.averageBacklogMessages, 1)} / {formatNumber(row.maxBacklogMessages, 0)}
                  </td>
                  <td>{formatDuration(row.blockedDurationMs)}</td>
                  <td>
                    {formatNumber(row.partialFlushes, 0)} / {formatNumber(row.fullFlushes, 0)}
                  </td>
                </tr>
              );
            })}
            {average && (
              <tr className="comparison__average">
                <td>{average.label}</td>
                <td>{average.source}</td>
                <td>{formatNumber(average.iterationCount, 1)}</td>
                <td>{formatDuration(average.durationMs)}</td>
                <td>{formatRate(average.throughputEventsPerSecond)}</td>
                <td>baseline</td>
                <td>{formatDuration(average.averageTotalMs)}</td>
                <td>
                  {formatNumber(average.averageBacklogMessages, 1)} / {formatNumber(average.maxBacklogMessages, 0)}
                </td>
                <td>{formatDuration(average.blockedDurationMs)}</td>
                <td>
                  {formatNumber(average.partialFlushes, 1)} / {formatNumber(average.fullFlushes, 1)}
                </td>
              </tr>
            )}
            {summaryRows.map((row) => (
              <tr key={row.id} className="comparison__summary">
                <td>{row.label}</td>
                <td>{row.source}</td>
                <td>{formatNumber(row.iterationCount, 1)}</td>
                <td>{formatDuration(row.durationMs)}</td>
                <td>{formatRate(row.throughputEventsPerSecond)}</td>
                <td>{formatPercent(rowDelta(row, average))}</td>
                <td>{formatDuration(row.averageTotalMs)}</td>
                <td>
                  {formatNumber(row.averageBacklogMessages, 1)} / {formatNumber(row.maxBacklogMessages, 0)}
                </td>
                <td>{formatDuration(row.blockedDurationMs)}</td>
                <td>
                  {formatNumber(row.partialFlushes, 1)} / {formatNumber(row.fullFlushes, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
