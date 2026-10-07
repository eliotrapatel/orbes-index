/**
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE of 2026-10-06, §3.3 IN-01; migration 0029; API §16.30, DATABASE §5.69 and
 * §5.70): a place granted by ORBES Client Services to one collector at a coming release. Personal, used once, never
 * transferred, never sold, and always within the release's fixed quantity.
 *
 *   what it covers  a chosen release (RELEASE: exactly that one; not cancelled nor over, not an after-room, opening by
 *                   the validity date), the next release of a model (MODEL: the model, and its variants when it is a main
 *                   model; a variant covers itself) or of a collection (COLLECTION: any model of it). After-rooms are
 *                   never covered.
 *   set aside       `covered_drop_id`: the release it is kept for. A chosen release's at the grant; the next release's at
 *                   the grant when one is published (`coverNextRelease`: the first eligible published release that opens
 *                   by `valid_until` and still has room), otherwise at the next publication of a release in its scope
 *                   (`coverOnPublish`, called by DropService.publish and LiveConsoleService.publish: the waiting
 *                   guarantees in grant order while they fit). Room: the pieces held, plus those guaranteed, plus these,
 *                   within the quantity (a draw) or the stock of every size (a LIVE RELEASE). Once set aside, a guarantee
 *                   never switches release.
 *   used            in a draw, at the draw (selected first) or at a direct reservation during its holder's early access;
 *                   in a LIVE RELEASE, when its holder's turn is given (`useGuarantees`). A lapsed place, a missed turn or
 *                   an expired hold never gives it back; leaving or withdrawing before use leaves it ACTIVE.
 *   carried         at a release's draw, end or cancellation, a guarantee set aside for it and not used (`releaseCovered`):
 *                   a model's or a collection's goes to the following release while still valid (`guarantee.carry`), a
 *                   chosen release's expires with it (`guarantee.expire`).
 *   its state       computed, never stored (`guaranteeState`): USED, REVOKED and EXPIRED as stored; ACTIVE and bound to
 *                   an entry ENTERED; ACTIVE and set aside for a release opening by `valid_until` SET_ASIDE; ACTIVE past
 *                   `valid_until` and not so set aside EXPIRED; otherwise WAITING. No scheduled job is needed.
 *
 * The console (OPERATOR: grant, change, revoke; ADMIN: the defaults of Orders → Settings, House guarantee; AUDITOR reads,
 * the clients' emails masked) and the collector (only what is shown: `visible`). A guarantee not shown leaves no mark for
 * its holder anywhere in the app; the copy of their data (the right of access) still includes it, with its note. The note
 * is never in the audit log: `guarantee.grant`, `.update`, `.revoke`, `.cover`, `.carry`, `.expire`, `.use` and
 * `.settings` name ids, pieces, dates and whether a note was given.
 *
 * Lock order: the account FOR SHARE, the release FOR UPDATE, its entry, then the guarantee (a grant inserts it last).
 * A change or a revocation reads the guarantee, locks its release, then locks the guarantee and checks it is still set
 * aside there.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { DropMode, DropRow, GuaranteeClosedReason, GuaranteeScope, GuaranteeStatus, HouseGuaranteeRow } from '../db/schema.js';
import { GUARANTEE_SCOPES } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The pieces a guarantee covers: 1 to 5, 1 by default (the settings'). */
export const GUARANTEE_PIECES = Object.freeze({ min: 1, max: 5, default: 1 });
/** How long a guarantee is valid by default, in days from the grant: 1 to 730, 90 by default (the settings'). */
export const GUARANTEE_VALID_DAYS = Object.freeze({ min: 1, max: 730, default: 90 });
/** A note for Client Services, or a revocation's: 1 to 500 characters. */
export const GUARANTEE_NOTE_MAX = 500;

