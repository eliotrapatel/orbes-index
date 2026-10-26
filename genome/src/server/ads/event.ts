/**
 * One conversion as the ad platforms hear of it (lot M4, K27 §3.1): what is sent, at most. The platforms' bodies
 * (server/ads/meta.ts, tiktok.ts, google.ts) are built from it and nothing else.
 *
 * The event's name, time and id (`orbes-<conversion id>`, so a platform deduplicates a retry), the SHA-256 of the
 * account's email (trimmed, lower case), the SHA-256 of a pseudonymous external id (HMAC-SHA-256 of the account's id under
 * a key derived from COOKIE_SECRET, info ADS_EXTERNAL_ID_INFO; never the account's id itself), the country (hashed where
 * the platform asks), the platform's click id when held, the user agent recorded with the consent, and for a paid order
 * its value and currency. Never a name, a phone, an address, an IP address, a piece, a model, a size or a release.
 */
import { createHash, createHmac } from 'node:crypto';
import { deriveSubkey } from '../crypto/secretbox.js';
import type { AdClickKind, AdEventKind } from '../db/schema.js';

/** A click id the account holds: its kind, the id as the address carried it, and when it was read. */
export interface AdClick {
  kind: AdClickKind;
  id: string;
  at: Date;
}

export interface AdEvent {
  /** `orbes-<conversion id>` (adEventId). */
  id: string;
  kind: AdEventKind;
  /** When the act happened: the conversion's time. */
  at: Date;
  /** SHA-256 (hex) of the account's email, trimmed and in lower case (hashEmail). */
  emailSha256: string;
  /** SHA-256 (hex) of the account's pseudonymous external id (hashedExternalId). */
  externalIdSha256: string;
  /** ISO 3166-1 alpha-2, upper case, when known. */
  country: string | null;
  /** The click ids held for the platform the event goes to (the latest of each kind is used). */
  clicks: readonly AdClick[];
  /** The browser's user agent recorded with the consent. */
  userAgent: string | null;
  /** A paid order's value (the main invoice's total, in minor units) and currency; null for any other act. */
  value: { minor: number; currency: string } | null;
}

/** HKDF info of the external id's key. */
export const ADS_EXTERNAL_ID_INFO = 'orbes/ads-external-id/v1';

/** The event id a platform deduplicates a retry by. */
export function adEventId(conversionId: number): string {
  return `orbes-${conversionId}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of an email as the platforms match it: trimmed, in lower case. */
export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

/** The key of the external ids, derived from COOKIE_SECRET (its own HKDF info, so it opens nothing else). */
export function adsExternalIdKey(cookieSecret: string): Uint8Array {
  return deriveSubkey(cookieSecret, ADS_EXTERNAL_ID_INFO, { salt: 'ORBES' });
}

/** An account's pseudonymous external id: HMAC-SHA-256 of its id (hex), the same on every platform and every event. */
export function adsExternalId(key: Uint8Array, accountId: string): string {
  return createHmac('sha256', key).update(accountId, 'utf8').digest('hex');
}

/** What is sent of the external id: its SHA-256 (hex). */
export function hashedExternalId(key: Uint8Array, accountId: string): string {
  return sha256Hex(adsExternalId(key, accountId));
}

/** The latest click id of these kinds, or null. */
export function latestClick(event: Pick<AdEvent, 'clicks'>, kinds: readonly AdClickKind[]): AdClick | null {
  let best: AdClick | null = null;
  for (const c of event.clicks) if (kinds.includes(c.kind) && (best === null || c.at.getTime() > best.at.getTime())) best = c;
  return best;
}

/** Seconds since the epoch, as Meta and TikTok take an event's time. */
export function unixSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1_000);
}

/** A value in minor units as a decimal number (two decimals, as every house currency). */
export function decimalValue(minor: number): number {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('ads: a value is a whole, non-negative number of minor units');
  return minor / 100;
}

/** The value a paid order carries, and only a paid order: refuses an event whose value does not match its kind. */
export function valueOf(event: Pick<AdEvent, 'kind' | 'value'>): { value: number; currency: string } | null {
  if ((event.kind === 'PAID_ORDER') !== (event.value !== null)) throw new Error('ads: a paid order carries its value, and only a paid order');
  if (event.value === null) return null;
  if (!/^[A-Z]{3}$/.test(event.value.currency)) throw new Error('ads: a currency is three capital letters');
  return { value: decimalValue(event.value.minor), currency: event.value.currency };
}
