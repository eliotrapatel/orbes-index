/**
 * The Platform reset page of the console, `#/settings/platform-reset` (lot PURGE, step PURGE.12, plan §B.5; D2, D7,
 * D8, D12, D13, R2, H2, H6, B5.page, B5.dlg, B5.signin, B5.check, B5.lock, F8, F17, F22, F27, F29, G8, G18;
 * views/platform-reset.ts, model/platform-reset.ts), pure:
 *
 *  - its address and who may ask it: an ADMIN asks whether he is the holder (`?part=holder`, the Settings page's link);
 *    anyone else meets the console's not-found state; the server says who the holder is, never the console;
 *  - every state: READY, REFUSED NOW (a window, a test running, a LIVE room open, in the server's Paris words), LOCKED
 *    (when, by whom, no button at all, H6); long text kept whole (a long email, a long refusal); the loading and the
 *    failure of the first read are the console's own (main.ts), and a refusal of a press never signs out;
 *  - what goes (the accounts neither test nor team in bold, D7), what stays, the sign-ups (Paris, never an email), the
 *    releases open or announced;
 *  - after a reset: its line (entry 1's short hash, the old log's head, F27), the post-check OK and failing (F17), the
 *    checklist (D8, M18, M21), the lists captured in entry 1 with the segments that went and the keys (F8, G8);
 *  - RESET PLATFORM's dialog: its body with the server's numbers for the date, a clock in 2027 reading INV-2027-000001
 *    and O27-J-00001 (H2), the count again, the fields, the phrase, what the press sends (G18), RESET_COLLECTORS_CHANGED
 *    said inside it (F22);
 *  - LOCK RESET's dialog (H6): its words, the current password, the code field as the sign-in's, the phrase LOCK RESET,
 *    a 400, 409 or 429 said inside it with no sign-out;
 *  - after the 202: the restart's poll, every 3 s, to the sign-in once every session ended, or back to the page.
 */
import { describe, expect, it } from 'vitest';
import { numbersAfterReset } from '../../src/server/services/platform-reset.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import { can } from '../../src/web/admin/model/permissions.js';
import {
  captureBlocks,
  goesRows,
  lastResetLine,
  lastResetParts,
  LOCK_PHRASE,
  lockedLine,
  mayAskHolder,
  parisDay,
  passwordField,
  PLATFORM_RESET_TEXT,
  postCheckRow,
  postCheckVerdict,
  pressProblem,
  releaseLines,
  RESET_CHECKLIST,
  RESET_PHRASE,
  resetButtons,
  resetDialogText,
  resetPress,
  resetState,
  RESTART_POLL_MS,
  restartAnswer,
  shortHash,
  signUpLines,
  staysRows,
} from '../../src/web/admin/model/platform-reset.js';
import { purgeCodeField } from '../../src/web/admin/model/test-purge.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import type { LastPlatformReset, PlatformResetPreview, ResetCapture, ResetPostCheckLine } from '../../src/web/admin/types.js';
import { CODE_HINT, CODE_INPUT } from '../../src/web/admin/ui/dialog.js';

const LONG = 'eliot.owner.console.holder.with.a.very.long.address.that.never.ends@example-a-long-domain-name.com';
const HASH = 'a3f09c1e5b7d2246e8f0c1b2a3d4e5f60718293a4b5c6d7e8f90123456789abc';
const OLD = '9be1f00c2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5';
const NIGHT = "The platform's night maintenance runs from 04:00 to 06:30 Paris (03:00–05:30 UTC). Try again at 06:30.";

const emptyCapture = (): ResetCapture => ({
  skus: [],
  logins: [],
  suppliers: [],
  pointsOfSale: [],
  carriers: [],
  stockLocations: [],
  boxes: [],
  addons: [],
  sets: [],
  vaultRewardsGiven: [],
  adsEventsFrom: null,
  pieceRanges: [],
  segmentsGone: [],
  keys: [],
});