/** A guarantee's state as the console and the app read it (computed, never stored). */
export const GUARANTEE_STATES = ['WAITING', 'SET_ASIDE', 'ENTERED', 'USED', 'EXPIRED', 'REVOKED'] as const;
export type GuaranteeState = (typeof GUARANTEE_STATES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PARIS = 'Europe/Paris';
const DAY_MS = 86_400_000;

/** The entries of a LIVE RELEASE that hold pieces of their size (live.ts LIVE_HOLDING_STATUSES; kept here so this module reads no release service). */
const LIVE_HOLDING = ['TURN', 'SECURED', 'CONFIRMED'] as const;
/** A LIVE entry still waiting for its turn: what a guarantee binds to. */
const LIVE_WAITING = ['WAITING', 'QUEUED'] as const;

// ── Errors ─────────────────────────────────────────────────────────────────

export const guaranteeNotFound = () => notFound('Guarantee', 'GUARANTEE_NOT_FOUND');
const releaseOver = () => conflict('GUARANTEE_RELEASE_OVER', 'This release is over or cancelled: it cannot be guaranteed.');
const releaseOpensLate = () => conflict('GUARANTEE_RELEASE_OPENS_LATE', 'This release opens after the guarantee’s validity: choose a later date.');
const releaseClosed = (afterRoom: boolean) =>
  conflict('GUARANTEE_RELEASE_CLOSED', afterRoom ? 'An after-room is never covered by a guarantee.' : 'Entries to this release are closed: it cannot be guaranteed.');
const exceedsRelease = (quantity: number, taken: number) =>
  conflict('GUARANTEE_EXCEEDS_RELEASE', `This release has ${quantity} ${quantity === 1 ? 'piece' : 'pieces'}; ${taken} ${taken === 1 ? 'is' : 'are'} already held or guaranteed.`);
const already = () => conflict('GUARANTEE_ALREADY', 'This client already holds a guarantee or a place in this release.');
const inUse = () => conflict('GUARANTEE_IN_USE', 'The client has entered with this guarantee: its pieces no longer change.');
const used = () => conflict('GUARANTEE_USED', 'This guarantee has been used.');
const notActive = () => conflict('GUARANTEE_CLOSED', 'This guarantee is no longer active.');
const accountNotActive = () => conflict('ACCOUNT_NOT_ACTIVE', 'Only an active account can be granted a guarantee.');

function assertStaff(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
  return actor.id.toLowerCase();
}

function knownId(id: unknown, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── Dates (Paris) ──────────────────────────────────────────────────────────

const parisParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Paris's offset from UTC at `at`, in milliseconds. */
function parisOffsetMs(at: Date): number {
  const p = Object.fromEntries(parisParts.formatToParts(at).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The first instant of a calendar day in Paris. */
function startOfParisDay(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - parisOffsetMs(new Date(guess));
  return new Date(guess - parisOffsetMs(new Date(first)));
}

/** A calendar day `YYYY-MM-DD` in Paris, as its last instant: what « valid until » means (the end of that day, Paris). */
export function endOfParisDay(day: string): Date {
  const m = DATE_RE.exec(day);
  if (!m) throw validationError('A date is YYYY-MM-DD.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw validationError('A date is YYYY-MM-DD.');
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return new Date(startOfParisDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime() - 1);
}

/** The calendar day of `at` in Paris, `YYYY-MM-DD`. */
export function parisDay(at: Date): string {
  const p = Object.fromEntries(parisParts.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The Paris day `days` after the Paris day of `at`, `YYYY-MM-DD` (the Grant dialog's default validity). */
export function parisDayPlus(at: Date, days: number): string {
  const [y, m, d] = parisDay(at).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ── State ──────────────────────────────────────────────────────────────────

/**
 * A guarantee's state (see the file header): `coveredOpensAt` the opening of the release it is set aside for (null when
 * none), `bound` whether an entry of that release uses it now.
 */
export function guaranteeState(
  g: Pick<HouseGuaranteeRow, 'status' | 'valid_until' | 'covered_drop_id'>,
  coveredOpensAt: Date | null,
  bound: boolean,
  now: Date,
): GuaranteeState {
  if (g.status !== 'ACTIVE') return g.status;
  if (bound) return 'ENTERED';
  const validUntil = new Date(g.valid_until).getTime();
  if (g.covered_drop_id && coveredOpensAt && new Date(coveredOpensAt).getTime() <= validUntil) return 'SET_ASIDE';
  if (now.getTime() > validUntil) return 'EXPIRED';
  return 'WAITING';
}

// ── Releases ───────────────────────────────────────────────────────────────

type ReleaseRow = Pick<
  DropRow,
  'id' | 'mode' | 'title' | 'model_id' | 'quantity' | 'opens_at' | 'closes_at' | 'published_at' | 'cancelled_at' | 'drawn_at' | 'ended_at' | 'parent_drop_id' | 'name_at' | 'announce_at'
>;

const RELEASE_COLUMNS = [
  'id', 'mode', 'title', 'model_id', 'quantity', 'opens_at', 'closes_at', 'published_at', 'cancelled_at', 'drawn_at', 'ended_at', 'parent_drop_id', 'name_at', 'announce_at',
] as const;

/** Whether a release may still be covered at `now`: not cancelled, not over, entries not closed, not an after-room. */
function coverable(d: ReleaseRow, now: Date): boolean {
  if (d.cancelled_at || d.parent_drop_id) return false;
  if (d.mode === 'DRAW' ? d.drawn_at !== null : d.ended_at !== null) return false;
  return now.getTime() < new Date(d.closes_at).getTime();
}

/** Why a chosen release cannot be guaranteed, or null. */
function releaseRefusal(d: ReleaseRow, validUntil: Date, now: Date): DomainError | null {
  if (d.parent_drop_id) return releaseClosed(true);
  if (d.cancelled_at || (d.mode === 'DRAW' ? d.drawn_at !== null : d.ended_at !== null)) return releaseOver();
  if (now.getTime() >= new Date(d.closes_at).getTime()) return releaseClosed(false);
  if (new Date(d.opens_at).getTime() > validUntil.getTime()) return releaseOpensLate();
  return null;
}

/** What a release holds: its capacity (a draw's quantity, a LIVE RELEASE's stock of every size) and the pieces held or guaranteed. */
export async function releaseRoom(db: Db, d: Pick<DropRow, 'id' | 'mode' | 'quantity'>, opts: { exceptGuaranteeId?: string } = {}): Promise<{ capacity: number; taken: number }> {
  const guaranteed = await guaranteedPieces(db, d.id, opts.exceptGuaranteeId);
  if (d.mode === 'DRAW') {
    const held = await db
      .selectFrom('drop_entries')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('pieces'), sql<number>`0`).as('n'))
      .where('drop_id', '=', d.id)
      .where('status', 'in', ['SELECTED', 'CONFIRMED'])
      .executeTakeFirstOrThrow();
    return { capacity: d.quantity, taken: Number(held.n) + guaranteed };
  }
  const [stock, held] = await Promise.all([
    db.selectFrom('drop_sizes').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('stock'), sql<number>`0`).as('n')).where('drop_id', '=', d.id).executeTakeFirstOrThrow(),
    db
      .selectFrom('live_entries')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('quantity'), sql<number>`0`).as('n'))
      .where('drop_id', '=', d.id)
      .where('status', 'in', [...LIVE_HOLDING])
      .executeTakeFirstOrThrow(),
  ]);
  return { capacity: Number(stock.n), taken: Number(held.n) + guaranteed };
}

/** The pieces of the ACTIVE guarantees set aside for a release (one guarantee left out, when named). */
export async function guaranteedPieces(db: Db, dropId: string, exceptGuaranteeId?: string): Promise<number> {
  const r = await db
    .selectFrom('house_guarantees')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('pieces'), sql<number>`0`).as('n'))
    .where('covered_drop_id', '=', dropId)
    .where('status', '=', 'ACTIVE')
    .$if(exceptGuaranteeId !== undefined, (q) => q.where('id', '<>', exceptGuaranteeId!))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Whether the account already holds, in a release, an ACTIVE guarantee or a place (a draw's held or sold; a LIVE turn, hold or sale). */
async function holdsIn(db: Db, accountId: string, d: Pick<DropRow, 'id' | 'mode'>): Promise<boolean> {
  const g = await db.selectFrom('house_guarantees').select('id').where('account_id', '=', accountId).where('covered_drop_id', '=', d.id).where('status', '=', 'ACTIVE').executeTakeFirst();
  if (g) return true;
  const place =
    d.mode === 'DRAW'
      ? await db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', accountId).where('status', 'in', ['SELECTED', 'CONFIRMED']).executeTakeFirst()
      : await db.selectFrom('live_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', accountId).where('status', 'in', [...LIVE_HOLDING]).executeTakeFirst();
  return place !== undefined;
}

/** The scope condition of the releases a MODEL or COLLECTION guarantee covers: the release's model, its main model, its collection. */
async function releaseScopeOf(db: Db, d: Pick<DropRow, 'model_id'>): Promise<{ modelId: string; mainId: string | null; collectionId: string | null }> {
  const m = await db
    .selectFrom('models as m')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .select((eb) => ['m.id', 'm.variant_of', eb.fn.coalesce('m.collection_id', 'main.collection_id').as('collection_id')])
    .where('m.id', '=', d.model_id)
    .executeTakeFirstOrThrow();
  return { modelId: m.id, mainId: m.variant_of, collectionId: m.collection_id };
}

/** Whether a MODEL or COLLECTION guarantee covers a release's model. */
function inScope(g: Pick<HouseGuaranteeRow, 'scope' | 'model_id' | 'collection_id'>, s: { modelId: string; mainId: string | null; collectionId: string | null }): boolean {
  if (g.scope === 'MODEL') return g.model_id === s.modelId || (s.mainId !== null && g.model_id === s.mainId);
  if (g.scope === 'COLLECTION') return s.collectionId !== null && g.collection_id === s.collectionId;
  return false;
}

/**
 * Set a guarantee aside for the first eligible published release in its scope that opens by its validity date, still
 * has room for its pieces and where its account holds nothing yet (a release left out when named), in the order of the
 * openings; that release's row FOR UPDATE. Returns the release, or null (the guarantee then waits).
 */
export async function coverNextRelease(
  tx: Db,
  g: Pick<HouseGuaranteeRow, 'id' | 'account_id' | 'scope' | 'model_id' | 'collection_id' | 'pieces' | 'valid_until'>,
  now: Date,
  opts: { except?: string } = {},
): Promise<ReleaseRow | null> {
  if (g.scope === 'RELEASE') return null;
  const candidates = await tx
    .selectFrom('drops as d')
    .innerJoin('models as m', 'm.id', 'd.model_id')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .select(['d.id'])
    .where('d.published_at', 'is not', null)
    .where('d.cancelled_at', 'is', null)
    .where('d.parent_drop_id', 'is', null)
    .where('d.drawn_at', 'is', null)
    .where('d.ended_at', 'is', null)
    .where('d.closes_at', '>', now)
    .where('d.opens_at', '<=', g.valid_until)
    .$if(opts.except !== undefined, (q) => q.where('d.id', '<>', opts.except!))
    .where((eb) =>
      g.scope === 'MODEL'
        ? eb.or([eb('m.id', '=', g.model_id!), eb('m.variant_of', '=', g.model_id!)])
        : eb(eb.fn.coalesce('m.collection_id', 'main.collection_id'), '=', g.collection_id!),
    )
    .orderBy('d.opens_at')
    .orderBy('d.id')
    .execute();
  for (const c of candidates) {
    const d = await tx.selectFrom('drops').select([...RELEASE_COLUMNS]).where('id', '=', c.id).forUpdate().executeTakeFirst();
    if (!d || !d.published_at || !coverable(d, now) || new Date(d.opens_at).getTime() > new Date(g.valid_until).getTime()) continue;
    if (await holdsIn(tx, g.account_id, d)) continue;
    const room = await releaseRoom(tx, d, { exceptGuaranteeId: g.id });
    if (room.taken + g.pieces > room.capacity) continue;
    return d;
  }
  return null;
}

/**
 * IN-01: whether a size of a LIVE RELEASE can still serve a guaranteed entry of `quantity` pieces (LIVE stock is checked
 * per size): its stock less the pieces CONFIRMED in it and those of the other guaranteed entries still open in it
 * (WAITING, QUEUED, TURN, SECURED). `entryId`, the entry itself, is left out of the count. LiveService.enter and
 * changeSize ask it, and so does a guarantee bound to an entry already waiting.
 */
export async function sizeServesGuarantee(tx: Db, dropId: string, sizeId: string, quantity: number, entryId: string | null): Promise<boolean> {
  const size = await tx.selectFrom('drop_sizes').select('stock').where('drop_id', '=', dropId).where('id', '=', sizeId).executeTakeFirst();
  if (!size) return false;
  const rows = await tx
    .selectFrom('live_entries')
    .select(['id', 'quantity'])
    .where('drop_id', '=', dropId)
    .where('size_id', '=', sizeId)
    .where((eb) => eb.or([eb('status', '=', 'CONFIRMED'), eb.and([eb('guarantee_id', 'is not', null), eb('status', 'in', ['WAITING', 'QUEUED', 'TURN', 'SECURED'])])]))
    .execute();
  const taken = rows.filter((r) => r.id !== entryId).reduce((n, r) => n + r.quantity, 0);
  return taken + quantity <= size.stock;
}

/**
 * Bind a guarantee just set aside to its account's entry in that release, when one is waiting (a draw's ENTERED, a LIVE
 * WAITING or QUEUED). A LIVE entry is bound only when its size can still serve the guarantee (sizeServesGuarantee);
 * otherwise it stays an ordinary entry, the guarantee set aside and unused, and a CHANGE SIZE checks again.
 */
async function bindWaitingEntry(tx: Db, g: { id: string; account_id: string; pieces: number }, d: Pick<DropRow, 'id' | 'mode'>): Promise<string | null> {
  if (d.mode === 'DRAW') {
    const e = await tx
      .updateTable('drop_entries')
      .set({ guarantee_id: g.id, pieces: g.pieces })
      .where('drop_id', '=', d.id)
      .where('account_id', '=', g.account_id)
      .where('status', '=', 'ENTERED')
      .where('guarantee_id', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return e?.id ?? null;
  }
  const waiting = await tx
    .selectFrom('live_entries')
    .select(['id', 'size_id', 'quantity'])
    .where('drop_id', '=', d.id)
    .where('account_id', '=', g.account_id)
    .where('status', 'in', [...LIVE_WAITING])
    .where('guarantee_id', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!waiting || !(await sizeServesGuarantee(tx, d.id, waiting.size_id, waiting.quantity, waiting.id))) return null;
  const e = await tx
    .updateTable('live_entries')
    .set({ guarantee_id: g.id })
    .where('id', '=', waiting.id)
    .where('status', 'in', [...LIVE_WAITING])
    .where('guarantee_id', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return e?.id ?? null;
}

/**
 * A release just published (DropService.publish, LiveConsoleService.publish; its row held FOR UPDATE by the caller): the
 * waiting MODEL and COLLECTION guarantees in its scope, valid at its opening, set aside for it in grant order while they
 * fit, an account that holds one there already passed over. An after-room covers none. Noted `guarantee.cover`.
 */
export async function coverOnPublish(tx: Db, d: ReleaseRow, now: Date, actor: Actor, notes: AuditRecordInput[]): Promise<number> {
  if (d.parent_drop_id || !coverable(d, now)) return 0;
  const scope = await releaseScopeOf(tx, d);
  const waiting = await tx
    .selectFrom('house_guarantees')
    .selectAll()
    .where('status', '=', 'ACTIVE')
    .where('covered_drop_id', 'is', null)
    .where('scope', 'in', ['MODEL', 'COLLECTION'])
    .where('valid_until', '>=', d.opens_at)
    .where((eb) =>
      eb.or([
        eb.and([eb('scope', '=', 'MODEL'), eb('model_id', 'in', [scope.modelId, ...(scope.mainId ? [scope.mainId] : [])])]),
        ...(scope.collectionId ? [eb.and([eb('scope', '=', 'COLLECTION'), eb('collection_id', '=', scope.collectionId)])] : []),
      ]),
    )
    .orderBy('granted_at')
    .orderBy('id')
    .forUpdate()
    .execute();
  let covered = 0;
  for (const g of waiting) {
    if (!inScope(g, scope)) continue;
    if (await holdsIn(tx, g.account_id, d)) continue;
    const room = await releaseRoom(tx, d);
    if (room.taken + g.pieces > room.capacity) continue;
    await tx.updateTable('house_guarantees').set({ covered_drop_id: d.id, covered_at: now }).where('id', '=', g.id).where('status', '=', 'ACTIVE').execute();
    notes.push({ actor, action: 'guarantee.cover', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, dropId: d.id, pieces: g.pieces, by: 'publish' } });
    covered++;
  }
  return covered;
}

/**
 * The ACTIVE guarantee an account holds for a release, honoured: set aside for it, the release opening by its validity
 * date (it is honoured until the release ends). Its row FOR UPDATE (after the release's and the entry's: the lock order).
 */
export async function holderGuarantee(tx: Db, accountId: string, d: Pick<DropRow, 'id' | 'opens_at' | 'parent_drop_id'>): Promise<HouseGuaranteeRow | null> {
  if (d.parent_drop_id) return null;
  const g = await tx
    .selectFrom('house_guarantees')
    .selectAll()
    .where('account_id', '=', accountId)
    .where('covered_drop_id', '=', d.id)
    .where('status', '=', 'ACTIVE')
    .where('valid_until', '>=', d.opens_at)
    .forUpdate()
    .executeTakeFirst();
  return g ?? null;
}

/**
 * Whether an account holds the house's guarantee for a release (no lock): set aside for it and honoured (the release
 * opening by its validity date), or used in it. A LIVE RELEASE lets such a holder in whatever its access rule
 * (live.ts accessOf). Never an after-room.
 */
export async function holdsGuaranteeFor(db: Db, accountId: string, dropId: string): Promise<boolean> {
  const g = await db
    .selectFrom('house_guarantees as g')
    .innerJoin('drops as d', 'd.id', 'g.covered_drop_id')
    .select('g.id')
    .where('g.account_id', '=', accountId)
    .where('d.id', '=', dropId)
    .where('d.parent_drop_id', 'is', null)
    .where((eb) => eb.or([eb.and([eb('g.status', '=', 'ACTIVE'), eb('g.valid_until', '>=', eb.ref('d.opens_at'))]), eb.and([eb('g.status', '=', 'USED'), eb('g.used_drop_id', '=', dropId)])]))
    .limit(1)
    .executeTakeFirst();
  return g !== undefined;
}

/** Guarantees used in a release (`now`: the draw, a reservation, a LIVE turn): USED, closed. Noted `guarantee.use`. */
export async function useGuarantees(tx: Db, ids: readonly string[], dropId: string, now: Date, actor: Actor, notes: AuditRecordInput[], how: 'draw' | 'reserve' | 'turn'): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .updateTable('house_guarantees')
    .set({ status: 'USED', used_at: now, used_drop_id: dropId, closed_at: now, closed_reason: 'USED' })
    .where('id', 'in', [...ids])
    .where('status', '=', 'ACTIVE')
    .returning(['id', 'account_id', 'pieces'])
    .execute();
  for (const g of rows.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    notes.push({ actor, action: 'guarantee.use', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, dropId, pieces: g.pieces, by: how } });
  }
  return rows.length;
}

/**
 * A release drawn, ended or cancelled (DropService.draw and cancel; LiveService's end; LiveConsoleService.cancel): its
 * ACTIVE guarantees, unbound from their entries, a chosen release's expired with it, a model's or a collection's carried
 * to the following release while still valid (or waiting for one), else expired. Noted `guarantee.carry` and
 * `guarantee.expire`. Returns how many were carried and expired.
 */
export async function releaseCovered(
  tx: Db,
  dropId: string,
  why: 'ENDED' | 'CANCELLED',
  now: Date,
  actor: Actor,
  notes: AuditRecordInput[],
): Promise<{ carried: number; expired: number }> {
  const rows = await tx.selectFrom('house_guarantees').selectAll().where('covered_drop_id', '=', dropId).where('status', '=', 'ACTIVE').orderBy('granted_at').orderBy('id').forUpdate().execute();
  if (rows.length === 0) return { carried: 0, expired: 0 };
  const ids = rows.map((g) => g.id);
  await tx.updateTable('drop_entries').set({ guarantee_id: null, pieces: 1 }).where('guarantee_id', 'in', ids).execute();
  await tx.updateTable('live_entries').set({ guarantee_id: null }).where('guarantee_id', 'in', ids).execute();
  const reason: GuaranteeClosedReason = why === 'CANCELLED' ? 'RELEASE_CANCELLED' : 'RELEASE_ENDED';
  let carried = 0;
  let expired = 0;
  for (const g of rows) {
    const valid = new Date(g.valid_until).getTime() >= now.getTime();
    if (g.scope === 'RELEASE' || !valid) {
      await tx.updateTable('house_guarantees').set({ status: 'EXPIRED', closed_at: now, closed_reason: reason }).where('id', '=', g.id).execute();
      notes.push({ actor, action: 'guarantee.expire', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, dropId, reason } });
      expired++;
      continue;
    }
    await tx.updateTable('house_guarantees').set({ covered_drop_id: null, covered_at: null }).where('id', '=', g.id).execute();
    const next = await coverNextRelease(tx, g, now, { except: dropId });
    if (next) {
      await tx.updateTable('house_guarantees').set({ covered_drop_id: next.id, covered_at: now }).where('id', '=', g.id).execute();
      await bindWaitingEntry(tx, g, next);
    }
    notes.push({ actor, action: 'guarantee.carry', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, from: dropId, to: next?.id ?? null, reason } });
    carried++;
  }
  return { carried, expired };
}

