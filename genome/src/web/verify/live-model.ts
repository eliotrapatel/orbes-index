/**
 * The LIVE RELEASE as /verify shows it (plan of 2026-10-04, The experience): what the page of a release
 * (/verify/releases/<id>) shows as it becomes the room, the line, the turn, the piece secured and the reservation
 * confirmed, its edge pages, its card in THE RELEASES and its entries in MY PIECES. Pure (no DOM) and unit-tested.
 *
 *  - Which screen: from the release's page, the account's standing (signed out, outside the rule, allowed), the room and
 *    the account's entry, at the server's time (`liveScreen`). The size never changes after T0: the picker is only
 *    offered before it (and, after it, to an account that is not in the line yet, which joins behind).
 *  - The server's time: three round trips to /api/v1/live/clock, the offset of the shortest kept (`clockOffset`); every
 *    countdown counts on it, so the door opens on every phone at the same second.
 *  - A time is said in Paris, then on this phone when its zone says it otherwise; a price as the house writes it
 *    (`€ 4 800`); the countdowns in two-digit groups.
 *  - The lock: during the last minute each data orbit of the seal turns back to its place, a step a second, its
 *    direction alternating with its neighbour's, and all of them align at T0 (`lockAngle`); the last ten seconds tick.
 *
 * Nothing the server did not send: a picture is taken from this origin's media route only.
 */
import { LIVE, RELEASES } from './copy.js';
import { isReleaseId, releasePath, tierLabel, type EntryModel, type MyEntryModel } from './releases-model.js';
import type {
  ClientServices,
  LiveAccess,
  LiveAccountEntry,
  LiveBanner,
  LiveCard,
  LiveEndedSheet,
  LiveEntry,
  LiveInterest,
  LiveRoom,
  LiveRoomSize,
  LiveSheet,
} from './types.js';
import { releaseContactModel, upper } from './view-model.js';

const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The zone the release's times are said in first. */
export const PARIS = 'Europe/Paris';

/** The page of an ended release: nothing more than that it is over (the plan's choice 32). */
export function isEndedSheet(s: LiveSheet | LiveEndedSheet | null | undefined): s is LiveEndedSheet {
  return !!s && s.phase === 'ENDED';
}

/** A picture of this origin's media route, else null. */
export function mediaSrc(url: string | null | undefined): string | null {
  return typeof url === 'string' && MEDIA_SRC.test(url) ? url : null;
}

// ── Words and figures ──────────────────────────────────────────────────────

const SYMBOLS: Readonly<Record<string, string>> = Object.freeze({ EUR: '€', GBP: '£', USD: '$', CHF: 'CHF' });
const NBSP = ' ';

