import { useId } from 'react';
import { formatNumber } from '../benchmark/format';
import { Panel } from './Panel';

export interface ThroughputGaugeMetrics {
  kustoReadThroughputRowsPerSec: number | null;
  processingThroughputRowsPerSec: number | null;
  eventThroughputEventsPerSec: number | null;
  compressionRateRowsPerEvent: number | null;
  checkpointAdvanceSeconds: number;
  checkpointVelocitySourcePerWall: number | null;
  cosmosWriteThroughputBatchesPerSec: number | null;
}

export type GaugeKey =
  | 'kusto'
  | 'processing'
  | 'event'
  | 'compression'
  | 'checkpointVelocity'
  | 'cosmos';

const DEFAULT_GAUGE_KEYS: GaugeKey[] = ['kusto', 'processing', 'event', 'compression', 'checkpointVelocity'];

export interface ThroughputGaugeIterationMetrics extends ThroughputGaugeMetrics {
  iterationId: string;
}

interface RunThroughputGaugesProps {
  metrics: ThroughputGaugeMetrics | null;
  iterationMetrics: ThroughputGaugeIterationMetrics[];
  rangePercentile?: number;
  gauges?: GaugeKey[];
}

interface GaugeMetric {
  key: GaugeKey;
  label: string;
  value: number | null;
  unit: string;
  color: string;
  description: string;
  rangeValues: Array<number | null>;
}

function finiteValues(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((left, right) => left - right);
}

function gaugeRange(values: number[], upperPercentile?: number): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = Number.POSITIVE_INFINITY;
  let observedMax = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    min = Math.min(min, value);
    observedMax = Math.max(observedMax, value);
  }

  const percentileMax =
    upperPercentile === undefined ? null : percentile(values, upperPercentile);
  const max = percentileMax ?? observedMax;
  const padding = max * 0.1;
  const rangeMin = Math.max(0, min - padding);
  const rangeMax = Math.max(max + padding, rangeMin + 1);
  return { min: rangeMin, max: rangeMax };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1));
  return values[index];
}

function formatGaugeValue(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1000) return formatNumber(value, 0);
  if (value >= 100) return formatNumber(value, 1);
  return formatNumber(value, 2);
}

function Gauge({
  metric,
  range,
  p95,
  rangePercentile,
}: {
  metric: GaugeMetric;
  range: { min: number; max: number };
  p95: number | null;
  rangePercentile?: number;
}) {
  const tooltipId = useId();
  const normalized = metric.value === null ? 0 : Math.max(0, Math.min(1, (metric.value - range.min) / (range.max - range.min)));
  const angle = -120 + normalized * 240;
  const endAngle = (Math.PI * (angle - 90)) / 180;
  const needleX = 80 + Math.cos(endAngle) * 44;
  const needleY = 80 + Math.sin(endAngle) * 44;

  return (
    <div className="gauge-card">
      <span className="gauge-card__info">
        <button
          type="button"
          className="gauge-card__info-trigger"
          aria-label={`About ${metric.label}`}
          aria-describedby={tooltipId}
        >
          i
        </button>
        <span id={tooltipId} className="gauge-card__info-tooltip" role="tooltip">
          {metric.description}
          {rangePercentile !== undefined &&
            ` The dial scale is capped at p${rangePercentile} so rare catch-up outliers do not flatten normal cycles; the aggregate value and p95 remain exact.`}
        </span>
      </span>
      <svg className="gauge" viewBox="0 0 160 116" role="img" aria-label={`${metric.label}: ${formatGaugeValue(metric.value)} ${metric.unit}`}>
        <path className="gauge__track" d="M 28 84 A 54 54 0 1 1 132 84" />
        <path className="gauge__value" d="M 28 84 A 54 54 0 1 1 132 84" pathLength={100} style={{ stroke: metric.color, strokeDasharray: `${normalized * 100} 100` }} />
        <line className="gauge__needle" x1="80" y1="84" x2={needleX} y2={needleY} />
        <circle className="gauge__hub" cx="80" cy="84" r="5" />
      </svg>
      <div className="gauge-card__value">{formatGaugeValue(metric.value)}</div>
      <div className="gauge-card__unit">{metric.unit}</div>
      <div className="gauge-card__label">{metric.label}</div>
      <div className="gauge-card__range">
        {formatGaugeValue(range.min)} - {formatGaugeValue(range.max)}
      </div>
      <div className="gauge-card__p95">p95 {formatGaugeValue(p95)}</div>
    </div>
  );
}

