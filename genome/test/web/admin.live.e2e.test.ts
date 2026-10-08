/**
 * The LIVE RELEASES in the console, end to end (step L4): the production web build of the console served by the real
 * Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and driven in Chromium (playwright-core) at
 * 1440 × 900.
 *
 *  1. An ADMIN creates a LIVE RELEASE from the Club page's Drops tab (its one link in the sidebar: SIGN OUT still within
 *     900 px), then sets every part of it in its dialog: the sizes and the quantity line (previewed), the access, the
 *     turns and holds with a per-tier override, the add-ons, the silhouette (a photograph); issues the boutique board's
 *     link (shown once) and publishes it with a post of the circle. Once announced, nothing edits it any more.
 *  2. A release live now: the board follows the console's stream (no reload): the line, LET IN, the turns given by the
 *     engine, a seal held, FREE, REMOVE (ADMIN), PAUSE and RESUME, a host message, ADD PIECES with what the quantity line
 *     promised; a reservation confirmed becomes its orders, followed on the Orders board narrowed to the release (plan
 *     LIVE RELEASE+); END NOW after the typed phrase.
 *  3. An OPERATOR runs the controls but neither ends nor removes; a page left while its open entries are on their way
 *     starts no stream once they arrive, the page on screen keeping its own; an AUDITOR reads the board, the line and
 *     the release's orders with the emails masked, without one action.
 *  4. A release published to be announced later: its post of the circle added then withdrawn on its page; then, the page
 *     never reloaded, its board's stream brings each state and the page is drawn again for it: ADD PIECES and the host
 *     message once announced, no cancellation once the room opens, PAUSE at T0, no control left after the end.
 *  5. The after-room (plan LIVE RELEASE+, choice 2): set in its dialog with the release (step 1); once the release has
 *     sold out, its state, timing and guests on the release's page, and its own page: the live board and its controls,
 *     what it takes from the release, never a setting, a publication, a cancellation, a silhouette or a board link; never
 *     listed among the drops on its own.
 *  6. Step S8 of LIVE RELEASE+: New live release proposes its sizes from the stock at its location (choice 13); the
 *     question after rewritten (choice 11); the best time to open beside its settings and in Analytics, by tier and
 *     country (choice 10); PUBLISH shows the feasibility check per size and publishes all the same (choice 12); once a
 *     release has ended, who was asked where and each answer counted.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { holdPieces } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'live.operator@orbes.test', password: 'live operator passphrase 2026' };
const AUDITOR = { email: 'live.auditor@orbes.test', password: 'live auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const HOUR = 3_600_000;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAS_CHROMIUM)('the console of the LIVE RELEASES (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let modelId: string;
  let admin: Actor;
  const problems: string[] = [];

  async function open(who: { email: string; password: string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await p.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await p.goto(`${origin}/admin`);
    await p.waitForSelector('[data-testid=login-form]');
    await p.fill('input[name=email]', who.email);
    await p.fill('input[name=password]', who.password);
    await p.click('[data-testid=login-submit]');
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const csp = (p: Page) => p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  async function confirmDialog(p: Page, phrase?: string): Promise<void> {
    if (phrase) await p.fill('[data-testid=dialog-phrase]', phrase);
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  /** Visible text in Gravesend Sans holding a one or a zero (its one is its capital I): none should. */
  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-live-${name}.png`), fullPage: true });
  }

  const fig = (p: Page, id: string) => p.locator(`[data-testid=${id}] .kpi__value`);

  /** An ACTIVE account holding `pieces` pieces of the model (its tier). */
  async function collector(n: number, pieces: number): Promise<{ id: string; email: string; actor: Actor }> {
    const email = `live.collector${n}@example.com`;
    const { account } = await ctx.services.auth.registerAccount({ email, password: 'live collector passphrase 2026' }, {});
    if (pieces) await holdPieces(ctx.db, account.id, pieces, modelId);
    return { id: account.id, email, actor: { type: 'account', id: account.id } };
  }

  /** The account's turn taken on the server's clock: the seal pressed, held 1.5 s, secured. */
  async function secure(a: { id: string; actor: Actor }, dropId: string): Promise<void> {
    const e = await ctx.services.live.entry(a.id, dropId);
    const token = e!.turn!.token!;
    await ctx.services.live.press(a.id, dropId, token);
    await sleep(1500);
    await ctx.services.live.secure(a.id, dropId, token, a.actor);
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-live-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    const collection = await ctx.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, collection_id: collection.id, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    // A staff account created by an ADMIN starts on a temporary password: these sign in with their own at once.
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    const row = await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow();
    admin = { type: 'admin', id: row.id };
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

  it('creates a LIVE RELEASE, sets every part of it, issues its board link and publishes it with a post of the circle', async () => {
    const p = await open(ADMIN);
    // No link of its own: the Club's; SIGN OUT and CHANGE PASSWORD still within a 900 px screen.
    for (const id of ['sign-out', 'change-password']) {
      const box = (await p.locator(`[data-testid=${id}]`).boundingBox())!;
      expect(box.y + box.height, id).toBeLessThanOrEqual(900);
    }
    await go(p, '#/club?tab=drops', 'Club');
    await expect.poll(() => p.locator('#live-releases .empty__text').textContent()).toMatch(/^No live release yet/);
    // One primary action on the tab: New live release; a draw's New release beside it, a ghost.
    expect(await p.locator('.club__drops .cbtn--primary').count()).toBe(1);
    expect(await p.locator('[data-testid=live-new]').getAttribute('class')).toContain('cbtn--primary');
    expect(await p.locator('[data-testid=drop-new]').getAttribute('class')).toContain('cbtn--ghost');
    await p.click('[data-testid=live-new]');
    await p.selectOption('dialog select[name=modelId]', modelId);
    await p.fill('dialog input[name=title]', 'THE MONOLITHE RING');
    const t0 = new Date(Date.now() + 6 * HOUR);
    const local = (d: Date) => d.toISOString().slice(0, 16);
    await p.fill('dialog input[name=opensAt]', local(t0));
    await p.fill('dialog input[name=closesAt]', local(new Date(t0.getTime() + HOUR)));
    await p.fill('dialog input[name=price]', '4 800');
    // A wrong line is said before anything is sent.
    await p.fill('dialog textarea[name=sizes]', '52');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Line 1: a size’s label, then its stock (52 = 3).');
    await p.fill('dialog textarea[name=sizes]', 'ONE SIZE = 25');
    await confirmDialog(p);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('THE MONOLITHE RING');
    const id = decodeURIComponent(new URL(p.url()).hash.split('/').pop()!);
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('DRAFT');
    expect(await p.locator('[data-testid=live-price]').textContent()).toBe('€ 4 800 a piece');
    expect(await p.locator('[data-testid=live-quantity-line]').textContent()).toBe('25 PIECES');

    // The sizes, previewed as typed, and the quantity line as the announcement will say it.
    await p.click('[data-testid=live-edit-sizes]');
    await p.fill('dialog textarea[name=sizes]', '52 = 3\n54 = 2');
    await expect.poll(() => p.locator('dialog [data-testid=live-sizes-preview]').textContent()).toBe('5 pieces in all · announced as « 5 PIECES »');
    await p.fill('dialog input[name=quantityLine]', '5 PIECES · NEVER MORE');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-sizes]').textContent()).toBe('52 × 3 · 54 × 2');
    expect(await p.locator('[data-testid=live-quantity-line]').textContent()).toBe('5 PIECES · NEVER MORE');

    // Access: owners from PLATINE of MONOLITHE, the line at random.
    await p.click('[data-testid=live-edit-access]');
    await p.selectOption('dialog select[name=minTier]', '2');
    await p.locator('dialog label.ccheck', { hasText: 'Owners of MONOLITHE' }).click();
    expect(await p.locator('dialog input[name=tierPriority]').isChecked()).toBe(true);
    await p.locator('dialog label.ccheck', { hasText: 'Tier priority' }).click();
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-access]').textContent()).toBe('owners from PLATINE of MONOLITHE');
    expect(await p.locator('#live-part-access').textContent()).toContain('At random for all');

    // Turns and holds: PALLADIUM has ten minutes to pay.
    await p.click('[data-testid=live-edit-turns]');
    await p.fill('dialog input[name="pay:3"]', '10');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-windows]').textContent()).toBe('PALLADIUM · 10 min to pay');

    // The add-ons, one per line.
    await p.click('[data-testid=live-edit-addons]');
    await p.fill('dialog textarea[name=addons]', 'ENGRAVING | 150 | Your initials, by hand\nGIFT BOX | 0');
    await confirmDialog(p);
    await expect.poll(() => p.locator('#live-part-addons').textContent()).toContain('Your initials, by hand');

    // The after-room: a second door after a sell-out, its own model, price, stock and delay; none until set.
    await expect.poll(() => p.locator('#live-part-after-room .notice').textContent()).toBe('None: the release closes at its sell-out.');
    await p.click('[data-testid=live-edit-after-room]');
    await p.locator('dialog label.ccheck', { hasText: 'An after-room after a sell-out' }).click();
    await p.selectOption('dialog select[name=modelId]', modelId);
    await p.fill('dialog input[name=price]', '900');
    await p.fill('dialog input[name=delay]', '0');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('The after-room opens 1 to 60 minutes after the sell-out.');
    await p.fill('dialog input[name=delay]', '5');
    await p.fill('dialog textarea[name=sizes]', 'ONE SIZE = 3');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-after-room-state]').textContent()).toBe('AFTER A SELL-OUT');
    expect(await p.locator('[data-testid=live-after-room-timing]').textContent()).toBe('5 min after the sell-out, open 15 min');
    expect(await p.locator('[data-testid=live-after-room-sizes]').textContent()).toBe('ONE SIZE × 3');

    // Nothing changed: said in the dialog, nothing sent.
    await p.click('[data-testid=live-edit-release]');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('Nothing has changed.');
    await p.click('[data-testid=dialog-cancel]');

    // The silhouette, a photograph prepared as it will be sent.
    const file = join(workDir, 'silhouette.png');
    const png = new PNG({ width: 240, height: 320 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([20, 20, 20, 255], i);
    writeFileSync(file, PNG.sync.write(png));
    await p.click('[data-testid=live-silhouette-edit]');
    await p.setInputFiles('dialog [data-testid=photo-file]', file);
    await expect.poll(() => p.locator('dialog [data-testid=photo-facts]').textContent(), { timeout: 15_000 }).toMatch(/^To be sent: 240 × 320 PX/);
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-silhouette] img').count()).toBe(1);

    // The board's link: shown once, its secret in the fragment.
    await p.click('[data-testid=live-board-issue]');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .live__link').textContent(), { timeout: 15_000 }).toMatch(new RegExp(`^${origin}/verify/releases/${id}/board#[A-Za-z0-9_-]{43}$`));
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-board-link]').textContent()).toMatch(/^Issued /);
    expect(await p.locator('body').textContent()).not.toContain('/board#');

    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'draft');

    // Published with its post of the circle: announced at once, so its settings are fixed.
    await p.click('[data-testid=live-publish]');
    await p.locator('dialog label.ccheck', { hasText: 'Post it in the circle' }).click();
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('ANNOUNCED');
    await expect.poll(() => p.locator('[data-testid=live-circle]').textContent()).toMatch(/^Post shown from /);
    for (const edit of ['live-edit-release', 'live-edit-sizes', 'live-edit-access', 'live-edit-times', 'live-edit-turns', 'live-edit-addons', 'live-edit-after-room', 'live-silhouette-edit', 'live-publish']) {
      expect(await p.locator(`[data-testid=${edit}]`).count(), edit).toBe(0);
    }
    const post = await ctx.db.selectFrom('circle_posts').select(['min_tier', 'drop_id']).where('drop_id', '=', id).executeTakeFirstOrThrow();
    expect(post.min_tier).toBe(2);
    // Its live board is there, before the room: nobody yet.
    await expect.poll(() => fig(p, 'live-in-room').textContent()).toBe('0');
    await go(p, '#/club?tab=drops', 'Club');
    await expect.poll(() => p.locator('#live-releases tbody tr', { hasText: 'THE MONOLITHE RING' }).textContent()).toContain('ANNOUNCED');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('follows a release live on its board: the line, LET IN, FREE, REMOVE, PAUSE, a message, ADD PIECES, Client Services, END NOW', async () => {
    const r = await ctx.services.liveConsole.create(
      {
        modelId,
        title: 'THE VAULT RING',
        opensAt: new Date(Date.now() + 2 * HOUR),
        closesAt: new Date(Date.now() + 3 * HOUR),
        priceMinor: 480_000,
        perAccount: 2,
        // Long turns: the steps below take their time, the server's clock is real.
        turnSeconds: 300,
        sizes: [
          { label: '52', stock: 1 },
          { label: '54', stock: 3 },
        ],
        quantityLine: '4 PIECES · NEVER MORE',
        addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }],
      },
      admin,
    );
    await ctx.services.liveConsole.publish(r.id, {}, admin);
    // T0 has just passed: the room and the line are open.
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 1000), closes_at: new Date(Date.now() + HOUR) }).where('id', '=', r.id).execute();
    const [s52, s54] = r.sizes;
    const x = await collector(1, 5);
    const y = await collector(2, 1);
    const z = await collector(3, 0);
    const w = await collector(4, 0);
    await ctx.services.live.enter(x.id, r.id, { sizeId: s52!.id }, x.actor);
    await ctx.services.live.enter(y.id, r.id, { sizeId: s54!.id, quantity: 2 }, y.actor);
    await ctx.services.live.enter(z.id, r.id, { sizeId: s54!.id }, z.actor);
    await ctx.services.live.enter(w.id, r.id, { sizeId: s54!.id }, w.actor);

    const p = await open(ADMIN);
    await go(p, `#/club/live/${r.id}`, 'THE VAULT RING');
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('LIVE');
    await expect.poll(() => fig(p, 'live-line').textContent()).toBe('4');
    const line = p.locator('#live-entries tbody tr');
    await expect.poll(() => line.count()).toBe(4);
    expect(await line.locator('[data-testid=live-entry-account]').allTextContents()).toEqual([x.email, y.email, z.email, w.email]);

    // LET IN the fourth: their turn now, out of order.
    await line.nth(3).locator('[data-testid=live-let-in]').click();
    await expect.poll(() => p.locator('dialog').textContent()).toContain('takes their turn now, before those ahead of them in size 54');
    await confirmDialog(p);
    await expect.poll(() => line.nth(3).locator('[data-testid=live-entry-status]').textContent()).toMatch(/^TURNLet in by the consoleUntil /);

    // The engine gives the turns; the board follows its stream, no reload.
    const before = await p.locator('[data-testid=live-updated]').textContent();
    await ctx.services.live.advance(r.id);
    await expect.poll(() => fig(p, 'live-turns').textContent(), { timeout: 10_000 }).toBe('3');
    expect(await p.locator('[data-testid=live-updated]').textContent()).toMatch(/^LIVE · /);
    expect(await p.locator('[data-testid=live-updated]').textContent()).not.toBe(before);
    expect(await fig(p, 'live-left').textContent()).toBe('0');

    // A seal held: SECURED, then the hold freed by the console.
    await secure(x, r.id);
    await expect.poll(() => fig(p, 'live-secured').textContent(), { timeout: 10_000 }).toBe('1');
    await expect.poll(() => line.first().locator('[data-testid=live-entry-status]').textContent()).toMatch(/^SECUREDTo pay until /);
    expect(await line.first().locator('td.col--num').nth(2).textContent()).toMatch(/^1\.\d{2} s$/);
    await line.first().locator('[data-testid=live-free]').click();
    await confirmDialog(p);
    await expect.poll(() => fig(p, 'live-expired').textContent(), { timeout: 10_000 }).toBe('1');

    // REMOVE (ADMIN): the third leaves the release.
    const third = line.filter({ hasText: z.email });
    await third.locator('[data-testid=live-remove]').click();
    await confirmDialog(p);
    await expect.poll(() => line.filter({ hasText: z.email }).count(), { timeout: 10_000 }).toBe(0);

    // PAUSE, then RESUME.
    await p.click('[data-testid=live-pause]');
    await expect.poll(() => p.locator('[data-testid=live-board-state]').textContent(), { timeout: 10_000 }).toContain('PAUSED');
    await p.click('[data-testid=live-resume]');
    await expect.poll(() => p.locator('[data-testid=live-board-state]').textContent(), { timeout: 10_000 }).not.toContain('PAUSED');

    // A host message for the room.
    await p.click('[data-testid=live-message-new]');
    await p.fill('dialog input[name=text]', 'The vault opens in the order of the line.');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-message]').textContent(), { timeout: 10_000 }).toContain('« The vault opens in the order of the line. »');

    // ADD PIECES, with what the quantity line promised.
    await p.locator('.live__sizes tbody tr', { hasText: '54' }).locator('[data-testid=live-add-pieces]').click();
    await expect.poll(() => p.locator('dialog [data-testid=live-quantity-promise]').textContent()).toContain('« 4 PIECES · NEVER MORE »');
    await p.fill('dialog input[name=pieces]', '1');
    await confirmDialog(p);
    await expect.poll(() => p.locator('.live__sizes tbody tr', { hasText: '54' }).locator('td').nth(1).textContent(), { timeout: 10_000 }).toBe('4');

    // Client Services: a reservation confirmed on /verify becomes its orders, followed on the Orders board, narrowed to
    // the release from its page (plan LIVE RELEASE+: the LIVE plan's list is retired).
    await secure(y, r.id);
    const engraving = (await ctx.services.liveConsole.get(r.id)).addons[0]!;
    await ctx.services.live.setAddons(y.id, r.id, [engraving.id], y.actor);
    await ctx.services.live.confirm(y.id, r.id, y.actor);
    await p.reload();
    await expect.poll(() => p.locator('[data-testid=live-orders]').textContent()).toBe('1 confirmed reservation: each piece is an order, followed step by step on the Orders board, from payment to delivery.');
    expect(await p.locator('#live-services tbody tr').count()).toBe(0);
    await p.locator('#live-services a', { hasText: 'Orders of this release' }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Orders');
    expect(decodeURIComponent(new URL(p.url()).hash)).toBe(`#/orders?dropId=${r.id}`);
    const cards = p.locator('[data-testid=column-RESERVED] [data-testid=order-card]');
    await expect.poll(() => cards.count()).toBe(2);
    expect(await cards.first().textContent()).toContain(y.email);
    expect(await cards.first().textContent()).toContain('ENGRAVING');
    await go(p, `#/club/live/${r.id}`, 'THE VAULT RING');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'board');

    // END NOW: an ADMIN, after the typed phrase.
    await p.click('[data-testid=live-end]');
    await expect.poll(() => p.locator('dialog [data-testid=dialog-confirm]').isDisabled()).toBe(true);
    await confirmDialog(p, `END ${r.id.slice(0, 8).toUpperCase()}`);
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('ENDED');
    for (const control of ['live-pause', 'live-extend', 'live-message-new', 'live-end', 'live-add-pieces', 'live-let-in']) {
      expect(await p.locator(`[data-testid=${control}]`).count(), control).toBe(0);
    }
    expect(await csp(p)).toEqual([]);
    await p.context().close();

    // An OPERATOR runs the controls of a release live, but neither ends it nor removes anyone.
    const live2 = await ctx.services.liveConsole.create({ modelId, title: 'THE SECOND RING', opensAt: new Date(Date.now() + 2 * HOUR), closesAt: new Date(Date.now() + 3 * HOUR), priceMinor: 100_000, sizes: [{ label: '52', stock: 2 }] }, admin);
    await ctx.services.liveConsole.publish(live2.id, {}, admin);
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 1000), closes_at: new Date(Date.now() + HOUR) }).where('id', '=', live2.id).execute();
    await ctx.services.live.enter(w.id, live2.id, { sizeId: live2.sizes[0]!.id }, w.actor);
    const o = await open(OPERATOR);
    await go(o, `#/club/live/${live2.id}`, 'THE SECOND RING');
    await expect.poll(() => o.locator('[data-testid=live-pause]').count()).toBe(1);
    expect(await o.locator('[data-testid=live-let-in]').count()).toBe(1);
    expect(await o.locator('[data-testid=live-end]').count()).toBe(0);
    expect(await o.locator('[data-testid=live-remove]').count()).toBe(0);
    expect(await o.locator('[data-testid=live-entry-account]').first().textContent()).toBe(w.email);

    // A stale page starts nothing: the console leaves a release's page while its open entries are still on their way;
    // once they arrive, the page now on screen keeps the one stream, and its board still follows it.
    await o.addInitScript(() => {
      const Native = window.EventSource;
      const all: EventSource[] = [];
      window.EventSource = class extends Native {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          all.push(this);
        }
      };
      (window as unknown as { __streams: () => string[] }).__streams = () => all.filter((e) => e.readyState !== EventSource.CLOSED).map((e) => new URL(e.url).pathname);
    });
    await o.reload();
    await expect.poll(() => o.locator('[data-testid=live-pause]').count()).toBe(1);
    const streams = () => o.evaluate(() => (window as unknown as { __streams: () => string[] }).__streams());
    await expect.poll(streams).toEqual([`/api/admin/live/${live2.id}/stream`]);
    let arrive!: () => void;
    const held = new Promise<void>((resolve) => (arrive = resolve));
    let asked!: () => void;
    const pending = new Promise<void>((resolve) => (asked = resolve));
    await o.route(
      (u) => u.pathname === `/api/admin/live/${r.id}/entries` && u.searchParams.get('status') === 'OPEN',
      async (route) => {
        asked();
        await held;
        await route.continue();
      },
    );
    await o.evaluate((h) => (location.hash = h), `#/club/live/${r.id}?status=OPEN`);
    await pending;
    await go(o, '#/club?tab=drops', 'Club');
    await go(o, `#/club/live/${live2.id}`, 'THE SECOND RING');
    await expect.poll(streams).toEqual([`/api/admin/live/${live2.id}/stream`]);
    arrive();
    await sleep(1000);
    expect(await streams()).toEqual([`/api/admin/live/${live2.id}/stream`]);
    await ctx.services.live.message(live2.id, 'The line moves in its order.', admin);
    await expect.poll(() => o.locator('[data-testid=live-message]').textContent(), { timeout: 10_000 }).toContain('« The line moves in its order. »');
    expect(await o.locator('[data-testid=live-updated]').textContent()).toMatch(/^LIVE · /);
    await o.unrouteAll();
    await o.context().close();

    // An AUDITOR reads the board, the line and the release's orders, the emails masked, without one action.
    const a = await open(AUDITOR);
    await go(a, `#/club/live/${r.id}`, 'THE VAULT RING');
    await expect.poll(() => a.locator('[data-testid=live-orders]').textContent()).toMatch(/^1 confirmed reservation/);
    await go(a, `#/orders?dropId=${r.id}`, 'Orders');
    await expect.poll(() => a.locator('[data-testid=order-card]').count()).toBe(2);
    expect(await a.locator('[data-testid=order-card]').first().textContent()).toContain('l***@example.com');
    expect(await a.locator('body').textContent()).not.toContain(y.email);
    await go(a, `#/club/live/${r.id}`, 'THE VAULT RING');
    await go(a, `#/club/live/${live2.id}`, 'THE SECOND RING');
    await expect.poll(() => a.locator('[data-testid=live-entry-account]').first().textContent()).toBe('l***@example.com');
    for (const action of ['live-pause', 'live-extend', 'live-message-new', 'live-end', 'live-add-pieces', 'live-let-in', 'live-free', 'live-remove', 'live-board-issue', 'live-cancel']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    await go(a, '#/club?tab=drops', 'Club');
    expect(await a.locator('[data-testid=live-new]').count()).toBe(0);
    expect(await csp(a)).toEqual([]);
    await a.context().close();
  }, STEP_TIMEOUT);

  it('draws the page again as the release moves on, without a reload: its post of the circle until the announcement, ADD PIECES once announced, PAUSE at T0, no control after the end', async () => {
    const r = await ctx.services.liveConsole.create(
      { modelId, title: 'THE THIRD RING', announceAt: new Date(Date.now() + 2 * HOUR), opensAt: new Date(Date.now() + 4 * HOUR), closesAt: new Date(Date.now() + 5 * HOUR), priceMinor: 100_000, sizes: [{ label: '52', stock: 2 }] },
      admin,
    );
    await ctx.services.liveConsole.publish(r.id, {}, admin);
    const move = (set: { announce_at?: Date; opens_at?: Date; closes_at?: Date }) => ctx.db.updateTable('drops').set(set).where('id', '=', r.id).execute();
    const p = await open(ADMIN);
    await go(p, `#/club/live/${r.id}`, 'THE THIRD RING');
    const state = () => p.locator('[data-testid=live-state]').textContent();
    const lead = () => p.locator('.page-head__lead').textContent();
    const count = (id: string) => p.locator(`[data-testid=${id}]`).count();
    await expect.poll(state).toBe('SCHEDULED');

    // Published, announced later: its post of the circle is added, then withdrawn, on its page.
    expect(await count('live-circle')).toBe(0);
    await p.click('[data-testid=live-circle-post]');
    await expect.poll(() => p.locator('dialog').textContent()).toContain('shown from the announcement');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-circle]').textContent()).toMatch(/^Post shown from /);
    expect(await count('live-circle-post')).toBe(0);
    await p.click('[data-testid=live-circle-withdraw]');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-circle]').textContent()).toBe('Post withdrawn');
    expect(await ctx.db.selectFrom('circle_posts').select('published_at').where('drop_id', '=', r.id).execute()).toEqual([{ published_at: null }]);
    for (const [id, n] of [['live-circle-post', 1], ['live-edit-sizes', 1], ['live-cancel', 1], ['live-add-pieces', 0], ['live-message-new', 0], ['live-pause', 0]] as const) {
      expect(await count(id), id).toBe(n);
    }

    // From here the page is never reloaded (the mark survives): its board's stream brings each state, the page follows.
    await p.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

    // Announced: the settings and the post's choice go, ADD PIECES and the host message come.
    await move({ announce_at: new Date(Date.now() - HOUR) });
    await expect.poll(state, { timeout: 15_000 }).toBe('ANNOUNCED');
    await expect.poll(() => count('live-add-pieces')).toBe(1);
    expect(await lead()).toMatch(/^Announced on \/verify/);
    for (const [id, n] of [['live-circle-post', 0], ['live-edit-sizes', 0], ['live-cancel', 1], ['live-message-new', 1], ['live-pause', 0], ['live-end', 1]] as const) {
      expect(await count(id), id).toBe(n);
    }

    // The room open: no cancellation any more, no pause before T0.
    await move({ opens_at: new Date(Date.now() + 2 * 60_000) });
    await expect.poll(state, { timeout: 15_000 }).toBe('ROOM OPEN');
    await expect.poll(() => count('live-cancel')).toBe(0);
    expect(await count('live-pause')).toBe(0);

    // T0: PAUSE comes with LIVE, the Publication's mark and the lead with it.
    await move({ opens_at: new Date(Date.now() - 60_000) });
    await ctx.services.live.advance(r.id);
    await expect.poll(() => count('live-pause'), { timeout: 15_000 }).toBe(1);
    expect(await state()).toBe('LIVE');
    expect(await lead()).toMatch(/^Live: /);
    await expect.poll(() => p.locator('[data-testid=live-board-state]').textContent()).toContain('LIVE');

    // The end of the sales: no control is left.
    await move({ closes_at: new Date(Date.now() - 1000) });
    await ctx.services.live.advance(r.id);
    await expect.poll(state, { timeout: 15_000 }).toBe('CLOSED');
    for (const id of ['live-pause', 'live-resume', 'live-extend', 'live-message-new', 'live-end', 'live-add-pieces']) {
      expect(await count(id), id).toBe(0);
    }
    expect(await lead()).toMatch(/^Over: /);
    expect(await p.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('shows a release’s after-room once its sell-out opened it, then its own page: the live board and controls, never a setting, a publication or a board link', async () => {
    const r = await ctx.services.liveConsole.create(
      {
        modelId,
        title: 'THE NIGHT RING',
        opensAt: new Date(Date.now() + 4 * HOUR),
        closesAt: new Date(Date.now() + 5 * HOUR),
        priceMinor: 100_000,
        sizes: [{ label: '52', stock: 1 }],
        afterRoom: { modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 2 }], addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }] },
      },
      admin,
    );
    await ctx.services.liveConsole.publish(r.id, {}, admin);
    // T0 passed; two collectors in the line; the first secures and pays the one piece: SOLD OUT, the second remembered.
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 60_000), closes_at: new Date(Date.now() + HOUR) }).where('id', '=', r.id).execute();
    const [first, second] = [await collector(51, 0), await collector(52, 0)];
    for (const c of [first, second]) await ctx.services.live.enter(c.id, r.id, { sizeId: (await ctx.services.liveConsole.get(r.id)).sizes[0]!.id }, c.actor);
    await ctx.services.live.advance(r.id);
    await secure(first!, r.id);
    await ctx.services.live.confirm(first!.id, r.id, first!.actor);

    const p = await open(ADMIN);
    await go(p, `#/club/live/${r.id}`, 'THE NIGHT RING');
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('SOLD OUT');
    await expect.poll(() => p.locator('[data-testid=live-after-room-state]').textContent()).toBe('OPENS SOON');
    expect(await p.locator('[data-testid=live-after-room-guests]').textContent()).toBe('1');
    expect(await p.locator('[data-testid=live-after-room-timing]').textContent()).toBe('10 min after the sell-out, open 15 min');
    expect(await p.locator('#live-part-after-room').textContent()).toContain('Its guests see it from its opening');
    await shot(p, 'after-room-parent');

    // Its own page: the release it follows, its offer read only, its board; no setting, publication, cancellation, board link.
    await p.click('#live-part-after-room a.cbtn');
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('THE NIGHT RING · THE AFTER-ROOM');
    expect(await p.locator('.page-head__lead').textContent()).toMatch(/^Opened by the release’s sell-out/);
    expect(await p.locator('[data-testid=live-after-room-of]').textContent()).toBe('THE NIGHT RING');
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('OPENS SOON');
    expect(await p.locator('#live-part-after-room-own').textContent()).toContain('30 s to hold the seal · 5 min to press PAY · 1 piece per person');
    await expect.poll(() => p.locator('[data-testid=live-in-room]').count()).toBe(1);
    for (const id of ['live-edit-release', 'live-edit-sizes', 'live-edit-after-room', 'live-publish', 'live-cancel', 'live-circle-post', 'live-board-issue', 'live-silhouette-edit', 'live-page']) {
      expect(await p.locator(`[data-testid=${id}]`).count(), id).toBe(0);
    }
    // Its live controls are there (announced at the sell-out): ADD PIECES and the host message.
    expect(await p.locator('[data-testid=live-message-new]').count()).toBe(1);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'after-room-own');
    // Never listed among the drops on its own.
    await go(p, '#/club?tab=drops', 'Club');
    await expect.poll(() => p.locator('#live-releases tbody tr', { hasText: 'THE NIGHT RING' }).count()).toBe(1);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('proposes the sizes from the stock, rewrites the question after, reads the best time to open, warns per size at PUBLISH and counts the answers', async () => {
    // A model of its own, in stock at FRANCE WAREHOUSE (the default location): 52 × 2, 54 × 1.
    const category = (await ctx.categories.getByCode('J'))!.index;
    const nocturne = (
      await ctx.db.insertInto('models').values({ category_id: category, name: 'NOCTURNE', type: 'RING', sku_prefix: 'NCT-RG', default_material: '925 STERLING SILVER' }).returning('id').executeTakeFirstOrThrow()
    ).id;
    const france = (await ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    for (const [label, n] of [['52', 2], ['54', 1]] as const) {
      const skuId = await inTransaction(ctx.db, (tx) => ensureSku(tx, nocturne, label));
      await ctx.services.stock.adjust({ skuId, locationId: france, delta: n, note: 'Pieces counted at the atelier.' }, admin);
    }
    // The activity of two days ago at a known hour: 50 sign-ins from PALLADIUM in France, 80 without a tier in the United
    // States an hour later (no account in either row).
    const paris = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(d));
    const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
    const at = new Date(Math.floor((Date.now() - 2 * 24 * HOUR) / HOUR) * HOUR);
    await ctx.db
      .insertInto('activity_hourly')
      .values([
        { hour: at, country: 'FR', tier: 3, sign_ins: 50, scans: 0 },
        { hour: new Date(at.getTime() + HOUR), country: 'US', tier: 0, sign_ins: 80, scans: 0 },
      ])
      .execute();
    const [frHour, usHour] = [paris(at), paris(new Date(at.getTime() + HOUR))];
    // Its supplier (plan NEXT LOT §3.5.4.5), for the release's Add to supplier order.
    const nord = await ctx.services.suppliers.create({ name: 'MAISON NORD', currency: 'EUR' }, admin);
    await ctx.services.suppliers.setModelSupplier(nocturne, { supplierId: nord.id }, admin);

    const p = await open(ADMIN);
    await go(p, '#/club?tab=drops', 'Club');
    await p.click('[data-testid=live-new]');
    await expect.poll(() => p.locator('dialog select[name=locationId] option').first().textContent()).toBe('The default (FRANCE WAREHOUSE)');
    await p.selectOption('dialog select[name=modelId]', nocturne);
    // The stock first: written into the sizes, said with where each comes from.
    await expect.poll(() => p.locator('dialog [data-testid=live-size-mix-line]').textContent(), { timeout: 15_000 }).toBe('52 = 2 (2 in stock) · 54 = 1 (1 in stock)');
    await expect.poll(() => p.locator('dialog textarea[name=sizes]').inputValue()).toBe('52 = 2\n54 = 1');
    expect(await p.locator('dialog [data-testid=live-size-mix-why]').textContent()).toContain('In stock at FRANCE WAREHOUSE: 52: 2, 54: 1, offered first.');
    // Yours to change: typed by hand, the proposal never writes over it.
    await p.fill('dialog textarea[name=sizes]', '52 = 3\n54 = 1\n56 = 1');
    await p.fill('dialog input[name=title]', 'THE NOCTURNE RING');
    const t0 = new Date(Math.floor((Date.now() + 26 * HOUR) / HOUR) * HOUR);
    const local = (d: Date) => d.toISOString().slice(0, 16);
    await p.fill('dialog input[name=opensAt]', local(t0));
    await p.fill('dialog input[name=closesAt]', local(new Date(t0.getTime() + HOUR)));
    await p.fill('dialog input[name=price]', '2 400');
    expect(await p.locator('dialog textarea[name=sizes]').inputValue()).toBe('52 = 3\n54 = 1\n56 = 1');
    await confirmDialog(p);
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('THE NOCTURNE RING');
    const id = decodeURIComponent(new URL(p.url()).hash.split('/').pop()!);
    await expect.poll(() => p.locator('[data-testid=live-sizes]').textContent()).toBe('52 × 3 · 54 × 1 · 56 × 1');
    expect(await p.locator('[data-testid=live-location]').textContent()).toBe('FRANCE WAREHOUSE');
    // Its stock under its sizes from its creation on (plan NEXT LOT §3.5.4.3): per size, the owner's sentence; a size of a
    // model with its supplier, Add to supplier order, into that supplier's draft for ORBES to confirm.
    await expect.poll(() => p.locator('[data-testid=live-stock-line]').textContent(), { timeout: 15_000 }).toBe('2 pieces on sale will wait for supplier stock once sold (FRANCE WAREHOUSE).');
    expect(await p.locator('[data-testid=live-stock-warning]').allTextContents()).toEqual(['52: 2 in stock, 1 will wait for supplier stock. Add to supplier order', '56: 0 in stock, 1 will wait for supplier stock. Add to supplier order']);
    await p.locator('[data-testid=live-stock-warning]', { hasText: '52:' }).locator('[data-testid=live-add-to-order]').click();
    expect(await p.locator('dialog [data-testid=live-add-to-order-text]').textContent()).toBe(
      'Add 1 piece of NOCTURNE · 52 to the draft of MAISON NORD, to deliver to FRANCE WAREHOUSE. You confirm the draft before it is sent.',
    );
    await confirmDialog(p);
    await p.waitForSelector('.toast:has-text("Added to the draft.")');
    const drafts = await ctx.services.supplierOrders.list({ status: 'DRAFT' });
    expect(drafts.map((d) => [d.supplier.name, d.location.name, d.pieces.ordered])).toEqual([['MAISON NORD', 'FRANCE WAREHOUSE', 1]]);
    await shot(p, 'stock-block');

    // The question after: the default one, rewritten.
    expect(await p.locator('[data-testid=live-question]').textContent()).toBe('WHAT WOULD YOU HAVE WANTED? · ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND (the default question)');
    expect(await p.locator('[data-testid=live-question-state]').textContent()).toBe('Asked at the release’s end, for 7 days');
    await p.click('[data-testid=live-edit-question]');
    await p.fill('dialog input[name=text]', 'WHICH FINISH?');
    await p.fill('dialog textarea[name=answers]', 'GOLD\nGOLD');
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => p.locator('dialog .dialog__error').textContent()).toBe('The answer GOLD is listed twice.');
    await p.fill('dialog textarea[name=answers]', 'GOLD\nSILVER\nBLACK');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-question]').textContent()).toBe('WHICH FINISH? · GOLD · SILVER · BLACK');

    // The best time to open, for every collector (its tiers): the busiest hour, its T0 beside it.
    const panel = p.locator('#live-best-time');
    await expect.poll(() => panel.locator('[data-testid=best-time-suggested]').textContent()).toMatch(new RegExp(`^${hh(usHour)} Paris · \\d+ % of the activity of every collector$`));
    expect(await panel.locator('[data-testid=best-time-release]').textContent()).toMatch(new RegExp(`^Its T0 · ${hh(paris(t0))} Paris · \\d+ % of that activity$`));
    expect(await panel.locator(`.best__col--suggested`).getAttribute('data-hour')).toBe(String(usHour));
    expect(await panel.locator('.best__col').count()).toBe(24);
    expect(await panel.locator('table').textContent()).toContain(hh(frHour));
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'question-best-time');

    // PUBLISH: the stock checked per size, a warning, published all the same.
    await p.click('[data-testid=live-publish]');
    await expect.poll(() => p.locator('dialog [data-testid=live-feasibility-line]').textContent(), { timeout: 15_000 }).toBe('2 pieces on sale will wait for supplier stock once sold (FRANCE WAREHOUSE).');
    expect(await p.locator('dialog [data-testid=live-feasibility-warning]').allTextContents()).toEqual([
      '52: 2 in stock, 1 will wait for supplier stock.',
      '56: 0 in stock, 1 will wait for supplier stock.',
    ]);
    await shot(p, 'feasibility');
    await confirmDialog(p);
    await expect.poll(() => p.locator('[data-testid=live-state]').textContent()).toBe('ANNOUNCED');
    const published = await ctx.db.selectFrom('audit_logs').select('details').where('target_id', '=', id).where('action', '=', 'drop.live.publish').executeTakeFirstOrThrow();
    expect(published.details).toMatchObject({ locationId: france, waitForStock: 2, shortSizes: ['52:1', '56:1'] });
    // Announced: the question is fixed, the best time no longer read.
    expect(await p.locator('[data-testid=live-edit-question]').count()).toBe(0);
    expect(await p.locator('#live-best-time').count()).toBe(0);

    // Analytics: every tier, then from PLATINE, then France only.
    await go(p, '#/analytics', 'Analytics');
    const best = p.locator('#analytics-best-time');
    await expect.poll(() => best.locator('[data-testid=best-time-suggested]').textContent(), { timeout: 15_000 }).toMatch(new RegExp(`^${hh(usHour)} Paris · \\d+ % of the activity of every collector$`));
    await p.click('[data-testid=best-time-tier-2]');
    await expect.poll(() => best.locator('[data-testid=best-time-suggested]').textContent(), { timeout: 15_000 }).toMatch(new RegExp(`^${hh(frHour)} Paris · \\d+ % of the activity of collectors from PLATINE$`));
    expect(await p.locator('[data-testid=best-time-tier-2]').getAttribute('aria-current')).toBe('page');
    await p.click('[data-testid=best-time-tier-0]');
    await expect.poll(() => best.locator('[data-testid=best-time-suggested]').textContent(), { timeout: 15_000 }).toMatch(/of the activity of every collector$/);
    await p.selectOption('[data-testid=best-time-country]', 'FR');
    await expect.poll(() => best.locator('[data-testid=best-time-suggested]').textContent(), { timeout: 15_000 }).toBe(`${hh(frHour)} Paris · 100 % of the activity of every collector in FR · France`);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'analytics-best-time');

    // A release ended: who was asked where, the answers counted.
    const r = await ctx.services.liveConsole.create(
      { modelId: nocturne, title: 'THE ASKED RING', opensAt: new Date(Date.now() + 6 * HOUR), closesAt: new Date(Date.now() + 7 * HOUR), priceMinor: 100_000, sizes: [{ label: '52', stock: 1 }] },
      admin,
    );
    await ctx.services.liveConsole.publish(r.id, {}, admin);
    const [first, second, absent] = [await collector(61, 0), await collector(62, 0), await collector(63, 0)];
    const size = (await ctx.services.liveConsole.get(r.id)).sizes[0]!.id;
    await ctx.services.live.setInterest(absent.id, r.id, size, absent.actor);
    await ctx.db.updateTable('drops').set({ opens_at: new Date(Date.now() - 60_000), closes_at: new Date(Date.now() + HOUR) }).where('id', '=', r.id).execute();
    for (const c of [first, second]) await ctx.services.live.enter(c.id, r.id, { sizeId: size }, c.actor);
    await ctx.services.live.advance(r.id);
    await secure(first, r.id);
    await ctx.services.live.confirm(first.id, r.id, first.actor);
    await ctx.services.live.advance(r.id);
    await ctx.services.questions.answer(second.id, r.id, 1, second.actor);
    await ctx.services.questions.answer(absent.id, r.id, 1, absent.actor);
    await go(p, `#/club/live/${r.id}`, 'THE ASKED RING');
    await expect.poll(() => p.locator('[data-testid=live-question-state]').textContent()).toMatch(/^Open until \d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC$/);
    expect(await p.locator('[data-testid=live-question-asked]').textContent()).toBe('2');
    expect(await p.locator('#live-part-question').textContent()).toContain('1 on the end page (took part, no piece) · 1 in MY PIECES (I’LL BE THERE, did not come)');
    expect(await p.locator('[data-testid=live-question-answered]').textContent()).toBe('2');
    expect(await p.locator('[data-testid=live-question-tally] .bar__label').allTextContents()).toEqual(['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND']);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'question-counted');
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);
});
