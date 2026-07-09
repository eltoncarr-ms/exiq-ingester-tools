import type { PipelineShardOption, PipelineWindowSnapshot } from '../benchmark/derive';
import { formatDateTime, formatNumber } from '../benchmark/format';
import { Panel } from './Panel';

interface ProcessingWindowPanelProps {
  snapshot: PipelineWindowSnapshot | null;
  shardOptions: PipelineShardOption[];
  selectedShardId: string | null;
  onShardChange: (shardId: string) => void;
}

function parseUtc(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatOptionalUtc(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

function formatCheckpoint(snapshot: PipelineWindowSnapshot): string {
  if (snapshot.rawCheckpointAdvancedTo === null || snapshot.rawCheckpointAdvancedTo === undefined) return 'not advanced';
  if (typeof snapshot.rawCheckpointAdvancedTo === 'string') return formatDateTime(snapshot.rawCheckpointAdvancedTo);

  return String(snapshot.rawCheckpointAdvancedTo);
}

function formatGap(valueMs: number): string {
  const seconds = Math.max(0, valueMs / 1000);
  if (seconds < 90) return `${formatNumber(seconds, seconds < 10 ? 1 : 0)} sec`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${formatNumber(minutes, minutes < 10 ? 1 : 0)} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${formatNumber(hours, hours < 10 ? 1 : 0)} hr`;
  return `${formatNumber(hours / 24, 1)} days`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ProcessingWindowPanel({ snapshot, shardOptions, selectedShardId, onShardChange }: ProcessingWindowPanelProps) {
  const actions =
    shardOptions.length > 0 ? (
      <label className="shard-select">
        Shard
        <select value={selectedShardId ?? shardOptions[0]?.shardId ?? ''} onChange={(event) => onShardChange(event.target.value)}>
          {shardOptions.map((option) => (
            <option key={option.shardId} value={option.shardId}>
              {option.label}
              {option.hasIncompletePipeline ? ' · active' : ''}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  if (!snapshot) {
    return (
      <Panel title="Processing window" actions={actions} description="No shard iterations are available for this run.">
        <div className="chart-empty">Load a benchmark run with iterations to see processing-window state.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Processing window"
      description={
        snapshot.source === 'aggregate'
          ? 'Selected Kusto window. Checkpoint state is available only when emitted by the artifact.'
          : 'Selected Kusto window with the checkpoint position overlaid.'
      }
      actions={actions}
    >
      <div className="pipeline-metrics">
        <div className="pipeline-metrics__row pipeline-metrics__row--primary">
          <Metric label="Shard id" value={snapshot.shardId} />
          <Metric label="Window start" value={formatOptionalUtc(snapshot.windowStartUtc)} />
          <Metric label="Window end" value={formatOptionalUtc(snapshot.windowEndUtc)} />
          <Metric label="Checkpoint" value={formatCheckpoint(snapshot)} />
        </div>
        <div className="pipeline-metrics__row pipeline-metrics__row--secondary">
          <Metric
            label="Window duration"
            value={
              parseUtc(snapshot.windowStartUtc) !== null && parseUtc(snapshot.windowEndUtc) !== null
                ? formatGap(Math.max(0, (parseUtc(snapshot.windowEndUtc) ?? 0) - (parseUtc(snapshot.windowStartUtc) ?? 0)))
                : '—'
            }
          />
          <Metric label="Window messages" value={formatNumber(snapshot.currentWindowMessages, 0)} />
          <Metric label="Blocked" value={formatNumber(snapshot.blockedMessages, 0)} />
        </div>
      </div>
      <ProcessingTimeline snapshot={snapshot} />
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card metric-card--compact">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
    </div>
  );
}

function ProcessingTimeline({ snapshot }: { snapshot: PipelineWindowSnapshot }) {
  const width = 920;
  const height = 132;
  const track = { x: 128, y: 64, width: width - 256, height: 38 };
  const windowStart = parseUtc(snapshot.windowStartUtc);
  const windowEnd = parseUtc(snapshot.windowEndUtc);
  const checkpoint = parseUtc(snapshot.checkpointAdvancedToUtc);
  const hasWindow = windowStart !== null && windowEnd !== null && windowEnd >= windowStart;
  const windowDuration = hasWindow ? Math.max(1, windowEnd - windowStart) : 1;
  const xFor = (atMs: number) => {
    if (!hasWindow) return track.x;
    return track.x + ((clamp(atMs, windowStart, windowEnd) - windowStart) / windowDuration) * track.width;
  };
  const checkpointX = checkpoint !== null ? xFor(checkpoint) : null;
  const checkpointFillWidth = checkpointX === null ? 0 : clamp(checkpointX - track.x, 0, track.width);
  const windowMessages = `${formatNumber(snapshot.currentWindowMessages, 0)} msg`;
  const windowDurationLabel = hasWindow ? formatGap(Math.max(0, windowEnd - windowStart)) : '—';
  const checkpointLabelWidth = 94;
  const checkpointLabelX = checkpointX === null ? null : clamp(checkpointX, checkpointLabelWidth / 2, width - checkpointLabelWidth / 2);

  return (
    <div className="processing-timeline">
      {hasWindow ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" className="processing-timeline__svg">
          <TimelineSideLabel label="Window start" x={track.x - 12} y={track.y + track.height / 2} anchor="end" />
          <rect className="processing-timeline__window" x={track.x} y={track.y} width={track.width} height={track.height} rx={12}>
           <title>
             Window {formatOptionalUtc(snapshot.windowStartUtc)} to {formatOptionalUtc(snapshot.windowEndUtc)}
           </title>
          </rect>
          {checkpointFillWidth > 0 && (
           <rect className="processing-timeline__checkpoint-fill" x={track.x} y={track.y} width={checkpointFillWidth} height={track.height} rx={12}>
             <title>Checkpoint coverage within the current window</title>
           </rect>
          )}
          <text className="processing-timeline__segment-text" x={track.x + track.width / 2} y={track.y + 24} textAnchor="middle">
           {windowDurationLabel} · {windowMessages}
          </text>
          {checkpointX !== null && checkpointLabelX !== null && (
          <g>
             <rect
               className="processing-timeline__label-chip processing-timeline__label-chip--checkpoint"
               x={checkpointLabelX - checkpointLabelWidth / 2}
               y={16}
               width={checkpointLabelWidth}
               height={22}
               rx={11}
             />
             <text className="processing-timeline__label" x={checkpointLabelX} y={31} textAnchor="middle">
               Checkpoint
             </text>
           </g>
          )}
          <line className="processing-timeline__marker processing-timeline__marker--boundary" x1={track.x} x2={track.x} y1={track.y - 10} y2={track.y + track.height + 10} />
          <line className="processing-timeline__marker processing-timeline__marker--boundary" x1={track.x + track.width} x2={track.x + track.width} y1={track.y - 10} y2={track.y + track.height + 10} />
          {checkpointX !== null && (
          <>
             <line className="processing-timeline__marker processing-timeline__marker--checkpoint" x1={checkpointX} x2={checkpointX} y1={track.y - 10} y2={track.y + track.height + 10} />
             <circle className="processing-timeline__checkpoint-dot" cx={checkpointX} cy={track.y + track.height / 2} r={5} />
          </>
          )}
          <TimelineSideLabel label="Window end" x={track.x + track.width + 12} y={track.y + track.height / 2} anchor="start" />
        </svg>
      ) : (
        <div className="chart-empty">Window start and end are not available for this snapshot.</div>
      )}
      {snapshot.source === 'aggregate' && snapshot.rawCheckpointAdvancedTo === null && (
        <div className="fallback-note">checkpoint.advancedTo is null, so the fallback watermark is not advanced.</div>
      )}
      {snapshot.source === 'pipeline' && checkpoint === null && <div className="fallback-note">Checkpoint position is not available for this snapshot.</div>}
    </div>
  );
}

function TimelineSideLabel({ label, x, y, anchor }: { label: string; x: number; y: number; anchor: 'start' | 'end' }) {
  const width = Math.max(88, label.length * 7 + 22);
  const chipX = anchor === 'end' ? x - width : x;
  const textX = anchor === 'end' ? x - width / 2 : x + width / 2;

  return (
    <g>
      <rect className="processing-timeline__label-chip" x={chipX} y={y - 11} width={width} height={22} rx={11} />
      <text className="processing-timeline__label" x={textX} y={y + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
