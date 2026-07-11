export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

/** Compact (e.g. "1.3M", "466.5K") rendering for large quantities, via `Intl.NumberFormat`'s compact notation. */
export function formatCompactNumber(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatRate(value: number): string {
  return `${formatNumber(value, value >= 100 ? 0 : 1)}/s`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (Math.abs(ms) < 1000) return `${formatNumber(ms, 0)} ms`;
  if (Math.abs(ms) < 60_000) return `${formatNumber(ms / 1000, 1)} s`;

  return `${formatNumber(ms / 60_000, 1)} min`;
}

/**
 * Duration formatter that dynamically scales its unit across ms/sec/min/
 * hour/day based on `ms`'s magnitude, unlike `formatDuration`'s three-rung
 * ms/s/min ladder (which never promotes to hours/days and would render a
 * multi-day span as an unreadable number of minutes). Hours and days use 2
 * fraction digits so a value like 1,569.3 minutes reads as "1.09 days"
 * rather than losing precision to a whole-number day count. Used where a
 * duration can plausibly span from sub-second to multi-day, e.g. cursor lag
 * or a poll source's full-run duration.
 */
export function formatDurationDynamic(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${formatNumber(ms, 0)} ms`;
  if (abs < 60_000) return `${formatNumber(ms / 1000, 1)} s`;
  if (abs < 3_600_000) return `${formatNumber(ms / 60_000, 1)} min`;
  if (abs < 86_400_000) return `${formatNumber(ms / 3_600_000, 2)} hours`;

  return `${formatNumber(ms / 86_400_000, 2)} days`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const mib = bytes / 1024 / 1024;
  if (Math.abs(mib) < 1024) return `${formatNumber(mib, 1)} MiB`;

  return `${formatNumber(mib / 1024, 2)} GiB`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';

  return `${value >= 0 ? '+' : ''}${formatNumber(value * 100, 1)}%`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;

  return date.toLocaleString();
}

export function formatAxisDateTime(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '—';

  return new Date(epochMs).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatClockTime(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '—';

  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}
