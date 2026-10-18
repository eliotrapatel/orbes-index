/**
 * The desktop suites' shared ground (plan DESKTOP §2(j), step 13: test/web/desktop.chrome, desktop.pages and
 * desktop.flows .e2e.test.ts): a computer's window (a mouse, no touch: openState's `size`) in the four looks every suite
 * runs in (1440 × 900 and 1024 × 768, dark and light), the NOCTURNE stage of a demo variant over one web build per file,
 * the computer's own test read in the page, and the measures every desktop page is held to (no sideways scroll, no
 * label or button on two lines, one h1), with the errors a page logs.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll } from 'vitest';
import { buildWeb } from '../../scripts/build-web.js';
import type { DemoVariant, NocturneDemo } from '../support/nocturne-demo.js';
import { startNocturneStage, type NocturneStage } from '../support/nocturne-stage.js';
import { openState, settle, type OpenedState, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH, type UiStage } from '../support/ui-stage.js';

export const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
export const POLL = { timeout: 20_000, interval: 100 } as const;

/** A computer's window and mode. */
export interface Look {
  name: string;
  size: { width: number; height: number };
  light: boolean;
}

/** The four looks of the desktop suites (plan §3 step 13: 1440 × 900 and 1024 × 768, both modes). */
export const LOOKS: readonly Look[] = Object.freeze([
  { name: '1440 × 900, dark', size: { width: 1440, height: 900 }, light: false },
  { name: '1440 × 900, light', size: { width: 1440, height: 900 }, light: true },
  { name: '1024 × 768, dark', size: { width: 1024, height: 768 }, light: false },
  { name: '1024 × 768, light', size: { width: 1024, height: 768 }, light: true },
]);

/** `state` on a computer's window of `look` (its own id kept apart with the look's). */
export function inLook(state: UiState, look: Look): UiState {
  return { ...state, id: `${state.id} @ ${look.name}`, size: look.size, light: look.light || undefined, viewport: undefined, stress: undefined };
}

/** A page of the app as a state: its demo, account, address and what shows it is there. */
export function at(variant: DemoVariant, path: string | ((d: NocturneDemo) => string), ready: string, extra: Partial<UiState> = {}): UiState {
  return { id: typeof path === 'string' ? path : 'page', title: 'a desktop page', refs: ['desktop'], variant, path: typeof path === 'string' ? () => path : path, ready, ...extra };
}

/**
 * One web build for the file (built before its tests, removed after), and the way to a fresh stage of a demo variant
 * on it, closed once `run` is done.
 */
export function stages(): { withStage<T>(variant: DemoVariant, run: (st: NocturneStage) => Promise<T>): Promise<T> } {
  let workDir = '';
  let webDir = '';
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'orbes-desktop-'));
    webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production' });
  }, 180_000);
  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });
  return {
    async withStage(variant, run) {
      const st = await startNocturneStage(webDir, variant, workDir);
      try {
        return await run(st);
      } finally {
        await st.close();
      }
    },
  };
}

/** Open `state` in `look` on the stage `st`, its page's errors watched. */
export async function openIn(st: { browser: Browser; stage: UiStage; demo: NocturneDemo }, state: UiState, look: Look): Promise<OpenedState & { errors: string[] }> {
  const s = inLook(state, look);
  const errors: string[] = [];
  // The page's errors from its first line: watched on the context's pages as they open.
  const browser = new Proxy(st.browser, {
    get(target, prop) {
      if (prop === 'newContext')
        return async (o: Parameters<Browser['newContext']>[0]) => {
          const c = await target.newContext(o);
          await c.addInitScript({ content: CSP_REPORT });
          c.on('page', (p) => watchErrors(p, errors));
          return c;
        };
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const opened = await openState(browser, st.stage, st.demo, s);
  return Object.assign(opened, { errors });
}

/** A CSP violation said on the console (an init script: a string, so no transpiler helper reaches the page). */
export const CSP_REPORT = "document.addEventListener('securitypolicyviolation', (e) => console.error('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));";

/**
 * A page's errors: an uncaught exception, a console error, a CSP report. A request of the API the server refuses (4xx)
 * is not an error of the page, which says what it means (a draw's page asks /api/v1/live/<id> first, plan §2(m), D18;
 * an account without a piece asks THE CIRCLE and the salon's model); a 5xx is.
 */
export function watchErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url ?? '';
    // A request of the app's API the server refused (4xx): the browser says so; the page says what it means.
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && /\/api\/v1\//.test(url)) return;
    errors.push(`console: ${m.text()} (${url})`);
  });
}

