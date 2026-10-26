/**
 * The events of test/ads/*.test.ts and their fixtures. The hashes in the fixtures (*.json) were computed apart from the
 * code (Python's hashlib and hmac, HKDF written out), so the bodies are checked against values the code did not make.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adEventId, adsExternalIdKey, hashEmail, hashedExternalId, type AdClick, type AdEvent } from '../../../src/server/ads/event.js';

export const COOKIE_SECRET = 'orbes-ads-test-cookie-secret-0123456789abcdef';
export const ACCOUNT_ID = '00000000-0000-4000-8000-0000000000a1';
export const EMAIL = '  Collector.One@Example.COM ';
export const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
export const SOURCE_URL = 'https://verify.theorbes.com';
/** 2026-10-26 09:30 in Paris (08:30 UTC). */
export const ACT_AT = new Date('2026-10-26T08:30:00.000Z');

/** Every value the platforms may receive of this account, for the "nothing else" checks. */
export const PERSONAL = { accountId: ACCOUNT_ID, email: EMAIL.trim(), emailLower: EMAIL.trim().toLowerCase() };

export function click(kind: AdClick['kind'], id: string, at = '2026-10-20T09:15:00.123Z'): AdClick {
  return { kind, id, at: new Date(at) };
}

/** A paid order of EUR 1 250.50 by an account in France, with the clicks given. */
export function paidOrder(clicks: AdClick[]): AdEvent {
  return {
    id: adEventId(4217),
    kind: 'PAID_ORDER',
    at: ACT_AT,
    emailSha256: hashEmail(EMAIL),
    externalIdSha256: hashedExternalId(adsExternalIdKey(COOKIE_SECRET), ACCOUNT_ID),
    country: 'FR',
    clicks,
    userAgent: USER_AGENT,
    value: { minor: 125_050, currency: 'EUR' },
  };
}

/** A sign-up with nothing but what every event carries. */
export function signup(clicks: AdClick[] = []): AdEvent {
  return { ...paidOrder(clicks), kind: 'SIGNUP', country: null, userAgent: null, value: null };
}

/** A fixture as its file holds it, byte for byte. */
export function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, name), 'utf8');
}

/** A body as the fixture writes it: JSON with two spaces, and a newline. */
export function pretty(body: unknown): string {
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Every key of a JSON value, at any depth (`a.b`, array items as `a[]`). */
export function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, `${prefix}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => {
      const path = prefix === '' ? k : `${prefix}.${k}`;
      return [path, ...keyPaths(v, path)];
    });
  }
  return [];
}
