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

// ── THE VAULT (lot Q3, step Q3.3; vault/SCOPE.md E6, ROUND 5) ─────────────────
//
// A vault's arrival is a FROM ORBES message (E6 "A new vault: a FROM ORBES message + a line in NOW + a quiet number next
// to THE VAULT"), delivered with the vault (services/vault.ts giveVault), never a switchable moment: no console words,
// no placeholder. ROUND 5 "'We': on the card and the vault only": these words say "we", as the card's back does ("With
// this piece, we have added a vault to your account."); plain, true lines, never "the house kept / set aside" (SCOPE I).

/** THE VAULT's sources (db/schema.ts VAULT_SOURCES), in their order. */
export const VAULT_SOURCE_NAMES = Object.freeze(['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE'] as const);
export type VaultSourceName = (typeof VAULT_SOURCE_NAMES)[number];

/**
 * Each source's label, as a waiting door's line and an OPENED row say it: the mockup's four word for word (section V:
 * YOUR SIZE SOLD OUT, A NEW PIECE, A NEW TIER, A COMPLETE PROFILE); the other three proposed (plan N16, the owner's
 * review board).
 */
export const VAULT_SOURCE_LABELS: Readonly<Record<VaultSourceName, string>> = Object.freeze({
  LIVE: 'YOUR SIZE SOLD OUT',
  PIECE: 'A NEW PIECE',
  TIER: 'A NEW TIER',
  WORN: 'A PHOTOGRAPH IN WORN',
  FRIEND: 'A FRIEND’S FIRST PIECE',
  PROFILE: 'A COMPLETE PROFILE',
  HOUSE: 'FROM THE HOUSE',
});

/** A waiting door's source line: its label, then its detail when it has one (`YOUR SIZE SOLD OUT · MONOLITHE IN BLUE`). */
export function vaultSourceLine(source: VaultSourceName, detail: string | null): string {
  const label = VAULT_SOURCE_LABELS[source] ?? '';
  return detail ? `${label} · ${detail}` : label;
}

/** The arrival's title, for one vault and for more (an occasion may give up to ten: CLUB > THE VAULT). */
export const VAULT_ARRIVED_TITLE = Object.freeze({ one: 'A VAULT IS WAITING FOR YOU', many: (n: number) => `${n} VAULTS ARE WAITING FOR YOU` });

/** What the arrival says of its occasion, before "we have added a vault to your account" (null: the sentence alone). */
const VAULT_ARRIVED_OCCASION: Readonly<Record<VaultSourceName, (detail: string | null) => string | null>> = Object.freeze({
  LIVE: (d: string | null) => (d ? `Your size sold out at the LIVE release of ${d} while you were in the line.` : 'Your size sold out at a LIVE release while you were in the line.'),
  PIECE: () => null,
  TIER: (d: string | null) => (d ? `You have reached ${d}.` : null),
  WORN: () => 'Your photograph is published in WORN.',
  FRIEND: () => 'A friend you invited has registered their first piece.',
  PROFILE: () => 'Your profile is complete.',
  HOUSE: () => null,
});

/**
 * A vault's arrival, rendered at its delivery (house_deliveries, source VAULT, title and words stored): its occasion, the
 * vaults added, until when they are kept (a Paris day, as a sentence writes it) and where to open them.
 *   `detail`  the occasion's detail: the release's piece (MONOLITHE IN BLUE), the new piece's, the tier reached (PLATINE).
 *   `until`   the Paris day `YYYY-MM-DD` its WAITS UNTIL shows.
 */
export function vaultArrivedWords(input: { source: VaultSourceName; detail: string | null; count: number; until: string }): HouseWords {
  const n = Number.isInteger(input.count) && input.count > 1 ? input.count : 1;
  const vaults = n === 1 ? 'a vault' : `${n} vaults`;
  const occasion = VAULT_ARRIVED_OCCASION[input.source]?.(input.detail) ?? null;
  const added = input.source === 'PIECE' ? `With your new piece${input.detail ? `, ${input.detail},` : ''} we have added ${vaults} to your account.` : `We have added ${vaults} to your account.`;
  const kept = n === 1 ? `It is kept until ${houseDate(input.until)}. Open it in YOUR ACCOUNT, under THE VAULT.` : `They are kept until ${houseDate(input.until)}. Open them in YOUR ACCOUNT, under THE VAULT.`;
  return { title: n === 1 ? VAULT_ARRIVED_TITLE.one : VAULT_ARRIVED_TITLE.many(n), body: [occasion, added, kept].filter((s): s is string => !!s).join(' ') };
}

