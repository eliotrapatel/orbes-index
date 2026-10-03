/**
 * OwnershipCertificateService (F-06): the owner's link to a certificate of the live record of a piece. Created by the
 * current owner only, read by anyone holding the link (VALID with the record, NO_LONGER_VALID, or one 404 for an
 * unknown and a withdrawn link), never a name or an email, ended for good by a transfer, a declaration or a revocation,
 * audited at creation and withdrawal, and its PDF deterministic.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import type { ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import {
  canonicalCertificateToken,
  CERTIFICATE_DEFAULT_DAYS,
  CERTIFICATE_TOKEN_LENGTH,
  certificateTokenBytes,
  encodeCertificateToken,
  hashCertificateToken,
  MAX_OPEN_CERTIFICATES,
  OwnershipCertificateService,
} from '../../src/server/services/ownership-certificates.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { createScanToken } from '../../src/server/services/scan-tokens.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const ORIGIN = 'https://verify.orbes.test';
const admin: Actor = { type: 'admin', id: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' };
const MIN = 60_000;
const DAY = 86_400_000;

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('certificate tokens', () => {
  it('writes 32 bytes as 52 Crockford characters and reads them back, in any accepted spelling', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
      const token = encodeCertificateToken(bytes);
      expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{52}$/);
      expect(certificateTokenBytes(token)).toEqual(bytes);
      // Lower case, hyphens and spaces, and the look-alikes I, L and O, read as the same token.
      const typed = token.toLowerCase().match(/.{1,4}/g)!.join('-').replace(/1/g, 'l').replace(/0/g, 'o');
      expect(certificateTokenBytes(` ${typed} `)).toEqual(bytes);
      expect(canonicalCertificateToken(typed)).toBe(token);
      expect(hashCertificateToken(typed)).toEqual(new Uint8Array(createHash('sha256').update(bytes).digest()));
    }
    expect(CERTIFICATE_TOKEN_LENGTH).toBe(52);
    expect(encodeCertificateToken(new Uint8Array(32))).toBe('0'.repeat(52));
    expect(encodeCertificateToken(new Uint8Array(32).fill(255))).toBe(`${'Z'.repeat(51)}G`);
  });

  it('refuses anything that cannot be one token: another length, a U, padding bits set, not a string', () => {
    const token = encodeCertificateToken(new Uint8Array(32).fill(7));
    for (const bad of [token.slice(1), `${token}0`, `U${token.slice(1)}`, `${token.slice(0, 51)}1`, '', 42, null, 'x'.repeat(200)]) {
      expect(certificateTokenBytes(bad), String(bad).slice(0, 20)).toBeUndefined();
      expect(hashCertificateToken(bad)).toBeUndefined();
    }
  });
});

describe('OwnershipCertificateService', () => {
  let t: TestDb;
  let audit: AuditService;
  let lifecycle: LifecycleService;
  let ownership: OwnershipService;
  let certificates: OwnershipCertificateService;
  let modelId: string;
  let serial = 0;
  const clock = createManualClock('2026-10-03T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
    ownership = new OwnershipService({ db: t.db, audit, lifecycle, clock: clock.now, transferKey: new Uint8Array(32).fill(7), requireScannedPiece: false });
    certificates = new OwnershipCertificateService({ db: t.db, audit, ownership, publicOrigin: ORIGIN, clock: clock.now });
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 }).execute();
    const col = await t.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    modelId = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, collection_id: col.id, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => t.close());

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function account(status: 'ACTIVE' | 'LOCKED' = 'ACTIVE') {
    const email = `claire-${randomUUID()}@example.com`;
    const row = await t.db
      .insertInto('accounts')
      .values({ email, email_normalized: email, password_hash: 'unused', display_name: 'Claire Bernard', status })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, email, actor: { type: 'account', id: row.id } as Actor };
  }

  /** A piece sold (its warranty running) and registered to a new account, with its GENOME. */
  async function owned() {
    const s = ++serial;
    const productId = `O26-J-${String(s).padStart(5, '0')}`;
    const packed = packIdentity({ year: 2026, categoryIndex: 1, serial: s });
    const row = await t.db
      .insertInto('products')
      .values({ product_id: productId, packed_identity: packed, year: 2026, category_id: 1, serial: s, sku: `MON-${s}`, model_id: modelId, material: '925 STERLING SILVER', created_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const g = computeGenome(packed, 1);
    await t.db
      .insertInto('genomes')
      .values({ product_id: row.id, genome_version: 1, genome_id: productId, value: g.value, glyphs: [...g.glyphs], pattern: g.ids.join('·'), fingerprint: g.fingerprint })
      .execute();
    await t.db.insertInto('product_status_history').values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: clock.now() }).execute();
    await lifecycle.transition(productId, 'ACTIVATED', {}, admin);
    await t.db.insertInto('warranties').values({ product_id: row.id, duration_months: 24, purchase_date: '2026-09-20', start_date: '2026-09-20', end_date: '2028-09-20' }).execute();
    const owner = await account();
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: row.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const token = (await createScanToken(t.db, { productId: row.id, scanEventId: scan.id, now: clock.now() })).token;
    await ownership.registerFirst(owner.id, { registrationToken: token }, owner.actor);
    clock.advance(MIN);
    return { p: { id: row.id, productId, genome: g }, owner };
  }

  // ── creation ──────────────────────────────────────────────────────────────

  it('creates a link for the current owner: the token in the fragment, only its hash stored, audited without it', async () => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, {}, owner.actor);
    expect(offer.productId).toBe(p.productId);
    expect(offer.token).toMatch(/^[0-9A-HJKMNP-TV-Z]{52}$/);
    expect(offer.url).toBe(`${ORIGIN}/verify/c#${offer.token}`);
    expect(offer.createdAt).toEqual(clock.now());
    expect(offer.expiresAt.getTime() - offer.createdAt.getTime()).toBe(CERTIFICATE_DEFAULT_DAYS * DAY);

    const row = await t.db.selectFrom('ownership_certificates').selectAll().where('id', '=', offer.id).executeTakeFirstOrThrow();
    const current = await t.db.selectFrom('ownership').select('id').where('product_id', '=', p.id).where('ended_at', 'is', null).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ product_id: p.id, ownership_id: current.id, revoked_at: null });
    expect(row.token_hash).toEqual(hashCertificateToken(offer.token));
    expect(Buffer.from(row.token_hash).toString('latin1')).not.toContain(offer.token);

    const entries = await audit.list({ action: 'ownership.certificate.create', targetId: p.productId });
    expect(entries.items.map((e) => [e.actorType, e.actorId, e.details])).toEqual([
      ['account', owner.id, { certificateId: offer.id, expiresAt: offer.expiresAt.toISOString(), validDays: CERTIFICATE_DEFAULT_DAYS }],
    ]);
    expect(JSON.stringify((await audit.list({ targetId: p.productId })).items)).not.toContain(offer.token);
  });

  it('lives 1 to 90 days, as chosen', async () => {
    const { p, owner } = await owned();
    for (const days of [1, 7, 90]) {
      const offer = await certificates.create(owner.id, p.productId, { validDays: days }, owner.actor);
      expect(offer.expiresAt.getTime() - offer.createdAt.getTime()).toBe(days * DAY);
    }
    for (const days of [0, 91, 1.5, -1]) await expectDomainError(certificates.create(owner.id, p.productId, { validDays: days }, owner.actor), 'VALIDATION_FAILED', 400);
  });

  it('is the current owner\'s only: another account and an unknown id get the same NOT_OWNER', async () => {
    const { p } = await owned();
    const stranger = await account();
    const a = await expectDomainError(certificates.create(stranger.id, p.productId, {}, stranger.actor), 'NOT_OWNER', 403);
    const b = await expectDomainError(certificates.create(stranger.id, 'O26-J-99999', {}, stranger.actor), 'NOT_OWNER', 403);
    expect(a.publicMessage).toBe(b.publicMessage);
    expect(await t.db.selectFrom('ownership_certificates').select('id').where('product_id', '=', p.id).execute()).toEqual([]);
  });

  it('is refused for a piece reported lost or stolen, and to an account locked by ORBES Client Services', async () => {
    const { p, owner } = await owned();
    await ownership.reportIncident(owner.id, p.productId, 'STOLEN', owner.actor);
    const e = await expectDomainError(certificates.create(owner.id, p.productId, {}, owner.actor), 'CERTIFICATE_NOT_ALLOWED', 409);
    expect(e.publicMessage).not.toMatch(/STOLEN/i);
    const other = await owned();
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', other.owner.id).execute();
    await expectDomainError(certificates.create(other.owner.id, other.p.productId, {}, other.owner.actor), 'ACCOUNT_LOCKED', 403);
  });

  it('is bound to a live session of the account when one is named (the route always names it): an ended one gets 401 and no link', async () => {
    const { p, owner } = await owned();
    const session = async (subjectId: string, expiresAt: Date) => {
      const idHash = new Uint8Array(createHash('sha256').update(randomUUID()).digest());
      await t.db
        .insertInto('sessions')
        .values({ id_hash: idHash, subject_type: 'account', subject_id: subjectId, csrf_token: 'csrf', created_at: clock.now(), expires_at: expiresAt, last_seen_at: clock.now() })
        .execute();
      return Buffer.from(idHash).toString('hex');
    };
    const live = await session(owner.id, new Date(clock.now().getTime() + DAY));
    const offer = await certificates.create(owner.id, p.productId, { sessionId: live }, owner.actor);
    expect((await certificates.lookup(offer.token)).status).toBe('VALID');
    const ended = await session(owner.id, new Date(clock.now().getTime() + DAY));
    await t.db.deleteFrom('sessions').where('id_hash', '=', new Uint8Array(Buffer.from(ended, 'hex'))).execute();
    const expired = await session(owner.id, new Date(clock.now().getTime() + MIN));
    clock.advance(MIN);
    const another = await session((await account()).id, new Date(clock.now().getTime() + DAY));
    for (const sessionId of [ended, expired, another, 'not-a-session', live.slice(1)]) {
      await expectDomainError(certificates.create(owner.id, p.productId, { sessionId }, owner.actor), 'UNAUTHORIZED', 401);
    }
    expect((await t.db.selectFrom('ownership_certificates').select('id').where('product_id', '=', p.id).execute()).map((r) => r.id)).toEqual([offer.id]);
  });

  it(`keeps at most ${MAX_OPEN_CERTIFICATES} links in use per piece; a withdrawn or expired one makes room`, async () => {
    const { p, owner } = await owned();
    const made = [];
    for (let i = 0; i < MAX_OPEN_CERTIFICATES; i++) made.push(await certificates.create(owner.id, p.productId, { validDays: i === 0 ? 1 : 30 }, owner.actor));
    await expectDomainError(certificates.create(owner.id, p.productId, {}, owner.actor), 'CERTIFICATE_LIMIT', 409);
    await certificates.revoke(owner.id, made[5].id, owner.actor);
    await certificates.create(owner.id, p.productId, {}, owner.actor);
    await expectDomainError(certificates.create(owner.id, p.productId, {}, owner.actor), 'CERTIFICATE_LIMIT', 409);
    clock.advance(DAY);
    await certificates.create(owner.id, p.productId, {}, owner.actor);
  });

  // ── the public lookup ─────────────────────────────────────────────────────

  it('VALID: the piece, its GENOME, the ownership and its day, the warranty, no loss or theft; never a person', async () => {
    const { p, owner } = await owned();
    const since = (await t.db.selectFrom('ownership').select('started_at').where('product_id', '=', p.id).executeTakeFirstOrThrow()).started_at.toISOString().slice(0, 10);
    const offer = await certificates.create(owner.id, p.productId, { validDays: 90 }, owner.actor);
    clock.advance(5 * MIN);
    const r = await certificates.lookup(offer.token);
    expect(r).toEqual({
      status: 'VALID',
      checkedAt: clock.now(),
      certificate: { issuedAt: offer.createdAt, expiresAt: offer.expiresAt },
      piece: {
        productId: p.productId,
        category: { code: 'J', name: 'Jewelry' },
        collection: 'ORBIT',
        model: 'MONOLITHE',
        type: 'RING',
        variant: null,
        material: '925 STERLING SILVER',
        createdYear: 2026,
        genome: { id: p.productId, version: 1, fingerprint: p.genome.fingerprint, glyphs: [...p.genome.glyphs], pattern: p.genome.ids.join('·') },
      },
      ownership: { verified: false, since },
      warranty: { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' },
      incidentReported: false,
    });
    // No personal data: neither the owner's email, name or account, nor the ownership's or the certificate's id.
    const ownershipRow = await t.db.selectFrom('ownership').select('id').where('product_id', '=', p.id).executeTakeFirstOrThrow();
    const json = JSON.stringify(r);
    for (const secret of [owner.email, 'Claire', 'Bernard', owner.id, ownershipRow.id, offer.id, offer.token]) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/AUTHENTIC|email|displayName|accountId/i);
    // Any accepted spelling of the token reads the same certificate.
    expect((await certificates.lookup(offer.token.toLowerCase().match(/.{1,4}/g)!.join('-'))).status).toBe('VALID');
    // Read live: the ownership confirmed by ORBES Client Services shows at once.
    await ownership.confirmOwnership(p.productId, admin);
    expect(await certificates.lookup(offer.token)).toMatchObject({ status: 'VALID', ownership: { verified: true } });
  });

  it('NO_LONGER_VALID after a transfer, for good; the new owner makes their own', async () => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, {}, owner.actor);
    const transfer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
    // A pending transfer changes nothing yet.
    expect((await certificates.lookup(offer.token)).status).toBe('VALID');
    const buyer = await account();
    await ownership.acceptTransfer(buyer.id, { transferCode: transfer.transferCode }, buyer.actor);
    expect(await certificates.lookup(offer.token)).toEqual({ status: 'NO_LONGER_VALID', checkedAt: clock.now() });
    // The seller can neither see it among their links nor make a new one; the buyer can.
    expect(await certificates.listForAccount(owner.id)).toEqual([]);
    await expectDomainError(certificates.create(owner.id, p.productId, {}, owner.actor), 'NOT_OWNER', 403);
    clock.advance(MIN);
    const theirs = await certificates.create(buyer.id, p.productId, {}, buyer.actor);
    expect((await certificates.lookup(theirs.token)).status).toBe('VALID');
    expect((await certificates.lookup(offer.token)).status).toBe('NO_LONGER_VALID');
  });

  it('NO_LONGER_VALID after a declaration, and still after the piece is found: a link made after it is valid', async () => {
    const { p, owner } = await owned();
    const before = await certificates.create(owner.id, p.productId, {}, owner.actor);
    clock.advance(MIN);
    await ownership.reportIncident(owner.id, p.productId, 'LOST', owner.actor);
    expect((await certificates.lookup(before.token)).status).toBe('NO_LONGER_VALID');
    expect(await certificates.listForAccount(owner.id)).toEqual([expect.objectContaining({ id: before.id, valid: false })]);
    clock.advance(MIN);
    await ownership.resolveIncident(owner.id, p.productId, owner.actor);
    expect((await t.db.selectFrom('products').select('status').where('id', '=', p.id).executeTakeFirstOrThrow()).status).toBe('REGISTERED');
    expect((await certificates.lookup(before.token)).status).toBe('NO_LONGER_VALID');
    clock.advance(MIN);
    const after = await certificates.create(owner.id, p.productId, {}, owner.actor);
    expect((await certificates.lookup(after.token)).status).toBe('VALID');
    expect((await certificates.listForAccount(owner.id)).map((c) => [c.id, c.valid])).toEqual([
      [after.id, true],
      [before.id, false],
    ]);
  });

  it.each<[string, ProductStatus[]]>([
    ['STOLEN', ['STOLEN']],
    ['REVOKED', ['REVOKED']],
    ['COUNTERFEIT_FLAGGED', ['COUNTERFEIT_FLAGGED']],
    ['RETIRED', ['RETIRED']],
  ])('NO_LONGER_VALID once the piece is %s (a transition of ORBES Client Services), and no new link is offered or made', async (_name, path) => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, {}, owner.actor);
    const listed = async () => (await ownership.listForAccount(owner.id)).map((x) => [x.productId, x.certificateAllowed]);
    expect(await listed()).toEqual([[p.productId, true]]);
    clock.advance(MIN);
    for (const to of path) await lifecycle.transition(p.productId, to, { reason: 'test' }, admin);
    expect((await certificates.lookup(offer.token)).status).toBe('NO_LONGER_VALID');
    // MY PIECES leaves OWNERSHIP CERTIFICATE out (certificateAllowed false), as the server refuses a new link.
    expect(await listed()).toEqual([[p.productId, false]]);
    await expectDomainError(certificates.create(owner.id, p.productId, {}, owner.actor), 'CERTIFICATE_NOT_ALLOWED', 409);
  });

  it('NO_LONGER_VALID once expired', async () => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, { validDays: 1 }, owner.actor);
    clock.advance(DAY - 1);
    expect((await certificates.lookup(offer.token)).status).toBe('VALID');
    clock.advance(1);
    expect((await certificates.lookup(offer.token)).status).toBe('NO_LONGER_VALID');
    expect(await certificates.listForAccount(owner.id)).toEqual([]);
  });

  it('answers an unknown, a malformed and a withdrawn link with the same 404', async () => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, {}, owner.actor);
    const other = await owned();
    // Another account's link, and an id that does not exist, cannot be withdrawn: the same 404.
    await expectDomainError(certificates.revoke(other.owner.id, offer.id, other.owner.actor), 'CERTIFICATE_NOT_FOUND', 404);
    await expectDomainError(certificates.revoke(owner.id, randomUUID(), owner.actor), 'CERTIFICATE_NOT_FOUND', 404);
    expect((await certificates.lookup(offer.token)).status).toBe('VALID');

    await certificates.revoke(owner.id, offer.id, owner.actor);
    const unknown = await expectDomainError(certificates.lookup(encodeCertificateToken(new Uint8Array(32).fill(9))), 'CERTIFICATE_NOT_FOUND', 404);
    const malformed = await expectDomainError(certificates.lookup('not a token'), 'CERTIFICATE_NOT_FOUND', 404);
    const withdrawn = await expectDomainError(certificates.lookup(offer.token), 'CERTIFICATE_NOT_FOUND', 404);
    expect(withdrawn.toResponse()).toEqual(unknown.toResponse());
    expect(malformed.toResponse()).toEqual(unknown.toResponse());
    await expectDomainError(certificates.renderPdf(offer.token), 'CERTIFICATE_NOT_FOUND', 404);
    // Withdrawn once: a second withdrawal is the same 404, and it left the owner's list.
    await expectDomainError(certificates.revoke(owner.id, offer.id, owner.actor), 'CERTIFICATE_NOT_FOUND', 404);
    expect(await certificates.listForAccount(owner.id)).toEqual([]);
    const entries = await audit.list({ action: 'ownership.certificate.revoke', targetId: p.productId });
    expect(entries.items.map((e) => [e.actorType, e.actorId, e.details])).toEqual([['account', owner.id, { certificateId: offer.id }]]);
    const row = await t.db.selectFrom('ownership_certificates').select('revoked_at').where('id', '=', offer.id).executeTakeFirstOrThrow();
    expect(row.revoked_at).toEqual(clock.now());
  });

  it('lists the owner\'s open links, newest first, without their tokens', async () => {
    const { p, owner } = await owned();
    const first = await certificates.create(owner.id, p.productId, {}, owner.actor);
    clock.advance(MIN);
    const second = await certificates.create(owner.id, p.productId, { validDays: 7 }, owner.actor);
    const list = await certificates.listForAccount(owner.id);
    expect(list).toEqual([
      { id: second.id, productId: p.productId, createdAt: second.createdAt, expiresAt: second.expiresAt, valid: true },
      { id: first.id, productId: p.productId, createdAt: first.createdAt, expiresAt: first.expiresAt, valid: true },
    ]);
    expect(JSON.stringify(list)).not.toContain(first.token);
  });

  // ── PDF ───────────────────────────────────────────────────────────────────

  it('renders the PDF of a VALID certificate, deterministically, with its live link and no person in it', async () => {
    const { p, owner } = await owned();
    const offer = await certificates.create(owner.id, p.productId, {}, owner.actor);
    const a = await certificates.renderPdf(offer.token);
    const b = await certificates.renderPdf(offer.token.toLowerCase());
    expect(a.contentType).toBe('application/pdf');
    expect(a.filename).toBe(`ORBES-ownership-certificate-${p.productId}-${clock.now().toISOString().slice(0, 10)}.pdf`);
    expect(Buffer.from(a.body as Uint8Array).equals(Buffer.from(b.body as Uint8Array))).toBe(true);
    const text = Buffer.from(a.body as Uint8Array).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    // The link, as an annotation (the lettering is paths, never text); no font; no person.
    expect(text).toContain(`/URI (${offer.url})`);
    expect(text).not.toMatch(/\/Font\b/);
    for (const secret of [owner.email, 'Claire', owner.id]) expect(text).not.toContain(secret);
    // Once the record changes, no PDF.
    await ownership.reportIncident(owner.id, p.productId, 'LOST', owner.actor);
    await expectDomainError(certificates.renderPdf(offer.token), 'CERTIFICATE_NO_LONGER_VALID', 409);
  });
});
