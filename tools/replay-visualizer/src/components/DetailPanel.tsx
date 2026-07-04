import type { ReplayModel, ReplayState } from '../replay/types';

interface Props {
  model: ReplayModel;
  state: ReplayState;
  selectedSeq: number | null;
  selectedOccurrenceId: string | null;
  onClose: () => void;
}

const DISPOSITION_LABEL: Record<string, string> = {
  emitted: 'Emitted (wrote a document)',
  acknowledged: 'Acknowledged (drained, no output)',
  'residual-drain': 'Residual drain (backstop)',
  rehydrated: 'Rehydrated (done before this run)',
  pending: 'Pending',
  skipped: 'Skipped',
  unknown: 'Unknown',
};

export function DetailPanel({ model, state, selectedSeq, selectedOccurrenceId, onClose }: Props): JSX.Element | null {
  if (selectedSeq === null && selectedOccurrenceId === null) {
    return null;
  }

  const msg = selectedSeq !== null ? model.messageBySeq.get(selectedSeq) : undefined;
  const occ = selectedOccurrenceId !== null ? model.occurrences.find((o) => o.id === selectedOccurrenceId) : undefined;

  return (
    <aside className="detail">
      <header className="detail__head">
        <h3>{msg ? `Message #${msg.seq}` : `Occurrence ${occ?.kind}`}</h3>
        <button className="btn btn--ghost" onClick={onClose}>✕</button>
      </header>

      {msg && (
        <div className="detail__body">
          <Row k="label" v={msg.label} />
          <Row k="session" v={msg.sessionId} />
          <Row k="status (now)" v={state.status.get(msg.seq) ?? 'not loaded'} />
          <Row k="disposition" v={DISPOSITION_LABEL[msg.disposition] ?? msg.disposition} />
          {msg.bladeId && <Row k="blade.id" v={msg.bladeId} />}
          {msg.bladeInstanceId && <Row k="blade.instanceId" v={msg.bladeInstanceId} />}
          {msg.timestampUtc && <Row k="timestamp" v={msg.timestampUtc} />}
          <Row k="enqueued" v={msg.enqueuedTimeUtc} />
          <details className="detail__raw">
            <summary>payload</summary>
            <pre>{truncate(JSON.stringify(msg.payload ?? {}, null, 2), 6000)}</pre>
          </details>
        </div>
      )}

      {occ && (
        <div className="detail__body">
          <Row k="kind" v={occ.kind} />
          <Row k="session" v={occ.sessionId} />
          {occ.eventType && <Row k="eventType" v={occ.eventType} />}
          {occ.bladeName && <Row k="blade" v={occ.bladeName} />}
          {occ.dwellMs !== undefined && <Row k="dwellMs" v={`${occ.dwellMs} (${occ.dwellSource ?? '—'})`} />}
          {occ.sealedReason && <Row k="sealedReason" v={occ.sealedReason} />}
          {occ.perf && <Row k="perf" v={JSON.stringify(occ.perf)} />}
          <Row k="sources" v={occ.sources.join(', ')} />
          <details className="detail__raw">
            <summary>document</summary>
            <pre>{truncate(JSON.stringify(occ.document ?? {}, null, 2), 6000)}</pre>
          </details>
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="detail__row">
      <span className="detail__k">{k}</span>
      <span className="detail__v">{v}</span>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more chars)` : s;
}
