/**
 * Codes and genomes: artifact downloads, revocation, registry lists.
 *
 * Artifact downloads are GETs but produce printable, verifying codes, so
 * they need OPERATOR (not AUDITOR) and every download is audited by the
 * issuance service. Artifacts are sent as attachments with `no-store`, and
 * SVG additionally under a sandboxing CSP so it can never run as a document
 * on this origin.
 */
import type { FastifyPluginAsync } from 'fastify';
import { artifactParams, artifactQuery, codeParams, pageOf, parse, printSheetBody, requiredReasonBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { toCodeRecord, toGenomeRecord } from '../../services/issuance.js';
import { makePage, pageOffset } from '../../types.js';
import { revokeCode } from './code-revocation.js';
import type { AdminRouteDeps } from './index.js';
import { codeJson, genomeJson } from './serialize.js';

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox";

export function safeFilename(name: string): string {
  const s = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return s.slice(0, 120) || 'orbes-code';
}

export const adminCodeRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;
  const { issuance } = ctx.services;

  // No automatic HEAD route: a HEAD would render and audit a download nobody receives.
  app.get('/api/admin/codes/:codeId/artifact.:format', { exposeHeadRoute: false, config: { guard: { minRole: 'OPERATOR' } } }, async (request, reply) => {
    const { codeId, format } = parse(artifactParams, request.params);
    const q = parse(artifactQuery, request.query);
    const artifact = await issuance.renderCode(
      codeId,
      format,
      {
        ...(q.widthMm !== undefined ? { widthMm: q.widthMm } : {}),
        ...(q.theme !== undefined ? { theme: q.theme } : {}),
        decor: q.decor ?? true,
        label: q.label ?? false,
        ...(q.dpi !== undefined ? { dpi: q.dpi } : {}),
      },
      adminActor(request),
    );
    reply.header('content-type', artifact.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(artifact.filename)}"`);
    reply.header('cache-control', 'no-store');
    if (format === 'svg') reply.header('content-security-policy', SVG_CSP);
    const body = artifact.body;
    return reply.send(typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });

  // Batch production: one PDF with many labeled codes and crop marks. POST because it carries a list (CSRF-protected, audited).
  app.post('/api/admin/codes/print-sheet', async (request, reply) => {
    const { codeIds, ...options } = parse(printSheetBody, request.body);
    const sheet = await issuance.renderPrintSheet(codeIds, options, adminActor(request));
    reply.header('content-type', sheet.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(sheet.filename)}"`);
    reply.header('cache-control', 'no-store');
    const body = sheet.body;
    return reply.send(typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });

  app.post('/api/admin/codes/:codeId/revoke', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { codeId } = parse(codeParams, request.params);
    const b = parse(requiredReasonBody, request.body);
    const r = await revokeCode(ctx, codeId, b.reason, adminActor(request));
    return { code: codeJson(toCodeRecord(r.code, r.productId)) };
  });

  app.get('/api/admin/codes', async (request) => {
    const page = pageOf(request.query);
    const base = db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id');
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await base
      .selectAll('c')
      .select('p.product_id as canonical_id')
      .orderBy('c.created_at', 'desc')
      .orderBy('c.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map((r) => codeJson(toCodeRecord(r, r.canonical_id))),
      Number(total.n),
      page,
    );
  });

  app.get('/api/admin/genomes', async (request) => {
    const page = pageOf(request.query);
    const total = await db.selectFrom('genomes').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await db
      .selectFrom('genomes')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map((r) => genomeJson(toGenomeRecord(r))),
      Number(total.n),
      page,
    );
  });
};
