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
 *  - Its early access (P-X02), by tier (plan NEXT-NINE, BP-19 T3): the hours
 *    before the opening when PALLADIUM, then PLATINE, reserve a place
 *    directly (0 for none; THE PROGRAM's 4 and 2 by default, PLATINE's never
 *    more than PALLADIUM's), said with their times, and the places the draw
 *    will give.
 *  - Its price (plan NOCTURNE, addition 5): optional, typed in units with
 *    its currency; shown on its card and page on /verify, and taken by the
 *    order of each entry Client Services confirms.
 *  - Its sizes (plan NEXT LOT §3.6.F): one field of pieces per offered size
 *    of its model (`size:<label>`, empty is 0, 0 leaves it out), 1 to 24
 *    sizes with pieces and 10 000 pieces in all, the pieces in all said
 *    below, and per size what the stock gives and what will wait for
 *    supplier stock; OFFER NEXT per size; the draw's outcome per size.
 *  - The tiers (P-X04): the words of each tier's benefits, one per line, as
 *    the server holds them (600 characters, 8 lines), what is sent (null to
 *    restore the default words), and an account's tier on its sheet.
 *  - The private salon's requests (P-X08): the status a `?status=` names,
 *    who closes one (OPERATOR, an OPEN one), what the Close dialog's note
 *    must be (required, 2 000 characters), and a request's model line.
 */
import { formatCount, formatDate, formatDateTime } from '../format.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { can } from './permissions.js';
import { ONE_SIZE_LABEL, sizeName } from './sizes.js';
import {
  ORDER_CURRENCIES,
  SHOP_REQUEST_OUTCOMES,
  SHOP_REQUEST_STATUSES,
  type AdminRole,
  type ClubTierSheet,
  type DrawOutcome,
  type DrawSize,
  type DrawSizeInput,
  type Drop,
  type DropChange,
  type DropEntry,
  type DropInput,
  type ModelSizes,
  type OrderCurrency,
  type OwnerSheet,
  type ShopRequest,
  type ShopRequestStatus,
} from '../types.js';

/** The tabs of the Club page, in their order. */
export const CLUB_TABS = [
  { id: 'drops', label: 'Drops' },
  { id: 'circle', label: 'Circle' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'requests', label: 'Requests' },
] as const;
export type ClubTab = (typeof CLUB_TABS)[number]['id'];

/** The tab a `?tab=` names; the first one otherwise. */
export function clubTab(query: Record<string, string>): ClubTab {
  return CLUB_TABS.find((t) => t.id === query.tab)?.id ?? CLUB_TABS[0].id;
}

/** The bounds the server holds a drop to (services/drops.ts; the early access, P-X02, EARLY_ACCESS_HOURS; its sizes, DRAW_SIZES). */
export const DROP_LIMITS = Object.freeze({ title: 120, description: 2000, quantity: 10_000, windowMin: 1, windowMax: 336, windowDefault: 48, earlyMin: 0, earlyMax: 336, note: 500, priceMax: 100_000_000, sizes: 24 });

/** A new draw's early access by default (BP-19 T3): THE PROGRAM's, PALLADIUM's then PLATINE's hours (services/club-program.ts DEFAULT_PROGRAM). */
export interface EarlyAccessDefaults {
  palladium: number;
  platine: number;
}
export const EARLY_ACCESS_DEFAULTS: Readonly<EarlyAccessDefaults> = Object.freeze({ palladium: 4, platine: 2 });

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

/**
 * The dialog's values of a drop: its own, or a new one's (entries open tomorrow at 10:00 UTC for two days, its early
 * access THE PROGRAM's by tier).
 */
export function dropFormValues(d: Drop | null, now: Date, early: EarlyAccessDefaults = EARLY_ACCESS_DEFAULTS): Record<string, string> {
  if (d) {
    return {
      modelId: d.model.id,
      title: d.title,
      description: d.description ?? '',
      opensAt: localUtc(d.opensAt),
      closesAt: localUtc(d.closesAt),
      purchaseWindowHours: String(d.purchaseWindowHours),
      earlyAccessHours: String(d.earlyAccessHours),
      earlyAccessPlatineHours: String(d.earlyAccessPlatineHours),
      price: d.priceMinor === null ? '' : moneyField(d.priceMinor),
      currency: d.currency ?? 'EUR',
    };
  }
  const opens = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 10));
  const closes = new Date(opens.getTime() + 2 * 86_400_000);
  return {
    modelId: '',
    title: '',
    description: '',
    opensAt: localUtc(opens.toISOString()),
    closesAt: localUtc(closes.toISOString()),
    purchaseWindowHours: String(DROP_LIMITS.windowDefault),
    earlyAccessHours: String(early.palladium),
    earlyAccessPlatineHours: String(Math.min(early.platine, early.palladium)),
    price: '',
    currency: 'EUR',
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
  const sizes = drawSizesProblem(v);
  if (sizes) return sizes;
  const opens = utcInstant(v.opensAt);
  const closes = utcInstant(v.closesAt);
  if (!opens || !closes) return 'Use the date and time pickers (UTC) for the opening and the close of entries.';
  if (Date.parse(closes) <= Date.parse(opens)) return 'Entries close after they open.';
  const hours = wholeNumber(v.purchaseWindowHours);
  if (hours === null || hours < DROP_LIMITS.windowMin || hours > DROP_LIMITS.windowMax) return `A place is held ${DROP_LIMITS.windowMin} to ${DROP_LIMITS.windowMax} hours.`;
  const early = wholeNumber(v.earlyAccessHours);
  const platine = wholeNumber(v.earlyAccessPlatineHours);
  for (const hours of [early, platine]) {
    if (hours === null || hours < DROP_LIMITS.earlyMin || hours > DROP_LIMITS.earlyMax) return `An early access lasts ${DROP_LIMITS.earlyMin} to ${DROP_LIMITS.earlyMax} hours (${DROP_LIMITS.earlyMin}: none).`;
  }
  if (platine! > early!) return 'PALLADIUM’s early access starts no later than PLATINE’s.';
  return drawPriceProblem(v);
}

