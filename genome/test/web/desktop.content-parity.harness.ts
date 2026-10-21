/**
 * The desktop's content parity (plan DESKTOP §2(j), §2(k), step 13): every word a phone's state shows is shown by the
 * same state on a computer (its desk-* state, test/support/nocturne-states.ts DESK_STATES, made from the phone's own:
 * `refs` names it, `phone: <id>`), but what DESKTOP_MOVED lists, each with its reason and where it is now.
 *
 * A phone's value (its entry of the content baseline, test/fixtures/nocturne-baseline.json) is shown on a computer when:
 *  - it is shown by the computer's state itself (`shows`, as the content test reads a value), or set on two or three
 *    lines one after the other (a line the computer's layout breaks: its words kept whole, in their order); or
 *  - it reads in the computer's words (DESKTOP_WORDS: the owner's decided swaps, HANDOVER §2: "on this computer",
 *    SOUND OFF where the sound starts off, CLICK AGAIN, the legal pages' computer words, legal/content/desktop.ts
 *    DESKTOP_WORDING) and those are shown; or
 *  - DESKTOP_MOVED lists it for that state: shown apart (`shownAs`: its parts, each shown in the state), on the page it
 *    moved to (`where`: read on that page, in the same window, right after the state), or left out on purpose (`removed`:
 *    the room's own chrome, decision 7).
 *
 * Checked in two places: test/web/desktop.content-parity.e2e.test.ts reads the two baselines (every phone value of a
 * twin found in its computer's recorded words, or listed; nothing listed that is not needed), and each desktop shard of
 * the content test (nocturne.content.harness.ts, desk-1 … desk-12) checks it on the page itself, where the values listed
 * `where` are read on the page they moved to.
 */
import type { Page } from 'playwright-core';
import { DESKTOP_WORDING } from '../../src/web/legal/content/desktop.js';
import { normalizeText, pageTexts, settle, shows, type StateRun, type UiState } from '../support/nocturne-states.js';

/** A phone's phrase and a computer's, as the owner decided them (HANDOVER §2; copy.ts forDevice, legal DESKTOP_WORDING). */
export interface DesktopWords {
  phone: string;
  computer: string;
  /** The value is the phrase alone (SOUND ON), not a phrase within a sentence. */
  whole?: boolean;
  reason: string;
}

/**
 * The owner's decided swaps (HANDOVER §2, decisions 8 and 10, D6) that the content states show: a computer reads these
 * words in place of the phone's. (CLICK AGAIN TO, YOUR NEW CLAIM CODE's card and the story card's sentence are swapped
 * too, in states the content test does not reach: test/web/copy.for-device.test.ts holds every pair, the desktop flows
 * read CLICK AGAIN TO REMOVE.)
 */
export const DESKTOP_WORDS: readonly DesktopWords[] = [
  { phone: 'SOUND ON', computer: 'SOUND OFF', whole: true, reason: 'D6, decision 10: on a computer the sound starts off, so the foot reads SOUND OFF.' },
  { phone: 'on this phone', computer: 'on this computer', reason: 'Decision 8 (HANDOVER §2): a time on the device’s own clock, and a draw’s seed checked, on this computer.' },
  { phone: 'One tap.', computer: 'One choice.', reason: 'Decision 8: the question after a release is answered with a click.' },
  {
    phone: 'This code could not be read. Please scan it again in even light, holding the camera steady.',
    computer: 'This code could not be read. Please upload a sharp, well-lit photo in which the whole code is visible, or scan it with your phone.',
    whole: true,
    reason: 'Decision 8 (BRIEF §5.8): a computer opens no camera, so UNREADABLE CODE asks for a photo, or the phone.',
  },
  ...(['en', 'fr'] as const).flatMap((lang) =>
    DESKTOP_WORDING[lang].map(([phone, computer]) => ({ phone, computer, reason: `Q3 (b): the legal pages’ computer words, displayed only (legal/content/desktop.ts DESKTOP_WORDING, ${lang}).` })),
  ),
];

