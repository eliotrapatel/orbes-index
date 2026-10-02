/**
 * Refresh of the Anomalies badge: one summary request at once, then one a
 * minute while the tab is visible. A hidden tab stops asking and asks again
 * as soon as it is shown. A failed request keeps the last count (a 401 has
 * already ended the session through the API client); only the latest answer
 * is applied, so a slow one never overwrites a newer count.
 */

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
  intervalMs?: number;
  doc?: VisibilitySource;
}

export interface AttentionPoll {
  /** Ask now (after a navigation or a decision). */
  refresh(): Promise<void>;
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
    } catch {
      /* keep the last count */
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

  doc.addEventListener('visibilitychange', onVisibility);
  void refresh();
  arm();
  return {
    refresh,
    stop() {
      stopped = true;
      disarm();
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
