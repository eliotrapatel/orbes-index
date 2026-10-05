/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+ of 2026-10-04, choice 11, G4): one question, its 2 to 6 answers,
 * asked once the release has ended, for LIVE_QUESTION_OPEN_DAYS days, answered in one tap and changeable while it is open.
 *
 *   the question   on by default; the default words (services/live.ts LIVE_QUESTION_DEFAULT: « WHAT WOULD YOU HAVE
 *                  WANTED? », ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND) unless the console rewrites them for
 *                  the release (`drops.question_text` and `question_answers`, both or neither); turned off, never asked
 *                  (its words kept for later). An after-room asks none (its release's line was asked).
 *   who is asked   from the release's recorded end (`ended_at`, the end of its sales, as THE RELEASES' PAST reads it)
 *                  until LIVE_QUESTION_OPEN_DAYS days later:
 *                   - TOOK_PART, on the release's end page: a collector who took part (a place in its line, whatever
 *                     became of it, never REMOVED: services/participation.ts) and secured no piece there (none
 *                     CONFIRMED, its after-room's included);
 *                   - INTEREST, in MY PIECES: a collector who said I'LL BE THERE and never had a place in its line (did
 *                     not come, or left the room before T0).
 *                  Anyone else is never asked (403 LIVE_QUESTION_NOT_ASKED), nor anyone before the end or after the
 *                  week (409 LIVE_QUESTION_CLOSED).
 *   the answer     the position of the answer chosen (1 to 6) in `release_answers`, one per account and release,
 *                  changed in place (`answered_at` the latest). Audited `drop.live.answer` with the release's id and the
 *                  position (and the one it replaced): ids and positions only.
 *   the console    on the release's page, the question as asked, when it is open, how many are asked in each place,
 *                  how many answered and each answer's count (`tally`); a segment's criterion reads the answers too
 *                  (services/segments.ts).
 */
import { sql, type Expression } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { DropRow } from '../db/schema.js';
import { conflict, DomainError, forbidden, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { dropNotFound } from './drops.js';
import { liveStages, stagesAt, LIVE_QUESTION_DEFAULT } from './live.js';
import { readActingAccount } from './ownership.js';
import { securedIn, tookPartIn } from './participation.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The question stays open this many days after the release's end. */
export const LIVE_QUESTION_OPEN_DAYS = 7;
/** Its words: one line of 1 to 120 characters (drops.question_text); 2 to 6 answers, each one line of 1 to 40. */
export const LIVE_QUESTION_LIMITS = Object.freeze({ text: 120, answer: 40, minAnswers: 2, maxAnswers: 6 });

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Where a collector is asked: on the release's end page (took part, no piece), or in MY PIECES (I'LL BE THERE, never came). */
export type QuestionAsked = 'TOOK_PART' | 'INTEREST';

/** A release's question as asked: its own words, or the default ones. */
export interface ReleaseQuestion {
  text: string;
  answers: string[];
  /** Rewritten for this release (false: the default question). */
  custom: boolean;
}

/** The question of a release as its row says it; null when it asks none (off, a draw, an after-room). */
export function releaseQuestion(d: Pick<DropRow, 'mode' | 'parent_drop_id' | 'question_enabled' | 'question_text' | 'question_answers'>): ReleaseQuestion | null {
  if (d.mode !== 'LIVE' || d.parent_drop_id !== null || d.question_enabled === false) return null;
  return questionWords(d);
}

/** A release's words, whether it asks them or not: its own, else the default question's. */
export function questionWords(d: Pick<DropRow, 'question_text' | 'question_answers'>): ReleaseQuestion {
  return d.question_text && d.question_answers
    ? { text: d.question_text, answers: [...d.question_answers], custom: true }
    : { text: LIVE_QUESTION_DEFAULT.text, answers: [...LIVE_QUESTION_DEFAULT.answers], custom: false };
}

/** When the question is open: from the recorded end, LIVE_QUESTION_OPEN_DAYS days; null before the end. */
export function questionWindow(d: Pick<DropRow, 'ended_at'>): { opensAt: Date; closesAt: Date } | null {
  if (!d.ended_at) return null;
  const opensAt = new Date(d.ended_at);
  return { opensAt, closesAt: new Date(opensAt.getTime() + LIVE_QUESTION_OPEN_DAYS * DAY_MS) };
}

/** Whether the question is open at `now`. */
export function questionOpen(d: Pick<DropRow, 'ended_at'>, now: Date): boolean {
  const w = questionWindow(d);
  return w !== null && now.getTime() >= w.opensAt.getTime() && now.getTime() < w.closesAt.getTime();
}

