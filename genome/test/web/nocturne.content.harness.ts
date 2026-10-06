/**
 * NOCTURNE's content test (plan NOCTURNE, fidelity rule 4: every field and every state), shared by its files. The
 * baseline (test/fixtures/nocturne-baseline.json, recorded by scripts/parity.ts --baseline on the app as it was before
 * NOCTURNE, 5efd4c9) holds every text value each state of /verify and /legal showed on the NOCTURNE demo; the test reaches
 * each state again (test/support/nocturne-states.ts) and checks that each value is still shown there (shows: within one
 * block of words, on word boundaries, case-insensitive, whitespace folded, a value « A · B » shown whole or part by part,
 * the parts the server writes («id», «ref», «code»…) read as any text of their shape).
 *
 * The states are run in shards (CONTENT_SHARDS), one test file each (test/web/nocturne.content-<shard>.e2e.test.ts), so
 * vitest's forks run them side by side, each within its own time limit; test/web/nocturne.content.e2e.test.ts checks that
 * the shards hold every state once. A shard keeps the states of a variant that write (`mutates`) together and in order:
 * each one finds the demo as the states before it in the baseline's run left it.
 *
 * Nothing may disappear but what MOVED lists: a value moved (or removed) on purpose, with its reason and its new place.
 * Each entry names a value of the baseline, so the list can never excuse a value that was not there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUB_TIER_DEFAULT_BENEFITS } from '../../src/server/services/club.js';
import { LIVE, RELEASES, TIER } from '../../src/web/verify/copy.js';
import { NOCTURNE_NOW } from '../support/nocturne-demo.js';
import { BASELINE_FILE, eachState, type Baseline } from '../support/nocturne-stage.js';
import { myPiecesTexts, normalizeText, openState, pageTexts, shows, UI_STATES, type UiState } from '../support/nocturne-states.js';
import { CHROMIUM_PATH } from '../support/ui-stage.js';

export const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);

export function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

/** A value moved or removed on purpose: the state it was in, the value, why, and where it is now. */
export interface Moved {
  state: string;
  value: string;
  reason: string;
  now: string;
  /** The value set apart, part by part, in the same state: each part must still be shown there. */
  shownAs?: readonly string[];
}

/** The states whose piece had its own photograph (the demo's boutique piece, O26-J-00184), with THE MODEL's beside it. */
const PIECE_PHOTO_STATES = [
  'result-registered-signed-out',
  'result-registered-transfer-link',
  'result-registered-other',
  'pieces',
  'pieces-warranty',
  'pieces-care',
  'pieces-service',
  'pieces-certificate-choice',
  'pieces-report-choice',
  'pieces-care-guide',
  'pieces-change-password',
  'pieces-certificate-link',
  'pieces-certificate-withdrawn',
];

/**
 * MY PIECES in every state the stage reaches it (its own states, and those of the draws', the room's, the stress and
 * the empty demos): YOUR TIER was at its head until N2.
 */
const TIER_STATES = [
  'pieces',
  'pieces-warranty',
  'pieces-care',
  'pieces-service',
  'pieces-certificate-choice',
  'pieces-report-choice',
  'pieces-care-guide',
  'pieces-change-password',
  'pieces-certificate-link',
  'pieces-certificate-withdrawn',
  'pieces-incidents',
  'pieces-piece-found',
  'pieces-question-after',
  'pieces-turn-passed',
  'pieces-draws',
  'pieces-empty',
  'pieces-stress',
  'live-pieces-turn',
];

/**
 * The words of YOUR TIER (P-X04) as MY PIECES showed them (tier-model.ts, TIER): its label (THE CLUB without a tier),
 * the pieces it counts, NEXT and the way to it, the first tier for an account without one, PALLADIUM the highest, and
 * the benefits as ORBES words them (CLUB_TIER_DEFAULT_BENEFITS, the demo's).
 */
