/**
 * 0006 — `admin_users.password_change_required` (A-02, staff accounts).
 *
 * A console user created by an ADMIN from the Team page receives a temporary
 * password, shown once to that ADMIN. The flag makes the console refuse every
 * route but sign-out, `me` and the password change (`403
 * PASSWORD_CHANGE_REQUIRED`) until the staff member has chosen a password of
 * their own; `AuthService.changePassword` clears it.
 *
 * Compatible with the previous image: the column has a default, and code that
 * does not know it never reads it (a migration cannot be rolled back by
 * redeploying the old image, DATABASE §9). `down` drops the column, restoring
 * the previous schema exactly. Without the column, an account that still holds
 * its temporary password would sign in with it and use its full role for good
 * (that password was shown to an ADMIN and handed over): so `down` first ends
 * the sessions of those accounts and disables them (`disabled_at` set, an
 * earlier one kept), as 0008's down does for the RETAIL accounts it can no
 * longer represent. Re-enabling one would let its temporary password in for
 * good: create a new account for that member instead (DATABASE §9.1,
 * DEPLOYMENT §8.2).
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [`ALTER TABLE admin_users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false`];

export const DOWN: readonly string[] = [
  // The accounts still on their temporary password stop working: their sessions end, they are disabled.
  `DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id IN (SELECT id FROM admin_users WHERE password_change_required)`,
  `UPDATE admin_users SET disabled_at = COALESCE(disabled_at, now()) WHERE password_change_required`,
  `ALTER TABLE admin_users DROP COLUMN password_change_required`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
