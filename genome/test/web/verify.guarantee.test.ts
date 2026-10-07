/**
 * THE HOUSE'S GUARANTEE on /verify (plan NEXT-NINE, §3.3 IN-01), as pure functions (src/web/verify/guarantee-model.ts):
 * the account sheet's blocks, the box of a draw's YOUR ENTRY in each state, GUARANTEED BY THE HOUSE with YOURS only from
 * the account's own entry shown to it, the rule sentences, the refusal said as the server says it; and nothing of a
 * guarantee not shown (the server sends none; an entry says `guaranteed: false`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUARANTEE, LIVE, RELEASES } from '../../src/web/verify/copy.js';
import { guaranteeBlocks, guaranteeBox, guaranteedLines, guaranteeFor, validUntilWords } from '../../src/web/verify/guarantee-model.js';
import { myEntries } from '../../src/web/verify/releases-model.js';
import type { ClubEntry, ClubGuarantee } from '../../src/web/verify/types.js';
import type { AccountGuarantee } from '../../src/server/services/guarantees.js';
import type { LiveOwnState } from '../../src/server/services/live-room.js';
import type { LiveState } from '../../src/web/verify/types.js';

type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export const guaranteeFits = (g: Json<AccountGuarantee>): ClubGuarantee => g;
export const ownGuaranteeFits = (g: Json<LiveOwnState['guarantee']>): LiveState['guarantee'] => g;

const DRAW = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const LIVE_ID = '0f8e7d6c-5b4a-4321-8fed-cba987654321';
const g = (o: Partial<ClubGuarantee> = {}): ClubGuarantee => ({ id: 'g1', scope: 'MODEL', target: 'MONOLITHE', pieces: 1, validUntil: '2026-12-31T22:59:59.999Z', release: null, ...o });

describe('THE HOUSE’S GUARANTEE on /verify (IN-01)', () => {
  it('fits what the server sends', () => {
    expect(typeof guaranteeFits).toBe('function');
    expect(typeof ownGuaranteeFits).toBe('function');
  });

  it('draws one block per guarantee shown, by what it covers, its release once set aside (TO BE REVEALED before a LIVE RELEASE’s name), its pieces and day', () => {
    expect(guaranteeBlocks(null)).toEqual([]);
    expect(guaranteeBlocks({ guarantees: [] })).toEqual([]);
    const blocks = guaranteeBlocks({
      guarantees: [
        g({ release: { id: DRAW, mode: 'DRAW', title: 'MONOLITHE, THE OCTOBER DRAW' } }),
        g({ id: 'g2', scope: 'COLLECTION', target: 'ÉCLIPSE', pieces: 2, release: { id: LIVE_ID, mode: 'LIVE', title: null } }),
        g({ id: 'g3', scope: 'RELEASE', target: 'MONOLITHE BLUE' }),
        g({ id: 'g4', scope: 'RELEASE', target: null }),
      ],
    });
    expect(blocks.map((b) => b.sentence)).toEqual([
      'A guaranteed place at the next release of MONOLITHE.',
      'A guaranteed place at the next release of the ÉCLIPSE collection.',
      'A guaranteed place at MONOLITHE BLUE.',
      'A guaranteed place at a coming release.',
    ]);
    expect(blocks[0]!).toMatchObject({ title: 'THE HOUSE’S GUARANTEE', note: 'Granted by ORBES. Personal and used once: it cannot be transferred.' });
    expect(blocks[0]!.rows).toEqual([
      { label: 'RELEASE', value: 'MONOLITHE, THE OCTOBER DRAW', href: `/verify/releases/${DRAW}`, releaseId: DRAW },
      { label: 'PIECES', value: '1' },
      { label: 'VALID UNTIL', value: '31 DECEMBER 2026' },
    ]);
    expect(blocks[1]!.rows[0]).toMatchObject({ label: 'RELEASE', value: 'TO BE REVEALED' });
    expect(blocks[1]!.rows[1]).toEqual({ label: 'PIECES', value: '2' });
    expect(blocks[2]!.rows.map((r) => r.label)).toEqual(['PIECES', 'VALID UNTIL']);
    expect(validUntilWords('2027-01-03T22:59:59.999Z')).toBe('3 JANUARY 2027');
  });

  it('says in YOUR ENTRY’s box: before entries open, open and not entered, entered, a reservation; nothing once drawn, cancelled or closed', () => {
    const one = { pieces: 1 };
    const two = { pieces: 2 };
    expect(guaranteeBox({ state: 'UPCOMING', drawn: false }, null, two)).toBe('ORBES guarantees you a place in this release. Enter the draw once entries open: you are selected first, for 2 pieces.');
    expect(guaranteeBox({ state: 'UPCOMING', drawn: false }, null, one, { canReserve: true })).toBe('Your reservation uses the house’s guarantee.');
    expect(guaranteeBox({ state: 'OPEN', drawn: false }, null, one)).toBe('ORBES guarantees you a place in this release. Enter the draw: you are selected first, for 1 piece.');
    expect(guaranteeBox({ state: 'OPEN', drawn: false }, { status: 'WITHDRAWN' }, one)).toBe(GUARANTEE.box.open('1 piece'));
    expect(guaranteeBox({ state: 'OPEN', drawn: false }, { status: 'ENTERED', guaranteed: true, pieces: 2 }, two)).toBe('You are entered with the house’s guarantee: you are selected first at the draw, for 2 pieces.');
    expect(guaranteeBox({ state: 'UPCOMING', drawn: false }, { status: 'SELECTED', reserved: true, guaranteed: true, pieces: 1 }, null)).toBe('Your reservation uses the house’s guarantee.');
    for (const state of ['CLOSED', 'DRAWN', 'CANCELLED'] as const) expect(guaranteeBox({ state, drawn: state === 'DRAWN' }, null, one), state).toBeNull();
    expect(guaranteeBox({ state: 'DRAWN', drawn: true }, { status: 'SELECTED', guaranteed: true, pieces: 2 }, null)).toBeNull();
    // A guarantee not shown: no guarantee sent, the entry not guaranteed: nothing.
    expect(guaranteeBox({ state: 'OPEN', drawn: false }, { status: 'ENTERED', guaranteed: false, pieces: 1 }, null)).toBeNull();
    expect(guaranteeBox({ state: 'OPEN', drawn: false }, null, null)).toBeNull();
    expect(guaranteeFor({ guarantees: [g({ release: { id: DRAW, mode: 'DRAW', title: 'X' } })] }, DRAW)?.id).toBe('g1');
    expect(guaranteeFor({ guarantees: [] }, DRAW)).toBeNull();
  });

  it('lists GUARANTEED BY THE HOUSE by entry id and pieces; YOURS only from the account’s own entry when its guarantee is shown to it', () => {
    const a = '11111111-2222-4333-8444-555555555555';
    const b = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    const items = [{ id: a, pieces: 2 }, { id: b, pieces: 1 }];
    expect(guaranteedLines(items, null)).toEqual([
      { id: a, line: 'GUARANTEED · 2 PIECES', yours: false },
      { id: b, line: 'GUARANTEED · 1 PIECE', yours: false },
    ]);
    expect(guaranteedLines(items, { id: a, guaranteed: true }).map((l) => l.yours)).toEqual([true, false]);
    // Its own entry with a guarantee not shown: its line, unmarked.
    expect(guaranteedLines(items, { id: b, guaranteed: false }).map((l) => l.yours)).toEqual([false, false]);
    expect(guaranteedLines(undefined, null)).toEqual([]);
    expect(GUARANTEE.list).toMatchObject({ title: 'GUARANTEED BY THE HOUSE', lead: 'Set aside before the draw: selected first, without a rank, and left out of the ranking below.' });
  });

  it('labels a guaranteed entry in MY PIECES, only when it is shown', () => {
    const entry = (o: Partial<ClubEntry>): ClubEntry => ({ id: 'e1', dropId: DRAW, title: 'MONOLITHE', state: 'OPEN', status: 'ENTERED', enteredAt: '', rank: null, respondBy: null, reserved: false, opensAt: '', closesAt: '', drawnAt: null, ...o });
    expect(myEntries([entry({ guaranteed: true, pieces: 2 }), entry({ id: 'e2', guaranteed: false })], { offsetMinutes: 0 }).map((m) => m.guaranteed)).toEqual([true, false]);
  });

  it('closes each rule with its sentence, its tier wording unchanged, and says the refusal as the server does', () => {
    expect(RELEASES.rule).toMatch(/^The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, /);
    expect(RELEASES.rule.endsWith(' Places guaranteed by ORBES are selected first, for the pieces they cover, and listed apart without a rank.')).toBe(true);
    for (const priority of [true, false]) expect(LIVE.rule(priority).endsWith(' Places guaranteed by ORBES come first in their size.')).toBe(true);
    expect(GUARANTEE.liveAnnounced).toBe('ORBES guarantees you a place in this release. Be in the room at the opening: you are first in line in your size.');
    expect(GUARANTEE.liveRoom(2)).toBe('You are first in line in your size, for up to 2 pieces.');
    expect(GUARANTEE.sizeFull).toBe('Your guaranteed place cannot be given in this size: choose another size.');
    // The server's own refusal (services/live.ts LIVE_GUARANTEE_SIZE_FULL), which the page shows as it is.
    expect(readFileSync(new URL('../../src/server/services/live.ts', import.meta.url), 'utf8')).toContain(`conflict('LIVE_GUARANTEE_SIZE_FULL', '${GUARANTEE.sizeFull}')`);
  });
});
