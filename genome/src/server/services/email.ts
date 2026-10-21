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
 *               one email at once; then sent over SMTP (email/smtp.ts), one connection each. A pass stops before its
 *               next email once the process is closing (stop) or half the lease has passed since the claim (a slow
 *               provider), so an email is always settled well inside its lease; the rows claimed but not tried are
 *               given back, due at once, their attempt not counted. Sent: SENT. Refused for
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
 *   cancel      at send time (lot M1 step M1.17), a row is CANCELLED instead of sent when its person no longer wants it
 *               or can no longer have it: its account is not ACTIVE (locked, or any later deletion path), a release
 *               notice's account stopped them, a founding announcement's pre-registration unsubscribed, a reset's
 *               code is used, replaced or expired, or the release a founding announcement or release notice is about
 *               is cancelled, gone or over. OwnerService.lock cancels the account's QUEUED rows in its own transaction
 *               (cancelAccountEmails), the unsubscribe the person's QUEUED rows of that kind, a release's cancel its
 *               QUEUED E1 and E2 rows (cancelReleaseEmails), a LIVE RELEASE's new opening its QUEUED E1 rows
 *               (cancelMovedAnnouncements).
 *   scans       the sender's pass first runs the scans registered (addScan): the release notices' watermark (E2,
 *               services/email-triggers.ts), only while the channel is on.
 *   console     the kinds' switches (ADMIN, audited `email.kind.enable` / `.disable`) and words (OPERATOR, audited
 *               `email.template.update`), the outbox read back (its counts, its rows, one row as it was sent), and a
 *               test to oneself (ADMIN, only while the channel is on, audited `email.test`), for routes/admin/email.ts.
 *
 * The triggers (E1 to E5) and the account's email data (its export, its lock) are services/email-triggers.ts's and
 * services/owners.ts's; the console's Emails page is lot M1 step M1.18's.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import { EMAIL_DEDUPE_MAX, EMAIL_ERROR_MAX, EMAIL_KINDS, EMAIL_TEMPLATE_BODY_MAX, EMAIL_TEMPLATE_SUBJECT_MAX, type EmailKind, type EmailOutboxTable, type EmailStatus } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import type { AuditService } from './audit.js';
import { EMAIL_DEFAULTS, EMAIL_SAMPLE_VALUES, OPT_IN_KINDS, type EmailWords } from '../email/copy.js';
import { renderEmail, type EmailValues, type RenderedEmail } from '../email/render.js';
import { buildMessage, isMailAddress, SmtpError, sendSmtp, type SmtpEnvelope, type SmtpOptions } from '../email/smtp.js';
import { makePage, noopLogger, pageOffset, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';

/** The sender's rhythm: a pass every 15 s, 50 emails at most a pass, the retries' delays, a claim's lease. */
export const EMAIL_SENDER = Object.freeze({
  intervalMs: 15_000,
  batch: 50,
  /** After the 1st, 2nd, 3rd and 4th failed attempt; the 5th failure is final (FAILED). */
  retryMs: Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]),
  /** How long a claimed row is kept from another sender while it is being sent. */
  leaseMs: 10 * 60_000,
  /** A pass tries no further email once this long has passed since its claim (half the lease); the rest are given back. */
  passMs: 5 * 60_000,
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
  /** The console's changes are audited (the kinds' switches and words, a test to oneself). */
  audit?: AuditService;
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
  /** Not sent: its person no longer wants it or can no longer have it (see cancelReason). */
  cancelled: number;
}

/** An outbox row as the console reads it: never its words (outboxEmail gives one email as it was sent). */
export interface OutboxEntry {
  id: string;
  kind: EmailKind;
  to: string;
  subject: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  notBefore: Date;
  createdAt: Date;
  sentAt: Date | null;
  settledAt: Date | null;
  /** Whom it is for: an account, a pre-registration, or neither (a test the console sent to itself). */
  accountId: string | null;
  preregistrationId: string | null;
}

/** The outbox's rows by status, and the last errors. */
export interface OutboxCounts {
  queued: number;
  sent: number;
  failed: number;
  cancelled: number;
  /** The 5 latest rows that failed or are being tried again, newest first. */
  lastErrors: { id: string; kind: EmailKind; status: EmailStatus; lastError: string; at: Date }[];
}

