/**
 * YOUR TASTES (plan CUSTOMER INTELLIGENCE §3.2 W.5 and W.13, step 1.3; services/tastes.ts; migration 0040), on the
 * service as createContext wires it:
 *
 *  - the choices come from the models shown PUBLIC (a variant through its main model), active, not discontinued, with
 *    an address; salon and hidden models are left out; a key once; a finish's label and colour those most of its models
 *    carry, ties to the earliest published; a main model's own label offered; a model without variants offers none;
 *  - `write` saves the whole set: a key kept keeps its `created_at`, a retired one may be kept and never newly added, 31
 *    of a kind refused; it returns the counts;
 *  - the counts `write` returns go into YOUR PROFILE's one `account.profile.update`, under the staff member when Client
 *    Services edit them, never the words;
 *  - `read` marks `retired` a choice whose variant was renamed, whose model was discontinued, hidden or moved to the
 *    salon, and takes the catalogue's words for the others.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import type { LookbookState } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { createAccount } from '../support/live.js';

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
  type?: string;
  lookbook?: LookbookState;
  slug?: boolean;
  active?: boolean;
  discontinued?: boolean;
  variantOf?: string;
  label?: string;
  swatch?: string;
  publishedAt?: string;
}

describe('YOUR TASTES (plan CUSTOMER INTELLIGENCE §3.2 W.5)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T09:00:00.000Z');
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
  });
  afterAll(() => h?.close());

  const svc = () => h.ctx.services.tastes;

  /** A model as the catalogue keeps it: PUBLIC with an address by default. */
  async function model(o: ModelOptions = {}): Promise<string> {
    const id = randomUUID();
    const lookbook = o.lookbook ?? 'PUBLIC';
    const slug = o.slug === false ? null : `m-${id.slice(0, 8)}`;
    await h.t.db
      .insertInto('models')
      .values({
        id, category_id: 1, name: 'MODEL', type: o.type ?? 'RING', sku_prefix: `T-${id.slice(0, 8)}`, slug, lookbook: slug === null ? 'HIDDEN' : lookbook,
        published_at: slug === null ? null : (o.publishedAt ?? '2026-01-01T00:00:00Z'), active: o.discontinued ? false : (o.active ?? true),
        discontinued_at: o.discontinued ? '2026-06-01T00:00:00Z' : null, variant_of: o.variantOf ?? null, variant_label: o.label ?? null, variant_swatch: o.label ? (o.swatch ?? '#888888') : null,
      })
      .execute();
    return id;
  }

  const clearModels = async () => {
    await h.t.db.deleteFrom('account_tastes').execute();
    await h.t.db.updateTable('models').set({ variant_of: null }).execute();
    await h.t.db.deleteFrom('models').execute();
  };

  it('offers the types and finishes of the models shown PUBLIC, active, not discontinued, with an address; a variant through its main model; salon and hidden models left out; each key once, alphabetical', async () => {
    await clearModels();
    expect(await svc().options()).toEqual({ pieces: [], finishes: [] });
    const main = await model({ type: 'RING', label: 'Steel', swatch: '#888888' });
    await model({ type: 'RING', variantOf: main, label: 'Gold', swatch: '#C9A227' });
    await model({ type: 'RING', variantOf: main, label: 'Blue', swatch: '#1F3A93' });
    await model({ type: 'signet  ring' });
    await model({ type: 'CUFF', lookbook: 'RESERVED' });
    await model({ type: 'PENDANT', lookbook: 'HIDDEN' });
    await model({ type: 'BELT', slug: false });
    await model({ type: 'WALLET', active: false });
    await model({ type: 'KEY RING', discontinued: true });
    // A variant of a salon model is left out with it; a variant whose own lookbook is HIDDEN follows its PUBLIC main.
    const salon = await model({ type: 'CARDHOLDER', lookbook: 'RESERVED', label: 'Black', swatch: '#000000' });
    await model({ type: 'CARDHOLDER', variantOf: salon, label: 'Tan', swatch: '#A0522D' });
    const pendant = await model({ type: 'PENDANT', label: 'Silver', swatch: '#C0C0C0' });
    await model({ type: 'PENDANT', variantOf: pendant, label: 'Onyx', swatch: '#111111', lookbook: 'HIDDEN' });
    // A discontinued variant offers neither its finish nor, alone, its type.
    await model({ type: 'BRACELET', variantOf: pendant, label: 'Ruby', swatch: '#9B111E', discontinued: true });
    expect(await svc().options()).toEqual({
      pieces: [
        { key: 'PENDANT', label: 'PENDANT' },
        { key: 'RING', label: 'RING' },
        { key: 'SIGNET RING', label: 'SIGNET RING' },
      ],
      finishes: [
        { key: 'BLUE', label: 'Blue', swatch: '#1F3A93' },
        { key: 'GOLD', label: 'Gold', swatch: '#C9A227' },
        { key: 'ONYX', label: 'Onyx', swatch: '#111111' },
        { key: 'SILVER', label: 'Silver', swatch: '#C0C0C0' },
        { key: 'STEEL', label: 'Steel', swatch: '#888888' },
      ],
    });
  });

  it('gives a finish the casing and the colour most of its models carry, ties to the earliest published, then the lowest id; a main model\'s own label offered; a model without variants offers none', async () => {
    await clearModels();
    const a = await model({ type: 'RING', label: 'Gold', swatch: '#C9A227', publishedAt: '2026-03-01T00:00:00Z' });
    await model({ type: 'RING', variantOf: a, label: 'Steel', swatch: '#888888', publishedAt: '2026-03-01T00:00:00Z' });
    const b = await model({ type: 'CUFF', label: 'GOLD', swatch: '#D4AF37', publishedAt: '2026-01-01T00:00:00Z' });
    await model({ type: 'CUFF', variantOf: b, label: 'Steel', swatch: '#888888', publishedAt: '2026-01-01T00:00:00Z' });
    // A lone model with a label is no group of variants: no finish.
    await model({ type: 'BELT', label: 'Leather', swatch: '#5C4033' });
    // Gold: 'Gold' and 'GOLD' once each, '#C9A227' and '#D4AF37' once each: the earliest published wins both.
    expect((await svc().options()).finishes).toEqual([
      { key: 'GOLD', label: 'GOLD', swatch: '#D4AF37' },
      { key: 'STEEL', label: 'Steel', swatch: '#888888' },
    ]);
    // A third Gold makes 'Gold' and its colour the majority.
    const c = await model({ type: 'PENDANT', label: 'Gold', swatch: '#C9A227', publishedAt: '2026-05-01T00:00:00Z' });
    await model({ type: 'PENDANT', variantOf: c, label: 'Onyx', swatch: '#111111' });
    expect((await svc().options()).finishes.find((f) => f.key === 'GOLD')).toEqual({ key: 'GOLD', label: 'Gold', swatch: '#C9A227' });
    expect((await svc().options()).pieces.map((p) => p.key)).toEqual(['BELT', 'CUFF', 'PENDANT', 'RING']);
  });

  it('writes the whole set: new keys from the catalogue only, a key kept keeps its created_at, a retired one kept and never newly added, 31 refused; returns the counts', async () => {
    await clearModels();
    const main = await model({ type: 'RING', label: 'Steel', swatch: '#888888' });
    const gold = await model({ type: 'RING', variantOf: main, label: 'Gold', swatch: '#C9A227' });
    await model({ type: 'CUFF' });
    const a = await createAccount(h.t.db);
    const write = (input: unknown) => inTransaction(h.t.db, (tx) => svc().write(tx, a.id, input));
    const rows = () => h.t.db.selectFrom('account_tastes').select(['kind', 'value_key', 'label', 'created_at']).where('account_id', '=', a.id).orderBy('kind').orderBy('value_key').execute();

    expect(await write({ pieces: ['ring', ' Cuff '], finishes: ['gold'] })).toEqual({ pieces: 2, finishes: 1, added: 3, removed: 0 });
    const first = await rows();
    expect(first.map((r) => [r.kind, r.value_key, r.label])).toEqual([['FINISH', 'GOLD', 'Gold'], ['PIECE', 'CUFF', 'CUFF'], ['PIECE', 'RING', 'RING']]);
    // The same set again: nothing written.
    h.clock.advance(60_000);
    expect(await write({ pieces: ['RING', 'CUFF', 'RING'], finishes: ['GOLD'] })).toEqual({ pieces: 2, finishes: 1, added: 0, removed: 0 });
    // One removed, one added; the key kept keeps its time.
    expect(await write({ pieces: ['RING'], finishes: ['GOLD', 'STEEL'] })).toEqual({ pieces: 1, finishes: 2, added: 1, removed: 1 });
    const second = await rows();
    expect(second.map((r) => r.value_key)).toEqual(['GOLD', 'STEEL', 'RING']);
    expect(second.find((r) => r.value_key === 'RING')!.created_at).toEqual(first.find((r) => r.value_key === 'RING')!.created_at);
    expect(second.find((r) => r.value_key === 'STEEL')!.created_at).toEqual(h.clock.now());

    // Gold leaves the collection: kept while chosen, never added again once removed.
    await h.t.db.updateTable('models').set({ active: false, discontinued_at: '2026-10-09T09:00:00Z' }).where('id', '=', gold).execute();
    expect(await write({ pieces: ['RING'], finishes: ['GOLD', 'STEEL'] })).toEqual({ pieces: 1, finishes: 2, added: 0, removed: 0 });
    expect(await write({ pieces: ['RING'], finishes: ['STEEL'] })).toEqual({ pieces: 1, finishes: 1, added: 0, removed: 1 });
    expect(await refusal(write({ pieces: ['RING'], finishes: ['GOLD', 'STEEL'] }))).toEqual({ code: 'TASTE_UNKNOWN', status: 400, message: 'Choose among the pieces and finishes of the collection.' });
    // Words that are no choice, or no key.
    for (const bad of [{ pieces: ['WATCH'], finishes: [] }, { pieces: [''], finishes: [] }, { pieces: [3], finishes: [] }, { pieces: 'RING', finishes: [] }, { finishes: [] }, null]) {
      expect(await refusal(write(bad)), JSON.stringify(bad)).toMatchObject({ code: 'TASTE_UNKNOWN', status: 400 });
    }
    // 30 of a kind at most (31 refused before anything is read), whichever kind.
    const many = Array.from({ length: 31 }, (_, i) => `TYPE ${i}`);
    expect(await refusal(write({ pieces: many, finishes: [] }))).toEqual({ code: 'TASTES_TOO_MANY', status: 400, message: 'Choose up to 30 favourite pieces and 30 favourite finishes.' });
    expect(await refusal(write({ pieces: [], finishes: many }))).toMatchObject({ code: 'TASTES_TOO_MANY' });
    // A refusal wrote nothing.
    expect((await rows()).map((r) => r.value_key)).toEqual(['STEEL', 'RING']);
    // 30 are taken.
    for (let i = 0; i < 29; i++) await model({ type: `TYPE ${i}` });
    expect(await write({ pieces: ['RING', ...many.slice(0, 29)], finishes: [] })).toEqual({ pieces: 30, finishes: 0, added: 29, removed: 1 });
    expect(await write({ pieces: [], finishes: [] })).toEqual({ pieces: 0, finishes: 0, added: 0, removed: 30 });
    expect(await rows()).toEqual([]);
  });

  it('reads a choice as retired once its variant is renamed, its model discontinued, hidden or moved to the salon, in its own words after the current ones; shown again, it is current again', async () => {
    await clearModels();
    const main = await model({ type: 'RING', label: 'Steel', swatch: '#888888' });
    const blue = await model({ type: 'RING', variantOf: main, label: 'Blue', swatch: '#1F3A93' });
    const gold = await model({ type: 'RING', variantOf: main, label: 'Gold', swatch: '#C9A227' });
    const cuff = await model({ type: 'CUFF', label: 'Rose gold', swatch: '#B76E79' });
    await model({ type: 'CUFF', variantOf: cuff, label: 'Onyx', swatch: '#111111' });
    const pendant = await model({ type: 'PENDANT' });
    const a = await createAccount(h.t.db);
    await inTransaction(h.t.db, (tx) => svc().write(tx, a.id, { pieces: ['RING', 'CUFF', 'PENDANT'], finishes: ['BLUE', 'GOLD', 'ROSE GOLD', 'STEEL'] }));
    expect(await svc().read(h.t.db, a.id)).toEqual({
      pieces: [
        { key: 'CUFF', label: 'CUFF', retired: false },
        { key: 'PENDANT', label: 'PENDANT', retired: false },
        { key: 'RING', label: 'RING', retired: false },
      ],
      finishes: [
        { key: 'BLUE', label: 'Blue', swatch: '#1F3A93', retired: false },
        { key: 'GOLD', label: 'Gold', swatch: '#C9A227', retired: false },
        { key: 'ROSE GOLD', label: 'Rose gold', swatch: '#B76E79', retired: false },
        { key: 'STEEL', label: 'Steel', swatch: '#888888', retired: false },
      ],
    });
    // Blue renamed Navy (a new choice, the old words retired); Gold discontinued; the cuff moved to the salon; the pendant hidden.
    await h.t.db.updateTable('models').set({ variant_label: 'Navy' }).where('id', '=', blue).execute();
    await h.t.db.updateTable('models').set({ active: false, discontinued_at: '2026-10-09T09:00:00Z' }).where('id', '=', gold).execute();
    await h.t.db.updateTable('models').set({ lookbook: 'RESERVED' }).where('id', '=', cuff).execute();
    await h.t.db.updateTable('models').set({ lookbook: 'HIDDEN' }).where('id', '=', pendant).execute();
    const read = await svc().read(h.t.db, a.id);
    expect(read).toEqual({
      pieces: [
        { key: 'RING', label: 'RING', retired: false },
        { key: 'CUFF', label: 'CUFF', retired: true },
        { key: 'PENDANT', label: 'PENDANT', retired: true },
      ],
      finishes: [
        { key: 'STEEL', label: 'Steel', swatch: '#888888', retired: false },
        { key: 'BLUE', label: 'Blue', retired: true },
        { key: 'GOLD', label: 'Gold', retired: true },
        { key: 'ROSE GOLD', label: 'Rose gold', retired: true },
      ],
    });
    expect((await svc().options()).finishes.map((f) => f.key)).toEqual(['NAVY', 'STEEL']);
    // Shown again: the same key is current again, by itself.
    await h.t.db.updateTable('models').set({ lookbook: 'PUBLIC' }).where('id', '=', cuff).execute();
    expect((await svc().read(h.t.db, a.id)).finishes.find((f) => f.key === 'ROSE GOLD')).toEqual({ key: 'ROSE GOLD', label: 'Rose gold', swatch: '#B76E79', retired: false });
  });
  it('puts the counts write returns in the profile\'s one account.profile.update, under the staff member when Client Services edit them, never the words', async () => {
    await clearModels();
    const main = await model({ type: 'RING', label: 'Steel', swatch: '#888888' });
    await model({ type: 'RING', variantOf: main, label: 'Gold', swatch: '#C9A227' });
    await model({ type: 'CUFF' });
    const a = await createAccount(h.t.db);
    const staff = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    await h.ctx.services.profiles.save(a.id, { version: 0, tastes: { pieces: ['RING'], finishes: ['GOLD'] } }, a.actor);
    await h.ctx.services.profiles.saveByStaff(a.id, { version: 1, tastes: { pieces: ['RING', 'CUFF'], finishes: ['STEEL'] } }, staff);
    const entries = await h.t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('target_id', '=', a.id).where('action', '=', 'account.profile.update').orderBy('id').execute();
    expect(entries).toEqual([
      { actor_type: 'account', actor_id: a.id, details: { by: 'collector', fields: ['tastes'], tastes: { pieces: 1, finishes: 1, added: 2, removed: 0 } } },
      { actor_type: 'admin', actor_id: staff.id, details: { by: 'staff', fields: ['tastes'], tastes: { pieces: 2, finishes: 1, added: 2, removed: 1 } } },
    ]);
    // No audit entry of the tastes' own.
    expect(await h.t.db.selectFrom('audit_logs').select('id').where('action', 'like', '%taste%').execute()).toEqual([]);
    const text = JSON.stringify(entries);
    for (const w of ['RING', 'CUFF', 'GOLD', 'Gold', 'STEEL', 'Steel']) expect(text, w).not.toContain(w);
  });
});
