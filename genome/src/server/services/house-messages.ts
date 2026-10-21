/**
 * House messages, the collector's side (macro scope of 2026-10-20, D24 M3 and M4; lot M2 plan §1.4, step M2.2): what
 * ORBES wrote to an account, in MESSAGES only (never `client_conversations`: they never reach the Messages board, never
 * make a conversation TO_ANSWER, and no reply is written under them), read-only. Two sources (`house_deliveries`,
 * migration 0052): a moment (services/house-moments.ts), its title and words rendered at delivery and stored with it; a
 * custom message written by staff (lot M2 step M2.3), its words read from the message itself, {firstName} filled at
 * reading.
 *
 *   list        GET /api/v1/account/house-messages?page=: the account's, newest first, 30 a page, each with whether it
 *               is unread, with how many are unread and how many there are in all.
 *   markRead    POST /api/v1/account/house-messages/read {upTo}: read up to a time, never later than now.
 *   unread      whether one is unread (GET /api/v1/account/messages/unread's `house`: NOW's line and the sheet's NEW).
 *   unreadCount how many are unread (GET /api/v1/account/messages/unread-count adds them to the answers unread).
 *
 * Kept with the account, as messages are: never deleted (the table refuses it), in its export (`accountHouseMessages`)
 * with when each was read. A lock leaves them as they are; a LOCKED account receives nothing new.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { HouseDeliverySource, HouseMoment } from '../db/schema.js';
import { notFound, validationError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { renderHouseWords } from '../../shared/house-words.js';

/** House messages a page of MESSAGES shows. */
export const HOUSE_PAGE_SIZE = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

/** A house message as its collector reads it. */
export interface CollectorHouseMessage {
  id: string;
  source: HouseDeliverySource;
  /** A moment's kind (its links are fixed by it: src/shared/house-words.ts HOUSE_MOMENT_LINKS); null for a custom message. */
  moment: HouseMoment | null;
  title: string;
  body: string;
  /** The piece a first registration or a year of ownership names, by its serial; null otherwise. */
  pieceRef: string | null;
  /** Whether the account still holds that piece (its link then opens the piece, else MY PIECES); null without a piece. */
  pieceHeld: boolean | null;
  at: Date;
  unread: boolean;
}

/** GET /api/v1/account/house-messages. */
export interface CollectorHousePage {
  messages: CollectorHouseMessage[];
  /** How many of the account's house messages are unread, on every page. */
  unread: number;
  /** How many the account has in all. */
  total: number;
}

/** A house message in the account's export (right of access): as its collector reads it, with when it was read. */
export interface ExportedHouseMessage {
  source: HouseDeliverySource;
  moment: HouseMoment | null;
  title: string;
  body: string;
  pieceRef: string | null;
  deliveredAt: Date;
  readAt: Date | null;
}

interface Row {
  id: string;
  source: HouseDeliverySource;
  moment: HouseMoment | null;
  title: string | null;
  body: string | null;
  piece_ref: string | null;
  delivered_at: Date;
  read_at: Date | null;
  custom_title: string | null;
  custom_body: string | null;
  first_name: string | null;
  held: boolean | null;
}

/** The account's deliveries with their words (a custom message's from the message), newest first unless `oldestFirst`. */
function rows(db: Db, accountId: string, opts: { limit?: number; offset?: number; oldestFirst?: boolean } = {}) {
  const order = opts.oldestFirst ? sql`d.delivered_at ASC, d.id ASC` : sql`d.delivered_at DESC, d.id DESC`;
  return sql<Row>`
    SELECT d.id, d.source, d.moment, d.title, d.body, d.piece_ref, d.delivered_at, d.read_at,
           hm.title AS custom_title, hm.body AS custom_body, pr.first_name,
           CASE WHEN d.piece_ref IS NULL THEN NULL ELSE EXISTS (
             SELECT 1 FROM ownership o JOIN products p ON p.id = o.product_id
              WHERE p.product_id = d.piece_ref AND o.account_id = d.account_id AND o.ended_at IS NULL) END AS held
      FROM house_deliveries d
      LEFT JOIN house_messages hm ON hm.id = d.house_message_id
      LEFT JOIN account_profiles pr ON pr.account_id = d.account_id
     WHERE d.account_id = ${accountId}
     ORDER BY ${order}
     ${opts.limit !== undefined ? sql`LIMIT ${opts.limit} OFFSET ${opts.offset ?? 0}` : sql``}`.execute(db);
}

