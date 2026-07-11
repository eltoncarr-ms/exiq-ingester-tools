import { useEffect, useMemo, useRef, useState } from 'react';
import type { PollCycleAnalysis } from '../../poll/derive';
import { formatDuration } from '../../benchmark/format';
import { Panel } from '../Panel';
import {
  activeStageAt,
  advanceElapsedMs,
  clampElapsedMs,
  orderedStageNames,
  POLL_PLAYBACK_SPEEDS,
  replayDurationMs,
  stageEndMs,
  type PollPlaybackSpeed,
} from './playback';

interface PollTimelineReplayProps {
  cycle: PollCycleAnalysis | null;
}

const STAGE_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#f472b6', '#2dd4bf', '#fb7185'];

function colorForStage(stageName: string, orderedNames: string[]): string {
  const index = orderedNames.indexOf(stageName);
  return STAGE_COLORS[index % STAGE_COLORS.length] ?? STAGE_COLORS[0];
}

export function PollTimelineReplay({ cycle }: PollTimelineReplayProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PollPlaybackSpeed>(1);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const runId = cycle?.runId ?? null;
  const durationMs = cycle ? replayDurationMs(cycle) : 0;
  const orderedNames = useMemo(() => (cycle ? orderedStageNames(cycle.stages) : []), [cycle]);

  // Reset playback whenever the selected cycle changes (including to/from none).
  useEffect(() => {
    setElapsedMs(0);
    setPlaying(false);
    setSpeed(1);
  }, [runId]);

  useEffect(() => {
    if (!playing || durationMs <= 0) return undefined;

    lastTickRef.current = null;
    const tick = (timestamp: number) => {
      const last = lastTickRef.current ?? timestamp;
      const deltaMs = timestamp - last;
      lastTickRef.current = timestamp;

      setElapsedMs((current) => {
        const next = advanceElapsedMs(current, deltaMs, speed, durationMs);
        if (next.finished) setPlaying(false);
        return next.elapsedMs;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, speed, durationMs]);

  if (!cycle) {
    return (
      <Panel title="Cycle replay" description="Select a cycle above to replay its stage timeline.">
        <div className="chart-empty">No cycle selected</div>
      </Panel>
    );
  }

  if (cycle.stages.length === 0) {
    return (
      <Panel title="Cycle replay" eyebrow={cycle.runId} description="This cycle has no recorded stage spans yet.">
        <div className="chart-empty">No stage data</div>
      </Panel>
    );
  }

  const activeStage = activeStageAt(cycle.stages, elapsedMs);
  const canPlay = durationMs > 0;

  const width = 900;
  const rowHeight = 40;
  const padLeft = 130;
  const padRight = 16;
  const padTop = 12;
  const height = padTop + orderedNames.length * rowHeight + 16;
  const innerWidth = width - padLeft - padRight;
  const xFor = (ms: number) => padLeft + (clampElapsedMs(ms, durationMs) / Math.max(durationMs, 1)) * innerWidth;

  return (
    <Panel
      title="Cycle replay"
      eyebrow={cycle.runId}
      description="Scrub, play, or step through the selected cycle's recorded stage spans. Dashed bars are still open (no matching end event yet)."
      actions={
        <div className="poll-replay__status" aria-live="polite">
          <span className="poll-replay__stage">{activeStage ? activeStage.stage : '—'}</span>
          <span className="poll-replay__elapsed">
            {formatDuration(elapsedMs)} / {formatDuration(durationMs)}
          </span>
        </div>
      }
    >
      <div className="poll-replay__controls">
        <button
          className="btn btn--sm"
          type="button"
          disabled={!canPlay}
          aria-pressed={playing}
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={() => {
            setElapsedMs(0);
            setPlaying(false);
          }}
        >
          Restart
        </button>
        <div className="poll-replay__speeds" role="group" aria-label="Playback speed">
          {POLL_PLAYBACK_SPEEDS.map((candidate) => (
            <button
              key={candidate}
              className={`btn btn--ghost btn--sm ${speed === candidate ? 'is-active' : ''}`}
              type="button"
              onClick={() => setSpeed(candidate)}
            >
              {candidate}x
            </button>
          ))}
        </div>
        <input
          className="poll-replay__scrubber"
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={1}
          value={elapsedMs}
          disabled={!canPlay}
          aria-label="Playback position"
          onChange={(event) => {
            setPlaying(false);
            setElapsedMs(clampElapsedMs(Number(event.target.value), durationMs));
          }}
        />
      </div>

      <svg className="timeline poll-replay__timeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Stage timeline replay">
        {orderedNames.map((name, row) => {
          const y = padTop + row * rowHeight;
          const spans = cycle.stages.filter((candidate) => candidate.stage === name);
          const color = colorForStage(name, orderedNames);

          return (
            <g key={name}>
              <text className="timeline__label" x={4} y={y + 20}>
                {name}
              </text>
              <line className="timeline__lane" x1={padLeft} x2={width - padRight} y1={y + 14} y2={y + 14} />
              {spans.map((stageSpan, index) => {
                const end = stageEndMs(stageSpan);
                const barEndMs = end ?? Math.max(elapsedMs, stageSpan.startMs);
                const x = xFor(stageSpan.startMs);
                const barWidth = Math.max(2, xFor(barEndMs) - x);
                const isOpen = end === null;
                const isActive = activeStage === stageSpan;

                return (
                  <rect
                    key={`${name}-${index}`}
                    className={`poll-replay__bar${isOpen ? ' poll-replay__bar--open' : ''}${isActive ? ' poll-replay__bar--active' : ''}`}
                    x={x}
                    y={y + 6}
                    width={barWidth}
                    height={16}
                    rx={5}
                    fill={color}
                  >
                    <title>
                      {name}: {stageSpan.durMs !== null ? formatDuration(stageSpan.durMs) : 'still open'} starting at{' '}
                      {formatDuration(stageSpan.startMs)}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        <line className="poll-replay__playhead" x1={xFor(elapsedMs)} x2={xFor(elapsedMs)} y1={padTop - 6} y2={height - 6} />
      </svg>
    </Panel>
  );
}
