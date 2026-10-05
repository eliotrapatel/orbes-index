/**
 * End-to-end: MY PIECES' orders (plan LIVE RELEASE+, step S3) in the built verification app, served by the real server
 * (in-memory database), driven in Chromium at a phone viewport.
 *
 *  - A collector who holds no piece yet, with three orders: a LIVE RELEASE's piece with its engraving, paid, made at the
 *    atelier and shipped by Colissimo; a private salon's whose size and price ORBES Client Services has still to enter;
 *    one cancelled. Another account's order never shows.
 *  - YOUR ORDERS under the pieces, the latest first: each card names the model, where it was sold and what its step
 *    means; RESERVED · PAID · SHIPPED · DELIVERED with their dates on this phone's calendar, the current one marked for a
 *    screen reader (aria-current), those to come without one; or the steps reached, then CANCELLED; SIZE, PRICE, the
 *    add-on and the TOTAL, or TO BE CONFIRMED (left out once cancelled); once shipped the CARRIER, the TRACKING NUMBER
 *    and TRACK THE SHIPMENT, the carrier's page in a new tab; the order's reference. YOUR RELEASES sends the LIVE
 *    RELEASE's piece to its order's steps, never a payment still to settle.
 *  - Delivered by ORBES Client Services, read again: every step reached, DELIVERED current.
 *  - Its documents (step S4, M6): the LIVE RELEASE's piece registered by the collector, its card offers its INVOICE
 *    (its number in the reading face) and its OWNERSHIP CERTIFICATE, each saved as a PDF, and its CARE GUIDE, opened
 *    under them (the house's general care text, its model having none) and closed again; the salon's order still to
 *    pay, its care guide only; the one cancelled before it was paid, none. A document that cannot be read says so.
 *  - Its orders unreadable (a server error): said, the pieces still shown; signed out: no orders at all.
 *
 * On the screen: the text's contrast on its ground computed from the page's own colours (at least 4.5 : 1), no figure in
 * the display face, one hairline button (SCAN ORBES CODE), the floors of BRAND-DESIGN-SYSTEM §3.8, nothing scrolling
 * sideways; no console error nor CSP report.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { DEFAULT_CARE, ORDERS } from '../../src/web/verify/copy.js';
import { orderDate } from '../../src/web/verify/orders-model.js';
import { createLiveRelease, liveFixture, type LiveFixture } from '../support/live.js';
import { tapZoneFloors } from '../support/tap-zones.js';
import { screenChecks } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}
/** The texts of `loc`'s elements, their spaces normalised (a price's no-break spaces read as spaces). */
async function textsOf(loc: Locator, expected: string[]): Promise<void> {
  await expect.poll(async () => (await loc.allInnerTexts()).map(norm), POLL).toEqual(expected);
}
const visible = (loc: Locator) => loc.waitFor({ state: 'visible', timeout: POLL.timeout });

