import type { ReplayModel, ReplayState } from '../replay/types';

interface Props {
  model: ReplayModel;
  state: ReplayState;
  onSelectOccurrence: (id: string) => void;
  selectedOccurrenceId: string | null;
}

export function Composition({ model, state, onSelectOccurrence, selectedOccurrenceId }: Props): JSX.Element {
  return (
    <section className="lane lane--compose">
      <header className="lane__head">
        <h2>Composition</h2>
        <div className="lane__meta">
          <span className="tag tag--muted">
            {state.composedOccurrenceIds.size}/{model.occurrences.length}
          </span>
        </div>
      </header>
      <div className="compose__list">
        {model.occurrences.map((occ) => {
          const composed = state.composedOccurrenceIds.has(occ.id);
          const flushed = state.cosmosDocs.some((d) => d.occurrenceId === occ.id);
          const drained = state.drainedOccurrenceIds.has(occ.id);
          if (!composed) {
            return (
              <div key={occ.id} className="occ occ--pending">
                <span className="occ__dot" /> waiting…
              </div>
            );
          }
          return (
            <button
              key={occ.id}
              className={`occ occ--${occ.kind.toLowerCase()} ${flushed ? 'occ--flushed' : ''} ${
                drained ? 'occ--drained' : ''
              } ${selectedOccurrenceId === occ.id ? 'occ--selected' : ''}`}
              onClick={() => onSelectOccurrence(occ.id)}
            >
              <div className="occ__head">
                <span className={`badge badge--${occ.kind.toLowerCase()}`}>{occ.kind}</span>
                <span className="occ__title">
                  {occ.kind === 'Emit'
                    ? shortBlade(occ.bladeName) ?? occ.eventType ?? 'event'
                    : `drain ${occ.sources.length} msgs`}
                </span>
              </div>
              <div className="occ__meta">
                <span>{occ.sources.length} src</span>
                {occ.dwellMs !== undefined && <span>dwell {occ.dwellMs}ms</span>}
                {occ.perf && Object.keys(occ.perf).length > 0 && <span className="occ__perf">perf</span>}
                {occ.sealedReason && <span>seal {occ.sealedReason}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function shortBlade(bladeName: string | undefined): string | undefined {
  if (!bladeName) return undefined;
  const parts = bladeName.split('/');
  return parts[parts.length - 1];
}