/** A one-line text the console types: trimmed, 1 to `max` characters, no control character. */
function line(v: unknown, max: number, what: string): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < 1 || s.length > max || CONTROL_CHARS.test(s)) throw validationError(`${what} is one line of 1 to ${max} characters.`);
  return s;
}

/**
 * The words the console sets (null and null: the default question): the question and its 2 to 6 answers, both or
 * neither, each answer once whatever the case; the default's own words are stored as the default (null).
 */
export function cleanQuestionWords(text: unknown, answers: unknown): { text: string | null; answers: string[] | null } {
  const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  if (empty(text) && empty(answers)) return { text: null, answers: null };
  if (empty(text) || empty(answers)) throw validationError('The question and its answers are written together: leave both empty to ask the default question.');
  const t = line(text, LIVE_QUESTION_LIMITS.text, 'The question');
  if (!Array.isArray(answers) || answers.length < LIVE_QUESTION_LIMITS.minAnswers || answers.length > LIVE_QUESTION_LIMITS.maxAnswers) {
    throw validationError(`The question has ${LIVE_QUESTION_LIMITS.minAnswers} to ${LIVE_QUESTION_LIMITS.maxAnswers} answers.`);
  }
  const out = answers.map((a) => line(a, LIVE_QUESTION_LIMITS.answer, 'An answer'));
  const seen = new Set<string>();
  for (const a of out) {
    if (seen.has(a.toUpperCase())) throw validationError(`The answer ${a} is listed twice.`);
    seen.add(a.toUpperCase());
  }
  const isDefault = t === LIVE_QUESTION_DEFAULT.text && out.length === LIVE_QUESTION_DEFAULT.answers.length && out.every((a, i) => a === LIVE_QUESTION_DEFAULT.answers[i]);
  return isDefault ? { text: null, answers: null } : { text: t, answers: out };
}

// ── Errors ─────────────────────────────────────────────────────────────────

const notAsked = () => new DomainError('LIVE_QUESTION_NOT_ASKED', 403, 'This question is for the collectors who took part in this release without a piece, or who said they would be there.');
const closed = () => conflict('LIVE_QUESTION_CLOSED', 'This question is closed.');

// ── Views ──────────────────────────────────────────────────────────────────

/** The question as a collector it is asked of reads it (the release's end page, MY PIECES). */
export interface AccountQuestion {
  /** The release. */
  dropId: string;
  /** Its name once revealed (its model's), its opening: how MY PIECES names it; null when it ended before its name. */
  name: string | null;
  opensAt: Date;
  text: string;
  answers: string[];
  /** The answer chosen (its position, from 1), or null. */
  answer: number | null;
  /** Open until then. */
  closesAt: Date;
  asked: QuestionAsked;
}

/** The question of a release as the console reads it. */
export interface AdminQuestion extends ReleaseQuestion {
  enabled: boolean;
  /** OFF (never asked), WAITING (until the end), OPEN (the week after it), CLOSED. */
  state: 'OFF' | 'WAITING' | 'OPEN' | 'CLOSED';
  opensAt: Date | null;
  closesAt: Date | null;
  /** The collectors asked, in each place, as they stand now. */
  asked: { tookPart: number; interest: number };
  answered: number;
  /** Each answer in order: its position, its words, how many chose it. */
  tally: { answer: number; label: string; count: number }[];
}

type QuestionRow = Pick<DropRow, 'id' | 'mode' | 'parent_drop_id' | 'published_at' | 'cancelled_at' | 'ended_at' | 'announce_at' | 'silhouette_at' | 'name_at' | 'photo_at' | 'opens_at' | 'room_opens_minutes' | 'question_enabled' | 'question_text' | 'question_answers'> & { model_name: string };

// ── Service ────────────────────────────────────────────────────────────────

