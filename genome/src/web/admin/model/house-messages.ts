/**
 * The House messages page (plan MACRO M2 §1.6, scope D24 M1 and M2; views/house-messages.ts, ui/house-preview.ts) —
 * pure helpers, no DOM: the words, each moment's name and what triggers it, the switches and figures in words, the words
 * being written checked as the server checks them (services/house-moments.ts cleanHouseTitle / cleanHouseBody), a custom
 * message's audience, reach, status and times in words, the send dialog's Paris date and time, and the preview's item.
 *
 *  - MOMENTS: six automatic messages, each off until an ADMIN switches it on; from then on, nothing is sent for what
 *    happened before (the switch-on rule). An OPERATOR writes the words; an AUDITOR reads them.
 *  - MESSAGES: a custom message to a segment or a tier and above, written by an OPERATOR, sent now or scheduled in
 *    Paris by an ADMIN who types SEND; a scheduled one is rescheduled or cancelled until it goes; a sent one never changes.
 *  - Every time in Paris. Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { HOUSE_LINK_WORDS, renderHouseWords, unknownPlaceholders as unknownIn, type HousePlaceholder } from '../../../shared/house-words.js';
import { formatCount } from '../format.js';
import {
  CLUB_TIER_NAMES,
  HOUSE_BODY_MAX,
  HOUSE_MESSAGE_STATUSES,
  HOUSE_MOMENTS,
  HOUSE_TITLE_MAX,
  type AdminRole,
  type HouseAudience,
  type HouseLinkKind,
  type HouseMessage,
  type HouseMessageStatus,
  type HouseMoment,
  type HouseMomentView,
  type HousePlaceholderName,
} from '../types.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';
import type { Tone } from './tone.js';

export const HOUSE_COPY = Object.freeze({
  lead: 'What ORBES writes to collectors in MESSAGES, read-only and never answered there: six moments, each with its own switch and words, and the messages you write to a segment or a tier. No email and no notification is sent.',
  moments: 'Moments',
  messages: 'Messages',
  tabs: 'House messages',
  // MOMENTS
  momentsTitle: 'The moments',
  momentsNote: 'Each off until an ADMIN switches it on',
  switchOn: 'Switch on',
  switchOff: 'Switch off',
  switchOnTitle: 'Switch this moment on',
  noBackFill: 'From now on: nothing is sent for what happened before.',
  switchedOn: 'Switched on.',
  switchedOff: 'Switched off.',
  off: 'Not sent.',
  editWords: 'Edit the words',
  readWords: 'Read the words',
  defaultWords: 'Default words',
  edited: 'Edited',
  close: 'Close',
  title: 'Title',
  titleHint: `One line, at most ${HOUSE_TITLE_MAX} characters.`,
  body: 'Words',
  bodyHint: `Plain paragraphs apart by an empty line, at most ${formatCount(HOUSE_BODY_MAX)} characters. No link: a moment’s links are fixed by its kind.`,
  placeholders: 'Filled when it is delivered',
  placeholdersNote: 'Choose one to place it where the cursor is.',
  firstNameNote: '{firstName} reads as nothing for an account without a first name.',
  links: 'Its links',
  save: 'Save the words',
  saved: 'Words saved.',
  reset: 'Back to the default words',
  resetBody: 'The title and the words of this moment become ORBES’s default words again. The messages already delivered keep theirs.',
  resetDone: 'The default words are back.',
  unsaved: 'The words being written are not saved. Leaving the page loses them.',
  readOnly: 'An OPERATOR writes the words.',
  preview: 'Preview',
  previewNote: 'With example values, as the collector’s MESSAGES shows it.',
  previewFailed: 'The preview could not be drawn.',
  delivered: 'Delivered',
  read: 'Read',
  days30: '30 days',
  inAll: 'In all',
  // MESSAGES
  messagesTitle: 'The messages',
  newMessage: 'New message',
  empty: 'No message yet.',
  emptyFiltered: 'No message matches this status.',
  newTitle: 'New message',
  audience: 'Audience',
  aSegment: 'A segment',
  aTier: 'A tier',
  segment: 'Segment',
  tier: 'Tier',
  chooseSegment: 'Choose a segment',
  noSegments: 'No segment yet: make one on the Segments page.',
  segmentsPage: 'Segments',
  customHint: 'Plain paragraphs apart by an empty line. {firstName} is the only placeholder; no link.',
  saveDraft: 'Save',
  savedDraft: 'Saved.',
  created: 'Draft saved.',
  deleteDraft: 'Delete the draft',
  deleteBody: 'The draft is deleted. Nothing was sent.',
  deleted: 'Draft deleted.',
  send: 'Send…',
  reschedule: 'Reschedule…',
  cancel: 'Cancel the message',
  cancelBody: 'The message is not sent, and it stays in the list as cancelled.',
  cancelled: 'Cancelled: it will not be sent.',
  sendTitle: 'Send this message',
  rescheduleTitle: 'Reschedule this message',
  when: 'When',
  sendNow: 'Send now',
  schedule: 'Schedule',
  at: 'Date and time, Paris',
  atHint: 'Paris time. The message reaches MESSAGES within 30 seconds of it.',
  saveFirst: 'Save the message before sending it.',
  adminSends: 'An ADMIN sends it.',
  operatorWrites: 'An OPERATOR writes the messages.',
  readOnlyMessage: 'An OPERATOR writes the messages and an ADMIN sends them.',
  unsavedMessage: 'The message being written is not saved. Leaving the page loses it.',
  reachUnread: 'The reach could not be read.',
  reachCounting: 'Counting…',
  frozenNote: 'The audience is counted again when it goes, and frozen there.',
  sentFacts: 'As it went',
  // The preview
  dark: 'Dark',
  light: 'Light',
  phone: 'Phone',
  computer: 'Computer',
});

/** Each moment as the console names it: its name and what triggers it, in one line. */
export const HOUSE_MOMENT_INFO: Readonly<Record<HouseMoment, { name: string; when: string }>> = Object.freeze({
  FIRST_REGISTRATION: { name: 'First piece', when: 'The day after a first piece is registered: the care guide and YOUR SIZES.' },
  BIRTHDAY_CREDIT: { name: 'Birthday credit', when: 'The birthday credit opens.' },
  CREDIT_EXPIRING: { name: 'Credit ending', when: 'A credit with a balance left ends in 7 days.' },
  PRIVATE_CARE: { name: 'PRIVATE CARE', when: 'A collector reaches the tier PRIVATE CARE opens from, with a piece held.' },
  OWNERSHIP_YEAR: { name: 'One year', when: 'A piece has been its owner’s for one year.' },
  NINETY_DAYS: { name: '90 days away', when: 'Ninety days without a visit: no sign-in, session or scan.' },
});

