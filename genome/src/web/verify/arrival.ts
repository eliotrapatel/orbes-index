/**
 * Where the visit comes from (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.3 and A.9, step 4.7): the page load's
 * arrival, read once at the app's very first step (main.ts App.start, before the router's first replaceEntry) and handed
 * to the recording's queue (seen.ts), which sends it as `a` in the page load's first POST /api/v1/seen (API §8.14). The
 * server classifies it (services/acquisition.ts: a link, then the tags, then the site, else direct). Nothing is drawn and
 * no word is added: the collector sees nothing new.
 *
 *   readArrival  reads `o` (a console link's code, `/go/<code>` adds it) and the five `utm_` tags from the address, then
 *                removes exactly those six parameters with history.replaceState (the path, the other parameters and the
 *                #fragment kept as they are, so `/verify/c#…` and a board's secret are never touched): a collector who
 *                shares the page never carries the link's code, and a reload never counts again. `document.referrer`
 *                is read only on the tab's first load (the tab flag sessionStorage['orbes.arrived'], read and written in
 *                try/catch: without storage it is read each load and the server's one-visit-a-day rule absorbs the
 *                repeats), and never when it is this app's own address. Each value the server would drop is left out
 *                here: a path that is not the app's, a code that is not 3 to 32 letters, figures or dashes, a tag empty
 *                or over 100 printable characters once trimmed, a referrer over 500 characters or not an `http:`,
 *                `https:` or `android-app:` address. So the arrival stays within 2 KB.
 *   sendArrival  hands it to the queue once the first screen is drawn (requestIdleCallback, or a 1.5 s timer where the
 *                browser has none), once per page load, never on an in-app move; a prerendered page waits until it is
 *                shown (`prerenderingchange`). Every error is swallowed: it never delays, blocks or changes a screen.
 *
 * The recording is off in an automated browser (seen.ts): its arrival is then never sent. The tab flag is the lot's one
 * value written by script (§3.3 T.9). Location, document, storage and history are parameters, so it is tested with plain
 * stubs (test/web/verify-arrival.test.ts).
 */
import type { SeenArrival } from './seen-model.js';