/** Where a phone's values moved to on a computer (read on that page, in the same window, right after the state). */
export type Where =
  /** The page a phone's sheet stood over (its address: NOW, a piece): on a computer the sheet is a page of its own (decision 5). */
  | 'under'
  /** The page the sign-in page was opened from, back in the history (decision 6: its page gives way to it). */
  | 'back'
  /** The sign-in page (/verify/sign-in), where the forms a phone embeds are (decision 6). */
  | 'sign-in'
  /** MY PIECES' ORDERS (its rows) and every order's page (decision 5: each order a page of its own). */
  | 'orders'
  /** MESSAGES' every subject, each opened (decision 5, D14: subjects | conversation, one subject's messages at a time). */
  | 'subjects'
  /** The page read from its top to its foot, a window at a time (a long list drawn as it nears the window). */
  | 'scrolled';

/** A phone's values moved or left out on a computer, on purpose: the states they are in, why, and where they are now. */
export interface DesktopMoved {
  /** The phone's states (their ids): their computer twins are concerned. */
  states: readonly string[];
  /** Its values (as the phone's baseline holds them); absent: every value of the state the computer does not show itself. */
  values?: readonly string[];
  reason: string;
  now: string;
  /** Shown apart in the same state: each of these is shown. */
  shownAs?: readonly string[];
  /** On another page (Where), or several, read there. */
  where?: Where | readonly Where[];
  /** Left out on purpose: nowhere on a computer. */
  removed?: true;
  /**
   * Not the desktop's: a count of the demo at another moment of its run (the phone's state recorded after writes of the
   * stage that the computer's state runs before), shown on the computer as it stands then.
   */
  run?: true;
}

/** The room's and the after-room's ends: no menu, SCAN nor account on a computer (decision 7). */
const ROOM_ENDS = ['live-missed', 'live-expired', 'live-released', 'live-left', 'live-removed', 'after-room-sold-out', 'after-room-closed', 'after-room-ended', 'after-room-over'] as const;

