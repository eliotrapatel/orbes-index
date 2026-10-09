/**
 * YOUR PROFILE (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.6, P.9, P.10, step 1.4; migration 0040): what a
 * collector tells ORBES about themselves, beside the account. The first and last name, the country (kept on
 * `accounts.country`), the city, the phone with its country code (not checked by text message), the date of birth
 * (entered once by the collector, then changed only by Client Services), the Instagram username, the favourite pieces
 * and finishes (services/tastes.ts) and the answer to « How did you hear about ORBES? ». The address is the default of
 * YOUR ADDRESSES (services/addresses.ts): one address book.
 *
 *   prepare        the first boot's answers to the question, only while the list is empty (audited
 *                  `heard_option.setup`); a renamed answer is never created again.
 *   options        what the collector can choose: the catalogue's pieces and finishes (TasteService), the answers offered.
 *   forCollector   GET /api/v1/account/profile: the profile, the choices, the default address in short, how many are
 *                  saved, and how complete it is. No staff name, no author, no audit data.
 *   save           PUT /api/v1/account/profile: the whole profile with its tastes, in one transaction (below).
 *   saveByStaff    Client Services' Edit the profile: the same without the date of birth; a LOCKED account included.
 *   forStaff       the client sheet's Profile: the collector's view and who changed what when; with `inClear` false (an
 *                  AUDITOR) the date of birth, the phone, the city, the Instagram and the address are withheld, the age
 *                  band given instead.
 *   heardOptions, createHeard, updateHeard, orderHeard   the console's Sign-up page (ADMIN edits, everyone reads).
 *
 * A save, collector or staff: the account FOR NO KEY UPDATE (as a sign-in), then its profile FOR UPDATE, then its
 * tastes FOR UPDATE: the same order everywhere (H2's addresses take the account FOR SHARE first), so nothing deadlocks.
 * The `version` sent must be the profile's (0 while it has no row): otherwise 409 PROFILE_CHANGED and nothing is written.
 * A field left out is unchanged; a name or a country once set is changed, never cleared. `accounts.display_name`
 * follows « First Last » and `accounts.country` the country. Nothing changed, nothing written and nothing audited.
 * Audited `account.profile.update` with the names of the fields changed, the tastes' counts and `birthDate: 'set'`,
 * never a value. The answers' labels are house words: their audits carry them.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { AccountProfileRow, ProfileSource } from '../db/schema.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { badRequest, conflict, notFound, validationError, type DomainError } from '../errors.js';
import { isCountryCode } from '../../shared/countries.js';
import {
  ageBand,
  ageOn,
  birthDateProblem,
  cleanName,
  cleanWords,
  CITY_MAX,
  completion,
  HEARD_OTHER_MAX,
  NAME_MAX,
  toE164,
  toInstagram,
  type AgeBand,
  type CompletionKey,
} from '../../shared/profile-rules.js';
import { SYSTEM_ACTOR, systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { countedCollector, houseAccount } from './population.js';
import { parisDay } from './schedule.js';
import { TasteService, type AccountTastes, type FinishOption, type TasteCounts, type TasteOption, type TasteOptions } from './tastes.js';

// ── Shapes ─────────────────────────────────────────────────────────────────

/** An answer to « How did you hear about ORBES? » as the sign-up and YOUR PROFILE offer it. */
export interface HeardChoice {
  id: string;
  label: string;
  other: boolean;
}

/** An answer as the console's Sign-up page lists it. */
export interface HeardOptionView extends HeardChoice {
  active: boolean;
  position: number;
  /** How many counted collectors gave it (test entrants and the team's own accounts left out); with `withCounts`. */
  given?: number;
}

/** A profile's phone: the country picked for its code, and the number in E.164. */
export interface ProfilePhone {
  country: string;
  number: string;
}

/** How complete a profile is (src/shared/profile-rules.ts completion). */
export interface ProfileCompletion {
  percent: number;
  missing: CompletionKey[];
}

