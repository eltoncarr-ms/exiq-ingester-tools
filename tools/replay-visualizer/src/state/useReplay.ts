import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildReplay } from '../replay/buildReplay';
import { reduceToStep } from '../replay/reducer';
import type { ReplayModel, ReplayState } from '../replay/types';
import type { RawRun } from '../loader/raw';

const SPEED_PRESETS = [0.25, 0.5, 1, 4, 16, 64] as const;
const TICK_MS = 90;

export interface UseReplay {
  model: ReplayModel | null;
  state: ReplayState;
  stepIndex: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  setRun: (run: RawRun) => void;
  reset: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stepForward: () => void;
  stepBack: () => void;
  seek: (index: number) => void;
  cycleSpeed: () => void;
}

const EMPTY_STATE: ReplayState = {
  stepIndex: -1,
  loadedSeqs: new Set(),
  status: new Map(),
  formedGroups: new Set(),
  composedOccurrenceIds: new Set(),
  cosmosDocs: [],
  drainedOccurrenceIds: new Set(),
  drainedCount: 0,
  checkpoint: 0,
  highlightSeqs: new Set(),
  activePhase: 'idle',
  description: 'Ready — drop a run folder or load the bundled sample.',
};

export function useReplay(): UseReplay {
  const [model, setModel] = useState<ReplayModel | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const timer = useRef<number | null>(null);

  const totalSteps = model?.steps.length ?? 0;

  const setRun = useCallback((run: RawRun) => {
    const built = buildReplay(run);
    setModel(built);
    setStepIndex(-1);
    setPlaying(false);
  }, []);

  const reset = useCallback(() => {
    setStepIndex(-1);
    setPlaying(false);
  }, []);

  const seek = useCallback(
    (index: number) => {
      if (!model) return;
      const clamped = Math.max(-1, Math.min(index, model.steps.length - 1));
      setStepIndex(clamped);
    },
    [model],
  );

  const stepForward = useCallback(() => seek(stepIndex + 1), [seek, stepIndex]);
  const stepBack = useCallback(() => seek(stepIndex - 1), [seek, stepIndex]);
  const play = useCallback(() => {
    if (!model) return;
    if (stepIndex >= model.steps.length - 1) setStepIndex(-1);
    setPlaying(true);
  }, [model, stepIndex]);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
  const cycleSpeed = useCallback(() => {
    setSpeed((s) => {
      const idx = SPEED_PRESETS.indexOf(s as (typeof SPEED_PRESETS)[number]);
      return SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
    });
  }, []);

  // Playback loop: speeds ≥1 advance several steps per fixed tick; speeds <1 advance one step but
  // stretch the tick interval so the replay runs at half/quarter pace. Auto-pause at the end.
  useEffect(() => {
    if (!playing || !model) return;
    const stepsPerTick = speed >= 1 ? speed : 1;
    const tickMs = speed >= 1 ? TICK_MS : TICK_MS / speed;
    timer.current = window.setInterval(() => {
      setStepIndex((prev) => {
        const next = prev + stepsPerTick;
        if (next >= model.steps.length - 1) {
          setPlaying(false);
          return model.steps.length - 1;
        }
        return next;
      });
    }, tickMs);
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [playing, model, speed]);

  const state = useMemo<ReplayState>(() => {
    if (!model) return EMPTY_STATE;
    if (stepIndex < 0) {
      return { ...EMPTY_STATE, checkpoint: model.startingCheckpoint };
    }
    return reduceToStep(model, stepIndex);
  }, [model, stepIndex]);

  return {
    model,
    state,
    stepIndex,
    totalSteps,
    playing,
    speed,
    setRun,
    reset,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBack,
    seek,
    cycleSpeed,
  };
}