/**
 * The QUEUED rows of an account cancelled (OwnerService.lock, in its transaction): CANCELLED, settled now, with the
 * reason in `last_error`. The number cancelled; rows already sent, failed or cancelled are left as they are.
 */
export async function cancelAccountEmails(tx: Db, accountId: string, now: Date, reason = CANCELLED_WORDS.notActive): Promise<number> {
  const r = await tx
    .updateTable('email_outbox')
    .set({ status: 'CANCELLED', settled_at: now, last_error: reason })
    .where('account_id', '=', accountId)
    .where('status', '=', 'QUEUED')
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}

/**
 * The QUEUED emails about a release cancelled (DropService.cancel and LiveConsoleService.cancel, in their transaction):
 * its founding announcements (`E1:<release>:…`) and release notices (`E2:<release>:…`), CANCELLED, settled now. The
 * number cancelled; the sender also cancels at send time a row whose release is cancelled, gone or over (cancelReason).
 */
export async function cancelReleaseEmails(tx: Db, dropId: string, now: Date): Promise<number> {
  const id = dropId.toLowerCase();
  const r = await tx
    .updateTable('email_outbox')
    .set({ status: 'CANCELLED', settled_at: now, last_error: CANCELLED_WORDS.releaseCancelled })
    .where('status', '=', 'QUEUED')
    .where((eb) =>
      eb.or([
        eb.and([eb('kind', '=', 'FOUNDING_ANNOUNCEMENT'), eb('dedupe_key', 'like', `E1:${id}:%`)]),
        eb.and([eb('kind', '=', 'RELEASE_NOTICE'), eb('dedupe_key', 'like', `E2:${id}:%`)]),
      ]),
    )
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}

/**
 * The QUEUED founding announcements of a LIVE RELEASE whose opening moved before its announcement
 * (LiveConsoleService.update, in its transaction): written for the old opening, at it and saying it, they are CANCELLED
 * (CANCELLED_WORDS.openingMoved), so the panel shows the release as not scheduled and the ADMIN sends it again. The
 * number cancelled.
 */
export async function cancelMovedAnnouncements(tx: Db, dropId: string, now: Date): Promise<number> {
  const r = await tx
    .updateTable('email_outbox')
    .set({ status: 'CANCELLED', settled_at: now, last_error: CANCELLED_WORDS.openingMoved })
    .where('status', '=', 'QUEUED')
    .where('kind', '=', 'FOUNDING_ANNOUNCEMENT')
    .where('dedupe_key', 'like', `E1:${dropId.toLowerCase()}:%`)
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}

