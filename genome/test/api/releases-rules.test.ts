/**
 * HOW RELEASES WORK's figures (plan NEXT-NINE of 2026-10-06, §3.5 FT-01, step 5.1; GET /api/v1/releases/rules): public
 * (no session), cached a minute, naming no account; the tiers equal the constant (CLUB_TIER_THRESHOLDS), the early
 * access equals THE PROGRAM's windows in minutes and follows them when they change, the place held equals
 * PURCHASE_WINDOW_HOURS' default. Read only: nothing audited, nothing written.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import { PURCHASE_WINDOW_HOURS } from '../../src/server/services/drops.js';
import type { Actor } from '../../src/server/types.js';
import { accountClient, createHarness, safeJson, type Harness } from './support.js';

interface RulesJson {
  tiers: { name: string; level: number; pieces: number }[];
  earlyAccess: { PALLADIUM: number; PLATINE: number };
  placeHeldHours: number;
  salonFromTier: string;
}

describe('GET /api/v1/releases/rules (FT-01)', () => {
  let h: Harness;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    const a = await h.t.db.insertInto('admin_users').values({ email: 'rules@orbes.test', email_normalized: 'rules@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  const read = async (c = h.client()) => {
    const res = await c.get('/api/v1/releases/rules');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    return { body: safeJson(res) as RulesJson, text: res.body };
  };

  it('answers anyone, cached a minute: the tiers from the constant, the early access in minutes, the place held', async () => {
    const { body } = await read();
    expect(Object.keys(body).sort()).toEqual(['earlyAccess', 'placeHeldHours', 'salonFromTier', 'tiers']);
    expect(body.tiers).toEqual(CLUB_TIER_NAMES.map((name, i) => ({ name, level: i + 1, pieces: CLUB_TIER_THRESHOLDS[i] })));
    expect(body.tiers.map((t) => [t.name, t.pieces])).toEqual([
      ['TITANE', 1],
      ['PLATINE', 5],
      ['PALLADIUM', 10],
    ]);
    // THE PROGRAM by default: PALLADIUM 4 hours, PLATINE 2 hours.
    expect(body.earlyAccess).toEqual({ PALLADIUM: 240, PLATINE: 120 });
    expect(body.placeHeldHours).toBe(PURCHASE_WINDOW_HOURS.default);
    expect(body.placeHeldHours).toBe(48);
    expect(body.salonFromTier).toBe('TITANE');
  });

  it('follows THE PROGRAM\'s windows, names no account signed in, and writes nothing', async () => {
    const audits = async () => Number((await h.t.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    const before = await audits();
    const { client, email } = await accountClient(h);
    const signed = await read(client);
    expect(signed.text).not.toContain(email);
    const p = await h.ctx.services.clubProgram.read();
    await h.ctx.services.clubProgram.update({ ...p, earlyAccessPalladiumHours: 6, earlyAccessPlatineHours: 0 }, admin);
    expect((await read()).body.earlyAccess).toEqual({ PALLADIUM: 360, PLATINE: 0 });
    await h.ctx.services.clubProgram.update({ ...p, earlyAccessPalladiumHours: 3, earlyAccessPlatineHours: 3 }, admin);
    expect((await read()).body.earlyAccess).toEqual({ PALLADIUM: 180, PLATINE: 180 });
    const afterUpdates = await audits();
    // The reads write nothing: two more reads leave the audit log as it was.
    await read();
    await read(client);
    expect(await audits()).toBe(afterUpdates);
    expect(afterUpdates).toBeGreaterThan(before);
    await h.ctx.services.clubProgram.update(p, admin);
    expect((await read()).body.earlyAccess).toEqual({ PALLADIUM: 240, PLATINE: 120 });
  });
});
