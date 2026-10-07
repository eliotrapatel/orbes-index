/**
 * The tiers' grants (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T5, step 2.5; migration 0027), on the services as
 * createContext wires them:
 *
 *  - reaching PLATINE by a first registration, or PALLADIUM by a transfer accepted, makes that tier's welcome GIFT and
 *    CREDIT (THE PROGRAM's amount, currency and months), each audited `club.grant` by the system;
 *  - an account that reaches PALLADIUM at once receives both tiers' grants;
 *  - once per tier and per account, ever: PLATINE, then TITANE, then PLATINE again gives no new row; a grant is never
 *    deleted (the database refuses it);
 *  - a piece reinstated (a flag lifted) counts again, and its owner's grants are made in its transaction;
 *  - a status read makes them, idempotently; at boot, `prepare` makes those of every ACTIVE account at PLATINE or above;
 *  - below its tier a grant waits: its credit is not usable, then comes back with its expiry unchanged;
 *  - a credit of 0 in THE PROGRAM gives no CREDIT row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { createScanToken } from '../../src/server/services/scan-tokens.js';
import { addUtcMonths, creditBalances } from '../../src/server/services/tier-grants.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;

describe('the tiers\' grants (BP-19 T5)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-03T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const grantsOf = (accountId: string) =>
    t.db.selectFrom('tier_grants').select(['tier', 'kind', 'amount_minor', 'currency', 'granted_at', 'expires_at']).where('account_id', '=', accountId).orderBy('tier').orderBy('kind').execute();
  const grantAudits = (accountId: string) =>
    t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('target_id', '=', accountId).where('action', '=', 'club.grant').orderBy('id').execute();

  /** A piece issued with its claim code, its warranty started: `register` it to an account, as a buyer would. */
  async function piece() {
    const p = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '54', material: '925 STERLING SILVER', withClaimSecret: true }, admin);
    await ctx.services.warranty.activate(p.product.id, { purchaseDate: '2026-11-01', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    return p;
  }
  async function register(accountId: string, p: Awaited<ReturnType<typeof piece>>) {
    const scan = await ctx.services.verification.verify({ code: p.code.data }, {});
    clock.advance(MINUTE);
    return ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode: p.claimCode! }, { type: 'account', id: accountId });
  }
  /** The recipient's signed-in scan of the piece (F-03), and the transfer code entered with it. */
  async function accept(accountId: string, code: string, p: Awaited<ReturnType<typeof piece>>) {
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: p.product.id, account_id: accountId, event_type: 'VERIFY', result_state: 'AUTHENTIC_REGISTERED', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const token = (await createScanToken(t.db, { productId: p.product.id, scanEventId: scan.id, purpose: 'TRANSFER_ACCEPT', now: clock.now() })).token;
    clock.advance(MINUTE);
    return ctx.services.ownership.acceptTransfer(accountId, { transferCode: code, productId: p.product.productId, transferToken: token }, { type: 'account', id: accountId });
  }

  it('makes PLATINE\'s GIFT and CREDIT when a first registration reaches it, audited by the system; nothing below it', async () => {
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, 3, f.modelId);
    await register(a.id, await piece());
    // Four pieces: TITANE, nothing granted.
    expect(await grantsOf(a.id)).toEqual([]);
    const now = clock.now();
    await register(a.id, await piece());
    const registeredAt = clock.now();
    expect(registeredAt.getTime()).toBeGreaterThan(now.getTime());
    expect(await grantsOf(a.id)).toEqual([
      { tier: 2, kind: 'CREDIT', amount_minor: 5_000, currency: 'EUR', granted_at: registeredAt, expires_at: addUtcMonths(registeredAt, 12) },
      { tier: 2, kind: 'GIFT', amount_minor: null, currency: null, granted_at: registeredAt, expires_at: null },
    ]);
    const audits = await grantAudits(a.id);
    expect(audits.map((x) => [x.actor_type, (x.details as { kind: string }).kind, (x.details as { tier: number }).tier])).toEqual([
      ['system', 'GIFT', 2],
      ['system', 'CREDIT', 2],
    ]);
    expect(audits[1]!.details).toMatchObject({ amountMinor: 5_000, currency: 'EUR', expiresAt: addUtcMonths(registeredAt, 12).toISOString() });
    // The club's status read again changes nothing: once per tier.
    await ctx.services.club.status(a.id);
    expect(await grantsOf(a.id)).toHaveLength(2);
    expect(await grantAudits(a.id)).toHaveLength(2);
  });

  it('makes PALLADIUM\'s when a transfer accepted reaches it; both tiers at once for an account that reaches PALLADIUM directly', async () => {
    const seller = await createAccount(t.db);
    const p = await piece();
    await register(seller.id, p);
    const buyer = await createAccount(t.db);
    await holdPieces(t.db, buyer.id, 9, f.modelId);
    // Nine pieces held, no write of the club's yet: no grant until one is made.
    expect(await grantsOf(buyer.id)).toEqual([]);
    const offer = await ctx.services.ownership.initiateTransfer(seller.id, p.product.productId, { type: 'account', id: seller.id });
    await accept(buyer.id, offer.transferCode, p);
    expect((await grantsOf(buyer.id)).map((g) => [g.tier, g.kind, g.amount_minor])).toEqual([
      [2, 'CREDIT', 5_000],
      [2, 'GIFT', null],
      [3, 'CREDIT', 10_000],
      [3, 'GIFT', null],
    ]);
    expect(await grantAudits(buyer.id)).toHaveLength(4);
  });

  it('grants once per tier and per account, ever: PLATINE, then TITANE, then PLATINE again gives no new row; a grant is never deleted', async () => {
    const a = await createAccount(t.db);
    const held = await holdPieces(t.db, a.id, 5, f.modelId);
    expect(await ctx.services.tierGrants.ensure(a.id)).toBe(2);
    const before = await grantsOf(a.id);
    // TITANE: a piece passed on.
    await t.db.updateTable('ownership').set({ ended_at: clock.now(), ended_reason: 'TRANSFERRED_OUT' }).where('product_id', '=', held[0]!).execute();
    clock.advance(MINUTE);
    expect(await ctx.services.tierGrants.ensure(a.id)).toBe(0);
    // PLATINE again, a year later: the same rows, the expiry unchanged.
    clock.advance(365 * 24 * 60 * MINUTE);
    await holdPieces(t.db, a.id, 1, f.modelId);
    expect(await ctx.services.tierGrants.ensure(a.id)).toBe(0);
    await ctx.services.club.status(a.id);
    expect(await grantsOf(a.id)).toEqual(before);
    // The database refuses a grant's deletion, and a change of what it gave.
    await expect(t.db.deleteFrom('tier_grants').where('account_id', '=', a.id).execute()).rejects.toThrow();
    await expect(t.db.updateTable('tier_grants').set({ amount_minor: 1 }).where('account_id', '=', a.id).where('kind', '=', 'CREDIT').execute()).rejects.toThrow();
  });

  it('counts a piece reinstated again: its owner\'s grants are made in its transaction', async () => {
    const a = await createAccount(t.db);
    const [flagged] = await holdPieces(t.db, a.id, 5, f.modelId);
    const productId = (await t.db.selectFrom('products').select('product_id').where('id', '=', flagged!).executeTakeFirstOrThrow()).product_id;
    await ctx.services.lifecycle.transition(productId, 'COUNTERFEIT_FLAGGED', { reason: 'To be examined.' }, admin);
    // Four pieces counted: the status read grants nothing.
    await ctx.services.club.status(a.id);
    expect(await grantsOf(a.id)).toEqual([]);
    await ctx.services.lifecycle.transition(productId, 'OWNED', { reason: 'Examined: authentic.' }, admin);
    expect((await grantsOf(a.id)).map((g) => [g.tier, g.kind])).toEqual([
      [2, 'CREDIT'],
      [2, 'GIFT'],
    ]);
  });

  it('lets a grant wait below its tier: its credit is not offered, then comes back with its expiry unchanged', async () => {
    const a = await createAccount(t.db);
    const held = await holdPieces(t.db, a.id, 5, f.modelId);
    await ctx.services.tierGrants.ensure(a.id);
    const [credit] = await creditBalances(t.db, a.id);
    expect(credit).toMatchObject({ tier: 2, amountMinor: 5_000, balanceMinor: 5_000, currency: 'EUR' });
    await t.db.updateTable('ownership').set({ ended_at: clock.now(), ended_reason: 'TRANSFERRED_OUT' }).where('product_id', '=', held[0]!).execute();
    // TITANE: the grant is kept, waiting (its row and balance unchanged).
    expect((await creditBalances(t.db, a.id))[0]).toEqual(credit);
    await holdPieces(t.db, a.id, 1, f.modelId);
    expect((await creditBalances(t.db, a.id))[0]!.expiresAt).toEqual(credit!.expiresAt);
  });

  it('makes no CREDIT for a credit of 0, and at boot the grants of every ACTIVE account at PLATINE or above, idempotently', async () => {
    const program = ctx.services.clubProgram;
    await program.update({ ...(await program.read()), creditPlatineMinor: 0 }, admin);
    const platine = await createAccount(t.db);
    await holdPieces(t.db, platine.id, 5, f.modelId);
    const locked = await createAccount(t.db);
    await holdPieces(t.db, locked.id, 5, f.modelId);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    const titane = await createAccount(t.db);
    await holdPieces(t.db, titane.id, 1, f.modelId);
    const made = await ctx.services.tierGrants.prepare();
    expect(made).toBeGreaterThanOrEqual(1);
    expect((await grantsOf(platine.id)).map((g) => [g.tier, g.kind])).toEqual([[2, 'GIFT']]);
    expect(await grantsOf(locked.id)).toEqual([]);
    expect(await grantsOf(titane.id)).toEqual([]);
    // Again: nothing more.
    expect(await ctx.services.tierGrants.prepare()).toBe(0);
    await t.db.deleteFrom('club_program_settings').execute();
  });

  it('counts the months in UTC calendar months', () => {
    expect(addUtcMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addUtcMonths(new Date('2026-11-03T09:00:00Z'), 12).toISOString()).toBe('2027-11-03T09:00:00.000Z');
  });
});
