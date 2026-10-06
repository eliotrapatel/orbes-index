/**
 * NOW (plan NOCTURNE, screen 1, step N3), on the NOCTURNE stage (test/support/nocturne-states.ts): /verify in place of
 * the landing. What leads, signed in and signed out — a LIVE RELEASE with the draw under it (C1, C10), a draw (C42), the
 * newest model (C43), nothing (YOUR PIECES, or the scan) — the sections under it in the canvas's order, every link going
 * where the canvas implies, the invitation answered YES or NO from its card (addition 6, by the post's own route, the
 * circle's visits left uncounted), and YOUR PIECES by their model's photographs, never a piece's own (decision 9).
 */
import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { NocturneDemo } from '../support/nocturne-demo.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, stateById, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

const READY = '.view--now[data-ready]';

/** A state of the stage, signed out (a visitor) or as `as`. */
const as = (id: string, newId: string, who: string | undefined): UiState => ({ ...stateById(id), id: newId, as: who });

/** The sections of NOW, in their order, by their accessible names. */
const sections = (page: Page) => page.locator('.view--now > section').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

/** What leads: the hero's label and title, or null without a hero. */
async function hero(page: Page): Promise<{ label: string; title: string } | null> {
  const h = page.locator('.view--now > section.now__hero');
  if ((await h.count()) === 0) return null;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return { label: norm(await h.locator('.n-lift > p').first().innerText()), title: norm((await h.locator('h1').textContent()) ?? '') };
}

/** Click `link` (a locator) on NOW, check the address it leads to (and the screen), then come back to NOW. */
async function follows(page: Page, click: () => Promise<void>, path: string | RegExp, screen?: string): Promise<void> {
  const at = () => new URL(page.url()).pathname;
  await click();
  if (typeof path === 'string') await expect.poll(at, { timeout: 10_000 }).toBe(path);
  else await expect.poll(at, { timeout: 10_000 }).toMatch(path);
  if (screen) await page.locator(screen).first().waitFor({ timeout: 10_000 });
  // Back to NOW by the rail, or back through the history where the screen has no rail (a LIVE RELEASE's page until N7;
  // a release's page lies on the list's entry, a sheet on the collection's).
  const rail = page.locator('.n-rail').getByRole('link', { name: 'NOW' });
  if (await rail.isVisible()) await rail.click();
  else
    for (let i = 0; i < 3 && at() !== '/verify'; i++) {
      const from = at();
      await page.evaluate(() => history.back());
      await expect.poll(at, { timeout: 10_000 }).not.toBe(from);
    }
  await expect.poll(at, { timeout: 10_000 }).toBe('/verify');
  await page.locator(READY).waitFor({ timeout: 10_000 });
}

/** SCAN ORBES CODE, then the scanner's CLOSE: NOW again, the focus on `target` (its title, or the scan without one). */
async function closesScanTo(page: Page, target: string): Promise<void> {
  await page.getByRole('button', { name: 'SCAN ORBES CODE' }).click();
  await page.locator('.view--scan').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'CLOSE' }).click();
  await page.locator(READY).waitFor({ timeout: 10_000 });
  await expect.poll(() => page.evaluate((sel) => document.activeElement === document.querySelector(`.view--now ${sel}`), target), { timeout: 10_000 }).toBe(true);
}

type Check = (page: Page, demo: NocturneDemo, stage: UiStage) => Promise<void>;

