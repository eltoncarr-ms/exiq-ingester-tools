import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { formatNumber } from './benchmark/format';
import type { BenchmarkFileHandle } from './components/DropZone';
import { Panel } from './components/Panel';
import { PollCycleList } from './components/poll/PollCycleList';
import { PollMetricDashboard } from './components/poll/PollMetricDashboard';
import { PollThroughputTrends } from './components/poll/PollThroughputTrends';
import { PollTimelineReplay } from './components/poll/PollTimelineReplay';
import { buildPollAnalysis, type PollCycleAnalysis } from './poll/derive';
import { decideLiveReadStep, EMPTY_LIVE_ANCHOR, LIVE_ANCHOR_BYTES, liveAnchorRange, nextAnchor } from './poll/live';
import { parsePollJsonlText } from './poll/parse';
import { flushPollTail, INITIAL_POLL_TAIL_STATE, pushPollTailChunk, type PollTailState } from './poll/tail';
import type { PollEvent, PollParseWarning } from './poll/types';

const LIVE_POLL_INTERVAL_MS = 1000;

// Internal sentinel selector key for "unresolved cycles" (stage activity with
// no `cycle` rollup yet, so no source assigned). Prefixed with a NUL byte so
// it can never collide with a real producer-emitted `source` string, which
// none of the poll cycle producers ever include. Never rendered directly —
// `PENDING_SOURCE_LABEL` is the user-facing text.
const PENDING_SOURCE_KEY = '\u0000pending';
const PENDING_SOURCE_LABEL = 'Source pending';

type PollSourceMode = 'idle' | 'static' | 'live';

/**
 * Dedicated Poll Telemetry page: loads a static `PollTelemetry__Sink=jsonl`
 * file, or tails one file live via the File System Access API, deriving the
 * same source-grouped analysis either way. Kept isolated from the benchmark
 * page's App/DropZone — the poll JSONL contract does not share a parser or
 * data model with the benchmark artifacts (see
 * docs/plans/poll-telemetry-visualizer.md).
 */
