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
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import type { AppContext } from './context.js';
import { ipHashOf } from './http/client.js';
import { errorBody, installErrorHandlers } from './http/errors.js';
import { registerRateLimits } from './http/rate-limit.js';
import { CONTENT_SECURITY_POLICY, registerSecurity } from './http/security.js';
import { registerStatic } from './http/static.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin/index.js';
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
  /** Refuse admin sessions that did not pass TOTP outside the auth routes. Default: production only. */
  requireAdminMfa?: boolean;
}

export async function buildApp(ctx: AppContext, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
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
    return503OnClosing: true,
    // URLs the router rejects (over-long parameter, broken percent-escape) never reach a hook or the
    // error handler: Fastify's default answer echoes the URL and its FST_ code, without our headers.
    frameworkErrors: (_error, _request, rawReply) => {
      const reply = rawReply as unknown as FastifyReply;
      reply
        .code(400)
        .header('content-security-policy', CONTENT_SECURITY_POLICY)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .type('application/json; charset=utf-8')
        .send(errorBody('BAD_REQUEST', 'The request URL is invalid.'));
    },
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
  const limiters = await registerRateLimits(app, config);

  const deps = { ctx, limiters };
  await app.register(publicRoutes, deps);
  await app.register(accountRoutes, deps);
  await app.register(ownershipRoutes, deps);
  await app.register(adminRoutes, { ...deps, requireMfa: opts.requireAdminMfa ?? config.env === 'production' });

  if (opts.serveStatic ?? true) await registerStatic(app, opts.staticDir ?? DEFAULT_STATIC_DIR);

  await app.ready();
  return app;
}
