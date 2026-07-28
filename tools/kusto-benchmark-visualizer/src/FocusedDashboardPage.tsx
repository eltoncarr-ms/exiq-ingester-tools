import { useCallback, useMemo, useRef, useState } from 'react';
import { formatDuration, formatNumber } from './benchmark/format';
import { Panel } from './components/Panel';
import { ThroughputGaugeGrid } from './components/RunThroughputGauges';
import {
  computeFocusedKpis,
  computeFocusedThroughput,
  type BandLevel,
  type Distribution,
  type FocusedKpis,
} from './appinsights/derive';
import { DEFAULT_QUERY_SERVER_PORT, loadCompletedCycles } from './appinsights/query';
import type { CompletedCycleRow } from './appinsights/types';

// ── Stat table helpers ─────────────────────────────────────────────────────

function fmtDist(
  d: Distribution | null | undefined,
  fmt: (v: number) => string,
): { count: string; min: string; mean: string; median: string; p95: string; max: string; stdDev: string } {
  if (!d) return { count: '—', min: '—', mean: '—', median: '—', p95: '—', max: '—', stdDev: '—' };
  const n = (v: number | null) => (v === null ? '—' : fmt(v));
  return {
    count: String(d.count),
    min: n(d.min),
    mean: n(d.mean),
    median: n(d.median),
    p95: n(d.p95),
    max: n(d.max),
    stdDev: n(d.stdDev),
  };
}

const TABLE_STYLE: React.CSSProperties = { borderCollapse: 'collapse', width: '100%' };
const TH_STYLE: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.25rem 0.5rem',
  borderBottom: '1px solid var(--border, #3f3f46)',
  whiteSpace: 'nowrap',
};
const TD_STYLE: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontVariantNumeric: 'tabular-nums',
};
const SUBTITLE_STYLE: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '0.875rem',
  margin: '0 0 0.5rem',
  color: 'var(--text-muted, inherit)',
};
const SUBTITLE_STYLE_SPACED: React.CSSProperties = {
  ...SUBTITLE_STYLE,
  marginTop: '1.25rem',
};

function StatTableHead() {
  return (
    <thead>
      <tr>
        <th style={TH_STYLE}>Level / Mode</th>
        <th style={TH_STYLE}>Count</th>
        <th style={TH_STYLE}>Min</th>
        <th style={TH_STYLE}>Mean</th>
        <th style={TH_STYLE}>Median</th>
        <th style={TH_STYLE}>P95</th>
        <th style={TH_STYLE}>Max</th>
        <th style={TH_STYLE}>Std Dev</th>
      </tr>
    </thead>
  );
}

type FmtDistResult = ReturnType<typeof fmtDist>;

function DistRow({ label, dist }: { label: string; dist: FmtDistResult }) {
  return (
    <tr>
      <td style={TD_STYLE}>{label}</td>
      <td style={TD_STYLE}>{dist.count}</td>
      <td style={TD_STYLE}>{dist.min}</td>
      <td style={TD_STYLE}>{dist.mean}</td>
      <td style={TD_STYLE}>{dist.median}</td>
      <td style={TD_STYLE}>{dist.p95}</td>
      <td style={TD_STYLE}>{dist.max}</td>
      <td style={TD_STYLE}>{dist.stdDev}</td>
    </tr>
  );
}

const BAND_LEVEL_LABELS: Record<BandLevel, string> = {
  intraBand: 'Intra-band',
  band: 'Band',
};
const BAND_LEVELS: BandLevel[] = ['intraBand', 'band'];

// ── Page component ─────────────────────────────────────────────────────────

