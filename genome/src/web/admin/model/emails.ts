/**
 * The emails in the console (plan MACRO M1 §4.3, scope E0, E1 and F6; views/emails.ts and the Founding list's panel in
 * views/founding.ts) — pure helpers, no DOM: the words, each kind's name and moment, the channel and the switches in
 * words, the words being written checked as the server checks them, the outbox's rows in words (Paris), and the
 * founding announcement's panel: what may be sent now, what waits, the phrase it asks for.
 *
 *  - Every email is off until the server has a provider (EMAIL_TRANSPORT=smtp) and its kind is switched on here
 *    (ADMIN). A kind may be switched on while the channel is off: it says it will send once the channel is on.
 *  - The words are the console's (OPERATOR), English; `{placeholders}` are filled when the email is written; a
 *    paragraph that is only `[WORDS]({link})` is the email's button (server: email/copy.ts, email/render.ts).
 *  - The outbox's addresses are masked for an AUDITOR by the server; a reset link's code is never shown.
 *  - Every time in Paris. Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { formatCount } from '../format.js';
import { EMAIL_KINDS, EMAIL_STATUSES, EMAIL_TEMPLATE_BODY_MAX, EMAIL_TEMPLATE_SUBJECT_MAX, type AdminRole, type AnnouncementRelease, type AnnouncementState, type EmailChannel, type EmailKind, type EmailKindView, type EmailStatus, type EmailWords, type OutboxEmail, type OutboxFilters } from '../types.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';
import type { Tone } from './tone.js';

export const EMAILS_COPY = Object.freeze({
  lead: 'Every email ORBES sends, each with its own switch and its own words. Each is off until an ADMIN switches it on, and nothing is sent until the server has an email provider.',
  channel: 'The channel',
  channelOff: 'No email provider in the server’s .env: nothing is sent.',
  channelOffNote: 'The emails switched on here go once the provider is added.',
  channelOn: 'Emails are sent through the server’s provider.',
  kinds: 'The emails',
  kindsNote: 'Off until an ADMIN switches it on',
  switchOn: 'Switch on',
  switchOff: 'Switch off',
  switchedOn: 'Switched on.',
  switchedOff: 'Switched off.',
  switchOnTitle: 'Switch this email on',
  willSend: 'Will send once the channel is on.',
  sends: 'Sends at its moment.',
  off: 'Not sent.',
  words: 'Words',
  editWords: 'Edit the words',
  readWords: 'Read the words',
  defaultWords: 'Default words',
  edited: 'Edited',
  close: 'Close',
  subject: 'Subject',
  subjectHint: `One line, at most ${EMAIL_TEMPLATE_SUBJECT_MAX} characters.`,
  body: 'Words',
  bodyHint: 'Paragraphs apart by an empty line. A paragraph that is only [WORDS]({link}) is the email’s button.',
  placeholders: 'Filled when it is written',
  placeholdersNote: 'Choose one to place it where the cursor is.',
  save: 'Save the words',
  saved: 'Words saved.',
  reset: 'Back to the default words',
  resetTitle: 'Back to the default words',
  resetBody: 'The subject and the words of this email become ORBES’s default words again. The emails already written keep theirs.',
  resetDone: 'The default words are back.',
  test: 'Send a test to me',
  testSent: (to: string) => `A test is on its way to ${to}.`,
  testOff: 'A test goes once the channel is on.',
  preview: 'Preview',
  previewNote: 'With example values, as a mail client shows it.',
  previewFailed: 'The preview could not be drawn.',
  dark: 'Dark',
  light: 'Light',
  text: 'Plain text',
  unsaved: 'The words being written are not saved. Leaving the page loses them.',
  readOnly: 'An OPERATOR writes the words.',
  outbox: 'The outbox',
  outboxNote: 'Each email is erased 90 days after it is sent',
  outboxEmpty: 'Nothing yet. An email is written here once its kind is on and its moment comes.',
  outboxFiltered: 'No email matches these filters.',
  lastErrors: 'Last errors',
  open: 'Open',
  sentAs: 'As it was sent',
  // The founding announcement's panel (the Founding list page).
  announcement: 'The founding announcement',
  announcementLead: 'One email to everyone on the list who has not unsubscribed, to tell them the first release is open (F6). It is prepared now and goes once the server has an email provider and the email is switched on.',
  announcementUnread: 'The founding announcement could not be read. Reload the page.',
  noRelease: 'No release to announce: a published release that is not over appears here.',
  release: 'Release',
  sendNow: 'Send now',
  sendAtOpening: 'Send at the opening',
  sendTitle: 'Send the founding announcement',
  cancel: 'Cancel scheduled',
  cancelTitle: 'Cancel the scheduled announcement',
  cancelBody: 'The announcements still waiting are cancelled and never sent. Sending it again later writes them again.',
  emailsPage: 'Emails',
  adminSends: 'An ADMIN sends it.',
});

/** Each kind as the console names it: its name, its moment, who receives it. */
export const EMAIL_KIND_INFO: Readonly<Record<EmailKind, { name: string; when: string; to: string }>> = Object.freeze({
  FOUNDING_ANNOUNCEMENT: { name: 'Founding announcement', when: 'Sent from the Founding list, now or at a release’s opening.', to: 'The founding list' },
  RELEASE_NOTICE: { name: 'Release notice', when: 'A release is announced.', to: 'The accounts that asked' },
  PASSWORD_RESET: { name: 'Password reset', when: 'A collector asks for a new password.', to: 'The account' },
  ORDER_CONFIRMED: { name: 'Order confirmed', when: 'An order is paid.', to: 'The buyer' },
  ORDER_SHIPPED: { name: 'Order shipped', when: 'An order leaves, with its tracking page.', to: 'The buyer' },
  ORDER_DELIVERED: { name: 'Order delivered', when: 'An order is delivered.', to: 'The buyer' },
  ORDER_CANCELLED: { name: 'Order cancelled', when: 'An order is cancelled.', to: 'The buyer' },
  DRAW_SELECTED: { name: 'Draw: a place', when: 'A draw gives the collector a place.', to: 'The collector' },
  DRAW_OFFERED: { name: 'Draw: a place offered', when: 'OFFER NEXT gives a freed place.', to: 'The collector' },
  WARRANTY_LABEL: { name: 'Warranty label', when: 'A warranty claim’s prepaid label is sent.', to: 'The owner' },
  CARE_LABEL: { name: 'PRIVATE CARE label', when: 'A PRIVATE CARE label is sent.', to: 'The owner' },
});

