/**
 * The after-room (plan LIVE RELEASE+ of 2026-10-04, choice 2 and decision 28; migration 0023): a second door, in the
 * same vault, for those still in the line when a LIVE RELEASE sold out.
 *
 * Optional per release, set in its console (services/live-console.ts): a child LIVE RELEASE (`drops.parent_drop_id`)
 * with its own model, price, sizes and stock, and add-ons; its delay (`after_room_delay_minutes`, 10 by default) and
 * length (`after_room_length_minutes`, 15). It inherits the parent's turn and pay windows (its own columns written from
 * the parent's with every save, the per-tier ones read from the parent: services/live.ts), its pieces per person and
 * currency, its stock location and its surprise (services/orders.ts ordersForLiveEntry), and asks no question after.
 *
 *   until        a DRAFT whose times say the latest it could open (the parent's close plus its delay). Nothing reads it but
 *   the end      the console.
 *   the parent   SOLD_OUT: in the transaction that ends the parent (its row FOR UPDATE, then the after-room's), the entries
 *   ends         still WAITING or QUEUED, the ones the sell-out ENDS, are remembered as its guests, in their order in the
 *                parent's line (`after_room_guests`: places 1, 2, 3…); it is published at the sell-out, opens its delay
 *                later (its T0) and closes its length after that. Without a guest, or when the parent ends otherwise
 *                (CLOSED, ENDED, or cancelled by the console), it is cancelled: it never opens.
 *   open         its guests' own entries in the release carry its door from the sell-out (`afterRoomDoors`): the page
 *                shows it at its T0. From then a guest sees it (`afterRoomPlace`), and nobody else, anywhere: it is not in THE RELEASES,
 *                the banner, the .ics, the circle, the boutique board, nor PAST (decision 28); any other account, a
 *                visitor and a guest before its T0 read it as an unknown release. A guest enters with a size and joins
 *                the line at its own place; the turns follow those places, size by size, with the same hold, add-ons and
 *                PAY as the main room (services/live.ts). It closes at its length, or at its own sell-out.
 *
 * Audited by the engine, on the parent: `drop.live.after_room.open` (its id, how many guests, when it opens and closes)
 * and `drop.live.after_room.skip` (its id, why: NO_GUESTS, NOT_SOLD_OUT, CANCELLED); never an entry nor an account.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow, LiveEndReason } from '../db/schema.js';
import type { Actor } from '../types.js';
import type { AuditRecordInput } from './audit.js';

/** An after-room opens this long after its parent's sell-out (the plan's choice 2: 10 minutes by default). */
export const AFTER_ROOM_DELAY_MINUTES = Object.freeze({ min: 1, max: 60, default: 10 });
/** An after-room is open this long (15 minutes by default). */
export const AFTER_ROOM_LENGTH_MINUTES = Object.freeze({ min: 5, max: 120, default: 15 });
/** What an after-room's title adds to its parent's (drops.title, at most 120 characters). */
export const AFTER_ROOM_TITLE_SUFFIX = ' · THE AFTER-ROOM';

const TITLE_MAX = 120;
const MINUTE_MS = 60_000;

/** Why an after-room never opened. */
export type AfterRoomSkip = 'NO_GUESTS' | 'NOT_SOLD_OUT' | 'CANCELLED';

/** Whether a release is an after-room. */
export function isAfterRoom(d: Pick<DropRow, 'parent_drop_id'>): boolean {
  return d.parent_drop_id !== null && d.parent_drop_id !== undefined;
}

/** An after-room's title: its parent's, then « · THE AFTER-ROOM », within 120 characters. */
export function afterRoomTitle(parentTitle: string): string {
  const room = TITLE_MAX - AFTER_ROOM_TITLE_SUFFIX.length;
  const base = parentTitle.trim();
  return `${base.length > room ? base.slice(0, room).trimEnd() : base}${AFTER_ROOM_TITLE_SUFFIX}`;
}

/** An after-room's T0 and close, from the moment it counts from (the sell-out; the parent's close for a draft). */
export function afterRoomTimes(from: Date, delayMinutes: number, lengthMinutes: number): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(new Date(from).getTime() + delayMinutes * MINUTE_MS);
  return { opensAt, closesAt: new Date(opensAt.getTime() + lengthMinutes * MINUTE_MS) };
}

/**
 * The after-room of a release whose end begins now, in the transaction that ends it (the parent's row FOR UPDATE, then
 * the after-room's): at a SOLD_OUT, the entries still WAITING or QUEUED (those the sell-out is about to END) remembered as
 * its guests, by place in the line then arrival, and the after-room published at `at`, opened its delay later for its
 * length; without a guest, or for another end, cancelled at `at`. A release without an after-room (or one already
 * settled), and an after-room itself, change nothing. Noted for the audit log, on the parent.
 */