export function ThroughputGaugeGrid({ metrics, iterationMetrics, rangePercentile, gauges }: RunThroughputGaugesProps) {
  const displayed = metrics;
  const allGauges: GaugeMetric[] = [
    {
      key: 'kusto',
      label: 'Kusto read throughput',
      value: displayed?.kustoReadThroughputRowsPerSec ?? null,
      unit: 'rows/sec',
      color: '#38bdf8',
      description: 'Raw source rows read per second during Kusto query + row mapping time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.kustoReadThroughputRowsPerSec),
    },
    {
      key: 'processing',
      label: 'Processing throughput',
      value: displayed?.processingThroughputRowsPerSec ?? null,
      unit: 'rows/sec',
      color: '#34d399',
      description: 'Raw source rows processed per second over total cycle/run wall time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.processingThroughputRowsPerSec),
    },
    {
      key: 'event',
      label: 'Event throughput',
      value: displayed?.eventThroughputEventsPerSec ?? null,
      unit: 'events/sec',
      color: '#f59e0b',
      description: 'Finalized output events/interactions per second over total cycle/run wall time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.eventThroughputEventsPerSec),
    },
    {
      key: 'compression',
      label: 'Compression rate',
      value: displayed?.compressionRateRowsPerEvent ?? null,
      unit: 'rows/event',
      color: '#a78bfa',
      description: 'Raw input rows represented by each finalized event/interaction.',
      rangeValues: iterationMetrics.map((candidate) => candidate.compressionRateRowsPerEvent),
    },
    {
      key: 'checkpointVelocity',
      label: 'Checkpoint velocity',
      value: displayed?.checkpointVelocitySourcePerWall ?? null,
      unit: 'src sec/wall sec',
      color: '#fb7185',
      description: 'Source-time seconds advanced between durable continuation or band checkpoints per wall-clock second; >1 catches up, <1 falls behind.',
      rangeValues: iterationMetrics.map((candidate) => candidate.checkpointVelocitySourcePerWall),
    },
    {
      key: 'cosmos',
      label: 'Cosmos write throughput',
      value: displayed?.cosmosWriteThroughputBatchesPerSec ?? null,
      unit: 'batches/sec',
      color: '#f472b6',
      description: 'Successful Cosmos partition-batch writes per second over Cosmos write-stage time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.cosmosWriteThroughputBatchesPerSec),
    },
  ];

  const order = gauges ?? DEFAULT_GAUGE_KEYS;
  const byKey = new Map(allGauges.map((g) => [g.key, g]));
  const gaugeMetrics = order.map((key) => byKey.get(key)).filter((g): g is GaugeMetric => g !== undefined);

  return (
    <div className="gauge-grid">
      {gaugeMetrics.map((metric) => (
        (() => {
          const values = finiteValues(metric.rangeValues.length > 0 ? metric.rangeValues : [metric.value]);
          return (
            <Gauge
              key={metric.key}
              metric={metric}
              range={gaugeRange(values, rangePercentile)}
              p95={percentile(values, 95)}
              rangePercentile={rangePercentile}
            />
          );
        })()
      ))}
    </div>
  );
}

export function RunThroughputGauges(props: RunThroughputGaugesProps) {
  return (
    <Panel
      title="Run throughput"
      eyebrow="weighted full-run metrics"
      description="Dials show weighted full-run totals. Each dial range is based on the per-iteration min/max for that metric with 10% padding."
    >
      <ThroughputGaugeGrid {...props} />
    </Panel>
  );
}
