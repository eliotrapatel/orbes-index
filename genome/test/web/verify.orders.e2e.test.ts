/**
 * End-to-end: MY PIECES' orders (plan LIVE RELEASE+, step S3) in the built verification app, served by the real server
 * (in-memory database), driven in Chromium at a phone viewport.
 *
 *  - A collector who holds no piece yet, with three orders: a LIVE RELEASE's piece with its engraving, paid, made at the
 *    atelier and shipped by Colissimo; a private salon's whose size and price ORBES Client Services has still to enter;
 *    one cancelled. Another account's order never shows.
 *  - MY PIECES' tab ORDERS (plan NOCTURNE, C24, C32), the latest first: each order on its model's photograph names
 *    where it was sold and its model; RESERVED · PAID · SHIPPED · DELIVERED with their dates on this phone's calendar
 *    (one step reached in full, several by their day and month), the current one marked for a screen reader
 *    (aria-current), those to come without one; or the steps reached, then CANCELLED; what its step means; SIZE, PRICE,
 *    the add-on and the TOTAL, or TO BE CONFIRMED (left out once cancelled); once shipped the CARRIER, the TRACKING
 *    NUMBER and TRACK THE SHIPMENT, the carrier's page in a new tab; the order's reference. The tab RELEASES sends the
 *    LIVE RELEASE's piece to its order's steps, never a payment still to settle.
 *  - Delivered by ORBES Client Services, read again: every step reached, DELIVERED current.
 *  - Its documents (step S4, M6): the LIVE RELEASE's piece registered by the collector, its card offers its INVOICE
 *    (its number in the reading face) and its OWNERSHIP CERTIFICATE, rows that save their PDF, and its CARE GUIDE, a row
 *    that opens under it (the house's general care text, its model having none) and closes again; the salon's order still to
 *    pay, its care guide only; the one cancelled before it was paid, none. A document that cannot be read says so.
 *  - Where its piece comes from (plan NOCTURNE, addition 2; C4): on the registered piece's page, WHERE IT COMES FROM, THE
 *    LIVE RELEASE OF its day (its page) and ORDER OR-…, DELIVERED ON its date, which opens ORDERS with the order in view.
 *  - Its orders unreadable (a server error): said in their tab, the pieces still shown; signed out: no orders at all.
 *
 *  - YOUR NEW CLAIM CODE (plan NEXT LOT §3.4): a new claim code ORBES Client Services made for a shipped order's piece,
 *    and for an order still to ship. Before SHOW THE CODE the code is nowhere in the page nor in what the server sent;
 *    SHOW THE CODE reads it once (busy while it runs: a second press never spends the reading), then the code in the
 *    reading face, COPY CODE, SAVE YOUR NEW CARD (its PDF), and REGISTER THIS PIECE on the shipped order (refused: the
 *    server's words, the button kept; done: its line takes the block's place and the focus, the ORDERS tab kept, the piece
 *    in PIECES); on the order still to ship, no REGISTER THIS PIECE but how it registers once arrived. A reload leaves no
 *    block; a reading that fails says so and keeps the button; one the server refuses says so and the block goes. Nothing
 *    scrolls sideways at 390, 375, 360 and 320 px, the code on one line; captured at phone and desk sizes (out/).
 *
 * On the screen: the text's contrast on its ground computed from the page's own colours (at least 4.5 : 1), no figure in
 * the display face, no button on ORDERS (its documents are rows; the one hairline button, SCAN ORBES CODE, is the
 * PIECES tab's), the floors of BRAND-DESIGN-SYSTEM §3.8, nothing scrolling sideways; no console error nor CSP report.
 *
 * Skipped (not failed) when the Chromium binary is absent.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { ensureSku } from '../../src/server/services/stock.js';
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
/** A tab of MY PIECES, by its name (its count after it), selected. */
async function openTab(page: Page, name: 'PIECES' | 'ORDERS' | 'RELEASES'): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}\\s*\\d*$`) }).click();
  await visible(page.locator(`.view--pieces[data-tab="${name.toLowerCase()}"]`));
}
/** A date of an order's step among several of one year: its day and month (C24, C32). */
const dayMonth = (date: string) => date.replace(/ \d{4}$/, '');
/**
 * ORDERS' buttons: none but each order's WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01, site 5), exactly one
 * under each order and no other anywhere in MY PIECES; the documents are rows.
 */
async function onlyWriteButtons(page: Page): Promise<void> {
  expect(await page.locator('.view--pieces .n-btn:not(.n-write__open)').count()).toBe(0);
  const orders = page.locator('.view--pieces article.n-pieces__order');
  const n = await orders.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) expect(await orders.nth(i).locator('.n-write__open').count()).toBe(1);
  expect(await page.locator('.view--pieces .n-write__open').count()).toBe(n);
}

describe.skipIf(!HAS_CHROMIUM)('MY PIECES: the orders of a collector (Chromium, phone)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let f: LiveFixture;
  let colissimo: string;
  let me: { id: string; token: string };
  /** The orders of the collector: the LIVE RELEASE's (shipped), the salon's to enter, the one cancelled. */
  const ids = { live: '', salon: '', cancelled: '', other: '', release: '' };
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
    ids.release = r.id;
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
    // No piece is registered yet: the PIECES tab says so; ORDERS holds the orders, with their count.
    await visible(page.locator('.pieces__empty'));
    await visible(page.getByRole('tab', { name: 'ORDERS 3', exact: true }));
    await openTab(page, 'ORDERS');
    const section = page.locator('.n-pieces__orders');
    await visible(section);

    // The latest first; never another account's.
    const cards = section.locator('article.n-pieces__order');
    await expect.poll(() => cards.count(), POLL).toBe(3);
    expect(await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status))).toEqual(['RESERVED', 'CANCELLED', 'SHIPPED']);
    const refs = await section.locator('.n-pieces__order-reference').allInnerTexts();
    const ref = (id: string) => `ORDER OR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    expect(refs.map(norm)).toEqual([ref(ids.salon), ref(ids.cancelled), ref(ids.live)]);
    expect(refs.join(' ')).not.toContain(ref(ids.other).slice(6));

    // The LIVE RELEASE's piece, shipped: its steps reached on several days, each by its day and month.
    const live = cards.nth(2);
    const liveDates = await datesOf(page, ids.live);
    await textOf(live.getByRole('heading', { level: 2 }), 'MONOLITHE');
    expect(await live.getAttribute('aria-labelledby')).toBe(await live.getByRole('heading', { level: 2 }).getAttribute('id'));
    await textOf(live.locator('.n-pieces__order-line'), 'LIVE RELEASE · MONOLITHE — LIVE');
    await textOf(live.locator('.n-pieces__order-sentence'), ORDERS.sentence.SHIPPED);
    const steps = live.getByRole('list', { name: ORDERS.stepsLabel }).getByRole('listitem');
    await textsOf(steps, [`RESERVED ${dayMonth(liveDates.reserved)}`, `PAID ${dayMonth(liveDates.paid)}`, `SHIPPED ${dayMonth(liveDates.shipped)}`, 'DELIVERED']);
    expect(liveDates.reserved).not.toBe(liveDates.paid);
    expect(await steps.evaluateAll((els) => els.map((e) => [e.classList.contains('is-done'), e.getAttribute('aria-current')]))).toEqual([
      [true, null],
      [true, null],
      [true, 'step'],
      [false, null],
    ]);
    await textsOf(live.locator('.n-pieces__order-rows .n-kv__row'), ['SIZE 52', 'PRICE € 4 800', 'ENGRAVING + € 250', 'TOTAL € 5 050', 'CARRIER COLISSIMO', 'TRACKING NUMBER 6A12345678901']);
    const track = live.getByRole('link', { name: 'Track the shipment 6A12345678901 on the site of Colissimo (opens in a new tab)' });
    await textOf(track, ORDERS.track);
    expect(await track.getAttribute('href')).toBe('https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901');
    expect(await track.getAttribute('target')).toBe('_blank');
    expect(await track.getAttribute('rel')).toBe('noopener noreferrer');

    // The salon's, its size and price to be entered by ORBES Client Services: one step reached, dated in full.
    const salon = cards.nth(0);
    await textOf(salon.locator('.n-pieces__order-line'), 'THE PRIVATE SALON · MONOLITHE');
    await textOf(salon.locator('.n-pieces__order-sentence'), ORDERS.sentence.RESERVED);
    await textsOf(salon.getByRole('listitem'), [`RESERVED ${(await datesOf(page, ids.salon)).reserved}`, 'PAID', 'SHIPPED', 'DELIVERED']);
    await textsOf(salon.locator('.n-pieces__order-rows .n-kv__row'), ['SIZE TO BE CONFIRMED', 'PRICE TO BE CONFIRMED']);
    expect(await salon.locator('.n-pieces__order-track').count()).toBe(0);

    // The one cancelled: the step it reached, then CANCELLED.
    const cancelled = cards.nth(1);
    const cancelledDates = await datesOf(page, ids.cancelled);
    await textOf(cancelled.locator('.n-pieces__order-sentence'), ORDERS.sentence.CANCELLED);
    const dated = (d: string) => (d.slice(-4) === cancelledDates.reserved.slice(-4) ? dayMonth(d) : d);
    await textsOf(cancelled.getByRole('listitem'), [`RESERVED ${dayMonth(cancelledDates.reserved)}`, `CANCELLED ${dated(cancelledDates.cancelled)}`]);
    expect(await cancelled.locator('[aria-current="step"]').innerText()).toMatch(/^CANCELLED/);
    // Its size and price were never entered: no row promises a confirmation that cannot come.
    expect(await cancelled.locator('.n-pieces__order-rows').count()).toBe(0);
    expect(norm(await cancelled.innerText())).not.toContain(ORDERS.toConfirm);

    // The screen: contrast, figures in the reading face, no button (the documents are rows), the floors of §3.8.
    const checks = await screenChecks(page);
    expect(checks.contrast).toEqual([]);
    expect(checks.figures).toEqual([]);
    // No button but each order's WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01, site 5): the documents are rows.
    await onlyWriteButtons(page);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    expect(floors.checked).toEqual(expect.arrayContaining([ORDERS.track]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: join(OUT_DIR, 'verify-my-pieces-orders.png'), fullPage: true });

    // RELEASES agrees with ORDERS: the LIVE RELEASE's piece secured, its steps in the orders, never a payment still to
    // settle nor a piece still "reserved" once it is shipped.
    await openTab(page, 'RELEASES');
    const release = page.locator('.n-pieces__entry', { hasText: 'LIVE RELEASE' });
    await textOf(release.locator('.pieces__entry-sentence'), 'You secured your piece in size 52. Its steps follow in YOUR ORDERS.');
    expect(norm(await release.innerText())).not.toContain('settle payment');
    expect(norm(await release.innerText())).not.toContain('is reserved');

    // ORBES Client Services marks it delivered: read again (the tab kept by the page's entry), every step reached.
    await openTab(page, 'ORDERS');
    await srv.ctx.services.orders.transition(ids.live, { to: 'DELIVERED' }, f.admin);
    await page.reload();
    const again = page.locator('article.n-pieces__order[data-status="DELIVERED"]');
    await visible(again);
    const delivered = await datesOf(page, ids.live);
    await textsOf(again.getByRole('listitem'), [`RESERVED ${dayMonth(delivered.reserved)}`, `PAID ${dayMonth(delivered.paid)}`, `SHIPPED ${dayMonth(delivered.shipped)}`, `DELIVERED ${dayMonth(delivered.delivered)}`]);
    expect(await again.locator('[aria-current="step"]').innerText()).toMatch(/^DELIVERED/);
    await textOf(again.locator('.n-pieces__order-sentence'), ORDERS.sentence.DELIVERED);
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
    await openTab(page, 'ORDERS');
    const live = page.locator('article.n-pieces__order[data-status="DELIVERED"]');
    await visible(live);
    const group = live.getByRole('group', { name: D.title });
    await visible(group);
    // Each a row: its label and number, then PDF or what the guide is (C24).
    const links = group.locator('.n-pieces__document');
    await textsOf(links, [`${D.invoice} ${invoice} ${D.pdf}`, `${D.careGuide} ${D.careGuideLabel('MONOLITHE')}`, `${D.certificate} ${D.pdf}`]);
    // The number in the reading face, the label in the display face.
    expect(await links.first().locator('.n-pieces__document-number').innerText()).toBe(invoice);
    // The model's photograph above the order (addition 3): the model has none here, so none is shown.
    expect(await live.locator('img').count()).toBe(0);
    // The salon's order, not paid yet: its care guide only; the one cancelled before it was paid: no document.
    await textsOf(page.locator('article.n-pieces__order[data-status="RESERVED"] .n-pieces__document'), [`${D.careGuide} ${D.careGuideLabel('MONOLITHE')}`]);
    expect(await page.locator('article.n-pieces__order[data-status="CANCELLED"] .n-pieces__documents').count()).toBe(0);

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
    // No button but each order's WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01, site 5): the documents are rows.
    await onlyWriteButtons(page);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    // The rows, by their words (the label, the number, then the line under them).
    expect(floors.checked).toEqual(expect.arrayContaining([`${D.invoice} ${invoice}${D.pdf}`, `${D.careGuide}${D.careGuideLabel('MONOLITHE')}`, `${D.certificate}${D.pdf}`]));
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

  it('says where the registered piece comes from: its release, a link to its page, and its order, ORDERS with it in view (addition 2)', async () => {
    const { page, problems } = await phone(me.token);
    await page.goto(`${srv.origin}/verify/pieces`);
    const item = page.locator('article.n-pieces__piece', { hasText: livePiece.productId });
    await visible(item);
    await item.getByRole('link', { name: 'SEE THE PIECE' }).click();
    const origin = page.locator('.view--piece .n-piece__origin');
    await visible(origin);
    await textOf(origin.locator('h2'), 'WHERE IT COMES FROM');
    const release = origin.locator('.n-piece__origin-release');
    const order = origin.locator('.n-piece__origin-order');
    await textOf(release, /^THE LIVE RELEASE OF \d{1,2} [A-Z]+ SEE THE RELEASE$/);
    expect(await release.getAttribute('href')).toBe(`/verify/releases/${ids.release}`);
    const ref = `OR-${ids.live.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const delivered = await datesOf(page, ids.live);
    await textOf(order, `ORDER ${ref} DELIVERED ON ${delivered.delivered}`);
    // Its figures in the reading face; the rows tap as wide as the column.
    expect((await screenChecks(page)).figures).toEqual([]);
    const floors = await tapZoneFloors(page);
    expect(floors.problems).toEqual([]);
    // ORDER OR-…: MY PIECES' tab ORDERS, the order in view, its heading taking the keyboard focus.
    await order.click();
    await visible(page.locator('.view--pieces[data-tab="orders"]'));
    expect(new URL(page.url()).pathname).toBe('/verify/pieces');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('article')?.getAttribute('data-order')), POLL).toBe(ref);
    expect(await page.getByRole('tab', { name: /^ORDERS/ }).getAttribute('aria-selected')).toBe('true');
    // Back: the landing (the piece's page gave its entry back to MY PIECES).
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe('/verify');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);

  it('says when the orders could not be read, the pieces still shown; signed out, no orders', async () => {
    const { page, problems } = await phone(me.token);
    await page.route('**/api/v1/account/orders', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }) }));
    await page.goto(`${srv.origin}/verify/pieces`);
    // The piece the collector registered with its documents (above) still shows; ORDERS says it could not be read.
    await visible(page.locator('.n-pieces__list article.n-pieces__piece'));
    await openTab(page, 'ORDERS');
    const section = page.locator('#pieces-orders-panel');
    await textOf(section.getByRole('alert'), ORDERS.loadFailed);
    expect(await section.locator('article').count()).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();

    const visitor = await phone(null);
    await visitor.page.goto(`${srv.origin}/verify/pieces`);
    await visible(visitor.page.locator('.pieces__signin'));
    expect(await visitor.page.getByRole('tab').count()).toBe(0);
    expect(await visitor.page.locator('.n-pieces__order').count()).toBe(0);
    expect(visitor.problems).toEqual([]);
    await visitor.page.context().close();
  }, 60_000);
});

describe.skipIf(!HAS_CHROMIUM)('MY PIECES: YOUR NEW CLAIM CODE on an order (plan NEXT LOT §3.4; Chromium, phone)', () => {
  const C = ORDERS.claim;
  const CODE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
  let srv: VerifyServer;
  let browser: Browser;
  let f: LiveFixture;
  let colissimo: string;
  let france: string;
  let me: { id: string; token: string };
  let sizeSeq = 40;
  /** The orders: shipped (REGISTER THIS PIECE), paid and still to ship, and one whose reading fails then is refused. */
  const ids = { shipped: '', paid: '', refused: '' };
  const pieces = { shipped: '', paid: '' };

  async function account(tag: string) {
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email: `claim.e2e.${tag}@example.com`, password: PASSWORD }, {});
    return { id: a.id, token: session.token };
  }

  /**
   * A piece of a fresh size counted in at FRANCE WAREHOUSE, sold to the account through the private salon: priced, linked,
   * paid, its warranty started, then shipped unless told; then ORBES Client Services makes it a new claim code (SOLD).
   */
  async function soldWithNewCode(accountId: string, upTo: 'PAID' | 'SHIPPED'): Promise<{ orderId: string; productId: string }> {
    const { services, db } = srv.ctx;
    const size = String(sizeSeq++);
    const sku = await inTransaction(db, (tx) => ensureSku(tx, f.modelId, size));
    await services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted in.' }, f.admin);
    const p = await services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: size, material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
    const request = await db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: new Date() }).returning('id').executeTakeFirstOrThrow();
    await services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    const orderId = (await db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await services.orders.setTerms(orderId, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, f.admin);
    await services.atelier.linkFromStock(orderId, p.product.productId, f.admin);
    await services.orders.transition(orderId, { to: 'PAID' }, f.admin);
    await services.warranty.activate(p.product.id, { purchaseDate: new Date().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, f.admin);
    if (upTo === 'SHIPPED') await services.orders.transition(orderId, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, f.admin);
    const situation = await services.claimRenewals.situation(p.product.productId);
    const r = await services.claimRenewals.renew(p.product.productId, { reason: 'Card lost.', expect: 'SOLD', after: situation.lastRenewalId }, f.admin);
    expect(r.claimCode).toBeUndefined();
    return { orderId, productId: p.product.productId };
  }

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixture(srv.ctx.db, new Date(Date.now() - DAY).toISOString());
    colissimo = (await srv.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    france = (await srv.ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    me = await account('me');
    ({ orderId: ids.refused } = await soldWithNewCode(me.id, 'PAID'));
    ({ orderId: ids.paid, productId: pieces.paid } = await soldWithNewCode(me.id, 'PAID'));
    ({ orderId: ids.shipped, productId: pieces.shipped } = await soldWithNewCode(me.id, 'SHIPPED'));
    browser = await launchChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.close();
  });

  const ref = (id: string) => `OR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const card = (page: Page, id: string) => page.locator(`article.n-pieces__order[data-order="${ref(id)}"]`);

  async function phone(width = 390): Promise<{ page: Page; problems: string[]; answers: string[] }> {
    const context = await (width === 1280 ? browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris' }) : mobileContext(browser));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.origin });
    await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: me.token, url: srv.origin }]);
    const page = await context.newPage();
    if (width !== 390 && width !== 1280) await page.setViewportSize({ width, height: 844 });
    const problems: string[] = [];
    const answers: string[] = [];
    page.on('console', (m) => {
      // A request this test cuts on purpose (net::ERR_INTERNET_DISCONNECTED) is no problem of the page.
      if (m.type() === 'error' && !/Failed to load resource: (the server responded with a status of [45]\d\d|net::ERR_INTERNET_DISCONNECTED)/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // What the server sent to the page, but the one reading's answer (kept apart, to know the code).
    page.on('response', (res) => {
      if (!res.url().includes('/api/') || res.url().endsWith('/claim-code')) return;
      void res.text().then((t) => answers.push(t), () => undefined);
    });
    await page.goto(`${srv.origin}/verify/pieces`);
    await openTab(page, 'ORDERS');
    return { page, problems, answers };
  }

  const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  it('before SHOW THE CODE: the block under the order\'s sentence, the code nowhere; nothing scrolls sideways at 390, 375, 360 and 320 px', async () => {
    for (const width of [390, 375, 360, 320]) {
      const { page, problems } = await phone(width);
      const shipped = card(page, ids.shipped);
      await visible(shipped.locator('.pieces__claim'));
      // Right after the order's sentence, before its rows.
      expect(await shipped.locator('.n-pieces__order-sentence + .n-pieces__claim').count()).toBe(1);
      expect(await shipped.locator('.n-pieces__claim + .n-pieces__order-rows').count()).toBe(1);
      await textOf(shipped.locator('.pieces__claim'), `${C.label} ${C.lead} ${C.show}`);
      expect(await shipped.getByRole('button', { name: C.show, exact: true }).getAttribute('class')).toContain('n-btn--ol');
      expect(await page.locator('.pieces__claim').count()).toBe(3);
      expect(await page.content()).not.toMatch(CODE);
      expect(await noSideways(page), `${width} px`).toBe(true);
      if (width === 390) await page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-waiting-phone.png'), fullPage: true });
      expect(problems).toEqual([]);
      await page.context().close();
    }
    const desk = await phone(1280);
    await visible(card(desk.page, ids.shipped).locator('.pieces__claim-show'));
    await desk.page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-waiting-desk.png'), fullPage: true });
    await desk.page.context().close();
  }, 120_000);

  it('a reading that fails says so and keeps SHOW THE CODE; one the server refuses says so, and the block goes', async () => {
    const { page, problems } = await phone();
    const block = card(page, ids.refused).locator('.pieces__claim');
    await page.route('**/claim-code', (route) => route.abort('internetdisconnected'), { times: 1 });
    await block.getByRole('button', { name: C.show, exact: true }).click();
    await textOf(block.getByRole('alert'), C.showFailed);
    await visible(block.getByRole('button', { name: C.show, exact: true }));
    // Read meanwhile (the server's one reading spent elsewhere): refused, the block gone, the sentence in its place.
    await srv.ctx.services.claimRenewals.reveal(me.id, ids.refused, { type: 'account', id: me.id });
    await block.getByRole('button', { name: C.show, exact: true }).click();
    await textOf(block, C.unavailable);
    expect(await block.getByRole('alert').innerText()).toBe(C.unavailable);
    expect(await block.locator('button').count()).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 60_000);

  it('SHOW THE CODE reads it once (a second press never spends it); COPY CODE, SAVE YOUR NEW CARD; REGISTER THIS PIECE refused, then done: its line, ORDERS kept; a reload leaves no block', async () => {
    const { page, problems, answers } = await phone();
    const shipped = card(page, ids.shipped);
    const block = shipped.locator('.pieces__claim');
    // The reading held: the button busy, its label kept, disabled; a second press sends nothing.
    let readings = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/orders/${ids.shipped}/claim-code`)) readings++;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/orders/${ids.shipped}/claim-code`, async (route) => {
      await held;
      await route.continue();
    });
    const show = block.getByRole('button', { name: C.show, exact: true });
    await show.click();
    await expect.poll(() => show.getAttribute('aria-busy'), POLL).toBe('true');
    expect(await show.isDisabled()).toBe(true);
    expect(norm(await show.innerText())).toBe(C.show);
    await show.dispatchEvent('click');
    release();
    const code = block.locator('.pieces__claim-code');
    await visible(code);
    const shown = norm(await code.locator('[aria-hidden="true"]').innerText());
    expect(shown).toMatch(new RegExp(`^${CODE.source}$`));
    expect(readings).toBe(1);
    // Never in what the server sent before (the orders, the pieces).
    for (const a of answers) expect(a).not.toContain(shown);
    // SHOW THE CODE gone, the code read character by character, the focus on it; one line, in the reading face.
    expect(await block.getByRole('button', { name: C.show }).count()).toBe(0);
    expect(await code.locator('.visually-hidden').innerText()).toBe(C.codeLabel(shown));
    expect(await page.evaluate(() => document.activeElement?.classList.contains('pieces__claim-code'))).toBe(true);
    expect(await code.evaluate((el) => el.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(el).fontSize) * 1.3)).toBe(true);
    await textOf(block.locator('.pieces__claim-once'), C.shownOnce);
    const register = block.getByRole('button', { name: 'Register your MONOLITHE with this claim code' });
    await textOf(register, C.register);
    expect(await register.getAttribute('class')).not.toContain('n-btn--ol');
    expect(await block.locator('.pieces__claim-arrived').count()).toBe(0);
    await textOf(block.locator('.n-pieces__claim-card'), C.card);
    await page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-shown-phone.png'), fullPage: true });
    // The same, at desk size, then back to the phone.
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await noSideways(page)).toBe(true);
    await page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-shown-desk.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    // COPY CODE: the code alone on the clipboard.
    await block.getByRole('button', { name: C.copy, exact: true }).click();
    await textOf(block.getByRole('status'), C.copied);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

    // SAVE YOUR NEW CARD: the card's PDF, the code in the request's body, never in its address.
    const save = block.getByRole('button', { name: 'Save the new certificate card of your MONOLITHE (PDF)' });
    await textOf(save, C.save);
    const [pdf] = await Promise.all([page.waitForEvent('download'), save.click()]);
    expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.url()).not.toContain(shown);
    await expect.poll(() => save.getAttribute('aria-busy'), POLL).toBe('false');
    // Saving fails: said, the code still there.
    await page.route('**/claim-card.pdf', (route) => route.abort('internetdisconnected'), { times: 1 });
    await save.click();
    await textOf(block.getByRole('alert'), C.saveFailed);
    await visible(code);
    // Refused with CLAIM_CARD_UNAVAILABLE: its words; any other refusal's words are never shown, the save reads as failed.
    const unavailable = 'Your new card can no longer be saved here. ORBES Client Services can assist you.';
    await page.route('**/claim-card.pdf', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CLAIM_CARD_UNAVAILABLE', message: unavailable } }) }), { times: 1 });
    await save.click();
    await textOf(block.getByRole('alert'), unavailable);
    await page.route('**/claim-card.pdf', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NO_ACTIVE_CODE', message: 'No active code for O26-TEST: re-issue its code on the product page first.' } }) }), { times: 1 });
    await save.click();
    await textOf(block.getByRole('alert'), C.saveFailed);
    await visible(code);

    // REGISTER THIS PIECE refused: the server's words, the button kept.
    await page.route('**/register', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REGISTRATION_CONFLICT', message: 'This piece changed meanwhile. Try again.' } }) }), { times: 1 });
    await register.click();
    await textOf(block.getByRole('alert'), 'This piece changed meanwhile. Try again.');
    await visible(register);
    // Done: its line in place of the block, the focus on it; ORDERS kept, the order DELIVERED once read again.
    await register.click();
    await textOf(block, C.registered);
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('pieces__claim-done')), POLL).toBe(true);
    await visible(page.locator(`article.n-pieces__order[data-order="${ref(ids.shipped)}"][data-status="DELIVERED"]`));
    await textOf(card(page, ids.shipped).locator('.pieces__claim'), C.registered);
    expect(await page.getByRole('tab', { name: /^ORDERS/ }).getAttribute('aria-selected')).toBe('true');
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('pieces__claim-done')), POLL).toBe(true);
    const owner = await srv.ctx.db.selectFrom('ownership as o').innerJoin('products as p', 'p.id', 'o.product_id').select('o.account_id').where('p.product_id', '=', pieces.shipped).where('o.ended_at', 'is', null).executeTakeFirstOrThrow();
    expect(owner.account_id).toBe(me.id);
    expect(problems).toEqual([]);

    // Reloaded: nothing more about it (« then never again »); the piece in PIECES.
    await page.reload();
    await openTab(page, 'ORDERS');
    await visible(card(page, ids.shipped));
    expect(await card(page, ids.shipped).locator('.pieces__claim').count()).toBe(0);
    expect(await page.content()).not.toContain(shown);
    await openTab(page, 'PIECES');
    await visible(page.locator('article.n-pieces__piece', { hasText: pieces.shipped }));
    await page.context().close();
  }, 120_000);

  it('on an order still to ship: the code, how the piece registers once it has arrived, no REGISTER THIS PIECE; one line at 320 px; desk', async () => {
    const { page, problems } = await phone(320);
    const block = card(page, ids.paid).locator('.pieces__claim');
    await block.getByRole('button', { name: C.show, exact: true }).click();
    const code = block.locator('.pieces__claim-code');
    await visible(code);
    await textOf(block.locator('.pieces__claim-arrived'), C.arrived);
    expect(await block.getByRole('button', { name: C.register }).count()).toBe(0);
    expect(await block.locator('button').count()).toBe(2);
    expect(await code.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= document.documentElement.clientWidth)).toBe(true);
    expect(await noSideways(page)).toBe(true);
    for (const width of [360, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await noSideways(page), `${width} px`).toBe(true);
    }
    await page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-to-ship-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await noSideways(page)).toBe(true);
    await page.screenshot({ path: join(OUT_DIR, 'verify-claim-code-to-ship-desk.png'), fullPage: true });
    const desk = await page.context().newPage();
    await desk.setViewportSize({ width: 1280, height: 900 });
    await desk.goto(`${srv.origin}/verify/pieces`);
    await openTab(desk, 'ORDERS');
    // Read once: the desk's page shows nothing more about it.
    await visible(card(desk, ids.paid));
    expect(await card(desk, ids.paid).locator('.pieces__claim').count()).toBe(0);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);
});
