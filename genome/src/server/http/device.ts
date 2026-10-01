/**
 * The `orbes_device` cookie (contract §3): a random 128-bit id the server
 * sets on the first verification, used only to count distinct devices in
 * anomaly scoring.
 *
 * - The cookie is httpOnly, SameSite=Lax, two years, Secure and `__Host-`
 *   prefixed (`__Host-orbes_device`, Path=/, no Domain) in production, and
 *   signed with COOKIE_SECRET (only server-issued ids count; a forged or
 *   truncated value is replaced, never trusted).
 * - The id itself is never stored: the database only sees
 *   HMAC(IP_HASH_PEPPER, id) via `pseudonymize`.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { cookieName } from '../services/sessions.js';
import { pseudonymize } from './client.js';

/** Base name; `__Host-orbes_device` in production (deviceCookieName). */
export const DEVICE_COOKIE = 'orbes_device';

export function deviceCookieName(config: Pick<AppConfig, 'env'>): string {
  return cookieName(config, DEVICE_COOKIE);
}
export const DEVICE_ID_BYTES = 16;
export const DEVICE_COOKIE_MAX_AGE_S = 2 * 365 * 24 * 60 * 60;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function deviceCookieOptions(config: Pick<AppConfig, 'env'>) {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_S,
    signed: true,
  };
}

/** The verified device id from the request cookie, or undefined (absent, tampered or malformed). */
export function readDeviceId(request: FastifyRequest, config: Pick<AppConfig, 'env'>): { id: string; renew: boolean } | undefined {
  const raw = request.cookies?.[deviceCookieName(config)];
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return undefined;
  const r = request.unsignCookie(raw);
  if (!r.valid || typeof r.value !== 'string' || !DEVICE_ID_RE.test(r.value)) return undefined;
  return { id: r.value, renew: r.renew };
}

/**
 * Pseudonymous device hash for this request, issuing the cookie when the
 * client has none (or only an invalid one).
 */
export function ensureDevice(request: FastifyRequest, reply: FastifyReply, config: Pick<AppConfig, 'env' | 'ipHashPepper'>): string {
  const existing = readDeviceId(request, config);
  let id: string;
  if (existing) {
    id = existing.id;
    // Re-sign after a COOKIE_SECRET rotation so the old secret can be retired.
    if (existing.renew) reply.setCookie(deviceCookieName(config), id, deviceCookieOptions(config));
  } else {
    id = randomBytes(DEVICE_ID_BYTES).toString('base64url');
    reply.setCookie(deviceCookieName(config), id, deviceCookieOptions(config));
  }
  return pseudonymize(config.ipHashPepper, 'device', id);
}