const TIER_WORDS: readonly RegExp[] = [
  new RegExp(`^(${TIER.label}|${TIER.noneLabel})$`),
  /^\d+ pieces? held$/,
  /^NEXT: (TITANE|PLATINE|PALLADIUM)$/,
  /^\d+ more pieces? registered to your account opens? (TITANE|PLATINE|PALLADIUM), from \d+ pieces held\. It adds:$/,
  new RegExp(`^${TIER.first('TITANE').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  new RegExp(`^${TIER.top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  new RegExp(`^${TIER.counted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
];
const TIER_BENEFITS = new Set(Object.values(CLUB_TIER_DEFAULT_BENEFITS).flatMap((b) => b.split('\n')));

/** Each value of YOUR TIER in the baseline of each MY PIECES state: the list names only values that were there. */
function tierMoves(): Moved[] {
  const baseline = readBaseline();
  return TIER_STATES.flatMap((state) =>
    (baseline.states[state]?.values ?? [])
      .filter((v) => TIER_BENEFITS.has(v) || TIER_WORDS.some((re) => re.test(v)))
      .map((value) => ({
        state,
        value,
        reason: 'Decision 10 (N2): YOUR TIER leaves MY PIECES, the whole block, THE CLUB and what a first piece opens included.',
        now: 'The account sheet (C2), opened by the header\'s account button (the tier\'s name and the monogram): YOUR TIER, its five dots, its benefits, NEXT.',
      })),
  );
}

/** The states whose PRODUCT tab named the field set at issuance VARIANT. */
const SIZE_STATES = ['result-first-registration-product', 'result-ownership-verified-product', 'result-ceremony'];

/** NOW's states (N3), and the account sheet's over NOW: the landing they showed until then gave way to NOW (plan NOCTURNE, screen 1). */
const NOW_STATES = [
  'now-signed-out',
  'now-signed-in',
  'now-draw-leads',
  'now-draw-soon',
  'now-draw-early',
  'now-collection-leads',
  'now-collection-leads-signed-out',
  'now-room-open',
  'now-live',
  'now-empty',
  'now-stress',
  // The account sheet over NOW (C2): the page under it.
  'account-sheet',
  'account-sheet-club',
  'account-sheet-stress',
  'account-sheet-password',
];

/** NOW's states whose banner counted down to a LIVE RELEASE announced (its hours past 24 a day or more ahead). */
const NOW_COUNTDOWN_STATES = ['now-signed-out', 'now-signed-in', 'account-sheet-club', 'account-sheet-password'];

function nowMoves(): Moved[] {
  const baseline = readBaseline();
  const has = (state: string, value: string) => (baseline.states[state]?.values ?? []).includes(value);
  return [
    ...NOW_STATES.filter((state) => has(state, 'AUTHENTICATION')).map((state) => ({
      state,
      value: 'AUTHENTICATION',
      reason: 'N3 (plan screen 1, C1, C10, C42, C43): NOW replaces the landing, whose title read ORBES AUTHENTICATION over the resting orbit.',
      now: 'Removed with the landing: the header says ORBES on every screen, and NOW opens on what leads (a release, a draw, the newest model), YOUR PIECES or the scan.',
    })),
    ...NOW_STATES.filter((state) => has(state, 'THE RELEASES')).map((state) => ({
      state,
      value: 'THE RELEASES',
      reason: 'N3: the landing\'s text link to THE RELEASES gave way to the rail of chapters (N2) and to NOW\'s release itself (C1, C42).',
      now: 'The rail\'s RELEASES on every screen, with its dot while a release is announced; SEE THE RELEASE on what leads NOW.',
    })),
    ...NOW_STATES.filter((state) => has(state, 'THE COLLECTION') && state === 'now-empty').map((state) => ({
      state,
      value: 'THE COLLECTION',
      reason: 'N3: with no model shown, NOW has no photograph of the collection to show, nor its link under it (plan: NOW then opens on YOUR PIECES or the scan).',
      now: 'The rail\'s COLLECTION, on every screen: THE COLLECTION and its sentence for a collection with no model yet.',
    })),
    ...NOW_COUNTDOWN_STATES.filter((state) => has(state, '74:11:00')).map((state) => ({
      state,
      value: '74:11:00',
      reason: 'N3 (C1, C10): on NOW the LIVE RELEASE announced leads the page itself, so its banner is MY PIECES\' alone (C3); its countdown is the hero\'s.',
      now: 'The hero of NOW: OPENS IN and the same time to the opening, in days, hours and minutes (03 · 02 · 11).',
      shownAs: ['OPENS IN', 'DAYS', 'HOURS', 'MINUTES'],
    })),
  ];
}

/**
 * N5 (plan NOCTURNE, screens 3 and 4; C3, C4, C24, C31): MY PIECES was one page, each piece with its GENOME, its tabs
 * and its declarations, then its orders, its releases and the account line. It is now split: the tabs PIECES, ORDERS
 * and RELEASES, the page of each piece (SEE THE PIECE), and the account sheet (C2) for SIGNED IN AS, CHANGE PASSWORD
 * and SIGN OUT. Each of these states showed that one page: a value not shown in the state itself is looked for in
 * every part of the account's MY PIECES (myPiecesTexts), in the same phone, right after.
 */
export const SPLIT: Readonly<{ states: readonly string[]; reason: string; now: string }> = Object.freeze({
  states: [
    'pieces',
    'pieces-warranty',
    'pieces-care',
    'pieces-service',
    'pieces-certificate-choice',
    'pieces-report-choice',
    'pieces-care-guide',
    'pieces-change-password',
    'pieces-incidents',
    'pieces-piece-found',
    'pieces-question-after',
    'pieces-turn-passed',
    'pieces-draws',
    'pieces-stress',
    'pieces-certificate-link',
    'pieces-certificate-withdrawn',
    'live-pieces-turn',
    'pieces-empty',
  ],
  reason: 'N5 (C3, C4, C24, C31): the one page of MY PIECES split into its tabs, the page of each piece and the account sheet.',
  now: 'MY PIECES: PIECES, ORDERS and RELEASES; each piece\'s page (its GENOME, its tabs, its declarations); the account sheet (SIGNED IN AS, CHANGE PASSWORD, SIGN OUT).',
});

/**
 * N5: MY PIECES' own links and headings that gave way to NOCTURNE's navigation: THE COLLECTION, THE RELEASES and THE
 * CIRCLE at its foot (the rail's chapters, N2 and N3 alike), YOUR ORDERS and YOUR RELEASES (its tabs ORDERS and RELEASES).
 */
function piecesMoves(): Moved[] {
  const baseline = readBaseline();
  const has = (state: string, value: string) => (baseline.states[state]?.values ?? []).includes(value);
  const rail = ['THE COLLECTION', 'THE RELEASES', 'THE CIRCLE'];
  const tabs: Record<string, string> = { 'YOUR ORDERS': 'ORDERS', 'YOUR RELEASES': 'RELEASES' };
  return SPLIT.states.flatMap((state) => [
    ...rail
      .filter((value) => has(state, value))
      .map((value) => ({
        state,
        value,
        reason: 'N5 (C3): MY PIECES\' text links to the other chapters gave way to the rail of chapters (N2), as NOW\'s did (N3).',
        now: `The rail's ${value.replace(/^THE /, '')}, on every screen.`,
      })),
    ...Object.entries(tabs)
      .filter(([value]) => has(state, value))
      .map(([value, tab]) => ({
        state,
        value,
        reason: 'N5 (C3, C24, C31): the section of MY PIECES became its tab.',
        now: `The tab ${tab} of MY PIECES, with its count.`,
      })),
    // The steps of an order of several steps are dated by day and month (C24, C32: five columns hold no year).
    ...ORDER_STEP_DATES.filter((value) => has(state, value)).map((value) => ({
      state,
      value,
      reason: 'N5 (C24, C32): the steps of an order reached on several days are dated by their day and month, the year of the first said by none of them.',
      now: 'The ORDERS tab of MY PIECES: the same day and month under its step.',
      shownAs: [value.replace(/ \d{4}$/, '')],
    })),
    // SIGNED IN AS you@example.com is the account sheet's (C2): its label, then the email.
    ...(baseline.states[state]?.values ?? [])
      .filter((value) => /^SIGNED IN AS \S+@\S+$/.test(value))
      .map((value) => ({
        state,
        value,
        reason: 'N5 (C2, C3): MY PIECES\' account line gave way to the account sheet, which says the same.',
        now: 'The account sheet (C2): SIGNED IN AS and the email, CHANGE PASSWORD, SIGN OUT.',
        shownAs: ['SIGNED IN AS', value.replace(/^SIGNED IN AS /, '')],
      })),
  ]);
}