// ── Views ──────────────────────────────────────────────────────────────────

/** What a guarantee covers, as the console names it: a model (its variant's label), a collection, or a release (its title). */
export interface GuaranteeTarget {
  kind: GuaranteeScope;
  id: string;
  name: string;
  /** A model's label among its variants (« Blue »), or null. */
  variant: string | null;
}

/** A guarantee as the console reads it (the client sheet); the routes mask nothing here but the client's email elsewhere. */
export interface AdminGuarantee {
  id: string;
  accountId: string;
  scope: GuaranteeScope;
  target: GuaranteeTarget;
  pieces: number;
  validUntil: Date;
  visible: boolean;
  /** For Client Services only. */
  note: string | null;
  status: GuaranteeStatus;
  state: GuaranteeState;
  /** The release it is set aside for, or was used in. */
  release: { id: string; title: string; mode: DropMode } | null;
  /** The entry that uses it now, or used it. */
  entryId: string | null;
  grantedAt: Date;
  grantedBy: { id: string; email: string } | null;
  updatedAt: Date | null;
  updatedBy: { id: string; email: string } | null;
  usedAt: Date | null;
  closedAt: Date | null;
  closedReason: GuaranteeClosedReason | null;
  revokeNote: string | null;
}

/** A guarantee as a release's page lists it in the console; the routes mask the email for an AUDITOR. */
export interface AdminReleaseGuarantee {
  id: string;
  account: { id: string; email: string };
  pieces: number;
  visible: boolean;
  state: GuaranteeState;
  entry: { id: string; status: string } | null;
  validUntil: Date;
  grantedAt: Date;
}

