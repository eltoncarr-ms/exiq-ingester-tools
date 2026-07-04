import type { RawRecord } from '../loader/raw';

export interface BladeRef {
  id?: string;
  instanceId?: string;
}

/**
 * Lazily parses the payload.context field, which is a JSON *string* (not an object). Returns the
 * embedded Blade reference when present. Never throws: malformed or missing context yields {}.
 */
export function parseBladeRef(payload: Record<string, unknown> | null | undefined): BladeRef {
  const raw = payload?.['context'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { Blade?: { id?: string; instanceId?: string } };
    const blade = parsed?.Blade;
    if (!blade) {
      return {};
    }
    return { id: blade.id, instanceId: blade.instanceId };
  } catch {
    return {};
  }
}

/**
 * Derives a short human label for a message. record.eventType is frequently null, so the action /
 * actionModifier pair in the payload is the real discriminator. Falls back to eventType, then a
 * placeholder for unmapped rows.
 */
export function messageLabel(record: RawRecord | null | undefined): string {
  if (!record) {
    return '(unmapped)';
  }
  const payload = record.payload ?? undefined;
  const action = typeof payload?.['action'] === 'string' ? (payload['action'] as string) : undefined;
  const modifier =
    typeof payload?.['actionModifier'] === 'string' ? (payload['actionModifier'] as string) : undefined;
  if (action) {
    return modifier ? `${action}/${modifier}` : action;
  }
  if (record.eventType) {
    return record.eventType;
  }
  return '(unmapped)';
}