const capture = (): ResetCapture => ({
  skus: [
    { code: 'MNL-RG-52', model: 'MONOLITHE', addon: null, size: '52', sizeType: 'RING', status: 'offered', createdAt: '2026-10-09T10:00:00Z', pieces: 12, orders: 3, releaseSizes: 2, stockMoves: 4, how: 'declared', check: false },
    { code: 'ENG-01', model: null, addon: 'ENGRAVING', size: 'ONE SIZE', sizeType: null, status: 'set aside', createdAt: '2026-10-20T10:00:00Z', pieces: 0, orders: 1, releaseSizes: 1, stockMoves: 0, how: 'by a flow', check: true },
  ],
  logins: [{ email: LONG, role: 'ADMIN', totp: true, status: 'active', createdAt: '2026-09-01T10:00:00Z' }],
  suppliers: [{ name: 'Supplier of the test', status: 'inactive', createdAt: '2026-10-10T10:00:00Z' }],
  pointsOfSale: [{ name: 'Boutique', city: 'Paris', country: 'FR', status: 'active', createdAt: '2026-10-11T10:00:00Z' }, { name: 'Pop-up', city: null, country: null, status: 'active', createdAt: '2026-10-11T10:00:00Z' }],
  carriers: [{ name: 'Colissimo', status: 'offered', createdAt: '2026-10-01T10:00:00Z' }],
  stockLocations: [{ name: 'FRANCE WAREHOUSE', default: true, address: false, createdAt: '2026-10-01T10:00:00Z' }],
  boxes: [{ name: 'Ring box', status: 'active', createdAt: '2026-10-02T10:00:00Z' }],
  addons: [{ name: 'ENGRAVING', kind: 'SERVICE', status: 'active', createdAt: '2026-10-03T10:00:00Z' }],
  sets: [{ name: 'The pair', code: 'SET-01', status: 'active', createdAt: '2026-10-04T10:00:00Z' }],
  vaultRewardsGiven: [{ id: 'v1', kind: 'ACCESS', given: 4, quantity: null, active: true }, { id: 'v2', kind: 'PIECE', given: 1, quantity: 3, active: false }],
  adsEventsFrom: '2026-10-20T08:00:00Z',
  pieceRanges: [{ year: 2026, category: 'J', pieces: 184, first: 'O26-J-00001', last: 'O26-J-00184' }],
  segmentsGone: ['Entered MONOLITHE — release I', 'Came through the summer link'],
  keys: [
    { keyId: 1, kid: 'orbes-k001-20261028-1a3f', status: 'ACTIVE' },
    { keyId: 2, kid: 'orbes-k002-20261029-77b0', status: 'REVOKED' },
  ],
});

const CATEGORIES = [
  { code: 'J', index: 1, name: 'Jewelry' },
  { code: 'A', index: 2, name: 'Accessories' },
];

function preview(p: Partial<PlatformResetPreview> = {}): PlatformResetPreview {
  const t = (table: string, kind: 'KEEP' | 'PARTLY' | 'WIPE', rows: number, stays = kind === 'KEEP' ? rows : 0) => ({ table, kind, rows, goes: rows - stays, stays });
  const tables = [
    t('accounts', 'WIPE', 14),
    t('drops', 'WIPE', 3),
    t('drop_entries', 'WIPE', 20),
    t('live_entries', 'WIPE', 5),
    t('orders', 'WIPE', 1204),
    t('products', 'WIPE', 184),
    t('genomes', 'WIPE', 184),
    t('codes', 'WIPE', 184),
    t('invoices', 'WIPE', 2),
    t('partners', 'WIPE', 1),
    t('links', 'PARTLY', 5, 2),
    t('audit_logs', 'WIPE', 52817),
    t('audit_purge_gaps', 'WIPE', 3),
    t('sessions', 'WIPE', 9),
    t('order_events', 'WIPE', 3000),
    t('scan_events', 'WIPE', 1),
    t('models', 'KEEP', 4),
    t('skus', 'KEEP', 12),
    t('addon_items', 'KEEP', 1),
    t('sets', 'KEEP', 1),
    t('categories', 'KEEP', 2),
  ];
  return {
    at: '2026-10-28T09:00:00.000Z',
    numbers: numbersAfterReset(new Date('2026-10-28T09:00:00Z'), CATEGORIES),
    tables,
    rowsToGo: tables.reduce((s, x) => s + x.goes, 0),
    collectors: { count: 2, signUps: [{ at: '2026-10-27T14:05:00.000Z', paris: '27 OCT 2026 · 15:05 Paris' }, { at: '2026-07-14T10:00:00.000Z', paris: '14 JUL 2026 · 12:00 Paris' }] },
    collectorsSeen: 2,
    collectorsSeenUntil: '2026-10-27T14:05:00.123456Z',
    testEntrants: 12,
    foundingList: 431,
    links: { kept: 2, wiped: 3 },
    acquisitionSources: { kept: 3 },
    partners: { partners: 1, experiences: 2, invoices: 0 },
    releases: [{ id: 'r1', title: 'MONOLITHE — release II', mode: 'DRAW', opensAt: '2026-10-29T18:00:00.000Z', closesAt: '2026-10-30T18:00:00.000Z' }],
    liveOpen: null,
    lists: capture(),
    ...p,
  };
}

