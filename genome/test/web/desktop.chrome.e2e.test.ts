/**
 * The desktop's chrome end to end (plan DESKTOP §2(j), step 13), on the NOCTURNE demo served by the real server, in
 * Chromium on a computer (a mouse, no touch) at 1440 × 900 and 1024 × 768, dark and light:
 *
 *  - every page's top bar (BRIEF decisions 5 and 6, §10.14, §10.17): 84 px, sticky at the window's top however far the
 *    page is scrolled; ORBES, then the menu NOW · RELEASES · COLLECTION · CIRCLE · PIECES with the page's chapter
 *    current, then SCAN (the SCAN page) and the account (its page; signed out, SIGN IN: the sign-in page); the foot's
 *    links on one row with SOUND OFF (a computer starts with the sound off, D6); no sideways scroll, no label or button
 *    on two lines, one h1; no page error, console error or CSP report;
 *  - the menu, SCAN and the account lead where they say, the current item following;
 *  - the computer's own addresses opened on a phone land on its equivalent: the SCAN page, the sign-in page, YOUR
 *    ACCOUNT's pages and MESSAGES on NOW, an order's page on MY PIECES' ORDERS, YOUR WISHLIST's card's on YOUR WISHLIST
 *    (its phone address, /verify/wishlist);
 *  - the switch (Q2): an iPad at 1366 px (by touch, and as Safari says it, a Mac with touch points) keeps the phone; a
 *    mouse at 1440 px has the computer's; a 900 px mouse window keeps the phone's layout with a computer's words and hover;
 *    a window resized across 1024 px, both ways, on every page the computer adds, never breaks (no error, no sideways
 *    scroll, the page's phone equivalent below 1024 px, the computer's again above; the terms' sections beside the text
 *    and VERIFY A PIECE's SCAN page above 1024 px only).
 */
