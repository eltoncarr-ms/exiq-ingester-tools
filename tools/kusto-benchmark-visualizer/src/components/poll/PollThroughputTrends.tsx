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
  const throughputSeries = toSeries('Records/sec', '#34d399', source.throughputPoints);
  const recordsSeries = toSeries('Records/cycle', '#38bdf8', source.recordsPoints);
  const latestThroughput = source.throughputPoints.at(-1);
  const latestRecords = source.recordsPoints.at(-1);

  return (
    <Panel
      title="Poll throughput trends"
      eyebrow={source.source}
      description="Successful-cycle records/sec and records/cycle, plotted at cycle completion time. Skipped and failed cycles do not contribute a point."
    >
      <div className="trend-grid">
        <section className="trend-card" aria-label="Records per second trend">
          <div className="trend-card__head">
            <div>
              <h3>Records/sec</h3>
              <span>successful cycles</span>
            </div>
            <strong>{latestThroughput ? formatThroughput(latestThroughput.value) : '—'}</strong>
          </div>
          <LineChart series={throughputSeries} valueFormatter={formatThroughput} emptyText="No successful cycles yet" />
        </section>
        <section className="trend-card" aria-label="Records per cycle trend">
          <div className="trend-card__head">
            <div>
              <h3>Records/cycle</h3>
              <span>successful cycles</span>
            </div>
            <strong>{latestRecords ? formatRecords(latestRecords.value) : '—'}</strong>
          </div>
          <LineChart series={recordsSeries} valueFormatter={formatRecords} emptyText="No successful cycles yet" />
        </section>
      </div>
    </Panel>
  );
}
