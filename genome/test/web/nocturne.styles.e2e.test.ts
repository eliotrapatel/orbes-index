/**
 * NOCTURNE's rulebook, read back from the real screens (plan NOCTURNE, fidelity rule 1: "a browser test reads the
 * computed styles of each component on the real screens and asserts those values"). The canvas's build.py (COMMON_CSS
 * and C_CSS) is normative; each value below is its own, as Chromium computes it (an em of letter spacing in px).
 *
 * The screens are the NOCTURNE stage's (test/support/nocturne-states.ts): the account sheet over NOW (C2), MY PIECES
 * while it reads, could not be shown, empty (C40), the sheet's CHANGE PASSWORD (C39), the shared certificate (Safari's
 * bars back to its light), the column on a computer. The pieces no screen holds yet (each step from N3 places them)
 * are built by their own view code into a real screen, under its stylesheet (test/support/nocturne-specimen.ts).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, stateById } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const HERE = dirname(fileURLToPath(import.meta.url));

// The rulebook's colours (C_CSS .C), as computed.
const IV = 'rgb(246, 242, 234)';
const ASH = 'rgb(167, 162, 154)';
const SMOKE = 'rgb(111, 106, 99)';
const GROUND = 'rgb(10, 10, 10)';
const PLATE = 'rgb(20, 19, 18)';
const LINE = 'rgba(246, 242, 234, 0.14)';
const LINE2 = 'rgba(246, 242, 234, 0.34)';
const NONE = 'rgba(0, 0, 0, 0)';

type Styles = Record<string, string>;

/** The computed style of the first element `selector` matches (its `pseudo` when given), and its box. */
async function read(page: Page, selector: string, props: readonly string[], pseudo?: string): Promise<Styles & { _w: string; _h: string; _top: string; _left: string; _bottom: string; _right: string }> {
  return page.evaluate(
    ({ selector, props, pseudo }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`no ${selector}`);
      const cs = getComputedStyle(el, pseudo ?? null);
      const out: Record<string, string> = {};
      for (const p of props) out[p] = cs.getPropertyValue(p);
      const r = el.getBoundingClientRect();
      out._w = String(r.width);
      out._h = String(r.height);
      out._top = String(r.top);
      out._left = String(r.left);
      out._bottom = String(r.bottom);
      out._right = String(r.right);
      return out as never;
    },
    { selector, props: [...props], pseudo },
  );
}

/** Assert `got` holds `want`: numbers in px within 0.05 px, every other value as it is. */
function holds(where: string, got: Styles, want: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(want)) {
    const g = got[k];
    if (typeof v === 'number') {
      expect(Number.parseFloat(g ?? 'NaN'), `${where} ${k} (${g})`).toBeCloseTo(v, 1);
    } else expect(g, `${where} ${k}`).toBe(v);
  }
}

/** An em of tracking at a size, in px. */
const em = (size: number, track: number) => size * track;

async function check(page: Page, selector: string, want: Record<string, string | number>, pseudo?: string): Promise<Styles> {
  const props = Object.keys(want).filter((k) => !k.startsWith('_'));
  const got = await read(page, selector, props, pseudo);
  holds(`${selector}${pseudo ?? ''}`, got, want);
  return got;
}

const isGravesend = (family: string) => /^"?Gravesend Sans"?/.test(family);
const isHelvetica = (family: string) => /^"?Helvetica Neue"?/.test(family);

