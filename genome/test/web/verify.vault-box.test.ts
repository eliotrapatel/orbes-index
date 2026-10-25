/**
 * THE VAULT's object and its opening (lot Q3, step Q3.10; plan §3.1, §3.2, §3b; src/web/verify/vault/): the box built
 * as the vault reference publishes it (vault/the-vault.html: its markup, THE / VAULT and FOR YOU letter by letter, the
 * monogram engraved, no number), its stylesheet (FOR YOU hidden while sealed, the focus ring in the box's own grey, a door
 * of THE VAULT page without its line, hint and OPEN ANOTHER), the gesture and the timeline on the page's own clock
 * (Playwright's clock in Chromium: FOR YOU marked 1000 ms after the hold first passes 0.02, --fyd what is left of that
 * second when the opening starts before it, cleared on an early let-go; nothing of the opening while the server draws;
 * the timeline from its answer, × 1.4 and the rarer tone for a rare reward, the vibration at 2 s × k; OPEN ANOTHER under
 * the reward once open, closing the box), and the page's dim (house.css, desktop-room.css: MK's vo-pagedim on SOLD OUT
 * and the end page only). vitest runs in node: the modules are bundled with esbuild and run in Chromium (skipped, not
 * failed, without it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VAULT } from '../../src/web/verify/copy.js';
import { SFX_AT } from '../../src/web/verify/live-sound.js';
import { DOOR_WORDS, LID_WORDS } from '../../src/web/verify/vault/emblem.js';
import { FOR_YOU_MS, HOLD_MS, OPENING_MS, RARE_K, RESET_MS, VIBRATE_AT_S } from '../../src/web/verify/vault/vault-opening.js';
import { CHROMIUM_PATH, launchChromium } from './verify.harness.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../src/web');
const VAULT_CSS = readFileSync(join(SRC, 'verify/vault/vault.css'), 'utf8');
const HOUSE_CSS = readFileSync(join(SRC, 'verify/house.css'), 'utf8');
const ROOM_CSS = readFileSync(join(SRC, 'shared/desktop-room.css'), 'utf8');

/** The page's side of the test: a box mounted at `place`, its server answer and its sounds recorded. */
const PAGE_SCRIPT = `
import { vaultBox } from ${JSON.stringify(join(SRC, 'verify/vault/vault-box.ts'))};
import { VaultOpening } from ${JSON.stringify(join(SRC, 'verify/vault/vault-opening.ts'))};
const t = (globalThis.T = { cues: [], primes: [], buzz: [], opens: 0, again: 0, answer: null, fail: null });
t.mount = (place, phone) => {
  const parts = vaultBox(place, phone);
  const frame = document.createElement('div');
  frame.className = 'frame';
  frame.append(parts.root);
  document.body.replaceChildren(frame);
  t.parts = parts;
  t.opening = new VaultOpening(parts, {
    open: () => { t.opens++; return new Promise((ok, ko) => { t.answer = ok; t.fail = ko; }); },
    sound: { prime: (set) => t.primes.push(set), cue: (passage, o) => t.cues.push({ passage, at: Math.round((o && o.base) || 0) }) },
    messageOf: (e) => String(e && e.message),
    vibrate: (p) => t.buzz.push({ at: Math.round(performance.now()), pattern: [...p] }),
    onAgain: () => t.again++,
  });
};
`;

const PAGE_CSS = readFileSync(join(SRC, 'verify/vault/vault-page.css'), 'utf8');

