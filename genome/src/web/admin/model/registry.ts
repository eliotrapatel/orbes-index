/**
 * Small pure rules for the registry views: anomaly triage moves, the words
 * of a case, key actions, typed confirmation phrases, revocation targets and
 * the audit chain verdict.
 */
import { formatCount, shortHash } from '../format.js';
import type { AnomalyStatus, ChainVerification, KeyJson, ReportChannel, RevocationTargetType } from '../types.js';
import type { Tone } from './tone.js';

// ── Anomalies ──────────────────────────────────────────────────────────────

export interface TriageMove {
  to: AnomalyStatus;
  label: string;
  /** A note is required for closing moves, so a resolution is always explained. */
  noteRequired: boolean;
}

/** Workflow: OPEN → ACKNOWLEDGED → RESOLVED / DISMISSED; closed findings can be reopened. */
export function triageMoves(status: AnomalyStatus): TriageMove[] {
  switch (status) {
    case 'OPEN':
      return [
        { to: 'ACKNOWLEDGED', label: 'Acknowledge', noteRequired: false },
        { to: 'RESOLVED', label: 'Resolve', noteRequired: true },
        { to: 'DISMISSED', label: 'Dismiss', noteRequired: true },
      ];
    case 'ACKNOWLEDGED':
      return [
        { to: 'RESOLVED', label: 'Resolve', noteRequired: true },
        { to: 'DISMISSED', label: 'Dismiss', noteRequired: true },
        { to: 'OPEN', label: 'Reopen', noteRequired: false },
      ];
    case 'RESOLVED':
    case 'DISMISSED':
      return [{ to: 'OPEN', label: 'Reopen', noteRequired: true }];
    default:
      return [];
  }
}

// ── Cases ──────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Readonly<Record<ReportChannel, string>> = Object.freeze({ BOUTIQUE: 'BOUTIQUE', ONLINE: 'ONLINE', PRIVATE: 'PRIVATE SALE', OTHER: 'OTHER' });

/** Where a customer saw or bought the piece, as the verify app asked it (PRIVATE reads PRIVATE SALE). */
export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '—';
  return CHANNEL_LABELS[channel as ReportChannel] ?? channel.replace(/_/g, ' ').toUpperCase();
}

/** `ONLINE · a marketplace listing`: the channel, then the place when the customer gave one. */
export function reportWhere(r: { channel: string; place: string | null }): string {
  return r.place ? `${channelLabel(r.channel)} · ${r.place}` : channelLabel(r.channel);
}

/** The short reference the customer reads under the result (`REF 1F3079F7`): the scan id's first block. */
export function scanReference(scanId: string | null | undefined): string {
  const head = (scanId ?? '').split('-')[0] ?? '';
  return /^[0-9a-f]{8}$/i.test(head) ? head.toUpperCase() : '—';
}

// ── Keys ───────────────────────────────────────────────────────────────────

export interface KeyActions {
  canRetire: boolean;
  canRevoke: boolean;
  /** A revoked key's compromise time can still be moved earlier (never later). */
  canAmend: boolean;
}

/** Only the ACTIVE key retires; ACTIVE and RETIRED keys can be revoked (compromise). */
export function keyActions(k: Pick<KeyJson, 'status'>): KeyActions {
  return { canRetire: k.status === 'ACTIVE', canRevoke: k.status !== 'REVOKED', canAmend: k.status === 'REVOKED' };
}

/** The phrase an admin types to confirm an irreversible action, e.g. `REVOKE KEY 3`. */
export function confirmationPhrase(action: 'revoke-key' | 'revoke-product' | 'revoke-code' | 'retire-key' | 'rotate-key' | 'reset-totp', target: string | number): string {
  switch (action) {
    case 'reset-totp':
      return `RESET 2FA ${target}`;
    case 'revoke-key':
      return `REVOKE KEY ${target}`;
    case 'retire-key':
      return `RETIRE KEY ${target}`;
    case 'rotate-key':
      return 'ROTATE';
    case 'revoke-product':
      return `REVOKE ${target}`;
    case 'revoke-code':
      return `REVOKE ISSUE ${target}`;
  }
}

/** Typed confirmation matches when equal ignoring case and surrounding/multiple spaces. */
export function phraseMatches(typed: string, phrase: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
  return norm(typed) === norm(phrase);
}

/**
 * `datetime-local` value (no zone, read as UTC by the console) → ISO 8601
 * with `Z`, or null when empty/invalid. The compromise time must not be in
 * the future.
 */
export function compromiseTime(local: string, now: Date): { ok: true; iso: string | null } | { ok: false; error: string } {
  const s = (local ?? '').trim();
  if (!s) return { ok: true, iso: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return { ok: false, error: 'Use the date and time picker (UTC).' };
  const d = new Date(`${s.length === 16 ? `${s}:00` : s}Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Not a valid date and time.' };
  if (d.getTime() > now.getTime() + 60_000) return { ok: false, error: 'The compromise time cannot be in the future.' };
  return { ok: true, iso: d.toISOString() };
}

// ── Revocations ────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;

/** Shape check of a revocation target before it is sent (the server dispatches and re-checks). */
export function revocationTargetError(type: RevocationTargetType, id: string): string | null {
  const v = (id ?? '').trim();
  if (!v) return 'Enter the target.';
  switch (type) {
    case 'CODE':
      return UUID_RE.test(v) ? null : 'A code is identified by its UUID.';
    case 'PRODUCT':
      return PRODUCT_RE.test(v) || UUID_RE.test(v) ? null : 'Use the product id, e.g. O26-J-00184.';
    case 'KEY':
      return /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 255 ? null : 'A key id is a number from 1 to 255.';
  }
}

// ── Audit chain ────────────────────────────────────────────────────────────

export interface ChainVerdict {
  title: string;
  detail: string;
  tone: Tone;
}

export function chainVerdict(r: ChainVerification): ChainVerdict {
  if (r.ok) {
    return {
      title: 'Chain intact',
      detail: `${formatCount(r.checked)} entries re-hashed${r.head ? ` · head #${r.head.id} ${shortHash(r.head.hash, 12, 6)}` : ''}`,
      tone: 'solid',
    };
  }
  return {
    title: 'Chain broken',
    detail: `First mismatch at entry #${r.firstBadId ?? '?'} after ${formatCount(r.checked)} verified entries. Preserve the database and escalate.`,
    tone: 'critical',
  };
}