/** The tab flag: set on the tab's first load, so the referring page is sent once per tab. */
export const ARRIVED_KEY = 'orbes.arrived';
/** The parameters read, then removed from the address. */
export const ARRIVAL_PARAMS = ['o', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
/** Where requestIdleCallback is missing: the arrival waits this long after the first screen. */
export const ARRIVAL_DELAY_MS = 1_500;

/** The app's addresses (the server's arrivalShape `path`). */
const PATH_RE = /^\/verify(\/[^?#]{0,200})?$/;
/** A console link's code (the server's `link`). */
const LINK_RE = /^[a-z0-9-]{3,32}$/i;
/** A tag once trimmed: 1 to 100 characters, none a control or format character. */
const TAG_RE = /^[^\p{C}]{1,100}$/u;
const REFERRER_MAX = 500;
const REFERRER_PROTOCOLS = ['http:', 'https:', 'android-app:'];
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

/** The parts of `location` read. */
export interface ArrivalLocation {
  pathname: string;
  search: string;
  hash: string;
  host: string;
}

/** The part of `document` read: the referring page. */
export interface ArrivalDocument {
  referrer: string;
}

/** The part of a Storage used for the tab flag (window.sessionStorage; a map in the tests). */
export interface ArrivalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The part of `history` used to take the six parameters out of the address. */
export interface ArrivalHistory {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

export interface ReadArrival {
  /** What is sent as `a`. */
  arrival: SeenArrival;
  /** The address once cleaned: the path, the other parameters and the fragment. */
  address: string;
}

/** This tab's session storage, or null where it cannot be reached (reading `sessionStorage` itself may throw). */
export function tabStorage(): ArrivalStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return null;
  }
};

/** A tag kept: trimmed, 1 to 100 printable characters; otherwise left out. */
const tagOf = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && TAG_RE.test(t) ? t : undefined;
};

/** The referring page, when it is another site's address the server keeps. */
function referrerOf(raw: string, ownHost: string): string | undefined {
  if (!raw || raw.length > REFERRER_MAX) return undefined;
  try {
    const url = new URL(raw);
    if (!REFERRER_PROTOCOLS.includes(url.protocol)) return undefined;
    if (url.host.toLowerCase() === ownHost.toLowerCase()) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/** Whether this is the tab's first load; the flag set for the next ones. Without storage, every load is a first. */
function firstLoadOfTab(storage: ArrivalStorage | null): boolean {
  if (!storage) return true;
  let first = true;
  try {
    first = storage.getItem(ARRIVED_KEY) !== '1';
  } catch {
    return true;
  }
  try {
    storage.setItem(ARRIVED_KEY, '1');
  } catch {
    // A full or refused storage: the flag is not kept, the next load sends the referrer again.
  }
  return first;
}

/**
 * The page load's arrival, and the address without `o` and the `utm_` tags (put back with `history.replaceState` when
 * any was there). Never thrown.
 */
export function readArrival(location: ArrivalLocation, document: ArrivalDocument, storage: ArrivalStorage | null, history: ArrivalHistory): ReadArrival {
  const arrival: SeenArrival = {};
  let address = '';
  try {
    const pathname = String(location.pathname ?? '');
    const hash = String(location.hash ?? '');
    const search = String(location.search ?? '').replace(/^\?/, '');
    if (PATH_RE.test(pathname)) arrival.path = pathname;

    // The six parameters, their first value each; every other part of the query kept byte for byte.
    const found: Partial<Record<(typeof ARRIVAL_PARAMS)[number], string>> = {};
    const kept: string[] = [];
    let removed = false;
    for (const part of search.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const key = decode(i < 0 ? part : part.slice(0, i));
      if (key !== null && (ARRIVAL_PARAMS as readonly string[]).includes(key)) {
        removed = true;
        const value = decode(i < 0 ? '' : part.slice(i + 1));
        const k = key as (typeof ARRIVAL_PARAMS)[number];
        if (found[k] === undefined && value !== null) found[k] = value;
      } else kept.push(part);
    }
    address = `${pathname}${kept.length ? `?${kept.join('&')}` : ''}${hash}`;

    const link = found.o?.trim();
    if (link && LINK_RE.test(link)) arrival.link = link.toLowerCase();
    const utm: NonNullable<SeenArrival['utm']> = {};
    for (const k of UTM_KEYS) {
      const v = tagOf(found[`utm_${k}`]);
      if (v !== undefined) utm[k] = v;
    }
    if (Object.keys(utm).length > 0) arrival.utm = utm;

    if (firstLoadOfTab(storage)) {
      const referrer = referrerOf(String(document.referrer ?? ''), String(location.host ?? ''));
      if (referrer !== undefined) arrival.referrer = referrer;
    }

    if (removed) {
      try {
        history.replaceState(history.state, '', address);
      } catch {
        // The address could not be rewritten: the arrival is still sent.
      }
    }
  } catch {
    // Never thrown: whatever was read is sent.
  }
  return { arrival, address };
}

/** Where the arrival waits for the first screen: the page's own timers and its prerendering. */
export interface ArrivalEnv {
  document: {
    readonly prerendering?: boolean;
    addEventListener(type: 'prerenderingchange', listener: () => void, options?: { once?: boolean }): void;
  };
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown;
  setTimeout: (callback: () => void, ms: number) => unknown;
}

/** What the arrival is handed to: the recording (seen.ts `seen`), which sends it in its first batch. */
export interface ArrivalTarget {
  arrive(a: SeenArrival): void;
}

/**
 * Hand the arrival over once the first screen is drawn (idle, or after ARRIVAL_DELAY_MS), after the prerender. Once per
 * call, and App.start calls it once per page load. Every error swallowed.
 */
export function sendArrival(target: ArrivalTarget, arrival: SeenArrival, env: ArrivalEnv): void {
  let handed = false;
  const hand = () => {
    if (handed) return;
    handed = true;
    try {
      target.arrive(arrival);
    } catch {
      // Never shown, never retried here: the queue keeps it through a refused send.
    }
  };
  const later = () => {
    try {
      if (typeof env.requestIdleCallback === 'function') env.requestIdleCallback(hand, { timeout: ARRIVAL_DELAY_MS });
      else env.setTimeout(hand, ARRIVAL_DELAY_MS);
    } catch {
      hand();
    }
  };
  try {
    if (env.document.prerendering === true) env.document.addEventListener('prerenderingchange', later, { once: true });
    else later();
  } catch {
    // No timer and no event: nothing is sent, nothing is shown.
  }
}
