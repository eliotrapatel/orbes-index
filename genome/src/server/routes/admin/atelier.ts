/**
 * The atelier in the console (plan LIVE RELEASE+ of 2026-10-04, The console → Atelier, Registry): the stock per SKU and
 * location, its transfers, counts and thresholds (services/stock.ts, services/atelier.ts), the pieces to make and their
 * work sheets, the pieces issued.
 *
 *   GET    /api/admin/atelier/stock                AUDITOR   the stock (?modelId=&locationId=), its minimums and suggestions
 *   POST   /api/admin/atelier/stock/transfer       OPERATOR  pieces of a SKU moved between locations
 *   POST   /api/admin/atelier/stock/adjust         OPERATOR  a count corrected, with why
 *   PUT    /api/admin/atelier/thresholds           OPERATOR  a SKU's minimum at a location, or none
 *   POST   /api/admin/atelier/make                 OPERATOR  pieces to make for the stock (a suggestion confirmed)
 *   GET    /api/admin/atelier/bench                AUDITOR   the pieces to make per release, model and size
 *                                                            (?view=OPEN|DONE|CANCELLED|ALL&origin=&skuId=&locationId=)
 *   GET    /api/admin/atelier/bench.csv            AUDITOR   the same, as a CSV: what to make
 *   POST   /api/admin/atelier/bench/:id/start      OPERATOR  TO MAKE → IN PROGRESS
 *   POST   /api/admin/atelier/bench/:id/done       OPERATOR  IN PROGRESS → DONE: the piece issued (its claim code shown once)
 *   POST   /api/admin/atelier/bench/:id/cancel     OPERATOR  a piece to make for the stock cancelled
 *   POST   /api/admin/atelier/sheets               OPERATOR  the work sheets, each with its ORBES code's data
 *
 * The work sheets carry the scannable data of each code (serialize.ts: only where an OPERATOR is producing codes), and
 * a claim code is in the answer that issues it and nowhere else (`cache-control: no-store` on both). Every mutation is
 * audited by its service.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  atelierStockQuery,
  benchDoneBody,
  benchParams,
  benchQuery,
  emptyBody,
  makeForStockBody,
  parse,
  stockAdjustBody,
  stockThresholdBody,
  stockTransferBody,
  workSheetsBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { BenchFilter } from '../../services/atelier.js';
import type { AdminRouteDeps } from './index.js';

const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const adminAtelierRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { atelier, stock } = ctx.services;

  app.get('/api/admin/atelier/stock', async (request) => atelier.stock(defined(parse(atelierStockQuery, request.query))));

  app.post('/api/admin/atelier/stock/transfer', async (request) => {
    const b = parse(stockTransferBody, request.body);
    return stock.transfer({ ...b, note: b.note ?? null }, adminActor(request));
  });

  app.post('/api/admin/atelier/stock/adjust', async (request) => {
    const b = parse(stockAdjustBody, request.body);
    return stock.adjust(b, adminActor(request));
  });

  app.put('/api/admin/atelier/thresholds', async (request, reply) => {
    const b = parse(stockThresholdBody, request.body);
    await atelier.setThreshold(b, adminActor(request));
    reply.code(204);
  });

  app.post('/api/admin/atelier/make', async (request, reply) => {
    const b = parse(makeForStockBody, request.body);
    const items = await atelier.makeForStock(b, adminActor(request));
    reply.code(201);
    return { items };
  });

  app.get('/api/admin/atelier/bench', async (request) => atelier.bench(defined(parse(benchQuery, request.query)) as BenchFilter));

  app.get('/api/admin/atelier/bench.csv', async (request, reply) => {
    const file = await atelier.benchCsv(defined(parse(benchQuery, request.query)) as BenchFilter);
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.post('/api/admin/atelier/bench/:id/start', async (request) => {
    const { id } = parse(benchParams, request.params);
    parse(emptyBody, request.body);
    return atelier.start(id, adminActor(request));
  });

  app.post('/api/admin/atelier/bench/:id/done', async (request, reply) => {
    const { id } = parse(benchParams, request.params);
    const b = parse(benchDoneBody, request.body);
    const issued = await atelier.done(id, defined(b), adminActor(request));
    // Shown once: only its hash is stored.
    reply.header('cache-control', 'no-store');
    return issued;
  });

  app.post('/api/admin/atelier/bench/:id/cancel', async (request) => {
    const { id } = parse(benchParams, request.params);
    parse(emptyBody, request.body);
    return atelier.cancel(id, adminActor(request));
  });

  app.post('/api/admin/atelier/sheets', async (request, reply) => {
    const b = parse(workSheetsBody, request.body);
    const sheets = await atelier.sheets(defined(b), adminActor(request));
    reply.header('cache-control', 'no-store');
    return { printedAt: ctx.clock(), sheets };
  });
};
