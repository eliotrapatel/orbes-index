/**
 * The client sheet's Engagement score in the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.3.6, §3.6 C.4.4
 * block 1, step 7.5), as pure functions: the block's words and its rows for each state. The score runs from 0 to 100
 * and is the sum of five parts; each row gives a part's points and, under them, the figure behind it. The server
 * calculates everything (services/engagement.ts) and sends the formula's own lines for « How the score is calculated »:
 * nothing is computed here but the words.
 *
 * Staff only: the score is never shown to the client. Every time is Paris time, in the console's way of writing dates.
 */
import { parisDayText, dayText } from './client-profile.js';
import { parisDateTime } from './links.js';
import { formatMoney } from './live.js';
import { ENGAGEMENT_PARTS, type EngagementBlock, type EngagementPart, type ScoreActKind, type SheetScore } from '../types.js';

export const ENGAGEMENT_COPY = Object.freeze({
  title: 'Engagement score',
  note: 'Staff only: never shown to the client. A fixed formula, calculated each morning from the last 12 months.',
  failed: 'The engagement score could not be read just now.',
  score: 'Score',
  how: 'How the score is calculated',
  notYet: 'Not calculated yet: the first score comes with the next morning’s calculation.',
  testEntrant: 'Test entrants have no score.',
  deleted: 'No score for a deleted account.',
  locked: 'not updated while the account is locked',
  lockedNone: 'Not calculated',
});

/** The five parts as the sheet names them. */
export const PART_LABELS: Readonly<Record<EngagementPart, string>> = Object.freeze({
  recency: 'Recency',
  frequency: 'Frequency',
  spend: 'Spend',
  speed: 'Release speed',
  attendance: 'Attendance',
});

/** The latest act in words. */
export const ACT_WORDS: Readonly<Record<ScoreActKind, string>> = Object.freeze({
  SCAN: 'a scan',
  DRAW: 'a draw entry',
  LIVE: 'a LIVE RELEASE entry',
  INTEREST: 'I’LL BE THERE',
  ORDER: 'an order',
  REGISTRATION: 'a piece registered',
});

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `GBP`, `GBP and USD`, `GBP, USD and CHF`. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Whole days since an act, at the calculation: `less than a day ago`, `1 day ago`, `12 days ago`. */
export function agoWords(days: number): string {
  if (days <= 0) return 'less than a day ago';
  return `${plural(days, 'day', 'days')} ago`;
}

/** A median in words: minutes up to two hours, then whole hours up to two days, then whole days. */
export function medianWords(minutes: number): string {
  if (minutes < 120) return plural(minutes, 'minute', 'minutes');
  if (minutes < 2 * 1440) return `${Math.floor(minutes / 60)} hours`;
  return `${Math.floor(minutes / 1440)} days`;
}

/** Recency's figure: the latest act, how long before the calculation, and its day. */
export function recencyNote(s: Pick<SheetScore, 'lastActAt' | 'lastActKind'>, calculatedAt: string | null): string {
  if (!s.lastActAt || !s.lastActKind) return 'No act in 12 months';
  const days = calculatedAt ? Math.max(0, Math.floor((Date.parse(calculatedAt) - Date.parse(s.lastActAt)) / DAY_MS)) : 0;
  return `Last act ${agoWords(days)}: ${ACT_WORDS[s.lastActKind]}, ${parisDayText(s.lastActAt)}`;
}

/** Frequency's figure: the days with an act. */
export function frequencyNote(s: Pick<SheetScore, 'activeDays'>): string {
  return s.activeDays === 0 ? 'No active day in 12 months' : `${plural(s.activeDays, 'active day', 'active days')} in 12 months`;
}

