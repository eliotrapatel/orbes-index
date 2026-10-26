/**
 * End-to-end: THE VAULT on a LIVE RELEASE's pages (lot Q3, step Q3.10; plan §3.2–§3.4, §3b; MK #sold, #release-end) in
 * the built app on the NOCTURNE stage `vault` (test/support/nocturne-demo.ts seedVault), driven in Chromium. Lean (the
 * content shards hold every state's words and the reduced-motion stills): its door held open in full motion on SOLD OUT
 * for your size on a phone and on a computer, and on the end page of a release sold out whole on a computer; then the
 * page dimmed to 16 % (LEAVE THE LINE, THE RELEASES) with OPEN ANOTHER at full strength under the reward and clear of the
 * line under it, the open lid's box at least 8 px below the sentence above it (MK's measured minimum, D69), and no error
 * of the page (a CSP report included). Under reduced motion in light mode: the reward at once, the page dimmed at once,
 * the room still dark. THE VAULT page (lot Q3, step Q3.11; plan §3.5, §3b; MK V): its second door opened in place, no OPEN
 * ANOTHER, the page never dimmed, PRESS AND HOLD gone from that door alone; then its first, the open lid's box at least
 * 8 px under YOUR VAULTS · N WAITING (D69), on a phone and a computer; the page never wider than the window, closed or
 * open (each door's floor clipped sideways), THE VAULT page, SOLD OUT for your size and the end page alike (a phone, 1024 ×
 * 768 and 1440 × 900), the end page's box on a phone as wide as SOLD OUT's. A credit to give opened signed out on a phone: MY PIECES' CREATE ACCOUNT,
 * then its page again with ACCEPT (plan §3.5, §3.10). Skipped (not failed) when the Chromium binary is absent.
 */
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { NOCTURNE_PASSWORD } from '../support/nocturne-demo.js';
import type { NocturneStage } from '../support/nocturne-stage.js';
import { settle, stateById, type UiState } from '../support/nocturne-states.js';
import { HAS_CHROMIUM, openIn, stages, type Look } from './desktop.harness.js';

const PHONE: Look = { name: 'phone', size: { width: 390, height: 844 }, light: false };
const DESK: Look = { name: '1440 × 900, dark', size: { width: 1440, height: 900 }, light: false };
const SMALL_DESK: Look = { name: '1024 × 768, dark', size: { width: 1024, height: 768 }, light: false };
const TIMEOUT = 240_000;

/** Hold the door with the space bar until the hold is full on the page's clock, then wait for the opening's end. */
async function openTheDoor(page: Page): Promise<void> {
  const front = page.locator('.live__vault-slot .vo-dopen__front');
  await front.waitFor({ state: 'attached' });
  await front.evaluate((e: HTMLElement) => {
    e.scrollIntoView({ block: 'center' });
    e.focus();
  });
  await page.keyboard.down(' ');
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.live__vault-slot .vlt')?.style.getPropertyValue('--p') === '1.0000', null, { timeout: 15_000 });
  await page.keyboard.up(' ');
  await page.waitForFunction(() => document.querySelector('.live__vault-slot .vlt')?.classList.contains('is-open'), null, { timeout: 15_000 });
}

/** What the opened page shows: the dim of `below` and OPEN ANOTHER's, their gap, the lid's clearance under `above`. */
async function measure(page: Page, below: string, above: string | null) {
  return page.evaluate(
    ({ below, above }) => {
      const strength = (e: Element | null) => {
        let o = 1;
        for (let x = e; x && x !== document.body; x = x.parentElement) o *= Number(getComputedStyle(x).opacity);
        return o;
      };
      const again = document.querySelector('.live__vault-slot .vlt__again')!;
      const next = document.querySelector(`.view--live ${below}`)!;
      const lid = document.querySelector('.live__vault-slot .vo-dopen__lid')!.getBoundingClientRect();
      const sentence = above ? [...document.querySelectorAll(`.view--live ${above}`)].find((e) => !e.closest('.vlt')) ?? null : null;
      return {
        dim: strength(next),
        // OPEN ANOTHER is the vault's own: nothing around it dims (its own rest, a text link's 0.8, aside).
        again: strength(again.parentElement),
        againShown: again.getClientRects().length > 0,
        gap: next.getBoundingClientRect().top - again.getBoundingClientRect().bottom,
        lidClear: sentence ? lid.top - sentence.getBoundingClientRect().bottom : null,
      };
    },
    { below, above },
  );
}

