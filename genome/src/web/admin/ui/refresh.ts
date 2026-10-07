/**
 * A part of a page read again every few seconds while it is on screen (plan TEST ENTRANTS: the server's status and a
 * release's test, every 2 s), as the Anomalies badge is every minute (ui/attention.ts): a hidden tab stops asking and
 * asks again as soon as it is shown; the next read is asked only once the last one has answered, so a slow server is
 * never sent a second request on top of the first (the moment it is strained is when it is watched).
 *
 * Its requests are made in the background: a 401 stops the refresh, and the admin's next action meets the ended
 * session. Every refresh running stops when the console moves elsewhere or signs out (`stopRefreshes`, main.ts).
 */
import { ApiError } from '../api.js';
import type { VisibilitySource } from './attention.js';

export interface RefreshOptions<T> {
  load: () => Promise<T>;
  apply: (value: T) => void;
  /** A read that failed (any but a 401): the last value stays; the caller may say it. */
  failed?: (e: unknown) => void;
  everyMs: number;
  /** Read at once (default); false when the caller has just read it. */
  immediate?: boolean;
  /** The element it fills: once off the page at a later read (a page drawn, then never shown), the refresh stops. */
  owner?: { readonly isConnected: boolean };
  doc?: VisibilitySource;
}

export interface Refresh {
  /** Read now (after an action), then every `everyMs` again. */
  now(): Promise<void>;
  stop(): void;
}

const running = new Set<Refresh>();

/** Stop every refresh running: the console moved elsewhere or signed out. */
export function stopRefreshes(): void {
  for (const r of [...running]) r.stop();
}

export function startRefresh<T>(o: RefreshOptions<T>): Refresh {
  const doc: VisibilitySource = o.doc ?? document;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let seq = 0;

  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    if (!stopped && !doc.hidden) timer = setTimeout(() => (o.owner && !o.owner.isConnected ? stop() : void read()), o.everyMs);
  };
  const read = async (): Promise<void> => {
    if (stopped) return;
    disarm();
    const mine = ++seq;
    try {
      const v = await o.load();
      if (!stopped && mine === seq) o.apply(v);
    } catch (e) {
      if (stopped) return;
      if (e instanceof ApiError && e.status === 401) return stop();
      if (mine === seq) o.failed?.(e);
    }
    // Only the latest read schedules the next.
    if (mine === seq) arm();
  };
  const onVisibility = () => {
    if (doc.hidden) return disarm();
    if (o.owner && !o.owner.isConnected) return stop();
    void read();
  };
  const stop = () => {
    stopped = true;
    disarm();
    doc.removeEventListener('visibilitychange', onVisibility);
    running.delete(handle);
  };
  const handle: Refresh = { now: read, stop };

  running.add(handle);
  doc.addEventListener('visibilitychange', onVisibility);
  if (o.immediate !== false) void read();
  else arm();
  return handle;
}
