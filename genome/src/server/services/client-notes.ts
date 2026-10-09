/**
 * Tags and private notes on the client sheet (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.3 and C.9, step 5.2;
 * migration 0044): what ORBES Client Services keeps about a client, never shown to the client, never in the app and
 * never in the right-of-access export (§3.0 (k)). Read by every console role that reaches the sheet (AUDITOR and up),
 * written by OPERATOR and ADMIN (the routes' guard); a note removed by its writer or an ADMIN.
 *
 *   notes        the notes not removed, the newest first: the NOTES_SHOWN newest and how many there are, or every one.
 *   addNote      a note of 1 to 2,000 characters (`cleanNote`), audited `account.note.add` with its id and length.
 *   removeNote   by its writer or an ADMIN (403 NOTE_NOT_YOURS otherwise): hidden, never deleted (`removed_at`,
 *                `removed_by`), so the audit entry `account.note.remove` still names a row. Twice changes nothing.
 *   tags         the account's tags, in the order they were added.
 *   addTag       a tag in capitals (`cleanTag`), at most TAG_LIMIT per account (409 TAG_LIMIT); one the account already
 *                carries changes nothing. Audited `account.tag.add` with the tag.
 *   removeTag    a deleted row, audited `account.tag.remove` with the tag; one it does not carry changes nothing.
 *   suggestions  the tags in use on any account, the most used first (SUGGESTIONS_MAX); while none is used, the three
 *                starting examples (VIP, PRESS, FRIEND OF THE HOUSE), suggested only, never created in advance.
 *
 * Each write takes the account's row first (FOR SHARE; FOR UPDATE for a tag added, so two adds at 19 wait for each
 * other and the bound holds), then its own rows: the same order as the profile's saves and H2's addresses, so nothing
 * deadlocks. A DELETED account is never written (409 ACCOUNT_DELETED); a LOCKED one is, since a lock stops the client,
 * not Client Services. A note's or a tag's words go to the audit log only as a tag (a house label) or a note's length:
 * a note may name personal facts, and the audit log can never be erased.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isCheckViolation } from '../db/pg-errors.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { accountDeleted } from './profiles.js';

/** The tags a client carries at most. */
export const TAG_LIMIT = 20;
/** A tag's length, in characters (migration 0044 `account_tags_tag`). */
export const TAG_MAX = 32;
/** A note's length, in characters (migration 0044 `account_notes_body`). */
export const NOTE_MAX = 2000;
/** The notes the sheet shows before « Show the … older notes ». */
export const NOTES_SHOWN = 50;
/** The suggestions offered at most. */
export const SUGGESTIONS_MAX = 50;
/** Suggested while no tag is used anywhere: the owner's three examples. */
export const STARTING_TAGS: readonly string[] = Object.freeze(['VIP', 'PRESS', 'FRIEND OF THE HOUSE']);

/** A private note as the client sheet reads it. */
export interface PrivateNote {
  id: string;
  text: string;
  at: Date;
  /** The writer's console email; null for a script. */
  by: string | null;
  /** The writer's console id (the sheet offers Remove to its writer); null for a script. */
  byId: string | null;
}

/** The notes not removed, the newest first, and how many there are. */
export interface PrivateNotes {
  items: PrivateNote[];
  total: number;
}

/** A tag offered as you type, with the accounts that carry it (0 for a starting example). */
export interface TagSuggestion {
  tag: string;
  accounts: number;
}

// ── Errors ─────────────────────────────────────────────────────────────────

export const noteNotFound = () => notFound('Note', 'NOTE_NOT_FOUND');
export const noteNotYours = () => new DomainError('NOTE_NOT_YOURS', 403, 'Only the note’s writer or an ADMIN removes it.');
export const tagLimit = () => conflict('TAG_LIMIT', `A client carries at most ${TAG_LIMIT} tags.`);
const tagRefused = () => validationError('A tag is 1 to 32 letters, digits or spaces (and & ’ - .).');
const noteLength = () => validationError('A note is 1 to 2,000 characters.');

// ── Cleaning ───────────────────────────────────────────────────────────────

