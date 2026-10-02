/**
 * What every console view receives. Views are async functions returning
 * their root element; main.ts mounts it and discards stale renders.
 */
import type { AdminApi } from '../api.js';
import type { Route } from '../router.js';
import type { AdminSession } from '../types.js';

export interface ViewContext {
  api: AdminApi;
  session: AdminSession;
  route: Route;
  now: () => Date;
  /** Go to a hash (`#/products/…`). */
  navigate(hash: string): void;
  /** Re-render the current route, e.g. after a mutation. */
  reload(): void;
  /** Merge query values into the current route (empty values removed) and navigate. */
  setQuery(q: Record<string, string | number | undefined | null>): void;
  /** The count of OPEN HIGH + CRITICAL findings a view has just read (Anomalies): the badge and the title show it. */
  attention(count: number): void;
}

export type View = (ctx: ViewContext) => Promise<HTMLElement>;

/** Positive page number from the route query (default 1). */
export function pageParam(ctx: ViewContext): number {
  const n = Number(ctx.route.query.page);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