export const DESKTOP_MOVED: readonly DesktopMoved[] = [
  {
    // The phone's account sheet, MESSAGES, its write sheet and its sections stand over the page they were opened on.
    states: [
      'account-sheet',
      'account-sheet-password',
      'sizes-view',
      'account-messages-empty',
      'account-write',
      'account-addresses',
      'account-profile',
      'profile-tastes',
      'birthday-credit',
      'tier-warranty-credit',
      'account-sheet-in-use',
      'account-sheet-stress',
      // Lot M1 (E2): YOUR PROFILE's release notices, on its page.
      'profile-release-notices',
    ],
    reason: 'Decision 5: the account, MESSAGES and their sections are pages of their own on a computer, never a sheet over the page they were opened on.',
    now: 'On that page itself (NOW, or the piece WRITE TO ORBES CLIENT SERVICES was pressed on), at its own address.',
    where: 'under',
  },
  {
    states: ['sizes-view'],
    values: ['6 COLLECTORS WILL BE THERE', '4 LEFT OF 12'],
    reason: 'The run, not the desktop: the phone’s sizes-view is recorded among the full demo’s writes (a collector entered in the room, an invitation answered), the computer’s YOUR SIZES page before them, as it writes nothing.',
    now: 'On NOW, as the demo stands when it is read (one collector fewer, one place more).',
    run: true,
  },
  {
    states: ['account-messages-thread'],
    values: ['CONCERNING MONOLITHE IN STEEL · O26-J-00184'],
    reason: 'Decision 5 (D14, HANDOVER §3): MESSAGES gathers a subject’s messages on a computer, its name in the list of subjects and CONCERNING said once at the head of its conversation, not over each message.',
    now: 'CONCERNING at the head of the conversation, MONOLITHE IN STEEL · O26-J-00184 in the list of subjects.',
    shownAs: ['CONCERNING', 'MONOLITHE IN STEEL · O26-J-00184'],
  },
  {
    states: ['account-messages-thread'],
    // The demo's own message (nocturne-states.ts, account-write-sent), its words as the demo writes them.
    values: [`Could the ${'ate' + 'lier'} adjust the clasp of this bracelet?`],
    reason: 'The run, not the desktop: the phone’s thread is recorded after account-write-sent (a message sent from the piece, a write of its stage) that the desktop shards do not make.',
    now: 'In MESSAGES once that message is sent (the desktop flows send one and read it there).',
    run: true,
  },
  {
    states: ['account-messages-thread'],
    reason: 'Decision 5 (D14): MESSAGES is a page in two parts on a computer, its subjects beside the conversation of the one chosen, each subject’s CONCERNING said once at its head; the phone’s sheet stood over NOW.',
    now: 'In MESSAGES, under each subject, opened in turn; NOW’s own words on NOW.',
    where: ['subjects', 'under'],
  },
  {
    states: ['account-messages-house-unread'],
    values: ['CONCERNING MONOLITHE IN STEEL · O26-J-00184'],
    reason: 'Decision 5 (D14, HANDOVER §3): MESSAGES gathers a subject’s messages on a computer, its name in the list of subjects and CONCERNING said once at the head of its conversation, not over each message.',
    now: 'CONCERNING at the head of the conversation, MONOLITHE IN STEEL · O26-J-00184 in the list of subjects.',
    shownAs: ['CONCERNING', 'MONOLITHE IN STEEL · O26-J-00184'],
  },
  {
    // Lot M2 (M3): a computer has no tabs; under FROM ORBES the button WRITE TO ORBES CLIENT SERVICES opens GENERAL.
    states: ['account-messages-house', 'account-messages-house-stress'],
    values: ['Messages from ORBES cannot be answered. To write, open ORBES CLIENT SERVICES.'],
    reason: 'Decision 5 (D14) and lot M2 (M3): FROM ORBES is a subject of MESSAGES on a computer, no tabs; in place of the reply, its sentence and the button WRITE TO ORBES CLIENT SERVICES, which opens GENERAL.',
    now: 'At the foot of FROM ORBES: the sentence, and WRITE TO ORBES CLIENT SERVICES beside it.',
    shownAs: ['Messages from ORBES cannot be answered.', 'WRITE TO ORBES CLIENT SERVICES'],
  },
  {
    states: ['account-messages-house'],
    values: ['NEW'],
    reason: 'The run, not the desktop: FROM ORBES is read as it opens, so on the stage only its first opening (desk-messages-house) shows the message unread; its light and 1024 twins open it after.',
    now: 'NEW beside the unread message’s author line the first time FROM ORBES opens (desk-messages-house).',
    run: true,
  },
  {
    states: ['account-messages-house', 'account-messages-house-stress'],
    reason: 'Decision 5 (D14) and lot M2: MESSAGES is a page in two parts on a computer, FROM ORBES and the conversation’s subjects beside the one chosen; the phone’s sheet stood over NOW.',
    now: 'In MESSAGES, under each subject (FROM ORBES among them), opened in turn; NOW’s own words on NOW.',
    where: ['subjects', 'under'],
  },
  {
    // Read on NOW alone: opening FROM ORBES there would read it, and NOW's line of a house message would go.
    states: ['account-messages-house-unread'],
    reason: 'Decision 5 (D14) and lot M2: MESSAGES is a page of its own on a computer, opened on the newest subject (the conversation, FROM ORBES with NEW in the list); the phone’s sheet stood over NOW.',
    now: 'NOW’s own words on NOW, its line of the message from ORBES still unread.',
    where: 'under',
  },
  ...[['draw-drawn'], ['draw-place-held', '2 · NO TIER · 0 YEARS']].map(([id, more]) => ({
    states: [id!],
    values: ['1 · TITANE · 0 YEARS', 'YOURS', ...(more ? [more] : [])],
    reason: 'Desktop (§10.30): THE ENTRIES is a table on a computer, its rows drawn as they near the window (content-visibility), the first window showing its head.',
    now: 'In THE ENTRIES’ rows, read as the page is scrolled to them: RANK, TIER, SENIORITY, IDENTIFIER and YOURS in their cells.',
    where: 'scrolled' as const,
  })),
  {
    states: ['sign-up', 'pieces-sign-in-refused', 'result-forgotten-password', 'signin-reset-email', 'signin-reset-sent'],
    reason: 'Decision 6: SIGN IN and CREATE ACCOUNT open the sign-in page on a computer, in the place of the page they were pressed on.',
    now: 'On the page they were pressed on (MY PIECES, the result), which the sign-in page gives way to.',
    where: 'back',
  },
  {
    states: ['result-registered-signed-out', 'result-unusual-card', 'result-stress'],
    values: ['EMAIL', 'PASSWORD', 'FORGOTTEN PASSWORD?'],
    reason: 'Decision 6: where a phone embeds the sign-in form, a computer shows its lead and the line SIGN IN · CREATE ACCOUNT.',
    now: 'On the sign-in page (/verify/sign-in), which the line opens.',
    where: 'sign-in',
  },
  {
    states: ['pieces-orders', 'pieces-orders-stress', 'claim-waiting', 'orders-delivery', 'orders-case'],
    reason: 'Decision 5: MY PIECES’ ORDERS lists rows on a computer, each opening its order’s page.',
    now: 'On MY PIECES’ ORDERS rows and on each order’s page (/verify/orders/OR-…).',
    where: 'orders',
  },
  {
    states: ROOM_ENDS.filter((id) => id !== 'after-room-over'),
    values: ['TITANE', 'NOW', 'COLLECTION', 'CIRCLE', 'PIECES', 'SCAN'],
    reason: 'Decision 7: the room and the after-room have no menu, SCAN nor account on a computer, their ends included (the phone’s room hides them too).',
    now: 'Nowhere in the room: THE RELEASES and the room’s foot lead out of it.',
    removed: true,
  },
  {
    states: ['after-room-over'],
    values: ['TITANE', 'NOW', 'COLLECTION', 'CIRCLE', 'SCAN'],
    reason: 'Decision 7: the after-room has no menu, SCAN nor account on a computer, its end included (MY PIECES stays, in its sentence).',
    now: 'Nowhere in the room: THE RELEASES and the room’s foot lead out of it.',
    removed: true,
  },
  {
    states: ['after-room-door', 'room-not-eligible', 'live-queue', 'live-queue-paused'],
    values: ['·'],
    reason: 'Decision 7: the room’s foot is one row on a computer, its links spaced, without the phone’s dot between PRIVACY and TERMS.',
    now: 'Nowhere: PRIVACY, TERMS, LEGAL and HELP stand in the room’s foot.',
    removed: true,
  },
  {
    states: ['collection-empty'],
    values: ['SIGN IN SCAN ORBES CODE'],
    reason: 'Desktop (decision 6 and §10.17): SIGN IN is the top bar’s, beside SCAN, on a computer.',
    now: 'SIGN IN in the top bar, SCAN ORBES CODE in the page.',
    shownAs: ['SIGN IN', 'SCAN ORBES CODE'],
  },
  {
    states: ['sign-up'],
    values: ['Creating an ORBES account means accepting the ORBES terms of use. TERMS OF USE · PRIVACY POLICY'],
    reason: 'Decision 6: on the sign-in page, the links TERMS OF USE · PRIVACY POLICY stand on their own line, the sentence under them.',
    now: 'On the sign-in page’s CREATE ACCOUNT, the two apart.',
    shownAs: ['Creating an ORBES account means accepting the ORBES terms of use.', 'TERMS OF USE · PRIVACY POLICY'],
  },
];