/** The specimen of the pieces no screen holds yet, bundled for the page. */
async function specimenScript(): Promise<string> {
  const out = await build({ entryPoints: [join(HERE, '../support/nocturne-specimen.ts')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' });
  return out.outputFiles[0]!.text;
}

describe.skipIf(!HAS_CHROMIUM)('NOCTURNE: every piece on the real screens takes the rulebook\'s values (build.py, Chromium)', () => {
  it(
    'sets the header, the rail, the account sheet, the type scale, the buttons, the rows, the switch, the dots, the fields, the footer, the SCAN ring, the loading state and could-not-be-shown, the column, and the pieces to come',
    async () => {
      const specimen = await specimenScript();
      const states = ['account-sheet', 'account-sheet-password', 'pieces-loading', 'pieces-failed', 'pieces-empty', 'pieces', 'certificate'];
      const seen = new Set<string>();
      await eachState(
        states.map(stateById),
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          const page = opened.page;
          try {
            seen.add(state.id);
            if (state.id === 'account-sheet') await sheet(page);
            if (state.id === 'account-sheet-password') await password(page);
            if (state.id === 'pieces-loading') await loading(page);
            if (state.id === 'pieces-failed') await failed(page);
            if (state.id === 'pieces-empty') await empty(page);
            if (state.id === 'pieces') {
              await chrome(page);
              await column(page);
              await pieces(page, specimen);
            }
            if (state.id === 'certificate') expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#ffffff');
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect([...seen].sort()).toEqual([...states].sort());
    },
    12 * 60_000,
  );

  it(
    'sets the scan and its results as C9, C11, C12, C14, C16 and C17 draw them: the camera, the lock, a problem, a result, its GENOME, THE MODEL, its lines, its tabs, the OWNERSHIP panel, its account line with a long email, the report row, the foot (N4)',
    async () => {
      const states = ['scan-camera', 'scan-verifying', 'problem-camera-denied', 'result-first-registration', 'result-ownership-verified', 'result-receiving', 'result-invalid'];
      const seen = new Set<string>();
      await eachState(
        states.map(stateById),
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          const page = opened.page;
          try {
            seen.add(state.id);
            if (state.id === 'scan-camera') await camera(page);
            if (state.id === 'scan-verifying') await locked(page);
            if (state.id === 'problem-camera-denied') await problem(page);
            if (state.id === 'result-first-registration') await firstRegistration(page);
            if (state.id === 'result-ownership-verified') await yours(page);
            if (state.id === 'result-receiving') await accountLineWraps(page);
            if (state.id === 'result-invalid') await invalid(page);
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect([...seen].sort()).toEqual([...states].sort());
    },
    12 * 60_000,
  );
});

/** C11: the camera on its ground, the orbit (272 px, its centre at 392 px), its moons, the status, LIGHT and the zoom. */
async function camera(page: Page): Promise<void> {
  await check(page, '.view--scan', { 'background-color': 'rgb(5, 5, 5)' });
  const orbit = await check(page, '.n-cam__orbit', { _w: 272, _h: 272 });
  expect(Number(orbit._top) + 136).toBeCloseTo(392, 0);
  await check(page, '.n-cam__ring', { 'box-shadow': 'rgba(246, 242, 234, 0.8) 0px 0px 0px 1px' });
  await check(page, '.n-cam__aperture', { 'box-shadow': `rgba(5, 5, 5, 0.5) 0px 0px 0px ${Math.max(844, 390) * 2}px` });
  await check(page, '.n-cam__moon--polaris', { _w: 18, _h: 18, 'box-shadow': `${IV} 0px 0px 0px 1.5px inset` });
  await check(page, '.n-cam__polaris-core', { _w: 8, _h: 8, 'background-color': IV });
  await check(page, '.n-cam__moon--ne', { _w: 9, _h: 9, 'background-color': IV });
  // The header: ORBES centred, CLOSE at the right (the account button's type).
  await check(page, '.n-cam__hd', { _h: 56, 'justify-content': 'center' });
  await check(page, '.n-cam__close', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.26), color: ASH, _h: 44, right: 12 });
  // SCANNING… at 572 px, the guide 10 px under it, both ivory.
  const line = await check(page, '.n-cam__line', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: IV });
  expect(Number(line._top)).toBeCloseTo(572, 0);
  await check(page, '.n-cam__hint', { 'font-size': 15, 'line-height': 23.25, color: IV, 'margin-top': 10 });
  // LIGHT and the zoom (0.5×): 44 px high, a hairline round each, 10 px apart, at 664 px.
  const light = await check(page, '.n-cam__light', { _h: 44, 'padding-left': 20, 'font-size': 10.5, 'letter-spacing': em(10.5, 0.24), color: IV, 'box-shadow': `${LINE2} 0px 0px 0px 1px inset` });
  expect(isGravesend((await read(page, '.n-cam__light', ['font-family']))['font-family']!)).toBe(true);
  expect(Number(light._top)).toBeCloseTo(664, 0);
  const zoom = await check(page, '.n-cam__zoom', { _h: 44, 'min-width': 64, 'font-size': 14, color: IV });
  expect(isHelvetica((await read(page, '.n-cam__zoom', ['font-family']))['font-family']!)).toBe(true);
  expect(Number(zoom._left) - Number(light._right)).toBeCloseTo(10, 0);
  // UPLOAD A PHOTO, a text link 44 px above the foot.
  await check(page, '.n-cam__upload', { bottom: 44 });
  await check(page, '.n-cam__upload .n-tl', { 'font-size': 10.5, 'letter-spacing': em(10.5, 0.26), color: IV });
}

/** C12: locked, then VERIFYING…: the veil darker, the ring and the moons heavier, one status line, the controls fainter. */
async function locked(page: Page): Promise<void> {
  await check(page, '.n-cam__aperture', { 'box-shadow': `rgba(5, 5, 5, 0.78) 0px 0px 0px ${Math.max(844, 390) * 2}px` });
  await check(page, '.n-cam__ring', { 'box-shadow': 'rgba(246, 242, 234, 0.95) 0px 0px 0px 2px' });
  await check(page, '.n-cam__moon--polaris', { _w: 24, _h: 24, 'box-shadow': `${IV} 0px 0px 0px 2px inset` });
  await check(page, '.n-cam__polaris-core', { _w: 10, _h: 10 });
  await check(page, '.n-cam__moon--se', { _w: 12, _h: 12 });
  const line = await check(page, '.n-cam__line', { 'font-size': 11, 'letter-spacing': em(11, 0.26), color: IV });
  expect(Number(line._top)).toBeCloseTo(580, 0);
  await check(page, '.n-cam__controls', { opacity: '0.6' });
  await check(page, '.n-cam__upload', { opacity: '0.6' });
}

/** C17: ORBES centred, the empty ring, the title, its sentence, the ivory button, the text link. */
async function problem(page: Page): Promise<void> {
  await check(page, '.n-message__body', { 'padding-top': 60, 'text-align': 'center' });
  await check(page, '.n-message .n-tone', { _w: 44, _h: 44 });
  await check(page, '.n-message .n-tone__ring', { 'stroke-width': '1.5px', stroke: IV });
  await check(page, '.n-message__title', { 'margin-top': 28, 'font-size': 16, 'letter-spacing': em(16, 0.14), 'line-height': 20.8, color: IV });
  await check(page, '.n-message__text', { 'margin-top': 14, 'font-size': 15, color: ASH });
  await check(page, '.n-message__actions', { 'margin-top': 32 });
  await check(page, '.n-message__actions .n-btn', { _h: 54, 'background-color': IV, color: GROUND });
  await check(page, '.n-message__second', { 'margin-top': 20 });
}

/** C9: the result's head, its GENOME, THE MODEL, its lines, its tabs, the OWNERSHIP panel signed out, the foot. */
async function firstRegistration(page: Page): Promise<void> {
  await check(page, '.n-result__head', { 'padding-top': 44, 'text-align': 'center' });
  await check(page, '.n-result .n-tone', { _w: 44, _h: 44 });
  await check(page, '.n-result .n-tone__core', { fill: IV });
  await check(page, '.n-result__title', { 'margin-top': 22, 'font-size': 30, 'line-height': 34.5, 'letter-spacing': em(30, 0.14), 'padding-left': em(30, 0.14), color: IV });
  await check(page, '.n-result__sub', { 'margin-top': 12, 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: ASH });
  await check(page, '.n-result__message', { 'margin-top': 16, 'padding-left': 24, 'font-size': 15, 'line-height': 23.25, color: ASH });
  // The GENOME (decision 12): 48 px under, its label, the 200 px figure with its glow, the id and the fingerprint.
  await check(page, '.n-result__genome', { 'margin-top': 48 });
  await check(page, '.n-gen__label', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: ASH });
  await check(page, '.n-gen__figure', { _w: 200, _h: 200, 'margin-top': 18 });
  await check(page, '.n-gen__figure .genome-svg', { filter: 'drop-shadow(rgba(246, 242, 234, 0.22) 0px 0px 18px)' });
  await check(page, '.n-gen__id', { 'margin-top': 18, 'font-size': 15, 'letter-spacing': em(15, 0.24), color: IV });
  const fp = await check(page, '.n-gen__fp', { 'margin-top': 8, 'font-size': 11.5, 'letter-spacing': em(11.5, 0.06), color: ASH });
  expect(fp._w).toBeDefined();
  // THE MODEL's photograph (decision 9): 48 px under, full width, 390 px, whole, no fade; its caption and sentence.
  await check(page, '.n-result__model', { 'margin-top': 48 });
  await check(page, '.n-result__photo', { _w: 390, _h: 390, 'background-color': 'rgb(21, 20, 19)' });
  await check(page, '.n-result__photo img', { 'object-fit': 'contain' });
  await check(page, '.n-result__photo', { content: 'none' }, '::after');
  await check(page, '.n-result .n-cap2', { 'padding-top': 12, 'padding-left': 24 });
  await check(page, '.n-result__photo-note', { 'margin-top': 14, 'font-size': 13, 'line-height': 18.85, color: ASH });
  // The model's name and the lines (SIZE among them), SEE THE MODEL 22 px under.
  await check(page, '.n-result__lines', { 'margin-top': 40 });
  await check(page, '.n-result__name', { 'font-size': 26, 'letter-spacing': em(26, 0.08), 'line-height': 29.12, color: IV });
  await check(page, '.n-result__line-list', { 'margin-top': 16, 'row-gap': 7 });
  await check(page, '.n-result__line-list .n-lines__line', { 'font-size': 11, 'letter-spacing': em(11, 0.24), color: ASH });
  await check(page, '.n-result__model-line', { 'margin-top': 22 });
  // The tabs spread across the column, OWNERSHIP open.
  await check(page, '.n-result__tabs', { 'margin-top': 48, 'padding-left': 24 });
  await check(page, '.n-tabsx', { 'justify-content': 'space-between', 'border-bottom-color': LINE });
  await check(page, '.n-tabsx__tab[aria-selected="false"]', { 'font-size': 10, 'letter-spacing': em(10, 0.22), color: ASH, 'padding-bottom': 14 });
  await check(page, '.n-tabsx__tab[aria-selected="true"]', { color: IV });
  await check(page, '.n-tabsx__tab[aria-selected="true"]', { height: 1, 'background-color': IV }, '::after');
  await check(page, '.n-result__tabs .n-tabs__panel:not([hidden])', { 'padding-top': 24 });
  // OWNERSHIP, signed out: REGISTRATION OPEN, its sentence, UNTIL, the sign-in.
  await check(page, '.n-own__status', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: IV });
  await check(page, '.n-own__text', { 'margin-top': 10, 'font-size': 15, color: ASH });
  await check(page, '.n-own__until', { 'margin-top': 14, 'font-size': 9.5, color: ASH });
  await check(page, '.n-own__lead', { 'margin-top': 18, 'font-size': 15, color: ASH });
  await check(page, '.n-own__switch', { 'margin-top': 20, 'column-gap': 22, 'border-bottom-color': LINE });
  await check(page, '.n-own__option[aria-pressed="true"]', { color: IV, 'font-size': 10, 'letter-spacing': em(10, 0.22) });
  await check(page, '.n-own__option[aria-pressed="true"]', { height: 1, 'background-color': IV }, '::after');
  await check(page, '.n-own .n-fld-group', { 'margin-top': 20 });
  await check(page, '.n-own .n-fld .n-lab', { 'font-size': 13, 'letter-spacing': em(13, 0.24), color: ASH });
  await check(page, '.n-own .n-fld__input', { _h: 44, 'border-bottom-color': LINE2, 'font-size': 16 });
  await check(page, '.n-own .form--signin .n-form__actions', { 'margin-top': 28 });
  await check(page, '.n-own .form--signin .n-btn', { _h: 54, 'background-color': IV, color: GROUND, 'font-size': 11, 'letter-spacing': em(11, 0.28) });
  await check(page, '.n-own__forgotten', { 'margin-top': 18, 'text-align': 'center' });
  // The foot: the assurance note, VERIFIED and REF, SCAN ANOTHER (the hairline button).
  await check(page, '.n-result__footnote', { 'margin-top': 36, 'font-size': 13, color: ASH });
  await check(page, '.n-result__meta', { 'margin-top': 22, 'justify-content': 'space-between' });
  await check(page, '.n-result__meta-item', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: ASH });
  const value = await check(page, '.n-result__meta-value', { 'letter-spacing': em(9.5, 0.04), color: IV });
  expect(value._w).toBeDefined();
  expect(isHelvetica((await read(page, '.n-result__meta-value', ['font-family']))['font-family']!)).toBe(true);
  await check(page, '.n-result__again', { 'margin-top': 26 });
  await check(page, '.n-result__again .n-btn', { _h: 54, 'background-color': NONE, color: IV, 'box-shadow': `${LINE2} 0px 0px 0px 1px inset` });
}

/** C14: OWNERSHIP of one's own piece: REGISTERED TO YOU, TRANSFER OF OWNERSHIP, CREATE TRANSFER CODE, the account line. */
async function yours(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'OWNERSHIP', exact: true }).click();
  await page.locator('.n-own__account').waitFor();
  await check(page, '.n-own__heading', { 'margin-top': 28, 'font-size': 11, 'letter-spacing': em(11, 0.26), color: IV });
  await check(page, '.n-own__action', { 'margin-top': 18, _h: 54, 'box-shadow': `${LINE2} 0px 0px 0px 1px inset` });
  await check(page, '.n-own__account', { 'margin-top': 22, 'line-height': 19, 'font-size': 9.5, color: ASH });
  await check(page, '.n-own__email', { 'font-size': 13, 'letter-spacing': 'normal', 'text-transform': 'none', color: IV });
  await check(page, '.n-own__link', { color: IV, 'text-decoration-line': 'underline', 'text-underline-offset': '3px' });
}

