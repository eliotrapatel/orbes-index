/**
 * The founding list (plan MACRO M1 §3.1; macro scope of 2026-10-20, F2 to F5; migration 0050 `preregistrations`): the
 * people theorbes.com's form adds, where they came from, and the ORBES account each one becomes.
 *
 *   register     POST /api/v1/founding (routes/founding.ts), from https://theorbes.com only (FOUNDING_ORIGIN). The
 *                form's email, first name and country, and its consent box ticked (F2), each refused in the collector's
 *                words (FOUNDING_WORDS, 400 VALIDATION_FAILED with `fields`). A hidden field a person never fills
 *                (`website`, the honeypot) filled: nothing is stored and the answer is the same 202. The source (F3) is
 *                classified as an arrival in the app is (AcquisitionService.sourceFor): the console link of `o`
 *                (archived ones included), then the `utm_` tags, then the referring site (services/referrers.ts, the form's
 *                own host theorbes.com an inner move), then DIRECT, with the day's cap and its fallbacks. An address
 *                already on the list leaves its row exactly as it was, and the answer is the same: nobody learns whether
 *                an address is on it (no enumeration). The account that already has the address is matched at once.
 *                The consent is recorded with its time and the legal version in force (FOUNDING_CONSENT_VERSION).
 *                Audited `founding.register` with the row's id and the source's kind, never the address.
 *   match        at a sign-up (AuthService.registerAccount, services/founding-match.ts): the unmatched row of the same
 *                address takes the account in the account's own transaction. Audited `founding.match`.
 *   list / summary / csv   the console's Founding list (lot M1, step M1.12): the rows by their joining, newest first,
 *                filtered (matched, country, kind of source, unsubscribed), the routes masking the address for an
 *                AUDITOR; the counts by country and by source (kind, channel, link, campaign, site); the CSV an OPERATOR
 *                downloads, in the columns of a Shopify customers import (S1, S6: the future store), every address,
 *                never as a marketing subscriber (the consent covers the founding announcement only).
 *   remove       erasure on request (ADMIN, the phrase `REMOVE <8>`): the row is deleted. Audited `founding.remove`.
 *   unsubscribe  the person asked to receive nothing more (E1's one-click link, lot M1 step M1.17): `unsubscribed_at` set
 *                once, the row kept, so the address is never written to again (§11 note 9). Audited
 *                `founding.unsubscribe`.
 *   exportOf     the right of access (services/owners.ts exportData): the matched row's joining date, first name,
 *                country, consent version, source and unsubscribe date.
 *
 * Nothing lasting is given (F4): the FOUNDING_LIST rule of a segment (services/segments.ts) reads the matched rows live.
 * No import of the old Google Sheet (F5: start fresh). Nothing leaves this database: no third party.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { FOUNDING_FIRST_NAME_MAX, type SourceKind } from '../db/schema.js';
import { DomainError, notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { countryName, isCountryCode } from '../../shared/countries.js';
import { cleanWords } from '../../shared/profile-rules.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AcquisitionService, ArrivalTags } from './acquisition.js';
import { sourceWords } from './acquisition-reads.js';
import type { AuditService } from './audit.js';
import { normalizeEmail } from './auth.js';
import { CANCELLED_WORDS } from './email.js';
import { lockFoundingAddress, matchPreregistration } from './founding-match.js';
import { parisDateTime } from './schedule.js';

/** The only site whose form may post to the founding list (CORS and the server's own Origin check, routes/founding.ts). */
export const FOUNDING_ORIGIN = 'https://theorbes.com';
/** The form's own host: a referrer from it is an inner move, never a referring site. */
export const FOUNDING_HOST = 'theorbes.com';
/**
 * The legal version in force (src/web/legal/content/index.ts LEGAL_VERSION), recorded with each consent. The server
 * cannot read the web's files (Dockerfile), so it is written here; test/web/legal.content.test.ts holds the two equal.
 */
export const FOUNDING_CONSENT_VERSION = '2026-10-22';

