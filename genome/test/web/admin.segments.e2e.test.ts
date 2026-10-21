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
 *  5. The customer intelligence lot's criteria (plan CUSTOMER INTELLIGENCE §3.6 C.5.1, step 8.7): the five new groups
 *     after the four; the engagement score's From and To with its notice, refused first when From is above To; a city
 *     and a tag typed; the model picker's hint; a device's checkboxes, negated; the words, the count; saved, then listed
 *     in a LIVE RELEASE's Segment select like any other (question 15).
 *  6. The Founding list (plan MACRO M1 §3.2, F3 and F4): from the sidebar's Clients, its KPIs and people (one matched to
 *     an account), a filter; MAKE THE SEGMENT in one click, then its link, the segment's members; the CSV in clear; a
 *     draw opened to the segment in its Edit dialog (Access) and listed under the segment's Used by; an AUDITOR reads
 *     the emails masked with nothing to change; an ADMIN removes a person with the phrase.
 *  7. The Emails page and the founding announcement (plan MACRO M1 §4.3, E0, E1, F6), the channel on (an SMTP server no
 *     test reaches: the sender's timers are off, nothing is sent): from the Settings page; an OPERATOR writes a kind's
 *     words, the preview drawn again as written (its HTML in a shadow root, DARK and LIGHT), a placeholder placed, one
 *     this email does not fill named, the page held while unsaved, then saved; an ADMIN switches a kind on (asked first),
 *     sends a test to themself and opens it in the outbox; on the Founding list, the panel previews a release's
 *     announcement, sends it at the opening with the phrase, then cancels it; an AUDITOR reads, masked, nothing to do.
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
import { giveSizes } from '../support/draws.js';
import { createAccount, holdPieces } from '../support/live.js';
import { seedScore } from '../support/scores.js';

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
  const members = { in: '', out: '', inId: '', outId: '' };
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
    // The emails' channel on (step 7): an SMTP server no test reaches; with ORBES_ENV=test the sender never starts.
    const config = testConfig({ publicOrigin: origin, host: '127.0.0.1', port, bootstrapAdmin: ADMIN, email: { transport: 'smtp', from: { address: 'hello@theorbes.com', name: 'ORBES' }, replyTo: null, smtp: { host: 'smtp.invalid', port: 465, security: 'tls', user: 'u', password: 'p' } } });
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
    // Two collectors: one holds a piece in size 58, the other five in size 50 (PLATINE).
    const a = await createAccount(ctx.db);
    const b = await createAccount(ctx.db);
    members.in = a.email;
    members.out = b.email;
    members.inId = a.id;
    members.outId = b.id;
    await holdPieces(ctx.db, a.id, 1, modelId, { variant: '58' });
    await holdPieces(ctx.db, b.id, 5, modelId, { variant: '50' });
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
      'City, age, how they heard and tags',
      'Wishlist and favourite pieces and finishes',
      'What they look at, devices and places',
      'Where they come from',
      'Engagement score',
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

  it('builds a segment with the customer intelligence criteria: the score with its notice, a city, a tag, a device negated; listed in a release’s Segment select', async () => {
    // The first collector: Lyon, born 15 June 1990, tagged VIP, scored 74 by the latest run; the second scored 40.
    const now = new Date();
    await ctx.db.insertInto('account_profiles').values({ account_id: members.inId, city: 'Lyon', birth_date: '1990-06-15', birth_date_by: 'COLLECTOR', birth_date_at: now }).execute();
    await ctx.db.insertInto('account_tags').values({ account_id: members.inId, tag: 'VIP' }).execute();
    await seedScore(ctx.db, members.inId, 74, now);
    await seedScore(ctx.db, members.outId, 40, now);

    const p = await open(OPERATOR);
    await go(p, '#/segments/new', 'New segment');
    const rules = p.locator('[data-testid=segment-root] > [data-testid=segment-rule]');
    const notice = p.locator('[data-testid=segment-score-notice]');
    expect(await notice.isVisible()).toBe(false);
    // The engagement score: From 60 To 100, and the notice while a rule reads it.
    await rules.nth(0).locator('select[name=kind]').selectOption('SCORE');
    expect([await rules.nth(0).locator('input[name=min]').inputValue(), await rules.nth(0).locator('input[name=max]').inputValue()]).toEqual(['60', '100']);
    expect(await rules.nth(0).locator('input[name=min]').getAttribute('inputmode')).toBe('numeric');
    expect(await rules.nth(0).locator('input[name=max]').getAttribute('maxlength')).toBe('3');
    await expect.poll(() => notice.isVisible(), POLL).toBe(true);
    expect(await text(p, '[data-testid=segment-score-notice]')).toBe('Scores are calculated each morning. Accounts created since then have none yet.');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF engagement score 60 to 100');
    // From above To: said before anything is sent.
    await rules.nth(0).locator('input[name=min]').fill('80');
    await rules.nth(0).locator('input[name=max]').fill('70');
    await expect.poll(() => text(p, '[data-testid=segment-problem]'), POLL).toBe('Engagement score: two whole numbers from 0 to 100, the first not above the second.');
    await rules.nth(0).locator('input[name=max]').fill('100');
    await rules.nth(0).locator('input[name=min]').fill('60');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');

    // A city and a tag, typed: kept folded and in capitals.
    await p.click('[data-testid=segment-add-rule]');
    await rules.nth(1).locator('select[name=kind]').selectOption('CITY');
    expect(await rules.nth(1).locator('input[name=items]').inputValue()).toBe('Lyon');
    await rules.nth(1).locator('input[name=items]').fill('LYON, Saint-Étienne');
    await p.click('[data-testid=segment-add-rule]');
    await rules.nth(2).locator('select[name=kind]').selectOption('TAGGED');
    await rules.nth(2).locator('input[name=items]').fill('vip');
    await expect.poll(() => text(p, '[data-testid=segment-words]'), POLL).toBe('ALL OF engagement score 60 to 100 · city Lyon or saint-etienne · tagged VIP');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');

    // A model wished for: the picker's hint. Then a device, negated: nobody here was recorded on a phone.
    await p.click('[data-testid=segment-add-rule]');
    await rules.nth(3).locator('select[name=kind]').selectOption('WISHES_MODEL');
    expect(await text(p, '[data-testid=segment-model-hint]')).toBe('A main model includes its variants. Tick a variant alone to target only it.');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('0 COLLECTORS');
    await rules.nth(3).locator('select[name=kind]').selectOption('DEVICE');
    expect(await rules.nth(3).locator('[role=group]').evaluateAll((g) => g.map((x) => x.getAttribute('aria-label')))).toEqual(['Device', 'System', 'Opened', 'App']);
    expect(await rules.nth(3).locator('input[name=Device-PHONE]').isChecked()).toBe(true);
    await rules.nth(3).locator('label.ccheck', { hasText: 'Inside an app' }).click();
    await rules.nth(3).locator('select[name=not]').selectOption('not');
    await expect.poll(() => text(p, '[data-testid=segment-words]'), POLL).toBe('ALL OF engagement score 60 to 100 · city Lyon or saint-etienne · tagged VIP · not used a phone, inside an app, in the last 90 days');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    // Every box unticked: the problem, the count withheld.
    await rules.nth(3).locator('label.ccheck', { hasText: 'Inside an app' }).click();
    await rules.nth(3).locator('label.ccheck', { hasText: /^Phone$/ }).click();
    await expect.poll(() => text(p, '[data-testid=segment-problem]'), POLL).toBe('Device: tick at least one.');
    expect(await text(p, '[data-testid=segment-count]')).toBe('—');
    await rules.nth(3).locator('label.ccheck', { hasText: /^Phone$/ }).click();
    await p.fill('input[name=name]', 'Engaged in Lyon');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'intelligence-builder');
    await p.click('[data-testid=segment-save]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Engaged in Lyon');
    // Read again from the server: the same rules, the notice still said.
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF engagement score 60 to 100 · city Lyon or saint-etienne · tagged VIP · not used a phone, in the last 90 days');
    expect(await notice.isVisible()).toBe(true);

    // Question 15: the release's Segment select lists it like any other.
    await go(p, `#/club/live/${releaseId}`, 'MONOLITHE — LIVE');
    await p.click('[data-testid=live-edit-access]');
    expect(await p.locator('dialog [name=segmentId] option').allTextContents()).toEqual(['None', 'Engaged in Lyon', 'Size 58']);
    await p.click('[data-testid=dialog-cancel]');
    expect(await csp(p)).toEqual([]);
    expect(problems).toEqual([]);
    await p.context().close();
  }, STEP_TIMEOUT);

  it('reads the Founding list, makes its segment in one click, opens a draw to it; an AUDITOR reads masked; an ADMIN removes on request', async () => {
    // Two people from theorbes.com: the first collector's email (matched at once), and someone without an account.
    const stranger = `founding.${Date.now()}@example.com`;
    await ctx.services.founding.register({ email: members.in, firstName: 'Ada', country: 'FR', consent: true }, SYSTEM_ACTOR);
    await ctx.services.founding.register({ email: stranger, firstName: 'Grace', country: 'GB', consent: true, referrer: 'https://www.vogue.fr/article' }, SYSTEM_ACTOR);
    // A draft draw of a model in sizes.
    const halo = (
      await ctx.db
        .insertInto('models')
        .values({ category_id: (await ctx.categories.getByCode('J'))!.index, name: 'HALO', type: 'RING', sku_prefix: 'HAL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await giveSizes(ctx.db, halo, ['52', '54']);
    const opensAt = new Date(Date.now() + 48 * HOUR);
    const draw = await ctx.services.drops.create({ modelId: halo, title: 'HALO — draw', sizes: [{ label: '52', pieces: 2 }], opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0, earlyAccessPlatineHours: 0 }, admin);

    const p = await open(OPERATOR);
    const clients = p.locator('.side__group', { hasText: 'Clients' }).locator('.side__link');
    expect(await clients.evaluateAll((links) => links.map((x) => x.getAttribute('data-route')))).toEqual(expect.arrayContaining(['links', 'founding']));
    await p.locator('.side__link', { hasText: 'Founding list' }).click();
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Founding list');
    const kpis = await p.locator('[data-testid=founding-kpis] .kpi__value').allTextContents();
    expect(kpis.map((x) => x.trim())).toEqual(['2', '1', '0', '2']);
    expect(await p.locator('[data-testid=founding-email]').allTextContents()).toEqual([stranger, members.in]);
    expect(await text(p, '#founding-sources')).toContain('vogue.fr');
    expect(await p.locator('[data-testid=founding-account]').count()).toBe(1);
    expect(await p.locator('[data-testid=founding-remove]').count()).toBe(0);
    await p.selectOption('[data-testid=founding-filter-matched]', 'yes');
    await expect.poll(async () => p.locator('[data-testid=founding-email]').allTextContents(), POLL).toEqual([members.in]);
    expect(p.url()).toContain('matched=yes');
    // The segment: none yet, then one click.
    expect(await text(p, '[data-testid=founding-segment-none]')).toBe('None yet.');
    await p.click('[data-testid=founding-make-segment]');
    await expect.poll(() => text(p, '[data-testid=founding-segment]'), POLL).toBe('Founding list');
    expect(await p.locator('[data-testid=founding-make-segment]').count()).toBe(0);
    expect(await figuresInDisplayFace(p)).toEqual([]);
    await shot(p, 'founding');
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=founding-csv]')]);
    expect(download.suggestedFilename()).toMatch(/^orbes-founding-list-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv.split('\n')[0]).toContain('First Name');
    expect(csv).toContain(stranger);
    await p.click('[data-testid=founding-segment]');
    await expect.poll(async () => (await title(p).textContent())?.trim(), POLL).toBe('Founding list');
    expect(await text(p, '[data-testid=segment-words]')).toBe('ALL OF on the founding list');
    await expect.poll(() => text(p, '[data-testid=segment-count]'), POLL).toBe('1 COLLECTOR');
    const foundingSegment = p.url().split('/segments/')[1]!.split('?')[0]!;

    // A draw's Access, in its Edit dialog until the publication.
    await go(p, `#/club/drops/${draw.id}`, 'HALO — draw');
    expect(await text(p, '[data-testid=drop-access]')).toBe('Everyone');
    await p.click('[data-testid=drop-edit]');
    await p.click('[data-testid=dialog-confirm]');
    await p.waitForSelector('dialog [name=accessSegmentId]');
    expect(await p.locator('dialog [name=accessSegmentId] option').allTextContents()).toEqual(['Everyone', 'Segment Engaged in Lyon', 'Segment Founding list', 'Segment Size 58']);
    await p.selectOption('dialog [name=accessSegmentId]', { label: 'Segment Founding list' });
    await confirmDialog(p);
    await expect.poll(() => text(p, '[data-testid=drop-access]'), POLL).toBe('Segment Founding list');
    expect(await p.locator('[data-testid=drop-access]').getAttribute('href')).toBe(`#/segments/${foundingSegment}`);
    await shot(p, 'draw-access');
    await go(p, `#/segments/${foundingSegment}`, 'Founding list');
    expect(await p.locator('#segment-used a', { hasText: 'HALO — draw' }).getAttribute('href')).toBe(`#/club/drops/${draw.id}`);
    expect(await csp(p)).toEqual([]);
    await p.context().close();

    // An AUDITOR: the emails masked, no CSV, no Remove, the segment's link.
    const a = await open(AUDITOR);
    await go(a, '#/founding', 'Founding list');
    const masked = await a.locator('[data-testid=founding-email]').allTextContents();
    expect(masked).not.toContain(members.in);
    expect(masked).toContain(`${members.in[0]}***@${members.in.split('@')[1]}`);
    expect(await a.locator('[data-testid=founding-csv]').count()).toBe(0);
    expect(await a.locator('[data-testid=founding-remove]').count()).toBe(0);
    expect(await text(a, '[data-testid=founding-segment]')).toBe('Founding list');
    expect(await csp(a)).toEqual([]);
    await a.context().close();

    // An ADMIN removes the stranger on request, with the phrase.
    const r = await open(ADMIN);
    await go(r, '#/founding?matched=no', 'Founding list');
    await r.click('[data-testid=founding-remove]');
    const row = await ctx.db.selectFrom('preregistrations').select('id').where('account_id', 'is', null).executeTakeFirstOrThrow();
    await r.fill('dialog [name=__phrase]', `REMOVE ${row.id.slice(0, 8).toUpperCase()}`);
    await confirmDialog(r);
    await expect.poll(() => text(r, '#founding-people'), POLL).toContain('Nobody on the list matches these filters.');
    expect(await ctx.db.selectFrom('preregistrations').select('id').execute()).toHaveLength(1);
    expect(await csp(r)).toEqual([]);
    expect(problems).toEqual([]);
    await r.context().close();
  }, STEP_TIMEOUT);

  it('the Emails page: an OPERATOR writes a kind\'s words beside its preview, an ADMIN switches it on and tests it; the founding announcement sent at the opening, then cancelled; an AUDITOR reads', async () => {
    // A published draw for the founding announcement (the list holds the matched collector of the case before).
    const halo = (await ctx.db.selectFrom('models').select('id').where('name', '=', 'HALO').executeTakeFirstOrThrow()).id;
    const opensAt = new Date(Date.now() + 72 * HOUR);
    const draw = await ctx.services.drops.create({ modelId: halo, title: 'HALO — second draw', sizes: [{ label: '54', pieces: 1 }], opensAt, closesAt: new Date(opensAt.getTime() + 24 * HOUR), earlyAccessHours: 0, earlyAccessPlatineHours: 0 }, admin);
    await ctx.services.drops.publish(draw.id, admin);
    const shadowBackground = (p: Page, scope: string) =>
      p.locator(`${scope} [data-testid=email-frame]`).evaluate((host) => getComputedStyle(host.shadowRoot!.querySelector('[part=body]')!).backgroundColor);

    // An OPERATOR, from the Settings page.
    const o = await open(OPERATOR);
    await go(o, '#/settings', 'Settings');
    await o.click('a.cbtn:has-text("Emails")');
    await expect.poll(async () => (await title(o).textContent())?.trim(), POLL).toBe('Emails');
    expect(await text(o, '[data-testid=emails-channel]')).toBe('ON');
    expect(await o.locator('[data-testid=emails-kind]').count()).toBe(11);
    expect(await o.locator('[data-testid=emails-switch]').count()).toBe(0);
    await o.locator('[data-testid=emails-kind]', { hasText: 'Order shipped' }).click();
    await o.waitForSelector('#emails-editor [data-testid=email-frame]');
    expect(await text(o, '#emails-editor [data-testid=email-subject]')).toBe('Your order OR-7F3A21C9 is on its way');
    expect(await o.locator('#emails-editor [data-testid=email-frame]').evaluate((host) => host.shadowRoot!.textContent)).toContain('has left ORBES with Colissimo.');
    expect(await shadowBackground(o, '#emails-editor')).toBe('rgb(10, 10, 10)');
    await o.click('#emails-editor [data-testid=email-view-light]');
    await expect.poll(() => shadowBackground(o, '#emails-editor'), POLL).toBe('rgb(255, 255, 255)');
    await o.fill('[data-testid=emails-subject]', 'On its way: ');
    await o.click('[data-testid=emails-place-orderRef]');
    expect(await o.inputValue('[data-testid=emails-subject]')).toBe('On its way: {orderRef}');
    await o.locator('[data-testid=emails-body]').focus();
    await o.keyboard.press('End');
    await o.keyboard.type('\n\nWith {giftWrap}.');
    expect(await text(o, '[data-testid=emails-unknown]')).toBe('{giftWrap} is not filled by this email: it stays as written.');
    await expect.poll(() => text(o, '#emails-editor [data-testid=email-subject]'), POLL).toBe('On its way: OR-7F3A21C9');
    // Unsaved, the page is held: Stay keeps the words.
    await o.evaluate(() => (location.hash = '#/dashboard'));
    await o.waitForSelector('dialog.dialog');
    expect(await text(o, 'dialog .dialog__eyebrow')).toBe('Emails');
    await o.click('[data-testid=dialog-cancel]');
    expect(await o.inputValue('[data-testid=emails-subject]')).toBe('On its way: {orderRef}');
    await o.click('[data-testid=emails-save]');
    await expect.poll(() => text(o, '[data-testid=emails-words-state] >> nth=4'), POLL).toBe('Edited');
    expect((await ctx.services.email.kind('ORDER_SHIPPED')).words.subject).toBe('On its way: {orderRef}');
    expect(await figuresInDisplayFace(o)).toEqual([]);
    await shot(o, 'emails-editor');
    expect(await csp(o)).toEqual([]);
    await o.context().close();

    // An ADMIN: switches the founding announcement on (asked first), sends a test of Order shipped, opens it.
    const a = await open(ADMIN);
    await go(a, '#/settings/emails', 'Emails');
    await a.locator('tr', { hasText: 'Founding announcement' }).locator('[data-testid=emails-switch]').click();
    await a.waitForSelector('dialog.dialog');
    await confirmDialog(a);
    await expect.poll(() => a.locator('tr', { hasText: 'Founding announcement' }).locator('[data-testid=emails-switch-state]').textContent(), POLL).toContain('Sends at its moment.');
    await go(a, '#/settings/emails?kind=ORDER_SHIPPED', 'Emails');
    await a.waitForSelector('#emails-editor [data-testid=email-frame]');
    await a.click('[data-testid=emails-test]');
    await expect.poll(() => a.locator('[data-testid=emails-to]').allTextContents(), POLL).toContain(ADMIN.email);
    const test = await ctx.db.selectFrom('email_outbox').select(['kind', 'subject', 'status']).where('to_address', '=', ADMIN.email).execute();
    expect(test).toEqual([{ kind: 'ORDER_SHIPPED', subject: 'On its way: OR-7F3A21C9', status: 'QUEUED' }]);
    await a.locator('tr', { hasText: ADMIN.email }).locator('[data-testid=emails-open]').click();
    await a.waitForSelector('dialog [data-testid=email-frame]');
    expect(await a.locator('dialog [data-testid=email-frame]').evaluate((host) => host.shadowRoot!.textContent)).toContain('With {giftWrap}.');
    await shot(a, 'emails-opened');
    await confirmDialog(a);

    // The founding announcement: the release chosen, its preview, sent at the opening with the phrase, then cancelled.
    await go(a, '#/founding', 'Founding list');
    await a.waitForSelector('[data-testid=founding-announcement-preview] [data-testid=email-frame]');
    expect(await text(a, '[data-testid=founding-announcement-reach]')).toBe('1 person on the list');
    await a.selectOption('[data-testid=founding-announcement-release]', draw.id);
    await expect.poll(() => a.locator('[data-testid=founding-announcement-preview] [data-testid=email-frame]').evaluate((host) => host.shadowRoot!.textContent ?? ''), POLL).toContain('HALO — second draw opens');
    await a.click('[data-testid=founding-announcement-opening]');
    await a.fill('dialog [name=__phrase]', `SEND ${draw.id.slice(0, 8).toUpperCase()}`);
    await confirmDialog(a);
    await expect.poll(() => text(a, '[data-testid=founding-announcement-emails]'), POLL).toBe('1 queued');
    expect(await text(a, '[data-testid=founding-announcement-scheduled]')).toMatch(/Paris$/);
    const queued = await ctx.db.selectFrom('email_outbox').select(['not_before', 'status']).where('kind', '=', 'FOUNDING_ANNOUNCEMENT').execute();
    expect(queued).toEqual([{ not_before: opensAt, status: 'QUEUED' }]);
    await shot(a, 'founding-announcement');
    await a.click('[data-testid=founding-announcement-cancel]');
    await confirmDialog(a);
    await expect.poll(() => text(a, '[data-testid=founding-announcement-emails]'), POLL).toBe('1 cancelled');
    expect(await csp(a)).toEqual([]);
    await a.context().close();

    // An AUDITOR: reads, the addresses masked, nothing to change.
    const r = await open(AUDITOR);
    await go(r, '#/settings/emails?kind=ORDER_SHIPPED', 'Emails');
    await r.waitForSelector('#emails-editor [data-testid=email-frame]');
    expect(await r.locator('[data-testid=emails-switch], [data-testid=emails-save], [data-testid=emails-test]').count()).toBe(0);
    expect(await r.locator('[data-testid=emails-subject]').evaluate((x) => (x as HTMLInputElement).readOnly)).toBe(true);
    expect(await r.locator('[data-testid=emails-to]').allTextContents()).not.toContain(ADMIN.email);
    await go(r, '#/founding', 'Founding list');
    await r.waitForSelector('[data-testid=founding-announcement-preview] [data-testid=email-frame]');
    expect(await r.locator('[data-testid=founding-announcement-now]').count()).toBe(0);
    expect(await csp(r)).toEqual([]);
    expect(problems).toEqual([]);
    await r.context().close();
  }, STEP_TIMEOUT);
});
