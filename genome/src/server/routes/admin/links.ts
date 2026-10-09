/**
 * The console's links and their channels (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.7.2, step 4.3; API §16.35):
 * the routes that make and change them, and what the New link dialog offers; and their reports (step 4.6,
 * services/acquisition-report.ts): what each link, campaign and site brought in, first and last link.
 *
 *   GET    /api/admin/links                        AUDITOR   the report: ?from&to (Paris days, both or neither), currency,
 *                                                           view (links | campaigns | sites), archived
 *   GET    /api/admin/links/:id                    AUDITOR   one link: its figures, its days, its return (?from&to&currency)
 *   GET    /api/admin/acquisition/collectors       AUDITOR   the collectors behind a figure: ?source&attribution&measure
 *                                                           &from&to&currency&page; emails masked for an AUDITOR
 *
 *   GET    /api/admin/link-channels                AUDITOR   the channels in their order, each with its links
 *   POST   /api/admin/link-channels                OPERATOR  a channel added (201)          link_channel.create
 *   PATCH  /api/admin/link-channels/:id            OPERATOR  renamed or moved               link_channel.update
 *   DELETE /api/admin/link-channels/:id            OPERATOR  removed while no link uses it (204)  link_channel.delete
 *   GET    /api/admin/links/destinations           AUDITOR   the releases and the models the dialog offers
 *   POST   /api/admin/links                        OPERATOR  a link made (201)              link.create
 *   PATCH  /api/admin/links/:id                    OPERATOR  its name, channel, destination, cost, note  link.update
 *   POST   /api/admin/links/:id/archive            OPERATOR  out of the list's default view  link.archive
 *   POST   /api/admin/links/:id/unarchive          OPERATOR  back in the list               link.unarchive
 *
 * Reads need AUDITOR and writes OPERATOR by the console's default rule (routes/admin/index.ts): RETAIL and LOGISTICS
 * get 403. Every write needs the CSRF token and a same-origin request, and is audited by LinkService.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  acquisitionCollectorsQuery,
  emptyBody,
  linkBody,
  linkChannelBody,
  linkChannelParams,
  linkChannelUpdateBody,
  linkParams,
  linkReportQuery,
  linksQuery,
  linkUpdateBody,
  parse,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { parseSourceSpec } from '../../services/acquisition-report.js';
import { clientEmail, readsClientEmails } from './serialize.js';
import type { AdminRouteDeps } from './index.js';

export const adminLinkRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { links, acquisitionReport } = ctx.services;

  app.get('/api/admin/link-channels', async () => ({ channels: await links.channels() }));

  app.post('/api/admin/link-channels', async (request, reply) => {
    const b = parse(linkChannelBody, request.body);
    const channel = await links.createChannel(b, adminActor(request));
    reply.code(201);
    return { channel };
  });

  app.patch('/api/admin/link-channels/:id', async (request) => {
    const { id } = parse(linkChannelParams, request.params);
    const b = parse(linkChannelUpdateBody, request.body);
    return { channel: await links.updateChannel(id, b, adminActor(request)) };
  });

  app.delete('/api/admin/link-channels/:id', async (request, reply) => {
    const { id } = parse(linkChannelParams, request.params);
    await links.deleteChannel(id, adminActor(request));
    return reply.code(204).send();
  });

  app.get('/api/admin/links/destinations', async () => links.destinations());

  app.get('/api/admin/links', async (request) => {
    const q = parse(linksQuery, request.query);
    return acquisitionReport.report({ from: q.from, to: q.to, currency: q.currency, view: q.view, archived: q.archived });
  });

  app.get('/api/admin/links/:id', async (request) => {
    const { id } = parse(linkParams, request.params);
    const q = parse(linkReportQuery, request.query);
    return acquisitionReport.link(id, { from: q.from, to: q.to, currency: q.currency });
  });

  app.get('/api/admin/acquisition/collectors', async (request) => {
    const q = parse(acquisitionCollectorsQuery, request.query);
    const inClear = readsClientEmails(request);
    const page = await acquisitionReport.collectors({
      source: parseSourceSpec(q.source),
      attribution: q.attribution,
      measure: q.measure,
      from: q.from,
      to: q.to,
      currency: q.currency,
      page: q.page,
    });
    return { ...page, items: page.items.map((c) => ({ ...c, email: clientEmail(c.email, inClear) })) };
  });

  app.post('/api/admin/links', async (request, reply) => {
    const b = parse(linkBody, request.body);
    const link = await links.create(b, adminActor(request));
    reply.code(201);
    return { link };
  });

  app.patch('/api/admin/links/:id', async (request) => {
    const { id } = parse(linkParams, request.params);
    const b = parse(linkUpdateBody, request.body);
    return { link: await links.update(id, b, adminActor(request)) };
  });

  app.post('/api/admin/links/:id/archive', async (request) => {
    const { id } = parse(linkParams, request.params);
    parse(emptyBody, request.body);
    return { link: await links.archive(id, adminActor(request)) };
  });

  app.post('/api/admin/links/:id/unarchive', async (request) => {
    const { id } = parse(linkParams, request.params);
    parse(emptyBody, request.body);
    return { link: await links.unarchive(id, adminActor(request)) };
  });
};
