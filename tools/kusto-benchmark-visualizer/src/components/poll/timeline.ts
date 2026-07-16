import type { PollCycleAnalysis, PollStageTimelineEntry } from '../../poll/derive';

export function stageEndMs(stage: PollStageTimelineEntry): number | null {
  return stage.durMs === null ? null : stage.startMs + stage.durMs;
}

export function replayDurationMs(cycle: PollCycleAnalysis): number {
  if (cycle.totalMs !== null && Number.isFinite(cycle.totalMs) && cycle.totalMs > 0) return cycle.totalMs;

  return cycle.stages.reduce((max, stage) => Math.max(max, stageEndMs(stage) ?? stage.startMs), 0);
}

export function stageMetricDescription(stageName: string): string {
  switch (stageName) {
    case 'cursorRead':
      return 'Reads the cached watermark from the active blob cursor session. The blob was loaded before the poll cycle, so this stage is normally sub-millisecond.';
    case 'kusto':
      return 'Executes the Kusto query and opens the result reader for the source-message window.';
    case 'map':
      return 'Reads the Kusto result rows and maps them into message batches for sealing.';
    case 'seal':
      return 'Completes the remaining seal work after Kusto retrieval and mapping, including statistics, input-row counting, and related overhead.';
    case 'write':
      return 'Flushes finalized interactions to Cosmos DB. Optional snapshot processing reads existing Cosmos snapshots, merges them, and upserts the result; timing includes SDK retries and throttling waits.';
    case 'advance':
      return 'Persists the new source cursor/watermark to blob storage after all Cosmos writes complete.';
    default:
      return `Measures all work recorded inside the ${stageName} stage.`;
  }
}

export function stageDisplayName(stageName: string): string {
  switch (stageName) {
    case 'cursorRead':
      return 'Blob Read Watermark';
    case 'kusto':
      return 'Get Kusto Messages';
    case 'map':
      return 'Map Messages';
    case 'seal':
      return 'Seal Messages';
    case 'write':
      return 'Flush to Cosmos';
    case 'advance':
      return 'Advance Cursor';
    default:
      return stageName;
  }
}

/**
 * The replay is a "video" of complete cycles, not a live-progress playhead: every frame always
 * shows exactly these four stage lanes, in this fixed order, regardless of which stages a given
 * cycle actually recorded.
 */
export const STAGE_LANES = ['cursorRead', 'kusto', 'map', 'seal', 'write', 'advance'] as const;
export type StageLane = (typeof STAGE_LANES)[number];

/** One stable lane's resolved bar for a single cycle frame. */
export interface LaneFrame {
  stage: StageLane;
  /** `false` when the cycle has no recorded entry for this stage — the lane still renders, empty. */
  recorded: boolean;
  /** `true` when the recorded stage has no matching `end` event yet (still open). */
  open: boolean;
  startMs: number;
  /** Actual recorded duration; `0` when unrecorded or still open (zero-duration marker). */
  durMs: number;
}

/** Resolves a cycle into exactly four lane frames, one per `STAGE_LANES`, with a zero fallback for any stage the cycle never recorded. */
export function resolveLaneFrames(cycle: PollCycleAnalysis): LaneFrame[] {
  const stageFrame = (stage: 'cursorRead' | 'write' | 'advance'): LaneFrame => {
    const entry = cycle.stages.find((candidate) => candidate.stage === stage);
    return entry
      ? { stage, recorded: true, open: entry.durMs === null, startMs: entry.startMs, durMs: entry.durMs ?? 0 }
      : { stage, recorded: false, open: false, startMs: 0, durMs: 0 };
  };

  const seal = cycle.stages.find((candidate) => candidate.stage === 'seal');
  const sealStartMs = seal?.startMs ?? 0;
  const kustoMs = Number.isFinite(cycle.kustoMs) ? Math.max(cycle.kustoMs ?? 0, 0) : 0;
  const mapMs = Number.isFinite(cycle.mapMs) ? Math.max(cycle.mapMs ?? 0, 0) : 0;
  const sealDurationMs = seal?.durMs ?? 0;
  const sealRemainderMs = Math.max(sealDurationMs - kustoMs - mapMs, 0);

  return [
    stageFrame('cursorRead'),
    { stage: 'kusto', recorded: cycle.kustoMs !== undefined, open: false, startMs: sealStartMs, durMs: kustoMs },
    { stage: 'map', recorded: cycle.mapMs !== undefined, open: false, startMs: sealStartMs + kustoMs, durMs: mapMs },
    {
      stage: 'seal',
      recorded: seal !== undefined,
      open: seal?.durMs === null,
      startMs: sealStartMs + kustoMs + mapMs,
      durMs: sealRemainderMs,
    },
    stageFrame('write'),
    stageFrame('advance'),
  ];
}

/** Sorts cycles chronologically, oldest first. */
export function orderCyclesChronologically(cycles: PollCycleAnalysis[]): PollCycleAnalysis[] {
  return [...cycles].sort((a, b) => a.startedAtMs - b.startedAtMs);
}

/** Selectable playback frequencies: cycles/frames shown per second (not a speed multiplier). */
export const PLAYBACK_FREQUENCIES = [10, 20] as const;
export type PlaybackFrequency = (typeof PLAYBACK_FREQUENCIES)[number];
export const DEFAULT_PLAYBACK_FREQUENCY: PlaybackFrequency = 10;

/** Milliseconds between frames for a given playback frequency (cycles/frames per second). */
export function frameIntervalMs(framesPerSec: number): number {
  return 1000 / framesPerSec;
}

/**
 * Advances a cycle index by `framesElapsed` frames (default one), wrapping around the list so
 * playback loops continuously from the newest cycle back to the oldest. Returns `0` for an empty
 * list and always `0` for a single-cycle list.
 */
export function nextCycleIndex(currentIndex: number, cycleCount: number, framesElapsed = 1): number {
  if (cycleCount <= 0) return 0;

  return (((currentIndex + framesElapsed) % cycleCount) + cycleCount) % cycleCount;
}