export async function settleAfterRoom(tx: Db, parent: Pick<DropRow, 'id' | 'parent_drop_id'>, reason: LiveEndReason, at: Date, actor: Actor, notes: AuditRecordInput[]): Promise<void> {
  if (isAfterRoom(parent)) return;
  const child = await tx
    .selectFrom('drops')
    .select(['id', 'published_at', 'cancelled_at', 'after_room_delay_minutes', 'after_room_length_minutes'])
    .where('parent_drop_id', '=', parent.id)
    .forUpdate()
    .executeTakeFirst();
  if (!child || child.published_at || child.cancelled_at) return;
  if (reason === 'SOLD_OUT') {
    const guests = await tx
      .selectFrom('live_entries')
      .select('id')
      .where('drop_id', '=', parent.id)
      .where('status', 'in', ['WAITING', 'QUEUED'])
      .orderBy(sql`position IS NULL`)
      .orderBy('position')
      .orderBy('joined_at')
      .orderBy('id')
      .execute();
    if (guests.length > 0) {
      for (let i = 0; i < guests.length; i += 500) {
        await tx
          .insertInto('after_room_guests')
          .values(guests.slice(i, i + 500).map((g, j) => ({ drop_id: child.id, entry_id: g.id, position: i + j + 1, remembered_at: at })))
          .execute();
      }
      const { opensAt, closesAt } = afterRoomTimes(at, child.after_room_delay_minutes!, child.after_room_length_minutes!);
      await tx.updateTable('drops').set({ published_at: at, opens_at: opensAt, closes_at: closesAt }).where('id', '=', child.id).execute();
      notes.push({
        actor,
        action: 'drop.live.after_room.open',
        targetType: 'drop',
        targetId: parent.id,
        details: { afterRoomId: child.id, guests: guests.length, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() },
      });
      return;
    }
  }
  await skip(tx, parent.id, child.id, reason === 'SOLD_OUT' ? 'NO_GUESTS' : 'NOT_SOLD_OUT', at, actor, notes);
}

/** The after-room of a release the console cancels: cancelled with it, never opened (the parent's row FOR UPDATE already). */
export async function cancelAfterRoom(tx: Db, parentId: string, at: Date, actor: Actor, notes: AuditRecordInput[]): Promise<void> {
  const child = await tx.selectFrom('drops').select(['id', 'published_at', 'cancelled_at']).where('parent_drop_id', '=', parentId).forUpdate().executeTakeFirst();
  if (!child || child.published_at || child.cancelled_at) return;
  await skip(tx, parentId, child.id, 'CANCELLED', at, actor, notes);
}

async function skip(tx: Db, parentId: string, childId: string, why: AfterRoomSkip, at: Date, actor: Actor, notes: AuditRecordInput[]): Promise<void> {
  await tx.updateTable('drops').set({ cancelled_at: at }).where('id', '=', childId).execute();
  notes.push({ actor, action: 'drop.live.after_room.skip', targetType: 'drop', targetId: parentId, details: { afterRoomId: childId, reason: why } });
}

export type AfterRoomRow = Pick<DropRow, 'id' | 'parent_drop_id' | 'published_at' | 'cancelled_at' | 'opens_at'>;

/**
 * The place an account keeps in an after-room it may see at `now`: the after-room published at its parent's sell-out,
 * not cancelled, its T0 passed, and the account one of its guests. Null otherwise: it is then an unknown release.
 */
export async function afterRoomPlace(db: Db, d: AfterRoomRow, accountId: string, now: Date): Promise<number | null> {
  if (!isAfterRoom(d) || !d.published_at || d.cancelled_at || now.getTime() < new Date(d.opens_at).getTime()) return null;
  const g = await db
    .selectFrom('after_room_guests as g')
    .innerJoin('live_entries as e', 'e.id', 'g.entry_id')
    .select('g.position')
    .where('g.drop_id', '=', d.id)
    .where('e.account_id', '=', accountId)
    .executeTakeFirst();
  return g?.position ?? null;
}

/** The second door, as the release's page shows it to one of the after-room's guests: when it appears, when it closes. */
export interface AfterRoomDoor {
  /** The after-room's T0: the door appears then. */
  opensAt: Date;
  closesAt: Date;
}

/**
 * The second door of each of these entries of a release that is a guest of its after-room, once the sell-out has opened
 * it and until it ends (its own sell-out, an END; its close is said by `closesAt`): by entry id. One read for all of them
 * (the room's viewers, once a second): an entry's own, never anyone else's.
 */
export async function afterRoomDoors(db: Db, entryIds: readonly string[]): Promise<Map<string, AfterRoomDoor>> {
  const out = new Map<string, AfterRoomDoor>();
  for (let i = 0; i < entryIds.length; i += 1000) {
    const rows = await db
      .selectFrom('after_room_guests as g')
      .innerJoin('drops as d', 'd.id', 'g.drop_id')
      .select(['g.entry_id', 'd.opens_at', 'd.closes_at'])
      .where('g.entry_id', 'in', entryIds.slice(i, i + 1000))
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.ended_at', 'is', null)
      .execute();
    for (const r of rows) out.set(r.entry_id, { opensAt: r.opens_at, closesAt: r.closes_at });
  }
  return out;
}
