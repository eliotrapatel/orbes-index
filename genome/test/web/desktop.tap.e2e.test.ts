/**
 * A computer with a touch screen (the owner's answer Q2, plan §2(e), step 7): a Windows laptop with touch points has the
 * desktop layout, marked `html.d-tap` before the first paint (shared/mode-early.ts), and every desktop control it shows
 * reaches the phone's 44 px floor where a finger lands (shared/desktop-tap.css; its declarations are held by
 * verify.brand.test.ts). This suite measures it in the page, as step 7's check did over every state: each control is
 * hit-tested at its centre and 21.5 px above, below, left and right of it (a 44 px zone centred, within a pixel's
 * rounding), at 1440 × 900 and 1024 × 768.
 *
 * The states are those that show each control the sheet extends (the bar's ORBES, its menu and account, the footer's
 * links and THE CLUB, SEE THE MODEL, a piece's and a wishlist's name, an address's EDIT / MAKE DEFAULT / REMOVE, READ,
 * the room's links at its foot, the legal pages' sections) with every other control on them; a control added later
 * under 44 px on these pages fails here. Kept as they are, as on the phone: a link inside a sentence (the legal pages'
 * text), and two controls closer than 44 px, which share the space between them (the legal pages' sections 37 px
 * apart, rows that touch, a question's answers, the room's SOUND next to DB-IP). A control a list that scrolls on its own
 * holds (the legal pages' sections in a window 768 px high) is tested scrolled into view. Step 13's desktop suites
 * open every desktop state.
 */
import { existsSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { eachState } from '../support/nocturne-stage.js';
import { openState, settle, UI_STATES } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
/** A Windows touch laptop's navigator: ten touch points, its system named, a mouse or a trackpad for its main pointer. */
const TOUCH_LAPTOP = `(() => {
  const def = (k, v) => Object.defineProperty(Navigator.prototype, k, { get: () => v, configurable: true });
  def('maxTouchPoints', 10);
  def('platform', 'Win32');
  def('userAgentData', { platform: 'Windows', mobile: false, brands: [], getHighEntropyValues: async () => ({}) });
})();`;

/** A browser whose new contexts are a Windows touch laptop's (openState's own options, its user agent and navigator). */
function touchLaptop(browser: Browser): Browser {
  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext')
        return async (o: Record<string, unknown> = {}) => {
          const c = await target.newContext({ ...o, userAgent: WINDOWS_UA });
          await c.addInitScript({ content: TOUCH_LAPTOP });
          return c;
        };
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Each state, and the classes of the controls the sheet extends that it must show (so each one is measured). */
const STATES: Readonly<Record<string, readonly string[]>> = {
  'now-signed-in': ['n-wm', 'n-rail__link', 'n-acct', 'n-fl__link', 'n-foot__club-link'],
  'now-messages': ['now__messages-read'],
  draw: ['n-release__see'],
  pieces: ['d-ptile__name'],
  'pieces-question-after': ['question__answer'],
  wishlist: ['d-wish__name'],
  'account-addresses': ['n-account__address-link'],
  room: ['legal-links__link'],
  'legal-terms': ['d-legal__link'],
};
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

interface Control {
  sig: string;
  classes: string[];
  text: string;
  w: number;
  h: number;
  inline: boolean;
  /** Where each sample landed: ok, offscreen, the element it landed on, or `next:<centres' distance>:<in its box>:<control>`. */
  res: Record<string, string>;
}
interface Measured {
  mark: { tap: boolean; touch: boolean; desktop: boolean };
  controls: Control[];
  /** Controls the page shows that no position let the check reach. */
  untested: string[];
}

/**
 * Every control the page shows, hit-tested where a finger lands (step 7's check, tap7.mts): the page scrolled by half
 * windows, each control tested near the middle of the window (never under the sticky bar, the bar's own at the top)
 * and whole inside any box that clips it; a control no position reached (a row of a list that scrolls on its own, past
 * its foot) is then scrolled into view and tested.
 */
function measure(page: Page): Promise<Measured> {
  return page.evaluate(async () => {
    const R = 21.5;
    const SEL = 'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], [tabindex]:not([tabindex="-1"]), label:has(> input)';
    const root = document.documentElement;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const sig = (el: Element | null): string => {
      if (!el) return 'none';
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || (Number(cs.opacity) === 0 && !el.matches('input'))) return false;
      if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || cs.pointerEvents === 'none') return false;
      return el.getAttribute('role') !== 'tabpanel';
    };
    const owns = (c: Element, at: Element | null): boolean => {
      if (!at) return false;
      if (c === at || c.contains(at)) return true;
      // A label of the control, or the control a label holds.
      if (at instanceof HTMLLabelElement && (at.control === c || at.contains(c))) return true;
      return c instanceof HTMLLabelElement && !!c.control && (c.control === at || c.control.contains(at));
    };
    const all = [...document.querySelectorAll(SEL)].filter(visible);
    // A control inside another (a visually hidden input in its label aside) is tested once, as the outer control.
    const controls = all.filter((el) => !all.some((o) => o !== el && o.contains(el) && !(o instanceof HTMLLabelElement && el instanceof HTMLInputElement)));
    const done = new Map<Element, Control>();
    const ih = innerHeight;
    /** Whether the control is whole inside every box that clips it. */
    const unclipped = (c: Element, r: DOMRect) => {
      for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5) return false;
      }
      return true;
    };
    /** Tests `c` where it stands, when its zone fits the window between `lo` and `hi`. */
    const test = (c: Element, lo: number, hi: number) => {
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cy < lo || cy > hi || cy - R < 0 || cy + R > ih || !unclipped(c, r)) return;
      const pts: Record<string, [number, number]> = { c: [cx, cy], up: [cx, cy - R], down: [cx, cy + R], left: [cx - R, cy], right: [cx + R, cy] };
      const res: Record<string, string> = {};
      for (const [k, [x, y]] of Object.entries(pts)) {
        if (x < 0 || x >= innerWidth) {
          res[k] = 'offscreen';
          continue;
        }
        const at = document.elementFromPoint(x, y);
        if (owns(c, at)) {
          res[k] = 'ok';
          continue;
        }
        const other = at?.closest(SEL);
        if (other && controls.includes(other)) {
          const o = other.getBoundingClientRect();
          const d = k === 'up' || k === 'down' ? Math.abs(o.top + o.height / 2 - cy) : Math.abs(o.left + o.width / 2 - cx);
          const inBox = x >= o.left && x <= o.right && y >= o.top && y <= o.bottom;
          res[k] = `next:${Math.round(d * 10) / 10}:${inBox ? 'box' : 'zone'}:${sig(other)}`;
        } else res[k] = sig(at);
      }
      const parent = c.parentElement;
      done.set(c, {
        sig: sig(c),
        classes: [...c.classList],
        text: ((c as HTMLElement).innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        inline: getComputedStyle(c).display === 'inline' && !!parent && /\S/.test([...parent.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')),
        res,
      });
    };
    const sh = root.scrollHeight;
    const positions: number[] = [];
    for (let y = 0; ; y += Math.round(ih / 2)) {
      positions.push(Math.min(y, Math.max(0, sh - ih)));
      if (y + ih >= sh) break;
    }
    for (const [i, y] of positions.entries()) {
      window.scrollTo(0, y);
      await sleep(140);
      const lo = i === 0 ? 0 : ih * 0.25;
      const hi = i === positions.length - 1 ? ih : ih * 0.75;
      for (const c of controls) if (!done.has(c)) test(c, lo, hi);
    }
    for (const c of controls) {
      if (done.has(c)) continue;
      c.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(140);
      test(c, ih * 0.25, ih * 0.75);
    }
    window.scrollTo(0, 0);
    return {
      mark: {
        tap: root.classList.contains('d-tap'),
        touch: root.classList.contains('d-touch'),
        desktop: matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches,
      },
      controls: [...done.values()],
      untested: controls.filter((c) => !done.has(c)).map(sig),
    };
  });
}

