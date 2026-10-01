/**
 * Client metadata derived from a request, in privacy-preserving form.
 *
 * Raw IP addresses and device ids are never stored or logged: everything
 * that leaves this module is a peppered HMAC (`pseudonymize`), a coarse user
 * agent family or a clipped user-agent string. The pepper is
 * `config.ipHashPepper`; each kind of value has its own domain label so an IP
 * hash can never collide with (or be replayed as) a device hash.
 */
import { createHmac } from 'node:crypto';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

export type PseudonymDomain = 'ip' | 'device' | 'session';

/** HMAC-SHA256(pepper, domain ‖ value), base64url (43 chars). */
export function pseudonymize(pepper: string, domain: PseudonymDomain, value: string): string {
  return createHmac('sha256', pepper).update(`orbes/${domain}/v1\u0000${value}`, 'utf8').digest('base64url');
}

/**
 * Canonical form of the client IP before hashing: lower case, IPv4-mapped
 * IPv6 unwrapped. IPv6 is NOT truncated here (rate limiting groups /64s on
 * its own), so the stored hash keeps per-address granularity.
 */
export function canonicalIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  try {
    return normalizeIP(ip, 128);
  } catch {
    return ip.toLowerCase();
  }
}

/** Peppered hash of the request's client IP (honours TRUST_PROXY through `request.ip`). */
export function ipHashOf(pepper: string, request: Pick<FastifyRequest, 'ip'>): string {
  return pseudonymize(pepper, 'ip', canonicalIp(request.ip));
}

/** Rate-limit key: hashed, IPv6 grouped by /64 so one host cannot rotate through its own subnet. */
export function rateLimitKeyOf(pepper: string, request: Pick<FastifyRequest, 'ip'>): string {
  let ip: string;
  try {
    ip = normalizeIP(request.ip ?? 'unknown', 64);
  } catch {
    ip = String(request.ip ?? 'unknown').toLowerCase();
  }
  return pseudonymize(pepper, 'ip', `rl:${ip}`);
}

const MAX_USER_AGENT = 256;

/** User-Agent header without control characters, bounded (stored with sessions for "signed-in devices"). */
export function userAgentOf(request: Pick<FastifyRequest, 'headers'>): string | null {
  const ua = request.headers['user-agent'];
  if (typeof ua !== 'string') return null;
  const s = ua.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s === '' ? null : s.slice(0, MAX_USER_AGENT);
}

/**
 * Coarse browser/OS family such as `Safari/iOS` or `Chrome/Android`. Versions
 * are dropped on purpose: the family is enough for anomaly diversity counts
 * and is far less identifying than a full user-agent string.
 */
export function userAgentFamily(ua: string | null | undefined): string | undefined {
  if (typeof ua !== 'string' || ua.trim() === '') return undefined;
  const s = ua.slice(0, 512);
  let browser = 'Other';
  if (/bot|crawler|spider|slurp|curl\/|wget\/|python|httpclient|okhttp|node-fetch|undici|axios|go-http/i.test(s)) browser = 'Bot';
  else if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung';
  else if (/CriOS\/|Chrome\/|Chromium\//.test(s)) browser = 'Chrome';
  else if (/FxiOS\/|Firefox\//.test(s)) browser = 'Firefox';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';
  else if (/AppleWebKit\//.test(s) && /Mobile\//.test(s)) browser = 'WebView';

  let os = 'Other';
  if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  return `${browser}/${os}`;
}
