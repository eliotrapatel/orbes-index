/**
 * TEST ENTRANTS in the console (the owner's lot of 2026-10-07; services/test-entrants.ts): a draw's page and a LIVE
 * RELEASE's page send test entrants, follow them and clean up after them; the Drops tab shows the test running.
 *
 *   POST /api/admin/drops/:id/test-runs                          ADMIN    SEND TEST ENTRANTS (phrase TEST <8>): 201
 *   POST /api/admin/test-runs/:id/add                            ADMIN    ADD MORE (the same phrase and body)
 *   POST /api/admin/test-runs/:id/stop                           ADMIN    STOP: the bots halt at once, nothing cleaned
 *   POST /api/admin/test-runs/:id/entrants/:accountId/confirm    ADMIN    CONFIRM a test entrant holding a place
 *   POST /api/admin/test-runs/:id/entrants/:accountId/release    ADMIN    RELEASE its held piece (a LIVE RELEASE only)
 *   POST /api/admin/test-runs/:id/end                            ADMIN    END TEST (phrase END TEST <8>): report, clean-up
 *   GET  /api/admin/drops/:id/test-runs/current                  AUDITOR  the release's newest test not ended, or null
 *   GET  /api/admin/drops/:id/test-runs                          AUDITOR  the release's tests, newest first
 *   GET  /api/admin/test-runs/active                             AUDITOR  the RUNNING test anywhere, or null
 *   POST /api/admin/test-runs/:id/purge                          ADMIN    PURGE (phrase PURGE TEST <8> + code): 202
 *   POST /api/admin/test-runs/purge-all                          ADMIN    PURGE ALL ENDED TESTS (PURGE ALL TESTS + code): 202
 *   GET  /api/admin/test-runs/ended                              AUDITOR  every ended test of every release, newest first
 *
 * Each change answers `{ run }`, the test as the current one reads it. An AUDITOR reads the test entrants' emails
 * masked, as every customer's (serialize.ts `clientEmail`). The service validates, locks and audits.
 *
 * TEST PURGE (lot PURGE, services/test-purge.ts; the owner's answers of 27 Oct 2026): the two purge routes draw on the
 * `auth` budget, as sign-in does (a code is guessed there), and carry the typed phrase and a fresh code of the
 * admin's authenticator app; no step-up token exists. TestPurgeService checks the phrase on the server, verifies the
 * step-up BEFORE its transaction (a wrong code is counted in its own commit) and consumes it INSIDE it, so a code is
 * used only by a request that commits. A PURGE on a PAUSED test resumes it; on one being purged it answers 409
 * PURGE_IN_PROGRESS. The answers are 202 (the purge goes on in the background, in bounded batches), or 400, 403, 404,
 * 409 and 429 with the console's words, Paris time first; never 401 for a wrong code (the console signs out on a
 * 401): only a session that ended answers 401.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { userAgentOf } from '../../http/client.js';
import { dropParams, emptyBody, parse, testRunBody, testRunEndBody, testRunEntrantParams, testRunParams, testRunPurgeAllBody, testRunPurgeBody } from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { TestEntrantService, TestRunSettingsInput, TestRunView } from '../../services/test-entrants.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The test entrants of this app (services/test-entrants.ts): its bots act through this app's routes. */
    testEntrants: TestEntrantService;
  }
}

function runJson(run: TestRunView, inClear: boolean) {
  return { ...run, selected: run.selected.map((s) => ({ ...s, email: clientEmail(s.email, inClear) })) };
}

/** A press's body as the service takes it: the groups sent, nothing else. */
function pressOf(b: z.infer<typeof testRunBody>): TestRunSettingsInput & { phrase: string } {
  return {
    phrase: b.phrase,
    tiers: b.tiers,
    ...(b.arrival ? { arrival: b.arrival } : {}),
    ...(b.behaviour ? { behaviour: b.behaviour } : {}),
    ...(b.choices ? { choices: b.choices } : {}),
    ...(b.profile ? { profile: b.profile } : {}),
  };
}

export const adminTestEntrantRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };
  const STEP_UP = { guard: { minRole: 'ADMIN' as const }, rateGroup: 'auth' as const };
  const tests = () => app.testEntrants;
  /** Who asks a purge: the ADMIN and the session the step-up checks; the hashed address for its audit rows (never the token). */
  const asking = (request: FastifyRequest) => ({
    asker: { actor: adminActor(request), token: requireAdmin(request).token },
    meta: { ipHash: request.orbes.ipHash, userAgent: userAgentOf(request) },
  });

  app.post('/api/admin/drops/:id/test-runs', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(dropParams, request.params);
    const b = parse(testRunBody, request.body);
    const run = await tests().start(id, pressOf(b), adminActor(request));
    reply.code(201);
    return { run: runJson(run, readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/:id/add', { config: ADMIN }, async (request) => {
    const { id } = parse(testRunParams, request.params);
    const b = parse(testRunBody, request.body);
    return { run: runJson(await tests().addMore(id, pressOf(b), adminActor(request)), readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/:id/stop', { config: ADMIN }, async (request) => {
    const { id } = parse(testRunParams, request.params);
    parse(emptyBody, request.body);
    return { run: runJson(await tests().stop(id, adminActor(request)), readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/:id/entrants/:accountId/confirm', { config: ADMIN }, async (request) => {
    const { id, accountId } = parse(testRunEntrantParams, request.params);
    parse(emptyBody, request.body);
    return { run: runJson(await tests().confirmEntrant(id, accountId, adminActor(request)), readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/:id/entrants/:accountId/release', { config: ADMIN }, async (request) => {
    const { id, accountId } = parse(testRunEntrantParams, request.params);
    parse(emptyBody, request.body);
    return { run: runJson(await tests().releaseEntrant(id, accountId, adminActor(request)), readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/:id/end', { config: ADMIN }, async (request) => {
    const { id } = parse(testRunParams, request.params);
    const { phrase } = parse(testRunEndBody, request.body);
    return { run: runJson(await tests().end(id, phrase, adminActor(request)), readsClientEmails(request)) };
  });

  app.get('/api/admin/drops/:id/test-runs/current', async (request) => {
    const { id } = parse(dropParams, request.params);
    const run = await tests().current(id);
    return { run: run ? runJson(run, readsClientEmails(request)) : null };
  });

  app.get('/api/admin/drops/:id/test-runs', async (request) => {
    const { id } = parse(dropParams, request.params);
    return { runs: await tests().list(id) };
  });

  app.get('/api/admin/test-runs/active', async () => ({ run: await tests().active() }));

  app.post('/api/admin/test-runs/:id/purge', { config: STEP_UP }, async (request, reply) => {
    const { id } = parse(testRunParams, request.params);
    const { phrase, totp } = parse(testRunPurgeBody, request.body);
    const { asker, meta } = asking(request);
    const { runId } = await ctx.services.testPurge.request(id, { phrase, totp }, asker, meta);
    reply.code(202);
    return { run: runJson(await tests().view(runId), readsClientEmails(request)) };
  });

  app.post('/api/admin/test-runs/purge-all', { config: STEP_UP }, async (request, reply) => {
    const { phrase, totp } = parse(testRunPurgeAllBody, request.body);
    const { asker, meta } = asking(request);
    const out = await ctx.services.testPurge.requestAll({ phrase, totp }, asker, meta);
    reply.code(202);
    return out;
  });

  app.get('/api/admin/test-runs/ended', async () => ({ runs: await tests().ended() }));
};
