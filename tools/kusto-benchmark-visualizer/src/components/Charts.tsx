import { formatDuration, formatNumber } from '../benchmark/format';

export interface LineSeries {
  name: string;
  color: string;
  points: Array<{ xMs: number; value: number; label: string }>;
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  includeZero?: boolean;
  valueFormatter?: (value: number) => string;
  emptyText?: string;
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
  valueFormatter = (value) => formatNumber(value, 1),
  emptyText = 'No data',
}: LineChartProps) {
  const allPoints = series.flatMap((item) => item.points).filter((point) => Number.isFinite(point.xMs) && Number.isFinite(point.value));
  if (allPoints.length === 0) {
    return <div className="chart-empty">{emptyText}</div>;
  }

  const width = 720;
  const pad = { left: 54, right: 18, top: 18, bottom: 32 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xValues = finiteValues(allPoints.map((point) => point.xMs));
  const yValues = finiteValues(allPoints.map((point) => point.value));
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = includeZero ? Math.min(0, ...yValues) : Math.min(...yValues);
  const yMax = Math.max(includeZero ? 1 : yMin + 1, ...yValues);
  const yTicks = [yMin, yMin + (yMax - yMin) / 2, yMax];

  return (
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
        {formatDuration(xMin)}
      </text>
      <text className="chart__tick" x={width - pad.right} y={height - 8} textAnchor="end">
        {formatDuration(xMax)}
      </text>
      {series.map((item) => {
        const points = item.points
          .filter((point) => Number.isFinite(point.xMs) && Number.isFinite(point.value))
          .map((point) => ({
            ...point,
            x: pad.left + scale(point.xMs, xMin, xMax, innerWidth),
            y: pad.top + innerHeight - scale(point.value, yMin, yMax, innerHeight),
          }));
        const path = points.map((point) => `${point.x},${point.y}`).join(' ');

        return (
          <g key={item.name}>
            <polyline className="chart__line" points={path} fill="none" stroke={item.color} />
            {points.map((point) => (
              <circle key={`${item.name}-${point.label}`} className="chart__dot" cx={point.x} cy={point.y} r={3.5} fill={item.color}>
                <title>
                  {item.name}: {valueFormatter(point.value)} at {formatDuration(point.xMs)} · {point.label}
                </title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export interface StackedBarPoint {
  label: string;
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
  const visibleTotals = points.map((point) => (showFull ? point.fullFlushes : 0) + (showPartial ? point.partialFlushes : 0));
  const maxTotal = Math.max(1, ...visibleTotals);

  return (
    <div className="bar-chart" role="img" aria-label="Flush volumes split by full and partial flushes">
      {points.map((point) => {
        const partialPct = ((showPartial ? point.partialFlushes : 0) / maxTotal) * 100;
        const fullPct = ((showFull ? point.fullFlushes : 0) / maxTotal) * 100;

        return (
          <div className="bar-chart__item" key={point.label}>
            <div className="bar-chart__bar" title={`${point.label}: ${point.partialFlushes} partial, ${point.fullFlushes} full, ${point.flushDocuments} docs`}>
              {showPartial && <span className="bar-chart__seg bar-chart__seg--partial" style={{ height: `${partialPct}%` }} />}
              {showFull && <span className="bar-chart__seg bar-chart__seg--full" style={{ height: `${fullPct}%` }} />}
            </div>
            <span className="bar-chart__label">{point.label.replace('iter-', '')}</span>
          </div>
        );
      })}
    </div>
  );
}
