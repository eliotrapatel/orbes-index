/**
 * The Yearly care board of the console (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6; API §16.29): the collectors'
 * requests for the yearly care of a piece, by status, oldest first, and each request's steps. Nothing is written in
 * MESSAGES at any step: the prepaid label shows only in the piece's SERVICE tab.
 *
 *   GET  /api/admin/care                 AUDITOR   the board: `?status=` a step's tab, `?year=`
 *   GET  /api/admin/care/:id             AUDITOR   a request: its facts, the address it returns to, the client's
 *                                                  conversation
 *   POST /api/admin/care/:id/label       OPERATOR  SEND LABEL: the PDF itself (`application/pdf`, at most 2 MiB), its
 *                                                  carrier and tracking number in the query (`?carrierId=&tracking=`)
 *   POST /api/admin/care/:id/receive     OPERATOR  RECEIVED AT THE ATELIER: the YEARLY_CARE record opened
 *   POST /api/admin/care/:id/return      OPERATOR  SHIP BACK {carrierId, tracking}
 *   POST /api/admin/care/:id/complete    OPERATOR  COMPLETE {notes?}: the record completed
 *   POST /api/admin/care/:id/cancel      OPERATOR  CANCEL {note}, before the piece is shipped back
 *
 * The label's route is the only one here whose body is not JSON: its parser lives in this plugin's encapsulation
 * context, as the photographs' do (media.ts), so no other route of the API accepts a PDF nor a body over 16 KB; here,
 * any other type is 415 FILE_NOT_PDF, a body over 2 MiB 413 FILE_TOO_LARGE (CARE_LABEL_UPLOAD_ROUTE: the edge lets this
 * path, and only it besides the photographs, carry more than 64 KB; deploy/vps/Caddyfile, DEPLOYMENT §15). An AUDITOR
 * reads the clients' emails and the return name and address masked (serialize.ts). services/care.ts checks, steps and
 * audits each change (`care.label`, `care.receive`, `care.return`, `care.complete`, `care.cancel`: never the address).
 */
import type { FastifyPluginAsync } from 'fastify';
import { DomainError } from '../../errors.js';
import { adminCareQuery, careCancelBody, careCompleteBody, careLabelQuery, careParams, careShipBody, emptyBody, pageOf, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { CARE_LABEL_MAX_BYTES, fileNotPdf, type CareBoardRow, type CareSheet } from '../../services/care.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, orderBuyer, readsClientEmails } from './serialize.js';

/** The label's upload route (POST, role OPERATOR): the edge gives exactly it, besides the photographs, more than 64 KB. */
export const CARE_LABEL_UPLOAD_ROUTE = '/api/admin/care/:id/label';
/** Its body limit: the largest label stored (2 MiB). */
export const CARE_LABEL_BODY_LIMIT_BYTES = CARE_LABEL_MAX_BYTES;

/** A parsed PDF body: kept apart from a parsed JSON object, which this route refuses. */
class PdfBody {
  constructor(readonly bytes: Uint8Array) {}
}

function rowJson<T extends CareBoardRow>(r: T, inClear: boolean): T {
  return { ...r, account: { ...r.account, email: clientEmail(r.account.email, inClear) } };
}

function sheetJson(s: CareSheet, inClear: boolean): CareSheet {
  const to = orderBuyer({ name: s.returnName, address: s.returnAddress }, inClear);
  return { ...rowJson(s, inClear), returnName: to.name ?? '', returnAddress: to.address ?? '' };
}

export const adminCareRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { care } = ctx.services;

  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: CARE_LABEL_BODY_LIMIT_BYTES }, (_request, body, done) => {
    const b = body as Buffer;
    done(null, new PdfBody(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
  });
  // Any other type is refused here without being read; JSON, inherited, reaches the handler and is refused there alike.
  app.addContentTypeParser('*', (_request, _payload, done) => done(fileNotPdf(), undefined));
  // A body over the limit says what the label may weigh.
  app.setErrorHandler((error, _request, _reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw new DomainError('FILE_TOO_LARGE', 413, 'The label is limited to 2 MB.');
    throw error;
  });

  app.get('/api/admin/care', async (request) => {
    const q = parse(adminCareQuery, request.query);
    const page = await care.list({ ...(q.status ? { status: q.status } : {}), ...(q.year !== undefined ? { year: q.year } : {}) }, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((r) => rowJson(r, inClear)) };
  });

  app.get('/api/admin/care/:id', async (request) => {
    const { id } = parse(careParams, request.params);
    return sheetJson(await care.sheet(id), readsClientEmails(request));
  });

  app.post(CARE_LABEL_UPLOAD_ROUTE, { bodyLimit: CARE_LABEL_BODY_LIMIT_BYTES }, async (request) => {
    const { id } = parse(careParams, request.params);
    if (!(request.body instanceof PdfBody)) throw fileNotPdf();
    const q = parse(careLabelQuery, request.query);
    return sheetJson(await care.sendLabel(id, { pdf: request.body.bytes, carrierId: q.carrierId, tracking: q.tracking }, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/care/:id/receive', async (request) => {
    const { id } = parse(careParams, request.params);
    parse(emptyBody, request.body);
    return sheetJson(await care.receive(id, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/care/:id/return', async (request) => {
    const { id } = parse(careParams, request.params);
    const b = parse(careShipBody, request.body);
    return sheetJson(await care.shipBack(id, { carrierId: b.carrierId, tracking: b.tracking }, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/care/:id/complete', async (request) => {
    const { id } = parse(careParams, request.params);
    const b = parse(careCompleteBody, request.body);
    return sheetJson(await care.complete(id, { notes: b.notes ?? null }, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/care/:id/cancel', async (request) => {
    const { id } = parse(careParams, request.params);
    const b = parse(careCancelBody, request.body);
    return sheetJson(await care.cancel(id, { note: b.note }, adminActor(request)), readsClientEmails(request));
  });
};
