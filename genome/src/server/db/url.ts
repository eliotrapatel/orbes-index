/**
 * DATABASE_URL parsing, shared by config validation and the connection factory.
 *
 * Accepted forms:
 *   postgres://user:pass@host:5432/db   (also postgresql://; unix sockets via ?host=/path)
 *   pglite:memory                        in-memory PGlite (dev, tests, demo)
 *   pglite:/absolute/data/dir            persistent PGlite on the local filesystem
 *
 * Error messages never echo the URL: it may carry a password.
 */
import { isAbsolute, normalize } from 'node:path';

export type DatabaseTarget =
  | { kind: 'postgres'; url: string }
  | { kind: 'pglite'; dataDir: null }       // in memory
  | { kind: 'pglite'; dataDir: string };    // absolute directory

export class DatabaseUrlError extends Error {
  override readonly name = 'DatabaseUrlError';
}

export function parseDatabaseUrl(url: string): DatabaseTarget {
  if (typeof url !== 'string' || url.trim() === '') throw new DatabaseUrlError('database URL is empty');
  const s = url.trim();

  if (s === 'pglite:memory') return { kind: 'pglite', dataDir: null };
  if (s.startsWith('pglite:')) {
    const dir = s.slice('pglite:'.length);
    if (!isAbsolute(dir)) {
      throw new DatabaseUrlError('pglite URL must be "pglite:memory" or "pglite:" followed by an absolute directory');
    }
    return { kind: 'pglite', dataDir: normalize(dir) };
  }

  if (/^postgres(ql)?:\/\//i.test(s)) {
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      throw new DatabaseUrlError('postgres URL is not a valid URL');
    }
    // An empty host is only meaningful for unix sockets, which pg reads from ?host=.
    if (parsed.hostname === '' && !parsed.searchParams.get('host')) {
      throw new DatabaseUrlError('postgres URL has no host');
    }
    return { kind: 'postgres', url: s };
  }

  throw new DatabaseUrlError('database URL must start with postgres://, postgresql:// or pglite:');
}

/** URL safe to log: the password (if any) is masked. */
export function redactDatabaseUrl(url: string): string {
  try {
    const t = parseDatabaseUrl(url);
    if (t.kind === 'pglite') return t.dataDir === null ? 'pglite:memory' : `pglite:${t.dataDir}`;
    const u = new URL(t.url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[invalid database url]';
  }
}