/** Spend's figure: the euros and the purchases; the pieces without a price; the currencies counted in euros. */
export function spendNote(s: Pick<SheetScore, 'spendEurMinor' | 'purchases' | 'unpriced' | 'otherCurrencies'>): string {
  if (s.purchases === 0) return 'No purchase in 12 months';
  if (s.unpriced >= s.purchases) return `${formatMoney(0, 'EUR')} in 12 months, ${plural(s.unpriced, 'piece', 'pieces')} without a price`;
  const parts = [`${formatMoney(s.spendEurMinor, 'EUR')} in 12 months`, plural(s.purchases, 'purchase', 'purchases')];
  if (s.unpriced > 0) parts.push(`${s.unpriced} without a price`);
  if (s.otherCurrencies.length > 0) parts.push(`${listWords(s.otherCurrencies)} counted in euros at the code’s ${s.otherCurrencies.length === 1 ? 'rate' : 'rates'}`);
  return parts.join(', ');
}

/** Release speed's figure: the median to enter, over the releases taken part in. */
export function speedNote(s: Pick<SheetScore, 'speedMinutes' | 'speedReleases'>): string {
  if (s.speedReleases === 0 || s.speedMinutes === null) return 'No release in 12 months';
  const over = `over ${plural(s.speedReleases, 'release', 'releases')}`;
  return s.speedMinutes === 0 ? `There at the opening, ${over}` : `Median ${medianWords(s.speedMinutes)} after opening, ${over}`;
}

/** Attendance's figure: the releases taken part in out of those open, since the 12 months' start or the account's creation. */
export function attendanceNote(s: Pick<SheetScore, 'releasesTaken' | 'releasesOpen' | 'releasesSince'>): string {
  if (s.releasesOpen === 0) return 'No release opened since the account was created';
  return `${s.releasesTaken} of ${plural(s.releasesOpen, 'release', 'releases')} since ${parisDayText(s.releasesSince)}`;
}

/** A row of the block: its label, its value (the points), the line under it, and the mark a stale score carries. */
export interface EngagementRow {
  key: 'score' | EngagementPart;
  label: string;
  value: string;
  note: string;
  /** « Not recalculated since … »: only on the Score row, when the calculations stopped. */
  stale: string | null;
}

/** The block as the sheet draws it: its rows, or one line when the account has no score by nature; the formula's lines under the rows. */
export interface EngagementView {
  rows: EngagementRow[];
  line: string | null;
  how: string[] | null;
}

const NOTES: Readonly<Record<EngagementPart, (s: SheetScore, calculatedAt: string | null) => string>> = Object.freeze({
  recency: recencyNote,
  frequency: frequencyNote,
  spend: spendNote,
  speed: speedNote,
  attendance: attendanceNote,
});

/** The Engagement score's rows and lines for a block, whatever its state. */
export function engagementView(b: EngagementBlock): EngagementView {
  const C = ENGAGEMENT_COPY;
  if (b.state === 'TEST_ENTRANT') return { rows: [], line: C.testEntrant, how: null };
  if (b.state === 'DELETED') return { rows: [], line: C.deleted, how: null };
  const locked = b.state === 'LOCKED';
  const s = b.score;
  if (!s) {
    const note = locked ? `${C.lockedNone} · ${C.locked}` : C.notYet;
    return { rows: [{ key: 'score', label: C.score, value: '—', note, stale: null }], line: null, how: null };
  }
  const calculated = `Calculated ${parisDateTime(b.calculatedAt)}`;
  const rows: EngagementRow[] = [
    {
      key: 'score',
      label: C.score,
      value: `${s.score} / 100`,
      note: locked ? `${calculated} · ${C.locked}` : calculated,
      // A locked account says why its score stands still; a stale mark would say it twice.
      stale: !locked && b.stale && b.lastRunDay ? `Not recalculated since ${dayText(b.lastRunDay)}` : null,
    },
    ...ENGAGEMENT_PARTS.map((part): EngagementRow => ({ key: part, label: PART_LABELS[part], value: `${s.points[part]} of ${b.partMax[part]}`, note: NOTES[part](s, b.calculatedAt), stale: null })),
  ];
  return { rows, line: null, how: [...b.formulaLines] };
}