/** A price as the house writes it: `€ 4 800`, `€ 4 800.50`; the groups never break across lines. */
export function formatMoney(minor: number, currency: string): string {
  const value = Number.isFinite(minor) ? Math.max(0, Math.round(minor)) : 0;
  const units = Math.floor(value / 100);
  const cents = value % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  return `${SYMBOLS[code] ?? code}${NBSP}${grouped}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

/** A moment in a zone: `SUNDAY 11 OCTOBER`, `11 OCTOBER`, `19:00`, `19:00:00`. */
export interface ZonedTime {
  day: string;
  /** `11 OCTOBER` */
  date: string;
  time: string;
  clock: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedTime(at: string | number, timeZone: string): ZonedTime | null {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { day: `${parts.weekday} ${parts.day} ${parts.month}`.toUpperCase(), date: `${parts.day} ${parts.month}`.toUpperCase(), time: `${parts.hour}:${parts.minute}`, clock: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** A time of the release: in Paris, then on this phone when its zone says it otherwise (null when it says the same). */
export function releaseTime(at: string, localZone: string): { paris: string; local: string | null } {
  const paris = zonedTime(at, PARIS);
  if (!paris) return { paris: '', local: null };
  const local = zonedTime(at, localZone);
  const same = !local || (local.day === paris.day && local.time === paris.time);
  return { paris: LIVE.paris(paris.day, paris.time), local: same ? null : LIVE.onThisPhone(local.day, local.time) };
}

/** A countdown in two-digit groups: DAYS HOURS MINUTES a day or more ahead, HOURS MINUTES SECONDS within a day. */
export function countdown(ms: number): { value: string; unit: string }[] {
  const left = Math.max(0, Math.ceil(ms / SECOND) * SECOND);
  const two = (n: number) => String(n).padStart(2, '0');
  const u = LIVE.units;
  if (left >= DAY) {
    return [
      { value: two(Math.floor(left / DAY)), unit: u.days },
      { value: two(Math.floor((left % DAY) / HOUR)), unit: u.hours },
      { value: two(Math.floor((left % HOUR) / MINUTE)), unit: u.minutes },
    ];
  }
  return [
    { value: two(Math.floor(left / HOUR)), unit: u.hours },
    { value: two(Math.floor((left % HOUR) / MINUTE)), unit: u.minutes },
    { value: two(Math.floor((left % MINUTE) / SECOND)), unit: u.seconds },
  ];
}

/** A short countdown: `04:59`, `1:04:59` from an hour; the seconds rounded up, so 0:00 is the moment itself. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / SECOND));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** The reference of a LIVE RELEASE entry for ORBES Client Services: `LR-` and the first eight figures of its id. */
export function liveReference(entryId: string): string {
  return `LR-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// ── The server's time ──────────────────────────────────────────────────────

/** One round trip of the clock sync: when it left and came back on this device's clock, and the server's time. */
export interface ClockSample {
  sentAt: number;
  receivedAt: number;
  server: number;
}

/** The round trips of a sync. */
export const CLOCK_SAMPLES = 3;

/**
 * How far the server's clock is ahead of this device's (ms), from the shortest round trip: the server read its clock
 * about half-way through it. Null without a usable sample.
 */
export function clockOffset(samples: readonly ClockSample[]): { offset: number; rtt: number } | null {
  let best: { offset: number; rtt: number } | null = null;
  for (const s of samples) {
    const rtt = s.receivedAt - s.sentAt;
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(s.server)) continue;
    if (!best || rtt < best.rtt) best = { offset: Math.round(s.server - (s.sentAt + rtt / 2)), rtt };
  }
  return best;
}

/**
 * The server's clock against this device's, measured by `samples` round trips to `read` (its time, ISO 8601): the
 * offset of the shortest (clockOffset); null when none comes back. The banner, THE RELEASES and the boutique board use
 * it (the release's page keeps its own three, with its READY CHECK).
 */
export async function measureClock(read: () => Promise<string>, samples = CLOCK_SAMPLES): Promise<{ offset: number; rtt: number } | null> {
  const got: ClockSample[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const sentAt = Date.now();
      const server = Date.parse(await read());
      got.push({ sentAt, receivedAt: Date.now(), server });
    } catch {
      break;
    }
  }
  return clockOffset(got);
}

// ── Which screen ───────────────────────────────────────────────────────────

/** The account as the release's room sees it. */
export type LiveViewer = 'unknown' | 'signed-out' | 'not-eligible' | 'ready';

export type LiveScreenKind =
  | 'loading'
  | 'announced'
  | 'signin'
  | 'notEligible'
  | 'room'
  | 'join'
  | 'line'
  | 'soldOut'
  | 'turn'
  | 'secured'
  | 'confirmed'
  | 'missed'
  | 'expired'
  | 'released'
  | 'left'
  | 'removed'
  | 'ended'
  | 'over';

export interface LiveScreenInput {
  sheet: LiveSheet | LiveEndedSheet;
  viewer: LiveViewer;
  room: LiveRoom | null;
  entry: LiveEntry | null;
  /** The server's time (ms). */
  now: number;
}

/** Where the release stands at the server's time `now`: its own phase once it has ended (sold out, ended by ORBES). */
export function phaseAt(sheet: LiveSheet, room: LiveRoom | null, now: number): 'ANNOUNCED' | 'ROOM' | 'LIVE' | 'ENDED' {
  if (room?.phase === 'ENDED') return 'ENDED';
  const times = room ?? sheet;
  if (now >= Date.parse(times.closesAt)) return 'ENDED';
  if (now >= Date.parse(times.opensAt)) return 'LIVE';
  if (now >= Date.parse(times.roomOpensAt)) return 'ROOM';
  return 'ANNOUNCED';
}