/**
 * Desk states made from a phone's state that show another screen than it (a route or a step of their own): no twin.
 * Each with its reason.
 */
export const NOT_TWINS: Readonly<Record<string, string>> = Object.freeze({
  'result-void-warranty': 'Its own state: the ORBES CARE tab of a warranty no longer valid (a route), which no phone state shows; its phone counterpart’s OWNERSHIP tab is desk-result-registered-signed-out’s.',
});

/** The phone's state a desk state is the twin of (its `refs`: `phone: <id>`), or null. */
export function phoneTwin(s: UiState): string | null {
  const id = s.refs.find((r) => r.startsWith('phone: '))?.slice('phone: '.length) ?? null;
  if (!id) return null;
  const name = s.id.replace(/^desk-(light-)?/, '').replace(/-(1024|1920)$/, '');
  return Object.hasOwn(NOT_TWINS, name) ? null : id;
}

const lower = (t: string) => normalizeText(t);

/** `value` in a computer's words (every swap of DESKTOP_WORDS that applies), normalized; null when none applies. */
export function inComputerWords(value: string): string | null {
  let v = lower(value);
  let changed = false;
  for (const w of DESKTOP_WORDS) {
    const [p, c] = [lower(w.phone), lower(w.computer)];
    if (w.whole ? v === p : v.includes(p)) {
      v = w.whole ? c : v.split(p).join(c);
      changed = true;
    }
  }
  return changed ? v : null;
}

