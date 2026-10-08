/**
 * YOUR ADDRESSES (plan NEXT LOT of 2026-10-07, §3.6.B, step 6.7; services/addresses.ts; migration 0039), on the service
 * as createContext wires it:
 *
 *  - an address is a name, the lines as typed, a country of the house's list and a phone with its country code, each
 *    refused in its own words;
 *  - the first address is the default; one asked as the default becomes it; at most 5 (409 ADDRESS_LIMIT);
 *  - EDIT changes the four fields whole; the same fields again change nothing;
 *  - REMOVE deletes it; the default removed, the oldest left becomes the default; another account's answers 404;
 *  - MAKE DEFAULT: one default per account;
 *  - a LOCKED account changes nothing (403 ACCOUNT_LOCKED);
 *  - two creations at once keep the limit and the one default;
 *  - audited `account.address.create`, `.update`, `.remove`, `.default` with the address's id and country, never its words;
 *  - exported to its account under the right of access; the registration country preselects COUNTRY.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import type { Actor } from '../../src/server/types.js';
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

const PARIS = { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };
const LONDON = { name: 'Jane Doe', address: '22 Kensington Church Street\nLondon W8 4EP', country: 'GB', phone: '+44 20 7946 0000' };

describe('YOUR ADDRESSES (plan NEXT LOT §3.6.B)', () => {
  let h: Harness;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-05T09:00:00.000Z');
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
  });
  afterAll(() => h?.close());

  const svc = () => h.ctx.services.addresses;
  const audits = (accountId: string) => h.t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'details']).where('target_id', '=', accountId).where('action', 'like', 'account.address.%').orderBy('id').execute();

  it('takes a name, the lines, a country of the list and a phone with its code; the first is the default; the registration country preselects COUNTRY', async () => {
    const a = await createAccount(h.t.db);
    await h.t.db.updateTable('accounts').set({ country: 'FR' }).where('id', '=', a.id).execute();
    expect(await svc().list(a.id)).toEqual({ addresses: [], defaultCountry: 'FR' });
    expect(await refusal(svc().create(a.id, { ...PARIS, name: '  ' }, a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Enter the name and the address.' });
    expect(await refusal(svc().create(a.id, { ...PARIS, address: undefined }, a.actor))).toMatchObject({ message: 'Enter the name and the address.' });
    expect(await refusal(svc().create(a.id, { ...PARIS, country: 'XX' }, a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Choose a country.' });
    expect(await refusal(svc().create(a.id, { ...PARIS, country: null }, a.actor))).toMatchObject({ message: 'Choose a country.' });
    expect(await refusal(svc().create(a.id, { ...PARIS, phone: '06 12 34 56 78' }, a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Enter a phone number with its country code.' });
    expect(await refusal(svc().create(a.id, { ...PARIS, name: 'Jane\nDoe' }, a.actor))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await refusal(svc().create(a.id, { ...PARIS, name: 'x'.repeat(201) }, a.actor))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await refusal(svc().create(a.id, { ...PARIS, address: 'x'.repeat(1001) }, a.actor))).toMatchObject({ code: 'VALIDATION_FAILED' });
    // Trimmed, the lines as typed; a country in lower case read as its code.
    const first = await svc().create(a.id, { name: ' Jane Doe ', address: '1 rue de la Paix\r\n75002 Paris ', country: 'fr', phone: ' +33 6 12  34 56 78 ' }, a.actor);
    expect(first.addresses).toEqual([{ id: expect.any(String), ...PARIS, isDefault: true }]);
    // A second, not the default; then one asked as the default.
    h.clock.advance(1000);
    const second = await svc().create(a.id, LONDON, a.actor);
    expect(second.addresses.map((x) => [x.country, x.isDefault])).toEqual([['FR', true], ['GB', false]]);
    h.clock.advance(1000);
    const third = await svc().create(a.id, { ...LONDON, country: 'CH', phone: '+41 79 123 45 67', isDefault: true }, a.actor);
    expect(third.addresses.map((x) => [x.country, x.isDefault])).toEqual([['FR', false], ['GB', false], ['CH', true]]);
    // An account without a registration country preselects none.
    const b = await createAccount(h.t.db);
    expect((await svc().list(b.id)).defaultCountry).toBeNull();
  });

  it('keeps 5 at most; edits whole; removes, the oldest left becoming the default; makes another the default; never another account\'s', async () => {
    const a = await createAccount(h.t.db);
    const other = await createAccount(h.t.db);
    for (let i = 0; i < 5; i++) {
      h.clock.advance(1000);
      await svc().create(a.id, { ...PARIS, name: `Jane ${i}` }, a.actor);
    }
    expect(await refusal(svc().create(a.id, PARIS, a.actor))).toEqual({ code: 'ADDRESS_LIMIT', status: 409, message: 'You may keep up to 5 addresses.' });
    const list = (await svc().list(a.id)).addresses;
    expect(list.map((x) => [x.name, x.isDefault])).toEqual([['Jane 0', true], ['Jane 1', false], ['Jane 2', false], ['Jane 3', false], ['Jane 4', false]]);
    // EDIT: the four fields; the same again changes nothing (no audit).
    const edited = await svc().update(a.id, list[1]!.id, LONDON, a.actor);
    expect(edited.addresses[1]).toEqual({ id: list[1]!.id, ...LONDON, isDefault: false });
    const before = (await audits(a.id)).length;
    await svc().update(a.id, list[1]!.id, LONDON, a.actor);
    expect((await audits(a.id)).length).toBe(before);
    // Another account's address: 404, for every action.
    for (const p of [svc().update(other.id, list[1]!.id, PARIS, other.actor), svc().remove(other.id, list[1]!.id, other.actor), svc().makeDefault(other.id, list[1]!.id, other.actor)]) {
      expect(await refusal(p)).toEqual({ code: 'ADDRESS_NOT_FOUND', status: 404, message: 'Address not found.' });
    }
    expect(await refusal(svc().remove(a.id, 'not-an-id', a.actor))).toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
    // MAKE DEFAULT: one default; already the default, nothing changes.
    await svc().makeDefault(a.id, list[3]!.id, a.actor);
    await svc().makeDefault(a.id, list[3]!.id, a.actor);
    expect((await svc().list(a.id)).addresses.filter((x) => x.isDefault).map((x) => x.id)).toEqual([list[3]!.id]);
    // REMOVE the default: the oldest left becomes the default.
    await svc().remove(a.id, list[3]!.id, a.actor);
    const left = (await svc().list(a.id)).addresses;
    expect(left.map((x) => [x.id, x.isDefault])).toEqual([[list[0]!.id, true], [list[1]!.id, false], [list[2]!.id, false], [list[4]!.id, false]]);
    // Room again for a fifth; removing an address that is not the default leaves the default.
    await svc().create(a.id, PARIS, a.actor);
    await svc().remove(a.id, list[2]!.id, a.actor);
    expect((await svc().list(a.id)).addresses.filter((x) => x.isDefault).map((x) => x.id)).toEqual([list[0]!.id]);
    // Every address removed: none left, no default.
    for (const x of (await svc().list(a.id)).addresses) await svc().remove(a.id, x.id, a.actor);
    expect((await svc().list(a.id)).addresses).toEqual([]);
  });

  it('keeps the limit and the one default when two creations meet', async () => {
    const a = await createAccount(h.t.db);
    const results = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => svc().create(a.id, { ...PARIS, name: `Jane ${i}` }, a.actor)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    for (const r of results.filter((x) => x.status === 'rejected')) expect(((r as PromiseRejectedResult).reason as DomainError).code).toBe('ADDRESS_LIMIT');
    const list = (await svc().list(a.id)).addresses;
    expect(list).toHaveLength(5);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it('refuses a LOCKED account; audits the address\'s id and country only, never its words; exports the addresses to their account', async () => {
    const a = await createAccount(h.t.db);
    const created = await svc().create(a.id, PARIS, a.actor);
    const id = created.addresses[0]!.id;
    await svc().update(a.id, id, { ...PARIS, address: '3 rue Neuve\n75004 Paris' }, a.actor);
    h.clock.advance(1000);
    const second = (await svc().create(a.id, LONDON, a.actor)).addresses[1]!.id;
    await svc().makeDefault(a.id, second, a.actor);
    await svc().remove(a.id, id, a.actor);
    const rows = await audits(a.id);
    expect(rows.map((r) => [r.action, r.actor_type])).toEqual([
      ['account.address.create', 'account'],
      ['account.address.update', 'account'],
      ['account.address.create', 'account'],
      ['account.address.default', 'account'],
      ['account.address.remove', 'account'],
    ]);
    expect(rows.map((r) => r.details)).toEqual([
      { addressId: id, country: 'FR', isDefault: true },
      { addressId: id, country: 'FR', fields: ['address'] },
      { addressId: second, country: 'GB', isDefault: false },
      { addressId: second, country: 'GB' },
      { addressId: id, country: 'FR' },
    ]);
    const words = JSON.stringify(await h.t.db.selectFrom('audit_logs').select('details').execute());
    for (const w of ['Jane', 'Paix', 'Neuve', 'Kensington', '+33', '+44']) expect(words, w).not.toContain(w);
    // The right of access: the addresses kept, with their dates.
    const exported = await h.ctx.services.owners.exportData(a.id, admin);
    expect(exported.addresses).toEqual([{ id: second, ...LONDON, isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }]);
    // Locked: nothing changes.
    await h.t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    const locked = { code: 'ACCOUNT_LOCKED', status: 403, message: 'This account is locked. ORBES Client Services can assist you.' };
    expect(await refusal(svc().create(a.id, PARIS, a.actor))).toEqual(locked);
    expect(await refusal(svc().update(a.id, second, PARIS, a.actor))).toEqual(locked);
    expect(await refusal(svc().remove(a.id, second, a.actor))).toEqual(locked);
    expect(await refusal(svc().makeDefault(a.id, second, a.actor))).toEqual(locked);
    expect((await svc().list(a.id)).addresses).toHaveLength(1);
  });
});