/** An entry that holds the account in the release (a LEFT one before T0 does not: it may enter again). */
export function heldEntry(entry: LiveEntry | null): LiveEntry | null {
  return entry && !(entry.status === 'LEFT' && entry.position === null) ? entry : null;
}

/** A size of the room, by id. */
export function roomSize(room: LiveRoom | null, sizeId: string | undefined): LiveRoomSize | null {
  return room?.sizes.find((s) => s.id === sizeId) ?? null;
}

/** The screen of the release's page now. */
export function liveScreen(i: LiveScreenInput): LiveScreenKind {
  const entry = i.viewer === 'ready' ? heldEntry(i.entry) : null;
  if (entry) {
    switch (entry.status) {
      case 'CONFIRMED':
        return 'confirmed';
      case 'SECURED':
        return 'secured';
      case 'TURN':
        return 'turn';
      case 'MISSED':
        return 'missed';
      case 'EXPIRED':
        return 'expired';
      case 'RELEASED':
        return 'released';
      case 'REMOVED':
        return 'removed';
      case 'ENDED':
        return 'ended';
      case 'LEFT':
        return 'left';
      case 'QUEUED': {
        // Sold out in its size: not enough pieces free nor held (which may return) to serve it.
        const left = servable(roomSize(i.room, entry.size.id));
        return left !== null && left < entry.quantity ? 'soldOut' : 'line';
      }
      case 'WAITING':
        return 'room';
    }
  }
  if (isEndedSheet(i.sheet)) return i.viewer === 'unknown' ? 'loading' : 'over';
  const phase = phaseAt(i.sheet, i.room, i.now);
  if (phase === 'ANNOUNCED') return 'announced';
  if (phase === 'ENDED') return 'over';
  switch (i.viewer) {
    case 'unknown':
      return 'loading';
    case 'signed-out':
      return 'signin';
    case 'not-eligible':
      return 'notEligible';
    default:
      return phase === 'ROOM' ? 'room' : 'join';
  }
}

// ── The room ───────────────────────────────────────────────────────────────

export interface ReadyCheck {
  label: string;
  value: string;
  ok: boolean;
}

/** READY CHECK: signed in · access · size · connection live · clock synced to ORBES. */
export function readyChecks(o: { access: LiveAccess | null; size: string | null; connection: 'live' | 'reconnecting'; synced: boolean }): ReadyCheck[] {
  const r = LIVE.ready;
  const tier = o.access?.tier ?? 0;
  return [
    { label: r.signedIn, value: '', ok: true },
    { label: r.access, value: o.access?.allowed ? (tier >= 1 ? tierLabel(tier) : r.granted) : '', ok: o.access?.allowed === true },
    { label: r.size, value: o.size ?? r.choose, ok: o.size !== null },
    { label: r.connection, value: o.connection === 'live' ? r.live : r.reconnecting, ok: o.connection === 'live' },
    { label: r.clock, value: o.synced ? r.synced : r.syncing, ok: o.synced },
  ];
}

/** A size of the picker. */
export interface SizeChoice {
  id: string;
  label: string;
  /** A piece of it can still be given: one not confirmed (free, or held in a turn or a hold that may return). */
  available: boolean;
  selected: boolean;
}

/**
 * The pieces of a size the line can still serve, as the server counts them when an account enters after T0: its stock
 * less what is confirmed (free, or held and possibly returning). Null without the room.
 */
export function servable(size: LiveRoomSize | null): number | null {
  return size ? size.left + size.held : null;
}

/** The sizes with stock, in order; `available` while the room says a piece of it can still be served. */
export function sizeChoices(sheet: LiveSheet, room: LiveRoom | null, selected: string | null): SizeChoice[] {
  return sheet.sizes
    .filter((s) => s.stock > 0)
    .map((s) => ({ id: s.id, label: s.label, available: (servable(roomSize(room, s.id)) ?? 1) >= 1, selected: s.id === selected }));
}