/** A release's guarantees counted: set aside, or used in it. */
export interface ReleaseGuaranteed {
  places: number;
  pieces: number;
}

/**
 * A guarantee as its holder reads it (GET /api/v1/club/status `guarantees`): only a guarantee shown to the client, still
 * waiting, set aside or entered. `target` in capitals (a model with its variant, `MONOLITHE IN BLUE`; a collection;
 * a release's title once it may be said, else null). `release`: the release it is set aside for once announced (its
 * title null before a LIVE RELEASE's name stage).
 */
export interface AccountGuarantee {
  id: string;
  scope: GuaranteeScope;
  target: string | null;
  pieces: number;
  validUntil: Date;
  release: { id: string; mode: DropMode; title: string | null } | null;
}

/** A guarantee in the client's copy of their data (the right of access): every one, shown or not, with its notes. */
export interface ExportedGuarantee {
  id: string;
  scope: GuaranteeScope;
  target: string;
  pieces: number;
  validUntil: Date;
  visible: boolean;
  note: string | null;
  /** Client Services' note at a revocation (optional), exported like the grant's note. */
  revokeNote: string | null;
  status: GuaranteeStatus;
  releaseId: string | null;
  grantedAt: Date;
  usedAt: Date | null;
  closedAt: Date | null;
}

/** A model's name as a guarantee says it: in capitals, its variant after it (`MONOLITHE IN BLUE`). */
function modelWords(name: string, variant: string | null): string {
  return `${name.trim().toUpperCase()}${variant ? ` IN ${variant.trim().toUpperCase()}` : ''}`;
}

type ViewRow = HouseGuaranteeRow & {
  covered_title: string | null;
  covered_mode: DropMode | null;
  covered_opens_at: Date | null;
  used_title: string | null;
  used_mode: DropMode | null;
  model_name: string | null;
  model_variant: string | null;
  collection_name: string | null;
  release_title: string | null;
  granted_email: string | null;
  updated_email: string | null;
};

