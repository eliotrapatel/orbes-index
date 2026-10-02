/**
 * Codes and genomes: artifact downloads, print sheets and their manifests,
 * revocation, registry lists.
 *
 * Artifact downloads are GETs but produce printable, verifying codes, so
 * they need OPERATOR (not AUDITOR) and every download is audited by the
 * issuance service. Artifacts are sent as attachments with `no-store`, and
 * SVG additionally under a sandboxing CSP so it can never run as a document
 * on this origin.
 *
 * The codes registry filters by production batch, model, code status and
 * issue day (codeListQuery); /api/admin/codes/ids answers the ids of the
 * printable codes among them, so the console can print a whole batch.
 */
import type { FastifyPluginAsync } from 'fastify';
import { artifactParams, artifactQuery, codeListQuery, codeParams, pageOf, parse, printSheetBody, requiredReasonBody, type CodeListQuery } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { Db } from '../../db/connection.js';
import { NOT_PRINTABLE, toCodeRecord, toGenomeRecord } from '../../services/issuance.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';
import { codeJson, genomeJson } from './serialize.js';

/** At most this many ids per GET /api/admin/codes/ids (five print sheets of 200). */
export const MAX_CODE_IDS = 1000;

const DAY_MS = 86_400_000;
/** The last day of a four-digit year: the day after it (year 10000) cannot be sent to PostgreSQL (PGlite writes `+010000-…`). */
const LAST_DAY = '9999-12-31';

/** The codes (joined to their products) that match the registry filters. */
export function filteredCodes(db: Db, f: CodeListQuery) {
  let q = db.selectFrom('codes as c').innerJoin('products as p', 'p.id', 'c.product_id');
  if (f.productionBatch !== undefined) q = q.where('p.production_batch', '=', f.productionBatch);
  if (f.modelId !== undefined) q = q.where('p.model_id', '=', f.modelId);
  if (f.status !== undefined) q = q.where('c.status', '=', f.status);
  // Issue days are UTC days (as `issuedAt`); both ends are included. Every code is issued before the end of the last day.
  if (f.issuedFrom !== undefined) q = q.where('c.created_at', '>=', new Date(`${f.issuedFrom}T00:00:00.000Z`));
  if (f.issuedTo !== undefined && f.issuedTo < LAST_DAY) q = q.where('c.created_at', '<', new Date(Date.parse(`${f.issuedTo}T00:00:00.000Z`) + DAY_MS));
  return q;
}

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
        ...(q.kOnly !== undefined ? { kOnly: q.kOnly } : {}),
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

  // The sheet's manifest (CSV): which label is where, in the PDF's order. Same body and checks as the sheet; audited.
  app.post('/api/admin/codes/print-sheet/manifest', async (request, reply) => {
    const { codeIds, ...options } = parse(printSheetBody, request.body);
    const manifest = await issuance.printSheetManifest(codeIds, options, adminActor(request));
    reply.header('content-type', manifest.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(manifest.filename)}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(manifest.body);
  });

  app.post('/api/admin/codes/:codeId/revoke', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { codeId } = parse(codeParams, request.params);
    const b = parse(requiredReasonBody, request.body);
    return { code: codeJson(await issuance.revokeCode(codeId, b.reason, adminActor(request))) };
  });

  app.get('/api/admin/codes', async (request) => {
    const f = parse(codeListQuery, request.query);
    const page = pageOf(request.query);
    const base = filteredCodes(db, f);
    const total = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await base
      .selectAll('c')
      .select(['p.product_id as canonical_id', 'p.status as product_status'])
      .orderBy('c.created_at', 'desc')
      .orderBy('c.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      // `printable`: a print sheet accepts the code (ACTIVE, of a product that may still be printed), as /codes/ids selects.
      rows.map((r) => ({ ...codeJson(toCodeRecord(r, r.canonical_id)), printable: r.status === 'ACTIVE' && !NOT_PRINTABLE.has(r.product_status) })),
      Number(total.n),
      page,
    );
  });

  // Every printable code of a filter (a production batch, typically), for a print sheet: ACTIVE codes of
  // products that may still be printed, in identity order (year, category, serial), at most MAX_CODE_IDS.
  app.get('/api/admin/codes/ids', async (request) => {
    const f = parse(codeListQuery, request.query);
    const base = filteredCodes(db, f)
      .where('c.status', '=', 'ACTIVE')
      .where('p.status', 'not in', [...NOT_PRINTABLE]);
    const total = Number((await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    const rows = await base.select('c.id').orderBy('p.year').orderBy('p.category_id').orderBy('p.serial').limit(MAX_CODE_IDS).execute();
    return { ids: rows.map((r) => r.id), total, truncated: total > rows.length };
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
