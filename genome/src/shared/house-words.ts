/**
 * The house messages' words (macro scope of 2026-10-20, D24 M1; lot M2 plan §1.2, step M2.2): the default title and
 * words of each of the six moments, their placeholders and how they are rendered, and the places of the app each
 * moment's message links to. Shared by the server (services/house-moments.ts renders and stores the words at delivery;
 * the console's editor refuses an unknown placeholder) and the collector app (web/verify/copy.ts re-exports `HOUSE`, so
 * every collector word still lives in copy.ts). No import from the server or the app; beside profile-rules.ts.
 *
 *   the moments       a) FIRST_REGISTRATION, b) BIRTHDAY_CREDIT, c) CREDIT_EXPIRING, d) PRIVATE_CARE,
 *                     e) OWNERSHIP_YEAR, f) NINETY_DAYS (db/schema.ts HOUSE_MOMENTS, migration 0052).
 *   the placeholders  {firstName} (YOUR PROFILE's first name, nothing without one), {piece} (the model as the app says
 *                     it: MONOLITHE IN STEEL), {amount} (a credit's balance in its currency, the app's money format:
 *                     € 20), {expires} (a Paris date inside a sentence: 12 November 2026), {tier} (a tier's name).
 *                     Each moment has its own (HOUSE_PLACEHOLDERS); a custom message only {firstName}.
 *   the words         plain paragraphs, no Markdown, no link: a moment's links are fixed by its kind
 *                     (HOUSE_MOMENT_LINKS) and drawn by the app.
 *
 * The defaults stay true for any THE PROGRAM setting (plan §1.2, §11 note 14): no default names a channel, a mechanism
 * or a count. b) never says where a credit comes off (THE PROGRAM's channels, and later a Shopify checkout, S7); d) never
 * says how many pieces PRIVATE CARE takes (THE PROGRAM's allowance, which the piece's ORBES CARE tab states), and its
 * {tier} is the tier PRIVATE CARE opens from. test/services/house-moments.test.ts holds them to it.
 */

/** The six moments, in the scope's order (db/schema.ts HOUSE_MOMENTS; test/shared/house-words.test.ts holds them equal). */
export const HOUSE_MOMENT_NAMES = Object.freeze(['FIRST_REGISTRATION', 'BIRTHDAY_CREDIT', 'CREDIT_EXPIRING', 'PRIVATE_CARE', 'OWNERSHIP_YEAR', 'NINETY_DAYS'] as const);
export type HouseMomentName = (typeof HOUSE_MOMENT_NAMES)[number];

/** Every placeholder the words may hold. */
export const HOUSE_PLACEHOLDER_NAMES = Object.freeze(['firstName', 'piece', 'amount', 'expires', 'tier'] as const);
export type HousePlaceholder = (typeof HOUSE_PLACEHOLDER_NAMES)[number];

/** The placeholders of each moment's words (title and words alike); {firstName} in all. */
export const HOUSE_PLACEHOLDERS: Readonly<Record<HouseMomentName, readonly HousePlaceholder[]>> = Object.freeze({
  FIRST_REGISTRATION: Object.freeze(['firstName', 'piece'] as const),
  BIRTHDAY_CREDIT: Object.freeze(['firstName', 'amount', 'expires'] as const),
  CREDIT_EXPIRING: Object.freeze(['firstName', 'amount', 'expires'] as const),
  PRIVATE_CARE: Object.freeze(['firstName', 'tier'] as const),
  OWNERSHIP_YEAR: Object.freeze(['firstName', 'piece'] as const),
  NINETY_DAYS: Object.freeze(['firstName'] as const),
});

/** A custom message's only placeholder (plan §1.3). */
export const HOUSE_CUSTOM_PLACEHOLDERS: readonly HousePlaceholder[] = Object.freeze(['firstName'] as const);

/**
 * The places of the app a moment's message links to, fixed by its kind (never editable):
 *   CARE        the piece's ORBES CARE tab, where CARING FOR THIS PIECE is (MY PIECES once the piece is no longer held);
 *   SIZES       YOUR SIZES;
 *   IN_USE      the tier panel's IN USE, where the credits are shown;
 *   MY_PIECES   MY PIECES;
 *   PIECE       the piece;
 *   COLLECTION  THE COLLECTION.
 */
export const HOUSE_LINK_KINDS = Object.freeze(['CARE', 'SIZES', 'IN_USE', 'MY_PIECES', 'PIECE', 'COLLECTION'] as const);
export type HouseLinkKind = (typeof HOUSE_LINK_KINDS)[number];