/** Why a row was cancelled (its `last_error`, as the console shows it). */
export const CANCELLED_WORDS = Object.freeze({
  notActive: 'Cancelled: the account is not active.',
  releaseNotices: 'Cancelled: release notices were stopped.',
  unsubscribed: 'Cancelled: unsubscribed from the founding list.',
  announcement: 'Cancelled: the scheduled announcement was cancelled.',
  releaseCancelled: 'Cancelled: the release was cancelled.',
  releaseOver: 'Cancelled: the release is over.',
  openingMoved: 'Cancelled: the release’s opening moved.',
  resetInvalid: 'Cancelled: the reset code is no longer valid.',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The release an email is about, from its dedupe key: a founding announcement's (`E1:<id>:…`) or a release notice's (`E2:<id>:…`). */
function releaseOfRow(row: Pick<OutboxRow, 'kind' | 'dedupe_key'>): string | null {
  const prefix = row.kind === 'FOUNDING_ANNOUNCEMENT' ? 'E1:' : row.kind === 'RELEASE_NOTICE' ? 'E2:' : null;
  if (prefix === null || !row.dedupe_key.startsWith(prefix)) return null;
  const id = row.dedupe_key.slice(prefix.length).split(':')[0] ?? '';
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** A scan the sender runs first in each pass while the channel is on (the release notices' watermark, E2). */
export type EmailScan = () => Promise<void>;

type OutboxRow = Selectable<EmailOutboxTable>;

export class EmailService {
  private readonly db: Db;
  private readonly audit: AuditService | null;
  private readonly scans: EmailScan[] = [];
  private readonly config: EmailServiceDeps['config'];
  private readonly key: Uint8Array;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly transport: EmailTransport | null;
  private timers = false;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  /** Set by stop(): a pass under way tries no further email. */
  private stopping = false;

  constructor(deps: EmailServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit ?? null;
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
    knownKind(kind);
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
    return (await this.enqueueMany(db, [input]))[0]!;
  }

  /**
   * Several emails at once (a draw's places, the founding announcement), in `db`'s transaction: each kind's switch and
   * words read once. One result per input, in their order.
   */
  async enqueueMany(db: Db, inputs: readonly EnqueueInput[]): Promise<EnqueueResult[]> {
    const checked = inputs.map((input) => {
      const key = input.dedupeKey;
      if (typeof key !== 'string' || key.length < 1 || key.length > EMAIL_DEDUPE_MAX || key !== key.trim() || /[\p{Cc}]/u.test(key)) {
        throw validationError('An email’s key is one line of 1 to 200 characters.');
      }
      if (input.accountId && input.preregistrationId) throw validationError('An email is for an account or a pre-registration, not both.');
      return { input, subjectId: this.subjectOf(input.kind, input.accountId ?? null, input.preregistrationId ?? null) };
    });
    if (!this.on) return inputs.map(() => ({ queued: false, reason: 'OFF' }) as const);
    if (inputs.length === 0) return [];
    return inTransaction(db, async (tx) => {
      const kinds = new Map<EmailKind, EmailKindWords>();
      const out: EnqueueResult[] = [];
      for (const { input, subjectId } of checked) {
        let kind = kinds.get(input.kind);
        if (!kind) {
          kind = await this.kind(input.kind, tx);
          kinds.set(input.kind, kind);
        }
        out.push(await this.write(tx, input, subjectId, kind));
      }
      return out;
    });
  }

  /** One email rendered and written, unless its kind is off, its address cannot be carried or its key was used. */
  private async write(tx: Db, input: EnqueueInput, subjectId: string | null, kind: EmailKindWords): Promise<EnqueueResult> {
    if (!kind.enabled) return { queued: false, reason: 'KIND_OFF' };
    const to = input.to.trim();
    if (!isMailAddress(to)) return { queued: false, reason: 'ADDRESS' };
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
        dedupe_key: input.dedupeKey,
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
    return row ? { queued: true, id: row.id } : { queued: false, reason: 'DUPLICATE' };
  }

  /** The id an email one may stop is keyed by (its unsubscribe link): the pre-registration's (E1), the account's (E2). */
  private subjectOf(kind: EmailKind, accountId: string | null, preregistrationId: string | null): string | null {
    if (!OPT_IN_KINDS.has(kind)) return null;
    const id = kind === 'FOUNDING_ANNOUNCEMENT' ? preregistrationId : accountId;
    if (!id) throw validationError(kind === 'FOUNDING_ANNOUNCEMENT' ? 'The founding announcement goes to a pre-registration.' : 'A release notice goes to an account.');
    return id;
  }

  // ── The sender ───────────────────────────────────────────────────────────

  /**
   * One pass: the QUEUED rows due, claimed, sent or put back for later. Nothing while the channel is off. It tries no
   * further email once the process is closing or EMAIL_SENDER.passMs has passed since the claim: those are given back.
   */
  async sendDue(): Promise<SendReport> {
    return (await this.pass()).report;
  }

  /** A pass, and whether more may be due at once (a full batch, or rows given back). */
  private async pass(): Promise<{ report: SendReport; more: boolean }> {
    const report: SendReport = { sent: 0, retried: 0, failed: 0, cancelled: 0 };
    if (!this.on || this.transport === null || this.stopping) return { report, more: false };
    for (const scan of this.scans) {
      try {
        await scan();
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'emails: a scan before the sender’s pass failed');
      }
    }
    const rows = await this.claim();
    const claimedAt = this.clock().getTime();
    for (const [i, row] of rows.entries()) {
      if (this.stopping || this.clock().getTime() - claimedAt >= EMAIL_SENDER.passMs) {
        await this.giveBack(rows.slice(i));
        return { report, more: !this.stopping };
      }
      const outcome = await this.sendOne(row);
      report[outcome] += 1;
    }
    return { report, more: rows.length >= EMAIL_SENDER.batch };
  }

  /** Rows claimed but not tried: due at once again, their attempt not counted (still under this pass's lease only). */
  private async giveBack(rows: OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    // Every row of one claim carries the same lease; a row whose lease is no longer it is not this pass's to give.
    await this.db
      .updateTable('email_outbox')
      .set((eb) => ({ attempts: eb('attempts', '-', 1), not_before: this.clock() }))
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .where('status', '=', 'QUEUED')
      .where('not_before', '=', rows[0]!.not_before)
      .execute();
    this.log.info({ count: rows.length, stopping: this.stopping }, 'emails: claimed emails given back for the next pass');
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

  /** A scan the sender runs first in each of its passes, while the channel is on (context.ts: the release notices). */
  addScan(scan: EmailScan): void {
    this.scans.push(scan);
  }

  /**
   * Why a claimed row must not go now, or null: its account is no longer ACTIVE (locked, or deleted by any later path),
   * a release notice's account stopped them, a founding announcement's pre-registration unsubscribed, a reset's code
   * (`PASSWORD_RESET:<code>`) is used, revoked or expired, or the release a founding announcement or release notice is
   * about is cancelled, gone or over.
   */
  private async cancelReason(row: OutboxRow): Promise<string | null> {
    if (row.account_id !== null) {
      const a = await this.db
        .selectFrom('accounts as a')
        .leftJoin('email_preferences as p', 'p.account_id', 'a.id')
        .select(['a.status', 'p.release_notices'])
        .where('a.id', '=', row.account_id)
        .executeTakeFirst();
      if (!a || a.status !== 'ACTIVE') return CANCELLED_WORDS.notActive;
      if (row.kind === 'RELEASE_NOTICE' && a.release_notices !== true) return CANCELLED_WORDS.releaseNotices;
    }
    if (row.preregistration_id !== null) {
      const p = await this.db.selectFrom('preregistrations').select('unsubscribed_at').where('id', '=', row.preregistration_id).executeTakeFirst();
      if (!p || p.unsubscribed_at !== null) return CANCELLED_WORDS.unsubscribed;
    }
    // A reset's code used, replaced (a later request, Client Services' code) or past its 30 minutes: its link is dead.
    const codeId = row.kind === 'PASSWORD_RESET' ? row.dedupe_key.slice('PASSWORD_RESET:'.length) : null;
    if (codeId !== null && UUID_RE.test(codeId)) {
      const c = await this.db.selectFrom('account_recovery_codes').select(['used_at', 'revoked_at', 'expires_at']).where('id', '=', codeId).executeTakeFirst();
      if (!c || c.used_at !== null || c.revoked_at !== null || c.expires_at.getTime() <= this.clock().getTime()) return CANCELLED_WORDS.resetInvalid;
    }
    const releaseId = releaseOfRow(row);
    if (releaseId !== null) {
      const d = await this.db.selectFrom('drops').select(['cancelled_at', 'closes_at', 'ended_at', 'drawn_at']).where('id', '=', releaseId).executeTakeFirst();
      if (!d || d.cancelled_at !== null) return CANCELLED_WORDS.releaseCancelled;
      if (d.ended_at !== null || d.drawn_at !== null || d.closes_at.getTime() <= this.clock().getTime()) return CANCELLED_WORDS.releaseOver;
    }
    return null;
  }

  private async sendOne(row: OutboxRow): Promise<keyof SendReport> {
    const email = this.config.email;
    if (email.transport !== 'smtp' || this.transport === null) return 'retried';
    const reason = await this.cancelReason(row);
    if (reason !== null) {
      await this.db
        .updateTable('email_outbox')
        .set({ status: 'CANCELLED', settled_at: this.clock(), last_error: reason })
        .where('id', '=', row.id)
        .where('status', '=', 'QUEUED')
        .execute();
      this.log.info({ kind: row.kind, id: row.id }, 'email cancelled');
      return 'cancelled';
    }
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
    this.stopping = false;
    this.schedule(0);
  }

  /**
   * At the process's close: no new pass; the one under way finishes the email it is sending (written SENT, or put back)
   * and gives back the rest of its claim, due at once for the next process.
   */
  async stop(): Promise<void> {
    this.stopping = true;
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
        full = (await this.pass()).more;
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'emails: a pass of the sender failed');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(full ? 0 : EMAIL_SENDER.intervalMs);
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** A kind switched on or off (ADMIN). Audited `email.kind.enable` / `email.kind.disable`; nothing when unchanged. */
  async setEnabled(kind: EmailKind, enabled: boolean, actor: Actor): Promise<EmailKindWords> {
    const by = adminOf(actor);
    const k = knownKind(kind);
    return inTransaction(this.db, async (tx) => {
      const before = await this.kind(k, tx);
      if (before.enabled === enabled) return before;
      await tx
        .insertInto('email_templates')
        .values({ kind: k, enabled, updated_by: by, updated_at: this.clock() })
        .onConflict((oc) => oc.column('kind').doUpdateSet({ enabled, updated_by: by, updated_at: this.clock() }))
        .execute();
      await this.audit?.record({ actor, action: enabled ? 'email.kind.enable' : 'email.kind.disable', targetType: 'email_kind', targetId: k, details: { kind: k } }, tx);
      return this.kind(k, tx);
    });
  }

  /**
   * A kind's words (OPERATOR): a subject (one line, 1 to 150 characters) and a body (1 to 5,000 characters), each null
   * for the default words; a part left out is kept. Audited `email.template.update` with which parts changed.
   */
  async setWords(kind: EmailKind, input: { subject?: string | null; body?: string | null }, actor: Actor): Promise<EmailKindWords> {
    const by = adminOf(actor);
    const k = knownKind(kind);
    const subject = input.subject === undefined ? undefined : input.subject === null ? null : cleanSubject(input.subject);
    const body = input.body === undefined ? undefined : input.body === null ? null : cleanBody(input.body);
    return inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('email_templates').select(['subject', 'body']).where('kind', '=', k).forUpdate().executeTakeFirst();
      const next = { subject: subject === undefined ? row?.subject ?? null : subject, body: body === undefined ? row?.body ?? null : body };
      const changed = { subject: next.subject !== (row?.subject ?? null), body: next.body !== (row?.body ?? null) };
      if (!changed.subject && !changed.body) return this.kind(k, tx);
      await tx
        .insertInto('email_templates')
        .values({ kind: k, subject: next.subject, body: next.body, updated_by: by, updated_at: this.clock() })
        .onConflict((oc) => oc.column('kind').doUpdateSet({ subject: next.subject, body: next.body, updated_by: by, updated_at: this.clock() }))
        .execute();
      await this.audit?.record(
        { actor, action: 'email.template.update', targetType: 'email_kind', targetId: k, details: { kind: k, subject: changed.subject, body: changed.body, defaults: { subject: next.subject === null, body: next.body === null } } },
        tx,
      );
      return this.kind(k, tx);
    });
  }

  /** The outbox's rows by status and its last errors. */
  async outboxCounts(): Promise<OutboxCounts> {
    const rows = await this.db.selectFrom('email_outbox').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).groupBy('status').execute();
    const n = (status: EmailStatus) => Number(rows.find((r) => r.status === status)?.n ?? 0);
    const errors = await this.db
      .selectFrom('email_outbox')
      .select(['id', 'kind', 'status', 'last_error', 'settled_at', 'created_at'])
      .where('last_error', 'is not', null)
      .where('status', 'in', ['QUEUED', 'FAILED'])
      .orderBy(sql`coalesce(settled_at, created_at)`, 'desc')
      .orderBy('id', 'desc')
      .limit(5)
      .execute();
    return {
      queued: n('QUEUED'),
      sent: n('SENT'),
      failed: n('FAILED'),
      cancelled: n('CANCELLED'),
      lastErrors: errors.map((e) => ({ id: e.id, kind: e.kind, status: e.status, lastError: e.last_error!, at: e.settled_at ?? e.created_at })),
    };
  }

  /** The outbox, newest first, filtered by status and kind; never the words (outboxEmail). */
  async outbox(filter: { status?: EmailStatus; kind?: EmailKind }, page: PageRequest): Promise<Page<OutboxEntry>> {
    const scoped = this.db
      .selectFrom('email_outbox')
      .$if(filter.status !== undefined, (q) => q.where('status', '=', filter.status!))
      .$if(filter.kind !== undefined, (q) => q.where('kind', '=', filter.kind!));
    const total = await scoped.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await scoped
      .select(['id', 'kind', 'to_address', 'subject', 'status', 'attempts', 'last_error', 'not_before', 'created_at', 'sent_at', 'settled_at', 'account_id', 'preregistration_id'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(rows.map(outboxEntry), Number(total.n), page);
  }

  /** One email as it was sent (or will be): its row and its words, text and HTML. 404 EMAIL_NOT_FOUND. */
  async outboxEmail(id: string): Promise<OutboxEntry & { text: string; html: string }> {
    if (typeof id !== 'string' || !UUID.test(id.toLowerCase())) throw emailNotFound();
    const r = await this.db.selectFrom('email_outbox').selectAll().where('id', '=', id.toLowerCase()).executeTakeFirst();
    if (!r) throw emailNotFound();
    return { ...outboxEntry(r), text: r.body_text, html: r.body_html };
  }

  /**
   * A test to oneself (ADMIN, only while the channel is on: 409 EMAIL_OFF): the kind's words (or those given) filled
   * with the example values, to the console member's own address, due now, whether the kind is on or not. Audited
   * `email.test` with the kind and the row, never the address.
   */
  async sendTest(kind: EmailKind, to: string, actor: Actor, words?: Partial<EmailWords>): Promise<{ id: string }> {
    adminOf(actor);
    const k = knownKind(kind);
    if (!this.on) throw emailOff();
    const address = typeof to === 'string' ? to.trim() : '';
    if (!isMailAddress(address)) throw validationError('Your console address cannot receive an email.');
    const rendered = await this.preview(k, words);
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const row = await tx
        .insertInto('email_outbox')
        .values({ kind: k, dedupe_key: `TEST:${k}:${randomUUID()}`, to_address: address, subject: rendered.subject, body_text: rendered.text, body_html: rendered.html, not_before: now, created_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit?.record({ actor, action: 'email.test', targetType: 'email_kind', targetId: k, details: { kind: k, emailId: row.id } }, tx);
      return { id: row.id };
    });
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** 409 EMAIL_OFF: no email provider in the server's .env, nothing can be sent. */
export const emailOff = () => conflict('EMAIL_OFF', 'No email provider in the server’s .env: nothing is sent.');
const emailNotFound = () => notFound('Email', 'EMAIL_NOT_FOUND');

function adminOf(actor: Actor): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID.test(actor.id.toLowerCase())) throw forbidden('Only ORBES staff change the emails.');
  return actor.id;
}

function knownKind(kind: unknown): EmailKind {
  if (!(EMAIL_KINDS as readonly unknown[]).includes(kind)) throw notFound('Email kind', 'EMAIL_KIND_NOT_FOUND');
  return kind as EmailKind;
}

/** A subject as the console writes it: one line, 1 to 150 characters, trimmed (the CHECK's rule). */
function cleanSubject(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < 1 || t.length > EMAIL_TEMPLATE_SUBJECT_MAX || /[\p{Cc}]/u.test(t)) throw validationError(`A subject is one line of 1 to ${EMAIL_TEMPLATE_SUBJECT_MAX} characters.`);
  return t;
}

/** A body as the console writes it: 1 to 5,000 characters, its line breaks kept (CR LF read as LF). */
function cleanBody(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
  if (t.length < 1 || t.length > EMAIL_TEMPLATE_BODY_MAX) throw validationError(`A body has 1 to ${EMAIL_TEMPLATE_BODY_MAX.toLocaleString('en-GB')} characters.`);
  return t;
}

function outboxEntry(r: Pick<OutboxRow, 'id' | 'kind' | 'to_address' | 'subject' | 'status' | 'attempts' | 'last_error' | 'not_before' | 'created_at' | 'sent_at' | 'settled_at' | 'account_id' | 'preregistration_id'>): OutboxEntry {
  return {
    id: r.id,
    kind: r.kind,
    to: r.to_address,
    subject: r.subject,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    notBefore: r.not_before,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    settledAt: r.settled_at,
    accountId: r.account_id,
    preregistrationId: r.preregistration_id,
  };
}
