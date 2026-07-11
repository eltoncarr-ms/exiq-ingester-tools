import type { PollSourceAnalysis, PollSourceMetrics } from '../../poll/derive';
import { formatDuration, formatNumber, formatRate } from '../../benchmark/format';
import { Panel } from '../Panel';

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

/** Optional stage-duration cards; rendered together only when at least one is defined. */
function stageDurationCards(metrics: PollSourceMetrics) {
  const cards: Array<{ label: string; value: number; hint: string }> = [];
  if (metrics.avgKustoMs !== undefined) cards.push({ label: 'Avg Kusto', value: metrics.avgKustoMs, hint: 'seal-query duration' });
  if (metrics.avgMapMs !== undefined) cards.push({ label: 'Avg map', value: metrics.avgMapMs, hint: 'row-mapping duration' });
  if (metrics.avgWriteMs !== undefined) cards.push({ label: 'Avg write', value: metrics.avgWriteMs, hint: 'write stage duration' });
  if (metrics.avgAdvanceMs !== undefined) cards.push({ label: 'Avg advance', value: metrics.avgAdvanceMs, hint: 'advance stage duration' });
  return cards;
}

export function PollMetricDashboard({ source }: PollMetricDashboardProps) {
  const { metrics } = source;
  const { outcomeCounts } = metrics;
  const stageCards = stageDurationCards(metrics);

  return (
    <Panel
      title="Poll cycle metrics"
      eyebrow={source.source}
      description="Totals and averages from this source's completed cycles only; stage-only (in-progress) cycles never contribute here."
    >
      <div className="poll-outcome-row" aria-label="Cycle outcome counts">
        <span className="tag tag--ok">{formatNumber(outcomeCounts.success, 0)} success</span>
        <span className="tag tag--warn">{formatNumber(outcomeCounts.skipped, 0)} skipped</span>
        <span className="tag tag--danger">{formatNumber(outcomeCounts.failed, 0)} failed</span>
      </div>

      <div className="metric-strip">
        <MetricCard label="Cycles" value={formatNumber(metrics.cycleCount, 0)} hint="completed cycles for this source" />
        <MetricCard label="Total records" value={formatNumber(metrics.totalRecords, 0)} hint="summed across every outcome" />
        {metrics.totalUsers !== undefined && <MetricCard label="Total users" value={formatNumber(metrics.totalUsers, 0)} hint="batches sealed" />}
        {metrics.avgCycleMs !== undefined && (
          <MetricCard label="Avg cycle duration" value={formatDuration(metrics.avgCycleMs)} hint="all outcomes" />
        )}
        {metrics.avgSuccessfulRecordsPerSec !== undefined && (
          <MetricCard label="Avg throughput" value={formatRate(metrics.avgSuccessfulRecordsPerSec)} hint="successful cycles only" />
        )}
        {metrics.latestCursorLagSec !== undefined && (
          <MetricCard
            label="Latest cursor lag"
            value={formatDuration(metrics.latestCursorLagSec * 1000)}
            hint="seal watermark trailing wall clock"
          />
        )}
        {metrics.totalWriteInteractionsRu !== undefined && (
          <MetricCard label="Total write RU" value={formatNumber(metrics.totalWriteInteractionsRu, 1)} hint="request units, when reported" />
        )}
      </div>

      {stageCards.length > 0 && (
        <div className="metric-strip">
          {stageCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={formatDuration(card.value)} hint={card.hint} />
          ))}
        </div>
      )}
    </Panel>
  );
}
