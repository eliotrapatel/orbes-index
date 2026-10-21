/**
 * MESSAGES with ORBES Client Services as a page in two parts on a computer (desktop, BRIEF decision 5,
 * "Subjects | conversation", §10.30; /verify/messages/<subject>): never a sheet, a side panel or a dialog.
 *
 *   ‹ YOUR ACCOUNT
 *   MESSAGES                              │ CONCERNING                                                 SEE THE PIECE
 *                                         │ MONOLITHE · O26-J-00184
 *   ──────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────
 *   MONOLITHE · O26-J-00184         NEW   │ YOU · 6 OCT 2026 · 14:02
 *   6 OCT 2026 · 16:40                    │ The clasp of my bracelet slips a little since last week. …
 *   GENERAL                               │ ORBES CLIENT SERVICES · 6 OCT 2026 · 16:40
 *                                         │ Thank you. Bring it to the Paris boutique, …
 *                                         │ YOUR REPLY
 *                                         │ ________________________________________________ (1 line, up to 6)
 *                                         │ Please leave out passwords and card numbers.                     [ SEND ]
 *
 * The page fills the window under the bar; the subjects and the conversation each scroll on their own. The thread is
 * the account's one conversation as the server gives it (GET /api/v1/account/messages), grouped here: each of the
 * collector's messages belongs to what it concerned (an order, a piece, a release, a model of THE PRIVATE SALON, a scan
 * and its REF), one without any to GENERAL; ORBES Client Services' answers carry none, so each stands with the
 * collector's message before it. The newest subject first, GENERAL among them by its latest message (last only while it
 * holds nothing), so the page opens on the newest message (§10.30); NEW on a subject an unread answer stood on
 * when the page opened (the answers newer than what was read: the newest `unread-count` of them), until it is opened.
 * Opening the page reads the conversation up to its latest message, as the phone's MESSAGES does (NOW's line goes).
 *
 * The address carries the subject (`/verify/messages/piece-o26-j-00184`), so a reload and back keep it; a subject is
 * chosen in place (the entry's address replaced). A reply carries its subject's context (the id the server gives
 * with each message, `concerning.ref`), so it stays on it; GENERAL's carry none. WRITE TO ORBES CLIENT SERVICES from
 * any place opens this page on that place's subject; before its first message the subject stands first in the list, with
 * the write sheet's own line on where the answer will appear, its context kept in the entry (a reload keeps it), and
 * CANCEL leaves it. Signed out, the sign-in page first, then here
 * on that subject (main.ts). No email address, phone or hours anywhere.
 *
 * FROM ORBES (macro scope D24, M3 and M4; lot M2 plan §1.5; /verify/messages/from-orbes): once the account has a house
 * message, a subject of its own, placed by its newest message like any other, NEW while one is unread. Its messages
 * oldest first like a conversation (SHOW EARLIER over them past a page of 30), each with its title, words and links; in
 * place of the reply, the line that no reply is written there and WRITE TO ORBES CLIENT SERVICES, which opens GENERAL.
 * Opening it reads it (NOW's line goes). Unreadable, the sentence, the server's words and TRY AGAIN in its part.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { DESKTOP, FROM_ORBES, LOOKBOOK, MESSAGES, PIECES, RELEASES } from '../copy.js';
import {
  concerningTarget,
  houseList,
  houseReadUpTo,
  messageProblem,
  messageText,
  orderContext,
  orderReference,
  pieceContext,
  threadItem,
  type ConcerningTarget,
  type HouseItem,
  type HouseList,
  type HouseTarget,
  type ThreadItem,
  type WriteContext,
} from '../messages-model.js';
import { seen } from '../seen.js';
import type { SessionStore } from '../session.js';
import type { AccountMessage, AccountThread, MessageContextInput, MessageContextKind } from '../types.js';
import { withNumerals } from './common.js';
import { FormError, messageOf, nocturneForm } from './forms.js';
import { appAnchor, button, failedState, icon, loadingState, textLink } from './nocturne.js';

export const MESSAGES_PATH = '/verify/messages';

/** Whether an address is the messages page's (`/verify/messages`, or one of its subjects). */
export function isMessagesPath(pathname: string): boolean {
  return /^\/verify\/messages(\/[^/]+)?\/?$/i.test(pathname);
}

