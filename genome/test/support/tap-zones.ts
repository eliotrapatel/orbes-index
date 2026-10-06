/**
 * The floors of BRAND-DESIGN-SYSTEM §3.8, measured in a real page once its
 * fonts have loaded: every visible button, link and tab is a tap zone of at
 * least 44 × 44 CSS px, set in type of at least 10 px; field labels are at
 * least 10 px; no two tap zones overlap (the zones are grown with transparent
 * padding, so they could); no control's label breaks onto a second line (a
 * zone can stay 44 px high around a label that has wrapped, so its size
 * cannot say it: its line boxes do); nothing scrolls sideways.
 *
 * Shared by the verify E2E suites (test/web/verify.e2e.test.ts and
 * test/e2e/fallbacks.test.ts), which call it on each screen at the phone
 * viewport, and by the legal pages' (test/web/legal.e2e.test.ts), which
 * leave out the links inside a sentence (`skip`): a word of a sentence is
 * not a control, and WCAG 2.5.8 exempts it from a target size.
 *
 * NOCTURNE (its rulebook, nocturne-ref/build.py, validated by the owner, who
 * declined larger labels) sets four controls at 9.5 px: the account button
 * (`.acct`), the rail's chapters (`.rail a`), DB-IP's attribution (`.dbip`)
 * and the banner of the LIVE RELEASES (`.banner`). They are held to that size
 * (RULEBOOK_TYPE), and to the 44 px zone like every other. The banner is a
 * line of text that wraps as C3 draws it, a long name whole (RULEBOOK_WRAPS):
 * its label may take two lines.
 */
import type { Page } from 'playwright-core';

export const TAP_ZONE_PX = 44;
export const ACTION_TYPE_PX = 10;
/** The controls NOCTURNE's rulebook sets under 10 px, by selector, and their size. */
export const RULEBOOK_TYPE: Readonly<Record<string, number>> = Object.freeze({ '.n-acct': 9.5, '.n-rail__link': 9.5, '.n-dbip': 9.5, '.live-banner': 9.5 });
/** The controls whose label the rulebook lets wrap (C3's banner: `LIVE RELEASE · <name> ·` over `OPENS IN <countdown>`). */
export const RULEBOOK_WRAPS = '.live-banner';

export interface TapZoneReport {
  /** The names of the controls measured (their text), in document order. */
  checked: string[];
  /** One line per breach; empty when the screen keeps the floors. */
  problems: string[];
}

export async function tapZoneFloors(page: Page, opts: { skip?: string } = {}): Promise<TapZoneReport> {
  return page.evaluate(
    async ({ zone, type, skip, rulebookType, wraps }) => {
      await document.fonts.ready;
      const name = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.tagName.toLowerCase();
      /** The lines the element's text takes: its text fragments, a new line each time one starts below all those before it. */
      const linesOf = (el: Element) => {
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          rects.push(...[...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5));
        }
        rects.sort((a, b) => a.top - b.top);
        let lines = 0;
        let bottom = -Infinity;
        for (const r of rects) {
          if (r.top >= bottom - 1) lines += 1;
          bottom = Math.max(bottom, r.bottom);
        }
        return lines;
      };
      // What can be tapped: visible, and not under a modal sheet (an inert page is out of reach until it closes).
      const targets = [...document.querySelectorAll('button, a[href], [role="tab"]')].filter((el) => el.checkVisibility() && !el.closest('[inert]') && !(skip && el.matches(skip)));
      const problems: string[] = [];
      const boxes = targets.map((el) => {
        const r = el.getBoundingClientRect();
        const px = Number.parseFloat(getComputedStyle(el).fontSize);
        // Sub-pixel layout: 43.99 is 44.
        if (r.width < zone - 0.05 || r.height < zone - 0.05) problems.push(`${name(el)}: tap zone ${r.width.toFixed(1)} × ${r.height.toFixed(1)} px`);
        const rulebook = Object.entries(rulebookType).find(([sel]) => el.matches(sel))?.[1];
        if (rulebook !== undefined ? px !== rulebook : px < type) problems.push(`${name(el)}: type ${px} px`);
        const lines = linesOf(el);
        if (lines > 1 && !el.matches(wraps)) problems.push(`${name(el)}: its label takes ${lines} lines`);
        let floating = false;
        for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') floating = true;
        return { name: name(el), r, floating };
      });
      for (const label of document.querySelectorAll('label')) {
        if (!label.checkVisibility()) continue;
        const px = Number.parseFloat(getComputedStyle(label).fontSize);
        if (px < type) problems.push(`label ${name(label)}: type ${px} px`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          // A control that floats over the page (NOCTURNE's SCAN ring, fixed at the foot of the screen) meets whatever
          // the page scrolls under it: the page keeps room at its end, so nothing stays under it once scrolled.
          if (boxes[i].floating !== boxes[j].floating) continue;
          const a = boxes[i].r;
          const b = boxes[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 0.5 && h > 0.5) problems.push(`${boxes[i].name} overlaps ${boxes[j].name}`);
        }
      }
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      if (overflow > 0) problems.push(`the page scrolls sideways by ${overflow} px`);
      return { checked: boxes.map((b) => b.name), problems };
    },
    { zone: TAP_ZONE_PX, type: ACTION_TYPE_PX, skip: opts.skip ?? '', rulebookType: RULEBOOK_TYPE, wraps: RULEBOOK_WRAPS },
  );
}