// ── THE VAULT's reveal and its receipt (lot Q3, step Q3.4; plan §2.4, §2.7, §3.11) ───────────────────────────────────
//
// What a vault held is written once at its opening (services/vault.ts open: `vaults.prize`, `prize_line`), in the
// reveal's words: its large words (the prize) and its line, from the reference's demo pattern (vault/the-vault.html
// REWARDS; plan §3.11, N30), OP-22's GUARANTEED line, € kept in the reveal (OP-32, N23). Words no mockup has (the card's
// line for a vault without a release, N4; the receipt, §2.7) are proposed for the owner's review board (N16).

/** The reveal's words of each kind. */
export const VAULT_REVEAL = Object.freeze({
  /** Above the prize, inside the box. */
  from: 'FROM THE VAULT',
  /** CREDIT: its amount (`€25`) and this line. */
  credit: 'House credit, valid 30 days.',
  /** ADDON (and a PRODUCT reward of an add-on won FREE): its name and this line (MK V "A free add-on on your next order."). */
  addon: 'Free on your next order.',
  /** GUARANTEED (OP-22 "GUARANTEED · A piece at the next LIVE release"). */
  guaranteed: Object.freeze({ prize: 'GUARANTEED', line: 'A piece at the next LIVE release.' }),
  /** A PRODUCT reward under its RIGHT TO BUY (round 2 "24 HOURS, at its usual price"): its name and this line. */
  rightToBuy: 'Yours to buy at its price, for 24 hours.',
  /** A product won FREE (a piece): its name and this line. */
  free: 'Yours, free. In YOUR ORDERS.',
  /** A VAULT EDITION (vault/the-vault.html REWARDS, without its number: SCOPE ROUND 5 "Numbers: REMOVE"): the kind's word, never the model's name (YOUR ORDERS shows it); its
   *  line the reward's own, else the reference's. */
  vaultEdition: Object.freeze({ prize: 'VAULT EDITION', line: 'Made only for the vault. Free.' }),
  /** THE PIECE: the release's piece in the entry's size. */
  thePiece: Object.freeze({ prize: 'THE PIECE', line: (piece: string, size: string | null) => (size ? `${piece}, size ${size}. Free.` : `${piece}. Free.`) }),
  /** A CREDIT TO GIVE: `€30 TO GIVE` and this line. */
  toGive: Object.freeze({ prize: (amount: string) => `${amount} TO GIVE`, line: 'For a friend’s first piece.' }),
  /** I WAS THERE (the floor): its line for a LIVE release's vault, and for a vault without a release (N4, proposed). */
  card: Object.freeze({ prize: 'I WAS THERE', release: 'Your card for this release. Save it.', other: 'Your card. Save it.' }),
});

/** Where what a vault held went (E9 "credits in YOUR ACCOUNT, products in YOUR ORDERS"), as its receipt says it. */
export const VAULT_WHERE = Object.freeze({ ACCOUNT: 'It is in YOUR ACCOUNT.', ORDERS: 'It is in YOUR ORDERS.', NONE: 'It is under THE VAULT.' } as const);
export type VaultWhere = keyof typeof VAULT_WHERE;

/** An amount as the vault writes it (OP-32 "€25 · House credit"): the symbol against the figure, `€25`, `€1 000.50`; `CHF 25`. */
export function vaultMoney(minor: number, currency: string): string {
  const said = houseMoney(minor, currency);
  return currency === 'CHF' || !/^[A-Z]{3}$/.test(currency) ? said : said.replace(NBSP, '');
}

/** The FROM ORBES receipt of an opened vault (E9 "plus a FROM ORBES message"): what it held and where it is, never other odds. */
export function vaultOpenedWords(input: { prize: string; line: string | null; where: VaultWhere }): HouseWords {
  return { title: VAULT_REVEAL.from, body: `Your vault held ${input.prize}${input.line ? ` · ${input.line}` : ''} ${VAULT_WHERE[input.where] ?? ''}`.trim() };
}

/** The house's words as the collector app reads them (web/verify/copy.ts re-exports it). */
export const HOUSE = Object.freeze({
  /** Each moment's default title and words (the console's RESET TO DEFAULT; what a moment says until edited). */
  moments: HOUSE_DEFAULT_WORDS,
  /** A house message's author on its author line (`ORBES · 21 OCT 2026 · 10:02`). */
  author: 'ORBES',
  /** Each link's words. */
  links: HOUSE_LINK_WORDS,
  /** THE VAULT's source labels (a waiting door's line, an OPENED row). */
  vaultSources: VAULT_SOURCE_LABELS,
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