/** NOCTURNE (addition 5): what the server would refuse in a draw's price, or null; an empty price is none. */
export function drawPriceProblem(v: Record<string, string>): string | null {
  const price = (v.price ?? '').trim();
  if (price === '') return null;
  const minor = parseMoney(price);
  if (minor === null || minor < 0 || minor > DROP_LIMITS.priceMax) return 'The price is an amount in units: 4200, or 4200.50.';
  if (!(ORDER_CURRENCIES as readonly string[]).includes(v.currency ?? '')) return `A draw is priced in ${ORDER_CURRENCIES.join(', ')}.`;
  return null;
}

/** A draw's price as the console reads it: `€ 4 200`, or None. */
export function drawPriceText(d: Pick<Drop, 'priceMinor' | 'currency'>): string {
  return d.priceMinor === null || d.currency === null ? 'None' : formatMoney(d.priceMinor, d.currency);
}

/** The body of a new drop (POST /api/admin/drops), from values dropProblem accepted. */
export function dropInput(v: Record<string, string>): DropInput {
  const description = (v.description ?? '').trim();
  return {
    modelId: v.modelId,
    title: v.title.trim(),
    description: description === '' ? null : description,
    sizes: drawSizesInput(v),
    opensAt: utcInstant(v.opensAt)!,
    closesAt: utcInstant(v.closesAt)!,
    purchaseWindowHours: Number(v.purchaseWindowHours),
    earlyAccessHours: Number(v.earlyAccessHours),
    earlyAccessPlatineHours: Number(v.earlyAccessPlatineHours),
    // NOCTURNE (addition 5): the price with its currency, or neither.
    ...((v.price ?? '').trim() === '' ? { priceMinor: null, currency: null } : { priceMinor: parseMoney(v.price)!, currency: v.currency as OrderCurrency }),
  };
}

