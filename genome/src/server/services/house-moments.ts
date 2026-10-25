/**
 * The house's moments (macro scope of 2026-10-20, D24 M1; lot M2 plan §1.2, step M2.2): six automatic messages ORBES
 * writes in a collector's MESSAGES (M4: there and on NOW's unread line only; no push, no email copy), read-only (M3).
 * Each has its own switch and its title and words, edited in the console (`house_moment_settings`, migration 0052; no row
 * is off with the default words of src/shared/house-words.ts). Every moment starts off.
 *
 *   a) FIRST_REGISTRATION  due the Paris day after the account's first ownership began (any way in: a claim, an order
 *                          fulfilled, a transfer received), once ever (`FIRST_REGISTRATION:<account>`); its piece is
 *                          that ownership's.
 *   b) BIRTHDAY_CREDIT     due when the birthday credit is granted (`tier_grants` kind BIRTHDAY), while it has not
 *                          expired and a balance is left (`BIRTHDAY_CREDIT:<grant>`).
 *   c) CREDIT_EXPIRING     due 7 days before a credit expires (CREDIT, BIRTHDAY or WARRANTY; never before it was granted),
 *                          while a balance is left (its amount less its open uses, `creditBalances`) and it is usable at
 *                          the account's tier now (`usableAt`): a tier's credit waiting below its tier says nothing
 *                          (`CREDIT_EXPIRING:<grant>`).
 *   d) PRIVATE_CARE        due when the account first reached the tier PRIVATE CARE opens from (`careOpens`, THE
 *                          PROGRAM's: the earliest GIFT grant of that tier or above, written once ever on reaching it),
 *                          while the tier held now still reaches it; nothing while THE PROGRAM gives no PRIVATE CARE
 *                          (`careOpens` null), once ever (`PRIVATE_CARE:<account>`).
 *   e) OWNERSHIP_YEAR      due the Paris day one year after an open ownership began (29 February on 28 February, as
 *                          `birthdayIn` does), the first year only (`OWNERSHIP_YEAR:<ownership>`).
 *   f) NINETY_DAYS         due 90 days after the account's last activity: the segments' ACTIVE criterion (a sign-in, a
 *                          session in use, a scan) and a page viewed; the account's creation when there is none; once
 *                          per absence: never while a NINETY_DAYS message reached the account since that activity
 *                          (`NINETY_DAYS:<account>:<the Paris day of the last activity>`).
 *
 * The switch-on rule (plan §1.2, §11 note 1): a moment delivers only what falls due at or after its switch-on
 * (`enabled_at`, moved to now at each switch-on), never the past; a pass missed later still catches up, since anything
 * due after `enabled_at` is delivered at the next pass.
 *
 * Who receives anything: ACTIVE accounts only (never a LOCKED or DELETED one), never a test entrant (`notTestEntrant`).
 *
 * The words are rendered at delivery and stored with it (`house_deliveries`: title one line of at most 400 characters,
 * words at most 8 000), so an edit changes the next deliveries, never those already read. A placeholder unknown to the
 * moment is refused at saving (422 HOUSE_PLACEHOLDER).
 *
 * `runMoments(now)` is the housekeeping job `houseMoments` (context.ts), at every pass while the morning window is open,
 * after `birthdayCredits`: for each moment switched on, the due events read (a coarse window in SQL, the exact due time
 * here, on the same pure functions the tests drive on a fake clock), rendered, inserted in transactions of at most 500
 * (`ON CONFLICT (dedupe_key) DO NOTHING`: two passes, a restart or two processes never deliver one twice), each
 * transaction audited by counts (`house.moment.delivered {moment, count}`, the system as actor; never an account). One
 * `house moments` log line per pass while a moment is on, with the counts per moment.
 *
 * The console (routes/admin/house.ts, step M2.3): `settings()` reads each moment's switch, words, defaults, placeholders
 * and links, `moments()` adds how many were delivered and read (30 days and in all), `preview` renders a moment with
 * example values; `setMoment` switches (`house.moment.enable` / `.disable`, ADMIN) and edits the words
 * (`house.moment.words`, OPERATOR, each as its length and SHA-256, never the words themselves).
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { HOUSE_BODY_MAX, HOUSE_DELIVERED_BODY_MAX, HOUSE_DELIVERED_TITLE_MAX, HOUSE_MOMENTS, HOUSE_TITLE_MAX, type HouseMoment } from '../db/schema.js';
import { DomainError, forbidden, notFound, validationError } from '../errors.js';
import { noopLogger, SYSTEM_ACTOR, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import {
  HOUSE_DEFAULT_WORDS,
  HOUSE_MOMENT_LINKS,
  HOUSE_PLACEHOLDERS,
  houseDate,
  houseMoney,
  renderHouseWords,
  unknownPlaceholders,
  type HouseLinkKind,
  type HousePlaceholder,
  type HouseValues,
  type HouseWords,
} from '../../shared/house-words.js';
import type { AuditService } from './audit.js';
import { birthdayIn, dayPlus } from './birthday-credits.js';
import { careOpens } from './care.js';
import { clubStandings, tierLevel } from './club.js';
import { readProgram, type ClubProgram } from './club-program.js';
import { notTestEntrant } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';
import { CREDIT_KINDS, usableAt, type CreditKind } from './tier-grants.js';

const DAY_MS = 86_400_000;

/** c) is due this many days before a credit expires. */
export const CREDIT_EXPIRING_DAYS = 7;
/** f) is due this many days after the last activity. */
export const ABSENCE_DAYS = 90;
/** Deliveries inserted per transaction. */
export const HOUSE_DELIVERY_BATCH = 500;