/** What the page draws, read in the page itself. */
export interface Facts {
  /** The app's own test: a window of 1024 px or more with a fine pointer and hover, not marked a phone (`d-touch`). */
  desktop: boolean;
  touch: boolean;
  tap: boolean;
  light: boolean;
  /** The page scrolls sideways (its width past the window's). */
  sideways: string | null;
  /** Labels, buttons, tabs and the bar's and the foot's links set on more lines than their design (BRIEF §10.9). */
  wraps: string[];
  /** The page's visible h1s. */
  h1: string[];
}

export function facts(page: Page): Promise<Facts> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const vis = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0 && !el.closest('[hidden], [inert]');
    const range = document.createRange();
    /** The lines a control's words take: their text rectangles' middles more than 0.8 em apart. */
    const lines = (el: Element) => {
      const mids: number[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        if (!n.data.trim() || !n.parentElement || !vis(n.parentElement) || n.parentElement.closest('.visually-hidden, .n-vh')) continue;
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) if (b.width > 0.5 && b.height > 0.5) mids.push((b.top + b.bottom) / 2);
      }
      mids.sort((a, b) => a - b);
      const em = Number.parseFloat(getComputedStyle(el).fontSize) || 12;
      let count = mids.length ? 1 : 0;
      for (let i = 1; i < mids.length; i++) if (mids[i]! - mids[i - 1]! > em * 0.8) count++;
      return count;
    };
    const LABELS =
      'main :is(.n-btn, .n-tl, .n-lb, .n-lab, .n-crumb, .n-row__label, .n-kv__label, .n-tabs__tab, .d-orow__title, .btn, .textlink, .n-g:not(h1, h2, h3)), header :is(a, button), footer :is(a, button)';
    /**
     * The lines a label is set on by design: one, and one more for each part the layout puts on a line of its own (a
     * descendant laid out as a block, or after a <br>: a time under its date, a reveal's stage over its day).
     */
    const designed = (el: Element) => 1 + [...el.querySelectorAll('*')].filter((d) => d.tagName === 'BR' || (vis(d) && /^(block|flex|grid|list-item|table)$/.test(getComputedStyle(d).display) && !!(d.textContent ?? '').trim())).length;
    const wraps = [...document.querySelectorAll(LABELS)]
      .filter((el) => el instanceof HTMLElement && vis(el) && !el.closest('.n-art, .legal__body, p.n-tx, [role="tabpanel"][hidden]'))
      .filter((el) => lines(el) > designed(el))
      .map((el) => `«${((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}» (${String((el as HTMLElement).className).trim().split(/\s+/).slice(0, 3).join('.')})`);
    const width = root.clientWidth;
    return {
      desktop: matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches && !root.classList.contains('d-touch'),
      touch: root.classList.contains('d-touch'),
      tap: root.classList.contains('d-tap'),
      light: root.dataset.mode === 'light',
      sideways: root.scrollWidth > width + 1 ? `${root.scrollWidth} px for ${width}` : null,
      wraps,
      h1: [...document.querySelectorAll('h1')].filter(vis).map((h) => (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    };
  });
}

/**
 * The problems of a desktop page in `look` (none when it holds): not the computer's layout, not in the look's mode, a
 * sideways scroll, a label on two lines (but those `wrapsAllowed` names, each a wrap the design keeps), no h1 or more than
 * one; with `where` before each.
 */
export async function desktopProblems(page: Page, look: Look, where: string, opts: { wrapsAllowed?: readonly RegExp[]; h1?: boolean } = {}): Promise<string[]> {
  await settle(page, 200);
  const f = await facts(page);
  const out: string[] = [];
  if (!f.desktop || f.touch) out.push(`${where}: not the computer's layout`);
  if (f.light !== look.light) out.push(`${where}: in ${f.light ? 'light' : 'dark'} for ${look.light ? 'light' : 'dark'}`);
  if (f.sideways) out.push(`${where}: scrolls sideways (${f.sideways})`);
  for (const w of f.wraps) if (!(opts.wrapsAllowed ?? []).some((re) => re.test(w))) out.push(`${where}: on two lines: ${w}`);
  if ((opts.h1 ?? true) && f.h1.length !== 1) out.push(`${where}: ${f.h1.length} h1 (${f.h1.join(' | ')})`);
  return out;
}

/** Words folded as the app's are compared: whitespace (no-break spaces included) to one space, trimmed. */
export const norm = (t: string) => t.replace(/[\s ]+/g, ' ').trim();
