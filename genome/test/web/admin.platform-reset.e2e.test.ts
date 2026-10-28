/**
 * The Platform reset page of the console, end to end (lot PURGE, step PURGE.12, plan §B.5; D2, D7, D12, D13, H2, H6,
 * B5.page, B5.dlg, B5.signin): the production web build of the console served by the real Fastify app (in-memory
 * PGlite, a bootstrap ADMIN, memory key provider), driven in Chromium (playwright-core) at 1440 × 900.
 *
 * One case, lean (the real reset runs in the service and API tests): the reset holder, signed in with his
 * authenticator code, finds the page from the Settings header and reads it (READY, the accounts neither test nor team
 * in bold, what stays, the signing key); RESET THE PLATFORM's dialog states the numbers after it for this year (the
 * server's, H2) and the account again, asks the current password, a code and the phrase; a wrong code is said inside
 * it, the code emptied, still signed in; LOCK RESET's dialog likewise (H6). The next code: 202, the restart notice over
 * the page; once every session has ended (as the reset ends them), the poll lands on the sign-in. Another ADMIN sees
 * no link, and the address answers the console's not-found state. The database's forbidden windows are answered open
 * (CI runs at any hour; the windows are proven in test/api/admin-platform-reset.test.ts). No CSP violation, no page
 * error, no figure in the display face.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { hashSecret } from '../../src/server/crypto/scrypt.js';
import { seal } from '../../src/server/crypto/secretbox.js';
import { base32Decode, generateTotpSecret, totp } from '../../src/server/crypto/totp.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { deriveTotpEncryptionKey } from '../../src/server/services/auth.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const STEP_TIMEOUT = 240_000;
/** expect.poll's budget (its default, 1 s, is too short on a shared CI runner). */
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

