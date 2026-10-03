/**
 * Photographs (F-04): a model's reference photograph and the photograph of
 * one piece (API §13.4, §14.12). OPERATOR, like every other mutation of the
 * catalogue and of a product; CSRF as for any unsafe request.
 *
 * The only routes whose body is not JSON: the image itself, sent as
 * `image/jpeg` or `image/webp`, at most 1 MiB. The two parsers live in this
 * plugin's encapsulation context, so no other route of the API accepts an
 * image, nor a body over 16 KB; here, any other type is a 415 that says what
 * to send. The service (MediaService) checks the bytes, strips EXIF and XMP,
 * stores the image once by its SHA-256 and audits the change.
 *
 * The edge in front of the VPS lets these two upload paths, and only them,
 * carry 1 200 KB instead of 64 KB (deploy/vps/Caddyfile, DEPLOYMENT §15).
 */
import type { FastifyPluginAsync } from 'fastify';
import { DomainError } from '../../errors.js';
import { catalogParams, emptyBody, parse, productParams } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, type ImageMime } from '../../media/image.js';
import type { ImageUpload } from '../../services/media.js';
import type { AdminRouteDeps } from './index.js';

/** The body limit of the image routes: the largest image stored (1 MiB). */
export const MEDIA_BODY_LIMIT_BYTES = MAX_IMAGE_BYTES;

/** The image routes: POST sets, DELETE removes (role OPERATOR, the default for a mutation). */
export const MEDIA_UPLOAD_ROUTES = Object.freeze(['/api/admin/models/:id/image', '/api/admin/products/:productId/photo'] as const);

/** A parsed image body: kept apart from a parsed JSON object, which these routes refuse. */
class ImageBody implements ImageUpload {
  constructor(
    readonly mime: ImageMime,
    readonly bytes: Uint8Array,
  ) {}
}

const unsupportedType = () =>
  new DomainError('UNSUPPORTED_MEDIA_TYPE', 415, 'Send the image itself, as image/jpeg or image/webp (at most 1 MB).');

function imageOf(body: unknown): ImageUpload {
  if (!(body instanceof ImageBody)) throw unsupportedType();
  return body;
}

export const adminMediaRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { media, catalog } = ctx.services;

  for (const mime of IMAGE_MIME_TYPES) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: MEDIA_BODY_LIMIT_BYTES }, (_request, body, done) => {
      const b = body as Buffer;
      done(null, new ImageBody(mime, new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
    });
  }
  // Any other type (image/svg+xml, image/png, a form…) is refused here without being read; JSON, inherited, reaches
  // the handler and is refused there with the same answer.
  app.addContentTypeParser('*', (_request, _payload, done) => done(unsupportedType(), undefined));

  // ── A model's reference photograph ───────────────────────────────────────

  app.post('/api/admin/models/:id/image', { bodyLimit: MEDIA_BODY_LIMIT_BYTES }, async (request) => {
    const { id } = parse(catalogParams, request.params);
    await media.setModelImage(id, imageOf(request.body), adminActor(request));
    return catalog.getModel(id);
  });

  app.delete('/api/admin/models/:id/image', async (request) => {
    const { id } = parse(catalogParams, request.params);
    parse(emptyBody, request.body);
    await media.removeModelImage(id, adminActor(request));
    return catalog.getModel(id);
  });

  // ── The photograph of one piece ──────────────────────────────────────────

  app.post('/api/admin/products/:productId/photo', { bodyLimit: MEDIA_BODY_LIMIT_BYTES }, async (request) => {
    const { productId } = parse(productParams, request.params);
    return media.setProductPhoto(productId, imageOf(request.body), adminActor(request));
  });

  app.delete('/api/admin/products/:productId/photo', async (request) => {
    const { productId } = parse(productParams, request.params);
    parse(emptyBody, request.body);
    return media.removeProductPhoto(productId, adminActor(request));
  });
};
