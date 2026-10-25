/**
 * THE VAULT page's view-model (lot Q3, step Q3.11; plan §3.5–§3.10; MK #vault-page): GET /api/v1/account/vaults → what
 * the page shows, phone and computer alike (D55). Pure (no DOM) and unit-tested, like the wishlist's model.
 *
 *   YOUR VAULTS · 2 WAITING     each waiting vault a door: its source line with its detail (MK's labels word for word,
 *                               N16: YOUR SIZE SOLD OUT · MONOLITHE IN BLUE), WAITS UNTIL a Paris day; none: one line
 *   OPENED                      compact rows, newest first: the day opened, the source's bare label, what it held (€
 *                               kept, OP-32: €25 · HOUSE CREDIT); SAVE THE IMAGE on an I WAS THERE row, GIVE IT on a credit
 *                               to give while no friend accepted it, GIVEN after (N33)
 *   HOW TO OBTAIN A VAULT       the sources switched on, each with this collector's state (N21; OP-21 THE HOUSE as it is)
 *   WHAT A VAULT CAN HOLD       the eight kinds, RARE on GUARANTEED, VAULT EDITION, THE PIECE; CREDIT never €, no odds (D45)
 *
 * Every word is copy.ts's (VAULT) or the server's own (the source labels, what a vault held). A row the app cannot read
 * is left out, never guessed. No odds anywhere on the page (D22): only an opened vault's own, in its reveal.
 */
import { ACCOUNT_PROFILE, VAULT } from './copy.js';
import type { AccountVaultsView, VaultDoorView, VaultGiftView, VaultLedgerRowView, VaultOpenedRowView, VaultRewardKind, VaultRevealView } from './types.js';
import { formatDateLong, upper } from './view-model.js';

/** THE VAULT page on a phone (the account sheet's row); a computer's is its card's, /verify/account/vault. */
export const VAULT_PAGE_PATH = '/verify/vault';
/** A friend's invitation, kept for CREATE ACCOUNT (N10). */
export const JOIN_PATH = '/verify/join';
/** A credit to give, as its friend opens it (N10). */
export const GIFT_PATH = '/verify/gift';

/** Whether a path names THE VAULT page of a phone (a trailing slash, any case). */
export function isVaultPagePath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === VAULT_PAGE_PATH;
}

const CODE_SEGMENT = /^([0-9A-Za-z-]{12,16})$/;

function codeAfter(prefix: string, pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (!path.toLowerCase().startsWith(`${prefix}/`)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(prefix.length + 1));
  } catch {
    return null;
  }
  const m = CODE_SEGMENT.exec(rest);
  if (!m) return null;
  const bare = m[1]!.replace(/-/g, '').toUpperCase();
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(bare) ? `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8)}` : null;
}

/** The invitation's code of /verify/join/<code> (XXXX-XXXX-XXXX), or null. */
export function joinCodeOf(pathname: string): string | null {
  return codeAfter(JOIN_PATH, pathname);
}

/** The credit to give's code of /verify/gift/<code> (XXXX-XXXX-XXXX), or null. */
export function giftCodeOf(pathname: string): string | null {
  return codeAfter(GIFT_PATH, pathname);
}

/** Whether a path is a join or a gift page (the code itself may be malformed: the page says so). */
export function vaultLinkOf(pathname: string): 'join' | 'gift' | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path.startsWith(`${JOIN_PATH}/`)) return 'join';
  if (path.startsWith(`${GIFT_PATH}/`)) return 'gift';
  return null;
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** A Paris day `YYYY-MM-DD` as THE VAULT writes it (MK: `27 NOVEMBER`); '' when unreadable. */
export function vaultDay(ymd: string | null | undefined): string {
  const m = typeof ymd === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : '';
}

/**
 * The odds as the vault writes them (`1 IN 200`; `1 IN 2,000` grouped, as the reference writes its demo's): the server's
 * `1 IN N` with its figures grouped; anything else as it came.
 */
