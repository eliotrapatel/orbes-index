/**
 * The desktop's pages end to end (plan DESKTOP §2(j), step 13), on the NOCTURNE demo served by the real server, in
 * Chromium on a computer (a mouse, no touch) at 1440 × 900 and 1024 × 768, dark and light. Each page in the
 * computer's layout and the look's mode, nothing scrolling sideways, no label or button on two lines, one h1, no page
 * error, console error or CSP report; and what each one is for:
 *
 *  - YOUR ACCOUNT and each of its pages (decision 5): its cards, each a link to its page; YOUR PROFILE, YOUR SIZES,
 *    YOUR ADDRESSES and CHANGE PASSWORD each a page with its title, ‹ YOUR ACCOUNT and its form; YOUR WISHLIST's page;
 *    MESSAGES in two parts (its subjects, the conversation);
 *  - THE RELEASES' tabs LIVE and PAST; a draw with ENTER THE DRAW; a drawn draw's THE ENTRIES as a table (RANK, TIER,
 *    SENIORITY, IDENTIFIER), its rows read as the page reaches them, the account's own marked YOURS;
 *  - a piece's tabs OWNERSHIP · ORBES CARE · SERVICE, each panel shown in turn;
 *  - ORBES CARE (plan ORBES CARE, D1): each warranty and each moment of a claim (the prepaid label, replaced, a credit,
 *    refused, repaired) with WARRANTY on the left at the top; nothing that starts a claim (no button nor link that
 *    claims, no photo to upload); the lifetime piece's certificate, its WARRANTY ACTIVE · LIFETIME, FROM and no UNTIL;
 *  - the shared certificate, on its paper;
 *  - the legal pages (terms, privacy, help, in English and French): the list of their sections stays under the bar as
 *    the text scrolls, and each section of it, the last included, is reached by its link (its heading under the bar);
 *  - a model's gallery by the keyboard (decision 1): its first tile focused and Enter opens the viewer on 1 / 2, the
 *    focus inside it; → and ← move (looping), Escape closes it, the focus back on its tile.
 */
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { NocturneDemo } from '../support/nocturne-demo.js';
import { settle, stateById } from '../support/nocturne-states.js';
import { at, desktopProblems, HAS_CHROMIUM, LOOKS, norm, openIn, POLL, stages, type Look } from './desktop.harness.js';

const TIMEOUT = 8 * 60_000;

/** The words of the page's controls named `selector`, folded. */
const words = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.filter((e) => (e as HTMLElement).getClientRects().length > 0).map((e) => ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/[\s ]+/g, ' ').trim()));

