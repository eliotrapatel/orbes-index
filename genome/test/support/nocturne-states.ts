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
import { NOCTURNE_NOW, type DemoVariant, type NocturneDemo } from './nocturne-demo.js';
import { codePhoto, gate, hideGrain, mobileContext, sleep, type UiStage } from './ui-stage.js';

/** A camera that refuses to open, the way a browser says it (getUserMedia's DOMException names). */
export type CameraFailure = 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'AbortError' | 'unsupported';

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
}

/** Requests a state holds open while it is captured, released when the run ends. */
export interface Holds {
  hold(pattern: string): void;
  releaseAll(): void;
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
const link = (run: StateRun, name: string | RegExp) => run.page.getByRole('link', { name, exact: typeof name === 'string' }).first();
const tab = (run: StateRun, name: string) => run.page.getByRole('tab', { name, exact: true }).first();
/** A tab of MY PIECES (PIECES, ORDERS, RELEASES: its name with its count), selected, its panel drawn. */
async function piecesTab(run: StateRun, name: 'PIECES' | 'ORDERS' | 'RELEASES'): Promise<void> {
  await run.page.locator('.view--pieces .n-pieces__tabs').waitFor();
  await run.page.getByRole('tab', { name: new RegExp(`^${name}\\s*\\d*$`) }).first().click();
  await run.page.locator(`.view--pieces[data-tab="${name.toLowerCase()}"]`).waitFor();
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
  const account = run.page.locator('.n-hd button.n-acct');
  await account.waitFor();
  // The tier is read for the header: wait for its name (or for an account without one, a moment).
  await run.page.waitForFunction(() => !!document.querySelector('.n-acct__tier:not([hidden])')?.textContent || document.querySelector('.n-acct')?.getAttribute('aria-label') === 'Your account', null, { timeout: 10_000 }).catch(() => {});
  await account.click();
  await run.page.locator('.n-account:not([hidden]) .n-account__tier').waitFor({ timeout: 20_000 });
  await fitSheet(run.page);
}

/** The phone grown (or shrunk) to the sheet: its top (under the header and the rail), its content and its foot's padding. */
async function fitSheet(page: Page): Promise<void> {
  const height = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.n-account__panel');
    if (!panel) return 0;
    // The bottom of its last piece, in the page (scrolled back), then its padding.
    const bottom = Math.max(...[...panel.children].map((c) => c.getBoundingClientRect().bottom + panel.scrollTop));
    return Math.ceil(bottom + Number.parseFloat(getComputedStyle(panel).paddingBottom));
  });
  const size = page.viewportSize();
  if (size && height > 0) await page.setViewportSize({ width: size.width, height: Math.max(height, 400) });
  await sleep(200);
}

