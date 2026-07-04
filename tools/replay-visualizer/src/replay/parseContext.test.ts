import { describe, expect, it } from 'vitest';
import type { RawRecord } from '../loader/raw';
import { messageLabel, parseBladeRef } from './parseContext';

describe('parseBladeRef', () => {
  it('extracts blade id/instanceId from the JSON-string payload.context', () => {
    const payload = {
      context: JSON.stringify({ Blade: { id: 'PortalBlade', instanceId: 'Blade_s_11' } }),
    };
    expect(parseBladeRef(payload)).toEqual({ id: 'PortalBlade', instanceId: 'Blade_s_11' });
  });

  it('returns {} (never throws) for missing, empty, malformed, or blade-less context', () => {
    expect(parseBladeRef(undefined)).toEqual({});
    expect(parseBladeRef(null)).toEqual({});
    expect(parseBladeRef({})).toEqual({});
    expect(parseBladeRef({ context: '' })).toEqual({});
    expect(parseBladeRef({ context: '{ not json' })).toEqual({});
    expect(parseBladeRef({ context: JSON.stringify({ Other: 1 }) })).toEqual({});
  });

  it('returns {} when context is present but not a string', () => {
    expect(parseBladeRef({ context: { Blade: { id: 'x' } } })).toEqual({});
  });
});

describe('messageLabel', () => {
  const record = (r: Partial<RawRecord>): RawRecord => r;

  it('prefers action/actionModifier over eventType (action is the real discriminator)', () => {
    expect(
      messageLabel(
        record({ eventType: 'BladeInteraction', payload: { action: 'BladeFullReady', actionModifier: 'open' } }),
      ),
    ).toBe('BladeFullReady/open');
  });

  it('uses action alone when no modifier', () => {
    expect(messageLabel(record({ eventType: null, payload: { action: 'Click' } }))).toBe('Click');
  });

  it('falls back to eventType when no action is present', () => {
    expect(messageLabel(record({ eventType: 'BladeInteraction', payload: {} }))).toBe('BladeInteraction');
  });

  it('falls back to (unmapped) when the record is null or carries nothing identifying', () => {
    expect(messageLabel(null)).toBe('(unmapped)');
    expect(messageLabel(undefined)).toBe('(unmapped)');
    expect(messageLabel(record({ eventType: null, payload: {} }))).toBe('(unmapped)');
  });
});
