/**
 * The Club page of the console (P-R03: its Drops tab) — pure helpers, no DOM.
 *
 *  - The tabs of the page, by `?tab=` (Drops, P-R03; Circle, P-X01; the
 *    tiers and the private salon's requests of the same lot join them).
 *  - A drop's dialog: its fields as the form holds them (the times as
 *    `datetime-local` values read in UTC, as the console says every time),
 *    what the server would refuse before anything is sent, and the change
 *    to send (any field of a DRAFT; the description only once published).
 *  - What may be done now, and by whom: edit, publish, cancel (OPERATOR),
 *    the draw (ADMIN, once its entries are closed), and for an entry
 *    CONFIRMED (its place held) and LAPSED (only once that time has passed),
 *    OFFER NEXT while places are left; the phrases typed before the
 *    irreversible ones (the draw, a cancellation).
 *  - Its early access (P-X02): the hours before the opening when PLATINE
 *    and PALLADIUM reserve a place directly (0 for none, 48 by default),
 *    said with its time, and the places the draw will give.
 *  - The tiers (P-X04): the words of each tier's benefits, one per line, as
 *    the server holds them (600 characters, 8 lines), what is sent (null to
 *    restore the default words), and an account's tier on its sheet.
 */
import { formatDateTime } from '../format.js';
import { can } from './permissions.js';
import type { AdminRole, ClubTierSheet, Drop, DropChange, DropEntry, DropInput, OwnerSheet } from '../types.js';

/** The tabs of the Club page, in their order. */
export const CLUB_TABS = [
  { id: 'drops', label: 'Drops' },
  { id: 'circle', label: 'Circle' },
  { id: 'tiers', label: 'Tiers' },
] as const;
export type ClubTab = (typeof CLUB_TABS)[number]['id'];

/** The tab a `?tab=` names; the first one otherwise. */
export function clubTab(query: Record<string, string>): ClubTab {
  return CLUB_TABS.find((t) => t.id === query.tab)?.id ?? CLUB_TABS[0].id;
}

/** The bounds the server holds a drop to (services/drops.ts; the early access, P-X02, EARLY_ACCESS_HOURS). */
export const DROP_LIMITS = Object.freeze({ title: 120, description: 2000, quantity: 10_000, windowMin: 1, windowMax: 336, windowDefault: 48, earlyMin: 0, earlyMax: 336, earlyDefault: 48, note: 500 });

const pad = (n: number) => String(n).padStart(2, '0');

