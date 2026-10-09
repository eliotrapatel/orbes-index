/**
 * The client sheet's Profile, tags and private notes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.6.5, P.6.6, §3.6
 * C.4.2, C.4.3 and C.9, steps 5.3 and 5.4; API §16.36): what the client gave in YOUR PROFILE, which Client Services may
 * correct, and what Client Services keeps about the client, never shown to the client (services/client-notes.ts).
 *
 *   GET    /api/admin/owners/:id/profile            AUDITOR   what Edit the profile opens on: the Profile (withheld in
 *                                                             part for an AUDITOR) and the choices offered now, the
 *                                                             collection's pieces and finishes and the answers offered:
 *                                                             { profile, options }
 *   PUT    /api/admin/owners/:id/profile            OPERATOR  Edit the profile: the collector's body without the date of
 *                                                             birth, with the version read: { profile }
 *                                                             account.profile.update { by: 'staff', fields }
 *   PUT    /api/admin/owners/:id/birth-date         OPERATOR  Change the date of birth: { version, birthDate | null, why },
 *                                                             the reason kept as a private note: { profile }
 *                                                             account.profile.update { by: 'staff', fields, birthDate,
 *                                                             noteId } and account.note.add
 *   PUT    /api/admin/owners/:id/default-address    OPERATOR  Edit the address: the default address changed, or created
 *                                                             as the default: { profile }
 *                                                             account.address.update / .create { by: 'staff', … }
 *   GET    /api/admin/owners/:id/intelligence       AUDITOR   the Intelligence (step 5.7, services/owner-intelligence.ts):
 *                                                             { engagement: null until I2, origin, wishlist, browsing,
 *                                                             recordingSince }, each block `{ failed: true }` alone when
 *                                                             it cannot be read; the cities withheld for an AUDITOR
 *   GET    /api/admin/owners/:id/intelligence/models?page=   AUDITOR   « Show all » the models viewed, 50 a page
 *                                                             (§3.6 C.11): { items, total, page, pageSize }
 *   GET    /api/admin/tags                          AUDITOR   the tags in use, the most used first (50 at most), or
 *                                                             VIP, PRESS and FRIEND OF THE HOUSE while none is: { items }
 *   GET    /api/admin/owners/:id/notes?all=1        AUDITOR   every note not removed, the newest first: { items, total }
 *   POST   /api/admin/owners/:id/tags               OPERATOR  { tag }: 201 { tags }; 200 when the client carries it
 *                                                             already                         account.tag.add
 *   DELETE /api/admin/owners/:id/tags/:tag          OPERATOR  204                             account.tag.remove
 *   POST   /api/admin/owners/:id/notes              OPERATOR  { text }: 201 the note          account.note.add
 *   DELETE /api/admin/owners/:id/notes/:noteId      OPERATOR  204; its writer or an ADMIN     account.note.remove
 *
 * The sheet itself (GET /api/admin/owners/:id) carries the Profile, the tags and the 50 newest notes
 * (routes/admin/owners.ts). Each PUT answers the Profile as an OPERATOR reads it, in clear. A version other than the
 * profile's answers 409 PROFILE_CHANGED ('The client changed the profile meanwhile. It has been read again: check and
 * save.'). A DELETED account is never written (409 ACCOUNT_DELETED), a LOCKED one is. Reads need AUDITOR and writes
 * OPERATOR, the scope's guard (routes/admin/index.ts), with the CSRF token and a same-origin request; every answer
 * `no-store`, as every API answer (http/security.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { birthDateBody, defaultAddressBody, emptyBody, noteBody, noteParams, ownerNotesQuery, ownerParams, ownerProfileBody, parse, tagBody, tagParams, viewedModelsQuery } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { ownerIntelligence } from '../../services/owner-intelligence.js';
import type { AdminRouteDeps } from './index.js';
import { ownerProfile, readsClientEmails } from './serialize.js';

export const adminClientSheetRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { clientNotes, profiles, addresses, acquisition, wishlist, tracking } = ctx.services;

  // Edit the profile's dialog opens on the profile as it is now (its version) and the choices offered now; read again
  // after a 409 PROFILE_CHANGED. Step 5.5: the console's three dialogs.
  app.get('/api/admin/owners/:id/profile', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const profile = await profiles.forStaff(id, { inClear: true });
    const options = await profiles.options();
    return { profile: ownerProfile(profile, readsClientEmails(request)), options };
  });

  app.put('/api/admin/owners/:id/profile', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(ownerProfileBody, request.body);
    return { profile: await profiles.saveByStaff(id, b, adminActor(request)) };
  });

  app.put('/api/admin/owners/:id/birth-date', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(birthDateBody, request.body);
    return { profile: await profiles.setBirthDateByStaff(id, b, adminActor(request)) };
  });

  app.put('/api/admin/owners/:id/default-address', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(defaultAddressBody, request.body);
    const actor = adminActor(request);
    await addresses.setDefaultByStaff(id, b, actor);
    return { profile: await profiles.forStaff(id, { inClear: true }) };
  });

  // Step 5.7: the Intelligence, read after the sheet; one block failing marks only itself.
  app.get('/api/admin/owners/:id/intelligence', async (request) => {
    const { id } = parse(ownerParams, request.params);
    return ownerIntelligence({ db: ctx.db, acquisition, wishlist, tracking, warn: (detail, message) => request.log.warn(detail, message) }, id, { inClear: readsClientEmails(request) });
  });

  app.get('/api/admin/owners/:id/intelligence/models', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const { page } = parse(viewedModelsQuery, request.query);
    return tracking.viewedModels(id, page ?? 1);
  });

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
