import type { CSSProperties } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeDescriptiveStats,
  type PollCycleAnalysis,
  type PollCycleOutcome,
  type PollDescriptiveStats,
} from '../../poll/derive';
import { formatAxisDateTime, formatDuration, formatNumber, formatRate } from '../../benchmark/format';
import { Panel } from '../Panel';
import {
  DEFAULT_PLAYBACK_FREQUENCY,
  PLAYBACK_FREQUENCIES,
  STAGE_LANES,
  frameIntervalMs,
  nextCycleIndex,
  orderCyclesChronologically,
  replayDurationMs,
  resolveLaneFrames,
  stageDisplayName,
  stageMetricDescription,
  type PlaybackFrequency,
} from './timeline';

interface PollTimelineReplayProps {
  cycles: PollCycleAnalysis[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

/**
 * Custom property carrying the bar transition duration, so width/opacity morphs finish well
 * before the next frame tick lands instead of chasing it — roughly 80% of the selected frame
 * interval, leaving no `x` transition (bars never move) and no fade/remount between frames.
 */
interface FrameTimingStyle extends CSSProperties {
  '--poll-replay-transition-ms'?: string;
}

/** Fraction of the frame interval spent animating a bar's width/opacity to the next cycle's values. */
const TRANSITION_FRACTION_OF_FRAME = 0.8;

const STAGE_COLORS: Record<string, string> = {
  cursorRead: '#38bdf8',
  kusto: '#22c55e',
  map: '#14b8a6',
  seal: '#34d399',
  write: '#f59e0b',
  advance: '#a78bfa',
};

function outcomeTagClass(outcome: PollCycleOutcome): string {
  if (outcome === 'success') return 'tag tag--ok';
  if (outcome === 'failed') return 'tag tag--danger';
  if (outcome === 'skipped') return 'tag tag--warn';
  return 'tag tag--muted';
}

function statsCell(
  stats: PollDescriptiveStats | undefined,
  key: keyof Pick<PollDescriptiveStats, 'avg' | 'min' | 'p50' | 'p95' | 'max'>,
): string {
  return stats ? formatDuration(stats[key]) : '\u2014';
}

function cycleCount(value: number | undefined): string {
  return value === undefined ? '\u2014' : formatNumber(value, 0);
}

function writeStageDescription(cycle: PollCycleAnalysis): string {
  return `${stageMetricDescription('write')} Cosmos counts for this cycle: retries ${cycleCount(cycle.cosmosRetryCount)}; 429s ${cycleCount(cycle.cosmos429Count)}; attempted ${cycleCount(cycle.cosmosWriteAttempted)}; succeeded ${cycleCount(cycle.cosmosWriteSucceeded)}; failed ${cycleCount(cycle.cosmosWriteFailed)}; cancelled ${cycleCount(cycle.cosmosWriteCancelled)}.`;
}

function StageInfo({ label, description }: { label: string; description: string }) {
  const tooltipId = useId();
  return (
    <span className="poll-replay__stage-info">
      <button
        type="button"
        className="gauge-card__info-trigger"
        aria-label={`About ${label}`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span id={tooltipId} className="gauge-card__info-tooltip" role="tooltip">
        {description}
      </span>
    </span>
  );
}

export function PollTimelineReplay({ cycles, selectedRunId, onSelect }: PollTimelineReplayProps) {
  const ordered = useMemo(() => orderCyclesChronologically(cycles), [cycles]);
  const stageStats = useMemo(
    () =>
      STAGE_LANES.map((stage) => ({
        stage,
        stats: computeDescriptiveStats(
          ordered.flatMap((candidate) => {
            const entry = resolveLaneFrames(candidate).find((item) => item.stage === stage);
            return entry?.recorded && !entry.open ? [entry.durMs] : [];
          }),
        ),
      })),
    [ordered],
  );
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frequency, setFrequency] = useState<PlaybackFrequency>(DEFAULT_PLAYBACK_FREQUENCY);
  const lastNotifiedRunIdRef = useRef<string | null>(null);

  const safeIndex = ordered.length === 0 ? 0 : Math.min(Math.max(index, 0), ordered.length - 1);
  const cycle = ordered[safeIndex] ?? null;

  // This is a playlist of complete cycles, not a live playhead: every `frameIntervalMs(frequency)`
  // ticks, jump straight to the next whole cycle, wrapping from the newest cycle back to the
  // oldest so playback loops continuously while `isPlaying` stays true.
  useEffect(() => {
    if (!isPlaying || ordered.length === 0) return undefined;

    const id = window.setInterval(() => {
      setIndex((prev) => nextCycleIndex(prev, ordered.length));
    }, frameIntervalMs(frequency));

    return () => window.clearInterval(id);
  }, [isPlaying, ordered.length, frequency]);

  // Reconciles this frame's cycle with the shared selection. While playing, every frame tick
  // notifies the parent so every other panel tracks the current cycle. While paused, an
  // externally-changed `selectedRunId` (one that didn't originate from our own last notification)
  // takes over the shown index instead — so playback-driven notifications never fight this sync.
  useEffect(() => {
    if (ordered.length === 0) return;

    let targetIndex = safeIndex;
    if (!isPlaying && selectedRunId && selectedRunId !== lastNotifiedRunIdRef.current) {
      const externalIndex = ordered.findIndex((candidate) => candidate.runId === selectedRunId);
      if (externalIndex >= 0) targetIndex = externalIndex;
    }

    if (targetIndex !== index) setIndex(targetIndex);

    const targetCycle = ordered[targetIndex];
    if (targetCycle && lastNotifiedRunIdRef.current !== targetCycle.runId) {
      lastNotifiedRunIdRef.current = targetCycle.runId;
      onSelect(targetCycle.runId);
    }
  }, [ordered, isPlaying, selectedRunId, index, safeIndex, onSelect]);

  if (!cycle) {
    return (
      <Panel title="Poll Stats" description="Select a poll cycle to inspect its stage durations.">
        <div className="chart-empty">No cycles yet</div>
      </Panel>
    );
  }

  const laneFrames = resolveLaneFrames(cycle);
  const cycleDurationMs = Math.max(1, replayDurationMs(cycle));
  const leftFor = (startMs: number) => (Math.min(Math.max(startMs, 0), cycleDurationMs) / cycleDurationMs) * 100;
  const widthFor = (startMs: number, durMs: number): string => {
    if (durMs <= 0) return '3px';
    const availableMs = Math.max(cycleDurationMs - Math.max(startMs, 0), 0);
    return `max(4px, ${(Math.min(durMs, availableMs) / cycleDurationMs) * 100}%)`;
  };

  const transitionMs = frameIntervalMs(frequency) * TRANSITION_FRACTION_OF_FRAME;
  const frameStyle: FrameTimingStyle = { '--poll-replay-transition-ms': `${transitionMs}ms` };

  const handlePlayPause = () => setIsPlaying((prev) => !prev);

  const handleRestart = () => setIndex(0);

  const handleManualSelect = (runId: string) => {
    const targetIndex = ordered.findIndex((candidate) => candidate.runId === runId);
    if (targetIndex < 0) return;
    setIsPlaying(false);
    setIndex(targetIndex);
  };

  const handleScrub = (value: number) => {
    setIsPlaying(false);
    setIndex(Math.min(Math.max(value, 0), ordered.length - 1));
  };

  return (
    <Panel
      title="Poll Stats"
      description="Cycle through every recorded poll cycle, in order, to compare how each stage's duration changes from one cycle to the next — or pick one to inspect directly. Dashed bars are still open (no matching end event yet)."
    >
      <div className="poll-replay__toolbar">
        <label className="poll-replay__selector">
          <span>Poll cycle</span>
          <select value={cycle.runId} onChange={(event) => handleManualSelect(event.target.value)}>
            {[...ordered].reverse().map((candidate) => (
              <option key={candidate.runId} value={candidate.runId}>
                {formatAxisDateTime(candidate.startedAtMs)} · {candidate.runId}
              </option>
            ))}
          </select>
        </label>

        <div className="poll-replay__summary">
          <span className="tag tag--muted">Records · {cycle.records !== null ? formatNumber(cycle.records, 0) : '—'}</span>
          <span className="tag tag--muted">
            Throughput · {cycle.recordsPerSec !== null ? formatRate(cycle.recordsPerSec) : '—'}
          </span>
          <span className="tag tag--muted">Duration · {formatDuration(replayDurationMs(cycle))}</span>
          <span className="tag tag--muted">Retries · {cycleCount(cycle.cosmosRetryCount)}</span>
          <span className="tag tag--muted">429s · {cycleCount(cycle.cosmos429Count)}</span>
          <span className="tag tag--muted">Attempted · {cycleCount(cycle.cosmosWriteAttempted)}</span>
          <span className="tag tag--muted">Succeeded · {cycleCount(cycle.cosmosWriteSucceeded)}</span>
          <span className="tag tag--muted">Failed · {cycleCount(cycle.cosmosWriteFailed)}</span>
          <span className="tag tag--muted">Cancelled · {cycleCount(cycle.cosmosWriteCancelled)}</span>
          <span className={outcomeTagClass(cycle.outcome)} title={cycle.failingStage ?? cycle.error}>
            Outcome · {cycle.outcome}
          </span>
        </div>
      </div>

      <div className="poll-replay__controls">
        <div className="poll-replay__transport" role="group" aria-label="Replay transport">
          <button type="button" className="btn btn--ghost btn--sm" aria-pressed={isPlaying} onClick={handlePlayPause}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" aria-label="Restart replay" onClick={handleRestart}>
            Restart
          </button>
        </div>

        <div className="poll-replay__frequencies" role="group" aria-label="Playback frequency">
          {PLAYBACK_FREQUENCIES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="btn btn--ghost btn--sm"
              aria-pressed={frequency === candidate}
              aria-label={`Playback frequency ${candidate}/sec`}
              onClick={() => setFrequency(candidate)}
            >
              {candidate}/sec
            </button>
          ))}
        </div>

        <label className="poll-replay__scrubber">
          <span>All cycles</span>
          <input
            type="range"
            min={0}
            max={Math.max(ordered.length - 1, 0)}
            step={1}
            value={safeIndex}
            aria-label="Replay position across all cycles"
            onChange={(event) => handleScrub(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="poll-replay__cycle-frame">
        <div
          className="poll-replay__lanes"
          role="group"
          aria-label="Stage sequence and duration bars for the current poll cycle"
          style={frameStyle}
        >
          {laneFrames.map((laneFrame) => {
            const color = STAGE_COLORS[laneFrame.stage] ?? '#38bdf8';
            const displayName = stageDisplayName(laneFrame.stage);
            const description = laneFrame.stage === 'write' ? writeStageDescription(cycle) : stageMetricDescription(laneFrame.stage);
            const barLeft = leftFor(laneFrame.startMs);
            const barWidth = widthFor(laneFrame.startMs, laneFrame.durMs);
            const barClass = ['poll-replay__bar', laneFrame.open ? 'poll-replay__bar--open' : '', !laneFrame.recorded ? 'poll-replay__bar--empty' : '']
              .filter(Boolean)
              .join(' ');

            const titleText = !laneFrame.recorded
              ? `${displayName}: not recorded for this cycle`
              : laneFrame.open
                ? `${displayName}: still open, duration not yet available`
                : `${displayName}: ${formatDuration(laneFrame.durMs)}`;

            return (
              <div className="poll-replay__lane" key={laneFrame.stage}>
                <div className="poll-replay__stage-label">
                  <span>{displayName}</span>
                  <StageInfo label={displayName} description={description} />
                </div>
                <div className="poll-replay__track">
                  <div
                    className={barClass}
                    style={{ background: color, left: `${barLeft}%`, width: barWidth }}
                    title={`${titleText}\n${description}`}
                    aria-hidden="true"
                  />
                </div>
                <div className="poll-replay__value">
                  {formatDuration(laneFrame.durMs)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="comparison poll-replay__stats">
        <table aria-label="Playback stage duration statistics">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Avg</th>
              <th>Min</th>
              <th>P50</th>
              <th>P95</th>
              <th>Max</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {stageStats.map(({ stage, stats }) => (
              <tr key={stage}>
                <th scope="row">{stageDisplayName(stage)}</th>
                <td>{statsCell(stats, 'avg')}</td>
                <td>{statsCell(stats, 'min')}</td>
                <td>{statsCell(stats, 'p50')}</td>
                <td>{statsCell(stats, 'p95')}</td>
                <td>{statsCell(stats, 'max')}</td>
                <td>{stats ? formatNumber(stats.count, 0) : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