/** An instant as a `datetime-local` value, in UTC (`2026-10-12T10:00`); '' when absent or invalid. */
export function localUtc(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A `datetime-local` value read in UTC, as ISO 8601 (`…Z`); null when empty or not a date and time. */
export function utcInstant(local: string | null | undefined): string | null {
  const s = (local ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const d = new Date(`${s.length === 16 ? `${s}:00` : s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The dialog's values of a drop: its own, or a new one's (entries open tomorrow at 10:00 UTC for two days). */
export function dropFormValues(d: Drop | null, now: Date): Record<string, string> {
  if (d) {
    return {
      modelId: d.model.id,
      title: d.title,
      description: d.description ?? '',
      quantity: String(d.quantity),
      opensAt: localUtc(d.opensAt),
      closesAt: localUtc(d.closesAt),
      purchaseWindowHours: String(d.purchaseWindowHours),
      earlyAccessHours: String(d.earlyAccessHours),
    };
  }
  const opens = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 10));
  const closes = new Date(opens.getTime() + 2 * 86_400_000);
  return {
    modelId: '',
    title: '',
    description: '',
    quantity: '1',
    opensAt: localUtc(opens.toISOString()),
    closesAt: localUtc(closes.toISOString()),
    purchaseWindowHours: String(DROP_LIMITS.windowDefault),
    earlyAccessHours: String(DROP_LIMITS.earlyDefault),
  };
}

const wholeNumber = (v: string): number | null => (/^\s*\d{1,6}\s*$/.test(v ?? '') ? Number(v) : null);

/** What the server would refuse in the dialog's values, said before anything is sent; null when they hold. */
export function dropProblem(v: Record<string, string>): string | null {
  if (!v.modelId) return 'Choose the model of the release.';
  const title = (v.title ?? '').trim();
  if (!title) return 'Give the release a title.';
  if (title.length > DROP_LIMITS.title) return `A title has at most ${DROP_LIMITS.title} characters.`;
  if ((v.description ?? '').trim().length > DROP_LIMITS.description) return `The description has at most ${DROP_LIMITS.description} characters.`;
  const quantity = wholeNumber(v.quantity);
  if (quantity === null || quantity < 1 || quantity > DROP_LIMITS.quantity) return `A release has 1 to ${DROP_LIMITS.quantity} pieces.`;
  const opens = utcInstant(v.opensAt);
  const closes = utcInstant(v.closesAt);
  if (!opens || !closes) return 'Use the date and time pickers (UTC) for the opening and the close of entries.';
  if (Date.parse(closes) <= Date.parse(opens)) return 'Entries close after they open.';
  const hours = wholeNumber(v.purchaseWindowHours);
  if (hours === null || hours < DROP_LIMITS.windowMin || hours > DROP_LIMITS.windowMax) return `A place is held ${DROP_LIMITS.windowMin} to ${DROP_LIMITS.windowMax} hours.`;
  const early = wholeNumber(v.earlyAccessHours);
  if (early === null || early < DROP_LIMITS.earlyMin || early > DROP_LIMITS.earlyMax) return `The early access lasts ${DROP_LIMITS.earlyMin} to ${DROP_LIMITS.earlyMax} hours (${DROP_LIMITS.earlyMin}: none).`;
  return null;
}

/** The body of a new drop (POST /api/admin/drops), from values dropProblem accepted. */
export function dropInput(v: Record<string, string>): DropInput {
  const description = (v.description ?? '').trim();
  return {
    modelId: v.modelId,
    title: v.title.trim(),
    description: description === '' ? null : description,
    quantity: Number(v.quantity),
    opensAt: utcInstant(v.opensAt)!,
    closesAt: utcInstant(v.closesAt)!,
    purchaseWindowHours: Number(v.purchaseWindowHours),
    earlyAccessHours: Number(v.earlyAccessHours),
  };
}

/** The fields of a DRAFT that differ from the dialog's values (PATCH /api/admin/drops/:id); {} when nothing changed. */
export function dropChange(d: Drop, v: Record<string, string>): DropChange {
  const next = dropInput(v);
  const out: DropChange = {};
  if (next.modelId !== d.model.id) out.modelId = next.modelId;
  if (next.title !== d.title) out.title = next.title;
  if ((next.description ?? null) !== (d.description ?? null)) out.description = next.description ?? null;
  if (next.quantity !== d.quantity) out.quantity = next.quantity;
  if (Date.parse(next.opensAt) !== Date.parse(d.opensAt)) out.opensAt = next.opensAt;
  if (Date.parse(next.closesAt) !== Date.parse(d.closesAt)) out.closesAt = next.closesAt;
  if (next.purchaseWindowHours !== d.purchaseWindowHours) out.purchaseWindowHours = next.purchaseWindowHours;
  if (next.earlyAccessHours !== d.earlyAccessHours) out.earlyAccessHours = next.earlyAccessHours;
  return out;
}

/** The phrase typed before the draw, and before a cancellation: the first eight characters of the drop's id. */
export function dropPhrase(action: 'draw' | 'cancel', d: Pick<Drop, 'id'>): string {
  return `${action === 'draw' ? 'DRAW' : 'CANCEL'} ${d.id.slice(0, 8).toUpperCase()}`;
}

/** The entries of a drop that hold a place or bought one: what OFFER NEXT is measured against. */
export function placesTaken(d: Pick<Drop, 'entries'>): number {
  return (d.entries.SELECTED ?? 0) + (d.entries.CONFIRMED ?? 0);
}

/** P-X02: the places a draw would give now: the pieces less those held or sold (the direct reservations, before it). */
export function placesToDraw(d: Pick<Drop, 'entries' | 'quantity'>): number {
  return Math.max(0, d.quantity - placesTaken(d));
}

/** P-X02: the early access as the console says it: `48 hours · from 10 OCT 2026 · 10:00 UTC`, or `None`. */
export function earlyAccessLine(d: Pick<Drop, 'earlyAccessHours' | 'earlyAccessOpensAt'>): string {
  if (!d.earlyAccessOpensAt || !(d.earlyAccessHours > 0)) return 'None';
  return `${d.earlyAccessHours} ${d.earlyAccessHours === 1 ? 'hour' : 'hours'} · from ${formatDateTime(d.earlyAccessOpensAt)}`;
}

/**
 * P-X02: when the direct reservations of a DRAFT would open if it were published at `now`: at its early access, at
 * once when that has begun, or never when entries are already open or it has none.
 */
export function earlyAccessOnPublish(d: Pick<Drop, 'earlyAccessOpensAt' | 'opensAt'>, now: Date): string {
  const from = d.earlyAccessOpensAt ? Date.parse(d.earlyAccessOpensAt) : Number.NaN;
  if (Number.isNaN(from) || now.getTime() >= Date.parse(d.opensAt)) return 'none';
  return from <= now.getTime() ? 'from its publication' : `from ${formatDateTime(d.earlyAccessOpensAt)}`;
}

export interface DropActions {
  /** Every field: a DRAFT only. */
  edit: boolean;
  /** The description alone: once published. */
  describe: boolean;
  publish: boolean;
  cancel: boolean;
  /** ADMIN, once its entries are closed. */
  draw: boolean;
  /** Places left and someone waiting. */
  offerNext: boolean;
}

/** What `role` may do to the drop now (the server checks again; this only hides what would be refused). */
export function dropActions(d: Drop, role: AdminRole | null | undefined): DropActions {
  const manage = can(role, 'manageDrops');
  const draft = d.state === 'DRAFT';
  return {
    edit: manage && draft,
    describe: manage && d.publishedAt !== null,
    publish: manage && draft,
    cancel: manage && d.state !== 'DRAWN' && d.state !== 'CANCELLED',
    draw: can(role, 'drawDrop') && d.state === 'CLOSED',
    offerNext: manage && d.state === 'DRAWN' && placesTaken(d) < d.quantity && (d.entries.WAITLISTED ?? 0) > 0,
  };
}

/**
 * What `role` may do to an entry now: CONFIRMED while its place is held, never on a cancelled release (the server
 * answers DROP_CANCELLED); LAPSED once that time has passed.
 */
export function entryActions(e: DropEntry, role: AdminRole | null | undefined, now: Date, cancelled = false): { confirm: boolean; lapse: boolean } {
  const manage = can(role, 'manageDrops') && e.status === 'SELECTED';
  const due = e.respondBy !== null && Date.parse(e.respondBy) <= now.getTime();
  return { confirm: manage && !cancelled, lapse: manage && due };
}

/** A tier as the console names it: 0 is none. */
export function tierName(tier: number | null): string {
  return tier === 3 ? 'PALLADIUM' : tier === 2 ? 'PLATINE' : tier === 1 ? 'TITANE' : tier === 0 ? 'None' : '—';
}

/** The window of entries: `12 OCT 2026 · 10:00 UTC → 14 OCT 2026 · 10:00 UTC`. */
export function dropWindow(d: Pick<Drop, 'opensAt' | 'closesAt'>): string {
  return `${formatDateTime(d.opensAt)} → ${formatDateTime(d.closesAt)}`;
}

/** The public page of a published drop on /verify. */
export function releaseAddress(d: Pick<Drop, 'id'>): string {
  return `/verify/releases/${d.id}`;
}

/** One line under the page's title: what the drop's state asks of the staff now. */
export function dropLead(d: Drop): string {
  switch (d.state) {
    case 'DRAFT':
      return 'A draft: nothing of it is public. Edit it freely, then publish it: its page shows the fingerprint of its seed from then on, and only its description changes after.';
    case 'UPCOMING':
      return d.earlyAccessOpensAt
        ? 'Published: its page on /verify announces it. During the early access below, PLATINE and PALLADIUM owners reserve a place directly, first come, first served; entries open to everyone at the time below, for the places left.'
        : 'Published: its page on /verify announces it. Entries open at the time below.';
    case 'OPEN':
      return 'Entries are open: any ORBES account enters from the release’s page.';
    case 'CLOSED':
      return d.reserved > 0
        ? 'Entries are closed. An ADMIN runs the draw, once: tier, seniority, then the seed’s order, for the places the direct reservations leave. Lapse first a reservation whose time has passed unconcluded: its place then goes to the draw.'
        : 'Entries are closed. An ADMIN runs the draw, once: tier, seniority, then the seed’s order.';
    case 'DRAWN':
      return 'Drawn: the places held wait for ORBES Client Services to conclude each sale. A lapse comes only after the time a place is held; then OFFER NEXT gives it to the first of the waiting list.';
    default:
      return 'Cancelled before its draw: entries closed for good, no draw.';
  }
}

// ── The tiers (P-X04) ─────────────────────────────────────────────────────

/** The bounds the server holds a tier's benefits to (services/club.ts CLUB_TIER_BENEFITS_MAX, CLUB_TIER_BENEFIT_LINES). */
export const TIER_LIMITS = Object.freeze({ benefits: 600, lines: 8 });

/** The lines of a tier's benefits, as /verify lists them: one benefit per line, the blank ones dropped. */
export function benefitLines(text: string | null | undefined): string[] {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** What the server would refuse in a tier's benefits, said before anything is sent; null when they hold (blank: the default words). */
export function tierBenefitsProblem(v: Record<string, string>): string | null {
  const lines = benefitLines(v.benefits);
  if (lines.join('\n').length > TIER_LIMITS.benefits) return `The benefits have at most ${TIER_LIMITS.benefits} characters.`;
  if (lines.length > TIER_LIMITS.lines) return `A tier has at most ${TIER_LIMITS.lines} benefits, one per line.`;
  return null;
}

/**
 * The words to send for a tier (PATCH /api/admin/club/tiers/:tier): the lines as typed, or null (the default words)
 * when they are blank or the default ones exactly; undefined when nothing changed.
 */
export function tierBenefitsChange(t: Pick<ClubTierSheet, 'benefits' | 'defaultBenefits' | 'edited'>, v: Record<string, string>): string | null | undefined {
  const typed = benefitLines(v.benefits).join('\n');
  const next = typed === '' || typed === benefitLines(t.defaultBenefits).join('\n') ? null : typed;
  const now = t.edited ? benefitLines(t.benefits).join('\n') : null;
  return next === now ? undefined : next;
}

/** A tier's threshold: `From 1 piece`, `From 3 pieces`. */
export function tierThreshold(t: Pick<ClubTierSheet, 'pieces'>): string {
  return `From ${t.pieces} ${t.pieces === 1 ? 'piece' : 'pieces'} held`;
}

/** An account's tier on its sheet (A-06): `PLATINE · 3 pieces held · 2 years`, or `None · 0 pieces held`. */
export function tierStanding(t: OwnerSheet['tier'] | null | undefined): string {
  if (!t) return '—';
  const pieces = `${t.pieces} ${t.pieces === 1 ? 'piece' : 'pieces'} held`;
  const years = t.seniority > 0 ? ` · ${t.seniority} ${t.seniority === 1 ? 'year' : 'years'}` : '';
  return `${tierName(t.level)} · ${pieces}${years}`;
}