/** The dates of the demo's orders (the full demo's, the stress demo's, the draws demo's), as their steps showed them before N5 (with the year). */
const ORDER_STEP_DATES = ['14 SEP 2026', '15 SEP 2026', '16 SEP 2026', '18 SEP 2026', '20 SEP 2026', '22 SEP 2026', '24 SEP 2026', '2 OCT 2026', '11 SEP 2026', '25 SEP 2026'];

/**
 * N5: MY PIECES before its pieces are read (ONE MOMENT…, could not be shown) and signed out (C18): its foot (SCAN ORBES
 * CODE, THE COLLECTION, THE RELEASES) and, signed in, its account line gave way to the chrome and the account sheet.
 */
function piecesChromeMoves(): Moved[] {
  const baseline = readBaseline();
  const where: Record<string, string> = {
    'SCAN ORBES CODE': 'The SCAN ring at the foot of every screen; once the pieces are read, ADD A PIECE and its SCAN ORBES CODE (C3).',
    'THE COLLECTION': 'The rail\'s COLLECTION, on every screen.',
    'THE RELEASES': 'The rail\'s RELEASES, on every screen.',
    'THE CIRCLE': 'The rail\'s CIRCLE, on every screen.',
    'CHANGE PASSWORD': 'The account sheet (C2, C39), from the header\'s account button.',
    'SIGN OUT': 'The account sheet (C2), from the header\'s account button.',
  };
  return ['pieces-signed-out', 'pieces-sign-in-refused', 'pieces-loading', 'pieces-failed'].flatMap((state) =>
    (baseline.states[state]?.values ?? [])
      .filter((value) => value in where || /^SIGNED IN AS \S+@\S+$/.test(value))
      .map((value) => ({
        state,
        value,
        reason: 'N5 (C3, C18, C40): MY PIECES keeps to its title, its sentence and its state while its pieces are read or the sign-in is asked; its foot and its account line were the chrome\'s and the account sheet\'s to say.',
        now: where[value] ?? 'The account sheet (C2): SIGNED IN AS and the email.',
      })),
  );
}

