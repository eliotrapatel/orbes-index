/**
 * The sign-up's profile (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.4.2, step 1.5): what CREATE ACCOUNT asks
 * beside the email and the password. The first and last name and the country are required by the public route only
 * (POST /api/v1/account/register: `requireSignUp`, worded 400s); AuthService.registerAccount keeps them optional, so
 * seeds and fixtures that create accounts without them keep working. Given, the names are cleaned by the shared rules
 * (src/shared/profile-rules.ts) and written, in the account's own transaction, as its `account_profiles` row, with the
 * optional answer to « How did you hear about ORBES? ».
 *
 * The answer is never a reason to refuse a sign-up: an unknown or set-aside option is dropped silently, and Other's
 * words are kept only with Other (and dropped when they cannot be kept). The connection's country only preselects
 * COUNTRY in the app (GET /api/v1/account/sign-up): nothing about the connection is stored here.
 */
import type { Db } from '../db/connection.js';
import { validationError } from '../errors.js';
import { isCountryCode } from '../../shared/countries.js';
import { cleanName, cleanWords, HEARD_OTHER_MAX, NAME_MAX } from '../../shared/profile-rules.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sign-up's refusals, in the collector's words (the app's SIGN_UP copy says the same). */
export const SIGN_UP_REFUSALS = {
  noFirstName: 'Enter your first name.',
  noLastName: 'Enter your last name.',
  noCountry: 'Choose your country.',
} as const;

/** A first or last name as a profile keeps it, or null when empty; refused in the collector's words when it cannot be kept. */
export function profileName(v: unknown, which: 'first' | 'last'): string | null {
  const r = cleanName(v);
  if (r.ok) return r.value;
  if (r.problem === 'TOO_LONG') throw validationError(`Your ${which} name is ${NAME_MAX} characters at most.`);
  throw validationError(`Your ${which} name contains characters that cannot be kept.`);
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * What the public route requires (P.4.2), in the order the form checks it: the first name, the last name, then the
 * country, one of H2's countries (src/shared/countries.ts). Each refusal is a 400 VALIDATION_FAILED in its own words.
 */
export function requireSignUp(input: { firstName?: unknown; lastName?: unknown; country?: unknown }): void {
  if (blank(input.firstName)) throw validationError(SIGN_UP_REFUSALS.noFirstName);
  if (blank(input.lastName)) throw validationError(SIGN_UP_REFUSALS.noLastName);
  if (!isCountryCode(input.country)) throw validationError(SIGN_UP_REFUSALS.noCountry);
}

/** The names a sign-up gives, cleaned; null when it gives neither (an internal caller: no profile row). */
export function signUpNames(input: { firstName?: unknown; lastName?: unknown }): { first: string; last: string } | null {
  if (blank(input.firstName) && blank(input.lastName)) return null;
  const first = profileName(input.firstName, 'first');
  if (first === null) throw validationError(SIGN_UP_REFUSALS.noFirstName);
  const last = profileName(input.lastName, 'last');
  if (last === null) throw validationError(SIGN_UP_REFUSALS.noLastName);
  return { first, last };
}

/** The answer a sign-up may carry: an option's id, and Other's words. */
export interface SignUpHeard {
  optionId?: unknown;
  other?: unknown;
}

/**
 * The new account's profile, in the account's transaction: its names, its answer when the option is offered (Other's
 * words only with Other), `updated_by` COLLECTOR. Returns the answer kept, for `account.register`'s details.
 */
export async function insertSignUpProfile(
  tx: Db,
  accountId: string,
  names: { first: string; last: string },
  heard: SignUpHeard | null | undefined,
  now: Date,
): Promise<{ heardOptionId: string | null }> {
  let option: { id: string; is_other: boolean } | undefined;
  if (heard && typeof heard === 'object' && typeof heard.optionId === 'string' && UUID_RE.test(heard.optionId)) {
    option = await tx.selectFrom('heard_options').select(['id', 'is_other']).where('id', '=', heard.optionId.toLowerCase()).where('active', '=', true).executeTakeFirst();
  }
  const words = option?.is_other ? cleanWords(heard?.other, HEARD_OTHER_MAX) : null;
  await tx
    .insertInto('account_profiles')
    .values({
      account_id: accountId,
      first_name: names.first,
      last_name: names.last,
      heard_option_id: option?.id ?? null,
      heard_other: words?.ok ? words.value : null,
      heard_at: option ? now : null,
      updated_by: 'COLLECTOR',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return { heardOptionId: option?.id ?? null };
}