/** The fields of a DRAFT that differ from the dialog's values (PATCH /api/admin/drops/:id); {} when nothing changed. */
export function dropChange(d: Drop, v: Record<string, string>): DropChange {
  const next = dropInput(v);
  const out: DropChange = {};
  if (next.modelId !== d.model.id) out.modelId = next.modelId;
  if (next.title !== d.title) out.title = next.title;
  if ((next.description ?? null) !== (d.description ?? null)) out.description = next.description ?? null;
  // Plan NEXT LOT §3.6.F: its sizes when they changed, or always for another model (the new model's sizes).
  if (out.modelId !== undefined || !sameDrawSizes(d.sizes, next.sizes)) out.sizes = next.sizes;
  if (Date.parse(next.opensAt) !== Date.parse(d.opensAt)) out.opensAt = next.opensAt;
  if (Date.parse(next.closesAt) !== Date.parse(d.closesAt)) out.closesAt = next.closesAt;
  if (next.purchaseWindowHours !== d.purchaseWindowHours) out.purchaseWindowHours = next.purchaseWindowHours;
  if (next.earlyAccessHours !== d.earlyAccessHours) out.earlyAccessHours = next.earlyAccessHours;
  if (next.earlyAccessPlatineHours !== d.earlyAccessPlatineHours) out.earlyAccessPlatineHours = next.earlyAccessPlatineHours;
  if ((next.priceMinor ?? null) !== d.priceMinor || (next.currency ?? null) !== d.currency) {
    out.priceMinor = next.priceMinor ?? null;
    out.currency = next.currency ?? null;
  }
  return out;
}

// ── A draw's sizes (plan NEXT LOT §3.6.F) ─────────────────────────────────

/** A size's field of pieces in the dialog: `size:<label>`. */
export const SIZE_FIELD = 'size:';
export const sizeField = (label: string): string => `${SIZE_FIELD}${label}`;

/** The line in place of the fields for a model with no offered size: a draw needs them. */
export const NO_DRAW_SIZES = 'No sizes yet: give this model its size type and its sizes in the Catalogue.';
/** The lead of the sizes' fields, and the hint for a model that declares more than a draw takes. */
export const DRAW_SIZES_LEAD = 'The sizes this model declares. Give each size its pieces; 0 leaves it out of the draw.';
export const DRAW_SIZES_HINT = `Up to ${DROP_LIMITS.sizes} sizes with pieces.`;

/**
 * A model's offered sizes, as a draw names them: its declared labels not set aside, ONE SIZE for a size of none. None for
 * a model with no size type, whose SKUs were never declared (§5.1 #20: the server refuses its draw, DROP_MODEL_SIZES_MISSING).
 */
export function offeredLabels(m: Pick<ModelSizes, 'sizes' | 'sizeType'>): string[] {
  if (m.sizeType === null) return [];
  return m.sizes.filter((s) => s.setAsideAt === null).map((s) => s.label ?? ONE_SIZE_LABEL);
}

/** A size's field as the dialog labels it: « Size 52 », « SIZE 52 » as written, « ONE SIZE ». */
export function sizeFieldLabel(label: string): string {
  return label.toUpperCase() === ONE_SIZE_LABEL ? ONE_SIZE_LABEL : sizeName(label);
}

/** A size inside a sentence: « size 52 », « SIZE 52 » as written, « ONE SIZE ». */
export function sizeInSentence(label: string): string {
  const named = sizeFieldLabel(label);
  return named.startsWith('Size ') ? `size ${named.slice(5)}` : named;
}

/** The values of a draw's size fields: a draft's pieces in each size it has (0 for the others), empty for a new release. */
export function drawSizeValues(labels: readonly string[], d: Pick<Drop, 'sizes'> | null): Record<string, string> {
  const pieces = new Map((d?.sizes ?? []).map((s) => [s.label.toUpperCase(), s.pieces]));
  return Object.fromEntries(labels.map((l) => [sizeField(l), d ? String(pieces.get(l.toUpperCase()) ?? 0) : '']));
}