/**
 * C14: the account line with a long email (t.nguyen@example.com) wraps after a dot, never before one (`MY PIECES ·` /
 * `SIGN OUT`): MY PIECES and SIGN OUT are inline-blocks (their 44 px zones), a break on either side but for its span.
 */
async function accountLineWraps(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'OWNERSHIP', exact: true }).click();
  const line = page.locator('.n-own__account');
  await line.waitFor();
  expect(await line.locator('.n-own__email').textContent()).toBe('t.nguyen@example.com');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const { lines, leading } = await line.evaluate((el) => {
      // A dot starts a line when the last visible character before it sits on the line above.
      const centre = (n: Node, i: number): number | null => {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const rect = r.getClientRects()[0];
        return rect ? rect.top + rect.height / 2 : null;
      };
      const leading: string[] = [];
      let before: number | null = null;
      let seen = '';
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          const ch = text[i]!;
          seen += ch;
          if (/\s/.test(ch)) continue;
          const y = centre(n, i);
          if (y === null) continue;
          if (ch === '·' && before !== null && y - before > 8) leading.push(seen);
          before = y;
        }
      }
      return { lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), leading };
    });
    expect(lines, `${width} px`).toBeGreaterThan(1);
    expect(leading, `${width} px`).toEqual([]);
  }
}

