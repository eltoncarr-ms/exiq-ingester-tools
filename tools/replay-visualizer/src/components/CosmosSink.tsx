import type { ReplayModel, ReplayState } from '../replay/types';

interface Props {
  model: ReplayModel;
  state: ReplayState;
}

export function CosmosSink({ model, state }: Props): JSX.Element {
  return (
    <section className="lane lane--sink">
      <header className="lane__head">
        <h2>Cosmos Sink</h2>
        <div className="lane__meta">
          <span className="tag tag--done">{state.cosmosDocs.length} written</span>
          {state.drainedCount > 0 && <span className="tag tag--muted">{state.drainedCount} drained</span>}
        </div>
      </header>
      <div className="sink__list">
        {state.cosmosDocs.length === 0 && <div className="empty">no documents flushed yet</div>}
        {state.cosmosDocs.map((doc) => (
          <div key={doc.id} className="doc doc--new">
            <span className="doc__type">{doc.eventType}</span>
            <span className="doc__blade">{shortBlade(doc.bladeName)}</span>
            <span className="doc__id">{doc.id.slice(0, 26)}…</span>
          </div>
        ))}
      </div>
      <footer className="sink__foot">
        <span>
          flush expects {model.flushSummary.eventsWritten} written · {model.flushSummary.acknowledged} acknowledged
        </span>
      </footer>
    </section>
  );
}

function shortBlade(bladeName: string | undefined): string {
  if (!bladeName) return '';
  const parts = bladeName.split('/');
  return parts[parts.length - 1] ?? '';
}
