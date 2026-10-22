/**
 * WORN, the owners' gallery (macro scope of 2026-10-20, D31 G1 to G5; lot M2 plan §2.1, §2.2 and §2.5, step M2.7;
 * services/worn.ts), on PGlite with the clock fixed:
 *
 *  - every sending rule: the piece held now (an open ownership), ACTIVE, not a test entrant, a held status, no transfer
 *    pending, a sheet for its model's group, YOUR PROFILE's first name and the account's country, the consent of the
 *    version in force; never held → 404;
 *  - the image through sanitizeImage exactly as media (EXIF and its GPS removed, an orientation other than 1 refused,
 *    another type refused, 1 MiB at most), the table's bounds the same as the sanitizer's;
 *  - one live photograph per piece, the rate of 5 sendings in 24 hours, the consent stored with its time and version, the
 *    credit written at sending (the Instagram name only when chosen) and kept after a profile change;
 *  - publish, refuse, take down and withdraw, the bytes erased each time but on publishing, the reviewer and dates, the
 *    audit (never the credit's name), a stale review refused;
 *  - the read-time rule: a piece passed on, returned or revoked, a LOCKED account: no longer shown, at once; endLeft
 *    ends them (ENDED, bytes erased, audited by count), a new owner's sending as well;
 *  - the sheet's read: the whole group (every variant), newest first, 12 a page with the total, the credit exactly first
 *    name, country and Instagram when chosen, never a serial, an account or a variant's label;
 *  - the photographs' readers (public, owner, staff), the console's queue and summary, the account's export.
 *
 * Under concurrency (PostgreSQL in genome-ci, ORBES_TEST_POSTGRES_URL; skipped here): two sendings for one piece at once,
 * one PENDING, the other WORN_ALREADY.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { WORN_PHOTO_MAX_BYTES, WORN_PHOTO_MAX_SIDE } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '../../src/server/media/image.js';
import { AuditService } from '../../src/server/services/audit.js';
import { accountWornPhotos, WORN_CONSENT_VERSION, WORN_PAGE_SIZE, WORN_RATE, WornService } from '../../src/server/services/worn.js';
import { LookbookService } from '../../src/server/services/lookbook.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { GPS_SECRET, includesText, jpegPhoto, pngImage, SEGMENTS, withJpegSegments } from '../support/images.js';
import { createAccount, createModel, holdPieces } from '../support/live.js';

const z = (iso: string) => new Date(iso);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'OK';
}

/** A JPEG with EXIF (its GPS position) and a comment: what a phone sends. */
const phonePhoto = (w = 64, h = 48) => withJpegSegments(jpegPhoto(w, h), [SEGMENTS.exifOriented(1), SEGMENTS.comment()]);

interface World {
  db: Db;
  clock: ManualClock;
  audit: AuditService;
  worn: WornService;
  lookbook: LookbookService;
  admin: Actor & { id: string };
}

