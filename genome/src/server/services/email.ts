/**
 * The emails' channel (macro scope E0; lot M1 plan §4.1; migration 0051): the outbox every email goes through, its
 * sender, its purge, and the links that stop an email.
 *
 *   enqueue     in the transaction of the act that causes the email (an outbox): the kind's words (the console's
 *               email_templates row, or email/copy.ts's) filled with the trigger's values and rendered in the house's
 *               look (email/render.ts) once, so the outbox keeps exactly what is sent. Nothing is written while the
 *               channel is off (EMAIL_TRANSPORT unset or `off`) or the kind is not switched on (no row is off); the
 *               `dedupe_key` makes every trigger idempotent (a second enqueue of a key writes nothing). An address the
 *               envelope cannot carry (not plain ASCII) is left out.
 *   sendDue     the sender: every EMAIL_SENDER.intervalMs (15 s) while the channel is on (start, from context.ts), the
 *               QUEUED rows due, oldest first, at most EMAIL_SENDER.batch (50) a pass. Each is claimed first (FOR UPDATE
 *               SKIP LOCKED, its attempt counted and its `not_before` moved a lease ahead), so two processes never send
 *               one email at once; then sent over SMTP (email/smtp.ts), one connection each. Sent: SENT. Refused for
 *               good by the server (a 5xx to the address or the message): FAILED at once. Any other failure is tried
 *               again 1 min, 5 min, 30 min, then 2 h later, then FAILED. `last_error` keeps the step and the server's
 *               words, never the credentials. The log says `email sent` / `email failed` with the kind and the row's
 *               id, never the address.
 *   purge       housekeeping's `emailPurge` (context.ts): a row 90 days (EMAIL_RETENTION_DAYS) after it was sent,
 *               failed or was cancelled (`settled_at`) is erased, address, subject and words with it.
 *   unsubscribe the link of an email one may stop (the founding announcement, E1; the release notices, E2): a token,
 *               the HMAC-SHA-256 of the kind and the person's id (the pre-registration's or the account's) under a key
 *               derived from the server's secrets as the LIVE turns' is (deriveEmailUnsubscribeKey). No table: any
 *               instance computes it again. The page (/verify/unsubscribe) and the one-click address (RFC 8058, the
 *               `List-Unsubscribe` header) carry it; their routes are lot M1 step M1.17's.
 *
 * The account's email data through its life (its export, its lock, the cancel at send time for an account no longer
 * ACTIVE), the triggers and the routes are step M1.17's; the console's Emails page M1.18's.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import { EMAIL_DEDUPE_MAX, EMAIL_ERROR_MAX, EMAIL_KINDS, type EmailKind, type EmailOutboxTable } from '../db/schema.js';
import { validationError } from '../errors.js';
import { EMAIL_DEFAULTS, EMAIL_SAMPLE_VALUES, OPT_IN_KINDS, type EmailWords } from '../email/copy.js';
import { renderEmail, type EmailValues, type RenderedEmail } from '../email/render.js';
import { buildMessage, isMailAddress, SmtpError, sendSmtp, type SmtpEnvelope, type SmtpOptions } from '../email/smtp.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import type { Selectable } from 'kysely';

/** The sender's rhythm: a pass every 15 s, 50 emails at most a pass, the retries' delays, a claim's lease. */
export const EMAIL_SENDER = Object.freeze({
  intervalMs: 15_000,
  batch: 50,
  /** After the 1st, 2nd, 3rd and 4th failed attempt; the 5th failure is final (FAILED). */
  retryMs: Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]),
  /** How long a claimed row is kept from another sender while it is being sent. */
  leaseMs: 10 * 60_000,
});

/** An email is erased this many days after it was sent, failed or was cancelled (the privacy policy's 90 days). */
export const EMAIL_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

