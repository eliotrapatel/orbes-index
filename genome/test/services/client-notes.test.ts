/**
 * Tags and private notes on the client sheet (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.9, C.11 and C.13, step 5.2;
 * services/client-notes.ts; migration 0044):
 *
 *  - `cleanTag` (capitals, spaces collapsed, the signs, 32 at most, refusals) and `cleanNote` (1 to 2,000, trimmed, line
 *    breaks kept);
 *  - notes added and removed, with their audits (the note's id and length, never its words); the 50 newest and how many,
 *    or every one; removed by its writer or an ADMIN, another OPERATOR 403 NOTE_NOT_YOURS, twice a no-op;
 *  - tags added and removed, with their audits; the same tag twice is one row and one audit; the 21st 409 TAG_LIMIT, and
 *    two adds racing at 19 leave 20 (PGlite always; PostgreSQL with ORBES_TEST_POSTGRES_URL, a pool of 8: true
 *    parallelism, in genome-ci);
 *  - a DELETED account 409 ACCOUNT_DELETED, a LOCKED one written;
 *  - the suggestions: the most used first, the three starting examples only while no tag is used.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { ClientNoteService, cleanNote, cleanTag, NOTES_SHOWN, STARTING_TAGS, TAG_LIMIT } from '../../src/server/services/client-notes.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';

async function refusal(p: Promise<unknown> | (() => unknown)): Promise<{ code: string; status: number; message: string }> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_notes_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

async function account(db: Db, status: 'ACTIVE' | 'LOCKED' | 'DELETED' = 'ACTIVE'): Promise<string> {
  const email = `notes-${randomUUID()}@example.com`;
  return (await db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused', status }).returning('id').executeTakeFirstOrThrow()).id;
}

async function staff(db: Db, role: 'OPERATOR' | 'ADMIN' | 'AUDITOR' = 'OPERATOR'): Promise<Actor & { email: string }> {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@orbes.test`;
  const id = (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role }).returning('id').executeTakeFirstOrThrow()).id;
  return { type: 'admin', id, email };
}

describe('cleanTag and cleanNote', () => {
  it('cleanTag: capitals, spaces collapsed and trimmed, letters of any script, figures and & \' ’ . -, 1 to 32', () => {
    expect(cleanTag('vip')).toBe('VIP');
    expect(cleanTag('  friend   of the\thouse ')).toBe('FRIEND OF THE HOUSE');
    expect(cleanTag('friend of the house’s')).toBe('FRIEND OF THE HOUSE’S');
    expect(cleanTag("a & b - st. john's")).toBe("A & B - ST. JOHN'S");
    expect(cleanTag('presse écrite')).toBe('PRESSE ÉCRITE');
    expect(cleanTag('пресса')).toBe('ПРЕССА');
    expect(cleanTag('2026')).toBe('2026');
    expect(cleanTag('x'.repeat(32))).toBe('X'.repeat(32));
    const words = 'A tag is 1 to 32 letters, digits or spaces (and & ’ - .).';
    for (const bad of ['', '   ', 'x'.repeat(33), 'VIP!', '<b>', 'VIP/PRESS', '#vip', '😀', 12, null, undefined, ['VIP']]) {
      expect(() => cleanTag(bad), String(bad)).toThrow(words);
    }
  });

  it('cleanNote: trimmed, line breaks kept, 1 to 2,000 characters', () => {
    expect(cleanNote('  Called the client.\r\nShe prefers the evening.  ')).toBe('Called the client.\nShe prefers the evening.');
    expect(cleanNote('é'.repeat(2000))).toHaveLength(2000);
    const words = 'A note is 1 to 2,000 characters.';
    for (const bad of ['', ' \n ', 'x'.repeat(2001), 42, null]) expect(() => cleanNote(bad), String(bad).slice(0, 20)).toThrow(words);
    expect(() => cleanNote('Called\u0000.')).toThrow('A note contains characters that cannot be kept.');
  });
});

describe('ClientNoteService (plan CUSTOMER INTELLIGENCE §3.6 C.4.3)', () => {
  let db: Db;
  let close: () => Promise<void>;
  const clock = createManualClock('2026-10-09T09:00:00.000Z');
  let notes: ClientNoteService;
  let op: Actor & { email: string };
  let other: Actor & { email: string };
  let admin: Actor & { email: string };

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = () => t.close();
    notes = new ClientNoteService({ db, audit: new AuditService({ db, clock: clock.now }), clock: clock.now });
    op = await staff(db);
    other = await staff(db);
    admin = await staff(db, 'ADMIN');
  });
  afterAll(() => close?.());

  const audits = (accountId: string) =>
    db.selectFrom('audit_logs').select(['action', 'actor_id', 'details']).where('target_id', '=', accountId).where('action', 'like', 'account.%').orderBy('id').execute();

  it('suggests the three starting examples while no tag is used, then the tags in use, the most used first', async () => {
    expect(await notes.suggestions()).toEqual(STARTING_TAGS.map((tag) => ({ tag, accounts: 0 })));
    expect(STARTING_TAGS).toEqual(['VIP', 'PRESS', 'FRIEND OF THE HOUSE']);
    // Suggestions only: nothing was created.
    expect(await db.selectFrom('account_tags').selectAll().execute()).toEqual([]);
    const [a, b, c] = [await account(db), await account(db), await account(db)];
    for (const id of [a, b, c]) await notes.addTag(id, 'collector', op);
    for (const id of [a, b]) await notes.addTag(id, 'press', op);
    await notes.addTag(a, 'zinc', op);
    await notes.addTag(b, 'press day', op);
    expect(await notes.suggestions()).toEqual([
      { tag: 'COLLECTOR', accounts: 3 },
      { tag: 'PRESS', accounts: 2 },
      { tag: 'PRESS DAY', accounts: 1 },
      { tag: 'ZINC', accounts: 1 },
    ]);
    await db.deleteFrom('account_tags').execute();
  });

  it('adds a tag once: the same tag twice is one row and one audit; removes it, audited; a tag it does not carry changes nothing', async () => {
    const a = await account(db);
    expect(await notes.addTag(a, 'vip', op)).toEqual({ tags: ['VIP'], added: true });
    clock.advance(1000);
    expect(await notes.addTag(a, ' VIP ', other)).toEqual({ tags: ['VIP'], added: false });
    clock.advance(1000);
    expect(await notes.addTag(a, 'friend  of the house', op)).toEqual({ tags: ['VIP', 'FRIEND OF THE HOUSE'], added: true });
    expect(await db.selectFrom('account_tags').select(['tag', 'created_by']).where('account_id', '=', a).orderBy('created_at').execute()).toEqual([
      { tag: 'VIP', created_by: op.id },
      { tag: 'FRIEND OF THE HOUSE', created_by: op.id },
    ]);
    await notes.removeTag(a, 'vip', other);
    await notes.removeTag(a, 'VIP', other);
    await notes.removeTag(a, 'PRESS', other);
    expect(await notes.tags(a)).toEqual(['FRIEND OF THE HOUSE']);
    expect(await audits(a)).toEqual([
      { action: 'account.tag.add', actor_id: op.id, details: { tag: 'VIP' } },
      { action: 'account.tag.add', actor_id: op.id, details: { tag: 'FRIEND OF THE HOUSE' } },
      { action: 'account.tag.remove', actor_id: other.id, details: { tag: 'VIP' } },
    ]);
    expect(await refusal(notes.addTag(a, 'VIP!', op))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'A tag is 1 to 32 letters, digits or spaces (and & ’ - .).' });
    expect(await refusal(notes.addTag(randomUUID(), 'VIP', op))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
    expect(await refusal(notes.tags('not-an-id'))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('refuses the 21st tag (409 TAG_LIMIT) and writes nothing of it', async () => {
    const a = await account(db);
    for (let i = 1; i <= TAG_LIMIT; i++) await notes.addTag(a, `tag ${i}`, op);
    expect(await refusal(notes.addTag(a, 'one more', op))).toEqual({ code: 'TAG_LIMIT', status: 409, message: 'A client carries at most 20 tags.' });
    expect(await notes.tags(a)).toHaveLength(TAG_LIMIT);
    // One it already carries is not a 21st.
    expect(await notes.addTag(a, 'tag 1', op)).toMatchObject({ added: false });
    expect((await audits(a)).filter((x) => x.action === 'account.tag.add')).toHaveLength(TAG_LIMIT);
  });

  it('adds a note and reads the notes not removed, the newest first: the 50 newest and how many, or every one', async () => {
    const a = await account(db);
    const first = await notes.addNote(a, '  Prefers to be called in the evening.\r\nAsk for Camille.  ', op);
    expect(first).toEqual({ id: expect.any(String), text: 'Prefers to be called in the evening.\nAsk for Camille.', at: clock.now(), by: op.email, byId: op.id });
    expect(await audits(a)).toEqual([{ action: 'account.note.add', actor_id: op.id, details: { noteId: first.id, length: 53 } }]);
    // The audit never holds the words.
    expect(JSON.stringify(await audits(a))).not.toContain('evening');
    for (let i = 1; i <= NOTES_SHOWN + 5; i++) {
      clock.advance(60_000);
      await notes.addNote(a, `Note ${i}.`, i % 2 ? op : admin);
    }
    const shown = await notes.notes(a);
    expect(shown.total).toBe(NOTES_SHOWN + 6);
    expect(shown.items).toHaveLength(NOTES_SHOWN);
    expect(shown.items[0]).toMatchObject({ text: `Note ${NOTES_SHOWN + 5}.`, by: op.email });
    expect(shown.items[1]).toMatchObject({ by: admin.email, byId: admin.id });
    const all = await notes.notes(a, { all: true });
    expect(all.items).toHaveLength(NOTES_SHOWN + 6);
    expect(all.items.at(-1)).toEqual(first);
    // A script's note names no one.
    const script = await notes.addNote(a, 'Imported.', { type: 'system' });
    expect(script).toMatchObject({ by: null, byId: null });
    expect(await refusal(notes.addNote(a, '', op))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'A note is 1 to 2,000 characters.' });
    expect(await refusal(notes.addNote(a, 'x'.repeat(2001), op))).toMatchObject({ message: 'A note is 1 to 2,000 characters.' });
    expect(await refusal(notes.notes(randomUUID()))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND', status: 404 });
  });

  it('removes a note by its writer or an ADMIN, never another OPERATOR (403 NOTE_NOT_YOURS); hidden, the row kept; twice a no-op', async () => {
    const a = await account(db);
    const mine = await notes.addNote(a, 'Mine.', op);
    const theirs = await notes.addNote(a, 'Theirs.', other);
    expect(await refusal(notes.removeNote(a, theirs.id, op))).toEqual({ code: 'NOTE_NOT_YOURS', status: 403, message: 'Only the note’s writer or an ADMIN removes it.' });
    clock.advance(1000);
    await notes.removeNote(a, mine.id, op);
    await notes.removeNote(a, theirs.id, admin);
    // Twice: nothing, by anyone.
    await notes.removeNote(a, mine.id, other);
    await notes.removeNote(a, theirs.id, admin);
    expect((await notes.notes(a)).items).toEqual([]);
    expect(await db.selectFrom('account_notes').select(['body', 'removed_by']).where('account_id', '=', a).orderBy('created_at').orderBy('body').execute()).toEqual([
      { body: 'Mine.', removed_by: op.id },
      { body: 'Theirs.', removed_by: admin.id },
    ]);
    expect((await audits(a)).filter((x) => x.action === 'account.note.remove')).toEqual([
      { action: 'account.note.remove', actor_id: op.id, details: { noteId: mine.id } },
      { action: 'account.note.remove', actor_id: admin.id, details: { noteId: theirs.id } },
    ]);
    // Another account's note, or none: 404.
    const b = await account(db);
    const elsewhere = await notes.addNote(b, 'Elsewhere.', op);
    expect(await refusal(notes.removeNote(a, elsewhere.id, op))).toEqual({ code: 'NOTE_NOT_FOUND', status: 404, message: 'Note not found.' });
    expect(await refusal(notes.removeNote(a, randomUUID(), op))).toMatchObject({ code: 'NOTE_NOT_FOUND' });
    expect(await refusal(notes.removeNote(a, 'nope', op))).toMatchObject({ code: 'NOTE_NOT_FOUND' });
  });

  it('writes on a LOCKED account, never on a DELETED one (409 ACCOUNT_DELETED), which still reads', async () => {
    const locked = await account(db, 'LOCKED');
    await notes.addTag(locked, 'vip', op);
    const note = await notes.addNote(locked, 'Locked after a lost card.', op);
    await notes.removeNote(locked, note.id, op);
    await notes.removeTag(locked, 'vip', op);
    const deleted = await account(db);
    await notes.addTag(deleted, 'press', op);
    const kept = await notes.addNote(deleted, 'Before the deletion.', op);
    await db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', deleted).execute();
    const gone = { code: 'ACCOUNT_DELETED', status: 409, message: 'This account is deleted.' };
    expect(await refusal(notes.addTag(deleted, 'vip', op))).toEqual(gone);
    expect(await refusal(notes.removeTag(deleted, 'press', op))).toEqual(gone);
    expect(await refusal(notes.addNote(deleted, 'After.', op))).toEqual(gone);
    expect(await refusal(notes.removeNote(deleted, kept.id, op))).toEqual(gone);
    expect(await notes.tags(deleted)).toEqual(['PRESS']);
    expect((await notes.notes(deleted)).items.map((n) => n.text)).toEqual(['Before the deletion.']);
  });
});

/** Every outcome of a batch of calls made together: 'ok' or the code of the refusal. */
async function together(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((s) => {
    if (s.status === 'fulfilled') return 'ok';
    if (s.reason instanceof DomainError) return s.reason.code;
    throw s.reason;
  });
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`Tags under concurrency, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    const clock = createManualClock('2026-10-09T09:00:00.000Z');
    let notes: ClientNoteService;
    let op: Actor;

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      notes = new ClientNoteService({ db, audit: new AuditService({ db, clock: clock.now }), clock: clock.now });
      op = await staff(db);
    }, 60_000);
    afterAll(() => close?.());

    it('two adds racing at 19 tags leave 20: one added, the other 409 TAG_LIMIT', async () => {
      const a = await account(db);
      for (let i = 1; i < TAG_LIMIT; i++) await notes.addTag(a, `tag ${i}`, op);
      const outcomes = await together([() => notes.addTag(a, 'first', op), () => notes.addTag(a, 'second', op)]);
      expect([...outcomes].sort()).toEqual(['TAG_LIMIT', 'ok']);
      expect(await notes.tags(a)).toHaveLength(TAG_LIMIT);
    }, 60_000);

    it('the same tag added by six staff at once is one row and one audit', async () => {
      const a = await account(db);
      expect(await together(Array.from({ length: 6 }, () => () => notes.addTag(a, 'vip', op)))).toEqual(Array(6).fill('ok'));
      expect(await notes.tags(a)).toEqual(['VIP']);
      const n = await db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).where('target_id', '=', a).where('action', '=', 'account.tag.add').executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(1);
    }, 60_000);
  });
}
