import type { RunAnalysis } from '../benchmark/derive';
import { formatAxisDateTime, formatNumber } from '../benchmark/format';
import { Panel } from './Panel';

interface TrendPoint {
  label: string;
  xAtMs: number;
  value: number;
}

interface TrendDefinition {
  title: string;
  unit: string;
  color: string;
  includeZero: boolean;
  points: TrendPoint[];
  formatValue: (value: number) => string;
}

interface ThroughputTrendChartsProps {
  analysis: RunAnalysis;
}

function formatThroughput(value: number): string {
  return formatNumber(value, value >= 100 ? 0 : 1);
}

function formatCompression(value: number): string {
  return formatNumber(value, value >= 100 ? 0 : 1);
}

function buildTrendPoints(
  analysis: RunAnalysis,
  selector: (metric: RunAnalysis['iterationThroughputMetrics'][number]) => number | null,
): TrendPoint[] {
  const anchors = new Map(analysis.throughputPoints.map((point) => [point.iterationId, point]));

  return analysis.iterationThroughputMetrics
    .map((metric) => {
      const anchor = anchors.get(metric.iterationId);
      const value = selector(metric);
      if (!anchor || value === null || !Number.isFinite(value)) return null;

      return {
        label: anchor.label,
        xAtMs: anchor.xAtMs,
        value,
      };
    })
    .filter((point): point is TrendPoint => point !== null)
    .sort((left, right) => left.xAtMs - right.xAtMs);
}

function buildDefinitions(analysis: RunAnalysis): TrendDefinition[] {
  return [
    {
      title: 'Kusto read throughput over time',
      unit: 'rows/sec',
      color: '#38bdf8',
      includeZero: true,
      points: buildTrendPoints(analysis, (metric) => metric.kustoReadThroughputRowsPerSec),
      formatValue: formatThroughput,
    },
    {
      title: 'Processing throughput over time',
      unit: 'rows/sec',
      color: '#34d399',
      includeZero: true,
      points: buildTrendPoints(analysis, (metric) => metric.processingThroughputRowsPerSec),
      formatValue: formatThroughput,
    },
    {
      title: 'Event throughput over time',
      unit: 'events/sec',
      color: '#a78bfa',
      includeZero: true,
      points: buildTrendPoints(analysis, (metric) => metric.eventThroughputEventsPerSec),
      formatValue: formatThroughput,
    },
    {
      title: 'Compression rate over time',
      unit: 'rows/event',
      color: '#f59e0b',
      includeZero: false,
      points: buildTrendPoints(analysis, (metric) => metric.compressionRateRowsPerEvent),
      formatValue: formatCompression,
    },
    {
      title: 'Checkpoint velocity over time',
      unit: 'src sec/wall sec',
      color: '#fb7185',
      includeZero: true,
      points: buildTrendPoints(analysis, (metric) => metric.checkpointVelocitySourcePerWall),
      formatValue: formatThroughput,
    },
  ];
}

export function ThroughputTrendCharts({ analysis }: ThroughputTrendChartsProps) {
  const definitions = buildDefinitions(analysis);

  return (
    <Panel
      title="Throughput trends"
      description="Per-iteration trend lines for the same five metrics shown in the run gauges."
    >
      <div className="trend-grid">
        {definitions.map((definition) => (
          <TrendCard key={definition.title} definition={definition} />
        ))}
      </div>
    </Panel>
  );
}

function TrendCard({ definition }: { definition: TrendDefinition }) {
  const latest = definition.points.at(-1);

  return (
    <section className="trend-card" aria-label={definition.title}>
      <div className="trend-card__head">
        <div>
          <h3>{definition.title}</h3>
          <span>{definition.unit}</span>
        </div>
        <strong>{latest ? definition.formatValue(latest.value) : '—'}</strong>
      </div>
      <MiniTrendChart definition={definition} />
    </section>
  );
}

function MiniTrendChart({ definition }: { definition: TrendDefinition }) {
  const width = 420;
  const height = 150;
  const pad = { left: 50, right: 12, top: 14, bottom: 24 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const extents = trendExtents(definition.points, definition.includeZero);

  if (definition.points.length === 0 || !extents) {
    return <div className="trend-card__empty">No iteration data</div>;
  }

  const xFor = (value: number) => pad.left + scale(value, extents.xMin, extents.xMax, innerWidth);
  const yFor = (value: number) => pad.top + innerHeight - scale(value, extents.yMin, extents.yMax, innerHeight);
  const plotted = definition.points.map((point) => ({
    ...point,
    x: xFor(point.xAtMs),
    y: yFor(point.value),
  }));
  const linePath = plotted.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPath =
    plotted.length > 1
      ? `M ${plotted[0].x} ${pad.top + innerHeight} L ${plotted.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${plotted.at(-1)?.x ?? pad.left} ${pad.top + innerHeight} Z`
      : '';
  const latest = plotted.at(-1);
  const yTicks = [extents.yMin, extents.yMin + (extents.yMax - extents.yMin) / 2, extents.yMax];

  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      {yTicks.map((tick) => {
        const y = yFor(tick);
        return (
          <g key={tick}>
            <line className="trend-chart__grid" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
            <text className="trend-chart__tick" x={pad.left - 8} y={y + 4} textAnchor="end">
              {definition.formatValue(tick)}
            </text>
          </g>
        );
      })}
      {areaPath && <path className="trend-chart__area" d={areaPath} fill={definition.color} />}
      <polyline className="trend-chart__line" points={linePath} fill="none" stroke={definition.color} />
      {plotted.map((point) => (
        <circle key={`${definition.title}-${point.label}`} className="trend-chart__dot" cx={point.x} cy={point.y} r={3.2} fill={definition.color}>
          <title>
            {definition.title}: {definition.formatValue(point.value)} {definition.unit} at {formatAxisDateTime(point.xAtMs)}
          </title>
        </circle>
      ))}
      {latest && <circle className="trend-chart__latest" cx={latest.x} cy={latest.y} r={5} fill={definition.color} />}
      <text className="trend-chart__tick" x={pad.left} y={height - 6}>
        {formatAxisDateTime(extents.xMin)}
      </text>
      <text className="trend-chart__tick" x={width - pad.right} y={height - 6} textAnchor="end">
        {formatAxisDateTime(extents.xMax)}
      </text>
    </svg>
  );
}

function trendExtents(points: TrendPoint[], includeZero: boolean) {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    xMin = Math.min(xMin, point.xAtMs);
    xMax = Math.max(xMax, point.xAtMs);
    yMin = Math.min(yMin, point.value);
    yMax = Math.max(yMax, point.value);
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;

  if (xMax <= xMin) {
    xMin -= 1;
    xMax += 1;
  }

  if (includeZero) {
    yMin = Math.min(0, yMin);
  }

  const yPadding = Math.max((yMax - yMin) * 0.1, yMax === 0 ? 1 : Math.abs(yMax) * 0.05);
  yMin = includeZero ? Math.min(0, yMin) : yMin - yPadding;
  yMax += yPadding;

  if (yMax <= yMin) {
    yMin -= 1;
    yMax += 1;
  }

  return { xMin, xMax, yMin, yMax };
}

function scale(value: number, min: number, max: number, size: number): number {
  if (max <= min) return size / 2;

  return ((value - min) / (max - min)) * size;
}