/** The sizes the dialog holds, in their order, each with its pieces (an empty field is 0; null: not a whole number in bounds). */
export function drawSizesOf(v: Record<string, string>): { label: string; pieces: number | null }[] {
  return Object.keys(v)
    .filter((k) => k.startsWith(SIZE_FIELD))
    .map((k) => {
      const raw = (v[k] ?? '').trim();
      const n = raw === '' ? 0 : wholeNumber(raw);
      return { label: k.slice(SIZE_FIELD.length), pieces: n === null || n > DROP_LIMITS.quantity ? null : n };
    });
}

/** What the server would refuse in a draw's sizes, said before anything is sent; null when they hold. */
export function drawSizesProblem(v: Record<string, string>): string | null {
  const sizes = drawSizesOf(v);
  if (sizes.length === 0) return NO_DRAW_SIZES;
  if (sizes.some((s) => s.pieces === null)) return `A size has 0 to ${formatCount(DROP_LIMITS.quantity)} pieces.`;
  const withPieces = sizes.filter((s) => (s.pieces ?? 0) > 0);
  if (withPieces.length < 1 || withPieces.length > DROP_LIMITS.sizes) return `A release has 1 to ${DROP_LIMITS.sizes} sizes with pieces.`;
  if (withPieces.reduce((n, s) => n + (s.pieces ?? 0), 0) > DROP_LIMITS.quantity) return `A release has at most ${formatCount(DROP_LIMITS.quantity)} pieces.`;
  return null;
}

/** The sizes to send (POST, PATCH): those with pieces, in the dialog's order. */
export function drawSizesInput(v: Record<string, string>): DrawSizeInput[] {
  return drawSizesOf(v)
    .filter((s) => (s.pieces ?? 0) > 0)
    .map((s) => ({ label: s.label, pieces: s.pieces! }));
}

/** Whether a draft's sizes are those the dialog gives (labels whatever their case, in order). */
function sameDrawSizes(had: readonly Pick<DrawSize, 'label' | 'pieces'>[], next: readonly DrawSizeInput[]): boolean {
  return had.length === next.length && had.every((s, i) => s.label.toUpperCase() === next[i]!.label.toUpperCase() && s.pieces === next[i]!.pieces);
}

/** The change of a draft's sizes from the Sizes and pieces dialog; null when nothing changed. */
export function drawSizesChange(d: Pick<Drop, 'sizes'>, v: Record<string, string>): DrawSizeInput[] | null {
  const next = drawSizesInput(v);
  return sameDrawSizes(d.sizes, next) ? null : next;
}

/** The pieces the fields give in all: « 12 pieces in all ». */
export function piecesInAll(v: Record<string, string>): string {
  const n = drawSizesOf(v).reduce((m, s) => m + (s.pieces ?? 0), 0);
  return `${formatCount(n)} ${n === 1 ? 'piece' : 'pieces'} in all`;
}

/**
 * Plan NEXT LOT §3.5.4.3, per size: what the stock at the draw's location gives it, and what will wait for supplier
 * stock once sold (« 52: 12 in stock, 13 will wait for supplier stock. »); only the sizes it does not cover.
 */
export function drawStockLines(v: Record<string, string>, available: (label: string) => number): string[] {
  return drawSizesOf(v)
    .filter((s) => (s.pieces ?? 0) > 0)
    .flatMap((s) => {
      const fromStock = Math.min(s.pieces!, Math.max(0, available(s.label)));
      const short = s.pieces! - fromStock;
      return short > 0 ? [`${s.label}: ${formatCount(fromStock)} in stock, ${formatCount(short)} will wait for supplier stock.`] : [];
    });
}

/** The draw's outcome as its toast says it: per size, « 17: 5 selected, 12 on the waiting list. »; overall for a draw without sizes. */
export function drawOutcomeText(r: Pick<DrawOutcome, 'selected' | 'waitlisted' | 'sizes'>): string {
  if (r.sizes.length === 0) return `Drawn: ${formatCount(r.selected)} ${r.selected === 1 ? 'place' : 'places'} held, ${formatCount(r.waitlisted)} on the waiting list.`;
  return `Drawn. ${r.sizes.map((s) => `${s.label}: ${formatCount(s.selected)} selected, ${formatCount(s.waitlisted)} on the waiting list.`).join(' ')}`;
}