function viewRows(db: Db) {
  return db
    .selectFrom('house_guarantees as g')
    .leftJoin('drops as c', 'c.id', 'g.covered_drop_id')
    .leftJoin('drops as u', 'u.id', 'g.used_drop_id')
    .leftJoin('drops as r', 'r.id', 'g.drop_id')
    .leftJoin('models as m', 'm.id', 'g.model_id')
    .leftJoin('collections as k', 'k.id', 'g.collection_id')
    .leftJoin('admin_users as gb', 'gb.id', 'g.granted_by')
    .leftJoin('admin_users as ub', 'ub.id', 'g.updated_by')
    .selectAll('g')
    .select([
      'c.title as covered_title',
      'c.mode as covered_mode',
      'c.opens_at as covered_opens_at',
      'u.title as used_title',
      'u.mode as used_mode',
      'm.name as model_name',
      'm.variant_label as model_variant',
      'k.name as collection_name',
      'r.title as release_title',
      'gb.email as granted_email',
      'ub.email as updated_email',
    ]);
}

/** The entries that use each guarantee now (a draw's or a LIVE RELEASE's), or used it. */
async function entriesOf(db: Db, ids: readonly string[]): Promise<Map<string, { id: string; status: string }>> {
  const out = new Map<string, { id: string; status: string }>();
  if (ids.length === 0) return out;
  const [draws, lives] = await Promise.all([
    db.selectFrom('drop_entries').select(['id', 'status', 'guarantee_id']).where('guarantee_id', 'in', [...ids]).execute(),
    db.selectFrom('live_entries').select(['id', 'status', 'guarantee_id']).where('guarantee_id', 'in', [...ids]).execute(),
  ]);
  for (const e of [...draws, ...lives]) if (e.guarantee_id) out.set(e.guarantee_id, { id: e.id, status: e.status });
  return out;
}

/** Whether an entry still waits with its guarantee (what makes it ENTERED): a draw's ENTERED, a LIVE WAITING or QUEUED. */
const waitingEntry = (e: { status: string } | undefined) => e !== undefined && (e.status === 'ENTERED' || e.status === 'WAITING' || e.status === 'QUEUED');

function targetOf(r: ViewRow): GuaranteeTarget {
  if (r.scope === 'MODEL') return { kind: 'MODEL', id: r.model_id!, name: r.model_name ?? '', variant: r.model_variant };
  if (r.scope === 'COLLECTION') return { kind: 'COLLECTION', id: r.collection_id!, name: r.collection_name ?? '', variant: null };
  return { kind: 'RELEASE', id: r.drop_id!, name: r.release_title ?? '', variant: null };
}

function adminView(r: ViewRow, entry: { id: string; status: string } | undefined, now: Date): AdminGuarantee {
  const release =
    r.covered_drop_id && r.covered_title && r.covered_mode
      ? { id: r.covered_drop_id, title: r.covered_title, mode: r.covered_mode }
      : r.used_drop_id && r.used_title && r.used_mode
        ? { id: r.used_drop_id, title: r.used_title, mode: r.used_mode }
        : null;
  return {
    id: r.id,
    accountId: r.account_id,
    scope: r.scope,
    target: targetOf(r),
    pieces: r.pieces,
    validUntil: r.valid_until,
    visible: r.visible,
    note: r.note,
    status: r.status,
    state: guaranteeState(r, r.covered_opens_at, r.status === 'ACTIVE' && waitingEntry(entry), now),
    release,
    entryId: entry?.id ?? null,
    grantedAt: r.granted_at,
    grantedBy: r.granted_by && r.granted_email ? { id: r.granted_by, email: r.granted_email } : null,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by && r.updated_email ? { id: r.updated_by, email: r.updated_email } : null,
    usedAt: r.used_at,
    closedAt: r.closed_at,
    closedReason: r.closed_reason,
    revokeNote: r.revoke_note,
  };
}

/** An account's guarantees for the console, the open ones first (by validity), then the closed ones, the latest first. */
export async function accountGuaranteesForStaff(db: Db, accountId: string, now: Date): Promise<AdminGuarantee[]> {
  const rows = (await viewRows(db).where('g.account_id', '=', accountId).execute()) as ViewRow[];
  const entries = await entriesOf(db, rows.map((r) => r.id));
  const views = rows.map((r) => adminView(r, entries.get(r.id), now));
  const open = (v: AdminGuarantee) => v.status === 'ACTIVE' && v.state !== 'EXPIRED';
  return views.sort((a, b) =>
    open(a) !== open(b)
      ? open(a)
        ? -1
        : 1
      : open(a)
        ? a.validUntil.getTime() - b.validUntil.getTime() || (a.id < b.id ? -1 : 1)
        : (b.closedAt ?? b.grantedAt).getTime() - (a.closedAt ?? a.grantedAt).getTime() || (a.id < b.id ? -1 : 1),
  );
}

/** The guarantees of a release (set aside for it, or used in it) for the console, in grant order. */
export async function releaseGuarantees(db: Db, dropId: string, now: Date): Promise<AdminReleaseGuarantee[]> {
  const rows = await db
    .selectFrom('house_guarantees as g')
    .innerJoin('accounts as a', 'a.id', 'g.account_id')
    .leftJoin('drops as c', 'c.id', 'g.covered_drop_id')
    .select(['g.id', 'g.account_id', 'a.email', 'g.pieces', 'g.visible', 'g.status', 'g.valid_until', 'g.covered_drop_id', 'g.granted_at', 'c.opens_at as covered_opens_at'])
    .where((eb) => eb.or([eb.and([eb('g.covered_drop_id', '=', dropId), eb('g.status', '=', 'ACTIVE')]), eb('g.used_drop_id', '=', dropId)]))
    .orderBy('g.granted_at')
    .orderBy('g.id')
    .execute();
  const entries = await entriesOf(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const entry = entries.get(r.id);
    return {
      id: r.id,
      account: { id: r.account_id, email: r.email },
      pieces: r.pieces,
      visible: r.visible,
      state: guaranteeState(r, r.covered_opens_at, r.status === 'ACTIVE' && waitingEntry(entry), now),
      entry: entry ?? null,
      validUntil: r.valid_until,
      grantedAt: r.granted_at,
    };
  });
}

/** Each release's guarantees counted (set aside for it and still ACTIVE, or used in it): the console's Guaranteed row. */
export async function releaseGuaranteed(db: Db, dropIds: readonly string[]): Promise<Map<string, ReleaseGuaranteed>> {
  const out = new Map<string, ReleaseGuaranteed>();
  if (dropIds.length === 0) return out;
  const rows = await db
    .selectFrom('house_guarantees')
    .select(['covered_drop_id', 'used_drop_id', 'status', 'pieces'])
    .where((eb) => eb.or([eb.and([eb('covered_drop_id', 'in', [...dropIds]), eb('status', '=', 'ACTIVE')]), eb('used_drop_id', 'in', [...dropIds])]))
    .execute();
  for (const r of rows) {
    const id = r.status === 'USED' ? r.used_drop_id! : r.covered_drop_id!;
    const t = out.get(id) ?? { places: 0, pieces: 0 };
    t.places += 1;
    t.pieces += r.pieces;
    out.set(id, t);
  }
  return out;
}

/** Whether a LIVE RELEASE's name may be said at `now` (live.ts liveStages: its name stage, or the announcement when none). */
function liveNamed(d: { announce_at: Date | null; published_at: Date | null; name_at: Date | null }, now: Date): boolean {
  const announced = d.announce_at ?? d.published_at;
  if (!announced || now.getTime() < new Date(announced).getTime()) return false;
  return !d.name_at || now.getTime() >= new Date(d.name_at).getTime();
}