export const momentName = (m: HouseMoment): string => HOUSE_MOMENT_INFO[m]?.name ?? m;

/** What each placeholder is filled with. */
export const HOUSE_PLACEHOLDER_WORDS: Readonly<Record<HousePlaceholderName, string>> = Object.freeze({
  firstName: 'The collector’s first name, nothing without one',
  piece: 'The piece’s model, as the app names it',
  amount: 'The credit’s balance, in its currency',
  expires: 'The day it ends, in Paris',
  tier: 'The tier PRIVATE CARE opens from',
});

/** A link's words, as the collector reads them (src/shared/house-words.ts). */
export const linkWords = (k: HouseLinkKind): string => HOUSE_LINK_WORDS[k];

// ── The address (`#/house-messages?tab=messages&message=new`) ────────────────────────────────────────────────────

export type HouseTab = 'moments' | 'messages';

export interface HouseParams {
  tab: HouseTab;
  /** The moment whose words are open, or null. */
  moment: HouseMoment | null;
  /** The custom message open: its id, `new`, or null. */
  message: string | null;
  /** The list's status filter. */
  status: HouseMessageStatus | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMoment = (v: string | undefined): v is HouseMoment => (HOUSE_MOMENTS as readonly string[]).includes(v ?? '');
const isStatus = (v: string | undefined): v is HouseMessageStatus => (HOUSE_MESSAGE_STATUSES as readonly string[]).includes(v ?? '');

/** The page's state from its address; anything unreadable is nothing. A message or a moment opens its own tab. */
export function houseParams(query: Readonly<Record<string, string | undefined>>): HouseParams {
  const message = query.message === 'new' || UUID.test(query.message ?? '') ? query.message!.toLowerCase() : null;
  const moment = isMoment(query.moment) ? query.moment : null;
  const tab: HouseTab = message ? 'messages' : moment ? 'moments' : query.tab === 'messages' ? 'messages' : 'moments';
  return { tab, moment: tab === 'moments' ? moment : null, message: tab === 'messages' ? message : null, status: isStatus(query.status) ? query.status : null };
}

export const HOUSE_PAGE_SIZE = 25;

// ── What the reader may do ───────────────────────────────────────────────────────────────────────────────────────

export interface HouseActions {
  /** Write a moment's words, write, save and delete a custom message, read its reach live (OPERATOR). */
  edit: boolean;
  /** Switch a moment on or off (ADMIN). */
  switch: boolean;
  /** Send now, schedule, reschedule, cancel (ADMIN). */
  send: boolean;
}

export function houseActions(role: AdminRole | null | undefined): HouseActions {
  return { edit: can(role, 'editHouseMessages'), switch: can(role, 'switchHouseMoments'), send: can(role, 'sendHouseMessages') };
}

// ── The moments ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A moment's switch in words: ON since when, or OFF. */
export function momentSwitch(m: Pick<HouseMomentView, 'enabled' | 'enabledAt'>): { text: string; tone: Tone; note: string } {
  if (!m.enabled) return { text: 'OFF', tone: 'muted', note: HOUSE_COPY.off };
  return { text: 'ON', tone: 'solid', note: `Since ${parisDateTime(m.enabledAt)}` };
}

/** Whose words a moment carries: the default ones, or which part is edited. */
export function momentWordsState(m: Pick<HouseMomentView, 'title' | 'body'>): string {
  if (m.title !== null && m.body !== null) return HOUSE_COPY.edited;
  if (m.title !== null) return `${HOUSE_COPY.edited}: title`;
  if (m.body !== null) return `${HOUSE_COPY.edited}: words`;
  return HOUSE_COPY.defaultWords;
}

/** The words a moment says now: the console's, else the default's. */
export function momentWords(m: Pick<HouseMomentView, 'title' | 'body' | 'defaults'>): { title: string; body: string } {
  return { title: m.title ?? m.defaults.title, body: m.body ?? m.defaults.body };
}

/** A share in words: `67 %`, `—` when nothing to share. */
export function shareText(read: number, of: number): string {
  if (!(of > 0)) return '—';
  return `${Math.round((read / of) * 100)} %`;
}

/** The figures of a moment, each `12 · 8 read · 67 %`: over 30 days and in all. */
export function momentFigures(f: HouseMomentView['figures']): { days30: string; all: string } {
  const line = (delivered: number, read: number) => (delivered === 0 ? 'None yet' : `${formatCount(delivered)} delivered · ${formatCount(read)} read · ${shareText(read, delivered)}`);
  return { days30: line(f.delivered30, f.read30), all: line(f.delivered, f.read) };
}

/** The switch dialog's words: what switching it on starts, and the no-back-fill sentence. */
export function switchOnBody(m: HouseMoment): string {
  const info = HOUSE_MOMENT_INFO[m];
  return `${info.name}: ${info.when.replace(/\.$/, '')}, ORBES writes this message in the collector’s MESSAGES. ${HOUSE_COPY.noBackFill}`;
}

// ── The words being written, checked as the server checks them ───────────────────────────────────────────────────

/** Words as a collector with no first name reads them (the server's cleanCustomTitle / cleanCustomBody). */
const withoutFirstName = (s: string): string => s.split('{firstName}').join('').trim();

/** What is wrong with a title being written, or null; `blankOk` for a moment (blank: the default's). */
export function titleProblem(title: string, blankOk = false): string | null {
  const s = title.trim();
  if (s === '') return blankOk ? null : 'Write a title.';
  // A custom message's {firstName} alone reads blank to a collector with no first name: the server refuses it.
  if (!blankOk && withoutFirstName(s) === '') return 'Write a title.';
  if (/[\r\n]/.test(s)) return 'One line.';
  if ([...s].length > HOUSE_TITLE_MAX) return `At most ${HOUSE_TITLE_MAX} characters.`;
  return null;
}

/** What is wrong with words being written, or null; `blankOk` for a moment (blank: the default's). */
export function bodyProblem(body: string, blankOk = false): string | null {
  const s = body.trim();
  if (s === '') return blankOk ? null : 'Write the message.';
  if (!blankOk && withoutFirstName(s) === '') return 'Write the message.';
  if ([...s].length > HOUSE_BODY_MAX) return `At most ${formatCount(HOUSE_BODY_MAX)} characters.`;
  return null;
}

/** The `{names}` written that these words may not hold: the server refuses them at saving (422 HOUSE_PLACEHOLDER). */
export function unknownPlaceholders(words: { title: string; body: string }, allowed: readonly HousePlaceholderName[]): string[] {
  return unknownIn(`${words.title}\n${words.body}`, allowed as readonly HousePlaceholder[]);
}

/** The line under the editor for those names, or null. */
export function unknownLine(names: readonly string[], allowed: readonly HousePlaceholderName[]): string | null {
  if (names.length === 0) return null;
  return `${names.join(', ')} cannot be used here. The words may hold ${allowed.map((p) => `{${p}}`).join(', ')}.`;
}

/** What PUT …/words is sent: each part changed, the default's words (or a blank) as null. */
export function momentWordsChange(m: Pick<HouseMomentView, 'title' | 'body' | 'defaults'>, draft: { title: string; body: string }): { title?: string | null; body?: string | null } {
  const now = momentWords(m);
  const out: { title?: string | null; body?: string | null } = {};
  const t = draft.title.trim();
  const b = draft.body.replace(/\r\n?/g, '\n').trim();
  if (draft.title !== now.title) out.title = t === '' || t === m.defaults.title ? null : t;
  if (draft.body !== now.body) out.body = b === '' || b === m.defaults.body ? null : b;
  return out;
}

export const isMomentDraftChanged = (m: Pick<HouseMomentView, 'title' | 'body' | 'defaults'>, draft: { title: string; body: string }): boolean => {
  const now = momentWords(m);
  return draft.title !== now.title || draft.body !== now.body;
};

// ── The custom messages ──────────────────────────────────────────────────────────────────────────────────────────

/** A tier's audience in words, as the server names it (services/house-messages.ts tierAudienceLabel). */
export function tierAudienceLabel(tier: 1 | 2 | 3): string {
  const name = CLUB_TIER_NAMES[tier - 1]!;
  return tier === CLUB_TIER_NAMES.length ? name : `${name} and above`;
}

/** The tier select's choices: TITANE and above, PLATINE and above, PALLADIUM. */
export const TIER_CHOICES: readonly { value: string; label: string }[] = Object.freeze(([1, 2, 3] as const).map((t) => ({ value: String(t), label: tierAudienceLabel(t) })));

/** The audience being chosen, or null while it is not one (no segment chosen). */
export interface AudienceDraft {
  kind: 'SEGMENT' | 'TIER';
  segmentId: string;
  tier: string;
}

export function audienceOf(d: AudienceDraft): HouseAudience | null {
  if (d.kind === 'SEGMENT') return UUID.test(d.segmentId) ? { segmentId: d.segmentId } : null;
  const t = Number(d.tier);
  return t === 1 || t === 2 || t === 3 ? { tier: t } : null;
}

/** The draft of a message's audience: as it is, or a tier by default (PLATINE and above) for a new one. */
export function audienceDraftOf(m: Pick<HouseMessage, 'audience'> | null): AudienceDraft {
  if (m?.audience.segmentId) return { kind: 'SEGMENT', segmentId: m.audience.segmentId, tier: '2' };
  if (m?.audience.tier) return { kind: 'TIER', segmentId: '', tier: String(m.audience.tier) };
  return { kind: 'TIER', segmentId: '', tier: '2' };
}

export const sameAudience = (a: HouseAudience | null, b: HouseAudience | null): boolean => (a?.segmentId ?? null) === (b?.segmentId ?? null) && (a?.tier ?? null) === (b?.tier ?? null);

/** The reach in words: `Reaches 1,204 collectors now.`, `Reaches 1 collector now.`, `Reaches nobody now.` */
export function reachText(n: number): string {
  if (n === 0) return 'Reaches nobody now.';
  return `Reaches ${formatCount(n)} ${n === 1 ? 'collector' : 'collectors'} now.`;
}

/** A custom message's status in words, and its tone. */
export function statusWords(s: HouseMessageStatus): string {
  return { DRAFT: 'Draft', SCHEDULED: 'Scheduled', SENT: 'Sent', CANCELLED: 'Cancelled' }[s];
}

export function statusTone(s: HouseMessageStatus): Tone {
  return ({ DRAFT: 'outline', SCHEDULED: 'solid', SENT: 'solid', CANCELLED: 'muted' } as const)[s];
}

/** The status filter's choices. */
export const STATUS_CHOICES = Object.freeze([{ value: '', label: 'Every status' }, ...HOUSE_MESSAGE_STATUSES.map((s) => ({ value: s, label: statusWords(s) }))]);

/** When a message went or goes, in Paris: `Goes 21 OCT 2026 · 18:00 Paris`, `Sent …`, `Cancelled …`, or its last change. */
export function statusWhen(m: Pick<HouseMessage, 'status' | 'sendAt' | 'sentAt' | 'cancelledAt' | 'updatedAt'>, now: Date): string {
  switch (m.status) {
    case 'DRAFT':
      return `Saved ${parisDateTime(m.updatedAt)}`;
    case 'SCHEDULED':
      return m.sendAt && new Date(m.sendAt).getTime() <= now.getTime() + 60_000 ? 'Goes within 30 seconds' : `Goes ${parisDateTime(m.sendAt)}`;
    case 'SENT':
      return `Sent ${parisDateTime(m.sentAt)}`;
    case 'CANCELLED':
      return `Cancelled ${parisDateTime(m.cancelledAt)}`;
  }
}

/** Reached and read in words: `1,204`, `806 · 67 %`; `—` before it went. */
export function reachedText(m: Pick<HouseMessage, 'status' | 'reach'>): string {
  return m.status === 'SENT' && m.reach !== null ? formatCount(m.reach) : '—';
}

export function readText(m: Pick<HouseMessage, 'status' | 'reach' | 'read' | 'shareRead'>): string {
  if (m.status !== 'SENT' || m.read === null) return '—';
  return `${formatCount(m.read)} · ${m.shareRead === null ? '—' : `${Math.round(m.shareRead * 100)} %`}`;
}

/** The count of the list under its table: `3 messages`, `1 message`. */
export function messagesLine(total: number, isFiltered: boolean): string {
  return `${formatCount(total)} ${total === 1 ? 'message' : 'messages'}${isFiltered ? (total === 1 ? ' matches the status' : ' match the status') : ''}`;
}

/** What the page offers for a message (the server checks again; this only hides what would be refused). */
export interface MessageOffer {
  /** Its words and audience may change. */
  editable: boolean;
  /** SEND… (a draft) or RESCHEDULE… (a scheduled one). */
  send: 'SEND' | 'RESCHEDULE' | null;
  cancel: boolean;
  remove: boolean;
}

export function messageOffer(m: Pick<HouseMessage, 'status'> | null, acts: HouseActions): MessageOffer {
  const status = m?.status ?? 'DRAFT';
  const open = status === 'DRAFT' || status === 'SCHEDULED';
  return {
    editable: open && acts.edit,
    send: m && acts.send ? (status === 'DRAFT' ? 'SEND' : status === 'SCHEDULED' ? 'RESCHEDULE' : null) : null,
    cancel: !!m && acts.send && status === 'SCHEDULED',
    remove: !!m && acts.edit && status === 'DRAFT',
  };
}

// ── The send dialog: a date and a time in Paris ──────────────────────────────────────────────────────────────────

const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function parisParts(d: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An instant as a `datetime-local` value read in Paris (`2026-10-21T18:00`); '' when absent or invalid. */
export function parisInputValue(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = parisParts(d);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/**
 * A `datetime-local` value read in Paris, as the instant it names (the server's services/schedule.ts parisLocalInstant):
 * when the clocks go back, the earlier of the two; a time that does not exist in Paris (the hour skipped in spring),
 * null; anything unreadable, null.
 */
export function parisLocalInstant(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asUtc)) return null;
  // Paris is UTC+1 or UTC+2: the earlier candidate that reads back as the value wins.
  for (const offset of [2, 1]) {
    const at = new Date(asUtc - offset * 3_600_000);
    const p = parisParts(at);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) return at;
  }
  return null;
}

