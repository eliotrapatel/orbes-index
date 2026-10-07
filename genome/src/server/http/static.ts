/**
 * Static web apps (contract §3 "Static web"), served from the esbuild output
 * of scripts/build-web.ts:
 *
 *   /                → 302 /verify
 *   /verify, /verify/*  → dist/web/verify/index.html   (client-side routes: /verify/pieces is MY PIECES,
 *                                                     /verify/c#… an ownership certificate, its token in the fragment,
 *                                                     /verify/lookbook THE COLLECTION and /verify/lookbook/<slug> a
 *                                                     model's sheet, P-R02; /verify/releases and a release's page,
 *                                                     P-R03; /verify/circle THE CIRCLE and /verify/circle/<id> a
 *                                                     post, P-X01; /verify/club THE CLUB, BP-19;
 *                                                     /verify/releases/how HOW RELEASES WORK, FT-01;
 *                                                     /verify/releases/<id>/board#… a LIVE RELEASE's
 *                                                     boutique board, its secret in the fragment, never indexed)
 *   /VERIFY/C and any other spelling of /verify/c → 301 /verify/c   (the certificate's PDF letters it in capitals)
 *   /admin,  /admin/*   → dist/web/admin/index.html
 *   /legal,  /legal/*   → dist/web/legal/index.html    (the legal pages, J-06: /legal/privacy, /legal/terms,
 *                                                     /legal/notice, /legal/faq; /legal is their index)
 *   /assets/*        → dist/web/assets/*
 *
 * Caching: content-hashed assets (`name-HASH.ext`) are immutable for a year;
 * everything else, HTML included, is `no-cache` (revalidated with ETag) so a
 * deploy is picked up on the next load. Dotfiles are never served.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CERTIFICATE_PATH } from '../services/ownership-certificates.js';

/** esbuild's default `[name]-[hash]` naming: an 8+ character base32-ish hash before the extension. */
export const HASHED_ASSET_RE = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE = 'no-cache';

/** Any spelling of it: `/VERIFY/C`, as the certificate's PDF letters it, `/Verify/c/`… */
const CERTIFICATE_ADDRESS_RE = /^\/verify\/c\/?$/i;

/** A LIVE RELEASE's boutique board (plan of 2026-10-04, choice 31): unlisted, its page never indexed nor followed. */
export const BOARD_ADDRESS_RE = /^\/verify\/releases\/[^/?#]+\/board\/?$/i;
export const NOINDEX = 'noindex, nofollow';

export function cacheControlFor(path: string): string {
  return HASHED_ASSET_RE.test(basename(path)) ? IMMUTABLE_CACHE : REVALIDATE_CACHE;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Register the web routes when `dir` (dist/web) exists. Returns whether anything was registered. */
export async function registerStatic(app: FastifyInstance, dir: string): Promise<boolean> {
  if (!isDir(dir)) {
    app.log.info({ dir }, 'web build not found: static routes disabled');
    return false;
  }
  const assets = join(dir, 'assets');
  await app.register(fastifyStatic, {
    root: isDir(assets) ? assets : dir,
    prefix: '/assets/',
    // Without an assets directory nothing must leak from dist/web through /assets/.
    serve: isDir(assets),
    decorateReply: true,
    index: false,
    dotfiles: 'deny',
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders(reply, path) {
      reply.header('cache-control', cacheControlFor(path));
    },
  });

  const page = (app: 'verify' | 'admin' | 'legal') => {
    const root = join(dir, app);
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Checked per request: a build that lands after startup is picked up without a restart.
      if (!existsSync(join(root, 'index.html'))) return reply.callNotFound();
      reply.header('cache-control', REVALIDATE_CACHE);
      if (app === 'verify' && BOARD_ADDRESS_RE.test(request.url.split('?', 1)[0]!)) reply.header('x-robots-tag', NOINDEX);
      return reply.sendFile('index.html', root, { cacheControl: false });
    };
  };
  const verify = page('verify');
  const admin = page('admin');
  const legal = page('legal');
  // The ownership certificate's PDF letters its address in capitals (the stroked lettering has no lower case):
  // VERIFY.THEORBES.COM/VERIFY/C#… typed as printed reaches the certificate. Paths are case-sensitive, so any spelling
  // of /verify/c but the canonical one is sent there; the browser keeps the fragment (the token) across the redirect.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const path = request.url.split('?', 1)[0];
    if (path !== CERTIFICATE_PATH && path !== `${CERTIFICATE_PATH}/` && CERTIFICATE_ADDRESS_RE.test(path)) return reply.redirect(CERTIFICATE_PATH, 301);
  });
  app.get('/', async (_request, reply) => reply.redirect('/verify', 302));
  app.get('/verify', verify);
  app.get('/verify/*', verify);
  app.get('/admin', admin);
  app.get('/admin/*', admin);
  app.get('/legal', legal);
  app.get('/legal/*', legal);
  return true;
}