/** GET /api/v1/account/profile (API §10.25). */
export interface CollectorProfileView {
  profile: {
    firstName: string | null;
    lastName: string | null;
    country: string | null;
    city: string | null;
    phone: ProfilePhone | null;
    birthDate: string | null;
    /** True once a date is set or the collector has entered one: only Client Services sets it then. */
    birthDateLocked: boolean;
    instagram: string | null;
    heard: { optionId: string; label: string; other: string | null } | null;
    tastes: AccountTastes;
    /** 0 while no row exists. */
    version: number;
  };
  options: { pieces: TasteOption[]; finishes: FinishOption[]; heard: HeardChoice[] };
  /** The default address of YOUR ADDRESSES, in short. */
  address: { name: string; firstLine: string; country: string } | null;
  /** How many addresses are saved. */
  addresses: number;
  completion: ProfileCompletion;
}

/** What the role does not read on the client sheet (§3.0 (h)). */
export const STAFF_WITHHELD = ['birthDate', 'phone', 'city', 'address', 'instagram'] as const;
export type StaffWithheld = (typeof STAFF_WITHHELD)[number];

/** The client sheet's Profile (plan §3.6 C.4.2, `OwnerSheet.profile`). */
export interface StaffProfileView {
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  /** 'YYYY-MM-DD'; null for an AUDITOR. */
  birthDate: string | null;
  /** For everyone. */
  ageBand: AgeBand | null;
  /** Null for an AUDITOR. */
  age: number | null;
  birthDateBy: ProfileSource | null;
  birthDateAt: Date | null;
  /** The client's one entry, kept after a removal. */
  birthDateCollectorAt: Date | null;
  phone: ProfilePhone | null;
  city: string | null;
  instagram: string | null;
  heard: { optionId: string; label: string; other: string | null; setAside: boolean; at: Date } | null;
  tastes: AccountTastes;
  /** The default address; null for an AUDITOR. */
  address: { name: string; lines: string; country: string; phone: string } | null;
  /** The saved addresses besides the default. */
  otherAddresses: number;
  completion: ProfileCompletion;
  version: number;
  updatedBy: ProfileSource | null;
  updatedAt: Date | null;
  withheld: StaffWithheld[];
  /** The account's email is a console login's: left out of the Collectors page and the export (§3.0 (d)). */
  teamAccount: boolean;
}

/** The fields a save carries; a field left out is unchanged. */
export interface ProfileInput {
  version: number;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: { country: string; number: string } | null;
  /** The collector's save only: left out, unchanged. */
  birthDate?: string | null;
  instagram?: string | null;
  heard?: { optionId: string; other?: string | null } | null;
  tastes?: { pieces: readonly string[]; finishes: readonly string[] };
}

/** The first boot's answers, in the owner's order; the last one is Other, with its text field. */
export const HEARD_PRESETS: readonly string[] = ['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other'];
/** An answer's length (migration 0040). */
export const HEARD_LABEL_MAX = 40;
/** The answers offered at once, Other included. */
export const HEARD_OFFERED_MAX = 12;

// ── Errors ─────────────────────────────────────────────────────────────────

/** A staff write on a DELETED account (plan §3.6 C.11): the sheet still reads, nothing is written. */
export const accountDeleted = () => conflict('ACCOUNT_DELETED', 'This account is deleted.');
/** The two voices of PROFILE_CHANGED: the collector's own, and Client Services'. */
export const profileChanged = (by: 'collector' | 'staff') =>
  conflict('PROFILE_CHANGED', by === 'collector' ? 'Your profile was changed meanwhile.' : 'The client changed the profile meanwhile. It has been read again: check and save.');
export const birthDateSet = () => conflict('BIRTH_DATE_SET', 'Your date of birth is saved. ORBES Client Services can change it.');
export const birthDateEntered = () => conflict('BIRTH_DATE_ENTERED', 'You have entered your date of birth once. ORBES Client Services can set it.');
export const heardUnavailable = () => badRequest('HEARD_UNAVAILABLE', 'This answer is no longer offered. Choose another.');
export const heardNotFound = () => notFound('Answer', 'HEARD_OPTION_NOT_FOUND');
export const heardLabelTaken = () => conflict('HEARD_LABEL_TAKEN', 'This answer exists already.');
export const heardLimit = () => conflict('HEARD_LIMIT', `At most ${HEARD_OFFERED_MAX} answers are offered at once. Set one aside first.`);
export const heardOtherStays = () => conflict('HEARD_OTHER_STAYS', 'Other stays offered.');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function knownAccount(accountId: unknown): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