/** The subject an address names (`piece-o26-j-00184`), or null for the page itself. */
export function messagesSubjectOf(pathname: string): string | null {
  const m = /^\/verify\/messages\/([^/]+)\/?$/i.exec(pathname);
  if (!m) return null;
  try {
    const key = decodeURIComponent(m[1]!).toLowerCase();
    return /^[a-z0-9-]{1,120}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** A subject's address. */
export function messagesPath(key: string | null): string {
  return key ? `${MESSAGES_PATH}/${encodeURIComponent(key)}` : MESSAGES_PATH;
}

/**
 * A subject's name as the list and the head set it (BRIEF §10.9): each value held whole with the ` · ` after it, so a
 * name breaks between its values first (`MONOLITHE IN STEEL ·` / `O26-J-00184`); a value longer than its line only
 * then between its words, its last two words held together, never one alone (`MONOLITHE, THE` / `OCTOBER DRAW`, never
 * `MONOLITHE, THE OCTOBER` / `DRAW`). Its figures in the reading face.
 */
function subjectLine(text: string): (string | HTMLSpanElement)[] {
  const values = text.split(' · ');
  return values.flatMap((v, i) => {
    const last = i === values.length - 1;
    const end = last ? '' : ' ·';
    const words = v.split(' ');
    const tail = words.length > 2 ? words.splice(-2).join(' ') : null;
    const group = h('span', { class: 'n-nw d-msg__value' }, ...(tail ? [...withNumerals(`${words.join(' ')} `), h('span', { class: 'n-nw' }, ...withNumerals(tail + end))] : withNumerals(words.join(' ') + end)));
    return last ? [group] : [group, ' '];
  });
}

const GENERAL = 'general';
/** FROM ORBES' subject: its address, /verify/messages/from-orbes (NOW's line of a house message opens it). */
export const FROM_ORBES_KEY = 'from-orbes';

/** A subject of the conversation: what its messages concern, and what a reply on it attaches. */
interface Subject {
  key: string;
  /** HOUSE: FROM ORBES, the house messages (lot M2), never answered. */
  kind: MessageContextKind | 'GENERAL' | 'HOUSE';
  /** As its latest message names it (the server's label), or GENERAL. */
  title: string;
  /** The place it names in the app (its CONCERNING link), null for none (a scan, GENERAL). */
  target: ConcerningTarget | null;
  /** What a reply on it attaches; null: none (GENERAL, or a context that can no longer be named). */
  context: MessageContextInput | null;
  items: ThreadItem[];
  /** The latest message's time (ISO), null before the first. */
  lastAt: string | null;
  unread: boolean;
  /** Opened from WRITE TO ORBES CLIENT SERVICES, its first message not written yet. */
  pending: boolean;
}

/** The subject key of a context the app attaches (WRITE TO ORBES CLIENT SERVICES) or a message concerned. */
function keyOf(kind: MessageContextKind, id: string | null, label: string, target: ConcerningTarget | null): string {
  if (kind === 'ORDER' && (target?.to === 'order' || id)) return `order-${orderReference(target?.to === 'order' ? target.id : id!).toLowerCase()}`;
  if (kind === 'PIECE' && (target?.to === 'piece' || id)) return `piece-${(target?.to === 'piece' ? target.id : id!).toLowerCase()}`;
  if (kind === 'RELEASE' && (target?.to === 'release' || id)) return `release-${(target?.to === 'release' ? target.id : id!).toLowerCase()}`;
  if (kind === 'MODEL' && target?.to === 'sheet') return `model-${target.slug}`;
  if (kind === 'SCAN') {
    const ref = new RegExp(`\\b${MESSAGES.label.ref} ([0-9A-F]{8})\\b`).exec(label)?.[1];
    if (ref) return `scan-${ref.toLowerCase()}${label.includes(MESSAGES.label.warranty) ? '-warranty' : ''}`;
  }
  // Anything else: its kind and its words.
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${kind.toLowerCase()}-${words || 'subject'}`;
}

/** What a reply on a message's subject attaches: its id as the server gives it (else from its place), and `about`. */
function contextOf(c: NonNullable<AccountMessage['concerning']>, target: ConcerningTarget | null): MessageContextInput | null {
  const id = c.ref ?? (target?.to === 'order' || target?.to === 'piece' || target?.to === 'release' ? target.id : null);
  if (!id) return null;
  return c.kind === 'SCAN' && c.label.includes(MESSAGES.label.warranty) ? { kind: 'SCAN', id, about: 'WARRANTY' } : { kind: c.kind, id };
}

/** The place a context names, when the app knows it by its id alone (an order, a piece, a release). */
function targetOfContext(c: WriteContext): ConcerningTarget | null {
  if (c.kind === 'ORDER') return { to: 'order', id: c.id };
  if (c.kind === 'PIECE') return { to: 'piece', id: c.id };
  if (c.kind === 'RELEASE') return { to: 'release', id: c.id };
  return null;
}

/** The subject of what WRITE TO ORBES CLIENT SERVICES attaches: its address (`order-or-6acd9a60`, `piece-o26-j-00184`). */
export function subjectKey(c: WriteContext): string {
  return keyOf(c.kind, c.id, c.label, targetOfContext(c));
}

/** Whether a value is what WRITE TO ORBES CLIENT SERVICES attaches (a history entry's: a reload keeps it). */
export function isWriteContext(v: unknown): v is WriteContext {
  const c = v as Partial<WriteContext> | null;
  return !!c && typeof c === 'object' && typeof c.kind === 'string' && ['PIECE', 'ORDER', 'RELEASE', 'SCAN', 'MODEL'].includes(c.kind) && typeof c.id === 'string' && typeof c.label === 'string';
}

/**
 * The conversation as subjects: each collector's message under what it concerned (GENERAL without), each answer under
 * the collector's message before it; NEW where one of the newest `unreadCount` answers stands. The newest subject first,
 * GENERAL last when it holds nothing.
 */
function subjectsOf(t: AccountThread, unreadCount: number, offsetMinutes: number): Subject[] {
  const byKey = new Map<string, Subject>();
  const general = (): Subject => ({ key: GENERAL, kind: 'GENERAL', title: DESKTOP.messages.general, target: null, context: null, items: [], lastAt: null, unread: false, pending: false });
  const answers = t.messages.flatMap((m, i) => (m.from === 'YOU' ? [] : [i]));
  const unread = new Set(unreadCount > 0 ? answers.slice(-unreadCount) : []);
  let current = GENERAL;
  t.messages.forEach((m, i) => {
    let key = current;
    if (m.from === 'YOU') {
      const c = m.concerning;
      if (c) {
        const target = concerningTarget(c.path);
        key = keyOf(c.kind, c.ref ?? null, c.label, target);
        const s = byKey.get(key);
        // The subject named as its latest message names it (a release's words follow the entry's state).
        if (s) {
          s.title = c.label;
          s.target = target ?? s.target;
          s.context = contextOf(c, target) ?? s.context;
        } else byKey.set(key, { key, kind: c.kind, title: c.label, target, context: contextOf(c, target), items: [], lastAt: null, unread: false, pending: false });
      } else key = GENERAL;
      current = key;
    }
    const s = byKey.get(key) ?? byKey.set(key, general()).get(key)!;
    s.items.push(threadItem(m, offsetMinutes));
    s.lastAt = m.at;
    if (unread.has(i)) s.unread = true;
  });
  const list = [...byKey.values()].sort((a, b) => Date.parse(b.lastAt ?? '') - Date.parse(a.lastAt ?? ''));
  if (!byKey.has(GENERAL)) list.push(general());
  return list;
}

export interface MessagesPageDeps {
  api: Pick<ApiClient, 'messages' | 'messagesUnreadCount' | 'readMessages' | 'writeMessage' | 'orders' | 'products' | 'houseMessages' | 'readHouseMessages' | 'messagesUnread'>;
  session: SessionStore;
  /** The subject the address names, null for the page itself (the newest subject). */
  subject: string | null;
  /** WRITE TO ORBES CLIENT SERVICES: what the place attaches, kept in the page's entry (null for none). */
  context: WriteContext | null;
  /** The subject shown: its address (and the context of a subject not written yet) in the page's entry, in place. */
  onSubject(key: string, context: WriteContext | null): void;
  /** ‹ YOUR ACCOUNT. */
  onAccount(): void;
  /** A subject's place (SEE THE PIECE, SEE THE ORDER…). */
  onConcerning(target: ConcerningTarget): void;
  /** CANCEL on a subject not written yet: back to where WRITE TO ORBES CLIENT SERVICES was pressed. */
  onCancel(): void;
  /** Signed out: the sign-in page, then this page. */
  onSignIn(): void;
  /** The conversation was read up to its latest message (NOW's line goes). */
  onRead(): void;
  /** A house message's link (FROM ORBES): its place in the app. */
  onHouse(target: HouseTarget): void;
}

export interface MessagesPageView {
  root: HTMLElement;
  dispose(): void;
}

export function messagesPageView(deps: MessagesPageDeps): MessagesPageView {
  const page = new MessagesPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

/** The reply box's lines: one to start (a field's 52 px), up to six as it is written (§10.30), then it scrolls. */
const REPLY_LINES = { min: 1, max: 6 };
/** The veil under the heads' hairline (shared/desktop-messages.css `ol.d-msg__conversation::before`, 24 px). */
const VEIL = 24;

class MessagesPage {
  readonly root: HTMLElement;
  private readonly app = h('div', { class: 'd-msg__app' });
  private load: Load = { kind: 'loading' };
  private loadGen = 0;
  private thread: AccountThread | null = null;
  private subjects: Subject[] = [];
  /**
   * FROM ORBES: the house messages read (pages joined, newest first), null when the account has none or they could not
   * be read (`houseError`, with `houseKnown` when one is known to be unread: its subject then says so).
   */
  private house: HouseList | null = null;
  private houseError: string | null = null;
  private houseKnown = false;
  /** TRY AGAIN pressed: FROM ORBES read again, ONE MOMENT… in place of its failure, a second press ignored. */
  private houseRetrying = false;
  /** SHOW EARLIER: reading the next page, or why it could not be read. */
  private earlier: { busy: boolean; error: string | null } = { busy: false, error: null };
  private selected: string | null;
  /** A subject opened from a place before its first message (its context), null for none. */
  private pending: WriteContext | null;
  /** The subjects opened during this visit: their NEW goes. */
  private readonly opened = new Set<string>();
  /** What was being written on each subject, kept while the page lives. */
  private readonly drafts = new Map<string, string>();
  /** MESSAGE SENT, under the reply once sent on the subject shown, until the next words. */
  private sentOn: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private signingIn = false;
  /** The reply's room followed: the window's height (the pane) and the reply's own words (an error, MESSAGE SENT). */
  private readonly sizer = new ResizeObserver(() => {
    // On the next frame: the box resized inside the observer's own callback would be a loop.
    requestAnimationFrame(() => {
      if (this.disposed) return;
      // The conversation at its end before the window changed (its sizes as last read): kept at its end after it.
      const box = this.root.querySelector<HTMLElement>('.d-msg__conversation');
      const wasEnd = !!box && !!this.ends && this.ends.height - box.scrollTop - this.ends.client < 2 + this.ends.back;
      const area = this.root.querySelector<HTMLTextAreaElement>('#messages-reply');
      if (area) grow(area);
      if (wasEnd) this.toLatest();
      else this.keepEnds();
    });
  });
  /** The conversation's sizes as last read (its content's height, its window's): where its end was. */
  private ends: { height: number; client: number; back: number } | null = null;

  constructor(private readonly deps: MessagesPageDeps) {
    this.selected = deps.subject;
    this.pending = deps.context;
    this.root = h('main', { class: ['view', 'view--messages', 'd-msg'], attrs: { 'aria-labelledby': 'messages-title' } });
    const crumb = appAnchor('/verify/account', ['n-g', 'n-crumb', 'd-msg__crumb'], () => deps.onAccount(), icon('back', { small: true }), MESSAGES.back);
    this.root.append(h('div', { class: 'd-msg__crumb-line' }, crumb), this.app);
    this.unsubscribe = deps.session.subscribe((s) => {
      if (s.status === 'anonymous') this.signIn();
    });
    this.render();
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.loadGen++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sizer.disconnect();
    seen.release(this);
  }

  /** The pane and the reply drawn: their sizes followed, so the reply box never takes the conversation's last room. */
  private watchRoom(): void {
    this.sizer.disconnect();
    for (const el of this.app.querySelectorAll<HTMLElement>(':scope > .d-msg__pane, :scope > .d-msg__pane > .d-msg__reply')) this.sizer.observe(el);
  }

  private signIn(): void {
    if (this.disposed || this.signingIn) return;
    this.signingIn = true;
    this.deps.onSignIn();
  }

  private async start(): Promise<void> {
    await this.deps.session.ensure().catch(() => undefined);
    if (this.disposed) return;
    if (this.deps.session.state.status !== 'signed-in') {
      this.signIn();
      return;
    }
    // The recording, as the phone's MESSAGES has it (plan CUSTOMER INTELLIGENCE §3.3 T.9): nothing new is recorded.
    seen.claim(this, 'MESSAGES', () => !this.disposed && this.root.isConnected);
    await this.read({ first: true });
  }

  /**
   * The conversation read (and, on the first read, how many answers are unread and FROM ORBES' first page), its subjects
   * drawn.
   */
  private async read(opts: { first?: boolean; select?: string } = {}): Promise<void> {
    const gen = ++this.loadGen;
    try {
      const [t, count] = await Promise.all([
        this.deps.api.messages(),
        opts.first ? this.deps.api.messagesUnreadCount().catch(() => 0) : Promise.resolve(0),
        opts.first ? this.readHouse() : Promise.resolve(),
      ]);
      if (gen !== this.loadGen || this.disposed) return;
      this.thread = t;
      const before = new Map(this.subjects.map((s) => [s.key, s.unread]));
      // The count holds the house messages unread too (GET …/unread-count): the answers' NEW counts the answers alone.
      // FROM ORBES unreadable, how many of the count are its own is not known: only the latest answer is marked, and
      // only while the conversation says an answer is unread (never an older answer marked NEW wrongly).
      const answers = this.house || !this.houseError ? count - (this.house?.unread ?? 0) : Math.min(count, t.unread ? 1 : 0);
      this.subjects = this.withHouse(subjectsOf(t, Math.max(0, answers), -new Date().getTimezoneOffset()));
      // NEW stays on a subject for the visit (the conversation is read as the page opens), until it is opened.
      if (!opts.first) for (const s of this.subjects) s.unread = (before.get(s.key) ?? false) && !this.opened.has(s.key);
      await this.place(opts.select ?? null);
      if (gen !== this.loadGen || this.disposed) return;
      this.load = { kind: 'ready' };
      if (opts.first && t.unread) {
        const latest = t.messages.at(-1)?.at;
        if (latest) void this.deps.api.readMessages(latest).then(() => this.deps.onRead(), () => undefined);
      }
    } catch (e) {
      if (gen !== this.loadGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
    if (opts.first) this.toLatest();
  }

  /** FROM ORBES' first page; unreadable, whether one is unread (its subject is then listed with the failure). */
  private async readHouse(): Promise<void> {
    try {
      const page = await this.deps.api.houseMessages(1);
      this.house = page.total > 0 ? houseList(page, -new Date().getTimezoneOffset()) : null;
      this.houseError = null;
    } catch (e) {
      this.deps.session.noteError(e);
      this.house = null;
      this.houseError = messageOf(e);
      this.houseKnown = this.houseKnown || (await this.deps.api.messagesUnread().then((u) => u.house, () => false));
    }
  }

  /** The subjects with FROM ORBES among them, by its newest message (first while it cannot be read); GENERAL empty last. */
  private withHouse(list: Subject[]): Subject[] {
    const list2 = list.filter((s) => s.key !== FROM_ORBES_KEY);
    if (!this.house && !(this.houseError && this.houseKnown)) return list2;
    const newest = this.house?.items[0]?.at ?? null;
    const house: Subject = { key: FROM_ORBES_KEY, kind: 'HOUSE', title: FROM_ORBES.title, target: null, context: null, items: [], lastAt: newest, unread: this.house ? this.house.unread > 0 : this.houseKnown, pending: false };
    if (!newest) return [house, ...list2];
    const dated = list2.filter((s) => s.lastAt);
    const at = dated.findIndex((s) => Date.parse(s.lastAt!) < Date.parse(newest));
    if (at < 0) dated.push(house);
    else dated.splice(at, 0, house);
    return [...dated, ...list2.filter((s) => !s.lastAt)];
  }

  /** FROM ORBES opened: read up to its newest message (NOW's line goes); its messages keep their NEW for the visit. */
  private readHouseShown(): void {
    const upTo = houseReadUpTo(this.house);
    if (!upTo || !this.house) return;
    this.house = { ...this.house, unread: 0 };
    void this.deps.api.readHouseMessages(upTo).then(() => this.deps.onRead(), () => undefined);
  }

  /** FROM ORBES read again (TRY AGAIN in its part): ONE MOMENT… while it reads, as SHOW EARLIER has it. */
  private async retryHouse(): Promise<void> {
    if (this.houseRetrying) return;
    const gen = this.loadGen;
    this.houseRetrying = true;
    this.render();
    this.root.querySelector<HTMLElement>('.d-msg__house-wait')?.focus({ preventScroll: true });
    await this.readHouse();
    this.houseRetrying = false;
    if (this.disposed) return;
    // A later read of the page draws FROM ORBES as just read; until it does, the failure or the list replaces ONE MOMENT….
    if (gen !== this.loadGen) {
      this.render();
      return;
    }
    this.subjects = this.withHouse(this.subjects);
    const s = this.subjects.find((x) => x.key === FROM_ORBES_KEY);
    if (s) s.unread = false;
    if (this.selected === FROM_ORBES_KEY) this.readHouseShown();
    this.render();
    this.toLatest();
  }

  /** SHOW EARLIER: FROM ORBES' next page, over what is shown; the conversation keeps its place under it. */
  private async houseMore(): Promise<void> {
    const list = this.house;
    if (!list || this.earlier.busy) return;
    const gen = this.loadGen;
    this.earlier = { busy: true, error: null };
    this.render();
    try {
      const page = await this.deps.api.houseMessages(list.pages + 1);
      if (gen !== this.loadGen || this.disposed || this.house !== list) return;
      this.house = { ...houseList(page, -new Date().getTimezoneOffset(), list), unread: list.unread };
      this.earlier = { busy: false, error: null };
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.loadGen || this.disposed) return;
      this.earlier = { busy: false, error: messageOf(e) };
    }
    const box = this.root.querySelector<HTMLElement>('.d-msg__conversation');
    const fromEnd = box ? box.scrollHeight - box.scrollTop : 0;
    this.render();
    const again = this.root.querySelector<HTMLElement>('.d-msg__conversation');
    if (again) again.scrollTop = again.scrollHeight - fromEnd;
    this.root.querySelector<HTMLElement>('.d-msg__earlier .n-tl')?.focus({ preventScroll: true });
    this.keepEnds();
  }

  /**
   * The subject shown: `select` (the one a message was just sent on), else the address's, else a place's not written
   * yet (WRITE TO ORBES CLIENT SERVICES: its own subject when it has one already), else the newest; its address follows.
   */
  private async place(select: string | null): Promise<void> {
    if (this.pending) {
      const p = this.pending;
      const existing = this.subjects.find((s) => s.kind === p.kind && (s.context?.id === p.id || s.key === this.pendingKey(p)));
      if (existing) {
        this.pending = null;
        this.selected = existing.key;
      } else if (!select) this.selected = this.pendingKey(p);
    }
    if (select) this.selected = select;
    // An address naming an order or a piece not written about yet (a link, a reload without its entry): its subject.
    if (this.selected && !this.pending && !this.subjects.some((s) => s.key === this.selected)) this.pending = await this.contextFor(this.selected);
    if (this.pending && this.selected !== this.pendingKey(this.pending)) this.pending = null;
    if (!this.selected || (!this.pending && !this.subjects.some((s) => s.key === this.selected))) this.selected = this.subjects[0]?.key ?? GENERAL;
    this.opened.add(this.selected);
    const s = this.subjects.find((x) => x.key === this.selected);
    if (s) s.unread = false;
    if (this.selected === FROM_ORBES_KEY) this.readHouseShown();
    this.deps.onSubject(this.selected, this.pending);
  }

  private pendingKey(c: WriteContext): string {
    return subjectKey(c);
  }

  /** The context of an order or a piece of the account named by a subject's address; null for any other. */
  private async contextFor(key: string): Promise<WriteContext | null> {
    try {
      const order = /^order-(or-[0-9a-f]{8})$/.exec(key);
      if (order) {
        const o = (await this.deps.api.orders()).find((x) => x.reference.toLowerCase() === order[1]);
        return o ? orderContext({ id: o.id, model: o.model, modelVariant: o.modelVariant }) : null;
      }
      const piece = /^piece-(o\d{2}-[a-z]-\d{5,6})$/.exec(key);
      if (piece) {
        const p = (await this.deps.api.products()).find((x) => x.productId.toLowerCase() === piece[1]);
        return p ? pieceContext({ productId: p.productId, model: p.model, modelVariant: p.modelVariant }) : null;
      }
    } catch (e) {
      this.deps.session.noteError(e);
    }
    return null;
  }

  /** The subject shown: the conversation's, or the one not written yet. */
  private shown(): Subject {
    const s = this.subjects.find((x) => x.key === this.selected);
    if (s) return s;
    const p = this.pending!;
    return { key: this.pendingKey(p), kind: p.kind, title: p.label, target: targetOfContext(p), context: { kind: p.kind, id: p.id, ...(p.about ? { about: p.about } : {}) }, items: [], lastAt: null, unread: false, pending: true };
  }

  /** Another subject chosen: drawn in place, its address in the page's entry; the conversation at its latest message. */
  private choose(key: string): void {
    if (key === this.selected) return;
    this.selected = key;
    this.sentOn = null;
    this.opened.add(key);
    const s = this.subjects.find((x) => x.key === key);
    if (s) s.unread = false;
    if (key === FROM_ORBES_KEY) this.readHouseShown();
    if (this.pending && key !== this.pendingKey(this.pending)) this.pending = null;
    this.deps.onSubject(key, this.pending);
    this.render();
    this.toLatest();
    this.root.querySelector<HTMLElement>(`.d-msg__subject[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  /** WRITE TO ORBES CLIENT SERVICES under FROM ORBES: GENERAL, its reply ready to write. */
  private toGeneral(): void {
    this.choose(GENERAL);
    this.root.querySelector<HTMLElement>('#messages-reply')?.focus({ preventScroll: true });
  }

  /**
   * The conversation scrolled to its latest message (it opens on the newest message, §10.30; kept there when the window
   * changes). A message the scroll cuts at the top that shows only its foot (the room under its words and its
   * hairline): the conversation's end takes that much more room (`--d-msg-tail`), so it goes up under the heads and no
   * second hairline stands under theirs. One whose signature would stand within the veil under the heads' hairline
   * (24 px): the end stands up to the newest message's foot higher, so the signature is 24 px under the hairline; a
   * signature the top cuts through goes up under the heads.
   */
  private toLatest(): void {
    const box = this.root.querySelector<HTMLElement>('.d-msg__conversation');
    if (!box) return;
    box.style.removeProperty('--d-msg-tail');
    box.scrollTop = box.scrollHeight;
    let back = 0;
    const top = box.getBoundingClientRect().top + box.clientTop;
    const all = [...box.querySelectorAll<HTMLElement>(':scope > .d-msg__message')];
    for (const m of all) {
      const r = m.getBoundingClientRect();
      if (r.bottom <= top + 0.5) continue;
      if (r.top < top - 0.5) {
        const foot = (Number.parseFloat(getComputedStyle(m).paddingBottom) || 0) + 1;
        const author = m.querySelector<HTMLElement>(':scope > .d-msg__author')?.getBoundingClientRect();
        // The newest message's own room under its words (its foot, no hairline): the end may stand that much higher.
        const last = all[all.length - 1];
        const spare = last && last !== m ? Number.parseFloat(getComputedStyle(last).paddingBottom) || 0 : 0;
        if (r.bottom - top <= foot) {
          // Only its foot shows: it goes up under the heads.
          box.style.setProperty('--d-msg-tail', `${Math.ceil(r.bottom - top)}px`);
          box.scrollTop = box.scrollHeight;
        } else if (author && author.bottom > top + 0.5 && author.top < top + VEIL) {
          // Its signature just under the heads' hairline: the end a little higher, the signature 24 px under the
          // hairline (the newest message's words still whole, only its foot under the conversation's edge); a
          // signature the top cuts through goes up instead.
          const need = top + VEIL - author.top;
          if (author.top >= top - 0.5 && need <= spare) {
            back = Math.ceil(need);
            box.scrollTop = box.scrollHeight - box.clientHeight - back;
          } else {
            box.style.setProperty('--d-msg-tail', `${Math.ceil(author.bottom - top)}px`);
            box.scrollTop = box.scrollHeight;
          }
        }
      }
      break;
    }
    this.keepEnds(back);
  }

  /**
   * The conversation's sizes read, to know after a change of the window whether it stood at its end (`back`: how much
   * higher than its very end toLatest set it, its first signature clear of the heads).
   */
  private keepEnds(back = this.ends?.back ?? 0): void {
    const box = this.root.querySelector<HTMLElement>('.d-msg__conversation');
    this.ends = box ? { height: box.scrollHeight, client: box.clientHeight, back } : null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private render(): void {
    const title = h('h1', { class: 'n-g d-msg__title', id: 'messages-title', attrs: { tabindex: -1 }, text: MESSAGES.title });
    if (this.load.kind === 'loading') {
      this.app.replaceChildren(h('div', { class: 'd-msg__top' }, title), h('div', { class: 'd-msg__wait' }, loadingState(PIECES.loading)));
      return;
    }
    if (this.load.kind === 'failed') {
      this.app.replaceChildren(
        h('div', { class: 'd-msg__top' }, title),
        h('div', { class: 'd-msg__wait' }, failedState({ sentence: MESSAGES.title, reason: this.load.message, retry: PIECES.retry, onRetry: () => void this.read({ first: true }) })),
      );
      return;
    }
    const focusedKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.d-msg__subject')?.dataset.key;
    const s = this.shown();
    const subjects = this.pending && !this.subjects.some((x) => x.key === s.key) ? [s, ...this.subjects] : this.subjects;
    this.app.replaceChildren(
      // In the eye's order (§10.17): MESSAGES and its subjects (the left part), then the conversation's head and the
      // conversation; the grid places each part (desktop-messages.css).
      h('div', { class: 'd-msg__top' }, title),
      h('nav', { class: 'd-msg__list', attrs: { 'aria-label': DESKTOP.messages.subjects } }, h('ul', { class: 'd-msg__subjects' }, ...subjects.map((x) => this.row(x, x.key === s.key)))),
      this.head(s),
      this.pane(s),
    );
    this.watchRoom();
    if (focusedKey) this.root.querySelector<HTMLElement>(`.d-msg__subject[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  }

  /** A subject in the list: its name, its latest message's date and time, NEW while an unread answer stands on it. */
  private row(s: Subject, current: boolean): HTMLElement {
    const latest = s.kind === 'HOUSE' ? this.house?.items[0]?.author : s.items.at(-1)?.author;
    const at = latest?.split(' · ').slice(1).join(' · ') ?? '';
    const a = appAnchor(
      messagesPath(s.key),
      ['d-msg__subject', current ? 'is-current' : null, s.unread ? 'is-unread' : null],
      () => this.choose(s.key),
      h('span', { class: 'd-msg__subject-top' }, h('span', { class: 'n-g d-msg__subject-name' }, ...subjectLine(s.title)), s.unread ? h('span', { class: 'n-g n-lb d-msg__new', text: MESSAGES.new }) : null),
      ...(at ? [h('span', { class: 'n-g n-lb d-msg__subject-at' }, ...withNumerals(at))] : []),
    );
    a.dataset.key = s.key;
    if (current) a.setAttribute('aria-current', 'true');
    return h('li', { class: 'd-msg__item' }, a);
  }

  /**
   * The conversation's head: CONCERNING and, on its line at the right, the way to the place the subject names; under
   * them the subject's name across the part. The head as tall for every subject (desktop-messages.css), so the heads'
   * hairline and MESSAGES never move from one subject to the next.
   */
  private head(s: Subject): HTMLElement {
    const see = s.target ? this.seeLink(s.target) : null;
    return h(
      'header',
      { class: 'd-msg__head' },
      h('div', { class: 'd-msg__head-line' }, s.kind === 'GENERAL' || s.kind === 'HOUSE' ? null : h('p', { class: 'n-g n-lb d-msg__concerning', text: MESSAGES.concerning }), see),
      h('h2', { class: 'n-g d-msg__subject-title', id: 'messages-subject' }, ...subjectLine(s.title)),
    );
  }

  private seeLink(target: ConcerningTarget): HTMLElement {
    const words = target.to === 'order' ? DESKTOP.messages.seeOrder : target.to === 'piece' ? PIECES.seePiece : target.to === 'release' ? RELEASES.see : target.to === 'sheet' ? LOOKBOOK.seeModel : PIECES.link;
    return textLink(words, { onOpen: () => this.deps.onConcerning(target), extraClass: 'd-msg__see' });
  }

  /** The conversation (or what is said before its first message), then the reply at its foot. */
  private pane(s: Subject): HTMLElement {
    if (s.kind === 'HOUSE') return this.housePane();
    const conversation =
      s.items.length > 0
        ? h(
            'ol',
            { class: 'd-msg__conversation', attrs: { 'aria-labelledby': 'messages-subject', tabindex: 0 } },
            ...s.items.map((m) =>
              h(
                'li',
                { class: ['d-msg__message', 'n-messages__item', m.mine ? 'n-messages__item--mine' : 'd-msg__message--house'], attrs: { 'data-testid': 'message' } },
                h('p', { class: 'n-g n-lb n-messages__author d-msg__author' }, ...withNumerals(m.author)),
                h('p', { class: 'n-tx n-messages__body d-msg__body', text: m.body }),
              ),
            ),
          )
        : h(
            'div',
            { class: 'd-msg__conversation d-msg__conversation--none' },
            // A subject opened from WRITE TO ORBES CLIENT SERVICES, before its first message: the write sheet's title over
            // its line, so the page says to whom it is written (its words the phone's sheet's).
            s.pending ? h('p', { class: 'n-g n-lb d-msg__write', text: MESSAGES.write }) : null,
            h('p', { class: 'n-tx d-msg__none', text: s.pending ? MESSAGES.where : MESSAGES.emptyThread }),
          );
    return h('section', { class: 'd-msg__pane', attrs: { 'aria-labelledby': 'messages-subject' } }, conversation, this.reply(s));
  }

  /**
   * FROM ORBES: its messages oldest first (SHOW EARLIER over them past a page), each its author line (ORBES and when, NEW
   * on one unread as the page opened), title, words and links; at its foot, in place of the reply, the line that no
   * reply is written there and WRITE TO ORBES CLIENT SERVICES (GENERAL).
   */
  private housePane(): HTMLElement {
    const list = this.house;
    const earlier = this.earlier;
    const conversation = list
      ? h(
          'ol',
          { class: 'd-msg__conversation d-msg__house', attrs: { 'aria-labelledby': 'messages-subject', tabindex: 0 } },
          list.more || earlier.busy || earlier.error
            ? h(
                'li',
                { class: 'd-msg__earlier' },
                earlier.error ? h('p', { class: 'n-err d-msg__earlier-error', attrs: { role: 'alert' } }, `${FROM_ORBES.earlierFailed} ${earlier.error}`) : null,
                earlier.busy
                  ? h('p', { class: 'n-g n-lb n-ivc', attrs: { role: 'status' }, text: FROM_ORBES.loading })
                  : textLink(earlier.error ? FROM_ORBES.retry : FROM_ORBES.earlier, { onOpen: () => void this.houseMore() }),
              )
            : null,
          ...[...list.items].reverse().map((m) => this.houseMessage(m)),
        )
      : this.houseRetrying
        ? h(
            'div',
            { class: 'd-msg__conversation d-msg__conversation--none d-msg__house-failed' },
            h('p', { class: 'n-g n-lb n-ivc d-msg__house-wait', attrs: { role: 'status', tabindex: -1 }, text: FROM_ORBES.loading }),
          )
        : h(
            'div',
            { class: 'd-msg__conversation d-msg__conversation--none d-msg__house-failed' },
            failedState({ sentence: FROM_ORBES.unreadable, reason: this.houseError ?? '', retry: FROM_ORBES.retry, onRetry: () => void this.retryHouse() }),
          );
    const foot = h(
      'div',
      { class: 'd-msg__reply d-msg__noreply' },
      h('p', { class: 'n-sm d-msg__noreply-text', text: FROM_ORBES.noReply }),
      button(MESSAGES.write, { outline: true, onClick: () => this.toGeneral(), extraClass: 'd-msg__noreply-write' }),
    );
    return h('section', { class: 'd-msg__pane', attrs: { 'aria-labelledby': 'messages-subject' } }, conversation, foot);
  }

  /** A house message of FROM ORBES. */
  private houseMessage(m: HouseItem): HTMLElement {
    return h(
      'li',
      { class: ['d-msg__message', 'n-messages__item', 'd-msg__message--house', 'd-msg__house-message'], attrs: { 'data-testid': 'house-message' } },
      h('p', { class: 'n-g n-lb n-messages__author d-msg__author' }, h('span', {}, ...withNumerals(m.author)), m.unread ? h('span', { class: 'd-msg__house-new', text: MESSAGES.new }) : null),
      h('p', { class: 'n-g n-t3 n-ivc d-msg__house-title' }, ...withNumerals(m.title)),
      h('p', { class: 'n-tx n-messages__body d-msg__body', text: m.body }),
      m.links.length > 0 ? h('p', { class: 'd-msg__house-links' }, ...m.links.map((l) => textLink(l.label, { onOpen: () => this.deps.onHouse(l.target), extraClass: 'd-msg__house-link' }))) : null,
    );
  }

  /** YOUR REPLY (YOUR MESSAGE before the first), its hint, SEND; CANCEL too on a subject not written yet. */
  private reply(s: Subject): HTMLElement {
    const label = s.items.length === 0 ? MESSAGES.yourMessage : MESSAGES.yourReply;
    const area = h('textarea', {
      class: 'n-fld__input n-write__area d-msg__area',
      id: 'messages-reply',
      attrs: { name: 'message', rows: REPLY_LINES.min, maxlength: MESSAGES.max, required: true, 'aria-describedby': 'messages-reply-hint', autocomplete: 'off' },
    });
    area.value = this.drafts.get(s.key) ?? '';
    // MESSAGE SENT and the write sheet's own sentence under it (decision 12: nothing of the phone's confirmation goes).
    const sent =
      this.sentOn === s.key
        ? h('div', { class: 'd-msg__sent-words', attrs: { role: 'status' } }, h('p', { class: 'n-g n-lb d-msg__sent', text: MESSAGES.sent }), h('p', { class: 'n-sm d-msg__sent-text', text: MESSAGES.sentText }))
        : null;
    area.addEventListener('input', () => {
      this.drafts.set(s.key, area.value);
      grow(area);
      if (sent?.isConnected) sent.remove();
    });
    const field = h(
      'div',
      { class: 'n-fld-group d-msg__field' },
      h('label', { class: 'n-fld', attrs: { for: 'messages-reply' } }, h('span', { class: 'n-g n-lab', text: label })),
      area,
      h('p', { class: 'n-sm n-fld__hint d-msg__hint', id: 'messages-reply-hint', text: MESSAGES.hint }),
    );
    const cancel = s.pending ? button(MESSAGES.cancel, { outline: true, onClick: () => this.deps.onCancel(), extraClass: 'd-msg__cancel' }) : null;
    const form = nocturneForm(
      this.deps.session,
      'reply',
      [field],
      MESSAGES.send,
      async () => {
        const problem = messageProblem(area.value);
        if (problem) {
          area.setAttribute('aria-invalid', 'true');
          throw new FormError(problem);
        }
        const words = messageText(area.value);
        let message: AccountMessage;
        try {
          message = await this.deps.api.writeMessage(words, s.context);
        } catch (e) {
          // A reply on a subject the server no longer lets the message attach (a scan over 24 hours old, a piece no
          // longer held, a model out of the account's reach): the same words with no context, as the phone sends every
          // reply, filed under GENERAL. A subject not written yet keeps the server's refusal.
          if (!(s.context && s.items.length > 0 && e instanceof ApiError && CONTEXT_GONE.has(e.code))) throw e;
          message = await this.deps.api.writeMessage(words, null);
        }
        this.drafts.delete(s.key);
        this.pending = null;
        // The subject the message now stands on (its own, or GENERAL for one that could no longer be attached).
        const into = this.subjectWith(message);
        this.sentOn = into;
        await this.read({ select: into });
        this.root.querySelector<HTMLElement>('#messages-reply')?.focus({ preventScroll: true });
        this.toLatest();
      },
      cancel ?? undefined,
    );
    // MESSAGE SENT beside the actions, on the reply's foot (SEND, and CANCEL, at its right end).
    const actions = form.querySelector<HTMLElement>(':scope > .n-form__actions');
    actions?.prepend(h('div', { class: 'd-msg__foot-words' }, sent));
    queueMicrotask(() => grow(area));
    return h('div', { class: 'd-msg__reply n-messages__reply' }, form);
  }

  /** The subject a message just written stands on. */
  private subjectWith(m: AccountMessage): string {
    const c = m.concerning;
    return c ? keyOf(c.kind, c.ref ?? null, c.label, concerningTarget(c.path)) : GENERAL;
  }
}

/** The server's refusals of a context that held when the subject was written and holds no longer (services/messages.ts resolveContext). */
const CONTEXT_GONE: ReadonlySet<string> = new Set(['MESSAGE_CONTEXT_EXPIRED', 'MESSAGE_CONTEXT_INVALID']);

/** What the conversation keeps, at least, when the reply grows (px): a message's author and two of its lines. */
const CONVERSATION_LEAST = 120;

/**
 * A reply box as tall as its words, one line to six, as far as the pane has room: the conversation keeps
 * CONVERSATION_LEAST above it (in a short window the box stops at fewer lines, two at the least); then it scrolls. A box
 * that scrolls is as tall as whole lines and one padding, so at its top as at its end it shows whole lines, never a
 * line cut under its label; written at its end, it shows its end. The conversation, read to its end, stays at its end as
 * the box grows or shrinks (its last message never cut by the reply's line).
 */
function grow(area: HTMLTextAreaElement): void {
  const style = getComputedStyle(area);
  const line = Number.parseFloat(style.lineHeight) || 26;
  const top = Number.parseFloat(style.paddingTop) || 0;
  const bottom = Number.parseFloat(style.paddingBottom) || 0;
  const border = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
  let lines: number = REPLY_LINES.max;
  const pane = area.closest<HTMLElement>('.d-msg__pane');
  const reply = area.closest<HTMLElement>('.d-msg__reply');
  const conversation = pane?.querySelector<HTMLElement>(':scope > .d-msg__conversation') ?? null;
  const atEnd = !!conversation && conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 2;
  if (pane && reply) {
    const around = reply.getBoundingClientRect().height - area.getBoundingClientRect().height;
    const room = pane.getBoundingClientRect().height - around - CONVERSATION_LEAST - Math.max(top, bottom) - border;
    lines = Math.min(REPLY_LINES.max, Math.max(2, Math.floor(room / line)));
  }
  area.style.height = 'auto';
  const full = area.scrollHeight + border;
  const least = Math.max(Number.parseFloat(style.minHeight) || 0, line * REPLY_LINES.min + top + bottom + border);
  const most = Math.max(least, line * lines + Math.max(top, bottom) + border);
  area.style.height = `${Math.min(Math.max(full, least), most)}px`;
  const scrolls = full > most + 0.5;
  area.style.overflowY = scrolls ? 'auto' : 'hidden';
  if (scrolls && area.selectionEnd === area.value.length) area.scrollTop = area.scrollHeight;
  if (atEnd && conversation) conversation.scrollTop = conversation.scrollHeight;
}
