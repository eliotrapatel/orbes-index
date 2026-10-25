/**
 * The states of /verify and /legal that the NOCTURNE stage reaches (docs/launch/NOCTURNE-MATRIX.md lists them with the
 * data each one shows): for each, the demo variant it lives in (test/support/nocturne-demo.ts), who looks at it (an
 * account's session, or a visitor), its address, what is done there to reach it, and the boards it is compared with.
 * Shared by the parity tool (scripts/parity.ts: the captures, the stress run, the content baseline) and the NOCTURNE
 * browser tests (test/web/nocturne.content-<shard>.e2e.test.ts through nocturne.content.harness.ts,
 * test/web/nocturne.overflow.e2e.test.ts).
 *
 * A state is reached by role and words (a button's name, a tab's), and by the app's own view roots where none says
 * enough, so a restyled app reaches the same state with the same definition; when a step of NOCTURNE changes how a state
 * is reached, it changes it here, to the same intent.
 *
 * The phone is the captures' (test/support/ui-stage.ts mobileContext), its clock fixed at NOW (the server's is too), its
 * camera an iPhone's: Chromium's fake camera playing a hand-held clip of a demo code, the track reporting a torch and a
 * zoom from 0.5× to 5× (LIGHT and the zoom toggle show; the camera opens at 2×, the toggle offering 0.5×).
 */
import { PNG } from 'pngjs';
import type { Browser, BrowserContext, Page, Route } from 'playwright-core';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { securedColumn, type SecuredPart } from '../../src/web/verify/live-model.js';
import { countPiecesIn, packAndShip } from './fulfil.js';
import { NOCTURNE_NOW, nocturnePhoto, type DemoVariant, type NocturneDemo } from './nocturne-demo.js';
import { codePhoto, gate, hideGrain, mobileContext, sleep, type UiStage } from './ui-stage.js';

/** A camera that refuses to open, the way a browser says it (getUserMedia's DOMException names). */
export type CameraFailure = 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'AbortError' | 'unsupported';

/** 5b shown (lot Q2, step Q2.8): its rows, one of them chosen. */
const FIVE_B_READY = '.view--live .live__addons:not([hidden]) .live__addon-item.is-on';

/** THE VAULT's door shown (lot Q3, step Q3.10): the box in its slot, on SOLD OUT for your size or the end page. */
const VAULT_DOOR = '.view--live .live__vault-slot .vault-box .vo-dopen__front';
const VAULT_END_DOOR = '.view--live.live--end-vault .live__vault-slot .vault-box .vo-dopen__front';
const VAULT_OPEN = '.view--live .live__vault-slot .vlt.is-open';

/** The demo's service whose name is exactly 40 characters (addons-hold-stress). */
const LONGEST_ADDON = 'A SECOND BOX OF THE HOUSE, WITH ITS CARD';

export interface StateRun {
  page: Page;
  context: BrowserContext;
  stage: UiStage;
  demo: NocturneDemo;
}

export interface UiState {
  /** Unique, kebab-case: the key of the content baseline. */
  id: string;
  /** What the screen is, in a few words (the matrix's words). */
  title: string;
  /** The boards it is compared with (C-ids), the before-captures (live-xx, plus-xx), or 'same pieces'. */
  refs: readonly string[];
  variant: DemoVariant;
  /** The account whose session the phone holds (a key of NocturneDemo.accounts); absent: a visitor, signed out. */
  as?: string;
  /** The address opened. */
  path(d: NocturneDemo): string;
  /** What the phone's camera does when the page opens it (an iPhone's by default). */
  camera?: CameraFailure | 'hold';
  /** Routes set before the page opens (a request held or failed). */
  routes?(page: Page, hold: Holds): Promise<void>;
  /** What is done on the page once it is open, until the state shows. */
  act?(run: StateRun, hold: Holds): Promise<void>;
  /** A selector that shows once the state is there. */
  ready: string;
  /** The state writes to the demo (a registration, an answer): it runs after the others of its variant. */
  mutates?: boolean;
  /** One of the extreme cases of fidelity rule 5 (the overflow test, parity --stress). */
  stress?: boolean;
  /** The capture of the state is the viewport alone (the camera, a full-screen moment), not the whole page. */
  viewport?: boolean;
  /**
   * A screen of this size (CSS px, at 1×) in place of the phone, for a state its before-capture shows on one (the
   * boutique board's landscape screen, live-07: capture-ui's 1280 × 720).
   */
  size?: { width: number; height: number };
  /**
   * LIGHT MODE kept on the device before the page opens, as the app keeps it (shared/prefs.ts: orbes.mode), so the page
   * draws in light from its first paint (the desktop states of Cinema in white).
   */
  light?: boolean;
  /**
   * What else the state must hold once shown, read by the content test after its words (a geometry): each problem in
   * words, none when it holds.
   */
  check?(page: Page): Promise<string[]>;
}

/** Requests a state holds open while it is captured, released when the run ends. */
export interface Holds {
  hold(pattern: string): void;
  releaseAll(): void;
}

/**
 * Production's A PIECE HAS RETURNED (lot Q1, step Q1.10; N11): the page in the one queue of a release (the first of the
 * demo's whose turn it has not given yet: each run takes one) whose size it reads full; then the turn held there is left,
 * and ORBES lets the collector in (LET IN): its turn comes on a size it saw full.
 */
async function returnedTurn(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.queueReturned!;
  let dropId: string | null = null;
  for (let n = 1; dropId === null && run.demo.releases[`queueReturned${n}`]; n++) {
    const id = run.demo.releases[`queueReturned${n}`]!;
    const e = await db.selectFrom('live_entries').select('status').where('drop_id', '=', id).where('account_id', '=', you.id).executeTakeFirst();
    if (e?.status === 'QUEUED') dropId = id;
  }
  if (!dropId) throw new Error('no returned-turn release left');
  if (!run.page.url().endsWith(dropId)) await run.page.goto(`${run.stage.origin}/verify/releases/${dropId}`);
  await run.page.locator('.view--live .live__queue .live__place-figure').waitFor();
  // The room read at least once more after the entry (a stream's, or the next reading): the size seen full.
  await run.page.waitForTimeout(2_500);
  const holder = await db.selectFrom('live_entries').select(['id', 'account_id']).where('drop_id', '=', dropId).where('status', '=', 'TURN').executeTakeFirstOrThrow();
  await services.live.leave(holder.account_id, dropId, { type: 'account', id: holder.account_id });
  const mine = await db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', you.id).executeTakeFirstOrThrow();
  const admin = await db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow();
  await services.live.letIn(dropId, mine.id, { type: 'admin', id: admin.id });
}

// ── The states ─────────────────────────────────────────────────────────────

const you = 'you';
const at = (path: string) => () => path;
const release = (key: string, tail = '') => (d: NocturneDemo) => `/verify/releases/${d.releases[key]}${tail}`;
const post = (key: string) => (d: NocturneDemo) => `/verify/circle/${d.posts[key]}`;
const sheet = (key: string) => (d: NocturneDemo) => `/verify/lookbook/${d.slugs[key]}`;
const piece = (role: string) => (d: NocturneDemo) => {
  const id = d.pieces[role];
  if (!id) throw new Error(`no demo piece ${role}`);
  return `/verify/pieces/${id}`;
};

/** Upload a photo of the demo code `role` through the page's own photo input (UPLOAD A PHOTO). */
async function upload(run: StateRun, role: string): Promise<void> {
  const code = run.demo.codes[role];
  if (!code) throw new Error(`no demo code ${role}`);
  await run.page.setInputFiles('#photo-input', { name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(code) });
}

const button = (run: StateRun, name: string | RegExp) => run.page.getByRole('button', { name, exact: typeof name === 'string' }).first();
/**
 * A computer's window (desktop, BRIEF decisions 5 and 6): the account's sheet is a page there
 * (/verify/account and its sections, each card a link), and where the phone embeds the sign-in a line of two links
 * leads to the sign-in page (/verify/sign-in).
 */
/**
 * Whether the app draws its computer layout: the app's own test, read in the page (a wide window with a fine
 * pointer and hover, on a device the page did not mark as a phone or a tablet, `html.d-touch`: shared/desktop.ts
 * `isDesktop`), never the window's width alone, so a touch context of 1024 px or more (an iPad, a large tablet) takes
 * the phone's paths as the app does, and a computer with a touch screen (`html.d-tap`) the computer's.
 */
const onComputer = (run: StateRun): Promise<boolean> =>
  run.page.evaluate(() => matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches && !document.documentElement.classList.contains('d-touch'));
/** Where the account's views stand: the phone's sheet, or a computer's page. */
const ACCT = ':is(.n-account, .view--account):not([hidden])';
/** An item of the account (YOUR SIZES, CHANGE PASSWORD…): the sheet's button, or a computer's card (a link). */
const accountItem = async (run: StateRun, name: RegExp) => run.page.locator(ACCT).getByRole((await onComputer(run)) ? 'link' : 'button', { name }).first();
const link = (run: StateRun, name: string | RegExp) => run.page.getByRole('link', { name, exact: typeof name === 'string' }).first();
const tab = (run: StateRun, name: string) => run.page.getByRole('tab', { name, exact: true }).first();
/** A tab of MY PIECES (PIECES, ORDERS, RELEASES: its name with its count), selected, its panel drawn. */
async function piecesTab(run: StateRun, name: 'PIECES' | 'ORDERS' | 'RELEASES'): Promise<void> {
  await run.page.locator('.view--pieces .n-pieces__tabs').waitFor();
  await run.page.getByRole('tab', { name: new RegExp(`^${name}\\s*\\d*$`) }).first().click();
  await run.page.locator(`.view--pieces[data-tab="${name.toLowerCase()}"]`).waitFor();
}

/** A piece's ORBES CARE tab (plan ORBES CARE, step 2.2), its PRIVATE CARE drawn (plan NEXT-NINE, BP-19 T6). */
async function orbesCare(run: StateRun): Promise<void> {
  await tab(run, 'ORBES CARE').click();
  await run.page.locator('.view--piece .piece__yearly-care:not([hidden])').waitFor();
}

/** ADD AN ADD-ON's rows: the phone's sheet, or the order page's part on a computer. */
const ADDON_FORM = ':is(.n-osheet, .d-oform) form.form--order-addons';

/** WORN of a piece (lot M2, D31): its block in OWNERSHIP, read with the piece. */
const WORN_BLOCK = '.view--piece .piece__worn:not([hidden])';

/**
 * WORN's CHOOSE A PHOTOGRAPH given a photograph of the demo (MONOLITHE in steel, WebP) through the block's own file
 * input, its preview then drawn (re-encoded by the page's canvas); SHOW MY INSTAGRAM switched on, so the credit reads
 * the Instagram name; with `agree`, the consent too.
 */
async function chooseWorn(run: StateRun, agree = false): Promise<void> {
  await run.page.locator(`${WORN_BLOCK} .n-worn__choose`).waitFor();
  await run.page.setInputFiles(`${WORN_BLOCK} input[type=file]`, { name: 'worn.webp', mimeType: 'image/webp', buffer: Buffer.from(nocturnePhoto('steel')) });
  await run.page.locator(`${WORN_BLOCK} .n-worn__figure img`).waitFor();
  await run.page.locator(`${WORN_BLOCK} .n-worn__instagram`).click();
  await run.page.locator(`${WORN_BLOCK} .n-worn__credit .n-worn__handle`).waitFor();
  if (agree) await run.page.locator(`${WORN_BLOCK} .n-worn__consent`).click();
  await run.page.evaluate(() => new Promise<void>((resolve) => {
    const img = document.querySelector<HTMLImageElement>('.piece__worn .n-worn__figure img');
    if (!img || img.complete) resolve();
    else img.addEventListener('load', () => resolve(), { once: true });
  }));
}

/** The photographs of WORN's block shown whole (a photograph sent is read from the owner's own address). */
async function wornPhotoLoaded(run: StateRun): Promise<void> {
  await run.page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.piece__worn img')].every((i) => i.complete && i.naturalWidth > 0));
}

/** WORN at the foot of a sheet (lot M2, step M2.11; G3 to G5). */
const SHEET_WORN = '.view--sheet[data-state="ready"] .n-model__worn';

/** The photographs of the sheet's WORN shown whole (each read from its public address). */
async function sheetWornLoaded(run: StateRun): Promise<void> {
  await run.page.locator(`${SHEET_WORN} .n-model__worn-img`).first().waitFor();
  await run.page.evaluate(() => {
    for (const img of document.querySelectorAll<HTMLImageElement>('.n-model__worn-img')) img.loading = 'eager';
  });
  await run.page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.n-model__worn-img')].every((i) => i.complete && i.naturalWidth > 0));
}

/** SHOW MORE pressed `times` times, each time until the photographs it adds are drawn. */
async function wornShowMore(run: StateRun, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const before = await run.page.locator(`${SHEET_WORN} .n-model__worn-item`).count();
    await run.page.locator(`${SHEET_WORN} .n-model__worn-more`).click();
    await run.page.waitForFunction((n) => document.querySelectorAll('.n-model__worn .n-model__worn-item').length > n, before);
  }
}

/**
 * The stress of WORN (fidelity rule 5): MONOLITHE's sheet, read signed out, said to hold 40 photographs, their credits
 * the longest the app takes (a first name of 50 characters, the longest English name of a country, an Instagram name of
 * 30), 12 a page as the server pages them; each photograph one of the eight the stage published (their own addresses).
 */
const WORN_STRESS_TOTAL = 40;
const WORN_STRESS_CREDITS: readonly { firstName: string; country: string; instagram: string | null }[] = [
  { firstName: 'Maximiliane-Alexandrine Bénédicte Héloïse Anastase', country: 'South Georgia & South Sandwich Islands', instagram: 'maximiliane.alexandrine.anasta' },
  { firstName: 'Jo', country: 'Chad', instagram: null },
  { firstName: 'Marie-Bénédicte Anastasia Héloïse de Montmorency', country: 'British Indian Ocean Territory', instagram: null },
  { firstName: 'Léa', country: 'Italy', instagram: 'lea.moretti' },
  { firstName: 'Bartholomew', country: 'Central African Republic', instagram: 'bartholomew.and.the.long.name' },
  { firstName: 'Yuki', country: 'Japan', instagram: null },
];

