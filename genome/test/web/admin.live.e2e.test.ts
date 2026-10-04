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
 *     promised; Client Services concludes a reservation with a note and downloads the CSV; END NOW after the typed phrase.
 *  3. An OPERATOR runs the controls but neither ends nor removes; an AUDITOR reads the board, the line and the
 *     reservations with the emails masked, without one action.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    for (const edit of ['live-edit-release', 'live-edit-sizes', 'live-edit-access', 'live-edit-times', 'live-edit-turns', 'live-edit-addons', 'live-silhouette-edit', 'live-publish']) {
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

    // Client Services: a reservation confirmed on /verify, concluded with a note; the CSV.
    await secure(y, r.id);
    const engraving = (await ctx.services.liveConsole.get(r.id)).addons[0]!;
    await ctx.services.live.setAddons(y.id, r.id, [engraving.id], y.actor);
    await ctx.services.live.confirm(y.id, r.id, y.actor);
    await p.reload();
    const reservation = p.locator('#live-services tbody tr');
    await expect.poll(() => reservation.count()).toBe(1);
    expect(await reservation.textContent()).toContain(y.email);
    expect(await reservation.textContent()).toContain('ENGRAVING € 150');
    expect(await reservation.textContent()).toContain('€ 9 900');
    await reservation.locator('[data-testid=live-conclude]').click();
    await p.fill('dialog textarea[name=note]', 'Paid by transfer; delivered in Paris.');
    await confirmDialog(p);
    await expect.poll(() => reservation.locator('[data-testid=live-outcome]').textContent()).toMatch(/^CONCLUDEDconsole@orbes\.test · .*Paid by transfer; delivered in Paris\.$/);
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=live-csv]')]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^ORBES-live-${r.id.slice(0, 8).toUpperCase()}-reservations-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).toContain(`"${y.email}","54","2","EUR","4800.00","ENGRAVING (150.00)","9900.00"`);
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
    await o.context().close();

    // An AUDITOR reads the board, the line and the reservations, the emails masked, without one action.
    const a = await open(AUDITOR);
    await go(a, `#/club/live/${r.id}`, 'THE VAULT RING');
    await expect.poll(() => a.locator('#live-services tbody tr').count()).toBe(1);
    expect(await a.locator('#live-services tbody tr').textContent()).toContain('l***@example.com');
    expect(await a.locator('body').textContent()).not.toContain(y.email);
    await go(a, `#/club/live/${live2.id}`, 'THE SECOND RING');
    await expect.poll(() => a.locator('[data-testid=live-entry-account]').first().textContent()).toBe('l***@example.com');
    for (const action of ['live-pause', 'live-extend', 'live-message-new', 'live-end', 'live-add-pieces', 'live-let-in', 'live-free', 'live-remove', 'live-board-issue', 'live-cancel', 'live-conclude']) {
      expect(await a.locator(`[data-testid=${action}]`).count(), action).toBe(0);
    }
    await go(a, '#/club?tab=drops', 'Club');
    expect(await a.locator('[data-testid=live-new]').count()).toBe(0);
    expect(await csp(a)).toEqual([]);
    await a.context().close();
  }, STEP_TIMEOUT);
});