/**
 * The samples of a control that miss it. Kept as they are, as on the phone: a link inside a sentence is the
 * sentence's; a sample on the control beside it is shared space when the two centres are 44 px apart or less (as step
 * 7 counted it); the legal pages' sections are rows that touch, 37 px apart, one on two lines here and there, so a
 * section's sample in the box of the section beside it is shared space too (neither can reach into the other); and on
 * an axis where the control is 44 px already (to within half a pixel), its very edge may round onto what is beside it.
 */
function misses(c: Control): string[] {
  if (c.inline) return [];
  const out: string[] = [];
  for (const [k, x] of Object.entries(c.res)) {
    if (x === 'ok' || x === 'offscreen') continue;
    if (x.startsWith('next:')) {
      const [, d, where, other] = x.split(':');
      if (Number.parseFloat(d!) <= 44.5) continue;
      if (where === 'box' && c.classes.includes('d-legal__link') && other!.split('.').includes('d-legal__link')) continue;
    }
    const whole = ((k === 'up' || k === 'down') && c.h >= 43.5) || ((k === 'left' || k === 'right') && c.w >= 43.5);
    if (whole && c.res.c === 'ok') continue;
    out.push(`${k} on ${x}`);
  }
  return out;
}

describe.skipIf(!HAS_CHROMIUM)('a computer with a touch screen (html.d-tap, Q2): every control reaches 44 px in the page (Chromium)', () => {
  it(
    'gives each control a finger can tap 44 px, or shares the space with the control beside it, at 1440 × 900 and 1024 × 768',
    async () => {
      const found: string[] = [];
      const states = Object.keys(STATES).map((id) => UI_STATES.find((s) => s.id === id)!);
      expect(states.every(Boolean)).toBe(true);
      await eachState(
        states,
        async (state, { stage, demo, browser }) => {
          // Opened once (some of these states write to the demo), then the same page made smaller.
          const opened = await openState(touchLaptop(browser), stage, demo, { ...state, size: { ...SIZES[0] } });
          try {
            for (const size of SIZES) {
              const where = `${state.id} at ${size.width} × ${size.height}`;
              await opened.page.setViewportSize({ ...size });
              await opened.page.mouse.move(size.width - 4, Math.round(size.height / 2));
              await settle(opened.page, 400);
              const m = await measure(opened.page);
              if (!m.mark.tap || m.mark.touch || !m.mark.desktop) found.push(`${where}: marked ${JSON.stringify(m.mark)}, not the desktop with d-tap`);
              for (const cls of STATES[state.id]!) if (!m.controls.some((c) => c.classes.includes(cls))) found.push(`${where}: no .${cls} measured`);
              for (const u of m.untested) found.push(`${where}: ${u} could not be reached`);
              for (const c of m.controls) {
                const miss = misses(c);
                if (miss.length) found.push(`${where}: ${c.sig} «${c.text}» ${c.w} × ${c.h} px, a finger misses it ${miss.join(', ')}`);
              }
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    10 * 60_000,
  );
});
