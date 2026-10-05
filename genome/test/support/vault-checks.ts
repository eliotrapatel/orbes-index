/**
 * The checks of a LIVE RELEASE's screens in the vault (plan of 2026-10-04, Quality bar item 4), measured in a real page:
 * the text's contrast on what lies under it computed from the page's own colours (at least 4.5 : 1), at most one primary
 * action (filled ivory), no figure in the display face, and the floors of BRAND-DESIGN-SYSTEM §3.8 (tap-zones.ts).
 * Shared by the LIVE RELEASE's browser suites (verify.live.e2e.test.ts, verify.live-announce.e2e.test.ts).
 */
import type { Locator, Page } from 'playwright-core';
import { expect } from 'vitest';
import { tapZoneFloors } from './tap-zones.js';

/**
 * What a screen of the vault keeps: every text at 4.5 : 1 or more on what lies under it (its colour and opacity blended
 * over the backgrounds of its ancestors), at most one primary action filled ivory, no figure set in the display face.
 */
export async function screenChecks(page: Page): Promise<{ contrast: string[]; filled: string[]; figures: string[] }> {
  return page.evaluate(async () => {
    // Measured at rest: every animation that ends (a screen fading in, a reveal) has ended.
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)));
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const over = (top: RGBA, under: [number, number, number], alpha = top[3]): [number, number, number] => [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)) as [number, number, number];
    const lum = (c: [number, number, number]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const ground = (el: Element): [number, number, number] => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      let c: [number, number, number] = [255, 255, 255];
      for (const e of chain) c = over(parse(getComputedStyle(e).backgroundColor), c);
      return c;
    };
    const opacity = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const contrast: string[] = [];
    const figures: string[] = [];
    for (const el of document.querySelectorAll('main *')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
      if (!own || !el.checkVisibility() || el.closest('[aria-hidden="true"], .visually-hidden, :disabled')) continue;
      const style = getComputedStyle(el);
      const bg = ground(el);
      const fg = over(parse(style.color), bg, parse(style.color)[3] * opacity(el));
      const r = ratio(fg, bg);
      if (r < 4.5) contrast.push(`${own.slice(0, 40)}: ${r.toFixed(2)}`);
      if (/^"?Gravesend Sans/.test(style.fontFamily) && /[01]/.test(own)) figures.push(own);
    }
    const filled = [...document.querySelectorAll('main button, main a')]
      .filter((el) => el.checkVisibility() && getComputedStyle(el).backgroundColor === 'rgb(246, 242, 234)' && document.querySelector('.view--live.vault, .live-card'))
      .map((el) => norm(el.textContent ?? ''));
    function norm(t: string) {
      return t.replace(/\s+/g, ' ').trim();
    }
    return { contrast, filled, figures };
  });
}

/** A vault screen keeps its contrast, its one primary action at most, its figures in the reading face and the floors of §3.8. */
export async function keepsVault(page: Page, primary: string | null, controls: string[] = []): Promise<void> {
  const checks = await screenChecks(page);
  expect(checks.contrast).toEqual([]);
  expect(checks.figures).toEqual([]);
  expect(checks.filled).toEqual(primary ? [primary] : []);
  const floors = await tapZoneFloors(page);
  expect(floors.problems).toEqual([]);
  expect(floors.checked).toEqual(expect.arrayContaining(controls));
}

/**
 * Reach `target` from the keyboard (Tab), then measure its focus ring against the ground around it (the ring is drawn
 * outside the control): the contrast ratio of the ring's colour, the outline's or, where the outline is a mark inside
 * the control (the size chosen before ENTER), the outermost box-shadow's; 0 when no ring shows.
 */
export async function focusRingContrast(page: Page, target: Locator): Promise<number> {
  for (let i = 0; i < 80 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  return target.evaluate((el) => {
    if (el !== document.activeElement || !el.matches(':focus-visible')) return 0;
    type RGB = [number, number, number];
    const parse = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const over = (top: [number, number, number, number], under: RGB): RGB => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as RGB;
    const lum = (c: RGB) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    let ground: RGB = [255, 255, 255];
    const chain: Element[] = [];
    for (let e: Element | null = el.parentElement; e; e = e.parentElement) chain.unshift(e);
    for (const e of chain) ground = over(parse(getComputedStyle(e).backgroundColor), ground);
    const style = getComputedStyle(el);
    const outside = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && parseFloat(style.outlineOffset) >= 0;
    const shadows = style.boxShadow === 'none' ? [] : (style.boxShadow.match(/rgba?\([^)]*\)/g) ?? []);
    const ring = outside ? style.outlineColor : shadows.at(-1);
    if (!ring) return 0;
    const [hi, lo] = [lum(over(parse(ring), ground)), lum(ground)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  });
}
