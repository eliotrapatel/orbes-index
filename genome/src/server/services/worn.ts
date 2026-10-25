/**
 * WORN, the owners' gallery (macro scope of 2026-10-20, D31 G1 to G5; lot M2 plan §2.1 and §2.2, step M2.7): the
 * photograph the owner of a registered piece sends from that piece, read by ORBES staff before it appears, once
 * published, at the foot of the model's sheet, for everyone, credited with the owner's first name and country, plus
 * their Instagram if they chose it. Its table is `worn_photos` (migration 0053).
 *
 * The collector's side (routes/ownership.ts):
 *   ofPiece    GET /api/v1/account/products/:productId/worn: the piece's photograph for its owner (its status, dates,
 *              refusal, credit as sent, its bytes' address while live), whether one may be sent now and why not, the
 *              credit as it would read, the consent's version and the sheet it appears on (null: no sheet, no WORN).
 *   send       POST …/worn?instagram=0|1&consent=<version>, the body the image itself: the account that holds the piece
 *              now (its open ownership), ACTIVE, not a test entrant, the piece in a held status (TRANSFERABLE_STATUSES:
 *              REGISTERED, OWNED, TRANSFERRED), no transfer pending, its model's group with a sheet (PUBLIC or
 *              RESERVED, with an address), YOUR PROFILE's first name and the account's country (409
 *              WORN_PROFILE_INCOMPLETE), the consent of the version in force (422 WORN_CONSENT). The image goes through
 *              media/image.ts sanitizeImage exactly as media today (its type by its own bytes, EXIF and XMP removed, 1
 *              MiB and 4 096 px at most, an orientation other than 1 refused). One photograph at a time (G1): one live
 *              (PENDING or PUBLISHED) per piece (409 WORN_ALREADY, the unique index answering two sendings at once);
 *              WORN_RATE sendings an account in a rolling 24 hours (429 WORN_LIMIT). The credit is written with the
 *              photograph and shown as staff approved it: a later profile change does not alter it.
 *   withdraw   DELETE /api/v1/account/worn/:id: the owner's own live photograph → WITHDRAWN, its bytes erased at once.
 *   photo      GET /api/v1/account/worn/:id/photo: its own live photograph (no-store).
 *
 * Everyone (routes/public.ts, routes/club.ts): a sheet carries its first page (`worn: { photos, total }`, LookbookService),
 * GET /api/v1/lookbook/:slug/worn?page= and /api/v1/club/lookbook/:slug/worn?page= the next ones (WORN_PAGE_SIZE a page):
 * the PUBLISHED photographs of the sheet's whole group (every variant, whichever dot is selected, as THE RELEASES OF THIS
 * MODEL reads it), newest first. GET /api/v1/worn/:id/photo serves one only while it is shown, kept 5 minutes
 * (WORN_PHOTO_CACHE_CONTROL, never "immutable": a withdrawal stops being served within minutes).
 *
 * SHOWN (the read-time rule): PUBLISHED, its ownership still open (a piece passed on or returned leaves WORN at once), its
 * piece not REVOKED, its account ACTIVE (a LOCKED account's photographs are not shown while it is locked). What is shown
 * is the photograph and its credit, and nothing else: the first name, the country's English name, the Instagram name when
 * chosen. Never the piece's serial, the account, nor the variant's label.
 *
 * The console (routes/admin/worn.ts): the queue (TO_REVIEW oldest first, PUBLISHED by model newest first, ENDED), the
 * badge's summary, publish (PENDING → PUBLISHED), refuse (PENDING → REFUSED) and take down (PUBLISHED → TAKEN_DOWN), each
 * by an OPERATOR under the row's lock, refuse and take down with a reason (WORN_REFUSALS) and the bytes erased.
 *
 * Housekeeping (`endLeft`, the job `wornEnded`, every pass): a live photograph whose piece left its owner (its ownership
 * ended, or the piece REVOKED) → ENDED, bytes erased; a new owner's sending ends it at once as well.
 *
 * Nobody but the owner and ORBES staff sees a photograph before it is published (G2): it is never in media_objects,
 * whose public route serves any stored hash and is cached for good. Refused, withdrawn, taken down or ended: its bytes
 * are erased, its row kept with the account, in its export (`accountWornPhotos`).
 *
 * Audit (never the credit's name): `worn.send` {id, productId, modelId, bytes, sha256, instagram}, `worn.withdraw`,
 * `worn.publish`, `worn.refuse` and `worn.take_down` {id, productId, refusal?}, `worn.end` {count} by the system.
 */
