/**
 * MediaService (F-04): the reference photograph of a model (phase 1) and the
 * photograph of one piece taken at issuance (phase 2), stored once each in
 * `media_objects` (migration 0012) and served publicly by
 * `GET /api/v1/media/:sha256`; and the gallery of a model's lookbook sheet
 * (P-R02, `model_images`, migration 0014): at most GALLERY_MAX photographs
 * beside its cover (the reference photograph), in an order, each with its
 * alternative text; and the photographs of a post of the owners' circle
 * (P-X01, `circle_post_images`, migration 0016): at most CIRCLE_PHOTOS_MAX,
 * in an order, each with its alternative text.
 *
 * Every image goes through `server/media/image.ts` first: its type checked by
 * its own bytes, EXIF and XMP removed, its dimensions read. It is then stored
 * under the SHA-256 of what remains (the same photograph is stored once),
 * and the model or the piece points to it, in one transaction with the audit
 * entry: `model.image.set`, `model.image.remove`, `product.photo.set`,
 * `product.photo.remove`, each with the image's facts (hash, type, size) and
 * the one it replaced, never its bytes. A change that changes nothing (the
 * same photograph again, or a removal where there is none) writes nothing.
 * The gallery's changes (`model.gallery.add`, `model.gallery.remove`,
 * `model.gallery.update`: its order and alternative texts) lock the model's
 * row first, so two of them on one model run one after the other, and keep
 * its positions 1 to n. The photographs of a circle post go the same way
 * (`circle.post.photo.add`, `circle.post.photo.remove`,
 * `circle.post.photo.update`), under the post's row lock.
 *
 * The silhouette of a LIVE RELEASE (`drops.silhouette_sha256`, migration 0021), its first staged reveal, goes the same
 * way (`drop.live.silhouette.set`, `drop.live.silhouette.remove`), until the release's announcement.
 *
 * An image no model, no gallery, no circle post, no piece and no release uses any more is deleted once
 * the change has committed: a removed photograph stops being served. A concurrent
 * upload of the very same bytes keeps it: the upload locks the row (FOR KEY
 * SHARE) as soon as it has inserted it or found it there, so the delete
 * waits for the upload, whose pointer the foreign key then sees (the delete
 * is refused, and simply skipped); a row deleted before that lock is
 * inserted again by the upload.
 *
 * The public results show the model's photograph on the AUTHENTIC states only
 * (VerificationService, `product.imageUrl`). A piece's own photograph is the
 * console's only (plan NOCTURNE, decision 9): no answer a collector receives
 * names it.
 */
import { createHash } from 'node:crypto';
import { inTransaction, type Db } from '../db/connection.js';
import { isForeignKeyViolation } from '../db/pg-errors.js';
import type { MediaMimeType } from '../db/schema.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
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

/** The photographs of a model's lookbook gallery (P-R02), beside its cover: positions 1 to GALLERY_MAX (migration 0014). */
export const GALLERY_MAX = 8;
/** A gallery photograph's alternative text: one line, at most this many characters (the database's bound). */
export const GALLERY_ALT_MAX = 200;

/** A gallery photograph's alternative text: '' and null mean the sheet's default (the model's name and type). */
export function normalizeAlt(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw validationError('The alternative text must be text.');
  const s = v.trim();
  if (/[\u0000-\u001f\u007f]/.test(s)) throw validationError('The alternative text is one line, without control characters.');
  if (s.length > GALLERY_ALT_MAX) throw validationError(`The alternative text has at most ${GALLERY_ALT_MAX} characters.`);
  return s;
}

/** One photograph of a gallery, as PATCH /api/admin/models/:id/gallery sends it back: the order is the list's. */
export interface GalleryItem {
  sha256: string;
  /** '' or null: the sheet's default; left out (undefined): the photograph keeps the text it has. */
  alt?: string | null;
}

const galleryImageNotFound = () => notFound('Photograph of this gallery', 'GALLERY_IMAGE_NOT_FOUND');

/** The photographs of a post of the owners' circle (P-X01): positions 1 to CIRCLE_PHOTOS_MAX (migration 0016). */
export const CIRCLE_PHOTOS_MAX = 4;

