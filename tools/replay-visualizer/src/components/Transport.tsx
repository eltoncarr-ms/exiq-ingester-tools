import type { ReplayModel, ReplayState } from '../replay/types';

interface TransportProps {
  model: ReplayModel;
  state: ReplayState;
  stepIndex: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSeek: (index: number) => void;
  onReset: () => void;
  onCycleSpeed: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  load: 'Load',
  group: 'Group',
  compose: 'Compose',
  flush: 'Flush',
  idle: 'Idle',
};

export function Transport(props: TransportProps): JSX.Element {
  const { model, state, stepIndex, totalSteps, playing, speed } = props;
  const pct = totalSteps > 1 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className="transport">
      <div className="transport__controls">
        <button className="btn" onClick={props.onReset} title="Reset to start">⏮</button>
        <button className="btn" onClick={props.onStepBack} title="Step back" disabled={stepIndex < 0}>◀</button>
        <button className="btn btn--primary" onClick={props.onTogglePlay} title="Play / Pause">
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          className="btn"
          onClick={props.onStepForward}
          title="Step forward"
          disabled={stepIndex >= totalSteps - 1}
        >
          ▶
        </button>
        <button className="btn btn--ghost btn--speed" onClick={props.onCycleSpeed} title="Playback speed">
          {formatSpeed(speed)}
        </button>
        <span className={`pill pill--${state.activePhase}`}>{PHASE_LABEL[state.activePhase] ?? state.activePhase}</span>
      </div>

      <input
        className="transport__scrub"
        type="range"
        min={-1}
        max={totalSteps - 1}
        value={stepIndex}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="Replay timeline"
      />

      <div className="transport__ruler" aria-hidden>
        {(['load', 'group', 'compose', 'flush'] as const).map((phase) => {
          const seg = model.phaseOffsets[phase];
          const width = totalSteps > 0 ? (seg.count / totalSteps) * 100 : 0;
          return (
            <div
              key={phase}
              className={`transport__seg transport__seg--${phase}`}
              style={{ width: `${width}%` }}
              title={`${PHASE_LABEL[phase]} — ${seg.count} steps`}
            >
              <span>{PHASE_LABEL[phase]}</span>
            </div>
          );
        })}
        <div className="transport__cursor" style={{ left: `${pct}%` }} />
      </div>

      <div className="transport__status">
        <span className="transport__step">
          step {stepIndex + 1} / {totalSteps}
        </span>
        <span className="transport__desc">{state.description}</span>
      </div>
    </div>
  );
}

/** Formats a speed multiplier: fractional speeds as ¼×/½×, integers as ×N. */
function formatSpeed(speed: number): string {
  if (speed === 0.25) return '¼×';
  if (speed === 0.5) return '½×';
  return `×${speed}`;
}