/** Whether a release's page may be opened at `now`: a draw published, a LIVE RELEASE announced. */
function releaseShown(d: { mode: DropMode; announce_at: Date | null; published_at: Date | null }, now: Date): boolean {
  if (!d.published_at) return false;
  if (d.mode === 'DRAW') return true;
  const announced = d.announce_at ?? d.published_at;
  return now.getTime() >= new Date(announced).getTime();
}

/**
 * An account's guarantees as its holder reads them (GET /api/v1/club/status): only those shown to the client, ACTIVE and
 * not expired, the soonest validity first. Nothing of a guarantee not shown.
 */
export async function accountGuarantees(db: Db, accountId: string, now: Date): Promise<AccountGuarantee[]> {
  const rows = await db
    .selectFrom('house_guarantees as g')
    .leftJoin('drops as c', 'c.id', 'g.covered_drop_id')
    .leftJoin('drops as r', 'r.id', 'g.drop_id')
    .leftJoin('models as m', 'm.id', 'g.model_id')
    .leftJoin('collections as k', 'k.id', 'g.collection_id')
    .select([
      'g.id', 'g.scope', 'g.pieces', 'g.valid_until', 'g.status', 'g.covered_drop_id',
      'c.mode as c_mode', 'c.title as c_title', 'c.opens_at as c_opens_at', 'c.published_at as c_published_at', 'c.announce_at as c_announce_at', 'c.name_at as c_name_at',
      'r.mode as r_mode', 'r.title as r_title', 'r.published_at as r_published_at', 'r.announce_at as r_announce_at', 'r.name_at as r_name_at',
      'm.name as model_name', 'm.variant_label as model_variant', 'k.name as collection_name',
    ])
    .where('g.account_id', '=', accountId)
    .where('g.visible', '=', true)
    .where('g.status', '=', 'ACTIVE')
    .orderBy('g.valid_until')
    .orderBy('g.id')
    .execute();
  const out: AccountGuarantee[] = [];
  for (const r of rows) {
    if (guaranteeState(r, r.c_opens_at, false, now) === 'EXPIRED') continue;
    let target: string | null;
    if (r.scope === 'MODEL') target = modelWords(r.model_name ?? '', r.model_variant);
    else if (r.scope === 'COLLECTION') target = (r.collection_name ?? '').trim().toUpperCase();
    else {
      const d = { mode: r.r_mode!, published_at: r.r_published_at, announce_at: r.r_announce_at, name_at: r.r_name_at };
      target = releaseShown(d, now) && (d.mode === 'DRAW' || liveNamed(d, now)) ? (r.r_title ?? '').toUpperCase() : null;
    }
    const covered = r.covered_drop_id && r.c_mode ? { mode: r.c_mode, published_at: r.c_published_at, announce_at: r.c_announce_at, name_at: r.c_name_at } : null;
    const release =
      covered && releaseShown(covered, now)
        ? { id: r.covered_drop_id!, mode: covered.mode, title: covered.mode === 'DRAW' || liveNamed(covered, now) ? r.c_title : null }
        : null;
    out.push({ id: r.id, scope: r.scope, target, pieces: r.pieces, validUntil: r.valid_until, release });
  }
  return out;
}

/** Every guarantee of an account, for its right-of-access export: shown or not, with its notes (grant and revocation), oldest first. */
export async function exportedGuarantees(db: Db, accountId: string): Promise<ExportedGuarantee[]> {
  const rows = (await viewRows(db).where('g.account_id', '=', accountId).orderBy('g.granted_at').orderBy('g.id').execute()) as ViewRow[];
  return rows.map((r) => {
    const t = targetOf(r);
    return {
      id: r.id,
      scope: r.scope,
      target: r.scope === 'MODEL' ? modelWords(t.name, t.variant) : t.name,
      pieces: r.pieces,
      validUntil: r.valid_until,
      visible: r.visible,
      note: r.note,
      revokeNote: r.revoke_note,
      status: r.status,
      releaseId: r.used_drop_id ?? r.covered_drop_id,
      grantedAt: r.granted_at,
      usedAt: r.used_at,
      closedAt: r.closed_at,
    };
  });
}

/** The ids of an account's entries' guarantees shown to the client (AccountDropEntry and LiveEntryView `guaranteed`). */
export async function visibleGuaranteeIds(db: Db, ids: readonly (string | null)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
  if (wanted.length === 0) return new Set();
  const rows = await db.selectFrom('house_guarantees').select('id').where('id', 'in', wanted).where('visible', '=', true).execute();
  return new Set(rows.map((r) => r.id));
}

// ── Input ──────────────────────────────────────────────────────────────────

export interface GrantInput {
  scope: GuaranteeScope;
  /** RELEASE: the release; MODEL: the model; COLLECTION: the collection. */
  targetId: string;
  pieces: number;
  /** A calendar day, `YYYY-MM-DD`, in Paris: the guarantee covers a release that opens by its end. */
  validUntil: string;
  visible: boolean;
  note?: string | null;
}

export interface GuaranteeChange {
  pieces?: number;
  validUntil?: string;
  visible?: boolean;
  note?: string | null;
}

export interface GuaranteeSettings {
  validDays: number;
  pieces: number;
  visible: boolean;
}

export interface GuaranteeSettingsSheet extends GuaranteeSettings {
  /** The Grant dialog's starting validity: today in Paris plus `validDays`. */
  defaultValidUntil: string;
  updatedAt: Date | null;
  updatedBy: { id: string; email: string } | null;
}

export const DEFAULT_GUARANTEE_SETTINGS: Readonly<GuaranteeSettings> = Object.freeze({
  validDays: GUARANTEE_VALID_DAYS.default,
  pieces: GUARANTEE_PIECES.default,
  visible: true,
});

function cleanPieces(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < GUARANTEE_PIECES.min || v > GUARANTEE_PIECES.max) {
    throw validationError(`A guarantee covers ${GUARANTEE_PIECES.min} to ${GUARANTEE_PIECES.max} pieces.`);
  }
  return v;
}