/** The form's fields that can be refused, in the form's order. */
export const FOUNDING_FIELDS = ['email', 'firstName', 'country', 'consent'] as const;
export type FoundingField = (typeof FOUNDING_FIELDS)[number];

/** Each refusal in the collector's words (F2), as the theorbes.com form shows it under its field. */
export const FOUNDING_WORDS: Readonly<Record<FoundingField, string>> = Object.freeze({
  email: 'Enter your email.',
  firstName: 'Enter your first name.',
  country: 'Choose your country.',
  consent: 'Tick the box to join the list.',
});

/** The rows of a page of the console's list, at most. */
export const FOUNDING_PAGE_MAX = 100;
/** The sources the summary names one by one, at most (the most joined first). */
export const FOUNDING_SUMMARY_SOURCES = 50;

/**
 * 400 VALIDATION_FAILED with every refused field in the collector's words: `{ error: { code, message, fields } }`,
 * `message` the first one's words.
 */
export class FoundingFieldsError extends DomainError {
  constructor(readonly fields: Readonly<Partial<Record<FoundingField, string>>>) {
    super('VALIDATION_FAILED', 400, Object.values(fields)[0] ?? 'The request is invalid.', { detail: `founding: ${Object.keys(fields).join(',')}` });
  }

  override toResponse(): { error: { code: string; message: string; fields: Partial<Record<FoundingField, string>> } } {
    return { error: { code: this.code, message: this.publicMessage, fields: { ...this.fields } } };
  }
}

/** What the form sends (http/schemas.ts foundingBody): the person's fields, the honeypot and where they came from. */
export interface FoundingInput {
  email?: unknown;
  firstName?: unknown;
  country?: unknown;
  consent?: unknown;
  /** The honeypot: a field hidden from people. Filled, nothing is stored. */
  website?: unknown;
  /** The console link's code read from theorbes.com's address (`?o=`). */
  o?: string | null;
  utm?: ArrivalTags | null;
  /** `document.referrer` on theorbes.com: only its host is kept. */
  referrer?: string | null;
}

/** What `register` did (the tests and the log; the route answers 202 `{ ok: true }` whatever it is). */
export type FoundingOutcome =
  | { outcome: 'HONEYPOT' }
  | { outcome: 'ALREADY' }
  | { outcome: 'ADDED'; id: string; sourceKind: Exclude<SourceKind, 'BEFORE' | 'STAFF'>; matched: string | null };

/** A source as the console shows it: its kind, its words, a link's channel and id. */
export interface FoundingSource {
  kind: SourceKind;
  label: string;
  channel: string | null;
  linkId: string | null;
}

/** A row of the console's list (the routes mask `email` for an AUDITOR). */
export interface FoundingEntry {
  id: string;
  email: string;
  firstName: string;
  country: string;
  source: FoundingSource;
  joinedAt: Date;
  consentAt: Date;
  consentVersion: string;
  /** The ORBES account with the same address, once matched (its client sheet). */
  accountId: string | null;
  matchedAt: Date | null;
  unsubscribedAt: Date | null;
}

export interface FoundingFilters {
  matched?: boolean;
  country?: string;
  sourceKind?: SourceKind;
  unsubscribed?: boolean;
}

/** The console's figures (KPIs, by country, by source). */
export interface FoundingSummary {
  total: number;
  matched: number;
  unsubscribed: number;
  countries: { country: string; name: string; count: number }[];
  kinds: { kind: SourceKind; count: number }[];
  channels: { name: string | null; count: number }[];
  /** The sources one by one, the most joined first (FOUNDING_SUMMARY_SOURCES at most). */
  sources: (FoundingSource & { count: number })[];
}

/** The right of access's `foundingList` (services/owners.ts): the matched row, in words. */
export interface ExportedFounding {
  joinedAt: Date;
  firstName: string;
  country: string;
  consentVersion: string;
  kind: SourceKind;
  source: string;
  channel: string | null;
  unsubscribedAt: Date | null;
}