/** THE VAULT page (lot Q3, step Q3.11) mounted with its data as read and its openings answered by the test. */
const VAULT_PAGE_SCRIPT = `
import { vaultPageView } from ${JSON.stringify(join(SRC, 'verify/views/vault-page.ts'))};
const t = (globalThis.P = { answers: [] });
const door = (id, line, day) => ({ id, source: 'LIVE', label: 'YOUR SIZE SOLD OUT', detail: 'MONOLITHE IN BLUE', line, givenAt: '2026-10-05T16:47:00Z', waitsUntil: day + 'T22:00:00Z', waitsUntilDay: day });
t.mount = () => {
  const view = vaultPageView({
    api: { openVault: () => new Promise((ok) => t.answers.push(ok)), vaults: () => Promise.reject(new Error('unused')), vaultInvite: () => Promise.reject(new Error('unused')) },
    session: { ensure: async () => ({ status: 'signed-in' }), noteError: () => {}, subscribe: () => () => {} },
    sound: { prime: () => {}, cue: () => {} },
    onSignIn: () => {},
    onPieces: () => {},
    onProfile: () => {},
    read: async () => ({
      waiting: [door('a', 'YOUR SIZE SOLD OUT · MONOLITHE IN BLUE', '2026-11-04'), door('b', 'A NEW TIER · PLATINE', '2026-11-04')],
      opened: [],
      ledger: [{ source: 'HOUSE' }],
      waitingCount: 2,
      grid: [],
    }),
  });
  document.body.className = 'nocturne';
  document.body.replaceChildren(view.root);
};
`;