export const kindName = (kind: EmailKind): string => EMAIL_KIND_INFO[kind]?.name ?? kind;

// ── The address (`#/settings/emails?kind=ORDER_SHIPPED&status=FAILED`) ──────────────────────────────────────────────

export interface EmailsParams {
  /** The kind whose words are open, or null. */
  kind: EmailKind | null;
  /** The outbox's filters. */
  status: EmailStatus | null;
  outboxKind: EmailKind | null;
}

const isKind = (v: string | undefined): v is EmailKind => (EMAIL_KINDS as readonly string[]).includes(v ?? '');
const isStatus = (v: string | undefined): v is EmailStatus => (EMAIL_STATUSES as readonly string[]).includes(v ?? '');

/** The page's state from its address; anything unreadable is nothing. */
export function emailsParams(query: Readonly<Record<string, string | undefined>>): EmailsParams {
  return { kind: isKind(query.kind) ? query.kind : null, status: isStatus(query.status) ? query.status : null, outboxKind: isKind(query.okind) ? query.okind : null };
}

/** What GET /api/admin/email/outbox is asked for. */
export function outboxFilters(p: EmailsParams): OutboxFilters {
  return { ...(p.status ? { status: p.status } : {}), ...(p.outboxKind ? { kind: p.outboxKind } : {}) };
}

export const OUTBOX_PAGE_SIZE = 25;