/**
 * The size preselected in the picker: the entry's, else the one said with I'LL BE THERE (when it is still offered), else
 * the only size of a one-size release; null otherwise (the collector picks one).
 */
export function initialSize(sheet: LiveSheet, entry: LiveEntry | null, interest: LiveInterest | null): string | null {
  const offered = sheet.sizes.filter((s) => s.stock > 0);
  const held = heldEntry(entry);
  if (held && offered.some((s) => s.id === held.size.id)) return held.size.id;
  if (interest && offered.some((s) => s.id === interest.size.id)) return interest.size.id;
  return offered.length === 1 ? offered[0]!.id : null;
}

/** The last minute: the lock's orbits turn back into alignment. */
export const LOCK_MS = 60 * SECOND;

/**
 * The angle of a data orbit of the lock (degrees) at `remainingMs` before T0: its scrambled offset until the last minute
 * (alternating in direction with its neighbours), then a step back each second, aligned (0) at T0.
 */
export function lockAngle(ring: number, remainingMs: number): number {
  const base = (ring % 2 === 0 ? 1 : -1) * (24 + ((ring * 47) % 113));
  if (remainingMs <= 0) return 0;
  if (remainingMs >= LOCK_MS) return base;
  return (base * Math.ceil(remainingMs / SECOND)) / (LOCK_MS / SECOND);
}

/** The second of the last ten that `remainingMs` falls in (10 … 1), when it does: each ticks once. */
export function tickSecond(remainingMs: number): number | null {
  const s = Math.ceil(remainingMs / SECOND);
  return remainingMs > 0 && s >= 1 && s <= 10 ? s : null;
}

// ── The line ───────────────────────────────────────────────────────────────

/** The pieces of the release as the line's meter draws them, one cell each (up to METER_CELLS), and its two lines. */
export interface LineFacts {
  /** `16 OF 25 LEFT · 4 IN SIZE 52` */
  left: string;
  /** `2 HELD PIECES MAY RETURN`, or null when none is held. */
  held: string | null;
  /** One per piece, in order: confirmed, held, then free; null above METER_CELLS pieces (a bar then). */
  cells: ('gone' | 'held' | 'free')[] | null;
  /** The share of the pieces taken (confirmed or held), for the bar. */
  taken: number;
}

export const METER_CELLS = 50;

export function lineFacts(room: LiveRoom, sizeId: string, sizeLabel: string): LineFacts {
  const size = roomSize(room, sizeId);
  const gone = Math.max(0, room.quantity - room.left - room.held);
  const left = LIVE.left(room.left, room.quantity);
  return {
    left: size ? `${left} · ${LIVE.inSize(size.left, sizeLabel)}` : left,
    held: room.held > 0 ? LIVE.held(room.held) : null,
    cells: room.quantity > 0 && room.quantity <= METER_CELLS ? Array.from({ length: room.quantity }, (_, i) => (i < gone ? 'gone' : i < gone + room.held ? 'held' : 'free')) : null,
    taken: room.quantity > 0 ? Math.min(1, (gone + room.held) / room.quantity) : 0,
  };
}

/** What the page says aloud of the account's place. */
export function placeAnnouncement(entry: LiveEntry): string | null {
  if (entry.status !== 'QUEUED' || entry.position === null) return null;
  return LIVE.announce.place(entry.position, entry.ahead ?? 0, entry.size.label);
}

export function aheadLine(entry: LiveEntry): string {
  return LIVE.ahead(entry.ahead ?? 0, entry.size.label);
}

// ── The turn and the hold ──────────────────────────────────────────────────

/** The seal held this long fills its ring (the server asks for 1.4 s between the press and the secure). */
export const HOLD_MS = 1500;
/** The secure is sent at least this long after the press was answered, so the server's clock has seen 1.4 s pass. */
export const PRESS_GAP_MS = 1420;

/** A deadline at the server's time `now`: what is left of it, and its share of the whole window. */
export function windowLeft(from: string, until: string, now: number): { remainingMs: number; fraction: number } {
  const start = Date.parse(from);
  const end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { remainingMs: 0, fraction: 0 };
  const remainingMs = Math.max(0, end - now);
  const total = Math.max(1, end - start);
  return { remainingMs, fraction: Math.min(1, remainingMs / total) };
}