async function wornStressRoutes(page: Page): Promise<void> {
  const ids = Array.from({ length: WORN_STRESS_TOTAL }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  let urls: string[] = [];
  const photos = (from: number, to: number) =>
    ids.slice(from, to).map((id, k) => {
      const i = from + k;
      return { id, url: urls[i % urls.length]!, width: 1600, height: 2000, credit: WORN_STRESS_CREDITS[i % WORN_STRESS_CREDITS.length]! };
    });
  await page.route('**/api/v1/lookbook/monolithe', async (route) => {
    const res = await route.fetch();
    const sheet = (await res.json()) as { worn: { photos: { url: string }[]; total: number } };
    urls = sheet.worn.photos.map((p) => p.url);
    await route.fulfill({ response: res, json: { ...sheet, worn: { photos: photos(0, 12), total: WORN_STRESS_TOTAL } } });
  });
  await page.route('**/api/v1/lookbook/monolithe/worn?*', async (route) => {
    const n = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({ json: { photos: photos((n - 1) * 12, n * 12), total: WORN_STRESS_TOTAL, page: n, pageSize: 12 } });
  });
}

/** A result read from a photo of `role`'s code, then `then` on it. */
function result(role: string, then?: (run: StateRun) => Promise<void>): Pick<UiState, 'path' | 'act' | 'ready'> {
  return {
    path: at('/verify'),
    act: async (run) => {
      await run.page.locator('.view--now[data-ready]').waitFor();
      await upload(run, role);
      await run.page.locator('.view--result .n-result__title').waitFor({ timeout: 30_000 });
      await settle(run.page);
      await then?.(run);
    },
    ready: '.view--result',
  };
}

/** A computer: the OWNERSHIP tab's SIGN IN opens the sign-in page, where FORGOTTEN PASSWORD? is (a phone's is in the tab). */
async function resultSignIn(run: StateRun): Promise<void> {
  if (!(await onComputer(run))) return;
  await run.page.locator('.view--result .d-signin-line').getByRole('link', { name: 'SIGN IN', exact: true }).click();
  await run.page.locator('.view--signin form').first().waitFor();
}

/** On a result signed in, OWNERSHIP: the piece `role` registered with its claim code (REGISTER THIS PIECE). */
async function registerPiece(run: StateRun, role: string): Promise<void> {
  await tab(run, 'OWNERSHIP').click();
  const code = run.demo.claimCodes[role];
  if (!code) throw new Error(`no claim code for ${role}`);
  await run.page.getByLabel('CLAIM CODE').first().fill(code);
  await button(run, 'REGISTER THIS PIECE').click();
  await button(run, 'VIEW AS OWNER').waitFor({ timeout: 20_000 });
}

/** The scan opened from NOW (its SCAN ORBES CODE). */
async function openScanner(run: StateRun): Promise<void> {
  await run.page.locator('.view--now[data-ready]').waitFor();
  await button(run, 'SCAN ORBES CODE').click();
}

/**
 * The decoder's worker replaced by one that answers every frame with `reply` (a failure the scan's guidance reads: a
 * hint, the seal seen), so a state of the scanner the hand-held clip never shows can be captured.
 */
async function stubDecoder(page: Page, reply: Record<string, unknown>): Promise<void> {
  const body = `const reply = ${JSON.stringify(reply)};
self.addEventListener('message', (ev) => {
  const m = ev.data;
  const out = { type: 'result', id: m && m.id, timing: { grayMs: 0, decodeMs: 1, totalMs: 1 }, ...reply, buffer: m && m.buffer };
  self.postMessage(out, m && m.buffer ? [m.buffer] : []);
});
self.postMessage({ type: 'ready' });`;
  await page.route('**/assets/verify-worker-*.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body }));
}

/** A problem of the scan, read from the result of `routeTo` on /api/v1/verify (a photo of the first piece's code). */
function verifyProblem(id: string, title: string, fulfil: (route: Route) => Promise<void>): UiState {
  return {
    id,
    title,
    refs: ['C17'],
    variant: 'full',
    path: at('/verify'),
    routes: async (page) => page.route('**/api/v1/verify', fulfil),
    act: async (run) => {
      await run.page.locator('.view--now[data-ready]').waitFor();
      await upload(run, 'first');
    },
    ready: '.view--message',
  };
}

function cameraProblem(id: string, title: string, camera: CameraFailure): UiState {
  return { id, title, refs: ['C17'], variant: 'full', path: at('/verify'), camera, act: openScanner, ready: '.view--message' };
}

/**
 * The account sheet opened by the header's account button (the tier's name and the monogram), once the tier is read;
 * the phone then as tall as the sheet's content below the header and the rail, so the whole sheet is in the picture.
 */
async function openAccountSheet(run: StateRun): Promise<void> {
  // The phone's button; a computer's link to YOUR ACCOUNT's page (desktop, decision 5).
  const account = run.page.locator('.n-hd .n-acct:has(> .n-mono):not([hidden])');
  await account.waitFor();
  // The tier is read for the header: wait for its name (or for an account without one, a moment).
  await run.page.waitForFunction(() => !!document.querySelector('.n-acct__tier:not([hidden])')?.textContent || document.querySelector('.n-acct')?.getAttribute('aria-label') === 'Your account', null, { timeout: 10_000 }).catch(() => {});
  await account.click();
  await run.page.locator(`${ACCT} :is(.n-account__tier, .d-acct__cards)`).first().waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** YOUR SIZES (plan NEXT-NINE, AC-01): the account sheet opened, then its view of the four sizes, the phone grown to it. */
async function openSizes(run: StateRun): Promise<void> {
  await openAccountSheet(run);
  await (await accountItem(run, /^YOUR SIZES/)).click();
  await run.page.locator(`${ACCT} :is(.n-account__sizes-view, .d-acct__sub--sizes) form`).waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** YOUR SIZES' fields set (a value of each select, '' for NOT SET), then SAVE, the sheet back with its sentence. */
async function saveSizes(run: StateRun, values: Readonly<Record<string, string>>): Promise<void> {
  await openSizes(run);
  for (const [kind, value] of Object.entries(values)) await run.page.selectOption(`#account-size-${kind}`, value);
  await button(run, 'SAVE').click();
  await run.page.getByText('Your sizes are saved.').first().waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** The phone grown (or shrunk) to the sheet: its top (under the header and the rail), its content and its foot's padding. */
async function fitSheet(page: Page, selector = '.n-account__panel'): Promise<void> {
  const height = await page.evaluate((sel) => {
    const panel = [...document.querySelectorAll<HTMLElement>(sel)].find((p) => p.closest('[hidden]') === null);
    if (!panel) return 0;
    // The bottom of its last piece, in the page (scrolled back), then its padding.
    const bottom = Math.max(...[...panel.children].map((c) => c.getBoundingClientRect().bottom + panel.scrollTop));
    return Math.ceil(bottom + Number.parseFloat(getComputedStyle(panel).paddingBottom));
  }, selector);
  const size = page.viewportSize();
  if (size && height > 0) await page.setViewportSize({ width: size.width, height: Math.max(height, 400) });
  await sleep(200);
}

/** WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01) under `within`: the write sheet opened, the phone grown to it. */
async function openWrite(run: StateRun, within = 'main'): Promise<void> {
  await run.page.locator(within).getByRole('button', { name: 'WRITE TO ORBES CLIENT SERVICES' }).first().click();
  // The phone's sheet; a computer's MESSAGES page on the subject, or (signed out) its sign-in page (desktop).
  await run.page.locator(':is(.n-write:not([hidden]) #write-title, .d-msg #messages-reply, .d-signin__panel .n-own)').first().waitFor({ timeout: 20_000 });
  await fitSheet(run.page, '.n-write__panel');
}

/** The account sheet on MESSAGES (CS-01), its conversation read, the phone grown to it. */
async function openMessages(run: StateRun, ready: string): Promise<void> {
  // A computer: YOUR ACCOUNT's page, then its MESSAGES card, which opens MESSAGES' page (desktop).
  if (await onComputer(run)) {
    await run.page.locator('.n-hd .n-acct:has(> .n-mono):not([hidden])').click();
    await run.page.locator('.d-acct__card[data-key="messages"]').click({ timeout: 20_000 });
  } else {
    await openAccountSheet(run);
    await run.page.locator('.n-account').getByRole('button', { name: 'MESSAGES' }).first().click();
  }
  await run.page.locator(ready).first().waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** A message of the demo's account `you` about its piece, written as the app writes it, and ORBES Client Services' answer. */
async function messageAndAnswer(run: StateRun): Promise<void> {
  const you = run.demo.accounts.you!;
  const { messages } = run.stage.ctx.services;
  await messages.write(you.id, { body: 'The clasp of my bracelet slips a little since last week.\nCould the atelier look at it?', context: { kind: 'PIECE', id: run.demo.pieces.yours! } }, you.actor);
  const conversation = await run.stage.ctx.db.selectFrom('client_conversations').select('id').where('account_id', '=', you.id).executeTakeFirstOrThrow();
  const admin = await run.stage.ctx.db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow();
  await messages.answer(conversation.id, { type: 'admin', id: admin.id }, { body: 'Thank you. Bring it to the Paris boutique, or send it with the label we prepare: the atelier will adjust the clasp.' });
}

/**
 * FROM ORBES (lot M2, macro scope D24 M3 and M4): MESSAGES opened (the phone's sheet, a computer's page), then on a
 * computer its subject FROM ORBES chosen (a computer's page opens on the newest subject).
 */
async function openFromOrbes(run: StateRun, ready: string): Promise<void> {
  await openMessages(run, ':is(.n-messages__parts, .n-messages__list, .n-messages__empty, .n-house__list, .d-msg__subjects)');
  if (await onComputer(run)) await run.page.locator('.d-msg__subject[data-key="from-orbes"]').click();
  else {
    // Nothing unread: MESSAGES opens on the conversation; its tab FROM ORBES then.
    const tab = run.page.locator('.n-account:not([hidden]) #messages-part-house[aria-selected="false"]');
    if (await tab.count()) await tab.click();
  }
  await run.page.locator(ready).first().waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** A long model name, as a moment's {piece} may write it (stress). */
const LONG_PIECE = 'MONOLITHE, THE ARCHITECTURE OF THE WRIST IN BRUSHED STEEL AND MIDNIGHT LACQUER';

/**
 * FROM ORBES at its longest (stress, lot M2): a page of 30 of 45 house messages, as the server would give them (two
 * unread): an 80-character title, 2,000 characters of words, a long model name in a moment's words, every kind of link;
 * the next page of 15 behind SHOW EARLIER. Reading is answered here, so the stage is never written.
 */
async function houseStress(page: Page): Promise<void> {
  const total = 45;
  const day = 86_400_000;
  const words = 'Each piece of ORBES is registered to its owner, and its care, its sizes and its releases are kept with the account. ';
  const long = (words.repeat(Math.ceil(2000 / words.length)).slice(0, 1990).trimEnd() + ' Thank you.').slice(0, 2000);
  const item = (i: number) => {
    const at = new Date(NOCTURNE_NOW.getTime() - i * day - 3_600_000).toISOString();
    const moments = ['FIRST_REGISTRATION', 'OWNERSHIP_YEAR', 'BIRTHDAY_CREDIT', 'PRIVATE_CARE', 'NINETY_DAYS', null] as const;
    const moment = i === 0 ? null : i === 1 ? 'FIRST_REGISTRATION' : moments[i % moments.length]!;
    const title = i === 0 ? 'A LETTER FROM THE HOUSE TO EVERY COLLECTOR OF THE FIRST SEASON OF ORBES, IN FULL' : i === 1 ? 'YOUR FIRST PIECE' : `A MESSAGE FROM ORBES, NUMBER ${total - i}`;
    const body = i === 0 ? long : i === 1 ? `${LONG_PIECE} is registered to you. How to care for it is in its ORBES CARE tab, and YOUR SIZES keeps your sizes for the releases to come.` : 'Since your last visit, THE COLLECTION and THE RELEASES have moved on.';
    const piece = moment === 'FIRST_REGISTRATION' || moment === 'OWNERSHIP_YEAR';
    return { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, source: moment ? 'MOMENT' : 'CUSTOM', moment, title, body, pieceRef: piece ? 'O26-J-00184' : null, pieceHeld: piece ? i !== 7 : null, at, unread: i < 2 };
  };
  await page.route('**/api/v1/account/house-messages?*', async (route) => {
    const at = Math.max(1, Number(new URL(route.request().url()).searchParams.get('page')) || 1);
    const messages = [];
    for (let i = (at - 1) * 30; i < Math.min(total, at * 30); i++) messages.push(item(i));
    await route.fulfill({ json: { messages, unread: 2, total } });
  });
  await page.route('**/api/v1/account/house-messages/read', (route) => route.fulfill({ status: 204, body: '' }));
}

/**
 * Plan NEXT LOT §3.4, the state claim-waiting (its own stage, the full story): ORBES Client Services sells you a
 * MONOLITHE in blue through THE PRIVATE SALON (size 17, € 4 200), marks it PAID; a Generator piece counted in is packed
 * and shipped through the agent's steps with Colissimo (its warranty started by hand, ORBES PARIS), unregistered; then the piece's card is lost and New claim code makes
 * it a new claim code for its buyer, waiting on the order. Written once per stage (a second opening finds it there).
 */
async function claimWaiting(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  const waiting = await db.selectFrom('claim_code_renewals').select('id').where('account_id', '=', you.id).where('status', '=', 'WAITING').executeTakeFirst();
  if (waiting) return;
  const admin = { type: 'admin' as const, id: (await db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id };
  const blue = (await db.selectFrom('models').select('id').where('slug', '=', run.demo.slugs.blue!).executeTakeFirstOrThrow()).id;
  const request = await db.insertInto('shop_requests').values({ account_id: you.id, model_id: blue, created_at: NOCTURNE_NOW }).returning('id').executeTakeFirstOrThrow();
  await services.salon.close(request.id, { note: 'A MONOLITHE in blue, size 17.', outcome: 'ACCEPTED' }, admin);
  const order = await db.selectFrom('orders').select(['id', 'location_id']).where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
  // Its piece, issued by the Generator and counted in where the order is served (test/support/fulfil.ts countPiecesIn);
  // paid, then packed and shipped through the agent's steps (packAndShip: the packing scan binds it), its warranty
  // started by hand before SHIP, which leaves it as it is.
  const sku = (await db.selectFrom('skus').select('id').where('model_id', '=', blue).where('size_label', '=', '17').executeTakeFirstOrThrow()).id;
  const piece = await services.issuance.issueProduct(
    { categoryCode: 'J', year: 2026, modelId: blue, variant: '17', material: '925 STERLING SILVER, BLUE LACQUER', productionBatch: 'B-2026-10', productionDate: '2026-10-01', withClaimSecret: true },
    admin,
  );
  await countPiecesIn(run.stage.ctx, { skuId: sku, locationId: order.location_id, productRefs: [piece.product.productId] }, admin);
  await services.orders.setTerms(order.id, { sizeLabel: '17', priceMinor: 420_000, currency: 'EUR' }, admin);
  // Its buyer entered by ORBES Client Services as the demo's other orders are (packAndShip's fixture buyer otherwise).
  await services.orders.setBuyer(order.id, { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris\nFrance', country: 'FR' }, admin);
  await services.orders.transition(order.id, { to: 'PAID' }, admin);
  const colissimo = (await db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  await packAndShip(
    run.stage.ctx,
    order.id,
    {
      carrierId: colissimo,
      trackingNumber: '6A10000000017',
      declaredValueMinor: 420_000,
      pieces: { [order.id]: piece.product.productId },
      beforeShip: async () => {
        await services.warranty.activate(piece.product.id, { purchaseDate: '2026-10-05', retailer: 'ORBES PARIS', country: 'FR' }, admin);
      },
    },
    admin,
  );
  await services.claimRenewals.renew(piece.product.productId, { reason: 'Card lost', expect: 'SOLD', after: null }, admin);
}

/** The demo's ORBES admin, as an actor. */
async function demoAdmin(run: StateRun): Promise<{ type: 'admin'; id: string }> {
  return { type: 'admin' as const, id: (await run.stage.ctx.db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id };
}

/** The two addresses `you` saves in the states of plan NEXT LOT §3.6 (test values of this demo only). */
const YOUR_ADDRESSES = [
  { name: 'Camille Laurent', address: '8 rue Saint-Honoré\n75001 Paris', country: 'FR', phone: '+33 6 12 34 56 78' },
  { name: 'Camille Laurent', address: '25 Old Bond Street\nLondon W1S 4QB', country: 'GB', phone: '+44 20 7946 0000' },
] as const;

/**
 * A salon order of MONOLITHE in blue, size 17, € 4 200, for `you` (closed ACCEPTED by ORBES Client Services), its piece
 * issued by the Generator and counted in where it is served (test/support/fulfil.ts countPiecesIn), paid: it holds its
 * piece (IN PREPARATION). Its id and its piece.
 */
async function bluePaidOrder(run: StateRun, admin: { type: 'admin'; id: string }): Promise<{ orderId: string; productId: string }> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  const blue = (await db.selectFrom('models').select('id').where('slug', '=', run.demo.slugs.blue!).executeTakeFirstOrThrow()).id;
  const request = await db.insertInto('shop_requests').values({ account_id: you.id, model_id: blue, created_at: NOCTURNE_NOW }).returning('id').executeTakeFirstOrThrow();
  await services.salon.close(request.id, { note: 'A MONOLITHE in blue, size 17.', outcome: 'ACCEPTED' }, admin);
  const order = await db.selectFrom('orders').select(['id', 'location_id']).where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
  const sku = (await db.selectFrom('skus').select('id').where('model_id', '=', blue).where('size_label', '=', '17').executeTakeFirstOrThrow()).id;
  const piece = await services.issuance.issueProduct(
    { categoryCode: 'J', year: 2026, modelId: blue, variant: '17', material: '925 STERLING SILVER, BLUE LACQUER', productionBatch: 'B-2026-10', productionDate: '2026-10-01', withClaimSecret: true },
    admin,
  );
  await countPiecesIn(run.stage.ctx, { skuId: sku, locationId: order.location_id, productRefs: [piece.product.productId] }, admin);
  await services.orders.setTerms(order.id, { sizeLabel: '17', priceMinor: 420_000, currency: 'EUR' }, admin);
  await services.orders.transition(order.id, { to: 'PAID' }, admin);
  return { orderId: order.id, productId: piece.product.productId };
}

/**
 * Plan NEXT LOT §3.6.B and C, the state orders-delivery (its own stage, the full story): ORBES sets the ENGRAVING
 * add-on's price in euros (€ 30) and turns its YOUR ORDERS switch on (lot Q2, step Q2.5, N4: what the settings' engraving
 * price became, §3.4 item 2); you save a default address and put it on your reserved LIVE order, then type its engraving
 * (the release's ENGRAVING add-on of before: its words alone); ORBES Client Services sells you a MONOLITHE in blue, paid,
 * holding its piece (your default address put on it), you add an engraving at the add-on's price (its unit, with its own
 * invoice), and the agent begins packing it. Written once per stage.
 */
async function ordersDelivery(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  if (await db.selectFrom('account_addresses').select('id').where('account_id', '=', you.id).executeTakeFirst()) return;
  const admin = await demoAdmin(run);
  const engraving = (await db.selectFrom('addon_items').select('id').where('engraving', '=', true).where('active', '=', true).executeTakeFirstOrThrow()).id;
  await services.addons.setPrices(engraving, { EUR: 3_000 }, admin);
  await services.addons.update(engraving, { offeredAt: { orders: true } }, admin);
  const saved = await services.addresses.create(you.id, { ...YOUR_ADDRESSES[0], isDefault: true }, you.actor);
  const live = await db.selectFrom('orders').select('id').where('account_id', '=', you.id).where('channel', '=', 'LIVE').where('status', '=', 'RESERVED').executeTakeFirstOrThrow();
  await services.orders.setAddress(you.id, live.id, { addressId: saved.addresses[0]!.id }, you.actor);
  await services.orders.setEngraving(you.id, live.id, 'C.L.', you.actor);
  const blue = await bluePaidOrder(run, admin);
  await services.orders.setEngraving(you.id, blue.orderId, 'A.R.', you.actor);
  await services.logistics.startPacking(blue.orderId, admin, null);
}

/**
 * Plan NEXT LOT §3.6.D, the state orders-case (its own stage, the full story): the order's location is given its postal
 * address; ORBES Client Services sells you a MONOLITHE in blue, you give its delivery address, it is packed and shipped
 * through the agent's steps with Colissimo, delivered today; you ask to return it (the size does not fit). The draw's piece delivered on 22 September
 * still offers RETURNS AND EXCHANGES. Written once per stage.
 */
async function ordersCase(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  if (await db.selectFrom('order_cases').select('id').executeTakeFirst()) return;
  const admin = await demoAdmin(run);
  const blue = await bluePaidOrder(run, admin);
  await services.orders.setAddress(you.id, blue.orderId, { address: YOUR_ADDRESSES[0], save: false }, you.actor);
  const location = (await db.selectFrom('orders').select('location_id').where('id', '=', blue.orderId).executeTakeFirstOrThrow()).location_id;
  await services.stock.updateLocation(location, { address: 'ORBES LOGISTICS\n14 rue des Entrepreneurs\n93400 Saint-Ouen\nFrance' }, admin);
  const colissimo = (await db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  await packAndShip(run.stage.ctx, blue.orderId, { carrierId: colissimo, trackingNumber: '6A10000000025', declaredValueMinor: 420_000, pieces: { [blue.orderId]: blue.productId } }, admin);
  await services.orders.transition(blue.orderId, { to: 'DELIVERED' }, admin);
  await services.orderCases.request(you.id, blue.orderId, { kind: 'RETURN', reason: 'SIZE', note: 'A size smaller, please.' }, you.actor);
}

/** Plan NEXT LOT §3.6.B, the state account-addresses (its own stage, the full story): you save two addresses, Paris the default. */
async function accountAddresses(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  if (await db.selectFrom('account_addresses').select('id').where('account_id', '=', you.id).executeTakeFirst()) return;
  await services.addresses.create(you.id, { ...YOUR_ADDRESSES[0], isDefault: true }, you.actor);
  await services.addresses.create(you.id, { ...YOUR_ADDRESSES[1], isDefault: false }, you.actor);
}

/**
 * Plan CUSTOMER INTELLIGENCE §3.1 P.8, the states account-profile and profile-tastes (their own stage): you, Camille
 * Laurent, give your names, country, city and how you heard of ORBES, with your Paris address the default; with
 * `tastes`, your favourite piece (BRACELET) and finish (Gold), and a finish the collection no longer shows (Silver, held
 * from before: NO LONGER IN THE COLLECTION). Written once, whichever state comes first.
 */
async function yourProfile(run: StateRun, tastes: boolean): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  if (!(await db.selectFrom('account_addresses').select('id').where('account_id', '=', you.id).executeTakeFirst())) {
    await services.addresses.create(you.id, { ...YOUR_ADDRESSES[0], isDefault: true }, you.actor);
  }
  const read = await services.profiles.forCollector(you.id);
  if (read.profile.version === 0) {
    const friend = read.options.heard.find((o) => o.label === 'A friend')!;
    await services.profiles.save(
      you.id,
      { version: 0, firstName: 'Camille', lastName: 'Laurent', country: 'FR', city: 'Paris', phone: null, instagram: null, heard: { optionId: friend.id }, tastes: { pieces: [], finishes: [] } },
      you.actor,
    );
  }
  if (tastes && !(await db.selectFrom('account_tastes').select('value_key').where('account_id', '=', you.id).executeTakeFirst())) {
    const now = await services.profiles.forCollector(you.id);
    await services.profiles.save(
      you.id,
      { version: now.profile.version, firstName: 'Camille', lastName: 'Laurent', country: 'FR', city: 'Paris', phone: null, instagram: null, heard: { optionId: now.profile.heard!.optionId }, tastes: { pieces: ['BRACELET'], finishes: ['GOLD'] } },
      you.actor,
    );
    // A finish chosen when the collection showed it, which it no longer does (no model of THE COLLECTION reads Silver).
    await db.insertInto('account_tastes').values({ account_id: you.id, kind: 'FINISH', value_key: 'SILVER', label: 'Silver' }).execute();
  }
}

/**
 * Plan CUSTOMER INTELLIGENCE §3.5 SB.4.5, the state birthday-credit (its own stage): the account without a piece
 * (t.nguyen) was born on today's day, its date of birth entered on 20 September, before its birthday; the daily grant
 * (BirthdayCreditService.grantDue, as housekeeping runs it) then gives its birthday credit: € 20 for 30 days, until
 * 3 November 2026. Written once.
 */
async function birthdayCredit(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const newcomer = run.demo.accounts.newcomer!;
  if (await db.selectFrom('tier_grants').select('id').where('account_id', '=', newcomer.id).where('kind', '=', 'BIRTHDAY').executeTakeFirst()) return;
  const read = await services.profiles.forCollector(newcomer.id);
  // Paris and UTC name the same day at the stage's hour (18:49 in Paris).
  await services.profiles.save(newcomer.id, { version: read.profile.version, birthDate: `1994-${NOCTURNE_NOW.toISOString().slice(5, 10)}` }, newcomer.actor);
  const entered = new Date(NOCTURNE_NOW.getTime() - 15 * 86_400_000);
  await db.updateTable('account_profiles').set({ birth_date_at: entered, birth_date_collector_at: entered }).where('account_id', '=', newcomer.id).execute();
  if ((await services.birthdayCredits.grantDue(NOCTURNE_NOW)) !== 1) throw new Error('birthday-credit: the daily grant gave no credit to the account without a piece');
}

/**
 * Plan CUSTOMER INTELLIGENCE §3.2 W.10.2, the state wishlist (the stage wishes): your three wishes, the latest first:
 * MONOLITHE in blue (shown; the heart of sheet-wished, or written here), MONOLITHE in gold wished two days before and
 * discontinued since (shown, DISCONTINUED · 2026), ZENITH wished five days before and hidden since (NOT IN THE
 * COLLECTION NOW). Written once.
 */
async function yourWishes(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  const you = run.demo.accounts.you!;
  const model = async (key: string) => (await db.selectFrom('models').select('id').where('slug', '=', run.demo.slugs[key]!).executeTakeFirstOrThrow()).id;
  const [gold, zenith] = [await model('gold'), await model('zenith')];
  if (await db.selectFrom('account_wishes').select('model_id').where('account_id', '=', you.id).where('model_id', '=', zenith).executeTakeFirst()) return;
  const admin = await demoAdmin(run);
  await services.wishlist.add(you.id, run.demo.slugs.blue!);
  const DAY_MS = 86_400_000;
  await db
    .insertInto('account_wishes')
    .values([
      { account_id: you.id, model_id: gold, added_at: new Date(NOCTURNE_NOW.getTime() - 2 * DAY_MS) },
      { account_id: you.id, model_id: zenith, added_at: new Date(NOCTURNE_NOW.getTime() - 5 * DAY_MS) },
    ])
    .execute();
  await services.catalog.discontinueModel(gold, admin);
  await services.catalog.updateModel(zenith, { lookbook: 'HIDDEN' }, admin);
}

/** The account sheet opened on YOUR PROFILE, its form drawn, the phone grown to it. */
async function openProfile(run: StateRun): Promise<void> {
  await openAccountSheet(run);
  await (await accountItem(run, /^YOUR PROFILE/)).click();
  await run.page.locator(`${ACCT} form.form--profile`).waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/**
 * A post's answer as the server sent it, its invitation changed by `change` (and the reader's answer set to `answer`
 * when given): the states of an invitation the demo's clock does not reach (C22: answers closed, every place taken).
 */
async function invitationAnswer(page: Page, change: (inv: Record<string, unknown>) => Record<string, unknown>, answer?: string | null): Promise<void> {
  await page.route('**/api/v1/club/circle/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { invitation: Record<string, unknown> | null; answer: string | null };
    const json = { ...body, invitation: body.invitation ? change(body.invitation) : null, ...(answer === undefined ? {} : { answer }) };
    await route.fulfill({ response: res, json });
  });
}

/** The states of the phone (and the boutique board's screen): those of the NOCTURNE baseline at c3d25c2. */
export const PHONE_STATES: readonly UiState[] = [
  // ── NOW (today: the landing, its banner of the LIVE RELEASES) ──
  { id: 'now-signed-out', title: 'NOW, signed out: a LIVE RELEASE announced, a draw open', refs: ['C10'], variant: 'full', path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-signed-in', title: 'NOW, signed in (TITANE, two pieces): a LIVE RELEASE announced, a draw open', refs: ['C1'], variant: 'full', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
  {
    id: 'now-messages',
    title: 'NOW, an answer of ORBES Client Services unread: MESSAGES, its sentence, READ, under the hero (CS-01)',
    refs: ['CS-01'],
    variant: 'full',
    as: you,
    path: at('/verify'),
    act: async (run) => {
      await messageAndAnswer(run);
      await run.page.reload();
    },
    ready: '.view--now[data-ready] .now__messages',
    mutates: true,
  },
  { id: 'now-draw-leads', title: 'NOW, no LIVE RELEASE announced: the draw leads', refs: ['C42'], variant: 'draw-leads', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-draw-soon', title: 'NOW, the draw before its entries open', refs: ['C42'], variant: 'draw-soon', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-draw-early', title: 'NOW, the draw in its early access', refs: ['C42'], variant: 'draw-early', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-collection-leads', title: 'NOW, nothing announced: the newest model leads', refs: ['C43'], variant: 'collection-leads', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-collection-leads-signed-out', title: 'NOW, nothing announced, signed out', refs: ['C43'], variant: 'collection-leads', path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-room-open', title: 'NOW while a room is open: the LIVE RELEASE leads, THE ROOM IS OPEN', refs: ['live-01'], variant: 'room', path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-live', title: 'NOW while a LIVE RELEASE is live: it leads, LIVE NOW', refs: ['live-01'], variant: 'live', path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-empty', title: 'NOW with nothing at all (no model, no release), signed in without a piece', refs: ['C43'], variant: 'empty', as: you, path: at('/verify'), ready: '.view--now[data-ready]', stress: true },
  { id: 'now-stress', title: 'NOW with the extreme content (a release in 42 minutes, its room open)', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify'), ready: '.view--now[data-ready]', stress: true },

  // ── The scan ──
  { id: 'scan-preparing', title: 'The scan: PREPARING CAMERA…, before the stream', refs: ['C38'], variant: 'full', path: at('/verify'), camera: 'hold', act: openScanner, ready: '.view--scan', viewport: true },
  {
    id: 'scan-camera',
    title: 'The scan: the camera searching, LIGHT and the zoom toggle (0.5×, opened at 2×)',
    refs: ['C11'],
    variant: 'full',
    path: at('/verify'),
    routes: async (page, hold) => hold.hold('**/assets/verify-worker-*.js'),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--scan.is-ready').waitFor({ timeout: 20_000 });
      await sleep(1_600);
    },
    ready: '.view--scan.is-ready',
    viewport: true,
  },
  {
    id: 'scan-light-zoom',
    title: 'The scan: LIGHT pressed, the zoom toggled to the widest view (the toggle offering 2×)',
    refs: ['C38'],
    variant: 'full',
    path: at('/verify'),
    routes: async (page, hold) => hold.hold('**/assets/verify-worker-*.js'),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--scan.is-ready').waitFor({ timeout: 20_000 });
      await button(run, 'LIGHT').click();
      await run.page.locator('.view--scan .n-cam__zoom').click();
      await sleep(600);
    },
    ready: '.view--scan.is-ready',
    viewport: true,
  },
  {
    id: 'scan-hint',
    title: 'The scan: after 6 seconds without a read, a hint in place of the guide (Hold steady — in even light)',
    refs: ['C38'],
    variant: 'full',
    path: at('/verify'),
    // A decoder that finds the code's format but never reads it: the hint of a code seen but not held still.
    routes: async (page) => stubDecoder(page, { ok: false, reason: 'FORMAT', moduleSizePx: 12 }),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--scan.is-ready').waitFor({ timeout: 20_000 });
      await run.page.waitForFunction(() => document.querySelector('.view--scan .n-cam__hint')?.textContent === 'Hold steady — in even light', null, { timeout: 20_000 });
      await sleep(900);
    },
    ready: '.view--scan.is-ready',
    viewport: true,
  },
  {
    id: 'scan-seal',
    title: 'The scan: the seal seen, the ring tightened round the centre',
    refs: ['C38'],
    variant: 'full',
    path: at('/verify'),
    // A decoder that sees a certain seal and no moons, frame after frame: the ring holds tight.
    routes: async (page) => stubDecoder(page, { ok: false, reason: 'NO_MOONS', seal: { confidence: 1, unitPx: 6 } }),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--scan.is-sealed').waitFor({ timeout: 20_000 });
      await sleep(900);
    },
    ready: '.view--scan.is-sealed',
    viewport: true,
  },
  {
    id: 'scan-verifying',
    title: 'The scan: the code locked, then VERIFYING…',
    refs: ['C12'],
    variant: 'full',
    path: at('/verify'),
    routes: async (page, hold) => hold.hold('**/api/v1/verify'),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--scan.is-locked').waitFor({ timeout: 30_000 });
      await run.page.waitForFunction(() => /VERIFYING/.test(document.querySelector('.view--scan')?.textContent ?? ''), null, { timeout: 10_000 });
      await sleep(1_400);
    },
    ready: '.view--scan.is-locked',
    viewport: true,
  },
  {
    id: 'photo-verifying',
    title: 'The photo path: READING PHOTO…, then VERIFYING…',
    refs: ['C12'],
    variant: 'full',
    path: at('/verify'),
    routes: async (page, hold) => hold.hold('**/api/v1/verify'),
    act: async (run) => {
      await run.page.locator('.view--now[data-ready]').waitFor();
      await upload(run, 'first');
      await run.page.waitForFunction(() => document.querySelector('.view--verifying .n-cam__line')?.textContent === 'VERIFYING…', null, { timeout: 20_000 });
      await sleep(1_300);
    },
    ready: '.view--verifying',
    viewport: true,
  },

  // ── The results ──
  { id: 'result-first-registration', title: 'AUTHENTIC — FIRST REGISTRATION, signed out: OWNERSHIP and the sign-in', refs: ['C9'], variant: 'full', ...result('first') },
  { id: 'result-first-registration-product', title: 'AUTHENTIC — FIRST REGISTRATION: the PRODUCT tab', refs: ['same pieces'], variant: 'full', ...result('first', (run) => tab(run, 'PRODUCT').click()) },
  // Plan ORBES CARE, step 2.3 (answer 6): the WARRANTY and CARE tabs merged into ORBES CARE, one state for their two.
  {
    id: 'result-first-registration-care',
    title: 'AUTHENTIC — FIRST REGISTRATION: the ORBES CARE tab (its WARRANTY, CARING FOR THIS PIECE, the contact)',
    refs: ['C35'],
    variant: 'full',
    ...result('first', (run) => tab(run, 'ORBES CARE').click()),
  },
  {
    id: 'result-create-account',
    title: 'The OWNERSHIP tab, signed out: CREATE ACCOUNT',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      // A computer: the line's CREATE ACCOUNT opens the sign-in page on its form.
      if (await onComputer(run)) {
        await run.page.locator('.view--result .d-signin-line').getByRole('link', { name: 'CREATE ACCOUNT', exact: true }).click();
        await run.page.locator('.view--signin form.form--create').waitFor();
      } else await button(run, 'CREATE ACCOUNT').click();
    }),
    // A computer: the sign-in page in the result's place (decision 6).
    ready: ':is(.view--result, .view--signin .d-signin__panel)',
  },
  {
    id: 'result-forgotten-password',
    title: 'The OWNERSHIP tab, signed out: FORGOTTEN PASSWORD?',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await resultSignIn(run);
      await button(run, 'FORGOTTEN PASSWORD?').click();
    }),
    // A computer: the sign-in page in the result's place (decision 6).
    ready: ':is(.view--result, .view--signin .d-signin__panel)',
  },
  {
    id: 'result-recovery-code',
    title: 'The OWNERSHIP tab, signed out: SET A NEW PASSWORD with a recovery code',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await resultSignIn(run);
      await button(run, 'FORGOTTEN PASSWORD?').click();
      await button(run, 'I HAVE A RECOVERY CODE').click();
    }),
    // A computer: the sign-in page in the result's place (decision 6).
    ready: ':is(.view--result, .view--signin .d-signin__panel)',
  },
  { id: 'result-first-registration-signed-in', title: 'AUTHENTIC — FIRST REGISTRATION, signed in: the claim code', refs: ['C36'], variant: 'full', as: you, ...result('first', (run) => tab(run, 'OWNERSHIP').click()) },
  {
    id: 'result-registration-closed',
    title: 'AUTHENTIC — FIRST REGISTRATION, signed in, the window of the scan closed: SCAN AGAIN',
    refs: ['C36'],
    variant: 'full',
    as: you,
    // The scan's window closed as the result arrives: its registration ends when it was verified.
    routes: async (page) =>
      page.route('**/api/v1/verify', async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { verifiedAt?: string; registration?: { expiresAt: string } };
        if (body.registration && body.verifiedAt) body.registration.expiresAt = body.verifiedAt;
        await route.fulfill({ response, json: body });
      }),
    ...result('first', (run) => tab(run, 'OWNERSHIP').click()),
  },
  { id: 'result-not-delivered', title: 'AUTHENTIC, a piece not delivered yet: registration opens once it has been', refs: ['C36'], variant: 'full', ...result('stock', (run) => tab(run, 'OWNERSHIP').click()) },
  { id: 'result-registered-signed-out', title: 'AUTHENTIC — REGISTERED, signed out: the resale guidance and RECEIVING THIS PIECE', refs: ['C13'], variant: 'full', ...result('yours', (run) => tab(run, 'OWNERSHIP').click()) },
  { id: 'result-registered-transfer-link', title: 'AUTHENTIC — REGISTERED: I HAVE A TRANSFER CODE', refs: ['C13'], variant: 'full', ...result('yours', (run) => link(run, 'I HAVE A TRANSFER CODE').or(button(run, 'I HAVE A TRANSFER CODE')).first().click()) },
  {
    id: 'result-registered-other',
    title: 'AUTHENTIC — REGISTERED, signed in as another account, no transfer pending: OWNERSHIP',
    refs: ['C37'],
    variant: 'full',
    as: 'newcomer',
    ...result('yours', (run) => tab(run, 'OWNERSHIP').click()),
    ready: '.view--result [role=tabpanel]:not([hidden]) :text("No transfer of this piece is pending")',
  },
  { id: 'result-receiving', title: 'AUTHENTIC — REGISTERED, a transfer pending, signed in as its receiver: RECEIVING OPEN UNTIL', refs: ['C37'], variant: 'full', as: 'newcomer', ...result('passing') },
  { id: 'result-ownership-verified', title: 'AUTHENTIC — OWNERSHIP VERIFIED: the account’s own piece, OWNERSHIP: CREATE TRANSFER CODE', refs: ['C14'], variant: 'full', as: you, ...result('gold', (run) => tab(run, 'OWNERSHIP').click()) },
  { id: 'result-ownership-verified-product', title: 'AUTHENTIC — OWNERSHIP VERIFIED: the PRODUCT tab it opens on', refs: ['C14'], variant: 'full', as: you, ...result('gold') },
  { id: 'result-unusual-card', title: 'UNUSUAL ACTIVITY DETECTED: DO YOU HOLD THE CERTIFICATE CARD? and WHERE DID YOU SEE OR BUY THIS PIECE?', refs: ['C15'], variant: 'full', ...result('copied') },
  { id: 'result-unusual-stolen', title: 'UNUSUAL ACTIVITY DETECTED: a piece reported stolen', refs: ['C15'], variant: 'full', ...result('stolen') },
  {
    id: 'result-unusual-report-open',
    title: 'UNUSUAL ACTIVITY: WHERE DID YOU SEE OR BUY THIS PIECE? answered BOUTIQUE',
    refs: ['C15'],
    variant: 'full',
    ...result('stolen', (run) => button(run, 'BOUTIQUE').click()),
  },
  { id: 'result-invalid', title: 'INVALID SIGNATURE', refs: ['C16'], variant: 'full', ...result('forged') },
  {
    id: 'result-write-signed-out',
    title: 'INVALID SIGNATURE, WRITE TO ORBES CLIENT SERVICES signed out: sign in or create an account first (CS-01)',
    refs: ['CS-01'],
    variant: 'full',
    ...result('forged', (run) => openWrite(run, '.n-result__help')),
    ready: ':is(.n-write:not([hidden]), .d-signin__panel) .n-own',
    viewport: true,
  },
  { id: 'result-unknown', title: 'UNKNOWN ORBES CODE: a code ORBES signed for no piece', refs: ['C16'], variant: 'full', ...result('unknown') },
  { id: 'result-revoked', title: 'REVOKED', refs: ['C16'], variant: 'full', ...result('revoked') },
  {
    id: 'result-unreadable',
    title: 'UNREADABLE CODE: a code read whole by the phone, its frame damaged on the way (MALFORMED_CODE)',
    refs: ['C16'],
    variant: 'full',
    // The first piece's code, read by the phone as it is; on its way to the server its last characters are lost, so the
    // server cannot unframe it and answers MALFORMED_CODE, as for a code damaged beyond its correction.
    routes: async (page) =>
      page.route('**/api/v1/verify', async (route) => {
        const body = route.request().postDataJSON() as { code: string };
        await route.continue({ postData: JSON.stringify({ ...body, code: body.code.slice(0, -6) }) });
      }),
    ...result('first'),
  },
  {
    id: 'result-stress',
    title: 'AUTHENTIC — FIRST REGISTRATION of the 24-character model in its 14-character variant, a Size of 14 characters: OWNERSHIP',
    refs: ['same pieces'],
    variant: 'stress',
    stress: true,
    ...result('stressFirst', (run) => tab(run, 'OWNERSHIP').click()),
  },

  // ── The problems of the scan ──
  cameraProblem('problem-camera-denied', 'CAMERA ACCESS DECLINED', 'NotAllowedError'),
  cameraProblem('problem-camera-missing', 'NO CAMERA AVAILABLE', 'NotFoundError'),
  cameraProblem('problem-camera-in-use', 'CAMERA UNAVAILABLE (in use)', 'NotReadableError'),
  cameraProblem('problem-camera-unsupported', 'CAMERA NOT SUPPORTED', 'unsupported'),
  verifyProblem('problem-network', 'CONNECTION INTERRUPTED', (r) => r.abort('internetdisconnected')),
  verifyProblem('problem-rate-limited', 'A MOMENT, PLEASE', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }) })),
  verifyProblem('problem-server', 'VERIFICATION UNAVAILABLE', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Unavailable.' } }) })),
  {
    id: 'problem-scan-timeout',
    title: 'NO ORBES CODE FOUND, after 40 seconds of the camera without a read',
    refs: ['C17'],
    variant: 'full',
    path: at('/verify'),
    // A decoder that never finds a code: after 40 seconds, the scan gives up.
    routes: async (page) => stubDecoder(page, { ok: false, reason: 'NO_SEAL' }),
    act: async (run) => {
      await openScanner(run);
      await run.page.locator('.view--message').waitFor({ timeout: 60_000 });
    },
    ready: '.view--message',
  },
  {
    id: 'problem-photo-unreadable',
    title: 'NO ORBES CODE FOUND in a photo',
    refs: ['C17'],
    variant: 'full',
    path: at('/verify'),
    act: async (run) => {
      await run.page.locator('.view--now[data-ready]').waitFor();
      await run.page.setInputFiles('#photo-input', { name: 'blank.png', mimeType: 'image/png', buffer: blankPng() });
    },
    ready: '.view--message',
  },
  {
    id: 'problem-photo-invalid',
    title: 'PHOTO NOT READABLE',
    refs: ['C17'],
    variant: 'full',
    path: at('/verify'),
    act: async (run) => {
      await run.page.locator('.view--now[data-ready]').waitFor();
      await run.page.setInputFiles('#photo-input', { name: 'note.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    },
    ready: '.view--message',
  },

  // ── MY PIECES ──
  { id: 'pieces-signed-out', title: 'MY PIECES, signed out: the sign-in', refs: ['C18'], variant: 'full', path: at('/verify/pieces'), ready: ':is(.view--pieces form, .view--pieces .d-signin-line)' },
  {
    id: 'pieces-sign-in-refused',
    title: 'MY PIECES, signed out: a sign-in refused',
    refs: ['C18'],
    variant: 'full',
    path: at('/verify/pieces'),
    act: async (run) => {
      // A computer: MY PIECES' SIGN IN opens the sign-in page, where the form is.
      let scope = '.view--pieces';
      if (await onComputer(run)) {
        await run.page.locator('.view--pieces .d-signin-line').getByRole('link', { name: 'SIGN IN', exact: true }).click();
        scope = '.view--signin';
        await run.page.locator(`${scope} form`).first().waitFor();
      }
      await run.page.locator(`${scope} input[type=email]`).first().fill('you@example.com');
      await run.page.locator(`${scope} input[type=password]`).first().fill('not-the-password-of-the-demo');
      await run.page.locator(`${scope} form`).first().getByRole('button', { name: 'SIGN IN', exact: true }).click();
      await run.page.locator(`${scope} .form__error`).first().waitFor();
    },
    ready: ':is(.view--pieces, .view--signin) .form__error',
  },
  // Plan CUSTOMER INTELLIGENCE §3.1 P.4.1: CREATE ACCOUNT asks the names and the country, then the one optional
  // question, its answers read from the server (the console's list); Other chosen, IN A FEW WORDS shows under it.
  {
    id: 'sign-up',
    title: 'CREATE ACCOUNT, signed out in MY PIECES: FIRST NAME, LAST NAME, EMAIL, PASSWORD, COUNTRY, HOW DID YOU HEAR ABOUT ORBES? (Other: IN A FEW WORDS)',
    refs: ['CUSTOMER INTELLIGENCE §3.1 P.4.1'],
    variant: 'full',
    path: at('/verify/pieces'),
    act: async (run) => {
      // A computer: MY PIECES' CREATE ACCOUNT opens the sign-in page on its form.
      let scope = '.view--pieces';
      if (await onComputer(run)) {
        await run.page.locator('.view--pieces .d-signin-line').getByRole('link', { name: 'CREATE ACCOUNT', exact: true }).click();
        scope = '.view--signin';
      } else {
        await run.page.locator('.view--pieces form').first().waitFor();
        await run.page.locator('.view--pieces').getByRole('button', { name: 'CREATE ACCOUNT', exact: true }).first().click();
      }
      // The answers arrive after the form: Other is chosen once they are there.
      await run.page.locator(`${scope} #auth-heard option`, { hasText: 'Other' }).waitFor({ state: 'attached' });
      await run.page.locator(`${scope} #auth-heard`).selectOption({ label: 'Other' });
    },
    ready: ':is(.view--pieces, .view--signin) form.form--create #auth-heard-other',
  },
  { id: 'pieces', title: 'MY PIECES, PIECES: each piece on its model\u2019s photograph, its size, its state, SEE THE PIECE; ADD A PIECE', refs: ['C3'], variant: 'full', as: you, path: at('/verify/pieces'), ready: '.view--pieces article.n-pieces__piece' },
  {
    id: 'pieces-orders',
    title: 'MY PIECES, ORDERS: each order on its model\u2019s photograph, its steps, its terms, its documents (reserved, delivered, returned, cancelled)',
    refs: ['C24', 'C32'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'ORDERS'),
    ready: '.view--pieces :is(article.n-pieces__order, .d-orow)',
  },
  // Plan NEXT LOT §3.4: YOUR NEW CLAIM CODE waiting on a shipped order, before SHOW THE CODE (no code is ever on screen
  // here); on its own stage, whose state writes the order and the code (claimWaiting).
  {
    id: 'claim-waiting',
    title: 'MY PIECES, ORDERS: YOUR NEW CLAIM CODE waiting on a shipped order of MONOLITHE in blue, SHOW THE CODE',
    refs: ['NEXT LOT §3.4'],
    variant: 'claim-waiting',
    as: you,
    path: at('/verify/pieces'),
    mutates: true,
    act: async (run) => {
      await claimWaiting(run);
      await run.page.reload();
      await piecesTab(run, 'ORDERS');
      // The card's block on a phone; a computer's row (its order's page holds the block).
      await run.page.locator('.view--pieces :is(.pieces__claim-show, .d-orow)').first().waitFor();
    },
    ready: '.view--pieces :is(.pieces__claim, .d-orows)',
  },
  // Plan NEXT LOT §3.6.B, C: DELIVERY ADDRESS and ENGRAVING on the orders, IN PREPARATION, packing begun; on its own stage,
  // whose state writes them (ordersDelivery).
  {
    id: 'orders-delivery',
    title: 'MY PIECES, ORDERS: DELIVERY ADDRESS with CHANGE and the release\u2019s engraving on the reserved order; a paid order IN PREPARATION, its priced engraving, packing begun',
    refs: ['NEXT LOT §3.6.B', 'NEXT LOT §3.6.C'],
    variant: 'orders-delivery',
    as: you,
    path: at('/verify/pieces'),
    mutates: true,
    act: async (run) => {
      await ordersDelivery(run);
      await run.page.reload();
      await piecesTab(run, 'ORDERS');
      await run.page.locator('.view--pieces :is(.pieces__address-change, .d-orow)').first().waitFor();
    },
    ready: '.view--pieces :is(.pieces__engraving-locked, .d-orows)',
  },
  // Plan NEXT LOT §3.6.D: a return asked on a delivered order (RETURN REQUESTED, RETURN ADDRESS), and RETURNS AND
  // EXCHANGES on another; on its own stage, whose state writes them (ordersCase).
  {
    id: 'orders-case',
    title: 'MY PIECES, ORDERS: RETURN REQUESTED with its RETURN ADDRESS; RETURNS AND EXCHANGES on a delivered order',
    refs: ['NEXT LOT §3.6.D'],
    variant: 'orders-case',
    as: you,
    path: at('/verify/pieces'),
    mutates: true,
    act: async (run) => {
      await ordersCase(run);
      await run.page.reload();
      await piecesTab(run, 'ORDERS');
      await run.page.locator('.view--pieces :is(.pieces__request, .d-orow)').first().waitFor();
    },
    ready: '.view--pieces :is(.pieces__return-address, .d-orows)',
  },
  {
    id: 'pieces-releases',
    title: 'MY PIECES, RELEASES: the account\u2019s entries, their state, sentence and id',
    refs: ['C31'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'RELEASES'),
    ready: '.view--pieces .n-pieces__entry',
  },
  { id: 'piece', title: 'A piece (from the draw of 14 September): THE MODEL, SIZE, WHERE IT COMES FROM, its GENOME, OWNERSHIP', refs: ['C4'], variant: 'full', as: you, path: piece('gold'), ready: '.view--piece .n-piece__origin' },
  { id: 'piece-boutique', title: 'A piece sold at a boutique (no order): nothing of where it comes from', refs: ['C4'], variant: 'full', as: you, path: piece('yours'), ready: '.view--piece .n-piece__article' },
  {
    id: 'pieces-warranty',
    title: 'A piece: ORBES CARE, its WARRANTY',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: (run) => orbesCare(run),
    ready: '.view--piece .n-piece__article',
  },
  {
    id: 'pieces-care',
    title: 'A piece: ORBES CARE, CARING FOR THIS PIECE and the contact',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: (run) => orbesCare(run),
    ready: '.view--piece .n-piece__article',
  },
  {
    id: 'pieces-service',
    title: 'A piece: SERVICE HISTORY',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: async (run) => {
      await tab(run, 'SERVICE').click();
      await run.page.getByText('No service has been recorded for this piece.').first().waitFor();
    },
    ready: '.view--piece .n-piece__article',
  },
  // THE CLUB (plan NEXT-NINE, BP-19 T9): the tiers and what each gives; the way to the reader's own tier.
  { id: 'club', title: 'THE CLUB, signed out: the tiers, HOW THE TIERS WORK, SIGN IN TO SEE YOUR TIER', refs: ['BP-19'], variant: 'full', path: at('/verify/club'), ready: '.view--club .n-club__way' },
  { id: 'club-platine', title: 'THE CLUB of a PLATINE account: YOUR TIER: PLATINE · 5 PIECES HELD', refs: ['BP-19'], variant: 'full', as: 'platine', path: at('/verify/club'), ready: '.view--club .n-club__way' },
  { id: 'club-no-piece', title: 'THE CLUB of an account without a piece: YOUR FIRST PIECE OPENS TITANE', refs: ['BP-19'], variant: 'full', as: 'newcomer', path: at('/verify/club'), ready: '.view--club .n-club__way' },
  { id: 'club-stress', title: 'THE CLUB of the extreme content: PALLADIUM, ten pieces, the welcome gift ORBITAL CHARM', refs: ['BP-19'], variant: 'stress', as: you, path: at('/verify/club'), ready: '.view--club .n-club__way', stress: true },
  // PRIVATE CARE (plan NEXT-NINE, BP-19 T6; named so by plan ORBES CARE): in ORBES CARE, for a PLATINE account, each step on a piece of its own.
  ...(
    [
      ['piece-care-available', 'careAvailable', 'voter1', 'A PLATINE piece: ORBES CARE, PRIVATE CARE, REQUEST PRIVATE CARE'],
      ['piece-care-requested', 'careRequested', 'platine', 'A PLATINE piece: PRIVATE CARE REQUESTED, its return address, CANCEL REQUEST'],
      // Plan ORBES CARE, step 1.4: on its own stage (care-used), THE PROGRAM's PLATINE at 1 piece a year, its default now every piece.
      ['piece-care-used', 'careUsed', 'platine', 'A PLATINE piece: the year’s PRIVATE CARE used for another piece'],
      ['piece-care-label', 'careLabel', 'voter2', 'A PLATINE piece: YOUR PREPAID LABEL, DOWNLOAD LABEL'],
      ['piece-care-returning', 'careReturning', 'voter3', 'A PLATINE piece in service: ON ITS WAY BACK, TRACK THE SHIPMENT'],
      ['piece-care-done', 'careDone', 'cared', 'A PLATINE piece: its PRIVATE CARE complete'],
    ] as const
  ).map(
    ([id, role, who, title]): UiState => ({
      id,
      title,
      refs: ['BP-19'],
      variant: id === 'piece-care-used' ? 'care-used' : 'full',
      as: who,
      path: piece(role),
      act: (run) => orbesCare(run),
      ready: '.view--piece .piece__yearly-care:not([hidden])',
    }),
  ),
  // ORBES CARE (plan ORBES CARE, step 5.1), on its own stage (orbes-care, test/support/nocturne-demo.ts): a piece's
  // ORBES CARE tab for each warranty and each moment of a claim, one collector each; a lifetime piece's certificate; a
  // warranty credit under IN USE.
  ...(
    [
      ['pieces-orbes-care', 'careLifetime', 'platine', 'A PLATINE piece: ORBES CARE, WARRANTY ACTIVE · LIFETIME, PRIVATE CARE, CARING FOR THIS PIECE, the contact', false],
      ['pieces-orbes-care-two-years', 'twoYears', 'leather', 'A piece of a 2-year model: ORBES CARE, WARRANTY ACTIVE until its date, manufacturing defects only', false],
      ['pieces-orbes-care-below', 'yours', you, 'A TITANE piece: ORBES CARE, WARRANTY ACTIVE · LIFETIME, PRIVATE CARE opens from PLATINE', false],
      ['pieces-claim-label', 'claimLabel', 'claimant1', 'A lifetime piece: WARRANTY CLAIM, YOUR PREPAID LABEL, DOWNLOAD LABEL', true],
      ['pieces-claim-replaced', 'claimReplaced', 'claimant2', 'A lifetime piece: WARRANTY CLAIM, REPLACED, the new piece on its way, TRACK THE SHIPMENT', true],
      ['pieces-claim-part-credit', 'claimPartCredit', 'claimant3', 'A replacement piece: WARRANTY CLAIM, a 30 % credit after the free replacement, the piece returned', true],
      ['pieces-claim-refused', 'claimRefused', 'claimant4', 'A lifetime piece: WARRANTY CLAIM, REFUSED after inspection (a scratch), the piece returned', true],
      ['pieces-claim-repaired', 'claimRepaired', 'leather', 'A piece of a 2-year model: WARRANTY CLAIM, REPAIRED, the piece returned', true],
    ] as const
  ).map(
    ([id, role, who, title, claimed]): UiState => ({
      id,
      title,
      refs: ['ORBES CARE §2(a)'],
      variant: 'orbes-care',
      as: who,
      path: piece(role),
      act: async (run) => {
        await tab(run, 'ORBES CARE').click();
        await run.page.locator(claimed ? '.view--piece .piece__warranty-claim:not([hidden])' : '.view--piece .piece__yearly-care:not([hidden])').waitFor();
      },
      ready: claimed ? '.view--piece .piece__warranty-claim:not([hidden])' : '.view--piece .piece__yearly-care:not([hidden])',
    }),
  ),
  {
    id: 'certificate-lifetime',
    title: 'The shared ownership certificate of a lifetime piece: WARRANTY ACTIVE · LIFETIME, no UNTIL',
    refs: ['ORBES CARE §2(a)'],
    variant: 'orbes-care',
    path: (d) => `/verify/c#${d.links.certificateLifetime}`,
    ready: '.view--certificate .genome-svg',
  },
  {
    id: 'tier-warranty-credit',
    title: 'The account sheet of a collector given a 30 % credit: YOUR TIER, IN USE, WARRANTY CREDIT and its note',
    refs: ['ORBES CARE §2(a)'],
    variant: 'orbes-care',
    as: 'claimant3',
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} .n-account__in-use`,
    viewport: true,
  },
  {
    id: 'piece-care-request',
    title: 'A PLATINE piece: REQUEST PRIVATE CARE, its own form: RETURN ADDRESS, NAME, ADDRESS, CONFIRM REQUEST · CANCEL',
    refs: ['BP-19'],
    variant: 'full',
    as: 'voter1',
    path: piece('careAvailable'),
    act: async (run) => {
      await orbesCare(run);
      await button(run, 'REQUEST PRIVATE CARE').click();
      await run.page.locator('.piece__yearly-care form textarea').waitFor();
    },
    ready: '.view--piece .piece__yearly-care form',
  },
  {
    id: 'pieces-certificate-choice',
    title: 'A piece: CREATE CERTIFICATE, its validity',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: async (run) => button(run, 'CREATE CERTIFICATE').click(),
    ready: '.view--piece .n-piece__validity',
  },
  {
    id: 'pieces-report-choice',
    title: 'A piece: REPORT LOST / STOLEN, LOST chosen',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: async (run) => {
      await button(run, 'REPORT LOST / STOLEN').click();
      await button(run, 'LOST').click();
    },
    ready: '.view--piece .n-piece__choice',
  },
  {
    id: 'pieces-care-guide',
    title: 'MY PIECES, ORDERS: an order\u2019s documents, the CARE GUIDE open',
    refs: ['C24'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    act: async (run) => {
      await piecesTab(run, 'ORDERS');
      // A computer: the delivered order's own page first (desktop, decision 5).
      const row = run.page.locator('.d-orow[data-status="DELIVERED"]');
      if ((await row.count()) > 0) await row.first().click();
      await run.page.locator(':is(article.n-pieces__order[data-status="DELIVERED"], .d-order) [data-document="CARE_GUIDE"]').first().click();
      await run.page.locator('.n-pieces__care-text').first().waitFor();
    },
    ready: '.n-pieces__care-text',
  },
  {
    id: 'pieces-change-password',
    title: 'MY PIECES: the account sheet\u2019s CHANGE PASSWORD over it',
    refs: ['C39'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    act: async (run) => {
      await run.page.locator('.view--pieces article.n-pieces__piece').first().waitFor();
      await openAccountSheet(run);
      await (await accountItem(run, /^CHANGE PASSWORD$/)).click();
      await run.page.locator(`${ACCT} :is(.n-account__password, .d-acct__sub--password)`).first().waitFor();
      await fitSheet(run.page);
    },
    ready: ':is(.n-account__password, .d-acct__sub--password form)',
    viewport: true,
  },
  { id: 'pieces-incidents', title: 'MY PIECES of an owner: reported stolen, transfer pending, reported lost, in service', refs: ['C3', 'C35'], variant: 'full', as: 'owner', path: at('/verify/pieces'), ready: '.view--pieces article.n-pieces__piece' },
  {
    id: 'pieces-piece-found',
    title: 'A piece reported lost by its owner: PIECE FOUND, confirmed with the password',
    refs: ['C35'],
    variant: 'full',
    as: 'owner',
    path: piece('lost'),
    act: async (run) => button(run, 'PIECE FOUND').click(),
    ready: '.view--piece input[type=password]',
  },
  { id: 'piece-stolen', title: 'A piece reported stolen: its sentence and the contact', refs: ['C35'], variant: 'full', as: 'owner', path: piece('stolen'), ready: '.view--piece .n-piece__incident-title' },
  { id: 'piece-transfer', title: 'A piece with a transfer pending: its date and CANCEL TRANSFER', refs: ['C35'], variant: 'full', as: 'owner', path: piece('passing'), ready: '.view--piece .piece__transfer-action' },
  { id: 'piece-in-service', title: 'A piece in service: its sentence, then SERVICE HISTORY', refs: ['C35'], variant: 'full', as: 'owner', path: piece('service'), ready: '.view--piece .n-piece__article' },
  { id: 'pieces-question-after', title: 'MY PIECES of a collector who said I’LL BE THERE and did not come: AFTER THE RELEASES', refs: ['C30', 'plus-14'], variant: 'full', as: 'absent', path: at('/verify/pieces'), ready: '.view--pieces .pieces__questions' },
  { id: 'pieces-turn-passed', title: 'MY PIECES of a collector whose turn passed: RELEASES · TURN PASSED', refs: ['C31'], variant: 'full', as: 'guest', path: at('/verify/pieces'), act: (run) => piecesTab(run, 'RELEASES'), ready: '.view--pieces .pieces__releases' },
  { id: 'pieces-empty', title: 'MY PIECES of an account without a piece: THE CLUB, EARLY ACCESS', refs: ['C40'], variant: 'empty', as: you, path: at('/verify/pieces'), ready: '.view--pieces .pieces__empty', stress: true },
  {
    id: 'pieces-loading',
    title: 'MY PIECES while its pieces are read: ONE MOMENT…',
    refs: ['C40'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    routes: async (page, hold) => hold.hold('**/api/v1/account/products'),
    ready: '.view--pieces .n-loading [role=status]',
  },
  {
    id: 'pieces-failed',
    title: 'MY PIECES could not be shown: the reason and TRY AGAIN',
    refs: ['C40'],
    variant: 'full',
    as: you,
    path: at('/verify/pieces'),
    routes: async (page) => page.route('**/api/v1/account/products', (r) => r.abort('internetdisconnected')),
    ready: '.view--pieces .n-failed',
  },
  {
    id: 'piece-failed',
    title: 'A piece could not be shown: the reason and TRY AGAIN',
    refs: ['C40'],
    variant: 'full',
    as: you,
    path: piece('gold'),
    routes: async (page) => page.route('**/api/v1/account/products', (r) => r.abort('internetdisconnected')),
    ready: '.view--piece .n-failed',
  },
  { id: 'pieces-stress', title: 'MY PIECES with ten pieces, the first of a 24-character model without a photograph, its Size of 14 characters', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/pieces'), ready: '.view--pieces article.n-pieces__piece', stress: true },
  {
    id: 'pieces-orders-stress',
    title: 'MY PIECES, ORDERS: four orders (a price in USD, € 125 400, a long tracking number)',
    refs: ['same pieces'],
    variant: 'stress',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'ORDERS'),
    ready: '.view--pieces :is(article.n-pieces__order, .d-orow)',
    stress: true,
  },
  { id: 'piece-stress', title: 'A piece of a 24-character model without a photograph, its Size of 14 characters', refs: ['same pieces'], variant: 'stress', as: you, path: piece('piece1'), ready: '.view--piece .n-piece__article', stress: true },

  // ── The account sheet (C2), from the header's account button ──
  {
    id: 'account-sheet',
    title: 'The account sheet: SIGNED IN AS, YOUR TIER (TITANE, two pieces), SOUND, CHANGE PASSWORD, MY PIECES, the legal pages, SIGN OUT',
    refs: ['C2'],
    // The page under the sheet as C2 draws it: NOW, RELEASES' dot (a draw open), no banner (no LIVE RELEASE).
    variant: 'draw-leads',
    as: you,
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} :is(.n-account__tier, .d-acct__cards)`,
    viewport: true,
  },
  {
    id: 'account-sheet-club',
    title: 'The account sheet of an account without a piece: THE CLUB and what a first piece opens',
    refs: ['C2'],
    variant: 'full',
    as: 'newcomer',
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} :is(.n-account__tier, .d-acct__cards)`,
    viewport: true,
  },
  {
    id: 'account-sheet-stress',
    title: 'The account sheet with the extreme content: PALLADIUM, ten pieces',
    refs: ['same pieces'],
    variant: 'stress',
    as: you,
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} :is(.n-account__tier, .d-acct__cards)`,
    viewport: true,
    stress: true,
  },
  {
    id: 'account-sheet-in-use',
    title: 'The account sheet of a PLATINE account: YOUR TIER, IN USE (its credit, its PRIVATE CARE), the program’s lines, THE CLUB',
    refs: ['BP-19'],
    variant: 'full',
    as: 'platine',
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} .n-account__in-use`,
    viewport: true,
  },
  // Plan CUSTOMER INTELLIGENCE §3.5 SB.4.5: the birthday credit under IN USE for an account without a tier, under THE
  // CLUB and what a first piece opens; on its own stage (birthdayCredit), so no other state holds a date of birth.
  {
    id: 'birthday-credit',
    title: 'The account sheet of an account without a piece, on its birthday: THE CLUB, what a first piece opens, IN USE: BIRTHDAY CREDIT € 20 · UNTIL 3 NOV 2026',
    refs: ['CUSTOMER INTELLIGENCE §3.5 SB.4.5'],
    variant: 'birthday-credit',
    as: 'newcomer',
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await birthdayCredit(run);
      await openAccountSheet(run);
    },
    ready: `${ACCT} .n-account__in-use`,
    viewport: true,
  },
  // Plan NEXT LOT §3.6.B: YOUR ADDRESSES in the account sheet, two saved, one the default; on its own stage
  // (accountAddresses).
  {
    id: 'account-addresses',
    title: 'The account sheet: YOUR ADDRESSES, two saved (DEFAULT), EDIT · MAKE DEFAULT · REMOVE, ADD AN ADDRESS',
    refs: ['NEXT LOT §3.6.B'],
    variant: 'account-addresses',
    as: you,
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await accountAddresses(run);
      await openAccountSheet(run);
      await (await accountItem(run, /^YOUR ADDRESSES/)).click();
      await run.page.locator(`${ACCT} .n-account__address`).first().waitFor({ timeout: 20_000 });
      await fitSheet(run.page);
    },
    ready: `${ACCT} .n-account__addresses-add`,
    viewport: true,
  },
  // Plan CUSTOMER INTELLIGENCE §3.1 P.8: YOUR PROFILE in the account sheet, its row after MESSAGES; on its own stage
  // (account-profile), first without favourites, then with YOUR TASTES chosen and a finish no longer in the collection.
  {
    id: 'account-profile',
    title: 'The account sheet: YOUR PROFILE, 50% complete: YOU, WHERE YOU ARE (the default address), CONTACT, YOUR TASTES, HOW YOU FOUND ORBES, SAVE, CANCEL',
    refs: ['CUSTOMER INTELLIGENCE §3.1 P.8'],
    variant: 'account-profile',
    as: you,
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await yourProfile(run, false);
      await openProfile(run);
    },
    ready: `${ACCT} form.form--profile`,
    viewport: true,
  },
  {
    id: 'profile-tastes',
    title: 'YOUR PROFILE: YOUR TASTES chosen (BRACELET, Gold), Silver held: NO LONGER IN THE COLLECTION',
    refs: ['CUSTOMER INTELLIGENCE §3.2 W.10.3'],
    variant: 'account-profile',
    as: you,
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await yourProfile(run, true);
      await openProfile(run);
      await run.page.locator(`${ACCT} #profile-group-tastes`).scrollIntoViewIfNeeded();
    },
    ready: `${ACCT} .n-profile__taste-retired`,
    viewport: true,
  },
  {
    id: 'account-sheet-password',
    title: 'The account sheet: CHANGE PASSWORD, its form',
    refs: ['C2', 'C39'],
    variant: 'full',
    as: you,
    path: at('/verify'),
    act: async (run) => {
      await openAccountSheet(run);
      await (await accountItem(run, /^CHANGE PASSWORD$/)).click();
      await fitSheet(run.page);
    },
    ready: `${ACCT} form`,
    viewport: true,
  },

  // ── WRITE TO ORBES CLIENT SERVICES and MESSAGES (plan NEXT-NINE, CS-01) ──
  {
    id: 'account-write',
    title: 'WRITE TO ORBES CLIENT SERVICES from a piece: CONCERNING, YOUR MESSAGE, SEND, CANCEL',
    refs: ['CS-01'],
    variant: 'draw-leads',
    as: you,
    path: piece('yours'),
    act: (run) => openWrite(run, '.view--piece'),
    ready: ':is(.n-write:not([hidden]), .d-msg) textarea',
    viewport: true,
  },
  {
    id: 'account-messages-empty',
    title: 'MESSAGES, empty: where to write from',
    refs: ['CS-01'],
    variant: 'draw-leads',
    as: you,
    path: at('/verify'),
    act: (run) => openMessages(run, ':is(.n-messages__empty, .d-msg__none)'),
    ready: ':is(.n-account:not([hidden]) .n-messages__empty, .d-msg .d-msg__none)',
    viewport: true,
  },
  {
    id: 'account-write-sent',
    title: 'WRITE TO ORBES CLIENT SERVICES, sent: MESSAGE SENT, SEE MESSAGES',
    refs: ['CS-01'],
    variant: 'draw-leads',
    as: you,
    path: piece('yours'),
    act: async (run) => {
      await openWrite(run, '.view--piece');
      // The phone's sheet; a computer's MESSAGES page (desktop).
      const box = run.page.locator(':is(.n-write:not([hidden]), .d-msg)').first();
      await box.locator('textarea').fill('Could the atelier adjust the clasp of this bracelet?');
      await box.getByRole('button', { name: 'SEND', exact: true }).click();
      await run.page.locator(':is(.n-write__sent, .d-msg__sent)').first().waitFor({ timeout: 20_000 });
      await fitSheet(run.page, '.n-write__panel');
    },
    ready: ':is(.n-write:not([hidden]) .n-write__sent, .d-msg__sent)',
    viewport: true,
    mutates: true,
  },
  {
    id: 'account-messages-thread',
    title: 'MESSAGES: the conversation, the answer signed ORBES CLIENT SERVICES, YOUR REPLY',
    refs: ['CS-01'],
    variant: 'draw-leads',
    as: you,
    path: at('/verify'),
    act: async (run) => {
      await messageAndAnswer(run);
      await run.page.reload();
      await run.page.locator('.view--now[data-ready]').waitFor();
      await openMessages(run, ':is(.n-messages__list, ol.d-msg__conversation)');
    },
    ready: ':is(.n-account:not([hidden]) .n-messages__list, .d-msg ol.d-msg__conversation)',
    viewport: true,
    mutates: true,
  },

  // ── FROM ORBES (lot M2, macro scope D24 M3 and M4) on the stage `house`: you's three house messages, the newest unread,
  // no conversation yet. NOW's line, FROM ORBES at its longest (routed, nothing written), then the writes in this order:
  // an answer too (the conversation first, FROM ORBES with NEW), then FROM ORBES opened (read). ──
  {
    id: 'now-messages-house',
    title: 'NOW, a message from ORBES unread and no answer: MESSAGES, A new message from ORBES., READ (lot M2, M4)',
    refs: ['M2'],
    variant: 'house',
    as: you,
    path: at('/verify'),
    ready: '.view--now[data-ready] .now__messages',
  },
  {
    id: 'account-messages-house-stress',
    title: 'FROM ORBES at its longest: an 80-character title, 2,000 characters of words, a long model name, 30 of 45 and SHOW EARLIER (lot M2)',
    refs: ['M2'],
    variant: 'house',
    as: you,
    path: at('/verify'),
    routes: houseStress,
    act: (run) => openFromOrbes(run, ':is(.n-account:not([hidden]) .n-house__list, .d-msg ol.d-msg__house)'),
    ready: ':is(.n-account:not([hidden]) .n-house__list, .d-msg ol.d-msg__house)',
    viewport: true,
    stress: true,
  },
  {
    id: 'account-messages-house-unread',
    title: 'MESSAGES, an answer and a message from ORBES unread: the tabs, ORBES CLIENT SERVICES first, FROM ORBES with NEW (lot M2)',
    refs: ['M2'],
    variant: 'house',
    as: you,
    path: at('/verify'),
    act: async (run) => {
      await messageAndAnswer(run);
      await run.page.reload();
      await run.page.locator('.view--now[data-ready]').waitFor();
      await openMessages(run, ':is(.n-account:not([hidden]) .n-messages__parts, .d-msg ol.d-msg__conversation)');
    },
    ready: ':is(.n-account:not([hidden]) .n-messages__parts, .d-msg ol.d-msg__conversation)',
    viewport: true,
    mutates: true,
  },
  {
    id: 'account-messages-house',
    title: 'MESSAGES on FROM ORBES: three messages newest first, the unread one NEW, their links, no reply, the way to write (lot M2, M3)',
    refs: ['M2'],
    variant: 'house',
    as: you,
    path: at('/verify'),
    act: (run) => openFromOrbes(run, ':is(.n-account:not([hidden]) .n-house__list, .d-msg ol.d-msg__house)'),
    ready: ':is(.n-account:not([hidden]) .n-house__list, .d-msg ol.d-msg__house)',
    viewport: true,
    mutates: true,
  },

  // ── WORN, sending from the piece (lot M2, macro scope D31 G1 to G3) on the stage `worn`: you's profile signs (Camille,
  // France, camille.m); a piece with no photograph, a photograph chosen (its preview and credit), one in review, one
  // published, one not published, a collector without a first name or country, and the 24-hour limit said under the
  // preview (the sending answered by the stage's route, nothing written). ──
  { id: 'piece-worn', title: 'A piece: OWNERSHIP, WORN, CHOOSE A PHOTOGRAPH (lot M2, G1)', refs: ['M2'], variant: 'worn', as: you, path: piece('yours'), ready: `${WORN_BLOCK} .n-worn__choose` },
  {
    id: 'piece-worn-chosen',
    title: 'A piece: WORN, a photograph chosen: its preview, CAMILLE · FRANCE @camille.m, SHOW MY INSTAGRAM, the consent, SEND · CANCEL (lot M2, G1, G3)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: piece('yours'),
    act: (run) => chooseWorn(run),
    ready: `${WORN_BLOCK} .n-worn__send`,
  },
  {
    id: 'piece-worn-review',
    title: 'A piece: WORN, IN REVIEW, its photograph and credit, ORBES is looking at your photograph., WITHDRAW (lot M2, G2)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: piece('wornReview'),
    act: (run) => wornPhotoLoaded(run),
    ready: `${WORN_BLOCK} .n-worn__withdraw`,
  },
  {
    id: 'piece-worn-published',
    title: 'A piece: WORN, PUBLISHED, In WORN since 4 OCT 2026., SEE IT ON THE SHEET, WITHDRAW (lot M2, G2)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: piece('wornPublished'),
    act: (run) => wornPhotoLoaded(run),
    ready: `${WORN_BLOCK} .n-worn__see-link`,
  },
  {
    id: 'piece-worn-refused',
    title: 'A piece: WORN, NOT PUBLISHED, The piece is not clearly visible., CHOOSE ANOTHER PHOTOGRAPH (lot M2, G2)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: piece('wornRefused'),
    ready: `${WORN_BLOCK} .n-worn__reason`,
  },
  {
    id: 'piece-worn-profile',
    title: 'A piece of a collector without a first name or country: WORN, its sentence and YOUR PROFILE (lot M2, G3)',
    refs: ['M2'],
    variant: 'worn',
    as: 'wornNewcomer',
    path: piece('wornProfile'),
    ready: `${WORN_BLOCK} .n-worn__profile`,
  },
  {
    id: 'piece-worn-error',
    title: 'A piece: WORN, SEND refused by the 24-hour limit: the server\u2019s words under the preview, kept, SEND again (lot M2, G1)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: piece('yours'),
    routes: async (page) =>
      page.route('**/api/v1/account/products/*/worn?*', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 429, json: { error: { code: 'WORN_LIMIT', message: 'You can send 5 photographs in 24 hours. Try again later.' } } })
          : route.fallback(),
      ),
    act: async (run) => {
      await chooseWorn(run, true);
      await run.page.locator(`${WORN_BLOCK} .n-worn__send`).click();
      await run.page.locator(`${WORN_BLOCK} .n-worn__error`).waitFor();
    },
    ready: `${WORN_BLOCK} .n-worn__error`,
  },

  // ── WORN at the foot of a model's sheet (lot M2, step M2.11; macro scope D31 G3 to G5) on the stage `worn`, the same for
  // everyone: MONOLITHE's eight photographs of its three variants signed out (the first 6, then SHOW MORE; credits of
  // the first name and country, the Instagram name when chosen, never a variant), ZENITH's one alone to an owner (a
  // RESERVED sheet), a photograph opened whole, and, on the stress's 40, the next page being read, unreadable, and every
  // photograph shown. ──
  {
    id: 'sheet-worn',
    title: 'A model’s sheet, signed out: WORN at its foot, the first 6 of its 8 photographs (every variant alike), CAMILLE · FRANCE @camille.m, SHOW MORE (lot M2, G3–G5)',
    refs: ['M2'],
    variant: 'worn',
    path: sheet('steel'),
    act: (run) => sheetWornLoaded(run),
    ready: `${SHEET_WORN} .n-model__worn-item`,
  },
  {
    id: 'sheet-worn-one',
    title: 'A RESERVED model’s sheet, to an owner: WORN with one photograph alone, HANA · SOUTH KOREA @hana.seo (lot M2, G4, G5)',
    refs: ['M2'],
    variant: 'worn',
    as: you,
    path: sheet('zenith'),
    act: (run) => sheetWornLoaded(run),
    ready: `${SHEET_WORN} .n-model__worn-grid--one`,
  },
  {
    id: 'sheet-worn-enlarged',
    title: 'A model’s sheet: WORN, SHOW MORE pressed (all 8), then a photograph opened whole with its credit and CLOSE (lot M2, G4)',
    refs: ['M2'],
    variant: 'worn',
    path: sheet('steel'),
    act: async (run) => {
      await sheetWornLoaded(run);
      if (await run.page.locator(`${SHEET_WORN} .n-model__worn-more`).count()) await wornShowMore(run, 1);
      await run.page.locator(`${SHEET_WORN} .n-model__worn-open`).nth(2).click();
      await run.page.locator(':is(.n-wv, .d-viewer.is-open) :is(.n-wv__photo, .d-viewer__photo)').first().waitFor();
      await run.page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.n-wv__photo, .d-viewer__photo')].every((i) => i.complete && i.naturalWidth > 0));
    },
    ready: ':is(.n-wv, .d-viewer.is-open) :is(.n-wv__credit, .d-viewer__credit)',
  },
  {
    id: 'sheet-worn-loading',
    title: 'A model’s sheet: WORN of 40, SHOW MORE pressed, its next page being read: ONE MOMENT… (lot M2, G4)',
    refs: ['M2'],
    variant: 'worn',
    path: sheet('steel'),
    routes: async (page, hold) => {
      await wornStressRoutes(page);
      hold.hold('**/api/v1/lookbook/monolithe/worn?page=2');
    },
    act: async (run) => {
      await sheetWornLoaded(run);
      await run.page.locator(`${SHEET_WORN} .n-model__worn-more`).click();
    },
    ready: `${SHEET_WORN} .n-model__worn-loading`,
    stress: true,
  },
  {
    id: 'sheet-worn-error',
    title: 'A model’s sheet: WORN of 40, its next page unreadable: its sentence and TRY AGAIN, the photographs shown kept (lot M2, G4)',
    refs: ['M2'],
    variant: 'worn',
    path: sheet('steel'),
    routes: async (page) => {
      await wornStressRoutes(page);
      await page.route('**/api/v1/lookbook/monolithe/worn?page=2', (route) => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'The service is busy. Try again in a moment.' } } }));
    },
    act: async (run) => {
      await sheetWornLoaded(run);
      await run.page.locator(`${SHEET_WORN} .n-model__worn-more`).click();
    },
    ready: `${SHEET_WORN} .n-model__worn-retry`,
    stress: true,
  },
  {
    id: 'sheet-worn-stress',
    title: 'A model’s sheet: WORN of 40, every page read: a first name of 50 characters, the longest country, an Instagram name of 30 (lot M2, G3, G4)',
    refs: ['M2'],
    variant: 'worn',
    path: sheet('steel'),
    routes: (page) => wornStressRoutes(page),
    act: async (run) => {
      await sheetWornLoaded(run);
      while (await run.page.locator(`${SHEET_WORN} .n-model__worn-more`).count()) await wornShowMore(run, 1);
      await sheetWornLoaded(run);
    },
    ready: `${SHEET_WORN} .n-model__worn-foot[hidden]`,
    stress: true,
  },

  // ── The catalogue add-ons (lot M3, D2), on their own stage (addons): the LIVE hold's rows, a draw's PLACE HELD, the
  // salon request, YOUR ORDERS' rows with REMOVE and ADD AN ADD-ON, its sheet (chosen, none available, could not be
  // read); then their writes: PAY with an add-on none is left of, a request sent with one ──
  // 5b, SECURED with add-ons (lot Q2, step Q2.8; MK #secured-addons; plan §3.4, §3.7): MK 5b's rows and look. Two
  // intended differences from MK: the amounts and the time are the demo's in the house's format (MK caption 4,
  // illustrative amounts), and M3's note sits under the rows, THE TRAVEL CASE having stock (N2; MK caption 5).
  { id: 'addons-hold', title: '5b, SECURED with add-ons (MK 5b): ADD-ONS, GIFT WRAPPING + € 15, ENGRAVING + € 40 chosen with YOUR TEXT « M. B. » 5 / 12, THE TRAVEL CASE + € 60, PAY € 5 090 · 08:11; differences from MK: the demo\u2019s amounts and time in the house\u2019s format, and M3\u2019s note under the rows (THE TRAVEL CASE has stock) (lot Q2, step Q2.8)', refs: ['MK 5b', 'Q2'], variant: 'addons', as: 'secured', path: release('live'), ready: FIVE_B_READY },
  {
    id: 'addons-hold-text-error',
    title: '5b: the engraving\u2019s words refused, « M. B. # », the house\u2019s sentence under the rows, the row kept chosen (lot Q2, step Q2.8)',
    refs: ['MK 5b', 'Q2'],
    variant: 'addons',
    as: 'secured',
    path: release('live'),
    act: async (run) => {
      const field = run.page.locator('.view--live .live__addons .ao-text__input');
      await field.fill('M. B. #');
      await field.press('Enter');
      await run.page.locator('.view--live .live__error:not([hidden])').waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .live__error:not([hidden])',
  },
  { id: 'addons-hold-light', title: '5b in light mode: the room stays dark, its rows, YOUR TEXT and PAY as in the dark (lot Q2, step Q2.8; D18)', refs: ['MK 5b', 'Q2'], variant: 'addons', as: 'secured', path: release('live'), light: true, ready: FIVE_B_READY },
  { id: 'addons-place-held', title: 'A draw drawn with a price, the account’s place held: ADD TO YOUR ORDER, a POLISHING CLOTH chosen, added when Client Services confirms (lot M3, D2)', refs: ['M3'], variant: 'addons', as: you, path: release('autumn'), ready: '.view--release .release__addons .n-addons__item.is-chosen' },
  {
    id: 'addons-salon',
    title: 'THE PRIVATE SALON: ZENITH’s request with ADD TO YOUR ORDER, a POLISHING CLOTH chosen (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: sheet('zenith'),
    act: async (run) => {
      await run.page.locator('.view--sheet .sheet__addons .n-addons').waitFor();
      await button(run, 'One more POLISHING CLOTH').click();
    },
    ready: '.view--sheet .sheet__addons .n-addons__item.is-chosen',
  },
  {
    id: 'addons-orders',
    title: 'MY PIECES, ORDERS: the reserved order’s POLISHING CLOTH × 2 with REMOVE and ADD AN ADD-ON; a paid order’s CHAIN EXTENDER and its own invoice; packing begun with a TRAVEL POUCH (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'ORDERS'),
    ready: '.view--pieces :is(.pieces__addons-locked, .d-orows)',
  },
  {
    id: 'addons-sheet',
    title: 'ADD AN ADD-ON on the reserved order: the add-ons available, a TRAVEL POUCH chosen, the total, ADD (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: at('/verify/pieces'),
    act: async (run) => {
      await openAddons(run);
      await button(run, 'One more TRAVEL POUCH').click();
    },
    ready: `${ADDON_FORM} .n-addons__item.is-chosen`,
  },
  {
    id: 'addons-sheet-none',
    title: 'ADD AN ADD-ON when none is available for the order: its sentence, CANCEL (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: at('/verify/pieces'),
    routes: (page) =>
      page.route('**/api/v1/account/orders/*/addons', (route) =>
        route.request().method() === 'GET' ? route.fulfill({ json: { canAdd: true, reason: null, paid: false, currency: 'EUR', offer: [] } }) : route.continue(),
      ),
    act: (run) => openAddons(run),
    ready: ':is(.n-osheet, .d-oform) .n-osheet__none',
  },
  {
    id: 'addons-sheet-error',
    title: 'ADD AN ADD-ON whose add-ons could not be read: the sentence and the reason, TRY AGAIN, CANCEL (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: at('/verify/pieces'),
    routes: (page) => page.route('**/api/v1/account/orders/*/addons', (route) => (route.request().method() === 'GET' ? route.abort('failed') : route.continue())),
    act: (run) => openAddons(run),
    ready: ':is(.n-osheet, .d-oform) .n-osheet__unreadable',
  },
  {
    id: 'addons-hold-stress',
    title: '5b at its longest: six rows (GIFT WRAPPING, ENGRAVING chosen, THE TRAVEL CASE, POLISHING CLOTH, THE TRAVEL CASE FOR TWO PIECES, LINED and its two-line line, a service of 40 characters), each name and line whole (lot Q2, step Q2.8)',
    refs: ['MK 5b', 'Q2'],
    variant: 'addons',
    as: 'secured',
    path: release('live'),
    mutates: true,
    act: async (run) => {
      await longestPick(run);
      await run.page.reload();
      await run.page.locator(FIVE_B_READY).waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .live__addons .live__addon-item:nth-child(6)',
    stress: true,
  },
  {
    id: 'addons-pay',
    title: 'PAY on 5b with THE TRAVEL CASE chosen and none left of it: CONFIRMED, THE TRAVEL CASE COULD NOT BE ADDED: NONE LEFT., the receipt with the ENGRAVING € 40, TOTAL € 5 090 (lot Q2, steps Q2.4, Q2.8)',
    refs: ['M3', 'Q2'],
    variant: 'addons',
    as: 'secured',
    path: release('live'),
    mutates: true,
    act: async (run) => {
      await run.page.locator(FIVE_B_READY).waitFor();
      // Lot Q2, steps Q2.4, Q2.8 (§3.4): THE TRAVEL CASE's row tapped on 5b, then its last unit taken before PAY.
      const row = run.page.locator('.view--live .live__addons .live__addon-item').filter({ has: run.page.locator('.live__addon-label', { hasText: /^THE TRAVEL CASE$/ }) });
      await row.locator('.live__addon').click();
      await row.and(run.page.locator('.is-on')).waitFor({ timeout: 20_000 });
      await run.page.locator('.view--live .live__pay:not([disabled])').waitFor({ timeout: 20_000 });
      await noneLeft(run, 'THE TRAVEL CASE');
      await run.page.locator('.view--live .live__pay').click();
      await run.page.locator('.view--live .live__left-out:not([hidden])').waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .live__left-out:not([hidden])',
  },
  {
    id: 'addons-salon-requested',
    title: 'THE PRIVATE SALON: REQUESTED with a POLISHING CLOTH, ORBES Client Services will contact you (lot M3, D2)',
    refs: ['M3'],
    variant: 'addons',
    as: you,
    path: sheet('zenith'),
    mutates: true,
    act: async (run) => {
      await run.page.locator('.view--sheet .sheet__addons .n-addons').waitFor();
      await button(run, 'One more POLISHING CLOTH').click();
      await run.page.locator('.view--sheet .sheet__addons .n-addons__item.is-chosen').waitFor();
      await button(run, 'REQUEST THIS PIECE').click();
      await run.page.locator('.view--sheet .n-model__requested-addons').waitFor({ timeout: 20_000 });
    },
    ready: '.view--sheet .n-model__requested-addons',
  },

  // ── THE COLLECTION ──
  { id: 'collection-signed-out', title: 'THE COLLECTION, signed out', refs: ['C5'], variant: 'full', path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__group' },
  { id: 'collection', title: 'THE COLLECTION, signed in: THE PRIVATE SALON', refs: ['C5'], variant: 'full', as: you, path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__reserved' },
  { id: 'collection-no-piece', title: 'THE COLLECTION, signed in without a piece', refs: ['C5'], variant: 'full', as: 'newcomer', path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__group' },
  { id: 'model', title: 'A model’s sheet: MONOLITHE in steel', refs: ['C6'], variant: 'full', as: you, path: sheet('steel'), ready: '.view--sheet .sheet__body section' },
  { id: 'model-blue', title: 'A model’s sheet: MONOLITHE in blue', refs: ['C6'], variant: 'full', path: sheet('blue'), ready: '.view--sheet .sheet__body section' },
  { id: 'model-gold', title: 'A model’s sheet: MONOLITHE in gold', refs: ['C6'], variant: 'full', path: sheet('gold'), ready: '.view--sheet .sheet__body section' },
  // N6: a model whose next release is a draw (no LIVE RELEASE leads, C42's): its row says when its entries close, or open.
  {
    id: 'model-draw-leads',
    title: 'A model’s sheet whose next release is a draw: MONOLITHE in steel, DRAW · ENTRIES OPEN, ENTRIES CLOSE …',
    refs: ['C6', 'C42'],
    variant: 'draw-leads',
    as: you,
    path: sheet('steel'),
    ready: '.view--sheet .n-model__next',
    stress: true,
  },
  {
    id: 'model-draw-soon',
    title: 'A model’s sheet whose next release is a draw before its entries open: DRAW · ENTRIES OPEN SOON, ENTRIES OPEN …',
    refs: ['C6', 'C42'],
    variant: 'draw-soon',
    as: you,
    path: sheet('steel'),
    ready: '.view--sheet .n-model__next',
    stress: true,
  },
  { id: 'model-salon', title: 'A model of THE PRIVATE SALON: ZENITH, REQUEST THIS PIECE', refs: ['C33'], variant: 'full', as: you, path: sheet('zenith'), ready: '.view--sheet .sheet__body section' },
  { id: 'model-salon-signed-out', title: 'A model of THE PRIVATE SALON, signed out: not in the collection', refs: ['C40'], variant: 'full', path: sheet('zenith'), ready: '.view--sheet[data-state="missing"]' },
  // Plan NEXT-NINE, AC-01: a model of the salon in four sizes: YOUR SIZE, the size YOUR SIZES suggests; REQUESTED · SIZE 54.
  { id: 'model-salon-sizes', title: 'THE PRIVATE SALON in sizes: YOUR SIZE, 52 preselected from YOUR SIZES, NOT SURE YET', refs: ['AC-01'], variant: 'full', as: 'sized', path: sheet('halo'), ready: '.view--sheet .n-model__yours' },
  { id: 'model-salon-size-requested', title: 'THE PRIVATE SALON: REQUESTED, SIZE 54', refs: ['AC-01'], variant: 'full', as: 'sizedRequested', path: sheet('halo'), ready: '.view--sheet .n-model__requested-size' },
  { id: 'model-not-found', title: 'A model’s address that leads nowhere', refs: ['C40'], variant: 'full', path: at('/verify/lookbook/no-such-model'), ready: '.view--sheet[data-state="missing"]' },
  { id: 'collection-empty', title: 'THE COLLECTION with no model', refs: ['C40'], variant: 'empty', path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__empty', stress: true },
  { id: 'collection-stress', title: 'THE COLLECTION with a 24-character name, no photograph', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__group', stress: true },
  { id: 'model-stress', title: 'A model of 24 characters without a photograph, € 125 400 in the salon', refs: ['same pieces'], variant: 'stress', as: you, path: sheet('long'), ready: '.view--sheet .sheet__body section', stress: true },
  // Plan CUSTOMER INTELLIGENCE §3.2 W.10.1: the heart on MONOLITHE in blue, tapped: pressed, In your wishlist. (its own
  // stage, wishes, so no other sheet sees the wish).
  {
    id: 'sheet-wished',
    title: 'A model’s sheet: MONOLITHE in blue, the heart pressed: WISHLIST, In your wishlist.',
    refs: ['CUSTOMER INTELLIGENCE §3.2 W.10.1'],
    variant: 'wishes',
    as: you,
    path: sheet('blue'),
    mutates: true,
    act: async (run) => {
      await run.page.locator('.view--sheet .n-heart').waitFor({ timeout: 20_000 });
      await button(run, 'WISHLIST').click();
      await run.page.locator('.view--sheet .n-heart[aria-pressed="true"]').waitFor({ timeout: 20_000 });
    },
    ready: '.view--sheet .n-model__heart-line',
  },
  // Plan CUSTOMER INTELLIGENCE §3.2 W.10.2: YOUR WISHLIST's page, empty (before the stage's wishes), then with your three.
  {
    id: 'wishlist-empty',
    title: 'YOUR WISHLIST, empty: its sentence and THE COLLECTION',
    refs: ['CUSTOMER INTELLIGENCE §3.2 W.10.2'],
    variant: 'wishes',
    as: you,
    path: at('/verify/wishlist'),
    ready: '.view--wishlist[data-state="empty"] .n-wishlist__empty',
  },
  {
    id: 'wishlist',
    title: 'YOUR WISHLIST: MONOLITHE in blue, in gold (DISCONTINUED · 2026), ZENITH (NOT IN THE COLLECTION NOW); SEE THE MODEL, REMOVE',
    refs: ['CUSTOMER INTELLIGENCE §3.2 W.10.2'],
    variant: 'wishes',
    as: you,
    path: at('/verify/wishlist'),
    mutates: true,
    act: async (run) => {
      await yourWishes(run);
      await run.page.reload();
    },
    ready: '.view--wishlist[data-state="ready"] .n-wishlist__card--hidden',
  },
  // Plan NEXT-NINE, BP-34: PAIRS WELL WITH as the console picked it on MONOLITHE (the pairs stage), read by a TITANE owner:
  // ZENITH of THE PRIVATE SALON, then MONOLITHE ARCHITECTURALE (24 characters, no photograph); the C6 foot, picked.
  { id: 'model-pairs', title: 'A model’s sheet: PAIRS WELL WITH as picked, ZENITH and MONOLITHE ARCHITECTURALE', refs: ['C6', 'BP-34'], variant: 'pairs', as: you, path: sheet('steel'), ready: '.view--sheet .n-model__pairs', stress: true },

  // ── THE RELEASES ──
  { id: 'releases', title: 'THE RELEASES, LIVE: the LIVE RELEASES and the draw', refs: ['C7'], variant: 'full', as: you, path: at('/verify/releases'), ready: '.view--releases article.live-card' },
  { id: 'releases-signed-out', title: 'THE RELEASES, LIVE, signed out', refs: ['C7'], variant: 'full', path: at('/verify/releases'), ready: '.view--releases article.live-card' },
  {
    id: 'releases-past',
    title: 'THE RELEASES, PAST: the account’s part in each',
    refs: ['C25'],
    variant: 'full',
    as: you,
    path: at('/verify/releases'),
    act: async (run) => {
      await tab(run, 'PAST').click();
      await run.page.locator('#releases-panel-past article.release-card').first().waitFor({ timeout: 20_000 });
      await run.page.locator('.releases__taken').waitFor({ timeout: 20_000 });
    },
    ready: '#releases-panel-past article.release-card',
  },
  {
    id: 'releases-past-more',
    title: 'THE RELEASES, PAST, with more releases than a page: SHOW MORE',
    refs: ['C25'],
    variant: 'full',
    as: you,
    path: at('/verify/releases'),
    // The demo has fewer past releases than a page: the answer says one more is there after the pages read, as C25's
    // SHOW MORE does (the app asks for more while fewer pages were read than the total fills).
    routes: async (page) =>
      page.route('**/api/v1/releases/past?*', async (route) => {
        const asked = new URL(route.request().url()).searchParams;
        const res = await route.fetch();
        const body = (await res.json()) as { total: number };
        const read = Number(asked.get('page') ?? 1) * Number(asked.get('pageSize') ?? 0);
        await route.fulfill({ response: res, json: { ...body, total: Math.max(body.total, read) + 1 } });
      }),
    act: async (run) => {
      await tab(run, 'PAST').click();
      await run.page.locator('#releases-panel-past article.release-card').first().waitFor({ timeout: 20_000 });
      await run.page.locator('.releases__taken').waitFor({ timeout: 20_000 });
      await run.page.locator('.releases__more').waitFor({ timeout: 20_000 });
    },
    ready: '#releases-panel-past .releases__more',
  },
  // HOW RELEASES WORK (plan NEXT-NINE, FT-01): every release's rules, their figures read from GET /api/v1/releases/rules.
  { id: 'releases-how', title: 'HOW RELEASES WORK: THE WAYS TO TAKE PART, HOW THE ORDER IS SET, WHAT THE HOUSE NEVER DOES', refs: ['FT-01'], variant: 'full', path: at('/verify/releases/how'), ready: '.view--how .n-how__back' },
  { id: 'releases-empty', title: 'THE RELEASES with no release', refs: ['C40'], variant: 'empty', path: at('/verify/releases'), ready: '.view--releases .releases__body p, .view--releases p.prose', stress: true },
  { id: 'releases-stress', title: 'THE RELEASES: a countdown under an hour, one over 9 days, a price in USD', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/releases'), ready: '.view--releases article.live-card', stress: true },
  { id: 'draw', title: 'A draw, entries open, signed in: ENTER THE DRAW', refs: ['C19'], variant: 'full', as: you, path: release('draw'), ready: '.view--release .release__body section, .view--release section' },
  { id: 'draw-signed-out', title: 'A draw, signed out: the sign-in', refs: ['C19'], variant: 'full', path: release('draw'), ready: ':is(.view--release form, .view--release .d-signin-line)' },
  { id: 'draw-soon', title: 'A draw before its entries open', refs: ['C42'], variant: 'draw-soon', as: you, path: release('draw'), ready: '.view--release section' },
  { id: 'draw-early', title: 'A draw in its early access, for a PLATINE account: RESERVE A PLACE', refs: ['C42'], variant: 'draw-early', as: 'platine', path: release('draw'), ready: '.view--release section' },
  { id: 'draw-drawn', title: 'A draw drawn: THIS RELEASE IS OVER, the seed checked, the entries by rank', refs: ['C29'], variant: 'full', as: you, path: release('draw:MONOLITHE IN GOLD'), ready: '.view--release section .n-story__open:not([hidden])' },
  { id: 'draw-not-found', title: 'A release’s address that leads nowhere', refs: ['C40'], variant: 'full', path: at('/verify/releases/00000000-0000-4000-8000-000000000000'), ready: '.view--release, .view--live' },
  { id: 'draw-soon-platine', title: 'A draw before its early access, for a PLATINE account: from when it may reserve a place', refs: ['C42'], variant: 'draw-soon', as: 'platine', path: release('draw'), ready: '.view--release .release__status' },
  { id: 'draw-early-others', title: 'A draw in its early access, for a TITANE account: PLATINE and PALLADIUM owners are reserving', refs: ['C42'], variant: 'draw-early', as: you, path: release('draw'), ready: '.view--release .release__status' },

  // ── A draw in every state (the `draws` demo) ──
  { id: 'draw-closed', title: 'A draw past its close, not drawn yet: ENTRIES CLOSED, the draw follows', refs: ['C19'], variant: 'draws', as: you, path: release('closed'), ready: '.view--release .release__status' },
  { id: 'draw-closed-entered', title: 'A draw past its close, entered: the draw follows the close of entries, WITHDRAW', refs: ['C19', 'C31'], variant: 'draws', as: 'entrant', path: release('closed'), ready: '.view--release .release__status' },
  { id: 'draw-closed-withdrawn', title: 'A draw past its close, withdrawn while it was open: WITHDRAWN', refs: ['C19', 'C31'], variant: 'draws', as: 'platine', path: release('closed'), ready: '.view--release .release__status' },
  { id: 'draw-cancelled', title: 'A draw cancelled: CANCELLED, there will be no draw', refs: ['C19'], variant: 'draws', as: you, path: release('cancelled'), ready: '.view--release .release__status' },
  { id: 'draw-cancelled-entered', title: 'A draw cancelled, entered: ENTERED, there will be no draw', refs: ['C19', 'C31'], variant: 'draws', as: 'entrant', path: release('cancelled'), ready: '.view--release .release__status' },
  { id: 'draw-withdrawn', title: 'A draw open, the entry withdrawn: WITHDRAWN, ENTER THE DRAW again', refs: ['C19', 'C31'], variant: 'draws', as: 'entrant', path: release('draw'), ready: '.view--release .release__status' },
  { id: 'draw-place-held', title: 'A draw drawn, the account selected: PLACE HELD until …, ORBES Client Services', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('selected'), ready: '.view--release:has(.release__status) .n-story__open:not([hidden])' },
  { id: 'draw-waiting-list', title: 'A draw drawn, the account on the WAITING LIST, its rank', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('waitlisted'), ready: '.view--release .release__status' },
  { id: 'draw-waiting-list-no-piece', title: 'A draw drawn, an account without a piece on the WAITING LIST', refs: ['C29', 'C31'], variant: 'draws', as: 'newcomer', path: release('selected'), ready: '.view--release .release__status' },
  { id: 'draw-lapsed', title: 'A draw drawn, the place held lapsed: LAPSED', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('lapsed'), ready: '.view--release .release__status' },
  { id: 'draw-full', title: 'A draw in its early access, every piece reserved: EVERY PIECE RESERVED, the waiting list after', refs: ['C42'], variant: 'draws', as: you, path: release('full'), ready: '.view--release .release__status' },
  { id: 'draw-place-reserved', title: 'A PLATINE account’s direct reservation: PLACE RESERVED, held until …, ORBES Client Services', refs: ['C42', 'C31'], variant: 'draws', as: 'platine', path: release('full'), ready: '.view--release:has(.release__status) .n-story__open:not([hidden])' },
  { id: 'draw-open-full', title: 'A draw open, every piece reserved: you may still enter, the waiting list', refs: ['C19'], variant: 'draws', as: you, path: release('openFull'), ready: '.view--release .release__status' },
  // ADD TO CALENDAR (macro scope C1; lot M1, step M1.9): a draw open, not entered, its .ics under its state.
  { id: 'draw-open-calendar', title: 'A draw open, not entered: ENTRIES OPEN, ADD TO CALENDAR under it, ENTER THE DRAW', refs: ['K25'], variant: 'draws', as: you, path: release('draw'), ready: '.view--release .n-release__calendar-line a[href$="/calendar.ics"]' },
  // Plan NEXT LOT §3.6.F: a draw in sizes, open, its SIZES row, its own rule, YOUR SIZE preselected from YOUR SIZES.
  {
    id: 'draw-sizes',
    title: 'A draw in sizes, entries open: SIZES (18 FULL, reserved directly), YOUR SIZE preselected from YOUR SIZES, ENTER THE DRAW',
    refs: ['NEXT LOT §3.6.F'],
    variant: 'draw-sizes',
    as: 'sized',
    path: release('drawSizes'),
    ready: '.view--release .release__sizes',
  },
  // Plan MACRO M1 §3.3 (F4; lot M1, step M1.13): the October draw opened to the segment Founding list (draw-selected
  // demo): FOR SELECTED COLLECTORS in THE RELEASE; for you, on the list, ENTER THE DRAW; for the guest, not on it, the
  // refusal in its place, as a LIVE RELEASE's; signed out, the sign-in's lead says the release is for selected collectors.
  { id: 'draw-selected', title: 'A draw FOR SELECTED COLLECTORS, open, for a collector among them: the rule in THE RELEASE, ENTER THE DRAW', refs: ['F4'], variant: 'draw-selected', as: you, path: release('draw'), ready: '.view--release:has(.release__for) .release__enter' },
  { id: 'draw-selected-not-eligible', title: 'A draw FOR SELECTED COLLECTORS, open, for a collector not among them: FOR SELECTED COLLECTORS, why, and that the account does not meet the rule, in place of ENTER THE DRAW', refs: ['F4'], variant: 'draw-selected', as: 'guest', path: release('draw'), ready: '.view--release:has(.release__for) .release__refusal' },
  // ── THE SET (lot M3, K44 T1 to T3), on its own stage (set): THE RELEASES with its LIVE RELEASES (at the photograph's
  // stage: its pieces side by side, their names; not revealed yet) and its October draw; PAST; NOW led by its LIVE
  // RELEASE; the October draw's pickers (YOUR SIZES' preselection), every size chosen with a size full in one piece, an
  // entry with every size; the first draw drawn (PLACE HELD, WAITING LIST); YOUR ORDERS (a set RESERVED, a set delivered
  // with RETURN THE SET, its HALO exchanged), then RETURN THE SET asked (its write, last) ──
  { id: 'set-releases', title: 'THE RELEASES with THE SET: its LIVE RELEASE at the photograph’s stage (its pieces side by side, THE SET · 3 PIECES, their names, 1 SET PER PERSON), its second not revealed yet, its October draw (lot M3, T1)', refs: ['M3'], variant: 'set', as: you, path: at('/verify/releases'), ready: '.view--releases article.live-card .n-tiles' },
  {
    id: 'set-past',
    title: 'THE RELEASES, PAST, with THE SET’s draws drawn: their pieces side by side, THE SET · 3 PIECES, 2 SETS (lot M3, T1)',
    refs: ['M3'],
    variant: 'set',
    as: you,
    path: at('/verify/releases'),
    act: async (run) => {
      await tab(run, 'PAST').click();
      await run.page.locator('#releases-panel-past article.release-card .n-tiles').first().waitFor({ timeout: 20_000 });
    },
    ready: '#releases-panel-past article.release-card .n-tiles',
  },
  { id: 'set-now', title: 'NOW led by THE SET’s LIVE RELEASE: its pieces side by side, THE SET · 3 PIECES and their names; its October draw under it (lot M3, T1)', refs: ['M3'], variant: 'set', as: you, path: at('/verify'), ready: '.view--now[data-ready] .now__hero .n-tiles' },
  { id: 'set-draw', title: 'THE SET’s October draw, open: ONE PRICE FOR THE SET, its sets and each piece’s sizes (HALO 56 full); YOUR SIZES, a picker per piece, the bracelet and the ring from YOUR SIZES, the necklace to choose; ENTER THE DRAW waiting (lot M3, T1)', refs: ['M3'], variant: 'set', as: you, path: release('setDraw'), ready: '.view--release .release__piece .release__yours-size' },
  {
    id: 'set-draw-chosen',
    title: 'THE SET’s October draw: a size chosen for every piece, HALO 56 (every piece of it reserved, said under it), ENTER THE DRAW ready (lot M3, T1)',
    refs: ['M3'],
    variant: 'set',
    as: you,
    path: release('setDraw'),
    act: async (run) => {
      await run.page.locator('.view--release .release__piece[data-piece="2"] .release__sizes button', { hasText: /^56$/ }).click();
      await run.page.locator('.view--release .release__piece[data-piece="3"] .release__sizes button', { hasText: /^45$/ }).click();
      await run.page.locator('.view--release .release__enter:not([disabled])').waitFor();
    },
    ready: '.view--release .release__piece[data-piece="2"] .release__size-note',
  },
  { id: 'set-draw-entered', title: 'THE SET’s October draw, entered: ENTERED · SIZE 16 · 54 · 42, each piece’s size to change, WITHDRAW (lot M3, T1)', refs: ['M3'], variant: 'set', as: 'sizer', path: release('setDraw'), ready: '.view--release .release__piece .release__sizes button[aria-pressed="true"]' },
  { id: 'set-draw-held', title: 'THE SET’s first draw, drawn: PLACE HELD · SIZE 17 · 52 · 45, THE ENTRIES with every size (lot M3, T1)', refs: ['M3'], variant: 'set', as: you, path: release('setDrawn'), ready: '.view--release .release__list .is-yours' },
  { id: 'set-draw-waiting', title: 'THE SET’s first draw, drawn: WAITING LIST · SIZE 17 · 52 · 45, rank 3 (lot M3, T1)', refs: ['M3'], variant: 'set', as: 'newcomer', path: release('setDrawn'), ready: '.view--release .release__list .is-yours' },
  {
    id: 'set-orders',
    title: 'MY PIECES, ORDERS with THE SET: a set RESERVED and a set delivered, each under THE SET · THE ORBITAL SET with ONE PRICE FOR THE SET; PIECE 1 OF 3; RETURN THE SET on the delivered pieces; the HALO exchanged for 54 (lot M3, T1 to T3)',
    refs: ['M3'],
    variant: 'set',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'ORDERS'),
    ready: '.view--pieces :is(.n-pieces__set .pieces__return, .d-oset)',
  },
  {
    id: 'set-orders-return',
    title: 'RETURN THE SET asked on a piece of the delivered set: RETURN REQUESTED on every piece sent back, every piece of the set together (lot M3, T3)',
    refs: ['M3'],
    variant: 'set',
    as: you,
    path: at('/verify/pieces'),
    mutates: true,
    act: (run) => returnTheSet(run),
    ready: '.view--pieces .n-pieces__set .n-pieces__request-label, .view--order .n-pieces__request-label',
  },
  // ── THE SET's LIVE RELEASE (lot M3, K44 T1, T4): announced at the photograph's stage, I'LL BE THERE with a picker per
  // piece (the bracelet and the ring from YOUR SIZES, the necklace in its one size), then said with every size (its write, last
  // on the set stage); on its own stage (set-live) the room (YOUR SIZES, READY CHECK SIZES, then entered and ready), the
  // line late (a picker per piece, HALO 56 greyed), the line, the turn, the set held, CONFIRMED and sold out in HALO 56 ──
  { id: 'set-live-there', title: 'THE SET’s LIVE RELEASE announced: its pieces side by side, THE SET · 3 PIECES, their names, ONE PRICE FOR THE SET, 1 SET PER PERSON; YOUR SIZES, a picker per piece, the bracelet and the ring from YOUR SIZES, the necklace’s one size, I’LL BE THERE (lot M3, T1, T4)', refs: ['M3'], variant: 'set', as: you, path: release('setLive'), ready: '.view--live .n-live__set-pickers .live__yours:not([hidden])' },
  {
    id: 'set-live-there-said',
    title: 'THE SET’s LIVE RELEASE: I’LL BE THERE said with every size, YOU’LL BE THERE · SIZE 17 · 52 · 45, WITHDRAW (lot M3, T1)',
    refs: ['M3'],
    variant: 'set',
    as: you,
    path: release('setLive'),
    mutates: true,
    act: async (run) => {
      await run.page.locator('.view--live .n-live__piece[data-piece="3"] button.live__size', { hasText: /^45$/ }).click();
      await button(run, 'I’LL BE THERE').click();
      await button(run, 'WITHDRAW').waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .n-live__said',
  },
  { id: 'set-room', title: 'THE SET’s room: its pieces behind the door, READY CHECK SIZES TO CHOOSE, YOUR SIZES a picker per piece (17 and 52 from YOUR SIZES), ENTER THE ROOM waiting for the necklace (lot M3, T1)', refs: ['M3'], variant: 'set-live', as: you, path: release('setRoom'), ready: '.view--live .live__set-pickers .live__yours:not([hidden])' },
  { id: 'set-room-ready', title: 'THE SET’s room, entered with SIZE 18 · 54 · 42: YOU’RE READY, each size to change until the opening (lot M3, T1)', refs: ['M3'], variant: 'set-live', as: 'platine', path: release('setRoom'), ready: '.view--live .live__ready:not([hidden])' },
  { id: 'set-live-join', title: 'THE SET live now, not in the line: 2 OF 5 SETS LEFT, a picker per piece (HALO 56 greyed, sold), 1 SET PER PERSON, ENTER THE LINE (lot M3, T1, T4)', refs: ['M3'], variant: 'set-live', as: you, path: release('setNow'), ready: '.view--live .live__join .live__set-pickers' },
  // ONE QUEUE (lot Q1, step Q1.3): THE SET's waiting state is the one queue, in SETS' words (N2), its id kept.
  { id: 'set-live-line', title: 'THE SET’s one queue: LIVE NOW, YOUR PLACE in your sizes, its time left, 2 OF 5 SETS LEFT, the one note (lot M3, T1; ONE QUEUE)', refs: ['M3'], variant: 'set-live', as: 'setLine', path: release('setNow'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'set-live-turn', title: 'THE SET’s turn: PRESS AND HOLD THE SEAL, TO SECURE YOUR SET, THE ORBITAL SET · SIZE 16 · 54 · 42 · € 12 000 (lot M3, T1)', refs: ['M3'], variant: 'set-live', as: 'setTurn', path: release('setNow'), ready: '.view--live .live-hold' },
  { id: 'set-live-secured', title: 'THE SET held on 5b: YOUR SET, THE SET · 3 PIECES, each piece in its size, ADD-ONS, the GIFT BOX + € 90 chosen, One box for the three pieces, PAY € 12 090 · 07:08 (lot M3, T1; lot Q2, step Q2.8, MK 5b)', refs: ['M3', 'MK 5b'], variant: 'set-live', as: 'setSecured', path: release('setNow'), ready: '.view--live .live__set-pieces .live__set-piece' },
  { id: 'set-live-confirmed', title: 'THE SET confirmed: CONFIRMED, YOUR SET IS RESERVED, each piece in its size on the receipt, the GIFT BOX, TOTAL, REFERENCE (lot M3, T1)', refs: ['M3'], variant: 'set-live', as: 'setBuyer', path: release('setNow'), ready: '.view--live .live__set-reserved' },
  { id: 'set-live-sold-out', title: 'THE SET sold out in one of its sizes: HALO · SOLD OUT IN SIZE 56, its one sentence, LEAVE THE LINE (lot M3, T1; ONE QUEUE)', refs: ['M3'], variant: 'set-live', as: 'setSoldout', path: release('setNow'), ready: '.view--live .live__edge' },
  { id: 'draw-selected-signed-out', title: 'A draw FOR SELECTED COLLECTORS, signed out: the rule in THE RELEASE, the sign-in says the release is for selected collectors', refs: ['F4'], variant: 'draw-selected', path: release('draw'), ready: '.view--release:has(.release__for) :is(form, .d-signin-line)' },
  {
    id: 'pieces-draws',
    title: 'MY PIECES of a collector with a draw in each state (PLACE HELD, WAITING LIST, LAPSED, CONCLUDED, ENTERED, WITHDRAWN, CANCELLED) and an order PAID',
    refs: ['C24', 'C31'],
    variant: 'draws',
    as: 'entrant',
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'RELEASES'),
    ready: '.view--pieces .pieces__releases',
  },
  // THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01), in the draws demo: shown to `holder`, not shown to `quiet`.
  { id: 'draw-guaranteed', title: 'A draw open, a place guaranteed by the house for 2 pieces, not entered yet: THE HOUSE’S GUARANTEE, ENTER THE DRAW', refs: ['IN-01'], variant: 'draws', as: 'holder', path: release('guaranteed'), ready: '.view--release .release__guarantee' },
  { id: 'draw-guaranteed-entered', title: 'A draw open, entered with the house’s guarantee: selected first at the draw', refs: ['IN-01'], variant: 'draws', as: 'holder', path: release('guaranteedEntered'), ready: '.view--release .release__guarantee' },
  { id: 'draw-guaranteed-drawn', title: 'A draw drawn: GUARANTEED BY THE HOUSE above the ranked list, YOURS on the holder’s own line', refs: ['IN-01'], variant: 'draws', as: 'holder', path: release('guaranteedDrawn'), ready: '.view--release:has(.release__guaranteed-list) .n-story__open:not([hidden])' },
  { id: 'draw-guaranteed-hidden', title: 'The same draw for a holder whose guarantee is not shown: the GUARANTEED lines, no YOURS, no box', refs: ['IN-01'], variant: 'draws', as: 'quiet', path: release('guaranteedDrawn'), ready: '.view--release:has(.release__guaranteed-list) .n-story__open:not([hidden])' },
  {
    id: 'draw-guarantee-account',
    title: 'The account sheet of a holder: THE HOUSE’S GUARANTEE, one block per guarantee shown (set aside, entered, waiting for ZENITH)',
    refs: ['IN-01'],
    variant: 'draws',
    as: 'holder',
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: `${ACCT} .n-account__guarantee`,
    viewport: true,
  },
  {
    id: 'draw-guarantee-pieces',
    title: 'MY PIECES of a holder, RELEASES: THE HOUSE’S GUARANTEE beside the status of its guaranteed entries',
    refs: ['IN-01'],
    variant: 'draws',
    as: 'holder',
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'RELEASES'),
    ready: '.view--pieces .pieces__guarantee',
  },
  { id: 'live-announced', title: 'A LIVE RELEASE before the room, signed in: YOUR SIZE, I’LL BE THERE', refs: ['C20'], variant: 'full', as: you, path: release('blue'), act: (run) => run.page.locator('.n-live__there button.live__size', { hasText: /^17$/ }).click(), ready: '.view--live .n-live__there' },
  { id: 'live-announced-guaranteed', title: 'A LIVE RELEASE before the room, for a holder of the house’s guarantee: I’LL BE THERE, then its line', refs: ['IN-01'], variant: 'full', as: 'holder', path: release('blue'), ready: '.view--live .live__guarantee' },
  // Plan NEXT-NINE, AC-01: I'LL BE THERE with the size YOUR SIZES preselects (a bracelet of 17 cm), to check.
  { id: 'live-announced-from-yours', title: 'A LIVE RELEASE before the room: 17 preselected, SIZE 17 · FROM YOUR SIZES, I’LL BE THERE', refs: ['AC-01'], variant: 'full', as: 'sized', path: release('blue'), ready: '.view--live .n-live__yours-block:not([hidden])' },
  { id: 'live-announced-signed-out', title: 'A LIVE RELEASE before the room, signed out: I’LL BE THERE opens the sign-in', refs: ['C28'], variant: 'full', path: release('blue'), ready: '.view--live' },
  { id: 'live-veiled', title: 'A LIVE RELEASE not yet revealed, for owners from PLATINE: not eligible', refs: ['C7', 'C28'], variant: 'full', as: you, path: release('veiled'), ready: '.view--live' },
  { id: 'live-veiled-platine', title: 'A LIVE RELEASE not yet revealed, for a PLATINE account', refs: ['C7'], variant: 'full', as: 'platine', path: release('veiled'), ready: '.view--live .n-live__there' },
  { id: 'live-rules', title: 'A LIVE RELEASE with its surprise and its access rules', refs: ['C27'], variant: 'rules', as: you, path: release('blue'), act: (run) => run.page.locator('.n-live__there button.live__size', { hasText: /^17$/ }).click(), ready: '.view--live .n-live__there' },
  { id: 'live-rules-not-eligible', title: 'Not eligible by participation', refs: ['C28'], variant: 'rules', as: 'newcomer', path: release('blue'), ready: '.view--live' },
  { id: 'live-selected-not-eligible', title: 'Not eligible: a release for selected collectors', refs: ['C28'], variant: 'rules', as: you, path: release('selected'), ready: '.view--live' },
  { id: 'live-past-secured', title: 'A past LIVE RELEASE’s final page: YOU SECURED A PIECE', refs: ['C29'], variant: 'full', as: you, path: release('morning'), ready: '.view--live .n-live__past' },
  { id: 'live-past-signed-out', title: 'A past LIVE RELEASE’s final page, signed out', refs: ['C29'], variant: 'full', path: release('morning'), ready: '.view--live .n-live__past' },
  { id: 'live-past-question', title: 'A past LIVE RELEASE, a collector whose turn passed: the question after', refs: ['C30', 'plus-11'], variant: 'full', as: 'guest', path: release('morning'), ready: '.view--live .n-question' },
  { id: 'live-past-gold', title: 'A past LIVE RELEASE nobody of the story took part in', refs: ['C25'], variant: 'full', as: you, path: release('live28'), ready: '.view--live .n-live__past' },

  // ── The room and the vault (compared with the before-captures) ──
  { id: 'room', title: 'The room: the door, READY CHECK, YOUR SIZE preselected, ENTER THE ROOM', refs: ['C21', 'live-05'], variant: 'room', as: you, path: release('room'), ready: '.view--live .live-hzd' },
  { id: 'room-sign-in', title: 'The room, signed out: SIGN IN TO ENTER', refs: ['live-13'], variant: 'room', path: release('room'), ready: '.view--live' },
  { id: 'room-not-eligible', title: 'The room, an account without a piece: not eligible', refs: ['live-14'], variant: 'room', as: 'newcomer', path: release('room'), ready: '.view--live' },
  // THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01): an account without a piece let in by its guarantee, shown or not.
  { id: 'room-guaranteed', title: 'The room for a holder of the house’s guarantee (2 pieces): ACCESS GRANTED, first in line in its size', refs: ['IN-01'], variant: 'room', as: 'roomHolder', path: release('room'), ready: '.view--live .live__guarantee:not([hidden])' },
  { id: 'room-guarantee-hidden', title: 'The room for a holder of a guarantee not shown: ACCESS GRANTED, no line of it', refs: ['IN-01'], variant: 'room', as: 'roomQuiet', path: release('room'), ready: '.view--live .live-hzd' },
  // ONE QUEUE (lot Q1, step Q1.3; ANSWERS r1, C3): the classic line screen is gone; every entry waiting reads the one
  // queue (`live-queue` and its states). `live-line` and `live-queue-admitted` went with it.
  // ONE QUEUE (lot Q1, step Q1.10; MK #turn, #turn-hold, #secured): seal C and its rings, the name with its variant, the
  // choice with its price and the room count on the phone; HOLD; PAY the light, the time inside it.
  { id: 'live-turn', title: 'The turn (MK 4): YOUR TURN, PRESS AND HOLD THE SEAL, seal C in its ring, MONOLITHE IN BLUE, SIZE 16 · 1 PIECE · € 5 050, the room count', refs: ['live-10', 'MK 4'], variant: 'live', as: 'turn', path: release('live'), ready: '.view--live .live-hold' },
  {
    id: 'live-hold',
    title: 'Holding the seal (MK 4b): HOLD, the inner ring filling in its light, its point on the leading end, the seal pressed',
    refs: ['MK 4b', 'D38'],
    variant: 'live',
    as: 'turn',
    path: release('live'),
    // The press never answered (nothing reaches the server: no press, no secure), the seal held down.
    act: async (run) => {
      await run.page.route('**/api/v1/live/*/press', () => undefined);
      const seal = run.page.locator('.view--live .live-hold');
      await seal.waitFor();
      const box = (await seal.boundingBox())!;
      await run.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await run.page.mouse.down();
    },
    ready: '.view--live .live__turn.is-holding',
  },
  { id: 'live-secured', title: '5b, SECURED with add-ons (MK 5b): YOUR PIECE on the horizon, seal C, ADD-ONS, ENGRAVING + € 150 chosen with YOUR TEXT empty 0 / 20, GIFT BOX + € 90, PAY € 5 200 · 08:11 with the time inside it (lot Q2, step Q2.8)', refs: ['live-11', 'MK 5b'], variant: 'live', as: 'secured', path: release('live'), ready: '.view--live .live__pay' },
  { id: 'live-confirmed', title: 'CONFIRMED in the vault: the photograph 470 px, CONFIRMED, LIVE RELEASE over MONOLITHE, the monogram on its horizon, the sentence, the receipt, SHARE TO STORIES, CLIENT SERVICES, MY PIECES (lot Q1 §3.7)', refs: ['live-12'], variant: 'live', as: 'confirmed', path: release('live'), ready: '.view--live:has(h1) .n-story__open:not([hidden])' },
  { id: 'live-sold-out-size', title: 'SOLD OUT IN SIZE 17: its one sentence (ONE QUEUE, D27), YOUR PLACE in its size, LEAVE THE LINE', refs: ['live-20'], variant: 'live', as: 'soldout', path: release('live'), ready: '.view--live .live__edge' },
  { id: 'live-missed', title: 'YOUR TURN HAS PASSED', refs: ['live-15', 'C30'], variant: 'live', as: 'missed', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-expired', title: 'YOUR HOLD HAS ENDED', refs: ['live-16', 'C30'], variant: 'live', as: 'expired', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-released', title: 'YOUR PLACE IS RELEASED', refs: ['live-17', 'C30'], variant: 'live', as: 'released', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-left', title: 'YOU LEFT THE LINE', refs: ['live-18', 'C30'], variant: 'live', as: 'left', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-removed', title: 'YOUR ENTRY IS REMOVED', refs: ['live-19', 'C30'], variant: 'live', as: 'removed', path: release('live'), ready: '.view--live .n-live__end' },
  // No before-capture shows ENTER THE LINE (live-09 is the line itself): the room's own pieces.
  { id: 'live-join', title: 'Live now, an account not in the line: ENTER THE LINE', refs: ['same pieces'], variant: 'live', as: you, path: release('live'), ready: '.view--live' },
  // ── THE VAULT (lot Q3, step Q3.10; MK #sold, #release-end; the stage `vault`): its door on SOLD OUT for your size and
  // on the end page of a release sold out whole, closed (also in light: the room stays dark), then opened (the reveal
  // still under reduced motion: €25 · House credit, valid 30 days. · 1 IN 10; GUARANTEED, rare), each opening its own
  // collector's vault (they write: last of the stage). ──
  { id: 'live-sold-out-size-vault', title: 'SOLD OUT for your size with THE VAULT (MK S): the door under the sentence, A vault is waiting for you., DRAW IT DOWN, OR PRESS AND HOLD, then LEAVE THE LINE', refs: ['MK S'], variant: 'vault', as: 'vaultS', path: release('live'), ready: VAULT_DOOR, check: vaultClosed },
  { id: 'live-sold-out-size-vault-light', title: 'SOLD OUT for your size with THE VAULT, in light mode: the room and the door stay dark', refs: ['MK S'], variant: 'vault', as: 'vaultS', path: release('live'), light: true, ready: VAULT_DOOR, check: allOf(vaultClosed, staysDark) },
  { id: 'live-end-vault', title: 'The end page of a release sold out whole with THE VAULT (MK 11): LIVE RELEASE and the name, SOLD OUT, its sentence, the door, THE RELEASES', refs: ['MK 11'], variant: 'vault', as: 'vaultEnd', path: release('vaultEnd'), act: (run) => sellOutWhole(run, 'vaultEnd'), ready: VAULT_END_DOOR, mutates: true, check: vaultClosed },
  { id: 'live-end-vault-light', title: 'The end page with THE VAULT, in light mode: drawn dark, as the room', refs: ['MK 11'], variant: 'vault', as: 'vaultEndLight', path: release('vaultEndLight'), light: true, act: (run) => sellOutWhole(run, 'vaultEndLight'), ready: VAULT_END_DOOR, mutates: true, check: allOf(vaultClosed, staysDark) },
  { id: 'vault-open', title: 'SOLD OUT for your size, THE VAULT opened (MK S, PLAY THE VAULT): FROM THE VAULT, €25, House credit, valid 30 days., 1 IN 10, OPEN ANOTHER above LEAVE THE LINE, the page dimmed', refs: ['MK S'], variant: 'vault', as: 'vaultSOpen', path: release('live'), act: (run) => openTheVault(run, { reduced: true }), ready: VAULT_OPEN, mutates: true, check: vaultOpened('.live__leave-line') },
  { id: 'vault-open-rare', title: 'SOLD OUT for your size, THE VAULT opened on a rare reward: GUARANTEED, A piece at the next LIVE release., 1 IN 200, OPEN ANOTHER', refs: ['MK S'], variant: 'vault', as: 'vaultSRare', path: release('live'), act: (run) => openTheVault(run, { rare: true, reduced: true }), ready: VAULT_OPEN, mutates: true, check: vaultOpened('.live__leave-line') },
  { id: 'live-end-vault-open', title: 'The end page with THE VAULT opened (MK 11): the reward, OPEN ANOTHER above THE RELEASES', refs: ['MK 11'], variant: 'vault', as: 'vaultEndOpen', path: release('vaultEndOpen'), act: async (run) => (await sellOutWhole(run, 'vaultEndOpen'), openTheVault(run, { reduced: true })), ready: VAULT_OPEN, mutates: true, check: vaultOpened('.n-live__back') },
  { id: 'live-pieces-turn', title: 'MY PIECES of a collector at its turn: YOUR TURN', refs: ['C31'], variant: 'live', as: 'turn', path: at('/verify/pieces'), act: (run) => piecesTab(run, 'RELEASES'), ready: '.view--pieces .pieces__releases' },
  { id: 'after-room-door', title: 'The after-room’s second door: the horizon open, a point at each parted end, the light through the gap (lot Q1 §3.9)', refs: ['C26', 'plus-07'], variant: 'afterroom', as: you, path: release('afterroom'), ready: '.view--live .live__after' },
  {
    id: 'after-room-join',
    title: 'The after-room: your place from the line, choose your size',
    refs: ['C26', 'plus-08'],
    variant: 'afterroom',
    as: you,
    path: release('afterroom'),
    act: async (run) => {
      await button(run, 'ENTER THE AFTER-ROOM').click();
      await run.page.locator('.live__join').waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .live__join',
  },
  {
    id: 'room-checks-pending',
    title: 'The room, its READY CHECK not ready: SIZE TO CHOOSE, CONNECTION RECONNECTING, CLOCK SYNCING',
    refs: ['same pieces'],
    variant: 'room',
    as: 'crowd5',
    path: release('room'),
    // The clock of ORBES never answers, the room's stream never opens: the page follows the room by reading it.
    routes: async (page) => {
      await page.route('**/api/v1/live/clock', (r) => r.abort('internetdisconnected'));
      await page.route('**/api/v1/live/*/stream', (r) => r.abort('internetdisconnected'));
    },
    ready: '.view--live .live-hzd',
  },
  { id: 'after-room-sold-out', title: 'The after-room sold out before your turn: SOLD OUT', refs: ['C30'], variant: 'afterroom-ends', as: 'arSoldOut', path: release('arSoldOut', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-closed', title: 'The after-room’s time over before your turn: THE AFTER-ROOM IS CLOSED', refs: ['C30'], variant: 'afterroom-ends', as: 'arClosed', path: release('arClosed', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-ended', title: 'The after-room ended by ORBES before your piece: THE AFTER-ROOM HAS ENDED', refs: ['C30'], variant: 'afterroom-ends', as: 'arEnded', path: release('arEnded', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-over', title: 'The after-room over, for a guest who never entered it: THE AFTER-ROOM IS CLOSED, your entry stays in MY PIECES', refs: ['C30'], variant: 'afterroom-ends', as: 'arOver', path: release('arSoldOut', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'room-stress', title: 'A room open with the longest host message, a 24-character name, a price of € 125 400', refs: ['same pieces'], variant: 'stress', as: you, path: release('soon'), ready: '.view--live', stress: true },
  { id: 'live-far-stress', title: 'A LIVE RELEASE more than 9 days away, in USD', refs: ['same pieces'], variant: 'stress', as: you, path: release('far'), ready: '.view--live', stress: true },

  // ── The one queue (ONE QUEUE, lot Q1, step Q1.3; ANSWERS C3): every entry waiting for its turn ──
  { id: 'live-queue', title: 'The one queue (MK Q1): LIVE NOW, MONOLITHE IN BLUE, SIZE 17 · 1 PIECE, the room, YOUR PLACE 4 in size 17, ESTIMATED … LEFT, 176 OF 300 LEFT · 3 IN SIZE 17, the one note, FROM ORBES, LEAVE THE LINE', refs: ['W5', 'W6', 'MK Q1'], variant: 'queue', as: 'queueWait', path: release('queueWait'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'live-queue-paused', title: 'The one queue paused by ORBES (PAUSE PACE): YOUR PLACE, THE QUEUE IS PAUSED over its frozen time', refs: ['W5'], variant: 'queue', as: 'queuePaused', path: release('queuePaused'), ready: '.view--live .live__queue[data-state="paused"]' },
  {
    id: 'live-queue-error',
    title: 'The queue, LEAVE THE LINE refused: the refusal as the server words it',
    refs: ['W6'],
    variant: 'queue',
    as: 'queued',
    path: release('queue'),
    routes: (page) => page.route('**/api/v1/live/*/leave', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }) })),
    act: async (run) => {
      await run.page.locator('.view--live .live__queue[data-state="waiting"]').waitFor({ timeout: 20_000 });
      // A second tap within a few seconds confirms it; the server refuses it.
      await button(run, 'LEAVE THE LINE').click();
      await run.page.locator('.live__queue .live__leave-line', { hasText: /AGAIN TO LEAVE/ }).click();
    },
    ready: '.view--live .live__queue .live__error:not([hidden])',
  },
  { id: 'live-queue-stress', title: 'The one queue at its longest: the last place in size 17, ESTIMATED … H … MIN LEFT', refs: ['same pieces'], variant: 'queue', as: 'queueFar', path: release('queue'), ready: '.view--live .live__queue[data-state="waiting"]', stress: true },
  // ONE QUEUE's look (lot Q1, step Q1.7; MK Q9, Q10): the Horizon band of a small release and at its LAST PIECES; the
  // phone without its photograph (it cannot be loaded): the vault's ground alone, the screen moved up.
  { id: 'live-queue-small', title: 'The one queue of a small release: 24 pieces, the Horizon band in place of the cells, 9 OF 24 LEFT · 2 IN SIZE 17, YOUR PLACE 3, FROM ORBES', refs: ['MK Q9'], variant: 'queue', as: 'queueSmall', path: release('queueSmall'), ready: '.view--live .live__queue[data-state="waiting"] .live-hz:not([hidden])' },
  { id: 'live-queue-last', title: 'The one queue at its LAST PIECES: 18 OF 300 LEFT · 2 IN SIZE 17, LAST PIECES under the band, YOUR PLACE 2, FROM ORBES', refs: ['MK Q10'], variant: 'queue', as: 'queueLast', path: release('queueLast'), ready: '.view--live .live__queue[data-state="waiting"] .live-hz.is-last' },
  {
    id: 'live-queue-nophoto',
    title: 'The one queue whose photograph cannot be loaded: the vault’s ground alone, the screen moved up, no corner marks',
    refs: ['OP-5'],
    variant: 'queue',
    as: 'queued',
    path: release('queue'),
    routes: (page) => page.route('**/api/v1/media/**', (r) => r.abort('failed')),
    ready: '.view--live.live--look:not(.live--photo) .live__queue[data-state="waiting"]',
  },
  // The one waiting screen in every state (lot Q1, step Q1.8; MK #queue Q2, Q3, Q5–Q8, #after-wait), each on its own
  // release of the stage (nocturne-demo.ts seedQueue): during the hold, the release's PAUSE, past the close, one size,
  // a late comer with its place, every piece of its size held; the after-room's waiting screen.
  { id: 'live-queue-hold', title: 'The one queue during the hold (MK Q2): YOUR PLACE 39, its time counting the hold, 300 OF 300 LEFT, nothing said of the hold', refs: ['MK Q2'], variant: 'queue', as: 'queueHold', path: release('queueHold'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'live-queue-release-paused', title: 'The one queue, the release paused by ORBES (MK Q3): PAUSED and its line above the frozen time, FROM ORBES alone above', refs: ['MK Q3'], variant: 'queue', as: 'queueReleasePaused', path: release('queueReleasePaused'), ready: '.view--live .live__queue[data-state="paused"]' },
  { id: 'live-queue-close', title: 'The one queue past the close (MK Q5): YOUR PLACE 42, ESTIMATED … H … MIN LEFT, 9 IN SIZE 17', refs: ['MK Q5'], variant: 'queue', as: 'queueClose', path: release('queueClose'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'live-queue-one', title: 'The one queue of a release in one size (MK Q6): ONE SIZE · 1 PIECE, YOUR PLACE 1, ESTIMATED LESS THAN A MINUTE LEFT, … IN ONE SIZE', refs: ['MK Q6'], variant: 'queue', as: 'queueOne', path: release('queueOne'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'live-queue-late', title: 'The one queue of a late comer with its place (MK Q7b): YOUR PLACE 40 behind those waiting at the opening, during the hold', refs: ['MK Q7b'], variant: 'queue', as: 'queueLate', path: release('queueHold'), ready: '.view--live .live__queue[data-state="waiting"]' },
  { id: 'live-queue-held', title: 'The one queue, every piece of its size held, none paid (MK Q8): still the waiting screen, 176 OF 300 LEFT · 0 IN SIZE 17', refs: ['MK Q8'], variant: 'queue', as: 'queueHeld', path: release('queueHeld'), ready: '.view--live .live__queue[data-state="waiting"]' },
  // The draw at the opening (lot Q1, step Q1.9; MK #room-draw, 3b): LIVE NOW, the name, its pieces, DRAWING THE PLACES and
  // its sentence on the horizon, the room count, the point travelling; the page waits for its place.
  { id: 'live-draw', title: 'The draw at the opening (MK 3b): LIVE NOW, MONOLITHE, 300 PIECES, DRAWING THE PLACES and its sentence on the horizon, the room count, FROM ORBES', refs: ['MK 3b', 'D36'], variant: 'queue', as: 'drawing', path: release('drawing'), ready: '.view--live .live__room.is-drawn .live__drawing:not([hidden])' },
  {
    id: 'live-turn-returned',
    title: 'The turn of a size seen full (N11): production’s A PIECE HAS RETURNED, PRESS AND HOLD THE SEAL',
    refs: ['N11', 'D51'],
    variant: 'queue',
    as: 'queueReturned',
    path: release('queueReturned1'),
    mutates: true,
    act: returnedTurn,
    ready: '.view--live .live__turn .live__overline',
  },
  { id: 'live-after-wait', title: 'The after-room’s waiting screen (MK A): THE AFTER-ROOM, YOUR PLACE 2 in size 17, 3 OF 12 LEFT · 0 IN SIZE 17, no time', refs: ['MK A', 'D29'], variant: 'queue', as: 'afterWait', path: release('afterWait', '/after-room'), ready: '.view--live .live__queue[data-state="waiting"]' },
  {
    id: 'live-queue-loading',
    title: 'The queue just entered after the opening, its figures being read: READING YOUR PLACE',
    refs: ['W2'],
    variant: 'queue',
    as: you,
    path: release('queue'),
    mutates: true,
    // No stream: the page reads the state; once ENTER THE LINE is offered, every read of it is held.
    routes: (page) => page.route('**/api/v1/live/*/stream', (r) => r.abort('internetdisconnected')),
    act: async (run, hold) => {
      await run.page.locator('.view--live .live__join').waitFor({ timeout: 20_000 });
      hold.hold('**/api/v1/live/*/state');
      await run.page.locator('.live__picker button.live__size', { hasText: /^17$/ }).click();
      await button(run, 'ENTER THE LINE').click();
    },
    ready: '.view--live .live__queue[data-state="reading"]',
  },

  // ── THE CIRCLE ──
  { id: 'circle', title: 'THE CIRCLE: the invitation answered YES, the note', refs: ['C8'], variant: 'full', as: you, path: at('/verify/circle'), ready: '.view--circle article' },
  { id: 'circle-platine', title: 'THE CIRCLE of a PLATINE account: the poll too', refs: ['C8'], variant: 'full', as: 'platine', path: at('/verify/circle'), ready: '.view--circle article' },
  {
    id: 'circle-show-more',
    title: 'THE CIRCLE of a PLATINE account with more posts than a page: SHOW MORE',
    refs: ['C8'],
    variant: 'full',
    as: 'platine',
    path: at('/verify/circle'),
    // The demo publishes fewer posts than a page (twenty): the feed's answer says one more is there, as C8's does.
    // Its content baseline is what 5efd4c9's feed showed under the same answer: circle-platine's, SHOW MORE after the
    // last post (views/circle.ts there: SHOW MORE while fewer posts are shown than the total).
    routes: async (page) =>
      page.route('**/api/v1/club/circle?*', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as { total: number };
        await route.fulfill({ response: res, json: { ...body, total: body.total + 1 } });
      }),
    ready: '.view--circle .circle__more',
  },
  { id: 'circle-signed-out', title: 'THE CIRCLE, signed out: the sign-in', refs: ['C40'], variant: 'full', path: at('/verify/circle'), ready: ':is(.view--circle form, .view--circle .d-signin-line)' },
  { id: 'circle-no-piece', title: 'THE CIRCLE without a piece: it opens once a piece is registered', refs: ['C40'], variant: 'full', as: 'newcomer', path: at('/verify/circle'), ready: '.view--circle .circle__closed' },
  {
    id: 'circle-failed',
    title: 'THE CIRCLE could not be shown: the reason and TRY AGAIN',
    refs: ['C40'],
    variant: 'full',
    as: you,
    path: at('/verify/circle'),
    routes: async (page) => page.route('**/api/v1/club/circle?*', (r) => r.abort('internetdisconnected')),
    ready: '.view--circle .n-failed',
  },
  { id: 'post-invitation', title: 'A post: the invitation, YOUR ANSWER, TO SEE', refs: ['C22'], variant: 'full', as: you, path: post('invitation'), ready: '.view--circle-post section' },
  {
    id: 'post-poll',
    title: 'A post: the poll, an option chosen before VOTE',
    refs: ['C34'],
    variant: 'full',
    as: 'platine',
    path: post('poll'),
    act: async (run) => {
      await button(run, 'BLACK').click();
      await run.page.locator('.circle-post__options [aria-pressed="true"]').waitFor();
    },
    ready: '.view--circle-post section',
  },
  { id: 'post-poll-voted', title: 'A post: the poll, voted, its results', refs: ['C34'], variant: 'full', as: 'voter1', path: post('poll'), ready: '.view--circle-post section' },
  { id: 'post-note', title: 'A post: the note', refs: ['C22'], variant: 'full', as: you, path: post('note'), ready: '.view--circle-post' },
  {
    id: 'post-answers-closed',
    title: 'An invitation whose event has begun: answers are closed, no YES nor NO',
    refs: ['C22'],
    variant: 'full',
    as: you,
    path: post('invitation'),
    routes: (page) => invitationAnswer(page, (inv) => ({ ...inv, open: false })),
    ready: '.view--circle-post section',
  },
  {
    id: 'post-full',
    title: 'An invitation with every place taken, not answered: YES held back',
    refs: ['C22'],
    variant: 'full',
    as: you,
    path: post('invitation'),
    routes: (page) => invitationAnswer(page, (inv) => ({ ...inv, placesLeft: 0 }), null),
    ready: '.view--circle-post section',
  },
  {
    id: 'post-failed',
    title: 'A post could not be shown: the reason and TRY AGAIN',
    refs: ['C40'],
    variant: 'full',
    as: you,
    path: post('invitation'),
    routes: async (page) => page.route('**/api/v1/club/circle/*', (r) => (r.request().method() === 'GET' ? r.abort('internetdisconnected') : r.continue())),
    ready: '.view--circle-post .n-failed',
  },
  { id: 'post-not-found', title: 'A post’s address that leads nowhere', refs: ['C40'], variant: 'full', as: you, path: at('/verify/circle/00000000-0000-4000-8000-000000000000'), ready: '.view--circle-post' },
  { id: 'circle-stress', title: 'THE CIRCLE with eight posts, a long title', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/circle'), ready: '.view--circle article', stress: true },
  { id: 'post-stress', title: 'A note with the longest title', refs: ['same pieces'], variant: 'stress', as: you, path: post('long'), ready: '.view--circle-post', stress: true },
  { id: 'post-poll-stress', title: 'A poll with a long option (A FINISH IN BRUSHED BLACK RHODIUM), before a vote', refs: ['same pieces'], variant: 'stress', as: you, path: post('longPoll'), ready: '.view--circle-post section', stress: true },
  {
    id: 'circle-empty',
    title: 'THE CIRCLE of an owner, nothing published',
    refs: ['C40'],
    variant: 'empty',
    as: 'owner',
    path: at('/verify/circle'),
    ready: '.view--circle :text("Nothing has been published in the circle yet.")',
    stress: true,
  },

  // ── The legal pages ──
  { id: 'legal-privacy', title: 'The legal pages: PRIVACY', refs: ['C23'], variant: 'full', path: at('/legal/privacy'), ready: '.legal__section' },
  { id: 'legal-terms', title: 'The legal pages: TERMS', refs: ['C23'], variant: 'full', path: at('/legal/terms'), ready: '.legal__section' },
  { id: 'legal-notice', title: 'The legal pages: LEGAL', refs: ['C23'], variant: 'full', path: at('/legal/notice'), ready: '.legal__section' },
  { id: 'legal-faq', title: 'The legal pages: HELP', refs: ['C41'], variant: 'full', path: at('/legal/faq'), ready: '.legal__section' },
  { id: 'legal-index', title: 'The legal pages: the index (/legal, and any other address under /legal)', refs: ['C23'], variant: 'full', path: at('/legal'), ready: '.legal-index' },
  { id: 'legal-privacy-fr', title: 'The legal pages in French: CONFIDENTIALITÉ', refs: ['C23'], variant: 'full', path: at('/legal/privacy?lang=fr'), ready: '.legal__section' },
  { id: 'legal-terms-fr', title: 'The legal pages in French: CONDITIONS', refs: ['C23'], variant: 'full', path: at('/legal/terms?lang=fr'), ready: '.legal__section' },
  { id: 'legal-notice-fr', title: 'The legal pages in French: MENTIONS LÉGALES', refs: ['C23'], variant: 'full', path: at('/legal/notice?lang=fr'), ready: '.legal__section' },
  { id: 'legal-faq-fr', title: 'The legal pages in French: AIDE', refs: ['C41'], variant: 'full', path: at('/legal/faq?lang=fr'), ready: '.legal__section' },
  { id: 'legal-index-fr', title: 'The legal pages in French: the index', refs: ['C23'], variant: 'full', path: at('/legal?lang=fr'), ready: '.legal-index' },

  // ── Kept as they are (plan NOCTURNE, choice 3 and the scope guard) ──
  { id: 'certificate', title: 'The shared ownership certificate (/verify/c#…), kept as it is', refs: ['kept (choice 3)', 'verify-13'], variant: 'full', path: (d) => `/verify/c#${d.links.certificate}`, ready: '.view--certificate .genome-svg' },
  // On the landscape screen its before-capture was taken on (live-07, capture-ui: 1280 × 720 at 1×), its viewport alone.
  {
    id: 'board',
    title: 'The boutique board of a LIVE RELEASE, kept as it is',
    refs: ['kept (scope guard)', 'live-07'],
    variant: 'room',
    path: (d) => `/verify/releases/${d.releases.room}/board#${d.links.board}`,
    ready: '.view--board .live-door__seal',
    viewport: true,
    size: { width: 1280, height: 720 },
  },

  // ── States that write (each its own piece or post) ──
  // The owner's transfer code first: you@example.com still holds its two pieces (TITANE, as C37 draws the header); the two
  // registrations after it give the account its third and fourth (still TITANE: PLATINE from five), which MY PIECES' states list.
  {
    id: 'result-transfer-code',
    title: 'The owner’s transfer code, created',
    refs: ['C37'],
    variant: 'full',
    as: you,
    mutates: true,
    ...result('gold', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await button(run, 'CREATE TRANSFER CODE').click();
      await button(run, 'CANCEL TRANSFER').waitFor({ timeout: 20_000 });
    }),
  },
  {
    id: 'result-registered-now',
    title: 'Registered: REGISTERED TO YOU, VIEW AS OWNER',
    refs: ['C36'],
    variant: 'full',
    as: you,
    mutates: true,
    ...result('first', (run) => registerPiece(run, 'first')),
  },
  {
    id: 'result-ceremony',
    title: 'VIEW AS OWNER after a first registration: the ceremony, SHARE THE GENOME',
    refs: ['C36'],
    variant: 'full',
    as: you,
    mutates: true,
    ...result('ceremony', async (run) => {
      await registerPiece(run, 'ceremony');
      await button(run, 'VIEW AS OWNER').click();
      await run.page.getByText('SHARE THE GENOME').first().waitFor({ timeout: 20_000 });
      // Plan NEXT-NINE, BP-10: SHARE TO STORIES, once its card is drawn.
      await button(run, 'SHARE TO STORIES').waitFor({ timeout: 20_000 });
      await sleep(2_500);
    }),
  },
  {
    id: 'result-ceremony-stress',
    title: 'The ceremony of a first registration: the 24-character model in its 14-character variant, a Size of 14 characters',
    refs: ['same pieces'],
    variant: 'stress',
    as: you,
    stress: true,
    mutates: true,
    ...result('stressCeremony', async (run) => {
      await registerPiece(run, 'stressCeremony');
      await button(run, 'VIEW AS OWNER').click();
      await run.page.getByText('SHARE THE GENOME').first().waitFor({ timeout: 20_000 });
      await sleep(2_500);
    }),
  },
  {
    id: 'result-received',
    title: 'The new owner, the transfer code entered: REGISTERED TO YOU, VIEW AS OWNER',
    refs: ['C37'],
    variant: 'full',
    as: 'newcomer',
    mutates: true,
    ...result('passing', async (run) => {
      const code = run.demo.links.transfer;
      if (!code) throw new Error('no transfer code in the demo');
      await run.page.getByLabel('TRANSFER CODE').first().fill(code);
      await button(run, 'RECEIVE THIS PIECE').click();
      await button(run, 'VIEW AS OWNER').waitFor({ timeout: 20_000 });
    }),
  },
  {
    id: 'pieces-certificate-link',
    title: 'A piece: the certificate link, shown once, COPY LINK, OPEN LINK, WITHDRAW',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    mutates: true,
    act: async (run) => {
      await button(run, 'CREATE CERTIFICATE').click();
      await button(run, 'CREATE LINK').click();
      await run.page.locator('.certificate-link__value').first().waitFor({ timeout: 20_000 });
    },
    ready: '.certificate-link',
  },
  {
    id: 'pieces-certificate-withdrawn',
    title: 'A piece: a certificate link withdrawn, The link has been withdrawn',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    mutates: true,
    act: async (run) => {
      await button(run, 'CREATE CERTIFICATE').click();
      await button(run, 'CREATE LINK').click();
      await run.page.locator('.certificate-link__value').first().waitFor({ timeout: 20_000 });
      await run.page.locator('.piece__certificate-withdraw').first().click();
      await run.page.getByText('The link has been withdrawn', { exact: false }).first().waitFor({ timeout: 20_000 });
    },
    ready: '.view--piece .n-piece__article',
  },
  {
    id: 'model-salon-requested',
    title: 'THE PRIVATE SALON: REQUESTED, ORBES Client Services will contact you',
    refs: ['C33'],
    variant: 'full',
    as: you,
    path: sheet('zenith'),
    mutates: true,
    act: async (run) => {
      await button(run, 'REQUEST THIS PIECE').click();
      await run.page.locator('.sheet__requested').waitFor({ timeout: 20_000 });
    },
    ready: '.sheet__requested',
  },
  {
    id: 'live-there',
    title: 'I’LL BE THERE said, with a size: YOU’LL BE THERE · SIZE 17, WITHDRAW',
    refs: ['C28'],
    variant: 'full',
    as: you,
    path: release('blue'),
    mutates: true,
    act: async (run) => {
      await run.page.locator('.n-live__there button.live__size', { hasText: /^17$/ }).click();
      await button(run, 'I’LL BE THERE').click();
      await button(run, 'WITHDRAW').waitFor({ timeout: 20_000 });
    },
    ready: '.view--live .n-live__there',
  },
  {
    id: 'draw-entered',
    title: 'A draw entered: You are entered in the draw, WITHDRAW, YOUR ENTRY',
    refs: ['C31'],
    variant: 'full',
    as: you,
    path: release('draw'),
    mutates: true,
    act: async (run) => {
      await button(run, 'ENTER THE DRAW').click();
      await run.page.getByText('You are entered in the draw.', { exact: false }).first().waitFor({ timeout: 20_000 });
    },
    ready: '.view--release',
  },
  {
    id: 'post-answered-no',
    title: 'The invitation answered NO',
    refs: ['C22'],
    variant: 'full',
    as: you,
    path: post('invitation'),
    mutates: true,
    act: async (run) => {
      await button(run, 'NO').click();
      await run.page.getByText('You will not come.', { exact: false }).first().waitFor({ timeout: 20_000 });
    },
    ready: '.view--circle-post',
  },
  {
    id: 'live-past-question-answered',
    title: 'The question after, answered: ANOTHER FINISH pressed',
    refs: ['C30'],
    variant: 'full',
    as: 'guest',
    path: release('morning'),
    mutates: true,
    act: async (run) => {
      await run.page.locator('.view--live .n-question').waitFor({ timeout: 20_000 });
      await button(run, 'ANOTHER FINISH').click();
      await run.page.locator('.n-question [aria-pressed="true"]').waitFor({ timeout: 20_000 });
      await settle(run.page);
    },
    ready: '.view--live .n-question',
  },
  // ── YOUR SIZES (plan NEXT-NINE, AC-01): the view of a collector who saved two sizes; then an account without a piece
  // saves its own, reads them again and clears them, in order ──
  {
    id: 'sizes-view',
    title: 'The account sheet: YOUR SIZES, a ring of 52 and a bracelet of 17 cm saved, the wrist and the necklace NOT SET, SAVE, CANCEL',
    refs: ['AC-01'],
    variant: 'full',
    as: 'sized',
    path: at('/verify'),
    // It writes nothing: it runs with the writes of YOUR SIZES, before them (the content test's shards, CONTENT_SHARDS).
    mutates: true,
    act: (run) => openSizes(run),
    ready: `${ACCT} :is(.n-account__sizes-view, .d-acct__sub--sizes) form`,
    viewport: true,
  },
  {
    id: 'sizes-save',
    title: 'YOUR SIZES saved: a ring of 52 and a wrist of 16.5 cm; the sheet says so, its row RING 52 · WRIST 16.5 CM',
    refs: ['AC-01'],
    variant: 'full',
    as: 'sizer',
    path: at('/verify'),
    mutates: true,
    act: (run) => saveSizes(run, { ring: '52', wrist: '16.5' }),
    ready: `${ACCT} :is(.n-account__sizes-line, .d-acct__card[data-key="sizes"] .d-acct__card-line)`,
    viewport: true,
  },
  {
    id: 'sizes-reopen',
    title: 'YOUR SIZES opened again: the ring of 52 and the wrist of 16.5 cm as saved',
    refs: ['AC-01'],
    variant: 'full',
    as: 'sizer',
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await openSizes(run);
      const values = await run.page.evaluate(() => ['ring', 'bracelet', 'wrist', 'necklace'].map((k) => (document.querySelector(`#account-size-${k}`) as HTMLSelectElement | null)?.value ?? null));
      if (JSON.stringify(values) !== JSON.stringify(['52', '', '16.5', ''])) throw new Error(`YOUR SIZES read again: ${JSON.stringify(values)}`);
    },
    ready: `${ACCT} :is(.n-account__sizes-view, .d-acct__sub--sizes) form`,
    viewport: true,
  },
  {
    id: 'sizes-clear',
    title: 'YOUR SIZES cleared: every size NOT SET, its row NOT SET',
    refs: ['AC-01'],
    variant: 'full',
    as: 'sizer',
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      await saveSizes(run, { ring: '', bracelet: '', wrist: '', necklace: '' });
      await run.page.locator(':is(.n-account__sizes-line, .d-acct__card[data-key="sizes"] .d-acct__card-line)', { hasText: /^NOT SET$/ }).waitFor({ timeout: 20_000 });
    },
    ready: `${ACCT} :is(.n-account__sizes-line, .d-acct__card[data-key="sizes"] .d-acct__card-line)`,
    viewport: true,
  },
  {
    id: 'room-ready',
    title: 'The room, entered: YOU’RE READY',
    refs: ['C21', 'live-06'],
    variant: 'room',
    as: you,
    path: release('room'),
    mutates: true,
    act: async (run) => {
      // The room counts the account once its entry is in: the count, read before, has grown by one (it comes after YOU’RE READY).
      const inRoom = () => run.page.evaluate(() => Number(/(\d+) IN THE ROOM/.exec(document.body.innerText)?.[1] ?? 0));
      await run.page.getByText(/\d+ IN THE ROOM/).first().waitFor({ timeout: 20_000 });
      const before = await inRoom();
      await button(run, 'ENTER THE ROOM').click();
      await run.page.getByText('YOU’RE READY').first().waitFor({ timeout: 20_000 });
      await run.page.waitForFunction((n) => new RegExp(`(^|\\D)${n} IN THE ROOM`).test(document.body.innerText), before + 1, { timeout: 20_000 });
    },
    ready: '.view--live .live-hzd',
  },
  // Plan MACRO M1 §4.4 (E1–E3; lot M1, step M1.19), on the stage `email` (the emails' channel on): FORGOTTEN PASSWORD? with
  // RESET BY EMAIL and its sentence once sent (an address no account uses: nothing is written); the page of the link (its
  // form, a link incomplete, a link refused, the new password saved); YOUR PROFILE's release notices; STOP THESE EMAILS
  // (release notices, the founding list's email, a link not recognised, then stopped). The writes last, in this order:
  // stopped, then the new password (which ends every session of you's, so nothing after it signs in as you).
  {
    id: 'signin-reset-email',
    title: 'MY PIECES, signed out: FORGOTTEN PASSWORD with RESET BY EMAIL (EMAIL, SEND LINK) over ORBES Client Services’ way',
    refs: ['E3'],
    variant: 'email',
    path: at('/verify/pieces'),
    act: async (run) => {
      await forgottenByEmail(run);
    },
    ready: ':is(.view--pieces, .view--signin) form.form--reset-request',
  },
  {
    id: 'signin-reset-sent',
    title: 'RESET BY EMAIL, SEND LINK pressed: the same sentence for any address',
    refs: ['E3'],
    variant: 'email',
    path: at('/verify/pieces'),
    act: async (run) => {
      const scope = await forgottenByEmail(run);
      await run.page.locator(`${scope} form.form--reset-request input[type=email]`).fill('someone.else@example.com');
      await run.page.locator(`${scope} form.form--reset-request`).getByRole('button', { name: 'SEND LINK', exact: true }).click();
      await run.page.locator(`${scope} .n-own__sent`).waitFor({ timeout: 20_000 });
    },
    ready: ':is(.view--pieces, .view--signin) .n-own__sent',
  },
  {
    id: 'reset-new-password',
    title: 'SET A NEW PASSWORD, the link of RESET BY EMAIL: the account, NEW PASSWORD twice, SAVE',
    refs: ['E3'],
    variant: 'email',
    path: (d) => `/verify/reset#${d.links.reset}`,
    ready: '.view--reset form.form--reset',
  },
  {
    id: 'reset-incomplete',
    title: 'SET A NEW PASSWORD, a link without its address and code: incomplete, SEND A NEW LINK',
    refs: ['E3'],
    variant: 'email',
    path: at('/verify/reset'),
    ready: '.view--reset form.form--reset-request',
  },
  {
    id: 'reset-expired',
    title: 'SET A NEW PASSWORD, a link refused (expired, used or replaced): said of the link, SEND A NEW LINK',
    refs: ['E3'],
    variant: 'email',
    // An address no account uses: the server's one answer for every refusal, and no guess counted against you's code.
    path: at('/verify/reset#no.account%40example.com/7K3M-Q9TD-2WXA'),
    act: async (run) => {
      await run.page.locator('.view--reset form.form--reset').waitFor();
      await run.page.locator('#reset-password').fill('a new password for orbes');
      await run.page.locator('#reset-password-again').fill('a new password for orbes');
      await run.page.locator('.view--reset form.form--reset').getByRole('button', { name: 'SAVE', exact: true }).click();
      await run.page.locator('.view--reset .n-mail__refused').waitFor({ timeout: 20_000 });
    },
    ready: '.view--reset form.form--reset-request',
  },
  {
    id: 'profile-release-notices',
    title: 'YOUR PROFILE, the emails’ channel on: EMAILS, EMAIL ME WHEN A RELEASE IS ANNOUNCED (on)',
    refs: ['E2'],
    variant: 'email',
    as: you,
    path: at('/verify'),
    act: async (run) => {
      await openProfile(run);
      await run.page.locator(`${ACCT} #profile-group-emails`).scrollIntoViewIfNeeded();
    },
    ready: `${ACCT} .n-profile__notices .n-sw__input:checked`,
    viewport: true,
  },
  {
    id: 'unsubscribe',
    title: 'STOP THESE EMAILS?, a release notice’s link: what it stops, STOP',
    refs: ['E2'],
    variant: 'email',
    path: (d) => `/verify/unsubscribe#${d.links.unsubscribe}`,
    ready: '.view--unsubscribe .n-mail__action',
  },
  {
    id: 'unsubscribe-founding',
    title: 'STOP THESE EMAILS?, the founding list’s link: what it stops, STOP',
    refs: ['E1'],
    variant: 'email',
    path: (d) => `/verify/unsubscribe#${d.links.unsubscribeFounding}`,
    ready: '.view--unsubscribe .n-mail__action',
  },
  {
    id: 'unsubscribe-invalid',
    title: 'STOP THESE EMAILS, a link not recognised: one calm sentence',
    refs: ['E1', 'E2'],
    variant: 'email',
    path: at('/verify/unsubscribe#not-a-link-of-orbes'),
    ready: '.view--unsubscribe .n-mail__invalid',
  },
  {
    id: 'unsubscribe-done',
    title: 'EMAILS STOPPED, release notices: no longer sent, and how to switch them on again',
    refs: ['E2'],
    variant: 'email',
    path: (d) => `/verify/unsubscribe#${d.links.unsubscribe}`,
    mutates: true,
    act: async (run) => {
      await run.page.locator('.view--unsubscribe').getByRole('button', { name: 'STOP', exact: true }).click();
      await run.page.locator('.view--unsubscribe .n-mail__stopped').waitFor({ timeout: 20_000 });
    },
    ready: '.view--unsubscribe .n-mail__stopped',
  },
  {
    id: 'reset-done',
    title: 'SET A NEW PASSWORD, saved: SIGN IN with the account’s email, and what the recovery did',
    refs: ['E3'],
    variant: 'email',
    path: at('/verify'),
    mutates: true,
    act: async (run) => {
      // A link of its own (ORBES Client Services' code for you, at NOW), so that each stage's run saves once.
      await run.page.goto(`${run.stage.origin}${await freshResetLink(run)}`);
      await run.page.locator('.view--reset form.form--reset').waitFor();
      await run.page.locator('#reset-password').fill('a new password for orbes');
      await run.page.locator('#reset-password-again').fill('a new password for orbes');
      await run.page.locator('.view--reset form.form--reset').getByRole('button', { name: 'SAVE', exact: true }).click();
      await run.page.locator('.view--reset .n-own__notice').waitFor({ timeout: 20_000 });
    },
    ready: '.view--reset form.form--signin',
  },
];

/**
 * Lot M1 (E3): MY PIECES signed out (on a computer, its SIGN IN opens the sign-in page), then FORGOTTEN PASSWORD?, RESET
 * BY EMAIL drawn; the scope the step stands in.
 */
async function forgottenByEmail(run: StateRun): Promise<string> {
  let scope = '.view--pieces';
  if (await onComputer(run)) {
    await run.page.locator('.view--pieces .d-signin-line').getByRole('link', { name: 'SIGN IN', exact: true }).click();
    scope = '.view--signin';
  }
  await run.page.locator(`${scope} form`).first().waitFor();
  await run.page.locator(scope).getByRole('button', { name: 'FORGOTTEN PASSWORD?', exact: true }).click();
  await run.page.locator(`${scope} form.form--reset-request`).waitFor({ timeout: 20_000 });
  return scope;
}

/** Lot M1 (E3): a link to choose a new password for you, its code issued at NOW by ORBES Client Services. */
async function freshResetLink(run: StateRun): Promise<string> {
  const { ctx } = run.stage;
  const you = run.demo.accounts.you!;
  const admin = await ctx.db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow();
  const issued = await ctx.services.recovery.issue(you.id, { type: 'admin', id: admin.id });
  return `/verify/reset#${encodeURIComponent(you.email)}/${issued.recoveryCode}`;
}

// ── A computer's window (desktop) ──────────────────────────────────────────

/**
 * The windows of a computer the desktop states open in: a mouse, no touch (openState's `size`), so the app draws its
 * computer layout (desktop, BRIEF decisions 5 and 6). Every screen family at 1440 × 900; ORBES CARE's (PRIVATE CARE's
 * every step, an order's DOCUMENTS), customer intelligence I2's (THE CLUB's tier) and Cinema in white also at
 * 1024 × 768 and 1920 × 1080.
 */
const DESK_WINDOWS = Object.freeze({
  1024: Object.freeze({ width: 1024, height: 768 }),
  1440: Object.freeze({ width: 1440, height: 900 }),
  1920: Object.freeze({ width: 1920, height: 1080 }),
});
type DeskWidth = keyof typeof DESK_WINDOWS;

/** The phone's state `id` (its account, address, routes, acts and ready). */
function phoneState(id: string): UiState {
  const s = PHONE_STATES.find((x) => x.id === id);
  if (!s) throw new Error(`no phone state ${id}`);
  return s;
}

/** A desktop state's id: `desk-`, `light-` in light, its name, then its window's width unless it is 1440 × 900. */
const deskId = (name: string, width: DeskWidth, light: boolean) => `desk-${light ? 'light-' : ''}${name}${width === 1440 ? '' : `-${width}`}`;
const deskTitle = (title: string, width: DeskWidth, light: boolean) => {
  const w = DESK_WINDOWS[width];
  return `${title} (a computer, ${w.width} × ${w.height}${light ? ', in light' : ''})`;
};

/**
 * The state `base` on a computer's window of `width` (in light with `light`): the same demo, account, address, routes and
 * acts, the window a mouse's (the phone's own acts take the computer's paths where a computer's differ: onComputer), its
 * capture the whole page. `name` is its id after `desk-` (the phone's id by default).
 */
function onDesk(base: UiState, width: DeskWidth, opts: { light?: boolean; name?: string; extra?: Partial<UiState> } = {}): UiState {
  const light = opts.light ?? false;
  return {
    ...base,
    id: deskId(opts.name ?? base.id, width, light),
    title: deskTitle(base.title, width, light),
    refs: ['desktop', ...(PHONE_STATES.includes(base) ? [`phone: ${base.id}`] : [])],
    size: DESK_WINDOWS[width],
    light: light || undefined,
    viewport: undefined,
    stress: undefined,
    ...opts.extra,
  };
}

/** 5b's right column, part by part, as the page draws it (desktop-room.ts SECURED_PARTS; the time PAY says is its own part). */
const FIVE_B_PARTS: Readonly<Record<SecuredPart, string | null>> = {
  'addons-title': '.live__addons-title',
  addons: '.live__addons',
  'addons-note': '.live__addons-note',
  error: '.live__error',
  pay: '.live__pay',
  'pay-left': null,
  'pay-note': '.live__pay-note',
  release: '.live__release',
};

/**
 * 5b on a computer (lot Q2, step Q2.8; D11, D17, D33, N10): PAY's foot, with the time to pay inside it, on the first
 * screen, the page not scrolled; its right column in the mockup's order (ADD-ONS, the rows, M3's note, the error line,
 * then PAY, its note, RELEASE MY PLACE), or with PAY first (is-pay-first) then the rows, M3's note and the error line,
 * each part shown below the one before it. `payFirst`: the order this window must take (undefined: either). `firstScreen`
 * false: a line shown after the screen opened (the engraving's words refused) may push PAY down; the order is decided as
 * the screen opens and never moves under the collector's hand.
 */
function fiveBColumn(payFirst?: boolean, firstScreen = true) {
  return async (page: Page): Promise<string[]> => {
    const at = await page.evaluate(
      ({ parts, rows, first }) => {
        const screen = document.querySelector('.d-room__screen--secured');
        const pay = screen?.querySelector(':scope > .d-room__br > .live__pay');
        if (!screen || !pay) return null;
        const isFirst = screen.classList.contains('is-pay-first');
        const shown = (isFirst ? first : rows).flatMap((p) => {
          const sel = parts[p];
          const el = sel ? screen.querySelector<HTMLElement>(`:scope > .d-room__br > ${sel}`) : null;
          if (!el || el.hidden || el.getClientRects().length === 0) return [];
          const r = el.getBoundingClientRect();
          return [{ part: p, top: Math.round(r.top), bottom: Math.round(r.bottom) }];
        });
        return { isFirst, shown, payBottom: Math.round(pay.getBoundingClientRect().bottom + scrollY), height: innerHeight };
      },
      { parts: FIVE_B_PARTS, rows: securedColumn(false), first: securedColumn(true) },
    );
    if (!at) return ['no PAY in the right column of SECURED'];
    const problems: string[] = [];
    if (firstScreen && at.payBottom > at.height) problems.push(`PAY ends at ${at.payBottom} px, below the first screen (${at.height} px)`);
    if (payFirst !== undefined && at.isFirst !== payFirst) problems.push(payFirst ? 'PAY does not come first' : 'PAY comes first, the rows fitting above it');
    for (let i = 1; i < at.shown.length; i++) {
      const [a, b] = [at.shown[i - 1]!, at.shown[i]!];
      if (b.top < a.bottom - 1) problems.push(`${b.part} (${b.top} px) is not below ${a.part} (${a.bottom} px)`);
    }
    if (!at.shown.some((p) => p.part === 'addons')) problems.push('no add-on rows shown');
    return problems;
  };
}

/**
 * 5b's rows on a computer (D34, D37): an unchosen row's ring at rest is the strong hairline (MK's desk frame, 0.34), no
 * ground on a row; YOUR TEXT focused, its hairline turns ink, its label too, and no ring frames the row.
 */
async function fiveBRows(page: Page): Promise<string[]> {
  const at = await page.evaluate(async () => {
    const rest = document.querySelector('.d-room__br .live__addon[aria-pressed="false"] .live__addon-mark');
    const item = document.querySelector('.d-room__br .live__addon-item');
    const input = document.querySelector<HTMLInputElement>('.d-room__br .ao-text__input');
    const ink = getComputedStyle(document.querySelector('.d-room__br .live__addon-label')!).color;
    const strong = getComputedStyle(document.querySelector('.d-room')!).getPropertyValue('--hairline-strong').trim();
    if (!rest || !item || !input) return null;
    const out = { ring: getComputedStyle(rest).borderTopColor, ground: getComputedStyle(item).backgroundColor, strong, ink, field: '', label: '', outline: '' };
    input.focus();
    await new Promise((r) => setTimeout(r, 400));
    const field = input.closest('.ao-text')!;
    out.field = getComputedStyle(field).borderBottomColor;
    out.label = getComputedStyle(field.querySelector('.ao-text__label')!).color;
    out.outline = getComputedStyle(input.closest('.live__addon-item')!).outlineStyle;
    input.blur();
    await new Promise((r) => setTimeout(r, 400));
    return out;
  });
  if (!at) return ['no unchosen row, no row or no YOUR TEXT'];
  return [
    ...(at.ring === 'rgba(246, 242, 234, 0.34)' ? [] : [`an unchosen row's ring rests at ${at.ring}, not the strong hairline (rgba(246, 242, 234, 0.34); the room's --hairline-strong ${at.strong})`]),
    ...(at.ground === 'rgba(0, 0, 0, 0)' ? [] : [`a row has the ground ${at.ground}`]),
    ...(at.field === at.ink ? [] : [`YOUR TEXT focused draws its hairline ${at.field}, not ink (${at.ink})`]),
    ...(at.label === at.ink ? [] : [`YOUR TEXT focused keeps its label ${at.label}`]),
    ...(at.outline === 'none' ? [] : [`YOUR TEXT focused, its row is framed (${at.outline})`]),
  ];
}

/** Each of `checks`, in order: every problem of each. */
/**
 * Open THE VAULT on the page (lot Q3, step Q3.10): its door held with the space bar until the hold is full (HOLD_MS 1 500), the
 * server's draw landing on the table's first row (€25 HOUSE CREDIT) or on GUARANTEED (`rare`: past the first row's
 * 100 000 parts of 1 000 000), the reveal under reduced motion (the reward at once) when `reduced`.
 */
async function openTheVault(run: StateRun, opts: { rare?: boolean; reduced?: boolean } = {}): Promise<void> {
  const service = run.stage.ctx.services.vault as unknown as { random: (max: number) => number };
  service.random = () => (opts.rare ? 100_000 : 0);
  if (opts.reduced) await run.page.emulateMedia({ reducedMotion: 'reduce' });
  const front = run.page.locator('.view--live .live__vault-slot .vo-dopen__front');
  await front.waitFor();
  await front.focus();
  await run.page.keyboard.down(' ');
  // Held until the hold is complete on the page's own clock (a page still loading runs it slower than the test's).
  await run.page.waitForFunction(() => (document.querySelector('.live__vault-slot .vlt') as HTMLElement | null)?.style.getPropertyValue('--p') === '1.0000', null, { timeout: 15_000 });
  await run.page.keyboard.up(' ');
  await run.page.locator(VAULT_OPEN).waitFor({ state: 'attached' });
}

/**
 * A release of one piece sold out whole while its page is open (lot Q3 §3.4): the page in the line, its piece's holder
 * pays (seedVault's `<key>Buyer`), Q3.5's hook gives the line its vaults, the release ends; the page follows the room to
 * its end page.
 */
async function sellOutWhole(run: StateRun, key: string): Promise<void> {
  const dropId = run.demo.releases[key]!;
  const buyer = run.demo.accounts[`${key}Buyer`]!;
  await run.page.locator('.view--live .live__queue').first().waitFor();
  await run.stage.ctx.services.live.confirm(buyer.id, dropId, buyer.actor);
}

/** A closed door (lot Q3 §3.3): its line and its hint shown, no OPEN ANOTHER, no number on it (D10). */
async function vaultClosed(page: Page): Promise<string[]> {
  const at = await page.evaluate(() => {
    const vlt = document.querySelector('.live__vault-slot .vlt');
    const shown = (sel: string) => {
      const e = vlt?.querySelector(sel);
      return !!e && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0.5 && e.getBoundingClientRect().height > 0;
    };
    return { lead: shown('.vlt__lead'), hint: shown('.vlt__hint'), again: shown('.vlt__again'), digits: /\d/.test(vlt?.querySelector('.vo-dopen')?.textContent ?? '') };
  });
  return [...(at.lead ? [] : ['the door\'s line is not shown']), ...(at.hint ? [] : ['its hint is not shown']), ...(at.again ? ['OPEN ANOTHER is shown on a closed door'] : []), ...(at.digits ? ['a number on the box'] : [])];
}

/**
 * An opened vault (lot Q3 §3.2, N3, N35): OPEN ANOTHER shown under the reward, wholly above `below` (LEAVE THE LINE on
 * S, THE RELEASES on the end page) and clear of it; the door's line and hint gone; the page dimmed to 16 % (`below` at
 * 0.16), OPEN ANOTHER at full strength.
 */
function vaultOpened(below: string) {
  return async (page: Page): Promise<string[]> => {
    const at = await page.evaluate((sel) => {
      const vlt = document.querySelector('.live__vault-slot .vlt');
      const again = vlt?.querySelector('.vlt__again');
      const next = document.querySelector(`.view--live ${sel}`);
      const o = (e: Element | null | undefined) => (e ? Number(getComputedStyle(e).opacity) : null);
      const gone = (e: Element | null | undefined) => !e || getComputedStyle(e).display === 'none' || Number(getComputedStyle(e).opacity) === 0;
      const box = (e: Element | null | undefined) => (e ? e.getBoundingClientRect() : null);
      // The page's dim is on the lines themselves or on what holds them (the screen's children, the room's places).
      let dim = 1;
      for (let e: Element | null = next; e && e !== document.body; e = e.parentElement) dim *= Number(getComputedStyle(e).opacity);
      const a = box(again);
      const n = box(next);
      return { again: !!again && !gone(again), againOpacity: o(again), lead: gone(vlt?.querySelector('.vlt__lead')), hint: gone(vlt?.querySelector('.vlt__hint')), dim, gap: a && n ? n.top - a.bottom : null, below: !!n };
    }, below);
    const out: string[] = [];
    if (!at.again) out.push('OPEN ANOTHER is not shown');
    if (at.againOpacity !== null && at.againOpacity < 0.99) out.push(`OPEN ANOTHER at opacity ${at.againOpacity}`);
    if (!at.lead) out.push('the door\'s line is still shown');
    if (!at.hint) out.push('the door\'s hint is still shown');
    if (!at.below) out.push(`no ${below} under the vault`);
    else if (Math.abs(at.dim - 0.16) > 0.01) out.push(`${below} at opacity ${at.dim.toFixed(2)}, not 0.16`);
    if (at.gap !== null && at.gap < 0) out.push(`OPEN ANOTHER overlaps ${below} by ${Math.round(-at.gap)} px`);
    return out;
  };
}

/** Light mode kept on the device, the page drawn dark all the same (the room, and the end page with THE VAULT). */
async function staysDark(page: Page): Promise<string[]> {
  const at = await page.evaluate(() => {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
    return { mode: document.documentElement.dataset.mode ?? null, luminance: (rgb[0]! + rgb[1]! + rgb[2]!) / 3, nocturne: document.body.classList.contains('nocturne') };
  });
  return [...(at.mode === 'light' ? [] : ['light mode is not kept on the device']), ...(at.luminance < 40 ? [] : [`the page's ground is light (${Math.round(at.luminance)})`])];
}

function allOf(...checks: ((page: Page) => Promise<string[]>)[]) {
  return async (page: Page): Promise<string[]> => {
    const out: string[] = [];
    for (const c of checks) out.push(...(await c(page)));
    return out;
  };
}

/**
 * A set's CONFIRMED on a computer (owner, 24 Oct, ANSWERS «Q1 BUILD QUESTIONS — DECIDED»: its title above its pieces'
 * photographs): the title block (CONFIRMED, LIVE RELEASE, the set's name) intersects none of the pieces' photographs
 * shown, and every one of them is below it.
 */
async function setConfirmedTitleClear(page: Page): Promise<string[]> {
  const at = await page.evaluate(() => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const parts = [...document.querySelectorAll('.d-room__head > :is(.live__title, .live__confirmed-of)')].map(box);
    const tiles = [...document.querySelectorAll('.d-room__band-img, .d-room > .d-room__photo--tiles > .d-room__img')]
      .filter((e) => getComputedStyle(e).visibility !== 'hidden' && (e as HTMLElement).offsetParent !== null && !e.closest('[hidden]'))
      .map(box);
    return { parts, tiles };
  });
  if (at.parts.length < 2) return ['no CONFIRMED title block in the head'];
  if (at.tiles.length < 2) return [`${at.tiles.length} of the set's photographs shown`];
  const title = {
    top: Math.min(...at.parts.map((p) => p.top)),
    bottom: Math.max(...at.parts.map((p) => p.bottom)),
    left: Math.min(...at.parts.map((p) => p.left)),
    right: Math.max(...at.parts.map((p) => p.right)),
  };
  return at.tiles.flatMap((t, i) => {
    const meets = t.left < title.right && t.right > title.left && t.top < title.bottom && t.bottom > title.top;
    return [
      ...(meets ? [`the title block (${Math.round(title.top)}–${Math.round(title.bottom)} px) lies on photograph ${i + 1} (${Math.round(t.top)}–${Math.round(t.bottom)} px)`] : []),
      ...(t.top < title.bottom ? [`photograph ${i + 1} starts at ${Math.round(t.top)} px, above the title block's foot (${Math.round(title.bottom)} px)`] : []),
    ];
  });
}

/** The phone's states `ids` on a computer's window of `width`. */
const desk = (width: DeskWidth, ...ids: string[]): UiState[] => ids.map((id) => onDesk(phoneState(id), width));
/** The phone's states `ids` on each window of `widths` (in light with `light`), in the order of `ids` then of the windows. */
const atWidths = (widths: readonly DeskWidth[], light: boolean, ids: readonly string[]): UiState[] => ids.flatMap((id) => widths.map((w) => onDesk(phoneState(id), w, { light })));
const SMALL_AND_MAIN: readonly DeskWidth[] = [1024, 1440];
const THREE: readonly DeskWidth[] = [1024, 1440, 1920];

/** A state's act, then `more` on the page it reached. */
const andThen = (s: UiState, more: (run: StateRun) => Promise<void>): Pick<UiState, 'act'> => ({
  act: async (run, hold) => {
    await s.act?.(run, hold);
    await more(run);
  },
});

/** A state made for a computer: its id, title and window (1440 × 900 unless said). */
function deskOwn(name: string, state: Omit<UiState, 'id' | 'refs' | 'size'>, width: DeskWidth = 1440): UiState {
  return { ...state, id: deskId(name, width, !!state.light), title: deskTitle(state.title, width, !!state.light), refs: ['desktop'], size: DESK_WINDOWS[width] };
}

/** The SCAN page (/verify/scan), UPLOAD A PHOTO given `photo`: the photo path, as on a phone. */
async function scanPageUpload(run: StateRun, photo: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await run.page.locator('.view--scanpage .d-scanpage__code svg').waitFor();
  await run.page.setInputFiles('#photo-input', photo);
}

/** MY PIECES' ORDERS (a computer's rows), then the order whose row reads `row`: its own page (/verify/orders/OR-…). */
async function openOrderPage(run: StateRun, row: RegExp): Promise<void> {
  await piecesTab(run, 'ORDERS');
  await run.page.locator('.view--pieces .d-orow', { hasText: row }).first().click();
  await run.page.locator('.view--order .d-order__head').waitFor({ timeout: 20_000 });
}

/**
 * ADD AN ADD-ON on you's reserved order (the add-ons' stage): on a phone, MY PIECES' ORDERS and its card's link (the
 * sheet); on a computer, the order's own page and its ADD-ONS part's link (the form in its place); read once open.
 */
async function openAddons(run: StateRun): Promise<void> {
  if (await onComputer(run)) {
    await openOrderPage(run, /RESERVED/);
    await run.page.locator('.view--order .pieces__addons-add').click();
  } else {
    await piecesTab(run, 'ORDERS');
    await run.page.locator('.view--pieces article.n-pieces__order[data-status="RESERVED"] .pieces__addons-add').first().click();
  }
  await run.page.locator(':is(.n-osheet, .d-oform) :is(form.form--order-addons, .n-osheet__none, .n-osheet__unreadable)').first().waitFor({ timeout: 20_000 });
}

/**
 * RETURN THE SET (lot M3, T3) on the first piece of you's delivered set: on a phone its card's button and its sheet; on a
 * computer that order's own page and its form; a reason given, the request sent, read once it is on the page.
 */
async function returnTheSet(run: StateRun): Promise<void> {
  if (await onComputer(run)) {
    await openOrderPage(run, /IN SEPTEMBER/);
    await run.page.locator('.view--order .pieces__return').click();
  } else {
    await piecesTab(run, 'ORDERS');
    await run.page.locator('.view--pieces .n-pieces__set .pieces__return').first().click();
  }
  await run.page.locator('#order-request-reason').selectOption('SIZE');
  await button(run, 'SEND THE REQUEST').click();
  await run.page.locator(':is(.view--pieces .n-pieces__set, .view--order) .n-pieces__request-label').first().waitFor({ timeout: 20_000 });
}

/**
 * addons-hold-stress's state write (lot Q2, step Q2.8; plan §3.4): the 'addons' release picks six rows, GIFT WRAPPING,
 * ENGRAVING, THE TRAVEL CASE, POLISHING CLOTH, THE TRAVEL CASE FOR TWO PIECES, LINED (its two-line line) and a service
 * of 40 characters (its LIVE switch only), made here. Written once per stage.
 */
async function longestPick(run: StateRun): Promise<void> {
  const { db, services } = run.stage.ctx;
  if (await db.selectFrom('addon_items').select('id').where('name', '=', LONGEST_ADDON).executeTakeFirst()) return;
  const admin = await demoAdmin(run);
  const made = await services.addons.create(
    { kind: 'SERVICE', name: LONGEST_ADDON, line: 'Its card written in your words.', skuCode: 'ADD-SECOND-BOX', prices: { EUR: 2_500 }, offeredAt: { live: true, draw: false, salon: false, orders: false } },
    admin,
  );
  const id = (name: string) => db.selectFrom('addon_items').select('id').where('name', '=', name).executeTakeFirstOrThrow().then((r) => r.id);
  const ids = [await id('GIFT WRAPPING'), await id('ENGRAVING'), await id('THE TRAVEL CASE'), await id('POLISHING CLOTH'), await id('THE TRAVEL CASE FOR TWO PIECES, LINED'), made.id];
  const live = run.demo.releases.live!;
  await db.deleteFrom('drop_addons').where('drop_id', '=', live).execute();
  await db.insertInto('drop_addons').values(ids.map((addon_id, i) => ({ drop_id: live, addon_id, position: i + 1 }))).execute();
}

/** No unit left of the add-on `name` at the default location (written once per stage): a correction down to 0. */
async function noneLeft(run: StateRun, name: string): Promise<void> {
  const { db, services } = run.stage.ctx;
  const sku = await db.selectFrom('addon_items as a').innerJoin('skus as k', 'k.addon_id', 'a.id').select('k.id').where('a.name', '=', name).executeTakeFirstOrThrow();
  const location = (await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
  const row = await db.selectFrom('stock_movements').select((eb) => eb.fn.sum<number>('delta').as('n')).where('sku_id', '=', sku.id).where('location_id', '=', location).executeTakeFirst();
  const held = await db.selectFrom('stock_holds').select((eb) => eb.fn.countAll<number>().as('n')).where('sku_id', '=', sku.id).where('location_id', '=', location).where('reservation', '=', 'STOCK').executeTakeFirst();
  const n = Number(row?.n ?? 0) - Number(held?.n ?? 0);
  if (n > 0) await services.stock.adjust({ skuId: sku.id, locationId: location, delta: -n, note: 'None left.' }, await demoAdmin(run));
}

/** The scan's answer with its warranty VOID (no demo piece has a void warranty and a code to read): NO LONGER VALID, WRITE. */
async function voidWarranty(page: Page): Promise<void> {
  await page.route('**/api/v1/verify', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { warranty?: Record<string, unknown> | null };
    if (body.warranty) body.warranty = { ...body.warranty, status: 'VOID' };
    await route.fulfill({ response, json: body });
  });
}

/** A drawn release's list of entries as the server pages it, `total` long, ranked (THE ENTRIES at its longest). */
async function longEntries(page: Page, total: number): Promise<void> {
  await page.route('**/api/v1/drops/*/entries?*', async (route) => {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get('pageSize')) || 100;
    const at = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const items = [];
    for (let rank = (at - 1) * size + 1; rank <= Math.min(total, at * size); rank++) {
      items.push({ id: `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`, tier: 1 + (rank % 3), seniority: 1 + (rank % 7), rank, size: null });
    }
    await route.fulfill({ json: { items, page: at, pageSize: size, total } });
  });
}

/** ORBES CARE's stage (orbes-care) at the three windows: each warranty, each moment of a claim, LIFETIME, a warranty credit. */
const CARE_STAGE = [
  'pieces-orbes-care',
  'pieces-orbes-care-two-years',
  'pieces-orbes-care-below',
  'pieces-claim-label',
  'pieces-claim-replaced',
  'pieces-claim-part-credit',
  'pieces-claim-refused',
  'pieces-claim-repaired',
  'certificate-lifetime',
  'tier-warranty-credit',
] as const;
/** The full demo's ORBES CARE and I2 at the three windows: PRIVATE CARE's form and label, SERVICE, a result's ORBES CARE, IN USE. */
const CARE_FULL = ['piece-care-request', 'piece-care-label', 'pieces-service', 'result-first-registration-care', 'account-sheet-in-use'] as const;
/** A result's ORBES CARE with its warranty no longer valid (no demo piece has one and a code to read): WRITE in WARRANTY. */
const voidWarrantyAt = (w: DeskWidth): UiState =>
  onDesk(phoneState('result-registered-signed-out'), w, {
    name: 'result-void-warranty',
    extra: {
      title: 'A piece read signed out, its warranty no longer valid: ORBES CARE, NO LONGER VALID, WRITE TO ORBES CLIENT SERVICES',
      routes: voidWarranty,
      ...andThen(phoneState('result-registered-signed-out'), (run) => tab(run, 'ORBES CARE').click()),
    },
  });

/** The paid order IN BLUE's own page, packing begun (orders-delivery's writes): DELIVERY ADDRESS, ENGRAVING, DOCUMENTS with ORBES CARE CONDITIONS · PDF. */
const orderDeliveryAt = (w: DeskWidth): UiState =>
  onDesk(phoneState('orders-delivery'), w, { name: 'order-delivery', extra: { ...andThen(phoneState('orders-delivery'), (run) => openOrderPage(run, /IN BLUE/)), ready: '.view--order .pieces__engraving-locked' } });
/** A piece of you's delivered set on its own page (lot M3, T1 to T3): THE SET's part, RETURN THE SET. */
const setOrderAt = (w: DeskWidth, light: boolean): UiState =>
  onDesk(phoneState('set-orders'), w, { name: 'set-order', light, extra: { ...andThen(phoneState('set-orders'), (run) => openOrderPage(run, /IN SEPTEMBER/)), ready: '.view--order .d-order__row--set .d-oset__pieces' } });
/** The add-ons' stage's reserved order on its own page (lot M3, D2): REMOVE and ADD AN ADD-ON in its ADD-ONS part. */
const addonsOrderAt = (light: boolean): UiState =>
  onDesk(phoneState('addons-orders'), 1440, { name: 'addons-order', light, extra: { ...andThen(phoneState('addons-orders'), (run) => openOrderPage(run, /RESERVED/)), ready: '.view--order .pieces__addons-add' } });
/** PRIVATE CARE's steps in the full demo (ORBES CARE, plan §2(d) item 2), beside CARE_FULL. */
const PRIVATE_CARE = ['piece-care-available', 'piece-care-requested', 'piece-care-returning', 'piece-care-done'] as const;

/**
 * The desktop shards in dark, and Cinema in white (desk-8); the light twins of HANDOVER §5.8 follow in desk-9, the other
 * screens in desk-10 … desk-12 (DESK_GROUPS).
 */
const DESK_SHARDS: Record<string, readonly UiState[]> = {
  'desk-1': [
    // ── NOW, THE SCAN, a result, the scan's problems, sign in ──
    ...desk(1440, 'now-signed-in', 'now-signed-out'),
    deskOwn('scan-page', { title: 'The SCAN page: SCAN AN ORBES CODE, WITH YOUR PHONE (its QR code), FROM THIS COMPUTER, UPLOAD A PHOTO', variant: 'full', path: at('/verify/scan'), ready: '.view--scanpage .d-scanpage__code svg' }),
    deskOwn('scan-upload', {
      title: 'The SCAN page, UPLOAD A PHOTO of a code: AUTHENTIC — FIRST REGISTRATION',
      variant: 'full',
      path: at('/verify/scan'),
      act: async (run) => {
        const code = run.demo.codes.first;
        if (!code) throw new Error('no demo code first');
        await scanPageUpload(run, { name: 'orbes-code.png', mimeType: 'image/png', buffer: codePhoto(code) });
        await run.page.locator('.view--result .n-result__title').waitFor({ timeout: 30_000 });
        await settle(run.page);
      },
      ready: '.view--result',
    }),
    deskOwn('scan-photo-unreadable', {
      title: 'The SCAN page, UPLOAD A PHOTO without a code: NO ORBES CODE FOUND',
      variant: 'full',
      path: at('/verify/scan'),
      act: (run) => scanPageUpload(run, { name: 'blank.png', mimeType: 'image/png', buffer: blankPng() }),
      ready: '.view--message',
    }),
    ...desk(1440, 'result-ownership-verified', 'result-registered-signed-out', 'result-unusual-card', 'result-invalid'),
    // The service failing (HANDOVER §5.8): CONNECTION INTERRUPTED, A MOMENT, PLEASE, VERIFICATION UNAVAILABLE; the scan's window closing.
    ...desk(1440, 'problem-network', 'problem-rate-limited', 'problem-server', 'result-registration-closed'),
    deskOwn('sign-in', { title: 'The sign-in page over a photograph: SIGN IN, CREATE ACCOUNT', variant: 'full', path: at('/verify/sign-in'), ready: '.view--signin form' }),
    ...desk(1440, 'sign-up', 'pieces-sign-in-refused', 'result-forgotten-password'),
    // The one waiting screen's other states on a computer (lot Q1, step Q1.8; MK #queue desk, #after-wait desk), on the
    // queue's stage (desk-10 holds its limit of states).
    ...desk(1440, 'live-queue-hold', 'live-queue-release-paused', 'live-queue-close', 'live-queue-one', 'live-queue-late', 'live-queue-held', 'live-after-wait'),
    // The re-recorded ones that had none: LEAVE THE LINE refused, the longest place, READING YOUR PLACE (its write, last).
    ...desk(1440, 'live-queue-error', 'live-queue-stress', 'live-queue-loading'),
  ],
  'desk-2': [
    // ── PIECES, an order's page, a piece, the certificate ──
    ...desk(1440, 'pieces', 'pieces-orders'),
    deskOwn('order', {
      title: 'An order’s page: the LIVE RELEASE’s order RESERVED, its steps, its terms, DELIVERY ADDRESS, ENGRAVING, DOCUMENTS',
      variant: 'full',
      as: you,
      path: at('/verify/pieces'),
      act: (run) => openOrderPage(run, /RESERVED/),
      ready: '.view--order .d-order__head',
    }),
    ...desk(1440, 'pieces-releases', 'piece', 'pieces-failed', 'piece-care-available', 'piece-care-requested', 'piece-care-returning', 'piece-care-done', 'certificate'),
    deskOwn('certificate-ended', {
      title: 'The shared certificate NO LONGER VALID (its record changed since)',
      variant: 'full',
      path: (d) => `/verify/c#${d.links.certificate}`,
      // The server's own answer for a certificate no longer valid (services/ownership-certificates.ts: CertificateLookup).
      routes: (page) => page.route('**/api/v1/certificates/lookup', (route) => route.fulfill({ json: { status: 'NO_LONGER_VALID', checkedAt: NOCTURNE_NOW.toISOString() } })),
      ready: '.view--certificate[data-state="ended"]',
    }),
    deskOwn('certificate-not-found', {
      title: 'The shared certificate NOT FOUND (a link withdrawn or incomplete)',
      variant: 'full',
      path: at('/verify/c#not-a-certificate-link'),
      ready: '.view--certificate[data-state="unknown"]',
    }),

    // ── THE COLLECTION, a model, THE PRIVATE SALON, YOUR WISHLIST, THE CLUB, the account's pages ──
    ...desk(1440, 'collection', 'model', 'model-salon'),
    deskOwn('collection-salon-locked', {
      title: 'THE COLLECTION of a TITANE owner, THE PRIVATE SALON locked: it opens at PLATINE, from 5 pieces',
      variant: 'full',
      as: you,
      path: at('/verify/lookbook'),
      // An owner below the salon's tier: no model of its tier, the lowest tier above it (as services/salon.ts answers).
      routes: (page) => page.route('**/api/v1/club/lookbook', (route) => route.fulfill({ json: { models: [], opensAt: { level: 2, name: 'PLATINE', pieces: 5 } } })),
      ready: '.view--lookbook[data-state="ready"] .n-lookbook__teaser-text',
    }),
    deskOwn('wishlist-signed-out', { title: 'YOUR WISHLIST’s page, signed out', variant: 'full', path: at('/verify/account/wishlist'), ready: '.view--wishlist:not([data-state="loading"])' }),
    deskOwn('wishlist-failed', {
      title: 'YOUR WISHLIST’s page that could not be read: TRY AGAIN',
      variant: 'full',
      as: you,
      path: at('/verify/account/wishlist'),
      routes: (page) => page.route('**/api/v1/account/wishlist', (route) => (route.request().method() === 'GET' ? route.abort('failed') : route.continue())),
      ready: '.view--wishlist[data-state="failed"]',
    }),
    ...desk(1440, 'club-platine', 'account-sheet-password'),
    // YOUR SIZES' page: it writes nothing (sizes-view runs with the writes of YOUR SIZES only for the phone's shard).
    onDesk(phoneState('sizes-view'), 1440, { name: 'account-sizes', extra: { mutates: undefined } }),
  ],
  'desk-3': [
    // ── THE RELEASES, a draw, a LIVE RELEASE, THE CIRCLE, the legal pages ──
    ...desk(1440, 'releases', 'releases-past', 'draw', 'draw-drawn'),
    deskOwn('draw-entries-long', {
      title: 'A draw drawn, THE ENTRIES at 600: SHOW MORE until the last, the list at its end, its head held under the bar',
      variant: 'full',
      as: you,
      path: release('draw:MONOLITHE IN GOLD'),
      routes: (page) => longEntries(page, 600),
      act: async (run) => {
        const items = run.page.locator('.view--release .release__list > *');
        await items.first().waitFor({ timeout: 20_000 });
        for (let n = await items.count(); n < 600; n = await items.count()) {
          await run.page.locator('.view--release .release__more').first().click();
          await run.page.waitForFunction((was) => document.querySelectorAll('.view--release .release__list > *').length > was, n, { timeout: 20_000 });
        }
        // The last entry at the window's foot: the rows drawn (content-visibility) are then those of its end, whatever is above the list.
        await items.last().evaluate((el) => el.scrollIntoView({ block: 'end' }));
      },
      ready: '.view--release .release__list',
    }),
    ...desk(1440, 'live-announced', 'live-past-secured', 'circle', 'post-invitation', 'post-poll'),
    ...desk(1440, 'legal-terms', 'legal-terms-fr', 'legal-privacy', 'legal-faq', 'legal-index'),
    // An answer of ORBES Client Services (HANDOVER §5.8), on NOW: it writes, after the full demo's other desktop states.
    ...desk(1440, 'now-messages'),
    // THE SET (lot M3, K44 T1) on its stage: THE RELEASES (also in light), NOW, PAST; the October draw's pickers (also in
    // light and at 1024 × 768), every size chosen, an entry; the first draw's place held and its waiting list.
    ...desk(1440, 'set-releases'),
    onDesk(phoneState('set-releases'), 1440, { light: true }),
    ...desk(1440, 'set-now', 'set-past', 'set-draw'),
    onDesk(phoneState('set-draw'), 1440, { light: true }),
    ...desk(1024, 'set-draw'),
    ...desk(1440, 'set-draw-chosen', 'set-draw-entered', 'set-draw-held', 'set-draw-waiting'),
  ],
  'desk-4': [
    // ── The other stages at 1440 × 900 ──
    // YOUR ACCOUNT and MESSAGES' page (the draw-leads stage): empty, writing from a piece, an answer (HANDOVER §5.8).
    ...desk(1440, 'now-draw-leads', 'account-sheet', 'account-messages-empty', 'account-write', 'account-messages-thread'),
    ...desk(1440, 'now-collection-leads', 'now-empty', 'room', 'live-turn', 'live-hold', 'live-turn-returned', 'after-room-door', 'model-pairs', 'draw-place-held', 'piece-care-used', 'wishlist'),
    // The console's writes on an order (HANDOVER §5.8), each on its order's page: YOUR NEW CLAIM CODE waiting, packing begun, a return asked.
    onDesk(phoneState('claim-waiting'), 1440, { name: 'order-claim-waiting', extra: { ...andThen(phoneState('claim-waiting'), (run) => openOrderPage(run, /IN BLUE/)), ready: '.view--order .pieces__claim' } }),
    orderDeliveryAt(1440),
    onDesk(phoneState('orders-case'), 1440, { name: 'order-case', extra: { ...andThen(phoneState('orders-case'), (run) => openOrderPage(run, /IN BLUE/)), ready: '.view--order .pieces__return-address' } }),
    ...desk(1440, 'account-addresses'),
    // A model's gallery (the stage gallery, D11): its grid of tiles; the viewer opened on the first, 1 / 2.
    deskOwn('model-gallery', { title: 'A model’s page with its gallery: MONOLITHE in steel, its photographs in gold and in blue as tiles', variant: 'gallery', as: you, path: sheet('steel'), ready: '.view--sheet .n-model__gallery.d-gallery .d-gallery__open' }),
    deskOwn('model-gallery-viewer', {
      title: 'A model’s gallery, its first photograph enlarged: PREVIOUS, NEXT, CLOSE, 1 / 2',
      variant: 'gallery',
      as: you,
      path: sheet('steel'),
      act: async (run) => {
        await run.page.locator('.view--sheet .d-gallery__open').first().click();
        await run.page.locator('.d-viewer .d-viewer__photo').waitFor();
      },
      ready: '.d-viewer .d-viewer__position',
    }),
  ],
  // ── ORBES CARE and I2 at 1024 × 768, 1440 × 900 and 1920 × 1080 ──
  // ORBES CARE's stage at 1024 and 1440; PRIVATE CARE used (its stage) and an order's DOCUMENTS with ORBES CARE
  // CONDITIONS · PDF (orders-delivery's stage, written once) at 1024 and 1920, their 1440 in desk-2 and desk-4.
  'desk-5': [...atWidths(SMALL_AND_MAIN, false, CARE_STAGE), ...atWidths([1024, 1920], false, ['piece-care-used']), orderDeliveryAt(1024), orderDeliveryAt(1920)],
  // The full demo's ORBES CARE and I2 at 1024 and 1440; the birthday credit's stage (its one write) at the three;
  // PRIVATE CARE's steps and THE CLUB of a PLATINE account at 1024 and 1920 (their 1440 in desk-2).
  'desk-6': [
    ...atWidths(SMALL_AND_MAIN, false, CARE_FULL),
    ...SMALL_AND_MAIN.map(voidWarrantyAt),
    ...atWidths(THREE, false, ['birthday-credit']),
    ...atWidths([1024, 1920], false, [...PRIVATE_CARE, 'club-platine']),
  ],
  // Both at 1920; YOUR PROFILE's stage (its writes, in order) at the three: entered, its tastes, then two retired.
  'desk-7': [
    ...atWidths([1920], false, CARE_STAGE),
    ...atWidths([1920], false, CARE_FULL),
    voidWarrantyAt(1920),
    ...atWidths(THREE, false, ['account-profile', 'profile-tastes']),
    onDesk(phoneState('profile-tastes'), 1440, {
      name: 'profile-retired-tastes',
      extra: {
        title: 'YOUR PROFILE: YOUR TASTES with three finishes the collection no longer shows (Black, Rose gold, Silver), the last two side by side: NO LONGER IN THE COLLECTION',
        act: async (run, hold) => {
          // Two more finishes chosen when the collection showed them, which it no longer does (written once). The retired
          // follow the collection's three in their keys' order (services/tastes.ts), so BLACK sits alone at the end of the
          // second row and ROSE GOLD and SILVER share the third: one note under its finish, two side by side.
          const you = run.demo.accounts.you!;
          const { db } = run.stage.ctx;
          await yourProfile(run, true);
          for (const [key, label] of [['BLACK', 'Black'], ['ROSE GOLD', 'Rose gold']] as const) {
            if (!(await db.selectFrom('account_tastes').select('value_key').where('account_id', '=', you.id).where('value_key', '=', key).executeTakeFirst())) {
              await db.insertInto('account_tastes').values({ account_id: you.id, kind: 'FINISH', value_key: key, label }).execute();
            }
          }
          await phoneState('profile-tastes').act?.(run, hold);
        },
      },
    }),
  ],
  // ── Cinema in white (light mode) at the three windows ──
  'desk-8': atWidths(THREE, true, ['now-signed-in', 'releases', 'collection', 'model', 'draw', 'live-announced', 'pieces-orbes-care', 'account-sheet-in-use']),
};

/** The states the review preview could not show (HANDOVER §5.8; plan §2(j): both modes), by their desk names at 1440 × 900. */
const UNSHOWN_IN_PREVIEW = [
  'problem-network',
  'problem-rate-limited',
  'problem-server',
  'result-registration-closed',
  'order-claim-waiting',
  'order-delivery',
  'order-case',
  'account-messages-thread',
  'now-messages',
  'collection-salon-locked',
  'wishlist-signed-out',
  'wishlist-failed',
  'certificate-ended',
  'certificate-not-found',
  'draw-entries-long',
  'profile-retired-tastes',
] as const;

/** The dark desk state `desk-<name>` at 1440 × 900, in light: the same demo, routes and acts, LIGHT MODE stored. */
function inLight(name: string): UiState {
  const s = Object.values(DESK_SHARDS)
    .flat()
    .find((x) => x.id === deskId(name, 1440, false));
  if (!s || s.light || s.size !== DESK_WINDOWS[1440]) throw new Error(`no dark desk state ${name} at 1440 × 900`);
  // Its title says its window (deskTitle), unless the state's own title replaced it (onDesk's extra).
  const at1440 = deskTitle('', 1440, false);
  const title = s.title.endsWith(at1440) ? s.title.slice(0, -at1440.length) : s.title;
  return { ...s, id: deskId(name, 1440, true), title: deskTitle(title, 1440, true), light: true };
}

/**
 * The desktop states (plan DESKTOP, step 12), by the content test's shard each runs in (nocturne.content.harness.ts:
 * desk-1 … desk-12; about twenty states each, at most 28, the states of a stage that write in one shard, in order): every
 * screen family on a computer at 1440 × 900, the pages the computer adds (the SCAN page, sign in, an order's page, the
 * account's pages, MESSAGES), the states the review preview could not show (HANDOVER §5.8: the service failing, the
 * scan's window closing, the console's writes, the salon locked, the wishlist signed out and failed, a certificate no
 * longer valid or not found, 600 entries, two retired tastes side by side) in both modes, a model's gallery (the stage
 * gallery, D11); the room's and the after-room's other screens, a result's other answers, a piece's incidents, the draw's
 * other states, the failures and the extreme content (desk-10 … desk-12); ORBES CARE (every PRIVATE CARE step, an
 * order's DOCUMENTS), I2 (THE CLUB's tier) and Cinema in white also at 1024 × 768 and 1920 × 1080. Their text is the baseline's own (its desk-* entries).
 */
export const DESK_GROUPS: Readonly<Record<string, readonly UiState[]>> = Object.freeze({
  ...DESK_SHARDS,
  // ── HANDOVER §5.8's states in light at 1440 × 900 (each stage fresh: its writes once, in order) ──
  'desk-9': [
    ...UNSHOWN_IN_PREVIEW.map(inLight),
    // THE SET (lot M3, K44 T1 to T3) on its stage: YOUR ORDERS' rows under the set's head row; a set's piece on its own
    // page (THE SET's part; also in light and at 1024 × 768); RETURN THE SET asked there, last.
    ...desk(1440, 'set-orders'),
    setOrderAt(1440, false),
    setOrderAt(1440, true),
    setOrderAt(1024, false),
    ...desk(1440, 'set-orders-return'),
    // Its LIVE RELEASE announced (lot M3, K44 T1, T4): I'LL BE THERE with a picker per piece, in dark and light; then said, last.
    ...desk(1440, 'set-live-there'),
    onDesk(phoneState('set-live-there'), 1440, { light: true }),
    ...desk(1440, 'set-live-there-said'),
  ],
  // ── The room's other screens at 1440 × 900, each staged for a computer (HANDOVER §5.4) ──
  // The line, secured with PAY, CONFIRMED, sold out in a size, the five ends, ENTER THE LINE; a LIVE RELEASE's rules and
  // not eligible; the room not eligible, then entered (its write, last of its stage); the after-room's join and its ends;
  // the queue (lot M1).
  'desk-10': [
    ...desk(1440, 'live-secured', 'live-confirmed', 'live-sold-out-size', 'live-missed', 'live-expired', 'live-released', 'live-left', 'live-removed', 'live-join'),
    // ONE QUEUE (lot Q1, step Q1.9; plan §3.11): the room's other variants in its look (the horizon door, READY CHECK on
    // hairlines), each with its own lines, before the write.
    ...desk(1440, 'live-rules', 'live-rules-not-eligible', 'room-sign-in', 'room-guaranteed', 'room-guarantee-hidden', 'room-checks-pending', 'room-not-eligible', 'room-ready'),
    ...desk(1440, 'after-room-join', 'after-room-sold-out', 'after-room-closed', 'after-room-ended', 'after-room-over'),
    // The queue of a paced release (lot M1, W2, W5): the place and its estimate, then paused.
    ...desk(1440, 'live-queue', 'live-queue-paused'),
    // ONE QUEUE's Horizon band (lot Q1, step Q1.7): a small release, its LAST PIECES; then the queue whose photograph
    // cannot be loaded (the same media refusal as on the phone).
    ...desk(1440, 'live-queue-small', 'live-queue-last', 'live-queue-nophoto'),
    // The draw at the opening (lot Q1, step Q1.9; MK #room-draw, desk).
    ...desk(1440, 'live-draw'),
  ],
  // ── A result's other answers, a piece's incidents, THE PRIVATE SALON in sizes, the draw's other states, the failures ──
  // The full demo's writes (a transfer code, the ceremony, a piece received, REQUESTED, a draw entered) last, in this order;
  // MY PIECES' ORDERS also at 1024 × 768 (plan §2(d) item 6: the row's wrap).
  'desk-11': [
    ...desk(1440, 'result-unknown', 'result-revoked', 'result-unreadable'),
    ...desk(1440, 'piece-stolen', 'piece-transfer', 'piece-in-service', 'model-salon-sizes'),
    ...desk(1440, 'draw-soon', 'draw-early', 'draw-sizes', 'pieces-draws', 'draw-open-calendar'),
    // Plan MACRO M1 §3.3 (F4; lot M1, step M1.13): a draw FOR SELECTED COLLECTORS, for one of them and for another.
    ...desk(1440, 'draw-selected', 'draw-selected-not-eligible'),
    ...desk(1440, 'circle-failed', 'post-failed', 'post-not-found', 'model-not-found', 'draw-not-found'),
    ...desk(1024, 'pieces-orders'),
    ...desk(1440, 'result-transfer-code', 'result-ceremony', 'result-received', 'model-salon-requested', 'draw-entered'),
  ],
  // ── The extreme content at 1440 × 900: the stress demo's 16 states (its ceremony, which writes, last), the empty demo's ──
  'desk-12': [
    ...desk(1440, 'now-stress', 'result-stress', 'club-stress', 'pieces-stress', 'pieces-orders-stress', 'piece-stress', 'account-sheet-stress', 'collection-stress', 'model-stress'),
    ...desk(1440, 'releases-stress', 'room-stress', 'live-far-stress', 'circle-stress', 'post-stress', 'post-poll-stress', 'result-ceremony-stress'),
    ...desk(1440, 'pieces-empty', 'collection-empty', 'releases-empty', 'circle-empty'),
    // THE SET's LIVE RELEASE in the Cinema room (lot M3, K44 T1, T4; the stage set-live): every screen of its room.
    ...desk(1440, 'set-room', 'set-room-ready', 'set-live-join', 'set-live-line', 'set-live-turn', 'set-live-secured'),
    // Its CONFIRMED: the title above the pieces' photographs (owner, 24 Oct), held by a geometry.
    onDesk(phoneState('set-live-confirmed'), 1440, { extra: { check: setConfirmedTitleClear } }),
    ...desk(1440, 'set-live-sold-out'),
  ],
  // ── The emails' screens (lot M1, step M1.19, E1–E3) on the stage `email`: each at 1440 × 900, RESET BY EMAIL, the
  // link's page, YOUR PROFILE's release notices and STOP THESE EMAILS also in light, the link's form and STOP THESE EMAILS
  // at 1024 × 768; their writes last (stopped, then the new password, which ends you's sessions) ──
  'desk-13': [
    ...desk(1440, 'signin-reset-email', 'signin-reset-sent', 'reset-new-password', 'reset-incomplete', 'reset-expired', 'profile-release-notices', 'unsubscribe', 'unsubscribe-founding', 'unsubscribe-invalid'),
    ...atWidths([1440], true, ['signin-reset-email', 'reset-new-password', 'profile-release-notices', 'unsubscribe']),
    ...desk(1024, 'reset-new-password', 'unsubscribe'),
    ...desk(1440, 'unsubscribe-done'),
    onDesk(phoneState('unsubscribe-done'), 1440, { light: true }),
    ...desk(1440, 'reset-done'),
    onDesk(phoneState('reset-done'), 1440, { light: true }),
    // FROM ORBES (lot M2, M3 and M4) on the stage `house`: NOW's line, the subject at its longest, then the writes in their
    // order (an answer too: FROM ORBES NEW in the list; FROM ORBES opened), the subject also in light and at 1024 × 768.
    ...desk(1440, 'now-messages-house'),
    onDesk(phoneState('account-messages-house-stress'), 1440, { name: 'messages-house-stress' }),
    onDesk(phoneState('account-messages-house-unread'), 1440, { name: 'messages-house-unread' }),
    onDesk(phoneState('account-messages-house'), 1440, { name: 'messages-house' }),
    onDesk(phoneState('account-messages-house'), 1440, { name: 'messages-house', light: true }),
    onDesk(phoneState('account-messages-house'), 1024, { name: 'messages-house' }),
  ],
  // ── WORN (lot M2, D31) on the stage `worn`: a piece's block with no photograph, a photograph chosen (the drop zone's
  // preview), in review and published at 1440 × 900; no photograph and published also in light; chosen at 1024 × 768;
  // and the sheet's WORN (step M2.11); then the catalogue add-ons, and last a set's CONFIRMED at 1024 × 768 (lot Q1) ──
  'desk-14': [
    ...desk(1440, 'piece-worn', 'piece-worn-chosen', 'piece-worn-review', 'piece-worn-published'),
    onDesk(phoneState('piece-worn'), 1440, { light: true }),
    onDesk(phoneState('piece-worn-published'), 1440, { light: true }),
    ...desk(1024, 'piece-worn-chosen'),
    // WORN at the foot of a sheet (step M2.11): four columns, the first 8 and SHOW MORE, in dark and in light; a
    // photograph enlarged in the sheet's viewer with its credit; the one photograph of a RESERVED sheet; at 1024 × 768.
    ...desk(1440, 'sheet-worn', 'sheet-worn-enlarged', 'sheet-worn-one'),
    onDesk(phoneState('sheet-worn'), 1440, { light: true }),
    onDesk(phoneState('sheet-worn-enlarged'), 1440, { light: true }),
    ...desk(1024, 'sheet-worn'),
    // The catalogue add-ons (lot M3, D2) on their stage: the hold in the room, a draw's PLACE HELD (also in light), the
    // salon request; each order's own page (the reserved one also in light, the paid one with its own invoice, packing
    // begun); ADD AN ADD-ON's part of the page chosen (also in light), none available, could not be read; PAY, last.
    // 5b (lot Q2, step Q2.8; N10): at 1440 × 900 the rows above PAY, as the mockup; at 1024 × 768 PAY, its time inside
    // it, on the first screen (production M3 showed the time there), first when the rows would push it below.
    onDesk(phoneState('addons-hold'), 1440, { extra: { check: allOf(fiveBColumn(false), fiveBRows) } }),
    ...desk(1440, 'addons-place-held', 'addons-salon'),
    onDesk(phoneState('addons-hold'), 1024, { extra: { check: fiveBColumn() } }),
    onDesk(phoneState('addons-place-held'), 1440, { light: true }),
    addonsOrderAt(false),
    addonsOrderAt(true),
    onDesk(phoneState('addons-orders'), 1440, { name: 'addons-order-paid', extra: { ...andThen(phoneState('addons-orders'), (run) => openOrderPage(run, /IN BLUE/)), ready: '.view--order .pieces__addon-remove' } }),
    onDesk(phoneState('addons-orders'), 1440, { name: 'addons-order-packing', extra: { ...andThen(phoneState('addons-orders'), (run) => openOrderPage(run, /IN GOLD/)), ready: '.view--order .pieces__addons-locked' } }),
    ...desk(1440, 'addons-sheet', 'addons-sheet-none', 'addons-sheet-error'),
    onDesk(phoneState('addons-sheet'), 1440, { light: true }),
    ...desk(1440, 'addons-pay'),
    // A set's CONFIRMED at 1024 × 768, last (its own stage, set-live, read only): the title above the pieces' photographs
    // (owner, 24 Oct).
    onDesk(phoneState('set-live-confirmed'), 1024, { extra: { check: setConfirmedTitleClear } }),
  ],
  // ── 5b, SECURED with add-ons (lot Q2, step Q2.8) on its own stage (addons): the engraving's words refused (the error
  // line right under the rows), in light mode (the room dark, its rings and YOUR TEXT as in the dark), then its longest
  // pick (its write), at 1440 × 900 and 1024 × 768 ──
  'desk-15': [
    onDesk(phoneState('addons-hold-text-error'), 1440, { extra: { check: fiveBColumn(undefined, false) } }),
    onDesk(phoneState('addons-hold-text-error'), 1024, { extra: { check: fiveBColumn(undefined, false) } }),
    onDesk(phoneState('addons-hold-light'), 1440, { light: true, name: 'addons-hold', extra: { check: allOf(fiveBColumn(false), fiveBRows) } }),
    onDesk(phoneState('addons-hold-stress'), 1440, { extra: { check: fiveBColumn() } }),
    onDesk(phoneState('addons-hold-stress'), 1024, { extra: { check: fiveBColumn() } }),
  ],
  // ── THE VAULT (lot Q3, step Q3.10; MK #sold, #release-end, desk) on its stage (vault): the door in the centre column of
  // SOLD OUT for your size (also at 1024 × 768, and in light: the room dark), on the end page of a release sold out whole
  // (also in light); then opened, each its own collector's vault (they write, last): S with its reward and OPEN ANOTHER
  // above LEAVE THE LINE, a rare one, the end page's OPEN ANOTHER clear of THE RELEASES ──
  'desk-16': [
    ...desk(1440, 'live-sold-out-size-vault'),
    ...desk(1024, 'live-sold-out-size-vault'),
    onDesk(phoneState('live-sold-out-size-vault-light'), 1440, { light: true, name: 'live-sold-out-size-vault' }),
    onDesk(phoneState('live-end-vault'), 1440, { extra: { as: 'vaultEndDesk', path: release('vaultEndDesk'), act: (run) => sellOutWhole(run, 'vaultEndDesk') } }),
    onDesk(phoneState('live-end-vault-light'), 1440, { light: true, name: 'live-end-vault', extra: { as: 'vaultEndDeskLight', path: release('vaultEndDeskLight'), act: (run) => sellOutWhole(run, 'vaultEndDeskLight') } }),
    onDesk(phoneState('vault-open'), 1440, { extra: { as: 'vaultSOpenDesk' } }),
    onDesk(phoneState('vault-open-rare'), 1440, { extra: { as: 'vaultSRareDesk' } }),
    onDesk(phoneState('live-end-vault-open'), 1440, { extra: { as: 'vaultEndOpenDesk', path: release('vaultEndOpenDesk'), act: async (run) => (await sellOutWhole(run, 'vaultEndOpenDesk'), openTheVault(run, { reduced: true })) } }),
  ],
});

/** The desktop states, shard by shard. */
export const DESK_STATES: readonly UiState[] = Object.values(DESK_GROUPS).flat();

/** Every state the content test reaches: the phone's, then the computer's (desk-*). */
export const UI_STATES: readonly UiState[] = [...PHONE_STATES, ...DESK_STATES];

/**
 * Plan NEXT-NINE, AC-01: the room of a collector who saved a bracelet of 17 cm (the room demo's `sized`): 17 preselected,
 * READY CHECK SIZE 17 · TO CONFIRM; then 17 tapped, the size ready. Outside UI_STATES (the room's shard holds its limit
 * of states): test/web/nocturne.content-room.e2e.test.ts reaches them with their own checks (shownSuite).
 */
export const ROOM_SIZE_STATES: readonly UiState[] = [
  { id: 'room-from-yours', title: 'The room: 17 preselected from YOUR SIZES, READY CHECK SIZE 17 · TO CONFIRM', refs: ['AC-01'], variant: 'room', as: 'sized', path: release('room'), ready: '.view--live .live__yours-block--room:not([hidden])' },
  {
    id: 'room-from-yours-confirmed',
    title: 'The room: 17 tapped, READY CHECK SIZE 17 ready, ENTER THE ROOM',
    refs: ['AC-01'],
    variant: 'room',
    as: 'sized',
    path: release('room'),
    act: async (run) => {
      await run.page.locator('.view--live .live__yours-block--room:not([hidden])').waitFor({ timeout: 20_000 });
      await run.page.locator('.live__picker button.live__size', { hasText: /^17$/ }).click();
      await run.page.locator('.view--live .live__yours-block--room').waitFor({ state: 'hidden', timeout: 20_000 });
      await run.page.waitForFunction(() => [...document.querySelectorAll('.live__check')].some((c) => /^SIZE/.test(c.textContent ?? '') && c.classList.contains('is-ok')), null, { timeout: 20_000 });
    },
    ready: '.view--live .live-hzd',
  },
];

/** The state that stands for each validated board (its capture is set beside the board). */
export const BOARD_STATES: Readonly<Record<string, string>> = Object.freeze({
  C1: 'now-signed-in',
  C2: 'account-sheet',
  C3: 'pieces',
  C4: 'piece',
  C5: 'collection',
  C6: 'model',
  C7: 'releases',
  C8: 'circle',
  C9: 'result-first-registration',
  C10: 'now-signed-out',
  C11: 'scan-camera',
  C12: 'scan-verifying',
  C13: 'result-registered-signed-out',
  C14: 'result-ownership-verified',
  C15: 'result-unusual-card',
  C16: 'result-invalid',
  C17: 'problem-camera-denied',
  C18: 'pieces-sign-in-refused',
  C19: 'draw',
  C20: 'live-announced',
  C21: 'room',
  C22: 'post-invitation',
  C23: 'legal-terms',
  C24: 'pieces-orders',
  C25: 'releases-past',
  C26: 'after-room-door',
  C27: 'live-rules',
  C28: 'live-rules-not-eligible',
  C29: 'live-past-secured',
  C30: 'live-missed',
  C31: 'pieces-releases',
  C32: 'pieces-orders',
  C33: 'model-salon',
  C34: 'post-poll',
  C35: 'pieces-warranty',
  C36: 'result-first-registration-signed-in',
  C37: 'result-receiving',
  C38: 'scan-light-zoom',
  C39: 'result-create-account',
  C40: 'pieces-loading',
  C41: 'legal-faq',
  C42: 'now-draw-leads',
  C43: 'now-collection-leads',
});

/**
 * The boards of several states (C5: THE PRIVATE SALON's teaser; C17: the problems of the scan; C28: I'LL BE THERE said,
 * signed out, and not eligible by tier and by selection; C30: the question after on a final page, and an after-room's
 * end; C33: REQUESTED; C36: registering; C37: passing a piece on; C38: the scanner; C40: every page's loading, could not
 * be shown, empty, owners only and not found; N8's: C8, the feed a PLATINE account reads, its poll too; C18, the
 * sign-in before its refusal; C22, NO and a note; C23, the index and the terms in French; C34, the results once voted;
 * C39, FORGOTTEN PASSWORD, SET A NEW PASSWORD and CHANGE PASSWORD; C41, HELP in French; N9's, each STATE n a board
 * draws: C2 without a piece; C16, UNKNOWN, REVOKED and UNREADABLE; C17, A MOMENT, PLEASE and VERIFICATION UNAVAILABLE;
 * C22, answers closed and every place taken; C25, SHOW MORE; C30, ANOTHER FINISH pressed; C31, PLACE HELD, WAITING
 * LIST and YOUR TURN; C35, a piece in service; C40, a piece, THE CIRCLE and a post that could not be shown; C42, the
 * draw before its entries and in its early access; C43, signed out): beside BOARD_STATES' first, each further state is set beside the board too, to be compared with its section.
 */
export const BOARD_SECTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  C8: ['circle-platine', 'circle-show-more'],
  C18: ['pieces-signed-out'],
  C22: ['post-answered-no', 'post-note', 'post-answers-closed', 'post-full'],
  C23: ['legal-index', 'legal-terms-fr'],
  C34: ['post-poll-voted'],
  C39: ['result-forgotten-password', 'result-recovery-code', 'account-sheet-password'],
  C41: ['legal-faq-fr'],
  C5: ['collection-signed-out', 'collection-no-piece'],
  C17: ['problem-scan-timeout', 'problem-network', 'problem-rate-limited', 'problem-server'],
  C35: ['pieces-service', 'pieces-care', 'pieces-certificate-choice', 'pieces-certificate-link', 'pieces-report-choice', 'pieces-piece-found', 'piece-stolen', 'piece-transfer', 'piece-in-service'],
  C36: ['result-registered-now', 'result-ceremony', 'result-registration-closed', 'result-not-delivered'],
  C37: ['result-transfer-code', 'result-received', 'result-registered-other'],
  C33: ['model-salon-requested'],
  C28: ['live-there', 'live-announced-signed-out', 'live-veiled', 'live-selected-not-eligible'],
  C30: ['live-past-question', 'live-past-question-answered', 'after-room-sold-out'],
  C38: ['scan-preparing', 'scan-hint', 'scan-seal', 'scan-verifying'],
  C2: ['account-sheet-club'],
  C16: ['result-unknown', 'result-revoked', 'result-unreadable'],
  C25: ['releases-past-more'],
  C31: ['pieces-draws', 'live-pieces-turn'],
  C42: ['now-draw-soon', 'now-draw-early'],
  C43: ['now-collection-leads-signed-out'],
  C40: ['pieces-failed', 'piece-failed', 'circle-failed', 'post-failed', 'pieces-empty', 'collection-empty', 'releases-empty', 'circle-empty', 'circle-no-piece', 'model-not-found', 'draw-not-found', 'post-not-found'],
});

export function stateById(id: string): UiState {
  const s = UI_STATES.find((x) => x.id === id);
  if (!s) throw new Error(`no state ${id}`);
  return s;
}

/**
 * The states in the order a run reaches them: by variant (each its own stage), those that write last, in the order
 * UI_STATES lists them whatever order they were asked in (each finds the demo as the writes listed before it left it).
 */
export function runOrder(states: readonly UiState[]): UiState[] {
  const variants = [...new Set(states.map((s) => s.variant))];
  const listed = (s: UiState) => UI_STATES.findIndex((x) => x.id === s.id);
  return variants.flatMap((v) => [
    ...states.filter((s) => s.variant === v && !s.mutates),
    ...states.filter((s) => s.variant === v && s.mutates).sort((a, b) => listed(a) - listed(b)),
  ]);
}

// ── Reaching a state ───────────────────────────────────────────────────────

/** The iPhone's camera, the failures of a camera, and a camera held before its stream (an init script: no page markup). */
function cameraScript(arg: { failure: string | null; hold: boolean }): void {
  const w = window as unknown as Record<string, unknown>;
  if (arg.failure === 'unsupported') {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true });
    return;
  }
  const md = navigator.mediaDevices;
  if (!md) return;
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  w.__nocturneReleaseCamera = () => release();
  const open = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (arg.hold) await held;
    if (arg.failure) throw new DOMException('The camera refused.', arg.failure);
    return open(c);
  };
  const capabilities = MediaStreamTrack.prototype.getCapabilities;
  MediaStreamTrack.prototype.getCapabilities = function (this: MediaStreamTrack) {
    const c = capabilities ? capabilities.call(this) : ({} as MediaTrackCapabilities);
    return this.kind === 'video' ? ({ ...c, torch: true, zoom: { min: 0.5, max: 5, step: 0.1 } } as MediaTrackCapabilities) : c;
  };
  const apply = MediaStreamTrack.prototype.applyConstraints;
  MediaStreamTrack.prototype.applyConstraints = function (this: MediaStreamTrack, k?: MediaTrackConstraints) {
    const sets = (k?.advanced ?? []) as Record<string, unknown>[];
    if (sets.some((s) => 'torch' in s || 'zoom' in s)) return Promise.resolve();
    return apply.call(this, k);
  };
}

/**
 * Wait for the page to rest: its fonts in, no request of its own pending for a moment, every finite motion finished (but
 * the room's door's: the draw's point travels on while the page waits for its place).
 */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await sleep(ms);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      // The draw's point travels on while the page waits for its place (ONE QUEUE §3.4, N16): never a still to reach.
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (target instanceof Element && target.closest('.live-hzd')) continue;
      if (t && t.iterations !== Infinity) {
        try {
          a.finish();
        } catch {
          // A motion that cannot finish (its end unknown) is left as it is.
        }
      }
    }
  });
  await hideGrain(page);
}

