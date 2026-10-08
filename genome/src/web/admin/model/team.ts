/**
 * Console users (the Team page, A-02) and the own password change: the state
 * of a row, what an ADMIN may do to it, the password rules checked before the
 * server is asked, and a short label for a session's device. Pure: the views
 * render these, the server stays the authority (403, 409 SELF_ACTION,
 * 409 LAST_ADMIN, the password policy).
 */
import type { AdminRole, AdminUser, StockLocation } from '../types.js';
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
 * the role choice is OPERATOR, AUDITOR, RETAIL or LOGISTICS (an ADMIN row can be stepped down,
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

/**
 * The role field's hint on the Team page (plan NEXT LOT §3.5.4.5): what each role the console gives does.
 */
export const ROLE_HINT =
  'OPERATOR issues and maintains pieces; AUDITOR reads; RETAIL, a seller, gets the sale mode only; LOGISTICS, a person at the logistics agent, gets the stock, the receptions and the orders to ship of its locations.';

/** The server's refusal of a LOGISTICS login without a location (services/auth.ts LOGISTICS_LOCATIONS_REQUIRED). */
export const LOCATIONS_REQUIRED = 'Choose at least one location.';

/**
 * The locations ticked when a Team dialog opens (plan NEXT LOT §3.5.4.5): a LOGISTICS login's own; otherwise the single
 * location when there is only one, none when there are several.
 */
export function initialLocations(a: Pick<AdminUser, 'role' | 'stockLocationIds'> | null, locations: readonly Pick<StockLocation, 'id'>[]): string[] {
  if (a && a.role === 'LOGISTICS' && a.stockLocationIds.length > 0) return [...a.stockLocationIds];
  return locations.length === 1 ? [locations[0].id] : [];
}

/** Why a Team dialog's role and locations would be refused, or null: LOGISTICS needs at least one location. */
export function locationsProblem(role: AdminRole | string, ticked: readonly string[]): string | null {
  return role === 'LOGISTICS' && ticked.length === 0 ? LOCATIONS_REQUIRED : null;
}

/** A LOGISTICS login's locations by name, in the console's order of the locations (`LOGISTICS WAREHOUSE · PARIS STOCK`); '' for any other role. */
export function locationNames(a: Pick<AdminUser, 'role' | 'stockLocationIds'>, locations: readonly Pick<StockLocation, 'id' | 'name'>[]): string {
  if (a.role !== 'LOGISTICS') return '';
  return locations
    .filter((l) => a.stockLocationIds.includes(l.id))
    .map((l) => l.name)
    .join(' · ');
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
