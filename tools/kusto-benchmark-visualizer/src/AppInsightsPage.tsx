/**
 * App Insights completed-cycle dashboard page.
 *
 * Three input modes, all normalized through the same path (see src/appinsights/query.ts):
 *   - Fixture: checked-in sample rows
 *   - File: user-selected exported-query JSON
 *   - Live: loopback HTTP call to the local query server
 *
 * Per AI-13: on a failed live refresh the page retains its last-good rows.
 * Per AI-02: this page does not import poll/types.ts, poll/derive.ts, or any
 *            poll-specific component.
 */
import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  formatCompactNumber,
  formatDuration,
  formatDurationDynamic,
  formatNumber,
} from './benchmark/format';
import { Panel } from './components/Panel';
import { ThroughputGaugeGrid } from './components/RunThroughputGauges';
import { CycleDetailPanel } from './components/appinsights/CycleDetailPanel';
import { ShardFleetTable } from './components/appinsights/ShardFleetTable';
import {
  computeBacklogStats,
  computeCosmosStats,
  computeKustoStats,
  computeShardFleet,
  computeSummary,
  computeThroughputStats,
} from './appinsights/derive';
import { loadCompletedCycles, DEFAULT_QUERY_SERVER_PORT } from './appinsights/query';
import type { CompletedCycleRow } from './appinsights/types';

type SourceMode = 'idle' | 'fixture' | 'file' | 'live';

function nullableNum(v: number | null, digits = 0): string {
  return v === null ? '—' : formatNumber(v, digits);
}

function nullableMs(v: number | null): string {
  return v === null ? '—' : formatDuration(v);
}

function nullableCompact(v: number | null): string {
  return v === null ? '—' : formatCompactNumber(v);
}

function nullableLag(v: number | null): string {
  return v === null ? '—' : formatDurationDynamic(v * 1000);
}

function MetricCard({
  label,
  value,
  detail,
  warn,
}: {
  label: string;
  value: string;
  detail?: string;
  warn?: boolean;
}) {
  return (
    <div className={`metric-card${warn ? ' metric-card--warn' : ''}`}>
      {detail && (
        <span className="metric-card__info">
          <span className="gauge-card__info">
            <button
              type="button"
              className="gauge-card__info-trigger"
              aria-label={`About ${label}`}
            >
              i
            </button>
            <span className="gauge-card__info-tooltip" role="tooltip">{detail}</span>
          </span>
        </span>
      )}
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
    </div>
  );
}

