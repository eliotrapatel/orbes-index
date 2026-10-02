/**
 * Certificate cards: the card that carries a product's claim code under a
 * scratch-off panel, as a PDF (one card per page, or A4 sheets of ten) or a
 * CSV for a print shop's variable-data run.
 *
 * OPERATOR, never AUDITOR: the response holds claim codes. A POST, because
 * the codes travel in the body (never in a URL, which ends up in proxy
 * logs), CSRF-protected like every mutation. The service checks each code
 * against its product's hash and audits product ids only. Files are sent as
 * attachments with `no-store`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { certificateBody, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';

export const adminCertificateRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { certificates } = ctx.services;

  app.post('/api/admin/certificates', { config: { guard: { minRole: 'OPERATOR' } } }, async (request, reply) => {
    const { items, format, layout } = parse(certificateBody, request.body);
    const file = await certificates.render(items, { ...(format ? { format } : {}), ...(layout ? { layout } : {}) }, adminActor(request));
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    const body = file.body;
    return reply.send(typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });
};
