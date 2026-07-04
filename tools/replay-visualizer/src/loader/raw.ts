// Raw artifact shapes as written by FileDebugDumpWriter. These mirror the JSON on disk exactly.
// `record.eventType` is frequently null; the real action discriminator lives in payload.action /
// payload.actionModifier, and blade correlation lives in the (string) payload.context field.

export type RawMessageStatus = 'Pending' | 'Done' | 'Skipped';

export interface RawRecord {
  sessionId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  partName?: string | null;
  priority?: boolean;
  timestampUtc?: string | null;
  dedupeKey?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface RawMessage {
  partitionId: string;
  sequenceNumber: number;
  status: RawMessageStatus;
  skipReason?: string | null;
  partitionKey?: string | null;
  offset?: string | null;
  enqueuedTimeUtc: string;
  record?: RawRecord | null;
  // Enhanced-only: authoritative per-message disposition from the flush layer (03-final-messages.json).
  disposition?: RawDisposition | null;
  eventId?: string | null;
}

export type RawDisposition =
  | 'emitted'
  | 'acknowledged'
  | 'residual-drain'
  | 'rehydrated'
  | 'pending'
  | 'skipped';

export interface RawOccurrence {
  kind: 'Emit' | 'Acknowledge';
  seal: string;
  lastActivityUtc: string;
  sourceCount: number;
  sources: string[]; // e.g. "1/3332"
  document?: Record<string, unknown> | null;
}

export interface RawComposedFile {
  sessionId: string;
  count: number;
  events: RawOccurrence[];
}

export interface RawMessagesFile {
  count: number;
  messages: RawMessage[];
}

export interface RawFlushSummary {
  eventsWritten: number;
  eventsFailed: number;
  acknowledged: number;
  messagesMarkedDone: number;
  checkpointSequenceNumber: number | null;
  transientFailures?: number;
  dataFailures?: number;
  configurationFailures?: number;
}

export interface RawFlushFile {
  summary: RawFlushSummary;
  markedDone: { count: number; messages: RawMessage[] };
  written: { count: number; events: Array<{ eventType: string; document: Record<string, unknown> }> };
}

// Enhanced-only artifacts (degrade gracefully when absent).
export interface RawRunMeta {
  dumpSchemaVersion?: number;
  partitionId?: string;
  startingCheckpoint?: number | null;
  finalCheckpoint?: number | null;
  checkpointAdvanced?: number | null;
  retentionFloor?: number | null;
  sequenceRange?: { min: number; max: number } | null;
  loadStats?: Record<string, number> | null;
  finalStats?: Record<string, number> | null;
}

export interface RawSessionGroupsFile {
  groups: Array<{ sessionId: string; memberCount: number; memberSequences: number[] }>;
}

export interface RawFinalMessagesFile {
  count: number;
  messages: RawMessage[];
}

/** The full set of parsed artifacts for one run directory. Enhanced fields are optional. */
export interface RawRun {
  partitionId: string;
  messages: RawMessagesFile;
  composed: RawComposedFile[];
  flush: RawFlushFile;
  runMeta?: RawRunMeta;
  sessionGroups?: RawSessionGroupsFile;
  finalMessages?: RawFinalMessagesFile;
  /** True when run-meta.json with a recognized schema version was present. */
  enhanced: boolean;
}