/** An add-on as the piece held offers it. */
export interface AddonChoice {
  id: string;
  label: string;
  line: string | null;
  price: string;
  selected: boolean;
}

export function addonChoices(sheet: LiveSheet, entry: LiveEntry): AddonChoice[] {
  const chosen = new Set(entry.addons.map((a) => a.id));
  return sheet.addons.map((a) => {
    const own = entry.addons.find((x) => x.id === a.id);
    return { id: a.id, label: upper(a.label), line: a.line && a.line.trim() ? a.line.trim() : null, price: LIVE.addonPrice(formatMoney(own?.priceMinor ?? a.priceMinor, entry.currency)), selected: chosen.has(a.id) };
  });
}

// ── The release's page, announced ──────────────────────────────────────────

/** The picture of a release: its photograph, else its silhouette, else none (the seal stands in). */
export interface LivePicture {
  src: string;
  alt: string;
  kind: 'photo' | 'silhouette';
}

export function pictureOf(c: Pick<LiveCard, 'imageUrl' | 'silhouetteUrl' | 'name'>): LivePicture | null {
  const name = c.name ? upper(c.name) : LIVE.kind;
  const photo = mediaSrc(c.imageUrl);
  if (photo) return { src: photo, alt: RELEASES.photosLabel(name), kind: 'photo' };
  const silhouette = mediaSrc(c.silhouetteUrl);
  return silhouette ? { src: silhouette, alt: `The silhouette of ${name}`, kind: 'silhouette' } : null;
}

/** The price and the quantity line: `€ 5 050 · 25 PIECES`. */
export function offerLine(r: Pick<LiveCard, 'priceMinor' | 'currency' | 'quantityLine'>): string {
  return [formatMoney(r.priceMinor, r.currency), upper(r.quantityLine)].filter((x) => x.length > 0).join(' · ');
}

export interface LiveSheetModel {
  id: string;
  /** The model's name once revealed, else TO BE REVEALED. */
  name: string;
  named: boolean;
  /** `RING · ORBIT` once the name is revealed. */
  line: string | null;
  price: string;
  /** `€ 5 050 · 25 PIECES`: the price and the quantity line, as the room and the release's card say them. */
  offer: string;
  when: { paris: string; local: string | null };
  /** `FOR OWNERS FROM PLATINE` */
  access: string;
  /** `25 PIECES · ONE PER COLLECTOR` */
  quantity: string;
  roomOpens: string;
  rule: string;
  picture: LivePicture | null;
  calendarHref: string;
  description: string | null;
}

export function liveSheetModel(s: LiveSheet, localZone: string): LiveSheetModel {
  const name = s.name ? upper(s.name) : null;
  return {
    id: s.id,
    name: name ?? LIVE.unnamed,
    named: name !== null,
    line: name ? [upper(s.type), upper(s.collection)].filter((x) => x.length > 0).join(' · ') || null : null,
    price: formatMoney(s.priceMinor, s.currency),
    offer: offerLine(s),
    when: releaseTime(s.opensAt, localZone),
    access: LIVE.forWhom(s.access.text),
    quantity: [upper(s.quantityLine), LIVE.perAccount(s.perAccount)].filter((x) => x.length > 0).join(' · '),
    roomOpens: LIVE.roomOpens(s.roomOpensMinutes),
    rule: LIVE.rule(s.tierPriority),
    picture: pictureOf(s),
    calendarHref: `/api/v1/live/${encodeURIComponent(s.id)}/calendar.ics`,
    description: s.description && s.description.trim() ? s.description.trim() : null,
  };
}

// ── The calendar of the reveals, and I'LL BE THERE ─────────────────────────

/** A date of the calendar of the reveals: the stages it reveals (`THE NAME AND THE PHOTOGRAPH`), and when, in Paris. */
export interface RevealDate {
  label: string;
  when: string;
  at: string;
}

/**
 * The reveals still to come, in the server's order (only stages that will show something), those said at the same minute
 * said together; each time in Paris. Nothing the server did not send: never a stage, only its time.
 */