export function PollTelemetryPage() {
  const [events, setEvents] = useState<PollEvent[]>([]);
  const [warnings, setWarnings] = useState<PollParseWarning[]>([]);
  const [mode, setMode] = useState<PollSourceMode>('idle');
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [livePolling, setLivePolling] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const liveHandleRef = useRef<BenchmarkFileHandle | null>(null);
  // Bytes already consumed from the live file; only bytes beyond this offset
  // are ever read, so a chunk already parsed is never re-parsed.
  const readOffsetRef = useRef(0);
  // The small byte range immediately before `readOffsetRef.current` as of
  // the last successfully committed read, retained so a subsequent File
  // snapshot can be verified to still hold those exact bytes before its
  // appended bytes are trusted — see src/poll/live.ts.
  const anchorRef = useRef<Uint8Array>(EMPTY_LIVE_ANCHOR);
  const tailStateRef = useRef<PollTailState>(INITIAL_POLL_TAIL_STATE);
  const decoderRef = useRef<TextDecoder | null>(null);
  // Bumped every time the live session is invalidated/replaced (stop, reset,
  // static load, or a new live file selection). An in-flight tick captures
  // this value at its start and refuses to commit once it no longer matches,
  // so a stale continuation (e.g. resumed after a StrictMode remount or a
  // session swap mid-await) can never write over a newer session's state.
  const sessionRef = useRef(0);

  const supportsLiveFile = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
  const analysis = useMemo(() => buildPollAnalysis(events), [events]);
  const loaded = mode !== 'idle';

  const resetAll = useCallback(() => {
    // Invalidate before touching any state/refs so an in-flight live tick
    // (captured generation from before this reset) can never commit.
    sessionRef.current += 1;
    setEvents([]);
    setWarnings([]);
    setMode('idle');
    setSourceLabel(null);
    setLoadError(null);
    setLivePolling(false);
    setSelectedSource(null);
    setSelectedRunId(null);
    liveHandleRef.current = null;
    readOffsetRef.current = 0;
    anchorRef.current = EMPTY_LIVE_ANCHOR;
    tailStateRef.current = INITIAL_POLL_TAIL_STATE;
    decoderRef.current = null;
  }, []);

  const loadStaticFile = useCallback(async (file: File) => {
    // Invalidate before the async read so an in-flight live tick cannot
    // commit once this static load has taken over the session.
    sessionRef.current += 1;
    const generation = sessionRef.current;
    setLivePolling(false);
    liveHandleRef.current = null;
    readOffsetRef.current = 0;
    anchorRef.current = EMPTY_LIVE_ANCHOR;
    tailStateRef.current = INITIAL_POLL_TAIL_STATE;
    decoderRef.current = null;
    setSelectedSource(null);
    setSelectedRunId(null);

    try {
      const text = await file.text();
      if (sessionRef.current !== generation) return;
      const parsed = parsePollJsonlText(text);
      if (sessionRef.current !== generation) return;
      setEvents(parsed.events);
      setWarnings(parsed.warnings);
      setMode('static');
      setSourceLabel(file.name);
      setLoadError(null);
    } catch (caught) {
      if (sessionRef.current !== generation) return;
      setMode('static');
      setSourceLabel(file.name);
      setEvents([]);
      setWarnings([]);
      setLoadError(caught instanceof Error ? caught.message : `${file.name}: failed to read file.`);
    }
  }, []);

  const onPickStaticFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      await loadStaticFile(file);
    },
    [loadStaticFile],
  );

  const onDropStaticFile = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      const file = event.dataTransfer.files[0];
      if (!file) return;
      await loadStaticFile(file);
    },
    [loadStaticFile],
  );

  const startLivePoll = useCallback(async () => {
    if (!window.showOpenFilePicker) return;

    setLiveBusy(true);
    setLoadError(null);
    // Invalidate before the file picker's async work so any in-flight tick
    // from a prior session cannot commit once this new selection starts.
    sessionRef.current += 1;
    const generation = sessionRef.current;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Poll telemetry JSONL',
            accept: { 'application/x-ndjson': ['.jsonl'], 'text/plain': ['.jsonl'] },
          },
        ],
      });
      if (!handle) return;
      if (sessionRef.current !== generation) return;

      setEvents([]);
      setWarnings([]);
      setSelectedSource(null);
      setSelectedRunId(null);
      liveHandleRef.current = handle;
      readOffsetRef.current = 0;
      anchorRef.current = EMPTY_LIVE_ANCHOR;
      tailStateRef.current = INITIAL_POLL_TAIL_STATE;
      decoderRef.current = new TextDecoder();
      setSourceLabel(handle.name);
      setMode('live');
      setLivePolling(true);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (sessionRef.current !== generation) return;
      setLoadError(caught instanceof Error ? caught.message : 'Failed to open a file for live polling.');
    } finally {
      setLiveBusy(false);
    }
  }, []);

  const stopLivePoll = useCallback(() => {
    const decoder = decoderRef.current;
    let state = tailStateRef.current;

    // Flush the decoder's own pending byte buffer (an incomplete multi-byte
    // UTF-8 sequence held back by the last `stream: true` decode) into the
    // tail state before flushing the tail's retained partial trailing line,
    // since no further bytes will arrive to complete either.
    if (decoder) {
      const finalText = decoder.decode();
      if (finalText.length > 0) {
        const step = pushPollTailChunk(state, finalText);
        state = step.state;
        if (step.events.length > 0) setEvents((current) => [...current, ...step.events]);
        if (step.warnings.length > 0) setWarnings((current) => [...current, ...step.warnings]);
      }
    }

    if (state.carry.trim().length > 0) {
      const flushed = flushPollTail(state);
      state = flushed.state;
      if (flushed.events.length > 0) setEvents((current) => [...current, ...flushed.events]);
      if (flushed.warnings.length > 0) setWarnings((current) => [...current, ...flushed.warnings]);
    }

    tailStateRef.current = state;
    // The session is over — the anchor is only meaningful to a tick that
    // will read this same handle again, and a stopped session never resumes
    // without going through `startLivePoll`'s own full reset.
    anchorRef.current = EMPTY_LIVE_ANCHOR;
    setLivePolling(false);
    // Invalidate last so the flush above always lands before an in-flight
    // tick's generation check can observe the new session.
    sessionRef.current += 1;
  }, []);

  useEffect(() => {
    if (!livePolling) return undefined;

    let disposed = false;
    let timer: number | undefined;

    const scheduleNext = () => {
      if (!disposed) timer = window.setTimeout(tick, LIVE_POLL_INTERVAL_MS);
    };

    const tick = async () => {
      // Capture the handle and session generation this tick is acting on
      // up front, then recheck both (plus `disposed`) immediately after
      // every await and before any ref/state mutation. This guards against
      // a stale continuation — from a StrictMode remount, a stop/reset, a
      // live-to-static switch, or a new live file selection — committing
      // over a newer session's state.
      const generation = sessionRef.current;
      const handle = liveHandleRef.current;
      if (!handle || disposed) return;

      const isCurrent = () => !disposed && sessionRef.current === generation && liveHandleRef.current === handle;

      try {
        const file = await handle.getFile();
        if (!isCurrent()) return;

        const priorOffset = readOffsetRef.current;
        const priorAnchor = anchorRef.current;
        const anchorRange = liveAnchorRange(priorOffset);

        // One read covers both the anchor-verification bytes and any bytes
        // appended since `priorOffset`, avoiding a second round trip through
        // the File System Access API on the common (no-rewrite) path. A
        // genuine read failure (permission revoked, handle gone, etc.) is
        // left to throw into the outer catch below, same as before this
        // change — it surfaces as a load error and retries next tick without
        // touching any committed state. Only a slice shorter than the
        // requested range (the file was mutated out from under this read,
        // between the size check above and this call) counts as "could not
        // be read consistently" for decideLiveReadStep.
        let currentAnchorBytes: Uint8Array | null = null;
        let tailBytes: Uint8Array | null = null;
        if (file.size >= priorOffset) {
          const combined = await file.slice(anchorRange.start, file.size).arrayBuffer();
          if (!isCurrent()) return;
          const combinedBytes = new Uint8Array(combined);
          if (combinedBytes.length >= anchorRange.length) {
            currentAnchorBytes = combinedBytes.slice(0, anchorRange.length);
            tailBytes = combinedBytes.slice(anchorRange.length);
          }
        }

        const decision = decideLiveReadStep({ priorOffset, priorAnchor, fileSize: file.size, currentAnchorBytes });

        if (decision.kind === 'reset') {
          // The bytes before the previously committed offset no longer match
          // (a truncate+rewrite, possibly one that regrew past the old
          // offset before this tick observed it) or could not be re-verified
          // — restart cleanly so stale carry/decoder/anchor state from the
          // previous file identity never resurfaces and no new-file bytes
          // are silently skipped.
          //
          // Read the full file into a local buffer and reconfirm `isCurrent`
          // before touching any ref or state: nothing here may be mutated
          // until the awaited read is known to have succeeded against this
          // still-current session, so a failed read or a stale continuation
          // never leaves the previous session's state partially cleared.
          const freshBytes =
            file.size > 0 ? new Uint8Array(await file.slice(0, file.size).arrayBuffer()) : new Uint8Array(0);
          if (!isCurrent()) return;

          readOffsetRef.current = 0;
          tailStateRef.current = INITIAL_POLL_TAIL_STATE;
          decoderRef.current = new TextDecoder();
          anchorRef.current = EMPTY_LIVE_ANCHOR;
          setEvents([]);
          setWarnings([]);
          setSelectedRunId(null);

          tailBytes = freshBytes;
        }

        if (decision.kind !== 'unchanged') {
          const bytes = tailBytes ?? new Uint8Array(0);
          if (bytes.length > 0) {
            // `stream: true` retains any multi-byte UTF-8 sequence split
            // across this chunk boundary until the rest arrives in a later
            // tick.
            const decoder = decoderRef.current ?? new TextDecoder();
            decoderRef.current = decoder;
            const chunkText = decoder.decode(bytes, { stream: true });

            const step = pushPollTailChunk(tailStateRef.current, chunkText);
            tailStateRef.current = step.state;
            if (step.events.length > 0) setEvents((current) => [...current, ...step.events]);
            if (step.warnings.length > 0) setWarnings((current) => [...current, ...step.warnings]);

            anchorRef.current = nextAnchor(anchorRef.current, bytes, LIVE_ANCHOR_BYTES);
          }
          readOffsetRef.current = file.size;
        }

        if (isCurrent()) setLoadError(null);
      } catch (caught) {
        if (isCurrent()) setLoadError(caught instanceof Error ? caught.message : 'Failed to poll the live file.');
      } finally {
        scheduleNext();
      }
    };

    void tick();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [livePolling]);

  // Selectable options: one per resolved source, plus a distinct "pending"
  // option whenever any cycle has stage activity but no rollup yet. Kept
  // separate from `analysis.sources` so a real source's cycles are never
  // combined with unresolved cycles under one selection (see Finding 1).
  const hasPending = analysis.unresolvedCycles.length > 0;
  const selectorOptions = useMemo(
    () => [
      ...analysis.sources.map((entry) => ({ key: entry.source, label: entry.source, count: entry.cycles.length })),
      ...(hasPending ? [{ key: PENDING_SOURCE_KEY, label: PENDING_SOURCE_LABEL, count: analysis.unresolvedCycles.length }] : []),
    ],
    [analysis.sources, analysis.unresolvedCycles.length, hasPending],
  );

  // Keep the selected source/pending option stable across re-derivation:
  // only fall back when the current selection no longer exists. A real
  // source is always preferred on fallback — pending is only chosen when no
  // real source is available — so pending is never auto-selected "under" a
  // real source.
  const stableSelectedSource = useMemo(() => {
    if (selectedSource === PENDING_SOURCE_KEY && hasPending) return PENDING_SOURCE_KEY;
    if (selectedSource && analysis.sources.some((entry) => entry.source === selectedSource)) return selectedSource;
    if (analysis.sources.length > 0) return analysis.sources[0].source;
    return hasPending ? PENDING_SOURCE_KEY : null;
  }, [analysis.sources, hasPending, selectedSource]);

  useEffect(() => {
    if (stableSelectedSource !== selectedSource) setSelectedSource(stableSelectedSource);
  }, [stableSelectedSource, selectedSource]);

  const isPendingSelected = stableSelectedSource === PENDING_SOURCE_KEY;

  const selectedSourceAnalysis = useMemo(
    () => (isPendingSelected ? null : analysis.sources.find((entry) => entry.source === stableSelectedSource) ?? null),
    [analysis.sources, isPendingSelected, stableSelectedSource],
  );

  // Selection/replay draws exclusively from whichever option is selected: a
  // real source's own completed cycles, or every still-unresolved
  // (in-progress) cycle when "Source pending" is selected — never both.
  const combinedCycles = useMemo<PollCycleAnalysis[]>(
    () => (isPendingSelected ? analysis.unresolvedCycles : selectedSourceAnalysis?.cycles ?? []),
    [analysis.unresolvedCycles, isPendingSelected, selectedSourceAnalysis],
  );

  const stableSelectedRunId = useMemo(() => {
    if (selectedRunId && combinedCycles.some((cycle) => cycle.runId === selectedRunId)) return selectedRunId;
    const latestFirst = [...combinedCycles].sort((a, b) => b.startedAtMs - a.startedAtMs);
    return latestFirst[0]?.runId ?? null;
  }, [combinedCycles, selectedRunId]);

  useEffect(() => {
    if (stableSelectedRunId !== selectedRunId) setSelectedRunId(stableSelectedRunId);
  }, [stableSelectedRunId, selectedRunId]);

  const selectedCycle = combinedCycles.find((cycle) => cycle.runId === stableSelectedRunId) ?? null;
  const recentWarnings = warnings.slice(-5);

  return (
    <div
      className={`app ${dragOver ? 'app--dragover' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragOver(false);
      }}
      onDrop={onDropStaticFile}
    >
      {dragOver && <div className="app__drop-overlay">Drop a poll telemetry .jsonl file</div>}
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__logo">◎</span>
          <div>
            <div className="app__title">Poll Telemetry</div>
            <div className="app__sub">PollTelemetry__Sink=jsonl stage/cycle stream</div>
          </div>
        </div>
        <div className="app__actions">
          <button className="btn btn--sm" type="button" onClick={() => inputRef.current?.click()}>
            Load .jsonl
          </button>
          <input
            ref={inputRef}
            className="dropzone__input"
            type="file"
            accept=".jsonl,application/x-ndjson,text/plain"
            onChange={onPickStaticFile}
          />
          {supportsLiveFile && (
            <button
              className={`btn btn--sm ${mode === 'live' ? (livePolling ? 'btn--status-ok' : 'btn--status-warn') : 'btn--ghost'}`}
              type="button"
              onClick={mode === 'live' && livePolling ? stopLivePoll : startLivePoll}
              disabled={liveBusy}
              aria-pressed={mode === 'live' && livePolling}
            >
              {mode === 'live' ? (livePolling ? 'Stop live' : 'Live stopped') : 'Poll live file'}
            </button>
          )}
          {warnings.length > 0 && <span className="tag tag--warn">{formatNumber(warnings.length, 0)} warnings</span>}
          {loaded && <span className="tag tag--muted">{formatNumber(events.length, 0)} events</span>}
          {loaded && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={resetAll}>
              Clear
            </button>
          )}
        </div>
      </header>

      {!loaded ? (
        <main className="app__welcome">
          <div className="dropzone">
            <div
              className={`dropzone__target ${dragOver ? 'dropzone__target--over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                inputRef.current?.click();
              }}
            >
              <div className="dropzone__icon">↧</div>
              <div className="dropzone__title">Drop a poll telemetry .jsonl file</div>
              <div className="dropzone__hint">
                Or use Load .jsonl above{supportsLiveFile ? ', or Poll live file to tail a file as it grows' : ''}
              </div>
            </div>
          </div>
          {loadError && (
            <div className="dropzone__error" role="alert">
              {loadError}
            </div>
          )}
          <p className="app__welcome-note">
            Load a static <code>PollTelemetry__Sink=jsonl</code> file to visualize cycle outcomes, throughput, and stage
            replay per source.
            {supportsLiveFile ? ' Use Poll live file to tail one file as the poller appends to it.' : ''}
          </p>
        </main>
      ) : (
        <main className="app__main">
          <section className="run-hero">
            <div className="run-hero__content">
              <p className="run-hero__eyebrow">{mode === 'live' ? (livePolling ? 'Polling live file' : 'Live file (stopped)') : 'Loaded file'}</p>
              <h1>{sourceLabel ?? 'Poll telemetry'}</h1>
              {(loadError || recentWarnings.length > 0) && (
                <div className="run-hero__refreshes">
                  {loadError && <span className="run-hero__refresh run-hero__refresh--error">{loadError}</span>}
                  {recentWarnings.map((warning, index) => (
                    <span key={`${warning.line}-${index}`} className="run-hero__refresh run-hero__refresh--error">
                      {warning.message}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {selectorOptions.length > 1 && (
            <div className="app__chart-window" aria-label="Poll source selector">
              <span>Source</span>
              {selectorOptions.map((option) => (
                <button
                  key={option.key}
                  className={`btn btn--sm ${stableSelectedSource === option.key ? '' : 'btn--ghost'}`}
                  type="button"
                  onClick={() => setSelectedSource(option.key)}
                >
                  {option.label} · {formatNumber(option.count, 0)}
                </button>
              ))}
            </div>
          )}

          {selectedSourceAnalysis ? (
            <>
              <PollMetricDashboard source={selectedSourceAnalysis} />
              <PollThroughputTrends source={selectedSourceAnalysis} />
            </>
          ) : (
            <Panel
              title="Poll cycle metrics"
              description={
                isPendingSelected
                  ? 'Pending cycles have stage activity but no rollup yet, so they have no source and no metrics/trends. They appear in Poll cycles below.'
                  : 'No cycle has resolved to a source yet; stage activity appears in Poll cycles below once matched.'
              }
            >
              <div className="chart-empty">{isPendingSelected ? 'Unresolved cycles have no metrics' : 'Waiting for a completed cycle'}</div>
            </Panel>
          )}

          <PollCycleList cycles={combinedCycles} selectedRunId={stableSelectedRunId} onSelect={setSelectedRunId} />
          <PollTimelineReplay cycle={selectedCycle} />
        </main>
      )}
    </div>
  );
}
