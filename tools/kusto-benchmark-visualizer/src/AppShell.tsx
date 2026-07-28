import { useRef, useState, type KeyboardEvent } from 'react';
import { App } from './App';
import { AppInsightsPage } from './AppInsightsPage';
import { FocusedDashboardPage } from './FocusedDashboardPage';
import { PollTelemetryPage } from './PollTelemetryPage';

type PageKey = 'benchmark' | 'poll' | 'appInsights' | 'focused';

const PAGES: Array<{ key: PageKey; label: string }> = [
  { key: 'benchmark', label: 'Benchmark' },
  { key: 'poll', label: 'Poll Telemetry' },
  { key: 'appInsights', label: 'App Insights' },
  { key: 'focused', label: 'App Insights – Focused' },
];

const tabId = (key: PageKey) => `shell-tab-${key}`;
const panelId = (key: PageKey) => `shell-panel-${key}`;

/**
 * Dependency-free two-page shell. Both pages stay mounted (toggled with the
 * `hidden` attribute rather than conditional rendering) so switching tabs
 * never resets the benchmark page's loaded runs, live-watch state, or the
 * poll page's live-poll session.
 */
export function AppShell() {
  const [page, setPage] = useState<PageKey>('benchmark');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectPageAt = (index: number) => {
    const target = PAGES[index];
    setPage(target.key);
    tabRefs.current[index]?.focus();
  };

  // Standard ARIA tabs keyboard pattern: arrow keys move focus and selection
  // together (wrapping at the ends), Home/End jump to the first/last tab.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        selectPageAt((index + 1) % PAGES.length);
        break;
      case 'ArrowLeft':
        selectPageAt((index - 1 + PAGES.length) % PAGES.length);
        break;
      case 'Home':
        selectPageAt(0);
        break;
      case 'End':
        selectPageAt(PAGES.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="shell">
      <nav className="shell__tabs" role="tablist" aria-label="Visualizer pages">
        {PAGES.map((candidate, index) => (
          <button
            key={candidate.key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={tabId(candidate.key)}
            role="tab"
            aria-selected={page === candidate.key}
            aria-controls={panelId(candidate.key)}
            tabIndex={page === candidate.key ? 0 : -1}
            className={`shell__tab ${page === candidate.key ? 'is-active' : ''}`}
            type="button"
            onClick={() => setPage(candidate.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div
        id={panelId('benchmark')}
        role="tabpanel"
        aria-labelledby={tabId('benchmark')}
        className="shell__page"
        hidden={page !== 'benchmark'}
      >
        <App />
      </div>
      <div
        id={panelId('poll')}
        role="tabpanel"
        aria-labelledby={tabId('poll')}
        className="shell__page"
        hidden={page !== 'poll'}
      >
        <PollTelemetryPage />
      </div>
      <div
        id={panelId('appInsights')}
        role="tabpanel"
        aria-labelledby={tabId('appInsights')}
        className="shell__page"
        hidden={page !== 'appInsights'}
      >
        <AppInsightsPage />
      </div>
      <div
        id={panelId('focused')}
        role="tabpanel"
        aria-labelledby={tabId('focused')}
        className="shell__page"
        hidden={page !== 'focused'}
      >
        <FocusedDashboardPage />
      </div>
    </div>
  );
}
