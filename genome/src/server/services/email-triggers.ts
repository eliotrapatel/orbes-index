/**
 * The emails' triggers (macro scope E1 to E6, F6; lot M1 plan §4.2, step M1.17): when each email is written in the
 * outbox (services/email.ts), to whom, with which values. Every one is off until the channel is on (EMAIL_TRANSPORT) and
 * its kind is switched on in the console; then each is written in the transaction of the act that causes it, once per
 * dedupe key, and nothing here ever sends: the sender does.
 *
 *   E1 FOUNDING_ANNOUNCEMENT  the console's Send the founding announcement (ADMIN, the phrase SEND <8>): one published
 *                             release, sent now or at its opening (`not_before` its `opens_at`, a draw's entries' opening
 *                             too), to every pre-registration not unsubscribed, once per release and pre-registration
 *                             (`E1:<release>:<pre-registration>`; again after a cancel, `…:<n>`). CANCEL SCHEDULED cancels
 *                             what is still QUEUED. Audited `email.announcement.queue` / `.cancel` with the counts (F6).
 *   E2 RELEASE_NOTICE         the sender's scan (EmailService.addScan): each release announced since the watermark
 *                             (`email_state.releases_until`; a draw at its publication, a LIVE RELEASE at its announcement,
 *                             never an after-room), to the ACTIVE accounts that asked for them in YOUR PROFILE
 *                             (`email_preferences.release_notices`), test entrants left out (`E2:<release>:<account>`).
 *                             The watermark starts at the scan's first run (set the overlap ahead, so no scan looks
 *                             back before it): nothing announced before is written. Its
 *                             words are the release's as its stage has made them public (a LIVE RELEASE is « A LIVE
 *                             RELEASE » before its name's stage), its access rule in words.
 *   E3 PASSWORD_RESET         services/account-recovery.ts requestByEmail.
 *   E4 ORDER_CONFIRMED        an order's step to PAID (« order confirmed », §11 note 5), SHIPPED (its carrier and tracking
 *      ORDER_SHIPPED          page; again for a parcel shipped again with another number) and DELIVERED (services/orders.ts
 *      ORDER_DELIVERED        `step`, the one place an order changes step), for the platform's orders only
 *                             (platformSendsOrderEmails).
 *   E5 ORDER_CANCELLED        an order cancelled (its credit note with it when it was paid);
 *      DRAW_SELECTED          the places a draw selects (services/drops.ts draw), held until `respond_by`;
 *      DRAW_OFFERED           OFFER NEXT from the waiting list;
 *      WARRANTY_LABEL         a warranty claim's prepaid label sent (LABEL_SENT);
 *      CARE_LABEL             a PRIVATE CARE request's prepaid label sent (LABEL_SENT).
 *   E6                        house messages stay in the app (M4): no kind exists for them.
 *
 * An email to an account goes only to an ACTIVE account that is no test entrant (their addresses, @orbes.test, reach
 * nobody); the sender cancels it if the account is no longer ACTIVE when it is due. Each one is a link into the app,
 * never an attachment, and names no piece's material nor price.
 *
 * YOUR PROFILE's release notices (`preferences`, `setPreferences`, audited `account.email_preferences`) and the links
 * that stop an email (`unsubscribe`: the founding announcement's pre-registration unsubscribed, or the account's release
 * notices stopped, their QUEUED emails cancelled) are here too. The same answer for any token.
 */
import { sql } from 'kysely';
import { inTransaction, uuidArray, type Db } from '../db/connection.js';
import type { DropRow, EmailKind, OrderRow, OrderStatus } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { CANCELLED_WORDS, emailOff, type EmailService, type EnqueueInput } from './email.js';
import { unsubscribePreregistration } from './founding.js';
import { announcedAt, liveAccessRule, liveRuleText, liveStages, stagesAt } from './live.js';
import { orderReference, trackingLink } from './orders.js';

/** How far back each scan of the release notices looks behind its watermark (a publication committed late is still seen). */
export const RELEASE_NOTICE_OVERLAP_MS = 10 * 60_000;
/** The releases the founding announcement's panel offers, at most. */
export const ANNOUNCEMENT_RELEASES = 50;

