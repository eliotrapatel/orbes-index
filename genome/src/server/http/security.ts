/**
 * Security headers (contract §3, SECURITY-MODEL §3.5).
 *
 * @fastify/helmet supplies the standard set (nosniff, frame denial, COOP,
 * CORP, HSTS in production, no-referrer, X-Powered-By removal). The CSP is
 * written verbatim from the contract instead of through helmet, whose
 * serialiser joins directives without the space the contract string has.
 *
 * API responses are `Cache-Control: no-store` unless a route chose
 * otherwise: they can carry session-bound data (CSRF tokens, ownership).
 */
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
  "worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const PERMISSIONS_POLICY = 'camera=(self)';

/** HSTS lifetime in production: two years, subdomains included (preload is an operator decision). */
export const HSTS_MAX_AGE_S = 63_072_000;

export async function registerSecurity(app: FastifyInstance, config: Pick<AppConfig, 'env'>): Promise<void> {
  const production = config.env === 'production';
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false, // set verbatim below
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: production ? { maxAge: HSTS_MAX_AGE_S, includeSubDomains: true } : false,
    xPoweredBy: true,
  } as Parameters<typeof helmet>[1]);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('permissions-policy', PERMISSIONS_POLICY);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.removeHeader('x-powered-by');
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}
