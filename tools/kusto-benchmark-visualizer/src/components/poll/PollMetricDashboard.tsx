import type { PollSourceAnalysis } from '../../poll/derive';
import { formatCompactNumber, formatDuration, formatDurationDynamic, formatNumber } from '../../benchmark/format';
import { Panel } from '../Panel';
import { ThroughputGaugeGrid } from '../RunThroughputGauges';

interface PollMetricDashboardProps {
  source: PollSourceAnalysis;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {hint && <div className="metric-card__hint">{hint}</div>}
    </div>
  );
}

function optionalCount(value: number | undefined): string {
  return value === undefined ? '\u2014' : formatNumber(value, 0);
}

export function PollMetricDashboard({ source }: PollMetricDashboardProps) {
  const { metrics } = source;
  const { outcomeCounts } = metrics;

  return (
    <Panel
      title="Poll Cycle Metrics"
      description="Totals and averages from this source's completed cycles only; stage-only (in-progress) cycles never contribute here."
    >
      <div className="poll-outcome-row" aria-label="Cycle outcome counts">
        <span className="tag tag--ok">{formatNumber(outcomeCounts.success, 0)} success</span>
        <span className="tag tag--warn">{formatNumber(outcomeCounts.skipped, 0)} skipped</span>
        <span className="tag tag--danger">{formatNumber(outcomeCounts.failed, 0)} failed</span>
      </div>

      <div className="metric-strip">
        {metrics.totalInputRows !== undefined && (
          <MetricCard label="Rows Processed" value={formatCompactNumber(metrics.totalInputRows)} hint="source messages processed" />
        )}
        <MetricCard
          label="Events Finalized"
          value={formatCompactNumber(metrics.totalRecords)}
          hint="destination interactions finalized, every outcome"
        />
        <MetricCard label="Checkpoints" value={formatNumber(metrics.checkpointCount, 0)} hint="successful cursor advancements" />
        {metrics.totalUsers !== undefined && <MetricCard label="Total users" value={formatCompactNumber(metrics.totalUsers)} hint="batches sealed" />}
        {metrics.avgCycleMs !== undefined && (
          <MetricCard label="Avg cycle duration" value={formatDuration(metrics.avgCycleMs)} hint="all outcomes" />
        )}
        {metrics.latestCursorLagSec !== undefined && (
          <MetricCard
            label="Cursor Lag"
            value={formatDurationDynamic(metrics.latestCursorLagSec * 1000)}
            hint="seal watermark trailing wall clock"
          />
        )}
        {metrics.totalWriteInteractionsRu !== undefined && (
          <MetricCard label="Total write RU" value={formatCompactNumber(metrics.totalWriteInteractionsRu)} hint="request units, when reported" />
        )}
      </div>

      <div className="metric-strip metric-strip--wrap" aria-label="Cosmos write totals">
        <MetricCard label="Cosmos retries" value={optionalCount(metrics.totalCosmosRetryCount)} />
        <MetricCard label="Cosmos 429s" value={optionalCount(metrics.totalCosmos429Count)} />
        <MetricCard label="Writes attempted" value={optionalCount(metrics.totalCosmosWriteAttempted)} />
        <MetricCard label="Writes succeeded" value={optionalCount(metrics.totalCosmosWriteSucceeded)} />
        <MetricCard label="Writes failed" value={optionalCount(metrics.totalCosmosWriteFailed)} />
        <MetricCard label="Writes cancelled" value={optionalCount(metrics.totalCosmosWriteCancelled)} />
        <MetricCard
          label="Affected cycles"
          value={optionalCount(metrics.cosmosAffectedCycleCount)}
          hint="retry, 429, failed, or cancelled write"
        />
      </div>

      <ThroughputGaugeGrid metrics={source.throughputMetrics} iterationMetrics={source.iterationThroughputMetrics} />
    </Panel>
  );
}
