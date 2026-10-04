/**
 * The tiers of the collectors' club (P-X04):
 *
 *  - the club's status (GET /api/v1/club/status, no-store): the account's
 *    tier and pieces as before, the benefits of its tier and of those below
 *    it (lowest first) and the next tier (the pieces it starts from, how many
 *    more, what it adds); PALLADIUM has none; an account without a tier reads
 *    what a first piece opens; a revoked piece counts for nothing;
 *  - the default words are constants of the code: `club_tiers` holds no row
 *    until the console changes a tier, and loses it when the tier is
 *    restored (null, blank text, or the default words exactly);
 *  - the console (/api/admin/club/tiers; an AUDITOR reads, OPERATOR writes):
 *    one benefit per line, blank lines and spaces dropped, at most 600
 *    characters and 8 lines; a name that is not a tier is refused; each
 *    change audited `club.tier.update`; the thresholds never change;
 *  - the owner's sheet (A-06) gains the account's tier;
 *  - /api/v1/account/me does not change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLUB_TIER_DEFAULT_BENEFITS, CLUB_TIER_THRESHOLDS, benefitLines, normalizeBenefits } from '../../src/server/services/club.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface NextJson {
  level: number;
  name: string;
  pieces: number;
  missing: number;
  benefits: string[];
}

interface StatusJson {
  tier: { level: number; name: string | null };
  pieces: number;
  seniority: number;
  benefits: string[];
  next: NextJson | null;
  entries: unknown[];
}

interface TierJson {
  tier: string;
  level: number;
  pieces: number;
  benefits: string;
  defaultBenefits: string;
  edited: boolean;
  updatedAt: string | null;
}

const lines = (name: keyof typeof CLUB_TIER_DEFAULT_BENEFITS) => benefitLines(CLUB_TIER_DEFAULT_BENEFITS[name]);

describe('the tiers of the club (P-X04)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<IssueResult> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return p;
  }

  const status = async (c: Client): Promise<StatusJson> => {
    const res = await c.get('/api/v1/club/status');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return safeJson(res) as StatusJson;
  };

  const tiers = async (c: Client): Promise<TierJson[]> => {
    const res = await c.get('/api/admin/club/tiers');
    expect(res.statusCode, res.body).toBe(200);
    return (safeJson(res) as { items: TierJson[] }).items;
  };

  const audits = () => h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'club.tier.update').orderBy('id').execute();

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  it('gives each account its tier, the benefits of its tier and of those below, and the way to the next one', async () => {
    expect(CLUB_TIER_THRESHOLDS).toEqual([1, 3, 5]);
    const { client } = await accountClient(h);
    // No piece: no benefit yet, and what a first piece opens.
    expect(await status(client)).toMatchObject({
      tier: { level: 0, name: null },
      pieces: 0,
      benefits: [],
      next: { level: 1, name: 'TITANE', pieces: 1, missing: 1, benefits: lines('TITANE') },
      entries: [],
    });
    const pieces: IssueResult[] = [await ownedPiece(client)];
    expect(await status(client)).toMatchObject({
      tier: { level: 1, name: 'TITANE' },
      pieces: 1,
      benefits: lines('TITANE'),
      next: { level: 2, name: 'PLATINE', pieces: 3, missing: 2, benefits: lines('PLATINE') },
    });
    for (let i = 0; i < 2; i++) pieces.push(await ownedPiece(client));
    expect(await status(client)).toMatchObject({
      tier: { level: 2, name: 'PLATINE' },
      pieces: 3,
      benefits: [...lines('TITANE'), ...lines('PLATINE')],
      next: { level: 3, name: 'PALLADIUM', pieces: 5, missing: 2, benefits: lines('PALLADIUM') },
    });
    for (let i = 0; i < 2; i++) pieces.push(await ownedPiece(client));
    const top = await status(client);
    expect(top).toMatchObject({ tier: { level: 3, name: 'PALLADIUM' }, pieces: 5, benefits: [...lines('TITANE'), ...lines('PLATINE'), ...lines('PALLADIUM')] });
    expect(top.next).toBeNull();
    // A piece revoked by ORBES counts for nothing: back to PLATINE, one piece from PALLADIUM.
    await h.ctx.services.lifecycle.transition(pieces[0]!.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    expect(await status(client)).toMatchObject({ tier: { level: 2, name: 'PLATINE' }, pieces: 4, next: { name: 'PALLADIUM', missing: 1 } });
    // /api/v1/account/me does not change: no tier there.
    const me = safeJson(await client.get('/api/v1/account/me')) as Record<string, unknown>;
    expect(JSON.stringify(me)).not.toMatch(/TITANE|PLATINE|PALLADIUM|benefits/);
    // Signed out: 401, as every route of the club.
    expect((await h.client().get('/api/v1/club/status')).statusCode).toBe(401);
  });

  it('keeps the default words in the code: no row until the console changes a tier', async () => {
    expect(await h.ctx.db.selectFrom('club_tiers').selectAll().execute()).toEqual([]);
    const read = await tiers(auditor);
    expect(read.map((t) => [t.tier, t.level, t.pieces, t.edited, t.updatedAt])).toEqual([
      ['TITANE', 1, 1, false, null],
      ['PLATINE', 2, 3, false, null],
      ['PALLADIUM', 3, 5, false, null],
    ]);
    for (const t of read) {
      expect(t.benefits).toBe(CLUB_TIER_DEFAULT_BENEFITS[t.tier as keyof typeof CLUB_TIER_DEFAULT_BENEFITS]);
      expect(t.defaultBenefits).toBe(t.benefits);
      // In English, one benefit per line, within the bounds the console holds them to.
      expect(normalizeBenefits(t.benefits)).toBe(t.benefits);
      expect(t.benefits).not.toMatch(/!|product|token|NFT|crypto|lottery/i);
    }
    // PLATINE says its early access, 48 hours by default; PALLADIUM its commissions and the atelier.
    expect(CLUB_TIER_DEFAULT_BENEFITS.TITANE).toMatch(/circle/);
    expect(CLUB_TIER_DEFAULT_BENEFITS.TITANE).toMatch(/draw/);
    expect(CLUB_TIER_DEFAULT_BENEFITS.PLATINE).toMatch(/Priority care/);
    expect(CLUB_TIER_DEFAULT_BENEFITS.PLATINE).toMatch(/48 hours/);
    expect(CLUB_TIER_DEFAULT_BENEFITS.PALLADIUM).toMatch(/commissions/);
    expect(CLUB_TIER_DEFAULT_BENEFITS.PALLADIUM).toMatch(/yearly visit to the ORBES atelier/);
  });

  it('lets OPERATOR change a tier\'s words, one per line, audited, read at once by the club; restored, the row goes', async () => {
    const before = (await audits()).length;
    // An AUDITOR reads, never writes.
    const refused = await auditor.patch('/api/admin/club/tiers/PLATINE', { benefits: 'Nothing.' });
    expect([refused.statusCode, errorOf(refused).code]).toEqual([403, 'FORBIDDEN']);
    // Refused before anything is written: too long, too many lines, not a tier, a threshold, an unknown field.
    const bad = async (url: string, body: unknown, code = 'VALIDATION_FAILED', statusCode = 400) => {
      const res = await operator.patch(url, body);
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body).slice(0, 80)).toEqual([statusCode, code]);
    };
    await bad('/api/admin/club/tiers/PLATINE', { benefits: 'x'.repeat(601) });
    await bad('/api/admin/club/tiers/PLATINE', { benefits: Array.from({ length: 9 }, (_, i) => `Benefit ${i + 1}.`).join('\n') });
    await bad('/api/admin/club/tiers/GOLD', { benefits: 'A benefit.' });
    await bad('/api/admin/club/tiers/platine', { benefits: 'A benefit.' });
    await bad('/api/admin/club/tiers/PLATINE', { benefits: 'A benefit.', pieces: 2 });
    await bad('/api/admin/club/tiers/PLATINE', {});
    expect(await h.ctx.db.selectFrom('club_tiers').selectAll().execute()).toEqual([]);

    // Saved: blank lines and the spaces around each dropped.
    const res = await operator.patch('/api/admin/club/tiers/PLATINE', { benefits: '  Priority care for your pieces.  \r\n\r\n A private viewing of each release.\n' });
    expect(res.statusCode, res.body).toBe(200);
    const saved = safeJson(res) as TierJson;
    expect(saved).toMatchObject({ tier: 'PLATINE', level: 2, pieces: 3, benefits: 'Priority care for your pieces.\nA private viewing of each release.', edited: true });
    expect(Date.parse(saved.updatedAt!)).not.toBeNaN();
    expect((await tiers(auditor)).find((t) => t.tier === 'PLATINE')).toMatchObject({ edited: true, defaultBenefits: CLUB_TIER_DEFAULT_BENEFITS.PLATINE });
    const row = await h.ctx.db.selectFrom('club_tiers').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ tier: 'PLATINE', benefits: saved.benefits });
    expect(row.updated_by).toMatch(/^[0-9a-f-]{36}$/);
    // Audited with the words set and the previous ones (null: the default words).
    const entries = (await audits()).slice(before);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor_type: 'admin', target_type: 'club_tier', target_id: 'PLATINE', details: { tier: 'PLATINE', benefits: saved.benefits, previous: null } });

    // The club reads the new words at once: the next tier of a TITANE owner, the benefits of a PLATINE one.
    const { client } = await accountClient(h);
    await ownedPiece(client);
    expect((await status(client)).next).toMatchObject({ name: 'PLATINE', benefits: ['Priority care for your pieces.', 'A private viewing of each release.'] });
    for (let i = 0; i < 2; i++) await ownedPiece(client);
    expect((await status(client)).benefits).toEqual([...lines('TITANE'), 'Priority care for your pieces.', 'A private viewing of each release.']);

    // Changed again, then restored by null: the row goes, the default words are back, each change audited.
    expect((await operator.patch('/api/admin/club/tiers/PLATINE', { benefits: 'Priority care.' })).statusCode).toBe(200);
    const restored = safeJson(await operator.patch('/api/admin/club/tiers/PLATINE', { benefits: null })) as TierJson;
    expect(restored).toMatchObject({ benefits: CLUB_TIER_DEFAULT_BENEFITS.PLATINE, edited: false, updatedAt: null });
    expect(await h.ctx.db.selectFrom('club_tiers').selectAll().execute()).toEqual([]);
    expect((await audits()).slice(before).map((e) => (e.details as { benefits: string | null; previous: string | null }))).toEqual([
      { tier: 'PLATINE', benefits: saved.benefits, previous: null },
      { tier: 'PLATINE', benefits: 'Priority care.', previous: saved.benefits },
      { tier: 'PLATINE', benefits: null, previous: 'Priority care.' },
    ]);
    expect((await status(client)).benefits).toEqual([...lines('TITANE'), ...lines('PLATINE')]);
    // Blank text, or the default words exactly, keep no row either.
    expect((await operator.patch('/api/admin/club/tiers/TITANE', { benefits: '   ' })).statusCode).toBe(200);
    expect((await operator.patch('/api/admin/club/tiers/PALLADIUM', { benefits: `${CLUB_TIER_DEFAULT_BENEFITS.PALLADIUM}\n` })).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('club_tiers').selectAll().execute()).toEqual([]);
    // The service refuses a writer that is not an ORBES admin.
    await expect(h.ctx.services.club.updateTier('TITANE', 'A benefit.', SYSTEM_ACTOR)).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });
  });

  it('shows the account\'s tier on its sheet (A-06)', async () => {
    const { client, email } = await accountClient(h);
    for (let i = 0; i < 3; i++) await ownedPiece(client);
    const account = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const sheet = safeJson(await auditor.get(`/api/admin/owners/${account.id}`)) as { tier: unknown };
    expect(sheet.tier).toEqual({ level: 2, name: 'PLATINE', pieces: 3, seniority: 0 });
    const { client: other, email: otherEmail } = await accountClient(h);
    expect(other).toBeDefined();
    const none = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', otherEmail).executeTakeFirstOrThrow();
    expect((safeJson(await operator.get(`/api/admin/owners/${none.id}`)) as { tier: unknown }).tier).toEqual({ level: 0, name: null, pieces: 0, seniority: 0 });
  });
});