/** Whether `value` is shown in `texts`, or on two or three of them one after the other (a line set apart, in order). */
export function shownOrBroken(texts: readonly string[], value: string): boolean {
  if (shows(texts, value)) return true;
  for (const span of [2, 3]) {
    const joined: string[] = [];
    for (let i = 0; i + span <= texts.length; i++) joined.push(texts.slice(i, i + span).join(' '));
    if (shows(joined, value)) return true;
  }
  return false;
}

/** The DESKTOP_MOVED entry of a phone state's value, if any. */
export function movedEntry(phoneId: string, value: string): DesktopMoved | null {
  const v = lower(value);
  const of = DESKTOP_MOVED.filter((m) => m.states.includes(phoneId));
  // A value listed by name first, then a state's every value moved.
  return of.find((m) => m.values?.some((x) => lower(x) === v)) ?? of.find((m) => !m.values) ?? null;
}

/** The outcome for one phone value on its computer twin, from the computer's own texts (`where` texts read apart). */
export type Verdict = { shown: true; by: 'itself' | 'words' | 'apart' | 'removed' } | { shown: false; where?: Where | readonly Where[] };

export function judge(phoneId: string, value: string, texts: readonly string[]): Verdict {
  if (shownOrBroken(texts, value)) return { shown: true, by: 'itself' };
  const words = inComputerWords(value);
  if (words !== null && shownOrBroken(texts, words)) return { shown: true, by: 'words' };
  const m = movedEntry(phoneId, value);
  if (m?.removed) return { shown: true, by: 'removed' };
  if (m?.shownAs) return m.shownAs.every((p) => shownOrBroken(texts, p)) ? { shown: true, by: 'apart' } : { shown: false };
  return m?.where ? { shown: false, where: m.where } : { shown: false };
}

/**
 * The page's words as the content test reads them (pageTexts: its blocks of words), and its lines as the browser lays
 * them out (`innerText`, one per line, a table's row on one line): a line the computer's layout breaks inside an inline
 * box (a time set on two lines) is read whole there, where pageTexts reads blocks only.
 */
export async function computerTexts(page: Page): Promise<{ blocks: string[]; lines: string[] }> {
  const blocks = await pageTexts(page);
  const lines = (await page.evaluate(() => document.body.innerText)).split('\n').map(normalizeText).filter((l) => l.length > 0);
  return { blocks, lines };
}

/** Whether `value` (or its computer's words) is shown in the page's blocks or lines. */
function shownIn(t: { blocks: readonly string[]; lines: readonly string[] }, value: string): boolean {
  const words = inComputerWords(value);
  return [value, ...(words === null ? [] : [words])].some((v) => shownOrBroken(t.blocks, v) || shownOrBroken(t.lines, v));
}

/** The page's texts once it rests. */
async function textsNow(page: Page, ms = 300): Promise<{ blocks: string[]; lines: string[] }> {
  await settle(page, ms);
  return computerTexts(page);
}