const UNSUBSCRIBE_KEY_INFO = 'orbes/email-unsubscribe/v1';
/** The kinds one may stop, each with its token's letter. */
const UNSUBSCRIBE_LETTER: Readonly<Partial<Record<EmailKind, string>>> = Object.freeze({ FOUNDING_ANNOUNCEMENT: 'f', RELEASE_NOTICE: 'r' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The key of the unsubscribe links (32 bytes): HKDF of the key-encryption key when there is one, else of the cookie
 * secret, as the LIVE turns' (services/live.ts deriveLiveTurnKey), with its own label.
 */
export function deriveEmailUnsubscribeKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, UNSUBSCRIBE_KEY_INFO, { salt: 'ORBES' });
}

/** How the server's transport sends one message (tests may give their own). */
export type EmailTransport = (envelope: SmtpEnvelope) => Promise<void>;

export interface EmailServiceDeps {
  db: Db;
  config: Pick<AppConfig, 'email' | 'publicOrigin'>;
  /** The unsubscribe links' key (deriveEmailUnsubscribeKey). */
  unsubscribeKey: Uint8Array;
  clock?: Clock;
  log?: Logger;
  /** Replaces the SMTP transport (tests). */
  transport?: EmailTransport;
  /** Added to the SMTP options (tests: the fake server's certificate authority, shorter timeouts). */
  smtp?: Pick<SmtpOptions, 'ca' | 'timeouts'>;
}

/** What a trigger asks for. */
export interface EnqueueInput {
  kind: EmailKind;
  /** The address it goes to (the account's or the pre-registration's). */
  to: string;
  /** Once per key, ever (`E1:<drop>:<preregistration>`, `ORDER_SHIPPED:<order>`…), at most 200 characters, one line. */
  dedupeKey: string;
  accountId?: string | null;
  preregistrationId?: string | null;
  /** The placeholders' values (email/copy.ts EMAIL_PLACEHOLDERS); `unsubscribeLink` is the service's own. */
  values?: EmailValues;
  /** When it may go (default: now). */
  notBefore?: Date;
}

/** What enqueue did: queued, or why not (the channel off, the kind off, its key already used, an address left out). */
export type EnqueueResult = { queued: true; id: string } | { queued: false; reason: 'OFF' | 'KIND_OFF' | 'DUPLICATE' | 'ADDRESS' };

/** A kind's words as the console reads them: its switch, its words, and which part is its own. */
export interface EmailKindWords {
  kind: EmailKind;
  enabled: boolean;
  words: EmailWords;
  edited: { subject: boolean; body: boolean };
}

/** One pass of the sender. */
export interface SendReport {
  sent: number;
  retried: number;
  failed: number;
}

type OutboxRow = Selectable<EmailOutboxTable>;

export class EmailService {
  private readonly db: Db;
  private readonly config: EmailServiceDeps['config'];
  private readonly key: Uint8Array;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly transport: EmailTransport | null;
  private timers = false;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(deps: EmailServiceDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.key = deps.unsubscribeKey;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    const email = deps.config.email;
    this.transport =
      deps.transport ??
      (email.transport === 'smtp'
        ? async (envelope) => {
            await sendSmtp({ ...email.smtp, clientName: new URL(deps.config.publicOrigin).hostname, ...deps.smtp }, envelope);
          }
        : null);
  }

  /** Whether the channel is on (EMAIL_TRANSPORT=smtp). */
  get on(): boolean {
    return this.config.email.transport === 'smtp';
  }

  /** The channel as the console shows it: off, or on with the server's host and the sender's address. */
  channel(): { on: false } | { on: true; host: string; from: string } {
    const e = this.config.email;
    return e.transport === 'smtp' ? { on: true, host: e.smtp.host, from: e.from.address } : { on: false };
  }

  // ── Words ────────────────────────────────────────────────────────────────