/** The outbox's filters: by status, by kind. */
export const STATUS_CHOICES = Object.freeze([{ value: '', label: 'Every status' }, ...EMAIL_STATUSES.map((s) => ({ value: s, label: statusWords(s) }))]);
export function kindChoices(): { value: string; label: string }[] {
  return [{ value: '', label: 'Every email' }, ...EMAIL_KINDS.map((k) => ({ value: k, label: kindName(k) }))];
}

// ── The channel and the switches ─────────────────────────────────────────────────────────────────────────────────

/** The channel's rows: its state, then the server's host and the sender, or why nothing is sent. */
export function channelRows(c: EmailChannel): { label: string; value: string; note?: string }[] {
  if (!c.on) return [{ label: 'Channel', value: 'OFF', note: EMAILS_COPY.channelOff }];
  return [
    { label: 'Channel', value: 'ON', note: EMAILS_COPY.channelOn },
    { label: 'Server', value: c.host },
    { label: 'Sender', value: c.from },
  ];
}

/** A kind's switch in words: ON and what follows from it, or OFF. */
export function switchState(k: Pick<EmailKindView, 'enabled'>, channelOn: boolean): { text: string; tone: Tone; note: string } {
  if (!k.enabled) return { text: 'OFF', tone: 'muted', note: EMAILS_COPY.off };
  return channelOn ? { text: 'ON', tone: 'solid', note: EMAILS_COPY.sends } : { text: 'ON', tone: 'outline', note: EMAILS_COPY.willSend };
}

/** Whose words a kind carries: the default ones, or which part is edited. */
export function wordsState(k: Pick<EmailKindView, 'edited'>): string {
  if (k.edited.subject && k.edited.body) return EMAILS_COPY.edited;
  if (k.edited.subject) return `${EMAILS_COPY.edited}: subject`;
  if (k.edited.body) return `${EMAILS_COPY.edited}: words`;
  return EMAILS_COPY.defaultWords;
}

/** The switch dialog's words: what switching it on starts. */
export function switchOnBody(k: EmailKind, channelOn: boolean): string {
  const info = EMAIL_KIND_INFO[k];
  return `${info.name}: ${info.when.replace(/\.$/, '')}, ORBES writes this email to ${info.to.toLowerCase()}.${channelOn ? '' : ` ${EMAILS_COPY.willSend}`}`;
}

// ── The words being written, checked as the server checks them ───────────────────────────────────────────────────

/** What is wrong with a subject being written, or null. */
export function subjectProblem(subject: string): string | null {
  const s = subject.trim();
  if (s === '') return 'Write a subject.';
  if (/[\r\n]/.test(subject)) return 'One line.';
  if (s.length > EMAIL_TEMPLATE_SUBJECT_MAX) return `At most ${EMAIL_TEMPLATE_SUBJECT_MAX} characters.`;
  return null;
}

/** What is wrong with a body being written, or null. */
export function bodyProblem(body: string): string | null {
  const s = body.trim();
  if (s === '') return 'Write the words.';
  if (s.length > EMAIL_TEMPLATE_BODY_MAX) return `At most ${formatCount(EMAIL_TEMPLATE_BODY_MAX)} characters.`;
  return null;
}