/** OFFER NEXT in a size: the draw drawn, a place free in it and someone on its waiting list (OPERATOR). */
export function sizeOfferable(d: Pick<Drop, 'state'>, s: Pick<DrawSize, 'held' | 'pieces' | 'waitlisted'>, role: AdminRole | null | undefined): boolean {
  return can(role, 'manageDrops') && d.state === 'DRAWN' && s.held < s.pieces && s.waitlisted > 0;
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

/**
 * P-X02, by tier (BP-19 T3): the early access as the console says it, `PALLADIUM 4 hours · from 10 OCT 2026 · 06:00 UTC;
 * PLATINE 2 hours · from 08:00 UTC` (PLATINE's day said when it is another), or `None`.
 */
export function earlyAccessLine(d: Pick<Drop, 'earlyAccessHours' | 'earlyAccessOpensAt' | 'earlyAccessPlatineHours' | 'earlyAccessPlatineOpensAt'>): string {
  if (!d.earlyAccessOpensAt || !(d.earlyAccessHours > 0)) return 'None';
  const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
  const palladiumAt = formatDateTime(d.earlyAccessOpensAt);
  const palladium = `PALLADIUM ${hours(d.earlyAccessHours)} · from ${palladiumAt}`;
  if (!d.earlyAccessPlatineOpensAt || !(d.earlyAccessPlatineHours > 0)) return `${palladium}; PLATINE none`;
  const platineAt = formatDateTime(d.earlyAccessPlatineOpensAt);
  const sameDay = platineAt.split(' · ')[0] === palladiumAt.split(' · ')[0];
  return `${palladium}; PLATINE ${hours(d.earlyAccessPlatineHours)} · from ${sameDay ? platineAt.split(' · ').slice(1).join(' · ') : platineAt}`;
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
  /** Places left and someone waiting (a draw without sizes; with sizes, per size: sizeOfferable). */
  offerNext: boolean;
  /** Plan NEXT LOT §3.6.F: its sizes and their pieces, a DRAFT only. */
  sizes: boolean;
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
    offerNext: manage && d.sizes.length === 0 && d.state === 'DRAWN' && placesTaken(d) < d.quantity && (d.entries.WAITLISTED ?? 0) > 0,
    sizes: manage && draft,
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

/** A tier's threshold: `From 1 piece held`, `From 5 pieces held`. */
export function tierThreshold(t: Pick<ClubTierSheet, 'pieces'>): string {
  return `From ${t.pieces} ${t.pieces === 1 ? 'piece' : 'pieces'} held`;
}

/** One line of an owner's Club block (BP-19 T10), and where it leads. */
export interface ClubBlockLine {
  label: string;
  value: string;
  /** The order a gift travels with, or the open yearly care. */
  link: { kind: 'order'; id: string } | { kind: 'care'; id: string } | null;
}

/**
 * An owner's Club block, under the tier line: `Credit PLATINE € 50, € 50 left, until 06 OCT 2027`, `Welcome gift
 * PLATINE: pending` (`with OR-…`, `delivered`), `Yearly care: 2026: 0 of 1` (a link to an open request).
 */
export function clubBlockLines(c: OwnerSheet['club'] | null | undefined): ClubBlockLine[] {
  if (!c) return [];
  const out: ClubBlockLine[] = [];
  for (const g of c.grants) {
    if (g.kind === 'CREDIT' && g.amountMinor !== null && g.currency) {
      out.push({
        label: `Credit ${g.tier}`,
        value: `${formatMoney(g.amountMinor, g.currency)}, ${formatMoney(g.balanceMinor ?? 0, g.currency)} left, until ${formatDate(g.expiresAt)}`,
        link: null,
      });
    }
    if (g.kind === 'GIFT' && g.gift) {
      const state = g.gift.state === 'PENDING' ? 'pending' : g.gift.state === 'DELIVERED' ? 'delivered' : `with ${g.gift.orderReference ?? 'its order'}`;
      out.push({ label: `Welcome gift ${g.tier}`, value: state, link: g.gift.state === 'WITH_ORDER' && g.gift.orderId ? { kind: 'order', id: g.gift.orderId } : null });
    }
  }
  const care = c.careThisYear;
  if (care) {
    // The year in the value: a label is set in the display face, which takes no figure.
    const of = care.allowance === 'ALL' ? `${care.year}: ${care.used} · every piece` : `${care.year}: ${care.used} of ${care.allowance}`;
    out.push({ label: 'Yearly care', value: care.open ? `${of} · open: ${care.open.productId}` : of, link: care.open ? { kind: 'care', id: care.open.id } : null });
  }
  return out;
}

/** An account's tier on its sheet (A-06): `PLATINE · 5 pieces held · 2 years`, or `None · 0 pieces held`. */
export function tierStanding(t: OwnerSheet['tier'] | null | undefined): string {
  if (!t) return '—';
  const pieces = `${t.pieces} ${t.pieces === 1 ? 'piece' : 'pieces'} held`;
  const years = t.seniority > 0 ? ` · ${t.seniority} ${t.seniority === 1 ? 'year' : 'years'}` : '';
  return `${tierName(t.level)} · ${pieces}${years}`;
}

// ── The private salon's requests (P-X08) ───────────────────────────────────

/** The bounds the server holds a request to (services/salon.ts SHOP_NOTE_MAX, SHOP_RESOLUTION_MAX). */
export const SHOP_REQUEST_LIMITS = Object.freeze({ note: 500, resolution: 2000 });

/** The status a `?status=` of the Requests tab names: OPEN, CLOSED, or every request (undefined). */
export function shopRequestStatusOf(query: Record<string, string>): ShopRequestStatus | undefined {
  return (SHOP_REQUEST_STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as ShopRequestStatus) : undefined;
}

/** Whether `role` may close the request now: an OPEN one, by an OPERATOR or an ADMIN. */
export function canCloseRequest(role: AdminRole, r: Pick<ShopRequest, 'status'>): boolean {
  return r.status === 'OPEN' && can(role, 'closeShopRequest');
}

/**
 * What the server would refuse in the Close dialog, said before anything is sent; null when it may be sent. With the
 * outcome (the dialog's choice): ACCEPTED or DECLINED, one of the two.
 */
export function closeRequestProblem(note: string, outcome?: string): string | null {
  const t = note.trim();
  if (t.length === 0) return 'Say in the note what was done for the client.';
  if (t.length > SHOP_REQUEST_LIMITS.resolution) return `The note must be at most ${SHOP_REQUEST_LIMITS.resolution} characters.`;
  if (outcome !== undefined && !(SHOP_REQUEST_OUTCOMES as readonly string[]).includes(outcome)) return 'Say whether the request is accepted or declined.';
  return null;
}

/** The choices of the Close dialog's outcome: ACCEPTED creates the request's order, DECLINED none. */
export const SHOP_REQUEST_OUTCOME_OPTIONS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '', label: 'Choose' },
  { value: 'ACCEPTED', label: 'Accepted: the sale is concluded' },
  { value: 'DECLINED', label: 'Declined: no sale' },
]);

/** Said under a request's model: its type and, when the salon shows one, its price. */
export function requestModelLine(r: Pick<ShopRequest, 'model'>): string {
  return [r.model.type, r.model.priceLabel].filter((x): x is string => typeof x === 'string' && x.trim().length > 0).join(' · ');
}

/** AC-01: the Size cell of a request, the size the client asked, or 'Not given' (not sure yet, or one size). */
export function requestSizeText(r: Pick<ShopRequest, 'size'>): string {
  return r.size ?? 'Not given';
}

/** AC-01: what the Close dialog adds once ACCEPTED is chosen for a request with a size: 'The order takes size 52.'; else null. */
export function acceptedSizeLine(r: Pick<ShopRequest, 'size'>, outcome: string | undefined): string | null {
  return outcome === 'ACCEPTED' && r.size ? `The order takes size ${r.size}.` : null;
}
