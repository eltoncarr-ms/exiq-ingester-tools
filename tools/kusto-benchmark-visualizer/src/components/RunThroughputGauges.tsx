import { useId } from 'react';
import type { IterationThroughputMetrics, RunThroughputMetrics } from '../benchmark/derive';
import { formatNumber } from '../benchmark/format';
import { Panel } from './Panel';

interface RunThroughputGaugesProps {
  metrics: RunThroughputMetrics | null;
  iterationMetrics: IterationThroughputMetrics[];
}

interface GaugeMetric {
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

function gaugeRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

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

function Gauge({ metric, range, p95 }: { metric: GaugeMetric; range: { min: number; max: number }; p95: number | null }) {
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

export function ThroughputGaugeGrid({ metrics, iterationMetrics }: RunThroughputGaugesProps) {
  const displayed = metrics;
  const gaugeMetrics: GaugeMetric[] = [
    {
      label: 'Kusto read throughput',
      value: displayed?.kustoReadThroughputRowsPerSec ?? 0,
      unit: 'rows/sec',
      color: '#38bdf8',
      description: 'Raw source rows read per second during Kusto query + row mapping time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.kustoReadThroughputRowsPerSec),
    },
    {
      label: 'Processing throughput',
      value: displayed?.processingThroughputRowsPerSec ?? 0,
      unit: 'rows/sec',
      color: '#34d399',
      description: 'Raw source rows processed per second over total cycle/run wall time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.processingThroughputRowsPerSec),
    },
    {
      label: 'Event throughput',
      value: displayed?.eventThroughputEventsPerSec ?? 0,
      unit: 'events/sec',
      color: '#f59e0b',
      description: 'Finalized output events/interactions per second over total cycle/run wall time.',
      rangeValues: iterationMetrics.map((candidate) => candidate.eventThroughputEventsPerSec),
    },
    {
      label: 'Compression rate',
      value: displayed?.compressionRateRowsPerEvent ?? null,
      unit: 'rows/event',
      color: '#a78bfa',
      description: 'Raw input rows represented by each finalized event/interaction.',
      rangeValues: iterationMetrics.map((candidate) => candidate.compressionRateRowsPerEvent),
    },
    {
      label: 'Checkpoint velocity',
      value: displayed?.checkpointVelocitySourcePerWall ?? 0,
      unit: 'src sec/wall sec',
      color: '#fb7185',
      description: 'Source-time seconds successfully advanced per wall-clock second; >1 catches up, <1 falls behind.',
      rangeValues: iterationMetrics.map((candidate) => candidate.checkpointVelocitySourcePerWall),
    },
  ];

  return (
    <div className="gauge-grid">
      {gaugeMetrics.map((metric) => (
        (() => {
          const values = finiteValues(metric.rangeValues.length > 0 ? metric.rangeValues : [metric.value]);
          return <Gauge key={metric.label} metric={metric} range={gaugeRange(values)} p95={percentile(values, 95)} />;
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
