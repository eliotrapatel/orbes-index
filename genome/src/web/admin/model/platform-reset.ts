/**
 * PLATFORM RESET in the console (lot PURGE, plan §B.5; the owner's answers of 27 Oct 2026, answers 1 to 3 and Claude's
 * points 3 and 4), pure: what the Platform reset page (`#/settings/platform-reset`, views/platform-reset.ts) says and
 * the words of its two dialogs. Every figure and every number comes from the server (GET /api/admin/platform-reset):
 * the numbers after a reset are the server's `numbersAfterReset` for the date, never a constant year (H2).
 *
 *  - The state: READY, REFUSED NOW with the server's reason (Paris time first: a window, a test running, a LIVE room
 *    open), or LOCKED with when and by whom.
 *  - What goes, by group (the accounts neither test nor team in bold, D7), and what stays (the catalogue, the settings,
 *    the console logins, the founding list with the links and sources it needs, the signing key).
 *  - The lists the reset captures before the wipe (the 9 Oct lists: what stays that a test may have made, the piece
 *    reference ranges, the segments that go, the signing keys), now from the preview, after a reset from entry 1.
 *  - After a reset: its line (when, by whom, the rows deleted, entry 1's hash, the old log's head), the post-check
 *    lines (OK or failing), a refused reset's line, and the checklist (D8, M18, M21).
 *  - RESET PLATFORM's dialog (the phrase, the current password, a fresh code, the count of accounts neither test nor
 *    team, sent back with the newest sign-up's time, G18) and LOCK RESET's (D13).
 *  - After the 202: the restart notice and the poll of the session every 3 s until the platform answers again.
 */
import { formatCount } from '../format.js';
import type { AdminRole, LastPlatformReset, PlatformResetPage, PlatformResetPreview, ResetCapture, ResetPostCheckLine } from '../types.js';
import type { DialogField } from '../ui/dialog.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';
import type { Tone } from './tone.js';

/** The phrase typed to reset the platform (D2), as the server checks it. */
export const RESET_PHRASE = 'RESET PLATFORM';
/** The phrase typed to lock the reset for good (D13). */
export const LOCK_PHRASE = 'LOCK RESET';
/** After the 202: the session asked again every 3 s until the platform answers (B5.signin). */
export const RESTART_POLL_MS = 3000;

/** The page's fixed words. */
export const PLATFORM_RESET_TEXT = Object.freeze({
  eyebrow: 'Settings · Before launch',
  title: 'Platform reset',
  lead: 'Empties the platform before the launch, in one step: the catalogue, the settings, the console logins and the founding list stay; every collector account, release, order, piece and invoice goes. Only the reset holder sees this page.',
  ready: 'Nothing holds a reset now.',
  noReset: 'No reset since this page exists.',
  resetDialogTitle: 'Reset the platform',
  lockDialogTitle: 'Lock reset',
  lockBody: 'After this, PLATFORM RESET is refused for good. Do it once the platform is launched.',
  restartTitle: 'The platform is restarting.',
  restartText: 'Sign in again in a minute.',
  restartWait: 'Every session ends with the reset. The sign-in comes back here as soon as the platform answers.',
  locked: 'LOCK RESET was pressed: the reset is refused for good.',
  capturedLead: 'What a test may have left, as the reset listed it before the wipe (entry 1 of the new log). Tidy it in the console.',
  previewLead: 'What a test may have made that a reset keeps. Check it before you reset; the reset lists it again in entry 1.',
  none: 'None.',
});

/** Whether the Settings page may ask if this login is the reset holder (an ADMIN; the server answers who). */
export function mayAskHolder(role: AdminRole | null | undefined): boolean {
  return can(role, 'resetPlatform');
}

