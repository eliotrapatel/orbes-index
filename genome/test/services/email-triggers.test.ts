/**
 * The emails' triggers (lot M1 plan §4.2, §4.5; step M1.17; services/email-triggers.ts), on PGlite with the channel on
 * (an SMTP channel no test reaches: nothing here sends, the outbox is read back):
 *  - off by default: the channel off, or a kind not switched on, writes nothing for any act;
 *  - E4 and ORDER_CANCELLED: an order's PAID (« order confirmed »), SHIPPED with its carrier and tracking page, DELIVERED
 *    and CANCELLED, each once, in the step's transaction; a GIFT order never (platformSendsOrderEmails); a test entrant
 *    and a locked account never;
 *  - E5: a draw's places selected, OFFER NEXT, the two labels;
 *  - E2: the watermark (nothing announced before the first scan), opted-in ACTIVE accounts only, test entrants left out,
 *    a LIVE RELEASE unnamed before its name's stage, the access rule in words, once per release and account, YOUR
 *    PROFILE's choice turned off cancelling what is queued, the sender cancelling a notice whose account stopped them;
 *  - E1: now or at the opening, once per release and pre-registration, unsubscribed ones left out, the phrase, the
 *    refusals, CANCEL SCHEDULED, sent again after a cancel; one release ever (409 FOUNDING_ALREADY_ANNOUNCED, a cancelled
 *    one replaced); the unsubscribe link; a removal takes its emails with it;
 *  - E1 and E2: a release cancelled (a draw, a LIVE RELEASE) cancels its queued emails; the sender cancels one whose
 *    release is cancelled or over; a LIVE RELEASE's opening moved cancels its queued announcements; the watermark left
 *    over an hour behind starts again;
 *  - E3: the sender cancels a reset whose code was replaced, used or expired;
 *  - E6: no kind exists for house messages.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig, type EmailConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { EMAIL_KINDS, type EmailKind, type OrderRow } from '../../src/server/db/schema.js';
import { EMAIL_DEFAULTS, EMAIL_SAMPLE_VALUES } from '../../src/server/email/copy.js';
import { emailWhen } from '../../src/server/email/render.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { CANCELLED_WORDS, EmailService } from '../../src/server/services/email.js';
import { announcementPhrase, platformSendsOrderEmails, RELEASE_NOTICE_OVERLAP_MS } from '../../src/server/services/email-triggers.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw } from '../support/draws.js';
import { countPiecesIn, packAndShip, scanIntoParcel } from '../support/fulfil.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const ORIGIN = 'https://verify.orbes.test';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PUBLIC: Actor = { type: 'system', id: 'public' };

const ON: EmailConfig = {
  transport: 'smtp',
  from: { address: 'hello@theorbes.com', name: 'ORBES' },
  replyTo: null,
  smtp: { host: 'smtp.invalid', port: 465, security: 'tls', user: 'u', password: 'p' },
};

async function refusal(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

describe('the emails’ triggers (E1 to E6)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor & { id: string };
  let france: string;
  let colissimo: string;
  let sizeSeq = 40;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig({ publicOrigin: ORIGIN, email: ON }), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    france = (await t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });
  beforeEach(async () => {
    await t.db.deleteFrom('email_outbox').execute();
    await t.db.deleteFrom('email_templates').execute();
  });

  const email = () => ctx.services.email;
  const emails = () => ctx.services.emails;
  const outbox = (kind?: EmailKind) =>
    t.db
      .selectFrom('email_outbox')
      .selectAll()
      .$if(kind !== undefined, (q) => q.where('kind', '=', kind!))
      .orderBy('created_at')
      .orderBy('dedupe_key')
      .execute();
  const on = async (...kinds: EmailKind[]) => {
    for (const k of kinds) await email().setEnabled(k, true, admin);
  };
  const audits = (action: string) => t.db.selectFrom('audit_logs').select(['target_id', 'details', 'actor_type']).where('action', '=', action).orderBy('id').execute();

  /** An ACTIVE account with a first name (YOUR PROFILE). */
  async function collector(firstName: string | null = 'Camille') {
    const a = await createAccount(t.db);
    if (firstName) await t.db.insertInto('account_profiles').values({ account_id: a.id, first_name: firstName }).execute();
    return a;
  }

  // ── E4 and an order cancelled ────────────────────────────────────────────

  /** A private salon's order of `buyer`, priced and sized, RESERVED; its piece in stock at FRANCE WAREHOUSE. */
  async function salonOrder(buyer: string) {
    const size = String(sizeSeq++);
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, size));
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: size, material: '925 STERLING SILVER', withClaimSecret: true }, admin);
    await countPiecesIn(ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, admin);
    const request = await t.db.insertInto('shop_requests').values({ account_id: buyer, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    return { id, piece };
  }

  it('writes nothing while the channel is off, nor for a kind not switched on', async () => {
    const off = await createContext(testConfig({ publicOrigin: ORIGIN }), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
    try {
      expect(off.services.email.on).toBe(false);
      await on('ORDER_CONFIRMED');
      const a = await collector();
      const { id } = await salonOrder(a.id);
      await off.services.orders.transition(id, { to: 'PAID' }, admin);
      expect(await outbox()).toEqual([]);
    } finally {
      await off.close();
    }
    // On, but the kind off: nothing either.
    await t.db.deleteFrom('email_templates').execute();
    const b = await collector();
    const second = await salonOrder(b.id);
    await ctx.services.orders.transition(second.id, { to: 'PAID' }, admin);
    expect(await outbox()).toEqual([]);
  });

  it('E4: confirmed at PAID, shipped with its carrier and tracking page, delivered; each once, in the step’s transaction, for the buyer only', async () => {
    await on('ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED');
    const a = await collector('Léa');
    const { id, piece } = await salonOrder(a.id);
    const ref = `OR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    clock.advance(MINUTE);
    await ctx.services.orders.transition(id, { to: 'PAID' }, admin);
    let rows = await outbox();
    expect(rows.map((r) => [r.kind, r.dedupe_key, r.account_id, r.to_address, r.status])).toEqual([['ORDER_CONFIRMED', `ORDER_CONFIRMED:${id}`, a.id, a.email, 'QUEUED']]);
    expect(rows[0]!.subject).toBe(`Your order ${ref} is confirmed`);
    expect(rows[0]!.body_text).toContain('Léa,');
    expect(rows[0]!.body_text).toContain(`SEE YOUR ORDER: ${ORIGIN}/verify/orders/${ref}`);

    await scanIntoParcel(ctx, id, { pieces: { [id]: piece.product.productId } }, admin);
    clock.advance(MINUTE);
    await packAndShip(ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    rows = await outbox('ORDER_SHIPPED');
    expect(rows.map((r) => r.dedupe_key)).toEqual([`ORDER_SHIPPED:${id}:6A12345678901`]);
    expect(rows[0]!.body_text).toContain('has left ORBES with Colissimo');
    expect(rows[0]!.body_text).toMatch(/FOLLOW THE PARCEL: https:\/\/\S+6A12345678901/);

    clock.advance(MINUTE);
    await ctx.services.orders.transition(id, { to: 'DELIVERED' }, admin);
    expect((await outbox('ORDER_DELIVERED')).map((r) => r.dedupe_key)).toEqual([`ORDER_DELIVERED:${id}`]);
    expect(await outbox('ORDER_CANCELLED')).toEqual([]);
    expect((await outbox()).every((r) => r.account_id === a.id && r.preregistration_id === null)).toBe(true);
  });

  it('E5: an order cancelled is told, its credit note mentioned; a step that fails writes nothing', async () => {
    await on('ORDER_CONFIRMED', 'ORDER_CANCELLED');
    const a = await collector();
    const { id } = await salonOrder(a.id);
    await ctx.services.orders.transition(id, { to: 'PAID' }, admin);
    // A refused step (PAID again) rolls back with its act: still one email.
    await refusal(ctx.services.orders.transition(id, { to: 'PAID' }, admin));
    expect(await outbox()).toHaveLength(1);
    await ctx.services.orders.transition(id, { to: 'CANCELLED', note: 'The collector changed their mind.' }, admin);
    const cancelled = await outbox('ORDER_CANCELLED');
    expect(cancelled.map((r) => r.dedupe_key)).toEqual([`ORDER_CANCELLED:${id}`]);
    expect(cancelled[0]!.body_text).toContain('If it was paid, its credit note is with the order.');
  });

  it('E4: the platform’s orders only (a welcome GIFT never); a test entrant and a locked account never', async () => {
    expect(platformSendsOrderEmails({ channel: 'GIFT' })).toBe(false);
    for (const channel of ['LIVE', 'DRAW', 'SALON', 'EXCHANGE'] as const) expect(platformSendsOrderEmails({ channel }), channel).toBe(true);
    await on('ORDER_CONFIRMED');
    const a = await collector();
    const { id } = await salonOrder(a.id);
    const row = await t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await inTransaction(t.db, (tx) => emails().orderStep(tx, { ...row, channel: 'GIFT' } as OrderRow, 'PAID'));
    expect(await outbox()).toEqual([]);
    // A test entrant's address (@orbes.test) reaches nobody.
    await t.db.insertInto('test_entrants').values({ account_id: a.id }).execute();
    await ctx.services.orders.transition(id, { to: 'PAID' }, admin);
    expect(await outbox()).toEqual([]);
    // A locked account gets nothing.
    const b = await collector();
    const second = await salonOrder(b.id);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', b.id).execute();
    await ctx.services.orders.transition(second.id, { to: 'PAID' }, admin);
    expect(await outbox()).toEqual([]);
  });

  // ── E5: draws and labels ─────────────────────────────────────────────────

  it('E5: the places a draw selects (held until respond_by), OFFER NEXT; never the waiting list', async () => {
    await on('DRAW_SELECTED', 'DRAW_OFFERED');
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const d = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The November draw', quantity: 2, opensAt, closesAt: new Date(opensAt.getTime() + HOUR), earlyAccessHours: 0, purchaseWindowHours: 48 }, admin);
    const people = [await collector('Ana'), await collector('Ben'), await collector('Cleo'), await collector('Dan')];
    clock.set(opensAt);
    for (const p of people) await f.drops.enter(p.id, d.id, p.actor);
    clock.set(new Date(opensAt.getTime() + HOUR + MINUTE));
    await f.drops.draw(d.id, admin);
    const entries = await t.db.selectFrom('drop_entries').select(['id', 'account_id', 'status', 'respond_by']).where('drop_id', '=', d.id).execute();
    const selected = entries.filter((e) => e.status === 'SELECTED');
    expect(selected).toHaveLength(2);
    let rows = await outbox('DRAW_SELECTED');
    expect(rows.map((r) => r.dedupe_key).sort()).toEqual(selected.map((e) => `DRAW_SELECTED:${e.id}`).sort());
    expect(rows.map((r) => r.account_id).sort()).toEqual(selected.map((e) => e.account_id).sort());
    expect(rows[0]!.body_text).toContain('The November draw');
    expect(rows[0]!.body_text).toContain('Paris time');
    expect(rows[0]!.body_text).toContain(`${ORIGIN}/verify/releases/${d.id}`);
    // A place lapses, the next is offered.
    clock.set(new Date(clock.now().getTime() + 49 * HOUR));
    await f.drops.lapse(d.id, selected[0]!.id, null, admin);
    const offered = await f.drops.offerNext(d.id, admin);
    rows = await outbox('DRAW_OFFERED');
    expect(rows.map((r) => r.dedupe_key)).toEqual([`DRAW_OFFERED:${offered.id}`]);
    expect(rows[0]!.subject).toBe('A place is offered to you');
  });

  it('E5: the warranty claim’s and the PRIVATE CARE’s prepaid labels link to the piece; both services carry the trigger', async () => {
    await on('WARRANTY_LABEL', 'CARE_LABEL');
    const a = await collector();
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '52', material: '925 STERLING SILVER' }, admin);
    const claimId = '11111111-1111-4111-8111-111111111111';
    const careId = '22222222-2222-4222-8222-222222222222';
    await inTransaction(t.db, async (tx) => {
      await emails().label(tx, 'WARRANTY_LABEL', { id: claimId, accountId: a.id, productUuid: piece.product.id });
      await emails().label(tx, 'CARE_LABEL', { id: careId, accountId: a.id, productUuid: piece.product.id });
      await emails().label(tx, 'CARE_LABEL', { id: careId, accountId: a.id, productUuid: piece.product.id });
      await emails().label(tx, 'WARRANTY_LABEL', { id: 'x', accountId: null, productUuid: piece.product.id });
    });
    const rows = await outbox();
    expect(rows.map((r) => [r.kind, r.dedupe_key])).toEqual([
      ['CARE_LABEL', `CARE_LABEL:${careId}`],
      ['WARRANTY_LABEL', `WARRANTY_LABEL:${claimId}`],
    ]);
    for (const r of rows) expect(r.body_text).toContain(`OPEN ORBES CARE: ${ORIGIN}/verify/pieces/${piece.product.productId}`);
    expect((ctx.services.care as unknown as { emails: unknown }).emails).toBe(emails());
    expect((ctx.services.warrantyClaims as unknown as { emails: unknown }).emails).toBe(emails());
  });

  it('E6: house messages have no email kind', () => {
    expect([...EMAIL_KINDS].sort()).toEqual(
      ['FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE', 'PASSWORD_RESET', 'ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'DRAW_SELECTED', 'DRAW_OFFERED', 'WARRANTY_LABEL', 'CARE_LABEL'].sort(),
    );
    expect(EMAIL_KINDS.some((k) => /MESSAGE|HOUSE/.test(k))).toBe(false);
  });

  // ── E2: the release notices ──────────────────────────────────────────────

  it('E2: from the watermark on, a release announced goes to the accounts that asked, once each; never a test entrant, a locked account, or before the first scan', async () => {
    await t.db.deleteFrom('email_state').execute();
    await on('RELEASE_NOTICE');
    const asked = await collector('Iris');
    const silent = await collector();
    const bot = await collector();
    const locked = await collector();
    for (const a of [asked, bot, locked]) await emails().setPreferences(a.id, { releaseNotices: true }, a.actor);
    await t.db.insertInto('test_entrants').values({ account_id: bot.id }).execute();
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    // Announced before the first scan: never written.
    const before = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The October draw', quantity: 3, opensAt: new Date(clock.now().getTime() + 24 * HOUR), closesAt: new Date(clock.now().getTime() + 48 * HOUR), earlyAccessHours: 0 }, admin);
    clock.advance(MINUTE);
    await email().sendDue();
    // The watermark starts after the overlap ahead, so its first scans look back no further than their start.
    expect((await t.db.selectFrom('email_state').selectAll().executeTakeFirstOrThrow()).releases_until).toEqual(new Date(clock.now().getTime() + RELEASE_NOTICE_OVERLAP_MS));
    clock.advance(MINUTE);
    await email().sendDue();
    expect(await outbox()).toEqual([]);
    clock.advance(RELEASE_NOTICE_OVERLAP_MS + MINUTE);
    // A draw published now, a LIVE RELEASE announced now but not named yet.
    const draw = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The November draw', quantity: 3, opensAt: new Date(clock.now().getTime() + 24 * HOUR), closesAt: new Date(clock.now().getTime() + 48 * HOUR), earlyAccessHours: 0 }, admin);
    const live = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 72 * HOUR) });
    await t.db.updateTable('drops').set({ title: 'MONOLITHE NOIR', name_at: new Date(clock.now().getTime() + 24 * HOUR) }).where('id', '=', live.id).execute();
    clock.advance(1_000);
    await email().sendDue();
    const rows = await outbox('RELEASE_NOTICE');
    expect(rows.map((r) => [r.dedupe_key, r.account_id]).sort()).toEqual(
      [
        [`E2:${draw.id}:${asked.id}`, asked.id],
        [`E2:${live.id}:${asked.id}`, asked.id],
      ].sort(),
    );
    expect(rows.some((r) => r.dedupe_key.includes(before.id))).toBe(false);
    const drawNotice = rows.find((r) => r.dedupe_key.includes(draw.id))!;
    expect(drawNotice.body_text).toContain('The November draw opens');
    expect(drawNotice.body_text).toContain('It is open to every ORBES account.');
    expect(drawNotice.body_text).toContain('STOP THESE EMAILS');
    const liveNotice = rows.find((r) => r.dedupe_key.includes(live.id))!;
    expect(liveNotice.body_text).toContain('A LIVE RELEASE opens');
    expect(liveNotice.body_text).not.toContain('MONOLITHE NOIR');
    // Again: nothing new.
    clock.advance(1_000);
    await email().sendDue();
    expect(await outbox('RELEASE_NOTICE')).toHaveLength(2);
    expect(silent.id).not.toBe(asked.id);
  });

  it('E2: YOUR PROFILE’s choice: off until asked, audited; turned off it cancels what is queued, and the sender cancels a notice whose account stopped them', async () => {
    const a = await collector();
    expect(await emails().preferences(a.id)).toEqual({ releaseNotices: false, changedAt: null });
    expect(await emails().setPreferences(a.id, { releaseNotices: true }, a.actor)).toEqual({ releaseNotices: true, changedAt: clock.now() });
    // Unchanged: not audited again.
    await emails().setPreferences(a.id, { releaseNotices: true }, a.actor);
    expect((await audits('account.email_preferences')).filter((x) => x.target_id === a.id)).toHaveLength(1);
    await on('RELEASE_NOTICE');
    await email().enqueue(t.db, { kind: 'RELEASE_NOTICE', to: a.email, accountId: a.id, dedupeKey: 'E2:test:1', values: {} });
    await emails().setPreferences(a.id, { releaseNotices: false }, a.actor);
    expect((await outbox()).map((r) => [r.status, r.last_error])).toEqual([['CANCELLED', CANCELLED_WORDS.releaseNotices]]);
    // Written while asked, stopped since by a write that did not go through the service: the sender cancels it.
    await t.db.deleteFrom('email_outbox').execute();
    await t.db.updateTable('email_preferences').set({ release_notices: true }).where('account_id', '=', a.id).execute();
    await email().enqueue(t.db, { kind: 'RELEASE_NOTICE', to: a.email, accountId: a.id, dedupeKey: 'E2:test:2', values: {} });
    await t.db.updateTable('email_preferences').set({ release_notices: false }).where('account_id', '=', a.id).execute();
    const sender = new EmailService({ db: t.db, config: { publicOrigin: ORIGIN, email: ON }, unsubscribeKey: new Uint8Array(32), clock: clock.now, transport: async () => undefined });
    expect(await sender.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 1 });
    expect((await outbox())[0]).toMatchObject({ status: 'CANCELLED', last_error: CANCELLED_WORDS.releaseNotices, sent_at: null });
    expect((await outbox())[0]!.settled_at).toEqual(clock.now());
  });

  // ── E1: the founding announcement ────────────────────────────────────────

  async function register(first: string) {
    const address = `${first.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase()}-${randomBytes(3).toString('hex')}@example.com`;
    const r = (await ctx.services.founding.register({ email: address, firstName: first, country: 'FR', consent: true }, PUBLIC)) as { id: string };
    return { id: r.id, email: address };
  }

  it('E1: to every pre-registration not unsubscribed, now or at the opening, once per release; CANCEL SCHEDULED; again after a cancel', async () => {
    await t.db.deleteFrom('preregistrations').execute();
    const opensAt = new Date(clock.now().getTime() + 48 * HOUR);
    const d = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The first draw', quantity: 5, opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0 }, admin);
    const lea = await register('Léa');
    const max = await register('Max');
    const gone = await register('Zoé');
    await ctx.services.founding.unsubscribe(gone.id, PUBLIC);
    const phrase = announcementPhrase(d.id);
    expect(phrase).toBe(`SEND ${d.id.slice(0, 8).toUpperCase()}`);

    // Refusals: the kind off, a wrong phrase.
    expect((await refusal(emails().queueAnnouncement(d.id, { when: 'NOW', phrase }, admin))).code).toBe('EMAIL_KIND_OFF');
    await on('FOUNDING_ANNOUNCEMENT');
    expect((await refusal(emails().queueAnnouncement(d.id, { when: 'NOW', phrase: 'SEND' }, admin))).code).toBe('VALIDATION_FAILED');

    // At the opening.
    expect(await emails().queueAnnouncement(d.id, { when: 'OPENING', phrase: phrase.toLowerCase() }, admin)).toEqual({ queued: 2, notBefore: opensAt });
    let rows = await outbox('FOUNDING_ANNOUNCEMENT');
    expect(rows.map((r) => [r.dedupe_key, r.preregistration_id, r.account_id, r.not_before.getTime()]).sort()).toEqual(
      [
        [`E1:${d.id}:${lea.id}`, lea.id, null, opensAt.getTime()],
        [`E1:${d.id}:${max.id}`, max.id, null, opensAt.getTime()],
      ].sort(),
    );
    const leas = rows.find((r) => r.preregistration_id === lea.id)!;
    expect(leas.body_text).toContain('Léa,');
    expect(leas.body_text).toContain('The first draw opens');
    expect(leas.body_text).toContain(`${ORIGIN}/verify/unsubscribe#f.${lea.id}.`);
    // Once per release: pressed again, nothing more.
    expect((await emails().queueAnnouncement(d.id, { when: 'NOW', phrase }, admin)).queued).toBe(0);
    const panel = await emails().announcement();
    expect(panel).toMatchObject({ channel: true, enabled: true, reach: 2 });
    expect(panel.releases.find((r) => r.id === d.id)).toMatchObject({ emails: { queued: 2, sent: 0, failed: 0, cancelled: 0 }, scheduledAt: opensAt, announced: true, words: 'The first draw' });
    // The panel's preview: the release chosen, its opening in Paris and its page; an example first name, never a person's.
    const preview = await emails().announcementPreview(d.id);
    expect(preview.subject).toBe(EMAIL_DEFAULTS.FOUNDING_ANNOUNCEMENT.subject);
    expect(preview.text).toContain(`The first draw opens ${emailWhen(opensAt)}, Paris time.`);
    expect(preview.text).toContain(`${ORIGIN}/verify/releases/${d.id}`);
    expect(preview.text).toContain(`${EMAIL_SAMPLE_VALUES.firstName},`);
    expect(preview.text).not.toContain('Léa');
    expect(preview.html).toContain('The first draw opens');

    // CANCEL SCHEDULED, then sent again now: new keys, the cancelled kept as the record.
    expect(await emails().cancelAnnouncement(d.id, admin)).toEqual({ cancelled: 2 });
    expect(await emails().cancelAnnouncement(d.id, admin)).toEqual({ cancelled: 0 });
    expect((await audits('email.announcement.cancel')).map((x) => x.details)).toEqual([{ dropId: d.id, cancelled: 2 }]);
    expect((await emails().queueAnnouncement(d.id, { when: 'NOW', phrase }, admin)).queued).toBe(2);
    rows = await outbox('FOUNDING_ANNOUNCEMENT');
    expect(rows.filter((r) => r.status === 'QUEUED').map((r) => r.dedupe_key).sort()).toEqual([`E1:${d.id}:${lea.id}:2`, `E1:${d.id}:${max.id}:2`].sort());
    expect(rows.filter((r) => r.status === 'CANCELLED').every((r) => r.last_error === CANCELLED_WORDS.announcement)).toBe(true);
    const queued = await audits('email.announcement.queue');
    expect(queued.map((x) => (x.details as { queued: number }).queued)).toEqual([2, 0, 2]);
    expect(JSON.stringify(queued)).not.toContain(lea.email);
  });

  it('E1: goes for one release ever: once sent for one, another is refused 409 and the panel offers that one only; cancelled (its release, or every email of it), another may go (lot M1 review)', async () => {
    await t.db.deleteFrom('preregistrations').execute();
    await on('FOUNDING_ANNOUNCEMENT');
    await register('Léa');
    const opensAt = new Date(clock.now().getTime() + 48 * HOUR);
    const draw = (title: string) => poolDraw(f.drops, t.db, { modelId: f.modelId, title, quantity: 3, opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0 }, admin);
    const a = await draw('The first');
    const b = await draw('The second');
    expect((await emails().announcement()).releases.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await emails().queueAnnouncement(a.id, { when: 'NOW', phrase: announcementPhrase(a.id) }, admin)).queued).toBe(1);
    // Sent (not only queued): still the one.
    await t.db.updateTable('email_outbox').set({ status: 'SENT', sent_at: clock.now(), settled_at: clock.now() }).execute();
    const refused = await refusal(emails().queueAnnouncement(b.id, { when: 'NOW', phrase: announcementPhrase(b.id) }, admin));
    expect([refused.code, refused.httpStatus]).toEqual(['FOUNDING_ALREADY_ANNOUNCED', 409]);
    expect((await emails().announcement()).releases.map((r) => r.id)).toEqual([a.id]);
    // Its own release again: allowed (nobody new is written to twice).
    expect((await emails().queueAnnouncement(a.id, { when: 'NOW', phrase: announcementPhrase(a.id) }, admin)).queued).toBe(0);
    // Every email of it cancelled: another release may go.
    await t.db.updateTable('email_outbox').set({ status: 'CANCELLED', sent_at: null, settled_at: clock.now() }).execute();
    expect((await emails().queueAnnouncement(b.id, { when: 'OPENING', phrase: announcementPhrase(b.id) }, admin)).queued).toBe(1);
    expect((await refusal(emails().queueAnnouncement(a.id, { when: 'NOW', phrase: announcementPhrase(a.id) }, admin))).code).toBe('FOUNDING_ALREADY_ANNOUNCED');
    // Its release cancelled: another may go.
    await f.drops.cancel(b.id, admin);
    expect((await emails().queueAnnouncement(a.id, { when: 'NOW', phrase: announcementPhrase(a.id) }, admin)).queued).toBe(1);
  });

  it('E1: refuses a LIVE RELEASE not announced yet sent now (at its opening it may go), an after-room, an unknown or a cancelled release; 409 EMAIL_OFF while the channel is off', async () => {
    await on('FOUNDING_ANNOUNCEMENT');
    const live = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 72 * HOUR), announceAt: new Date(clock.now().getTime() + 24 * HOUR) });
    const phrase = announcementPhrase(live.id);
    expect((await refusal(emails().queueAnnouncement(live.id, { when: 'NOW', phrase }, admin))).code).toBe('RELEASE_NOT_ANNOUNCED');
    expect((await emails().announcement()).releases.find((r) => r.id === live.id)).toMatchObject({ announced: false, words: 'A LIVE RELEASE' });
    expect((await emails().announcementPreview(live.id)).text).toContain('A LIVE RELEASE opens');
    expect((await refusal(emails().announcementPreview('00000000-0000-4000-8000-000000000000'))).code).toBe('DROP_NOT_FOUND');
    await emails().queueAnnouncement(live.id, { when: 'OPENING', phrase }, admin);
    expect((await refusal(emails().queueAnnouncement('00000000-0000-4000-8000-000000000000', { when: 'NOW', phrase: 'SEND 00000000' }, admin))).code).toBe('DROP_NOT_FOUND');
    const off = await createContext(testConfig({ publicOrigin: ORIGIN }), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
    try {
      expect((await refusal(off.services.emails.queueAnnouncement(live.id, { when: 'NOW', phrase }, admin))).code).toBe('EMAIL_OFF');
      expect((await off.services.emails.announcement()).channel).toBe(false);
    } finally {
      await off.close();
    }
  });

  it('E1 and E2: a release cancelled cancels its queued founding announcements and release notices (a draw and a LIVE RELEASE); the sender cancels one whose release was cancelled or is over', async () => {
    await t.db.deleteFrom('preregistrations').execute();
    await on('FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE');
    const lea = await register('Léa');
    const reader = await collector('Iris');
    await emails().setPreferences(reader.id, { releaseNotices: true }, reader.actor);
    const opensAt = new Date(clock.now().getTime() + 48 * HOUR);
    const d = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The cancelled draw', quantity: 3, opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0 }, admin);
    const live = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 72 * HOUR) });
    const kept = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The kept draw', quantity: 3, opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0 }, admin);
    const queue = async (r: { id: string }) => {
      expect((await emails().queueAnnouncement(r.id, { when: 'OPENING', phrase: announcementPhrase(r.id) }, admin)).queued).toBe(1);
      await email().enqueue(t.db, { kind: 'RELEASE_NOTICE', to: reader.email, accountId: reader.id, dedupeKey: `E2:${r.id}:${reader.id}`, values: {} });
    };
    // One release at a time: the founding announcement goes for one release ever, a cancelled one replaced (lot M1 review).
    await queue(d);
    expect((await refusal(emails().queueAnnouncement(live.id, { when: 'OPENING', phrase: announcementPhrase(live.id) }, admin))).code).toBe('FOUNDING_ALREADY_ANNOUNCED');
    await f.drops.cancel(d.id, admin);
    await queue(live);
    await ctx.services.liveConsole.cancel(live.id, admin);
    await queue(kept);
    const rows = await outbox();
    const of = (id: string) => rows.filter((r) => r.dedupe_key.includes(id)).map((r) => [r.kind, r.status, r.last_error, r.settled_at]);
    for (const id of [d.id, live.id])
      expect(of(id).sort()).toEqual(
        [
          ['FOUNDING_ANNOUNCEMENT', 'CANCELLED', CANCELLED_WORDS.releaseCancelled, clock.now()],
          ['RELEASE_NOTICE', 'CANCELLED', CANCELLED_WORDS.releaseCancelled, clock.now()],
        ].sort(),
      );
    expect(of(kept.id).map((r) => r[1])).toEqual(['QUEUED', 'QUEUED']);
    expect((await audits('drop.cancel')).find((x) => x.target_id === d.id)!.details).toMatchObject({ emailsCancelled: 2 });
    expect((await audits('drop.live.cancel')).find((x) => x.target_id === live.id)!.details).toMatchObject({ emailsCancelled: 2 });
    // The panel no longer lists them; the kept release's are still scheduled.
    const panel = await emails().announcement();
    expect(panel.releases.map((r) => r.id)).not.toContain(d.id);
    expect(panel.releases.find((r) => r.id === kept.id)).toMatchObject({ emails: { queued: 1, sent: 0, failed: 0, cancelled: 0 }, scheduledAt: opensAt });

    // At send time: a release cancelled by a write that did not go through the services, and one over, are not told.
    const sendAt = (at: Date) => new EmailService({ db: t.db, config: { publicOrigin: ORIGIN, email: ON }, unsubscribeKey: new Uint8Array(32), clock: () => at, transport: async () => undefined });
    await t.db.updateTable('drops').set({ cancelled_at: clock.now() }).where('id', '=', kept.id).execute();
    expect(await sendAt(opensAt).sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 2 });
    expect((await outbox()).filter((r) => r.dedupe_key.includes(kept.id)).map((r) => [r.status, r.last_error, r.sent_at])).toEqual([
      ['CANCELLED', CANCELLED_WORDS.releaseCancelled, null],
      ['CANCELLED', CANCELLED_WORDS.releaseCancelled, null],
    ]);
    const late = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The late draw', quantity: 3, opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0 }, admin);
    await emails().queueAnnouncement(late.id, { when: 'NOW', phrase: announcementPhrase(late.id) }, admin);
    expect(await sendAt(new Date(opensAt.getTime() + 25 * HOUR)).sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 1 });
    expect((await outbox('FOUNDING_ANNOUNCEMENT')).find((r) => r.dedupe_key === `E1:${late.id}:${lea.id}`)).toMatchObject({ status: 'CANCELLED', last_error: CANCELLED_WORDS.releaseOver, sent_at: null });
  });

  it('E1: a LIVE RELEASE’s opening moved before its announcement cancels the founding announcements queued for the old one; nothing goes at the old opening', async () => {
    await t.db.deleteFrom('preregistrations').execute();
    await on('FOUNDING_ANNOUNCEMENT');
    const lea = await register('Léa');
    const opensAt = new Date(clock.now().getTime() + 72 * HOUR);
    const live = await createLiveRelease(f, { opensAt, announceAt: new Date(clock.now().getTime() + 24 * HOUR) });
    const phrase = announcementPhrase(live.id);
    expect(await emails().queueAnnouncement(live.id, { when: 'OPENING', phrase }, admin)).toEqual({ queued: 1, notBefore: opensAt });
    // Another change keeps them.
    await ctx.services.liveConsole.update(live.id, { title: 'NIGHT II' }, admin);
    expect((await outbox('FOUNDING_ANNOUNCEMENT')).map((r) => r.status)).toEqual(['QUEUED']);
    const moved = new Date(opensAt.getTime() + 24 * HOUR);
    await ctx.services.liveConsole.update(live.id, { opensAt: moved, closesAt: new Date(moved.getTime() + HOUR) }, admin);
    expect((await outbox('FOUNDING_ANNOUNCEMENT')).map((r) => [r.dedupe_key, r.status, r.last_error, r.settled_at])).toEqual([[`E1:${live.id}:${lea.id}`, 'CANCELLED', CANCELLED_WORDS.openingMoved, clock.now()]]);
    const updates = (await audits('drop.live.update')).filter((x) => x.target_id === live.id);
    expect(updates.map((x) => (x.details as { emailsCancelled?: number }).emailsCancelled)).toEqual([undefined, 1]);
    expect((await emails().announcement()).releases.find((r) => r.id === live.id)).toMatchObject({ emails: { queued: 0, sent: 0, failed: 0, cancelled: 1 }, scheduledAt: null });
    const sendAt = (at: Date) => new EmailService({ db: t.db, config: { publicOrigin: ORIGIN, email: ON }, unsubscribeKey: new Uint8Array(32), clock: () => at, transport: async () => undefined });
    expect(await sendAt(opensAt).sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    // Sent again for the new opening: at it, saying it.
    expect(await emails().queueAnnouncement(live.id, { when: 'OPENING', phrase }, admin)).toEqual({ queued: 1, notBefore: moved });
    expect((await outbox('FOUNDING_ANNOUNCEMENT')).find((r) => r.status === 'QUEUED')).toMatchObject({ dedupe_key: `E1:${live.id}:${lea.id}:2`, not_before: moved });
  });

  it('E3: the sender cancels a reset whose code was replaced, used or is past its 30 minutes; it sends the open one', async () => {
    await on('PASSWORD_RESET');
    const a = await collector('Iris');
    await ctx.services.recovery.requestByEmail(a.email);
    clock.advance(MINUTE);
    await ctx.services.recovery.requestByEmail(a.email);
    const sendAt = (at: Date) => new EmailService({ db: t.db, config: { publicOrigin: ORIGIN, email: ON }, unsubscribeKey: new Uint8Array(32), clock: () => at, transport: async () => undefined });
    expect(await sendAt(clock.now()).sendDue()).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 1 });
    let rows = await outbox('PASSWORD_RESET');
    expect(rows.map((r) => [r.status, r.last_error])).toEqual([
      ['CANCELLED', CANCELLED_WORDS.resetInvalid],
      ['SENT', null],
    ]);
    // Past its 30 minutes when it is due (a retry late): not sent.
    clock.advance(MINUTE);
    await ctx.services.recovery.requestByEmail(a.email);
    expect(await sendAt(new Date(clock.now().getTime() + 31 * MINUTE)).sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 1 });
    rows = await outbox('PASSWORD_RESET');
    expect(rows[2]).toMatchObject({ status: 'CANCELLED', last_error: CANCELLED_WORDS.resetInvalid, sent_at: null });
  });

  it('E2: a watermark left over an hour behind (the channel switched off, then on) starts again as at the first scan: no burst for the releases announced meanwhile', async () => {
    await on('RELEASE_NOTICE');
    const reader = await collector('Iris');
    await emails().setPreferences(reader.id, { releaseNotices: true }, reader.actor);
    await t.db.deleteFrom('email_state').execute();
    await t.db.insertInto('email_state').values({ id: 1, releases_until: new Date(clock.now().getTime() - 3 * HOUR) }).execute();
    const meanwhile = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The quiet draw', quantity: 3, opensAt: new Date(clock.now().getTime() + 24 * HOUR), closesAt: new Date(clock.now().getTime() + 48 * HOUR), earlyAccessHours: 0 }, admin);
    clock.advance(1_000);
    await email().sendDue();
    expect(await outbox('RELEASE_NOTICE')).toEqual([]);
    expect((await t.db.selectFrom('email_state').selectAll().executeTakeFirstOrThrow()).releases_until).toEqual(new Date(clock.now().getTime() + RELEASE_NOTICE_OVERLAP_MS));
    clock.advance(RELEASE_NOTICE_OVERLAP_MS + MINUTE);
    const next = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'The next draw', quantity: 3, opensAt: new Date(clock.now().getTime() + 24 * HOUR), closesAt: new Date(clock.now().getTime() + 48 * HOUR), earlyAccessHours: 0 }, admin);
    clock.advance(1_000);
    await email().sendDue();
    // Every account that asked (earlier cases' too) has the next release's notice; none has the one announced meanwhile.
    const keys = (await outbox('RELEASE_NOTICE')).map((r) => r.dedupe_key);
    expect(keys).toContain(`E2:${next.id}:${reader.id}`);
    expect(keys.every((k) => k.startsWith(`E2:${next.id}:`))).toBe(true);
    expect(meanwhile.id).not.toBe(next.id);
  });

  it('the unsubscribe link: a pre-registration unsubscribed (its queued announcements cancelled), an account’s release notices off; a forged token does nothing; a removal takes its emails with it', async () => {
    await on('FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE');
    const p = await register('Nina');
    await email().enqueue(t.db, { kind: 'FOUNDING_ANNOUNCEMENT', to: p.email, preregistrationId: p.id, dedupeKey: `E1:x:${p.id}`, values: {} });
    const token = email().unsubscribeToken('FOUNDING_ANNOUNCEMENT', p.id);
    expect(emails().unsubscribeKind(token)).toBe('FOUNDING_ANNOUNCEMENT');
    expect(emails().unsubscribeKind(`${token.slice(0, -2)}AA`)).toBeNull();
    await emails().unsubscribe(`${token.slice(0, -2)}AA`);
    expect((await t.db.selectFrom('preregistrations').select('unsubscribed_at').where('id', '=', p.id).executeTakeFirstOrThrow()).unsubscribed_at).toBeNull();
    await emails().unsubscribe(token, 'ip-hash');
    expect((await t.db.selectFrom('preregistrations').select('unsubscribed_at').where('id', '=', p.id).executeTakeFirstOrThrow()).unsubscribed_at).toEqual(clock.now());
    expect((await outbox())[0]).toMatchObject({ status: 'CANCELLED', last_error: CANCELLED_WORDS.unsubscribed });
    await emails().unsubscribe(token); // used again: the same, nothing more
    expect((await audits('founding.unsubscribe')).filter((x) => x.target_id === p.id)).toHaveLength(1);

    const a = await collector();
    await emails().setPreferences(a.id, { releaseNotices: true }, a.actor);
    await emails().unsubscribe(email().unsubscribeToken('RELEASE_NOTICE', a.id));
    expect(await emails().preferences(a.id)).toMatchObject({ releaseNotices: false });
    const stopped = (await audits('account.email_preferences')).filter((x) => x.target_id === a.id);
    expect(stopped.map((x) => [x.actor_type, (x.details as { by: string }).by])).toEqual([
      ['account', 'profile'],
      ['account', 'unsubscribe'],
    ]);

    // Removed on request: its emails go with it (the outbox's foreign key is RESTRICT).
    await ctx.services.founding.remove(p.id, `REMOVE ${p.id.slice(0, 8).toUpperCase()}`, admin);
    expect(await t.db.selectFrom('email_outbox').select('id').where('preregistration_id', '=', p.id).execute()).toEqual([]);
  });
});