/** The time a schedule starts from: the next full hour after one hour from now, in Paris. */
export function defaultScheduleValue(now: Date): string {
  const at = new Date(Math.ceil((now.getTime() + 3_600_000) / 3_600_000) * 3_600_000);
  return parisInputValue(at);
}

/** What is wrong with a date and time chosen to schedule, or null. */
export function scheduleProblem(value: string, now: Date): string | null {
  if (value.trim() === '') return 'Choose a date and a time.';
  const at = parisLocalInstant(value);
  if (!at) return 'This time does not exist in Paris: choose another.';
  if (at.getTime() + 60_000 <= now.getTime()) return 'Choose a time to come, in Paris.';
  if (at.getTime() - now.getTime() > 366 * 86_400_000) return 'A message is scheduled at most a year ahead.';
  return null;
}

/** The send dialog's line: to whom, how many now, when. */
export function sendLine(label: string, reach: number | null, when: { now: true } | { now: false; value: string }): string {
  const count = reach === null ? '' : ` ${reachText(reach)}`;
  const at = when.now ? 'It reaches their MESSAGES within 30 seconds.' : (() => {
    const i = parisLocalInstant(when.value);
    return i ? `It goes ${parisDateTime(i)}.` : '';
  })();
  // Only the sentences' own spaces are made single: a figure keeps its narrow group space.
  return [`To ${label}.${count}`, at, HOUSE_COPY.frozenNote].filter((x) => x !== '').join(' ');
}