const CASES: { state: UiState; check: Check }[] = [
  // ── A LIVE RELEASE leads, the draw under it (C1, C10) ──
  {
    state: stateById('now-signed-in'),
    check: async (page, demo) => {
      expect(await hero(page)).toEqual({ label: 'LIVE RELEASE', title: 'MONOLITHE IN BLUE' });
      expect(await sections(page)).toEqual(['The next release', 'Also announced', 'Your pieces', 'The circle', 'The collection', 'Scan']);
      const top = page.locator('.now__hero');
      await expect.poll(() => top.locator('.n-cd').getAttribute('aria-label')).toMatch(/^OPENS IN 03 DAYS 02 HOURS 11 MINUTES$/);
      expect(await top.innerText()).toMatch(/THURSDAY 8 OCTOBER · 21:00 PARIS/);
      expect((await top.locator('.now__lines').innerText()).split('\n')).toEqual(['25 PIECES', 'ONE PER COLLECTOR', 'FOR OWNERS']);
      expect(await top.locator('.now__interest').innerText()).toBe('5 COLLECTORS WILL BE THERE');
      // The draw as a plate card: its state, title, model, price, pieces and closing time in UTC.
      const card = page.locator('section[aria-label="Also announced"] .n-card');
      expect((await card.innerText()).replace(/\s+/g, ' ')).toBe('DRAW · ENTRIES OPEN MONOLITHE, THE OCTOBER DRAW MONOLITHE · BRACELET € 4 200 12 PIECES · ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC SEE THE RELEASE');
      // YOUR PIECES: the two pieces by their model's photographs (decision 9), and the tier in one line.
      const pieces = page.locator('.now__piece');
      expect(await pieces.count()).toBe(2);
      expect(await pieces.locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('alt')))).toEqual([
        'The MONOLITHE BRACELET model in steel, photographed by ORBES',
        'The MONOLITHE BRACELET model in gold, photographed by ORBES',
      ]);
      expect(await pieces.locator('.now__piece-id').allInnerTexts()).toEqual([demo.pieces.yours, demo.pieces.gold]);
      const models = await page.evaluate(async () => {
        const r = await fetch('/api/v1/lookbook/monolithe');
        const s = (await r.json()) as { variants: { slug: string; coverUrl: string }[] };
        return Object.fromEntries(s.variants.map((v) => [v.slug, v.coverUrl]));
      });
      expect(await pieces.locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))).toEqual([models.monolithe, models['monolithe-gold']]);
      expect((await page.locator('.now__tier').innerText()).replace(/\s+/g, ' ')).toBe('TITANE 2 pieces held. 1 more piece registered to your account opens PLATINE, from 3 pieces held.');
      // THE CIRCLE: the invitation as a plate card, its answer pressed.
      const inv = page.locator('.now__invitation');
      expect(await inv.locator('h3').innerText()).toBe('AN EVENING AT THE ATELIER');
      expect(await inv.locator('.now__invitation-places').innerText()).toBe('3 LEFT OF 12');
      expect(await inv.getByRole('button', { name: 'YES' }).getAttribute('aria-pressed')).toBe('true');
      expect(await inv.getByRole('button', { name: 'NO' }).getAttribute('aria-pressed')).toBe('false');
      // THE COLLECTION: a model's photograph the hero does not show (here gold, the hero being blue).
      expect(await page.locator('section[aria-label="The collection"] img').getAttribute('alt')).toBe('The MONOLITHE BRACELET model in gold, photographed by ORBES');
      // Every link where the canvas implies.
      expect(await top.getByRole('link', { name: 'SEE THE RELEASE' }).getAttribute('href')).toBe(`/verify/releases/${demo.releases.blue}`);
      await follows(page, () => top.getByRole('link', { name: 'SEE THE RELEASE' }).click(), `/verify/releases/${demo.releases.blue}`, '.view--live, .view--release');
      await follows(page, () => card.getByRole('link', { name: 'SEE THE RELEASE' }).click(), `/verify/releases/${demo.releases.draw}`, '.view--release');
      await follows(page, () => page.locator('section[aria-label="Your pieces"]').getByRole('link', { name: 'MY PIECES' }).click(), '/verify/pieces', '.view--pieces');
      await follows(page, () => page.locator('.now__piece').first().click(), '/verify/pieces', '.view--pieces');
      await follows(page, () => page.locator('section[aria-label="The circle"]').getByRole('link', { name: 'THE CIRCLE' }).click(), '/verify/circle', '.view--circle');
      await follows(page, () => page.locator('.now__invitation').getByRole('link', { name: 'SEE THE INVITATION' }).click(), `/verify/circle/${demo.posts.invitation}`, '.view--circle-post');
      await follows(page, () => page.locator('section[aria-label="The collection"]').getByRole('link', { name: 'THE COLLECTION' }).click(), '/verify/lookbook', '.view--lookbook');
      // The scanner's CLOSE back to NOW: the focus comes to its title, not left on <body>.
      await closesScanTo(page, '#now-title');
    },
  },
  {
    state: stateById('now-signed-out'),
    check: async (page, demo) => {
      // The same top as signed in, then SCAN ORBES CODE, UPLOAD A PHOTO and MY PIECES, then THE COLLECTION.
      expect(await hero(page)).toEqual({ label: 'LIVE RELEASE', title: 'MONOLITHE IN BLUE' });
      expect(await sections(page)).toEqual(['The next release', 'Also announced', 'Scan', 'The collection']);
      const scan = page.locator('section[aria-label="Scan"]');
      expect(await scan.locator('button, a').allInnerTexts()).toEqual(['SCAN ORBES CODE', 'UPLOAD A PHOTO', 'MY PIECES']);
      await follows(page, () => scan.getByRole('link', { name: 'MY PIECES' }).click(), '/verify/pieces', '.view--pieces');
      expect(await page.locator('.now__piece, .now__invitation').count()).toBe(0);
      await follows(page, () => page.locator('.now__hero').getByRole('link', { name: 'SEE THE RELEASE' }).click(), `/verify/releases/${demo.releases.blue}`);
      // CIRCLE and PIECES of the rail lead to the sign-in.
      await follows(page, () => page.locator('.n-rail').getByRole('link', { name: 'CIRCLE' }).click(), '/verify/circle', '.view--circle');
      await follows(page, () => page.locator('.n-rail').getByRole('link', { name: 'PIECES' }).click(), '/verify/pieces', '.view--pieces');
    },
  },
  // ── A draw leads (C42) ──
  {
    state: stateById('now-draw-leads'),
    check: async (page, demo) => {
      expect(await hero(page)).toEqual({ label: 'DRAW · ENTRIES OPEN', title: 'MONOLITHE, THE OCTOBER DRAW' });
      expect(await sections(page)).toEqual(['The next release', 'Your pieces', 'The circle', 'The collection', 'Scan']);
      const top = page.locator('.now__hero');
      expect((await top.innerText()).replace(/\s+/g, ' ')).toContain('MONOLITHE · BRACELET € 4 200 12 PIECES · ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC 11 OCT 2026 · 20:00 on this phone (UTC+02:00) SEE THE RELEASE');
      // The draw's model photograph (steel): the collection's then shows another of its models.
      expect(await top.locator('img').getAttribute('alt')).toBe('The model of MONOLITHE, THE OCTOBER DRAW, photographed by ORBES');
      expect(await page.locator('section[aria-label="The collection"] img').getAttribute('alt')).toBe('The MONOLITHE BRACELET model in gold, photographed by ORBES');
      await follows(page, () => top.getByRole('link', { name: 'SEE THE RELEASE' }).click(), `/verify/releases/${demo.releases.draw}`, '.view--release');
    },
  },
  {
    state: as('now-draw-leads', 'now-draw-leads-signed-out', undefined),
    check: async (page) => {
      expect(await hero(page)).toEqual({ label: 'DRAW · ENTRIES OPEN', title: 'MONOLITHE, THE OCTOBER DRAW' });
      expect(await sections(page)).toEqual(['The next release', 'Scan', 'The collection']);
    },
  },
  {
    state: stateById('now-draw-soon'),
    check: async (page) => {
      expect(await hero(page)).toEqual({ label: 'DRAW · ENTRIES OPEN SOON', title: 'MONOLITHE, THE OCTOBER DRAW' });
      expect((await page.locator('.now__line').innerText()).replace(/\s+/g, ' ')).toBe('12 PIECES · ENTRIES OPEN 7 OCT 2026 · 10:00 UTC');
    },
  },
  {
    state: stateById('now-draw-early'),
    check: async (page) => {
      expect(await hero(page)).toEqual({ label: 'DRAW · EARLY ACCESS', title: 'MONOLITHE, THE OCTOBER DRAW' });
    },
  },
  // ── The newest model leads (C43) ──
  {
    state: stateById('now-collection-leads'),
    check: async (page) => {
      expect(await hero(page)).toEqual({ label: 'THE COLLECTION · ORBITAL', title: 'MONOLITHE' });
      expect(await sections(page)).toEqual(['The collection', 'Your pieces', 'The circle', 'Scan']);
      const top = page.locator('.now__hero');
      expect(await top.locator('.now__sizes').innerText()).toBe('SIZES 16 · 17 · 18');
      expect(await top.getByRole('group', { name: 'Its variants' }).getByRole('button').allInnerTexts()).toEqual(['Steel', 'Gold', 'Blue']);
      expect(await top.getByRole('button', { name: 'Steel' }).getAttribute('aria-pressed')).toBe('true');
      expect(await top.locator('.now__owned').innerText()).toBe('You own two: steel and gold');
      expect(await top.locator('img').getAttribute('alt')).toBe('The MONOLITHE BRACELET model in steel, photographed by ORBES');
      expect(await top.getByRole('link', { name: 'SEE THE MODEL' }).getAttribute('href')).toBe('/verify/lookbook/monolithe');
      // A dot shows its variant, and SEE THE MODEL opens it.
      await top.getByRole('button', { name: 'Blue' }).click();
      expect(await top.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true');
      expect(await top.locator('img').getAttribute('alt')).toBe('The MONOLITHE BRACELET model in blue, photographed by ORBES');
      await follows(page, () => top.getByRole('link', { name: 'SEE THE MODEL' }).click(), '/verify/lookbook/monolithe-blue', '.view--sheet');
      // No RELEASES dot: nothing is announced.
      expect(await page.locator('.n-rail__live').isHidden()).toBe(true);
    },
  },
  {
    state: stateById('now-collection-leads-signed-out'),
    check: async (page) => {
      expect(await hero(page)).toEqual({ label: 'THE COLLECTION · ORBITAL', title: 'MONOLITHE' });
      expect(await sections(page)).toEqual(['The collection', 'Scan']);
      expect(await page.locator('.now__owned').count()).toBe(0);
      expect(await page.locator('section[aria-label="Scan"]').getByRole('link', { name: 'MY PIECES' }).count()).toBe(1);
    },
  },
  // ── Nothing announced, no model shown: YOUR PIECES, or the scan ──
  {
    state: stateById('now-empty'),
    check: async (page) => {
      expect(await hero(page)).toBeNull();
      expect(await sections(page)).toEqual(['Your pieces', 'Scan']);
      expect(await page.locator('.now__empty').innerText()).toMatch(/^No piece is registered to your ORBES account yet\./);
      expect(await page.locator('main.view--now').getAttribute('aria-label')).toBe('NOW');
    },
  },
  {
    state: as('now-empty', 'now-empty-owner', 'owner'),
    check: async (page) => {
      // An owner of a model kept out of the collection, before an empty circle: its piece, no circle section.
      expect(await hero(page)).toBeNull();
      expect(await sections(page)).toEqual(['Your pieces', 'Scan']);
      expect(await page.locator('.now__piece').count()).toBe(1);
    },
  },
  {
    state: as('now-empty', 'now-empty-signed-out', undefined),
    check: async (page) => {
      expect(await hero(page)).toBeNull();
      expect(await sections(page)).toEqual(['Scan']);
      // Without a title, the focus comes back to SCAN ORBES CODE, as on the landing NOW replaces.
      await closesScanTo(page, '.landing__scan');
    },
  },
  // ── A LIVE RELEASE in its room, then live: it leads, its state said ──
  {
    state: stateById('now-room-open'),
    check: async (page) => {
      expect((await hero(page))?.label).toBe('LIVE RELEASE · THE ROOM IS OPEN');
      expect(await page.locator('.now__hero .n-cd').count()).toBe(1);
      // The banner is MY PIECES' (C3): on NOW, the release leads the page itself.
      expect(await page.locator('.live-banner-host').isHidden()).toBe(true);
    },
  },
  {
    state: stateById('now-live'),
    check: async (page) => {
      expect((await hero(page))?.label).toBe('LIVE RELEASE · LIVE NOW');
      expect(await page.locator('.now__hero .n-cd').count()).toBe(0);
    },
  },
];