function cleanNote(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('A note is text.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (s.length > GUARANTEE_NOTE_MAX || CONTROL_CHARS.test(s)) throw validationError(`A note has at most ${GUARANTEE_NOTE_MAX} characters.`);
  return s;
}

function cleanValidUntil(v: unknown, now: Date): Date {
  if (typeof v !== 'string') throw validationError('Valid until is a date, YYYY-MM-DD.');
  const at = endOfParisDay(v);
  if (at.getTime() <= now.getTime()) throw validationError('Valid until is today or later.');
  if (at.getTime() > now.getTime() + (GUARANTEE_VALID_DAYS.max + 1) * DAY_MS) throw validationError(`A guarantee is valid ${GUARANTEE_VALID_DAYS.max} days at most.`);
  return at;
}

export function checkSettings(input: unknown): GuaranteeSettings {
  if (!input || typeof input !== 'object') throw validationError('Send the whole settings.');
  const v = input as Record<string, unknown>;
  if (typeof v.validDays !== 'number' || !Number.isInteger(v.validDays) || v.validDays < GUARANTEE_VALID_DAYS.min || v.validDays > GUARANTEE_VALID_DAYS.max) {
    throw validationError(`Valid for is ${GUARANTEE_VALID_DAYS.min} to ${GUARANTEE_VALID_DAYS.max} days.`);
  }
  if (typeof v.visible !== 'boolean') throw validationError('Shown to the client is yes or no.');
  return { validDays: v.validDays, pieces: cleanPieces(v.pieces), visible: v.visible };
}

/** The Grant dialog's defaults now: their row, or DEFAULT_GUARANTEE_SETTINGS. */
export async function readGuaranteeSettings(db: Db): Promise<GuaranteeSettings> {
  const r = await db.selectFrom('guarantee_settings').select(['valid_days', 'pieces', 'visible']).where('id', '=', 1).executeTakeFirst();
  return r ? { validDays: r.valid_days, pieces: r.pieces, visible: r.visible } : { ...DEFAULT_GUARANTEE_SETTINGS };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface GuaranteeServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export interface GrantOutcome {
  guarantee: AdminGuarantee;
  /** The release it was set aside for at once, or null (it waits for the next one). */
  setAsideFor: { id: string; title: string } | null;
}

export class GuaranteeService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: GuaranteeServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** An account's guarantees (the client sheet). */
  forAccount(accountId: string): Promise<AdminGuarantee[]> {
    return accountGuaranteesForStaff(this.db, knownId(accountId, () => notFound('Account', 'ACCOUNT_NOT_FOUND')), this.clock());
  }

  /** A release's guarantees (GET /api/admin/drops/:id/guarantees): 404 DROP_NOT_FOUND for an unknown release. */
  async forRelease(dropId: string): Promise<AdminReleaseGuarantee[]> {
    const id = knownId(dropId, () => new DomainError('DROP_NOT_FOUND', 404, 'This release is not known to ORBES.'));
    const d = await this.db.selectFrom('drops').select('id').where('id', '=', id).executeTakeFirst();
    if (!d) throw new DomainError('DROP_NOT_FOUND', 404, 'This release is not known to ORBES.');
    return releaseGuarantees(this.db, id, this.clock());
  }

  /** The Grant dialog's defaults (Orders → Settings, House guarantee), who set them and when. */
  async settings(): Promise<GuaranteeSettingsSheet> {
    const s = await readGuaranteeSettings(this.db);
    const meta = await this.db
      .selectFrom('guarantee_settings as s')
      .leftJoin('admin_users as u', 'u.id', 's.updated_by')
      .select(['s.updated_at', 's.updated_by', 'u.email'])
      .where('s.id', '=', 1)
      .executeTakeFirst();
    return {
      ...s,
      defaultValidUntil: parisDayPlus(this.clock(), s.validDays),
      updatedAt: meta ? meta.updated_at : null,
      updatedBy: meta?.updated_by && meta.email ? { id: meta.updated_by, email: meta.email } : null,
    };
  }

  // ── Changes ──────────────────────────────────────────────────────────────

  /** The defaults changed whole (PUT /api/admin/settings/guarantees, ADMIN). Audited `guarantee.settings`, before and after. */
  async saveSettings(input: unknown, actor: Actor): Promise<GuaranteeSettingsSheet> {
    const admin = assertStaff(actor, 'change the guarantee’s settings');
    const next = checkSettings(input);
    await inTransaction(this.db, async (tx) => {
      const before = await readGuaranteeSettings(tx);
      const values = { valid_days: next.validDays, pieces: next.pieces, visible: next.visible, updated_by: admin, updated_at: this.clock() };
      await tx
        .insertInto('guarantee_settings')
        .values({ id: 1, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet(values))
        .execute();
      await this.audit.record({ actor, action: 'guarantee.settings', targetType: 'guarantee_settings', targetId: null, details: { before: { ...before }, after: { ...next } } }, tx);
    });
    return this.settings();
  }

  /**
   * Grant a guarantee (POST /api/admin/owners/:id/guarantees, OPERATOR). Refused: an unknown account (404), a LOCKED one
   * (403 ACCOUNT_LOCKED), one deleted (409 ACCOUNT_NOT_ACTIVE); values out of bounds (400); an unknown target (404); a
   * chosen release over or cancelled (409 GUARANTEE_RELEASE_OVER), opening after the validity (409
   * GUARANTEE_RELEASE_OPENS_LATE), closed or an after-room (409 GUARANTEE_RELEASE_CLOSED), without room (409
   * GUARANTEE_EXCEEDS_RELEASE), or where the client already holds a guarantee or a place (409 GUARANTEE_ALREADY). A model
   * no longer offered is refused (409 MODEL_INACTIVE). Set aside at once for a chosen release, or for the next release
   * in its scope when one is published and has room (otherwise it waits); bound to the client's waiting entry there.
   * Lock order: the account FOR SHARE, the release FOR UPDATE, the entry, then the insert. Audited `guarantee.grant`
   * (ids, pieces, validity, shown, whether a note was given; never its words).
   */
  async grant(accountId: string, input: GrantInput, actor: Actor): Promise<GrantOutcome> {
    const admin = assertStaff(actor, 'grant a guarantee');
    const account = knownId(accountId, () => notFound('Account', 'ACCOUNT_NOT_FOUND'));
    if (!(GUARANTEE_SCOPES as readonly unknown[]).includes(input?.scope)) throw validationError('A guarantee covers a release, a model or a collection.');
    const pieces = cleanPieces(input.pieces);
    if (typeof input.visible !== 'boolean') throw validationError('Shown to the client is yes or no.');
    const note = cleanNote(input.note);
    const scope = input.scope;
    const missing = () =>
      scope === 'RELEASE'
        ? new DomainError('DROP_NOT_FOUND', 404, 'This release is not known to ORBES.')
        : scope === 'MODEL'
          ? notFound('Model', 'MODEL_NOT_FOUND')
          : notFound('Collection', 'COLLECTION_NOT_FOUND');
    const targetId = knownId(input.targetId, missing);
    const { id, cover } = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const validUntil = cleanValidUntil(input.validUntil, now);
      const a = await tx.selectFrom('accounts').select(['id', 'status']).where('id', '=', account).forShare().executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status === 'LOCKED') throw customerAccountLocked();
      if (a.status !== 'ACTIVE') throw accountNotActive();
      let cover: ReleaseRow | null = null;
      const g = { id: '00000000-0000-0000-0000-000000000000', account_id: account, scope, model_id: null as string | null, collection_id: null as string | null, pieces, valid_until: validUntil };
      if (scope === 'RELEASE') {
        const d = await tx.selectFrom('drops').select([...RELEASE_COLUMNS]).where('id', '=', targetId).forUpdate().executeTakeFirst();
        if (!d) throw missing();
        const refusal = releaseRefusal(d, validUntil, now);
        if (refusal) throw refusal;
        if (await holdsIn(tx, account, d)) throw already();
        const room = await releaseRoom(tx, d);
        if (room.taken + pieces > room.capacity) throw exceedsRelease(room.capacity, room.taken);
        cover = d;
      } else if (scope === 'MODEL') {
        const m = await tx.selectFrom('models').select(['id', 'active', 'discontinued_at']).where('id', '=', targetId).executeTakeFirst();
        if (!m) throw missing();
        if (!m.active || m.discontinued_at !== null) throw conflict('MODEL_INACTIVE', 'This model is no longer offered.');
        g.model_id = m.id;
        cover = await coverNextRelease(tx, g, now);
      } else {
        const k = await tx.selectFrom('collections').select('id').where('id', '=', targetId).executeTakeFirst();
        if (!k) throw missing();
        g.collection_id = k.id;
        cover = await coverNextRelease(tx, g, now);
      }
      let inserted: { id: string };
      try {
        inserted = await tx
          .insertInto('house_guarantees')
          .values({
            account_id: account,
            scope,
            drop_id: scope === 'RELEASE' ? targetId : null,
            model_id: g.model_id,
            collection_id: g.collection_id,
            pieces,
            valid_until: validUntil,
            visible: input.visible,
            note,
            covered_drop_id: cover?.id ?? null,
            covered_at: cover ? now : null,
            granted_by: admin,
            granted_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (e) {
        if (isUniqueViolation(e, 'house_guarantees_one_per_release')) throw already();
        throw e;
      }
      const entryId = cover ? await bindWaitingEntry(tx, { id: inserted.id, account_id: account, pieces }, cover) : null;
      await this.audit.record(
        {
          actor,
          action: 'guarantee.grant',
          targetType: 'house_guarantee',
          targetId: inserted.id,
          details: {
            accountId: account,
            scope,
            targetId,
            pieces,
            validUntil: validUntil.toISOString(),
            visible: input.visible,
            noted: note !== null,
            coveredDropId: cover?.id ?? null,
            ...(entryId ? { entryId } : {}),
          },
        },
        tx,
      );
      return { id: inserted.id, cover };
    });
    const guarantee = await this.view(id);
    return { guarantee, setAsideFor: cover ? { id: cover.id, title: cover.title } : null };
  }

  /**
   * Change a guarantee while ACTIVE (PATCH /api/admin/guarantees/:id, OPERATOR): its pieces (not while the client has
   * entered with it: 409 GUARANTEE_IN_USE; within its release's room: 409 GUARANTEE_EXCEEDS_RELEASE), its validity (its
   * release still opening by it: 409 GUARANTEE_RELEASE_OPENS_LATE), shown or not, its note. Reads the guarantee, locks
   * its release, then the guarantee. Audited `guarantee.update` with each value before and after (the note as
   * `noted`).
   */
  async update(guaranteeId: string, change: GuaranteeChange, actor: Actor): Promise<AdminGuarantee> {
    const admin = assertStaff(actor, 'change a guarantee');
    const id = knownId(guaranteeId, guaranteeNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const { g, release } = await this.lockForChange(tx, id);
      if (g.status === 'USED') throw used();
      if (g.status !== 'ACTIVE') throw notActive();
      const set: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (change.pieces !== undefined) {
        const pieces = cleanPieces(change.pieces);
        if (pieces !== g.pieces) {
          const bound = await entriesOf(tx, [g.id]);
          if (waitingEntry(bound.get(g.id))) throw inUse();
          if (release && pieces > g.pieces) {
            const room = await releaseRoom(tx, release, { exceptGuaranteeId: g.id });
            if (room.taken + pieces > room.capacity) throw exceedsRelease(room.capacity, room.taken);
          }
          set.pieces = pieces;
          before.pieces = g.pieces;
          after.pieces = pieces;
        }
      }
      if (change.validUntil !== undefined) {
        const validUntil = cleanValidUntil(change.validUntil, now);
        if (validUntil.getTime() !== new Date(g.valid_until).getTime()) {
          if (release && new Date(release.opens_at).getTime() > validUntil.getTime()) throw releaseOpensLate();
          if (validUntil.getTime() <= new Date(g.granted_at).getTime()) throw validationError('Valid until is after the grant.');
          set.valid_until = validUntil;
          before.validUntil = new Date(g.valid_until).toISOString();
          after.validUntil = validUntil.toISOString();
        }
      }
      if (change.visible !== undefined) {
        if (typeof change.visible !== 'boolean') throw validationError('Shown to the client is yes or no.');
        if (change.visible !== g.visible) {
          set.visible = change.visible;
          before.visible = g.visible;
          after.visible = change.visible;
        }
      }
      if (change.note !== undefined) {
        const note = cleanNote(change.note);
        if (note !== g.note) {
          set.note = note;
          before.noted = g.note !== null;
          after.noted = note !== null;
        }
      }
      if (Object.keys(set).length === 0) return;
      await tx
        .updateTable('house_guarantees')
        .set({ ...set, updated_by: admin, updated_at: now })
        .where('id', '=', g.id)
        .execute();
      if (set.pieces !== undefined) await tx.updateTable('drop_entries').set({ pieces: set.pieces as number }).where('guarantee_id', '=', g.id).where('status', '=', 'ENTERED').execute();
      await this.audit.record({ actor, action: 'guarantee.update', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, before, after } } as AuditRecordInput, tx);
    });
    return this.view(id);
  }

  /**
   * Revoke a guarantee while ACTIVE (POST /api/admin/guarantees/:id/revoke, OPERATOR; 409 GUARANTEE_USED once used): the
   * client's entry, if any, stays as an ordinary entry (unbound: one piece). Reads the guarantee, locks its release, then
   * the guarantee, its release checked again. Audited `guarantee.revoke` (whether a note was given; never its words).
   */
  async revoke(guaranteeId: string, note: string | null | undefined, actor: Actor): Promise<AdminGuarantee> {
    const admin = assertStaff(actor, 'revoke a guarantee');
    const id = knownId(guaranteeId, guaranteeNotFound);
    const text = cleanNote(note);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const { g } = await this.lockForChange(tx, id);
      if (g.status === 'USED') throw used();
      if (g.status !== 'ACTIVE') throw notActive();
      await tx.updateTable('drop_entries').set({ guarantee_id: null, pieces: 1 }).where('guarantee_id', '=', g.id).execute();
      await tx.updateTable('live_entries').set({ guarantee_id: null }).where('guarantee_id', '=', g.id).execute();
      await tx
        .updateTable('house_guarantees')
        .set({ status: 'REVOKED', revoked_by: admin, revoke_note: text, closed_at: now, closed_reason: 'REVOKED', updated_by: admin, updated_at: now })
        .where('id', '=', g.id)
        .execute();
      await this.audit.record(
        { actor, action: 'guarantee.revoke', targetType: 'house_guarantee', targetId: g.id, details: { accountId: g.account_id, coveredDropId: g.covered_drop_id, noted: text !== null } },
        tx,
      );
    });
    return this.view(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Read the guarantee, lock the release it is set aside for, then lock the guarantee and check it is still there. */
  private async lockForChange(tx: Db, id: string): Promise<{ g: HouseGuaranteeRow; release: ReleaseRow | null }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await tx.selectFrom('house_guarantees').select(['id', 'covered_drop_id']).where('id', '=', id).executeTakeFirst();
      if (!read) throw guaranteeNotFound();
      const release = read.covered_drop_id ? ((await tx.selectFrom('drops').select([...RELEASE_COLUMNS]).where('id', '=', read.covered_drop_id).forUpdate().executeTakeFirst()) ?? null) : null;
      const g = await tx.selectFrom('house_guarantees').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (g.covered_drop_id === read.covered_drop_id) return { g, release };
    }
    throw conflict('GUARANTEE_BUSY', 'This guarantee is changing: try again.');
  }

  private async view(id: string): Promise<AdminGuarantee> {
    const r = (await viewRows(this.db).where('g.id', '=', id).executeTakeFirst()) as ViewRow | undefined;
    if (!r) throw guaranteeNotFound();
    const entries = await entriesOf(this.db, [id]);
    return adminView(r, entries.get(id), this.clock());
  }
}