export const HOUSE_MOMENT_LINKS: Readonly<Record<HouseMomentName, readonly HouseLinkKind[]>> = Object.freeze({
  FIRST_REGISTRATION: Object.freeze(['CARE', 'SIZES'] as const),
  BIRTHDAY_CREDIT: Object.freeze(['IN_USE'] as const),
  CREDIT_EXPIRING: Object.freeze(['IN_USE'] as const),
  PRIVATE_CARE: Object.freeze(['MY_PIECES'] as const),
  OWNERSHIP_YEAR: Object.freeze(['PIECE'] as const),
  NINETY_DAYS: Object.freeze(['COLLECTION'] as const),
});

/** A moment's default title (one line) and words. */
export interface HouseWords {
  title: string;
  body: string;
}

/** The default words of each moment (plan §1.2), in the house voice. */
export const HOUSE_DEFAULT_WORDS: Readonly<Record<HouseMomentName, Readonly<HouseWords>>> = Object.freeze({
  FIRST_REGISTRATION: Object.freeze({
    title: 'YOUR FIRST PIECE',
    body: '{piece} is registered to you. How to care for it is in its ORBES CARE tab, and YOUR SIZES keeps your sizes for the releases to come.',
  }),
  BIRTHDAY_CREDIT: Object.freeze({ title: 'YOUR BIRTHDAY CREDIT', body: 'A credit of {amount} is yours until {expires}.' }),
  CREDIT_EXPIRING: Object.freeze({ title: 'A CREDIT ENDS SOON', body: '{amount} of your credit ends on {expires}.' }),
  PRIVATE_CARE: Object.freeze({ title: 'PRIVATE CARE', body: 'From {tier}, ORBES offers PRIVATE CARE for your pieces. Ask from the piece, in its ORBES CARE tab.' }),
  OWNERSHIP_YEAR: Object.freeze({ title: 'ONE YEAR', body: '{piece} has been yours for a year today.' }),
  NINETY_DAYS: Object.freeze({ title: 'WHAT IS NEW', body: 'Since your last visit, THE COLLECTION and THE RELEASES have moved on.' }),
});

/**
 * The words of each link a moment's message carries (HOUSE_MOMENT_LINKS), as the app writes its places: the console's
 * preview draws them too (lot M2 step M2.4), so the two never differ.
 */
export const HOUSE_LINK_WORDS: Readonly<Record<HouseLinkKind, string>> = Object.freeze({
  CARE: 'CARING FOR YOUR PIECE',
  SIZES: 'YOUR SIZES',
  IN_USE: 'IN USE',
  MY_PIECES: 'MY PIECES',
  PIECE: 'SEE THE PIECE',
  COLLECTION: 'THE COLLECTION',
});

/** The house's words as the collector app reads them (web/verify/copy.ts re-exports it). */
export const HOUSE = Object.freeze({
  /** Each moment's default title and words (the console's RESET TO DEFAULT; what a moment says until edited). */
  moments: HOUSE_DEFAULT_WORDS,
  /** A house message's author on its author line (`ORBES · 21 OCT 2026 · 10:02`). */
  author: 'ORBES',
  /** Each link's words. */
  links: HOUSE_LINK_WORDS,
});

const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;

/** The placeholders written in `text` that `allowed` does not hold, each once, in the order written. */
export function unknownPlaceholders(text: string, allowed: readonly HousePlaceholder[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!(allowed as readonly string[]).includes(name) && !out.includes(`{${name}}`)) out.push(`{${name}}`);
  }
  return out;
}

/** The values a moment's words are rendered with: a placeholder without a value reads as nothing. */
export type HouseValues = Partial<Record<HousePlaceholder, string | null>>;

/** `text` with each known placeholder replaced by its value (nothing when it has none); anything else kept as written. */
export function renderHouseWords(text: string, values: HouseValues): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) =>
    (HOUSE_PLACEHOLDER_NAMES as readonly string[]).includes(name) ? (values[name as HousePlaceholder] ?? '') : whole,
  );
}

const SYMBOLS: Readonly<Record<string, string>> = Object.freeze({ EUR: '€', GBP: '£', USD: '$', CHF: 'CHF' });
const NBSP = '\u00a0';

/** An amount as the app writes it (web/verify/view-model.ts formatMoney): `€ 20`, `€ 4 800.50`; the groups never break. */
export function houseMoney(minor: number, currency: string): string {
  const value = Number.isFinite(minor) ? Math.max(0, Math.round(minor)) : 0;
  const units = Math.floor(value / 100);
  const cents = value % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  return `${SYMBOLS[code] ?? code}${NBSP}${grouped}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A Paris day `YYYY-MM-DD` as a sentence writes it (web/verify/view-model.ts formatDateLong): 12 November 2026. */
export function houseDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = m ? MONTHS_LONG[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : day;
}