  /** Every kind's switch and words (no row: off, the default words). */
  async kinds(db: Db = this.db): Promise<EmailKindWords[]> {
    const rows = await db.selectFrom('email_templates').select(['kind', 'enabled', 'subject', 'body']).execute();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return EMAIL_KINDS.map((kind) => {
      const r = byKind.get(kind);
      return {
        kind,
        enabled: r?.enabled ?? false,
        words: { subject: r?.subject ?? EMAIL_DEFAULTS[kind].subject, body: r?.body ?? EMAIL_DEFAULTS[kind].body },
        edited: { subject: (r?.subject ?? null) !== null, body: (r?.body ?? null) !== null },
      };
    });
  }

  /** One kind's switch and words. */
  async kind(kind: EmailKind, db: Db = this.db): Promise<EmailKindWords> {
    const r = await db.selectFrom('email_templates').select(['enabled', 'subject', 'body']).where('kind', '=', kind).executeTakeFirst();
    return {
      kind,
      enabled: r?.enabled ?? false,
      words: { subject: r?.subject ?? EMAIL_DEFAULTS[kind].subject, body: r?.body ?? EMAIL_DEFAULTS[kind].body },
      edited: { subject: (r?.subject ?? null) !== null, body: (r?.body ?? null) !== null },
    };
  }

  /** An email as it would be sent (the console's preview): the words given, or the kind's, with example values. */
  async preview(kind: EmailKind, words?: Partial<EmailWords>): Promise<RenderedEmail> {
    const current = (await this.kind(kind)).words;
    const sampleId = '00000000-0000-4000-8000-000000000000';
    return renderEmail({
      kind,
      words: { subject: words?.subject ?? current.subject, body: words?.body ?? current.body },
      values: { ...EMAIL_SAMPLE_VALUES, unsubscribeLink: OPT_IN_KINDS.has(kind) ? this.unsubscribeLinks(kind, sampleId).page : null },
      origin: this.config.publicOrigin,
      unsubscribeUrl: OPT_IN_KINDS.has(kind) ? this.unsubscribeLinks(kind, sampleId).page : null,
    });
  }

  // ── The outbox ───────────────────────────────────────────────────────────

