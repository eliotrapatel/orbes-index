/**
 * End-to-end: the access rules beyond the tier and the surprise (plan LIVE RELEASE+, choices 3, 4, 27 and decision 32),
 * served by the real server with the live engine ticking (in-memory database, the real clock), driven in Chromium at a
 * phone's size.
 *
 *  - Announced: FOR COLLECTORS WHO HAVE TAKEN PART IN 2 RELEASES among the facts, its figure in the reading face; the
 *    vault label A SURPRISE IN EVERY BOX, never what it is; a collector who has taken part in two says I'LL BE THERE,
 *    one who has taken part in one reads the rule and how many releases they have taken part in.
 *  - In the room: FOR SELECTED COLLECTORS, never the segment's name; a member enters the room, the label under the
 *    offer; a collector outside the segment reads the not-eligible page: « This release is for selected collectors. »
 *
 * On every vault screen: the text's contrast computed from the page's own colours, at most one primary action, no
 * figure in the display face, the floors of BRAND-DESIGN-SYSTEM §3.8 (vault-checks.ts). Skipped when Chromium is absent.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLiveEngine } from '../../src/server/context.js';
import type { LiveEngine } from '../../src/server/services/live-engine.js';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { createManualClock } from '../../src/server/types.js';
import { LIVE } from '../../src/web/verify/copy.js';
import { createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture, type LiveReleaseOptions } from '../support/live.js';
import { keepsVault } from '../support/vault-checks.js';
import { CHROMIUM_PATH, launchChromium, mobileContext, startVerifyServer, type VerifyServer } from './verify.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const POLL = { timeout: 20_000, interval: 100 };
const PASSWORD = 'correct horse battery staple';
const MINUTE = 60_000;
const HOUR = 3_600_000;

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
async function textOf(loc: Locator, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(async () => norm(await loc.innerText()), POLL).toBe(expected);
  else await expect.poll(async () => norm(await loc.innerText()), POLL).toMatch(expected);
}

describe.skipIf(!HAS_CHROMIUM)('the access rules beyond the tier, and the surprise (Chromium)', () => {
  let srv: VerifyServer;
  let browser: Browser;
  let engine: LiveEngine;
  let f: LiveFixture;
  let n = 0;

  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    srv = await startVerifyServer();
    f = await liveFixtureOn(srv.ctx, createManualClock(new Date()));
    engine = startLiveEngine(srv.ctx, { connection: 'shared' });
    browser = await launchChromium();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await engine?.stop();
    await srv?.close();
  });

  async function account(pieces = 0, variant: string | null = null) {
    const email = `live.access.${++n}@example.com`;
    const { account: a, session } = await srv.ctx.services.auth.registerAccount({ email, password: PASSWORD }, {});
    if (pieces > 0) await holdPieces(srv.ctx.db, a.id, pieces, f.modelId, { variant });
    return { id: a.id, email, token: session.token };
  }

  /** A LIVE RELEASE of yesterday, closed, where each account of `who` had a place in the line: one release taken part in. */
  async function tookPart(who: { id: string }[]): Promise<void> {
    const r = await createLiveRelease(f, { opensAt: new Date(Date.now() + HOUR), sizes: [{ label: '52', stock: 5 }] });
    const opens = new Date(Date.now() - 26 * HOUR);
    const closes = new Date(opens.getTime() + HOUR);
    await srv.ctx.db
      .updateTable('drops')
      .set({ published_at: new Date(opens.getTime() - HOUR), opens_at: opens, closes_at: closes, ended_at: closes, ended_reason: 'CLOSED' })
      .where('id', '=', r.id)
      .execute();
    await srv.ctx.db
      .insertInto('live_entries')
      .values(
        who.map((a, i) => ({
          drop_id: r.id,
          account_id: a.id,
          size_id: r.sizes[0]!.id,
          quantity: 1,
          tier: 0,
          status: 'ENDED' as const,
          position: i + 1,
          joined_at: new Date(opens.getTime() - MINUTE),
          queued_at: opens,
          ended_at: closes,
        })),
      )
      .execute();
  }

  async function phone(token: string): Promise<{ page: Page; context: BrowserContext; problems: string[] }> {
    const context = await mobileContext(browser);
    await context.addCookies([{ name: sessionCookieName(srv.ctx.config, 'account'), value: token, url: srv.origin }]);
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`);
      if (/Content Security Policy/i.test(m.text())) problems.push(`csp: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    return { page, context, problems };
  }

  const release = async (o: Partial<LiveReleaseOptions> & { opensAt: Date }) => {
    const r = await createLiveRelease(f, { priceMinor: 505_000, sizes: [{ label: '52', stock: 3 }], ...o });
    await srv.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    return r;
  };

  it('announced: the rule of taking part in words, A SURPRISE IN EVERY BOX; I’LL BE THERE for who took part in two, the count for who took part in one', async () => {
    const regular = await account();
    const newcomer = await account();
    await tookPart([regular, newcomer]);
    await tookPart([regular]);
    const r = await release({ opensAt: new Date(Date.now() + HOUR), minParticipations: 2, surprise: 'A silk pouch, hand-stitched.' });

    const { page, context, problems } = await phone(regular.token);
    await page.goto(`${srv.origin}/verify/releases/${r.id}`);
    const facts = page.locator('.live__announced .live__facts .live__fact');
    await textOf(facts.first(), 'FOR COLLECTORS WHO HAVE TAKEN PART IN 2 RELEASES');
    // Its figure in the reading face.
    expect(await facts.first().locator('.numeral').evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/Gravesend/);
    const label = page.locator('.live__announced .live__surprise');
    await textOf(label, LIVE.surprise);
    expect(await label.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Gravesend Sans/);
    expect(await page.content()).not.toContain('silk');
    await page.locator('.live__there .live__size', { hasText: '52' }).waitFor({ state: 'visible', timeout: POLL.timeout });
    await keepsVault(page, 'I’LL BE THERE');
    await page.screenshot({ path: join(OUT_DIR, 'verify-live-access-announced.png'), fullPage: true });
    expect(problems).toEqual([]);
    await context.close();

    const out = await phone(newcomer.token);
    await out.page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(out.page.locator('.live__there-rule'), `This release is for collectors who have taken part in 2 releases. You have taken part in 1 release. ${LIVE.edge.notEligible.text}`);
    expect(await out.page.locator('.live__there .live__size').count()).toBe(0);
    await keepsVault(out.page, null);
    await out.page.screenshot({ path: join(OUT_DIR, 'verify-live-access-count.png'), fullPage: true });
    expect(out.problems).toEqual([]);
    await out.context.close();
  }, 90_000);

  it('in the room: FOR SELECTED COLLECTORS; a member in the room under the label; anyone else on the not-eligible page', async () => {
    const segment = await srv.ctx.services.segments.create({ name: 'Size 58 owners', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['58'] }] } }, f.admin);
    const member = await account(1, '58');
    const outsider = await account(5, '50');
    // T0 in three minutes: the room (five minutes before) is open.
    const r = await release({ opensAt: new Date(Date.now() + 3 * MINUTE), accessSegmentId: segment.id, surprise: 'A silk pouch, hand-stitched.' });

    const inside = await phone(member.token);
    await inside.page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(inside.page.locator('.live__room .live__surprise'), LIVE.surprise);
    await inside.page.locator('.live__room .live__size', { hasText: '52' }).waitFor({ state: 'visible', timeout: POLL.timeout });
    expect(await inside.page.content()).not.toContain('Size 58 owners');
    // The label under the offer, once the screen has come in.
    expect(await inside.page.locator('.live__room .live__surprise').evaluate((el) => el.previousElementSibling?.classList.contains('live__offer'))).toBe(true);
    await expect.poll(() => inside.page.locator('.live__screen').first().evaluate((el) => getComputedStyle(el).opacity), POLL).toBe('1');
    await inside.page.screenshot({ path: join(OUT_DIR, 'verify-live-access-room.png'), fullPage: true });
    expect(inside.problems).toEqual([]);
    await inside.context.close();

    const out = await phone(outsider.token);
    await out.page.goto(`${srv.origin}/verify/releases/${r.id}`);
    await textOf(out.page.locator('h1'), 'FOR SELECTED COLLECTORS');
    await textOf(out.page.locator('.live__edge .live__note').first(), `This release is for selected collectors. ${LIVE.edge.notEligible.text}`);
    expect(await out.page.content()).not.toContain('Size 58 owners');
    await keepsVault(out.page, null, ['THE RELEASES']);
    expect(await out.page.locator('.live__edge .btn:visible').count()).toBe(1);
    await out.page.screenshot({ path: join(OUT_DIR, 'verify-live-access-selected.png'), fullPage: true });
    expect(out.problems).toEqual([]);
    await out.context.close();
  }, 90_000);
});
