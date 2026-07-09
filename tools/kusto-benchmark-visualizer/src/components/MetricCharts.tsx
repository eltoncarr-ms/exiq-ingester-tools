import { useState } from 'react';
import type { RunAnalysis } from '../benchmark/derive';
import { formatBytes, formatDuration, formatNumber, formatRate } from '../benchmark/format';
import { LineChart, StackedBarChart } from './Charts';
import { Panel } from './Panel';

interface MetricChartsProps {
  analysis: RunAnalysis;
}

function checkpointSeries(analysis: RunAnalysis) {
  return [
    {
      name: 'Advanced to',
      color: '#38bdf8',
      points: analysis.checkpointPoints
        .filter((point) => point.advancedTo !== null)
        .map((point) => ({ xMs: point.xMs, xAtMs: point.xAtMs, value: point.advancedTo ?? 0, label: point.label })),
    },
    {
      name: 'Upper watermark',
      color: '#f59e0b',
      points: analysis.checkpointPoints
        .filter((point) => point.upper !== null)
        .map((point) => ({ xMs: point.xMs, xAtMs: point.xAtMs, value: point.upper ?? 0, label: point.label })),
    },
  ];
}

function parseUtc(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chartDomain(analysis: RunAnalysis) {
  const windowStarts = analysis.pipelineSnapshots
    .map((candidate) => parseUtc(candidate.windowStartUtc))
    .filter((value): value is number => value !== null);
  const windowEnds = analysis.pipelineSnapshots
    .map((candidate) => parseUtc(candidate.windowEndUtc))
    .filter((value): value is number => value !== null);
  if (windowStarts.length > 0 && windowEnds.length > 0) {
    let startAtMs = Number.POSITIVE_INFINITY;
    let endAtMs = Number.NEGATIVE_INFINITY;
    for (const value of windowStarts) startAtMs = Math.min(startAtMs, value);
    for (const value of windowEnds) endAtMs = Math.max(endAtMs, value);
    if (Number.isFinite(startAtMs) && Number.isFinite(endAtMs) && endAtMs > startAtMs) {
      return { startAtMs, endAtMs };
    }
  }

  return { startAtMs: analysis.timelineStartAtMs, endAtMs: analysis.timelineEndAtMs };
}

export function MetricCharts({ analysis }: MetricChartsProps) {
  const [showPartial, setShowPartial] = useState(true);
  const [showFull, setShowFull] = useState(true);
  const xDomain = chartDomain(analysis);

  return (
    <div className="metrics-grid">
      <Panel title="Throughput over time" eyebrow="events finalized per second">
        <LineChart
          series={[{ name: 'Throughput', color: '#34d399', points: analysis.throughputPoints }]}
          xDomain={xDomain}
          valueFormatter={formatRate}
          emptyText="No throughput data"
        />
      </Panel>
      <Panel title="Checkpoint progress" eyebrow="advanced checkpoint vs upper watermark">
        <LineChart
          series={checkpointSeries(analysis)}
          xDomain={xDomain}
          includeZero={false}
          valueFormatter={(value) => formatNumber(value, 0)}
          emptyText="Checkpoint values are not numeric."
        />
      </Panel>
      <Panel title="Blocker delay" eyebrow="checkpoint blocked duration">
        <LineChart
          series={[{ name: 'Blocked duration', color: '#f97316', points: analysis.blockerPoints }]}
          xDomain={xDomain}
          valueFormatter={formatDuration}
          emptyText="No blocker delay data"
        />
      </Panel>
      <Panel title="Backlog buildup" eyebrow="messages waiting behind blockers">
        <LineChart
          series={[{ name: 'Backlog messages', color: '#f472b6', points: analysis.backlogPoints }]}
          xDomain={xDomain}
          valueFormatter={(value) => formatNumber(value, 0)}
          emptyText="No backlog data"
        />
      </Panel>
      <Panel title="Memory profile" eyebrow="managed, working set, GC heap">
        <LineChart
          series={[
            {
              name: 'Managed',
              color: '#60a5fa',
              points: analysis.memoryPoints.map((point) => ({ xMs: point.xMs, xAtMs: point.xAtMs, value: point.managedMiB, label: point.label })),
            },
            {
              name: 'Working set',
              color: '#a78bfa',
              points: analysis.memoryPoints.map((point) => ({ xMs: point.xMs, xAtMs: point.xAtMs, value: point.workingSetMiB, label: point.label })),
            },
            {
              name: 'GC heap',
              color: '#2dd4bf',
              points: analysis.memoryPoints.map((point) => ({ xMs: point.xMs, xAtMs: point.xAtMs, value: point.gcHeapMiB, label: point.label })),
            },
          ]}
          xDomain={xDomain}
          includeZero={false}
          valueFormatter={(value) => formatBytes(value * 1024 * 1024)}
          emptyText="No memory samples"
          showLegend
        />
      </Panel>
      <Panel
        title="Flush volumes"
        eyebrow="documents per completed iteration"
        description="Each column is one completed iteration. The number is documents sent; height is relative volume; P/F badges show whether that iteration produced partial or full flushes."
        actions={
          <div className="toggle-row">
            <label>
              <input type="checkbox" checked={showPartial} onChange={(event) => setShowPartial(event.target.checked)} />
              Partial
            </label>
            <label>
              <input type="checkbox" checked={showFull} onChange={(event) => setShowFull(event.target.checked)} />
              Full
            </label>
          </div>
        }
      >
        <StackedBarChart
          points={analysis.flushPoints.map((point) => ({
            label: point.iterationId,
            xAtMs: point.xAtMs,
            fullFlushes: point.fullFlushes,
            partialFlushes: point.partialFlushes,
            flushDocuments: point.flushDocuments,
          }))}
          showFull={showFull}
          showPartial={showPartial}
        />
      </Panel>
    </div>
  );
}
