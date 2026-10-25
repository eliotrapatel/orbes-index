/**
 * A friend's invitation (lot Q3, step Q3.11; plan §3.10, N10): /verify/join/<code> keeps the code in this tab
 * (sessionStorage `orbes.invite`), and CREATE ACCOUNT sends it as `invite` (api.ts register), then forgets it. A code the
 * server does not know is ignored there, never refused (Q3.6). Nothing else is kept: no giver, no account. Storage that
 * cannot be reached (a private window, blocked site data) keeps it in memory for this page only.
 */

const KEY = 'orbes.invite';
/** The personal invitation's code: 12 Crockford characters, with or without its dashes (XXXX-XXXX-XXXX). */
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}$/i;

let memory: string | null = null;

function store(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Whether `code` reads as an invitation's (or a credit to give's) code. */
export function isVaultCode(code: string): boolean {
  return CODE.test(code);
}

/** The code of /verify/join/<code> kept for CREATE ACCOUNT. */
export function keepInvite(code: string): void {
  if (!isVaultCode(code)) return;
  memory = code.toUpperCase();
  try {
    store()?.setItem(KEY, memory);
  } catch {
    // Kept in memory only.
  }
}

/** The kept code, or null. */
export function keptInvite(): string | null {
  try {
    const v = store()?.getItem(KEY) ?? null;
    if (v && isVaultCode(v)) return v;
  } catch {
    // Read from memory.
  }
  return memory;
}

/** Forgotten once an account is created with it. */
export function forgetInvite(): void {
  memory = null;
  try {
    store()?.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
