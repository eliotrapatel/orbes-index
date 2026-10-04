/**
 * The Fastify application (contract §3): plugins, security, routes and the
 * static web apps, wired to an AppContext.
 *
 *   const app = await buildApp(ctx, { serveStatic: false });
 *   const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
 *
 * Request pipeline (onRequest, before any body is parsed):
 *   cookies → request state (hashed IP) → security headers → rate limit
 *   (per group) → session / CSRF / MFA / role guard (account & admin scopes).
 * Then: JSON body (≤ 16 KB, JSON only) → zod validation in the handler →
 * service call → `{ error: { code, message } }` on any failure.
 *
 * The LIVE RELEASES' streams (http/live-stream.ts) live in this app's hub
 * (`app.liveHub`), which the shutdown ends before the server closes.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { AppContext } from './context.js';
import { DomainError } from './errors.js';
import { ipHashOf } from './http/client.js';
import { errorBody, installErrorHandlers } from './http/errors.js';
import { LiveHub, type LiveHubOptions } from './http/live-stream.js';
import { registerRateLimits } from './http/rate-limit.js';
import { CONTENT_SECURITY_POLICY, registerSecurity } from './http/security.js';
import { registerStatic } from './http/static.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin/index.js';
import { clubRoutes } from './routes/club.js';
import { liveRoutes } from './routes/live.js';
import { ownershipRoutes } from './routes/ownership.js';
import { publicRoutes } from './routes/public.js';

/** Contract §3: request bodies are limited to 16 KB. */
export const BODY_LIMIT_BYTES = 16 * 1024;

/** dist/web next to src/ (genome/dist/web), where scripts/build-web.ts writes the web apps. */
export const DEFAULT_STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'web');

export interface BuildAppOptions {
  /** Serve the web apps from `staticDir` when it exists (default true). */
  serveStatic?: boolean;
  staticDir?: string;
  /** Fastify logger: pino options (see http/logging.ts loggerOptions) or false (default, silent). */
  logger?: FastifyServerOptions['logger'];
  /** Refuse admin sessions that did not pass TOTP outside the auth routes. Default: config.adminRequireMfa (ADMIN_REQUIRE_MFA). */
  requireAdminMfa?: boolean;
  /** The LIVE RELEASES' streams: their pulse, heartbeat, cache and per-account cap (tests). */
  liveHub?: LiveHubOptions;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The LIVE RELEASES' streams of this app (http/live-stream.ts). */
    liveHub: LiveHub;
  }
}

/**
 * URLs the router rejects (over-long parameter, broken percent-escape) never reach a hook or the
 * error handler: Fastify's default answer echoes the URL and its FST_ code, without our headers.
 * Typed against the plain HTTP/1.1 server this app runs on (the factory's generic option type
 * would otherwise be inferred against the HTTP/2 overloads).
 */
export const frameworkErrors: NonNullable<FastifyServerOptions<Server>['frameworkErrors']> = (_error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
  reply
    .code(400)
    .header('content-security-policy', CONTENT_SECURITY_POLICY)
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'no-store')
    .type('application/json; charset=utf-8')
    .send(errorBody('BAD_REQUEST', 'The request URL is invalid.'));
};

/** What a request gets while the server drains (SIGTERM): the standard error shape, not Fastify's own body. */
export const shuttingDown = () =>
  new DomainError('SERVICE_UNAVAILABLE', 503, 'The service is restarting. Please try again in a moment.');

export async function buildApp(ctx: AppContext, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify<Server>({
    logger: opts.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    // Request ids are ours: a client-supplied id could forge log correlation.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 128 },
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
    forceCloseConnections: 'idle',
    // Draining is answered by the gate below (standard error shape and security headers).
    return503OnClosing: false,
    frameworkErrors,
  });

  // JSON is the only body format the API speaks. Dropping text/plain also means a
  // cross-site "simple" POST can never reach a handler with a parsed body.
  app.removeContentTypeParser('text/plain');
  // Same secure parser (prototype/constructor poisoning → 400), but an EMPTY JSON body
  // reads as "no body", so clients that always send the header can call body-less routes.
  const json = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, payload, done) => {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    json(request, text, done);
  });
  installErrorHandlers(app);

  await app.register(cookie, { secret: config.cookieSecret, hook: 'onRequest' });
  app.decorateRequest('orbes', null as unknown as never);
  app.addHook('onRequest', async (request) => {
    request.orbes = { ipHash: ipHashOf(config.ipHashPepper, request) };
  });
  await registerSecurity(app, config);
  // Shutdown gate: once close() starts, requests still arriving on open keep-alive connections get
  // a 503 SERVICE_UNAVAILABLE (and Connection: close) instead of running against a closing database.
  let closing = false;
  const liveHub = new LiveHub({ room: ctx.services.liveRoom, clock: ctx.clock, log: ctx.log, ...opts.liveHub });
  app.decorate('liveHub', liveHub);
  app.addHook('preClose', async () => {
    closing = true;
    // Open streams are requests in progress: ended here, or the server would wait for them.
    liveHub.stop();
  });
  app.addHook('onRequest', async (_request, reply) => {
    if (!closing) return;
    reply.header('connection', 'close');
    throw shuttingDown();
  });
  const limiters = await registerRateLimits(app, config);

  const deps = { ctx, limiters };
  const requireAdminMfa = opts.requireAdminMfa ?? config.adminRequireMfa;
  await app.register(publicRoutes, { ...deps, requireAdminMfa });
  await app.register(accountRoutes, deps);
  await app.register(ownershipRoutes, deps);
  await app.register(clubRoutes, deps);
  await app.register(liveRoutes, { ...deps, hub: liveHub });
  await app.register(adminRoutes, { ...deps, requireMfa: requireAdminMfa });

  if (opts.serveStatic ?? true) await registerStatic(app, opts.staticDir ?? DEFAULT_STATIC_DIR);

  await app.ready();
  return app;
}