/** The toast after sending: now, or when it goes. */
export function sentToast(m: Pick<HouseMessage, 'sendAt'>, now: Date): string {
  if (!m.sendAt || new Date(m.sendAt).getTime() <= now.getTime() + 60_000) return 'Sent: it reaches MESSAGES within 30 seconds.';
  return `Scheduled: it goes ${parisDateTime(m.sendAt)}.`;
}

// ── The preview's item (ui/house-preview.ts) ────────────────────────────────────────────────────────────────────

/** A house message as the collector's MESSAGES draws it: its author line, title, words and links. */
export interface HousePreviewItem {
  author: string;
  title: string;
  body: string;
  links: string[];
}

/** The first name a preview is written to (services/house-moments.ts HOUSE_SAMPLE_FIRST_NAME). */
export const SAMPLE_FIRST_NAME = 'Camille';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The author line, in Paris (the collector's own offset in the app): `ORBES · 21 OCT 2026 · 10:02`. */
export function authorLine(author: string, at: Date): string {
  const p = parisParts(at);
  return `${author} · ${p.d} ${MONTHS[p.mo - 1]} ${p.y} · ${pad(p.h)}:${pad(p.mi)}`;
}

/** A custom message as its collector reads it: {firstName} filled with the sample's, no link. */
export function customPreview(words: { title: string; body: string }, at: Date, author: string): HousePreviewItem {
  const values = { firstName: SAMPLE_FIRST_NAME };
  return {
    author: authorLine(author, at),
    title: renderHouseWords(words.title.trim(), values).replace(/\s+/g, ' ').trim(),
    body: renderHouseWords(words.body.replace(/\r\n?/g, '\n').trim(), values),
    links: [],
  };
}