// ── Due times (pure: the tests drive them on a fake clock) ─────────────────

/** a) The first instant (00:00 Paris) of the Paris day after the account's first ownership began. */
export function firstRegistrationDue(firstStartedAt: Date): Date {
  return parisDayStart(dayPlus(parisDay(firstStartedAt), 1));
}

/** e) The first instant (00:00 Paris) of the Paris day one year after an ownership began; 29 February on 28 February. */
export function ownershipYearDue(startedAt: Date): Date {
  const day = parisDay(startedAt);
  return parisDayStart(birthdayIn(Number(day.slice(0, 4)) + 1, day));
}

/** c) 7 days before the credit expires, never before it was granted. */
export function creditExpiringDue(expiresAt: Date, grantedAt: Date): Date {
  return new Date(Math.max(expiresAt.getTime() - CREDIT_EXPIRING_DAYS * DAY_MS, grantedAt.getTime()));
}

/** f) 90 days after the last activity. */
export function absenceDue(lastActivity: Date): Date {
  return new Date(lastActivity.getTime() + ABSENCE_DAYS * DAY_MS);
}

/** The switch-on rule: due at or after the moment's switch-on, and not after now. */
export function isDue(due: Date, enabledAt: Date, now: Date): boolean {
  return due.getTime() >= enabledAt.getTime() && due.getTime() <= now.getTime();
}

/** Each moment's dedupe key (house_deliveries.dedupe_key, at most 200 characters). */
export const momentKey = {
  FIRST_REGISTRATION: (accountId: string) => `FIRST_REGISTRATION:${accountId}`,
  BIRTHDAY_CREDIT: (grantId: string) => `BIRTHDAY_CREDIT:${grantId}`,
  CREDIT_EXPIRING: (grantId: string) => `CREDIT_EXPIRING:${grantId}`,
  PRIVATE_CARE: (accountId: string) => `PRIVATE_CARE:${accountId}`,
  OWNERSHIP_YEAR: (ownershipId: string) => `OWNERSHIP_YEAR:${ownershipId}`,
  NINETY_DAYS: (accountId: string, lastActivity: Date) => `NINETY_DAYS:${accountId}:${parisDay(lastActivity)}`,
} as const;

// ── Words ──────────────────────────────────────────────────────────────────

