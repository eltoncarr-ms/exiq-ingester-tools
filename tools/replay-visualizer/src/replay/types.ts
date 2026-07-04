// The derived, UI-facing replay model and step/state types. This layer is pure (no React) and
// fully deterministic so the reducer can scrub to any step.

export type MessageStatus = 'Pending' | 'Done' | 'Skipped';

export type Disposition =
  | 'emitted'
  | 'acknowledged'
  | 'residual-drain'
  | 'rehydrated'
  | 'pending'
  | 'skipped'
  | 'unknown';

export interface ReplayMessage {
  seq: number;
  sessionId: string;
  label: string;
  loadedStatus: MessageStatus;
  disposition: Disposition;
  bladeId?: string;
  bladeInstanceId?: string;
  timestampUtc?: string;
  enqueuedTimeUtc: string;
  /** The full raw record payload, kept for the on-demand detail panel only. */
  payload?: Record<string, unknown> | null;
  eventType?: string | null;
}

export interface ReplayGroup {
  sessionId: string;
  memberSeqs: number[];
  /** True when this group came from the authoritative 01-session-groups.json artifact. */
  authoritative: boolean;
}

export interface ReplayOccurrence {
  id: string; // stable: `${sessionId}:${index}`
  sessionId: string;
  kind: 'Emit' | 'Acknowledge';
  sources: number[];
  lastActivityUtc: string;
  // Emit-only projected event fields (best-effort, may be absent).
  eventId?: string;
  eventType?: string;
  bladeName?: string;
  dwellMs?: number;
  dwellSource?: string;
  sealedReason?: string | null;
  perf?: Record<string, number> | null;
  document?: Record<string, unknown> | null;
}

export interface CosmosDoc {
  id: string;
  eventType: string;
  bladeName?: string;
  occurrenceId: string;
}

export type StepPhase = 'load' | 'group' | 'compose' | 'flush';

export interface ReplayStep {
  index: number;
  phase: StepPhase;
  /** For load: the message seqs loaded by this (batched) step. */
  seqs?: number[];
  /** For group: the session id. */
  sessionId?: string;
  /** For compose/flush: the occurrence id. */
  occurrenceId?: string;
  /** Flush-only: terminal reconciliation step that applies the authoritative markedDone set. */
  finalizes?: boolean;
  /** Flush-finalize-only: the seqs this step marks Done (a chunk of the markedDone roster). */
  markDoneSeqs?: number[];
  /** Flush-finalize-only: caps the checkpoint frontier for this step, so the sweep animates in
   * chunks instead of jumping to its final value in one move. */
  checkpointTo?: number;
  /** Short, human-readable description of what this step does. */
  description: string;
}

export interface ReplayModel {
  partitionId: string;
  enhanced: boolean;
  startingCheckpoint: number;
  finalCheckpoint: number;
  sequenceRange: { min: number; max: number };
  messages: ReplayMessage[]; // ordered by seq ascending
  messageBySeq: Map<number, ReplayMessage>;
  groups: ReplayGroup[];
  occurrences: ReplayOccurrence[];
  steps: ReplayStep[];
  /** Sequence numbers the flush layer authoritatively marked Done (02-flush.json markedDone). */
  markedDoneSeqs: number[];
  /** Phase boundaries (first step index of each phase) for the timeline ruler. */
  phaseOffsets: Record<StepPhase, { start: number; count: number }>;
  flushSummary: {
    eventsWritten: number;
    eventsFailed: number;
    acknowledged: number;
    messagesMarkedDone: number;
  };
}

/** The full computed visual state at a given step index. */
export interface ReplayState {
  stepIndex: number;
  loadedSeqs: Set<number>;
  status: Map<number, MessageStatus>;
  formedGroups: Set<string>;
  composedOccurrenceIds: Set<string>;
  cosmosDocs: CosmosDoc[];
  /** Acknowledge occurrences whose drain flush has been applied (no Cosmos output, marked done). */
  drainedOccurrenceIds: Set<string>;
  drainedCount: number;
  checkpoint: number;
  highlightSeqs: Set<number>;
  activePhase: StepPhase | 'idle';
  description: string;
}