/** C16: INVALID SIGNATURE: the void mark, the help line 36 px under the message, the contact, the report's row. */
async function invalid(page: Page): Promise<void> {
  await check(page, '.n-result .n-tone__ring', { 'stroke-width': '1.5px', stroke: IV });
  expect(await page.locator('.n-result .n-tone__core').count()).toBe(0);
  await check(page, '.n-result__help', { 'margin-top': 36, 'padding-left': 24 });
  await check(page, '.n-result__help .n-tx', { 'font-size': 15, 'line-height': 23.25, color: ASH });
  await check(page, '.n-contact', { 'margin-top': 14, 'row-gap': 8, 'font-size': 13, color: ASH });
  await check(page, '.n-contact .n-contact__email', { 'font-size': 10.5, 'letter-spacing': em(10.5, 0.22), color: IV, 'text-decoration-line': 'underline' });
  await check(page, '.n-report', { 'padding-top': 76 });
  await check(page, '.n-report__toggle', { 'padding-top': 20, 'padding-bottom': 20, 'border-top-color': LINE, 'border-bottom-color': LINE });
  await check(page, '.n-report__toggle .n-report__title', { 'font-size': 11, 'letter-spacing': em(11, 0.26), 'line-height': 16.5, color: IV });
  await check(page, '.n-report__toggle .n-report__lead', { 'margin-top': 4, 'font-size': 13, color: ASH });
  // `.C .acc .sm{margin-top:4px}` reaches the row's 16 px + too: 2 px below the row's centre, as C16 draws it.
  await check(page, '.n-report__toggle .n-ic--sm', { 'margin-top': 4, _w: 16, _h: 16 });
}

/** The header, the rail, the footer, the SCAN ring (C .hd .wm .acct .rail .foot .fl .snd .dbip .cr .scan), Safari's bars. */
async function chrome(page: Page): Promise<void> {
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#0a0a0a');
  await check(page, '.n-hd', { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', height: 56, 'padding-left': 22, 'padding-right': 12 });
  const wmFamily = (await read(page, '.n-wm', ['font-family']))['font-family']!;
  expect(isGravesend(wmFamily), wmFamily).toBe(true);
  await check(page, '.n-wm', { 'font-size': 14, 'letter-spacing': em(14, 0.46), 'text-transform': 'uppercase', 'font-weight': '500', color: IV });
  // The account button: TITANE, then the monogram, 28 px, in ivory (decision 11), named "Your account, TITANE".
  const acct = page.locator('.n-hd button.n-acct');
  expect(await acct.getAttribute('aria-label')).toBe('Your account, TITANE');
  expect((await acct.innerText()).trim()).toBe('TITANE');
  await check(page, '.n-hd button.n-acct', { display: 'flex', 'align-items': 'center', 'column-gap': 10, height: 44, 'padding-left': 10, 'padding-right': 10, 'font-size': 9.5, 'letter-spacing': em(9.5, 0.26), color: ASH });
  const mono = await check(page, '.n-hd button.n-acct svg.n-mono', { color: IV, _w: 28, _h: 28 });
  expect(Number(mono._w)).toBeCloseTo(28, 1);
  expect(await page.locator('.n-hd button.n-acct svg.n-mono').getAttribute('viewBox')).toBe('0 0 500 500');
  // The rail: 40 px, its hairline, the five chapters at 9.5 px, 0.16 em; the current one ivory and underlined, at its word.
  await check(page, '.n-rail', { display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-end', height: 40, 'padding-left': 22, 'padding-right': 22, 'border-bottom-width': 1, 'border-bottom-color': LINE, 'white-space': 'nowrap', 'overflow-x': 'clip' });
  expect(await page.locator('.n-rail a').allInnerTexts()).toEqual(['NOW', 'RELEASES', 'COLLECTION', 'CIRCLE', 'PIECES']);
  expect(await page.locator('.n-rail').getAttribute('aria-label')).toBe('Main');
  await check(page, '.n-rail__link:not([aria-current])', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.16), color: ASH, 'padding-bottom': 13 });
  await check(page, '.n-rail__link[aria-current="page"]', { color: IV });
  expect(await page.locator('.n-rail__link[aria-current="page"]').innerText()).toBe('PIECES');
  await check(page, '.n-rail__link[aria-current="page"]', { height: 1, 'background-color': IV, bottom: -1 }, '::after');
  // The word stands 13 px above the hairline, as the canvas sets it; its tap zone is 44 px high.
  const rail = await read(page, '.n-rail', []);
  const link = await read(page, '.n-rail__link[aria-current="page"]', []);
  expect(Number(rail._bottom) - 1 - Number(link._bottom)).toBeCloseTo(0, 1);
  expect(Number(link._h)).toBeGreaterThanOrEqual(44 - 0.05);
  // RELEASES' dot: a LIVE RELEASE is announced (the demo's blue one).
  await check(page, '.n-rail__live', { width: 5, height: 5, 'border-radius': '50%', 'background-color': IV, 'margin-left': 7, display: 'inline-block' });
  // The footer: the monogram 38 px, the legal links at 10 px, SOUND, DB-IP's attribution, © ORBES · PARIS in ash.
  await check(page, '.n-foot', { 'margin-top': 96, 'padding-top': 40, 'padding-left': 24, 'padding-right': 24, 'border-top-width': 1, 'border-top-color': LINE });
  await check(page, '.n-foot > svg.n-mono', { _w: 38, _h: 38, color: IV });
  await check(page, '.n-fl', { display: 'grid', 'column-gap': 22, 'row-gap': 12, 'margin-top': 30, 'font-size': 10, 'letter-spacing': em(10, 0.22), color: ASH, 'justify-content': 'start' });
  expect(await page.locator('.n-fl a').allInnerTexts()).toEqual(['PRIVACY', 'TERMS', 'LEGAL', 'HELP']);
  for (const target of await page.locator('.n-fl a').evaluateAll((els) => els.map((e) => e.getAttribute('target')))) expect(target).toBe('_blank');
  await check(page, '.n-snd', { 'font-size': 10, 'letter-spacing': em(10, 0.22), color: ASH, 'min-height': 44 });
  await check(page, '.n-snd__state', { color: IV, 'font-weight': '500' });
  expect(await page.getByRole('button', { name: 'SOUND', exact: true }).getAttribute('aria-pressed')).toBe('true');
  await check(page, '.n-foot__sound', { 'margin-top': 22 });
  await check(page, '.n-dbip', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.2), color: ASH, 'text-decoration-line': 'underline', 'text-underline-offset': 4 });
  await check(page, '.n-foot__credit', { 'margin-top': 18 });
  // The © line takes ash, not the canvas's smoke (under 4.5 : 1).
  const cr = await check(page, '.n-cr', { 'font-size': 9, 'letter-spacing': em(9, 0.24), 'margin-top': 18, color: ASH });
  expect(cr.color).not.toBe(SMOKE);
  expect(await page.locator('.n-cr').innerText()).toBe('© ORBES · PARIS');
  // The SCAN ring at the foot of the screen, over its fade.
  await check(page, '.n-scan', { position: 'fixed', bottom: 0, height: 132, display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'flex-end', 'padding-bottom': 22, 'background-image': 'linear-gradient(rgba(10, 10, 10, 0), rgb(10, 10, 10) 58%)' });
  await check(page, '.n-scan__ring', {
    width: 62,
    height: 62,
    'border-radius': '50%',
    // The rulebook's 1 px inset hairline only: no browser button border drawn over it.
    'border-top-width': 0,
    'border-right-width': 0,
    'border-bottom-width': 0,
    'border-left-width': 0,
    'background-color': GROUND,
    color: IV,
    'box-shadow': 'rgba(246, 242, 234, 0.62) 0px 0px 0px 1px inset, rgba(246, 242, 234, 0.14) 0px 0px 34px 0px',
  });
  await check(page, '.n-scan__ring svg', { width: 26, height: 26 });
  await check(page, '.n-scan__label', { 'margin-top': 9, 'font-size': 8.5, 'letter-spacing': em(8.5, 0.3), color: ASH, 'padding-left': em(8.5, 0.3) });
  expect(await page.locator('.n-scan__ring').getAttribute('aria-label')).toBe('Scan an ORBES code');
  // The view ends above the ring: the column keeps the canvas's 132 px at its foot.
  await check(page, 'body.nocturne .n-column', { 'padding-bottom': 132 });
}