/**
 * N6 (C5, C6): THE COLLECTION's own SCAN ORBES CODE at its foot gave way to the SCAN ring, as MY PIECES' did (N5); a
 * visitor's page keeps the words in THE PRIVATE SALON's teaser (addition 7), an owner's has the ring alone.
 */
function collectionMoves(): Moved[] {
  const baseline = readBaseline();
  return ['collection', 'collection-stress']
    .filter((state) => (baseline.states[state]?.values ?? []).includes('SCAN ORBES CODE'))
    .map((state) => ({
      state,
      value: 'SCAN ORBES CODE',
      reason: 'N6 (C5): THE COLLECTION draws no button of its own at its foot; the scan is the SCAN ring\'s, at the foot of every screen.',
      now: 'The SCAN ring at the foot of the screen (SCAN); for a visitor, THE PRIVATE SALON\'s teaser\'s SCAN ORBES CODE.',
    }));
}

/**
 * N7 (C7, C19, C20, C25, C27–C30): THE RELEASES and a release's pages in NOCTURNE's pieces. Their own foot (SCAN ORBES
 * CODE, THE COLLECTION) gave way to the SCAN ring and the rail, as MY PIECES' and THE COLLECTION's did; on PAST the
 * head's sentence is the count of the releases taken part in (C25); a past release's date is its day over its title
 * (C29, C30); a rule and why, and several rules, are each said on lines of their own (C27, C28); said, YOU'LL BE THERE ·
 * SIZE 17 stands over the sizes in YOUR SIZE's place (C28).
 */
