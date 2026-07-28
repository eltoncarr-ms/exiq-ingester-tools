/**
 * Tests for the four-tab AppShell.
 *
 * Uses renderToStaticMarkup (react-dom/server) — identical to the existing
 * cosmosMetrics.test.tsx approach. This verifies the structure: all four
 * tab buttons and all four panels are present in the server-rendered markup,
 * confirming the `hidden`-attribute pattern (panels mount unconditionally and
 * toggle visibility without unmounting). Interactive state-preservation is a
 * runtime concern guaranteed by the `hidden` pattern rather than conditional
 * rendering, and cannot be exercised without jsdom.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell — four-tab structure', () => {
  it('renders all four tab buttons', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-tab-benchmark"');
    expect(markup).toContain('id="shell-tab-poll"');
    expect(markup).toContain('id="shell-tab-appInsights"');
    expect(markup).toContain('id="shell-tab-focused"');
  });

  it('renders labels for all four tabs', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('Benchmark');
    expect(markup).toContain('Poll Telemetry');
    expect(markup).toContain('App Insights');
    expect(markup).toContain('App Insights – Focused');
  });

  it('renders all four panel divs (hidden pattern — not conditional rendering)', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-panel-benchmark"');
    expect(markup).toContain('id="shell-panel-poll"');
    expect(markup).toContain('id="shell-panel-appInsights"');
    expect(markup).toContain('id="shell-panel-focused"');
  });

  it('marks the benchmark tab as initially selected and the others as not selected', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-tab-benchmark" role="tab" aria-selected="true"');
    expect(markup).toContain('id="shell-tab-poll" role="tab" aria-selected="false"');
    expect(markup).toContain('id="shell-tab-appInsights" role="tab" aria-selected="false"');
    expect(markup).toContain('id="shell-tab-focused" role="tab" aria-selected="false"');
  });

  it('applies hidden to non-active panels in the initial render (benchmark is active)', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    expect(markup).toContain('id="shell-panel-poll"');
    expect(markup).toContain('id="shell-panel-appInsights"');
    expect(markup).toContain('id="shell-panel-focused"');
    expect(markup).toMatch(/id="shell-panel-poll"[^>]*hidden/);
    expect(markup).toMatch(/id="shell-panel-appInsights"[^>]*hidden/);
    expect(markup).toMatch(/id="shell-panel-focused"[^>]*hidden/);
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
    expect(markup).toContain('aria-labelledby="shell-tab-focused"');
  });

  it('all four panels are rendered (not conditionally removed) — verifies hidden-toggle pattern', () => {
    const markup = renderToStaticMarkup(<AppShell />);
    const benchmarkPanelIdx = markup.indexOf('id="shell-panel-benchmark"');
    const pollPanelIdx = markup.indexOf('id="shell-panel-poll"');
    const aiPanelIdx = markup.indexOf('id="shell-panel-appInsights"');
    const focusedPanelIdx = markup.indexOf('id="shell-panel-focused"');
    expect(benchmarkPanelIdx).toBeGreaterThan(-1);
    expect(pollPanelIdx).toBeGreaterThan(-1);
    expect(aiPanelIdx).toBeGreaterThan(-1);
    expect(focusedPanelIdx).toBeGreaterThan(-1);
  });
});