/** Hold the door `n` (1-based) of THE VAULT page until it has opened in place and its opening has ended. */
async function openPageDoor(page: Page, n: number): Promise<void> {
  const front = page.locator('.view--vault .vp-vault').nth(n - 1).locator('.vo-dopen__front');
  await front.evaluate((e: HTMLElement) => {
    e.scrollIntoView({ block: 'center' });
    e.focus();
  });
  await page.keyboard.down(' ');
  await page.waitForFunction((i) => document.querySelectorAll<HTMLElement>('.view--vault .vp-vault .vlt')[i]?.style.getPropertyValue('--p') === '1.0000', n - 1, { timeout: 15_000 });
  await page.keyboard.up(' ');
  await page.waitForFunction((i) => document.querySelectorAll('.view--vault .vp-vault .vlt')[i]?.classList.contains('is-open'), n - 1, { timeout: 15_000 });
  await page.waitForFunction((i) => !document.querySelectorAll('.view--vault .vp-vault .vlt')[i]?.classList.contains('is-playing'), n - 1, { timeout: 15_000 });
}

/** THE VAULT page once door `n` opened: its parts, the page's strength, the lid's clearance under the line above it. */
async function measurePage(page: Page, n: number, desk: boolean) {
  return page.evaluate(
    ({ i, desk }) => {
      const strength = (e: Element | null) => {
        let o = 1;
        for (let x = e; x && x !== document.body; x = x.parentElement) o *= Number(getComputedStyle(x).opacity);
        return o;
      };
      const shown = (e: Element | null) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
      const doors = [...document.querySelectorAll('.view--vault .vp-vault')];
      const door = doors[i]!;
      const lid = door.querySelector('.vo-dopen__lid')!.getBoundingClientRect();
      // The line above the lid: YOUR VAULTS · N WAITING for the first door (and each of a row on a computer), else the
      // previous door's WAITS UNTIL (D69).
      const above = i === 0 || desk ? document.querySelector('.view--vault .vp-sec--vaults > .vp-over')! : doors[i - 1]!.querySelector('.vp-until')!;
      return {
        open: door.querySelector('.vlt')!.classList.contains('is-open'),
        again: shown(door.querySelector('.vlt__again')),
        press: shown(door.querySelector('.vp-press')),
        from: door.querySelector('.vp-from')?.textContent ?? '',
        until: door.querySelector('.vp-until')?.textContent ?? '',
        others: doors.filter((_, j) => j !== i).map((d) => shown(d.querySelector('.vp-press'))),
        strength: [strength(document.querySelector('.view--vault .vp-sec--how')), strength(document.querySelector('.view--vault .vp-title')), ...doors.map((d) => strength(d))],
        lidClear: lid.top - above.getBoundingClientRect().bottom,
      };
    },
    { i: n - 1, desk },
  );
}

/** How much wider than its window the page is (0: it never scrolls sideways). */
async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