describe.skipIf(!HAS_CHROMIUM)('desktop pages (Chromium, a computer)', () => {
  const { withStage } = stages();

  for (const look of LOOKS) {
    it(
      `${look.name}: YOUR ACCOUNT and its pages, YOUR WISHLIST, MESSAGES; THE RELEASES, a draw and THE ENTRIES; a piece’s tabs; the certificate; the legal pages and their sections`,
      async () => {
        await withStage('full', async (st) => {
          const problems: string[] = [];
          const check = async (name: string, path: string | ((d: NocturneDemo) => string), ready: string, as: string | undefined, then: (page: Page) => Promise<void> = async () => {}, opts: { h1?: boolean } = {}) => {
            let opened: Awaited<ReturnType<typeof openIn>> | null = null;
            try {
              opened = await openIn(st, at('full', path, ready, { as }), look);
              await then(opened.page);
              problems.push(...(await desktopProblems(opened.page, look, `${name} (${look.name})`, opts)));
              problems.push(...opened.errors.map((e) => `${name} (${look.name}): ${e}`));
            } catch (e) {
              problems.push(`${name} (${look.name}): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
            } finally {
              await opened?.close();
            }
          };

          // ── YOUR ACCOUNT, its cards, each a link to its page ──
          await check('YOUR ACCOUNT', '/verify/account', '.view--account .d-acct__cards', 'you', async (page) => {
            const cards = await page.locator('.view--account a.d-acct__card').evaluateAll((els) => els.map((a) => [(a as HTMLElement).querySelector('.d-acct__card-title, .n-g')?.textContent?.trim() ?? '', a.getAttribute('href')]));
            expect(cards.map(([, href]) => href)).toEqual(['/verify/account/profile', '/verify/account/sizes', '/verify/account/addresses', '/verify/account/wishlist', '/verify/messages', '/verify/account/password']);
            expect(await words(page, '.view--account h1')).toEqual(['YOUR ACCOUNT']);
            expect(await page.getByRole('button', { name: 'SIGN OUT', exact: true }).count()).toBe(1);
          });
          for (const [path, title, form] of [
            ['/verify/account/profile', 'YOUR PROFILE', 'form.form--profile'],
            ['/verify/account/sizes', 'YOUR SIZES', 'form'],
            ['/verify/account/addresses', 'YOUR ADDRESSES', '.d-acct__sub--addresses'],
            ['/verify/account/password', 'CHANGE PASSWORD', 'form'],
          ] as const) {
            await check(title, path, `.view--account ${form}`, 'you', async (page) => {
              expect(await words(page, '.view--account h1')).toEqual([title]);
              expect(await words(page, '.view--account a[href="/verify/account"]')).toContain('YOUR ACCOUNT');
            });
          }
          await check('YOUR WISHLIST', '/verify/account/wishlist', '.view--wishlist:not([data-state="loading"])', 'you', async (page) => {
            expect(await words(page, '.view--wishlist h1')).toEqual(['YOUR WISHLIST']);
          });
          await check('MESSAGES', '/verify/messages', '.d-msg :is(.d-msg__none, ol.d-msg__conversation)', 'you', async (page) => {
            expect(await words(page, '.d-msg h1')).toEqual(['MESSAGES']);
            expect(await page.getByRole('navigation', { name: 'Your subjects with ORBES Client Services' }).count()).toBe(1);
          });

          // ── THE RELEASES' tabs; a draw; THE ENTRIES ──
          await check('THE RELEASES', '/verify/releases', '.view--releases', 'you', async (page) => {
            const tabs = await words(page, '.view--releases [role="tab"]');
            expect(tabs.map((t) => t.replace(/\s*\d+$/, ''))).toEqual(['LIVE', 'PAST']);
            await page.getByRole('tab', { name: /^PAST/ }).click();
            await expect.poll(() => page.getByRole('tab', { name: /^PAST/ }).getAttribute('aria-selected'), POLL).toBe('true');
            await settle(page, 300);
          });
          await check('a draw', (d) => `/verify/releases/${d.releases.draw}`, '.view--release section', 'you', async (page) => {
            expect(await page.locator('.view--release').getByLabel('YOUR ENTRY').getByRole('button', { name: 'ENTER THE DRAW', exact: true }).count()).toBe(1);
          });
          await check('a drawn draw', (d) => `/verify/releases/${d.releases['draw:MONOLITHE IN GOLD']}`, '.view--release section .n-story__open:not([hidden])', 'you', async (page) => {
            expect(await words(page, '.view--release .d-entries__head [role="columnheader"]')).toEqual(['RANK', 'TIER', 'SENIORITY', 'IDENTIFIER']);
            const rows = page.locator('.view--release .release__list > *');
            await rows.last().scrollIntoViewIfNeeded();
            await settle(page, 300);
            const first = norm(await rows.first().innerText());
            expect(first).toMatch(/^1\b.*TITANE.*0 YEARS/);
            expect(norm(await page.locator('.view--release .release__list').innerText())).toMatch(/YOURS/);
            await page.evaluate(() => window.scrollTo(0, 0));
          });

          // ── A piece's tabs ──
          await check('a piece', (d) => `/verify/pieces/${d.pieces.yours}`, '.view--piece .n-piece__article', 'you', async (page) => {
            expect(await words(page, '.view--piece [role="tab"]')).toEqual(['OWNERSHIP', 'ORBES CARE', 'SERVICE']);
            for (const name of ['ORBES CARE', 'SERVICE', 'OWNERSHIP']) {
              await page.getByRole('tab', { name, exact: true }).click();
              await expect.poll(() => page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), POLL).toBe('true');
              await settle(page, 300);
              const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
              if (sideways) problems.push(`a piece, ${name} (${look.name}): scrolls sideways`);
            }
          });

          // ── The shared certificate ──
          await check('the certificate', (d) => `/verify/c#${d.links.certificate}`, '.view--certificate .genome-svg', undefined, async (page) => {
            expect(norm(await page.locator('.view--certificate').innerText())).toMatch(/OWNERSHIP CERTIFICATE/);
          });

          // ── The legal pages: the list of their sections, each reached ──
          for (const [path, ready] of [
            ['/legal/terms', '.legal__section'],
            ['/legal/terms?lang=fr', '.legal__section'],
            ['/legal/privacy', '.legal__section'],
            ['/legal/faq', '.legal__section'],
            ['/legal/faq?lang=fr', '.legal__section'],
          ] as const) {
            await check(path, path, ready, undefined, async (page) => {
              problems.push(...(await sectionsReached(page, `${path} (${look.name})`)));
            });
          }
          expect(problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: ORBES CARE, each warranty and each moment of a claim, WARRANTY on the left, nothing that starts a claim; the lifetime certificate`,
      async () => {
        await withStage('orbes-care', async (st) => {
          const problems: string[] = [];
          const MOMENTS: readonly [string, RegExp][] = [
            ['pieces-orbes-care', /ACTIVE · LIFETIME/],
            ['pieces-orbes-care-two-years', /ACTIVE/],
            ['pieces-orbes-care-below', /PLATINE/],
            ['pieces-claim-label', /DOWNLOAD LABEL/],
            ['pieces-claim-replaced', /REPLACED Your new piece is on its way/],
            ['pieces-claim-part-credit', /A credit of € 1 170 toward a new piece/],
            ['pieces-claim-refused', /Not covered by the warranty: it is scratched\./],
            ['pieces-claim-repaired', /repaired under the ORBES warranty/],
          ];
          for (const [id, said] of MOMENTS) {
            const opened = await openIn(st, stateById(id), look);
            const where = `${id} (${look.name})`;
            try {
              const panel = opened.page.locator('.view--piece [role="tabpanel"]:not([hidden])');
              const text = norm(await panel.innerText());
              if (!said.test(text)) problems.push(`${where}: does not say ${said}`);
              const layout = await panel.evaluate((p) => {
                const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
                const warranty = [...p.querySelectorAll('h2, h3, .n-lb, .n-panel-label, [class*="label"]')].find((el) => /^WARRANTY$/.test((el.textContent ?? '').trim()));
                const care = [...p.querySelectorAll('h2, h3, .n-lb, .n-panel-label, [class*="label"]')].find((el) => /^(PRIVATE CARE|CARING FOR THIS PIECE)$/.test((el.textContent ?? '').trim()));
                const w = box(warranty ?? null);
                const c = box(care ?? null);
                const claims = [...p.querySelectorAll('button, a[href], input, [role="button"]')].filter((el) => (el as HTMLElement).getClientRects().length > 0).map((el) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('type') || '').replace(/\s+/g, ' ').trim());
                return { w: w && { left: w.left, top: w.top }, c: c && { left: c.left, top: c.top }, mid: p.getBoundingClientRect().left + p.getBoundingClientRect().width / 2, files: p.querySelectorAll('input[type="file"]').length, claims };
              });
              if (!layout.w) problems.push(`${where}: no WARRANTY`);
              else if (layout.w.left > layout.mid) problems.push(`${where}: WARRANTY not on the left`);
              if (layout.w && layout.c && (layout.c.left <= layout.w.left || Math.abs(layout.c.top - layout.w.top) > 2) && !/claim/.test(id)) problems.push(`${where}: WARRANTY and the care beside it not on one line (${JSON.stringify(layout)})`);
              if (layout.files > 0) problems.push(`${where}: a photo to upload`);
              const starts = layout.claims.filter((c) => /\b(START|MAKE|OPEN|FILE|SUBMIT)\b.*\bCLAIM\b|^CLAIM\b|SUBSCRIBE|OPENS SOON/i.test(c));
              if (starts.length > 0) problems.push(`${where}: something that starts a claim or subscribes: ${starts.join(', ')}`);
              problems.push(...(await desktopProblems(opened.page, look, where)));
              problems.push(...opened.errors.map((e) => `${where}: ${e}`));
            } finally {
              await opened.close();
            }
          }
          const cert = await openIn(st, stateById('certificate-lifetime'), look);
          try {
            const text = norm(await cert.page.locator('.view--certificate').innerText());
            if (!/WARRANTY ACTIVE · LIFETIME FROM/.test(text) || /ACTIVE · LIFETIME UNTIL/.test(text)) problems.push(`certificate-lifetime (${look.name}): ${text.slice(0, 200)}`);
            problems.push(...(await desktopProblems(cert.page, look, `certificate-lifetime (${look.name})`)));
            problems.push(...cert.errors.map((e) => `certificate-lifetime (${look.name}): ${e}`));
          } finally {
            await cert.close();
          }
          expect(problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: a model’s gallery by the keyboard: Enter opens the viewer, → and ← move, Escape closes, the focus back on its tile`,
      async () => {
        await withStage('gallery', async (st) => {
          const opened = await openIn(st, at('gallery', (d) => `/verify/lookbook/${d.slugs.steel}`, '.view--sheet .n-model__gallery.d-gallery .d-gallery__open', { as: 'you' }), look);
          const { page } = opened;
          try {
            const tiles = page.locator('.view--sheet .d-gallery__open');
            expect(await tiles.count()).toBe(2);
            expect(await tiles.first().getAttribute('aria-label')).toBe('Enlarge photograph 1 of 2');
            await tiles.first().focus();
            await page.keyboard.press('Enter');
            const viewer = page.locator('.d-viewer');
            await viewer.locator('.d-viewer__photo').waitFor({ timeout: 20_000 });
            const position = () => page.locator('.d-viewer .d-viewer__position').innerText().then(norm);
            await expect.poll(position, POLL).toBe('1 / 2');
            expect(await page.evaluate(() => !!document.activeElement?.closest('.d-viewer'))).toBe(true);
            expect(await words(page, '.d-viewer :is(button, a)')).toEqual(expect.arrayContaining(['PREVIOUS', 'NEXT', 'CLOSE']));
            await page.keyboard.press('ArrowRight');
            await expect.poll(position, POLL).toBe('2 / 2');
            await page.keyboard.press('ArrowRight');
            await expect.poll(position, POLL).toBe('1 / 2');
            await page.keyboard.press('ArrowLeft');
            await expect.poll(position, POLL).toBe('2 / 2');
            // Tab stays inside the viewer.
            for (let i = 0; i < 4; i++) {
              await page.keyboard.press('Tab');
              expect(await page.evaluate(() => !!document.activeElement?.closest('.d-viewer'))).toBe(true);
            }
            const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
            expect(sideways).toBe(false);
            await page.keyboard.press('Escape');
            await expect.poll(() => page.locator('.d-viewer .d-viewer__photo').count(), POLL).toBe(0);
            expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Enlarge photograph 1 of 2');
            // The second tile opens it on 2 / 2.
            await tiles.nth(1).focus();
            await page.keyboard.press('Enter');
            await expect.poll(position, POLL).toBe('2 / 2');
            await page.keyboard.press('Escape');
            await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), POLL).toBe('Enlarge photograph 2 of 2');
            expect(await desktopProblems(page, look, `a model's gallery (${look.name})`)).toEqual([]);
            expect(opened.errors).toEqual([]);
          } finally {
            await opened.close();
          }
        });
      },
      TIMEOUT,
    );
  }
});

/**
 * A legal page's list of sections (desktop, §10.30): under the bar as the text scrolls (sticky), and each of its links,
 * the first, a middle one and the last, reached and followed: its heading then under the bar, the list still in view.
 */
async function sectionsReached(page: Page, where: string): Promise<string[]> {
  const out: string[] = [];
  const nav = page.locator('nav.d-legal__sections');
  if ((await nav.count()) !== 1) return [`${where}: no list of sections`];
  const links = nav.locator('a.d-legal__link');
  const n = await links.count();
  if (n < 2) return [`${where}: ${n} sections`];
  for (const i of [...new Set([0, Math.floor(n / 2), n - 1])]) {
    const link = links.nth(i);
    await link.scrollIntoViewIfNeeded();
    // The link is where the pointer finds it (not under the text column nor past the window).
    const reach = await link.evaluate((a) => {
      const r = a.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 20);
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { inWindow: r.top >= 0 && r.bottom <= innerHeight, hit: !!hit && (hit === a || a.contains(hit)) };
    });
    if (!reach.inWindow || !reach.hit) {
      out.push(`${where}: section ${i + 1} of ${n} cannot be reached by the pointer (${JSON.stringify(reach)})`);
      continue;
    }
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await settle(page, 600);
    const at = await page.evaluate((id) => {
      const head = document.getElementById(id.slice(1));
      const nav = document.querySelector('nav.d-legal__sections')!.getBoundingClientRect();
      const r = head?.getBoundingClientRect();
      const root = document.documentElement;
      return { top: r ? Math.round(r.top) : null, atEnd: Math.ceil(root.scrollTop + innerHeight) >= root.scrollHeight - 1, navTop: Math.round(nav.top), navBottom: Math.round(nav.bottom), hash: location.hash };
    }, href);
    if (at.hash !== href) out.push(`${where}: section ${i + 1}: the address reads ${at.hash} for ${href}`);
    if (at.top === null || (!(at.top >= 84 && at.top <= 84 + 120) && !(at.atEnd && at.top >= 84 && at.top < 900))) out.push(`${where}: section ${i + 1}'s heading at ${at.top} px`);
    // Under the bar as the text scrolls; at the page's end the list leaves with the text it stands beside (sticky).
    if (!at.atEnd && (at.navTop < 84 || at.navTop > 84 + 80)) out.push(`${where}: the list of sections at ${at.navTop} px once scrolled`);
  }
  return out;
}

export type { Look };