export interface FoundingServiceDeps {
  db: Db;
  audit: AuditService;
  acquisition: AcquisitionService;
  clock?: Clock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entryNotFound = () => notFound('Pre-registration', 'PREREGISTRATION_NOT_FOUND');

/**
 * A pre-registration unsubscribed, in `tx` (FoundingService.unsubscribe; the founding announcement's link, lot M1 step
 * M1.17): `unsubscribed_at` set once, the row kept; its founding announcements still QUEUED cancelled. True when this
 * call set it; false when it was set already or the row no longer exists. Audited `founding.unsubscribe` when it sets it.
 */
export async function unsubscribePreregistration(tx: Db, audit: AuditService, id: string, actor: Actor, now: Date): Promise<boolean> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return false;
  const r = await tx.updateTable('preregistrations').set({ unsubscribed_at: now }).where('id', '=', id.toLowerCase()).where('unsubscribed_at', 'is', null).returning('id').executeTakeFirst();
  if (!r) return false;
  const cancelled = await tx
    .updateTable('email_outbox')
    .set({ status: 'CANCELLED', settled_at: now, last_error: CANCELLED_WORDS.unsubscribed })
    .where('preregistration_id', '=', r.id)
    .where('status', '=', 'QUEUED')
    .executeTakeFirst();
  await audit.record(
    { actor, action: 'founding.unsubscribe', targetType: 'preregistration', targetId: r.id, details: { preregistrationId: r.id, emailsCancelled: Number(cancelled.numUpdatedRows ?? 0) } },
    tx,
  );
  return true;
}

/** The phrase Remove asks for: `REMOVE 1A2B3C4D` (the row's id, its first 8 characters). */
export function removePhrase(id: string): string {
  return `REMOVE ${id.slice(0, 8).toUpperCase()}`;
}

/** What a first name never holds: a digit, `/`, `:`, `@` or `www` (a link's or an address's shape). */
const LINK_SHAPED = /[\p{Nd}/:@]|www/iu;

/** The form's fields checked (F2): the values as stored, or every field refused in the collector's words. */
export function cleanFounding(input: FoundingInput): { email: string; normalized: string; firstName: string; country: string } {
  const fields: Partial<Record<FoundingField, string>> = {};
  const email = normalizeEmail(input?.email);
  if (!email) fields.email = FOUNDING_WORDS.email;
  const name = cleanWords(input?.firstName, FOUNDING_FIRST_NAME_MAX);
  // A first name opens the emails (`{firstName},`): never an address's shape (lot M1 review, THREAT-MODEL AF).
  if (!name.ok || name.value === null || LINK_SHAPED.test(name.value)) fields.firstName = FOUNDING_WORDS.firstName;
  const country = typeof input?.country === 'string' ? input.country.trim().toUpperCase() : '';
  if (!isCountryCode(country)) fields.country = FOUNDING_WORDS.country;
  if (input?.consent !== true) fields.consent = FOUNDING_WORDS.consent;
  if (Object.keys(fields).length > 0) throw new FoundingFieldsError(fields);
  return { email: email!.email, normalized: email!.normalized, firstName: (name as { value: string }).value, country };
}

/** The honeypot is filled when it holds anything but blank text. */
const honeypot = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

interface Row {
  id: string;
  email: string;
  first_name: string;
  country: string;
  consent_at: Date;
  consent_version: string;
  account_id: string | null;
  matched_at: Date | null;
  unsubscribed_at: Date | null;
  created_at: Date;
  kind: SourceKind;
  link_id: string | null;
  link_name: string | null;
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  site: string | null;
}

const sourceOf = (r: Pick<Row, 'kind' | 'link_id' | 'link_name' | 'channel' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'site'>): FoundingSource => ({
  kind: r.kind,
  label: sourceWords(r),
  channel: r.channel,
  linkId: r.link_id,
});