describe.skipIf(!HAS_CHROMIUM)('THE VAULT page (Chromium)', () => {
  const { withStage } = stages();

  it(
    'opens a door in place on THE VAULT page (phone, computer): no OPEN ANOTHER, the page never dimmed, PRESS AND HOLD gone from that door alone, its source line and WAITS UNTIL kept; the first door\'s lid at least 8 px under YOUR VAULTS · N WAITING; never wider than the window; a credit to give signed out on a phone comes back after CREATE ACCOUNT with ACCEPT',
    async () => {
      await withStage('vault', async (st) => {
        const base = stateById('vault-page');
        for (const [look, as] of [
          [PHONE, 'vaultPageOpen'],
          [DESK, 'vaultPageOpenDesk'],
        ] as const) {
          const desk = look === DESK;
          const opened = await openIn(st, { ...base, as, check: undefined }, look);
          try {
            const page = opened.page;
            // Each door's floor reaches wider than the window: the page is clipped sideways, closed and open.
            expect(await sideways(page), `${look.name}: the page wider than the window, closed`).toBe(0);
            // The second door first: in place, nothing else changes.
            await openPageDoor(page, 2);
            expect(await sideways(page), `${look.name}: the page wider than the window, a door open`).toBe(0);
            const second = await measurePage(page, 2, desk);
            expect(second.open, look.name).toBe(true);
            expect(second.again, `${look.name}: OPEN ANOTHER on THE VAULT page`).toBe(false);
            expect(second.press, `${look.name}: PRESS AND HOLD once open`).toBe(false);
            expect(second.others, `${look.name}: the other doors' PRESS AND HOLD`).toEqual([true]);
            expect(second.from.length, look.name).toBeGreaterThan(0);
            expect(second.until, look.name).toMatch(/^WAITS UNTIL \d{1,2} [A-Z]+$/);
            for (const o of second.strength) expect(o, `${look.name}: the page is never dimmed`).toBe(1);
            expect(second.lidClear, `${look.name}: the second door's lid under the line above it`).toBeGreaterThanOrEqual(8);
            // Then the first: its open lid clear of YOUR VAULTS · N WAITING (MK's measured minimum, D69), over the float.
            await openPageDoor(page, 1);
            let least = Infinity;
            for (let i = 0; i < 5; i++) {
              const m = await measurePage(page, 1, desk);
              least = Math.min(least, m.lidClear);
              for (const o of m.strength) expect(o, look.name).toBe(1);
              await page.waitForTimeout(250);
            }
            expect(least, `${look.name}: the first lid's box under YOUR VAULTS · N WAITING`).toBeGreaterThanOrEqual(8);
            expect(await sideways(page), `${look.name}: the page wider than the window, both doors open`).toBe(0);
            expect(opened.errors).toEqual([]);
          } finally {
            await opened.close();
          }
        }

        // A credit to give opened signed out on a phone (plan §3.5, §3.10): the sign-in first (MY PIECES), then, the
        // account created there, its page again at its own address with ACCEPT.
        const gift = stateById('vault-gift');
        const out = await openIn(st, { ...gift, as: undefined, ready: '.view--pieces form', check: undefined }, PHONE);
        try {
          const page = out.page;
          await page.locator('.view--pieces').getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).first().click();
          const form = page.locator('.view--pieces form.form--create');
          await form.getByLabel('FIRST NAME', { exact: true }).fill('Camille');
          await form.getByLabel('LAST NAME', { exact: true }).fill('Laurent');
          await form.getByLabel('EMAIL', { exact: true }).fill('vault.newfriend@example.com');
          await form.getByLabel('PASSWORD', { exact: true }).fill(NOCTURNE_PASSWORD);
          await form.getByLabel('COUNTRY', { exact: true }).selectOption('FR');
          await form.getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).click();
          await page.locator('.view--gift[data-state="ready"] .vp-gift__accept').waitFor({ timeout: 20_000 });
          expect(new URL(page.url()).pathname).toBe(`/verify/gift/${st.demo.links.vaultGift}`);
          expect(await page.evaluate(() => sessionStorage.getItem('orbes.gift')), 'the kept code forgotten').toBeNull();
          expect(out.errors).toEqual([]);
        } finally {
          await out.close();
        }
      });
    },
    TIMEOUT,
  );
});