/** The invitation answered from NOW (addition 6): NO gives the place back, YES takes it again; no visit counted. */
const ANSWER: { state: UiState; check: Check } = {
  state: { ...as('now-signed-in', 'now-answer', 'you'), mutates: true },
  check: async (page, _demo, stage) => {
    const visits = async () => Number((await stage.db.selectFrom('circle_daily_visits').select((eb) => eb.fn.sum<number>('visits').as('n')).executeTakeFirst())?.n ?? 0);
    const before = await visits();
    const inv = page.locator('.now__invitation');
    await inv.getByRole('button', { name: 'NO' }).click();
    await expect.poll(() => page.locator('.now__invitation').getByRole('button', { name: 'NO' }).getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.now__invitation').getByRole('button', { name: 'YES' }).getAttribute('aria-pressed')).toBe('false');
    expect(await page.locator('.now__invitation-places').innerText()).toBe('4 LEFT OF 12');
    await page.locator('.now__invitation').getByRole('button', { name: 'YES' }).click();
    await expect.poll(() => page.locator('.now__invitation').getByRole('button', { name: 'YES' }).getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('.now__invitation-places').innerText()).toBe('3 LEFT OF 12');
    // NOW's read of the feed is no visit to the circle.
    await page.reload();
    await page.locator(READY).waitFor();
    expect(await visits()).toBe(before);
  },
};

/**
 * YES held back when every place is taken, and refused (409 CIRCLE_FULL) when the last one went between the read and the
 * click: the message said (role=alert), the card read again from the feed.
 */
const FULL: { state: UiState; check: Check } = {
  state: { ...as('now-signed-in', 'now-answer-full', 'you'), mutates: true },
  check: async (page, demo, stage) => {
    const post = demo.posts.invitation!;
    const rsvp = (who: string, answer: 'YES' | 'NO') => {
      const a = demo.accounts[who]!;
      return stage.ctx.services.circle.rsvp(a.id, post, answer, a.actor);
    };
    const inv = page.locator('.now__invitation');
    const reread = async () => {
      await page.reload();
      await page.locator(READY).waitFor({ timeout: 30_000 });
    };
    // You give your place back; four other owners take the four left: NONE LEFT OF 12, YES held back, NO still yours.
    await rsvp('you', 'NO');
    for (const who of ['guest', 'absent', 'platine', 'voter1']) await rsvp(who, 'YES');
    await reread();
    expect(await inv.locator('.now__invitation-places').innerText()).toBe('NONE LEFT OF 12');
    expect(await inv.getByRole('button', { name: 'YES' }).isDisabled()).toBe(true);
    expect(await inv.getByRole('button', { name: 'NO' }).isEnabled()).toBe(true);
    expect(await inv.getByRole('button', { name: 'NO' }).getAttribute('aria-pressed')).toBe('true');
    // One place given back, read; then taken again before the click: the answer is refused, the card read again.
    await rsvp('voter1', 'NO');
    await reread();
    expect(await inv.locator('.now__invitation-places').innerText()).toBe('1 LEFT OF 12');
    expect(await inv.getByRole('button', { name: 'YES' }).isEnabled()).toBe(true);
    await rsvp('voter2', 'YES');
    await inv.getByRole('button', { name: 'YES' }).click();
    const alert = inv.getByRole('alert');
    await alert.waitFor({ timeout: 10_000 });
    expect(await alert.innerText()).toBe('Every place of this invitation is taken.');
    expect(await inv.locator('.now__invitation-places').innerText()).toBe('NONE LEFT OF 12');
    expect(await inv.getByRole('button', { name: 'YES' }).isDisabled()).toBe(true);
    expect(await inv.getByRole('button', { name: 'YES' }).getAttribute('aria-pressed')).toBe('false');
    expect(await inv.getByRole('button', { name: 'NO' }).getAttribute('aria-pressed')).toBe('true');
  },
};

describe.skipIf(!HAS_CHROMIUM)('NOW: what leads, its sections and its links, signed in and signed out (Chromium)', () => {
  it(
    'leads with a LIVE RELEASE and its draw, a draw, the newest model or nothing, each section and link as the canvas sets it',
    async () => {
      const failures: string[] = [];
      const all = [...CASES, ANSWER, FULL];
      await eachState(
        all.map((c) => c.state),
        async (state, { stage, demo, browser }) => {
          const c = all.find((x) => x.state.id === state.id)!;
          const opened = await openState(browser, stage, demo, state);
          try {
            await opened.page.locator(READY).waitFor({ timeout: 30_000 });
            await c.check(opened.page, demo, stage);
          } catch (e) {
            failures.push(`${state.id}: ${(e as Error).message}`);
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(failures).toEqual([]);
    },
    10 * 60_000,
  );
});