function releasesMoves(): Moved[] {
  const baseline = readBaseline();
  const values = (state: string) => baseline.states[state]?.values ?? [];
  const foot: Record<string, string> = {
    'SCAN ORBES CODE': 'The SCAN ring at the foot of every screen (SCAN).',
    'THE COLLECTION': 'The rail\'s COLLECTION, on every screen.',
  };
  const footStates = Object.keys(baseline.states).filter((state) => /^(releases|draw)(-|$)/.test(state));
  // The baseline's `5 OCT 2026` read as the page says it now: its weekday, day and month, its year after them when it is
  // not the stage's (livePastModel's pastDay), any date of the baseline, never a table of known ones.
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const pastDay = (date: string): string | null => {
    const d = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec(date);
    const month = d ? months.indexOf(d[2]!) : -1;
    if (!d || month < 0) return null;
    const at = new Date(Date.UTC(Number(d[3]), month, Number(d[1])));
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
      .formatToParts(at)
      .reduce<Record<string, string>>((parts, p) => ({ ...parts, [p.type]: p.value }), {});
    const said = `${day.weekday} ${day.day} ${day.month}`.toUpperCase();
    return d[3] === String(NOCTURNE_NOW.getUTCFullYear()) ? said : `${said} ${d[3]}`;
  };
  return [
    ...footStates.flatMap((state) =>
      values(state)
        .filter((value) => value in foot)
        .map((value) => ({
          state,
          value,
          reason: 'N7 (C7, C19, C25): THE RELEASES and a draw\'s page draw no foot of their own; the scan is the SCAN ring\'s, THE COLLECTION the rail\'s, THE RELEASES the crumb\'s.',
          now: foot[value]!,
        })),
    ),
    ...['releases-past']
      .filter((state) => values(state).includes(RELEASES.lead))
      .map((state) => ({
        state,
        value: RELEASES.lead,
        reason: 'N7 (C25): on PAST, signed in, the head\'s sentence is the count of the releases taken part in.',
        now: 'The head of THE RELEASES on its LIVE tab (and on PAST signed out); on PAST signed in: You have taken part in N releases.',
      })),
    ...['live-past-secured', 'live-past-signed-out', 'live-past-question', 'live-past-gold'].flatMap((state) =>
      values(state)
        .map((value) => {
          const m = /^(\d{1,2} [A-Z]{3} \d{4}) · (.+)$/.exec(value);
          return { value, day: m ? pastDay(m[1]!) : null, pieces: m?.[2] ?? '' };
        })
        .filter((v): v is { value: string; day: string; pieces: string } => v.day !== null)
        .map(({ value, day, pieces }) => ({
          state,
          value,
          reason: 'N7 (C29, C30): a past LIVE RELEASE\'s day is said over its title after LIVE RELEASE (its year with it when not this year\'s), its pieces under its title.',
          now: `LIVE RELEASE · ${day} over the title, ${pieces} under it.`,
          shownAs: [day, pieces],
        })),
    ),
    ...['live-veiled', 'live-rules-not-eligible', 'live-selected-not-eligible'].flatMap((state) =>
      values(state)
        .filter((value) => value.startsWith('This release is for ') && value.endsWith(LIVE.edge.notEligible.text))
        .map((value) => ({
          state,
          value,
          reason: 'N7 (C28, states 3 to 5): not eligible, the rule (when it is one), why, and that the account does not meet it, each on a line of its own.',
          now: 'In place of I\'LL BE THERE: why in the reading face, then the account\'s refusal under it.',
          shownAs: [value.slice(0, value.length - LIVE.edge.notEligible.text.length).trim(), LIVE.edge.notEligible.text],
        })),
    ),
    ...['live-rules', 'live-rules-not-eligible'].flatMap((state) =>
      values(state)
        .filter((value) => value === 'FOR OWNERS FROM PLATINE OR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES OR SELECTED COLLECTORS')
        .map((value) => ({
          state,
          value,
          reason: 'N7 (C27): several rules any one of which lets a collector in are listed under WHO MAY ENTER, one under the other, OR between them.',
          now: 'WHO MAY ENTER: FOR OWNERS FROM PLATINE, OR, FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES, OR, FOR SELECTED COLLECTORS.',
          shownAs: ['WHO MAY ENTER', 'FOR OWNERS FROM PLATINE', 'FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES', 'FOR SELECTED COLLECTORS'],
        })),
    ),
    ...['live-there']
      .filter((state) => values(state).includes(LIVE.yourSize))
      .map((state) => ({
        state,
        value: LIVE.yourSize,
        reason: 'N7 (C28, state 1): said, YOU\'LL BE THERE · SIZE 17 stands over the sizes in YOUR SIZE\'s place; the sizes keep YOUR SIZE as their name.',
        now: 'YOU\'LL BE THERE · SIZE 17 over the sizes (their group named YOUR SIZE for assistive technologies).',
        shownAs: ['YOU’LL BE THERE · SIZE 17'],
      })),
  ];
}

