/**
 * Hash routes of the console (`/admin#/products/O26-J-00184?page=2`).
 *
 * Hash routing keeps the server contract trivial (one HTML shell at /admin)
 * and never sends route state, such as search terms, to the server in the
 * request line. Pure: parse/build only; main.ts listens to `hashchange`.
 */

export const ROUTES = [
  { name: 'login', path: '/login' },
  { name: 'security', path: '/security' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'generator', path: '/generator' },
  { name: 'products', path: '/products' },
  { name: 'product', path: '/products/:productId' },
  { name: 'genomes', path: '/genomes' },
  { name: 'codes', path: '/codes' },
  { name: 'scans', path: '/scans' },
  { name: 'analytics', path: '/analytics' },
  { name: 'owners', path: '/owners' },
  { name: 'owner', path: '/owners/:accountId' },
  /** The Club (P-R03): its tabs (Drops) by `?tab=`; a drop's page from its row, no link of its own in the sidebar. */
  { name: 'club', path: '/club' },
  { name: 'drop', path: '/club/drops/:dropId' },
  { name: 'warranties', path: '/warranties' },
  { name: 'anomalies', path: '/anomalies' },
  { name: 'cases', path: '/cases' },
  { name: 'revocations', path: '/revocations' },
  { name: 'keys', path: '/keys' },
  { name: 'audit', path: '/audit' },
  { name: 'team', path: '/team' },
  { name: 'catalogue', path: '/catalogue' },
  /** A model's lookbook (P-R02): reached from the Catalogue's model row, no link of its own in the sidebar. */
  { name: 'model', path: '/catalogue/:modelId' },
  { name: 'retailers', path: '/retailers' },
  { name: 'sale', path: '/sale' },
  { name: 'documents', path: '/documents' },
  { name: 'document', path: '/documents/:docId' },
] as const;

export type RouteName = (typeof ROUTES)[number]['name'];

export interface Route {
  name: RouteName | 'not-found';
  params: Record<string, string>;
  query: Record<string, string>;
  /** The normalised hash path, e.g. `/products`. */
  path: string;
}

const MAX_HASH = 512;

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = safeDecode((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
    const v = safeDecode((i < 0 ? '' : part.slice(i + 1)).replace(/\+/g, ' '));
    // Plain keys only: a crafted link must not reach Object.prototype through route state.
    if (k === null || v === null || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k) || k in Object.prototype) continue;
    out[k] = v.slice(0, 200);
  }
  return out;
}

/** Parse `location.hash`. An empty hash is the dashboard. */
export function parseHash(hash: string): Route {
  let h = (hash ?? '').slice(0, MAX_HASH);
  if (h.startsWith('#')) h = h.slice(1);
  if (!h.startsWith('/')) h = `/${h}`;
  const q = h.indexOf('?');
  const rawPath = q < 0 ? h : h.slice(0, q);
  const query = q < 0 ? {} : parseQuery(h.slice(q + 1));
  const path = rawPath.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'dashboard', params: {}, query, path: '/dashboard' };

  const segs = path.split('/').slice(1);
  for (const r of ROUTES) {
    const pat = r.path.split('/').slice(1);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(':')) {
        const v = safeDecode(segs[i]);
        if (v === null || v === '') {
          ok = false;
          break;
        }
        params[pat[i].slice(1)] = v;
      } else if (pat[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: r.name, params, query, path };
  }
  return { name: 'not-found', params: {}, query, path };
}

/** Build `#/path?query` from a route name, params and query (empty values dropped). */
export function href(name: RouteName, params: Record<string, string> = {}, query: Record<string, string | number | undefined | null> = {}): string {
  const r = ROUTES.find((x) => x.name === name);
  if (!r) throw new Error(`unknown route ${name}`);
  const path = r.path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined || v === '') throw new Error(`missing route param ${k}`);
    return encodeURIComponent(v);
  });
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** Shorthand for product pages, the most linked route. */
export function productHref(productId: string): string {
  return href('product', { productId });
}