const circlePostNotFound = () => notFound('Post of the circle', 'CIRCLE_POST_NOT_FOUND');
const circlePhotoNotFound = () => notFound('Photograph of this post', 'CIRCLE_PHOTO_NOT_FOUND');
/** As services/drops.ts says it (not imported: drops.ts reads this module). */
const releaseNotFound = () => new DomainError('DROP_NOT_FOUND', 404, 'This release is not known to ORBES.');
const releaseAnnounced = () => conflict('LIVE_ANNOUNCED', 'This release is announced: its settings no longer change. Raise a size’s stock with ADD PIECES.');

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

  // ── The gallery of a model's lookbook sheet (P-R02) ──────────────────────

  /**
   * Add a photograph to the gallery of a model's lookbook sheet (POST /api/admin/models/:id/gallery), last. At most
   * GALLERY_MAX (409 GALLERY_FULL); the model's reference photograph is its cover already (409 IMAGE_IS_COVER); the same
   * photograph again writes nothing. Audited `model.gallery.add` with the image's facts and its position.
   */
  async addModelGalleryImage(modelId: string, upload: ImageUpload, actor: Actor): Promise<StoredImage> {
    const image = sanitizeImage(upload?.bytes, upload?.mime);
    const id = modelKey(modelId);
    const stored = describe(image);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('models').select(['id', 'image_sha256']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (row.image_sha256 === stored.sha256) {
        throw conflict('IMAGE_IS_COVER', 'This photograph is already the reference photograph of the model, the cover of its sheet.');
      }
      const images = await tx.selectFrom('model_images').select(['sha256', 'position']).where('model_id', '=', id).execute();
      if (images.some((i) => i.sha256 === stored.sha256)) return;
      if (images.length >= GALLERY_MAX) throw conflict('GALLERY_FULL', `The gallery of a model holds ${GALLERY_MAX} photographs at most: remove one first.`);
      await this.store(tx, stored.sha256, image, actor);
      const position = images.length + 1;
      await tx
        .insertInto('model_images')
        .values({ model_id: id, sha256: stored.sha256, position, alt: null, created_by: adminId(actor), created_at: this.clock() })
        .execute();
      await this.audit.record({ actor, action: 'model.gallery.add', targetType: 'model', targetId: id, details: { ...facts(stored), position } }, tx);
    });
    return stored;
  }

  /**
   * Remove a photograph from a model's gallery (DELETE /api/admin/models/:id/gallery/:sha256); the ones after it move up.
   * 404 GALLERY_IMAGE_NOT_FOUND when it is not in this gallery. Audited `model.gallery.remove`. The image, used nowhere
   * else, is then deleted.
   */
  async removeModelGalleryImage(modelId: string, sha256: string, actor: Actor): Promise<void> {
    const id = modelKey(modelId);
    const sha = typeof sha256 === 'string' ? sha256.toLowerCase() : '';
    if (!SHA256_RE.test(sha)) throw galleryImageNotFound();
    await inTransaction(this.db, async (tx) => {
      const model = await tx.selectFrom('models').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
      const row = await tx.selectFrom('model_images').select(['position']).where('model_id', '=', id).where('sha256', '=', sha).executeTakeFirst();
      if (!row) throw galleryImageNotFound();
      await tx.deleteFrom('model_images').where('model_id', '=', id).where('sha256', '=', sha).execute();
      // Positions stay 1…n: the unique (model_id, position) is checked at commit, so the shift may pass over itself.
      await tx
        .updateTable('model_images')
        .set((eb) => ({ position: eb('position', '-', 1) }))
        .where('model_id', '=', id)
        .where('position', '>', row.position)
        .execute();
      await this.audit.record({ actor, action: 'model.gallery.remove', targetType: 'model', targetId: id, details: { sha256: sha, position: row.position } }, tx);
    });
    await this.deleteIfUnused(sha);
  }

  /**
   * The order and the alternative texts of a model's gallery (PATCH /api/admin/models/:id/gallery): `items` names every
   * photograph of the gallery once, in the new order, each with its text ('' or null: the sheet's default; left out:
   * unchanged). A list that no longer matches the gallery (a photograph added or removed meanwhile) is 409
   * GALLERY_CHANGED, and nothing is written. Audited `model.gallery.update` with the gallery before and after; nothing
   * is written when nothing changes.
   */
  async arrangeModelGallery(modelId: string, items: readonly GalleryItem[], actor: Actor): Promise<void> {
    const id = modelKey(modelId);
    if (!Array.isArray(items) || items.length > GALLERY_MAX) throw validationError(`List the photographs of the gallery, ${GALLERY_MAX} at most.`);
    const asked = items.map((item, i) => {
      const sha = typeof item?.sha256 === 'string' ? item.sha256.toLowerCase() : '';
      if (!SHA256_RE.test(sha)) throw validationError(`Photograph ${i + 1}: not a SHA-256.`);
      return { sha256: sha, alt: item.alt === undefined ? undefined : normalizeAlt(item.alt), position: i + 1 };
    });
    await inTransaction(this.db, async (tx) => {
      const model = await tx.selectFrom('models').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
      const current = await tx.selectFrom('model_images').select(['sha256', 'position', 'alt']).where('model_id', '=', id).orderBy('position').execute();
      const named = new Set(asked.map((n) => n.sha256));
      if (named.size !== asked.length || named.size !== current.length || current.some((c) => !named.has(c.sha256))) {
        throw conflict('GALLERY_CHANGED', 'The gallery changed meanwhile: reload it, then try again.');
      }
      const before = new Map(current.map((c) => [c.sha256, c]));
      const next = asked.map((n) => ({ ...n, alt: n.alt === undefined ? before.get(n.sha256)!.alt : n.alt }));
      const changed = next.filter((n) => before.get(n.sha256)!.position !== n.position || before.get(n.sha256)!.alt !== n.alt);
      if (changed.length === 0) return;
      for (const n of changed) {
        await tx.updateTable('model_images').set({ position: n.position, alt: n.alt }).where('model_id', '=', id).where('sha256', '=', n.sha256).execute();
      }
      await this.audit.record(
        {
          actor,
          action: 'model.gallery.update',
          targetType: 'model',
          targetId: id,
          details: {
            before: current.map((c) => ({ sha256: c.sha256, alt: c.alt })),
            after: next.map((n) => ({ sha256: n.sha256, alt: n.alt })),
          },
        },
        tx,
      );
    });
  }

  // ── The photographs of a post of the owners' circle (P-X01) ─────────────

  /**
   * Add a photograph to a post of the circle (POST /api/admin/circle/posts/:id/photos), last. At most CIRCLE_PHOTOS_MAX
   * (409 CIRCLE_PHOTOS_FULL); the same photograph again writes nothing. Audited `circle.post.photo.add` with the
   * image's facts and its position.
   */
  async addCirclePostPhoto(postId: string, upload: ImageUpload, actor: Actor): Promise<StoredImage> {
    const image = sanitizeImage(upload?.bytes, upload?.mime);
    const id = circlePostKey(postId);
    const stored = describe(image);
    await inTransaction(this.db, async (tx) => {
      const post = await tx.selectFrom('circle_posts').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!post) throw circlePostNotFound();
      const images = await tx.selectFrom('circle_post_images').select(['sha256', 'position']).where('post_id', '=', id).execute();
      if (images.some((i) => i.sha256 === stored.sha256)) return;
      if (images.length >= CIRCLE_PHOTOS_MAX) throw conflict('CIRCLE_PHOTOS_FULL', `A post of the circle holds ${CIRCLE_PHOTOS_MAX} photographs at most: remove one first.`);
      await this.store(tx, stored.sha256, image, actor);
      const position = images.length + 1;
      await tx
        .insertInto('circle_post_images')
        .values({ post_id: id, sha256: stored.sha256, position, alt: null, created_by: adminId(actor), created_at: this.clock() })
        .execute();
      await this.audit.record({ actor, action: 'circle.post.photo.add', targetType: 'circle_post', targetId: id, details: { ...facts(stored), position } }, tx);
    });
    return stored;
  }

  /**
   * Remove a photograph from a post of the circle (DELETE /api/admin/circle/posts/:id/photos/:sha256); the ones after
   * it move up. 404 CIRCLE_PHOTO_NOT_FOUND when it is not this post's. Audited `circle.post.photo.remove`. The image,
   * used nowhere else, is then deleted.
   */
  async removeCirclePostPhoto(postId: string, sha256: string, actor: Actor): Promise<void> {
    const id = circlePostKey(postId);
    const sha = typeof sha256 === 'string' ? sha256.toLowerCase() : '';
    if (!SHA256_RE.test(sha)) throw circlePhotoNotFound();
    await inTransaction(this.db, async (tx) => {
      const post = await tx.selectFrom('circle_posts').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!post) throw circlePostNotFound();
      const row = await tx.selectFrom('circle_post_images').select(['position']).where('post_id', '=', id).where('sha256', '=', sha).executeTakeFirst();
      if (!row) throw circlePhotoNotFound();
      await tx.deleteFrom('circle_post_images').where('post_id', '=', id).where('sha256', '=', sha).execute();
      // Positions stay 1…n: the unique (post_id, position) is checked at commit, so the shift may pass over itself.
      await tx
        .updateTable('circle_post_images')
        .set((eb) => ({ position: eb('position', '-', 1) }))
        .where('post_id', '=', id)
        .where('position', '>', row.position)
        .execute();
      await this.audit.record({ actor, action: 'circle.post.photo.remove', targetType: 'circle_post', targetId: id, details: { sha256: sha, position: row.position } }, tx);
    });
    await this.deleteIfUnused(sha);
  }

  /**
   * The order and the alternative texts of a post's photographs (PATCH /api/admin/circle/posts/:id/photos): `items`
   * names every photograph of the post once, in the new order, each with its text ('' or null: the post's default;
   * left out: unchanged). A list that no longer matches (a photograph added or removed meanwhile) is 409
   * CIRCLE_PHOTOS_CHANGED, and nothing is written. Audited `circle.post.photo.update` with the photographs before and
   * after; nothing is written when nothing changes.
   */
  async arrangeCirclePostPhotos(postId: string, items: readonly GalleryItem[], actor: Actor): Promise<void> {
    const id = circlePostKey(postId);
    if (!Array.isArray(items) || items.length > CIRCLE_PHOTOS_MAX) throw validationError(`List the photographs of the post, ${CIRCLE_PHOTOS_MAX} at most.`);
    const asked = items.map((item, i) => {
      const sha = typeof item?.sha256 === 'string' ? item.sha256.toLowerCase() : '';
      if (!SHA256_RE.test(sha)) throw validationError(`Photograph ${i + 1}: not a SHA-256.`);
      return { sha256: sha, alt: item.alt === undefined ? undefined : normalizeAlt(item.alt), position: i + 1 };
    });
    await inTransaction(this.db, async (tx) => {
      const post = await tx.selectFrom('circle_posts').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!post) throw circlePostNotFound();
      const current = await tx.selectFrom('circle_post_images').select(['sha256', 'position', 'alt']).where('post_id', '=', id).orderBy('position').execute();
      const named = new Set(asked.map((n) => n.sha256));
      if (named.size !== asked.length || named.size !== current.length || current.some((c) => !named.has(c.sha256))) {
        throw conflict('CIRCLE_PHOTOS_CHANGED', 'The photographs of this post changed meanwhile: reload them, then try again.');
      }
      const before = new Map(current.map((c) => [c.sha256, c]));
      const next = asked.map((n) => ({ ...n, alt: n.alt === undefined ? before.get(n.sha256)!.alt : n.alt }));
      const changed = next.filter((n) => before.get(n.sha256)!.position !== n.position || before.get(n.sha256)!.alt !== n.alt);
      if (changed.length === 0) return;
      for (const n of changed) {
        await tx.updateTable('circle_post_images').set({ position: n.position, alt: n.alt }).where('post_id', '=', id).where('sha256', '=', n.sha256).execute();
      }
      await this.audit.record(
        {
          actor,
          action: 'circle.post.photo.update',
          targetType: 'circle_post',
          targetId: id,
          details: {
            before: current.map((c) => ({ sha256: c.sha256, alt: c.alt })),
            after: next.map((n) => ({ sha256: n.sha256, alt: n.alt })),
          },
        },
        tx,
      );
    });
  }

  /**
   * The silhouette of a LIVE RELEASE (POST /api/admin/live/:id/silhouette): its first staged reveal on /verify, from
   * `silhouette_at` (without one, the seal stands in). Set until the release's announcement, like every setting of it
   * (409 LIVE_ANNOUNCED after; DROP_CANCELLED once cancelled). Audited `drop.live.silhouette.set` with the image's facts
   * and the one it replaced.
   */
  async setLiveSilhouette(dropId: string, upload: ImageUpload, actor: Actor): Promise<StoredImage> {
    const image = sanitizeImage(upload?.bytes, upload?.mime);
    const id = releaseKey(dropId);
    const stored = describe(image);
    const previous = await inTransaction(this.db, async (tx) => {
      const row = await this.lockUnannouncedRelease(tx, id);
      await this.store(tx, stored.sha256, image, actor);
      if (row.silhouette_sha256 === stored.sha256) return null;
      await tx.updateTable('drops').set({ silhouette_sha256: stored.sha256 }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'drop.live.silhouette.set', targetType: 'drop', targetId: id, details: { ...facts(stored), previous: row.silhouette_sha256 } }, tx);
      return row.silhouette_sha256;
    });
    if (previous) await this.deleteIfUnused(previous);
    return stored;
  }

  /** Remove a LIVE RELEASE's silhouette (DELETE /api/admin/live/:id/silhouette), until its announcement: the seal stands in. Audited `drop.live.silhouette.remove`. */
  async removeLiveSilhouette(dropId: string, actor: Actor): Promise<void> {
    const id = releaseKey(dropId);
    const previous = await inTransaction(this.db, async (tx) => {
      const row = await this.lockUnannouncedRelease(tx, id);
      if (row.silhouette_sha256 === null) return null;
      await tx.updateTable('drops').set({ silhouette_sha256: null }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'drop.live.silhouette.remove', targetType: 'drop', targetId: id, details: { previous: row.silhouette_sha256 } }, tx);
      return row.silhouette_sha256;
    });
    if (previous) await this.deleteIfUnused(previous);
  }

  /**
   * A LIVE RELEASE's row FOR UPDATE, neither cancelled nor announced (its announcement, or its publication without one);
   * never an after-room, which has no staged reveal (services/after-room.ts).
   */
  private async lockUnannouncedRelease(tx: Db, id: string): Promise<{ silhouette_sha256: string | null }> {
    const row = await tx
      .selectFrom('drops')
      .select(['silhouette_sha256', 'cancelled_at', 'announce_at', 'published_at'])
      .where('id', '=', id)
      .where('mode', '=', 'LIVE')
      .where('parent_drop_id', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw releaseNotFound();
    if (row.cancelled_at) throw conflict('DROP_CANCELLED', 'This release has been cancelled.');
    const announced = row.announce_at ?? row.published_at;
    if (announced && announced.getTime() <= this.clock().getTime()) throw releaseAnnounced();
    return row;
  }

  /**
   * Store the image once: the same bytes uploaded again (for another model or piece) are the same row. The row is
   * then locked FOR KEY SHARE until this transaction ends: ON CONFLICT DO NOTHING takes no lock on a row that already
   * exists, so without it the change that removed the last use of these bytes could delete the row between this
   * insert and the pointer written next (whose foreign key would then fail). Locked, that delete waits for this
   * transaction, and its foreign key then refuses it (deleteIfUnused skips it). A row deleted just before the lock is
   * inserted again.
   */
  private async store(tx: Db, sha256: string, image: CleanImage, actor: Actor): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await tx
        .insertInto('media_objects')
        .values({
          sha256,
          mime: image.mime,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          // The console user who uploaded it; a script (system actor) leaves it empty.
          created_by: adminId(actor),
          created_at: this.clock(),
        })
        .onConflict((oc) => oc.column('sha256').doNothing())
        .execute();
      const kept = await tx.selectFrom('media_objects').select('sha256').where('sha256', '=', sha256).forKeyShare().executeTakeFirst();
      if (kept) return;
    }
    throw new Error('media: the image could not be stored (deleted twice while it was being stored)');
  }

  /** Delete an image no model, no gallery, no circle post, no piece and no release's silhouette uses any more. Best effort, after the change committed. */
  private async deleteIfUnused(sha256: string): Promise<void> {
    try {
      await this.db
        .deleteFrom('media_objects')
        .where('sha256', '=', sha256)
        .where((eb) => eb.not(eb.exists(eb.selectFrom('models').select('id').where('image_sha256', '=', sha256))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('model_images').select('model_id').where('sha256', '=', sha256))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('circle_post_images').select('post_id').where('sha256', '=', sha256))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('products').select('id').where('photo_sha256', '=', sha256))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('drops').select('id').where('silhouette_sha256', '=', sha256))))
        .execute();
    } catch (e) {
      // Used again meanwhile (the foreign key refused the delete): it stays, as it should.
      if (isForeignKeyViolation(e)) return;
      this.log.warn({ sha256, err: { message: (e as Error)?.message } }, 'media: an unused image could not be deleted');
    }
  }
}

/** The console user behind an upload (media_objects.created_by, model_images.created_by); a script (system actor) leaves it empty. */
function adminId(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

function modelKey(modelId: string): string {
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
  return modelId.toLowerCase();
}

function releaseKey(dropId: string): string {
  if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw releaseNotFound();
  return dropId.toLowerCase();
}

function circlePostKey(postId: string): string {
  if (typeof postId !== 'string' || !UUID_RE.test(postId)) throw circlePostNotFound();
  return postId.toLowerCase();
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