export function revealCalendar(c: Pick<LiveCard, 'reveals'>): RevealDate[] {
  const out: RevealDate[] = [];
  for (const r of Array.isArray(c.reveals) ? c.reveals : []) {
    const label = r ? LIVE.stage[r.stage] : undefined;
    const t = Date.parse(r?.at);
    if (!label || !Number.isFinite(t)) continue;
    const paris = zonedTime(t, PARIS)!;
    const when = LIVE.paris(paris.day, paris.time);
    const last = out[out.length - 1];
    if (last && last.when === when) last.label = LIVE.together(last.label, label);
    else out.push({ label, when, at: r.at });
  }
  return out;
}

/** I'LL BE THERE, counted: `428 COLLECTORS WILL BE THERE`; null before anyone has said so. */
export function interestLine(n: number): string | null {
  return Number.isInteger(n) && n > 0 ? LIVE.there.count(n) : null;
}

// ── THE RELEASES ───────────────────────────────────────────────────────────

/** A LIVE RELEASE in THE RELEASES: its vault plate among the ivory ones of the draws. */
export interface LiveCardModel {
  id: string;
  href: string;
  /** LIVE RELEASE, LIVE RELEASE · THE ROOM IS OPEN, LIVE RELEASE · LIVE NOW */
  kind: string;
  title: string;
  /** `SUNDAY 11 OCTOBER · 19:00 PARIS`, then on this phone when it differs. */
  when: { paris: string; local: string | null };
  /** `€ 4 800 · 25 PIECES · ONE PER COLLECTOR`: the price, the quantity line and the limit per collector. */
  line: string;
  access: string;
  picture: LivePicture | null;
  /** The calendar of the reveals still to come. */
  reveals: RevealDate[];
  /** `428 COLLECTORS WILL BE THERE`, or null. */
  interest: string | null;
}

export function liveCards(cards: readonly LiveCard[], localZone: string): LiveCardModel[] {
  return cards
    .filter((c) => c?.kind === 'LIVE' && isReleaseId(c.id) && (c.phase === 'ANNOUNCED' || c.phase === 'ROOM' || c.phase === 'LIVE'))
    .map((c) => ({
      id: c.id,
      href: releasePath(c.id),
      kind: c.phase === 'ANNOUNCED' ? LIVE.kind : `${LIVE.kind} · ${LIVE.phase[c.phase]}`,
      title: c.name ? upper(c.name) : LIVE.unnamed,
      when: releaseTime(c.opensAt, localZone),
      line: [offerLine(c), LIVE.perAccount(c.perAccount)].join(' · '),
      access: LIVE.forWhom(c.access.text),
      picture: pictureOf(c),
      reveals: revealCalendar(c),
      interest: interestLine(c.interest),
    }));
}

/** A moment the answer still holds ahead though this device's estimate of the server's clock has passed it: read again this soon. */
export const CHANGE_RETRY_MS = 4000;

/**
 * When THE RELEASES should read its LIVE half again, at the server's time `now` (ms) as this device estimates it: the
 * next of the moments that change a card (a stage, the room's opening, T0, the end); and, while a release's room is open
 * or it is live, within `watchMs`, since it may end before its time (sold out, or ended by ORBES) and then leaves the
 * list. A moment the answer still holds ahead (a reveal it lists, a phase it has not reached, its end) that `now` has
 * passed (an answer read just before it, or this device ahead of the server) is read again CHANGE_RETRY_MS later, never
 * dropped. Null when nothing is ahead.
 */
export function nextChange(
  cards: readonly Pick<LiveCard, 'phase' | 'reveals' | 'roomOpensAt' | 'opensAt' | 'closesAt'>[],
  now: number,
  watchMs: number,
): number | null {
  let next: number | null = null;
  const consider = (t: number) => {
    if (next === null || t < next) next = t;
  };
  for (const c of cards) {
    const room = Date.parse(c.roomOpensAt);
    if (c.phase === 'ROOM' || c.phase === 'LIVE' || (Number.isFinite(room) && now >= room)) consider(now + watchMs);
    const ahead = [
      ...(Array.isArray(c.reveals) ? c.reveals.map((r) => r.at) : []),
      c.phase === 'ANNOUNCED' ? c.roomOpensAt : null,
      c.phase === 'ANNOUNCED' || c.phase === 'ROOM' ? c.opensAt : null,
      c.closesAt,
    ];
    for (const at of ahead) {
      const t = typeof at === 'string' ? Date.parse(at) : NaN;
      if (Number.isFinite(t)) consider(t > now ? t : now + CHANGE_RETRY_MS);
    }
  }
  return next;
}