/** A delivery's title and words as read: a moment's as stored, a custom message's with {firstName} filled now. */
function wordsOf(r: Row): { title: string; body: string } {
  if (r.source === 'MOMENT') return { title: r.title ?? '', body: r.body ?? '' };
  const values = { firstName: r.first_name };
  return { title: renderHouseWords(r.custom_title ?? '', values).replace(/\s+/g, ' ').trim(), body: renderHouseWords(r.custom_body ?? '', values).trim() };
}

/** Every house message of the account, oldest first, as its export gives it. */
export async function accountHouseMessages(db: Db, accountId: string): Promise<ExportedHouseMessage[]> {
  const r = await rows(db, accountId, { oldestFirst: true });
  return r.rows.map((x) => ({ source: x.source, moment: x.moment, ...wordsOf(x), pieceRef: x.piece_ref, deliveredAt: x.delivered_at, readAt: x.read_at }));
}

export interface HouseMessageServiceDeps {
  db: Db;
  clock?: Clock;
}

export class HouseMessageService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: HouseMessageServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** A page of the account's house messages, newest first (page 1 the newest), with the unread count and the total. */
  async list(accountId: string, page = 1): Promise<CollectorHousePage> {
    const account = assertAccount(accountId);
    const p = Number.isInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1;
    const counts = await this.db
      .selectFrom('house_deliveries')
      .select((eb) => [eb.fn.countAll<string | number>().as('total'), eb.fn.count<string | number>('id').filterWhere('read_at', 'is', null).as('unread')])
      .where('account_id', '=', account)
      .executeTakeFirstOrThrow();
    const r = await rows(this.db, account, { limit: HOUSE_PAGE_SIZE, offset: (p - 1) * HOUSE_PAGE_SIZE });
    return {
      messages: r.rows.map((x) => ({
        id: x.id,
        source: x.source,
        moment: x.moment,
        ...wordsOf(x),
        pieceRef: x.piece_ref,
        pieceHeld: x.held,
        at: x.delivered_at,
        unread: x.read_at === null,
      })),
      unread: Number(counts.unread),
      total: Number(counts.total),
    };
  }

  /** Whether a house message is unread (NOW's line, the account's NEW). */
  async unread(accountId: string): Promise<{ house: boolean }> {
    const account = assertAccount(accountId);
    const r = await this.db.selectFrom('house_deliveries').select('id').where('account_id', '=', account).where('read_at', 'is', null).limit(1).executeTakeFirst();
    return { house: r !== undefined };
  }

  /** How many house messages are unread. */
  async unreadCount(accountId: string): Promise<number> {
    const account = assertAccount(accountId);
    const r = await this.db
      .selectFrom('house_deliveries')
      .select((eb) => eb.fn.countAll<string | number>().as('n'))
      .where('account_id', '=', account)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The collector has read its house messages delivered up to `upTo` (never later than now); a read one stays read. */
  async markRead(accountId: string, upTo: Date): Promise<void> {
    const account = assertAccount(accountId);
    if (!(upTo instanceof Date) || Number.isNaN(upTo.getTime())) throw validationError('upTo must be a date-time.');
    const now = this.clock();
    const at = new Date(Math.min(upTo.getTime(), now.getTime()));
    await this.db
      .updateTable('house_deliveries')
      .set({ read_at: at })
      .where('account_id', '=', account)
      .where('read_at', 'is', null)
      .where('delivered_at', '<=', at)
      .execute();
  }
}
