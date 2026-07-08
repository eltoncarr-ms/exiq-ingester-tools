import { buildAverageSummaryRow, percentDelta, type RunAnalysis, type SummaryRow } from '../benchmark/derive';
import { formatDuration, formatNumber, formatPercent, formatRate } from '../benchmark/format';
import { Panel } from './Panel';

interface SummaryComparisonProps {
  runs: RunAnalysis[];
  summaryRows?: SummaryRow[];
  selectedRunId: string | null;
  timeRangeLabel: string;
  visiblePointCount: number;
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

export function SummaryComparison({ runs, summaryRows = [], selectedRunId, timeRangeLabel, visiblePointCount, onSelectRun }: SummaryComparisonProps) {
  const average = buildAverageSummaryRow(runs);
  const selected = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedRow = selected?.summaryRow;
  const totalEvents = runs.reduce((sum, run) => sum + run.summaryRow.eventsFinalized, 0);

  return (
    <Panel title="Run stats" eyebrow="selected benchmark run" description="Headline cards show full-run totals. The chart window controls which points render in the timeline and metric charts.">
      <div className="metric-strip">
        <MetricCard label="Duration" value={selectedRow ? formatDuration(selectedRow.durationMs) : '—'} hint="full run elapsed wall-clock time" />
        <MetricCard label="Rows processed" value={selected ? formatNumber(selected.artifact.summary.messagesProcessed, 0) : '—'} hint="source messages processed" />
        <MetricCard label="Events finalized" value={selectedRow ? formatNumber(selectedRow.eventsFinalized, 0) : '—'} hint="documents sent or attempted" />
        <MetricCard label="Throughput" value={selectedRow ? formatRate(selectedRow.throughputEventsPerSecond) : '—'} hint="full-run events per second" />
        <MetricCard label="Checkpoints" value={selected ? formatNumber(selected.artifact.summary.checkpointAdvancements, 0) : '—'} hint="successful checkpoint advancements" />
        <MetricCard label="Chart window" value={timeRangeLabel} hint={`${formatNumber(visiblePointCount, 0)} iteration point(s) visible`} />
      </div>

      <div className="comparison">
        <div className="comparison__caption">
          Loaded artifacts: {formatNumber(runs.length, 0)} run(s), {formatNumber(summaryRows.length, 0)} summary artifact(s), {formatNumber(totalEvents, 0)} total finalized event(s).
        </div>
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