const check = (key: ResetPostCheckLine['key'], ok = true, value = 'Found.'): ResetPostCheckLine => ({ key, label: `The ${key} line`, ok, value });

function lastReset(p: Partial<LastPlatformReset> = {}): LastPlatformReset {
  return {
    at: '2026-10-28T08:12:00.000Z',
    by: 'owner@example.com',
    counts: { wiped: { accounts: 14 }, kept: { models: 4 }, partly: { links: { before: 5, after: 2 } }, collectors: 2 },
    rowsDeleted: 48211,
    anchor: { id: 1, hash: HASH },
    oldHead: { id: 52817, hash: OLD },
    capture: capture(),
    postCheck: (['chain', 'key', 'documents', 'pieces', 'numbers', 'test'] as const).map((k) => check(k)),
    ...p,
  };
}

/** A fake fetch answering from a queue, recording each call. */
function fakeFetch(...answers: Response[]): { fetch: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const r = answers.shift();
      if (!r) throw new Error('unexpected request');
      return r;
    },
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the Platform reset page', () => {
  it('is #/settings/platform-reset, from the Settings page; an ADMIN asks whether he is the holder, every other role meets the not-found state', async () => {
    expect(href('platformReset')).toBe('#/settings/platform-reset');
    expect(parseHash('#/settings/platform-reset').name).toBe('platformReset');
    expect(parseHash('#/settings/tests').name).toBe('endedTests');
    expect(parseHash('#/settings').name).toBe('settings');
    expect(mayAskHolder('ADMIN')).toBe(true);
    expect(can('ADMIN', 'resetPlatform')).toBe(true);
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const) expect(mayAskHolder(role), role).toBe(false);
    expect(mayAskHolder(null)).toBe(false);
    // The link's ask: `?part=holder`, its answer as the server gives it (another ADMIN: false, the page then hidden).
    const { fetch, calls } = fakeFetch(json(200, { holder: false }), json(200, { holder: true }), json(200, { holder: false }));
    const api = new AdminApi({ fetch });
    expect(await api.platformResetHolder()).toEqual({ holder: false });
    expect(await api.platformResetHolder()).toEqual({ holder: true });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', '/api/admin/platform-reset?part=holder'],
      ['GET', '/api/admin/platform-reset?part=holder'],
    ]);
    // The page itself: anyone but the holder reads `{ holder: false }` and nothing else (the view then shows not-found).
    expect(await api.platformReset()).toEqual({ holder: false });
    expect(calls[2]!.url).toBe('/api/admin/platform-reset');
    expect(PLATFORM_RESET_TEXT.title).toBe('Platform reset');
    expect(PLATFORM_RESET_TEXT.eyebrow).toBe('Settings · Before launch');
  });

  it('says READY, REFUSED NOW in the server’s Paris words (a window, a test running, a LIVE room open), or LOCKED by whom with no button (H6)', () => {
    expect(resetState({ launched: null, refusal: null })).toEqual({ tone: 'solid', label: 'READY', line: 'Nothing holds a reset now.' });
    for (const message of [NIGHT, 'A test is running. Reset once it has ended.', 'A LIVE room is open until 28 October at 21:00 Paris.']) {
      expect(resetState({ launched: null, refusal: { code: 'X', message } })).toEqual({ tone: 'alert', label: 'REFUSED NOW', line: message });
    }
    const locked = resetState({ launched: { at: '2026-11-02T09:00:00.000Z', by: 'owner@example.com' }, refusal: { code: 'RESET_LOCKED', message: 'x' } });
    expect(locked).toEqual({ tone: 'outline', label: 'LOCKED', line: 'Locked 02 NOV 2026 · 10:00 Paris by owner@example.com. The reset is refused for good.' });
    expect(lockedLine({ at: '2026-07-14T10:00:00.000Z', by: null })).toBe('Locked 14 JUL 2026 · 12:00 Paris. The reset is refused for good.');
    // The buttons: none once locked (no reset, no lock); RESET PLATFORM only with a preview to say what goes.
    expect(resetButtons({ launched: { at: '2026-11-02T09:00:00.000Z', by: null }, preview: null })).toEqual({ reset: false, lock: false });
    expect(resetButtons({ launched: { at: '2026-11-02T09:00:00.000Z', by: null }, preview: preview() })).toEqual({ reset: false, lock: false });
    expect(resetButtons({ launched: null, preview: preview() })).toEqual({ reset: true, lock: true });
    expect(resetButtons({ launched: null, preview: null })).toEqual({ reset: false, lock: true });
  });

  it('keeps long text whole: a long email in every line, a long refusal as the server wrote it', () => {
    expect(lockedLine({ at: '2026-11-02T09:00:00.000Z', by: LONG })).toContain(LONG);
    expect(lastResetLine(lastReset({ by: LONG }))).toContain(` by ${LONG}: `);
    const long = `${NIGHT} `.repeat(6).trim();
    expect(resetState({ launched: null, refusal: { code: 'RESET_WINDOW', message: long } }).line).toBe(long);
    expect(captureBlocks(capture(), 'now').find((b) => b.key === 'logins')!.rows[0]![0]).toBe(LONG);
  });

  it('a refusal of a press is said, never a sign-out; only an ended session (401) signs out, as everywhere in the console', async () => {
    for (const [status, code, message] of [
      [400, 'STEP_UP_CODE_INVALID', 'The code is not valid. Check the time on your device and try again.'],
      [409, 'RESET_LOCKED', 'LOCK RESET was pressed on 2 November at 10:00 Paris: the reset is refused for good.'],
      [429, 'STEP_UP_LOCKED', 'Too many wrong codes today. Try again after 29 October at 14:05 Paris.'],
    ] as const) {
      let signedOut = 0;
      const { fetch, calls } = fakeFetch(json(status, { error: { code, message } }), json(status, { error: { code, message } }));
      const api = new AdminApi({ fetch, onUnauthorized: () => signedOut++ });
      await expect(api.lockPlatformReset(LOCK_PHRASE, 'passphrase', '123456')).rejects.toMatchObject({ status, code, message });
      await expect(api.resetPlatform(resetPress({ password: 'passphrase', totp: '123 456' }, preview()))).rejects.toMatchObject({ status, code, message });
      expect(signedOut, code).toBe(0);
      expect(calls.map((c) => [c.init.method, c.url])).toEqual([
        ['POST', '/api/admin/platform-reset/lock'],
        ['POST', '/api/admin/platform-reset'],
      ]);
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ phrase: 'LOCK RESET', password: 'passphrase', totp: '123456' });
    }
    // The first read failing: the console's own failure state with the server's words (main.ts); a 401 signs out.
    let signedOut = 0;
    const { fetch } = fakeFetch(json(500, { error: { code: 'INTERNAL', message: 'The server could not complete the request.' } }), json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }));
    const api = new AdminApi({ fetch, onUnauthorized: () => signedOut++ });
    await expect(api.platformReset()).rejects.toMatchObject({ status: 500, message: 'The server could not complete the request.' });
    await expect(api.platformReset()).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toBe(1);
  });

  it('says what goes by group, the accounts neither test nor team in bold (D7), their sign-ups in Paris (never an email), the releases open or announced', () => {
    const rows = goesRows(preview());
    const text = (k: string) => rows.find((r) => r.key === k)!.value.map((v) => v.text).join('');
    expect(rows.map((r) => r.label)).toEqual([
      'Collector accounts',
      'Releases',
      'Entries',
      'Orders',
      'Pieces and identities',
      'Invoices and credit notes',
      'Partners',
      'Links',
      'Audit log',
      'Sessions',
      'Everything else',
      'In all',
    ]);
    expect(text('accounts')).toBe('14 accounts: 2 neither test nor team, 12 test entrants.');
    expect(rows[0]!.value.filter((v) => v.strong).map((v) => v.text)).toEqual(['2 neither test nor team']);
    expect(text('entries')).toBe('25 entries.');
    expect(text('orders')).toBe(`${formatCount(1204)} orders.`);
    expect(text('pieces')).toBe('184 pieces, 184 genomes, 184 codes.');
    expect(text('invoices')).toBe('2 documents.');
    expect(text('partners')).toBe('1 partner, 2 experiences, 0 partner invoices.');
    expect(text('links')).toBe('3 links the founding list does not need.');
    expect(text('audit')).toBe(`${formatCount(52820)} entries: the log restarts at entry 1, which records the reset.`);
    expect(text('sessions')).toBe('9 sessions: everyone signs in again, you too.');
    expect(text('rest')).toBe(`${formatCount(3001)} rows in 2 other tables.`);
    expect(text('total')).toBe(`${formatCount(preview().rowsToGo)} rows.`);
    expect(rows.at(-1)!.value[0]!.strong).toBe(true);
    expect(goesRows(preview({ collectors: { count: 1, signUps: [] }, testEntrants: 1 }))[0]!.value.map((v) => v.text).join('')).toBe('14 accounts: 1 neither test nor team, 1 test entrant.');
    expect(signUpLines(preview())).toEqual(['27 OCT 2026 · 15:05 Paris', '14 JUL 2026 · 12:00 Paris']);
    expect(JSON.stringify(signUpLines(preview()))).not.toContain('@');
    expect(releaseLines(preview())).toEqual(['MONOLITHE — release II — DRAW · opens 29 OCT 2026 · 19:00 Paris · closes 30 OCT 2026 · 19:00 Paris']);
  });

  it('says what stays: the catalogue, the settings, the console logins, the founding list with what it needs, the signing key', () => {
    const rows = staysRows(preview());
    expect(rows.map((r) => [r.label, r.value.map((v) => v.text).join('')])).toEqual([
      ['Catalogue', '4 models, 12 SKUs, 1 add-on, 1 set.'],
      ['Settings', 'Every setting, as it is.'],
      ['Console logins', '1 login, yours included.'],
      ['Founding list', '431 addresses, no longer linked to an account.'],
      ['What the founding list needs', '2 links and 3 sources.'],
      ['Signing key', 'Key 1 (orbes-k001-20261028-1a3f), kept as it is.'],
    ]);
    expect(rows[3]!.value.filter((v) => v.strong).map((v) => v.text)).toEqual(['431 addresses']);
  });

  it('after a reset: its line with entry 1’s short hash and the old log’s head (F27), and with no previous log', () => {
    expect(lastResetLine(lastReset())).toBe(
      `Last reset 28 OCT 2026 · 09:12 Paris by owner@example.com: ${formatCount(48211)} rows deleted. Audit log restarted: entry 1, hash ${HASH.slice(0, 12)}. Previous log ended at entry 52817, hash ${OLD.slice(0, 12)}.`,
    );
    expect(lastResetParts(lastReset()).filter((p) => p.mono).map((p) => p.text)).toEqual([shortHash(HASH), shortHash(OLD)]);
    expect(shortHash(HASH)).toBe('a3f09c1e5b7d');
    expect(lastResetLine(lastReset({ oldHead: null, by: null, rowsDeleted: 1 }))).toBe(`Last reset 28 OCT 2026 · 09:12 Paris: 1 row deleted. Audit log restarted: entry 1, hash ${HASH.slice(0, 12)}. There was no previous log.`);
    expect(lastResetLine(lastReset({ anchor: null, rowsDeleted: null }))).toBe(`Last reset 28 OCT 2026 · 09:12 Paris by owner@example.com. Audit log restarted. Previous log ended at entry 52817, hash ${OLD.slice(0, 12)}.`);
  });

  it('after a reset: the post-check lines OK, or the failing one in the danger tone (F17)', () => {
    expect(postCheckRow(check('chain', true, 'Entry 1, hash a3f09c1e5b7d; 14 entries checked.'))).toEqual({ label: 'The chain line', mark: 'OK', tone: 'solid', value: 'Entry 1, hash a3f09c1e5b7d; 14 entries checked.', failing: false });
    expect(postCheckRow(check('key', false, '2 ACTIVE signing keys, expected 1.'))).toEqual({ label: 'The key line', mark: 'FAILING', tone: 'critical', value: '2 ACTIVE signing keys, expected 1.', failing: true });
    expect(postCheckVerdict(lastReset().postCheck)).toBe('Every check after the reset is OK.');
    expect(postCheckVerdict([check('chain'), check('key', false)])).toBe('1 check after the reset is failing: see the line in red.');
    expect(postCheckVerdict([check('chain', false), check('key', false)])).toBe('2 checks after the reset are failing: see the lines in red.');
  });

  it('after a reset: the checklist, each a plain sentence, the key and the logins leading to their pages (D8, M18, M21)', () => {
    expect(RESET_CHECKLIST.map((i) => `${i.before}${i.link?.label ?? ''}${i.after ?? ''}`)).toEqual([
      'At the last reset before real printing, rotate the signing key, then revoke the old one (Keys), and ask the host for a backup right after: the new key lives only in the keys volume until the nightly backup.',
      'Destroy every printed test card, tag and box card: piece serials restart at 00001.',
      'Discard the downloaded test invoices, credit notes, partner invoices and CSV files: INV-, CN-, P- and PC- numbers restart.',
      'Re-create your collector account in the app.',
      'Disable in Team any console login made for a test.',
      'Tidy in the console what a test may have left: the lists below, captured before the wipe.',
      'Write the reset date next to any audit anchor you kept: the log restarts at entry 1.',
    ]);
    expect(RESET_CHECKLIST.filter((i) => i.link).map((i) => href(i.link!.route))).toEqual(['#/keys', '#/team']);
  });

  it('lists what entry 1 captured before the wipe, the segments that went and the signing keys included (F8, G8), and the same lists now', () => {
    const before = captureBlocks(capture(), 'before');
    expect(before.map((b) => b.title)).toEqual([
      'SKUs, with how each came',
      'Console logins',
      'Suppliers',
      'Points of sale',
      'Carriers',
      'Stock locations',
      'Boxes',
      'Add-ons',
      'Sets',
      'Vault rewards that were given (each count now back to zero)',
      'Ads events counted from',
      'Piece references that were made (the cards to destroy)',
      'Segments that went',
      'Signing keys',
    ]);
    // Titles are set in the display face: never a figure (its one is a capital I).
    for (const b of [...before, ...captureBlocks(capture(), 'now')]) expect(b.title, b.title).not.toMatch(/\d/);
    const of = (k: string) => before.find((b) => b.key === k)!;
    expect(of('skus').rows).toEqual([
      ['MNL-RG-52', 'MONOLITHE', '52', 'OFFERED', 'declared', '12 pieces · 3 orders · 2 release sizes · 4 stock moves'],
      ['ENG-01', 'ENGRAVING', 'ONE SIZE', 'SET ASIDE', 'by a flow', '0 pieces · 1 order · 1 release size · 0 stock moves'],
    ]);
    expect(of('skus').flag).toEqual([false, true]);
    expect(of('logins').rows).toEqual([[LONG, 'ADMIN', 'ON', 'ACTIVE', '01 SEP 2026']]);
    expect(of('pointsOfSale').rows.map((r) => r[1])).toEqual(['Paris, FR', '—']);
    expect(of('stockLocations').rows).toEqual([['FRANCE WAREHOUSE', 'DEFAULT', 'None', '01 OCT 2026']]);
    expect(of('vaultRewardsGiven').rows).toEqual([
      ['ACCESS', '4', 'No limit', 'ACTIVE'],
      ['PIECE', '1', '3', 'INACTIVE'],
    ]);
    expect(of('adsEventsFrom').rows).toEqual([['20 OCT 2026 · 10:00 Paris']]);
    expect(of('pieceRanges').rows).toEqual([['2026', 'J', '184', 'O26-J-00001', 'O26-J-00184']]);
    expect(of('pieceRanges').mono).toEqual([3, 4]);
    expect(of('segmentsGone').rows).toEqual([['Entered MONOLITHE — release I'], ['Came through the summer link']]);
    expect(of('keys').rows).toEqual([
      ['1', 'orbes-k001-20261028-1a3f', 'ACTIVE'],
      ['2', 'orbes-k002-20261029-77b0', 'REVOKED'],
    ]);
    expect(of('keys').mono).toEqual([0, 1]);
    const now = captureBlocks(capture(), 'now');
    expect(now.find((b) => b.key === 'segmentsGone')!.title).toBe('Segments that go');
    expect(now.find((b) => b.key === 'pieceRanges')!.title).toBe('Piece references made (the cards to destroy)');
    expect(now.find((b) => b.key === 'vaultRewardsGiven')!.title).toBe('Vault rewards given (a reset sets each count back to zero)');
    // Nothing captured: every list empty (the page says None under each).
    expect(captureBlocks(emptyCapture(), 'before').every((b) => b.rows.length === 0)).toBe(true);
    expect(PLATFORM_RESET_TEXT.none).toBe('None.');
    expect(parisDay('2026-10-28T23:30:00Z')).toBe('29 OCT 2026');
    expect(parisDay(null)).toBe('—');
  });

  it('RESET PLATFORM’s dialog: the server’s numbers for the date, a clock in 2027 reading INV-2027-000001 and O27-J-00001 (H2); the accounts again; what holds it now', () => {
    const in2027 = preview({ numbers: numbersAfterReset(new Date('2027-01-01T00:00:30Z'), CATEGORIES) });
    const text = resetDialogText(in2027, null);
    expect(text.lines).toEqual([
      'Everything above under What goes is deleted, in one step, and the platform restarts (about a minute, nobody can use it meanwhile). Piece serials restart at 00001 (O27-A-00001, O27-J-00001) and invoice numbers at INV-2027-000001. The signing key stays.',
    ]);
    expect(resetDialogText(preview(), null).lines[0]).toContain('(O26-A-00001, O26-J-00001) and invoice numbers at INV-2026-000001.');
    // No active category: no piece reference to name.
    expect(resetDialogText(preview({ numbers: numbersAfterReset(new Date('2027-06-01T00:00:00Z'), []) }), null).lines[0]).toContain('Piece serials restart at 00001 and invoice numbers at INV-2027-000001.');
    expect(text.collectors).toEqual({ strong: '2 accounts', rest: ' that are neither test nor team would go: check them before you confirm.' });
    expect(resetDialogText(preview({ collectors: { count: 1, signUps: [] } }), null).collectors).toEqual({ strong: '1 account', rest: ' that is neither test nor team would go: check them before you confirm.' });
    expect(resetDialogText(preview({ collectors: { count: 0, signUps: [] } }), null).collectors).toEqual({ strong: 'No account', rest: ' that is neither test nor team would go.' });
    expect(text.hold).toBeNull();
    expect(resetDialogText(preview(), { message: 'A LIVE room is open until 28 October at 21:00 Paris.' }).hold).toBe('A LIVE room is open until 28 October at 21:00 Paris.');
  });

  it('RESET PLATFORM’s fields, phrase and press: the current password, the code as the sign-in asks it, RESET PLATFORM, and what the page showed (G18); RESET_COLLECTORS_CHANGED said inside it (F22)', async () => {
    expect(RESET_PHRASE).toBe('RESET PLATFORM');
    expect(passwordField()).toEqual({ name: 'password', label: 'Current password', kind: 'password', autocomplete: 'current-password', required: true });
    expect(purgeCodeField()).toEqual({ name: 'totp', label: 'Authenticator code', kind: 'code', required: true });
    expect(CODE_INPUT).toEqual({ autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 9, mono: true, placeholder: '000 000' });
    expect(CODE_HINT).toBe('Six digits from your authenticator app. Just signed in? Wait for the next code.');
    expect(pressProblem({ password: '', totp: '123456' })).toBe('Enter your current password.');
    expect(pressProblem({ password: 'x', totp: '12345' })).toBe('Enter the six digits from your authenticator app.');
    expect(pressProblem({ password: 'x', totp: '123 456' })).toBeNull();
    expect(resetPress({ password: 'pass phrase', totp: '123 456' }, preview())).toEqual({
      phrase: 'RESET PLATFORM',
      password: 'pass phrase',
      totp: '123456',
      collectorsSeen: 2,
      collectorsSeenUntil: '2026-10-27T14:05:00.123456Z',
    });
    expect(resetPress({ password: 'p', totp: '000000' }, preview({ collectorsSeen: 0, collectorsSeenUntil: null }))).toMatchObject({ collectorsSeen: 0, collectorsSeenUntil: null });
    // The press as sent, and the 409 the dialog says inside it (no sign-out).
    let signedOut = 0;
    const words = '2 accounts signed up since you opened this page. Reload it and check them.';
    const { fetch, calls } = fakeFetch(json(409, { error: { code: 'RESET_COLLECTORS_CHANGED', message: words } }), json(202, { restartsIn: 'about a minute' }));
    const api = new AdminApi({ fetch, onUnauthorized: () => signedOut++ });
    const press = resetPress({ password: 'pass phrase', totp: '123456' }, preview());
    await expect(api.resetPlatform(press)).rejects.toMatchObject({ status: 409, code: 'RESET_COLLECTORS_CHANGED', message: words });
    expect(await api.resetPlatform(press)).toEqual({ restartsIn: 'about a minute' });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(press);
    expect(signedOut).toBe(0);
  });

  it('LOCK RESET’s dialog (H6): its words, the current password, the code kind, the phrase LOCK RESET', () => {
    expect(LOCK_PHRASE).toBe('LOCK RESET');
    expect(PLATFORM_RESET_TEXT.lockDialogTitle).toBe('Lock reset');
    expect(PLATFORM_RESET_TEXT.lockBody).toBe('After this, PLATFORM RESET is refused for good. Do it once the platform is launched.');
    expect(passwordField().kind).toBe('password');
    expect(passwordField().autocomplete).toBe('current-password');
    expect(purgeCodeField().kind).toBe('code');
    expect(PLATFORM_RESET_TEXT.locked).toBe('LOCK RESET was pressed: the reset is refused for good.');
  });

  it('after the 202: the notice, then the session asked every 3 s: every session ended, the sign-in; alive again after the platform was down, the page again; else it waits', () => {
    expect(RESTART_POLL_MS).toBe(3000);
    expect([PLATFORM_RESET_TEXT.restartTitle, PLATFORM_RESET_TEXT.restartText]).toEqual(['The platform is restarting.', 'Sign in again in a minute.']);
    expect(restartAnswer({ status: 401 }, false)).toBe('signIn');
    expect(restartAnswer({ status: 401 }, true)).toBe('signIn');
    // Alive before it went down: the restart has not begun yet.
    expect(restartAnswer({ status: 200 }, false)).toBe('wait');
    // Alive after it was down: the reset did not happen (refused, rolled back): the page says why.
    expect(restartAnswer({ status: 200 }, true)).toBe('back');
    for (const status of [0, 502, 503, 504, 500, 403]) expect(restartAnswer({ status }, false), String(status)).toBe('wait');
  });
});
