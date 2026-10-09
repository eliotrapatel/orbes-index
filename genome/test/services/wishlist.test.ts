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
 *  - no audit entry for a heart.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LookbookState } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { WISHLIST_MAX } from '../../src/server/services/wishlist.js';
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
