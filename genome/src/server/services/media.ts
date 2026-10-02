/**
 * MediaService (F-04): the reference photograph of a model (phase 1) and the
 * photograph of one piece taken at issuance (phase 2), stored once each in
 * `media_objects` (migration 0012) and served publicly by
 * `GET /api/v1/media/:sha256`.
 *
 * Every image goes through `server/media/image.ts` first: its type checked by
 * its own bytes, EXIF and XMP removed, its dimensions read. It is then stored
 * under the SHA-256 of what remains (the same photograph is stored once),
 * and the model or the piece points to it, in one transaction with the audit
 * entry: `model.image.set`, `model.image.remove`, `product.photo.set`,
 * `product.photo.remove`, each with the image's facts (hash, type, size) and
 * the one it replaced, never its bytes. A change that changes nothing (the
 * same photograph again, or a removal where there is none) writes nothing.
 *
 * An image no model and no piece uses any more is deleted once the change
 * has committed: a removed photograph stops being served. A concurrent
 * upload of the very same bytes that points to it meanwhile keeps it (the
 * foreign key refuses the delete, which is then simply skipped).
 *
 * The public results show these images on the AUTHENTIC states only
 * (VerificationService, `product.imageUrl` and `product.photoUrl`).
 */
import { createHash } from 'node:crypto';
import { inTransaction, type Db } from '../db/connection.js';
import { isForeignKeyViolation } from '../db/pg-errors.js';
import type { MediaMimeType } from '../db/schema.js';
import { notFound } from '../errors.js';
import { sanitizeImage, type CleanImage, type ImageMime } from '../media/image.js';
import { noopLogger, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import type { AuditService } from './audit.js';
import { requireProduct } from './lifecycle.js';

/** Where an image is served: `/api/v1/media/<sha256>`, relative to the origin. */
export const MEDIA_URL_PREFIX = '/api/v1/media/';

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The public URL of a stored image, or null. */
export function mediaUrl(sha256: string | null | undefined): string | null {
  return typeof sha256 === 'string' && SHA256_RE.test(sha256) ? `${MEDIA_URL_PREFIX}${sha256}` : null;
}

/** An uploaded image as the HTTP layer received it: the declared type and the raw bytes. */
export interface ImageUpload {
  mime: ImageMime;
  bytes: Uint8Array;
}

/** What was stored: the facts the audit entry records, and the URL that serves it. */
export interface StoredImage {
  sha256: string;
  mime: ImageMime;
  width: number;
  height: number;
  /** Size in bytes, after the metadata was removed. */
  bytes: number;
  url: string;
}

/** A piece and the URL of its photograph (null without one). */
export interface ProductPhoto {
  productId: string;
  photoUrl: string | null;
}

export interface MediaServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

export class MediaService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: MediaServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /** A stored image (GET /api/v1/media/:sha256); undefined when there is none. `withBytes: false` only checks it exists. */
  async get(sha256: string, opts: { withBytes?: boolean } = {}): Promise<{ mime: MediaMimeType; bytes: Uint8Array | null } | undefined> {
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return undefined;
    if (opts.withBytes === false) {
      const row = await this.db.selectFrom('media_objects').select('mime').where('sha256', '=', sha256).executeTakeFirst();
      return row ? { mime: row.mime, bytes: null } : undefined;
    }
    const row = await this.db.selectFrom('media_objects').select(['mime', 'bytes']).where('sha256', '=', sha256).executeTakeFirst();
    return row ? { mime: row.mime, bytes: row.bytes } : undefined;
  }

  /**
   * The model's reference photograph (POST /api/admin/models/:id/image): shown above the GENOME on the authentic
   * result of every piece issued with the model. Audited `model.image.set` with the number of those pieces.
   */
  async setModelImage(modelId: string, upload: ImageUpload, actor: Actor): Promise<StoredImage> {
    const image = sanitizeImage(upload?.bytes, upload?.mime);
    const id = modelKey(modelId);
    const stored = describe(image);
    const previous = await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('models').select(['id', 'image_sha256']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
      await this.store(tx, stored.sha256, image, actor);
      if (row.image_sha256 === stored.sha256) return null;
      await tx.updateTable('models').set({ image_sha256: stored.sha256 }).where('id', '=', id).execute();
      await this.audit.record(
        {
          actor,
          action: 'model.image.set',
          targetType: 'model',
          targetId: id,
          details: { ...facts(stored), previous: row.image_sha256, issuedPieces: await issuedWithModel(tx, id) },
        },
        tx,
      );
      return row.image_sha256;
    });
    if (previous) await this.deleteIfUnused(previous);
    return stored;
  }

  /** Remove the model's reference photograph (DELETE /api/admin/models/:id/image). Audited `model.image.remove`. */
  async removeModelImage(modelId: string, actor: Actor): Promise<void> {
    const id = modelKey(modelId);
    const previous = await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('models').select(['id', 'image_sha256']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (row.image_sha256 === null) return null;
      await tx.updateTable('models').set({ image_sha256: null }).where('id', '=', id).execute();
      await this.audit.record(
        { actor, action: 'model.image.remove', targetType: 'model', targetId: id, details: { previous: row.image_sha256, issuedPieces: await issuedWithModel(tx, id) } },
        tx,
      );
      return row.image_sha256;
    });
    if (previous) await this.deleteIfUnused(previous);
  }

  /**
   * The photograph of one piece (POST /api/admin/products/:productId/photo), offered at issuance and on the product
   * page: shown above the GENOME on the piece's authentic results, beside its model's. Audited `product.photo.set`.
   */
  async setProductPhoto(productRef: string, upload: ImageUpload, actor: Actor): Promise<ProductPhoto> {
    const image = sanitizeImage(upload?.bytes, upload?.mime);
    const stored = describe(image);
    const { productId, previous } = await inTransaction(this.db, async (tx) => {
      const p = await requireProduct(tx, productRef, { forUpdate: true });
      await this.store(tx, stored.sha256, image, actor);
      if (p.photo_sha256 === stored.sha256) return { productId: p.product_id, previous: null };
      await tx.updateTable('products').set({ photo_sha256: stored.sha256, updated_at: this.clock() }).where('id', '=', p.id).execute();
      await this.audit.record(
        { actor, action: 'product.photo.set', targetType: 'product', targetId: p.product_id, details: { ...facts(stored), previous: p.photo_sha256 } },
        tx,
      );
      return { productId: p.product_id, previous: p.photo_sha256 };
    });
    if (previous) await this.deleteIfUnused(previous);
    return { productId, photoUrl: stored.url };
  }

  /** Remove the photograph of a piece (DELETE /api/admin/products/:productId/photo). Audited `product.photo.remove`. */
  async removeProductPhoto(productRef: string, actor: Actor): Promise<ProductPhoto> {
    const { productId, previous } = await inTransaction(this.db, async (tx) => {
      const p = await requireProduct(tx, productRef, { forUpdate: true });
      if (p.photo_sha256 === null) return { productId: p.product_id, previous: null };
      await tx.updateTable('products').set({ photo_sha256: null, updated_at: this.clock() }).where('id', '=', p.id).execute();
      await this.audit.record({ actor, action: 'product.photo.remove', targetType: 'product', targetId: p.product_id, details: { previous: p.photo_sha256 } }, tx);
      return { productId: p.product_id, previous: p.photo_sha256 };
    });
    if (previous) await this.deleteIfUnused(previous);
    return { productId, photoUrl: null };
  }

  /** Store the image once: the same bytes uploaded again (for another model or piece) are the same row. */
  private async store(tx: Db, sha256: string, image: CleanImage, actor: Actor): Promise<void> {
    await tx
      .insertInto('media_objects')
      .values({
        sha256,
        mime: image.mime,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        // The console user who uploaded it; a script (system actor) leaves it empty.
        created_by: actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null,
        created_at: this.clock(),
      })
      .onConflict((oc) => oc.column('sha256').doNothing())
      .execute();
  }

  /** Delete an image no model and no piece uses any more. Best effort, after the change committed. */
  private async deleteIfUnused(sha256: string): Promise<void> {
    try {
      await this.db
        .deleteFrom('media_objects')
        .where('sha256', '=', sha256)
        .where((eb) => eb.not(eb.exists(eb.selectFrom('models').select('id').where('image_sha256', '=', sha256))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('products').select('id').where('photo_sha256', '=', sha256))))
        .execute();
    } catch (e) {
      // Used again meanwhile (the foreign key refused the delete): it stays, as it should.
      if (isForeignKeyViolation(e)) return;
      this.log.warn({ sha256, err: { message: (e as Error)?.message } }, 'media: an unused image could not be deleted');
    }
  }
}

function modelKey(modelId: string): string {
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
  return modelId.toLowerCase();
}

function describe(image: CleanImage): StoredImage {
  const sha256 = createHash('sha256').update(image.bytes).digest('hex');
  return { sha256, mime: image.mime, width: image.width, height: image.height, bytes: image.bytes.length, url: `${MEDIA_URL_PREFIX}${sha256}` };
}

/** The audit facts of a stored image: never its bytes. */
function facts(s: StoredImage) {
  return { sha256: s.sha256, mime: s.mime, width: s.width, height: s.height, bytes: s.bytes };
}

async function issuedWithModel(db: Db, modelId: string): Promise<number> {
  const r = await db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', modelId).executeTakeFirstOrThrow();
  return Number(r.n);
}