/** The texts of the page `where` names, read in the window of `run` right after its state (the state is left). */
export async function whereTexts(run: StateRun, state: UiState, where: Where): Promise<{ blocks: string[]; lines: string[] }> {
  const { page, stage, demo } = run;
  if (where === 'under') {
    await page.goto(`${stage.origin}${state.path(demo)}`);
    await page.locator(':is(.view--now[data-ready], .view--piece .n-piece__article, .view--pieces .n-pieces__panel)').first().waitFor({ timeout: 30_000 });
    return textsNow(page, 600);
  }
  if (where === 'back') {
    await page.goBack();
    await page.locator('main.view:not([hidden]):not(.view--signin)').first().waitFor({ timeout: 30_000 });
    return textsNow(page, 600);
  }
  if (where === 'sign-in') {
    await page.goto(`${stage.origin}/verify/sign-in`);
    await page.locator('.view--signin form').first().waitFor({ timeout: 30_000 });
    return textsNow(page);
  }
  const out = { blocks: [] as string[], lines: [] as string[] };
  const add = (t: { blocks: string[]; lines: string[] }) => {
    out.blocks.push(...t.blocks);
    out.lines.push(...t.lines);
  };
  if (where === 'scrolled') {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = Math.round((page.viewportSize()?.height ?? 800) * 0.8);
    for (let y = 0; y < height; y += step) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      add(await textsNow(page, 150));
    }
    return out;
  }
  if (where === 'subjects') {
    // MESSAGES' page as it stands (the state's), then each of its subjects chosen.
    const subjects = page.locator('.d-msg .d-msg__subject');
    const keys = await subjects.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key ?? ''));
    for (const key of keys) {
      const subject = page.locator(`.d-msg .d-msg__subject[data-key="${key}"]`);
      await subject.click();
      await page.locator(`.d-msg .d-msg__subject.is-current[data-key="${key}"]`).waitFor({ timeout: 30_000 });
      add(await textsNow(page));
    }
    return out;
  }
  // MY PIECES' ORDERS, its rows, then each order's page.
  await page.goto(`${stage.origin}/verify/pieces`);
  await page.locator('.view--pieces .n-pieces__tabs').waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^ORDERS\s*\d*$/ }).first().click();
  await page.locator('.view--pieces[data-tab="orders"] .d-orow').first().waitFor({ timeout: 30_000 });
  add(await textsNow(page));
  const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('.view--pieces a.d-orow')].map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs.filter((h) => h.length > 0)) {
    await page.goto(`${stage.origin}${href}`);
    await page.locator('.view--order .d-order__head').waitFor({ timeout: 30_000 });
    add(await textsNow(page));
  }
  return out;
}

const WHERE_WORDS: Readonly<Record<Where, string>> = Object.freeze({
  under: 'on the page under the sheet',
  back: 'on the page it was opened from',
  'sign-in': 'on the sign-in page',
  orders: 'on the orders and their pages',
  subjects: 'under each subject of MESSAGES',
  scrolled: 'on the page scrolled to its foot',
});

/**
 * The phone's values (`phoneValues`, the baseline of its state `phoneId`) the computer's state of `run` does not show:
 * each judged on the state's own page, those moved to another page then read there (`run` leaves the state for it).
 */
export async function parityMissing(run: StateRun, state: UiState, phoneId: string, phoneValues: readonly string[]): Promise<string[]> {
  const here = await computerTexts(run.page);
  const missing: string[] = [];
  const elsewhere = new Map<string, string[]>();
  for (const value of phoneValues) {
    if (shownIn(here, value)) continue;
    const m = movedEntry(phoneId, value);
    if (m?.removed || m?.run) continue;
    if (m?.shownAs) {
      if (!m.shownAs.every((p) => shownIn(here, p))) missing.push(`${value} (shown apart as ${m.shownAs.join(' + ')})`);
      continue;
    }
    if (m?.where) {
      const places = typeof m.where === 'string' ? [m.where] : m.where;
      elsewhere.set(places.join(' '), [...(elsewhere.get(places.join(' ')) ?? []), value]);
    } else missing.push(value);
  }
  // Each set of places read once, in its order (the state left for the first).
  for (const [key, values] of elsewhere) {
    const places = key.split(' ') as Where[];
    const there = { blocks: [] as string[], lines: [] as string[] };
    for (const where of places) {
      const t = await whereTexts(run, state, where);
      there.blocks.push(...t.blocks);
      there.lines.push(...t.lines);
    }
    for (const value of values) if (!shownIn(there, value)) missing.push(`${value} (looked for ${places.map((w) => WHERE_WORDS[w]).join(', then ')})`);
  }
  return missing;
}