/** A model's name as {piece} says it (plan §1.2): MONOLITHE, or MONOLITHE IN STEEL, the variant's label in capitals. */
export function pieceName(name: string, variantLabel: string | null): string {
  const v = typeof variantLabel === 'string' ? variantLabel.trim().replace(/\s+/g, ' ').toUpperCase() : '';
  return v ? `${name} IN ${v}` : name;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g;

function cut(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** A rendered title as stored: one line, spaces made single, at most 400 characters; blank → null. */
export function deliveredTitle(s: string): string | null {
  const line = s.replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  return line === '' ? null : cut(line, HOUSE_DELIVERED_TITLE_MAX);
}

/** Rendered words as stored: line breaks kept, at most 8 000 characters; blank → null. */
export function deliveredBody(s: string): string | null {
  const text = s.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  return /\S/.test(text) ? cut(text, HOUSE_DELIVERED_BODY_MAX) : null;
}

/**
 * A moment's title and words for one account, its placeholders filled; a title or words that render blank (a lone
 * {firstName} without one) read as the defaults'.
 */
export function renderMoment(moment: HouseMoment, words: { title: string | null; body: string | null }, values: HouseValues): HouseWords {
  const d = HOUSE_DEFAULT_WORDS[moment];
  return {
    title: deliveredTitle(renderHouseWords(words.title ?? d.title, values)) ?? deliveredTitle(renderHouseWords(d.title, values)) ?? moment,
    body: deliveredBody(renderHouseWords(words.body ?? d.body, values)) ?? deliveredBody(renderHouseWords(d.body, values)) ?? d.body,
  };
}

/** The words' fingerprint in the audit log: their length and SHA-256, never the words (the circle's rule). */
function fingerprint(s: string | null): { length: number; sha256: string } | null {
  return s === null ? null : { length: [...s].length, sha256: createHash('sha256').update(s, 'utf8').digest('hex') };
}

export const housePlaceholder = (found: readonly string[], allowed: readonly HousePlaceholder[]) =>
  new DomainError(
    'HOUSE_PLACEHOLDER',
    422,
    `${found.join(', ')} cannot be used here. The words may hold ${allowed.map((p) => `{${p}}`).join(', ')}.`,
  );

/** A title as the console writes it: one line, trimmed, 1 to 80 characters; null, '' or blank → the default (null). */
export function cleanHouseTitle(v: unknown, allowed: readonly HousePlaceholder[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The title must be text.');
  const t = v.trim();
  if (t === '') return null;
  if (/[\r\n]/.test(t)) throw validationError('The title is one line.');
  if (/[\u0000-\u001f\u007f]/.test(t)) throw validationError('The title contains invalid characters.');
  if ([...t].length > HOUSE_TITLE_MAX) throw validationError(`The title is limited to ${HOUSE_TITLE_MAX} characters.`);
  const unknown = unknownPlaceholders(t, allowed);
  if (unknown.length > 0) throw housePlaceholder(unknown, allowed);
  return t;
}

/** Words as the console writes them: plain paragraphs, at most 2 000 characters; null, '' or blank → the default (null). */
export function cleanHouseBody(v: unknown, allowed: readonly HousePlaceholder[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The words must be text.');
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (!/\S/.test(t)) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) throw validationError('The words contain invalid characters.');
  if ([...t].length > HOUSE_BODY_MAX) throw validationError(`The words are limited to ${HOUSE_BODY_MAX.toLocaleString('en-GB')} characters.`);
  const unknown = unknownPlaceholders(t, allowed);
  if (unknown.length > 0) throw housePlaceholder(unknown, allowed);
  return t;
}

// ── The service ────────────────────────────────────────────────────────────

/** A moment as the console reads it. */
export interface HouseMomentView {
  moment: HouseMoment;
  enabled: boolean;
  /** Since when it is on (what falls due from then on is delivered); null while off. */
  enabledAt: Date | null;
  /** The console's title and words; null: the default's. */
  title: string | null;
  body: string | null;
  defaults: HouseWords;
  placeholders: readonly HousePlaceholder[];
  links: readonly HouseLinkKind[];
  updatedAt: Date | null;
}

/** How many of a moment's messages were delivered and read: over the last 30 days (delivered since then) and in all. */
export interface HouseMomentFigures {
  delivered30: number;
  read30: number;
  delivered: number;
  read: number;
}

/** The console's figures cover this many days. */
export const HOUSE_FIGURES_DAYS = 30;
/** The first name a preview is written to. */
export const HOUSE_SAMPLE_FIRST_NAME = 'Camille';

/** A moment as its PREVIEW shows it: the title and words rendered, its links, the example values used. */
export interface HouseMomentPreview extends HouseWords {
  moment: HouseMoment;
  links: readonly HouseLinkKind[];
  values: Record<string, string>;
}

/** One message due to one account. */
interface Due {
  accountId: string;
  key: string;
  pieceRef: string | null;
  values: HouseValues;
}

interface Setting {
  moment: HouseMoment;
  enabledAt: Date;
  title: string | null;
  body: string | null;
}

export interface HouseMomentServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
  log?: Logger;
}

const accountFilter = (column: string) => sql`${sql.ref(column)} IN (SELECT ha.id FROM accounts ha WHERE ha.status = 'ACTIVE') AND ${notTestEntrant(column)}`;

export class HouseMomentService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: HouseMomentServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /** Every moment, in the scope's order: its switch, its words, the defaults, its placeholders and links. */
  async settings(db: Db = this.db): Promise<HouseMomentView[]> {
    const rows = await db.selectFrom('house_moment_settings').selectAll().execute();
    const of = new Map(rows.map((r) => [r.moment, r]));
    return HOUSE_MOMENTS.map((moment) => {
      const r = of.get(moment);
      return {
        moment,
        enabled: r?.enabled ?? false,
        enabledAt: r?.enabled_at ?? null,
        title: r?.title ?? null,
        body: r?.body ?? null,
        defaults: { ...HOUSE_DEFAULT_WORDS[moment] },
        placeholders: HOUSE_PLACEHOLDERS[moment],
        links: HOUSE_MOMENT_LINKS[moment],
        updatedAt: r?.updated_at ?? null,
      };
    });
  }

  /**
   * Switch a moment (`enabled`: on moves `enabled_at` to now, so nothing of the past is sent; off clears it) and/or set
   * its words (`title`, `body`: a string, or null for the default's; absent: unchanged). Refuses a placeholder the
   * moment does not have (422 HOUSE_PLACEHOLDER). The roles (the switch ADMIN, the words OPERATOR) are the routes'.
   */
  async setMoment(moment: unknown, input: { enabled?: unknown; title?: unknown; body?: unknown }, actor: Actor): Promise<HouseMomentView> {
    if (typeof moment !== 'string' || !(HOUSE_MOMENTS as readonly string[]).includes(moment)) throw notFound('Moment', 'HOUSE_MOMENT_NOT_FOUND');
    const m = moment as HouseMoment;
    if (actor?.type !== 'admin' || typeof actor.id !== 'string') throw forbidden('Only ORBES staff can change a moment.');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw validationError('enabled must be true or false.');
    const allowed = HOUSE_PLACEHOLDERS[m];
    const title = input.title === undefined ? undefined : cleanHouseTitle(input.title, allowed);
    const body = input.body === undefined ? undefined : cleanHouseBody(input.body, allowed);
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      // A moment the console never touched has no row to lock: make it (off, no words) first, so two first writes at once
      // read one after the other and neither overwrites the other's change.
      await tx.insertInto('house_moment_settings').values({ moment: m, enabled: false, updated_by: actor.id!, updated_at: now }).onConflict((oc) => oc.column('moment').doNothing()).execute();
      const before = await tx.selectFrom('house_moment_settings').selectAll().where('moment', '=', m).forUpdate().executeTakeFirstOrThrow();
      const wasOn = before.enabled;
      const on = input.enabled === undefined ? wasOn : (input.enabled as boolean);
      const next = {
        enabled: on,
        enabled_at: on ? (wasOn ? before.enabled_at : now) : null,
        title: title === undefined ? before.title : title,
        body: body === undefined ? before.body : body,
      };
      const switched = on !== wasOn;
      const changed = { title: next.title !== before.title, body: next.body !== before.body };
      if (!switched && !changed.title && !changed.body) return (await this.settings(tx)).find((v) => v.moment === m)!;
      await tx.updateTable('house_moment_settings').set({ ...next, updated_by: actor.id!, updated_at: now }).where('moment', '=', m).execute();
      if (switched) await this.audit.record({ actor, action: on ? 'house.moment.enable' : 'house.moment.disable', targetType: 'house_moment', targetId: m, details: { moment: m } }, tx);
      if (changed.title || changed.body) {
        await this.audit.record(
          {
            actor,
            action: 'house.moment.words',
            targetType: 'house_moment',
            targetId: m,
            details: {
              moment: m,
              ...(changed.title ? { title: fingerprint(next.title) } : {}),
              ...(changed.body ? { body: fingerprint(next.body) } : {}),
              defaults: { title: next.title === null, body: next.body === null },
            },
          },
          tx,
        );
      }
      return (await this.settings(tx)).find((v) => v.moment === m)!;
    });
  }

  /**
   * Every moment as the console's MOMENTS lists it (step M2.3): `settings()` with how many were delivered and read, over
   * the last 30 days (delivered since then) and in all.
   */
  async moments(now: Date = this.clock()): Promise<(HouseMomentView & { figures: HouseMomentFigures })[]> {
    const since = new Date(now.getTime() - HOUSE_FIGURES_DAYS * DAY_MS);
    const [views, counted] = await Promise.all([
      this.settings(),
      sql<{ moment: HouseMoment; delivered: string | number; read: string | number; delivered30: string | number; read30: string | number }>`
        SELECT moment, count(*) AS delivered, count(read_at) AS read,
               count(*) FILTER (WHERE delivered_at >= ${since}) AS delivered30,
               count(read_at) FILTER (WHERE delivered_at >= ${since}) AS read30
          FROM house_deliveries
         WHERE source = 'MOMENT'
         GROUP BY moment`.execute(this.db),
    ]);
    const of = new Map(counted.rows.map((r) => [r.moment, r]));
    return views.map((v) => {
      const r = of.get(v.moment);
      return { ...v, figures: { delivered30: Number(r?.delivered30 ?? 0), read30: Number(r?.read30 ?? 0), delivered: Number(r?.delivered ?? 0), read: Number(r?.read ?? 0) } };
    });
  }

  /**
   * A moment as a collector would read it (the console's PREVIEW), with example values: the words given (each a string,
   * null for the default's; absent: the moment's own now), checked as a save checks them (422 HOUSE_PLACEHOLDER).
   * {piece} names the catalogue's first model, {amount} € 20, {expires} a date 30 days ahead, {tier} the tier PRIVATE
   * CARE opens from. Nothing is stored.
   */
  async preview(moment: unknown, words: { title?: unknown; body?: unknown } = {}, now: Date = this.clock()): Promise<HouseMomentPreview> {
    if (typeof moment !== 'string' || !(HOUSE_MOMENTS as readonly string[]).includes(moment)) throw notFound('Moment', 'HOUSE_MOMENT_NOT_FOUND');
    const m = moment as HouseMoment;
    const allowed = HOUSE_PLACEHOLDERS[m];
    const title = words.title === undefined ? undefined : cleanHouseTitle(words.title, allowed);
    const body = words.body === undefined ? undefined : cleanHouseBody(words.body, allowed);
    const current = (await this.settings()).find((v) => v.moment === m)!;
    const [model, program] = await Promise.all([
      this.db.selectFrom('models').select(['name', 'variant_label']).where('active', '=', true).orderBy('name').orderBy('id').limit(1).executeTakeFirst(),
      readProgram(this.db),
    ]);
    const values: HouseValues = {
      firstName: HOUSE_SAMPLE_FIRST_NAME,
      piece: model ? pieceName(model.name, model.variant_label) : 'YOUR PIECE',
      amount: houseMoney(2000, 'EUR'),
      expires: houseDate(parisDay(new Date(now.getTime() + 30 * DAY_MS))),
      tier: careOpens(program)?.tier ?? 'PLATINE',
    };
    const rendered = renderMoment(m, { title: title === undefined ? current.title : title, body: body === undefined ? current.body : body }, values);
    return { moment: m, ...rendered, links: HOUSE_MOMENT_LINKS[m], values: Object.fromEntries(allowed.map((p) => [p, values[p] ?? ''])) };
  }

  /**
   * The moments due at `now` (the housekeeping job `houseMoments`): for each moment switched on, the events due since its
   * switch-on, rendered and delivered once each. Returns how many were delivered; a moment that fails is logged and the
   * others go on (the next pass tries it again).
   */
  async runMoments(now: Date = this.clock()): Promise<number> {
    const rows = await this.db.selectFrom('house_moment_settings').selectAll().where('enabled', '=', true).execute();
    if (rows.length === 0) return 0;
    const on = new Map<HouseMoment, Setting>(rows.map((r) => [r.moment, { moment: r.moment, enabledAt: r.enabled_at!, title: r.title, body: r.body }]));
    const program = await readProgram(this.db);
    const counts: Partial<Record<HouseMoment, number>> = {};
    let total = 0;
    for (const moment of HOUSE_MOMENTS) {
      const s = on.get(moment);
      if (!s) continue;
      try {
        const due = await this.read(moment, s.enabledAt, now, program);
        const n = await this.deliver(s, due, now);
        counts[moment] = n;
        total += n;
      } catch (e) {
        this.log.error({ moment, err: { message: (e as Error)?.message } }, 'a house moment could not be delivered');
      }
    }
    this.log.info({ ...counts, total }, 'house moments');
    return total;
  }

  /** What `moment` has due at `now`, since `enabledAt`, not delivered yet. */
  async read(moment: HouseMoment, enabledAt: Date, now: Date, program?: ClubProgram): Promise<Due[]> {
    switch (moment) {
      case 'FIRST_REGISTRATION':
        return this.firstRegistrations(enabledAt, now);
      case 'BIRTHDAY_CREDIT':
        return this.birthdayCredits(enabledAt, now);
      case 'CREDIT_EXPIRING':
        return this.creditsExpiring(enabledAt, now);
      case 'PRIVATE_CARE':
        return this.privateCare(enabledAt, now, program ?? (await readProgram(this.db)));
      case 'OWNERSHIP_YEAR':
        return this.ownershipYears(enabledAt, now);
      case 'NINETY_DAYS':
        return this.absences(enabledAt, now);
    }
  }

  /** a) Each account's first ownership whose next Paris day began since the switch-on. */
  private async firstRegistrations(enabledAt: Date, now: Date): Promise<Due[]> {
    const r = await sql<{ account_id: string; started_at: Date; piece_ref: string; name: string; variant_label: string | null; first_name: string | null }>`
      SELECT o.account_id, o.started_at, p.product_id AS piece_ref, m.name, m.variant_label, pr.first_name
        FROM ownership o
        JOIN products p ON p.id = o.product_id
        JOIN models m ON m.id = p.model_id
        LEFT JOIN account_profiles pr ON pr.account_id = o.account_id
       WHERE o.started_at >= ${new Date(enabledAt.getTime() - 2 * DAY_MS)} AND o.started_at < ${now}
         AND NOT EXISTS (SELECT 1 FROM ownership o2 WHERE o2.account_id = o.account_id AND (o2.started_at, o2.id) < (o.started_at, o.id))
         AND ${accountFilter('o.account_id')}
         AND NOT EXISTS (SELECT 1 FROM house_deliveries d WHERE d.dedupe_key = 'FIRST_REGISTRATION:' || o.account_id::text)
       ORDER BY o.started_at, o.id`.execute(this.db);
    return r.rows
      .filter((x) => isDue(firstRegistrationDue(x.started_at), enabledAt, now))
      .map((x) => ({ accountId: x.account_id, key: momentKey.FIRST_REGISTRATION(x.account_id), pieceRef: x.piece_ref, values: { firstName: x.first_name, piece: pieceName(x.name, x.variant_label) } }));
  }

  /** b) Each birthday credit granted since the switch-on, not expired, with a balance left. */
  private async birthdayCredits(enabledAt: Date, now: Date): Promise<Due[]> {
    const rows = await this.grants(['BIRTHDAY'], sql`g.granted_at >= ${enabledAt} AND g.granted_at <= ${now} AND g.expires_at > ${now}`);
    return rows
      .filter((g) => g.balance > 0)
      .map((g) => ({ accountId: g.account_id, key: momentKey.BIRTHDAY_CREDIT(g.id), pieceRef: null, values: { firstName: g.first_name, amount: houseMoney(g.balance, g.currency), expires: houseDate(parisDay(g.expires_at)) } }));
  }

  /** c) Each credit whose 7 days before expiry began since the switch-on, not expired, a balance left, usable at the tier now. */
  private async creditsExpiring(enabledAt: Date, now: Date): Promise<Due[]> {
    const rows = (await this.grants([...CREDIT_KINDS], sql`g.expires_at > ${now} AND g.expires_at >= ${enabledAt} AND g.expires_at <= ${new Date(now.getTime() + CREDIT_EXPIRING_DAYS * DAY_MS)}`)).filter(
      (g) => g.balance > 0 && isDue(creditExpiringDue(g.expires_at, g.granted_at), enabledAt, now),
    );
    if (rows.length === 0) return [];
    const standings = await clubStandings(this.db, [...new Set(rows.map((g) => g.account_id))], now);
    return rows
      .filter((g) => usableAt({ kind: g.kind, tier: g.kind === 'CREDIT' ? (g.tier as 2 | 3) : null }, standings.get(g.account_id)?.tier ?? 0))
      .map((g) => ({ accountId: g.account_id, key: momentKey.CREDIT_EXPIRING(g.id), pieceRef: null, values: { firstName: g.first_name, amount: houseMoney(g.balance, g.currency), expires: houseDate(parisDay(g.expires_at)) } }));
  }

  /** The credit grants of `kinds` matching `where`, with their balance (the amount less the open uses), not delivered yet. */
  private async grants(kinds: CreditKind[], where: ReturnType<typeof sql>) {
    const moment = kinds.length === 1 && kinds[0] === 'BIRTHDAY' ? 'BIRTHDAY_CREDIT' : 'CREDIT_EXPIRING';
    const r = await sql<{ id: string; account_id: string; kind: CreditKind; tier: number | null; granted_at: Date; expires_at: Date; amount_minor: number; currency: string; used: string | number | null; first_name: string | null }>`
      SELECT g.id, g.account_id, g.kind, g.tier, g.granted_at, g.expires_at, g.amount_minor, g.currency, pr.first_name,
             (SELECT sum(u.amount_minor) FROM credit_uses u WHERE u.grant_id = g.id AND u.released_at IS NULL) AS used
        FROM tier_grants g
        LEFT JOIN account_profiles pr ON pr.account_id = g.account_id
       WHERE g.kind IN (${sql.join(kinds)}) AND ${where}
         AND ${accountFilter('g.account_id')}
         AND NOT EXISTS (SELECT 1 FROM house_deliveries d WHERE d.dedupe_key = ${`${moment}:`} || g.id::text)
       ORDER BY g.granted_at, g.id`.execute(this.db);
    return r.rows.map((g) => ({ ...g, balance: Math.max(0, g.amount_minor - Number(g.used ?? 0)) }));
  }

  /** d) Each account that reached the tier PRIVATE CARE opens from since the switch-on, and still holds it. */
  private async privateCare(enabledAt: Date, now: Date, program: ClubProgram): Promise<Due[]> {
    const opens = careOpens(program);
    if (opens === null) return [];
    const level = tierLevel(opens.tier);
    const r = await sql<{ account_id: string; reached_at: Date; first_name: string | null }>`
      SELECT g.account_id, min(g.granted_at) AS reached_at, min(pr.first_name) AS first_name
        FROM tier_grants g
        LEFT JOIN account_profiles pr ON pr.account_id = g.account_id
       WHERE g.kind = 'GIFT' AND g.tier >= ${level}
         AND ${accountFilter('g.account_id')}
         AND NOT EXISTS (SELECT 1 FROM house_deliveries d WHERE d.dedupe_key = 'PRIVATE_CARE:' || g.account_id::text)
       GROUP BY g.account_id
      HAVING min(g.granted_at) >= ${enabledAt} AND min(g.granted_at) <= ${now}`.execute(this.db);
    const rows = r.rows.filter((x) => isDue(new Date(x.reached_at), enabledAt, now));
    if (rows.length === 0) return [];
    const standings = await clubStandings(this.db, rows.map((x) => x.account_id), now);
    return rows
      .filter((x) => {
        const s = standings.get(x.account_id);
        return s !== undefined && s.pieces > 0 && s.tier >= level;
      })
      .map((x) => ({ accountId: x.account_id, key: momentKey.PRIVATE_CARE(x.account_id), pieceRef: null, values: { firstName: x.first_name, tier: opens.tier } }));
  }

  /** e) Each open ownership whose first anniversary (a Paris day) began since the switch-on. */
  private async ownershipYears(enabledAt: Date, now: Date): Promise<Due[]> {
    const r = await sql<{ id: string; account_id: string; started_at: Date; piece_ref: string; name: string; variant_label: string | null; first_name: string | null }>`
      SELECT o.id, o.account_id, o.started_at, p.product_id AS piece_ref, m.name, m.variant_label, pr.first_name
        FROM ownership o
        JOIN products p ON p.id = o.product_id
        JOIN models m ON m.id = p.model_id
        LEFT JOIN account_profiles pr ON pr.account_id = o.account_id
       WHERE o.ended_at IS NULL
         AND o.started_at >= ${new Date(enabledAt.getTime() - 368 * DAY_MS)} AND o.started_at <= ${new Date(now.getTime() - 364 * DAY_MS)}
         AND ${accountFilter('o.account_id')}
         AND NOT EXISTS (SELECT 1 FROM house_deliveries d WHERE d.dedupe_key = 'OWNERSHIP_YEAR:' || o.id::text)
       ORDER BY o.started_at, o.id`.execute(this.db);
    return r.rows
      .filter((x) => isDue(ownershipYearDue(x.started_at), enabledAt, now))
      .map((x) => ({ accountId: x.account_id, key: momentKey.OWNERSHIP_YEAR(x.id), pieceRef: x.piece_ref, values: { firstName: x.first_name, piece: pieceName(x.name, x.variant_label) } }));
  }

  /**
   * f) Each account whose last activity (a sign-in, a session in use, a scan: the segments' ACTIVE criterion; a page
   * viewed, kept 13 months, so a purged or signed-out session does not bring it forward; its creation when none) was 90 days ago since the switch-on, and that no NINETY_DAYS message reached since that activity.
   */
  private async absences(enabledAt: Date, now: Date): Promise<Due[]> {
    const from = new Date(enabledAt.getTime() - ABSENCE_DAYS * DAY_MS);
    const to = new Date(now.getTime() - ABSENCE_DAYS * DAY_MS);
    if (to.getTime() < from.getTime()) return [];
    const r = await sql<{ account_id: string; last_at: Date; first_name: string | null }>`
      SELECT x.account_id, x.last_at, pr.first_name
        FROM (
          SELECT a.id AS account_id,
                 greatest(a.created_at,
                          (SELECT max(al.occurred_at) FROM audit_logs al WHERE al.action = 'account.login' AND al.target_type = 'account' AND al.target_id = a.id::text),
                          (SELECT max(ss.last_seen_at) FROM sessions ss WHERE ss.subject_type = 'account' AND ss.subject_id = a.id),
                          (SELECT max(se.occurred_at) FROM scan_events se WHERE se.account_id = a.id),
                          (SELECT max(cv.at) FROM collector_views cv WHERE cv.account_id = a.id)) AS last_at
            FROM accounts a
           WHERE a.status = 'ACTIVE' AND a.created_at <= ${to} AND ${notTestEntrant('a.id')}
        ) x
        LEFT JOIN account_profiles pr ON pr.account_id = x.account_id
       WHERE x.last_at >= ${from} AND x.last_at <= ${to}
         AND NOT EXISTS (SELECT 1 FROM house_deliveries d WHERE d.account_id = x.account_id AND d.moment = 'NINETY_DAYS' AND d.delivered_at >= x.last_at)
       ORDER BY x.account_id`.execute(this.db);
    return r.rows
      .filter((x) => isDue(absenceDue(new Date(x.last_at)), enabledAt, now))
      .map((x) => ({ accountId: x.account_id, key: momentKey.NINETY_DAYS(x.account_id, new Date(x.last_at)), pieceRef: null, values: { firstName: x.first_name } }));
  }

  /** Render and insert `due`, at most HOUSE_DELIVERY_BATCH per transaction, each transaction audited by its count. */
  private async deliver(s: Setting, due: Due[], now: Date): Promise<number> {
    let delivered = 0;
    for (let i = 0; i < due.length; i += HOUSE_DELIVERY_BATCH) {
      const batch = due.slice(i, i + HOUSE_DELIVERY_BATCH);
      delivered += await inTransaction(this.db, async (tx) => {
        // Still ACTIVE and not a test entrant at the delivery itself.
        const ids = [...new Set(batch.map((d) => d.accountId))];
        const active = await sql<{ id: string }>`SELECT a.id FROM accounts a WHERE a.id IN (${sql.join(ids)}) AND a.status = 'ACTIVE' AND ${notTestEntrant('a.id')}`.execute(tx);
        const still = new Set(active.rows.map((a) => a.id));
        const values = batch
          .filter((d) => still.has(d.accountId))
          .map((d) => {
            const words = renderMoment(s.moment, s, d.values);
            return { account_id: d.accountId, source: 'MOMENT' as const, moment: s.moment, title: words.title, body: words.body, piece_ref: d.pieceRef, dedupe_key: d.key, delivered_at: now };
          });
        if (values.length === 0) return 0;
        const inserted = await tx.insertInto('house_deliveries').values(values).onConflict((oc) => oc.column('dedupe_key').doNothing()).returning('id').execute();
        if (inserted.length > 0) {
          await this.audit.record({ actor: SYSTEM_ACTOR, action: 'house.moment.delivered', targetType: 'house_moment', targetId: s.moment, details: { moment: s.moment, count: inserted.length } }, tx);
        }
        return inserted.length;
      });
    }
    return delivered;
  }
}