/**
 * The values NOCTURNE moves or removes on purpose, step by step. N1: THIS PIECE and the sentence for two photographs
 * (decision 9: the piece's own photograph leaves every collector's screen and answer; the model's alone stays,
 * captioned THE MODEL, with the sentence for one), and VARIANT (the field set at issuance renamed Size). N2: YOUR TIER
 * (decision 10: moved from MY PIECES to the account sheet), and a page's failure said on two lines (C40). N3: the landing
 * replaced by NOW (its title, its links to THE RELEASES and, with no model shown, to THE COLLECTION; the banner's countdown).
 */
export const MOVED: readonly Moved[] = [
  ...PIECE_PHOTO_STATES.flatMap((state) => [
    {
      state,
      value: 'THIS PIECE',
      reason: 'Decision 9 (N1): no photograph of the piece itself is shown to a collector; the model is the reference for a piece.',
      now: 'Removed: the model’s photograph alone, captioned THE MODEL.',
    },
    {
      state,
      value: 'Photographed by ORBES. Compare them with the piece in your hands.',
      reason: 'Decision 9 (N1): one photograph, the model’s, is shown, no longer two.',
      now: 'The sentence for one photograph: Photographed by ORBES. Compare it with the piece in your hands.',
    },
  ]),
  ...SIZE_STATES.map((state) => ({
    state,
    value: 'VARIANT',
    reason: 'N1: the piece’s field set at issuance is its size, renamed Size in the console and on a piece.',
    now: 'The same row and value, labelled SIZE.',
  })),
  ...tierMoves(),
  ...nowMoves(),
  ...piecesMoves(),
  ...piecesChromeMoves(),
  ...collectionMoves(),
  ...releasesMoves(),
  // N4 (C16): on a result that is neither authentic nor UNUSUAL ACTIVITY, WHERE DID YOU SEE OR BUY THIS PIECE? is a row
  // that opens (+): its four answers are inside it.
  ...['result-invalid', 'result-unknown', 'result-revoked'].flatMap((state) =>
    ['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER'].map((value) => ({
      state,
      value,
      reason: 'N4 (C16): the question is a row that opens (+), its answers inside it, as the canvas draws it under INVALID SIGNATURE, UNKNOWN and REVOKED.',
      now: 'The same answers, two by two, once the row WHERE DID YOU SEE OR BUY THIS PIECE? is opened (open as it was under UNUSUAL ACTIVITY, C15).',
    })),
  ),
  {
    state: 'scan-preparing',
    value: 'Align the ORBES CODE within the orbit',
    reason: 'N4 (C38): PREPARING CAMERA… stands alone, before the stream.',
    now: 'The guide shows under SCANNING… once the camera streams (scan-camera).',
  },
  {
    state: 'pieces-failed',
    value: 'Your pieces could not be shown just now. The ORBES service could not be reached. Check your connection, then try again.',
    reason: 'N2 (C40): a page that could not be shown says its sentence, then the reason on a line of its own, then TRY AGAIN.',
    now: 'The same words on two lines: the sentence in ivory, the reason in ash.',
    shownAs: ['Your pieces could not be shown just now.', 'The ORBES service could not be reached. Check your connection, then try again.'],
  },
];

const movedKey = (state: string, value: string) => `${state}\u0000${normalizeText(value)}`;
const moved = new Map(MOVED.map((m) => [movedKey(m.state, m.value), m] as const));

/** A state whose id is one of `names` or starts with one of them and a dash. */
const named =
  (...names: string[]) =>
  (s: UiState) =>
    names.some((n) => s.id === n || s.id.startsWith(`${n}-`));
