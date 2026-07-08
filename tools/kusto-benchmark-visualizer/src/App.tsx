import { useMemo, useState } from 'react';
import { makeLoadedRun, makeLoadedSummary, type LoadedRun, type LoadedSummary } from './benchmark/derive';
import { formatDateTime, formatDuration, formatNumber } from './benchmark/format';
import { SYNTHETIC_ARTIFACTS } from './benchmark/sample';
import { DropZone, type ParsedArtifact } from './components/DropZone';
import { MetricCharts } from './components/MetricCharts';
import { SummaryComparison } from './components/SummaryComparison';
import { Timeline } from './components/Timeline';

export function App() {
  const [runs, setRuns] = useState<LoadedRun[]>([]);
  const [summaries, setSummaries] = useState<LoadedSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const analyses = useMemo(() => runs.map((run) => run.analysis), [runs]);
  const summaryRows = useMemo(() => summaries.map((summary) => summary.summaryRow), [summaries]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  const addArtifacts = (artifacts: ParsedArtifact[]) => {
    const ordinalBase = Date.now();
    const runAdditions = artifacts
      .filter((artifact): artifact is Extract<ParsedArtifact, { kind: 'run' }> => artifact.kind === 'run')
      .map(({ artifact, sourceName }, index) => makeLoadedRun(artifact, sourceName, ordinalBase + index));
    const summaryAdditions = artifacts
      .filter((artifact): artifact is Extract<ParsedArtifact, { kind: 'summary' }> => artifact.kind === 'summary')
      .map(({ artifact, sourceName }, index) => makeLoadedSummary(artifact, sourceName, ordinalBase + runAdditions.length + index));

    setRuns((current) => [...current, ...runAdditions]);
    setSummaries((current) => [...current, ...summaryAdditions]);
    setSelectedRunId(runAdditions.at(-1)?.id ?? selectedRunId);
  };

  const loadSamples = () => {
    addArtifacts(SYNTHETIC_ARTIFACTS.map((artifact, index) => ({ kind: 'run', artifact, sourceName: `synthetic-${index + 1}.json` })));
  };

  const clearRuns = () => {
    setRuns([]);
    setSummaries([]);
    setSelectedRunId(null);
  };

  return (
    <div className="app">
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
              <span className="tag tag--muted">{selectedRun.artifact.run.partitionScope}</span>
              <span className="tag tag--muted">{formatNumber(selectedRun.artifact.summary.iterationCount, 0)} iterations</span>
              <span className="tag tag--ok">{formatDuration(selectedRun.artifact.summary.durationMs)}</span>
            </>
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
          <DropZone onArtifacts={addArtifacts} onLoadSamples={loadSamples} />
          <p className="app__welcome-note">
            Load one or more Kusto benchmark JSON artifacts to visualize stage timings, throughput, checkpoints, blocker delay, backlog,
            memory, and flush behavior. The synthetic samples demonstrate multi-run baseline comparison.
          </p>
        </main>
      ) : (
        <main className="app__main">
          <section className="run-hero">
            <div>
              <p className="run-hero__eyebrow">{selectedRun ? 'Selected run' : 'Averaged summary'}</p>
              <h1>{selectedRun?.analysis.label ?? summaries.at(-1)?.artifact.label ?? 'Benchmark summary'}</h1>
              {selectedRun ? (
                <p>
                  {selectedRun.artifact.run.source} · client {selectedRun.artifact.run.clientId} of {selectedRun.artifact.run.clientCount} ·{' '}
                  {formatDateTime(selectedRun.artifact.run.startedAtUtc)}
                </p>
              ) : (
                <p>Load run artifacts for timelines; summary artifacts provide averaged baseline comparison rows.</p>
              )}
            </div>
            <DropZone compact onArtifacts={addArtifacts} onLoadSamples={loadSamples} />
          </section>

          <SummaryComparison runs={analyses} summaryRows={summaryRows} selectedRunId={selectedRun?.id ?? null} onSelectRun={setSelectedRunId} />

          {selectedRun && (
            <>
              <Timeline analysis={selectedRun.analysis} />
              <MetricCharts analysis={selectedRun.analysis} />
            </>
          )}
        </main>
      )}
    </div>
  );
}
