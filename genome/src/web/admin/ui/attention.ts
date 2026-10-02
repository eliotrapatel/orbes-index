/**
 * Refresh of the Anomalies badge: one summary request at once (unless the
 * caller has just read the count), then one a minute while the tab is
 * visible. A hidden tab stops asking and asks again as soon as it is shown.
 * A failed request keeps the last count; only the latest answer is applied,
 * so a slow one never overwrites a newer count.
 *
 * The refresh runs on a timer, so it never ends the session itself: its
 * requests are made in the background (a 401 does not sign the admin out,
 * which would replace a page holding claim codes). A 401 stops the refresh
 * and tells the caller (`onEnded`); the admin's next action meets the
 * ended session.
 */
import { ApiError } from '../api.js';

export const ATTENTION_INTERVAL_MS = 60_000;

/** The part of `document` the refresh needs (a fake in tests). */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface AttentionPollOptions {
  /** The count to show (OPEN HIGH + CRITICAL findings). */
  load: () => Promise<number>;
  apply: (count: number) => void;
  /** The session ended (a request answered 401): the refresh has stopped. */
  onEnded?: () => void;
  /** Ask at once (default); false when the caller is reading the count itself (the Anomalies view). */
  immediate?: boolean;
  intervalMs?: number;
  doc?: VisibilitySource;
}

export interface AttentionPoll {
  /** Ask now (after a navigation or a decision). */
  refresh(): Promise<void>;
  /** A count read elsewhere (the Anomalies view's own summary): shown, and newer than any answer still on its way. */
  set(count: number): void;
  stop(): void;
}

export function startAttentionPoll(o: AttentionPollOptions): AttentionPoll {
  const doc: VisibilitySource = o.doc ?? document;
  const every = o.intervalMs ?? ATTENTION_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let seq = 0;

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    const mine = ++seq;
    try {
      const n = await o.load();
      if (!stopped && mine === seq) o.apply(n);
    } catch (e) {
      // The session ended: ask no more. Any other failure keeps the last count.
      if (!stopped && e instanceof ApiError && e.status === 401) {
        stop();
        o.onEnded?.();
      }
    }
  };
  const arm = () => {
    if (timer === null && !stopped && !doc.hidden) timer = setInterval(() => void refresh(), every);
  };
  const disarm = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (doc.hidden) return disarm();
    void refresh();
    arm();
  };
  const stop = () => {
    stopped = true;
    disarm();
    doc.removeEventListener('visibilitychange', onVisibility);
  };

  doc.addEventListener('visibilitychange', onVisibility);
  if (o.immediate !== false) void refresh();
  arm();
  return {
    refresh,
    set(count) {
      if (stopped) return;
      seq++;
      o.apply(count);
    },
    stop,
  };
}