import { createHash } from 'node:crypto';
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { WORN_REFUSALS, type Database, type WornRefusal, type WornStatus } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound } from '../errors.js';
import { sanitizeImage } from '../media/image.js';
import { makePage, pageOffset, SYSTEM_ACTOR, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import { countryName } from '../../shared/countries.js';
import type { AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { findProduct } from './lifecycle.js';
import type { ImageUpload } from './media.js';
import { TRANSFERABLE_STATUSES } from './ownership.js';
import { giveVault } from './vault.js';

/** The photographs a page of a sheet's WORN holds (the sheet carries the first). */
export const WORN_PAGE_SIZE = 12;

/** One photograph at a time, and at most this many sendings an account in a rolling 24 hours (429 WORN_LIMIT). */
export const WORN_RATE = Object.freeze({ max: 5, windowMs: 24 * 60 * 60_000 });

/**
 * The legal version in force (src/web/legal/content/index.ts LEGAL_VERSION), the consent a sending must carry and the
 * one recorded with it. The server cannot read the web's files (Dockerfile), so it is written here, as
 * FOUNDING_CONSENT_VERSION is; test/web/legal.content.test.ts holds the two equal.
 */
export const WORN_CONSENT_VERSION = '2026-10-25';

/** A published photograph, as everyone reads it: the same for all, a withdrawal shown within 5 minutes. */
export const WORN_PHOTO_CACHE_CONTROL = 'public, max-age=300';

/** Why a piece cannot send a photograph now (`ofPiece`, 403 WORN_NOT_ALLOWED, 409 for the last two). */
export const WORN_BLOCKS = ['NO_SHEET', 'TEST_ENTRANT', 'NOT_HELD', 'STATUS', 'TRANSFER_PENDING', 'PROFILE_INCOMPLETE', 'LIVE'] as const;
export type WornBlock = (typeof WORN_BLOCKS)[number];

/** The console's three lists. */
export const WORN_QUEUES = ['TO_REVIEW', 'PUBLISHED', 'ENDED'] as const;
export type WornQueue = (typeof WORN_QUEUES)[number];

const LIVE: readonly WornStatus[] = ['PENDING', 'PUBLISHED'];
const SETTLED: readonly WornStatus[] = ['REFUSED', 'WITHDRAWN', 'TAKEN_DOWN', 'ENDED'];
/** A piece no longer its owner's, whatever its ownership says: a revocation (plan §2.1). */
const LEFT_STATUSES = ['REVOKED'] as const;
const ERASED = { photo: null, photo_mime: null, photo_sha256: null, width: null, height: null } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Errors ─────────────────────────────────────────────────────────────────

export const wornNotFound = () => new DomainError('WORN_NOT_FOUND', 404, 'This photograph is not in WORN.');
const NOT_ALLOWED: Readonly<Record<Exclude<WornBlock, 'PROFILE_INCOMPLETE' | 'LIVE'>, string>> = {
  NO_SHEET: 'This model has no sheet to show a photograph on yet.',
  TEST_ENTRANT: 'A test account sends no photograph to WORN.',
  NOT_HELD: 'Only the owner of the piece now sends its photograph.',
  STATUS: 'A piece reported lost or stolen, or in service, sends no photograph.',
  TRANSFER_PENDING: 'A piece whose transfer is pending sends no photograph.',
};
export const wornNotAllowed = (reason: keyof typeof NOT_ALLOWED) => new DomainError('WORN_NOT_ALLOWED', 403, NOT_ALLOWED[reason], { detail: reason });
export const wornProfileIncomplete = () => conflict('WORN_PROFILE_INCOMPLETE', 'Add your first name and country in YOUR PROFILE to sign your photograph.');
export const wornAlready = () => conflict('WORN_ALREADY', 'This piece already has a photograph in WORN or in review. Withdraw it to send another.');
export const wornLimit = () => new DomainError('WORN_LIMIT', 429, `You can send ${WORN_RATE.max} photographs in 24 hours. Try again later.`);
export const wornConsent = () => new DomainError('WORN_CONSENT', 422, 'Tick the box to agree to how WORN shows your photograph.');
export const wornState = (message: string) => conflict('WORN_STATE', message);
const wornRefusal = () => new DomainError('VALIDATION_FAILED', 400, `The reason is one of ${WORN_REFUSALS.join(', ')}.`);

// ── Views ──────────────────────────────────────────────────────────────────

/** The credit under a photograph (G3): exactly the first name, the country's English name and, when chosen, the Instagram name. */
export interface WornCredit {
  firstName: string;
  country: string;
  instagram: string | null;
}

/** A photograph of a sheet's WORN, as everyone reads it. */
export interface WornSheetPhoto {
  id: string;
  /** GET /api/v1/worn/:id/photo. */
  url: string;
  width: number;
  height: number;
  credit: WornCredit;
}

/** A sheet's WORN: a page of its photographs, newest first, and how many it shows in all. */
export interface WornSheet {
  photos: WornSheetPhoto[];
  total: number;
}

/** A page of a sheet's WORN (GET …/lookbook/:slug/worn?page=). */
export interface WornSheetPage extends WornSheet {
  page: number;
  pageSize: number;
}

/** A photograph as its owner reads it from the piece. */
export interface OwnerWornPhoto {
  id: string;
  status: WornStatus;
  sentAt: Date;
  publishedAt: Date | null;
  endedAt: Date | null;
  /** Why staff refused or took it down (shown in words); null otherwise. */
  refusal: WornRefusal | null;
  /** The credit as it was sent (and as it reads under the photograph). */
  credit: WornCredit;
  /** GET /api/v1/account/worn/:id/photo while live (in review or published); null once erased. */
  url: string | null;
  width: number | null;
  height: number | null;
}

/** The piece's WORN for its owner (GET /api/v1/account/products/:productId/worn). */
export interface PieceWorn {
  /** The sheet its photograph appears on (SEE IT ON THE SHEET); null: the model has none, the block is not drawn. */
  sheet: { slug: string } | null;
  /** Its photograph now: in review, published, refused or taken down; null when none (or withdrawn, or ended). */
  photo: OwnerWornPhoto | null;
  canSend: boolean;
  /** Why not, when it cannot (LIVE: one is in review or published). */
  reason: WornBlock | null;
  /** The credit a sending would carry now: YOUR PROFILE's first name, the country's name, the Instagram name it may show. */
  credit: { firstName: string | null; country: string | null; instagram: string | null };
  /** The consent's version a sending carries (`consent=`). */
  consentVersion: string;
}

/** A photograph in the console. */
export interface AdminWornPhoto {
  id: string;
  status: WornStatus;
  piece: { id: string; productId: string };
  model: { id: string; name: string; slug: string | null; variantLabel: string | null };
  owner: { accountId: string; email: string };
  credit: WornCredit & { countryCode: string };
  consentVersion: string;
  consentAt: Date;
  sentAt: Date;
  reviewedAt: Date | null;
  reviewedBy: { id: string; email: string } | null;
  publishedAt: Date | null;
  endedAt: Date | null;
  refusal: WornRefusal | null;
  /** GET /api/admin/worn/:id/photo while live; null once erased. */
  photoUrl: string | null;
  width: number | null;
  height: number | null;
  /** Whether everyone sees it now (PUBLISHED and shown by the read-time rule). */
  shown: boolean;
}

/** The console's badge and figures. */
export interface WornSummary {
  toReview: number;
  published: number;
  oldestToReviewAt: Date | null;
}

/** A photograph in the account's copy of its data (never its bytes). */
export interface ExportedWornPhoto {
  piece: string;
  model: string;
  status: WornStatus;
  sentAt: Date;
  publishedAt: Date | null;
  endedAt: Date | null;
  refusal: WornRefusal | null;
  credit: { firstName: string; country: string; instagram: string | null };
  consentVersion: string;
  consentAt: Date;
}

// ── Shared reads ───────────────────────────────────────────────────────────

const creditOf = (r: { credit_first_name: string; credit_country: string; credit_instagram: string | null }): WornCredit => ({
  firstName: r.credit_first_name,
  country: countryName(r.credit_country.trim()),
  instagram: r.credit_instagram,
});

/**
 * The read-time rule (SHOWN) on `w` (worn_photos): PUBLISHED, its ownership open, its piece not REVOKED, its account
 * ACTIVE.
 */
const shownSql = sql<SqlBool>`w.status = 'PUBLISHED'
  AND EXISTS (SELECT 1 FROM ownership so WHERE so.id = w.ownership_id AND so.ended_at IS NULL)
  AND EXISTS (SELECT 1 FROM products sp WHERE sp.id = w.product_id AND sp.status NOT IN (${sql.join(LEFT_STATUSES.map((s) => sql.lit(s)))}))
  AND EXISTS (SELECT 1 FROM accounts sa WHERE sa.id = w.account_id AND sa.status = 'ACTIVE')`;

/**
 * A sheet's WORN (G4, G5): the photographs SHOWN of the models `modelIds` (a sheet's whole group), newest published
 * first, page `page` of WORN_PAGE_SIZE, with the total. The same for everyone.
 */
export async function sheetWorn(db: Db, modelIds: readonly string[], page = 1): Promise<WornSheetPage> {
  const p = Number.isInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1;
  if (modelIds.length === 0) return { photos: [], total: 0, page: p, pageSize: WORN_PAGE_SIZE };
  const base = db
    .selectFrom('worn_photos as w')
    .where('w.model_id', 'in', [...modelIds])
    .where(shownSql);
  const [rows, count] = await Promise.all([
    base
      .select(['w.id', 'w.width', 'w.height', 'w.credit_first_name', 'w.credit_country', 'w.credit_instagram'])
      .orderBy('w.published_at', 'desc')
      .orderBy('w.id', 'desc')
      .limit(WORN_PAGE_SIZE)
      .offset((p - 1) * WORN_PAGE_SIZE)
      .execute(),
    base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
  ]);
  return {
    photos: rows.map((r) => ({ id: r.id, url: `/api/v1/worn/${r.id}/photo`, width: r.width!, height: r.height!, credit: creditOf(r) })),
    total: Number(count.n),
    page: p,
    pageSize: WORN_PAGE_SIZE,
  };
}

/** The account's photographs for its copy of its data (R21), oldest first; never the bytes. */
export async function accountWornPhotos(db: Db, accountId: string): Promise<ExportedWornPhoto[]> {
  const rows = await db
    .selectFrom('worn_photos as w')
    .innerJoin('products as p', 'p.id', 'w.product_id')
    .innerJoin('models as m', 'm.id', 'w.model_id')
    .select([
      'p.product_id as piece',
      'm.name as model',
      'w.status',
      'w.created_at',
      'w.published_at',
      'w.ended_at',
      'w.refusal',
      'w.credit_first_name',
      'w.credit_country',
      'w.credit_instagram',
      'w.consent_version',
      'w.consent_at',
    ])
    .where('w.account_id', '=', accountId)
    .orderBy('w.created_at')
    .orderBy('w.id')
    .execute();
  return rows.map((r) => ({
    piece: r.piece,
    model: r.model,
    status: r.status,
    sentAt: r.created_at,
    publishedAt: r.published_at,
    endedAt: r.ended_at,
    refusal: r.refusal,
    credit: { firstName: r.credit_first_name, country: r.credit_country.trim(), instagram: r.credit_instagram },
    consentVersion: r.consent_version,
    consentAt: r.consent_at,
  }));
}

/**
 * The sheet a model's photographs appear on: the model itself, when it has one (PUBLIC or RESERVED, with an address);
 * null otherwise (NO_SHEET), so a hidden variant never shows on its group's sheet (plan §2.1, P-X08).
 */
async function sheetOfModel(db: Db, modelId: string): Promise<{ slug: string; groupIds: string[] } | null> {
  const m = await db.selectFrom('models').select(['id', 'slug', 'lookbook', 'variant_of']).where('id', '=', modelId).executeTakeFirst();
  if (!m || m.slug === null || (m.lookbook !== 'PUBLIC' && m.lookbook !== 'RESERVED')) return null;
  const root = m.variant_of ?? m.id;
  const group = await db
    .selectFrom('models')
    .select('id')
    .where((eb) => eb.or([eb('id', '=', root), eb('variant_of', '=', root)]))
    .execute();
  return { slug: m.slug, groupIds: group.map((g) => g.id) };
}

function cleanRef(id: unknown): string | null {
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
}

// ── The service ────────────────────────────────────────────────────────────

export interface WornServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

interface PieceFacts {
  product: { id: string; product_id: string; model_id: string | null; status: string };
  /** The account's open ownership of the piece, or null. */
  ownershipId: string | null;
  sheet: { slug: string; groupIds: string[] } | null;
  reason: WornBlock | null;
  credit: PieceWorn['credit'];
  creditRaw: { firstName: string | null; country: string | null; instagram: string | null };
}

export class WornService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: WornServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The owner ────────────────────────────────────────────────────────────

  /** The piece's WORN for its owner; 404 PRODUCT_NOT_FOUND for a piece the account never held. */
  async ofPiece(accountId: string, productRef: string): Promise<PieceWorn> {
    const facts = await this.factsOf(this.db, accountId, productRef);
    const latest = await this.db
      .selectFrom('worn_photos')
      .select(['id', 'status', 'created_at', 'published_at', 'ended_at', 'refusal', 'credit_first_name', 'credit_country', 'credit_instagram', 'width', 'height', 'photo_sha256'])
      .where('product_id', '=', facts.product.id)
      .where('account_id', '=', accountId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    // Withdrawn or ended: the block starts again; refused or taken down: its reason, then CHOOSE ANOTHER PHOTOGRAPH.
    const photo: OwnerWornPhoto | null =
      latest && latest.status !== 'WITHDRAWN' && latest.status !== 'ENDED'
        ? {
            id: latest.id,
            status: latest.status,
            sentAt: latest.created_at,
            publishedAt: latest.published_at,
            endedAt: latest.ended_at,
            refusal: latest.refusal,
            credit: creditOf(latest),
            url: latest.photo_sha256 === null ? null : `/api/v1/account/worn/${latest.id}/photo`,
            width: latest.width,
            height: latest.height,
          }
        : null;
    const live = photo !== null && LIVE.includes(photo.status);
    const reason: WornBlock | null = facts.reason ?? (live ? 'LIVE' : null);
    return { sheet: facts.sheet ? { slug: facts.sheet.slug } : null, photo, canSend: reason === null, reason, credit: facts.credit, consentVersion: WORN_CONSENT_VERSION };
  }

  /** Send a photograph from a piece (see the header); answers the piece's WORN. */
  async send(accountId: string, productRef: string, upload: ImageUpload, opts: { instagram?: boolean; consent?: unknown }, actor: Actor): Promise<PieceWorn> {
    if (opts.consent !== WORN_CONSENT_VERSION) throw wornConsent();
    const clean = sanitizeImage(upload.bytes, upload.mime);
    const sha256 = createHash('sha256').update(clean.bytes).digest('hex');
    const now = this.clock();
    const serial = await inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      const facts = await this.factsOf(tx, accountId, productRef, true);
      if (facts.reason === 'PROFILE_INCOMPLETE') throw wornProfileIncomplete();
      if (facts.reason !== null) throw wornNotAllowed(facts.reason as keyof typeof NOT_ALLOWED);
      // A photograph left live by the piece's previous owner leaves now (the job would end it at its next pass).
      await this.endWhere(tx, now, (eb) => eb.and([eb('product_id', '=', facts.product.id), eb('ownership_id', '<>', facts.ownershipId!)]));
      const live = await tx.selectFrom('worn_photos').select('id').where('product_id', '=', facts.product.id).where('status', 'in', [...LIVE]).executeTakeFirst();
      if (live) throw wornAlready();
      const recent = await tx
        .selectFrom('worn_photos')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('account_id', '=', accountId)
        .where('created_at', '>', new Date(now.getTime() - WORN_RATE.windowMs))
        .executeTakeFirstOrThrow();
      if (Number(recent.n) >= WORN_RATE.max) throw wornLimit();
      const instagram = opts.instagram === true ? facts.creditRaw.instagram : null;
      const row = await tx
        .insertInto('worn_photos')
        .values({
          product_id: facts.product.id,
          ownership_id: facts.ownershipId!,
          account_id: accountId,
          model_id: facts.product.model_id!,
          photo: clean.bytes,
          photo_mime: clean.mime,
          photo_sha256: sha256,
          width: clean.width,
          height: clean.height,
          credit_first_name: facts.creditRaw.firstName!,
          credit_country: facts.creditRaw.country!,
          credit_instagram: instagram,
          consent_at: now,
          consent_version: WORN_CONSENT_VERSION,
          status: 'PENDING',
          created_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch((e: unknown) => {
          if (isUniqueViolation(e, 'worn_photos_live_once')) throw wornAlready();
          throw e;
        });
      await this.audit.record(
        {
          actor,
          action: 'worn.send',
          targetType: 'worn_photo',
          targetId: row.id,
          details: { id: row.id, productId: facts.product.product_id, modelId: facts.product.model_id, bytes: clean.bytes.length, sha256, instagram: instagram !== null },
        },
        tx,
      );
      return facts.product.product_id;
    });
    return this.ofPiece(accountId, serial);
  }

  /** The owner withdraws its own live photograph: WITHDRAWN, its bytes erased at once (404 WORN_NOT_FOUND otherwise). */
  async withdraw(accountId: string, photoId: string, actor: Actor): Promise<void> {
    const id = cleanRef(photoId);
    if (!id) throw wornNotFound();
    const now = this.clock();
    await inTransaction(this.db, async (tx) => {
      const w = await tx.selectFrom('worn_photos').select(['id', 'account_id', 'product_id', 'status', 'created_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!w || w.account_id !== accountId || !LIVE.includes(w.status)) throw wornNotFound();
      await tx.updateTable('worn_photos').set({ status: 'WITHDRAWN', ...ERASED, ended_at: now < w.created_at ? w.created_at : now }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'worn.withdraw', targetType: 'worn_photo', targetId: id, details: { id, productId: await serialOf(tx, w.product_id), from: w.status } }, tx);
    });
  }

  /**
   * A photograph's bytes for `reader`: the public (shown only), its owner (its own, while live), staff (while live).
   * 404 WORN_NOT_FOUND for anything else. `withBytes: false` answers the hash only (a revalidation).
   */
  async photo(photoId: string, reader: { kind: 'public' } | { kind: 'owner'; accountId: string } | { kind: 'staff' }, opts: { withBytes?: boolean } = {}): Promise<{ mime: string; sha256: string; bytes: Uint8Array | null }> {
    const id = cleanRef(photoId);
    if (!id) throw wornNotFound();
    const withBytes = opts.withBytes ?? true;
    let q = this.db
      .selectFrom('worn_photos as w')
      .select(['w.photo_mime', 'w.photo_sha256'])
      .$if(withBytes, (qb) => qb.select('w.photo'))
      .where('w.id', '=', id)
      .where('w.status', 'in', [...LIVE]);
    if (reader.kind === 'public') q = q.where(shownSql);
    if (reader.kind === 'owner') q = q.where('w.account_id', '=', reader.accountId);
    const r = (await q.executeTakeFirst()) as { photo_mime: string | null; photo_sha256: string | null; photo?: Uint8Array | null } | undefined;
    if (!r || r.photo_sha256 === null || r.photo_mime === null) throw wornNotFound();
    return { mime: r.photo_mime, sha256: r.photo_sha256, bytes: withBytes ? (r.photo ?? null) : null };
  }

  // ── Everyone ─────────────────────────────────────────────────────────────

  /** A sheet's WORN, page `page` (G4, G5): see `sheetWorn`. */
  forSheet(modelIds: readonly string[], page = 1): Promise<WornSheetPage> {
    return sheetWorn(this.db, modelIds, page);
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** A list of the console (TO_REVIEW oldest first; PUBLISHED newest first, of a model's group; ENDED newest first). */
  async queue(filter: { queue: WornQueue; modelId?: string | null }, req: PageRequest): Promise<Page<AdminWornPhoto>> {
    let base = this.db
      .selectFrom('worn_photos as w')
      .innerJoin('products as p', 'p.id', 'w.product_id')
      .innerJoin('models as m', 'm.id', 'w.model_id')
      .innerJoin('accounts as a', 'a.id', 'w.account_id')
      .leftJoin('admin_users as r', 'r.id', 'w.reviewed_by');
    if (filter.queue === 'TO_REVIEW') base = base.where('w.status', '=', 'PENDING');
    else if (filter.queue === 'PUBLISHED') base = base.where('w.status', '=', 'PUBLISHED');
    else base = base.where('w.status', 'in', [...SETTLED]);
    const model = cleanRef(filter.modelId ?? null);
    if (filter.modelId && !model) return makePage([], 0, req);
    if (model) base = base.where((eb) => eb.or([eb('m.id', '=', model), eb('m.variant_of', '=', model)]));
    const ordered =
      filter.queue === 'TO_REVIEW'
        ? base.orderBy('w.created_at').orderBy('w.id')
        : filter.queue === 'PUBLISHED'
          ? base.orderBy('w.published_at', 'desc').orderBy('w.id', 'desc')
          : base.orderBy('w.ended_at', 'desc').orderBy('w.id', 'desc');
    const [rows, count] = await Promise.all([
      ordered
        .select([
          'w.id',
          'w.status',
          'w.product_id as piece_id',
          'p.product_id as serial',
          'm.id as model_id',
          'm.name as model_name',
          'm.slug as model_slug',
          'm.variant_label',
          'w.account_id',
          'a.email',
          'w.credit_first_name',
          'w.credit_country',
          'w.credit_instagram',
          'w.consent_version',
          'w.consent_at',
          'w.created_at',
          'w.reviewed_at',
          'w.reviewed_by',
          'r.email as reviewer_email',
          'w.published_at',
          'w.ended_at',
          'w.refusal',
          'w.photo_sha256',
          'w.width',
          'w.height',
        ])
        .select(sql<boolean>`(${shownSql})`.as('shown'))
        .limit(req.pageSize)
        .offset(pageOffset(req))
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const items: AdminWornPhoto[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      piece: { id: r.piece_id, productId: r.serial },
      model: { id: r.model_id, name: r.model_name, slug: r.model_slug, variantLabel: r.variant_label },
      owner: { accountId: r.account_id, email: r.email },
      credit: { ...creditOf(r), countryCode: r.credit_country.trim() },
      consentVersion: r.consent_version,
      consentAt: r.consent_at,
      sentAt: r.created_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: r.reviewed_by && r.reviewer_email ? { id: r.reviewed_by, email: r.reviewer_email } : null,
      publishedAt: r.published_at,
      endedAt: r.ended_at,
      refusal: r.refusal,
      photoUrl: r.photo_sha256 === null ? null : `/api/admin/worn/${r.id}/photo`,
      width: r.width,
      height: r.height,
      shown: r.shown === true,
    }));
    return makePage(items, Number(count.n), req);
  }

  /** The badge (TO REVIEW) and the figures of the console's WORN page. */
  async summary(): Promise<WornSummary> {
    const r = await this.db
      .selectFrom('worn_photos')
      .select([
        sql<string>`count(*) FILTER (WHERE status = 'PENDING')`.as('to_review'),
        sql<string>`count(*) FILTER (WHERE status = 'PUBLISHED')`.as('published'),
        sql<Date | null>`min(created_at) FILTER (WHERE status = 'PENDING')`.as('oldest'),
      ])
      .executeTakeFirstOrThrow();
    const oldest = r.oldest === null || r.oldest === undefined ? null : new Date(r.oldest);
    return { toReview: Number(r.to_review), published: Number(r.published), oldestToReviewAt: oldest };
  }

  /** PUBLISH a photograph in review (OPERATOR): everyone sees it, as SHOWN reads it. 409 WORN_STATE once reviewed. */
  async publish(photoId: string, actor: Actor): Promise<void> {
    await this.review(photoId, actor, 'PENDING', 'PUBLISHED', null, 'worn.publish', 'This photograph is no longer to review.');
  }

  /** REFUSE a photograph in review with a reason (OPERATOR): its bytes erased. */
  async refuse(photoId: string, refusal: unknown, actor: Actor): Promise<void> {
    await this.review(photoId, actor, 'PENDING', 'REFUSED', refusalOf(refusal), 'worn.refuse', 'This photograph is no longer to review.');
  }

  /** TAKE DOWN a published photograph with a reason (OPERATOR): it leaves WORN, its bytes erased. */
  async takeDown(photoId: string, refusal: unknown, actor: Actor): Promise<void> {
    await this.review(photoId, actor, 'PUBLISHED', 'TAKEN_DOWN', refusalOf(refusal), 'worn.take_down', 'This photograph is not published.');
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────

  /** `wornEnded`: each live photograph whose piece left its owner → ENDED, its bytes erased; audited by count. */
  async endLeft(now: Date = this.clock()): Promise<number> {
    const n = await inTransaction(this.db, (tx) =>
      this.endWhere(tx, now, (eb) =>
        eb.or([
          eb.exists(eb.selectFrom('ownership as o').select('o.id').whereRef('o.id', '=', 'worn_photos.ownership_id').where('o.ended_at', 'is not', null)),
          eb.exists(eb.selectFrom('products as p').select('p.id').whereRef('p.id', '=', 'worn_photos.product_id').where('p.status', 'in', [...LEFT_STATUSES])),
        ]),
      ),
    );
    if (n > 0) await this.audit.record({ actor: SYSTEM_ACTOR, action: 'worn.end', targetType: 'worn_photo', details: { count: n } });
    return n;
  }

  // ── Inside ───────────────────────────────────────────────────────────────

  /** Live photographs matching `where` → ENDED, bytes erased; how many. */
  private async endWhere(tx: Db, now: Date, where: (eb: ExpressionBuilder<Database, 'worn_photos'>) => Expression<SqlBool>): Promise<number> {
    const r = await tx
      .updateTable('worn_photos')
      .set({ status: 'ENDED', ...ERASED, ended_at: sql<Date>`greatest(${now}::timestamptz, created_at)` })
      .where('status', 'in', [...LIVE])
      .where(where)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  }

  /** A review under the row's lock: `from` → `to`, the reviewer and time, bytes erased unless published. */
  private async review(photoId: string, actor: Actor, from: WornStatus, to: WornStatus, refusal: WornRefusal | null, action: string, stale: string): Promise<void> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES staff review WORN.');
    const id = cleanRef(photoId);
    if (!id) throw wornNotFound();
    const now = this.clock();
    await inTransaction(this.db, async (tx) => {
      const w = await tx.selectFrom('worn_photos').select(['id', 'product_id', 'account_id', 'ownership_id', 'status', 'created_at', 'published_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!w) throw wornNotFound();
      if (w.status !== from) throw wornState(stale);
      const at = now < w.created_at ? w.created_at : now;
      const settles = to !== 'PUBLISHED';
      await tx
        .updateTable('worn_photos')
        .set({
          status: to,
          refusal,
          reviewed_by: actor.id!,
          reviewed_at: at,
          ...(to === 'PUBLISHED' ? { published_at: at } : {}),
          ...(settles ? { ...ERASED, ended_at: at } : {}),
        })
        .where('id', '=', id)
        .execute();
      await this.audit.record(
        { actor, action, targetType: 'worn_photo', targetId: id, details: { id, productId: await serialOf(tx, w.product_id), ...(refusal ? { refusal } : {}) } },
        tx,
      );
      // THE VAULT (A WORN PHOTOGRAPH PUBLISHED; OP-29 "one per published WORN photograph, at most one per piece"): its
      // sender's vault while their ownership is open; a photograph taken down later keeps it.
      if (to === 'PUBLISHED') {
        const open = await tx.selectFrom('ownership').select('id').where('id', '=', w.ownership_id).where('account_id', '=', w.account_id).where('ended_at', 'is', null).executeTakeFirst();
        if (open) for (const n of (await giveVault(tx, { source: 'WORN', accountId: w.account_id, productId: w.product_id, wornPhotoId: id }, at)).notes) await this.audit.record(n, tx);
      }
    });
  }

  /**
   * The piece and what decides a sending: its open ownership by the account (404 PRODUCT_NOT_FOUND for a piece the
   * account never held), its sheet, the first reason it cannot send (WORN_BLOCKS' order, LIVE apart), the credit.
   */
  private async factsOf(db: Db, accountId: string, productRef: string, forUpdate = false): Promise<PieceFacts> {
    const product = await findProduct(db, productRef, { forUpdate });
    const notYours = () => notFound('Product', 'PRODUCT_NOT_FOUND');
    if (!product) throw notYours();
    const owned = await db.selectFrom('ownership').select(['id', 'ended_at']).where('product_id', '=', product.id).where('account_id', '=', accountId).orderBy('started_at', 'desc').execute();
    if (owned.length === 0) throw notYours();
    const open = owned.find((o) => o.ended_at === null) ?? null;
    const [sheet, account, profile, entrant, pending] = await Promise.all([
      product.model_id ? sheetOfModel(db, product.model_id) : Promise.resolve(null),
      db.selectFrom('accounts').select('country').where('id', '=', accountId).executeTakeFirst(),
      db.selectFrom('account_profiles').select(['first_name', 'instagram']).where('account_id', '=', accountId).executeTakeFirst(),
      db.selectFrom('test_entrants').select('account_id').where('account_id', '=', accountId).executeTakeFirst(),
      db.selectFrom('ownership_transfers').select('id').where('product_id', '=', product.id).where('status', '=', 'PENDING').executeTakeFirst(),
    ]);
    const firstName = profile?.first_name?.trim() ? profile.first_name.trim() : null;
    const country = account?.country?.trim() ? account.country.trim().toUpperCase() : null;
    const instagram = profile?.instagram ?? null;
    const reason: WornBlock | null = !sheet
      ? 'NO_SHEET'
      : entrant
        ? 'TEST_ENTRANT'
        : !open
          ? 'NOT_HELD'
          : !TRANSFERABLE_STATUSES.includes(product.status)
            ? 'STATUS'
            : pending
              ? 'TRANSFER_PENDING'
              : firstName === null || country === null
                ? 'PROFILE_INCOMPLETE'
                : null;
    return {
      product: { id: product.id, product_id: product.product_id, model_id: product.model_id, status: product.status },
      ownershipId: open?.id ?? null,
      sheet,
      reason,
      credit: { firstName, country: country ? countryName(country) : null, instagram },
      creditRaw: { firstName, country, instagram },
    };
  }
}

/** A refusal's reason, one of WORN_REFUSALS. */
function refusalOf(v: unknown): WornRefusal {
  if (typeof v !== 'string' || !(WORN_REFUSALS as readonly string[]).includes(v)) throw wornRefusal();
  return v as WornRefusal;
}

async function serialOf(db: Db, productId: string): Promise<string> {
  return (await db.selectFrom('products').select('product_id').where('id', '=', productId).executeTakeFirstOrThrow()).product_id;
}
