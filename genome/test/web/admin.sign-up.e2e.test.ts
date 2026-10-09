/**
 * The console's Sign-up page, end to end (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.10; step 1.10): the production
 * web build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. Reached from the Owners page's header (no sidebar item): what a new account is asked, then the answers to « How
 *     did you hear about ORBES? » in their order, Other last with its text field, each with how many collectors gave it
 *     (a test entrant and the team's own account left out).
 *  2. An ADMIN adds an answer (last before Other), renames it (« Nothing has changed. » when it is not), moves it up and
 *     down (at once, no dialog), sets one aside and offers it again; Other has Edit only; at 12 offered, Add says so.
 *  3. An AUDITOR reads the page, without one action.
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
import { SIGN_UP_COPY as C } from '../../src/web/admin/model/sign-up.js';
import { createTestDb, type TestDb } from '../support/db.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const AUDITOR = { email: 'signup.auditor@orbes.test', password: 'sign-up auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const SCREENSHOTS = !!process.env.ORBES_SCREENSHOTS;
const STEP_TIMEOUT = 180_000;
const PRESETS = ['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other'];

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

describe.skipIf(!HAS_CHROMIUM)('the console\'s Sign-up page (plan CUSTOMER INTELLIGENCE §3.1 P.10, E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];

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
    await expect.poll(async () => (await title(p).textContent())?.trim()).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const labels = (p: Page) => p.locator('#sign-up-heard [data-testid=heard-label]').allTextContents();
  const row = (p: Page, label: string) => p.locator('#sign-up-heard tbody tr').filter({ has: p.locator('[data-testid=heard-label]', { hasText: new RegExp(`^${label}$`) }) });
  const toast = (p: Page, text: string) => p.locator('.toast', { hasText: text }).first().waitFor({ timeout: 15_000 });

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe(heading);
  }

  async function dialogWith(p: Page, value: string | null): Promise<void> {
    await p.waitForSelector('dialog.dialog');
    if (value !== null) await p.fill('dialog.dialog input[name=label]', value);
    await p.click('[data-testid=dialog-confirm]');
  }

  async function confirmed(p: Page): Promise<void> {
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  async function shot(p: Page, name: string): Promise<void> {
    if (!SCREENSHOTS) return;
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(() => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT_DIR, `admin-sign-up-${name}.png`), fullPage: true });
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-sign-up-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    // Two collectors who heard of ORBES on Instagram, one who heard from a friend; a test entrant and the team's own
    // account who answered Instagram too, left out of Given.
    const heard = await ctx.services.profiles.offeredHeard();
    const id = (label: string) => heard.find((o) => o.label === label)!.id;
    const signUp = async (email: string, label: string) =>
      (await ctx.services.auth.registerAccount({ email, password: 'collector passphrase 2026', firstName: 'Camille', lastName: 'Laurent', country: 'FR', heard: { optionId: id(label) } }, {})).account.id;
    await signUp('one@example.com', 'Instagram');
    await signUp('two@example.com', 'Instagram');
    await signUp('three@example.com', 'A friend');
    const entrant = await signUp('entrant@example.com', 'Instagram');
    await ctx.db.insertInto('test_entrants').values({ account_id: entrant }).execute();
    await signUp(ADMIN.email, 'Instagram');
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

  it(
    'reads what a new account is asked and the answers with their counts, reached from Owners',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/owners', 'Owners');
      await p.locator('.page-head').getByRole('link', { name: 'Sign-up', exact: true }).click();
      await expect.poll(async () => (await title(p).textContent())?.trim(), { timeout: 15_000 }).toBe('Sign-up');
      expect(await p.evaluate(() => location.hash)).toBe('#/sign-up');
      // No sidebar item of its own: Owners stays the current one.
      expect(await p.locator('nav').getByRole('link', { name: 'Sign-up' }).count()).toBe(0);
      expect((await p.locator('.page-head__eyebrow').textContent())?.trim()).toBe(C.eyebrow);
      expect((await p.locator('#sign-up-asked .deflist__label').allTextContents()).map((x) => x.trim())).toEqual(['First name and last name', 'Country', 'How did you hear about ORBES?']);
      expect((await p.locator('#sign-up-asked .deflist__value').allTextContents()).map((x) => x.trim())).toEqual(['Required', 'Required, preselected from where the person connects', 'Optional']);
      expect(await labels(p)).toEqual(PRESETS);
      expect((await row(p, 'Other').textContent()) ?? '').toContain(C.otherNote);
      expect(await row(p, 'Instagram').locator('[data-testid=heard-given]').textContent()).toBe('2');
      expect(await row(p, 'A friend').locator('[data-testid=heard-given]').textContent()).toBe('1');
      expect(await row(p, 'TikTok').locator('[data-testid=heard-given]').textContent()).toBe('0');
      expect(await p.locator('#sign-up-heard .status__text').allTextContents()).toEqual(Array(8).fill(C.offered));
      // Other: Edit only.
      expect(await row(p, 'Other').getByRole('button').allTextContents()).toEqual([C.edit]);
      await shot(p, 'page');
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'lets an ADMIN add, rename, move, set aside and offer again an answer; Add says so at 12 offered',
    async () => {
      const p = await open(ADMIN);
      await go(p, '#/sign-up', 'Sign-up');
      // Add: last before Other.
      await p.click('[data-testid=heard-add]');
      await dialogWith(p, 'A podcast');
      await confirmed(p);
      await toast(p, C.added);
      await expect.poll(() => labels(p)).toEqual([...PRESETS.slice(0, 7), 'A podcast', 'Other']);
      // A label taken whatever the case is refused in the dialog.
      await p.click('[data-testid=heard-add]');
      await dialogWith(p, 'instagram');
      await expect.poll(async () => (await p.locator('dialog.dialog .dialog__error').textContent())?.trim()).toBe(C.taken);
      await p.keyboard.press('Escape');
      await p.waitForSelector('dialog.dialog', { state: 'detached' });
      // Edit: unchanged, then renamed.
      await row(p, 'A podcast').locator('[data-testid=heard-edit]').click();
      expect(await p.locator('dialog.dialog .dialog__text').first().textContent()).toBe(C.editText);
      await dialogWith(p, null);
      await expect.poll(async () => (await p.locator('dialog.dialog .dialog__error').textContent())?.trim()).toBe(C.unchanged);
      await dialogWith(p, 'A radio show');
      await confirmed(p);
      await toast(p, C.saved);
      await expect.poll(() => labels(p)).toEqual([...PRESETS.slice(0, 7), 'A radio show', 'Other']);
      // Move up and down: at once.
      expect(await row(p, 'Instagram').locator('[data-testid=heard-up]').isDisabled()).toBe(true);
      expect(await row(p, 'A radio show').locator('[data-testid=heard-down]').isDisabled()).toBe(true);
      await row(p, 'A radio show').locator('[data-testid=heard-up]').click();
      await toast(p, C.orderSaved);
      await expect.poll(() => labels(p)).toEqual([...PRESETS.slice(0, 6), 'A radio show', 'An influencer', 'Other']);
      await row(p, 'Instagram').locator('[data-testid=heard-down]').click();
      await expect.poll(() => labels(p)).toEqual(['TikTok', 'Instagram', ...PRESETS.slice(2, 6), 'A radio show', 'An influencer', 'Other']);
      // Set aside, then offer again.
      await row(p, 'TikTok').locator('[data-testid=heard-toggle]').click();
      expect(await p.locator('dialog.dialog .dialog__text').first().textContent()).toBe(C.setAsideText);
      await dialogWith(p, null);
      await confirmed(p);
      await toast(p, C.setAsideDone);
      await expect.poll(() => row(p, 'TikTok').locator('.status__text').textContent()).toBe(C.setAside);
      await row(p, 'TikTok').locator('[data-testid=heard-toggle]').click();
      expect(await p.locator('dialog.dialog .dialog__text').first().textContent()).toBe(C.offerAgainText);
      await dialogWith(p, null);
      await confirmed(p);
      await toast(p, C.offeredAgain);
      await expect.poll(() => row(p, 'TikTok').locator('.status__text').textContent()).toBe(C.offered);
      // Up to 12 offered: three more, then Add says so.
      for (const label of ['A newsletter', 'A concierge', 'An event']) {
        await p.click('[data-testid=heard-add]');
        await dialogWith(p, label);
        await confirmed(p);
        await expect.poll(async () => (await labels(p)).includes(label)).toBe(true);
      }
      await p.click('[data-testid=heard-add]');
      await dialogWith(p, 'A billboard');
      await expect.poll(async () => (await p.locator('dialog.dialog .dialog__error').textContent())?.trim()).toBe(C.limit);
      await p.keyboard.press('Escape');
      await p.waitForSelector('dialog.dialog', { state: 'detached' });
      // Audited, by label (house words).
      const actions = await ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', 'heard_option.%').execute();
      expect(actions.map((a) => a.action).sort()).toEqual(
        ['heard_option.create', 'heard_option.create', 'heard_option.create', 'heard_option.create', 'heard_option.order', 'heard_option.order', 'heard_option.setup', 'heard_option.update', 'heard_option.update', 'heard_option.update'].sort(),
      );
      await shot(p, 'edited');
      await p.context().close();
    },
    STEP_TIMEOUT,
  );

  it(
    'shows an AUDITOR the page without one action',
    async () => {
      const p = await open(AUDITOR);
      await go(p, '#/sign-up', 'Sign-up');
      await expect.poll(async () => (await labels(p)).length).toBeGreaterThan(8);
      expect(await p.locator('#sign-up-heard').getByRole('button').count()).toBe(0);
      expect(await p.locator('[data-testid=heard-add]').count()).toBe(0);
      await p.context().close();
    },
    STEP_TIMEOUT,
  );
});
