import type { PipelineWindowSnapshot } from '../benchmark/derive';
import { formatDateTime, formatNumber } from '../benchmark/format';
import { Panel } from './Panel';

interface QueueVisualizationPanelProps {
  snapshot: PipelineWindowSnapshot | null;
}

const STATUS_LABELS = {
  pending: 'Pending',
  done: 'Done',
  skipped: 'Skipped',
  duplicateAcknowledged: 'Duplicate ack',
  poisoned: 'Poisoned',
} as const;

const EVENT_LABELS = {
  read: 'Read',
  rehydrate: 'Rehydrate',
  process: 'Process',
  flush: 'Flush',
  checkpoint: 'Checkpoint',
  blocked: 'Blocked',
  duplicate: 'Duplicate',
} as const;

export function QueueVisualizationPanel({ snapshot }: QueueVisualizationPanelProps) {
  if (!snapshot) {
    return (
      <Panel title="Queue visualization" eyebrow="message state">
        <div className="chart-empty">No queue data is available.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Queue visualization"
      eyebrow={`${snapshot.iterationId} · ${snapshot.shardId}`}
      description={
        snapshot.source === 'pipeline'
          ? 'Sampled messages are colorized by current status; aggregate counts still represent the full window.'
          : 'Aggregate fallback for old artifacts. No per-message cells are fabricated because the source artifact has no message samples.'
      }
    >
      <StatusLegend snapshot={snapshot} />
      {snapshot.source === 'pipeline' ? <PipelineQueue snapshot={snapshot} /> : <AggregateFallback snapshot={snapshot} />}
      {snapshot.events.length > 0 && <EventMarkers snapshot={snapshot} />}
    </Panel>
  );
}

function StatusLegend({ snapshot }: { snapshot: PipelineWindowSnapshot }) {
  return (
    <div className="queue-legend" aria-label="Queue status legend">
      {Object.entries(STATUS_LABELS).map(([status, label]) => (
        <span key={status} className="queue-legend__item">
          <span className={`queue-dot queue-dot--${status}`} />
          {label}: {formatNumber(snapshot.statusCounts[status as keyof typeof STATUS_LABELS], 0)}
        </span>
      ))}
    </div>
  );
}

function PipelineQueue({ snapshot }: { snapshot: PipelineWindowSnapshot }) {
  if (snapshot.messages.length === 0) {
    return (
      <div className="queue-empty">
        This pipeline snapshot contains no sampled messages. Use the status counts above for aggregate state.
      </div>
    );
  }

  const messages = [...snapshot.messages].sort((left, right) => left.ordinal - right.ordinal);
  const hiddenCount = Math.max(0, snapshot.currentWindowMessages - messages.length);

  return (
    <>
      <div className="queue-grid" aria-label="Sampled queue messages">
        {messages.map((message) => (
          <span
            key={`${message.ordinal}-${message.rowId ?? message.sessionId ?? 'message'}`}
            className={`queue-cell queue-cell--${message.status}`}
            title={[
              `#${message.ordinal}`,
              STATUS_LABELS[message.status],
              formatDateTime(message.enqueuedTimeUtc),
              message.rowId ? `row ${message.rowId}` : null,
              message.sessionId ? `session ${message.sessionId}` : null,
              message.skipReason ? `skip: ${message.skipReason}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </div>
      <div className="fallback-note">
        Showing {formatNumber(messages.length, 0)} sampled message{messages.length === 1 ? '' : 's'}
        {hiddenCount > 0 ? `; ${formatNumber(hiddenCount, 0)} additional window message(s) are represented only in counts.` : '.'}
      </div>
    </>
  );
}

function AggregateFallback({ snapshot }: { snapshot: PipelineWindowSnapshot }) {
  const bars = [
    { key: 'current', label: 'Window rows', value: snapshot.currentWindowMessages, className: 'aggregate-bar__fill--current' },
    { key: 'done', label: 'Processed', value: snapshot.statusCounts.done, className: 'aggregate-bar__fill--done' },
    { key: 'pending', label: 'Backlog', value: snapshot.backlogMessages, className: 'aggregate-bar__fill--pending' },
    { key: 'blocked', label: 'Blocked', value: snapshot.blockedMessages, className: 'aggregate-bar__fill--blocked' },
    { key: 'skipped', label: 'Unprocessed/Skipped', value: snapshot.statusCounts.skipped, className: 'aggregate-bar__fill--skipped' },
  ];
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <div className="aggregate-fallback" aria-label="Aggregate queue fallback">
      <div className="aggregate-fallback__banner">Aggregate fallback only — old artifacts do not contain per-message samples.</div>
      {bars.map((bar) => (
        <div className="aggregate-bar" key={bar.key}>
          <div className="aggregate-bar__label">{bar.label}</div>
          <div className="aggregate-bar__track">
            <span className={`aggregate-bar__fill ${bar.className}`} style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }} />
          </div>
          <div className="aggregate-bar__value">{formatNumber(bar.value, 0)}</div>
        </div>
      ))}
    </div>
  );
}

function EventMarkers({ snapshot }: { snapshot: PipelineWindowSnapshot }) {
  return (
    <div className="event-markers" aria-label="Pipeline event markers">
      <div className="event-markers__title">Events</div>
      <div className="event-markers__list">
        {snapshot.events.map((event, index) => (
          <span key={`${event.atUtc}-${event.kind}-${index}`} className={`event-marker event-marker--${event.kind}`}>
            <span className="event-marker__kind">{EVENT_LABELS[event.kind]}</span>
            <span>{event.label}</span>
            <span className="event-marker__time">{formatDateTime(event.atUtc)}</span>
            {event.messageCount !== undefined && <span className="event-marker__count">{formatNumber(event.messageCount, 0)} msg</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