  /**
   * Writes one email in the outbox, in `db`'s transaction when it is one (the act that causes it): rendered now, sent
   * from `notBefore`. Writes nothing while the channel or the kind is off, or when its key was used.
   */
  async enqueue(db: Db, input: EnqueueInput): Promise<EnqueueResult> {
    const key = input.dedupeKey;
    if (typeof key !== 'string' || key.length < 1 || key.length > EMAIL_DEDUPE_MAX || key !== key.trim() || /[\p{Cc}]/u.test(key)) {
      throw validationError('An email’s key is one line of 1 to 200 characters.');
    }
    if (input.accountId && input.preregistrationId) throw validationError('An email is for an account or a pre-registration, not both.');
    const subjectId = this.subjectOf(input.kind, input.accountId ?? null, input.preregistrationId ?? null);
    if (!this.on) return { queued: false, reason: 'OFF' };
    return inTransaction(db, async (tx) => {
      const kind = await this.kind(input.kind, tx);
      if (!kind.enabled) return { queued: false, reason: 'KIND_OFF' } as const;
      const to = input.to.trim();
      if (!isMailAddress(to)) return { queued: false, reason: 'ADDRESS' } as const;
      const unsubscribe = subjectId === null ? null : this.unsubscribeLinks(input.kind, subjectId).page;
      const rendered = renderEmail({
        kind: input.kind,
        words: kind.words,
        values: { ...input.values, unsubscribeLink: unsubscribe },
        origin: this.config.publicOrigin,
        unsubscribeUrl: unsubscribe,
      });
      const row = await tx
        .insertInto('email_outbox')
        .values({
          kind: input.kind,
          dedupe_key: key,
          account_id: input.accountId ?? null,
          preregistration_id: input.preregistrationId ?? null,
          to_address: to,
          subject: rendered.subject,
          body_text: rendered.text,
          body_html: rendered.html,
          not_before: input.notBefore ?? this.clock(),
          created_at: this.clock(),
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      return row ? ({ queued: true, id: row.id } as const) : ({ queued: false, reason: 'DUPLICATE' } as const);
    });
  }

  /** The id an email one may stop is keyed by (its unsubscribe link): the pre-registration's (E1), the account's (E2). */
  private subjectOf(kind: EmailKind, accountId: string | null, preregistrationId: string | null): string | null {
    if (!OPT_IN_KINDS.has(kind)) return null;
    const id = kind === 'FOUNDING_ANNOUNCEMENT' ? preregistrationId : accountId;
    if (!id) throw validationError(kind === 'FOUNDING_ANNOUNCEMENT' ? 'The founding announcement goes to a pre-registration.' : 'A release notice goes to an account.');
    return id;
  }

  // ── The sender ───────────────────────────────────────────────────────────

  /** One pass: the QUEUED rows due, claimed, sent or put back for later. Nothing while the channel is off. */
  async sendDue(): Promise<SendReport> {
    const report: SendReport = { sent: 0, retried: 0, failed: 0 };
    if (!this.on || this.transport === null) return report;
    const rows = await this.claim();
    for (const row of rows) {
      const outcome = await this.sendOne(row);
      report[outcome] += 1;
    }
    return report;
  }

  /** The rows due, oldest first, each one's attempt counted and its time moved a lease ahead, in one transaction. */
  private async claim(): Promise<OutboxRow[]> {
    const now = this.clock();
    const lease = new Date(now.getTime() + EMAIL_SENDER.leaseMs);
    const rows = await inTransaction(this.db, async (tx) => {
      const due = await tx
        .selectFrom('email_outbox')
        .select('id')
        .where('status', '=', 'QUEUED')
        .where('not_before', '<=', now)
        .orderBy('not_before')
        .orderBy('id')
        .limit(EMAIL_SENDER.batch)
        .forUpdate()
        .skipLocked()
        .execute();
      if (due.length === 0) return [];
      return tx
        .updateTable('email_outbox')
        .set((eb) => ({ attempts: eb('attempts', '+', 1), not_before: lease }))
        .where(
          'id',
          'in',
          due.map((d) => d.id),
        )
        .returningAll()
        .execute();
    });
    return rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  }

  private async sendOne(row: OutboxRow): Promise<keyof SendReport> {
    const email = this.config.email;
    if (email.transport !== 'smtp' || this.transport === null) return 'retried';
    const subjectId = OPT_IN_KINDS.has(row.kind) ? (row.kind === 'FOUNDING_ANNOUNCEMENT' ? row.preregistration_id : row.account_id) : null;
    try {
      const data = buildMessage({
        from: email.from,
        to: row.to_address,
        replyTo: email.replyTo,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
        id: row.id,
        date: this.clock(),
        unsubscribe: subjectId ? { oneClick: this.unsubscribeLinks(row.kind, subjectId).oneClick } : null,
      });
      await this.transport({ from: email.from.address, to: row.to_address, data });
    } catch (e) {
      return this.failed(row, e);
    }
    const now = this.clock();
    await this.db
      .updateTable('email_outbox')
      .set({ status: 'SENT', sent_at: now, settled_at: now, last_error: null })
      .where('id', '=', row.id)
      .where('status', '=', 'QUEUED')
      .execute();
    this.log.info({ kind: row.kind, id: row.id }, 'email sent');
    return 'sent';
  }

  /** A failed attempt: tried again later, or FAILED (refused for good, or its retries used). */
  private async failed(row: OutboxRow, e: unknown): Promise<'retried' | 'failed'> {
    const now = this.clock();
    const err = e instanceof SmtpError ? e : new SmtpError('message', 0, `message: ${String((e as Error)?.message ?? e)}`);
    const words = err.message.replace(/[\p{Cc}]/gu, ' ').trim().slice(0, EMAIL_ERROR_MAX) || 'failed';
    const final = err.permanent || row.attempts > EMAIL_SENDER.retryMs.length;
    if (final) {
      await this.db
        .updateTable('email_outbox')
        .set({ status: 'FAILED', settled_at: now, last_error: words })
        .where('id', '=', row.id)
        .where('status', '=', 'QUEUED')
        .execute();
    } else {
      const delay = EMAIL_SENDER.retryMs[Math.max(0, row.attempts - 1)]!;
      await this.db
        .updateTable('email_outbox')
        .set({ not_before: new Date(now.getTime() + delay), last_error: words })
        .where('id', '=', row.id)
        .where('status', '=', 'QUEUED')
        .execute();
    }
    this.log.warn({ kind: row.kind, id: row.id, attempts: row.attempts, final, stage: err.stage, code: err.code }, 'email failed');
    return final ? 'failed' : 'retried';
  }

  /** At the process's start (context.ts), only while the channel is on: a pass now, then every 15 s. */
  start(): void {
    if (!this.on) return;
    this.timers = true;
    this.schedule(0);
  }

  /** At the process's close: no new pass; the one under way finishes. */
  async stop(): Promise<void> {
    this.timers = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  private schedule(ms: number): void {
    if (!this.timers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    let full = false;
    this.running = (async () => {
      try {
        const r = await this.sendDue();
        full = r.sent + r.retried + r.failed >= EMAIL_SENDER.batch;
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'emails: a pass of the sender failed');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(full ? 0 : EMAIL_SENDER.intervalMs);
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────

  /** Erases the emails settled (sent, failed, cancelled) more than 90 days before `now`; the number erased. */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - EMAIL_RETENTION_DAYS * DAY_MS);
    const r = await this.db.deleteFrom('email_outbox').where('settled_at', '<', cutoff).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  }

  // ── Unsubscribe ──────────────────────────────────────────────────────────

  /** The token of an email one may stop: `<letter>.<id>.<HMAC-SHA-256 of the kind and the id, 16 bytes>`. */
  unsubscribeToken(kind: EmailKind, subjectId: string): string {
    const letter = UNSUBSCRIBE_LETTER[kind];
    const id = subjectId.toLowerCase();
    if (!letter || !UUID.test(id)) throw validationError('Only the founding announcement and the release notices can be stopped.');
    return `${letter}.${id}.${this.mac(kind, id).toString('base64url')}`;
  }

  /** What a token stops (its kind and its person's id), or null when it is not one of the server's. */
  readUnsubscribeToken(token: unknown): { kind: EmailKind; subjectId: string } | null {
    if (typeof token !== 'string') return null;
    const m = /^([a-z])\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(token);
    if (!m || !UUID.test(m[2]!)) return null;
    const kind = (Object.entries(UNSUBSCRIBE_LETTER).find(([, letter]) => letter === m[1])?.[0] ?? null) as EmailKind | null;
    if (kind === null) return null;
    const given = Buffer.from(m[3]!, 'base64url');
    const expected = this.mac(kind, m[2]!);
    return given.length === expected.length && timingSafeEqual(given, expected) ? { kind, subjectId: m[2]! } : null;
  }

  /** The page that stops an email (its token in the fragment: never in a log or a referrer) and its one-click address. */
  unsubscribeLinks(kind: EmailKind, subjectId: string): { page: string; oneClick: string } {
    const token = this.unsubscribeToken(kind, subjectId);
    return { page: `${this.config.publicOrigin}/verify/unsubscribe#${token}`, oneClick: `${this.config.publicOrigin}/api/v1/email/unsubscribe?t=${token}` };
  }

  private mac(kind: EmailKind, id: string): Buffer {
    return createHmac('sha256', this.key).update(`${UNSUBSCRIBE_KEY_INFO}\u0000${kind}\u0000${id}`, 'utf8').digest().subarray(0, 16);
  }
}
