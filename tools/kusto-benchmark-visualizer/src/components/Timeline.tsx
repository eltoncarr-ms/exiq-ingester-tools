import { STAGE_DEFINITIONS, type RunAnalysis } from '../benchmark/derive';
import { formatDuration } from '../benchmark/format';
import { Panel } from './Panel';

interface TimelineProps {
  analysis: RunAnalysis;
}

export function Timeline({ analysis }: TimelineProps) {
  const width = 980;
  const rowHeight = 42;
  const padLeft = 146;
  const padRight = 20;
  const padTop = 24;
  const height = padTop + STAGE_DEFINITIONS.length * rowHeight + 28;
  const innerWidth = width - padLeft - padRight;
  const timelineEnd = Math.max(analysis.timelineEndMs, 1);
  const xFor = (ms: number) => padLeft + (Math.max(0, ms) / timelineEnd) * innerWidth;

  return (
    <Panel title="Ingestion stage timeline" eyebrow={analysis.label}>
      <svg className="timeline" viewBox={`0 0 ${width} ${height}`} role="img">
        <line className="timeline__axis" x1={padLeft} x2={width - padRight} y1={height - 22} y2={height - 22} />
        {[0, timelineEnd / 2, timelineEnd].map((tick) => (
          <g key={tick}>
            <line className="timeline__grid" x1={xFor(tick)} x2={xFor(tick)} y1={padTop - 10} y2={height - 22} />
            <text className="timeline__tick" x={xFor(tick)} y={height - 6} textAnchor={tick === 0 ? 'start' : tick === timelineEnd ? 'end' : 'middle'}>
              {formatDuration(tick)}
            </text>
          </g>
        ))}
        {STAGE_DEFINITIONS.map((stage, row) => {
          const y = padTop + row * rowHeight;
          const segments = analysis.timelineSegments.filter((segment) => segment.stageKey === stage.key && segment.durationMs > 0);

          return (
            <g key={stage.key}>
              <text className="timeline__label" x={14} y={y + 23}>
                {stage.label}
              </text>
              <line className="timeline__lane" x1={padLeft} x2={width - padRight} y1={y + 16} y2={y + 16} />
              {segments.map((segment) => {
                const x = xFor(segment.startMs);
                const barWidth = Math.max(2, xFor(segment.endMs) - x);
                return (
                  <rect
                    key={`${segment.iterationId}-${segment.stageKey}`}
                    className="timeline__bar"
                    x={x}
                    y={y + 8}
                    width={barWidth}
                    height={16}
                    rx={5}
                    fill={segment.color}
                  >
                    <title>
                      {segment.iterationId} · {segment.shardId} · {segment.stageLabel}: {formatDuration(segment.durationMs)}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}