export class FoundingService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly acquisition: AcquisitionService;
  private readonly clock: Clock;

  constructor(deps: FoundingServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.acquisition = deps.acquisition;
    this.clock = deps.clock ?? systemClock;
  }

  /** The theorbes.com form (see the header). Throws FoundingFieldsError (400) for a refused field; anything else is a 202. */
  async register(input: FoundingInput, actor: Actor): Promise<FoundingOutcome> {
    // The honeypot first: a robot learns nothing, not even which of its fields were wrong.
    if (honeypot(input?.website)) return { outcome: 'HONEYPOT' };
    const clean = cleanFounding(input);
    const now = this.clock();
    try {
      return await inTransaction(this.db, async (tx) => {
        // An account signing up with this address at the same instant waits, or is waited for: the match is never missed.
        await lockFoundingAddress(tx, clean.normalized);
        // An address already on the list: nothing read, nothing written, nothing audited (its source is not even made).
        const known = await tx.selectFrom('preregistrations').select('id').where('email_normalized', '=', clean.normalized).executeTakeFirst();
        if (known) return { outcome: 'ALREADY' as const };
        const source = await this.acquisition.sourceFor(tx, { link: input.o ?? null, utm: input.utm ?? null, referrer: input.referrer ?? null }, FOUNDING_HOST, now);
        const row = await tx
          .insertInto('preregistrations')
          .values({
            email: clean.email,
            email_normalized: clean.normalized,
            first_name: clean.firstName,
            country: clean.country,
            consent_at: now,
            consent_version: FOUNDING_CONSENT_VERSION,
            source_id: source.id,
            created_at: now,
          })
          .onConflict((oc) => oc.column('email_normalized').doNothing())
          .returning('id')
          .executeTakeFirst();
        // Two forms of one address at once: the other one's row stands, this one changes nothing.
        if (!row) return { outcome: 'ALREADY' as const };
        await this.audit.record(
          { actor, action: 'founding.register', targetType: 'preregistration', targetId: row.id, details: { preregistrationId: row.id, sourceKind: source.kind } },
          tx,
        );
        // The account that already has the address takes the row at once (F3).
        const account = await tx.selectFrom('accounts').select('id').where('email_normalized', '=', clean.normalized).executeTakeFirst();
        const matched = account ? await matchPreregistration(tx, this.audit, { accountId: account.id, emailNormalized: clean.normalized, now, at: 'REGISTER' }, actor) : null;
        return { outcome: 'ADDED' as const, id: row.id, sourceKind: source.kind, matched: matched ? account!.id : null };
      });
    } catch (e) {
      if (isUniqueViolation(e, 'preregistrations_email_normalized_key')) return { outcome: 'ALREADY' };
      throw e;
    }
  }

  /** The rows, newest first, filtered (see the header). */
  async list(filters: FoundingFilters, page: PageRequest): Promise<Page<FoundingEntry>> {
    const size = Math.min(FOUNDING_PAGE_MAX, Math.max(1, page.pageSize));
    const req = { page: Math.max(1, page.page), pageSize: size };
    const where = this.filtered(filters);
    const total = await this.db
      .selectFrom('preregistrations as p')
      .innerJoin('acquisition_sources as s', 's.id', 'p.source_id')
      .where(where)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const rows = await this.rows(this.db)
      .where(where)
      .orderBy('p.created_at', 'desc')
      .orderBy('p.id')
      .limit(req.pageSize)
      .offset(pageOffset(req))
      .execute();
    return makePage(rows.map((r) => this.entry(r)), Number(total.n), req);
  }

  /** The console's figures (see the header). */
  async summary(): Promise<FoundingSummary> {
    const [totals, countries, kinds, channels, sources] = await Promise.all([
      sql<{ total: number; matched: number; unsubscribed: number }>`
        SELECT count(*)::int AS total, count(account_id)::int AS matched, count(unsubscribed_at)::int AS unsubscribed FROM preregistrations`.execute(this.db),
      sql<{ country: string; n: number }>`SELECT country, count(*)::int AS n FROM preregistrations GROUP BY country ORDER BY n DESC, country`.execute(this.db),
      sql<{ kind: SourceKind; n: number }>`
        SELECT s.kind, count(*)::int AS n FROM preregistrations p JOIN acquisition_sources s ON s.id = p.source_id GROUP BY s.kind ORDER BY n DESC, s.kind`.execute(this.db),
      sql<{ name: string | null; n: number }>`
        SELECT c.name, count(*)::int AS n FROM preregistrations p
          JOIN acquisition_sources s ON s.id = p.source_id
          LEFT JOIN links l ON l.id = s.link_id
          LEFT JOIN link_channels c ON c.id = l.channel_id
         GROUP BY c.name ORDER BY n DESC, c.name NULLS LAST`.execute(this.db),
      sql<Omit<Row, 'id' | 'email' | 'first_name' | 'country' | 'consent_at' | 'consent_version' | 'account_id' | 'matched_at' | 'unsubscribed_at' | 'created_at'> & { n: number }>`
        SELECT s.kind, s.link_id, l.name AS link_name, c.name AS channel, s.utm_source, s.utm_medium, s.utm_campaign, s.site, count(*)::int AS n
          FROM preregistrations p
          JOIN acquisition_sources s ON s.id = p.source_id
          LEFT JOIN links l ON l.id = s.link_id
          LEFT JOIN link_channels c ON c.id = l.channel_id
         GROUP BY s.id, l.name, c.name
         ORDER BY n DESC, s.id
         LIMIT ${FOUNDING_SUMMARY_SOURCES}`.execute(this.db),
    ]);
    const t = totals.rows[0] ?? { total: 0, matched: 0, unsubscribed: 0 };
    return {
      total: Number(t.total),
      matched: Number(t.matched),
      unsubscribed: Number(t.unsubscribed),
      countries: countries.rows.map((r) => ({ country: r.country, name: countryName(r.country), count: Number(r.n) })),
      kinds: kinds.rows.map((r) => ({ kind: r.kind, count: Number(r.n) })),
      channels: channels.rows.map((r) => ({ name: r.name, count: Number(r.n) })),
      sources: sources.rows.map((r) => ({ ...sourceOf(r), count: Number(r.n) })),
    };
  }

  /**
   * The CSV an OPERATOR downloads, every row, oldest first, in the columns of a Shopify customers import (S1, S6):
   * First Name, Last Name (empty: the form asks for none), Email, Accepts Email Marketing (always `no`: the consent of F2
   * covers the founding announcement only, never a store's general marketing; lot M1 review), Default Address Country
   * Code, Tags (`founding-list`), Note (joined, in Paris; the consent's version and what it covers; the source in words;
   * the unsubscribe, if any, in Paris).
   */
  async csv(view: { email: (stored: string) => string }): Promise<{ filename: string; contentType: string; body: string }> {
    const rows = await this.rows(this.db).orderBy('p.created_at').orderBy('p.id').execute();
    const body = csvDocument([
      ['First Name', 'Last Name', 'Email', 'Accepts Email Marketing', 'Default Address Country Code', 'Tags', 'Note'],
      ...rows.map((r) => [
        r.first_name,
        '',
        view.email(r.email),
        'no',
        r.country,
        'founding-list',
        `Joined ${parisDateTime(r.created_at)} Paris · consent ${r.consent_version}: founding announcement only · ${sourceWords(r)}${r.unsubscribed_at ? ` · unsubscribed ${parisDateTime(r.unsubscribed_at)} Paris` : ''}`,
      ]),
    ]);
    return { filename: `orbes-founding-list-${parisDateTime(this.clock()).slice(0, 10)}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }

  /** Erasure on request (ADMIN): the phrase `REMOVE <8>`, then the row deleted. 404 PREREGISTRATION_NOT_FOUND. */
  async remove(id: string, phrase: unknown, actor: Actor): Promise<void> {
    const rowId = this.idOf(id);
    const wanted = removePhrase(rowId);
    if (typeof phrase !== 'string' || phrase.trim().replace(/\s+/g, ' ').toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('preregistrations').select(['id', 'account_id']).where('id', '=', rowId).forUpdate().executeTakeFirst();
      if (!row) throw entryNotFound();
      // Its emails go with it (lot M1 step M1.17): the founding announcements written to it, sent or not (the outbox's
      // foreign key is RESTRICT, as every other).
      await tx.deleteFrom('email_outbox').where('preregistration_id', '=', rowId).execute();
      await tx.deleteFrom('preregistrations').where('id', '=', rowId).execute();
      await this.audit.record(
        { actor, action: 'founding.remove', targetType: 'preregistration', targetId: rowId, details: { preregistrationId: rowId, matched: row.account_id !== null } },
        tx,
      );
    });
  }

  /**
   * The person asked to receive nothing more (§11 note 9): `unsubscribed_at` set once, the row kept. True when this call
   * set it; false when it was set already or the row no longer exists (removed on request), so an old link answers the
   * same. Audited `founding.unsubscribe` when it sets it.
   */
  async unsubscribe(id: string, actor: Actor): Promise<boolean> {
    return inTransaction(this.db, (tx) => unsubscribePreregistration(tx, this.audit, id, actor, this.clock()));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private rows(db: Db) {
    return db
      .selectFrom('preregistrations as p')
      .innerJoin('acquisition_sources as s', 's.id', 'p.source_id')
      .leftJoin('links as l', 'l.id', 's.link_id')
      .leftJoin('link_channels as c', 'c.id', 'l.channel_id')
      .select([
        'p.id',
        'p.email',
        'p.first_name',
        'p.country',
        'p.consent_at',
        'p.consent_version',
        'p.account_id',
        'p.matched_at',
        'p.unsubscribed_at',
        'p.created_at',
        's.kind',
        's.link_id',
        'l.name as link_name',
        'c.name as channel',
        's.utm_source',
        's.utm_medium',
        's.utm_campaign',
        's.site',
      ]);
  }

  private filtered(f: FoundingFilters): RawBuilder<SqlBool> {
    const parts: RawBuilder<unknown>[] = [];
    if (f.matched !== undefined) parts.push(f.matched ? sql`p.account_id IS NOT NULL` : sql`p.account_id IS NULL`);
    if (f.unsubscribed !== undefined) parts.push(f.unsubscribed ? sql`p.unsubscribed_at IS NOT NULL` : sql`p.unsubscribed_at IS NULL`);
    if (f.country !== undefined) parts.push(sql`p.country = ${f.country.toUpperCase()}`);
    if (f.sourceKind !== undefined) parts.push(sql`s.kind = ${f.sourceKind}`);
    return parts.length ? sql<SqlBool>`(${sql.join(parts, sql` AND `)})` : sql<SqlBool>`true`;
  }

  private entry(r: Row): FoundingEntry {
    return {
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      country: r.country,
      source: sourceOf(r),
      joinedAt: r.created_at,
      consentAt: r.consent_at,
      consentVersion: r.consent_version,
      accountId: r.account_id,
      matchedAt: r.matched_at,
      unsubscribedAt: r.unsubscribed_at,
    };
  }

  private idOf(id: unknown): string {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw entryNotFound();
    return id.toLowerCase();
  }
}

/** The right of access's `foundingList` of one account (services/owners.ts exportData), read in the export's transaction. */
export async function exportedFounding(db: Db, accountId: string): Promise<ExportedFounding | null> {
  const r = await db
    .selectFrom('preregistrations as p')
    .innerJoin('acquisition_sources as s', 's.id', 'p.source_id')
    .leftJoin('links as l', 'l.id', 's.link_id')
    .leftJoin('link_channels as c', 'c.id', 'l.channel_id')
    .select(['p.created_at', 'p.first_name', 'p.country', 'p.consent_version', 'p.unsubscribed_at', 's.kind', 's.link_id', 'l.name as link_name', 'c.name as channel', 's.utm_source', 's.utm_medium', 's.utm_campaign', 's.site'])
    .where('p.account_id', '=', accountId)
    .executeTakeFirst();
  if (!r) return null;
  return {
    joinedAt: r.created_at,
    firstName: r.first_name,
    country: r.country,
    consentVersion: r.consent_version,
    kind: r.kind,
    source: sourceWords(r),
    channel: r.channel,
    unsubscribedAt: r.unsubscribed_at,
  };
}