export function AppInsightsPage() {
  const [mode, setMode] = useState<SourceMode>('idle');
  const [rows, setRows] = useState<CompletedCycleRow[]>([]);
  const [lastGoodRows, setLastGoodRows] = useState<CompletedCycleRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Filters
  const [filterSource, setFilterSource] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterMode, setFilterMode] = useState('');

  // Live config
  const [livePort, setLivePort] = useState(DEFAULT_QUERY_SERVER_PORT);
  const [liveAppRole, setLiveAppRole] = useState('cursor-poller-local');
  const [liveLookback, setLiveLookback] = useState(24);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Session guard: invalidate in-flight loads on reset/switch
  const sessionRef = useRef(0);

  const resetAll = useCallback(() => {
    sessionRef.current += 1;
    setRows([]);
    setLastGoodRows([]);
    setMode('idle');
    setLoadError(null);
    setBusy(false);
    setSelectedRunId(null);
  }, []);

  const applyRows = useCallback((newRows: CompletedCycleRow[]) => {
    setRows(newRows);
    setLastGoodRows(newRows);
    setLoadError(null);
  }, []);

  const loadFixture = useCallback(async () => {
    sessionRef.current += 1;
    const gen = sessionRef.current;
    setBusy(true);
    setLoadError(null);
    try {
      const result = await loadCompletedCycles({ kind: 'fixture' });
      if (sessionRef.current !== gen) return;
      applyRows(result);
      setMode('fixture');
    } catch (err) {
      if (sessionRef.current !== gen) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sessionRef.current === gen) setBusy(false);
    }
  }, [applyRows]);

  const loadFile = useCallback(async (file: File) => {
    sessionRef.current += 1;
    const gen = sessionRef.current;
    setBusy(true);
    setLoadError(null);
    setSelectedRunId(null);
    try {
      const result = await loadCompletedCycles({ kind: 'file', file });
      if (sessionRef.current !== gen) return;
      applyRows(result);
      setMode('file');
    } catch (err) {
      if (sessionRef.current !== gen) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sessionRef.current === gen) setBusy(false);
    }
  }, [applyRows]);

  const loadLive = useCallback(async () => {
    if (!liveAppRole.trim()) {
      setLoadError('Enter an application role name before querying live.');
      return;
    }
    sessionRef.current += 1;
    const gen = sessionRef.current;
    setBusy(true);
    setLoadError(null);
    // Keep last-good rows visible while refreshing (AI-13)
    try {
      const result = await loadCompletedCycles({
        kind: 'live',
        port: livePort,
        params: { appRoleNameFilter: liveAppRole.trim(), lookbackHours: liveLookback },
      });
      if (sessionRef.current !== gen) return;
      applyRows(result);
      setMode('live');
    } catch (err) {
      if (sessionRef.current !== gen) return;
      // On failure, retain last-good rows and show an error (AI-13)
      setRows(lastGoodRows);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sessionRef.current === gen) setBusy(false);
    }
  }, [applyRows, lastGoodRows, liveAppRole, liveLookback, livePort]);

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  // Unique filter options derived from loaded rows
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source).filter(Boolean))].sort(), [rows]);
  const outcomes = useMemo(() => [...new Set(rows.map((r) => r.outcome).filter(Boolean))].sort(), [rows]);
  const modes = useMemo(() => [...new Set(rows.map((r) => r.executionMode))].sort(), [rows]);

  // Apply filters
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterSource && r.source !== filterSource) return false;
      if (filterOutcome && r.outcome !== filterOutcome) return false;
      if (filterMode && r.executionMode !== filterMode) return false;
      return true;
    });
  }, [rows, filterSource, filterOutcome, filterMode]);

  // Compute wall-clock interval from event times
  const wallClockSeconds = useMemo(() => {
    const times = filtered
      .map((r) => (r.eventTimeUtc ? Date.parse(r.eventTimeUtc) : NaN))
      .filter(Number.isFinite);
    if (times.length < 2) return 0;
    const min = Math.min(...times);
    const max = Math.max(...times);
    return (max - min) / 1000;
  }, [filtered]);

  const summary = useMemo(() => computeSummary(filtered, wallClockSeconds), [filtered, wallClockSeconds]);
  const fleet = useMemo(() => computeShardFleet(filtered), [filtered]);
  const backlog = useMemo(() => computeBacklogStats(filtered), [filtered]);
  const kusto = useMemo(() => computeKustoStats(filtered), [filtered]);
  const cosmos = useMemo(() => computeCosmosStats(filtered), [filtered]);
  const throughput = useMemo(() => computeThroughputStats(filtered), [filtered]);

  const iterationRows = useMemo(
    () => [...filtered].sort((a, b) => Date.parse(b.eventTimeUtc) - Date.parse(a.eventTimeUtc)),
    [filtered],
  );

  const selectedRow = useMemo(() => {
    if (selectedRunId) {
      return iterationRows.find((r) => r.runId === selectedRunId) ?? iterationRows[0] ?? null;
    }
    return iterationRows[0] ?? null;
  }, [iterationRows, selectedRunId]);

  const activeRunId = selectedRow?.runId ?? null;

  const loaded = mode !== 'idle';

  return (
    <div className="app">
      <main className="app__main">
      {/* ── Benchmark selector / input controls ─────────────────────────── */}
      <Panel title="App Insights — Completed Cycle Dashboard" eyebrow="CursorPoll.Cycle">
        <div className="poll-controls-row">
          <button type="button" className="btn" onClick={() => void loadFixture()} disabled={busy}>
            {busy && mode === 'fixture' ? 'Loading…' : 'Load fixture'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            Load exported JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={onFileInputChange}
          />
          {loaded && (
            <button type="button" className="btn btn--secondary" onClick={resetAll}>
              Clear
            </button>
          )}
        </div>

        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Live query (requires local server)</summary>
          <div className="poll-controls-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              App role name{' '}
              <input
                type="text"
                value={liveAppRole}
                onChange={(e) => setLiveAppRole(e.target.value)}
                placeholder="eiq-test-row-wus3-api-xnmmvm"
                style={{ width: 280 }}
              />
            </label>
            <label>
              Lookback (h){' '}
              <input
                type="number"
                value={liveLookback}
                min={1}
                max={168}
                onChange={(e) => setLiveLookback(Math.max(1, Math.min(168, Number(e.target.value))))}
                style={{ width: 60 }}
              />
            </label>
            <label>
              Server port{' '}
              <input
                type="number"
                value={livePort}
                min={1024}
                max={65535}
                onChange={(e) => setLivePort(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </label>
            <button type="button" className="btn" onClick={() => void loadLive()} disabled={busy}>
              {busy && mode === 'live' ? 'Querying…' : 'Query live'}
            </button>
          </div>
        </details>

        {loadError && (
          <div className="load-error" role="alert" style={{ marginTop: 8, color: 'var(--color-danger, #f87171)' }}>
            {loadError}
          </div>
        )}

        {loaded && (
          <div className="poll-controls-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <label>
              Source{' '}
              <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
                <option value="">All</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Outcome{' '}
              <select value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)}>
                <option value="">All</option>
                {outcomes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label>
              Mode{' '}
              <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)}>
                <option value="">All</option>
                {modes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <span className="tag tag--ok">{filtered.length} rows</span>
            {wallClockSeconds > 0 && (
              <span className="tag">wall clock: {formatNumber(wallClockSeconds, 0)} s</span>
            )}
          </div>
        )}
      </Panel>

      {loaded && (
        <>
          {/* ── Summary ───────────────────────────────────────────────────── */}
          <Panel title="Summary" eyebrow="Fleet-level aggregates">
            <div className="poll-outcome-row" aria-label="Cycle outcome counts">
              <span className="tag tag--ok">{formatNumber(summary.succeeded, 0)} success</span>
              <span className="tag tag--warn">{formatNumber(summary.skipped, 0)} skipped</span>
              <span className="tag tag--danger">{formatNumber(summary.failed, 0)} failed</span>
              <span className="tag">{formatNumber(summary.cancelled, 0)} cancelled</span>
              {summary.validationFailureSweeps > 0 && (
                <span className="tag tag--warn">{formatNumber(summary.validationFailureSweeps, 0)} validation failure sweeps</span>
              )}
            </div>
            <div className="metric-strip metric-strip--wrap">
              <MetricCard
                label="Rows Processed"
                value={nullableCompact(summary.totalRawBandRows ?? summary.totalInputRows)}
                detail="Interval aggregate prefers non-overlapping rawBandRows deduped by bandId. Per-iteration views below show physical rawScanRows."
              />
              <MetricCard
                label="Events Finalized"
                value={formatCompactNumber(summary.totalRecords)}
                detail="Destination interactions finalized across the selected cycle rows."
              />
              <MetricCard
                label="Avg Cycle Duration"
                value={summary.avgCycleMs === null ? '—' : formatDuration(summary.avgCycleMs)}
                detail="Average total cycle duration across lane attempts with an observed totalMs."
              />
              <MetricCard
                label="Cursor Lag"
                value={nullableLag(summary.maxCursorLagAfterSeconds)}
                detail="Worst observed wall-clock distance from cycle completion to the durable cursor watermark."
              />
              <MetricCard
                label="Total Write RU"
                value={nullableCompact(summary.totalInteractionWriteRu)}
                detail="interactionWriteRu summed across both bulk and transactional interaction writes. Snapshot RU remains a separate diagnostic gap."
              />
            </div>
            <details className="metric-details">
              <summary>Additional summary details</summary>
              <div className="metric-strip metric-strip--wrap">
              <MetricCard
                label="Checkpoints"
                value={formatNumber(summary.checkpointCount, 0)}
                detail="Successful cycles that durably committed positive source-time progress."
              />
              <MetricCard
                label="Fleet throughput"
                value={summary.fleetThroughputPerSec !== null ? `${formatNumber(summary.fleetThroughputPerSec, 1)}/s` : '—'}
                detail="Finalized events divided by the selected event-time span. This is sum(records)/wall-clock seconds, not an average of per-cycle recordsPerSec."
              />
              <MetricCard
                label="Physical raw scan rows"
                value={nullableCompact(summary.totalInputRows)}
                detail="rawScanRows summed across cycle rows. This is the physical per-iteration count and can double-count resumed pages."
              />
              <MetricCard
                label="Non-overlapping band rows"
                value={nullableCompact(summary.totalRawBandRows)}
                detail="rawBandRows deduped by bandId so resumed pages do not double-count interval totals."
              />
              <MetricCard
                label="Committed progress"
                value={summary.totalCommittedProgressSeconds !== null ? `${formatNumber(summary.totalCommittedProgressSeconds, 0)} s` : '—'}
                detail="Total durable source-time seconds committed across the selected cycle rows."
              />
              <MetricCard
                label="Max backlog"
                value={summary.maxBacklogAfterSeconds !== null ? `${formatNumber(summary.maxBacklogAfterSeconds, 0)} s` : '—'}
                detail="Worst remaining backlog across shards after a cycle completes. Per-shard backlog is never summed."
              />
              <MetricCard
                label="Lane attempts"
                value={formatNumber(summary.laneAttempts, 0)}
                detail="Completed lane-attempt rows included by the current filters."
              />
              <MetricCard
                label="Partial Cosmos RU"
                value={nullableCompact(summary.partialTotalRu)}
                detail="Diagnostic totalCosmosRu only. This remains partial because snapshot success RU is still unavailable."
                warn={summary.partialTotalRu !== null}
              />
            </div>
            </details>
            <details className="metric-details">
              <summary>Progress-kind breakdown</summary>
              <div className="poll-outcome-row" aria-label="Progress kind counts">
                <span className="tag">{formatNumber(summary.progressKindCounts.bandCommit, 0)} bandCommit</span>
                <span className="tag">{formatNumber(summary.progressKindCounts.continuation, 0)} continuation</span>
                <span className="tag">{formatNumber(summary.progressKindCounts.noWork, 0)} noWork</span>
                <span className="tag">{formatNumber(summary.progressKindCounts.unknown, 0)} absent</span>
              </div>
            </details>
            <details className="metric-details">
              <summary>Throughput gauges</summary>
              <ThroughputGaugeGrid
                metrics={throughput.metrics}
                iterationMetrics={throughput.iterationMetrics}
                rangePercentile={95}
              />
            </details>
          </Panel>

          {/* ── Shard fleet ───────────────────────────────────────────────── */}
          <Panel
            title="Shard fleet"
            eyebrow="Per-shard cursor lag, progress, outcomes, backlog"
            description="Cursor lag and backlog are shown per shard; backlog is never summed across shards."
          >
            <ShardFleetTable entries={fleet} />
          </Panel>

          {/* ── Iterations ─────────────────────────────────────────────────── */}
          <Panel
            title="Iterations"
            eyebrow="Per-iteration raw scan, lag, and write RU"
            description="Rows show per-cycle rawScanRows. Select one to inspect the full secondary detail below."
          >
            {iterationRows.length === 0 ? (
              <div className="chart-empty">No cycle rows match the current filters</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="poll-shard-table" style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85em' }}>
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Shard</th>
                      <th>Rows processed</th>
                      <th>Events finalized</th>
                      <th>Duration</th>
                      <th>Cursor after</th>
                      <th>Cursor lag</th>
                      <th>Write RU</th>
                      <th>Progress</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {iterationRows.map((row, index) => {
                      const isSelected = row.runId === activeRunId;
                      return (
                        <tr key={`${row.runId}-${index}`} style={isSelected ? { background: 'rgba(96, 165, 250, 0.08)' } : undefined}>
                          <td>
                            <button
                              type="button"
                              className="btn btn--secondary"
                              style={{ padding: '2px 8px', fontSize: '0.9em' }}
                              onClick={() => setSelectedRunId(row.runId)}
                            >
                              {row.eventTimeUtc}
                            </button>
                          </td>
                          <td>{row.shardId === '' ? '(singleton)' : row.shardId}</td>
                          <td>{nullableCompact(row.rawScanRows)}</td>
                          <td>{nullableCompact(row.outcome === 'success' ? row.records : null)}</td>
                          <td>{nullableMs(row.totalMs)}</td>
                          <td>{row.cursorAfterUtc ?? '—'}</td>
                          <td>{nullableLag(row.cursorLagAfterSeconds)}</td>
                          <td>{nullableCompact(row.interactionWriteRu)}</td>
                          <td>{row.progressKind || '—'}</td>
                          <td>{row.outcome || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <details className="metric-details" open={selectedRow !== null}>
              <summary>Selected cycle detail</summary>
              {selectedRow && <CycleDetailPanel row={selectedRow} />}
            </details>
          </Panel>

          {/* ── Operational details ───────────────────────────────────────── */}
          <Panel title="Operational details" eyebrow="Secondary diagnostics">
            <details className="metric-details">
              <summary>Backlog and paging</summary>
              <div className="metric-strip">
                <MetricCard label="Max backlog after" value={nullableNum(backlog.maxBacklogAfterSeconds, 1)} detail="Fleet worst-case remaining backlog in seconds." />
                <MetricCard label="Min backlog after" value={nullableNum(backlog.minBacklogAfterSeconds, 1)} detail="Most-caught-up lane in seconds." />
                <MetricCard label="Max backlog before" value={nullableNum(backlog.maxBacklogBeforeSeconds, 1)} detail="Largest starting backlog in seconds." />
                <MetricCard
                  label="Slowest drain rate (s/s)"
                  value={nullableNum(backlog.slowestDrainRateSecondsPerSec, 3)}
                  detail="Worst-backlog lane net drain: (backlog before - backlog after) / cycle wall time."
                />
                <MetricCard
                  label="Guarded drain estimate (s)"
                  value={nullableNum(backlog.guardedDrainEstimateSeconds, 0)}
                  detail="Estimated seconds to drain the maximum backlog at the slowest observed positive drain rate."
                />
              </div>
              <div className="metric-strip">
                <MetricCard label="Has-more cycles" value={formatNumber(backlog.hasMoreCount, 0)} detail="Cycles whose current source-time band was not fully drained." />
                <MetricCard label="Band-drained cycles" value={formatNumber(backlog.bandDrainedCount, 0)} />
                <MetricCard label="Resumed-pending cycles" value={formatNumber(backlog.resumedPendingCount, 0)} />
                <MetricCard label="Reread candidates (sum)" value={nullableNum(backlog.totalRereadCandidates)} />
              </div>
            </details>

            <details className="metric-details">
              <summary>Kusto pipeline</summary>
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                {kusto.hasLegacyRows
                  ? '⚠ Legacy rows present: legacy kustoMs has a different timing boundary from drain-safe kustoMs. Stats are separated by mode.'
                  : 'Drain-safe mode only.'}
              </div>
              <div className="metric-strip">
                <MetricCard label="Throttled cycles" value={formatNumber(kusto.throttledCycleCount, 0)} />
              </div>
              {kusto.byMode.map((m) => (
                <details key={m.mode} open>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Mode: {m.mode} ({formatNumber(m.count, 0)} cycles)
                  </summary>
                  <div className="metric-strip" style={{ marginTop: 8 }}>
                    <MetricCard label="Avg Kusto" value={nullableMs(m.avgKustoMs)} detail={`${m.mode} timing only; timing boundaries differ by execution mode.`} />
                    <MetricCard
                      label="Avg map ms"
                      value={m.mode === 'legacy' ? 'unknown (legacy)' : nullableMs(m.avgMapMs)}
                      detail={m.mode === 'legacy' ? 'Unavailable on legacy rows.' : undefined}
                    />
                    <MetricCard
                      label="Avg rows scanned"
                      value={m.mode === 'legacy' ? 'unknown (legacy)' : nullableNum(m.avgRowsScanned, 0)}
                      detail={m.mode === 'legacy' ? 'Unavailable on legacy rows.' : undefined}
                    />
                    <MetricCard label="Avg rows returned" value={nullableNum(m.avgRowsReturned, 0)} />
                    <MetricCard label="Avg rows mapped" value={nullableNum(m.avgRowsMapped, 0)} />
                    <MetricCard label="Total duplicates collapsed" value={nullableNum(m.totalDuplicateCollapsed)} />
                    <MetricCard label="Total contract invalid" value={nullableNum(m.totalContractInvalid)} />
                    <MetricCard label="Total throttle retries" value={nullableNum(m.throttleRetryTotal)} />
                    <MetricCard label="Total throttle delay" value={nullableMs(m.throttleDelayMsTotal)} />
                  </div>
                </details>
              ))}
            </details>

            <details className="metric-details">
              <summary>Cosmos write diagnostics</summary>
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                cosmosAttempted/Succeeded/Failed/Cancelled are partition-batch outcomes — not document or operation counts.
                totalCosmosRu remains a partial observed diagnostic total because snapshot success RU is still unavailable.
              </div>
              <div className="metric-strip">
                <MetricCard label="Partition-batches attempted" value={nullableNum(cosmos.totalCosmosAttempted)} />
                <MetricCard label="Partition-batches succeeded" value={nullableNum(cosmos.totalCosmosSucceeded)} />
                <MetricCard label="Partition-batches failed" value={nullableNum(cosmos.totalCosmosFailed)} />
                <MetricCard label="Partition-batches cancelled" value={nullableNum(cosmos.totalCosmosCancelled)} />
              </div>
              <div className="metric-strip">
                <MetricCard label="Interaction write RU" value={nullableCompact(summary.totalInteractionWriteRu)} detail="Primary write-RU metric from interactionWriteRu across both bulk and transactional modes." />
                <MetricCard label="Bulk success RU" value={nullableNum(cosmos.bulkSuccessRuSum, 0)} detail="Legacy partial detail: successful bulk interaction writes only." warn={cosmos.bulkSuccessRuSum !== null} />
                <MetricCard label="Total RU" value={nullableNum(cosmos.partialTotalRuSum, 0)} detail="Incomplete observed totalCosmosRu; snapshot success RU is unavailable." warn={cosmos.partialTotalRuSum !== null} />
                <MetricCard label="RU / event" value={nullableNum(cosmos.partialRuPerRecord, 2)} detail="Incomplete observed totalCosmosRu divided by finalized events." />
                <MetricCard label="SDK failures" value={nullableNum(cosmos.sdkFailedServiceRequestTotal)} detail="SDK failed service requests, not retry attempts." />
                <MetricCard label="Terminal 429s" value={nullableNum(cosmos.terminal429Total)} detail="Operations that ended with HTTP 429, not every intermediate 429 response." />
                <MetricCard label="Max terminal retry-after" value={nullableMs(cosmos.maxTerminalRetryAfterMs)} />
                <MetricCard label="Affected cycles" value={formatNumber(cosmos.affectedCycleCount, 0)} />
              </div>
            </details>
          </Panel>
        </>
      )}
      </main>
    </div>
  );
}
