/**
 * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.4 and W.13, step 2.2; services/wishlist.ts; migration 0041), on the
 * service as createContext wires it:
 *
 *  - add, add again (the same row) and remove; remove twice; remove an unknown or malformed address;
 *  - the 10-minute reopen, and a new row after 11 minutes;
 *  - 200 open wishes, then 409 WISHLIST_FULL (a reopening included);
 *  - HIDDEN 404; RESERVED below the tier 404 and from the tier 200; discontinued 200; a LOCKED account 403;
 *  - `list`: SHOWN and NOT_SHOWN, the fields a NOT_SHOWN item leaves out, the latest first; a tier fallen and back;
 *  - `ofAccount`: the staff's states;
 *  - no audit entry for a heart;
 *  - the jobs (§3.2 W.7, step 2.4): `aggregateWishMonths` counts each complete Paris month once (adds, removes and a
 *    reopening; test entrants, team accounts and LOCKED accounts left out), a second run does nothing, and once the last
 *    complete month is counted a pass ends before account_wishes is read (an earlier wish is not even found); `purgeWishHistory`
 *    deletes only removed rows older than 13 months in counted months, never an open one, in batches; the housekeeping
 *    runs both in the morning window only, returns both, and purges nothing in a pass where the count failed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LookbookState } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { startHousekeeping } from '../../src/server/context.js';
import { aggregateWishMonths, purgeWishHistory, wishHistoryCutoff, WISHLIST_MAX } from '../../src/server/services/wishlist.js';
import type { Logger } from '../../src/server/types.js';
import { createHarness, type Harness } from '../api/support.js';
import { createAccount, holdPieces } from '../support/live.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

interface ModelOptions {
  name?: string;
  type?: string;
  lookbook?: LookbookState;
  minTier?: 1 | 2 | 3;
  discontinued?: boolean;
  variantOf?: string;
  label?: string;
  swatch?: string;
  collectionId?: string;
  image?: string;
}

const MINUTE = 60_000;
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const SHA = createHash('sha256').update(PHOTO).digest('hex');

describe('YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.4)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    await h.t.db.insertInto('media_objects').values({ sha256: SHA, mime: 'image/jpeg', bytes: PHOTO, width: 8, height: 8 }).execute();
  });
  afterAll(() => h?.close());
  beforeEach(() => h.clock.set('2026-10-09T09:00:00.000Z'));

  const svc = () => h.ctx.services.wishlist;

  /** A model as the catalogue keeps it: PUBLIC with an address by default. */
  async function model(o: ModelOptions = {}): Promise<{ id: string; slug: string }> {
    const id = randomUUID();
    const slug = `w-${id.slice(0, 8)}`;
    await h.t.db
      .insertInto('models')
      .values({
        id, category_id: 1, collection_id: o.collectionId ?? null, name: o.name ?? 'MONOLITHE', type: o.type ?? 'RING', sku_prefix: `W-${id.slice(0, 8)}`, slug, lookbook: o.lookbook ?? 'PUBLIC',
        private_min_tier: o.minTier ?? 1, published_at: '2026-01-01T00:00:00Z', image_sha256: o.image ?? null,
        discontinued_at: o.discontinued ? '2026-06-01T00:00:00Z' : null, active: !o.discontinued, variant_of: o.variantOf ?? null, variant_label: o.label ?? null, variant_swatch: o.label ? (o.swatch ?? '#335577') : null,
      })
      .execute();
    return { id, slug };
  }

  const rowsOf = (accountId: string) => h.t.db.selectFrom('account_wishes').selectAll().where('account_id', '=', accountId).orderBy('added_at').execute();

  it('adds a wish, adds it again as the same row, removes it and removes it again; an unknown or malformed address removes nothing and says so the same way', async () => {
    const a = await createAccount(h.t.db);
    const m = await model({ name: 'ORBITE' });
    const first = await svc().add(a.id, m.slug);
    expect(first).toEqual({
      wished: true,
      count: 1,
      item: { state: 'SHOWN', slug: m.slug, name: 'ORBITE', variant: null, type: 'RING', collection: null, imageUrl: null, discontinuedYear: null, reserved: false, addedAt: new Date('2026-10-09T09:00:00.000Z') },
    });
    h.clock.advance(MINUTE);
    // The same address, any case and spaces: the open wish as it is.
    expect(await svc().add(a.id, ` ${m.slug.toUpperCase()} `)).toEqual(first);
    expect(await rowsOf(a.id)).toHaveLength(1);
    expect(await svc().remove(a.id, m.slug)).toEqual({ wished: false, count: 0 });
    expect(await svc().remove(a.id, m.slug)).toEqual({ wished: false, count: 0 });
    expect(await rowsOf(a.id)).toEqual([{ account_id: a.id, model_id: m.id, added_at: new Date('2026-10-09T09:00:00.000Z'), removed_at: new Date('2026-10-09T09:01:00.000Z') }]);
    // Removing never says whether an address exists.
    await svc().add(a.id, m.slug);
    for (const slug of ['no-such-model', '../x', 'x'.repeat(200), '', 'Bad Slug']) expect(await svc().remove(a.id, slug)).toEqual({ wished: false, count: 1 });
    // No audit entry for a heart.
    expect(await h.t.db.selectFrom('audit_logs').select('action').where('target_id', '=', a.id).execute()).toEqual([]);
  });

  it('reopens a wish removed less than 10 minutes ago, and adds a new row after 11 minutes', async () => {
    const a = await createAccount(h.t.db);
    const m = await model();
    await svc().add(a.id, m.slug);
    for (let i = 0; i < 10; i++) {
      h.clock.advance(5_000);
      await svc().remove(a.id, m.slug);
      h.clock.advance(5_000);
      expect((await svc().add(a.id, m.slug)).item.addedAt).toEqual(new Date('2026-10-09T09:00:00.000Z'));
    }
    expect(await rowsOf(a.id)).toEqual([{ account_id: a.id, model_id: m.id, added_at: new Date('2026-10-09T09:00:00.000Z'), removed_at: null }]);
    await svc().remove(a.id, m.slug);
    h.clock.advance(9 * MINUTE + 59_000);
    expect((await svc().add(a.id, m.slug)).item.addedAt).toEqual(new Date('2026-10-09T09:00:00.000Z'));
    await svc().remove(a.id, m.slug);
    h.clock.advance(11 * MINUTE);
    const fresh = await svc().add(a.id, m.slug);
    expect(fresh.item.addedAt).toEqual(new Date(h.clock.now()));
    const rows = await rowsOf(a.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.removed_at).not.toBeNull();
    expect(rows[1]!.removed_at).toBeNull();
  });

  it('holds 200 open wishes, then answers 409 WISHLIST_FULL, a reopening included; removing one makes room', async () => {
    const a = await createAccount(h.t.db);
    const filler = await Promise.all(Array.from({ length: WISHLIST_MAX - 1 }, () => model()));
    await h.t.db.insertInto('account_wishes').values(filler.map((f, i) => ({ account_id: a.id, model_id: f.id, added_at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 1000) }))).execute();
    const last = await model();
    const extra = await model();
    expect((await svc().add(a.id, last.slug)).count).toBe(WISHLIST_MAX);
    expect(await refusal(svc().add(a.id, extra.slug))).toEqual({ code: 'WISHLIST_FULL', status: 409, message: 'Your wishlist holds up to 200 models. Remove one to add another.' });
    // An open wish is still answered at 200.
    expect((await svc().add(a.id, last.slug)).count).toBe(WISHLIST_MAX);
    // A wish removed a minute ago is not reopened past 200.
    await svc().remove(a.id, last.slug);
    await svc().add(a.id, extra.slug);
    h.clock.advance(MINUTE);
    expect((await refusal(svc().add(a.id, last.slug))).code).toBe('WISHLIST_FULL');
    await svc().remove(a.id, filler[0]!.slug);
    expect((await svc().add(a.id, last.slug)).count).toBe(WISHLIST_MAX);
    expect((await svc().list(a.id)).length).toBe(WISHLIST_MAX);
  });

  it('wishes only for a model the reader may open: HIDDEN 404, RESERVED below the tier 404 and from it 200, discontinued 200; a LOCKED account 403', async () => {
    const a = await createAccount(h.t.db);
    const hidden = await model({ lookbook: 'HIDDEN' });
    const salon = await model({ lookbook: 'RESERVED', minTier: 2, name: 'SALON' });
    const gone = await model({ discontinued: true, name: 'OLD' });
    const notFound = { code: 'LOOKBOOK_NOT_FOUND', status: 404, message: 'This model is not in the ORBES collection.' };
    expect(await refusal(svc().add(a.id, hidden.slug))).toEqual(notFound);
    expect(await refusal(svc().add(a.id, 'no-such-model'))).toEqual(notFound);
    for (const slug of ['../x', 'x'.repeat(200), '']) expect(await refusal(svc().add(a.id, slug))).toEqual(notFound);
    expect(await refusal(svc().add(a.id, salon.slug))).toEqual(notFound);
    // One piece: TITANE, still below PLATINE.
    await holdPieces(h.t.db, a.id, 1, gone.id);
    expect(await refusal(svc().add(a.id, salon.slug))).toEqual(notFound);
    await holdPieces(h.t.db, a.id, 4, gone.id);
    const wished = await svc().add(a.id, salon.slug);
    expect(wished.item).toMatchObject({ state: 'SHOWN', name: 'SALON', reserved: true });
    expect((await svc().add(a.id, gone.slug)).item).toMatchObject({ state: 'SHOWN', name: 'OLD', discontinuedYear: 2026 });
    expect(await rowsOf(a.id)).toHaveLength(2);

    const locked = await createAccount(h.t.db);
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    const m = await model();
    expect(await refusal(svc().add(locked.id, m.slug))).toEqual({ code: 'ACCOUNT_LOCKED', status: 403, message: 'This account is locked. ORBES Client Services can assist you.' });
    expect((await refusal(svc().remove(locked.id, m.slug))).code).toBe('ACCOUNT_LOCKED');
    expect((await refusal(svc().add(randomUUID(), m.slug))).code).toBe('ACCOUNT_NOT_FOUND');
    expect((await refusal(svc().add('not-an-id', m.slug))).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('lists the open wishes, the latest first: SHOWN with the model\'s facts, NOT_SHOWN with its address, name, variant and date only; a tier fallen and back', async () => {
    const a = await createAccount(h.t.db);
    const collection = (await h.t.db.insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    const main = await model({ name: 'MONOLITHE', label: 'Steel', swatch: '#8A8D8F', collectionId: collection, image: SHA });
    const blue = await model({ name: 'MONOLITHE', label: 'Blue', swatch: '#1F3A93', variantOf: main.id, collectionId: collection });
    const solo = await model({ name: 'ORBITE', type: 'CUFF' });
    const salon = await model({ lookbook: 'RESERVED', minTier: 1, name: 'SALON', label: 'Gold', swatch: '#C9A227', collectionId: collection, image: SHA });
    const old = await model({ discontinued: true, name: 'OLD' });
    const pieces = await holdPieces(h.t.db, a.id, 1, old.id);
    for (const m of [main, blue, solo, salon, old]) {
      await svc().add(a.id, m.slug);
      h.clock.advance(MINUTE);
    }
    // Hidden since it was wished.
    await h.t.db.updateTable('models').set({ lookbook: 'HIDDEN' }).where('id', '=', solo.id).execute();
    const at = (m: number) => new Date(Date.parse('2026-10-09T09:00:00.000Z') + m * MINUTE);
    expect(await svc().list(a.id)).toEqual([
      { state: 'SHOWN', slug: old.slug, name: 'OLD', variant: null, type: 'RING', collection: null, imageUrl: null, discontinuedYear: 2026, reserved: false, addedAt: at(4) },
      { state: 'SHOWN', slug: salon.slug, name: 'SALON', variant: { label: 'Gold', swatch: '#C9A227' }, type: 'RING', collection: 'ORBITAL', imageUrl: `/api/v1/media/${SHA}`, discontinuedYear: null, reserved: true, addedAt: at(3) },
      { state: 'NOT_SHOWN', slug: solo.slug, name: 'ORBITE', variant: null, addedAt: at(2) },
      { state: 'SHOWN', slug: blue.slug, name: 'MONOLITHE', variant: { label: 'Blue', swatch: '#1F3A93' }, type: 'RING', collection: 'ORBITAL', imageUrl: null, discontinuedYear: null, reserved: false, addedAt: at(1) },
      { state: 'SHOWN', slug: main.slug, name: 'MONOLITHE', variant: { label: 'Steel', swatch: '#8A8D8F' }, type: 'RING', collection: 'ORBITAL', imageUrl: `/api/v1/media/${SHA}`, discontinuedYear: null, reserved: false, addedAt: at(0) },
    ]);
    // The piece given up: below the salon's tier, its wish is kept and shown as not in the collection now.
    await h.t.db.updateTable('ownership').set({ ended_at: new Date(h.clock.now()) }).where('product_id', 'in', pieces).execute();
    const fallen = await svc().list(a.id);
    expect(fallen.find((w) => w.slug === salon.slug)).toEqual({ state: 'NOT_SHOWN', slug: salon.slug, name: 'SALON', variant: { label: 'Gold', swatch: '#C9A227' }, addedAt: at(3) });
    expect(Object.keys(fallen.find((w) => w.slug === salon.slug)!).sort()).toEqual(['addedAt', 'name', 'slug', 'state', 'variant']);
    // Shown again: back to normal; renamed: the new words.
    await holdPieces(h.t.db, a.id, 1, old.id);
    await h.t.db.updateTable('models').set({ lookbook: 'PUBLIC' }).where('id', '=', solo.id).execute();
    await h.t.db.updateTable('models').set({ name: 'ORBITE II' }).where('id', '=', solo.id).execute();
    const back = await svc().list(a.id);
    expect(back.map((w) => w.state)).toEqual(['SHOWN', 'SHOWN', 'SHOWN', 'SHOWN', 'SHOWN']);
    expect(back.find((w) => w.slug === solo.slug)).toMatchObject({ name: 'ORBITE II', type: 'CUFF' });
    // A removed wish is no longer listed; another account's never is.
    await svc().remove(a.id, blue.slug);
    const other = await createAccount(h.t.db);
    await svc().add(other.id, blue.slug);
    expect((await svc().list(a.id)).map((w) => w.slug)).toEqual([old.slug, salon.slug, solo.slug, main.slug]);
    expect(await svc().list((await createAccount(h.t.db)).id)).toEqual([]);
  });

  it('reads an account\'s open wishes for staff, the latest first, with the model\'s id and state: SHOWN, HIDDEN, DISCONTINUED, RESERVED', async () => {
    const a = await createAccount(h.t.db);
    const shown = await model({ name: 'SHOWN', label: 'Blue', swatch: '#1F3A93' });
    const hidden = await model({ name: 'HIDDEN ONE' });
    const old = await model({ discontinued: true, name: 'OLD' });
    const salon = await model({ lookbook: 'RESERVED', minTier: 1, name: 'SALON' });
    await holdPieces(h.t.db, a.id, 1, old.id);
    for (const m of [shown, hidden, old, salon]) {
      await svc().add(a.id, m.slug);
      h.clock.advance(MINUTE);
    }
    await h.t.db.updateTable('models').set({ lookbook: 'HIDDEN' }).where('id', '=', hidden.id).execute();
    const at = (m: number) => new Date(Date.parse('2026-10-09T09:00:00.000Z') + m * MINUTE);
    expect(await svc().ofAccount(a.id)).toEqual([
      { modelId: salon.id, name: 'SALON', variant: null, addedAt: at(3), state: 'RESERVED' },
      { modelId: old.id, name: 'OLD', variant: null, addedAt: at(2), state: 'DISCONTINUED' },
      { modelId: hidden.id, name: 'HIDDEN ONE', variant: null, addedAt: at(1), state: 'HIDDEN' },
      { modelId: shown.id, name: 'SHOWN', variant: { label: 'Blue', swatch: '#1F3A93' }, addedAt: at(0), state: 'SHOWN' },
    ]);
    // A wished model later bought or registered stays wished (question 12).
    await holdPieces(h.t.db, a.id, 1, shown.id);
    expect((await svc().ofAccount(a.id)).map((w) => w.modelId)).toContain(shown.id);
  });
});

describe('YOUR WISHLIST\'s jobs (plan CUSTOMER INTELLIGENCE §3.2 W.7): the monthly summary, then the purge', () => {
  let h: Harness;
  const lines: { level: string; o: unknown }[] = [];
  const log: Logger = { info: (o) => lines.push({ level: 'info', o }), warn: (o) => lines.push({ level: 'warn', o }), error: (o) => lines.push({ level: 'error', o }) };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await createHarness({ context: { log } });
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    for (const name of ['A', 'B', 'C']) {
      const id = randomUUID();
      await h.t.db.insertInto('models').values({ id, category_id: 1, name, type: 'RING', sku_prefix: `WJ-${id.slice(0, 8)}`, slug: `wj-${name.toLowerCase()}`, lookbook: 'PUBLIC', published_at: '2026-01-01T00:00:00Z' }).execute();
      ids[name] = id;
    }
    for (const who of ['c1', 'c2', 'te', 'team', 'locked']) ids[who] = (await createAccount(h.t.db)).id;
    await h.t.db.insertInto('test_entrants').values({ account_id: ids.te! }).execute();
    const team = await h.t.db.selectFrom('accounts').select('email_normalized').where('id', '=', ids.team!).executeTakeFirstOrThrow();
    await h.t.db.insertInto('admin_users').values({ email: team.email_normalized, email_normalized: team.email_normalized, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', ids.locked!).execute();
    const row = (who: string, model: string, added: string, removed: string | null = null) => ({ account_id: ids[who]!, model_id: ids[model]!, added_at: added, removed_at: removed });
    await h.t.db
      .insertInto('account_wishes')
      .values([
        // 00:30 Paris on 1 October: an October wish, though it is still 30 September in UTC.
        row('c1', 'A', '2026-09-30T22:30:00Z'),
        row('c1', 'B', '2026-10-05T10:00:00Z', '2026-10-20T10:00:00Z'),
        row('c2', 'A', '2026-10-10T10:00:00Z', '2026-11-03T10:00:00Z'),
        // 00:30 Paris on 1 December: the month in progress on 10 December, counted with it.
        row('c2', 'B', '2026-11-30T23:30:00Z'),
        row('te', 'A', '2026-10-02T10:00:00Z'),
        row('team', 'A', '2026-10-02T10:00:00Z'),
        row('locked', 'A', '2026-10-02T10:00:00Z'),
      ])
      .execute();
    // A reopening: removed and added again within 10 minutes is the same row, counted once.
    h.clock.set('2026-10-03T10:00:00.000Z');
    await h.ctx.services.wishlist.add(ids.c2!, 'wj-c');
    h.clock.advance(60_000);
    await h.ctx.services.wishlist.remove(ids.c2!, 'wj-c');
    h.clock.advance(60_000);
    await h.ctx.services.wishlist.add(ids.c2!, 'wj-c');
  });
  afterAll(() => h?.close());

  const months = async () =>
    (await h.t.db.selectFrom('model_wish_months').select(['month', 'model_id', 'added', 'removed', 'wished_end']).orderBy('month').orderBy('model_id').execute()).map((r) => ({
      month: r.month,
      model: Object.keys(ids).find((k) => ids[k] === r.model_id),
      added: r.added,
      removed: r.removed,
      wishedEnd: r.wished_end,
    }));
  const counted = async () => (await h.t.db.selectFrom('wish_months_counted').select('month').orderBy('month').execute()).map((r) => r.month);
  const wishes = async () => Number((await h.t.db.selectFrom('account_wishes').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);

  it('waits for the morning window: a pass at 07:29 UTC counts nothing, the one at 07:30 counts each complete Paris month once, and returns both jobs', async () => {
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      h.clock.set('2026-12-10T07:29:00.000Z');
      const early = await hk.runOnce();
      expect(early).toMatchObject({ wishMonths: 0, wishHistory: 0 });
      expect(await counted()).toEqual([]);
      h.clock.set('2026-12-10T07:30:00.000Z');
      const pass = await hk.runOnce();
      expect(pass).toMatchObject({ wishMonths: 2, wishHistory: 0 });
      expect(Object.keys(pass)).toEqual([
        'sessions', 'transfers', 'scanTokens', 'scanStats', 'activity', 'acquisitionConversions', 'viewStats', 'viewMonths', 'acquisitionDaily', 'wishMonths', 'scanHistory', 'viewPurge', 'acquisitionPurge', 'wishHistory', 'devicePurge', 'liveNetworks', 'careLabels', 'packingPhotos', 'sizes',
      ]);
    } finally {
      await hk.stop();
    }
    // October and November (Paris), not December in progress; test entrants, the team's accounts and LOCKED ones left out.
    expect(await counted()).toEqual(['2026-10-01', '2026-11-01']);
    expect(await months()).toEqual(
      [
        { month: '2026-10-01', model: 'A', added: 2, removed: 0, wishedEnd: 2 },
        { month: '2026-10-01', model: 'B', added: 1, removed: 1, wishedEnd: 0 },
        { month: '2026-10-01', model: 'C', added: 1, removed: 0, wishedEnd: 1 },
        { month: '2026-11-01', model: 'A', added: 0, removed: 1, wishedEnd: 1 },
        { month: '2026-11-01', model: 'C', added: 0, removed: 0, wishedEnd: 1 },
      ].sort((a, b) => (a.month === b.month ? ids[a.model]!.localeCompare(ids[b.model]!) : a.month.localeCompare(b.month))),
    );
    // A second run does nothing.
    const before = await months();
    expect(await aggregateWishMonths(h.t.db, new Date('2026-12-10T09:00:00.000Z'))).toBe(0);
    expect(await months()).toEqual(before);
  });

  it('ends a pass on one read of wish_months_counted once the last complete month is counted, before account_wishes is read', async () => {
    // November 2026 (the month before 10 December's) is counted: a wish added in August, never counted, is not even
    // looked for, so the pass counts nothing and changes nothing (a min(added_at) read would have found August).
    const before = await months();
    const marked = await counted();
    await h.t.db.insertInto('account_wishes').values({ account_id: ids.c1!, model_id: ids.C!, added_at: '2026-08-15T10:00:00Z', removed_at: null }).execute();
    try {
      expect(await aggregateWishMonths(h.t.db, new Date('2026-12-10T09:00:00.000Z'))).toBe(0);
      expect(await months()).toEqual(before);
      expect(await counted()).toEqual(marked);
    } finally {
      await h.t.db.deleteFrom('account_wishes').where('account_id', '=', ids.c1!).where('model_id', '=', ids.C!).where('added_at', '=', new Date('2026-08-15T10:00:00Z')).execute();
    }
  });

  it('purges only removed wishes older than 13 Paris months whose month is counted, never an open one, in batches', async () => {
    expect(wishHistoryCutoff(new Date('2027-12-15T08:00:00.000Z'))).toEqual(new Date('2026-11-14T23:00:00.000Z'));
    expect(wishHistoryCutoff(new Date('2027-03-31T08:00:00.000Z'))).toEqual(new Date('2026-02-27T23:00:00.000Z'));
    const total = await wishes();
    // Before 13 months: nothing.
    expect(await purgeWishHistory(h.t.db, new Date('2027-11-20T08:00:00.000Z'))).toBe(0);
    // October not counted: its removal (20 October) stays; November's (3 November) goes once 13 months have passed.
    await h.t.db.deleteFrom('wish_months_counted').where('month', '=', '2026-10-01').execute();
    expect(await purgeWishHistory(h.t.db, new Date('2027-12-15T08:00:00.000Z'))).toBe(1);
    expect(await h.t.db.selectFrom('account_wishes').select('removed_at').where('account_id', '=', ids.c2!).where('model_id', '=', ids.A!).execute()).toEqual([]);
    await h.t.db.insertInto('wish_months_counted').values({ month: '2026-10-01' }).execute();
    expect(await purgeWishHistory(h.t.db, new Date('2027-12-15T08:00:00.000Z'), { batchSize: 1, maxBatches: 5 })).toBe(1);
    expect(await wishes()).toBe(total - 2);
    // Open wishes are never purged, however old.
    expect(await h.t.db.selectFrom('account_wishes').select('removed_at').where('removed_at', 'is not', null).execute()).toEqual([]);
    expect(await purgeWishHistory(h.t.db, new Date('2030-01-01T08:00:00.000Z'))).toBe(0);
    expect(await wishes()).toBe(total - 2);
  });

  it('deletes at most its batches a pass', async () => {
    const id = (await createAccount(h.t.db)).id;
    await h.t.db
      .insertInto('account_wishes')
      .values(Array.from({ length: 5 }, (_, i) => ({ account_id: id, model_id: ids.A!, added_at: `2026-10-0${i + 1}T08:00:00Z`, removed_at: `2026-10-0${i + 1}T09:00:00Z` })))
      .execute();
    expect(await purgeWishHistory(h.t.db, new Date('2027-12-15T08:00:00.000Z'), { batchSize: 2, maxBatches: 2 })).toBe(4);
    expect(await purgeWishHistory(h.t.db, new Date('2027-12-15T08:00:00.000Z'), { batchSize: 2, maxBatches: 2 })).toBe(1);
  });

  it('purges no wish in a pass where the count failed, and the next pass counts, then purges', async () => {
    // A removal in December 2026 and a month not counted yet: the count fails (a test trigger) when it marks one.
    const id = (await createAccount(h.t.db)).id;
    await h.t.db.insertInto('account_wishes').values({ account_id: id, model_id: ids.B!, added_at: '2026-12-02T08:00:00Z', removed_at: '2026-12-03T08:00:00Z' }).execute();
    await h.t.db.insertInto('account_wishes').values({ account_id: id, model_id: ids.C!, added_at: '2026-10-02T08:00:00Z', removed_at: '2026-10-03T08:00:00Z' }).execute();
    await sql`CREATE FUNCTION wish_months_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the count failed'; END $$`.execute(h.t.db);
    await sql`CREATE TRIGGER wish_months_fail BEFORE INSERT ON wish_months_counted FOR EACH ROW EXECUTE FUNCTION wish_months_fail()`.execute(h.t.db);
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      h.clock.set('2028-01-20T08:00:00.000Z');
      lines.length = 0;
      const failed = await hk.runOnce();
      expect(failed).toMatchObject({ wishMonths: 0, wishHistory: 0 });
      expect(lines.some((l) => l.level === 'error' && (l.o as { job?: string }).job === 'wishMonths')).toBe(true);
      // October 2026's removal is counted and past 13 months, yet stays: nothing is purged in this pass.
      expect(await h.t.db.selectFrom('account_wishes').select('model_id').where('account_id', '=', id).orderBy('added_at').execute()).toEqual([{ model_id: ids.C! }, { model_id: ids.B! }]);
      await sql`DROP TRIGGER wish_months_fail ON wish_months_counted`.execute(h.t.db);
      await sql`DROP FUNCTION wish_months_fail()`.execute(h.t.db);
      const pass = await hk.runOnce();
      expect(pass.wishMonths).toBe(13);
      expect(pass.wishHistory).toBe(2);
      expect(await h.t.db.selectFrom('account_wishes').select('model_id').where('account_id', '=', id).execute()).toEqual([]);
      expect((await counted()).at(-1)).toBe('2027-12-01');
      expect((await hk.runOnce())).toMatchObject({ wishMonths: 0, wishHistory: 0 });
    } finally {
      await hk.stop();
    }
  });
});