const full = (s: UiState) => s.variant === 'full';
const ROOM_VARIANTS: readonly string[] = ['room', 'live', 'afterroom', 'afterroom-ends'];

/**
 * The shards of the content test, each a test file: the `full` demo by screen group (its states that write in one
 * shard of their own, in their order), the room's variants, the draws in every state, the extreme content (the stress
 * demo; its account sheet runs with the others) and the other variants. Each holds about twenty states.
 */
export const CONTENT_SHARDS: Readonly<Record<string, (s: UiState) => boolean>> = Object.freeze({
  scan: (s) => full(s) && !s.mutates && named('now', 'scan', 'photo', 'problem')(s),
  results: (s) => full(s) && !s.mutates && named('result')(s),
  // MY PIECES, and the account sheet (C2: its own, over NOW, in the full, draw-leads and stress demos).
  pieces: (s) => (full(s) && !s.mutates && named('pieces', 'piece')(s)) || named('account')(s),
  collection: (s) => full(s) && !s.mutates && named('collection', 'model')(s),
  releases: (s) => full(s) && !s.mutates && named('releases', 'draw', 'live')(s),
  circle: (s) => full(s) && !s.mutates && named('circle', 'post', 'legal', 'certificate')(s),
  writes: (s) => full(s) && !!s.mutates,
  room: (s) => ROOM_VARIANTS.includes(s.variant),
  draws: (s) => s.variant === 'draws',
  stress: (s) => s.variant === 'stress' && !named('account')(s),
  variants: (s) => !full(s) && !ROOM_VARIANTS.includes(s.variant) && s.variant !== 'draws' && s.variant !== 'stress' && !named('account')(s),
});

/** The states of shard `name`, in the order of UI_STATES. */
export function contentShard(name: string): UiState[] {
  const pick = CONTENT_SHARDS[name];
  if (!pick) throw new Error(`no content shard ${name}`);
  return UI_STATES.filter(pick);
}

/** Each shard's time limit: well under CI's, about twice what it takes on a laptop. */
export const SHARD_TIMEOUT_MS = 8 * 60_000;

/** The content test of shard `name`: every value of the baseline of each of its states, still shown in that state. */
export function contentSuite(name: string): void {
  const states = contentShard(name);
  describe.skipIf(!HAS_CHROMIUM)(`NOCTURNE content, ${name}: every value of the baseline is still shown in its state (Chromium)`, () => {
    it(
      `shows every value of the ${states.length} states of ${name}, but those moved on purpose`,
      async () => {
        const baseline = readBaseline();
        expect(states.length).toBeGreaterThan(0);
        const missing: string[] = [];
        await eachState(
          states,
          async (state, { stage, demo, browser }) => {
            const recorded = baseline.states[state.id];
            if (!recorded) throw new Error(`${state.id}: not in the baseline (scripts/parity.ts --baseline --states ${state.id})`);
            const opened = await openState(browser, stage, demo, state);
            try {
              const texts = await pageTexts(opened.page);
              /** What is not shown in the state itself: the text looked for, and how it is reported. */
              const unseen: { text: string; label: string }[] = [];
              for (const value of recorded.values) {
                const m = moved.get(movedKey(state.id, value));
                if (m) {
                  // Set apart on purpose: each of its parts is still shown there.
                  for (const part of m.shownAs ?? []) if (!shows(texts, part)) unseen.push({ text: part, label: `${part} (of «${value}»)` });
                  continue;
                }
                if (!shows(texts, value)) unseen.push({ text: value, label: value });
              }
              // MY PIECES split (N5): what its one page showed is shown in one of its parts.
              const parts = unseen.length > 0 && SPLIT.states.includes(state.id) ? await myPiecesTexts(opened) : null;
              for (const u of unseen) if (!parts || !shows(parts, u.text)) missing.push(`${state.id}: ${u.label}`);
            } finally {
              await opened.close();
            }
          },
          () => {},
        );
        expect(missing).toEqual([]);
      },
      SHARD_TIMEOUT_MS,
    );
  });
}
