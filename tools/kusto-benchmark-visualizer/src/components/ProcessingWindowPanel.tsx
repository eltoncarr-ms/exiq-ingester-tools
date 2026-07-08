import type { PipelineShardOption, PipelineWindowSnapshot } from '../benchmark/derive';
import { formatAxisDateTime, formatDateTime, formatNumber } from '../benchmark/format';
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
      <Panel title="Processing window" eyebrow="queue state" actions={actions} description="No shard iterations are available for this run.">
        <div className="chart-empty">Load a benchmark run with iterations to see processing-window state.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Processing window"
      eyebrow={`${snapshot.shardId} · ${snapshot.source === 'pipeline' ? 'pipeline snapshot' : 'aggregate fallback'}`}
      description={
        snapshot.source === 'aggregate'
          ? 'Old artifact fallback: checkpoint/watermark state is derived only from checkpoint.advancedTo.'
          : 'Latest active pipeline window for the selected shard.'
      }
      actions={actions}
    >
      <div className="pipeline-metrics">
        <Metric label="Shard id" value={snapshot.shardId} />
        <Metric label="Window start" value={formatOptionalUtc(snapshot.windowStartUtc)} />
        <Metric label="Window end" value={formatOptionalUtc(snapshot.windowEndUtc)} />
        <Metric label="Observed" value={formatOptionalUtc(snapshot.currentTimeUtc)} />
        <Metric label="Current-window messages" value={formatNumber(snapshot.currentWindowMessages, 0)} />
        <Metric label="Total shard messages" value={formatNumber(snapshot.totalShardMessages, 0)} />
        <Metric label="Backlog" value={formatNumber(snapshot.backlogMessages, 0)} />
        <Metric label="Blocked" value={formatNumber(snapshot.blockedMessages, 0)} />
        <Metric label={snapshot.source === 'aggregate' ? 'Checkpoint watermark' : 'Checkpoint'} value={formatCheckpoint(snapshot)} />
        <Metric label="Watermark" value={snapshot.source === 'pipeline' ? formatOptionalUtc(snapshot.watermarkUtc) : 'checkpoint-only fallback'} />
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
  const pad = { left: 28, right: 28, top: 36, bottom: 30 };
  const windowStart = parseUtc(snapshot.windowStartUtc);
  const windowEnd = parseUtc(snapshot.windowEndUtc);
  const current = parseUtc(snapshot.currentTimeUtc) ?? snapshot.observedAtMs;
  const markers = [
    { key: 'current', label: 'Current', atMs: current, className: 'processing-timeline__marker--current' },
    ...(snapshot.source === 'pipeline'
      ? [
          { key: 'watermark', label: 'Watermark', atMs: parseUtc(snapshot.watermarkUtc), className: 'processing-timeline__marker--watermark' },
          { key: 'candidate', label: 'Candidate', atMs: parseUtc(snapshot.candidateWatermarkUtc), className: 'processing-timeline__marker--candidate' },
          { key: 'checkpoint', label: 'Checkpoint', atMs: parseUtc(snapshot.checkpointAdvancedToUtc), className: 'processing-timeline__marker--checkpoint' },
        ]
      : [{ key: 'checkpoint', label: 'Checkpoint', atMs: parseUtc(snapshot.checkpointAdvancedToUtc), className: 'processing-timeline__marker--checkpoint' }]),
  ].filter((marker): marker is { key: string; label: string; atMs: number; className: string } => marker.atMs !== null);
  const domainValues = [windowStart, windowEnd, current, ...markers.map((marker) => marker.atMs)].filter((value): value is number => value !== null);
  const domainStart = Math.min(...domainValues, current - 60_000);
  const domainEnd = Math.max(...domainValues, current + 60_000, domainStart + 1);
  const xFor = (atMs: number) => pad.left + ((atMs - domainStart) / (domainEnd - domainStart)) * (width - pad.left - pad.right);
  const windowX = windowStart === null ? null : xFor(windowStart);
  const windowWidth = windowStart === null || windowEnd === null ? 0 : Math.max(2, xFor(windowEnd) - xFor(windowStart));

  return (
    <div className="processing-timeline">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="processing-timeline__svg">
        <line className="processing-timeline__axis" x1={pad.left} x2={width - pad.right} y1={72} y2={72} />
        {windowX !== null && (
          <rect className="processing-timeline__window" x={windowX} y={48} width={windowWidth} height={48} rx={12}>
            <title>
              Window {formatOptionalUtc(snapshot.windowStartUtc)} → {formatOptionalUtc(snapshot.windowEndUtc)}
            </title>
          </rect>
        )}
        {[domainStart, domainStart + (domainEnd - domainStart) / 2, domainEnd].map((tick) => (
          <text key={tick} className="processing-timeline__tick" x={xFor(tick)} y={height - 8} textAnchor={tick === domainStart ? 'start' : tick === domainEnd ? 'end' : 'middle'}>
            {formatAxisDateTime(tick)}
          </text>
        ))}
        {markers.map((marker, index) => (
          <g key={marker.key}>
            <line className={`processing-timeline__marker ${marker.className}`} x1={xFor(marker.atMs)} x2={xFor(marker.atMs)} y1={30} y2={104} />
            <text className="processing-timeline__label" x={xFor(marker.atMs)} y={18 + (index % 2) * 14} textAnchor="middle">
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
      {snapshot.source === 'aggregate' && snapshot.rawCheckpointAdvancedTo === null && (
        <div className="fallback-note">checkpoint.advancedTo is null, so the fallback watermark is not advanced.</div>
      )}
    </div>
  );
}