/** Letters of any script, figures, spaces and & ' ’ . - (migration 0044 `account_tags_tag`). */
const TAG_RE = /^[\p{L}\p{Nd} &'’.-]+$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Control characters but the line break and the tab, which a note keeps. */
const NOTE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * A tag as it is stored: its spaces collapsed and trimmed, in capitals (« friend  of the house » → « FRIEND OF THE
 * HOUSE »), 1 to 32 letters of any script, figures, spaces and & ' ’ . -. Refused: 400 'A tag is 1 to 32 letters,
 * digits or spaces (and & ’ - .).' Shared with Segments' TAGGED.
 */
export function cleanTag(v: unknown): string {
  if (typeof v !== 'string') throw tagRefused();
  const tag = v.normalize('NFC').replace(/\s+/gu, ' ').trim().toUpperCase().normalize('NFC');
  const length = [...tag].length;
  if (length < 1 || length > TAG_MAX || !TAG_RE.test(tag)) throw tagRefused();
  return tag;
}

/**
 * A note as it is stored: its line breaks kept (« \r\n » made « \n »), trimmed, 1 to 2,000 characters. Refused: 400 'A
 * note is 1 to 2,000 characters.', or 'A note contains characters that cannot be kept.' for a control character.
 */
export function cleanNote(v: unknown): string {
  if (typeof v !== 'string') throw noteLength();
  const text = v.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const length = [...text].length;
  if (length < 1 || length > NOTE_MAX) throw noteLength();
  if (NOTE_CONTROL.test(text)) throw validationError('A note contains characters that cannot be kept.');
  return text;
}

function knownAccount(accountId: unknown): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

/** The console login behind a write, or null for a script. */
const writer = (actor: Actor): string | null => (actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null);

/** The account's row, locked for a write: 404 when unknown, 409 ACCOUNT_DELETED when deleted; LOCKED is written. */
async function lockAccount(tx: Db, accountId: string, mode: 'share' | 'update'): Promise<void> {
  const q = tx.selectFrom('accounts').select('status').where('id', '=', accountId);
  const account = await (mode === 'update' ? q.forUpdate() : q.forShare()).executeTakeFirst();
  if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  if (account.status === 'DELETED') throw accountDeleted();
}

/**
 * A private note written in `tx` and audited `account.note.add` with its id and length, never its words: the one
 * insert of ClientNoteService.addNote and of ProfileService.setBirthDateByStaff (the reason of a date of birth
 * changed). The account's row must already be locked by the caller. Returns the note's id.
 */
export async function insertNote(tx: Db, audit: AuditService, accountId: string, text: string, actor: Actor, now: Date): Promise<string> {
  const row = await tx.insertInto('account_notes').values({ account_id: accountId, body: text, created_by: writer(actor), created_at: now }).returning('id').executeTakeFirstOrThrow();
  await audit.record({ actor, action: 'account.note.add', targetType: 'account', targetId: accountId, details: { noteId: row.id, length: [...text].length } }, tx);
  return row.id;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface ClientNoteServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class ClientNoteService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: ClientNoteServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  private async exists(db: Db, accountId: string): Promise<void> {
    if (!(await db.selectFrom('accounts').select('id').where('id', '=', accountId).executeTakeFirst())) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  }

  // ── Private notes ──────────────────────────────────────────────────────

  /** The notes not removed, the newest first: the NOTES_SHOWN newest, or every one with `all`; and how many there are. */
  async notes(accountId: string, { all = false }: { all?: boolean } = {}, db: Db = this.db): Promise<PrivateNotes> {
    const id = knownAccount(accountId);
    await this.exists(db, id);
    let q = db
      .selectFrom('account_notes as n')
      .leftJoin('admin_users as u', 'u.id', 'n.created_by')
      .select(['n.id', 'n.body', 'n.created_at', 'n.created_by', 'u.email'])
      .where('n.account_id', '=', id)
      .where('n.removed_at', 'is', null)
      .orderBy('n.created_at', 'desc')
      .orderBy('n.id', 'desc');
    if (!all) q = q.limit(NOTES_SHOWN);
    const [rows, count] = await Promise.all([
      q.execute(),
      db.selectFrom('account_notes').select((eb) => eb.fn.countAll<number>().as('n')).where('account_id', '=', id).where('removed_at', 'is', null).executeTakeFirstOrThrow(),
    ]);
    return { items: rows.map((r) => ({ id: r.id, text: r.body, at: r.created_at, by: r.email ?? null, byId: r.created_by })), total: Number(count.n) };
  }

  /** Add a private note (OPERATOR, ADMIN): see `cleanNote`; a DELETED account 409. Answers the note. */
  async addNote(accountId: string, text: unknown, actor: Actor): Promise<PrivateNote> {
    const id = knownAccount(accountId);
    const body = cleanNote(text);
    const noteId = await inTransaction(this.db, async (tx) => {
      await lockAccount(tx, id, 'share');
      return insertNote(tx, this.audit, id, body, actor, this.clock());
    });
    const row = await this.db
      .selectFrom('account_notes as n')
      .leftJoin('admin_users as u', 'u.id', 'n.created_by')
      .select(['n.id', 'n.body', 'n.created_at', 'n.created_by', 'u.email'])
      .where('n.id', '=', noteId)
      .executeTakeFirstOrThrow();
    return { id: row.id, text: row.body, at: row.created_at, by: row.email ?? null, byId: row.created_by };
  }

  /**
   * Remove a note of the account (its writer, or an ADMIN): hidden with who and when, the row kept. 404 NOTE_NOT_FOUND
   * when the account has no such note; 403 NOTE_NOT_YOURS for another OPERATOR; removed already, nothing changes.
   */
  async removeNote(accountId: string, noteId: string, actor: Actor): Promise<void> {
    const id = knownAccount(accountId);
    if (typeof noteId !== 'string' || !UUID_RE.test(noteId)) throw noteNotFound();
    const by = writer(actor);
    await inTransaction(this.db, async (tx) => {
      await lockAccount(tx, id, 'share');
      const note = await tx.selectFrom('account_notes').select(['id', 'created_by', 'removed_at']).where('id', '=', noteId.toLowerCase()).where('account_id', '=', id).forUpdate().executeTakeFirst();
      if (!note) throw noteNotFound();
      if (note.removed_at !== null) return;
      if (by === null) throw noteNotYours();
      if (note.created_by !== by) {
        const role = await tx.selectFrom('admin_users').select('role').where('id', '=', by).executeTakeFirst();
        if (role?.role !== 'ADMIN') throw noteNotYours();
      }
      const removed = await tx
        .updateTable('account_notes')
        .set({ removed_at: this.clock(), removed_by: by })
        .where('id', '=', note.id)
        .where('removed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (removed) await this.audit.record({ actor, action: 'account.note.remove', targetType: 'account', targetId: id, details: { noteId: note.id } }, tx);
    });
  }

  // ── Tags ───────────────────────────────────────────────────────────────

  /** The account's tags, in the order they were added. */
  async tags(accountId: string, db: Db = this.db): Promise<string[]> {
    const id = knownAccount(accountId);
    await this.exists(db, id);
    return accountTags(db, id);
  }

  /**
   * Add a tag (OPERATOR, ADMIN): see `cleanTag`; one the account carries changes nothing (`added` false); the 21st 409
   * TAG_LIMIT, checked after the insert under the account's row FOR UPDATE. Answers the account's tags.
   */
  async addTag(accountId: string, tag: unknown, actor: Actor): Promise<{ tags: string[]; added: boolean }> {
    const id = knownAccount(accountId);
    const value = cleanTag(tag);
    try {
      return await inTransaction(this.db, async (tx) => {
        await lockAccount(tx, id, 'update');
        const inserted = await tx
          .insertInto('account_tags')
          .values({ account_id: id, tag: value, created_by: writer(actor), created_at: this.clock() })
          .onConflict((oc) => oc.columns(['account_id', 'tag']).doNothing())
          .returning('tag')
          .executeTakeFirst();
        if (inserted) {
          const count = await tx.selectFrom('account_tags').select((eb) => eb.fn.countAll<number>().as('n')).where('account_id', '=', id).executeTakeFirstOrThrow();
          if (Number(count.n) > TAG_LIMIT) throw tagLimit();
          await this.audit.record({ actor, action: 'account.tag.add', targetType: 'account', targetId: id, details: { tag: value } }, tx);
        }
        return { tags: await accountTags(tx, id), added: inserted !== undefined };
      });
    } catch (e) {
      // A letter the database's [[:alnum:]] does not take (cleanTag already refuses what it can name).
      if (isCheckViolation(e, 'account_tags_tag')) throw tagRefused();
      throw e;
    }
  }

  /** Remove a tag (OPERATOR, ADMIN): the row deleted, audited; one the account does not carry changes nothing. */
  async removeTag(accountId: string, tag: unknown, actor: Actor): Promise<void> {
    const id = knownAccount(accountId);
    const value = cleanTag(tag);
    await inTransaction(this.db, async (tx) => {
      await lockAccount(tx, id, 'share');
      const removed = await tx.deleteFrom('account_tags').where('account_id', '=', id).where('tag', '=', value).returning('tag').executeTakeFirst();
      if (removed) await this.audit.record({ actor, action: 'account.tag.remove', targetType: 'account', targetId: id, details: { tag: value } }, tx);
    });
  }

  /** The tags in use, the most used first (then by their words), SUGGESTIONS_MAX at most; the starting three while none is used. */
  async suggestions(db: Db = this.db): Promise<TagSuggestion[]> {
    const rows = await sql<{ tag: string; accounts: number }>`
      SELECT tag, count(*)::int AS accounts FROM account_tags GROUP BY tag ORDER BY accounts DESC, tag LIMIT ${SUGGESTIONS_MAX}`.execute(db);
    if (rows.rows.length === 0) return STARTING_TAGS.map((tag) => ({ tag, accounts: 0 }));
    return rows.rows.map((r) => ({ tag: r.tag, accounts: Number(r.accounts) }));
  }
}

/** An account's tags, in the order they were added (then by their words). */
export async function accountTags(db: Db, accountId: string): Promise<string[]> {
  const rows = await db.selectFrom('account_tags').select('tag').where('account_id', '=', accountId).orderBy('created_at').orderBy('tag').execute();
  return rows.map((r) => r.tag);
}