describe.skipIf(!HAS_CHROMIUM)('THE VAULT on SOLD OUT for your size and the end page (Chromium)', () => {
  const { withStage } = stages();

  /** The door's box width on the page (its `.vlt`). */
  const boxWidth = (page: Page) => page.evaluate(() => document.querySelector('.live__vault-slot .vlt')!.getBoundingClientRect().width);

  /** `base` opened in `look` for `as`, `then` run on its page; the page's errors none. */
  async function onPage(st: NocturneStage, base: UiState, look: Look, extra: Partial<UiState>, then: (page: Page) => Promise<void>): Promise<void> {
    const opened = await openIn(st, { ...base, ...extra }, look);
    try {
      await then(opened.page);
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.close();
    }
  }

  it(
    'opens on SOLD OUT for your size (phone, computer) and on the end page (computer): the page dimmed to 16 %, OPEN ANOTHER at full strength above the line under it, the lid clear of the sentence above; under reduced motion in light mode, at once and dark',
    async () => {
      await withStage('vault', async (st) => {
        const sold = stateById('live-sold-out-size-vault');
        let soldBox = 0;
        for (const [look, as] of [
          [PHONE, 'vaultSE2e'],
          [DESK, 'vaultSOpen'],
        ] as const) {
          await onPage(st, sold, look, { as }, async (page) => {
            // The door's floor never makes the page wider than the window (closed, then open).
            expect(await sideways(page), `${look.name}: SOLD OUT wider than the window, closed`).toBe(0);
            if (look === PHONE) soldBox = await boxWidth(page);
            await openTheDoor(page);
            // The opening's end (6.55 s), the page's dim (from 1.8 s over 1.25 s) long done.
            await page.waitForFunction(() => !document.querySelector('.live__vault-slot .vlt')?.classList.contains('is-playing'), null, { timeout: 15_000 });
            expect(await sideways(page), `${look.name}: SOLD OUT wider than the window, open`).toBe(0);
            // The open box floats (30 %): the lid's clearance read over a second, its least kept.
            let least = Infinity;
            for (let i = 0; i < 5; i++) {
              const m = await measure(page, '.live__leave-line', '.live__note');
              least = Math.min(least, m.lidClear!);
              expect([m.againShown, m.again], look.name).toEqual([true, 1]);
              expect(m.dim, look.name).toBeCloseTo(0.16, 2);
              expect(m.gap, look.name).toBeGreaterThanOrEqual(0);
              await page.waitForTimeout(250);
            }
            expect(least, `${look.name}: the lid's box under the sentence`).toBeGreaterThanOrEqual(8);
          });
        }
        // The end page of a release sold out whole: the page in the line as its last piece is paid, then opened.
        const end = stateById('live-end-vault');
        await onPage(st, end, DESK, { as: 'vaultEndE2e', path: (d) => `/verify/releases/${d.releases.vaultEndE2e}`, act: async (run) => {
          await run.page.locator('.view--live .live__queue').first().waitFor();
          const buyer = run.demo.accounts.vaultEndE2eBuyer!;
          await run.stage.ctx.services.live.confirm(buyer.id, run.demo.releases.vaultEndE2e!, buyer.actor);
        } }, async (page) => {
          expect(await sideways(page), 'the end page wider than the window, closed').toBe(0);
          await openTheDoor(page);
          await page.waitForFunction(() => !document.querySelector('.live__vault-slot .vlt')?.classList.contains('is-playing'), null, { timeout: 15_000 });
          expect(await sideways(page), 'the end page wider than the window, open').toBe(0);
          const m = await measure(page, '.n-live__back', null);
          expect([m.againShown, m.again]).toEqual([true, 1]);
          expect(m.dim).toBeCloseTo(0.16, 2);
          // THE RELEASES clears OPEN ANOTHER (never MK's known 20 px overlap).
          expect(m.gap).toBeGreaterThanOrEqual(0);
        });
        // SOLD OUT on a small computer (1024 × 768), and the end page there and on a phone: never wider than the window,
        // closed or open (each door's floor clipped sideways); on the phone, the end page's box as wide as SOLD OUT's
        // (MK draws it at the same share of the width on both). Opened under reduced motion: the same open box, at once.
        await onPage(st, sold, SMALL_DESK, { as: 'vaultSOpenDesk' }, async (page) => {
          expect(await sideways(page), 'SOLD OUT at 1024, closed').toBe(0);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await openTheDoor(page);
          await settle(page, 100);
          expect(await sideways(page), 'SOLD OUT at 1024, open').toBe(0);
        });
        for (const [look, key] of [
          [PHONE, 'vaultEndOpen'],
          [SMALL_DESK, 'vaultEndOpenDesk'],
        ] as const) {
          await onPage(st, end, look, { as: key, path: (d) => `/verify/releases/${d.releases[key]}`, act: async (run) => {
            await run.page.locator('.view--live .live__queue').first().waitFor();
            const buyer = run.demo.accounts[`${key}Buyer`]!;
            await run.stage.ctx.services.live.confirm(buyer.id, run.demo.releases[key]!, buyer.actor);
          } }, async (page) => {
            expect(await sideways(page), `${look.name}: the end page, closed`).toBe(0);
            if (look === PHONE) expect(await boxWidth(page), 'the end page\'s box as wide as SOLD OUT\'s').toBeCloseTo(soldBox, 0);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await openTheDoor(page);
            await settle(page, 100);
            expect(await sideways(page), `${look.name}: the end page, open`).toBe(0);
          });
        }
        // Reduced motion, light mode kept on the device: the reward at once, the dim at once, the room dark.
        await onPage(st, sold, { ...PHONE, light: true }, { as: 'vaultSRare' }, async (page) => {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await openTheDoor(page);
          await settle(page, 100);
          const playing = await page.evaluate(() => document.querySelector('.live__vault-slot .vlt')?.classList.contains('is-playing'));
          expect(playing).toBe(false);
          const m = await measure(page, '.live__leave-line', '.live__note');
          expect(m.dim).toBeCloseTo(0.16, 2);
          expect(m.again).toBe(1);
          const ground = await page.evaluate(() => ({ mode: document.documentElement.dataset.mode, bg: getComputedStyle(document.body).backgroundColor }));
          expect(ground).toEqual({ mode: 'light', bg: 'rgb(10, 10, 10)' });
        });
      });
    },
    TIMEOUT,
  );
});
