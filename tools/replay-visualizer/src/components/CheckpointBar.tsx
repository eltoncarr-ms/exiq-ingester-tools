import type { ReplayModel, ReplayState } from '../replay/types';

interface Props {
  model: ReplayModel;
  state: ReplayState;
}

export function CheckpointBar({ model, state }: Props): JSX.Element {
  const { min, max } = model.sequenceRange;
  const span = Math.max(1, max - min);
  const startPct = ((model.startingCheckpoint - min) / span) * 100;
  const nowPct = ((state.checkpoint - min) / span) * 100;
  const finalPct = ((model.finalCheckpoint - min) / span) * 100;
  const atFinal = state.checkpoint >= model.finalCheckpoint;

  return (
    <section className="checkpoint">
      <header className="checkpoint__head">
        <h2>Checkpoint</h2>
        <div className="checkpoint__meta">
          <span className="tag tag--muted">start {model.startingCheckpoint}</span>
          <span className={`tag ${atFinal ? 'tag--ok' : 'tag--warn'}`}>now {state.checkpoint}</span>
          <span className="tag tag--muted">final {model.finalCheckpoint}</span>
          {!model.enhanced && <span className="tag tag--warn" title="No run-meta.json; checkpoint progression is derived">derived</span>}
        </div>
      </header>
      <div className="checkpoint__track">
        <div className="checkpoint__range" style={{ left: `${clamp(startPct)}%`, width: `${clamp(finalPct - startPct)}%` }} />
        <div className="checkpoint__fill" style={{ left: `${clamp(startPct)}%`, width: `${clamp(nowPct - startPct)}%` }} />
        <div className="checkpoint__marker checkpoint__marker--start" style={{ left: `${clamp(startPct)}%` }} title={`start ${model.startingCheckpoint}`} />
        <div className="checkpoint__marker checkpoint__marker--now" style={{ left: `${clamp(nowPct)}%` }} title={`now ${state.checkpoint}`} />
        <div className="checkpoint__marker checkpoint__marker--final" style={{ left: `${clamp(finalPct)}%` }} title={`final ${model.finalCheckpoint}`} />
      </div>
      <div className="checkpoint__axis">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </section>
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