describe.skipIf(!HAS_CHROMIUM)('THE VAULT\'s box and its opening (lot Q3, step Q3.10; Chromium)', () => {
  let browser: Browser;
  let bundle = '';

  beforeAll(async () => {
    const out = await build({ stdin: { contents: PAGE_SCRIPT, resolveDir: HERE, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.mp3': 'file' }, outdir: '/tmp/unused' });
    bundle = out.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
    browser = await launchChromium();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** A page with the box mounted at `place` (`reduced`: prefers-reduced-motion), its clock Playwright's. */
  async function boxAt(place: 'soldOut' | 'end' | 'page', opts: { phone?: boolean; reduced?: boolean } = {}): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-05T16:49:00Z') });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addStyleTag({ content: `${VAULT_CSS}\nbody { margin: 0; background: #0a0a0a; color: #f6f2ea; } .frame { width: 326px; margin: 0 auto; }` });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(([p, phone]) => (globalThis as unknown as { T: { mount(p: string, phone: boolean): void } }).T.mount(p as string, phone as boolean), [place, opts.phone ?? true] as const);
    return page;
  }

  const state = (page: Page) =>
    page.evaluate(() => {
      const t = (globalThis as unknown as { T: Record<string, unknown> & { parts: { vlt: HTMLElement; again: HTMLElement; lead: HTMLElement; hint: HTMLElement } } }).T;
      const v = t.parts.vlt;
      const shown = (e: Element) => e.getClientRects().length > 0 && Number(getComputedStyle(e).opacity) > 0;
      const forYou = v.querySelector('.vo-dopen__for')!;
      return {
        classes: [...v.classList].filter((c) => c !== 'vlt').sort(),
        p: v.style.getPropertyValue('--p'),
        fyd: v.style.getPropertyValue('--fyd'),
        k: getComputedStyle(v).getPropertyValue('--k').trim(),
        forYou: Number(getComputedStyle(forYou).opacity),
        again: shown(t.parts.again),
        againInReward: t.parts.again.parentElement?.classList.contains('vlt__reward') ?? false,
        lead: shown(t.parts.lead),
        hint: shown(t.parts.hint),
        hintText: t.parts.hint.textContent,
        status: v.querySelector('.vlt__status')?.textContent ?? '',
        opens: t.opens as number,
        cues: t.cues as { passage: string; at: number }[],
        primes: t.primes as string[],
        buzz: t.buzz as { at: number; pattern: number[] }[],
        againCount: t.again as number,
        now: Math.round(performance.now()),
      };
    });
  const answer = (page: Page, rare: boolean) =>
    page.evaluate((r) => {
      const t = (globalThis as unknown as { T: { answer(v: unknown): void } }).T;
      t.answer({ vaultId: 'v', kind: r ? 'GUARANTEED' : 'CREDIT', prize: r ? 'GUARANTEED' : '€25', line: r ? 'A piece at the next LIVE release.' : 'House credit, valid 30 days.', odds: r ? '1 IN 200' : '1 IN 10', rare: r, where: 'ACCOUNT', openedAt: '', giftCode: null });
    }, rare);
  /** The door held with the space bar (focused first) for `ms` of the page's clock. */
  async function hold(page: Page, ms: number, letGo = true): Promise<void> {
    await page.focus('.vo-dopen__front');
    await page.keyboard.down(' ');
    await page.clock.runFor(ms);
    if (letGo) await page.keyboard.up(' ');
  }

  it('is the reference\'s door-open box: its section and door named for a reader, THE / VAULT and FOR YOU letter by letter at their ink positions, the monogram engraved, its faces, no number', async () => {
    const page = await boxAt('soldOut');
    const m = await page.evaluate(() => {
      const t = (globalThis as unknown as { T: { mount(p: string, phone: boolean): void; parts: { root: HTMLElement } } }).T;
      const root = t.parts.root;
      const words = (sel: string) => [...root.querySelectorAll(`${sel} text`)].map((x) => [...x.querySelectorAll('tspan')].map((s) => [s.textContent, Number(s.getAttribute('x'))]));
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      t.mount('soldOut', true);
      const again = [...document.querySelectorAll('[id]')].map((e) => e.id);
      const front = document.querySelector('.vo-dopen__front')!;
      return {
        phone: root.classList.contains('vault-box--phone'),
        section: [root.querySelector('section')?.getAttribute('aria-label'), root.querySelector('section')?.dataset.variant, root.querySelector('section')?.dataset.place],
        label: front.getAttribute('aria-label'),
        describedBy: document.getElementById(front.getAttribute('aria-describedby') ?? '')?.textContent,
        door: words('.vo-door__half--up .vo-door__emb'),
        lid: words('.vo-dopen__mono'),
        masks: [...root.querySelectorAll('.vo-dopen__mono mask')].map((x) => x.querySelectorAll('path').length),
        faces: root.querySelectorAll('.vo-side, .vo-cnr').length,
        text: root.querySelector('.vo-dopen')!.textContent ?? '',
        lead: root.querySelector('.vlt__lead')?.textContent,
        hint: root.querySelector('.vlt__hint')?.textContent,
        reused: ids.filter((id) => again.includes(id) && document.querySelectorAll(`[id="${id}"]`).length > 1),
      };
    });
    expect(m.phone).toBe(true);
    expect(m.section).toEqual([VAULT.name, 'door-open', 'soldOut']);
    expect(m.label).toBe(VAULT.door.label);
    expect(m.describedBy).toBe(VAULT.door.hint);
    expect(m.door).toEqual(DOOR_WORDS.map((w) => w.letters.map(([l, x]) => [l, x])));
    expect(m.lid).toEqual([LID_WORDS.letters.map(([l, x]) => [l, x])]);
    expect(m.masks).toEqual([5, 5]);
    expect(m.faces).toBe(12);
    // No number anywhere on the box (D10): THE VAULT, FOR YOU, FROM THE VAULT, the lid's ORBES.
    expect(m.text).not.toMatch(/\d|NO\./);
    expect([m.lead, m.hint]).toEqual([VAULT.door.lead, VAULT.door.hint]);
    // A box mounted again never reuses another's gradient or mask ids.
    expect(m.reused).toEqual([]);
    // The focus ring in the box's own grey, gone once open (D31); no ivory edge line (the reference's 22.5° facets).
    expect(VAULT_CSS).toMatch(/\.vo-dopen__front:focus-visible \{ outline: 1px solid #3a3a3b !important;/);
    expect(VAULT_CSS).toMatch(/\.is-open \.vo-dopen__front:focus-visible \{ outline-color: transparent !important; \}/);
    await page.context().close();
  });

  it('hides FOR YOU while sealed and marks it 1000 ms after the hold first passes 0.02; let go early, it settles back in 380 ms and FOR YOU is cleared', async () => {
    const page = await boxAt('soldOut');
    expect((await state(page)).forYou).toBe(0);
    await hold(page, 900, false);
    let s = await state(page);
    expect(s.classes).toEqual(['is-holding']);
    expect(Number(s.p)).toBeGreaterThan(0.5);
    // Its press primes THE VAULT's sounds.
    expect(s.primes).toEqual(['vault']);
    // About 30 ms after the press the hold passes 0.02: FOR YOU marked 1000 ms later.
    await page.clock.runFor(FOR_YOU_MS - 900 + 60);
    s = await state(page);
    expect(s.classes).toEqual(['fy-in', 'is-holding']);
    // Its 0.5 s ease-out runs on the page's own (unfaked) animation clock.
    await expect.poll(async () => (await state(page)).forYou, { timeout: 5_000 }).toBeCloseTo(1, 2);
    await page.keyboard.up(' ');
    await page.clock.runFor(RESET_MS + 50);
    s = await state(page);
    expect(s.classes).toEqual([]);
    expect([s.p, s.fyd, s.opens]).toEqual(['0.0000', '', 0]);
    await expect.poll(async () => (await state(page)).forYou, { timeout: 5_000 }).toBe(0);
    await page.context().close();
  });

  it('draws nothing of the opening while the server draws; starts the timeline at its answer (a rare one at --k 1.4 with its halves at 0.14 s, the rarer tone, the vibration at 2.8 s), with --fyd what is left of FOR YOU\'s second', async () => {
    const page = await boxAt('soldOut');
    // Drawn down 110 px within 200 ms: its end reached before FOR YOU's second.
    const box = (await page.locator('.vo-dopen__front').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    for (let y = 10; y <= 130; y += 20) {
      await page.mouse.move(box.x + box.width / 2, box.y + 40 + y);
      await page.clock.runFor(30);
    }
    let s = await state(page);
    expect(s.opens).toBe(1);
    // Pending: held, nothing of the opening started.
    expect(s.classes).toEqual(['is-holding']);
    await page.clock.runFor(400);
    s = await state(page);
    expect(s.classes).toEqual(['is-holding']);
    expect(s.cues).toEqual([]);
    const answeredAt = s.now;
    await answer(page, true);
    s = await state(page);
    expect(s.classes).toEqual(['is-open', 'is-playing', 'is-rare']);
    expect(s.k).toBe('1.4');
    // FOR YOU's second began at the draw's first move: what is left of it when the opening starts.
    const fyd = Number.parseFloat(s.fyd);
    expect(fyd).toBeGreaterThan(0);
    expect(fyd).toBeLessThan(1);
    expect(s.cues.map((c) => c.passage)).toEqual(['vaultRare']);
    expect(Math.abs(s.cues[0]!.at - answeredAt)).toBeLessThan(50);
    expect(SFX_AT.vaultRare.find(([n]) => n === 'vault-halves')![1]).toBeCloseTo(0.14, 6);
    expect(s.status).toBe(VAULT.reveal.said('GUARANTEED', 'A piece at the next LIVE release.', '1 IN 200'));
    await page.mouse.up();
    await page.clock.runFor(VIBRATE_AT_S * RARE_K * 1000 + 20);
    s = await state(page);
    expect(s.buzz).toHaveLength(1);
    expect(s.buzz[0]!.pattern).toEqual([16, 40, 26]);
    expect(s.buzz[0]!.at - answeredAt).toBeGreaterThanOrEqual(VIBRATE_AT_S * RARE_K * 1000);
    // The end at 6.55 s × 1.4: the open box at rest, its float calm.
    await page.clock.runFor(OPENING_MS * RARE_K);
    expect((await state(page)).classes).toEqual(['is-open', 'is-rare']);
    await page.context().close();
  });

  it('plays a reward at k 1 from the answer after a full hold (1500 ms); a refusal settles the box back with the server\'s sentence where the hint stands', async () => {
    const page = await boxAt('end', { phone: false });
    await hold(page, HOLD_MS + 50);
    let s = await state(page);
    expect([s.opens, s.classes]).toEqual([1, ['fy-in', 'is-holding']]);
    await page.evaluate(() => (globalThis as unknown as { T: { fail(e: Error): void } }).T.fail(new Error('This vault was kept 30 days and can no longer be opened.')));
    await page.clock.runFor(RESET_MS + 50);
    s = await state(page);
    expect(s.classes).toEqual(['has-error']);
    expect(s.hintText).toBe('This vault was kept 30 days and can no longer be opened.');
    expect(s.lead).toBe(true);
    // The next press: the hint again, a second draw asked.
    await hold(page, HOLD_MS + 50);
    s = await state(page);
    expect([s.hintText, s.opens]).toEqual([VAULT.door.hint, 2]);
    await answer(page, false);
    s = await state(page);
    expect(s.classes).toEqual(['fy-in', 'is-open', 'is-playing']);
    expect(s.k).toBe('1');
    expect(s.cues.map((c) => c.passage)).toEqual(['vault']);
    await page.context().close();
  });

  it('shows OPEN ANOTHER under the reward once open on SOLD OUT and the end page (the door\'s line and hint gone) and closes the box with it; a door of THE VAULT page has none, nor its line, hint or hairline', async () => {
    for (const place of ['soldOut', 'end'] as const) {
      const page = await boxAt(place, { reduced: true });
      expect((await state(page)).again).toBe(false);
      await hold(page, HOLD_MS + 50);
      await answer(page, false);
      let s = await state(page);
      // Reduced motion: the reward at once, its tone alone, the focus on OPEN ANOTHER.
      expect(s.classes).toContain('is-open');
      expect(s.classes).not.toContain('is-playing');
      expect(s.cues.map((c) => c.passage)).toEqual(['vaultStill']);
      expect([s.again, s.againInReward, s.lead, s.hint], place).toEqual([true, true, false, false]);
      expect(await page.evaluate(() => document.activeElement?.className)).toContain('vlt__again');
      await page.click('.vlt__again');
      s = await state(page);
      expect(s.classes).toEqual([]);
      expect(s.againCount).toBe(1);
      await page.context().close();
    }
    const page = await boxAt('page', { reduced: true });
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.vlt__rule, .vlt__lead, .vlt__hint, .vlt__again')].map((e) => getComputedStyle(e).display));
    expect(hidden).toEqual(['none', 'none', 'none', 'none']);
    await hold(page, HOLD_MS + 50);
    await answer(page, false);
    const s = await state(page);
    expect(s.classes).toContain('is-open');
    expect(s.again).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.className ?? '')).not.toContain('vlt__again');
    expect(VAULT_CSS).toMatch(/\.vlt\[data-place="page"\]\[data-variant="door-open"\] \{ padding-top: 0 !important; \}/);
    await page.context().close();
  });

  it('draws a door of THE VAULT page as MK V: no hairline, no line, no DRAW IT DOWN hint; PRESS AND HOLD under the box and above the source line, gone once it opens in place with its source line and WAITS UNTIL kept and SAVE THE IMAGE for I WAS THERE (lot Q3, step Q3.11; N1, N33)', async () => {
    const out = await build({ stdin: { contents: VAULT_PAGE_SCRIPT, resolveDir: HERE, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.mp3': 'file', '.json': 'json' }, outdir: '/tmp/unused' });
    const pageBundle = out.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addStyleTag({ content: `${VAULT_CSS}\n${PAGE_CSS}\nbody { margin: 0; background: #0a0a0a; color: #f6f2ea; }` });
    await page.addScriptTag({ content: pageBundle });
    await page.evaluate(() => (globalThis as unknown as { P: { mount(): void } }).P.mount());
    await page.waitForSelector('.view--vault[data-state="ready"] .vp-vault .vo-dopen__front');
    const doors = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.vp-vault')].map((li) => {
          const shown = (e: Element | null) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
          const box = li.querySelector('.vo-dopen__front')!.getBoundingClientRect();
          const press = li.querySelector('.vp-press');
          const from = li.querySelector('.vp-from')!.getBoundingClientRect();
          return {
            rule: shown(li.querySelector('.vlt__rule')),
            lead: shown(li.querySelector('.vlt__lead')),
            drawHint: shown(li.querySelector('.vlt .vlt__hint')),
            again: shown(li.querySelector('.vlt__again')),
            press: press ? { text: press.textContent, cls: press.className, under: press.getBoundingClientRect().top >= box.bottom - 1, above: press.getBoundingClientRect().bottom <= from.top + 1 } : null,
            from: li.querySelector('.vp-from')!.textContent,
            until: li.querySelector('.vp-until')!.textContent,
            act: li.querySelector('.vp-act')?.textContent ?? null,
          };
        }),
      );
    for (const d of await doors()) {
      expect([d.rule, d.lead, d.drawHint, d.again]).toEqual([false, false, false, false]);
      expect(d.press).toEqual({ text: 'PRESS AND HOLD', cls: 'live__fact vlt__hint vp-press', under: true, above: true });
      expect(d.until).toBe('WAITS UNTIL 4 NOVEMBER');
    }
    await page.focus('.vp-vault:nth-child(2) .vo-dopen__front');
    await page.keyboard.down(' ');
    await page.waitForFunction(() => (globalThis as unknown as { P: { answers: unknown[] } }).P.answers.length === 1, null, { timeout: 10_000 });
    await page.keyboard.up(' ');
    await page.evaluate(() => (globalThis as unknown as { P: { answers: ((v: unknown) => void)[] } }).P.answers[0]!({ vaultId: 'b', kind: 'I_WAS_THERE', prize: 'I WAS THERE', line: 'Your card. Save it.', odds: '1 IN 2000', rare: false, where: 'NONE', openedAt: '', giftCode: null }));
    await page.waitForSelector('.vp-vault:nth-child(2) .vlt.is-open');
    const [first, second] = await doors();
    expect(first!.press?.text).toBe('PRESS AND HOLD');
    expect(second!.press).toBeNull();
    expect([second!.again, second!.from, second!.until, second!.act]).toEqual([false, 'A NEW TIER · PLATINE', 'WAITS UNTIL 4 NOVEMBER', 'SAVE THE IMAGE']);
    // The odds as the vault writes them, grouped.
    expect(await page.evaluate(() => document.querySelector('.vp-vault:nth-child(2) .vo-rw__odds')?.textContent)).toBe('1 IN 2,000');
    await context.close();
  });

  it('dims the page as MK\'s vo-pagedim, on SOLD OUT and the end page only (a slot\'s vault): from 1.8 s over 1.25 s to 0.16, a rare reward from 2.52 s over 1.75 s; never on a door of THE VAULT page', () => {
    const phone = '.view--live:not(.d-room):has(.live__vault-slot .vlt';
    const phoneParts = ':is(.live__photo, .live__head, .live__screen > :not(.live__vault-slot), .live__vault-slot .vlt__rule)';
    expect(HOUSE_CSS).toContain(`${phone}.is-open) ${phoneParts} {\n  opacity: 0.16;`);
    expect(HOUSE_CSS).toContain(`${phone}.is-playing) ${phoneParts} {\n    animation: vlt-pagedim 1.25s cubic-bezier(0.16, 1, 0.3, 1) 1.8s backwards;`);
    expect(HOUSE_CSS).toContain(`${phone}.is-playing.is-rare) ${phoneParts} {\n    animation: vlt-pagedim 1.75s cubic-bezier(0.16, 1, 0.3, 1) 2.52s backwards;`);
    const desk = 'html:not(.d-touch) .d-room:has(.live__vault-slot .vlt';
    const deskParts = ':is(.d-room__photo, .live__head, .d-room__head, .d-room__bl, .d-room__br, .d-room__body > :not(.live__vault-slot), .live__foot)';
    expect(ROOM_CSS).toContain(`${desk}.is-open) ${deskParts} {\n    opacity: 0.16;`);
    expect(ROOM_CSS).toContain(`${desk}.is-playing) ${deskParts} {\n    animation: vlt-pagedim 1.25s cubic-bezier(0.16, 1, 0.3, 1) 1.8s backwards;`);
    expect(ROOM_CSS).toContain(`${desk}.is-playing.is-rare) ${deskParts} {\n    animation: vlt-pagedim 1.75s cubic-bezier(0.16, 1, 0.3, 1) 2.52s backwards;`);
    // Every dim reads a vault in a LIVE page's slot: THE VAULT page's doors never dim it (N35).
    for (const css of [HOUSE_CSS, ROOM_CSS]) for (const m of css.matchAll(/animation: vlt-pagedim [^;]+;/g)) expect(css.slice(Math.max(0, css.lastIndexOf('}', m.index) + 1), m.index)).toContain('.live__vault-slot .vlt');
    // The vault itself never dims the page.
    expect(VAULT_CSS).not.toMatch(/pagedim/);
  });
});