describe.skipIf(!HAS_CHROMIUM)('MY PIECES: the orders of a collector (Chromium, phone)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let f: LiveFixture;
  let colissimo: string;
  let me: { id: string; token: string };
  /** The orders of the collector: the LIVE RELEASE's (shipped), the salon's to enter, the one cancelled. */
  const ids = { live: '', salon: '', cancelled: '', other: '' };
  /** The LIVE RELEASE's piece as the atelier issued it: its code's data and its claim code, for its buyer to register it. */
  const livePiece = { productId: '', codeData: '', claimCode: '' };

  async function account(tag: string) {
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `orders.e2e.${tag}@example.com`, password: PASSWORD }, {});
    return { id: a.id, token: session.token };
  }

  /** A request of the private salon closed as ACCEPTED by Client Services: its order, RESERVED. */
  async function salonOrder(accountId: string): Promise<string> {
    const request = await srv.ctx.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: new Date() }).returning('id').executeTakeFirstOrThrow();
    await srv.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    return (await srv.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  }

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    // The LIVE RELEASE three days ago, on services of its own clock over the server's database.
    f = await liveFixture(srv.ctx.db, new Date(Date.now() - 3 * DAY).toISOString());
    colissimo = (await srv.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    me = await account('me');
    const other = await account('other');

    const opensAt = new Date(f.clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 3 }], priceMinor: 480_000, addons: [{ label: 'Engraving', priceMinor: 25_000 }] });
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    const actor = { type: 'account' as const, id: me.id };
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(me.id, r.id, { sizeId: r.sizes[0]!.id }, actor);
    f.clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(me.id, r.id))!.turn!.token!;
    await f.live.press(me.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(me.id, r.id, token, actor);
    await f.live.setAddons(me.id, r.id, r.addons.map((a) => a.id), actor);
    await f.live.confirm(me.id, r.id, actor);
    ids.live = (await srv.ctx.db.selectFrom('orders').select('id').where('account_id', '=', me.id).where('channel', '=', 'LIVE').executeTakeFirstOrThrow()).id;

    // Today, ORBES Client Services: paid, the piece made at the atelier, shipped.
    const orders = srv.ctx.services.orders;
    await orders.transition(ids.live, { to: 'PAID' }, f.admin);
    const bench = await srv.ctx.db.selectFrom('bench_items').select('id').where('order_id', '=', ids.live).executeTakeFirstOrThrow();
    await srv.ctx.services.atelier.start(bench.id, f.admin);
    const done = await srv.ctx.services.atelier.done(bench.id, { material: '925 STERLING SILVER' }, f.admin);
    Object.assign(livePiece, { productId: done.productId, codeData: (await srv.ctx.services.issuance.printableCode(done.codeId)).data, claimCode: done.claimCode! });
    await orders.transition(ids.live, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, f.admin);

    ids.cancelled = await salonOrder(me.id);
    await orders.transition(ids.cancelled, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);
    ids.salon = await salonOrder(me.id);
    ids.other = await salonOrder(other.id);
    browser = await launchChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function phone(token: string | null): Promise<{ page: Page; problems: string[] }> {
    const context = await mobileContext(browser);
    if (token) await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: token, url: srv.origin }]);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of [45]\d\d/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    return { page, problems };
  }

  /** When the order reached each step, on the phone's calendar: its offset on that date (summer or winter time). */
  async function datesOf(page: Page, id: string) {
    const o = await srv.ctx.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const times = [o.reserved_at, o.paid_at, o.shipped_at, o.delivered_at, o.cancelled_at].map((x) => (x ? x.toISOString() : null));
    const offsets = await page.evaluate((ts) => ts.map((t) => (t === null ? 0 : -new Date(t).getTimezoneOffset())), times);
    const [reserved, paid, shipped, delivered, cancelled] = times.map((t, i) => orderDate(t, offsets[i]));
    return { reserved: reserved!, paid: paid!, shipped: shipped!, delivered: delivered!, cancelled: cancelled! };
  }

  it('YOUR ORDERS: each order with its steps and their dates, the model, the size, the add-on and the price; shipped, the carrier and the tracking link; delivered, read again', async () => {
    const { page, problems } = await phone(me.token);
    await page.goto(`${srv.origin}/verify/pieces`);
    const section = page.locator('section.pieces__orders');
    await visible(section);
    await textOf(section.getByRole('heading', { name: ORDERS.title }), ORDERS.title);
    // No piece is registered yet: the page says so, and the orders follow.
    await visible(page.locator('.pieces__empty'));
    expect(await page.evaluate(() => {
      const empty = document.querySelector('.pieces__empty')!;
      const orders = document.querySelector('.pieces__orders')!;
      return Boolean(empty.compareDocumentPosition(orders) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);

    // The latest first; never another account's.
    const cards = section.locator('article.pieces__order');
    await expect.poll(() => cards.count(), POLL).toBe(3);
    expect(await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status))).toEqual(['RESERVED', 'CANCELLED', 'SHIPPED']);
    const refs = await section.locator('.pieces__order-reference').allInnerTexts();
    const ref = (id: string) => `ORDER OR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    expect(refs.map(norm)).toEqual([ref(ids.salon), ref(ids.cancelled), ref(ids.live)]);
    expect(refs.join(' ')).not.toContain(ref(ids.other).slice(6));

    // The LIVE RELEASE's piece, shipped.
    const live = cards.nth(2);
    const liveDates = await datesOf(page, ids.live);
    await textOf(live.getByRole('heading'), 'MONOLITHE');
    expect(await live.getAttribute('aria-labelledby')).toBe(await live.getByRole('heading').getAttribute('id'));
    await textOf(live.locator('.pieces__order-line'), 'LIVE RELEASE · MONOLITHE — LIVE');
    await textOf(live.locator('.pieces__order-sentence'), ORDERS.sentence.SHIPPED);
    const steps = live.getByRole('list', { name: ORDERS.stepsLabel }).getByRole('listitem');
    await textsOf(steps, [`RESERVED ${liveDates.reserved}`, `PAID ${liveDates.paid}`, `SHIPPED ${liveDates.shipped}`, 'DELIVERED']);
    expect(liveDates.reserved).not.toBe(liveDates.paid);
    expect(await steps.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.state, e.getAttribute('aria-current')]))).toEqual([
      ['done', null],
      ['done', null],
      ['current', 'step'],
      ['next', null],
    ]);
    await textsOf(live.locator('.pieces__order-rows .rows__row'), ['SIZE 52', 'PRICE € 4 800', 'ENGRAVING € 250', 'TOTAL € 5 050']);
    await textsOf(live.locator('.pieces__order-shipment .rows__row'), ['CARRIER COLISSIMO', 'TRACKING NUMBER 6A12345678901']);
    const track = live.getByRole('link', { name: 'Track the shipment 6A12345678901 on the site of Colissimo (opens in a new tab)' });
    await textOf(track, ORDERS.track);
    expect(await track.getAttribute('href')).toBe('https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901');
    expect(await track.getAttribute('target')).toBe('_blank');
    expect(await track.getAttribute('rel')).toBe('noopener noreferrer');

    // The salon's, its size and price to be entered by ORBES Client Services.
    const salon = cards.nth(0);
    await textOf(salon.locator('.pieces__order-line'), 'THE PRIVATE SALON');
    await textOf(salon.locator('.pieces__order-sentence'), ORDERS.sentence.RESERVED);
    await textsOf(salon.locator('.pieces__order-step'), [`RESERVED ${(await datesOf(page, ids.salon)).reserved}`, 'PAID', 'SHIPPED', 'DELIVERED']);
    await textsOf(salon.locator('.pieces__order-rows .rows__row'), ['SIZE TO BE CONFIRMED', 'PRICE TO BE CONFIRMED']);
    expect(await salon.locator('.pieces__order-shipment, .pieces__order-track').count()).toBe(0);

    // The one cancelled: the step it reached, then CANCELLED.
    const cancelled = cards.nth(1);
    const cancelledDates = await datesOf(page, ids.cancelled);
    await textOf(cancelled.locator('.pieces__order-sentence'), ORDERS.sentence.CANCELLED);
    await textsOf(cancelled.locator('.pieces__order-step'), [`RESERVED ${cancelledDates.reserved}`, `CANCELLED ${cancelledDates.cancelled}`]);
    expect(await cancelled.locator('[aria-current="step"]').innerText()).toMatch(/^CANCELLED/);
    // Its size and price were never entered: no row promises a confirmation that cannot come.
    expect(await cancelled.locator('.pieces__order-rows').count()).toBe(0);
    expect(norm(await cancelled.innerText())).not.toContain(ORDERS.toConfirm);

    // YOUR RELEASES agrees with YOUR ORDERS: the LIVE RELEASE's piece secured, its steps in the orders, never a
    // payment still to settle nor a piece still "reserved" once it is shipped.
    const release = page.locator('.pieces__entry-card', { hasText: 'LIVE RELEASE' });
    await textOf(release.locator('.pieces__entry-sentence'), 'You secured your piece in size 52. Its steps follow in YOUR ORDERS.');
    expect(norm(await release.innerText())).not.toContain('settle payment');
    expect(norm(await release.innerText())).not.toContain('is reserved');

    // The screen: contrast, figures in the reading face, one hairline button, the floors of §3.8, nothing sideways.
    const checks = await screenChecks(page);
    expect(checks.contrast).toEqual([]);
    expect(checks.figures).toEqual([]);
    expect(await page.locator('.view--pieces .btn').count()).toBe(1);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    expect(floors.checked).toEqual(expect.arrayContaining([ORDERS.track]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-orders.png'), fullPage: true });

    // ORBES Client Services marks it delivered: read again, every step reached.
    await srv.ctx.services.orders.transition(ids.live, { to: 'DELIVERED' }, f.admin);
    await page.reload();
    const again = page.locator('article.pieces__order[data-status="DELIVERED"]');
    await visible(again);
    const delivered = await datesOf(page, ids.live);
    await textsOf(again.locator('.pieces__order-step'), [`RESERVED ${delivered.reserved}`, `PAID ${delivered.paid}`, `SHIPPED ${delivered.shipped}`, `DELIVERED ${delivered.delivered}`]);
    expect(await again.locator('[aria-current="step"]').innerText()).toMatch(/^DELIVERED/);
    await textOf(again.locator('.pieces__order-sentence'), ORDERS.sentence.DELIVERED);
    await visible(again.getByRole('link', { name: /^Track the shipment 6A12345678901/ }));
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('its documents: the invoice and the ownership certificate saved as PDFs, the care guide opened and closed; a document that cannot be read says so', async () => {
    const D = ORDERS.documents;
    // The collector registers the piece of the LIVE RELEASE (its warranty started at the sale).
    const uuid = (await srv.ctx.db.selectFrom('products').select('id').where('product_id', '=', livePiece.productId).executeTakeFirstOrThrow()).id;
    await srv.ctx.services.warranty.activate(uuid, { purchaseDate: new Date().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, f.admin);
    const scan = await srv.ctx.services.verification.verify({ code: livePiece.codeData }, {});
    await srv.ctx.services.ownership.registerFirst(me.id, { registrationToken: scan.registration!.token, claimCode: livePiece.claimCode }, { type: 'account', id: me.id });
    const invoice = (await srv.ctx.services.orders.forAccount(me.id)).find((o) => o.id === ids.live)!.documents.invoice!.number;

    const { page, problems } = await phone(me.token);
    await page.goto(`${srv.origin}/verify/pieces`);
    const live = page.locator('article.pieces__order[data-status="DELIVERED"]');
    await visible(live);
    const group = live.getByRole('group', { name: D.title });
    await visible(group);
    const links = group.locator('.pieces__order-document');
    await textsOf(links, [`${D.invoice} ${invoice}`, D.careGuide, D.certificate]);
    // The number in the reading face, the label in the display face.
    expect(await links.first().locator('.numeral').innerText()).toBe(invoice);
    // The salon's order, not paid yet: its care guide only; the one cancelled before it was paid: no document.
    await textsOf(page.locator('article.pieces__order[data-status="RESERVED"] .pieces__order-document'), [D.careGuide]);
    expect(await page.locator('article.pieces__order[data-status="CANCELLED"] .pieces__order-documents').count()).toBe(0);

    // INVOICE: its PDF saved.
    const [pdf] = await Promise.all([page.waitForEvent('download'), group.getByRole('button', { name: D.invoiceLabel(invoice) }).click()]);
    expect(pdf.suggestedFilename()).toBe(`ORBES-invoice-${invoice}.pdf`);
    expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');
    // OWNERSHIP CERTIFICATE: the piece is registered to the collector.
    const [certificate] = await Promise.all([page.waitForEvent('download'), group.getByRole('button', { name: D.certificateLabel('MONOLITHE') }).click()]);
    expect(certificate.suggestedFilename()).toMatch(new RegExp(`^ORBES-ownership-certificate-${livePiece.productId}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));

    // CARE GUIDE: opened under the links (the house's general text: the model has none of its own), then closed.
    const care = group.getByRole('button', { name: D.careGuideLabel('MONOLITHE') });
    expect(await care.getAttribute('aria-expanded')).toBe('false');
    const panel = live.locator(`#${await care.getAttribute('aria-controls')}`);
    expect(await panel.isHidden()).toBe(true);
    await care.click();
    await textOf(panel, DEFAULT_CARE);
    expect(await care.getAttribute('aria-expanded')).toBe('true');
    expect(await group.getByRole('alert').count()).toBe(0);

    // The screen with the documents and the care guide open.
    const checks = await screenChecks(page);
    expect(checks.contrast).toEqual([]);
    expect(checks.figures).toEqual([]);
    expect(await page.locator('.view--pieces .btn').count()).toBe(1);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    expect(floors.checked).toEqual(expect.arrayContaining([`${D.invoice} ${invoice}`, D.careGuide, D.certificate]));
    // At rest for the picture: the pointer off the links, the page at its top (its fixed frame drawn there).
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-documents.png'), fullPage: true });
    await care.click();
    expect(await care.getAttribute('aria-expanded')).toBe('false');
    expect(await panel.isHidden()).toBe(true);

    // A document that cannot be read: said under the links, nothing saved; the next try works.
    await page.route('**/invoice.pdf', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }) }), { times: 1 });
    await group.getByRole('button', { name: D.invoiceLabel(invoice) }).click();
    await textOf(group.getByRole('alert'), D.downloadFailed);
    const [again] = await Promise.all([page.waitForEvent('download'), group.getByRole('button', { name: D.invoiceLabel(invoice) }).click()]);
    expect(again.suggestedFilename()).toBe(`ORBES-invoice-${invoice}.pdf`);
    await expect.poll(() => group.getByRole('alert').count(), POLL).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('says when the orders could not be read, the pieces still shown; signed out, no orders', async () => {
    const { page, problems } = await phone(me.token);
    await page.route('**/api/v1/account/orders', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }) }));
    await page.goto(`${srv.origin}/verify/pieces`);
    const section = page.locator('section.pieces__orders');
    await textOf(section.getByRole('alert'), ORDERS.loadFailed);
    // The piece the collector registered with its documents (above) still shows.
    await visible(page.locator('.pieces__list article.piece'));
    expect(await section.locator('article').count()).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();

    const visitor = await phone(null);
    await visitor.page.goto(`${srv.origin}/verify/pieces`);
    await visible(visitor.page.locator('.pieces__signin'));
    expect(await visitor.page.locator('section.pieces__orders').isHidden()).toBe(true);
    expect(await visitor.page.locator('.pieces__order').count()).toBe(0);
    expect(visitor.problems).toEqual([]);
    await visitor.page.context().close();
  }, 60_000);
});
