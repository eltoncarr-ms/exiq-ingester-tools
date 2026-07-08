import { formatAxisDateTime, formatNumber } from '../benchmark/format';

export interface LineSeries {
  name: string;
  color: string;
  points: Array<{ xMs: number; xAtMs?: number; value: number; label: string }>;
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  includeZero?: boolean;
  xDomain?: { startAtMs: number; endAtMs: number };
  valueFormatter?: (value: number) => string;
  emptyText?: string;
  showLegend?: boolean;
}

function finiteValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function scale(value: number, min: number, max: number, size: number): number {
  if (max <= min) return size / 2;

  return ((value - min) / (max - min)) * size;
}

export function LineChart({
  series,
  height = 190,
  includeZero = true,
  xDomain,
  valueFormatter = (value) => formatNumber(value, 1),
  emptyText = 'No data',
  showLegend = false,
}: LineChartProps) {
  const allPoints = series.flatMap((item) => item.points).filter((point) => Number.isFinite(point.xMs) && Number.isFinite(point.value));
  if (allPoints.length === 0) {
    return <div className="chart-empty">{emptyText}</div>;
  }

  const width = 720;
  const pad = { left: 54, right: 18, top: 18, bottom: 32 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xValues = finiteValues(allPoints.map((point) => point.xAtMs ?? point.xMs));
  const yValues = finiteValues(allPoints.map((point) => point.value));
  const xMin = xDomain?.startAtMs ?? Math.min(...xValues);
  const xMax = xDomain?.endAtMs ?? Math.max(...xValues);
  const yMin = includeZero ? Math.min(0, ...yValues) : Math.min(...yValues);
  const yMax = Math.max(includeZero ? 1 : yMin + 1, ...yValues);
  const yTicks = [yMin, yMin + (yMax - yMin) / 2, yMax];

  const chart = (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
      {yTicks.map((tick) => {
        const y = pad.top + innerHeight - scale(tick, yMin, yMax, innerHeight);
        return (
          <g key={tick}>
            <line className="chart__grid" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
            <text className="chart__tick" x={pad.left - 8} y={y + 4} textAnchor="end">
              {valueFormatter(tick)}
            </text>
          </g>
        );
      })}
      <text className="chart__tick" x={pad.left} y={height - 8}>
        {formatAxisDateTime(xMin)}
      </text>
      <text className="chart__tick" x={width - pad.right} y={height - 8} textAnchor="end">
        {formatAxisDateTime(xMax)}
      </text>
      {series.map((item) => {
        const points = item.points
          .filter((point) => Number.isFinite(point.xMs) && Number.isFinite(point.value))
          .map((point) => ({
            ...point,
            x: pad.left + scale(point.xAtMs ?? point.xMs, xMin, xMax, innerWidth),
            y: pad.top + innerHeight - scale(point.value, yMin, yMax, innerHeight),
          }));
        const path = points.map((point) => `${point.x},${point.y}`).join(' ');

        return (
          <g key={item.name}>
            <polyline className="chart__line" points={path} fill="none" stroke={item.color} />
            {points.map((point) => (
              <circle key={`${item.name}-${point.label}`} className="chart__dot" cx={point.x} cy={point.y} r={3.5} fill={item.color}>
                <title>
                  {item.name}: {valueFormatter(point.value)} at {formatAxisDateTime(point.xAtMs ?? point.xMs)} · {point.label}
                </title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );

  if (!showLegend) return chart;

  return (
    <div className="chart-shell">
      <div className="chart-legend" aria-label="Chart legend">
        {series.map((item) => (
          <span key={item.name} className="chart-legend__item">
            <span className="chart-legend__swatch" style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
      </div>
      {chart}
    </div>
  );
}

export interface StackedBarPoint {
  label: string;
  xAtMs?: number;
  fullFlushes: number;
  partialFlushes: number;
  flushDocuments: number;
}

interface StackedBarChartProps {
  points: StackedBarPoint[];
  showFull: boolean;
  showPartial: boolean;
}

export function StackedBarChart({ points, showFull, showPartial }: StackedBarChartProps) {
  const visiblePoints = points.filter((point) => {
    if (showFull && point.fullFlushes > 0) return true;
    if (showPartial && point.partialFlushes > 0) return true;
    return point.fullFlushes === 0 && point.partialFlushes === 0 && showFull && showPartial;
  });
  const maxDocuments = Math.max(1, ...visiblePoints.map((point) => point.flushDocuments));

  return (
    <div className="bar-chart" role="img" aria-label="Flush document volumes with full and partial flush markers">
      {visiblePoints.map((point) => {
        const documentPct = (point.flushDocuments / maxDocuments) * 100;

        return (
          <div className="bar-chart__item" key={point.label}>
            <div className="bar-chart__docs">{formatNumber(point.flushDocuments, 0)}</div>
            <div
              className="bar-chart__bar"
              title={`${point.label}: ${point.flushDocuments} documents, ${point.partialFlushes} partial flush(es), ${point.fullFlushes} full flush(es)`}
            >
              <span className="bar-chart__seg bar-chart__seg--docs" style={{ height: `${documentPct}%` }} />
            </div>
            <div className="bar-chart__badges">
              {point.partialFlushes > 0 && <span className="bar-chart__badge bar-chart__badge--partial">P{formatNumber(point.partialFlushes, 0)}</span>}
              {point.fullFlushes > 0 && <span className="bar-chart__badge bar-chart__badge--full">F{formatNumber(point.fullFlushes, 0)}</span>}
            </div>
            <span className="bar-chart__label">{point.xAtMs ? formatAxisDateTime(point.xAtMs) : point.label}</span>
          </div>
        );
      })}
    </div>
  );
}
