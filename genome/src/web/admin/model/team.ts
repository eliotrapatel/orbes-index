/**
 * Console users (the Team page, A-02) and the own password change: the state
 * of a row, what an ADMIN may do to it, the password rules checked before the
 * server is asked, and a short label for a session's device. Pure: the views
 * render these, the server stays the authority (403, 409 SELF_ACTION,
 * 409 LAST_ADMIN, the password policy).
 */
import type { AdminUser } from '../types.js';
import type { Tone } from './tone.js';

/** The server's minimum (services/auth.ts PASSWORD_MIN_LENGTH), in code points after NFKC. */
export const PASSWORD_MIN_LENGTH = 12;

export interface AdminState {
  label: string;
  tone: Tone;
}

/** One state per console user, the most pressing first. */
export function adminState(a: Pick<AdminUser, 'disabled' | 'locked' | 'passwordChangeRequired'>): AdminState {
  if (a.disabled) return { label: 'DISABLED', tone: 'muted' };
  if (a.locked) return { label: 'LOCKED', tone: 'alert' };
  if (a.passwordChangeRequired) return { label: 'TEMPORARY PASSWORD', tone: 'outline' };
  return { label: 'ACTIVE', tone: 'solid' };
}

export interface TeamActions {
  role: boolean;
  disable: boolean;
  enable: boolean;
  unlock: boolean;
  sessions: boolean;
  resetTotp: boolean;
}

/**
 * What the Team page offers on a row. Nothing on one's own account but the
 * reset of one's own second factor (the server answers 409 SELF_ACTION);
 * the role choice is OPERATOR or AUDITOR (an ADMIN row can be stepped down,
 * the last active ADMIN excepted: 409 LAST_ADMIN).
 */
export function teamActions(a: Pick<AdminUser, 'id' | 'disabled' | 'locked' | 'totpEnabled'>, selfId: string): TeamActions {
  const other = a.id !== selfId;
  return {
    role: other,
    disable: other && !a.disabled,
    enable: other && a.disabled,
    unlock: other && a.locked && !a.disabled,
    sessions: other && !a.disabled,
    resetTotp: a.totpEnabled,
  };
}

const length = (s: string) => [...s.normalize('NFKC')].length;

/** Why a new password would be refused, or null (the server's policy remains the authority). */
export function newPasswordProblem(current: string, next: string, confirm: string): string | null {
  if (!current) return 'Enter the current password.';
  if (length(next) < PASSWORD_MIN_LENGTH) return 'The new password is too short: twelve characters at least.';
  if (next !== confirm) return 'The two new passwords differ.';
  if (next.normalize('NFKC') === current.normalize('NFKC')) return 'Choose a password different from the current one.';
  return null;
}

/** `Chrome · macOS`-like label for a session's User-Agent; the raw value, cut short, when unrecognised. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua.trim()) return 'Unknown device';
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? ua.slice(0, 60);
}
