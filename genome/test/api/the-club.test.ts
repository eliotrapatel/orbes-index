/**
 * THE CLUB (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9; GET /api/v1/the-club): public (no session), cached a minute,
 * naming no account; every tier from its threshold (CLUB_TIER_THRESHOLDS), its program's lines then its words; the
 * credit's currency from THE PROGRAM; a tier's welcome gift only while its model is active.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLUB_TIER_DEFAULT_BENEFITS, CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import { DEFAULT_PROGRAM, programLines } from '../../src/server/services/club-program.js';
import type { Actor } from '../../src/server/types.js';
import { createModel } from '../support/live.js';
import { accountClient, createHarness, safeJson, seedCatalog, type Harness } from './support.js';

interface TheClubJson {
  tiers: { name: string; level: number; pieces: number; lines: string[] }[];
  tierThresholds: number[];
  creditCurrency: string;
  gifts: { tier: string; model: string; imageUrl: string | null }[];
}

describe('THE CLUB (BP-19 T9)', () => {
  let h: Harness;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    await seedCatalog(h.ctx);
    const a = await h.t.db.insertInto('admin_users').values({ email: 'the-club@orbes.test', email_normalized: 'the-club@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  const read = async (c = h.client()) => {
    const res = await c.get('/api/v1/the-club');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    return { body: safeJson(res) as TheClubJson, text: res.body };
  };

  it('answers anyone, cached a minute: each tier from its threshold, its program\'s lines then its words; the credit\'s currency', async () => {
    const { body } = await read();
    expect(body.tierThresholds).toEqual([...CLUB_TIER_THRESHOLDS]);
    expect(body.tierThresholds).toEqual([1, 5, 10]);
    expect(body.tiers.map((t) => [t.name, t.level, t.pieces])).toEqual([
      ['TITANE', 1, 1],
      ['PLATINE', 2, 5],
      ['PALLADIUM', 3, 10],
    ]);
    expect(body.tiers[0]!.lines).toEqual(CLUB_TIER_DEFAULT_BENEFITS.TITANE.split('\n'));
    expect(body.tiers[1]!.lines).toEqual(programLines(DEFAULT_PROGRAM, 2));
    expect(body.tiers[2]!.lines).toEqual([...programLines(DEFAULT_PROGRAM, 3), ...CLUB_TIER_DEFAULT_BENEFITS.PALLADIUM.split('\n')]);
    expect(body.creditCurrency).toBe('EUR');
    expect(body.gifts).toEqual([]);
  });

  it('names no account, signed in or not; follows THE PROGRAM: the credit\'s currency, an active gift model with its photograph', async () => {
    const { client, email } = await accountClient(h);
    const signed = await read(client);
    expect(signed.text).not.toContain(email);
    expect(Object.keys(signed.body).sort()).toEqual(['creditCurrency', 'gifts', 'tierThresholds', 'tiers']);
    const p = await h.ctx.services.clubProgram.read();
    const charm = await createModel(h.t.db, 'ORBITAL CHARM');
    await h.ctx.services.clubProgram.update({ ...p, creditCurrency: 'CHF', giftPalladiumModelId: charm }, admin);
    const after = (await read()).body;
    expect(after.creditCurrency).toBe('CHF');
    expect(after.gifts).toEqual([{ tier: 'PALLADIUM', model: 'ORBITAL CHARM', imageUrl: null }]);
    expect(after.tiers[2]!.lines).toContain('A welcome gift, ORBITAL CHARM, added to your next order.');
    // A gift model no longer active: no gift, no line.
    await h.t.db.updateTable('models').set({ active: false }).where('id', '=', charm).execute();
    const inactive = (await read()).body;
    expect(inactive.gifts).toEqual([]);
    expect(inactive.tiers[2]!.lines.join('\n')).not.toContain('welcome gift');
  });
});