describe.skipIf(!HAS_CHROMIUM)('the Platform reset page in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  const problems: string[] = [];

  async function open(who: { email: string; password: string; code?: () => string }): Promise<Page> {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' });
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
    if (who.code) {
      await p.waitForSelector('input[name=totp]', { state: 'visible' });
      await p.fill('input[name=totp]', who.code());
      await p.click('[data-testid=login-submit]');
    }
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Dashboard');
    return p;
  }

  const title = (p: Page) => p.locator('h1.page-head__title');
  const csp = (p: Page) => p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  const text = async (p: Page, testId: string) => ((await p.locator(`[data-testid=${testId}]`).first().textContent()) ?? '').trim();

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  /** Visible text in Gravesend Sans holding a one or a zero (its one is its capital I): none should. */
  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-reset-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
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

  it('the holder reads the page from Settings; a wrong code is said inside RESET THE PLATFORM and LOCK RESET, still signed in; the next code: the restart notice, then the sign-in; another ADMIN sees no link', async () => {
    // The database's own windows answered open in this test database (as the API suite does).
    await sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`).execute(ctx.db);
    // The reset holder: an ADMIN whose second factor was enrolled long ago, recorded in the gate (as the migration does at the deploy).
    const id = randomUUID();
    const holder = { email: `holder.${id.slice(0, 8)}@example.com`, password: 'reset holder passphrase 2026' };
    const secret = generateTotpSecret();
    await ctx.db
      .insertInto('admin_users')
      .values({
        id,
        email: holder.email,
        email_normalized: holder.email,
        password_hash: await hashSecret(holder.password),
        role: 'ADMIN',
        password_change_required: false,
        totp_secret_enc: seal(deriveTotpEncryptionKey(ctx.config), JSON.stringify({ v: 1, s: secret, c: 0 }), `orbes/admin-totp/v1|${id}`),
      })
      .execute();
    await sql`UPDATE platform_reset_gate SET holder_admin_id = ${id}::uuid WHERE id = 1`.execute(ctx.db);
    const key = base32Decode(secret);
    // One collector who is neither test nor team: what the page counts in bold.
    await ctx.services.auth.registerAccount({ email: 'reset.collector@example.com', password: 'reset collector passphrase 2026' }, {});
    const year = new Date().getUTCFullYear();

    // Another ADMIN: no link in Settings, and the address answers the console's not-found state.
    const other = await open(ADMIN);
    await go(other, '#/settings', 'Settings');
    await other.waitForSelector('a.cbtn[href="#/settings/tests"]');
    expect(await other.locator('a.cbtn[href="#/settings/platform-reset"]').count()).toBe(0);
    await other.evaluate(() => (location.hash = '#/settings/platform-reset'));
    await expect.poll(async () => ((await other.locator('.failure__text').textContent()) ?? '').trim(), POLL).toBe('This page does not exist.');
    expect(await other.locator('[data-testid=reset-holder]').count()).toBe(0);
    // The page never names itself to them: the crumb and the tab's title are the not-found state's, no sidebar mark.
    expect((await other.locator('.topbar__crumb').textContent())?.trim()).toBe('Not found');
    expect(await other.evaluate(() => document.title)).toMatch(/^(\(\S+\) )?Not found — ORBES Genome Console$/);
    expect(await other.locator('.side__link.is-active').count()).toBe(0);
    await other.context().close();

    // The holder: the link from Settings, the page.
    const p = await open({ ...holder, code: () => totp(key, Date.now()) });
    await go(p, '#/settings', 'Settings');
    await p.click('a.cbtn[href="#/settings/platform-reset"]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Platform reset');
    expect(await text(p, 'reset-holder')).toBe(holder.email);
    expect(await p.locator('[data-testid=reset-state] .status__text').textContent()).toBe('READY');
    expect(await text(p, 'goes-accounts')).toMatch(/^\d+ accounts?: 1 neither test nor team, 0 test entrants\.$/);
    expect(await p.locator('[data-testid=goes-accounts] strong').textContent()).toBe('1 neither test nor team');
    expect(await p.locator('[data-testid=reset-sign-ups] li').count()).toBe(1);
    expect(await text(p, 'stays-founding')).toBe('0 addresses, no longer linked to an account.');
    expect(await text(p, 'stays-key')).toMatch(/^Key \d+ \(.+\), kept as it is\.$/);
    expect(await p.locator('[data-testid=reset-list-keys] tbody tr').count()).toBe(1);
    expect(await p.locator('[data-testid=reset-last]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);

    // RESET THE PLATFORM: the numbers after it for this year (the server's), the account again, the fields and the phrase.
    await p.click('[data-testid=reset-platform]');
    await p.waitForSelector('dialog.dialog--danger');
    const dialog = p.locator('dialog.dialog');
    expect(await text(p, 'reset-line')).toBe(
      `Everything above under What goes is deleted, in one step, and the platform restarts (about a minute, nobody can use it meanwhile). Piece serials restart at 00001 (O${String(year).slice(2)}-J-00001) and invoice numbers at INV-${year}-000001. The signing key stays.`,
    );
    expect(await text(p, 'reset-collectors')).toBe('1 account that is neither test nor team would go: check them before you confirm.');
    expect(await dialog.locator('input[name=password]').evaluate((el) => [el.getAttribute('type'), el.getAttribute('autocomplete')])).toEqual(['password', 'current-password']);
    const code = dialog.locator('input[name=totp]');
    expect(await code.evaluate((el) => [el.getAttribute('autocomplete'), el.getAttribute('inputmode'), el.getAttribute('placeholder'), el.classList.contains('mono')])).toEqual(['one-time-code', 'numeric', '000 000', true]);
    expect(await dialog.textContent()).toContain('Six digits from your authenticator app. Just signed in? Wait for the next code.');
    expect(await p.isDisabled('[data-testid=dialog-confirm]')).toBe(true);
    await p.fill('[data-testid=dialog-phrase]', 'RESET PLATFORM');
    await dialog.locator('input[name=password]').fill(holder.password);
    // A wrong code: said inside the dialog, which stays open; the code emptied; still signed in.
    const now = Date.now();
    const near = [-1, 0, 1, 2].map((d) => totp(key, now + d * 30_000));
    const wrong = ['000000', '111111', '222222', '333333', '444444'].filter((c) => !near.includes(c));
    await code.fill(wrong[0]!);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(async () => ((await dialog.locator('.dialog__error').textContent()) ?? '').trim(), POLL).toBe('The code is not valid. Check the time on your device and try again.');
    expect(await code.inputValue()).toBe('');
    expect(await p.inputValue('[data-testid=dialog-phrase]')).toBe('RESET PLATFORM');
    expect(await p.locator('[data-testid=login-form]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await p.click('[data-testid=dialog-cancel]');
    await p.waitForSelector('dialog.dialog', { state: 'detached' });

    // LOCK RESET: its words, the same fields, the phrase LOCK RESET; a wrong code said inside it, still signed in (H6).
    await p.click('[data-testid=reset-lock]');
    await p.waitForSelector('dialog.dialog--danger');
    expect(await text(p, 'lock-line')).toBe('After this, PLATFORM RESET is refused for good. Do it once the platform is launched.');
    expect(await dialog.locator('input[name=password]').getAttribute('autocomplete')).toBe('current-password');
    expect(await dialog.locator('input[name=totp]').getAttribute('autocomplete')).toBe('one-time-code');
    await p.fill('[data-testid=dialog-phrase]', 'LOCK RESET');
    await dialog.locator('input[name=password]').fill(holder.password);
    await dialog.locator('input[name=totp]').fill(wrong[1]!);
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(async () => ((await dialog.locator('.dialog__error').textContent()) ?? '').trim(), POLL).toBe('The code is not valid. Check the time on your device and try again.');
    expect(await dialog.locator('input[name=totp]').inputValue()).toBe('');
    expect(await p.locator('[data-testid=login-form]').count()).toBe(0);
    await p.click('[data-testid=dialog-cancel]');
    await p.waitForSelector('dialog.dialog', { state: 'detached' });
    expect((await ctx.db.selectFrom('platform_reset_gate').select('launched_at').executeTakeFirstOrThrow()).launched_at).toBeNull();

    // The next code: 202 (the test's lifecycle only logs: nothing restarts here), the notice over the whole page.
    await p.click('[data-testid=reset-platform]');
    await p.waitForSelector('dialog.dialog--danger');
    await p.fill('[data-testid=dialog-phrase]', 'RESET PLATFORM');
    await dialog.locator('input[name=password]').fill(holder.password);
    await dialog.locator('input[name=totp]').fill(totp(key, Date.now() + 30_000));
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('[data-testid=reset-restarting]');
    expect(await text(p, 'reset-restarting')).toContain('The platform is restarting.Sign in again in a minute.');
    const cover = await p.locator('[data-testid=reset-restarting]').boundingBox();
    expect(cover).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
    expect(await p.locator('[data-testid=login-form]').count()).toBe(0);
    // Every session ended, as the reset ends them: the next ask of the session lands on the sign-in.
    await ctx.db.deleteFrom('sessions').execute();
    await p.waitForSelector('[data-testid=login-form]', { timeout: 15_000 });
    expect(await p.locator('[data-testid=reset-restarting]').count()).toBe(0);
    expect(await csp(p)).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);
});
