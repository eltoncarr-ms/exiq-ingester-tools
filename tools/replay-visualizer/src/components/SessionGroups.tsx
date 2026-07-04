import type { ReplayModel, ReplayState } from '../replay/types';

interface Props {
  model: ReplayModel;
  state: ReplayState;
}

export function SessionGroups({ model, state }: Props): JSX.Element {
  return (
    <section className="lane lane--groups">
      <header className="lane__head">
        <h2>Session Groups</h2>
        <div className="lane__meta">
          <span className="tag tag--muted">
            {state.formedGroups.size}/{model.groups.length}
          </span>
          {model.groups.some((g) => g.authoritative) ? (
            <span className="tag tag--ok">authoritative</span>
          ) : (
            <span className="tag tag--warn">approximate</span>
          )}
        </div>
      </header>
      <div className="groups__list">
        {model.groups.length === 0 && <div className="empty">no session groups</div>}
        {model.groups.map((g) => {
          const formed = state.formedGroups.has(g.sessionId);
          return (
            <div key={g.sessionId} className={`group ${formed ? 'group--formed' : ''}`}>
              <div className="group__id">{g.sessionId.slice(0, 12)}…</div>
              <div className="group__bar">
                <div className="group__fill" style={{ width: formed ? '100%' : '0%' }} />
              </div>
              <div className="group__count">{g.memberSeqs.length} msgs</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
