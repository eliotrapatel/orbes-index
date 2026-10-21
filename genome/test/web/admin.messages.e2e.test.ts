/**
 * The Messages board of the console, end to end (plan NEXT-NINE of 2026-10-06, §3.1 CS-01, step 1.3): the production
 * web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. The sidebar: Messages first under Clients, its badge counting To answer; the board in its order (PALLADIUM, then
 *     PLATINE, then the rest), its priority tags, what each conversation concerns; the filters (Answered, Mine,
 *     Unassigned, a search by email).
 *  2. A conversation: Take it, an answer sent (the toast), the status ANSWERED; an ADMIN assigns it to another; Close
 *     conversation after its confirmation; the client writes again and it reopens, To answer.
 *  3. The client sheet's Messages line opens the conversation. An AUDITOR reads the board, the email masked, without
 *     one action.
 *  4. House messages (plan MACRO M2 §1.6, D24 M1 and M2), under Messages: the six moments OFF, one switched on after
 *     the no-back-fill sentence; a custom message to PLATINE and above, its reach (the PALLADIUM and PLATINE clients),
 *     its preview in the collector's look (DARK · LIGHT, PHONE · COMPUTER), saved, scheduled in Paris with SEND typed,
 *     then cancelled: nothing delivered.
 * No CSP violation, no page error.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, holdPieces } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'messages.operator@orbes.test', password: 'messages operator passphrase 2026' };
const OTHER = { email: 'messages.other@orbes.test', password: 'messages other passphrase 2026' };
const AUDITOR = { email: 'messages.auditor@orbes.test', password: 'messages auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const POLL = { timeout: 15_000 };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

describe.skipIf(!HAS_CHROMIUM)('the Messages board in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];
  /** The clients, in the order they wrote: none, PALLADIUM, PLATINE. */
  const clients: { id: string; email: string; actor: { type: 'account'; id: string } }[] = [];

  async function open(who: { email: string; password: string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await p.goto(`${origin}/admin`);
    await p.waitForSelector('[data-testid=login-form]');
    await p.fill('input[name=email]', who.email);
    await p.fill('input[name=password]', who.password);
    await p.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const rows = (p: Page) => p.locator('#messages table.table tbody tr');

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  /**
   * The phone's twin of a screen the next nine adds (plan NEXT-NINE, Phase 10: every new screen at a phone's size and a
   * desk's): the whole page at 390 × 844, then the desk's size again.
   */
  async function phoneTwin(p: Page, file: string): Promise<void> {
    const desk = p.viewportSize() ?? { width: 1440, height: 900 };
    await p.setViewportSize({ width: 390, height: 844 });
    try {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      await p.screenshot({ path: join(OUT_DIR, file), fullPage: true });
    } finally {
      await p.setViewportSize(desk);
    }
  }

  async function shot(p: Page, name: string, opts: { phone?: boolean } = {}): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      // From the top: a page captured whole while scrolled draws its sticky sidebar and bar where it stopped.
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-messages-${name}.png`), fullPage: true });
    if (opts.phone) await phoneTwin(p, `admin-messages-${name}-phone.png`);
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-messages-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    let offset = -3 * 3_600_000;
    ctx = await createContext(config, { db: t.db, clock: () => new Date(Date.now() + offset), keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    for (const who of [OPERATOR, OTHER]) await ctx.services.auth.createAdmin({ ...who, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    const modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-MSG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    // Three clients write an hour apart: one without a piece, a PALLADIUM (10 pieces) about a piece, a PLATINE (5).
    for (const pieces of [0, 10, 5]) {
      const a = await createAccount(ctx.db);
      const held = pieces ? await holdPieces(ctx.db, a.id, pieces, modelId) : [];
      const serial = held[0] ? (await ctx.db.selectFrom('products').select('product_id').where('id', '=', held[0]).executeTakeFirstOrThrow()).product_id : null;
      await ctx.services.messages.write(a.id, { body: `A question from a client with ${pieces} pieces.`, ...(serial ? { context: { kind: 'PIECE' as const, id: serial } } : {}) }, a.actor as { type: 'account'; id: string });
      clients.push(a as (typeof clients)[number]);
      offset += 3_600_000;
    }
    offset = 0;
    app = await buildApp(ctx, { serveStatic: true, staticDir: webDir });
    await app.listen({ port, host: '127.0.0.1' });
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    await app?.close().catch(() => {});
    await ctx?.close().catch(() => {});
    await t?.close().catch(() => {});
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    expect(problems).toEqual([]);
  });

  it('puts Messages first under Clients with its badge, and lists To answer by priority, then waiting time; the filters narrow it', async () => {
    const p = await open(OPERATOR);
    const clientsNav = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
    expect((await clientsNav.evaluateAll((links) => links.map((x) => x.getAttribute('data-route'))))[0]).toBe('messages');
    const badge = p.locator('.side__link[data-route=messages] [data-testid=messages-badge]');
    await expect.poll(async () => (await badge.isVisible()) && (await badge.locator('.side__badge-count').textContent()), POLL).toBe('3');
    // The tab title keeps the Anomalies count (none here).
    expect(await p.title()).not.toMatch(/^\(3\)/);
    await p.locator('.side__link[data-route=messages]').click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Messages');
    expect(await p.locator('.page-head').textContent()).toContain('One conversation per client. Clients write from the app, and your answers appear in their account. No email is sent.');
    await expect.poll(() => rows(p).count(), POLL).toBe(3);
    expect(await p.locator('[data-testid=conversation-client]').allTextContents()).toEqual([clients[1]!.email, clients[2]!.email, clients[0]!.email]);
    expect(await p.locator('[data-testid=conversation-priority]').allTextContents()).toEqual(['Priority · PALLADIUM', 'Priority · PLATINE']);
    expect((await p.locator('[data-testid=conversation-concerns]').allTextContents())[0]).toMatch(/^Piece O26-J-\d{5}$/);
    expect((await p.locator('[data-testid=conversation-concerns]').allTextContents())[2]).toBe('General');
    expect(await p.locator('select[name=status] option').allTextContents()).toEqual(['To answer (3)', 'Answered', 'Closed', 'All']);
    await shot(p, 'board', { phone: true });
    // Answered: none yet; Unassigned: all three; a search by email: one.
    await p.selectOption('select[name=status]', 'ANSWERED');
    await expect.poll(() => p.locator('#messages .empty__text').textContent(), POLL).toBe('No conversation to answer.');
    await p.selectOption('select[name=status]', 'TO_ANSWER');
    await expect.poll(() => rows(p).count(), POLL).toBe(3);
    await p.selectOption('select[name=who]', 'unassigned');
    await expect.poll(() => rows(p).count(), POLL).toBe(3);
    await p.fill('input[name=q]', clients[2]!.email);
    await p.click('[data-testid=messages-search] button[type=submit]');
    await expect.poll(() => rows(p).count(), POLL).toBe(1);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('takes, answers, assigns, closes; the client writing again reopens it', async () => {
    const p = await open(OPERATOR);
    await go(p, '#/messages', 'Messages');
    await rows(p).first().locator('[data-testid=conversation-excerpt]').click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(clients[1]!.email);
    expect(await p.locator('[data-testid=conversation-priority]').textContent()).toBe('Priority · PALLADIUM');
    expect(await p.locator('[data-testid=conversation-answering]').textContent()).toBe('—');
    expect(await p.locator('[data-testid=thread-message]').count()).toBe(1);
    expect(await p.locator('[data-testid=thread-message] .thread__concerns').textContent()).toMatch(/^Concerns Piece O26-J-\d{5}$/);
    await p.click('[data-testid=take-conversation]');
    await expect.poll(() => p.locator('[data-testid=conversation-answering]').textContent(), POLL).toBe(OPERATOR.email);
    // An empty answer is refused in the page; then sent.
    await p.click('[data-testid=answer-send]');
    expect(await p.locator('.cfield[data-field=body] .cfield__hint').textContent()).toBe('Write the answer.');
    await p.fill('[data-testid=answer-body]', 'Your piece is with the atelier.\nIt will be back on Friday.');
    await p.click('[data-testid=answer-send]');
    await expect.poll(() => p.locator('.toast').first().textContent(), POLL).toContain('Answer sent.');
    await expect.poll(() => p.locator('[data-testid=thread-message]').count(), POLL).toBe(2);
    expect(await p.locator('[data-testid=thread-message]').nth(1).getAttribute('data-author')).toBe('STAFF');
    expect(await p.locator('[data-testid=thread-message]').nth(1).locator('.thread__author').textContent()).toBe(OPERATOR.email);
    expect(await p.locator('[data-testid=conversation-status]').textContent()).toBe('Answered');
    await shot(p, 'conversation', { phone: true });
    const id = (await p.evaluate(() => location.hash)).split('/').at(-1)!;
    await p.context().close();

    // An ADMIN assigns it to another OPERATOR.
    const a = await open(ADMIN);
    await go(a, `#/messages/${id}`, clients[1]!.email);
    const other = (await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', OTHER.email).executeTakeFirstOrThrow()).id;
    await a.selectOption('[data-testid=assign-conversation]', other);
    await expect.poll(() => a.locator('[data-testid=conversation-answering]').textContent(), POLL).toBe(OTHER.email);
    // Close, after its confirmation.
    await a.click('[data-testid=close-conversation]');
    await a.click('[data-testid=dialog-confirm]');
    await a.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
    await expect.poll(() => a.locator('[data-testid=conversation-status]').textContent(), POLL).toBe('Closed');
    expect(await a.locator('[data-testid=close-conversation]').count()).toBe(0);
    // The client writes again: it reopens, To answer, and the badge counts it again.
    await ctx.services.messages.write(clients[1]!.id, { body: 'Thank you. One more question.' }, clients[1]!.actor);
    await a.reload();
    await expect.poll(() => a.locator('[data-testid=conversation-status]').textContent(), POLL).toBe('To answer');
    expect(await a.locator('[data-testid=thread-message]').count()).toBe(3);
    // The client sheet's Messages line opens it.
    await go(a, `#/owners/${clients[1]!.id}`, clients[1]!.email);
    expect(await a.locator('[data-testid=owner-messages]').textContent()).toBe('To answer');
    await a.click('[data-testid=owner-messages]');
    await expect.poll(() => a.evaluate(() => location.hash), POLL).toBe(`#/messages/${id}`);
    await a.context().close();
  }, STEP_TIMEOUT);

  it('lets an AUDITOR read the board and a conversation, the emails masked, without one action', async () => {
    const p = await open(AUDITOR);
    await go(p, '#/messages', 'Messages');
    await expect.poll(() => rows(p).count(), POLL).toBe(3);
    for (const e of await p.locator('[data-testid=conversation-client]').allTextContents()) expect(e).toMatch(/^l\*\*\*@example\.com$/);
    await rows(p).first().locator('[data-testid=conversation-excerpt]').click();
    await p.waitForSelector('[data-testid=thread]');
    for (const id of ['take-conversation', 'close-conversation', 'answer-form', 'assign-conversation']) expect(await p.locator(`[data-testid=${id}]`).count(), id).toBe(0);
    await p.context().close();
  }, STEP_TIMEOUT);
  it('writes house messages: a moment switched on, a message to a tier with its reach and preview, scheduled in Paris, then cancelled', async () => {
    const p = await open(ADMIN);
    // The sidebar: House messages right under Messages.
    const clientsNav = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
    expect((await clientsNav.evaluateAll((links) => links.map((x) => x.getAttribute('data-route')))).slice(0, 2)).toEqual(['messages', 'houseMessages']);
    await p.locator('.side__link[data-route=houseMessages]').click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('House messages');
    // MOMENTS: the six, each OFF; one switched on after the no-back-fill sentence.
    await expect.poll(() => p.locator('[data-testid=house-moment]').count(), POLL).toBe(6);
    expect(await p.locator('[data-testid=house-switch-state] .status__text').allTextContents()).toEqual(['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF']);
    await p.locator('[data-testid=house-switch]').first().click();
    expect(await p.locator('dialog .dialog__text').textContent()).toContain('From now on: nothing is sent for what happened before.');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('[data-testid=house-switch-state] .status__text').first().textContent(), POLL).toBe('ON');
    await p.locator('[data-testid=house-moment]').first().click();
    await expect.poll(() => p.locator('[data-testid=house-moment-preview] [data-testid=house-frame-title]').textContent(), POLL).toBe('YOUR FIRST PIECE');
    expect(await p.locator('[data-testid=house-moment-preview] [data-testid=house-frame-link]').allTextContents()).toEqual(['CARING FOR YOUR PIECE', 'YOUR SIZES']);
    await shot(p, 'house-moment', { phone: true });

    // MESSAGES: a new message to PLATINE and above, its reach and its preview.
    await p.click('[data-testid=house-tab-messages]');
    await expect.poll(() => p.locator('#house-messages .empty__text').textContent(), POLL).toBe('No message yet.');
    await p.locator('#house-messages a', { hasText: 'New message' }).click();
    await p.waitForSelector('[data-testid=house-title]');
    await p.fill('[data-testid=house-title]', 'THE WINTER PIECES');
    await p.fill('[data-testid=house-body]', 'Dear {firstName},\n\nThe winter pieces are in THE COLLECTION.');
    await p.selectOption('[data-testid=house-audience]', 'tier:2');
    await expect.poll(() => p.locator('[data-testid=house-reach]').textContent(), POLL).toBe('Reaches 2 collectors now.');
    const frame = p.locator('[data-testid=house-message-preview] [data-testid=house-frame]');
    await expect.poll(() => frame.locator('[data-testid=house-frame-body]').textContent(), POLL).toBe('Dear Camille,\n\nThe winter pieces are in THE COLLECTION.');
    await p.click('[data-testid=house-view-light]');
    await p.click('[data-testid=house-view-computer]');
    expect([await frame.getAttribute('data-mode'), await frame.getAttribute('data-width')]).toEqual(['light', 'computer']);
    expect(await frame.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    await shot(p, 'house-preview-light');
    await p.click('[data-testid=house-view-dark]');
    await p.click('[data-testid=house-view-phone]');
    expect(await frame.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).width])).toEqual(['rgb(10, 10, 10)', '390px']);
    await shot(p, 'house-new', { phone: true });
    if (SCREENSHOTS) {
      // A computer's tight layout: the editor over its preview.
      await p.setViewportSize({ width: 1024, height: 768 });
      await p.waitForTimeout(300);
      await p.screenshot({ path: join(OUT_DIR, 'admin-messages-house-new-1024.png'), fullPage: true });
      await p.setViewportSize({ width: 1440, height: 900 });
    }
    await p.click('[data-testid=house-save]');
    await expect.poll(() => p.locator('[data-testid=house-editor-status]').textContent(), POLL).toBe('Draft');

    // Send…: SCHEDULE tomorrow at 18:00 in Paris, SEND typed.
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
    await p.click('[data-testid=house-send]');
    await p.selectOption('dialog [name=when]', 'SCHEDULE');
    await p.fill('dialog [name=at]', `${tomorrow}T18:00`);
    await expect.poll(() => p.locator('[data-testid=house-send-line]').textContent(), POLL).toContain('Reaches 2 collectors now. It goes ');
    expect(await p.locator('[data-testid=house-send-line]').textContent()).toContain('· 18:00 Paris.');
    expect(await p.locator('[data-testid=dialog-confirm]').isDisabled()).toBe(true);
    await p.fill('[data-testid=dialog-phrase]', 'SEND');
    await shot(p, 'house-send');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('[data-testid=house-editor-status]').textContent(), POLL).toBe('Scheduled');
    expect(await p.locator('#house-message-editor .deflist__note').first().textContent()).toMatch(/^Goes \d{2} [A-Z]{3} \d{4} · 18:00 Paris$/);
    const row = await ctx.db.selectFrom('house_messages').select(['id', 'status', 'send_at', 'audience_min_tier']).executeTakeFirstOrThrow();
    expect([row.status, row.audience_min_tier, new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(row.send_at!)]).toEqual(['SCHEDULED', 2, '18:00']);

    // Cancel the message: kept, CANCELLED, nothing delivered.
    await p.click('[data-testid=house-cancel]');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('[data-testid=house-editor-status]').textContent(), POLL).toBe('Cancelled');
    expect(await p.locator('[data-testid=house-message-status] .status__text').allTextContents()).toEqual(['Cancelled']);
    expect(await p.locator('[data-testid=house-send], [data-testid=house-reschedule], [data-testid=house-cancel]').count()).toBe(0);
    await shot(p, 'house-cancelled', { phone: true });
    expect((await ctx.db.selectFrom('house_messages').select('status').where('id', '=', row.id).executeTakeFirstOrThrow()).status).toBe('CANCELLED');
    expect(Number((await ctx.db.selectFrom('house_deliveries').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n)).toBe(0);
    await p.context().close();
    // An AUDITOR reads the message and the moments, without one action.
    const r = await open(AUDITOR);
    await go(r, `#/house-messages?message=${row.id}`, 'House messages');
    await expect.poll(() => r.locator('[data-testid=house-editor-status]').textContent(), POLL).toBe('Cancelled');
    expect(await r.locator('[data-testid=house-message-preview] [data-testid=house-frame-title]').textContent()).toBe('THE WINTER PIECES');
    await go(r, '#/house-messages', 'House messages');
    await expect.poll(() => r.locator('[data-testid=house-moment]').count(), POLL).toBe(6);
    for (const id of ['house-title', 'house-save', 'house-send', 'house-cancel', 'house-switch']) expect(await r.locator(`[data-testid=${id}]`).count(), id).toBe(0);
    await r.context().close();
  }, STEP_TIMEOUT);
});
