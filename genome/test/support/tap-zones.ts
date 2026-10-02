/**
 * The floors of BRAND-DESIGN-SYSTEM §3.8, measured in a real page once its
 * fonts have loaded: every visible button, link and tab is a tap zone of at
 * least 44 × 44 CSS px, set in type of at least 10 px; field labels are at
 * least 10 px; no two tap zones overlap (the zones are grown with transparent
 * padding, so they could); nothing scrolls sideways.
 *
 * Shared by the verify E2E suites (test/web/verify.e2e.test.ts and
 * test/e2e/fallbacks.test.ts), which call it on each screen at the phone
 * viewport.
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

export async function tapZoneFloors(page: Page): Promise<TapZoneReport> {
  return page.evaluate(
    async ({ zone, type }) => {
      await document.fonts.ready;
      const name = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.tagName.toLowerCase();
      const targets = [...document.querySelectorAll('button, a[href], [role="tab"]')].filter((el) => el.checkVisibility());
      const problems: string[] = [];
      const boxes = targets.map((el) => {
        const r = el.getBoundingClientRect();
        const px = Number.parseFloat(getComputedStyle(el).fontSize);
        // Sub-pixel layout: 43.99 is 44.
        if (r.width < zone - 0.05 || r.height < zone - 0.05) problems.push(`${name(el)}: tap zone ${r.width.toFixed(1)} × ${r.height.toFixed(1)} px`);
        if (px < type) problems.push(`${name(el)}: type ${px} px`);
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
    { zone: TAP_ZONE_PX, type: ACTION_TYPE_PX },
  );
}