/** A hash as the page shows it: its first 12 hex characters (the full value in the tooltip). */
export function shortHash(hex: string): string {
  return hex.slice(0, 12);
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** A day in Paris, as the lists write when a row was made: `14 OCT 2026`. */
export function parisDay(v: string | null | undefined): string {
  const full = parisDateTime(v);
  return full === '—' ? full : full.split(' · ')[0]!;
}

// ── The state ──────────────────────────────────────────────────────────────

type HolderPage = Extract<PlatformResetPage, { holder: true }>;

/** READY, REFUSED NOW (the server's words, Paris time first) or LOCKED (when and by whom). */
export function resetState(p: Pick<HolderPage, 'launched' | 'refusal'>): { tone: Tone; label: string; line: string } {
  if (p.launched) return { tone: 'outline', label: 'LOCKED', line: lockedLine(p.launched) };
  if (p.refusal) return { tone: 'alert', label: 'REFUSED NOW', line: p.refusal.message };
  return { tone: 'solid', label: 'READY', line: PLATFORM_RESET_TEXT.ready };
}

/** `Locked 28 OCT 2026 · 14:05 Paris by …. The reset is refused for good.` */
export function lockedLine(l: { at: string; by: string | null }): string {
  return `Locked ${parisDateTime(l.at)}${l.by ? ` by ${l.by}` : ''}. The reset is refused for good.`;
}

/** Which buttons the page shows: none once locked; RESET PLATFORM only with a preview to state what goes. */
export function resetButtons(p: Pick<HolderPage, 'launched' | 'preview'>): { reset: boolean; lock: boolean } {
  if (p.launched) return { reset: false, lock: false };
  return { reset: p.preview !== null, lock: true };
}

// ── After a reset ──────────────────────────────────────────────────────────

/** One piece of a line: plain words, or an identifier or hash (mono). */
export interface LinePart {
  text: string;
  mono?: boolean;
}

/**
 * `Last reset 28 OCT 2026 · 14:05 Paris by …: 12 480 rows deleted. Audit log restarted: entry 1, hash 3f…. Previous
 * log ended at entry 48211, hash 9a….` (F27: the old head, so an attack before it is not erased from sight.)
 */
export function lastResetParts(r: LastPlatformReset): LinePart[] {
  const parts: LinePart[] = [{ text: `Last reset ${parisDateTime(r.at)}${r.by ? ` by ${r.by}` : ''}${r.rowsDeleted === null ? '' : `: ${plural(r.rowsDeleted, 'row', 'rows')} deleted`}. ` }];
  if (r.anchor) parts.push({ text: `Audit log restarted: entry ${r.anchor.id}, hash ` }, { text: shortHash(r.anchor.hash), mono: true }, { text: '. ' });
  else parts.push({ text: 'Audit log restarted. ' });
  if (r.oldHead) parts.push({ text: `Previous log ended at entry ${r.oldHead.id}, hash ` }, { text: shortHash(r.oldHead.hash), mono: true }, { text: '.' });
  else parts.push({ text: 'There was no previous log.' });
  return parts;
}

export function lastResetLine(r: LastPlatformReset): string {
  return lastResetParts(r)
    .map((p) => p.text)
    .join('');
}

/** A post-check line as the page shows it: its label, OK or FAILING, and what was found (the failing one in the danger tone). */
export function postCheckRow(l: ResetPostCheckLine): { label: string; mark: 'OK' | 'FAILING'; tone: Tone; value: string; failing: boolean } {
  return { label: l.label, mark: l.ok ? 'OK' : 'FAILING', tone: l.ok ? 'solid' : 'critical', value: l.value, failing: !l.ok };
}

/** The post-check's verdict: every line OK, or how many fail. */
export function postCheckVerdict(lines: readonly ResetPostCheckLine[]): string {
  const bad = lines.filter((l) => !l.ok).length;
  return bad === 0 ? 'Every check after the reset is OK.' : bad === 1 ? '1 check after the reset is failing: see the line in red.' : `${bad} checks after the reset are failing: see the lines in red.`;
}

/** One item of the checklist after a reset: its words, and the console page it leads to. */
export interface ChecklistItem {
  key: string;
  before: string;
  link?: { label: string; route: 'keys' | 'team' };
  after?: string;
}

/** The checklist after a reset (B5.check, D8, M18, M21): each a plain sentence, links to the existing pages. */
export const RESET_CHECKLIST: readonly ChecklistItem[] = Object.freeze([
  {
    key: 'key',
    before: 'At the last reset before real printing, rotate the signing key, then revoke the old one (',
    link: { label: 'Keys', route: 'keys' },
    after: '), and ask the host for a backup right after: the new key lives only in the keys volume until the nightly backup.',
  },
  { key: 'cards', before: 'Destroy every printed test card, tag and box card: piece serials restart at 00001.' },
  { key: 'documents', before: 'Discard the downloaded test invoices, credit notes, partner invoices and CSV files: INV-, CN-, P- and PC- numbers restart.' },
  { key: 'account', before: 'Re-create your collector account in the app.' },
  { key: 'logins', before: 'Disable in ', link: { label: 'Team', route: 'team' }, after: ' any console login made for a test.' },
  { key: 'tidy', before: 'Tidy in the console what a test may have left: the lists below, captured before the wipe.' },
  { key: 'anchor', before: 'Write the reset date next to any audit anchor you kept: the log restarts at entry 1.' },
]);

// ── What goes and what stays ───────────────────────────────────────────────

/** A row of What goes or What stays: its label and its value in parts (`strong`: the figure to read first). */
export interface CountRow {
  key: string;
  label: string;
  value: { text: string; strong?: boolean }[];
}

const goes = (p: PlatformResetPreview, ...tables: string[]) => tables.reduce((s, t) => s + (p.tables.find((x) => x.table === t)?.goes ?? 0), 0);
const stays = (p: PlatformResetPreview, ...tables: string[]) => tables.reduce((s, t) => s + (p.tables.find((x) => x.table === t)?.stays ?? 0), 0);

/** The tables each group of What goes reads (the rest is said in one line). */
const GOES_GROUPS: readonly { key: string; label: string; tables: readonly string[] }[] = Object.freeze([
  { key: 'accounts', label: 'Collector accounts', tables: ['accounts'] },
  { key: 'releases', label: 'Releases', tables: ['drops'] },
  { key: 'entries', label: 'Entries', tables: ['drop_entries', 'live_entries'] },
  { key: 'orders', label: 'Orders', tables: ['orders'] },
  { key: 'pieces', label: 'Pieces and identities', tables: ['products', 'genomes', 'codes'] },
  { key: 'invoices', label: 'Invoices and credit notes', tables: ['invoices'] },
  { key: 'partners', label: 'Partners', tables: ['partners', 'partner_experiences', 'partner_invoices'] },
  { key: 'links', label: 'Links', tables: ['links'] },
  { key: 'audit', label: 'Audit log', tables: ['audit_logs', 'audit_purge_gaps'] },
  { key: 'sessions', label: 'Sessions', tables: ['sessions'] },
]);

/** What goes, by group: the accounts neither test nor team in bold (D7, M10), then the rest and the total. */
export function goesRows(p: PlatformResetPreview): CountRow[] {
  const n = p.collectors.count;
  const rows: CountRow[] = [
    {
      key: 'accounts',
      label: 'Collector accounts',
      value: [
        { text: `${plural(goes(p, 'accounts'), 'account', 'accounts')}: ` },
        { text: `${formatCount(n)} neither test nor team`, strong: true },
        { text: `, ${plural(p.testEntrants, 'test entrant', 'test entrants')}.` },
      ],
    },
    { key: 'releases', label: 'Releases', value: [{ text: `${plural(goes(p, 'drops'), 'release', 'releases')}.` }] },
    { key: 'entries', label: 'Entries', value: [{ text: `${plural(goes(p, 'drop_entries', 'live_entries'), 'entry', 'entries')}.` }] },
    { key: 'orders', label: 'Orders', value: [{ text: `${plural(goes(p, 'orders'), 'order', 'orders')}.` }] },
    {
      key: 'pieces',
      label: 'Pieces and identities',
      value: [{ text: `${plural(goes(p, 'products'), 'piece', 'pieces')}, ${plural(goes(p, 'genomes'), 'genome', 'genomes')}, ${plural(goes(p, 'codes'), 'code', 'codes')}.` }],
    },
    { key: 'invoices', label: 'Invoices and credit notes', value: [{ text: `${plural(goes(p, 'invoices'), 'document', 'documents')}.` }] },
    {
      key: 'partners',
      label: 'Partners',
      value: [{ text: `${plural(p.partners.partners, 'partner', 'partners')}, ${plural(p.partners.experiences, 'experience', 'experiences')}, ${plural(p.partners.invoices, 'partner invoice', 'partner invoices')}.` }],
    },
    { key: 'links', label: 'Links', value: [{ text: `${plural(p.links.wiped, 'link', 'links')} the founding list does not need.` }] },
    { key: 'audit', label: 'Audit log', value: [{ text: `${plural(goes(p, 'audit_logs', 'audit_purge_gaps'), 'entry', 'entries')}: the log restarts at entry 1, which records the reset.` }] },
    { key: 'sessions', label: 'Sessions', value: [{ text: `${plural(goes(p, 'sessions'), 'session', 'sessions')}: everyone signs in again, you too.` }] },
  ];
  const grouped = new Set(GOES_GROUPS.flatMap((g) => g.tables));
  const rest = p.tables.filter((t) => !grouped.has(t.table) && t.goes > 0);
  const restRows = rest.reduce((s, t) => s + t.goes, 0);
  rows.push({ key: 'rest', label: 'Everything else', value: [{ text: restRows === 0 ? 'Nothing else.' : `${plural(restRows, 'row', 'rows')} in ${plural(rest.length, 'other table', 'other tables')}.` }] });
  rows.push({ key: 'total', label: 'In all', value: [{ text: `${plural(p.rowsToGo, 'row', 'rows')}.`, strong: true }] });
  return rows;
}

/** The newest sign-ups of the accounts neither test nor team, Paris time (never an email). */
export function signUpLines(p: PlatformResetPreview): string[] {
  return p.collectors.signUps.map((s) => s.paris);
}

/** The releases open or announced that go, as the console names a release: `TITLE — DRAW · opens … · closes …`. */
export function releaseLines(p: PlatformResetPreview): string[] {
  return p.releases.map((r) => `${r.title} — ${r.mode} · opens ${parisDateTime(r.opensAt)} · closes ${parisDateTime(r.closesAt)}`);
}

/** What stays: the catalogue, the settings, the console logins, the founding list and what it needs, the signing key. */
export function staysRows(p: PlatformResetPreview): CountRow[] {
  const keys = p.lists.keys;
  const active = keys.filter((k) => k.status === 'ACTIVE');
  return [
    {
      key: 'catalogue',
      label: 'Catalogue',
      value: [{ text: `${plural(stays(p, 'models'), 'model', 'models')}, ${plural(stays(p, 'skus'), 'SKU', 'SKUs')}, ${plural(stays(p, 'addon_items'), 'add-on', 'add-ons')}, ${plural(stays(p, 'sets'), 'set', 'sets')}.` }],
    },
    { key: 'settings', label: 'Settings', value: [{ text: 'Every setting, as it is.' }] },
    { key: 'logins', label: 'Console logins', value: [{ text: `${plural(p.lists.logins.length, 'login', 'logins')}, yours included.` }] },
    { key: 'founding', label: 'Founding list', value: [{ text: `${plural(p.foundingList, 'address', 'addresses')}`, strong: true }, { text: ', no longer linked to an account.' }] },
    {
      key: 'foundingLinks',
      label: 'What the founding list needs',
      value: [{ text: `${plural(p.links.kept, 'link', 'links')} and ${plural(p.acquisitionSources.kept, 'source', 'sources')}.` }],
    },
    {
      key: 'key',
      label: 'Signing key',
      value: [{ text: active.length === 1 ? `Key ${active[0]!.keyId} (${active[0]!.kid}), kept as it is.` : `${plural(active.length, 'active key', 'active keys')}, kept as they are.` }],
    },
  ];
}

// ── The lists the reset captures ───────────────────────────────────────────

/**
 * One list: its title, its columns (`mono`: the identifier columns), its rows; `flag`: the SKUs to check (made by a flow
 * and still offered, the 9 Oct "check" flag), marked CHECK beside how they came.
 */
export interface ListBlock {
  key: keyof ResetCapture;
  title: string;
  head: string[];
  mono: number[];
  rows: string[][];
  flag?: boolean[];
}

/**
 * The 9 Oct lists (F8, G8), from the preview (`when` 'now': what a reset would keep or take) or from entry 1 (`when`
 * 'before': what the last reset listed before the wipe). The segments that go and the signing keys last.
 */
export function captureBlocks(c: ResetCapture, when: 'now' | 'before'): ListBlock[] {
  const now = when === 'now';
  const status = (s: string) => s.toUpperCase();
  const used = (k: ResetCapture['skus'][number]) =>
    `${plural(k.pieces, 'piece', 'pieces')} · ${plural(k.orders, 'order', 'orders')} · ${plural(k.releaseSizes, 'release size', 'release sizes')} · ${plural(k.stockMoves, 'stock move', 'stock moves')}`;
  return [
    {
      key: 'skus',
      title: 'SKUs, with how each came',
      head: ['SKU', 'Of', 'Size', 'Status', 'Came', 'Used by'],
      mono: [0],
      rows: c.skus.map((k) => [k.code, k.model ?? k.addon ?? '—', k.size, status(k.status), k.how, used(k)]),
      flag: c.skus.map((k) => k.check),
    },
    {
      key: 'logins',
      title: 'Console logins',
      head: ['Login', 'Role', 'Two-factor', 'Status', 'Made'],
      mono: [],
      rows: c.logins.map((l) => [l.email, l.role, l.totp ? 'ON' : 'OFF', status(l.status), parisDay(l.createdAt)]),
    },
    { key: 'suppliers', title: 'Suppliers', head: ['Supplier', 'Status', 'Made'], mono: [], rows: c.suppliers.map((s) => [s.name, status(s.status), parisDay(s.createdAt)]) },
    {
      key: 'pointsOfSale',
      title: 'Points of sale',
      head: ['Point of sale', 'Place', 'Status', 'Made'],
      mono: [],
      rows: c.pointsOfSale.map((x) => [x.name, [x.city, x.country].filter((v) => v).join(', ') || '—', status(x.status), parisDay(x.createdAt)]),
    },
    { key: 'carriers', title: 'Carriers', head: ['Carrier', 'Status', 'Made'], mono: [], rows: c.carriers.map((x) => [x.name, status(x.status), parisDay(x.createdAt)]) },
    {
      key: 'stockLocations',
      title: 'Stock locations',
      head: ['Stock location', 'Default', 'Address', 'Made'],
      mono: [],
      rows: c.stockLocations.map((x) => [x.name, x.default ? 'DEFAULT' : '—', x.address ? 'Set' : 'None', parisDay(x.createdAt)]),
    },
    { key: 'boxes', title: 'Boxes', head: ['Box', 'Status', 'Made'], mono: [], rows: c.boxes.map((x) => [x.name, status(x.status), parisDay(x.createdAt)]) },
    { key: 'addons', title: 'Add-ons', head: ['Add-on', 'Kind', 'Status', 'Made'], mono: [], rows: c.addons.map((x) => [x.name, x.kind, status(x.status), parisDay(x.createdAt)]) },
    { key: 'sets', title: 'Sets', head: ['Set', 'Code', 'Status', 'Made'], mono: [1], rows: c.sets.map((x) => [x.name, x.code, status(x.status), parisDay(x.createdAt)]) },
    {
      key: 'vaultRewardsGiven',
      // A title is set in the display face, whose figure one is its capital I: the words say zero.
      title: now ? 'Vault rewards given (a reset sets each count back to zero)' : 'Vault rewards that were given (each count now back to zero)',
      head: ['Reward', 'Given', 'Quantity', 'Status'],
      mono: [],
      rows: c.vaultRewardsGiven.map((v) => [v.kind, formatCount(v.given), v.quantity === null ? 'No limit' : formatCount(v.quantity), v.active ? 'ACTIVE' : 'INACTIVE']),
    },
    {
      key: 'adsEventsFrom',
      title: 'Ads events counted from',
      head: ['From'],
      mono: [],
      rows: c.adsEventsFrom ? [[parisDateTime(c.adsEventsFrom)]] : [],
    },
    {
      key: 'pieceRanges',
      title: now ? 'Piece references made (the cards to destroy)' : 'Piece references that were made (the cards to destroy)',
      head: ['Year', 'Category', 'Pieces', 'First', 'Last'],
      mono: [3, 4],
      rows: c.pieceRanges.map((r) => [String(r.year), r.category, formatCount(r.pieces), r.first, r.last]),
    },
    { key: 'segmentsGone', title: now ? 'Segments that go' : 'Segments that went', head: ['Segment'], mono: [], rows: c.segmentsGone.map((s) => [s]) },
    { key: 'keys', title: 'Signing keys', head: ['Key id', 'Kid', 'Status'], mono: [0, 1], rows: c.keys.map((k) => [String(k.keyId), k.kid, k.status]) },
  ];
}

// ── The dialogs ────────────────────────────────────────────────────────────

/** The current password of a press (D2, D10): masked, the browser's current-password. */
export function passwordField(): DialogField {
  return { name: 'password', label: 'Current password', kind: 'password', autocomplete: 'current-password', required: true };
}

/** What blocks a press before it is sent: the password, then the code (6 to 8 digits, as the server reads it). */
export function pressProblem(v: Record<string, string>): string | null {
  if (!(v.password ?? '')) return 'Enter your current password.';
  return /^\d{6,8}$/.test((v.totp ?? '').replace(/\s+/g, '')) ? null : 'Enter the six digits from your authenticator app.';
}

/**
 * RESET PLATFORM's dialog: what goes and the numbers after it (the server's for the date, H2: a press on 1 January
 * 2027 reads INV-2027-000001), the count of accounts neither test nor team again (D7), and what holds it now.
 */
export function resetDialogText(
  p: Pick<PlatformResetPreview, 'numbers' | 'collectors'>,
  refusal: { message: string } | null,
  restartsIn = 'about a minute',
): { lines: string[]; collectors: { strong: string; rest: string }; hold: string | null } {
  const refs = p.numbers.pieceReferences.map((r) => r.reference);
  const n = p.collectors.count;
  return {
    lines: [
      `Everything above under What goes is deleted, in one step, and the platform restarts (${restartsIn}, nobody can use it meanwhile). Piece serials restart at 00001${refs.length ? ` (${refs.join(', ')})` : ''} and invoice numbers at ${p.numbers.invoice}. The signing key stays.`,
    ],
    collectors:
      n === 0
        ? { strong: 'No account', rest: ' that is neither test nor team would go.' }
        : { strong: `${plural(n, 'account', 'accounts')}`, rest: ` that ${n === 1 ? 'is' : 'are'} neither test nor team would go: check them before you confirm.` },
    hold: refusal?.message ?? null,
  };
}

/** What the reset press sends: the phrase, the password, the code without its spaces, and what the page showed (G18). */
export function resetPress(v: Record<string, string>, p: Pick<PlatformResetPreview, 'collectorsSeen' | 'collectorsSeenUntil'>) {
  return {
    phrase: RESET_PHRASE,
    password: v.password ?? '',
    totp: (v.totp ?? '').replace(/\s+/g, ''),
    collectorsSeen: p.collectorsSeen,
    collectorsSeenUntil: p.collectorsSeenUntil,
  };
}

// ── After the 202 ──────────────────────────────────────────────────────────

/**
 * What the restart's poll does with an answer of the session (GET /api/admin/auth/me): a 401, every session ended by
 * the reset: the sign-in; the session alive again once the platform was seen down: the reset did not happen (refused,
 * rolled back), the page is read again; anything else (no answer, 502, 503 while it restarts, or alive before it went
 * down): wait for the next ask.
 */
export function restartAnswer(answer: { status: number }, seenDown: boolean): 'signIn' | 'back' | 'wait' {
  if (answer.status === 401) return 'signIn';
  if (answer.status === 200) return seenDown ? 'back' : 'wait';
  return 'wait';
}