/**
 * Whether the platform sends an order's emails (E4, and its cancellation): every order but a welcome GIFT, which travels
 * with its order. When Shopify takes the checkout or the receipt (macro scope S2, S3), its orders are left out here, so no
 * customer receives two.
 */
export function platformSendsOrderEmails(order: Pick<OrderRow, 'channel'>): boolean {
  return order.channel !== 'GIFT';
}

/** The phrase Send the founding announcement asks for: `SEND 1A2B3C4D` (the release's id, its first 8 characters). */
export function announcementPhrase(dropId: string): string {
  return `SEND ${dropId.slice(0, 8).toUpperCase()}`;
}

/** What an email to an account needs of it. */
interface Recipient {
  id: string;
  email: string;
  firstName: string | null;
}

/** A release as the announcement's panel reads it. */
export interface AnnouncementRelease {
  id: string;
  mode: 'DRAW' | 'LIVE';
  /** Its title, as the console writes it. */
  title: string;
  /** What the email says of it now (its stage's words). */
  words: string;
  opensAt: Date;
  closesAt: Date;
  /** A LIVE RELEASE before its announcement can be sent only at its opening. */
  announced: boolean;
  emails: { queued: number; sent: number; failed: number; cancelled: number };
  /** The earliest time a QUEUED announcement of it goes, or null. */
  scheduledAt: Date | null;
}

/** The founding announcement's panel (the Founding list page, lot M1 step M1.18). */
export interface AnnouncementState {
  channel: boolean;
  enabled: boolean;
  /** The pre-registrations it would reach: those not unsubscribed. */
  reach: number;
  releases: AnnouncementRelease[];
}

export interface EmailTriggersDeps {
  db: Db;
  email: EmailService;
  audit: AuditService;
  publicOrigin: string;
  clock?: Clock;
}

type ReleaseRow = Pick<
  DropRow,
  | 'id' | 'mode' | 'title' | 'model_id' | 'parent_drop_id' | 'published_at' | 'cancelled_at' | 'drawn_at' | 'ended_at' | 'opens_at' | 'closes_at'
  | 'announce_at' | 'silhouette_at' | 'name_at' | 'photo_at' | 'room_opens_minutes' | 'live_min_tier' | 'access_collection_id' | 'min_participations'
  | 'access_segment_id' | 'access_combine'