async function worldOn(db: Db, start: string): Promise<World> {
  const clock = createManualClock(start);
  const audit = new AuditService({ db, clock: clock.now });
  await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
  const email = `worn-admin-${randomUUID()}@orbes.test`;
  const adminId = (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id;
  return { db, clock, audit, worn: new WornService({ db, audit, clock: clock.now }), lookbook: new LookbookService({ db, clock: clock.now }), admin: { type: 'admin', id: adminId } };
}

/** A model shown in the lookbook (PUBLIC by default) with its address; a variant of `of` when given. */
async function sheetModel(db: Db, name: string, o: { lookbook?: 'PUBLIC' | 'RESERVED' | 'HIDDEN'; of?: string; label?: string } = {}): Promise<{ id: string; slug: string }> {
  const id = await createModel(db, name);
  const slug = `${name.toLowerCase()}-${id.slice(0, 8)}`;
  // The main model of a group carries its own label (N1).
  if (o.of) await db.updateTable('models').set({ variant_label: sql`coalesce(variant_label, 'Silver')`, variant_swatch: sql`coalesce(variant_swatch, '#8A8D8F')` }).where('id', '=', o.of).execute();
  await db
    .updateTable('models')
    .set({
      slug,
      lookbook: o.lookbook ?? 'PUBLIC',
      published_at: z('2026-01-01T00:00:00Z'),
      ...(o.of ? { variant_of: o.of, variant_label: o.label ?? 'Gold', variant_swatch: '#C9A227' } : {}),
    })
    .where('id', '=', id)
    .execute();
  return { id, slug };
}

/** An ACTIVE account with YOUR PROFILE's first name, its country and, when given, its Instagram name. */
async function owner(db: Db, o: { firstName?: string | null; country?: string | null; instagram?: string | null } = {}) {
  const a = await createAccount(db);
  await db.updateTable('accounts').set({ country: o.country === undefined ? 'FR' : o.country }).where('id', '=', a.id).execute();
  const firstName = o.firstName === undefined ? 'Camille' : o.firstName;
  await db.insertInto('account_profiles').values({ account_id: a.id, first_name: firstName, instagram: o.instagram ?? null }).execute();
  return a;
}

const serialOf = async (db: Db, id: string) => (await db.selectFrom('products').select('product_id').where('id', '=', id).executeTakeFirstOrThrow()).product_id;
const rowOf = (db: Db, id: string) => db.selectFrom('worn_photos').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const audits = (db: Db, action: string) => db.selectFrom('audit_logs').selectAll().where('action', '=', action).orderBy('id').execute();
const jpeg = (bytes: Uint8Array = phonePhoto()) => ({ mime: 'image/jpeg' as const, bytes });

/** Pass the piece to another account, as an accepted transfer does: its ownership ended, the new one open. */
async function passOn(db: Db, productId: string, to: string, at: Date) {
  await db.updateTable('ownership').set({ ended_at: at, ended_reason: 'TRANSFERRED_OUT' }).where('product_id', '=', productId).where('ended_at', 'is', null).execute();
  await db.insertInto('ownership').values({ product_id: productId, account_id: to, acquired_via: 'TRANSFER', started_at: at }).execute();
}

describe('WORN (plan MACRO M2 §2.1, §2.2)', () => {
  let t: TestDb;
  let w: World;
  let ring: { id: string; slug: string };
  let gold: { id: string; slug: string };

  beforeAll(async () => {
    t = await createTestDb();
    w = await worldOn(t.db, '2026-11-02T10:00:00.000Z');
    ring = await sheetModel(t.db, 'MONOLITHE');
    gold = await sheetModel(t.db, 'MONOLITHEG', { of: ring.id, label: 'Gold' });
  });
  afterAll(() => t?.close());

  /** An owner of a new piece of `model` (MONOLITHE by default), and the piece's serial. */
  async function holder(model = ring.id, o: Parameters<typeof owner>[1] = {}) {
    const a = await owner(t.db, o);
    const [id] = await holdPieces(t.db, a.id, 1, model);
    return { ...a, productId: id!, serial: await serialOf(t.db, id!) };
  }
  const send = (h: { id: string; serial: string; actor: Actor }, o: { instagram?: boolean; consent?: unknown; bytes?: Uint8Array; mime?: 'image/jpeg' | 'image/webp' } = {}) =>
    w.worn.send(h.id, h.serial, { mime: o.mime ?? 'image/jpeg', bytes: o.bytes ?? phonePhoto() }, { instagram: o.instagram, consent: 'consent' in o ? o.consent : WORN_CONSENT_VERSION }, h.actor);

  it('holds the table’s bounds to the sanitizer’s: 1 MiB and 4 096 px (media/image.ts)', () => {
    expect(WORN_PHOTO_MAX_BYTES).toBe(MAX_IMAGE_BYTES);
    expect(WORN_PHOTO_MAX_SIDE).toBe(MAX_IMAGE_SIDE);
  });

  it('sends a photograph from a held piece: PENDING, its EXIF removed, the credit and the consent written, audited without the name', async () => {
    const h = await holder(ring.id, { instagram: 'camille.m' });
    const before = await w.worn.ofPiece(h.id, h.serial);
    expect(before).toEqual({
      sheet: { slug: ring.slug },
      photo: null,
      canSend: true,
      reason: null,
      credit: { firstName: 'Camille', country: 'France', instagram: 'camille.m' },
      consentVersion: WORN_CONSENT_VERSION,
    });
    const photo = phonePhoto();
    expect(includesText(photo, GPS_SECRET)).toBe(true);
    const after = await send(h, { bytes: photo });
    expect(after.canSend).toBe(false);
    expect(after.reason).toBe('LIVE');
    expect(after.photo).toMatchObject({ status: 'PENDING', sentAt: w.clock.now(), publishedAt: null, endedAt: null, refusal: null, credit: { firstName: 'Camille', country: 'France', instagram: null }, width: 64, height: 48 });
    expect(after.photo!.url).toBe(`/api/v1/account/worn/${after.photo!.id}/photo`);
    const row = await rowOf(t.db, after.photo!.id);
    expect(includesText(row.photo!, GPS_SECRET)).toBe(false);
    expect(row.photo_sha256).toBe(createHash('sha256').update(row.photo!).digest('hex'));
    expect(row).toMatchObject({ product_id: h.productId, account_id: h.id, model_id: ring.id, photo_mime: 'image/jpeg', credit_first_name: 'Camille', credit_country: 'FR', credit_instagram: null, consent_version: WORN_CONSENT_VERSION, consent_at: w.clock.now(), status: 'PENDING' });
    const [entry] = (await audits(t.db, 'worn.send')).filter((a) => a.target_id === row.id);
    expect(entry!.details).toEqual({ id: row.id, productId: h.serial, modelId: ring.id, bytes: row.photo!.length, sha256: row.photo_sha256, instagram: false });
    expect(JSON.stringify(entry)).not.toContain('Camille');
  });

  it('shows the Instagram name only when chosen, and keeps the credit as sent after the profile changes', async () => {
    const h = await holder(ring.id, { instagram: 'camille.m' });
    const sent = await send(h, { instagram: true });
    expect(sent.photo!.credit).toEqual({ firstName: 'Camille', country: 'France', instagram: 'camille.m' });
    await t.db.updateTable('account_profiles').set({ first_name: 'Lou', instagram: 'lou.x' }).where('account_id', '=', h.id).execute();
    await t.db.updateTable('accounts').set({ country: 'IT' }).where('id', '=', h.id).execute();
    const read = await w.worn.ofPiece(h.id, h.serial);
    expect(read.photo!.credit).toEqual({ firstName: 'Camille', country: 'France', instagram: 'camille.m' });
    expect(read.credit).toEqual({ firstName: 'Lou', country: 'Italy', instagram: 'lou.x' });
    // Chosen without a name in YOUR PROFILE: none shown.
    const bare = await holder(ring.id);
    expect((await send(bare, { instagram: true })).photo!.credit.instagram).toBeNull();
  });

  it('refuses the consent missing or of another version, before reading the image (422 WORN_CONSENT)', async () => {
    const h = await holder();
    for (const consent of [undefined, '', '2026-01-01', true]) expect(await codeOf(send(h, { consent, bytes: pngImage() }))).toBe('WORN_CONSENT');
    expect(await t.db.selectFrom('worn_photos').select('id').where('account_id', '=', h.id).execute()).toEqual([]);
  });

  it('refuses each piece that cannot send, and says why on its WORN', async () => {
    const reasonOf = async (h: { id: string; serial: string }) => (await w.worn.ofPiece(h.id, h.serial)).reason;
    // NO_SHEET: no model of its group is shown; a variant hidden whose main model is shown sends, to its group's sheet.
    const hidden = await sheetModel(t.db, 'HIDDEN', { lookbook: 'HIDDEN' });
    const a = await holder(hidden.id);
    expect(await reasonOf(a)).toBe('NO_SHEET');
    expect((await w.worn.ofPiece(a.id, a.serial)).sheet).toBeNull();
    expect(await codeOf(send(a))).toBe('WORN_NOT_ALLOWED');
    const hiddenVariant = await sheetModel(t.db, 'MONOLITHES', { of: ring.id, lookbook: 'HIDDEN', label: 'Steel' });
    const v = await holder(hiddenVariant.id);
    expect((await w.worn.ofPiece(v.id, v.serial)).sheet).toEqual({ slug: ring.slug });
    expect(await codeOf(send(v))).toBe('OK');
    // A RESERVED sheet counts.
    const reserved = await sheetModel(t.db, 'ZENITH', { lookbook: 'RESERVED' });
    expect(await codeOf(send(await holder(reserved.id)))).toBe('OK');
    // TEST_ENTRANT.
    const te = await holder();
    await t.db.insertInto('test_entrants').values({ account_id: te.id }).execute();
    expect(await reasonOf(te)).toBe('TEST_ENTRANT');
    expect(await codeOf(send(te))).toBe('WORN_NOT_ALLOWED');
    // STATUS: lost, stolen or in service.
    for (const status of ['LOST', 'STOLEN', 'SERVICED'] as const) {
      const s = await holder();
      await t.db.updateTable('products').set({ status }).where('id', '=', s.productId).execute();
      expect(await reasonOf(s), status).toBe('STATUS');
      expect(await codeOf(send(s)), status).toBe('WORN_NOT_ALLOWED');
    }
    // TRANSFER_PENDING.
    const tp = await holder();
    await t.db.insertInto('ownership_transfers').values({ product_id: tp.productId, from_account_id: tp.id, token_hash: randomBytes(32), expires_at: new Date(w.clock.now().getTime() + 86_400_000) }).execute();
    expect(await reasonOf(tp)).toBe('TRANSFER_PENDING');
    expect(await codeOf(send(tp))).toBe('WORN_NOT_ALLOWED');
    // NOT_HELD: passed on; never held: 404.
    const was = await holder();
    const next = await owner(t.db);
    await passOn(t.db, was.productId, next.id, w.clock.now());
    expect(await reasonOf(was)).toBe('NOT_HELD');
    expect(await codeOf(send(was))).toBe('WORN_NOT_ALLOWED');
    const stranger = await owner(t.db);
    expect(await codeOf(w.worn.ofPiece(stranger.id, was.serial))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(w.worn.send(stranger.id, was.serial, jpeg(), { consent: WORN_CONSENT_VERSION }, stranger.actor))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(w.worn.ofPiece(stranger.id, 'O26-J-99999'))).toBe('PRODUCT_NOT_FOUND');
    // PROFILE_INCOMPLETE: no first name, or no country (409).
    for (const o of [{ firstName: null }, { country: null }]) {
      const p = await holder(ring.id, o);
      expect(await reasonOf(p)).toBe('PROFILE_INCOMPLETE');
      expect((await w.worn.ofPiece(p.id, p.serial)).credit).toEqual({ firstName: o.firstName === null ? null : 'Camille', country: o.country === null ? null : 'France', instagram: null });
      expect(await codeOf(send(p))).toBe('WORN_PROFILE_INCOMPLETE');
    }
    // A LOCKED account sends nothing.
    const locked = await holder();
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    expect(await codeOf(send(locked))).toBe('ACCOUNT_LOCKED');
  });

  it('takes the image exactly as media does: another type, an orientation other than 1, over 1 MiB refused', async () => {
    const h = await holder();
    expect(await codeOf(send(h, { bytes: pngImage() }))).toBe('IMAGE_INVALID');
    expect(await codeOf(send(h, { bytes: jpegPhoto(), mime: 'image/webp' }))).toBe('IMAGE_INVALID');
    expect(await codeOf(send(h, { bytes: withJpegSegments(jpegPhoto(), [SEGMENTS.exifOriented(6)]) }))).toBe('IMAGE_INVALID');
    const heavy = new Uint8Array(MAX_IMAGE_BYTES + 1);
    heavy.set(jpegPhoto());
    expect(await codeOf(send(h, { bytes: heavy }))).toBe('PAYLOAD_TOO_LARGE');
    expect(await t.db.selectFrom('worn_photos').select('id').where('account_id', '=', h.id).execute()).toEqual([]);
  });

  it('keeps one live photograph per piece, and at most 5 sendings an account in 24 hours', async () => {
    const h = await holder();
    const first = await send(h);
    expect(await codeOf(send(h))).toBe('WORN_ALREADY');
    await w.worn.withdraw(h.id, first.photo!.id, h.actor);
    expect((await w.worn.ofPiece(h.id, h.serial)).photo).toBeNull();
    // Withdrawn three more times: the fifth sending of the day is the last.
    for (let i = 0; i < 3; i++) {
      w.clock.advance(60_000);
      const s = await send(h);
      await w.worn.withdraw(h.id, s.photo!.id, h.actor);
    }
    w.clock.advance(60_000);
    const fifth = await send(h);
    await w.worn.withdraw(h.id, fifth.photo!.id, h.actor);
    expect(WORN_RATE.max).toBe(5);
    expect(await codeOf(send(h))).toBe('WORN_LIMIT');
    // Another of its pieces too: the rate is the account's.
    const [other] = await holdPieces(t.db, h.id, 1, ring.id);
    expect(await codeOf(w.worn.send(h.id, other!, jpeg(), { consent: WORN_CONSENT_VERSION }, h.actor))).toBe('WORN_LIMIT');
    // A rolling 24 hours after the first.
    w.clock.advance(24 * 60 * 60_000 - 4 * 60_000);
    expect(await codeOf(send(h))).toBe('OK');
  });

  it('publishes, refuses, takes down and withdraws, erasing the bytes but on publishing; a stale review is refused', async () => {
    // Refused: its reason, the reviewer, the bytes erased; the owner may send another.
    const r = await holder();
    const sent = (await send(r)).photo!;
    w.clock.advance(60_000);
    await w.worn.refuse(sent.id, 'QUALITY', w.admin);
    let row = await rowOf(t.db, sent.id);
    expect(row).toMatchObject({ status: 'REFUSED', refusal: 'QUALITY', reviewed_by: w.admin.id, reviewed_at: w.clock.now(), published_at: null, ended_at: w.clock.now(), photo: null, photo_mime: null, photo_sha256: null, width: null, height: null });
    const refused = await w.worn.ofPiece(r.id, r.serial);
    expect(refused).toMatchObject({ canSend: true, reason: null, photo: { status: 'REFUSED', refusal: 'QUALITY', url: null, width: null } });
    expect(await codeOf(w.worn.publish(sent.id, w.admin))).toBe('WORN_STATE');
    expect(await codeOf(w.worn.refuse(sent.id, 'QUALITY', w.admin))).toBe('WORN_STATE');
    // Published: the bytes kept, then taken down: erased, published_at kept.
    const p = await holder();
    const two = (await send(p)).photo!;
    expect(await codeOf(w.worn.takeDown(two.id, 'NOT_SUITABLE', w.admin))).toBe('WORN_STATE');
    expect(await codeOf(w.worn.refuse(two.id, 'NOPE', w.admin))).toBe('VALIDATION_FAILED');
    expect(await codeOf(w.worn.publish(two.id, p.actor))).toBe('FORBIDDEN');
    w.clock.advance(60_000);
    await w.worn.publish(two.id, w.admin);
    const publishedAt = w.clock.now();
    row = await rowOf(t.db, two.id);
    expect(row).toMatchObject({ status: 'PUBLISHED', reviewed_by: w.admin.id, published_at: publishedAt, ended_at: null, refusal: null });
    expect(row.photo).not.toBeNull();
    expect((await w.worn.ofPiece(p.id, p.serial)).photo).toMatchObject({ status: 'PUBLISHED', publishedAt });
    w.clock.advance(60_000);
    await w.worn.takeDown(two.id, 'NOT_SUITABLE', w.admin);
    row = await rowOf(t.db, two.id);
    expect(row).toMatchObject({ status: 'TAKEN_DOWN', refusal: 'NOT_SUITABLE', published_at: publishedAt, ended_at: w.clock.now(), photo: null });
    // Withdrawn by its owner, in review or published; another's, or one settled: 404.
    const o = await holder();
    const three = (await send(o)).photo!;
    await w.worn.publish(three.id, w.admin);
    expect(await codeOf(w.worn.withdraw(r.id, three.id, r.actor))).toBe('WORN_NOT_FOUND');
    await w.worn.withdraw(o.id, three.id, o.actor);
    row = await rowOf(t.db, three.id);
    expect(row).toMatchObject({ status: 'WITHDRAWN', ended_at: w.clock.now(), photo: null, refusal: null });
    expect(row.published_at).not.toBeNull();
    expect(await codeOf(w.worn.withdraw(o.id, three.id, o.actor))).toBe('WORN_NOT_FOUND');
    expect(await codeOf(w.worn.withdraw(o.id, 'not-an-id', o.actor))).toBe('WORN_NOT_FOUND');
    for (const [action, id, extra] of [
      ['worn.refuse', sent.id, { refusal: 'QUALITY' }],
      ['worn.publish', two.id, {}],
      ['worn.take_down', two.id, { refusal: 'NOT_SUITABLE' }],
      ['worn.withdraw', three.id, { from: 'PUBLISHED' }],
    ] as const) {
      const entries = (await audits(t.db, action)).filter((a) => a.target_id === id);
      expect(entries, action).toHaveLength(1);
      expect(entries[0]!.details, action).toMatchObject({ id, ...extra });
      expect(JSON.stringify(entries[0]), action).not.toContain('Camille');
    }
  });

  it('reads a sheet’s WORN: every variant of its group, newest first, 12 a page, the credit only', async () => {
    const main = await sheetModel(t.db, 'ORBIT');
    const variant = await sheetModel(t.db, 'ORBITG', { of: main.id, label: 'Rose Gold' });
    const ids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const h = await holder(i % 2 === 0 ? main.id : variant.id, { firstName: `Name${i}`, country: i === 0 ? 'GB' : 'FR', instagram: i === 0 ? 'name.zero' : null });
      const s = (await send(h, { instagram: true })).photo!;
      w.clock.advance(60_000);
      await w.worn.publish(s.id, w.admin);
      ids.push(s.id);
    }
    // One in review: not shown.
    const pending = await holder(main.id);
    await send(pending);
    const page1 = await w.worn.forSheet([main.id, variant.id], 1);
    expect(page1.total).toBe(14);
    expect(page1.pageSize).toBe(WORN_PAGE_SIZE);
    expect(page1.photos.map((p) => p.id)).toEqual([...ids].reverse().slice(0, 12));
    const page2 = await w.worn.forSheet([main.id, variant.id], 2);
    expect(page2.photos.map((p) => p.id)).toEqual([ids[1], ids[0]]);
    expect(page2.photos[1]).toEqual({ id: ids[0], url: `/api/v1/worn/${ids[0]}/photo`, width: 64, height: 48, credit: { firstName: 'Name0', country: 'United Kingdom', instagram: 'name.zero' } });
    // The sheet carries its first page, whichever dot is asked; the next pages by its address.
    const sheet = await w.lookbook.sheet(variant.slug);
    expect(sheet.worn).toEqual({ photos: page1.photos, total: 14 });
    expect((await w.lookbook.sheet(main.slug)).worn).toEqual(sheet.worn);
    expect(await w.lookbook.worn(main.slug, 2)).toEqual(page2);
    // Nothing but the photograph and its credit: no serial, account, variant label nor model name.
    const text = JSON.stringify(page1);
    const owners = await t.db.selectFrom('worn_photos as w').innerJoin('products as p', 'p.id', 'w.product_id').select(['w.account_id', 'p.product_id']).where('w.id', 'in', ids).execute();
    for (const o of owners) {
      expect(text).not.toContain(o.account_id);
      expect(text).not.toContain(o.product_id);
    }
    expect(text).not.toContain('Rose Gold');
    expect(text).not.toContain('ORBIT');
    for (const p of page1.photos) expect(Object.keys(p.credit).sort()).toEqual(['country', 'firstName', 'instagram']);
    // A RESERVED sheet or a hidden one: the lookbook's own 404 for the public.
    expect(await codeOf(w.lookbook.worn('nope', 1))).toBe('LOOKBOOK_NOT_FOUND');
  });

  it('stops showing a photograph at once when its piece leaves its owner or its account is locked; endLeft ends it', async () => {
    const shown = async (id: string) => (await w.worn.forSheet([ring.id, gold.id], 1)).photos.some((p) => p.id === id);
    const publishedBy = async (h: { id: string; serial: string; actor: Actor }) => {
      const s = (await send(h)).photo!;
      await w.worn.publish(s.id, w.admin);
      return s.id;
    };
    // Passed on: hidden at once; the job ends it, bytes erased, audited by count.
    const a = await holder(gold.id);
    const passed = await publishedBy(a);
    expect(await shown(passed)).toBe(true);
    expect((await w.worn.photo(passed, { kind: 'public' })).bytes).not.toBeNull();
    const b = await owner(t.db);
    await passOn(t.db, a.productId, b.id, w.clock.now());
    expect(await shown(passed)).toBe(false);
    expect(await codeOf(w.worn.photo(passed, { kind: 'public' }))).toBe('WORN_NOT_FOUND');
    // A LOCKED account: hidden while locked, back once ACTIVE.
    const c = await holder();
    const lockedOne = await publishedBy(c);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', c.id).execute();
    expect(await shown(lockedOne)).toBe(false);
    expect(await codeOf(w.worn.photo(lockedOne, { kind: 'public' }))).toBe('WORN_NOT_FOUND');
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', c.id).execute();
    expect(await shown(lockedOne)).toBe(true);
    // Revoked: hidden, then ended.
    const d = await holder();
    const revoked = await publishedBy(d);
    await t.db.updateTable('products').set({ status: 'REVOKED' }).where('id', '=', d.productId).execute();
    expect(await shown(revoked)).toBe(false);
    // In review when passed on: ended as well.
    const e = await holder();
    const inReview = (await send(e)).photo!.id;
    await passOn(t.db, e.productId, (await owner(t.db)).id, w.clock.now());
    w.clock.advance(60_000);
    const before = (await audits(t.db, 'worn.end')).length;
    expect(await w.worn.endLeft(w.clock.now())).toBe(3);
    for (const id of [passed, revoked, inReview]) expect(await rowOf(t.db, id), id).toMatchObject({ status: 'ENDED', ended_at: w.clock.now(), photo: null, photo_sha256: null });
    expect((await rowOf(t.db, lockedOne)).status).toBe('PUBLISHED');
    const ends = await audits(t.db, 'worn.end');
    expect(ends).toHaveLength(before + 1);
    expect(ends.at(-1)!.details).toEqual({ count: 3 });
    expect(ends.at(-1)!.actor_type).toBe('system');
    expect(await w.worn.endLeft(w.clock.now())).toBe(0);
    expect((await audits(t.db, 'worn.end')).length).toBe(before + 1);
  });

  it('lets the next owner send at once: the previous owner’s live photograph is ended in the same transaction', async () => {
    const a = await holder();
    const old = (await send(a)).photo!.id;
    const b = await owner(t.db);
    await passOn(t.db, a.productId, b.id, w.clock.now());
    const theirs = await w.worn.send(b.id, a.serial, jpeg(), { consent: WORN_CONSENT_VERSION }, b.actor);
    expect(theirs.photo!.status).toBe('PENDING');
    expect(await rowOf(t.db, old)).toMatchObject({ status: 'ENDED', photo: null });
    // The previous owner sees no photograph on a piece it no longer holds.
    expect(await w.worn.ofPiece(a.id, a.serial)).toMatchObject({ photo: null, canSend: false, reason: 'NOT_HELD' });
  });

  it('serves a photograph to the public once shown, to its owner and to staff while live, and to no one once erased', async () => {
    const h = await holder();
    const s = (await send(h)).photo!;
    const stored = await rowOf(t.db, s.id);
    expect(await codeOf(w.worn.photo(s.id, { kind: 'public' }))).toBe('WORN_NOT_FOUND');
    expect((await w.worn.photo(s.id, { kind: 'owner', accountId: h.id })).bytes).toEqual(stored.photo);
    expect(await codeOf(w.worn.photo(s.id, { kind: 'owner', accountId: (await owner(t.db)).id }))).toBe('WORN_NOT_FOUND');
    expect(await w.worn.photo(s.id, { kind: 'staff' })).toEqual({ mime: 'image/jpeg', sha256: stored.photo_sha256, bytes: stored.photo });
    await w.worn.publish(s.id, w.admin);
    expect(await w.worn.photo(s.id, { kind: 'public' }, { withBytes: false })).toEqual({ mime: 'image/jpeg', sha256: stored.photo_sha256, bytes: null });
    await w.worn.withdraw(h.id, s.id, h.actor);
    for (const reader of [{ kind: 'public' as const }, { kind: 'owner' as const, accountId: h.id }, { kind: 'staff' as const }]) {
      expect(await codeOf(w.worn.photo(s.id, reader)), reader.kind).toBe('WORN_NOT_FOUND');
    }
    expect(await codeOf(w.worn.photo('nope', { kind: 'staff' }))).toBe('WORN_NOT_FOUND');
  });

  it('lists the console’s queue (TO REVIEW oldest first, PUBLISHED by model, ENDED) and counts its badge', async () => {
    const t2 = await createTestDb();
    try {
      const v = await worldOn(t2.db, '2026-11-03T10:00:00.000Z');
      const main = await sheetModel(t2.db, 'HALO');
      const other = await sheetModel(t2.db, 'ARC');
      const sendOn = async (model: string) => {
        const h = await owner(t2.db, { instagram: 'h.q' });
        const [pid] = await holdPieces(t2.db, h.id, 1, model);
        v.clock.advance(60_000);
        return (await v.worn.send(h.id, pid!, jpeg(), { consent: WORN_CONSENT_VERSION, instagram: true }, h.actor)).photo!.id;
      };
      const a = await sendOn(main.id);
      const b = await sendOn(other.id);
      const c = await sendOn(main.id);
      const d = await sendOn(main.id);
      expect(await v.worn.summary()).toEqual({ toReview: 4, published: 0, oldestToReviewAt: z('2026-11-03T10:01:00.000Z') });
      await v.worn.publish(c, v.admin);
      v.clock.advance(60_000);
      await v.worn.publish(b, v.admin);
      await v.worn.refuse(d, 'PIECE_NOT_VISIBLE', v.admin);
      const req = { page: 1, pageSize: 50 };
      const review = await v.worn.queue({ queue: 'TO_REVIEW' }, req);
      expect(review.items.map((i) => i.id)).toEqual([a]);
      expect(review.items[0]).toMatchObject({
        status: 'PENDING',
        model: { id: main.id, name: 'HALO', slug: main.slug, variantLabel: null },
        credit: { firstName: 'Camille', country: 'France', countryCode: 'FR', instagram: 'h.q' },
        consentVersion: WORN_CONSENT_VERSION,
        photoUrl: `/api/admin/worn/${a}/photo`,
        reviewedBy: null,
        shown: false,
      });
      expect(review.items[0]!.owner.email).toMatch(/@example\.com$/);
      expect((await v.worn.queue({ queue: 'PUBLISHED' }, req)).items.map((i) => i.id)).toEqual([b, c]);
      const byModel = await v.worn.queue({ queue: 'PUBLISHED', modelId: main.id }, req);
      expect(byModel.items.map((i) => [i.id, i.shown, i.reviewedBy?.id])).toEqual([[c, true, v.admin.id]]);
      expect(byModel.total).toBe(1);
      const ended = await v.worn.queue({ queue: 'ENDED' }, req);
      expect(ended.items.map((i) => [i.id, i.status, i.refusal, i.photoUrl])).toEqual([[d, 'REFUSED', 'PIECE_NOT_VISIBLE', null]]);
      expect((await v.worn.queue({ queue: 'PUBLISHED', modelId: 'nope' }, req)).total).toBe(0);
      expect(await v.worn.summary()).toEqual({ toReview: 1, published: 2, oldestToReviewAt: z('2026-11-03T10:01:00.000Z') });
    } finally {
      await t2.close();
    }
  });

  it('gives the account’s photographs in its copy of its data, oldest first, never the bytes', async () => {
    const h = await holder(ring.id, { instagram: 'camille.m' });
    const one = (await send(h, { instagram: true })).photo!.id;
    await w.worn.refuse(one, 'NOT_SUITABLE', w.admin);
    w.clock.advance(60_000);
    await send(h);
    const out = await accountWornPhotos(t.db, h.id);
    expect(out).toEqual([
      expect.objectContaining({ piece: h.serial, model: 'MONOLITHE', status: 'REFUSED', refusal: 'NOT_SUITABLE', credit: { firstName: 'Camille', country: 'FR', instagram: 'camille.m' }, consentVersion: WORN_CONSENT_VERSION }),
      expect.objectContaining({ piece: h.serial, status: 'PENDING', publishedAt: null, endedAt: null, credit: { firstName: 'Camille', country: 'FR', instagram: null } }),
    ]);
    for (const e of out) expect(Object.keys(e).sort()).toEqual(['consentAt', 'consentVersion', 'credit', 'endedAt', 'model', 'piece', 'publishedAt', 'refusal', 'sentAt', 'status']);
  });
});

// ── Under concurrency ──────────────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('WORN on PostgreSQL', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const admin = createDb(adminUrl!);
    const name = `orbes_worn_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
    close = async () => {
      await closeDb(db);
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    };
  }, 60_000);
  afterAll(() => close?.());

  it('two sendings for one piece at once: one PENDING, the other WORN_ALREADY', async () => {
    const v = await worldOn(db, '2026-11-02T10:00:00.000Z');
    const model = await sheetModel(db, 'MONOLITHE');
    const h = await owner(db);
    const [pid] = await holdPieces(db, h.id, 1, model.id);
    // Two services, as two processes: each its own transaction on the pool.
    const other = new WornService({ db, audit: v.audit, clock: v.clock.now });
    const codes = await Promise.all([v.worn, other].map((s) => codeOf(s.send(h.id, pid!, jpeg(), { consent: WORN_CONSENT_VERSION }, h.actor))));
    expect(codes.sort()).toEqual(['OK', 'WORN_ALREADY']);
    const rows = await db.selectFrom('worn_photos').select('status').where('product_id', '=', pid!).execute();
    expect(rows).toEqual([{ status: 'PENDING' }]);
  });
});