export function vaultOdds(odds: string | null | undefined): string {
  const m = typeof odds === 'string' ? /^1 IN (\d+)$/.exec(odds.trim()) : null;
  return m ? `1 IN ${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : (odds ?? '');
}

/** The quiet number next to THE VAULT (D18): how many wait, nothing when none (or unread). */
export function vaultQuietNumber(waiting: number | null | undefined): string | null {
  return typeof waiting === 'number' && Number.isInteger(waiting) && waiting > 0 ? String(waiting) : null;
}

/** NOW's line (D18): its words while a vault waits; null otherwise. */
export function nowVaultLine(waiting: number | null | undefined): { label: string; action: string } | null {
  return typeof waiting === 'number' && Number.isInteger(waiting) && waiting > 0 ? { label: VAULT.now.label(waiting), action: VAULT.now.open } : null;
}

/** A door of YOUR VAULTS. */
export interface VaultDoorModel {
  id: string;
  /** `YOUR SIZE SOLD OUT · MONOLITHE IN BLUE`. */
  line: string;
  /** `WAITS UNTIL 27 NOVEMBER`. */
  until: string;
  /** Its name for a reader. */
  label: string;
  /** What its I WAS THERE image says, should it hold the card. */
  image: IWasThereInput;
}

/** What the I WAS THERE image says (D11; N4): the release (or the occasion), its date; nothing else. */
export interface IWasThereInput {
  /** `LIVE RELEASE`, or the occasion's label (`A NEW TIER`). */
  eyebrow: string;
  /** `MONOLITHE IN BLUE`, `PLATINE`; null without one. */
  name: string | null;
  /** `3 OCTOBER 2026`. */
  date: string;
}

/** An OPENED row's action (N33), in MK's text-link style. */
export type VaultOpenedAction = { kind: 'save'; image: IWasThereInput } | { kind: 'give'; code: string } | { kind: 'given' };

/** A row of OPENED. */
export interface VaultOpenedModel {
  id: string;
  /** `28 OCTOBER`. */
  day: string;
  /** `A NEW PIECE`. */
  label: string;
  /** `€25 · HOUSE CREDIT`. */
  held: string;
  action: VaultOpenedAction | null;
}

/** A row of HOW TO OBTAIN A VAULT. */
export interface VaultLedgerModel {
  source: VaultLedgerRowView['source'];
  label: string;
  line: string;
  /** This collector's state: its words; `link` makes it MK's underlined link; `done` its tick (✓ DONE). */
  state: { text: string; link: 'worn' | 'invite' | 'profile' | null; done: boolean } | null;
  /** A NEW TIER's progress on its horizon (MK: 7 OF 10 PIECES), its fraction 0–1; null elsewhere. */
  progress: { fraction: number; of: string } | null;
}

/** A cell of WHAT A VAULT CAN HOLD. */
export interface VaultGridModel {
  kind: VaultRewardKind;
  label: string;
  line: string;
  rare: boolean;
}

export interface VaultPageModel {
  /** `YOUR VAULTS · 2 WAITING`, or `YOUR VAULTS`. */
  heading: string;
  doors: VaultDoorModel[];
  /** "No vault is waiting." when none waits but OPENED has rows; null otherwise (a first visit shows neither). */
  none: string | null;
  opened: VaultOpenedModel[];
  ledger: VaultLedgerModel[];
  grid: VaultGridModel[];
  /** Nothing waiting, nothing opened: the title, the sentence, HOW TO OBTAIN and WHAT A VAULT CAN HOLD only. */
  first: boolean;
}

const KINDS: readonly VaultRewardKind[] = ['CREDIT', 'ADDON', 'GUARANTEED', 'PRODUCT', 'CREDIT_TO_GIVE', 'I_WAS_THERE', 'VAULT_EDITION', 'THE_PIECE'];
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A Paris day `YYYY-MM-DD` with its year (`3 OCTOBER 2026`), the image's date. */
function longDay(ymd: string): string {
  const long = formatDateLong(ymd);
  return /^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(long) ? long.toUpperCase() : '';
}

/** What the I WAS THERE image of a vault says (D11; N4 for a vault without a release). */
export function iWasThere(source: string, label: string, detail: string | null, day: string): IWasThereInput {
  return { eyebrow: source === 'LIVE' ? VAULT.image.live : upper(label), name: detail ? upper(detail) : null, date: longDay(day) };
}

function door(d: VaultDoorView): VaultDoorModel | null {
  const line = upper(d?.line);
  const day = vaultDay(d?.waitsUntilDay);
  if (typeof d?.id !== 'string' || !line || !day) return null;
  const until = VAULT.page.until(day);
  return { id: d.id, line, until, label: VAULT.page.doorLabel(line, until), image: iWasThere(d.source, d.label, d.detail, typeof d.givenAt === 'string' ? parisYmd(d.givenAt) : '') };
}

/** A moment's Paris day `YYYY-MM-DD` ('' when unreadable). */
export function parisYmd(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** A moment's time in Paris, `21:14` ('' when unreadable): a right to buy's end (times in Paris first). */
export function parisTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return `${parts.hour}:${parts.minute}`;
  } catch {
    return '';
  }
}

function opened(r: VaultOpenedRowView): VaultOpenedModel | null {
  const day = vaultDay(r?.openedDay);
  const label = upper(r?.label);
  const held = upper(r?.held);
  if (typeof r?.id !== 'string' || !day || !label || !held) return null;
  let action: VaultOpenedAction | null = null;
  if (r.kind === 'I_WAS_THERE') action = { kind: 'save', image: iWasThere(r.source, r.label, r.detail, r.givenDay) };
  else if (r.kind === 'CREDIT_TO_GIVE' && r.gift) action = r.gift.given ? { kind: 'given' } : typeof r.gift.code === 'string' && r.gift.code ? { kind: 'give', code: r.gift.code } : null;
  return { id: r.id, day, label, held, action };
}

function ledgerRow(r: VaultLedgerRowView): VaultLedgerModel | null {
  const L = VAULT.ledger;
  const base = (source: VaultLedgerRowView['source']) => ({ source, label: L[source].label, line: L[source].line, state: null, progress: null });
  switch (r?.source) {
    case 'LIVE': {
      const day = vaultDay(r.next);
      return { ...base('LIVE'), state: day ? { text: L.next(day), link: null, done: false } : null };
    }
    case 'PIECE':
      return { ...base('PIECE'), state: { text: L.withNext, link: null, done: false } };
    case 'TIER': {
      if (r.next && typeof r.next.pieces === 'number' && r.next.pieces > 0) {
        const pieces = Math.max(0, Math.min(r.next.pieces, Number(r.pieces) || 0));
        return { ...base('TIER'), state: { text: L.away(upper(r.next.tier), Math.max(1, Number(r.next.away) || 1)), link: null, done: false }, progress: { fraction: pieces / r.next.pieces, of: L.of(pieces, r.next.pieces) } };
      }
      return { ...base('TIER'), state: r.tier ? { text: L.highest(upper(r.tier)), link: null, done: false } : null };
    }
    case 'WORN':
      return { ...base('WORN'), state: { text: L.send, link: 'worn', done: false } };
    case 'FRIEND':
      return { ...base('FRIEND'), state: { text: L.invite, link: 'invite', done: false } };
    case 'PROFILE':
      return { ...base('PROFILE'), state: r.done ? { text: L.done, link: null, done: true } : { text: ACCOUNT_PROFILE.percentRow(Math.max(0, Math.min(99, Math.round(Number(r.percent) || 0)))), link: 'profile', done: false } };
    case 'HOUSE':
      return { ...base('HOUSE'), state: { text: L.discretion, link: null, done: false } };
    default:
      return null;
  }
}

/** THE VAULT page from what the server read. */
export function vaultPageModel(d: AccountVaultsView): VaultPageModel {
  const doors = (Array.isArray(d?.waiting) ? d.waiting : []).map(door).filter((x): x is VaultDoorModel => x !== null);
  const rows = (Array.isArray(d?.opened) ? d.opened : []).map(opened).filter((x): x is VaultOpenedModel => x !== null);
  const ledger = (Array.isArray(d?.ledger) ? d.ledger : []).map(ledgerRow).filter((x): x is VaultLedgerModel => x !== null);
  const rare = new Map((Array.isArray(d?.grid) ? d.grid : []).map((g) => [g?.kind, g?.rare === true] as const));
  const grid = KINDS.map((kind) => ({ kind, label: VAULT.grid[kind].label, line: VAULT.grid[kind].line, rare: rare.get(kind) ?? (kind === 'GUARANTEED' || kind === 'VAULT_EDITION' || kind === 'THE_PIECE') }));
  const first = doors.length === 0 && rows.length === 0;
  return { heading: VAULT.page.waiting(doors.length), doors, none: doors.length === 0 && !first ? VAULT.page.none : null, opened: rows, ledger, grid, first };
}

/** The action under an opened reveal (N33): SAVE THE IMAGE for I WAS THERE, GIVE IT for a credit to give; null otherwise. */
export function revealAction(r: Pick<VaultRevealView, 'kind' | 'giftCode'>, image: IWasThereInput): VaultOpenedAction | null {
  if (r.kind === 'I_WAS_THERE') return { kind: 'save', image };
  if (r.kind === 'CREDIT_TO_GIVE' && typeof r.giftCode === 'string' && r.giftCode) return { kind: 'give', code: r.giftCode };
  return null;
}

/** The link a credit to give travels by (its friend's page). */
export function giftUrl(origin: string, code: string): string {
  return `${origin}${GIFT_PATH}/${encodeURIComponent(code)}`;
}

/** /verify/gift/<code> as its friend reads it. */
export interface VaultGiftModel {
  title: string;
  /** `€30 for your first piece, until 27 NOVEMBER.` */
  line: string;
  /** ACCEPT is offered. */
  canAccept: boolean;
  /** Why not (the server's words), or that it is accepted / ended; null while ACCEPT is offered. */
  note: string | null;
}

export function vaultGiftModel(g: VaultGiftView): VaultGiftModel {
  const day = vaultDay(g?.expiresDay);
  const line = VAULT.gift.line(text(g?.amount), day);
  if (g?.state === 'ACCEPTED') return { title: VAULT.gift.title, line, canAccept: false, note: VAULT.gift.accepted };
  if (g?.state !== 'OPEN') return { title: VAULT.gift.title, line, canAccept: false, note: VAULT.gift.ended };
  if (g.canAccept === true) return { title: VAULT.gift.title, line, canAccept: true, note: null };
  return { title: VAULT.gift.title, line, canAccept: false, note: text(g.refusal) || VAULT.gift.ended };
}