// ── The banner ─────────────────────────────────────────────────────────────

/** The banner of /verify and MY PIECES: LIVE RELEASE · <name once revealed> · OPENS IN hh:mm:ss / THE ROOM IS OPEN / LIVE NOW. */
export interface BannerModel {
  id: string;
  href: string;
  phase: 'ANNOUNCED' | 'ROOM' | 'LIVE';
  /** `LIVE RELEASE · MONOLITHE`, or `LIVE RELEASE` before the name. */
  lead: string;
  /** `OPENS IN`, `OPENS IN 3 DAYS`, `THE ROOM IS OPEN`, `LIVE NOW`. */
  state: string;
  /** Within a day of the opening: `02:14:09`; null otherwise. */
  clock: string | null;
}

/** The banner at the server's time `now` (ms), its phase from the release's own times; null once it has ended (hidden). */
export function bannerModel(b: LiveBanner | null, now: number): BannerModel | null {
  if (!b || !isReleaseId(b.id)) return null;
  const room = Date.parse(b.roomOpensAt);
  const opens = Date.parse(b.opensAt);
  const closes = Date.parse(b.closesAt);
  if (![room, opens, closes].every(Number.isFinite) || now >= closes) return null;
  const lead = b.name ? `${LIVE.kind} · ${upper(b.name)}` : LIVE.kind;
  const base = { id: b.id, href: releasePath(b.id), lead };
  if (now >= opens) return { ...base, phase: 'LIVE', state: LIVE.phase.LIVE, clock: null };
  if (now >= room) return { ...base, phase: 'ROOM', state: LIVE.phase.ROOM, clock: null };
  // OPENS IN counts to T0, as the release's page does; the room opens a few minutes before it. A day or more ahead it
  // says the days (OPENS IN 3 DAYS), as the page's countdown does, the plan's hh:mm:ss from the last day: hours past 24
  // would read as a number to work out, not a time.
  const left = opens - now;
  if (left >= DAY) return { ...base, phase: 'ANNOUNCED', state: LIVE.banner.days(Math.floor(left / DAY)), clock: null };
  const total = Math.ceil(left / SECOND);
  const two = (n: number) => String(n).padStart(2, '0');
  return { ...base, phase: 'ANNOUNCED', state: LIVE.opensIn, clock: `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}` };
}

// ── MY PIECES ──────────────────────────────────────────────────────────────

/** The account's entries in the LIVE RELEASES, as YOUR RELEASES lists them: its release, its status, what it means now. */
export function myLiveEntries(list: readonly LiveAccountEntry[], opts: { clientServices?: ClientServices }): MyEntryModel[] {
  return list
    .filter((x) => isReleaseId(x?.release?.id) && typeof x.entry?.status === 'string' && x.entry.status in LIVE.statusLabel)
    .map((x) => {
      const e = x.entry;
      const title = upper(x.release.title ?? x.release.name ?? '') || LIVE.kind;
      const label = LIVE.statusLabel[e.status];
      const reference = liveReference(e.id);
      const sentence = e.status === 'CONFIRMED' ? LIVE.sentence.CONFIRMED(e.size.label) : LIVE.sentence[e.status];
      const entry: EntryModel = {
        label,
        sentence,
        entryId: null,
        reference: e.status === 'CONFIRMED' || e.status === 'SECURED' ? LIVE.reference(reference) : null,
        canEnter: false,
        canWithdraw: false,
        canReserve: false,
        contact: e.status === 'CONFIRMED' ? releaseContactModel(opts.clientServices, title, reference, label) : null,
      };
      return { id: e.id, dropId: x.release.id, href: releasePath(x.release.id), title, stateLabel: LIVE.kind, entry };
    });
}