export interface OpenedState extends StateRun {
  holds: Holds;
  close(): Promise<void>;
}

/** Open `state` on a new phone of `browser` against `stage`: its session, its camera, its routes, its address, its steps. */
export async function openState(browser: Browser, stage: UiStage, demo: NocturneDemo, state: UiState): Promise<OpenedState> {
  const context = state.size
    ? await browser.newContext({ viewport: { ...state.size }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/Paris', reducedMotion: 'no-preference' })
    : await mobileContext(browser);
  const page = await context.newPage();
  const gates: { open(): void }[] = [];
  const holds: Holds = {
    hold: (pattern) => {
      const g = gate();
      gates.push(g);
      void page.route(pattern, async (route) => {
        await g.promise;
        await route.continue().catch(() => {});
      });
    },
    releaseAll: () => gates.forEach((g) => g.open()),
  };
  const close = async () => {
    holds.releaseAll();
    await context.close().catch(() => {});
  };
  // Every step of a state fails within its time rather than waits for ever (a click on a control that never shows).
  context.setDefaultTimeout(30_000);
  try {
    // The functions handed to the page are compiled by tsx or vitest, which may wrap a named function in __name().
    await context.addInitScript({ content: 'globalThis.__name = globalThis.__name || ((f) => f);' });
    await context.clock.setFixedTime(NOCTURNE_NOW);
    await context.addInitScript(cameraScript, { failure: state.camera && state.camera !== 'hold' ? state.camera : null, hold: state.camera === 'hold' });
    // LIGHT MODE as the app keeps it on the device (a string: no transpiler helper reaches the page).
    if (state.light) await context.addInitScript({ content: "try { localStorage.setItem('orbes.mode', 'light'); } catch {}" });
    if (state.as) {
      const a = demo.accounts[state.as];
      if (!a) throw new Error(`no demo account ${state.as}`);
      await context.addCookies([{ name: sessionCookieName(stage.ctx.config, 'account'), value: a.token, url: stage.origin }]);
    }
    await state.routes?.(page, holds);
    const run: StateRun = { page, context, stage, demo };
    await page.goto(`${stage.origin}${state.path(demo)}`);
    await state.act?.(run, holds);
    await page.locator(state.ready).first().waitFor({ state: 'attached', timeout: 30_000 });
    await settle(page, 700);
    return { ...run, holds, close };
  } catch (e) {
    // Where the state was not reached, what the page showed (ORBES_NOCTURNE_FAILURES: a directory for it).
    const dir = process.env.ORBES_NOCTURNE_FAILURES;
    if (dir) await page.screenshot({ path: `${dir}/${state.id}.failed.png`, fullPage: true }).catch(() => {});
    await close();
    throw new Error(`${state.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── What a state shows ─────────────────────────────────────────────────────

/**
 * Every text of MY PIECES as the account of `opened` has it, in the same phone: its PIECES tab, its other tabs (ORDERS,
 * RELEASES), the page of each of its pieces (SEE THE PIECE), then the account sheet (SIGNED IN AS, CHANGE PASSWORD,
 * SIGN OUT). Plan NOCTURNE, N5: the one page MY PIECES was split into these (C3, C4, C24, C31; C2); what the page showed
 * before is looked for in them (test/web/nocturne.content.harness.ts, SPLIT).
 */
export async function myPiecesTexts(opened: { page: Page; stage: UiStage }): Promise<string[]> {
  const page = opened.page;
  const out: string[] = [];
  await page.goto(`${opened.stage.origin}/verify/pieces`);
  await page.locator('.view--pieces .n-pieces__panel, .view--pieces .pieces__signin, .view--pieces .n-failed').first().waitFor({ timeout: 30_000 });
  await settle(page, 300);
  out.push(...(await pageTexts(page)));
  // The PIECES tab (the address opened again keeps the tab its entry held), then each piece's page from it.
  const piecesTab = page.getByRole('tab', { name: /^PIECES\s*\d*$/ });
  if ((await piecesTab.count()) > 0) {
    await piecesTab.first().click();
    await page.locator('.view--pieces[data-tab="pieces"]').waitFor();
    await settle(page, 200);
    out.push(...(await pageTexts(page)));
  }
  const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('.view--pieces a.n-pieces__see')].map((a) => a.getAttribute('href') ?? ''));
  for (const name of ['ORDERS', 'RELEASES']) {
    const t = page.getByRole('tab', { name: new RegExp(`^${name}\\s*\\d*$`) });
    if ((await t.count()) === 0) continue;
    await t.first().click();
    await page.locator(`.view--pieces[data-tab="${name.toLowerCase()}"]`).waitFor();
    await settle(page, 200);
    out.push(...(await pageTexts(page)));
  }
  for (const href of hrefs.filter((x) => x.length > 0)) {
    await page.goto(`${opened.stage.origin}${href}`);
    await page.locator('.view--piece .n-piece__article').waitFor({ timeout: 30_000 });
    await settle(page, 200);
    out.push(...(await pageTexts(page)));
  }
  const account = page.locator('.n-hd .n-acct:has(> .n-mono):not([hidden])');
  if ((await account.count()) > 0) {
    await account.first().click();
    await page.locator('.n-account:not([hidden]) .n-account__panel').waitFor({ timeout: 20_000 });
    await settle(page, 200);
    out.push(...(await pageTexts(page)));
  }
  return out;
}

/**
 * Every text the page shows, as it reads: each block of words (an element laid out as a block whose descendants are all
 * laid out in the line: its words, its figures set apart in the reading face, its links and buttons, read together), and
 * the own words of a block that holds other blocks; visible only, whitespace folded, in page order. An empty field's
 * placeholder counts as a text.
 */
export async function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fold = (t: string) => t.replace(/[\s\u00a0]+/g, ' ').trim();
    const inLine = (el: Element) => /^(inline|inline-block|inline-flex|inline-grid|contents|none)$/.test(getComputedStyle(el).display);
    const shown = (el: Element): boolean => {
      if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
      for (let e: Element | null = el; e; e = e.parentElement) if (Number.parseFloat(getComputedStyle(e).opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (t: string) => {
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg)$/i.test(el.tagName)) continue;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (!el.value && el.placeholder && shown(el)) add(fold(el.placeholder));
        continue;
      }
      if (inLine(el) && el.parentElement && el.parentElement !== document.body) continue;
      const hasBlocks = (e: Element) => [...e.querySelectorAll('*')].some((d) => !(d instanceof SVGElement) && !inLine(d));
      const read = (e: Element) => (e instanceof HTMLElement ? e.innerText : (e.textContent ?? ''));
      let words = '';
      if (!hasBlocks(el)) words = read(el);
      else {
        // A block of blocks: its own words, and those of its children laid out in the line that hold no block.
        for (const n of el.childNodes) {
          if (n.nodeType === Node.TEXT_NODE) words += n.textContent ?? '';
          else if (n instanceof Element && inLine(n) && !hasBlocks(n) && !(n instanceof SVGElement) && shown(n)) words += ` ${read(n)} `;
        }
      }
      words = fold(words);
      if (!words || !shown(el)) continue;
      add(words);
    }
    return out;
  });
}

/** The page's blocks of words (visibleTexts), each folded, lower case: what a baseline value is looked for in. */
export async function pageTexts(page: Page): Promise<string[]> {
  return (await visibleTexts(page)).map(normalizeText);
}

export function normalizeText(t: string): string {
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[\s ]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The parts of a value that change from one run to the next (written by the server: references, ids, genomes, codes,
 * the stage's port) or with an edition of the legal pages (their version's date), replaced by a mark the content test
 * reads as any text of the same shape (MARK_SHAPES, valuePattern).
 */
const VOLATILE: readonly [RegExp, string][] = [
  [/https?:\/\/127\.0\.0\.1:\d+\S*/g, '«link»'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '«id»'],
  [/\b[0-9a-f]{64}\b/gi, '«hex»'],
  [/\b(?:[0-9a-f]{4} ){15}[0-9a-f]{4}\b/gi, '«hex»'],
  // A code the server wrote (a claim, transfer or recovery code), never the field's placeholder XXXX-XXXX-XXXX.
  [/\b(?!X{4}-X{4}-X{4}\b)[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\b/g, '«code»'],
  [/\bG\d-[0-9A-F]{4}-[0-9A-F]{4}\b/g, '«genome»'],
  [/\b(OR|LR|INV|CN)-(?=[0-9A-Z-]*\d)[0-9A-Z-]{4,}\b/g, '$1-«ref»'],
  [/\b(REF(?:ERENCE)?) [0-9A-F]{8}\b/g, '$1 «ref»'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/gi, '«ref»'],
  // The version of the legal pages (LEGAL_VERSION), moved with each edition of their text.
  [/\b(VERSION (?:OF|DU)) \d{1,2}(?:ER)? \S+ \d{4}\b/gi, '$1 «date»'],
];

export function maskVolatile(value: string): string {
  return VOLATILE.reduce((v, [re, mark]) => v.replace(re, mark), value);
}

/**
 * Where a value may start and end: not inside a word or a figure. Nothing of a letter or a digit next to it, and a
 * figure is whole with its separators (17 is not shown by 2017, nor by 17:00, nor by 1.17).
 */
const STARTS = '(?<![\\p{L}\\p{N}]|\\p{N}[:.,])';
const ENDS = '(?![\\p{L}\\p{N}]|[:.,]\\p{N})';

/**
 * What each mark of maskVolatile stands for, in the page's normalized (lower-case) words: a value made of a mark alone
 * (the GENOME's id, a code, the seed) is shown only by a text of its shape, never by any word.
 */
const MARK_SHAPES: Readonly<Record<string, string>> = Object.freeze({
  genome: 'g\\d-[0-9a-f]{4}-[0-9a-f]{4}',
  code: '[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}',
  hex: '(?:[0-9a-f]{64}|(?:[0-9a-f]{4} ){15}[0-9a-f]{4})',
  id: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  link: 'https?://\\S+',
  ref: '[0-9a-z-]*\\d[0-9a-z-]*',
  date: '\\d{1,2}(?:er)? \\S+ \\d{4}',
});

/** A baseline value as a pattern over a block of the page's normalized words: each mark read as a text of its shape, on word boundaries. */
export function valuePattern(value: string): RegExp {
  const escape = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = normalizeText(value)
    .split(/(«[a-z]+»)/)
    .map((part) => {
      const mark = /^«([a-z]+)»$/.exec(part)?.[1];
      if (mark === undefined) return escape(part);
      const shape = MARK_SHAPES[mark];
      if (!shape) throw new Error(`no shape for the mark «${mark}»`);
      return shape;
    })
    .join('');
  return new RegExp(STARTS + body + ENDS, 'u');
}

/**
 * Whether `value` (a baseline value) is shown in `texts` (pageTexts): whole within one block of words, or each of its
 * parts joined by « · » within a block. A value never straddles two blocks, and never matches inside a word or a figure.
 */
export function shows(texts: readonly string[], value: string): boolean {
  const shown = (v: string) => {
    const re = valuePattern(v);
    return texts.some((t) => re.test(t));
  };
  if (shown(value)) return true;
  const parts = value.split(' · ').filter((p) => p.trim().length > 0);
  return parts.length > 1 && parts.every(shown);
}

// ── Overflow (fidelity rule 5) ─────────────────────────────────────────────

/**
 * What overflows on the page: the page scrolling sideways, an element with words or a control reaching past the
 * column's edges or past its parent's box (into the page's margin, past a plate's padding), any box whose content
 * spills out of it (words or not: a row, a flex or grid item sized to its content), words wider than their own box,
 * and words cut (an ellipsis, a clipped box, a clamp). A box that scrolls sideways on purpose holds what it scrolls,
 * and a full-bleed photograph reaches past its column on purpose.
 */
export async function overflows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    const width = doc.clientWidth;
    if (doc.scrollWidth > width + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} px for ${width})`);
    const name = (el: Element) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}${own ? ` «${own.slice(0, 60)}»` : ''}`;
    };
    /**
     * A row that scrolls sideways on purpose (overflow-x auto or scroll, PAIRS WELL WITH's: plan NEXT-NINE, BP-34): its
     * cards may lie past the column while scrolled out of view; the row itself must stay inside the column.
     */
    const scrolls = (cs: CSSStyleDeclaration) => cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrolls(getComputedStyle(p))) return true;
      return false;
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (scrolls(getComputedStyle(el)) && el.clientWidth > 0) {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > width + 1) out.push(`${name(el)}, a row that scrolls, reaches past the column (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
      }
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      const control = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|A)$/.test(el.tagName);
      if (!hasText && !control) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if ((r.left < -1 || r.right > width + 1) && !inScroller(el)) out.push(`${name(el)} reaches past the column (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
      const cs = getComputedStyle(el);
      if (hasText && cs.display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
        out.push(`${name(el)} is wider than its box (${el.scrollWidth} px in ${el.clientWidth})`);
      }
      const clipped = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (hasText && (cs.textOverflow === 'ellipsis' || clipped) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        out.push(`${name(el)} is cut (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
      }
      const clamp = (cs as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      if (hasText && clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) out.push(`${name(el)} is clamped`);
    }
    // Any box, words or not, whose content spills out of it sideways (a descendant past its edge shows in its scrollWidth).
    for (const el of document.body.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || !el.checkVisibility({ visibilityProperty: true })) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || cs.display === 'inline' || cs.display === 'contents') continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      if (hasText) continue; // reported above as wider than its box
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} spills out of its box (${el.scrollWidth} px in ${el.clientWidth})`);
    }
    // Words or a control in the flow past their parent's box: into the page's margin, past a plate's padding.
    const boxOf = (el: Element): HTMLElement | null => {
      for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).display !== 'contents') return p;
      return null;
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || !el.checkVisibility({ visibilityProperty: true })) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      const control = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|A)$/.test(el.tagName);
      if (!hasText && !control) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      const p = boxOf(el);
      if (!p || p === document.body || p === doc) continue;
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      // A full-bleed photograph spans the screen's width on purpose.
      if (/^(IMG|PICTURE|VIDEO)$/.test(el.tagName) && r.left <= 1 && r.right >= width - 1) continue;
      const b = p.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1) {
        out.push(`${name(el)} reaches past its parent ${name(p)} (${Math.round(r.left)} to ${Math.round(r.right)} in ${Math.round(b.left)} to ${Math.round(b.right)})`);
      }
    }
    return out;
  });
}

/** A white card with no code on it (NO ORBES CODE FOUND). */
function blankPng(): Buffer {
  const png = new PNG({ width: 600, height: 600 });
  png.data.fill(255);
  return PNG.sync.write(png);
}