/** The `{names}` written that this kind does not fill: they stay as they are written. */
export function unknownPlaceholders(words: EmailWords, placeholders: readonly { name: string }[]): string[] {
  const known = new Set(placeholders.map((p) => p.name));
  const out: string[] = [];
  for (const m of `${words.subject}\n${words.body}`.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) if (!known.has(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** The line under the editor for those names, or null. */
export function unknownLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.map((n) => `{${n}}`).join(', ');
  return `${list} ${names.length === 1 ? 'is' : 'are'} not filled by this email: ${names.length === 1 ? 'it stays' : 'they stay'} as written.`;
}

/** What PUT …/words is sent: each part changed, the default's words as null (the default kept as the default). */
export function wordsChange(k: Pick<EmailKindView, 'words' | 'defaults'>, draft: EmailWords): { subject?: string | null; body?: string | null } {
  const out: { subject?: string | null; body?: string | null } = {};
  if (draft.subject !== k.words.subject) out.subject = draft.subject.trim() === k.defaults.subject ? null : draft.subject.trim();
  if (draft.body !== k.words.body) out.body = draft.body.trim() === k.defaults.body ? null : draft.body.trim();
  return out;
}

export const isDraftChanged = (k: Pick<EmailKindView, 'words'>, draft: EmailWords): boolean => draft.subject !== k.words.subject || draft.body !== k.words.body;

// ── The outbox ───────────────────────────────────────────────────────────────────────────────────────────────────

export function statusWords(s: EmailStatus): string {
  return { QUEUED: 'Queued', SENT: 'Sent', FAILED: 'Failed', CANCELLED: 'Cancelled' }[s];
}

export function statusTone(s: EmailStatus): Tone {
  return ({ QUEUED: 'outline', SENT: 'solid', FAILED: 'alert', CANCELLED: 'muted' } as const)[s];
}

/** The outbox's four figures: queued, sent, failed, cancelled. */
export function outboxKpis(o: { queued: number; sent: number; failed: number; cancelled: number }): { key: EmailStatus; label: string; value: string; note: string; tone: Tone }[] {
  return [
    { key: 'QUEUED', label: 'Queued', value: formatCount(o.queued), note: 'TO BE SENT', tone: 'solid' },
    { key: 'SENT', label: 'Sent', value: formatCount(o.sent), note: 'IN 90 DAYS', tone: 'solid' },
    { key: 'FAILED', label: 'Failed', value: formatCount(o.failed), note: o.failed > 0 ? 'NOT SENT' : 'NONE', tone: o.failed > 0 ? 'alert' : 'solid' },
    { key: 'CANCELLED', label: 'Cancelled', value: formatCount(o.cancelled), note: 'NEVER SENT', tone: 'solid' },
  ];
}

/** When an email went or goes, in Paris: due, tried again, sent, failed or cancelled. */
export function outboxWhen(e: Pick<OutboxEmail, 'status' | 'attempts' | 'notBefore' | 'sentAt' | 'settledAt'>): string {
  switch (e.status) {
    case 'QUEUED':
      return e.attempts > 0 ? `Tried ${triesText(e.attempts)} · again ${parisDateTime(e.notBefore)}` : `Due ${parisDateTime(e.notBefore)}`;
    case 'SENT':
      return `Sent ${parisDateTime(e.sentAt)}`;
    case 'FAILED':
      return `After ${triesText(e.attempts)} · ${parisDateTime(e.settledAt)}`;
    case 'CANCELLED':
      return parisDateTime(e.settledAt);
  }
}

const triesText = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${formatCount(n)} times`);

/** Whom an outbox row is for: a person of the founding list, an account, or the console's own test. */
export function recipientKind(e: Pick<OutboxEmail, 'accountId' | 'preregistrationId'>): string {
  if (e.preregistrationId) return 'Founding list';
  if (e.accountId) return 'Account';
  return 'Test';
}

/** The count of the outbox under its table: `3 emails`, `1 email`, with the filters said. */
export function outboxLine(total: number, isFiltered: boolean): string {
  return `${formatCount(total)} ${total === 1 ? 'email' : 'emails'}${isFiltered ? (total === 1 ? ' matches the filters' : ' match the filters') : ''}`;
}

// ── What the reader may do ───────────────────────────────────────────────────────────────────────────────────────

export interface EmailsActions {
  /** Switch a kind on or off, and a test to oneself. */
  switch: boolean;
  /** Write the words, preview them as written, bring back the defaults. */
  edit: boolean;
}

export function emailsActions(role: AdminRole | null | undefined): EmailsActions {
  return { switch: can(role, 'switchEmails'), edit: can(role, 'editEmailWords') };
}

// ── The founding announcement's panel (the Founding list page) ───────────────────────────────────────────────────

/** The phrase Send asks for: `SEND 1A2B3C4D` (services/email-triggers.ts announcementPhrase). */
export function announcementPhrase(dropId: string): string {
  return `SEND ${dropId.slice(0, 8).toUpperCase()}`;
}

/** A release as the panel's choice names it: `HALO — draw · DRAW · 05 NOV 2026 · 19:00 Paris`. */
export function releaseChoiceLabel(r: Pick<AnnouncementRelease, 'title' | 'mode' | 'opensAt'>): string {
  return `${r.title} · ${r.mode} · ${parisDateTime(r.opensAt)}`;
}

/** The release the panel shows: the one chosen, or the first still to be announced, or the soonest. */
export function chosenRelease(s: Pick<AnnouncementState, 'releases'>, chosen: string | null): AnnouncementRelease | null {
  return s.releases.find((r) => r.id === chosen) ?? s.releases.find((r) => r.emails.queued + r.emails.sent + r.emails.failed === 0) ?? s.releases[0] ?? null;
}

/** Its emails in words: `2 queued · 1 sent`, or `None yet`. */
export function announcementEmailsText(e: AnnouncementRelease['emails']): string {
  const parts = [
    e.queued ? `${formatCount(e.queued)} queued` : null,
    e.sent ? `${formatCount(e.sent)} sent` : null,
    e.failed ? `${formatCount(e.failed)} failed` : null,
    e.cancelled ? `${formatCount(e.cancelled)} cancelled` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? parts.join(' · ') : 'None yet';
}

/** The count reached: `3 people on the list`, `1 person`. */
export function reachText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'person' : 'people'} on the list`;
}

/** What the panel offers for a release: Send now, Send at the opening, Cancel scheduled, each with why not. */
export interface AnnouncementOffer {
  now: { ok: boolean; why: string | null };
  atOpening: { ok: boolean; why: string | null; shown: boolean };
  cancel: boolean;
  /** Why nothing may be sent (the channel, the switch, nobody on the list), or null. */
  blocked: string | null;
}

export function announcementOffer(s: Pick<AnnouncementState, 'channel' | 'enabled' | 'reach'>, r: AnnouncementRelease, now: Date): AnnouncementOffer {
  const blocked = !s.channel
    ? EMAILS_COPY.channelOff
    : !s.enabled
      ? 'Switch the founding announcement on first, on the Emails page.'
      : s.reach === 0
        ? 'Nobody on the list to write to.'
        : null;
  const opened = new Date(r.opensAt).getTime() <= now.getTime();
  const notAnnounced = r.mode === 'LIVE' && !r.announced;
  return {
    blocked,
    now: { ok: blocked === null && !notAnnounced, why: blocked ?? (notAnnounced ? 'This release is not announced yet: send it at its opening.' : null) },
    // Once the release has opened, its opening is now: Send now alone is offered.
    atOpening: { ok: blocked === null && !opened, why: blocked, shown: !opened },
    cancel: r.emails.queued > 0,
  };
}

/** The send dialog's words: to whom, when, what the email says of the release. */
export function sendBody(s: Pick<AnnouncementState, 'reach'>, r: AnnouncementRelease, when: 'NOW' | 'OPENING'): string {
  const whenWords = when === 'NOW' ? 'now' : `at the release’s opening, ${parisDateTime(r.opensAt)}`;
  return `To ${reachText(s.reach).replace(' on the list', '')} on the founding list who have not unsubscribed, ${whenWords}. Each person receives it once for this release; those who already have it are left out. The email names the release “${r.words}”.`;
}

/** The toast after a send: how many, and when. */
export function sentText(queued: number, notBefore: string, now: Date): string {
  if (queued === 0) return 'Everyone on the list already has it for this release.';
  const at = new Date(notBefore).getTime() > now.getTime() + 60_000 ? `, to go ${parisDateTime(notBefore)}` : '';
  return `${formatCount(queued)} ${queued === 1 ? 'email' : 'emails'} written${at}.`;
}