// ── Cleaning a save ────────────────────────────────────────────────────────

/** What a save asks, each given field cleaned (left out: undefined, unchanged). */
interface CleanInput {
  version: number;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
  city?: string | null;
  phone?: ProfilePhone | null;
  birthDate?: string | null;
  instagram?: string | null;
  heard?: { optionId: string; other: string | null } | null;
  tastes?: unknown;
}

const has = (x: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(x, k) && x[k] !== undefined;

function nameOf(v: unknown, which: 'first' | 'last'): string | null {
  const r = cleanName(v);
  if (r.ok) return r.value;
  if (r.problem === 'TOO_LONG') throw validationError(`Your ${which} name is ${NAME_MAX} characters at most.`);
  throw validationError(`Your ${which} name contains characters that cannot be kept.`);
}

/** The fields of a save, cleaned by the shared rules (src/shared/profile-rules.ts), before anything is read. */
function cleanInput(input: unknown, withBirthDate: boolean): CleanInput {
  if (!input || typeof input !== 'object') throw validationError('The profile is invalid.');
  const x = input as Record<string, unknown>;
  if (!Number.isInteger(x.version) || (x.version as number) < 0) throw validationError('The profile is invalid.');
  const out: CleanInput = { version: x.version as number };
  if (has(x, 'firstName')) out.firstName = nameOf(x.firstName, 'first');
  if (has(x, 'lastName')) out.lastName = nameOf(x.lastName, 'last');
  if (has(x, 'country')) {
    if (x.country === null || x.country === '') out.country = null;
    else if (!isCountryCode(x.country)) throw validationError('Choose your country.');
    else out.country = x.country;
  }
  if (has(x, 'city')) {
    const r = cleanWords(x.city, CITY_MAX);
    if (!r.ok) throw validationError(r.problem === 'TOO_LONG' ? `Your city is ${CITY_MAX} characters at most.` : 'Your city contains characters that cannot be kept.');
    out.city = r.value;
  }
  if (has(x, 'phone')) {
    if (x.phone === null) out.phone = null;
    else {
      const p = (typeof x.phone === 'object' ? x.phone : {}) as Record<string, unknown>;
      const r = toE164(p.country, p.number);
      if (!r.ok) {
        throw validationError(
          r.problem === 'NO_CODE' ? 'Choose the country code of your phone.' : r.problem === 'NOT_DIGITS' ? 'Enter your phone number with digits only.' : 'This phone number is too short or too long.',
        );
      }
      out.phone = { country: p.country as string, number: r.e164 };
    }
  }
  if (withBirthDate && has(x, 'birthDate')) out.birthDate = x.birthDate === null ? null : typeof x.birthDate === 'string' ? x.birthDate : '';
  if (has(x, 'instagram')) {
    const r = toInstagram(x.instagram);
    if (!r.ok) throw validationError('Enter your Instagram username: letters, numbers, full stops and underscores, 30 at most.');
    out.instagram = r.value;
  }
  if (has(x, 'heard')) {
    if (x.heard === null) out.heard = null;
    else {
      const hd = (typeof x.heard === 'object' ? x.heard : {}) as Record<string, unknown>;
      if (typeof hd.optionId !== 'string' || !UUID_RE.test(hd.optionId)) throw heardUnavailable();
      const r = cleanWords(hd.other, HEARD_OTHER_MAX);
      if (!r.ok) throw validationError(r.problem === 'TOO_LONG' ? `Your words are ${HEARD_OTHER_MAX} characters at most.` : 'Your words contain characters that cannot be kept.');
      out.heard = { optionId: hd.optionId.toLowerCase(), other: r.value };
    }
  }
  if (has(x, 'tastes')) out.tastes = x.tastes;
  return out;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface ProfileServiceDeps {
  db: Db;
  audit: AuditService;
  tastes: TasteService;
  clock?: Clock;
}

export class ProfileService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly tastes: TasteService;
  private readonly clock: Clock;

  constructor(deps: ProfileServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.tastes = deps.tastes;
    this.clock = deps.clock ?? systemClock;
  }

  // ── First boot ─────────────────────────────────────────────────────────

  /**
   * The first boot's answers (HEARD_PRESETS, Other last), only while the list is empty; two processes starting
   * together create them once. Audited `heard_option.setup` by the system when it created any. Returns their labels.
   */
  async prepare(): Promise<string[]> {
    return inTransaction(this.db, async (tx) => {
      const created = await sql<{ label: string }>`
        INSERT INTO heard_options (label, is_other, position, created_at, updated_at)
        SELECT v.label, v.is_other, v.position, ${this.clock()}::timestamptz, ${this.clock()}::timestamptz
          FROM (VALUES ${sql.join(HEARD_PRESETS.map((label, i) => sql`(${label}::text, ${i === HEARD_PRESETS.length - 1}::boolean, ${i + 1}::smallint)`))}) AS v (label, is_other, position)
         WHERE NOT EXISTS (SELECT 1 FROM heard_options)
        ON CONFLICT DO NOTHING RETURNING label`.execute(tx);
      const labels = created.rows.map((r) => r.label);
      if (labels.length > 0) await this.audit.record({ actor: SYSTEM_ACTOR, action: 'heard_option.setup', targetType: 'heard_option', targetId: null, details: { labels } }, tx);
      return labels;
    });
  }

  // ── What can be chosen ─────────────────────────────────────────────────

  /** The answers offered at sign-up and in YOUR PROFILE, in their order, Other last. */
  async offeredHeard(db: Db = this.db): Promise<HeardChoice[]> {
    const rows = await db.selectFrom('heard_options').select(['id', 'label', 'is_other']).where('active', '=', true).orderBy('is_other').orderBy('position').orderBy('id').execute();
    return rows.map((r) => ({ id: r.id, label: r.label, other: r.is_other }));
  }

  /** What the collector can choose: the catalogue's pieces and finishes (TasteService), and the answers offered. */
  async options(db: Db = this.db): Promise<TasteOptions & { heard: HeardChoice[] }> {
    const [tastes, heard] = await Promise.all([this.tastes.options(db), this.offeredHeard(db)]);
    return { ...tastes, heard };
  }

  // ── Reading ────────────────────────────────────────────────────────────

  /** Everything a view of the profile reads, in one go. */
  private async gather(db: Db, accountId: string) {
    const account = await db.selectFrom('accounts').select(['id', 'country', 'status']).where('id', '=', accountId).executeTakeFirst();
    if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const [row, options, addresses] = await Promise.all([
      db.selectFrom('account_profiles').selectAll().where('account_id', '=', accountId).executeTakeFirst(),
      this.options(db),
      db.selectFrom('account_addresses').select(['name', 'address', 'country', 'phone', 'is_default']).where('account_id', '=', accountId).execute(),
    ]);
    const heardRow = row?.heard_option_id
      ? await db.selectFrom('heard_options').select(['id', 'label', 'is_other', 'active']).where('id', '=', row.heard_option_id).executeTakeFirst()
      : undefined;
    const tastes = await this.tastes.read(db, accountId, options);
    const address = addresses.find((a) => a.is_default) ?? null;
    const profile = row ?? null;
    const done = completion(
      profile
        ? { firstName: profile.first_name, lastName: profile.last_name, birthDate: profile.birth_date, city: profile.city, phone: profile.phone, instagram: profile.instagram, heard: profile.heard_option_id, tastes }
        : null,
      { country: account.country },
      address !== null,
      options,
    );
    return { account, row: profile, heardRow, options, tastes, address, addresses: addresses.length, completion: done };
  }

  /** YOUR PROFILE (GET /api/v1/account/profile): see CollectorProfileView. */
  async forCollector(accountId: string, db: Db = this.db): Promise<CollectorProfileView> {
    const id = knownAccount(accountId);
    const g = await this.gather(db, id);
    const r = g.row;
    const heard = [...g.options.heard];
    // The saved answer, set aside since, is still shown as the collector's.
    if (g.heardRow && !g.heardRow.active) heard.push({ id: g.heardRow.id, label: g.heardRow.label, other: g.heardRow.is_other });
    return {
      profile: {
        firstName: r?.first_name ?? null,
        lastName: r?.last_name ?? null,
        country: g.account.country,
        city: r?.city ?? null,
        phone: r?.phone && r.phone_country ? { country: r.phone_country, number: r.phone } : null,
        birthDate: r?.birth_date ?? null,
        birthDateLocked: !!r?.birth_date || !!r?.birth_date_collector_at,
        instagram: r?.instagram ?? null,
        heard: r && g.heardRow ? { optionId: g.heardRow.id, label: g.heardRow.label, other: r.heard_other } : null,
        tastes: g.tastes,
        version: r?.version ?? 0,
      },
      options: { pieces: g.options.pieces, finishes: g.options.finishes, heard },
      address: g.address ? { name: g.address.name, firstLine: g.address.address.split('\n')[0]!.trim(), country: g.address.country } : null,
      addresses: g.addresses,
      completion: g.completion,
    };
  }

  /**
   * The client sheet's Profile (plan §3.6 C.4.2): the collector's view, who set the date of birth and when, who saved
   * last, the default address whole and how many others are saved. With `inClear` false (an AUDITOR: §3.0 (h)) the
   * date of birth, the age, the phone, the city, the Instagram and the address are null and named in `withheld`; the
   * age band is given to everyone.
   */
  async forStaff(accountId: string, { inClear }: { inClear: boolean }, db: Db = this.db): Promise<StaffProfileView> {
    const id = knownAccount(accountId);
    const g = await this.gather(db, id);
    const r = g.row;
    const age = r?.birth_date ? ageOn(r.birth_date, parisDay(this.clock())) : null;
    const team = await sql<{ team: boolean }>`SELECT ${houseAccount('a.id')} AS team FROM accounts a WHERE a.id = ${id}`.execute(db);
    return {
      firstName: r?.first_name ?? null,
      lastName: r?.last_name ?? null,
      country: g.account.country,
      birthDate: inClear ? (r?.birth_date ?? null) : null,
      ageBand: age === null ? null : ageBand(age),
      age: inClear ? age : null,
      birthDateBy: r?.birth_date_by ?? null,
      birthDateAt: r?.birth_date_at ?? null,
      birthDateCollectorAt: r?.birth_date_collector_at ?? null,
      phone: inClear && r?.phone && r.phone_country ? { country: r.phone_country, number: r.phone } : null,
      city: inClear ? (r?.city ?? null) : null,
      instagram: inClear ? (r?.instagram ?? null) : null,
      heard: r && g.heardRow && r.heard_at ? { optionId: g.heardRow.id, label: g.heardRow.label, other: r.heard_other, setAside: !g.heardRow.active, at: r.heard_at } : null,
      tastes: g.tastes,
      address: inClear && g.address ? { name: g.address.name, lines: g.address.address, country: g.address.country, phone: g.address.phone } : null,
      otherAddresses: g.addresses - (g.address ? 1 : 0),
      completion: g.completion,
      version: r?.version ?? 0,
      updatedBy: r?.updated_by ?? null,
      updatedAt: r?.updated_at ?? null,
      withheld: inClear ? [] : [...STAFF_WITHHELD],
      teamAccount: !!team.rows[0]?.team,
    };
  }

  // ── Saving ─────────────────────────────────────────────────────────────

  /**
   * The collector's SAVE (PUT /api/v1/account/profile): see the header. A LOCKED account answers 403 ACCOUNT_LOCKED.
   * The date of birth: left out, unchanged; entered while none is set and the collector never entered one (a real day,
   * from 1900, at least 13 years before today in Paris), written once with `birth_date_collector_at`; the same date
   * again changes nothing; another date 409 BIRTH_DATE_SET; after Client Services removed the collector's one entry,
   * 409 BIRTH_DATE_ENTERED; null refused (only Client Services removes it). Answers the profile read again.
   */
  async save(accountId: string, input: unknown, actor: Actor): Promise<CollectorProfileView> {
    const id = knownAccount(accountId);
    await this.write(id, cleanInput(input, true), actor, 'collector');
    return this.forCollector(id);
  }

  /**
   * Client Services' Edit the profile (PUT /api/admin/owners/:id/profile, OPERATOR): the collector's save without the
   * date of birth (its own route), a LOCKED account included, a DELETED one refused (409 ACCOUNT_DELETED); `updated_by`
   * STAFF. Answers the client sheet's Profile, in clear.
   */
  async saveByStaff(accountId: string, input: unknown, actor: Actor): Promise<StaffProfileView> {
    const id = knownAccount(accountId);
    await this.write(id, cleanInput(input, false), actor, 'staff');
    return this.forStaff(id, { inClear: true });
  }

  private async write(id: string, x: CleanInput, actor: Actor, by: 'collector' | 'staff'): Promise<void> {
    const source: ProfileSource = by === 'collector' ? 'COLLECTOR' : 'STAFF';
    await inTransaction(this.db, async (tx) => {
      const account = await tx.selectFrom('accounts').select(['status', 'country', 'display_name']).where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
      if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (by === 'collector' && account.status !== 'ACTIVE') throw customerAccountLocked();
      if (by === 'staff' && account.status === 'DELETED') throw accountDeleted();
      const row = await tx.selectFrom('account_profiles').selectAll().where('account_id', '=', id).forUpdate().executeTakeFirst();
      if (x.version !== (row?.version ?? 0)) throw profileChanged(by);

      const now = this.clock();
      const was = row ?? null;
      const next: Partial<AccountProfileRow> = {};
      const fields: string[] = [];
      let birth: 'set' | undefined;

      // Names: changed, never cleared once given.
      for (const [key, column, refusal] of [
        ['firstName', 'first_name', 'Enter your first name.'],
        ['lastName', 'last_name', 'Enter your last name.'],
      ] as const) {
        const v = x[key];
        if (v === undefined || v === (was?.[column] ?? null)) continue;
        if (v === null) throw validationError(refusal);
        next[column] = v;
        fields.push(key);
      }
      // The country, on the account: changed, never cleared once given.
      let country: string | undefined;
      if (x.country !== undefined && x.country !== account.country) {
        if (x.country === null) throw validationError('Choose your country.');
        country = x.country;
        fields.push('country');
      }
      if (x.city !== undefined && x.city !== (was?.city ?? null)) {
        next.city = x.city;
        fields.push('city');
      }
      if (x.phone !== undefined) {
        const phone = x.phone?.number ?? null;
        const phoneCountry = x.phone?.country ?? null;
        if (phone !== (was?.phone ?? null) || phoneCountry !== (was?.phone_country ?? null)) {
          next.phone = phone;
          next.phone_country = phoneCountry;
          fields.push('phone');
        }
      }
      if (x.birthDate !== undefined) {
        if (x.birthDate === null) throw validationError('Only ORBES Client Services can remove a date of birth.');
        if (was?.birth_date) {
          if (x.birthDate !== was.birth_date) throw birthDateSet();
        } else if (was?.birth_date_collector_at) {
          throw birthDateEntered();
        } else {
          const problem = birthDateProblem(x.birthDate, parisDay(now));
          if (problem === 'NOT_A_DATE') throw validationError('This date does not exist.');
          if (problem !== null) throw validationError('Enter your date of birth.');
          next.birth_date = x.birthDate;
          next.birth_date_by = 'COLLECTOR';
          next.birth_date_at = now;
          next.birth_date_collector_at = now;
          fields.push('birthDate');
          birth = 'set';
        }
      }
      if (x.instagram !== undefined && x.instagram !== (was?.instagram ?? null)) {
        next.instagram = x.instagram;
        fields.push('instagram');
      }
      if (x.heard !== undefined) {
        if (x.heard === null) {
          if (was?.heard_option_id) {
            next.heard_option_id = null;
            next.heard_other = null;
            fields.push('heard');
          }
        } else {
          const option = await tx.selectFrom('heard_options').select(['id', 'is_other', 'active']).where('id', '=', x.heard.optionId).executeTakeFirst();
          const kept = option !== undefined && option.id === was?.heard_option_id;
          if (!option || (!kept && !option.active)) throw heardUnavailable();
          const other = option.is_other ? x.heard.other : null;
          if (!kept || other !== (was?.heard_other ?? null)) {
            next.heard_option_id = option.id;
            next.heard_other = other;
            if (!was?.heard_at) next.heard_at = now;
            fields.push('heard');
          }
        }
      }
      let tastes: TasteCounts | undefined;
      if (x.tastes !== undefined) {
        const counts = await this.tastes.write(tx, id, x.tastes);
        if (counts.added + counts.removed > 0) {
          tastes = counts;
          fields.push('tastes');
        }
      }
      if (fields.length === 0) return;

      const version = (was?.version ?? 0) + 1;
      const columns = { ...next, version, updated_by: source, updated_at: now };
      if (was) await tx.updateTable('account_profiles').set(columns).where('account_id', '=', id).execute();
      else await tx.insertInto('account_profiles').values({ account_id: id, ...columns, created_at: now }).execute();
      // The account follows: « First Last » once both are given, and the country.
      const first = next.first_name ?? was?.first_name ?? null;
      const last = next.last_name ?? was?.last_name ?? null;
      const displayName = first && last ? `${first} ${last}` : undefined;
      const accountChanges = {
        ...(displayName !== undefined && displayName !== account.display_name ? { display_name: displayName } : {}),
        ...(country !== undefined ? { country } : {}),
      };
      if (Object.keys(accountChanges).length > 0) await tx.updateTable('accounts').set({ ...accountChanges, updated_at: now }).where('id', '=', id).execute();
      await this.audit.record(
        { actor, action: 'account.profile.update', targetType: 'account', targetId: id, details: { by, fields, ...(tastes ? { tastes } : {}), ...(birth ? { birthDate: birth } : {}) } },
        tx,
      );
    });
  }

  // ── The answers to « How did you hear about ORBES? » (the console's Sign-up page) ──

  /**
   * Every answer, offered or set aside, in their order (Other last); with `withCounts`, how many counted collectors
   * gave each (test entrants and the team's own accounts left out: §3.0 (d)).
   */
  async heardOptions({ withCounts }: { withCounts: boolean }, db: Db = this.db): Promise<HeardOptionView[]> {
    const rows = await db.selectFrom('heard_options').select(['id', 'label', 'is_other', 'active', 'position']).orderBy('is_other').orderBy('position').orderBy('id').execute();
    let given = new Map<string, number>();
    if (withCounts) {
      const counts = await sql<{ id: string; n: number }>`
        SELECT p.heard_option_id AS id, count(*)::int AS n
          FROM account_profiles p
         WHERE p.heard_option_id IS NOT NULL AND ${countedCollector('p.account_id')}
         GROUP BY 1`.execute(db);
      given = new Map(counts.rows.map((r) => [r.id, r.n]));
    }
    return rows.map((r) => ({ id: r.id, label: r.label, other: r.is_other, active: r.active, position: r.position, ...(withCounts ? { given: given.get(r.id) ?? 0 } : {}) }));
  }

  /** The list's rows FOR UPDATE in id order: two ADMINs at once never leave two answers at the same place. */
  private async lockHeard(tx: Db) {
    return tx.selectFrom('heard_options').select(['id', 'label', 'is_other', 'active', 'position']).orderBy('id').forUpdate().execute();
  }

  private labelOf(v: unknown): string {
    const r = cleanWords(v, HEARD_LABEL_MAX);
    if (!r.ok) throw validationError(r.problem === 'TOO_LONG' ? `An answer is ${HEARD_LABEL_MAX} characters at most.` : 'The answer contains characters that cannot be kept.');
    if (r.value === null) throw validationError('Enter the answer.');
    return r.value;
  }

  /** Positions 1..n in the given order of the answers that are not Other, then Other: one transaction. */
  private async place(tx: Db, ordered: readonly string[], other: string | undefined, now: Date): Promise<void> {
    const all = other ? [...ordered, other] : [...ordered];
    for (const [i, id] of all.entries()) await tx.updateTable('heard_options').set({ position: i + 1, updated_at: now }).where('id', '=', id).where('position', '<>', i + 1).execute();
  }

  /**
   * Add an answer (ADMIN): 1 to 40 characters, unique whatever the case (409 HEARD_LABEL_TAKEN), at most 12 offered
   * (409 HEARD_LIMIT); placed last before Other. Audited `heard_option.create` with its label.
   */
  async createHeard(input: { label: unknown }, actor: Actor): Promise<HeardOptionView[]> {
    const label = this.labelOf(input?.label);
    try {
      await inTransaction(this.db, async (tx) => {
        const rows = await this.lockHeard(tx);
        if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase())) throw heardLabelTaken();
        if (rows.filter((r) => r.active).length >= HEARD_OFFERED_MAX) throw heardLimit();
        const now = this.clock();
        const ordered = rows.filter((r) => !r.is_other).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
        const other = rows.find((r) => r.is_other);
        const created = await tx.insertInto('heard_options').values({ label, position: ordered.length + 1, created_at: now, updated_at: now }).returning('id').executeTakeFirstOrThrow();
        await this.place(tx, [...ordered.map((r) => r.id), created.id], other?.id, now);
        await this.audit.record({ actor, action: 'heard_option.create', targetType: 'heard_option', targetId: created.id, details: { label } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'heard_options_label_key')) throw heardLabelTaken();
      throw e;
    }
    return this.heardOptions({ withCounts: true });
  }

  /**
   * Rename an answer, set it aside or offer it again (ADMIN): Other is never set aside (409 HEARD_OTHER_STAYS);
   * offering again keeps 12 offered at most; a label taken answers 409 HEARD_LABEL_TAKEN. Nothing changed, nothing
   * audited; otherwise `heard_option.update` with the label and the offer before and after.
   */
  async updateHeard(id: string, input: { label?: unknown; active?: unknown }, actor: Actor): Promise<HeardOptionView[]> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw heardNotFound();
    const optionId = id.toLowerCase();
    const label = input?.label === undefined ? undefined : this.labelOf(input.label);
    if (input?.active !== undefined && typeof input.active !== 'boolean') throw validationError('The answer is invalid.');
    const active = input?.active as boolean | undefined;
    try {
      await inTransaction(this.db, async (tx) => {
        const rows = await this.lockHeard(tx);
        const row = rows.find((r) => r.id === optionId);
        if (!row) throw heardNotFound();
        const nextLabel = label ?? row.label;
        const nextActive = active ?? row.active;
        if (nextLabel === row.label && nextActive === row.active) return;
        if (row.is_other && !nextActive) throw heardOtherStays();
        if (nextLabel.toLowerCase() !== row.label.toLowerCase() && rows.some((r) => r.id !== row.id && r.label.toLowerCase() === nextLabel.toLowerCase())) throw heardLabelTaken();
        if (nextActive && !row.active && rows.filter((r) => r.active).length >= HEARD_OFFERED_MAX) throw heardLimit();
        await tx.updateTable('heard_options').set({ label: nextLabel, active: nextActive, updated_at: this.clock() }).where('id', '=', row.id).execute();
        await this.audit.record(
          {
            actor,
            action: 'heard_option.update',
            targetType: 'heard_option',
            targetId: row.id,
            details: { before: { label: row.label, active: row.active }, after: { label: nextLabel, active: nextActive } },
          },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e, 'heard_options_label_key')) throw heardLabelTaken();
      throw e;
    }
    return this.heardOptions({ withCounts: true });
  }

  /**
   * The answers' order (ADMIN): `ids` must be exactly the answers other than Other, offered or set aside (400 'Reorder
   * every answer at once.'); positions 1..n in one transaction, Other n+1. Audited `heard_option.order` with the labels
   * in their new order; the same order again changes nothing.
   */
  async orderHeard(ids: unknown, actor: Actor): Promise<HeardOptionView[]> {
    const everyAnswer = (): DomainError => validationError('Reorder every answer at once.');
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) throw everyAnswer();
    const wanted = (ids as string[]).map((x) => x.toLowerCase());
    await inTransaction(this.db, async (tx) => {
      const rows = await this.lockHeard(tx);
      const others = rows.filter((r) => !r.is_other);
      if (new Set(wanted).size !== wanted.length || wanted.length !== others.length || !others.every((r) => wanted.includes(r.id))) throw everyAnswer();
      const current = [...others].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1)).map((r) => r.id);
      const other = rows.find((r) => r.is_other);
      const unchanged = current.every((x, i) => x === wanted[i]) && others.every((r) => r.position === wanted.indexOf(r.id) + 1) && (!other || other.position === wanted.length + 1);
      if (unchanged) return;
      await this.place(tx, wanted, other?.id, this.clock());
      const labels = wanted.map((x) => rows.find((r) => r.id === x)!.label);
      await this.audit.record({ actor, action: 'heard_option.order', targetType: 'heard_option', targetId: null, details: { labels } }, tx);
    });
    return this.heardOptions({ withCounts: true });
  }
}
