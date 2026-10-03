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
 */
import type { Page } from 'playwright-core';

export const TAP_ZONE_PX = 44;
export const ACTION_TYPE_PX = 10;

export interface TapZoneReport {
  /** The names of the controls measured (their text), in document order. */
  checked: string[];
  /** One line per breach; empty when the screen keeps the floors. */
  problems: string[];
}

export async function tapZoneFloors(page: Page, opts: { skip?: string } = {}): Promise<TapZoneReport> {
  return page.evaluate(
    async ({ zone, type, skip }) => {
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
      const targets = [...document.querySelectorAll('button, a[href], [role="tab"]')].filter((el) => el.checkVisibility() && !(skip && el.matches(skip)));
      const problems: string[] = [];
      const boxes = targets.map((el) => {
        const r = el.getBoundingClientRect();
        const px = Number.parseFloat(getComputedStyle(el).fontSize);
        // Sub-pixel layout: 43.99 is 44.
        if (r.width < zone - 0.05 || r.height < zone - 0.05) problems.push(`${name(el)}: tap zone ${r.width.toFixed(1)} × ${r.height.toFixed(1)} px`);
        if (px < type) problems.push(`${name(el)}: type ${px} px`);
        const lines = linesOf(el);
        if (lines > 1) problems.push(`${name(el)}: its label takes ${lines} lines`);
        return { name: name(el), r };
      });
      for (const label of document.querySelectorAll('label')) {
        if (!label.checkVisibility()) continue;
        const px = Number.parseFloat(getComputedStyle(label).fontSize);
        if (px < type) problems.push(`label ${name(label)}: type ${px} px`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
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
    { zone: TAP_ZONE_PX, type: ACTION_TYPE_PX, skip: opts.skip ?? '' },
  );
}
