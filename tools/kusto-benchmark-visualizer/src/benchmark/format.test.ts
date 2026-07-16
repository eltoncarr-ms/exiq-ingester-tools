import { describe, expect, it } from 'vitest';
import { formatDurationDynamic } from './format';

describe('formatDurationDynamic', () => {
  it('renders sub-second durations in ms', () => {
    expect(formatDurationDynamic(482)).toBe('482 ms');
  });

  it('renders sub-minute durations in seconds with 1 decimal', () => {
    expect(formatDurationDynamic(45_230)).toBe('45.2 s');
  });

  it('renders sub-hour durations in minutes with 1 decimal', () => {
    expect(formatDurationDynamic(5 * 60_000 + 30_000)).toBe('5.5 min');
  });

  it('renders sub-day durations in hours with 2 decimals', () => {
    expect(formatDurationDynamic(5 * 3_600_000 + 30 * 60_000)).toBe('5.50 hours');
  });

  it('promotes multi-day spans to days with 2 decimals, e.g. 1,569.3 minutes reads as about 1.09 days', () => {
    const ms = 1569.3 * 60_000;
    expect(formatDurationDynamic(ms)).toBe('1.09 days');
  });

  it('never renders a multi-day span in minutes (unlike the 3-rung formatDuration ladder)', () => {
    const twoDaysMs = 2 * 86_400_000;
    expect(formatDurationDynamic(twoDaysMs)).toBe('2.00 days');
  });

  it('returns an em dash for a non-finite input', () => {
    expect(formatDurationDynamic(Number.NaN)).toBe('—');
    expect(formatDurationDynamic(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