>;
const RELEASE_COLUMNS = [
  'id', 'mode', 'title', 'model_id', 'parent_drop_id', 'published_at', 'cancelled_at', 'drawn_at', 'ended_at', 'opens_at', 'closes_at',
  'announce_at', 'silhouette_at', 'name_at', 'photo_at', 'room_opens_minutes', 'live_min_tier', 'access_collection_id', 'min_participations',
  'access_segment_id', 'access_combine',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const releaseNotFound = () => notFound('Release', 'DROP_NOT_FOUND');
const kindOff = (what: string) => conflict('EMAIL_KIND_OFF', `Switch ${what} on first, on the Emails page.`);

export class EmailTriggers {
  private readonly db: Db;
  private readonly email: EmailService;
  private readonly audit: AuditService;
  private readonly origin: string;
  private readonly clock: Clock;

  constructor(deps: EmailTriggersDeps) {
    this.db = deps.db;
    this.email = deps.email;
    this.audit = deps.audit;
    this.origin = deps.publicOrigin;
    this.clock = deps.clock ?? systemClock;
  }

  /** Whether a kind would be written now: the channel on and the kind switched on (read in `tx`). */
  private async writes(tx: Db, kind: EmailKind): Promise<boolean> {
    return this.email.on && (await this.email.kind(kind, tx)).enabled;
  }

  /** The accounts an email may go to, by id: ACTIVE, no test entrant, with their first name. */
  private async recipients(tx: Db, accountIds: readonly string[]): Promise<Map<string, Recipient>> {
    const ids = [...new Set(accountIds.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return new Map();
    const rows = await tx
      .selectFrom('accounts as a')
      .leftJoin('account_profiles as p', 'p.account_id', 'a.id')
      .select(['a.id', 'a.email', 'p.first_name'])
      .where(sql<boolean>`a.id = ANY(${uuidArray(ids)})`)
      .where('a.status', '=', 'ACTIVE')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('test_entrants as t').select('t.account_id').whereRef('t.account_id', '=', 'a.id'))))
      .execute();
    return new Map(rows.map((r) => [r.id.toLowerCase(), { id: r.id, email: r.email, firstName: r.first_name ?? null }]));
  }

  private link(path: string): string {
    return `${this.origin}${path}`;
  }

  // ── E4, and an order cancelled (E5) ──────────────────────────────────────

  /**
   * An order's step (services/orders.ts `step`, in its transaction): PAID → ORDER_CONFIRMED, SHIPPED → ORDER_SHIPPED
   * (once per tracking number), DELIVERED → ORDER_DELIVERED, CANCELLED → ORDER_CANCELLED; for the platform's orders only.
   */
  readonly orderStep = async (tx: Db, order: OrderRow, to: OrderStatus): Promise<void> => {
    const kind = ORDER_KINDS[to];
    if (!kind || !platformSendsOrderEmails(order) || !(await this.writes(tx, kind))) return;
    const who = (await this.recipients(tx, [order.account_id])).get(order.account_id.toLowerCase());
    if (!who) return;
    const reference = orderReference(order.id);
    let dedupeKey = `${kind}:${order.id}`;
    let shipped: { carrier: string; trackingUrl: string | null } | null = null;
    if (kind === 'ORDER_SHIPPED') {
      const c = order.carrier_id ? await tx.selectFrom('carriers').select(['name', 'tracking_url']).where('id', '=', order.carrier_id).executeTakeFirst() : undefined;
      shipped = { carrier: c?.name ?? 'the carrier', trackingUrl: c && order.tracking_number ? trackingLink(c.tracking_url, order.tracking_number) : null };
      dedupeKey = `${kind}:${order.id}:${(order.tracking_number ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
    }
    await this.email.enqueue(tx, {
      kind,
      to: who.email,
      accountId: who.id,
      dedupeKey,
      values: {
        firstName: who.firstName,
        orderRef: reference,
        link: this.link(`/verify/orders/${reference}`),
        ...(shipped ? { carrier: shipped.carrier, trackingUrl: shipped.trackingUrl } : {}),
      },
    });
  };

  // ── E5: a draw's places, the labels ──────────────────────────────────────

  /**
   * The places a draw selected (DRAW_SELECTED) or OFFER NEXT offered (DRAW_OFFERED), in the draw's transaction: each
   * entry's account, held until `heldUntil`, once per entry and kind.
   */
  async drawPlaces(tx: Db, kind: 'DRAW_SELECTED' | 'DRAW_OFFERED', d: Pick<DropRow, 'id' | 'title'>, entries: readonly { id: string; accountId: string }[], heldUntil: Date): Promise<void> {
    if (entries.length === 0 || !(await this.writes(tx, kind))) return;
    const who = await this.recipients(
      tx,
      entries.map((e) => e.accountId),
    );
    const inputs: EnqueueInput[] = [];
    for (const e of entries) {
      const r = who.get(e.accountId.toLowerCase());
      if (!r) continue;
      inputs.push({
        kind,
        to: r.email,
        accountId: r.id,
        dedupeKey: `${kind}:${e.id}`,
        values: { firstName: r.firstName, release: d.title, heldUntil, link: this.link(`/verify/releases/${d.id}`) },
      });
    }
    await this.email.enqueueMany(tx, inputs);
  }

  /** A prepaid label sent (LABEL_SENT): a warranty claim's (WARRANTY_LABEL) or a PRIVATE CARE request's (CARE_LABEL). */
  async label(tx: Db, kind: 'WARRANTY_LABEL' | 'CARE_LABEL', request: { id: string; accountId: string | null; productUuid: string }): Promise<void> {
    if (request.accountId === null || !(await this.writes(tx, kind))) return;
    const who = (await this.recipients(tx, [request.accountId])).get(request.accountId.toLowerCase());
    if (!who) return;
    const piece = await tx.selectFrom('products').select('product_id').where('id', '=', request.productUuid).executeTakeFirst();
    await this.email.enqueue(tx, {
      kind,
      to: who.email,
      accountId: who.id,
      dedupeKey: `${kind}:${request.id}`,
      values: { firstName: who.firstName, link: this.link(piece ? `/verify/pieces/${encodeURIComponent(piece.product_id)}` : '/verify/pieces') },
    });
  }

  // ── E2: the release notices ──────────────────────────────────────────────

  /**
   * The sender's scan (run first in each of its passes while the channel is on): the releases announced since the
   * watermark (less RELEASE_NOTICE_OVERLAP_MS), each to the accounts that asked and have not had its notice; then the
   * watermark moves to now. Its first run only sets the watermark.
   */
  readonly releaseNotices = async (): Promise<void> => {
    if (!this.email.on) return;
    const now = this.clock();
    const state = await this.db.selectFrom('email_state').select('releases_until').where('id', '=', 1).executeTakeFirst();
    if (!state) {
      // Its first run: the watermark set the overlap ahead, so that no scan ever looks back before this one (nothing
      // announced before the channel and the scan existed is written); it moves on with the clock once passed.
      await this.db
        .insertInto('email_state')
        .values({ id: 1, releases_until: new Date(now.getTime() + RELEASE_NOTICE_OVERLAP_MS) })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      return;
    }
    if ((await this.email.kind('RELEASE_NOTICE')).enabled) {
      const since = new Date(state.releases_until.getTime() - RELEASE_NOTICE_OVERLAP_MS);
      const announced = sql<Date>`greatest(coalesce(announce_at, published_at), published_at)`;
      const releases = await this.db
        .selectFrom('drops')
        .select(RELEASE_COLUMNS)
        .where('published_at', 'is not', null)
        .where('cancelled_at', 'is', null)
        .where('parent_drop_id', 'is', null)
        .where('closes_at', '>', now)
        .where(announced, '>', since)
        .where(announced, '<=', now)
        .orderBy('opens_at')
        .orderBy('id')
        .execute();
      for (const d of releases) await this.noticesFor(d, now);
    }
    await this.db.updateTable('email_state').set({ releases_until: now }).where('id', '=', 1).where('releases_until', '<', now).execute();
  };

  private async noticesFor(d: ReleaseRow, now: Date): Promise<void> {
    if (d.mode === 'LIVE' && d.ended_at) return;
    await inTransaction(this.db, async (tx) => {
      const prefix = `E2:${d.id}:`;
      const rows = await tx
        .selectFrom('email_preferences as e')
        .innerJoin('accounts as a', 'a.id', 'e.account_id')
        .leftJoin('account_profiles as p', 'p.account_id', 'a.id')
        .select(['a.id', 'a.email', 'p.first_name'])
        .where('e.release_notices', '=', true)
        .where('a.status', '=', 'ACTIVE')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('test_entrants as t').select('t.account_id').whereRef('t.account_id', '=', 'a.id'))))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('email_outbox as o').select('o.id').where('o.dedupe_key', '=', sql<string>`${prefix} || a.id::text`))))
        .orderBy('a.id')
        .execute();
      if (rows.length === 0) return;
      const release = await this.releaseWords(tx, d, now);
      const access = await this.accessWords(tx, d, now);
      await this.email.enqueueMany(
        tx,
        rows.map((r) => ({
          kind: 'RELEASE_NOTICE' as const,
          to: r.email,
          accountId: r.id,
          dedupeKey: `${prefix}${r.id}`,
          values: { firstName: r.first_name ?? null, release, opensAt: d.opens_at, access, link: this.link(`/verify/releases/${d.id}`) },
        })),
      );
    });
  }

  /** A release in the words its stage has made public at `now`: a draw's title; a LIVE RELEASE's once named. */
  private async releaseWords(_tx: Db, d: ReleaseRow, now: Date): Promise<string> {
    if (d.mode !== 'LIVE') return d.title;
    return liveStages(d, stagesAt(d, now))?.name ? d.title : 'A LIVE RELEASE';
  }

  /** Who may take part, in words: a draw's (everyone, or selected collectors), a LIVE RELEASE's rule as anyone reads it now. */
  private async accessWords(tx: Db, d: ReleaseRow, now: Date): Promise<string> {
    const text = d.mode === 'LIVE' ? liveRuleText(await liveAccessRule(tx, d, now)) : d.access_segment_id ? 'selected collectors' : 'every ORBES account';
    return text === 'every ORBES account' ? 'It is open to every ORBES account.' : `It is for ${text}.`;
  }

  /** YOUR PROFILE's release notices: on or off (off until asked), and when it last changed. */
  async preferences(accountId: string): Promise<{ releaseNotices: boolean; changedAt: Date | null }> {
    const r = await this.db.selectFrom('email_preferences').select(['release_notices', 'changed_at']).where('account_id', '=', accountId).executeTakeFirst();
    return { releaseNotices: r?.release_notices ?? false, changedAt: r?.changed_at ?? null };
  }

  /**
   * EMAIL ME WHEN A RELEASE IS ANNOUNCED, on or off. Audited `account.email_preferences` when it changes; off cancels the
   * account's release notices still QUEUED.
   */
  async setPreferences(accountId: string, input: { releaseNotices: boolean }, actor: Actor): Promise<{ releaseNotices: boolean; changedAt: Date | null }> {
    if (typeof input?.releaseNotices !== 'boolean') throw validationError('Choose on or off.');
    return inTransaction(this.db, (tx) => this.writePreferences(tx, accountId, input.releaseNotices, actor, 'profile'));
  }

  private async writePreferences(tx: Db, accountId: string, releaseNotices: boolean, actor: Actor, by: 'profile' | 'unsubscribe') {
    const now = this.clock();
    const account = await tx.selectFrom('accounts').select('id').where('id', '=', accountId).forUpdate().executeTakeFirst();
    if (!account) return { releaseNotices: false, changedAt: null };
    const before = await tx.selectFrom('email_preferences').select(['release_notices', 'changed_at']).where('account_id', '=', account.id).executeTakeFirst();
    if ((before?.release_notices ?? false) === releaseNotices) return { releaseNotices, changedAt: before?.changed_at ?? null };
    await tx
      .insertInto('email_preferences')
      .values({ account_id: account.id, release_notices: releaseNotices, changed_at: now })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ release_notices: releaseNotices, changed_at: now }))
      .execute();
    let cancelled = 0;
    if (!releaseNotices) {
      const r = await tx
        .updateTable('email_outbox')
        .set({ status: 'CANCELLED', settled_at: now, last_error: CANCELLED_WORDS.releaseNotices })
        .where('account_id', '=', account.id)
        .where('kind', '=', 'RELEASE_NOTICE')
        .where('status', '=', 'QUEUED')
        .executeTakeFirst();
      cancelled = Number(r.numUpdatedRows ?? 0);
    }
    await this.audit.record(
      { actor, action: 'account.email_preferences', targetType: 'account', targetId: account.id, details: { releaseNotices, by, ...(cancelled ? { emailsCancelled: cancelled } : {}) } },
      tx,
    );
    return { releaseNotices, changedAt: now };
  }

  // ── Stopping an email ────────────────────────────────────────────────────

  /** What a link stops (for the page's words), or null for a token that is not the server's. */
  unsubscribeKind(token: unknown): EmailKind | null {
    return this.email.readUnsubscribeToken(token)?.kind ?? null;
  }

  /**
   * A link that stops an email (the page's STOP, or a mail client's one click, RFC 8058): the founding announcement's
   * pre-registration unsubscribed (services/founding.ts), or the account's release notices off; their QUEUED emails
   * cancelled. Nothing for a token that is not the server's; the caller answers the same either way.
   */
  async unsubscribe(token: unknown, ipHash?: string): Promise<void> {
    const t = this.email.readUnsubscribeToken(token);
    if (!t) return;
    const withIp = <A extends Actor>(a: A): A => (ipHash ? { ...a, ipHash } : a);
    if (t.kind === 'FOUNDING_ANNOUNCEMENT') {
      await inTransaction(this.db, (tx) => unsubscribePreregistration(tx, this.audit, t.subjectId, withIp({ type: 'system', id: 'unsubscribe' }), this.clock()));
      return;
    }
    if (t.kind === 'RELEASE_NOTICE') {
      await inTransaction(this.db, (tx) => this.writePreferences(tx, t.subjectId, false, withIp({ type: 'account', id: t.subjectId }), 'unsubscribe'));
    }
  }

  // ── E1: the founding announcement ────────────────────────────────────────

  /** The founding announcement's panel: the channel, the switch, its reach, and the releases it may announce. */
  async announcement(): Promise<AnnouncementState> {
    const now = this.clock();
    const reach = await this.db.selectFrom('preregistrations').select((eb) => eb.fn.countAll<number>().as('n')).where('unsubscribed_at', 'is', null).executeTakeFirstOrThrow();
    const rows = await this.db
      .selectFrom('drops')
      .select(RELEASE_COLUMNS)
      .where('published_at', 'is not', null)
      .where('cancelled_at', 'is', null)
      .where('parent_drop_id', 'is', null)
      .where('closes_at', '>', now)
      .where('ended_at', 'is', null)
      .orderBy('opens_at')
      .orderBy('id')
      .limit(ANNOUNCEMENT_RELEASES)
      .execute();
    const counts = rows.length
      ? await this.db
          .selectFrom('email_outbox')
          .select([
            sql<string>`split_part(dedupe_key, ':', 2)`.as('drop_id'),
            'status',
            (eb) => eb.fn.countAll<number>().as('n'),
            sql<Date | null>`min(not_before) FILTER (WHERE status = 'QUEUED')`.as('next'),
          ])
          .where('kind', '=', 'FOUNDING_ANNOUNCEMENT')
          .where(sql<string>`split_part(dedupe_key, ':', 2)`, 'in', rows.map((r) => r.id))
          .groupBy([sql`split_part(dedupe_key, ':', 2)`, 'status'])
          .execute()
      : [];
    const releases: AnnouncementRelease[] = [];
    for (const d of rows) {
      const mine = counts.filter((c) => c.drop_id === d.id);
      const n = (status: string) => Number(mine.find((c) => c.status === status)?.n ?? 0);
      const next = mine.map((c) => c.next).filter((x): x is Date => x !== null);
      releases.push({
        id: d.id,
        mode: d.mode === 'LIVE' ? 'LIVE' : 'DRAW',
        title: d.title,
        words: await this.releaseWords(this.db, d, now),
        opensAt: d.opens_at,
        closesAt: d.closes_at,
        announced: d.mode !== 'LIVE' || isAnnouncedRow(d, now),
        emails: { queued: n('QUEUED'), sent: n('SENT'), failed: n('FAILED'), cancelled: n('CANCELLED') },
        scheduledAt: next.length ? new Date(Math.min(...next.map((x) => new Date(x).getTime()))) : null,
      });
    }
    return { channel: this.email.on, enabled: (await this.email.kind('FOUNDING_ANNOUNCEMENT')).enabled, reach: Number(reach.n), releases };
  }

  /**
   * Send the founding announcement (ADMIN, the phrase SEND <8>): to every pre-registration not unsubscribed that has not
   * had it for this release (queued, sent or failed), now or at the release's opening. 409 EMAIL_OFF, EMAIL_KIND_OFF, a
   * release not published, cancelled or over, or a LIVE RELEASE not announced yet sent now; 404 for an after-room or an
   * unknown release. Audited `email.announcement.queue` with the counts, never an address.
   */
  async queueAnnouncement(dropId: string, input: { when: 'NOW' | 'OPENING'; phrase: unknown }, actor: Actor): Promise<{ queued: number; notBefore: Date }> {
    if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw releaseNotFound();
    const id = dropId.toLowerCase();
    const wanted = announcementPhrase(id);
    if (typeof input?.phrase !== 'string' || input.phrase.trim().replace(/\s+/g, ' ').toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
    if (input.when !== 'NOW' && input.when !== 'OPENING') throw validationError('Send it now or at the release’s opening.');
    if (!this.email.on) throw emailOff();
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await tx.selectFrom('drops').select(RELEASE_COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!d || d.parent_drop_id !== null) throw releaseNotFound();
      if (!d.published_at) throw conflict('RELEASE_NOT_PUBLISHED', 'Publish the release first.');
      if (d.cancelled_at) throw conflict('DROP_CANCELLED', 'This release is cancelled.');
      if (d.closes_at.getTime() <= now.getTime() || d.ended_at || d.drawn_at) throw conflict('RELEASE_OVER', 'This release is over.');
      if (input.when === 'NOW' && d.mode === 'LIVE' && !isAnnouncedRow(d, now)) throw conflict('RELEASE_NOT_ANNOUNCED', 'This release is not announced yet: send it at its opening.');
      if (!(await this.email.kind('FOUNDING_ANNOUNCEMENT', tx)).enabled) throw kindOff('the founding announcement');
      const notBefore = input.when === 'OPENING' && d.opens_at.getTime() > now.getTime() ? d.opens_at : now;
      const prefix = `E1:${d.id}:`;
      const people = await tx
        .selectFrom('preregistrations as p')
        .select([
          'p.id',
          'p.email',
          'p.first_name',
          (eb) =>
            eb
              .selectFrom('email_outbox as o')
              .select((x) => x.fn.countAll<number>().as('n'))
              .whereRef('o.preregistration_id', '=', 'p.id')
              .where('o.kind', '=', 'FOUNDING_ANNOUNCEMENT')
              .where('o.dedupe_key', 'like', `${prefix}%`)
              .as('tries'),
        ])
        .where('p.unsubscribed_at', 'is', null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('email_outbox as o')
                .select('o.id')
                .whereRef('o.preregistration_id', '=', 'p.id')
                .where('o.kind', '=', 'FOUNDING_ANNOUNCEMENT')
                .where('o.dedupe_key', 'like', `${prefix}%`)
                .where('o.status', '<>', 'CANCELLED'),
            ),
          ),
        )
        .orderBy('p.created_at')
        .orderBy('p.id')
        .execute();
      const release = await this.releaseWords(tx, d, now);
      const results = await this.email.enqueueMany(
        tx,
        people.map((p) => {
          const tries = Number(p.tries ?? 0);
          return {
            kind: 'FOUNDING_ANNOUNCEMENT' as const,
            to: p.email,
            preregistrationId: p.id,
            dedupeKey: tries === 0 ? `${prefix}${p.id}` : `${prefix}${p.id}:${tries + 1}`,
            values: { firstName: p.first_name, release, opensAt: d.opens_at, link: this.link(`/verify/releases/${d.id}`) },
            notBefore,
          };
        }),
      );
      const queued = results.filter((r) => r.queued).length;
      await this.audit.record(
        { actor, action: 'email.announcement.queue', targetType: 'drop', targetId: d.id, details: { dropId: d.id, when: input.when, notBefore: notBefore.toISOString(), queued, reach: people.length } },
        tx,
      );
      return { queued, notBefore };
    });
  }

  /** CANCEL SCHEDULED (ADMIN): the release's founding announcements still QUEUED, CANCELLED. Audited `email.announcement.cancel` when it cancels any. */
  async cancelAnnouncement(dropId: string, actor: Actor): Promise<{ cancelled: number }> {
    if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw releaseNotFound();
    const id = dropId.toLowerCase();
    return inTransaction(this.db, async (tx) => {
      const d = await tx.selectFrom('drops').select(['id', 'parent_drop_id']).where('id', '=', id).executeTakeFirst();
      if (!d || d.parent_drop_id !== null) throw releaseNotFound();
      const now = this.clock();
      const r = await tx
        .updateTable('email_outbox')
        .set({ status: 'CANCELLED', settled_at: now, last_error: CANCELLED_WORDS.announcement })
        .where('kind', '=', 'FOUNDING_ANNOUNCEMENT')
        .where('dedupe_key', 'like', `E1:${d.id}:%`)
        .where('status', '=', 'QUEUED')
        .executeTakeFirst();
      const cancelled = Number(r.numUpdatedRows ?? 0);
      if (cancelled > 0) await this.audit.record({ actor, action: 'email.announcement.cancel', targetType: 'drop', targetId: d.id, details: { dropId: d.id, cancelled } }, tx);
      return { cancelled };
    });
  }
}

/** The email each step of an order writes. */
const ORDER_KINDS: Readonly<Partial<Record<OrderStatus, EmailKind>>> = Object.freeze({
  PAID: 'ORDER_CONFIRMED',
  SHIPPED: 'ORDER_SHIPPED',
  DELIVERED: 'ORDER_DELIVERED',
  CANCELLED: 'ORDER_CANCELLED',
});

/** A release announced at `now`: published, and past its announcement (a LIVE RELEASE's `announce_at`). */
function isAnnouncedRow(d: Pick<DropRow, 'announce_at' | 'published_at'>, now: Date): boolean {
  const at = announcedAt(d);
  return d.published_at !== null && at !== null && now.getTime() >= at.getTime() && now.getTime() >= d.published_at.getTime();
}
