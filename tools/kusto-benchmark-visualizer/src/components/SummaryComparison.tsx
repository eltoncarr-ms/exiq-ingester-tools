import type { RunAnalysis, SummaryRow } from '../benchmark/derive';
import { formatDuration, formatNumber } from '../benchmark/format';
import { Panel } from './Panel';
import { ThroughputGaugeGrid } from './RunThroughputGauges';

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

export function SummaryComparison({ runs, selectedRunId, timeRangeLabel, visiblePointCount }: SummaryComparisonProps) {
  const selected = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedRow = selected?.summaryRow;

  return (
    <Panel
      title="Run stats"
      description="Headline cards and dials show weighted full-run totals from the latest iteration snapshots."
    >
      <div className="metric-strip">
        <MetricCard label="Duration" value={selectedRow ? formatDuration(selectedRow.durationMs) : '—'} hint="full run elapsed wall-clock time" />
        <MetricCard label="Rows processed" value={selected ? formatNumber(selected.artifact.summary.messagesProcessed, 0) : '—'} hint="source messages processed" />
        <MetricCard label="Events finalized" value={selectedRow ? formatNumber(selectedRow.eventsFinalized, 0) : '—'} hint="documents sent or attempted" />
        <MetricCard label="Checkpoints" value={selected ? formatNumber(selected.artifact.summary.checkpointAdvancements, 0) : '—'} hint="successful checkpoint advancements" />
        <MetricCard label="Chart window" value={timeRangeLabel} hint={`${formatNumber(visiblePointCount, 0)} iteration point(s) visible`} />
      </div>

      <ThroughputGaugeGrid
        metrics={selected?.throughputMetrics ?? null}
        iterationMetrics={selected?.iterationThroughputMetrics ?? []}
      />
    </Panel>
  );
}