/** The column on black, phone width at most on a computer (choice 5), its overhead light; the ground and the type. */
async function column(page: Page): Promise<void> {
  await check(page, 'body', { 'background-color': GROUND, color: IV, 'font-size': 15, 'line-height': '22.5px' });
  const family = (await read(page, 'body', ['font-family']))['font-family']!;
  expect(isHelvetica(family), family).toBe(true);
  await check(page, '.n-column', { height: 480, 'background-image': 'radial-gradient(120% 55% at 50% 0%, rgba(246, 242, 234, 0.1), rgba(10, 10, 10, 0) 62%)', top: 0 }, '::before');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: size.height });
  try {
    const col = await read(page, '.n-column', ['max-width']);
    expect(col['max-width']).toBe('480px');
    expect(Number(col._w)).toBeCloseTo(480, 1);
    expect(Number(col._left)).toBeCloseTo((1280 - 480) / 2, 1);
    const ring = await read(page, '.n-scan', []);
    expect(Number(ring._w)).toBeCloseTo(480, 1);
    expect(Number(ring._left)).toBeCloseTo(400, 1);
  } finally {
    await page.setViewportSize(size);
  }
}

/** C2: the sheet, its handle, its words, its rows, the switch, the dots, SIGN OUT (C .plate .handle .row .sw .meter .btn.ol). */
async function sheet(page: Page): Promise<void> {
  const panel = await check(page, '.n-account__panel', { 'background-color': PLATE, 'border-top-left-radius': '16px', 'border-top-right-radius': '16px', 'padding-bottom': 40 });
  // Under the header and the rail, 24 px down (56 + 40 + 24), the page dimmed above it.
  expect(Number(panel._top)).toBeCloseTo(120, 1);
  await check(page, '.n-account__scrim', { 'background-color': 'rgba(0, 0, 0, 0.55)' });
  expect(await page.locator('.n-account__panel').getAttribute('role')).toBe('dialog');
  expect(await page.locator('.n-account__panel').getAttribute('aria-modal')).toBe('true');
  // The handle, 40 × 4, on the plate's top edge and centred (as C2 draws it).
  const handle = await check(page, '.n-handle', { width: 40, height: 4, 'border-top-left-radius': '2px', 'background-color': LINE2 });
  expect(Number(handle._top)).toBeCloseTo(120, 1);
  expect(Number(handle._left) + 20).toBeCloseTo(195, 1);
  // YOUR ACCOUNT, SIGNED IN AS, YOUR TIER, NEXT: the label (9.5 px, 0.28 em, ash; NEXT in ivory).
  for (const sel of ['#account-title', '.n-account__tier > .n-lb']) await check(page, sel, { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: ASH, 'text-transform': 'uppercase' });
  await check(page, '.n-account__next-label', { color: IV, 'margin-top': 20 });
  await check(page, '.n-account__email', { 'font-size': 15, color: IV, 'margin-top': 6 });
  await check(page, '.n-account__tier', { 'margin-top': 30, 'padding-left': 24, 'padding-right': 24 });
  // TITANE (.t2: 16 px, 1.3, 0.14 em) and its pieces (.sm: 13 px, 1.45, ash), then the five dots.
  await check(page, '.n-account__tier-name', { 'font-size': 16, 'line-height': '20.8px', 'letter-spacing': em(16, 0.14), color: IV });
  await check(page, '.n-account__tier-pieces', { 'font-size': 13, 'line-height': '18.85px', color: ASH });
  await check(page, '.n-account__dots', { display: 'flex', 'column-gap': 10, 'justify-content': 'flex-start', 'margin-top': 12 });
  expect(await page.locator('.n-account__dots .n-meter__dot').count()).toBe(5);
  expect(await page.locator('.n-account__dots .n-meter__dot.is-on').count()).toBe(2);
  await check(page, '.n-account__dots .n-meter__dot.is-on', { width: 9, height: 9, 'border-radius': '50%', 'background-color': IV, 'box-shadow': 'none' });
  await check(page, '.n-account__dots .n-meter__dot:not(.is-on)', { width: 9, height: 9, 'background-color': NONE, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset' });
  await check(page, '.n-account__benefits', { 'margin-top': 10, 'row-gap': 6 });
  await check(page, '.n-account__benefit', { 'padding-left': 14, 'font-size': 13, color: ASH });
  await check(page, '.n-account__benefit', { content: '"–"', position: 'absolute', left: 0 }, '::before');
  // The rows: SOUND with its switch, CHANGE PASSWORD, MY PIECES, the legal pages; their hairlines; 10.5 px, 0.22 em words.
  await check(page, '.n-account__rows', { 'margin-top': 30, 'border-top-width': 1, 'border-top-color': LINE });
  expect(await page.locator('.n-account__rows .n-row__label').allInnerTexts()).toEqual(['SOUND', 'CHANGE PASSWORD', 'MY PIECES', 'PRIVACY · TERMS · LEGAL · HELP']);
  await check(page, '.n-account__rows .n-row', { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'column-gap': 14, 'padding-top': 16, 'padding-bottom': 16, 'padding-left': 24, 'padding-right': 24, 'border-bottom-width': 1, 'border-bottom-color': LINE, 'font-size': 15 });
  await check(page, '.n-account__rows .n-row__label', { 'font-size': 10.5, 'letter-spacing': em(10.5, 0.22) });
  await check(page, '.n-account__rows .n-row--lead svg', { width: 16, height: 16, 'stroke-width': '1.4px' });
  // The switch, on (the sound plays): 44 × 26, an ivory track, its knob of the ground at 21 px.
  expect(await page.getByRole('switch', { name: 'SOUND' }).isChecked()).toBe(true);
  await check(page, '.n-sw', { width: 44, height: 26 });
  await check(page, '.n-sw__track', { 'border-top-left-radius': '13px', 'background-color': IV });
  await check(page, '.n-sw__track', { width: 20, height: 20, top: 3, left: 21, 'background-color': GROUND, 'border-top-left-radius': '50%' }, '::after');
  // SIGN OUT: the hairline button, 54 px, 26 px under the rows.
  await check(page, '.n-account__out', { 'margin-top': 26 });
  await check(page, '.n-account__out .n-btn', { height: 54, 'background-color': NONE, color: IV, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset', 'font-size': 11, 'letter-spacing': em(11, 0.28) });
  const out = (await read(page, '.n-account__out .n-btn', ['font-family']))['font-family']!;
  expect(isGravesend(out), out).toBe(true);
  await check(page, '.n-account__close', { width: 44, height: 44 });
  await check(page, '.n-account__close svg', { width: 22, height: 22, 'stroke-width': '1.25px' });
  // The tap on the dimmed page closes it; focus returns to the account button.
  await page.keyboard.press('Escape');
  expect(await page.locator('.n-account').isHidden()).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('n-acct'))).toBe(true);
}

/** C39 in the sheet: the fields underlined on the dark, the ivory button beside CANCEL (C .fld .lab .btn .duo .tx). */
async function password(page: Page): Promise<void> {
  await check(page, '.n-account__password-lead', { 'font-size': 15, 'line-height': '23.25px', color: ASH, 'margin-top': 10 });
  await check(page, '.n-fld-group', { 'margin-top': 20 });
  await check(page, '.n-fld .n-lab', { display: 'block', 'font-size': 13, 'letter-spacing': em(13, 0.24), color: ASH, 'margin-bottom': 6, 'text-transform': 'uppercase' });
  // The first field has the focus (its line then turns ivory); the other at rest.
  await check(page, '.n-fld__input:focus', { 'border-bottom-color': IV });
  await check(page, '.n-fld__input:not(:focus)', { height: 44, 'border-bottom-width': 1, 'border-bottom-color': LINE2, 'border-top-width': 0, 'font-size': 16, color: IV, 'background-color': NONE, 'padding-left': 0 });
  await check(page, '.n-form__actions', { display: 'grid', 'column-gap': 10, 'margin-top': 22 });
  const cols = (await read(page, '.n-form__actions', ['grid-template-columns']))['grid-template-columns']!.split(' ');
  expect(cols).toHaveLength(2);
  expect(Number.parseFloat(cols[0]!)).toBeCloseTo(Number.parseFloat(cols[1]!), 1);
  await check(page, '.n-form__actions .n-btn:not(.n-btn--ol)', { height: 54, 'background-color': IV, color: GROUND, 'font-size': 11, 'letter-spacing': em(11, 0.28), 'justify-content': 'center' });
  expect(await page.locator('.n-form__actions .n-btn').allInnerTexts()).toEqual(['CHANGE PASSWORD', 'CANCEL']);
  await check(page, '.n-fld__hint', { 'font-size': 13, color: ASH, 'margin-top': 6 });
}

/** C40, the loading state (addition 14): the monogram, 40 px, breathing over 2.4 s, still under reduced motion; ONE MOMENT…. */
async function loading(page: Page): Promise<void> {
  const mono = await check(page, '.n-loading .n-breath', {
    'animation-name': 'n-breath',
    'animation-duration': '2.4s',
    'animation-timing-function': 'ease-in-out',
    'animation-iteration-count': 'infinite',
    color: IV,
    display: 'block',
    _w: 40,
    _h: 40,
  });
  expect(await page.locator('.n-loading .n-breath').getAttribute('aria-hidden')).toBe('true');
  const text = await check(page, '.n-loading__text', { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.28), color: IV, 'text-align': 'center', 'margin-top': 16 });
  expect(Number(text._top) - Number(mono._bottom)).toBeCloseTo(16, 1);
  expect(await page.locator('.n-loading__text').innerText()).toBe('ONE MOMENT…');
  // The status read aloud: a live region that is never marked busy (a busy live region holds its announcements).
  expect(await page.locator('.n-loading__text').getAttribute('role')).toBe('status');
  expect(await page.locator('.n-loading [aria-busy]').count()).toBe(0);
  // Its keyframes: 1 → 0.4 → 1.
  const frames = await page.evaluate(() => document.querySelector('.n-breath')!.getAnimations().map((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => [k.offset, k.opacity])));
  expect(frames).toEqual([[[0, '1'], [0.5, '0.4'], [1, '1']]]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await check(page, '.n-loading .n-breath', { 'animation-name': 'none' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

/** C40, could not be shown: the sentence in ivory, the reason in ash, TRY AGAIN the hairline button. */
async function failed(page: Page): Promise<void> {
  await check(page, '.n-failed', { 'text-align': 'center' });
  expect(await page.locator('.n-failed').getAttribute('role')).toBe('alert');
  await check(page, '.n-failed__sentence', { 'font-size': 15, 'line-height': '23.25px', color: IV });
  await check(page, '.n-failed__reason', { 'font-size': 13, 'line-height': '18.85px', color: ASH, 'margin-top': 8 });
  await check(page, '.n-failed .n-btn', { 'margin-top': 18, height: 54, 'background-color': NONE, color: IV, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset' });
  expect(await page.locator('.n-failed .n-btn').innerText()).toBe('TRY AGAIN');
}

/** C40, an empty page in its own words (.sm, left on the margin). */
async function empty(page: Page): Promise<void> {
  await check(page, '.pieces__empty', { 'font-size': 13, 'line-height': '18.85px', color: ASH, 'text-align': 'left', 'letter-spacing': 'normal' });
  const p = await read(page, '.pieces__empty', []);
  expect(Number(p._left)).toBeCloseTo(24, 1);
}

/** The pieces no screen holds yet, by their view code, into this screen (C .btn .tl .tabs .tabsx .switch2 .acc .dl .kv .fld .card .ph .fade .lift .cd .meter .vsel .fin .sizes .steps). */
async function pieces(page: Page, script: string): Promise<void> {
  await page.route('**/__nocturne-specimen.js', (route) => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.addScriptTag({ url: '/__nocturne-specimen.js' });
  await page.waitForFunction(() => document.documentElement.dataset.specimen === 'ready');
  const at = (piece: string, sel = '') => `[data-piece="${piece}"] ${sel}`.trim();
  // Buttons and a text link.
  await check(page, at('buttons', '.n-btn:not(.n-btn--ol)'), { height: 54, width: 342, 'background-color': IV, color: GROUND, 'font-size': 11, 'letter-spacing': em(11, 0.28), 'column-gap': 12 });
  await check(page, at('buttons', '.n-btn--ol'), { 'background-color': NONE, color: IV, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset' });
  const tl = await check(page, at('buttons', '.n-tl'), { display: 'inline-block', 'font-size': 10.5, 'letter-spacing': em(10.5, 0.26), 'padding-bottom': 5, 'border-bottom-width': 1, 'border-bottom-color': IV, color: IV });
  expect(Number(tl._h)).toBeGreaterThanOrEqual(44 - 0.05);
  // Tabs: MY PIECES' (30 px apart, 10.5 px, 0.24 em), a result's (spread across, 10 px, 0.22 em), SIGN IN's (22 px apart).
  await check(page, at('tabs', '.n-tabs'), { display: 'flex', 'column-gap': 30, 'border-bottom-width': 1, 'border-bottom-color': LINE });
  await check(page, at('tabs', '.n-tabs__tab[aria-selected="false"]'), { 'font-size': 10.5, 'letter-spacing': em(10.5, 0.24), color: ASH, 'padding-bottom': 14 });
  await check(page, at('tabs', '.n-tabs__tab[aria-selected="true"]'), { color: IV });
  await check(page, at('tabs', '.n-tabs__tab[aria-selected="true"]'), { height: 1, bottom: -1, 'background-color': IV }, '::after');
  await check(page, at('tabs', '.n-tabs__count'), { 'font-size': 10, 'margin-left': 6, top: -3, 'letter-spacing': 'normal', 'vertical-align': 'top' });
  expect(isHelvetica((await read(page, at('tabs', '.n-tabs__count'), ['font-family']))['font-family']!)).toBe(true);
  expect(await page.locator(at('tabs', '[role="tab"]')).count()).toBe(3);
  await check(page, at('tabsx', '.n-tabsx'), { 'justify-content': 'space-between', 'border-bottom-width': 1 });
  await check(page, at('tabsx', '.n-tabsx__tab'), { 'font-size': 10, 'letter-spacing': em(10, 0.22), 'padding-bottom': 14 });
  await check(page, at('switch2', '.n-switch2'), { 'column-gap': 22 });
  await check(page, at('switch2', '.n-switch2__tab'), { 'font-size': 10, 'letter-spacing': em(10, 0.22), 'padding-bottom': 12 });
  // Rows that open (+ / −) and lead on (›): 20 px above and below, a hairline under.
  await check(page, at('accordion', '.n-acc'), { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'column-gap': 16, 'padding-top': 20, 'padding-bottom': 20, 'border-bottom-width': 1, 'border-bottom-color': LINE });
  await check(page, at('accordion', '.n-acc__title'), { 'font-size': 11, 'letter-spacing': em(11, 0.26), color: IV });
  await check(page, at('accordion', '.n-acc__line:not(.n-acc__line--lb)'), { 'margin-top': 4, 'font-size': 13, color: ASH });
  expect(await page.locator(at('accordion', '.n-acc[aria-expanded]')).getAttribute('aria-expanded')).toBe('false');
  // Facts.
  await check(page, at('dl', '.n-dl__row'), { display: 'flex', 'justify-content': 'space-between', 'column-gap': 16, 'padding-top': 14, 'padding-bottom': 14, 'border-bottom-width': 1, 'border-top-width': 1, 'font-size': 14 });
  await check(page, at('dl', '.n-dl__label'), { color: ASH });
  await check(page, at('kv', '.n-kv__row'), { 'padding-top': 13, 'padding-bottom': 13, 'font-size': 13.5, 'border-bottom-width': 1 });
  await check(page, at('kv', '.n-kv__label'), { 'font-size': 9.5, 'letter-spacing': em(9.5, 0.24), color: ASH, 'padding-top': 2 });
  await check(page, at('kv', '.n-kv__value'), { 'text-align': 'right' });
  // A field.
  await check(page, at('field', '.n-lab'), { 'font-size': 13, 'letter-spacing': em(13, 0.24), color: ASH, 'margin-bottom': 6 });
  await check(page, at('field', 'input'), { height: 44, 'border-bottom-color': LINE2, 'font-size': 16, color: IV });
  // A plate card, its hairline frame inset 14 px.
  await check(page, at('card', '.n-card'), { 'background-color': PLATE, 'padding-top': 44, 'padding-left': 24, 'padding-right': 24, 'padding-bottom': 40, position: 'relative' });
  await check(page, at('card', '.n-card'), { top: 14, left: 14, right: 14, bottom: 14, 'box-shadow': 'rgba(246, 242, 234, 0.16) 0px 0px 0px 1px inset' }, '::before');
  // A photograph shown whole, full width, fading at its top (22 %) and its foot (46 %); the text rises 56 px onto it.
  const ph = await check(page, at('photo', '.n-ph'), { 'background-color': 'rgb(21, 20, 19)', position: 'relative', overflow: 'hidden', _h: 390 });
  expect(Number(ph._w)).toBeCloseTo(390, 1);
  await check(page, at('photo', '.n-ph > img'), { 'object-fit': 'contain', 'object-position': '50% 55%' });
  await check(page, at('photo', '.n-ph'), { height: 0.22 * 390, 'background-image': 'linear-gradient(rgb(10, 10, 10), rgba(10, 10, 10, 0))', top: 0, 'z-index': '1' }, '::before');
  await check(page, at('photo', '.n-ph'), { height: 0.46 * 390, 'background-image': 'linear-gradient(rgba(10, 10, 10, 0), rgb(10, 10, 10))', bottom: 0 }, '::after');
  await check(page, at('photo', '.n-lift'), { 'margin-top': -56, position: 'relative' });
  await check(page, at('photo', '.n-t1'), { 'font-size': 30, 'line-height': '33.6px', 'letter-spacing': em(30, 0.08) });
  // A countdown: figures in weight 200, their units under them, colons in smoke.
  await check(page, at('countdown', '.n-cd'), { display: 'flex', 'justify-content': 'center', 'align-items': 'flex-start', 'column-gap': 10, 'margin-top': 28 });
  await check(page, at('countdown', '.n-cd__group'), { 'min-width': 58 });
  await check(page, at('countdown', '.n-cd__value'), { 'font-size': 46, 'font-weight': '200', 'line-height': '46px', 'letter-spacing': em(46, 0.01) });
  expect(isHelvetica((await read(page, at('countdown', '.n-cd__value'), ['font-family']))['font-family']!)).toBe(true);
  await check(page, at('countdown', '.n-cd__unit'), { 'margin-top': 10, 'font-size': 8.5, 'letter-spacing': em(8.5, 0.24), color: ASH, 'padding-left': em(8.5, 0.24) });
  await check(page, at('countdown', '.n-cd__sep'), { 'font-size': 34, 'font-weight': '200', 'line-height': '37.4px', color: SMOKE, 'font-style': 'normal' });
  // The tier as five dots, centred.
  await check(page, at('dots', '.n-meter'), { display: 'flex', 'justify-content': 'center', 'column-gap': 10 });
  // Variant dots: 26 px apart, 12 px names, the selected one ringed.
  await check(page, at('variants', '.n-vsel'), { display: 'flex', 'justify-content': 'center', 'column-gap': 26 });
  await check(page, at('variants', '.n-vsel__option[aria-pressed="false"]'), { 'font-size': 12, color: ASH, 'row-gap': 9, 'min-width': 44, 'min-height': 44, 'flex-direction': 'column' });
  await check(page, at('variants', '.n-vsel__option[aria-pressed="true"]'), { color: IV });
  await check(page, at('variants', '.n-vsel__option[aria-pressed="false"] .n-vsel__dot'), { width: 16, height: 16, 'border-radius': '50%', 'box-shadow': 'rgba(246, 242, 234, 0.2) 0px 0px 0px 1px' });
  await check(page, at('variants', '.n-vsel__option[aria-pressed="true"] .n-vsel__dot'), { 'box-shadow': 'rgb(10, 10, 10) 0px 0px 0px 3px, rgb(246, 242, 234) 0px 0px 0px 4px' });
  // Each dot drawn from its swatch, the swatch at 55 %.
  expect((await read(page, at('variants', '.n-vsel__option[aria-pressed="true"] .n-vsel__dot'), ['background-image']))['background-image']).toMatch(/^linear-gradient\(135deg, rgb\(\d+, \d+, \d+\), rgb\(157, 155, 150\) 55%, rgb\(\d+, \d+, \d+\)\)$/);
  await check(page, at('variants', '.n-fin'), { display: 'flex', 'flex-wrap': 'wrap', 'row-gap': 8, 'column-gap': 18 });
  await check(page, at('variants', '.n-fin__item'), { 'font-size': 13, 'column-gap': 8 });
  await check(page, at('variants', '.n-fin__dot'), { width: 12, height: 12, 'border-radius': '50%' });
  // Size buttons: 78 × 54, 10 px apart, the selected one doubly ringed.
  await check(page, at('sizes', '.n-sizes'), { display: 'flex', 'justify-content': 'center', 'column-gap': 10 });
  await check(page, at('sizes', '.n-sizes__option[aria-pressed="false"]'), { width: 78, height: 54, 'font-size': 16, color: IV, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset' });
  await check(page, at('sizes', '.n-sizes__option[aria-pressed="true"]'), { 'box-shadow': 'rgb(246, 242, 234) 0px 0px 0px 1px inset, rgb(10, 10, 10) 0px 0px 0px 4px inset, rgb(246, 242, 234) 0px 0px 0px 5px inset' });
  // The steps of an order: four dots on a hairline, the bar to the step reached.
  await check(page, at('steps', '.n-steps'), { display: 'grid', position: 'relative' });
  await check(page, at('steps', '.n-steps'), { top: 5, left: 5, height: 1, 'background-color': LINE2 }, '::before');
  const steps = await read(page, at('steps', '.n-steps'), ['grid-template-columns']);
  expect(steps['grid-template-columns']!.split(' ')).toHaveLength(4);
  const before = await read(page, at('steps', '.n-steps'), ['right'], '::before');
  expect(Number.parseFloat(before.right!)).toBeCloseTo(Number(steps._w) * 0.25, 1);
  const bar = await check(page, at('steps', '.n-steps__bar'), { top: 5, left: 5, height: 1, 'background-color': IV });
  expect(Number(bar._w)).toBeCloseTo(Number(steps._w) * 0.25, 1);
  await check(page, at('steps', '.n-steps__step:not(.is-done) .n-steps__dot'), { width: 11, height: 11, 'border-radius': '50%', 'background-color': GROUND, 'box-shadow': 'rgba(246, 242, 234, 0.34) 0px 0px 0px 1px inset' });
  await check(page, at('steps', '.n-steps__step.is-done .n-steps__dot'), { 'background-color': IV, 'box-shadow': 'none' });
  await check(page, at('steps', '.n-steps__step:not(.is-done) .n-steps__label'), { 'margin-top': 12, 'font-size': 8.5, 'letter-spacing': em(8.5, 0.2), color: ASH });
  await check(page, at('steps', '.n-steps__step.is-done .n-steps__label'), { color: IV });
  await check(page, at('steps', '.n-steps__date'), { 'font-size': 12, color: ASH, 'margin-top': 4 });
  expect(await page.locator(at('steps', '[aria-current="step"]')).innerText()).toContain('PAID');
}
