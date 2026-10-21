/** NOCTURNE's content test, shard draws (test/web/nocturne.content.harness.ts: CONTENT_SHARDS). */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { LIVE, RELEASES, STORY } from '../../src/web/verify/copy.js';
import { eachState } from '../support/nocturne-stage.js';
import { openState, stateById } from '../support/nocturne-states.js';
import { contentSuite, HAS_CHROMIUM, hiddenGuaranteeSuite, SHARD_TIMEOUT_MS } from './nocturne.content.harness.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

contentSuite('draws');

// Plan NEXT-NINE, IN-01: `quiet` holds a guarantee not shown on the open draw and on the drawn one.
const MARK = /THE HOUSE'S GUARANTEE|guaranteed place|guarantees you|with the house's guarantee/i;
const as = (id: string, over: Record<string, unknown>) => ({ ...stateById(id), id: `${id}-as-quiet`, ...over }) as ReturnType<typeof stateById>;
hiddenGuaranteeSuite('draws', [
  // The drawn release: its GUARANTEED lines, unmarked: no YOURS, no box.
  { state: stateById('draw-guaranteed-hidden'), absent: [MARK, /\bYOURS\b/], present: [/GUARANTEED . 1 PIECE/i, /GUARANTEED BY THE HOUSE/i] },
  // The open draw it is set aside for: no box.
  { state: as('draw-guaranteed', { as: 'quiet', ready: '.view--release .release__status' }), absent: [MARK] },
  // Its account sheet: no block.
  { state: as('draw-guarantee-account', { as: 'quiet', ready: '.n-account:not([hidden]) .n-account__rows' }), absent: [MARK] },
  // MY PIECES, RELEASES: no label beside its entry.
  { state: as('draw-guarantee-pieces', { as: 'quiet', ready: '.view--pieces .pieces__releases' }), absent: [MARK] },
]);

// Plan NEXT-NINE, BP-10: a place SELECTED (PLACE HELD, and PLACE RESERVED directly) offers SHARE TO STORIES; its card
// says SELECTED, DRAW, the draw's title and its day. Written to out/story-selected.png. A place waitlisted or lapsed does not.
describe.skipIf(!HAS_CHROMIUM)('SHARE TO STORIES on a draw\'s page (BP-10, Chromium)', () => {
  it(
    'offers the SELECTED card for a place held or reserved, a 1080 × 1920 PNG; none for the waiting list or a lapse',
    async () => {
      const found: string[] = [];
      const states = ['draw-place-held', 'draw-place-reserved', 'draw-waiting-list', 'draw-lapsed'].map((id) => stateById(id));
      await eachState(
        states,
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            const page = opened.page;
            const open = page.getByRole('button', { name: STORY.button });
            if (state.id === 'draw-waiting-list' || state.id === 'draw-lapsed') {
              await sleep(1_500);
              if ((await open.count()) !== 0) found.push(`${state.id}: shows ${STORY.button}`);
              return;
            }
            await open.waitFor({ state: 'visible', timeout: 20_000 });
            // Under the status and the entry number, above WRITE TO ORBES CLIENT SERVICES; the page still says its own words.
            const order = await page.locator('.release__entry').evaluate((el) => [...el.querySelectorAll('.release__status, .n-story__open, .n-write__open')].map((x) => ['release__status', 'n-story__open', 'n-write__open'].find((c) => x.classList.contains(c))));
            if (JSON.stringify(order) !== JSON.stringify(['release__status', 'n-story__open', 'n-write__open'])) found.push(`${state.id}: order ${order.join(', ')}`);
            const label = (await page.locator('.n-release__status-label').innerText()).trim();
            if (label !== (state.id === 'draw-place-held' ? 'PLACE HELD' : 'PLACE RESERVED')) found.push(`${state.id}: label ${label}`);
            await open.click();
            const dialog = page.getByRole('dialog', { name: STORY.label });
            await dialog.waitFor({ state: 'visible' });
            const alt = (await dialog.locator('img').getAttribute('alt')) ?? '';
            if (!/^ORBES\. SELECTED\. DRAW\. .+\. \d{1,2} [A-Z]+ \d{4}\. THEORBES\.COM$/.test(alt)) found.push(`${state.id}: alt ${alt}`);
            const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: STORY.save }).click()]);
            if (download.suggestedFilename() !== STORY.filename) found.push(`${state.id}: file ${download.suggestedFilename()}`);
            if (state.id === 'draw-place-held') {
              mkdirSync(OUT_DIR, { recursive: true });
              const path = join(OUT_DIR, 'story-selected.png');
              await download.saveAs(path);
              const png = PNG.sync.read(readFileSync(path));
              if (png.width !== 1080 || png.height !== 1920) found.push(`${state.id}: ${png.width} × ${png.height}`);
              if ([...png.data.subarray(0, 3)].join(',') !== '10,10,10') found.push(`${state.id}: corner ${[...png.data.subarray(0, 3)]}`);
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    SHARD_TIMEOUT_MS,
  );
});

