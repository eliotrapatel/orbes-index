/**
 * Static web apps (contract §3 "Static web"), served from the esbuild output
 * of scripts/build-web.ts:
 *
 *   /                → 302 /verify
 *   /verify, /verify/*  → dist/web/verify/index.html   (client-side routes: /verify/pieces is MY PIECES,
 *                                                     /verify/c#… an ownership certificate, its token in the fragment)
 *   /admin,  /admin/*   → dist/web/admin/index.html
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

/** esbuild's default `[name]-[hash]` naming: an 8+ character base32-ish hash before the extension. */
export const HASHED_ASSET_RE = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE = 'no-cache';

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

  const page = (app: 'verify' | 'admin') => {
    const root = join(dir, app);
    return async (_request: FastifyRequest, reply: FastifyReply) => {
      // Checked per request: a build that lands after startup is picked up without a restart.
      if (!existsSync(join(root, 'index.html'))) return reply.callNotFound();
      reply.header('cache-control', REVALIDATE_CACHE);
      return reply.sendFile('index.html', root, { cacheControl: false });
    };
  };
  const verify = page('verify');
  const admin = page('admin');
  app.get('/', async (_request, reply) => reply.redirect('/verify', 302));
  app.get('/verify', verify);
  app.get('/verify/*', verify);
  app.get('/admin', admin);
  app.get('/admin/*', admin);
  return true;
}