export interface QuestionServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class QuestionService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: QuestionServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * The question of a release for a signed-in account, now: null when it is not asked of it (or not open). 404 for
   * anything but a published LIVE RELEASE (an after-room, a draft, a cancelled one: the same as an unknown release).
   */
  async forAccount(accountId: string, dropId: string): Promise<AccountQuestion | null> {
    const account = assertAccount(accountId);
    const d = await this.release(this.db, knownId(dropId));
    const now = this.clock();
    return this.asked(this.db, d, account, now);
  }

  /** The questions open for an account in MY PIECES (it said I'LL BE THERE and never came), the latest end first. */
  async forPieces(accountId: string): Promise<AccountQuestion[]> {
    const account = assertAccount(accountId);
    const now = this.clock();
    const since = new Date(now.getTime() - LIVE_QUESTION_OPEN_DAYS * DAY_MS);
    const rows = await this.reads(this.db)
      .where('d.ended_at', 'is not', null)
      .where('d.ended_at', '<=', now)
      .where('d.ended_at', '>', since)
      .where((eb) => eb.exists(eb.selectFrom('live_interest as i').select('i.drop_id').whereRef('i.drop_id', '=', 'd.id').where('i.account_id', '=', account)))
      .orderBy('d.ended_at', 'desc')
      .orderBy('d.id')
      .execute();
    const out: AccountQuestion[] = [];
    for (const d of rows) {
      const q = await this.asked(this.db, d, account, now);
      if (q?.asked === 'INTEREST') out.push(q);
    }
    return out;
  }

  /**
   * One tap: the answer `answer` (its position, from 1) to the release's question, chosen or changed while it is open,
   * by an account it is asked of. Audited `drop.live.answer`; the same answer again changes nothing.
   */
  async answer(accountId: string, dropId: string, answer: number, actor: Actor): Promise<AccountQuestion> {
    const account = assertAccount(accountId);
    const id = knownId(dropId);
    if (!Number.isInteger(answer) || answer < 1 || answer > LIVE_QUESTION_LIMITS.maxAnswers) throw validationError('Choose one of the answers.');
    await inTransaction(this.db, async (tx) => {
      const acting = await readActingAccount(tx, account);
      if (!acting || acting.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const d = await this.release(tx, id);
      const now = this.clock();
      const words = releaseQuestion(d);
      if (!words || !questionOpen(d, now)) throw closed();
      if (!(await this.askedWhere(tx, d.id, account, now))) throw notAsked();
      if (answer > words.answers.length) throw validationError('Choose one of the answers.');
      const before = await tx.selectFrom('release_answers').select('answer').where('drop_id', '=', d.id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (before?.answer === answer) return;
      await tx
        .insertInto('release_answers')
        .values({ drop_id: d.id, account_id: account, answer, answered_at: now })
        .onConflict((oc) => oc.columns(['drop_id', 'account_id']).doUpdateSet({ answer, answered_at: now }))
        .execute();
      await this.audit.record({ actor, action: 'drop.live.answer', targetType: 'drop', targetId: d.id, details: { answer, ...(before ? { before: before.answer } : {}) } }, tx);
    });
    return (await this.forAccount(account, id))!;
  }

  /** The question of a release in the console: its words, when it is open, who is asked, the answers counted. */
  async tally(d: Pick<DropRow, 'id' | 'mode' | 'parent_drop_id' | 'ended_at' | 'question_enabled' | 'question_text' | 'question_answers'>, db: Db = this.db): Promise<AdminQuestion> {
    const now = this.clock();
    const words = questionWords(d);
    const enabled = d.parent_drop_id === null && d.mode === 'LIVE' && d.question_enabled !== false;
    const window = questionWindow(d);
    const state: AdminQuestion['state'] = !enabled ? 'OFF' : !window ? 'WAITING' : now.getTime() < window.closesAt.getTime() ? 'OPEN' : 'CLOSED';
    const [tookPart, interest, answers] = await Promise.all([
      db
        .selectFrom('accounts as a')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where((eb) => tookPartIn(db, now, eb.ref('a.id'), d.id))
        .where((eb) => eb.not(securedIn(db, eb.ref('a.id'), d.id)))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('live_interest as i')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('i.drop_id', '=', d.id)
        .where((eb) => eb.not(eb.exists(this.placed(db, eb.ref('i.account_id'), d.id))))
        .executeTakeFirstOrThrow(),
      db.selectFrom('release_answers').select((eb) => ['answer', eb.fn.countAll<number>().as('n')]).where('drop_id', '=', d.id).groupBy('answer').execute(),
    ]);
    const counts = new Map(answers.map((a) => [a.answer, Number(a.n)]));
    return {
      ...words,
      enabled,
      state,
      opensAt: window?.opensAt ?? null,
      closesAt: window?.closesAt ?? null,
      asked: { tookPart: Number(tookPart.n), interest: Number(interest.n) },
      answered: [...counts.values()].reduce((a, b) => a + b, 0),
      tally: words.answers.map((label, i) => ({ answer: i + 1, label, count: counts.get(i + 1) ?? 0 })),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private reads(db: Db) {
    return db
      .selectFrom('drops as d')
      .innerJoin('models as m', 'm.id', 'd.model_id')
      .select([
        'd.id', 'd.mode', 'd.parent_drop_id', 'd.published_at', 'd.cancelled_at', 'd.ended_at', 'd.announce_at', 'd.silhouette_at', 'd.name_at', 'd.photo_at', 'd.opens_at',
        'd.room_opens_minutes', 'd.question_enabled', 'd.question_text', 'd.question_answers', 'm.name as model_name',
      ])
      .where('d.mode', '=', 'LIVE')
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.parent_drop_id', 'is', null);
  }

  /** A published LIVE RELEASE (never an after-room, a draft or a cancelled one: 404); its question no longer changes once announced. */
  private async release(db: Db, id: string): Promise<QuestionRow> {
    const d = await this.reads(db).where('d.id', '=', id).executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  /** A place in the release's line (any entry with a position: REMOVED ones too, for they came). */
  private placed(db: Db, account: Expression<string>, dropId: string) {
    return db
      .selectFrom('live_entries as pe')
      .innerJoin('drops as pd', 'pd.id', 'pe.drop_id')
      .select('pe.id')
      .where('pe.account_id', '=', account)
      .where('pe.position', 'is not', null)
      .where(sql<string>`coalesce(pd.parent_drop_id, pd.id)`, '=', dropId);
  }

  /** Where the account is asked the release's question at `now` (its words aside), or null. */
  private async askedWhere(db: Db, dropId: string, account: string, now: Date): Promise<QuestionAsked | null> {
    const r = await db
      .selectFrom('accounts as a')
      .select((eb) => [
        sql<boolean>`${tookPartIn(db, now, eb.ref('a.id'), dropId)}`.as('took_part'),
        sql<boolean>`${securedIn(db, eb.ref('a.id'), dropId)}`.as('secured'),
        eb.exists(eb.selectFrom('live_interest as i').select('i.drop_id').where('i.drop_id', '=', dropId).whereRef('i.account_id', '=', 'a.id')).as('interest'),
        eb.exists(this.placed(db, eb.ref('a.id'), dropId)).as('placed'),
      ])
      .where('a.id', '=', account)
      .executeTakeFirst();
    if (!r) return null;
    if (r.took_part) return r.secured ? null : 'TOOK_PART';
    return r.interest && !r.placed ? 'INTEREST' : null;
  }

  /** The question as the account reads it at `now`, when it is asked of it and open; null otherwise. */
  private async asked(db: Db, d: QuestionRow, account: string, now: Date): Promise<AccountQuestion | null> {
    const words = releaseQuestion(d);
    const window = questionWindow(d);
    if (!words || !window || !questionOpen(d, now)) return null;
    const where = await this.askedWhere(db, d.id, account, now);
    if (!where) return null;
    const chosen = await db.selectFrom('release_answers').select('answer').where('drop_id', '=', d.id).where('account_id', '=', account).executeTakeFirst();
    const stages = liveStages(d, stagesAt(d, now));
    return {
      dropId: d.id,
      name: stages?.name ? d.model_name : null,
      opensAt: d.opens_at,
      text: words.text,
      answers: words.answers,
      answer: chosen && chosen.answer <= words.answers.length ? chosen.answer : null,
      closesAt: window.closesAt,
      asked: where,
    };
  }
}

function assertAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
  return accountId.toLowerCase();
}

function knownId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw dropNotFound();
  return id.toLowerCase();
}

/** An answer to a question after, as the account's export gives it. */
export interface ExportedReleaseAnswer {
  dropId: string;
  title: string;
  question: string;
  /** Its position (from 1) and its words. */
  answer: number;
  answerText: string | null;
  answeredAt: Date;
}

/** The account's answers to the questions after (the right of access, services/owners.ts), oldest first. */
export async function accountReleaseAnswers(db: Db, accountId: string): Promise<ExportedReleaseAnswer[]> {
  const rows = await db
    .selectFrom('release_answers as r')
    .innerJoin('drops as d', 'd.id', 'r.drop_id')
    .select(['r.drop_id', 'd.title', 'd.question_text', 'd.question_answers', 'r.answer', 'r.answered_at'])
    .where('r.account_id', '=', assertAccount(accountId))
    .orderBy('r.answered_at')
    .orderBy('r.drop_id')
    .execute();
  return rows.map((r) => {
    const words = questionWords(r);
    return { dropId: r.drop_id, title: r.title, question: words.text, answer: r.answer, answerText: words.answers[r.answer - 1] ?? null, answeredAt: r.answered_at };
  });
}