export function FocusedDashboardPage() {
  const [anchor, setAnchor] = useState('');
  const [appRole, setAppRole] = useState('cursor-poller-local');
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [discoveredDuration, setDiscoveredDuration] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState(48);
  const [rows, setRows] = useState<CompletedCycleRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'discovering' | 'discovered' | 'fetching'>('idle');
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, CompletedCycleRow[]>>(new Map());
  const sessionRef = useRef(0);

  // datetime-local yields local wall time; new Date(local).toISOString() converts to UTC.
  const anchorIso = anchor ? new Date(anchor).toISOString() : null;

  const handleDiscover = useCallback(async () => {
    if (!anchorIso || !appRole.trim()) return;
    sessionRef.current += 1;
    const gen = sessionRef.current;
    setPhase('discovering');
    setError(null);
    const discoveryStart = new Date(Date.parse(anchorIso) - 24 * 3_600_000).toISOString();
    try {
      const result = await loadCompletedCycles({
        kind: 'live',
        port: DEFAULT_QUERY_SERVER_PORT,
        params: { appRoleNameFilter: appRole.trim(), startTimeUtc: discoveryStart, durationHours: 48 },
      });
      if (sessionRef.current !== gen) return;
      if (result.length === 0) {
        setError('No cycles found for this role in the ±24h window.');
        setPhase('idle');
        return;
      }
      const times = result.map((r) => Date.parse(r.eventTimeUtc)).filter(Number.isFinite);
      const wStart = new Date(Math.min(...times)).toISOString();
      const wEnd = new Date(Math.max(...times)).toISOString();
      const disc = (Date.parse(wEnd) - Date.parse(wStart)) / 3_600_000;
      const isTruncated = Date.parse(wStart) - Date.parse(discoveryStart) < 3_600_000;
      setWindowStart(wStart);
      setDiscoveredDuration(disc);
      setDurationHours(disc);
      setRows(result);
      setTruncated(isTruncated);
      setPhase('discovered');
    } catch (err) {
      if (sessionRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }, [anchorIso, appRole]);

  const handleFetch = useCallback(async () => {
    if (!windowStart || !appRole.trim()) return;
    const cacheKey = `${appRole.trim()}|${windowStart}|${durationHours.toFixed(4)}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setRows(cached);
      return;
    }
    sessionRef.current += 1;
    const gen = sessionRef.current;
    setPhase('fetching');
    setError(null);
    try {
      const result = await loadCompletedCycles({
        kind: 'live',
        port: DEFAULT_QUERY_SERVER_PORT,
        params: { appRoleNameFilter: appRole.trim(), startTimeUtc: windowStart, durationHours },
      });
      if (sessionRef.current !== gen) return;
      cacheRef.current.set(cacheKey, result);
      setRows(result);
      setPhase('discovered');
    } catch (err) {
      if (sessionRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('discovered'); // keep last-good rows; stay in discovered state
    }
  }, [appRole, durationHours, windowStart]);

  const handleClear = useCallback(() => {
    sessionRef.current += 1;
    setRows([]);
    setError(null);
    setWindowStart(null);
    setDiscoveredDuration(null);
    setTruncated(false);
    setPhase('idle');
    cacheRef.current.clear();
    // Retain anchor and appRole
  }, []);

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(e.target.value);
      if (!Number.isFinite(next)) return;
      setDurationHours(Math.max(discoveredDuration ?? 0, Math.min(168, next)));
    },
    [discoveredDuration],
  );

  const throughput = useMemo(
    () => (rows.length > 0 ? computeFocusedThroughput(rows) : null),
    [rows],
  );
  const kpis = useMemo<FocusedKpis | null>(
    () => (rows.length > 0 ? computeFocusedKpis(rows) : null),
    [rows],
  );

  return (
    <div className="app">
      {/* Header bar */}
      <header className="app__bar appinsights-header">
        <div className="app__brand">
          <span className="app__logo">◎</span>
          <div>
            <div className="app__title">App Insights – Focused</div>
            <div className="app__sub">Window-based CursorPoll.Cycle telemetry</div>
          </div>
        </div>
        <div className="app__actions appinsights-header__actions">
          {/* App role input */}
          <input
            className="input input--sm"
            type="text"
            placeholder="App role name"
            value={appRole}
            onChange={(e) => setAppRole(e.target.value)}
            disabled={phase === 'discovering' || phase === 'fetching'}
          />
          {/* Anchor datetime-local input */}
          <label className="input-label input-label--sm">
            <input
              className="input input--sm"
              type="datetime-local"
              title="Anchor time (local — converted to UTC)"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              disabled={phase === 'discovering' || phase === 'fetching'}
            />
            <span className="input-label__hint">(UTC)</span>
          </label>
          {/* Discover button */}
          <button
            type="button"
            className="btn btn--sm"
            onClick={handleDiscover}
            disabled={!anchorIso || !appRole.trim() || phase === 'discovering' || phase === 'fetching'}
          >
            {phase === 'discovering' ? 'Discovering…' : 'Discover'}
          </button>
          {/* Window info + extend controls, shown after discovery */}
          {phase !== 'idle' && windowStart && discoveredDuration !== null && (
            <>
              <span className="appinsights-header__info">
                Window: {new Date(windowStart).toISOString().replace('T', ' ').slice(0, 19)}Z
                &nbsp;·&nbsp;{discoveredDuration.toFixed(1)}h discovered
              </span>
              <input
                className="input input--sm"
                type="number"
                min={discoveredDuration}
                max={168}
                step={0.5}
                value={durationHours}
                onChange={handleDurationChange}
                disabled={phase === 'fetching'}
                title="Fetch window duration (hours)"
                style={{ width: '6rem' }}
              />
              <span className="input-label__hint">h</span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={handleFetch}
                disabled={phase === 'fetching' || durationHours <= 0}
              >
                {phase === 'fetching' ? 'Fetching…' : 'Fetch'}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={handleClear}
                disabled={phase === 'discovering' || phase === 'fetching'}
              >
                Clear
              </button>
            </>
          )}
        </div>
      </header>

      {/* Truncation warning */}
      {truncated && (
        <div className="load-error" role="alert">
          ⚠ Window start is within 1h of the query edge; the run may be truncated.
          Adjust the anchor or extend backward manually.
        </div>
      )}

      {/* Load error */}
      {error && <div className="load-error" role="alert">{error}</div>}

      {/* Content — only when rows are loaded */}
      {rows.length > 0 && throughput && kpis && (
        <main className="app__main">
          {/* Gauges */}
          <Panel title="Throughput Gauges">
            <ThroughputGaugeGrid
              gauges={['kusto', 'cosmos', 'compression', 'checkpointVelocity']}
              metrics={throughput.metrics}
              iterationMetrics={throughput.iterationMetrics}
              rangePercentile={95}
            />
          </Panel>

          {/* Checkpoint Velocity */}
          <Panel title="Checkpoint Velocity">
            <table style={TABLE_STYLE}>
              <StatTableHead />
              <tbody>
                <DistRow
                  label="All cycles"
                  dist={fmtDist(kpis.checkpointVelocity, (v) => formatNumber(v, 1))}
                />
              </tbody>
            </table>
          </Panel>

          {/* Dependency Latency */}
          <Panel title="Dependency Latency">
            <h3 style={SUBTITLE_STYLE}>Iteration Speed (ms)</h3>
            <table style={TABLE_STYLE}>
              <StatTableHead />
              <tbody>
                <DistRow
                  label="All cycles"
                  dist={fmtDist(kpis.iterationSpeed, formatDuration)}
                />
              </tbody>
            </table>

            <h3 style={SUBTITLE_STYLE_SPACED}>Kusto Latency (ms)</h3>
            <table style={TABLE_STYLE}>
              <StatTableHead />
              <tbody>
                {kpis.kustoLatency.map((entry) => (
                  <DistRow
                    key={entry.label}
                    label={entry.label}
                    dist={fmtDist(entry.distribution, formatDuration)}
                  />
                ))}
              </tbody>
            </table>

            <h3 style={SUBTITLE_STYLE_SPACED}>Cosmos Write Latency (ms)</h3>
            <table style={TABLE_STYLE}>
              <StatTableHead />
              <tbody>
                {BAND_LEVELS.map((level) => (
                  <DistRow
                    key={level}
                    label={BAND_LEVEL_LABELS[level]}
                    dist={fmtDist(kpis.cosmosLatencyByLevel[level], formatDuration)}
                  />
                ))}
              </tbody>
            </table>
          </Panel>
        </main>
      )}
    </div>
  );
}
