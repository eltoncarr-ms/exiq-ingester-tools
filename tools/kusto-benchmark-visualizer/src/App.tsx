import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  filterRunAnalysisByRange,
  makeLoadedRun,
  makeLoadedRunWithId,
  makeLoadedSummary,
  selectPipelineSnapshotForShard,
  selectStableShardId,
  TIME_RANGES,
  upsertLoadedRun,
  type LoadedRun,
  type LoadedSummary,
  type TimeRangeKey,
} from './benchmark/derive';
import { formatDateTime, formatDuration, formatNumber } from './benchmark/format';
import { BenchmarkLoadError } from './benchmark/parse';
import { DropZone, readBenchmarkDataTransfer, readBenchmarkDirectoryHandle, readBenchmarkInputFiles, type BenchmarkDirectoryHandle, type ParsedArtifact } from './components/DropZone';
import { ProcessingWindowPanel } from './components/ProcessingWindowPanel';
import { SummaryComparison } from './components/SummaryComparison';

export function App() {
  const [runs, setRuns] = useState<LoadedRun[]>([]);
  const [summaries, setSummaries] = useState<LoadedSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedShardId, setSelectedShardId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('all');
  const [watchedFiles, setWatchedFiles] = useState<WatchedFile[]>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [dragOverApp, setDragOverApp] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const analyses = useMemo(() => runs.map((run) => run.analysis), [runs]);
  const summaryRows = useMemo(() => summaries.map((summary) => summary.summaryRow), [summaries]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedAnalysis = selectedRun?.analysis ?? null;
  const filteredAnalysis = useMemo(
    () => (selectedAnalysis ? filterRunAnalysisByRange(selectedAnalysis, timeRange) : null),
    [selectedAnalysis, timeRange],
  );
  const stableSelectedShardId = useMemo(
    () => (filteredAnalysis ? selectStableShardId(filteredAnalysis.shardOptions, selectedShardId) : null),
    [filteredAnalysis, selectedShardId],
  );
  const selectedPipelineSnapshot = useMemo(
    () => (filteredAnalysis ? selectPipelineSnapshotForShard(filteredAnalysis, stableSelectedShardId) : null),
    [filteredAnalysis, stableSelectedShardId],
  );
  const selectedRangeLabel = TIME_RANGES.find((range) => range.key === timeRange)?.label ?? 'All';
  const watchedFileSignature = useMemo(() => watchedFiles.map((file) => `${file.id}:${file.sourceName}`).join('|'), [watchedFiles]);
  const supportsLiveWatch = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const hasLiveWatchError = Boolean(watchError) || watchedFiles.some((file) => file.lastError);

  const upsertParsedArtifact = (artifact: ParsedArtifact, ordinal: number) => {
    const stableId = artifact.watchKey ?? `${artifact.kind}:${artifact.sourceName}:${ordinal}`;
    if (artifact.kind === 'run') {
      const loaded = artifact.watchKey
        ? makeLoadedRunWithId(artifact.artifact, artifact.sourceName, stableId)
        : makeLoadedRun(artifact.artifact, artifact.sourceName, ordinal);
      setRuns((current) => (artifact.watchKey ? upsertLoadedRun(current, loaded) : [...current, loaded]));
      setSelectedRunId(loaded.id);
      return;
    }

    const loaded = makeLoadedSummary(artifact.artifact, artifact.sourceName, ordinal);
    setSummaries((current) => [...current, loaded]);
  };

  const addArtifacts = (artifacts: ParsedArtifact[]) => {
    const ordinalBase = Date.now();
    artifacts.forEach((artifact, index) => upsertParsedArtifact(artifact, ordinalBase + index));
  };

  const clearRuns = () => {
    setRuns([]);
    setSummaries([]);
    setSelectedRunId(null);
    setSelectedShardId(null);
    setWatchedFiles([]);
    setWatchError(null);
    setDropError(null);
  };

  const handleAppDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOverApp(false);
    setDropError(null);
    if (event.dataTransfer.files.length === 0 && event.dataTransfer.items.length === 0) return;

    try {
      addArtifacts(await readBenchmarkInputFiles(await readBenchmarkDataTransfer(event.dataTransfer)));
    } catch (caught) {
      setDropError(caught instanceof Error ? caught.message : 'Failed to load dropped benchmark data.');
    }
  };

  const withWatchKey = (artifacts: ParsedArtifact[], watchKey: string): ParsedArtifact[] =>
    artifacts.map((artifact) => ({ ...artifact, watchKey }));

  const watchLiveFile = async () => {
    if (!window.showDirectoryPicker) return;

    setWatchBusy(true);
    setWatchError(null);
    try {
      const handle = await window.showDirectoryPicker();
      const watchKey = `live-dir:${handle.name}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
      addArtifacts(withWatchKey(await readBenchmarkDirectoryHandle(handle), watchKey));
      setWatchedFiles((current) => upsertWatchedFile(current, watchKey, handle.name, handle));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setWatchError(caught instanceof Error ? caught.message : 'Failed to stream benchmark folder.');
    } finally {
      setWatchBusy(false);
    }
  };

  useEffect(() => {
    if (watchedFiles.length === 0) return;

    let disposed = false;
    const refresh = async () => {
      for (const watched of watchedFiles) {
        try {
          const artifacts = withWatchKey(await readBenchmarkDirectoryHandle(watched.handle), watched.id);
          if (disposed) return;
          addArtifacts(artifacts);
          setWatchedFiles((current) =>
            current.map((candidate) =>
              candidate.id === watched.id
                ? { ...candidate, lastRefreshAtUtc: new Date().toISOString(), lastError: null }
                : candidate,
            ),
          );
        } catch (caught) {
          if (disposed) return;
          const message =
            caught instanceof BenchmarkLoadError || caught instanceof Error
              ? caught.message
              : `${watched.sourceName}: failed to refresh.`;
          setWatchedFiles((current) =>
            current.map((candidate) => (candidate.id === watched.id ? { ...candidate, lastError: message } : candidate)),
          );
        }
      }
    };

    const intervalId = window.setInterval(refresh, 250);
    void refresh();
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [watchedFileSignature]);

  useEffect(() => {
    if (stableSelectedShardId !== selectedShardId) {
      setSelectedShardId(stableSelectedShardId);
    }
  }, [selectedShardId, stableSelectedShardId]);

  return (
    <div
      className={`app ${dragOverApp ? 'app--dragover' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOverApp(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragOverApp(false);
        }
      }}
      onDrop={handleAppDrop}
    >
      {dragOverApp && <div className="app__drop-overlay">Drop benchmark run or iterations folder</div>}
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__logo">◨</span>
          <div>
            <div className="app__title">Kusto Benchmark Visualizer</div>
            <div className="app__sub">schema v1 ExIQ ingestion artifacts</div>
          </div>
        </div>
        <div className="app__actions">
          {selectedRun && (
            <>
              <div className="app__chart-window" aria-label="Chart time range">
                <span>Chart window</span>
                {TIME_RANGES.map((range) => (
                  <button
                    key={range.key}
                    className={`btn btn--sm ${timeRange === range.key ? '' : 'btn--ghost'}`}
                    type="button"
                    onClick={() => setTimeRange(range.key)}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
              <span className="tag tag--muted">{selectedRun.artifact.run.partitionScope}</span>
              <span className="tag tag--muted">{formatNumber(selectedRun.artifact.summary.iterationCount, 0)} iterations</span>
              <span className="tag tag--ok">{formatDuration(selectedRun.artifact.summary.durationMs)}</span>
            </>
          )}
          {supportsLiveWatch && (
            <button
              className={`btn btn--sm ${watchedFiles.length > 0 ? (hasLiveWatchError ? 'btn--status-warn' : 'btn--status-ok') : 'btn--ghost'}`}
              type="button"
              onClick={watchLiveFile}
              disabled={watchBusy}
            >
              {watchedFiles.length > 0 ? `Live stream ${formatNumber(watchedFiles.length, 0)}` : 'Live Stream'}
            </button>
          )}
          {summaries.length > 0 && <span className="tag tag--muted">{formatNumber(summaries.length, 0)} summaries</span>}
          {runs.length + summaries.length > 0 && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={clearRuns}>
              Clear
            </button>
          )}
        </div>
      </header>

      {runs.length + summaries.length === 0 ? (
        <main className="app__welcome">
          <DropZone onArtifacts={addArtifacts} />
          <p className="app__welcome-note">
            Load one or more Kusto benchmark JSON artifacts to visualize stage timings, throughput, checkpoints, blocker delay, backlog,
            memory, and flush behavior.
            {supportsLiveWatch ? ' Use Live Stream to poll a benchmark run folder as it is refreshed.' : ''}
          </p>
        </main>
      ) : (
        <main className="app__main">
          <section className="run-hero">
            <div className="run-hero__content">
              <p className="run-hero__eyebrow">{selectedRun ? 'Selected run' : 'Averaged summary'}</p>
              <h1>{selectedRun?.analysis.label ?? summaries.at(-1)?.artifact.label ?? 'Benchmark summary'}</h1>
              {(watchedFiles.length > 0 || watchError || dropError) && (
                <div className="run-hero__refreshes">
                  {watchedFiles.map((file) => (
                    <span key={file.id} className={file.lastError ? 'run-hero__refresh run-hero__refresh--error' : 'run-hero__refresh'}>
                      {file.sourceName}: {file.lastError ?? `refreshed ${file.lastRefreshAtUtc ? formatDateTime(file.lastRefreshAtUtc) : 'pending'}`}
                    </span>
                  ))}
                  {watchError && <span className="run-hero__refresh run-hero__refresh--error">{watchError}</span>}
                  {dropError && <span className="run-hero__refresh run-hero__refresh--error">{dropError}</span>}
                </div>
              )}
              {selectedRun ? (
                <p>
                  {selectedRun.artifact.run.source} · client {selectedRun.artifact.run.clientId} of {selectedRun.artifact.run.clientCount} ·{' '}
                  {formatDateTime(selectedRun.artifact.run.startedAtUtc)}
                </p>
              ) : (
                <p>Load run artifacts for timelines; summary artifacts provide averaged baseline comparison rows.</p>
              )}
            </div>
          </section>

          <SummaryComparison
            runs={analyses}
            summaryRows={summaryRows}
            selectedRunId={selectedRun?.id ?? null}
            timeRangeLabel={selectedRangeLabel}
            visiblePointCount={filteredAnalysis?.throughputPoints.length ?? 0}
            onSelectRun={setSelectedRunId}
          />

          {filteredAnalysis && (
            <ProcessingWindowPanel
              snapshot={selectedPipelineSnapshot}
              shardOptions={filteredAnalysis.shardOptions}
              selectedShardId={stableSelectedShardId}
              onShardChange={setSelectedShardId}
            />
          )}
        </main>
      )}
    </div>
  );
}

interface WatchedFile {
  id: string;
  sourceName: string;
  handle: BenchmarkDirectoryHandle;
  lastRefreshAtUtc: string | null;
  lastError: string | null;
}

function upsertWatchedFile(files: WatchedFile[], id: string, sourceName: string, handle: BenchmarkDirectoryHandle): WatchedFile[] {
  const next: WatchedFile = { id, sourceName, handle, lastRefreshAtUtc: new Date().toISOString(), lastError: null };
  return files.some((file) => file.id === id) ? files.map((file) => (file.id === id ? next : file)) : [...files, next];
}
