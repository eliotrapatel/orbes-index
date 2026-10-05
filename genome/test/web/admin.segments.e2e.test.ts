/**
 * The Segments page and the access rules in the console, end to end (plan LIVE RELEASE+, step S6): the production web
 * build of the console served by the real Fastify app (in-memory PGlite, bootstrap ADMIN, memory key provider) and
 * driven in Chromium (playwright-core) at 1440 × 900.
 *
 *  1. An OPERATOR builds a segment from the sidebar's Segments (Clients): a criterion chosen among the four groups, its
 *     value, the count of collectors read again as the rules change, a group within added and removed, a rule
 *     negated, the rules in words, a refusal said before anything is sent; created, listed with its count; its members'
 *     CSV in clear.
 *  2. A LIVE RELEASE's access: the segment, the releases taken part in, OR; the rules as the release page says them. Its
 *     surprise: on, its description (internal).
 *  3. A post of the circle for the segment. The segment's page lists what uses it; DELETE is not offered then.
 *  4. An AUDITOR reads the segment in words, its count, its CSV with the emails masked; nothing to change.
 * No CSP violation, no page error, no figure in the display face.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, holdPieces } from '../support/live.js';

const CHROMIUM = process.env.ORBES_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HAS_CHROMIUM = existsSync(CHROMIUM);
const ADMIN = { email: 'console@orbes.test', password: 'orbes console passphrase 2026' };
const OPERATOR = { email: 'segments.operator@orbes.test', password: 'segments operator passphrase 2026' };
const AUDITOR = { email: 'segments.auditor@orbes.test', password: 'segments auditor passphrase 2026' };
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const STEP_TIMEOUT = 180_000;
const HOUR = 3_600_000;
const POLL = { timeout: 15_000, interval: 100 };

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

describe.skipIf(!HAS_CHROMIUM)('the Segments page and the access rules in the console (E2E, Chromium)', () => {
  let workDir: string;
  let t: TestDb;
  let ctx: AppContext;
  let app: FastifyInstance;
  let origin: string;
  let browser: Browser;
  let admin: Actor;
  let modelId: string;
  let releaseId: string;
  let postId: string;
  let segmentId = '';
  const members = { in: '', out: '' };
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
  const text = async (p: Page, sel: string) => ((await p.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();

  async function go(p: Page, hash: string, heading: string): Promise<void> {
    await p.evaluate((h) => (location.hash = h), hash);
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe(heading);
  }

  async function confirmDialog(p: Page): Promise<void> {
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog.dialog', { state: 'detached', timeout: 15_000 });
  }

  const figuresInDisplayFace = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.checkVisibility() && /^"?Gravesend Sans/.test(getComputedStyle(el).fontFamily))
        .map((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim())
        .filter((x) => /[01]/.test(x)),
    );

  async function shot(p: Page, name: string): Promise<void> {
    mkdirSync(OUT_DIR, { recursive: true });
    await p.evaluate(async () => {
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      await document.fonts.ready;
    });
    await p.screenshot({ path: join(OUT_DIR, `admin-segments-${name}.png`), fullPage: true });
  }

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-admin-segments-e2e-'));
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production', apps: ['admin'] });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    t = await createTestDb();
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN });
    ctx = await createContext(config, { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
    modelId = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await ctx.services.auth.createAdmin({ ...OPERATOR, role: 'OPERATOR' }, SYSTEM_ACTOR);
    await ctx.services.auth.createAdmin({ ...AUDITOR, role: 'AUDITOR' }, SYSTEM_ACTOR);
    await ctx.db.updateTable('admin_users').set({ password_change_required: false }).execute();
    admin = { type: 'admin', id: (await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', ADMIN.email).executeTakeFirstOrThrow()).id };
    // Two collectors: one holds a piece in size 58, the other three in size 50 (PLATINE).
    const a = await createAccount(ctx.db);
    const b = await createAccount(ctx.db);
    members.in = a.email;
    members.out = b.email;
    await holdPieces(ctx.db, a.id, 1, modelId, { variant: '58' });
    await holdPieces(ctx.db, b.id, 3, modelId, { variant: '50' });
    // A LIVE RELEASE, a draft, and a post of the circle.
    const opensAt = new Date(Date.now() + 24 * HOUR);
    releaseId = (await ctx.services.liveConsole.create({ modelId, title: 'MONOLITHE — LIVE', opensAt, closesAt: new Date(opensAt.getTime() + HOUR), priceMinor: 480_000, sizes: [{ label: '52', stock: 3 }] }, admin)).id;
    postId = (await ctx.services.circle.create({ kind: 'NOTE', title: 'A word for the size 58', minTier: 1 }, admin)).id;

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
  });

  it('builds a segment: a criterion and its value, the live count, a group, a rule negated, the words; created, listed; its CSV', async () => {
    const p = await open(OPERATOR);
    const clients = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
    expect(await clients.evaluateAll((links) => links.map((x) => x.getAttribute('data-route')))).toContain('segments');
    await p.locator('.side__link', { hasText: 'Segments' }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Segments');
    expect(await text(p, '#segments-list')).toContain('No segment yet');
    await p.click('text=New segment');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('New segment');

    // The builder starts with one rule; nobody has taken part in 3 releases.
    const rule = p.locator('[data-testid=segment-rule]').first();
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('0 COLLECTORS');
    expect(await rule.locator('select[name=kind] optgroup').evaluateAll((g) => g.map((x) => x.getAttribute('label')))).toEqual([
      'Releases taken part in and pieces secured',
      'Tier, models and collections owned',
      'Sizes and country',
      'Interest, answers and last activity',
    ]);
    await rule.locator('select[name=kind]').selectOption('SIZE');
    await p.locator('[data-testid=segment-rule] input[name=items]').first().fill('58');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF size 58');
    // A group within: ANY of its rules; removed again.
    await p.click('[data-testid=segment-add-group]');
    await p.locator('[data-testid=segment-group]').waitFor();
    expect(await text(p, '[data-testid=segment-words]')).toMatch(/^ALL OF size 58 · \(ANY OF size \d+\)$/);
    await p.click('[data-testid=segment-remove-group]');
    expect(await p.locator('[data-testid=segment-group]').count()).toBe(0);
    // Negated: everyone but the one in size 58.
    await p.locator('[data-testid=segment-rule] select[name=not]').first().selectOption('not');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF not size 58');
    await p.locator('[data-testid=segment-rule] select[name=not]').first().selectOption('');
    // A refusal said first: no name; an empty value.
    await p.click('[data-testid=segment-save]');
    await expect.poll(() => text(p, '[data-testid=segment-problem]'), POLL).toBe('Give the segment a name.');
    await p.locator('[data-testid=segment-rule] input[name=items]').first().fill('');
    await expect.poll(() => text(p, '[data-testid=segment-problem]'), POLL).toBe('Size: choose at least one size.');
    expect(await text(p, '[data-testid=segment-count]')).toBe('—');
    await p.locator('[data-testid=segment-rule] input[name=items]').first().fill('58');
    await p.fill('input[name=name]', 'Size 58');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'builder');
    await p.click('[data-testid=segment-save]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Size 58');
    segmentId = p.url().split('/segments/')[1]!.split('?')[0]!;
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=segment-csv]')]);
    expect(download.suggestedFilename()).toBe('orbes-segment-size-58.csv');
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).toContain(`"${members.in}"`);
    expect(csv).not.toContain(members.out);

    await go(p, '#/segments', 'Segments');
    expect(await text(p, '[data-testid=segment-row-count]')).toBe('1 COLLECTOR');
    expect(await text(p, '#segments-list')).toContain('ALL OF size 58');
    await shot(p, 'list');
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('chooses the segment in a release’s access with the releases taken part in, OR; sets its surprise; a post for the segment', async () => {
    const p = await open(OPERATOR);
    await go(p, `#/club/live/${releaseId}`, 'MONOLITHE — LIVE');
    await p.click('[data-testid=live-edit-access]');
    await p.selectOption('dialog [name=segmentId]', { label: 'Size 58' });
    await p.fill('dialog [name=minParticipations]', '2');
    await p.selectOption('dialog [name=combine]', 'OR');
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=live-access]'), POLL).toBe('collectors who have taken part in 2 releases or selected collectors');
    expect(await text(p, '[data-testid=live-access-segment]')).toBe('Size 58');
    expect(await text(p, '[data-testid=live-access-combine]')).toBe('Any one rule is enough (OR)');
    await p.click('[data-testid=live-edit-surprise]');
    await p.locator('dialog [name=enabled]').check({ force: true });
    // Without its description, the dialog says so before anything is sent.
    await p.click('[data-testid=dialog-confirm]');
    await expect.poll(() => text(p, 'dialog'), POLL).toContain('Say what goes in the box');
    await p.fill('dialog [name=text]', 'A silk pouch, hand-stitched.');
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=live-surprise]'), POLL).toBe('In every box · A silk pouch, hand-stitched.');
    await shot(p, 'release-access');

    await go(p, `#/club/circle/${postId}`, 'A word for the size 58');
    await p.click('[data-testid=circle-edit]');
    await p.selectOption('dialog [name=segmentId]', { label: 'Size 58' });
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=circle-audience]'), POLL).toBe('TITANE and up · segment Size 58');

    await go(p, `#/segments/${segmentId}`, 'Size 58');
    // Its count as saved, at once.
    expect(await text(p, '[data-testid=segment-count]')).toBe('1 COLLECTOR');
    const used = await text(p, '#segment-used');
    expect(used).toContain('MONOLITHE — LIVE');
    expect(used).toContain('A word for the size 58');
    expect(await p.locator('[data-testid=segment-delete]').isDisabled()).toBe(true);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'used');
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('an AUDITOR reads the segment in words and its count; its CSV masked; nothing to change', async () => {
    const p = await open(AUDITOR);
    await go(p, '#/segments', 'Segments');
    expect(await p.locator('text=New segment').count()).toBe(0);
    await go(p, `#/segments/${segmentId}`, 'Size 58');
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF size 58');
    expect(await text(p, '[data-testid=segment-count]')).toBe('1 COLLECTOR');
    expect(await p.locator('[data-testid=segment-save]').count()).toBe(0);
    expect(await p.locator('[data-testid=segment-delete]').count()).toBe(0);
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=segment-csv]')]);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).not.toContain(members.in);
    expect(csv).toContain(`"${members.in[0]}***@${members.in.split('@')[1]}"`);
    await shot(p, 'auditor');
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);
});