// Plan NEXT LOT §3.6.F: a draw in sizes, on its own stage. YOUR SIZE preselected from YOUR SIZES: ENTER THE DRAW enters
// in it, the label over the sizes then ENTERED · SIZE 17; a size tapped then changes the entry's at once; WITHDRAW keeps it, preselected for the entry again. Nothing
// sideways at 320 px. The state writes, after its baseline's read.
describe.skipIf(!HAS_CHROMIUM)('a draw in sizes: enter in a size, change it, withdraw (NEXT LOT §3.6.F, Chromium)', () => {
  it(
    'enters in the size preselected, changes it with a tap, keeps it once withdrawn',
    async () => {
      const found: string[] = [];
      await eachState(
        [stateById('draw-sizes')],
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            const page = opened.page;
            const label = () => page.locator('.n-release__status-label').innerText().then((t) => t.trim());
            const pressed = () => page.locator('.release__sizes button[aria-pressed="true"]').innerText().then((t) => t.trim());
            // The label over the sizes: YOUR SIZE, then ENTERED · SIZE 17 once entered, while entries are open.
            const over = () => page.locator('.release__size-label').innerText().then((t) => t.trim());
            if ((await pressed()) !== '17') found.push(`preselected ${await pressed()}`);
            if ((await over()) !== 'YOUR SIZE') found.push(`over the sizes before entering: ${await over()}`);
            await page.getByRole('button', { name: 'ENTER THE DRAW' }).click();
            await page.locator('.n-release__status-label').waitFor({ state: 'visible' });
            if ((await label()) !== 'ENTERED · SIZE 17') found.push(`entered: ${await label()}`);
            if ((await over()) !== 'ENTERED · SIZE 17') found.push(`over the sizes once entered: ${await over()}`);
            const sentence = (await page.locator('.release__sentence').innerText()).trim();
            if (sentence !== 'You are entered in the draw, in size 17. You may change your size until entries close, and withdraw until the draw.') found.push(`sentence: ${sentence}`);
            // YOUR SIZES' lines go once the entry has its size; a tap changes it at once.
            if ((await page.locator('.release__yours').count()) !== 0) found.push('YOUR SIZES lines still shown');
            await page.locator('.release__sizes button', { hasText: '16' }).click();
            await page.waitForFunction(() => document.querySelector('.n-release__status-label')?.textContent?.trim() === 'ENTERED · SIZE 16', null, { timeout: 15_000 });
            if ((await pressed()) !== '16') found.push(`after the change ${await pressed()}`);
            if ((await over()) !== 'ENTERED · SIZE 16') found.push(`over the sizes after the change: ${await over()}`);
            // 18 is full (reserved by PLATINE): still open to an entry, the waiting list said under the sizes.
            await page.locator('.release__sizes button', { hasText: '18' }).click();
            await page.waitForFunction(() => document.querySelector('.n-release__status-label')?.textContent?.trim() === 'ENTERED · SIZE 18', null, { timeout: 15_000 });
            const note = (await page.locator('.release__size-note').innerText()).trim();
            if (note !== 'Every piece in size 18 has been reserved. You may still enter: the draw ranks a waiting list in each size.') found.push(`note: ${note}`);
            await page.getByRole('button', { name: 'WITHDRAW' }).click();
            await page.waitForFunction(() => document.querySelector('.n-release__status-label')?.textContent?.trim() === 'WITHDRAWN · SIZE 18', null, { timeout: 15_000 });
            if ((await pressed()) !== '18') found.push(`withdrawn, preselected ${await pressed()}`);
            if ((await over()) !== 'YOUR SIZE') found.push(`over the sizes once withdrawn: ${await over()}`);
            if (await page.getByRole('button', { name: 'ENTER THE DRAW' }).isDisabled()) found.push('ENTER THE DRAW disabled with a size picked');
            await page.setViewportSize({ width: 320, height: 800 });
            const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (wide > 0) found.push(`sideways ${wide} px at 320`);
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    SHARD_TIMEOUT_MS,
  );
});

// Macro scope C1 (lot M1, step M1.9): ADD TO CALENDAR on a draw's page while its entries are to open or open, LIVE's
// word, its .ics read from the server (the opening of entries to their close); none once its entries are closed or it is
// cancelled (the server has no file then).
describe.skipIf(!HAS_CHROMIUM)('ADD TO CALENDAR on a draw\'s page (macro scope C1, Chromium)', () => {
  it(
    'links an open draw to its .ics, a calendar file; a closed or cancelled draw offers none',
    async () => {
      const found: string[] = [];
      await eachState(
        ['draw-open-calendar', 'draw-closed', 'draw-cancelled'].map((id) => stateById(id)),
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            const page = opened.page;
            const link = page.getByRole('link', { name: LIVE.calendar });
            if (state.id !== 'draw-open-calendar') {
              if ((await link.count()) !== 0) found.push(`${state.id}: shows ${LIVE.calendar}`);
              return;
            }
            const href = (await link.getAttribute('href')) ?? '';
            if (href !== `/api/v1/drops/${demo.releases.draw}/calendar.ics`) found.push(`href ${href}`);
            if ((await link.getAttribute('download')) !== 'orbes-draw.ics') found.push(`download ${await link.getAttribute('download')}`);
            const res = await page.request.get(new URL(href, page.url()).toString());
            if (res.status() !== 200) found.push(`status ${res.status()}`);
            if (!/^text\/calendar/.test(res.headers()['content-type'] ?? '')) found.push(`type ${res.headers()['content-type']}`);
            const body = await res.text();
            if (!body.startsWith('BEGIN:VCALENDAR') || !/BEGIN:VEVENT/.test(body)) found.push('not a calendar');
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    SHARD_TIMEOUT_MS,
  );
});

// Plan MACRO M1 §3.3 (F4; lot M1, step M1.13): a draw opened to a segment says FOR SELECTED COLLECTORS in THE RELEASE;
// a collector among them is offered ENTER THE DRAW, one who is not reads the refusal in its place (as a LIVE RELEASE's),
// with no ENTER THE DRAW anywhere on the page; signed out, the sign-in's lead says the release is for selected collectors.
describe.skipIf(!HAS_CHROMIUM)('a draw FOR SELECTED COLLECTORS (plan MACRO M1 §3.3, F4, Chromium)', () => {
  it(
    'shows the rule to all, ENTER THE DRAW to a collector among them, the refusal in its place to another',
    async () => {
      const found: string[] = [];
      await eachState(
        ['draw-selected', 'draw-selected-not-eligible', 'draw-selected-signed-out'].map((id) => stateById(id)),
        async (state, { stage, demo, browser }) => {
          const opened = await openState(browser, stage, demo, state);
          try {
            const page = opened.page;
            const rule = (await page.locator('.view--release .release__for').allTextContents()).map((t) => t.trim());
            if (rule.join('|') !== RELEASES.selected) found.push(`${state.id}: rule ${JSON.stringify(rule)}`);
            const enter = await page.getByRole('button', { name: RELEASES.enter }).count();
            const refusal = page.locator('.view--release .release__entry .release__refusal');
            if (state.id === 'draw-selected') {
              if (enter === 0) found.push(`${state.id}: no ${RELEASES.enter}`);
              if ((await refusal.count()) !== 0) found.push(`${state.id}: refused`);
            } else if (state.id === 'draw-selected-not-eligible') {
              if (enter !== 0) found.push(`${state.id}: ${RELEASES.enter} offered`);
              const words = (await refusal.locator('p').allTextContents()).map((t) => t.trim());
              const want = [RELEASES.selected, RELEASES.notEligible, LIVE.edge.notEligible.text];
              if (JSON.stringify(words) !== JSON.stringify(want)) found.push(`${state.id}: refusal ${JSON.stringify(words)}`);
            } else if (!(await page.locator('.view--release').innerText()).includes(RELEASES.signInSelected)) {
              found.push(`${state.id}: lead`);
            }
          } finally {
            await opened.close();
          }
        },
        () => {},
      );
      expect(found).toEqual([]);
    },
    SHARD_TIMEOUT_MS,
  );
});
