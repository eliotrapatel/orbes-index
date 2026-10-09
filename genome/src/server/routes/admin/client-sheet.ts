/**
 * The client sheet's tags and private notes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.3 and C.9, step 5.3;
 * API §16.36): what ORBES Client Services keeps about a client, never shown to the client (services/client-notes.ts).
 *
 *   GET    /api/admin/tags                          AUDITOR   the tags in use, the most used first (50 at most), or
 *                                                             VIP, PRESS and FRIEND OF THE HOUSE while none is: { items }
 *   GET    /api/admin/owners/:id/notes?all=1        AUDITOR   every note not removed, the newest first: { items, total }
 *   POST   /api/admin/owners/:id/tags               OPERATOR  { tag }: 201 { tags }; 200 when the client carries it
 *                                                             already                         account.tag.add
 *   DELETE /api/admin/owners/:id/tags/:tag          OPERATOR  204                             account.tag.remove
 *   POST   /api/admin/owners/:id/notes              OPERATOR  { text }: 201 the note          account.note.add
 *   DELETE /api/admin/owners/:id/notes/:noteId      OPERATOR  204; its writer or an ADMIN     account.note.remove
 *
 * The sheet itself (GET /api/admin/owners/:id) carries the tags and the 50 newest notes (routes/admin/owners.ts). A
 * DELETED account is never written (409 ACCOUNT_DELETED), a LOCKED one is. Reads need AUDITOR and writes OPERATOR, the
 * scope's guard (routes/admin/index.ts), with the CSRF token and a same-origin request; every answer `no-store`, as every
 * API answer (http/security.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { emptyBody, noteBody, noteParams, ownerNotesQuery, ownerParams, parse, tagBody, tagParams } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

export const adminClientSheetRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { clientNotes } = ctx.services;

  app.get('/api/admin/tags', async () => ({ items: await clientNotes.suggestions() }));

  app.get('/api/admin/owners/:id/notes', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const { all } = parse(ownerNotesQuery, request.query);
    return clientNotes.notes(id, { all: all === true });
  });

  app.post('/api/admin/owners/:id/tags', async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(tagBody, request.body);
    const { tags, added } = await clientNotes.addTag(id, b.tag, adminActor(request));
    reply.code(added ? 201 : 200);
    return { tags };
  });

  app.delete('/api/admin/owners/:id/tags/:tag', async (request, reply) => {
    const { id, tag } = parse(tagParams, request.params);
    parse(emptyBody, request.body);
    await clientNotes.removeTag(id, tag, adminActor(request));
    return reply.code(204).send();
  });

  app.post('/api/admin/owners/:id/notes', async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(noteBody, request.body);
    const note = await clientNotes.addNote(id, b.text, adminActor(request));
    reply.code(201);
    return note;
  });

  app.delete('/api/admin/owners/:id/notes/:noteId', async (request, reply) => {
    const { id, noteId } = parse(noteParams, request.params);
    parse(emptyBody, request.body);
    await clientNotes.removeNote(id, noteId, adminActor(request));
    return reply.code(204).send();
  });
};
