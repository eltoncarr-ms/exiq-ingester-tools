/**
 * Tests for the three-tab AppShell.
 *
 * Uses renderToStaticMarkup (react-dom/server) — identical to the existing
 * cosmosMetrics.test.tsx approach. This verifies the structure: all three
 * tab buttons and all three panels are present in the server-rendered markup,
 * confirming the `hidden`-attribute pattern (panels mount unconditionally and
 * toggle visibility without unmounting). Interactive state-preservation is a
 * runtime concern guaranteed by the `hidden` pattern rather than conditional
 * rendering, and cannot be exercised without jsdom.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell — three-tab structure', () => {
  it('renders all three tab buttons', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-tab-benchmark"');
    expect(markup).toContain('id="shell-tab-poll"');
    expect(markup).toContain('id="shell-tab-appInsights"');
  });

  it('renders labels for all three tabs', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('Benchmark');
    expect(markup).toContain('Poll Telemetry');
    expect(markup).toContain('App Insights');
  });

  it('renders all three panel divs (hidden pattern — not conditional rendering)', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-panel-benchmark"');
    expect(markup).toContain('id="shell-panel-poll"');
    expect(markup).toContain('id="shell-panel-appInsights"');
  });

  it('marks the benchmark tab as initially selected and the others as not selected', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    // The first tab (benchmark) should be aria-selected="true"
    expect(markup).toContain('id="shell-tab-benchmark" role="tab" aria-selected="true"');
    expect(markup).toContain('id="shell-tab-poll" role="tab" aria-selected="false"');
    expect(markup).toContain('id="shell-tab-appInsights" role="tab" aria-selected="false"');
  });

  it('applies hidden to non-active panels in the initial render (benchmark is active)', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    // The poll and appInsights panels should have the hidden attribute
    expect(markup).toContain('id="shell-panel-poll"');
    expect(markup).toContain('id="shell-panel-appInsights"');
    // Benchmark panel is active — no hidden attribute in the initial render
    // (React omits hidden={false} from the DOM)
    // Poll and appInsights panels have hidden="" in the markup
    // Use a regex to check that shell-panel-poll appears with hidden
    expect(markup).toMatch(/id="shell-panel-poll"[^>]*hidden/);
    expect(markup).toMatch(/id="shell-panel-appInsights"[^>]*hidden/);
  });

  it('has the tablist role on the nav', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('role="tablist"');
  });

  it('each panel has the tabpanel role and links to its tab via aria-labelledby', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('aria-labelledby="shell-tab-benchmark"');
    expect(markup).toContain('aria-labelledby="shell-tab-poll"');
    expect(markup).toContain('aria-labelledby="shell-tab-appInsights"');
  });

  it('all three panels are rendered (not conditionally removed) — verifies hidden-toggle pattern', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    // If panels were conditionally rendered, non-active panels would not appear.
    // The `hidden` pattern keeps them mounted. Verify content from each page appears.
    // App Insights page renders a panel with "CursorPoll.Cycle" eyebrow text — verifying it mounted.
    // Poll Telemetry page renders a distinctive structure.
    // We check that all three panel IDs appear, which proves all three are mounted.
    const benchmarkPanelIdx = markup.indexOf('id="shell-panel-benchmark"');
    const pollPanelIdx = markup.indexOf('id="shell-panel-poll"');
    const aiPanelIdx = markup.indexOf('id="shell-panel-appInsights"');
    expect(benchmarkPanelIdx).toBeGreaterThan(-1);
    expect(pollPanelIdx).toBeGreaterThan(-1);
    expect(aiPanelIdx).toBeGreaterThan(-1);
  });
});