export const UI_STATES: readonly UiState[] = [
  // ── NOW (today: the landing, its banner of the LIVE RELEASES) ──
  { id: 'now-signed-out', title: 'NOW, signed out: a LIVE RELEASE announced, a draw open', refs: ['C10'], variant: 'full', path: at('/verify'), ready: '.view--now[data-ready]' },
  { id: 'now-signed-in', title: 'NOW, signed in (TITANE, two pieces): a LIVE RELEASE announced, a draw open', refs: ['C1'], variant: 'full', as: you, path: at('/verify'), ready: '.view--now[data-ready]' },
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
  { id: 'result-first-registration-warranty', title: 'AUTHENTIC — FIRST REGISTRATION: the WARRANTY tab', refs: ['C35'], variant: 'full', ...result('first', (run) => tab(run, 'WARRANTY').click()) },
  { id: 'result-first-registration-care', title: 'AUTHENTIC — FIRST REGISTRATION: the CARE tab', refs: ['C35'], variant: 'full', ...result('first', (run) => tab(run, 'CARE').click()) },
  {
    id: 'result-create-account',
    title: 'The OWNERSHIP tab, signed out: CREATE ACCOUNT',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await button(run, 'CREATE ACCOUNT').click();
    }),
  },
  {
    id: 'result-forgotten-password',
    title: 'The OWNERSHIP tab, signed out: FORGOTTEN PASSWORD?',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await button(run, 'FORGOTTEN PASSWORD?').click();
    }),
  },
  {
    id: 'result-recovery-code',
    title: 'The OWNERSHIP tab, signed out: SET A NEW PASSWORD with a recovery code',
    refs: ['C39'],
    variant: 'full',
    ...result('first', async (run) => {
      await tab(run, 'OWNERSHIP').click();
      await button(run, 'FORGOTTEN PASSWORD?').click();
      await button(run, 'I HAVE A RECOVERY CODE').click();
    }),
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
  { id: 'result-unknown', title: 'UNKNOWN ORBES CODE: a code ORBES signed for no piece', refs: ['C16'], variant: 'full', ...result('unknown') },
  { id: 'result-revoked', title: 'REVOKED', refs: ['C16'], variant: 'full', ...result('revoked') },
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
  { id: 'pieces-signed-out', title: 'MY PIECES, signed out: the sign-in', refs: ['C18'], variant: 'full', path: at('/verify/pieces'), ready: '.view--pieces form' },
  {
    id: 'pieces-sign-in-refused',
    title: 'MY PIECES, signed out: a sign-in refused',
    refs: ['C18'],
    variant: 'full',
    path: at('/verify/pieces'),
    act: async (run) => {
      await run.page.locator('.view--pieces input[type=email]').first().fill('you@example.com');
      await run.page.locator('.view--pieces input[type=password]').first().fill('not-the-password-of-the-demo');
      await run.page.locator('.view--pieces form').first().getByRole('button', { name: 'SIGN IN', exact: true }).click();
      await run.page.locator('.view--pieces .form__error').first().waitFor();
    },
    ready: '.view--pieces .form__error',
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
    ready: '.view--pieces article.n-pieces__order',
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
    title: 'A piece: WARRANTY',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: async (run) => tab(run, 'WARRANTY').click(),
    ready: '.view--piece .n-piece__article',
  },
  {
    id: 'pieces-care',
    title: 'A piece: CARE, then ORBES CARE',
    refs: ['C35'],
    variant: 'full',
    as: you,
    path: piece('yours'),
    act: async (run) => tab(run, 'CARE').click(),
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
      await run.page.locator('article.n-pieces__order[data-status="DELIVERED"] [data-document="CARE_GUIDE"]').click();
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
      await run.page.locator('.n-account').getByRole('button', { name: 'CHANGE PASSWORD' }).first().click();
      await run.page.locator('.n-account__password').waitFor();
      await fitSheet(run.page);
    },
    ready: '.n-account__password',
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
  { id: 'pieces-stress', title: 'MY PIECES with six pieces, the first of a 24-character model without a photograph, its Size of 14 characters', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/pieces'), ready: '.view--pieces article.n-pieces__piece', stress: true },
  {
    id: 'pieces-orders-stress',
    title: 'MY PIECES, ORDERS: four orders (a price in USD, € 125 400, a long tracking number)',
    refs: ['same pieces'],
    variant: 'stress',
    as: you,
    path: at('/verify/pieces'),
    act: (run) => piecesTab(run, 'ORDERS'),
    ready: '.view--pieces article.n-pieces__order',
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
    ready: '.n-account:not([hidden]) .n-account__tier',
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
    ready: '.n-account:not([hidden]) .n-account__tier',
    viewport: true,
  },
  {
    id: 'account-sheet-stress',
    title: 'The account sheet with the extreme content: PALLADIUM, six pieces',
    refs: ['same pieces'],
    variant: 'stress',
    as: you,
    path: at('/verify'),
    act: (run) => openAccountSheet(run),
    ready: '.n-account:not([hidden]) .n-account__tier',
    viewport: true,
    stress: true,
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
      await run.page.locator('.n-account').getByRole('button', { name: 'CHANGE PASSWORD', exact: true }).click();
      await fitSheet(run.page);
    },
    ready: '.n-account:not([hidden]) form',
    viewport: true,
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
  { id: 'model-not-found', title: 'A model’s address that leads nowhere', refs: ['C40'], variant: 'full', path: at('/verify/lookbook/no-such-model'), ready: '.view--sheet[data-state="missing"]' },
  { id: 'collection-empty', title: 'THE COLLECTION with no model', refs: ['C40'], variant: 'empty', path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__empty', stress: true },
  { id: 'collection-stress', title: 'THE COLLECTION with a 24-character name, no photograph', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/lookbook'), ready: '.view--lookbook[data-state="ready"] .lookbook__group', stress: true },
  { id: 'model-stress', title: 'A model of 24 characters without a photograph, € 125 400 in the salon', refs: ['same pieces'], variant: 'stress', as: you, path: sheet('long'), ready: '.view--sheet .sheet__body section', stress: true },

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
  { id: 'releases-empty', title: 'THE RELEASES with no release', refs: ['C40'], variant: 'empty', path: at('/verify/releases'), ready: '.view--releases .releases__body p, .view--releases p.prose', stress: true },
  { id: 'releases-stress', title: 'THE RELEASES: a countdown under an hour, one over 9 days, a price in USD', refs: ['same pieces'], variant: 'stress', as: you, path: at('/verify/releases'), ready: '.view--releases article.live-card', stress: true },
  { id: 'draw', title: 'A draw, entries open, signed in: ENTER THE DRAW', refs: ['C19'], variant: 'full', as: you, path: release('draw'), ready: '.view--release .release__body section, .view--release section' },
  { id: 'draw-signed-out', title: 'A draw, signed out: the sign-in', refs: ['C19'], variant: 'full', path: release('draw'), ready: '.view--release form' },
  { id: 'draw-soon', title: 'A draw before its entries open', refs: ['C42'], variant: 'draw-soon', as: you, path: release('draw'), ready: '.view--release section' },
  { id: 'draw-early', title: 'A draw in its early access, for a PLATINE account: RESERVE A PLACE', refs: ['C42'], variant: 'draw-early', as: 'platine', path: release('draw'), ready: '.view--release section' },
  { id: 'draw-drawn', title: 'A draw drawn: THIS RELEASE IS OVER, the seed checked, the entries by rank', refs: ['C29'], variant: 'full', as: you, path: release('draw:MONOLITHE IN GOLD'), ready: '.view--release section' },
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
  { id: 'draw-place-held', title: 'A draw drawn, the account selected: PLACE HELD until …, ORBES Client Services', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('selected'), ready: '.view--release .release__status' },
  { id: 'draw-waiting-list', title: 'A draw drawn, the account on the WAITING LIST, its rank', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('waitlisted'), ready: '.view--release .release__status' },
  { id: 'draw-waiting-list-no-piece', title: 'A draw drawn, an account without a piece on the WAITING LIST', refs: ['C29', 'C31'], variant: 'draws', as: 'newcomer', path: release('selected'), ready: '.view--release .release__status' },
  { id: 'draw-lapsed', title: 'A draw drawn, the place held lapsed: LAPSED', refs: ['C29', 'C31'], variant: 'draws', as: 'entrant', path: release('lapsed'), ready: '.view--release .release__status' },
  { id: 'draw-full', title: 'A draw in its early access, every piece reserved: EVERY PIECE RESERVED, the waiting list after', refs: ['C42'], variant: 'draws', as: you, path: release('full'), ready: '.view--release .release__status' },
  { id: 'draw-place-reserved', title: 'A PLATINE account’s direct reservation: PLACE RESERVED, held until …, ORBES Client Services', refs: ['C42', 'C31'], variant: 'draws', as: 'platine', path: release('full'), ready: '.view--release .release__status' },
  { id: 'draw-open-full', title: 'A draw open, every piece reserved: you may still enter, the waiting list', refs: ['C19'], variant: 'draws', as: you, path: release('openFull'), ready: '.view--release .release__status' },
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
  { id: 'live-announced', title: 'A LIVE RELEASE before the room, signed in: YOUR SIZE, I’LL BE THERE', refs: ['C20'], variant: 'full', as: you, path: release('blue'), act: (run) => run.page.locator('.n-live__there button.live__size', { hasText: /^17$/ }).click(), ready: '.view--live .n-live__there' },
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
  { id: 'room', title: 'The room: the door, READY CHECK, YOUR SIZE preselected, ENTER THE ROOM', refs: ['C21', 'live-05'], variant: 'room', as: you, path: release('room'), ready: '.view--live .live-door' },
  { id: 'room-sign-in', title: 'The room, signed out: SIGN IN TO ENTER', refs: ['live-13'], variant: 'room', path: release('room'), ready: '.view--live' },
  { id: 'room-not-eligible', title: 'The room, an account without a piece: not eligible', refs: ['live-14'], variant: 'room', as: 'newcomer', path: release('room'), ready: '.view--live' },
  { id: 'live-line', title: 'The line: YOUR PLACE, ahead in your size, the pieces left', refs: ['live-09'], variant: 'live', as: 'line', path: release('live'), ready: '.view--live .live__ahead' },
  { id: 'live-turn', title: 'The turn: PRESS AND HOLD THE SEAL', refs: ['live-10'], variant: 'live', as: 'turn', path: release('live'), ready: '.view--live .live-hold' },
  { id: 'live-secured', title: 'Secured: the piece, the add-ons, PAY · total', refs: ['live-11'], variant: 'live', as: 'secured', path: release('live'), ready: '.view--live .live__pay' },
  { id: 'live-confirmed', title: 'CONFIRMED, in ivory', refs: ['live-12'], variant: 'live', as: 'confirmed', path: release('live'), ready: '.view--live h1' },
  { id: 'live-sold-out-size', title: 'SOLD OUT IN SIZE 17: stay, or LEAVE THE LINE', refs: ['live-20'], variant: 'live', as: 'soldout', path: release('live'), ready: '.view--live .live__edge' },
  { id: 'live-missed', title: 'YOUR TURN HAS PASSED', refs: ['live-15', 'C30'], variant: 'live', as: 'missed', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-expired', title: 'YOUR HOLD HAS ENDED', refs: ['live-16', 'C30'], variant: 'live', as: 'expired', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-released', title: 'YOUR PLACE IS RELEASED', refs: ['live-17', 'C30'], variant: 'live', as: 'released', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-left', title: 'YOU LEFT THE LINE', refs: ['live-18', 'C30'], variant: 'live', as: 'left', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-removed', title: 'YOUR ENTRY IS REMOVED', refs: ['live-19', 'C30'], variant: 'live', as: 'removed', path: release('live'), ready: '.view--live .n-live__end' },
  { id: 'live-join', title: 'Live now, an account not in the line: ENTER THE LINE', refs: ['live-09'], variant: 'live', as: you, path: release('live'), ready: '.view--live' },
  { id: 'live-pieces-turn', title: 'MY PIECES of a collector at its turn: YOUR TURN', refs: ['C31'], variant: 'live', as: 'turn', path: at('/verify/pieces'), act: (run) => piecesTab(run, 'RELEASES'), ready: '.view--pieces .pieces__releases' },
  { id: 'after-room-door', title: 'The after-room’s second door', refs: ['C26', 'plus-07'], variant: 'afterroom', as: you, path: release('afterroom'), ready: '.view--live .live__after' },
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
    ready: '.view--live .live-door',
  },
  { id: 'after-room-sold-out', title: 'The after-room sold out before your turn: SOLD OUT', refs: ['C30'], variant: 'afterroom-ends', as: 'arSoldOut', path: release('arSoldOut', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-closed', title: 'The after-room’s time over before your turn: THE AFTER-ROOM IS CLOSED', refs: ['C30'], variant: 'afterroom-ends', as: 'arClosed', path: release('arClosed', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-ended', title: 'The after-room ended by ORBES before your piece: THE AFTER-ROOM HAS ENDED', refs: ['C30'], variant: 'afterroom-ends', as: 'arEnded', path: release('arEnded', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'after-room-over', title: 'The after-room over, for a guest who never entered it: THE AFTER-ROOM IS CLOSED, your entry stays in MY PIECES', refs: ['C30'], variant: 'afterroom-ends', as: 'arOver', path: release('arSoldOut', '/after-room'), ready: '.view--live .n-live__end' },
  { id: 'room-stress', title: 'A room open with the longest host message, a 24-character name, a price of € 125 400', refs: ['same pieces'], variant: 'stress', as: you, path: release('soon'), ready: '.view--live', stress: true },
  { id: 'live-far-stress', title: 'A LIVE RELEASE more than 9 days away, in USD', refs: ['same pieces'], variant: 'stress', as: you, path: release('far'), ready: '.view--live', stress: true },

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
    routes: async (page) =>
      page.route('**/api/v1/club/circle?*', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as { total: number };
        await route.fulfill({ response: res, json: { ...body, total: body.total + 1 } });
      }),
    ready: '.view--circle .circle__more',
  },
  { id: 'circle-signed-out', title: 'THE CIRCLE, signed out: the sign-in', refs: ['C40'], variant: 'full', path: at('/verify/circle'), ready: '.view--circle form' },
  { id: 'circle-no-piece', title: 'THE CIRCLE without a piece: it opens once a piece is registered', refs: ['C40'], variant: 'full', as: 'newcomer', path: at('/verify/circle'), ready: '.view--circle .circle__closed' },
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
  { id: 'board', title: 'The boutique board of a LIVE RELEASE, kept as it is', refs: ['kept (scope guard)', 'live-07'], variant: 'room', path: (d) => `/verify/releases/${d.releases.room}/board#${d.links.board}`, ready: '.view--board .live-door__seal' },

  // ── States that write (each its own piece or post) ──
  // The owner's transfer code first: you@example.com still holds its two pieces (TITANE, as C37 draws the header); the two
  // registrations after it give the account its third and fourth (PLATINE from three), which MY PIECES' states list.
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
    ready: '.view--live .live-door',
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
 * C39, FORGOTTEN PASSWORD, SET A NEW PASSWORD and CHANGE PASSWORD; C41, HELP in French):
 * beside BOARD_STATES' first, each further state is set beside the board too, to be compared with its section.
 */
export const BOARD_SECTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  C8: ['circle-platine', 'circle-show-more'],
  C18: ['pieces-signed-out'],
  C22: ['post-answered-no', 'post-note'],
  C23: ['legal-index', 'legal-terms-fr'],
  C34: ['post-poll-voted'],
  C39: ['result-forgotten-password', 'result-recovery-code', 'account-sheet-password'],
  C41: ['legal-faq-fr'],
  C5: ['collection-signed-out', 'collection-no-piece'],
  C17: ['problem-scan-timeout', 'problem-network'],
  C35: ['pieces-service', 'pieces-care', 'pieces-certificate-choice', 'pieces-certificate-link', 'pieces-report-choice', 'pieces-piece-found', 'piece-stolen', 'piece-transfer'],
  C36: ['result-registered-now', 'result-ceremony', 'result-registration-closed', 'result-not-delivered'],
  C37: ['result-transfer-code', 'result-received', 'result-registered-other'],
  C33: ['model-salon-requested'],
  C28: ['live-there', 'live-announced-signed-out', 'live-veiled', 'live-selected-not-eligible'],
  C30: ['live-past-question', 'after-room-sold-out'],
  C38: ['scan-preparing', 'scan-hint', 'scan-seal', 'scan-verifying'],
  C40: ['pieces-failed', 'pieces-empty', 'collection-empty', 'releases-empty', 'circle-empty', 'circle-no-piece', 'model-not-found', 'draw-not-found', 'post-not-found'],
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

/** Wait for the page to rest: its fonts in, no request of its own pending for a moment, every finite motion finished. */
export async function settle(page: Page, ms = 400): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await sleep(ms);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
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
  const context = await mobileContext(browser);
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
  const account = page.locator('.n-hd button.n-acct');
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
    for (const el of document.body.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      const control = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|A)$/.test(el.tagName);
      if (!hasText && !control) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.left < -1 || r.right > width + 1) out.push(`${name(el)} reaches past the column (${Math.round(r.left)} to ${Math.round(r.right)} of ${width})`);
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
