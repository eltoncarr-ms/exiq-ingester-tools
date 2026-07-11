import type { PollSourceAnalysis, PollTrendPoint } from '../../poll/derive';
import { formatAxisDateTime, formatNumber } from '../../benchmark/format';
import { LineChart, type LineSeries } from '../Charts';
import { Panel } from '../Panel';

interface PollThroughputTrendsProps {
  source: PollSourceAnalysis;
}

function formatThroughput(value: number): string {
  return `${formatNumber(value, value >= 100 ? 0 : 1)}/s`;
}

function formatRecords(value: number): string {
  return formatNumber(value, 0);
}

function toSeries(name: string, color: string, points: PollTrendPoint[]): LineSeries[] {
  return [
    {
      name,
      color,
      points: points.map((point) => ({ xMs: point.atMs, value: point.value, label: formatAxisDateTime(point.atMs) })),
    },
  ];
}

export function PollThroughputTrends({ source }: PollThroughputTrendsProps) {
  // The first chart is raw Kusto/source message throughput (inputRows /
  // totalMs), not the producer's `recordsPerSec` field — that field counts
  // finalized output events/interactions per second, which is what the
  // second chart (events/cycle) reflects instead.
  const throughputSeries = toSeries('msg/sec', '#34d399', source.throughputPoints);
  const recordsSeries = toSeries('events/cycle', '#38bdf8', source.recordsPoints);
  const latestThroughput = source.throughputPoints.at(-1);
  const latestRecords = source.recordsPoints.at(-1);

  return (
    <Panel
      title="Poll throughput trends"
      description="Successful-cycle msg/sec and events/cycle, plotted at cycle completion time. Skipped and failed cycles do not contribute a point."
    >
      <div className="trend-grid">
        <section className="trend-card" aria-label="Raw source message throughput trend">
          <div className="trend-card__head">
            <div>
              <h3>msg/sec</h3>
              <span>raw Kusto/source messages, successful cycles</span>
            </div>
            <strong>{latestThroughput ? formatThroughput(latestThroughput.value) : '—'}</strong>
          </div>
          <LineChart series={throughputSeries} valueFormatter={formatThroughput} emptyText="No successful cycles yet" />
        </section>
        <section className="trend-card" aria-label="Finalized events per cycle trend">
          <div className="trend-card__head">
            <div>
              <h3>events/cycle</h3>
              <span>finalized output interactions, successful cycles</span>
            </div>
            <strong>{latestRecords ? formatRecords(latestRecords.value) : '—'}</strong>
          </div>
          <LineChart series={recordsSeries} valueFormatter={formatRecords} emptyText="No successful cycles yet" />
        </section>
      </div>
    </Panel>
  );
}
