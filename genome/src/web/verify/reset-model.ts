/**
 * The emails' pages of the collector app (macro scope E1–E3; lot M1 plan §4.4, step M1.19), their pure part (tested in
 * test/web/verify.emails.test.ts):
 *
 *   /verify/reset#<email>/<XXXX-XXXX-XXXX>   RESET BY EMAIL's link (services/account-recovery.ts resetLink): the
 *                                           account's address (URI-encoded) and its recovery code, in the fragment, so
 *                                           that no request line, log or referrer ever holds them. The page reads them,
 *                                           then takes them out of the address bar (views/reset.ts).
 *   /verify/unsubscribe#<token>             an email's STOP THESE EMAILS (services/email.ts unsubscribeLinks): the HMAC
 *                                           token the server signed, in the fragment too.
 *
 * And whether RESET BY EMAIL is offered now (GET /api/v1/account/reset), read once a page load for every sign-in of the
 * app (`resetOffered`): a sign-in's FORGOTTEN PASSWORD? shows it only then, and stays ORBES Client Services' alone
 * otherwise, as before.
 */
import type { ApiClient } from './api.js';
import { normalizeCodeInput } from './view-model.js';

export const RESET_PATH = '/verify/reset';
export const UNSUBSCRIBE_PATH = '/verify/unsubscribe';

const pathOf = (path: string) => path.replace(/\/+$/, '').toLowerCase();

export function isResetPath(path: string): boolean {
  return pathOf(path) === RESET_PATH;
}

export function isUnsubscribePath(path: string): boolean {
  return pathOf(path) === UNSUBSCRIBE_PATH;
}

/** What a reset link carries: the account's email and its recovery code, grouped XXXX-XXXX-XXXX. */
export interface ResetLink {
  email: string;
  code: string;
}

/** An email the link may carry (the server's own check is the one that counts): one @, no space, at most 254. */
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+$/;

/**
 * The email and code of a reset link's fragment (`#<email>/<code>`), or null when it does not hold both: the code's 12
 * characters (Crockford's, any case, with or without its dashes), the email URI-decoded.
 */
export function resetLinkOf(hash: string): ResetLink | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const slash = raw.lastIndexOf('/');
  if (slash <= 0) return null;
  let email: string;
  try {
    email = decodeURIComponent(raw.slice(0, slash)).trim();
  } catch {
    return null;
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const tail = raw.slice(slash + 1);
  if (!/^[0-9A-Za-z-]+$/.test(tail) || tail.replace(/-/g, '').length !== 12) return null;
  const code = normalizeCodeInput(tail);
  return { email, code };
}

/** The token of an unsubscribe link's fragment, or null when it holds none (the server reads what it is). */
export function unsubscribeTokenOf(hash: string): string | null {
  const raw = (hash.startsWith('#') ? hash.slice(1) : hash).trim();
  return raw.length > 0 && raw.length <= 120 && /^[A-Za-z0-9._~-]+$/.test(raw) ? raw : null;
}

/** RESET BY EMAIL offered or not, read once a page load (a read that failed is tried again by the next sign-in). */
const offers = new WeakMap<object, Promise<boolean>>();

/**
 * Whether RESET BY EMAIL is offered now, read once for the page: off when it cannot be read, so FORGOTTEN PASSWORD? is
 * then ORBES Client Services' alone, as it always was.
 */
export function resetOffered(api: Pick<ApiClient, 'resetOffered'>): Promise<boolean> {
  let p = offers.get(api);
  if (!p) {
    p = api.resetOffered().catch(() => {
      offers.delete(api);
      return false;
    });
    offers.set(api, p);
  }
  return p;
}

/** The answer already read, if it is: true, false, or undefined while unread (no read is started). */
const known = new WeakMap<object, boolean>();

/** `resetOffered`, and the answer kept as it arrives (for a panel that draws before and after it). */
export function readResetOffer(api: Pick<ApiClient, 'resetOffered'>): Promise<boolean> {
  return resetOffered(api).then((on) => {
    known.set(api, on);
    return on;
  });
}

/** The answer of `readResetOffer` if it has arrived; undefined otherwise. */
export function resetOfferKnown(api: Pick<ApiClient, 'resetOffered'>): boolean | undefined {
  return known.get(api);
}