import type { Browser, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { NocturneDemo } from '../support/nocturne-demo.js';
import { mobileContext, type UiStage } from '../support/ui-stage.js';
import { settle } from '../support/nocturne-states.js';
import { at, desktopProblems, facts, HAS_CHROMIUM, LOOKS, norm, openIn, POLL, stages, watchErrors, type Look } from './desktop.harness.js';
import { sessionCookieName } from '../../src/server/services/sessions.js';

const TIMEOUT = 8 * 60_000;
const MENU = ['NOW', 'RELEASES', 'COLLECTION', 'CIRCLE', 'PIECES'] as const;
type Chapter = (typeof MENU)[number] | null;

/** The pages of the demo `full` signed in as `you`, each with its chapter in the menu. */
const PAGES: readonly { name: string; path: (d: NocturneDemo) => string; ready: string; chapter: Chapter; as?: string; account?: boolean }[] = [
  { name: 'NOW', path: () => '/verify', ready: '.view--now[data-ready]', chapter: 'NOW', as: 'you' },
  { name: 'THE RELEASES', path: () => '/verify/releases', ready: '.view--releases', chapter: 'RELEASES', as: 'you' },
  { name: 'a draw', path: (d) => `/verify/releases/${d.releases.draw}`, ready: '.view--release', chapter: 'RELEASES', as: 'you' },
  { name: 'THE COLLECTION', path: () => '/verify/lookbook', ready: '.view--lookbook[data-state="ready"]', chapter: 'COLLECTION', as: 'you' },
  { name: 'a model', path: (d) => `/verify/lookbook/${d.slugs.steel}`, ready: '.view--sheet', chapter: 'COLLECTION', as: 'you' },
  { name: 'THE CIRCLE', path: () => '/verify/circle', ready: '.view--circle', chapter: 'CIRCLE', as: 'you' },
  { name: 'MY PIECES', path: () => '/verify/pieces', ready: '.view--pieces .n-pieces__panel', chapter: 'PIECES', as: 'you' },
  { name: 'a piece', path: (d) => `/verify/pieces/${d.pieces.yours}`, ready: '.view--piece .n-piece__article', chapter: 'PIECES', as: 'you' },
  { name: 'YOUR ACCOUNT', path: () => '/verify/account', ready: '.view--account .d-acct__cards', chapter: null, as: 'you', account: true },
  { name: 'THE CLUB', path: () => '/verify/club', ready: '.view--club', chapter: null, as: 'you' },
  { name: 'the SCAN page', path: () => '/verify/scan', ready: '.view--scanpage .d-scanpage__code svg', chapter: null, as: 'you' },
  { name: 'NOW, signed out', path: () => '/verify', ready: '.view--now[data-ready]', chapter: 'NOW' },
  { name: 'the sign-in page', path: () => '/verify/sign-in', ready: '.view--signin form', chapter: null },
];

/** The top bar, the menu and the foot as the page draws them. */
function chrome(page: Page) {
  return page.evaluate(() => {
    const hd = document.querySelector<HTMLElement>('header.n-hd')!;
    const box = hd.getBoundingClientRect();
    const words = (el: Element | null) => (el as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    const shown = (el: Element | null) => !!el && (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const menu = [...hd.querySelectorAll<HTMLAnchorElement>('a.n-rail__link')].filter(shown);
    const acct = [...hd.querySelectorAll<HTMLAnchorElement>('a.n-acct')].filter(shown);
    const scan = hd.querySelector<HTMLAnchorElement>('a.n-hd__scan');
    const foot = [...document.querySelectorAll<HTMLElement>('footer :is(a.n-foot__club-link, a.n-fl__link, button.n-snd)')].filter(shown);
    return {
      position: getComputedStyle(hd).position,
      top: Math.round(box.top),
      height: Math.round(box.height * 10) / 10,
      wordmark: { text: words(hd.querySelector('a.n-wm')), href: hd.querySelector('a.n-wm')?.getAttribute('href') ?? null },
      menu: menu.map((a) => ({ text: words(a)!.replace(/ LIVE$/, ''), href: a.getAttribute('href'), current: a.getAttribute('aria-current') })),
      menuInBar: menu.every((a) => a.closest('header.n-hd') === hd),
      scan: scan && shown(scan) ? { text: words(scan), href: scan.getAttribute('href'), current: scan.getAttribute('aria-current') } : null,
      account: acct.map((a) => ({ text: words(a), href: a.getAttribute('href'), current: a.getAttribute('aria-current') })),
      foot: foot.map((el) => ({ text: words(el), mid: Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) })),
      order: [...hd.querySelectorAll('a.n-wm, a.n-rail__link, a.n-hd__scan, a.n-acct')].filter(shown).map((el) => (el as HTMLElement).className.split(' ').find((c) => /^n-(wm|rail__link|hd__scan|acct)$/.test(c))),
    };
  });
}

async function chromeProblems(page: Page, look: Look, p: (typeof PAGES)[number], signedIn: boolean): Promise<string[]> {
  const out: string[] = [];
  const where = `${p.name} (${look.name})`;
  const c = await chrome(page);
  if (c.position !== 'sticky' || c.top !== 0 || c.height !== 84) out.push(`${where}: the bar is ${c.position}, at ${c.top}, ${c.height} px high`);
  if (c.wordmark.text !== 'ORBES' || c.wordmark.href !== '/verify') out.push(`${where}: the wordmark ${JSON.stringify(c.wordmark)}`);
  const menu = c.menu.map((m) => m.text);
  if (JSON.stringify(menu) !== JSON.stringify(MENU) || !c.menuInBar) out.push(`${where}: the menu reads ${menu.join(' · ')}`);
  const current = c.menu.filter((m) => m.current === 'page').map((m) => m.text);
  if (JSON.stringify(current) !== JSON.stringify(p.chapter ? [p.chapter] : [])) out.push(`${where}: current in the menu ${current.join(', ') || 'none'} for ${p.chapter ?? 'none'}`);
  if (c.scan?.text !== 'SCAN' || c.scan.href !== '/verify/scan') out.push(`${where}: SCAN ${JSON.stringify(c.scan)}`);
  if (p.name === 'the SCAN page' && c.scan?.current !== 'page') out.push(`${where}: SCAN not current on its page`);
  const account = c.account[0];
  if (c.account.length !== 1) out.push(`${where}: ${c.account.length} account links in the bar`);
  else if (signedIn ? account!.href !== '/verify/account' || account!.text !== 'TITANE' : account!.href !== '/verify/sign-in' || account!.text !== 'SIGN IN') out.push(`${where}: the account ${JSON.stringify(account)}`);
  else if ((account!.current === 'page') !== (!!p.account || p.name === 'the sign-in page')) out.push(`${where}: the account's current ${account!.current}`);
  if (JSON.stringify(c.order) !== JSON.stringify(['n-wm', ...MENU.map(() => 'n-rail__link'), 'n-hd__scan', 'n-acct'])) out.push(`${where}: the bar's order ${c.order.join(', ')}`);
  const foot = c.foot.map((f) => f.text);
  if (JSON.stringify(foot) !== JSON.stringify(['THE CLUB', 'PRIVACY', 'TERMS', 'LEGAL', 'HELP', 'SOUND OFF'])) out.push(`${where}: the foot reads ${foot.join(' · ')}`);
  const mids = c.foot.map((f) => f.mid);
  if (mids.length > 0 && Math.max(...mids) - Math.min(...mids) > 3) out.push(`${where}: the foot's links on more than one row (${mids.join(', ')})`);
  // Sticky: at the foot of the page, the bar still at the window's top.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await settle(page, 300);
  const low = await chrome(page);
  if (low.top !== 0 || low.height !== 84) out.push(`${where}: scrolled to the foot, the bar is at ${low.top}, ${low.height} px high`);
  await page.evaluate(() => window.scrollTo(0, 0));
  out.push(...(await desktopProblems(page, look, where)));
  return out;
}

describe.skipIf(!HAS_CHROMIUM)('desktop chrome (Chromium, a computer)', () => {
  const { withStage } = stages();

  for (const look of LOOKS) {
    it(
      `${look.name}: every page's bar, menu, SCAN and account, sticky; the foot on one row with SOUND OFF; nothing sideways, no label on two lines, one h1, no error`,
      async () => {
        await withStage('full', async (st) => {
          const problems: string[] = [];
          for (const p of PAGES) {
            const opened = await openIn(st, at('full', p.path, p.ready, { as: p.as }), look);
            try {
              problems.push(...(await chromeProblems(opened.page, look, p, !!p.as)));
              problems.push(...opened.errors.map((e) => `${p.name} (${look.name}): ${e}`));
            } finally {
              await opened.close();
            }
          }
          expect(problems).toEqual([]);
        });
      },
      TIMEOUT,
    );

    it(
      `${look.name}: the menu, SCAN and the account lead where they say, the current item following`,
      async () => {
        await withStage('full', async (st) => {
          const opened = await openIn(st, at('full', '/verify', '.view--now[data-ready]', { as: 'you' }), look);
          const { page } = opened;
          try {
            const bar = page.locator('header.n-hd');
            const go = async (link: ReturnType<Page['locator']>, path: RegExp, view: string) => {
              await link.click();
              await page.locator(view).first().waitFor({ timeout: 20_000 });
              await expect.poll(() => new URL(page.url()).pathname, POLL).toMatch(path);
              await settle(page, 200);
            };
            const current = () => page.evaluate(() => [...document.querySelectorAll('header.n-hd [aria-current="page"]')].filter((e) => (e as HTMLElement).getClientRects().length > 0).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').replace(/ LIVE$/, '').trim()));
            for (const [name, path, view] of [
              ['RELEASES', /^\/verify\/releases$/, '.view--releases'],
              ['COLLECTION', /^\/verify\/lookbook$/, '.view--lookbook'],
              ['CIRCLE', /^\/verify\/circle$/, '.view--circle'],
              ['PIECES', /^\/verify\/pieces$/, '.view--pieces'],
              ['NOW', /^\/verify$/, '.view--now'],
            ] as const) {
              await go(bar.locator('a.n-rail__link', { hasText: new RegExp(`^${name}`) }), path, view);
              expect(await current()).toEqual([name]);
            }
            await go(bar.getByRole('link', { name: 'Scan an ORBES code' }), /^\/verify\/scan$/, '.view--scanpage .d-scanpage__code svg');
            expect(await current()).toEqual(['SCAN']);
            await go(bar.locator('a.n-acct:not([hidden])'), /^\/verify\/account$/, '.view--account .d-acct__cards');
            expect(await current()).toEqual(['TITANE']);
            // ORBES leads to NOW.
            await go(bar.locator('a.n-wm'), /^\/verify$/, '.view--now');
            expect(await current()).toEqual(['NOW']);
            expect(opened.errors).toEqual([]);
          } finally {
            await opened.close();
          }
          // Signed out: SIGN IN in the bar opens the sign-in page, marked current.
          const out = await openIn(st, at('full', '/verify/releases', '.view--releases'), look);
          try {
            await out.page.locator('header.n-hd a.n-acct:not([hidden])').click();
            await out.page.locator('.view--signin form').waitFor({ timeout: 20_000 });
            expect(new URL(out.page.url()).pathname).toBe('/verify/sign-in');
            expect(await out.page.locator('header.n-hd a.n-acct:not([hidden])').getAttribute('aria-current')).toBe('page');
            expect(out.errors).toEqual([]);
          } finally {
            await out.close();
          }
        });
      },
      TIMEOUT,
    );
  }

  it(
    "the computer's own addresses opened on a phone land on its equivalent",
    async () => {
      await withStage('full', async (st) => {
        const reference = await yourOrderReference(st.stage, st.demo);
        const cases: { path: string; view: string; pathname: string; then?: (p: Page) => Promise<void> }[] = [
          { path: '/verify/scan', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/sign-in', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/account', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/account/profile', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/account/sizes', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/account/addresses', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/account/password', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/messages', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: '/verify/messages/general', view: '.view--now[data-ready]', pathname: '/verify' },
          { path: `/verify/orders/${reference}`, view: '.view--pieces[data-tab="orders"]', pathname: '/verify/pieces' },
          { path: '/verify/account/wishlist', view: '.view--wishlist', pathname: '/verify/wishlist' },
        ];
        const problems: string[] = [];
        for (const c of cases) {
          const context = await mobileContext(st.browser);
          const errors: string[] = [];
          try {
            await context.clock.setFixedTime(new Date('2026-10-05T16:49:00.000Z'));
            await context.addCookies([{ name: sessionCookieName(st.stage.ctx.config, 'account'), value: st.demo.accounts.you!.token, url: st.stage.origin }]);
            const page = await context.newPage();
            watchErrors(page, errors);
            await page.goto(`${st.stage.origin}${c.path}`);
            await page.locator(c.view).first().waitFor({ timeout: 20_000 });
            await settle(page, 300);
            const f = await facts(page);
            if (!f.touch || f.desktop) problems.push(`${c.path}: not the phone's layout`);
            const at = new URL(page.url()).pathname;
            if (at !== c.pathname) problems.push(`${c.path}: at ${at} for ${c.pathname}`);
            if (f.sideways) problems.push(`${c.path}: scrolls sideways (${f.sideways})`);
            if (c.path.startsWith('/verify/orders/') && !(await page.locator('.view--pieces article.n-pieces__order').first().isVisible())) problems.push(`${c.path}: no order card on ORDERS`);
            problems.push(...errors.map((e) => `${c.path}: ${e}`));
          } finally {
            await context.close();
          }
        }
        expect(problems).toEqual([]);
      });
    },
    TIMEOUT,
  );

  it(
    'the switch: an iPad at 1366 px keeps the phone, a mouse at 1440 px the computer; a 900 px mouse window has hover and a computer’s words; resized across 1024 px both ways, every page holds',
    async () => {
      await withStage('full', async (st) => {
        const problems: string[] = [];
        // An iPad by touch, and with its trackpad (Safari says it is a Mac: a Mac with touch points).
        const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
        const TRACKPAD = "(() => { const d = (k, v) => Object.defineProperty(Navigator.prototype, k, { get: () => v, configurable: true }); d('maxTouchPoints', 5); d('platform', 'MacIntel'); })();";
        for (const [name, options, script] of [
          ['an iPad by touch', { viewport: { width: 1366, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPAD }, null],
          ['an iPad with its trackpad', { viewport: { width: 1366, height: 1024 }, userAgent: IPAD }, TRACKPAD],
        ] as const) {
          // Under load, Chromium now and then opens a touch context without its touch (no touch points, a fine pointer):
          // that window is no iPad, so it is opened again (three tries) before the app is judged on it.
          for (let attempt = 1; ; attempt++) {
            const context = await st.browser.newContext({ ...options, locale: 'en-GB', timezoneId: 'Europe/Paris' });
            try {
              if (script) await context.addInitScript({ content: script });
              const page = await context.newPage();
              await page.goto(`${st.stage.origin}/verify/releases/${st.demo.releases.draw}`);
              await page.locator('.view--release').waitFor({ timeout: 20_000 });
              const touched = await page.evaluate(() => navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);
              if (!script && !touched) {
                if (attempt < 3) continue;
                problems.push(`${name}: the browser gave the window no touch (${attempt} tries)`);
                break;
              }
              await settle(page, 300);
              const f = await facts(page);
              if (!f.touch || f.desktop) problems.push(`${name}: not the phone's layout`);
              const text = norm(await page.locator('main').innerText());
              if (!/on this phone \(UTC\+02:00\)/.test(text) || /on this computer/.test(text)) problems.push(`${name}: not the phone's words`);
              break;
            } finally {
              await context.close();
            }
          }
        }
        // A mouse at 1440: the computer's layout; at 900: the phone's layout, the computer's words, hover.
        for (const width of [1440, 900]) {
          const opened = await openIn(st, at('full', (d) => `/verify/releases/${d.releases.draw}`, '.view--release'), { name: `${width}`, size: { width, height: 800 }, light: false });
          try {
            const f = await facts(opened.page);
            if (f.desktop !== (width === 1440) || f.touch) problems.push(`a mouse at ${width} px: desktop ${f.desktop}, touch ${f.touch}`);
            const text = norm(await opened.page.locator('main').innerText());
            if (!/on this computer \(UTC\+02:00\)/.test(text) || /on this phone/.test(text)) problems.push(`a mouse at ${width} px: not a computer's words`);
            if (width === 900) {
              const enter = opened.page.getByRole('link', { name: 'SIGN IN', exact: true }).or(opened.page.getByRole('button', { name: 'ENTER THE DRAW' })).first();
              const bg = () => enter.evaluate((el) => getComputedStyle(el).backgroundColor + getComputedStyle(el).color);
              const rest = await bg();
              await enter.hover();
              await expect.poll(bg, POLL).not.toBe(rest);
              const sound = norm(await opened.page.locator('footer button.n-snd').innerText());
              if (sound !== 'SOUND OFF') problems.push(`a mouse at 900 px: ${sound}`);
            }
            problems.push(...opened.errors.map((e) => `a mouse at ${width} px: ${e}`));
          } finally {
            await opened.close();
          }
        }
        expect(problems).toEqual([]);
      });
    },
    TIMEOUT,
  );

  it(
    'resized across 1024 px and back, every page the computer adds holds: its phone equivalent below, the computer’s page again above',
    async () => {
      await withStage('full', async (st) => {
        const reference = await yourOrderReference(st.stage, st.demo);
        const cases: { name: string; path: string; ready: string; as?: string; narrow: string; narrowPath: RegExp; wide: string; legal?: true }[] = [
          { name: 'NOW', path: '/verify', ready: '.view--now[data-ready]', as: 'you', narrow: '.view--now', narrowPath: /^\/verify$/, wide: '.view--now' },
          { name: 'the SCAN page', path: '/verify/scan', ready: '.view--scanpage svg', as: 'you', narrow: '.view--now', narrowPath: /^\/verify$/, wide: '.view--now' },
          { name: 'YOUR ACCOUNT', path: '/verify/account', ready: '.view--account .d-acct__cards', as: 'you', narrow: '.n-account:not([hidden]) .n-account__panel', narrowPath: /^\/verify$/, wide: '.view--account .d-acct__cards' },
          { name: 'YOUR SIZES', path: '/verify/account/sizes', ready: '.view--account form', as: 'you', narrow: '.n-account:not([hidden]) .n-account__sizes-view', narrowPath: /^\/verify$/, wide: '.view--account form' },
          { name: 'MESSAGES', path: '/verify/messages', ready: '.view--messages', as: 'you', narrow: '.n-account:not([hidden]) #account-messages-title', narrowPath: /^\/verify$/, wide: '.view--messages' },
          { name: 'an order', path: `/verify/orders/${reference}`, ready: '.view--order .d-order__head', as: 'you', narrow: '.view--pieces[data-tab="orders"]', narrowPath: /^\/verify\/pieces$/, wide: '.view--pieces' },
          { name: 'the sign-in page', path: '/verify/sign-in', ready: '.view--signin form', narrow: '.view--pieces form', narrowPath: /^\/verify\/pieces$/, wide: '.view--pieces' },
          { name: 'a draw', path: `/verify/releases/${st.demo.releases.draw}`, ready: '.view--release', as: 'you', narrow: '.view--release', narrowPath: /^\/verify\/releases\//, wide: '.view--release' },
          { name: 'a model', path: `/verify/lookbook/${st.demo.slugs.steel}`, ready: '.view--sheet', as: 'you', narrow: '.view--sheet', narrowPath: /^\/verify\/lookbook\//, wide: '.view--sheet' },
          // The terms: their sections beside the text above 1024 px only, VERIFY A PIECE leading to the SCAN page there.
          { name: 'the terms', path: '/legal/terms', ready: 'main.legal .legal__body', narrow: 'main.legal > article.legal__body', narrowPath: /^\/legal\/terms$/, wide: 'main.legal .d-legal__sections', legal: true },
        ];
        const problems: string[] = [];
        for (const c of cases) {
          const opened = await openIn(st, at('full', c.path, c.ready, { as: c.as }), LOOKS[0]!);
          const { page } = opened;
          try {
            for (const [width, view, desktop] of [
              [900, c.narrow, false],
              [1440, c.wide, true],
              [1023, c.narrow, false],
              [1024, c.wide, true],
            ] as const) {
              await page.setViewportSize({ width, height: 900 });
              const shown = await page
                .locator(view)
                .first()
                .waitFor({ timeout: 20_000 })
                .then(() => true)
                .catch(() => false);
              await settle(page, 300);
              const f = await facts(page);
              const where = `${c.name} at ${width} px`;
              if (!shown) problems.push(`${where}: ${view} not shown`);
              if (f.desktop !== desktop) problems.push(`${where}: desktop ${f.desktop}`);
              if (f.sideways) problems.push(`${where}: scrolls sideways (${f.sideways})`);
              if (!desktop && !c.narrowPath.test(new URL(page.url()).pathname)) problems.push(`${where}: at ${new URL(page.url()).pathname}`);
              if (c.legal) {
                const legal = await page.evaluate(() => ({
                  sections: document.querySelectorAll('.d-legal__sections').length,
                  bodies: document.querySelectorAll('article.legal__body').length,
                  verify: document.querySelector('.legal-head__verify')?.getAttribute('href') ?? null,
                }));
                if (legal.sections !== (desktop ? 1 : 0)) problems.push(`${where}: ${legal.sections} sections lists`);
                if (legal.bodies !== 1) problems.push(`${where}: ${legal.bodies} texts`);
                if (legal.verify !== (desktop ? '/verify/scan' : '/verify')) problems.push(`${where}: VERIFY A PIECE leads to ${legal.verify}`);
              }
            }
            problems.push(...opened.errors.map((e) => `${c.name}: ${e}`));
          } finally {
            await opened.close();
          }
        }
        expect(problems).toEqual([]);
      });
    },
    TIMEOUT,
  );
});

/** The reference of an order of `you` (the LIVE RELEASE's, RESERVED), as an order's page names it. */
async function yourOrderReference(stage: UiStage, demo: NocturneDemo): Promise<string> {
  const order = await stage.ctx.db.selectFrom('orders').select('id').where('account_id', '=', demo.accounts.you!.id).where('status', '=', 'RESERVED').executeTakeFirstOrThrow();
  return `OR-${order.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export type { Browser };
