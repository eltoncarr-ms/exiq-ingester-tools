export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
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
