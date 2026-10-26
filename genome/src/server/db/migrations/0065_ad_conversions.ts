/**
 * 0065 — the server-side conversions to Meta, TikTok and Google, built and switched off (macro scope of 2026-10-20, K27
 * A1, A3 and A4; lot M4 plan §3.2, step M4.9): the console's switch and its settings, the link channels mapped to a
 * platform, the collectors' advertising choices, the platforms' click ids held with consent, and the outbox of events
 * per platform. Nothing here is read, written or sent while the switch is off (A1: off by default and at deployment);
 * the service, its sender and its routes come in steps M4.10 to M4.13. The platform holds the truth and sends only its
 * own acts: an order paid on a future Shopify store is the store's to report (S1–S4).
 *
 * `ads_settings`: one row (`id` 1), written at the console's first save, never by the migration; no row reads as off.
 *  - `enabled` (DEFAULT false: off); `events_from`, set at the first switch on and never moved after
 *    (`ads_settings_events_from`): no act before it is ever sent; on needs it (`ads_settings_on`);
 *  - `switched_at` and `switched_by` (the ADMIN who switched it last, on or off; NULL for a script), the switch's time
 *    with its author (`ads_settings_switched`), never before the first switch on (`ads_settings_times`);
 *  - `meta_test_event_code` and `tiktok_test_event_code` (1 to 40 characters, one line; NULL: none), each platform's
 *    test mode for the console's SEND A TEST EVENT;
 *  - `google_action_signup`, `google_action_draw_entry`, `google_action_live_entry`, `google_action_paid_order`: the
 *    Google Ads conversion action of each act, as its resource name (`customers/<id>/conversionActions/<id>`); NULL:
 *    not named;
 *  - `updated_by` (the ADMIN; NULL for a script) and `updated_at` (stamped by `orbes_touch_updated_at`).
 *
 * `ads_channel_platforms`: a link channel (`link_channels`, 0043) mapped to a platform, META, TIKTOK or GOOGLE (A3: an act
 * goes only to the platform the collector came from); once per channel and platform (the primary key). No mapping by
 * default.
 *
 * `ad_consents`: a collector's choice (A4), the proof of consent: on a device (`tracking_devices`, 0042) while signed
 * out, on an account (`accounts`) once known, or both; one at least (`ad_consents_subject`). `choice` GRANTED or
 * DECLINED, `source` BANNER or ACCOUNT, `text_version` (the advertising text's version shown, a `YYYY-MM-DD` date),
 * `user_agent` (1 to 400 characters, recorded with a GRANTED choice only: `ad_consents_user_agent`) and `chosen_at`. A
 * choice is never changed (`ad_consents_immutable`): a new choice is a new row, the latest one counts. Read by account
 * and by device, latest first.
 *
 * `ad_clicks`: a platform's click id read from the address the collector arrived by, stored only with a GRANTED choice:
 * its device, its account once known (it takes the account at sign-up and sign-in), its `kind` (FBCLID, TTCLID, GCLID,
 * GBRAID, WBRAID), the `click_id` itself (1 to 500 printable characters, no space) and `clicked_at`; once per device,
 * kind and id (`ad_clicks_click_key`). Its id, device, kind, click id and time never change.
 *
 * `ad_events`: the outbox, one event per platform, conversion (`acquisition_conversions`, 0043) and act
 * (`ad_events_key`): `kind` SIGNUP, DRAW_ENTRY, LIVE_ENTRY or PAID_ORDER (an ORDER conversion once its order is paid);
 * `status` QUEUED, SENT, FAILED, SKIPPED or CANCELLED; `skip_reason` (TOO_OLD, NO_CLICK_ID, NOT_READY) exactly on a
 * SKIPPED one (`ad_events_skipped`); `attempts` (≥ 0), `not_before` (when it may go), `last_error` (1 to 300 characters,
 * never a key; a FAILED one always has one: `ad_events_failed`); `created_at`, `sent_at` exactly when SENT
 * (`ad_events_sent`) and `settled_at` exactly when no longer QUEUED (`ad_events_settled`), the end the purge counts its
 * 90 days from, as the emails' outbox does. Its id, platform, conversion, act and creation never change. `ad_events_due`
 * (status, not_before) serves the sender.
 *
 * Every foreign key ON DELETE RESTRICT, at the head of an index, as every other. On the previous image during the
 * roll-out (Q3's, at 0062: lot M4's migrations ship together): five tables it never reads. No row is inserted. `down`
 * refuses while the switch is on or any consent, click id or event exists, naming the counts; otherwise it drops the
 * five tables: the schema of 0064 exactly. One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts.
/** The platforms (schema.ts ADS_PLATFORMS, A2): Meta, TikTok and Google; no Snapchat. */
const PLATFORMS = `'META','TIKTOK','GOOGLE'`;
/** A choice and where it was made (schema.ts AD_CONSENT_CHOICES, AD_CONSENT_SOURCES). */
const CHOICES = `'GRANTED','DECLINED'`;
const SOURCES = `'BANNER','ACCOUNT'`;
/** A click id's kind (schema.ts AD_CLICK_KINDS). */
const CLICK_KINDS = `'FBCLID','TTCLID','GCLID','GBRAID','WBRAID'`;
/** An event's act, state and reason skipped (schema.ts AD_EVENT_KINDS, AD_EVENT_STATUSES, AD_SKIP_REASONS). */
const EVENT_KINDS = `'SIGNUP','DRAW_ENTRY','LIVE_ENTRY','PAID_ORDER'`;
const EVENT_STATUSES = `'QUEUED','SENT','FAILED','SKIPPED','CANCELLED'`;
const SKIP_REASONS = `'TOO_OLD','NO_CLICK_ID','NOT_READY'`;
/** A test event code, at most (schema.ts ADS_TEST_EVENT_CODE_MAX). */
const TEST_CODE_MAX = 40;
/** A Google Ads conversion action's resource name (schema.ts ADS_GOOGLE_ACTION_PATTERN). */
const GOOGLE_ACTION = `'^customers/[0-9]{1,12}/conversionActions/[0-9]{1,20}$'`;
/** A user agent recorded with a choice, a click id, an event's last error, at most (schema.ts AD_USER_AGENT_MAX, AD_CLICK_ID_MAX, AD_EVENT_ERROR_MAX). */
const USER_AGENT_MAX = 400;
const CLICK_ID_MAX = 500;
const ERROR_MAX = 300;

/** One line of 1 to n characters, trimmed, no control character. */
const line = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;
/** A Google Ads conversion action's column. */
const googleAction = (act: string) =>
  `google_action_${act} text NULL CONSTRAINT ads_settings_google_action_${act}_check CHECK (google_action_${act} ~ ${GOOGLE_ACTION})`;

export const UP: readonly string[] = [
  // ── ads_settings ─────────────────────────────────────────────────────────
  `CREATE TABLE ads_settings (
     id                     smallint    PRIMARY KEY DEFAULT 1 CONSTRAINT ads_settings_id_check CHECK (id = 1),
     enabled                boolean     NOT NULL DEFAULT false,
     events_from            timestamptz NULL,
     switched_at            timestamptz NULL,
     switched_by            uuid        NULL CONSTRAINT ads_settings_switched_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     meta_test_event_code   text        NULL CONSTRAINT ads_settings_meta_test_event_code_check CHECK (${line('meta_test_event_code', TEST_CODE_MAX)}),
     tiktok_test_event_code text        NULL CONSTRAINT ads_settings_tiktok_test_event_code_check CHECK (${line('tiktok_test_event_code', TEST_CODE_MAX)}),
     ${googleAction('signup')},
     ${googleAction('draw_entry')},
     ${googleAction('live_entry')},
     ${googleAction('paid_order')},
     updated_by             uuid        NULL CONSTRAINT ads_settings_updated_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at             timestamptz NOT NULL DEFAULT now(),
     -- On only from a first switch on; a switch with its time; never before the first one.
     CONSTRAINT ads_settings_on CHECK (NOT enabled OR events_from IS NOT NULL),
     CONSTRAINT ads_settings_switched CHECK ((switched_by IS NULL OR switched_at IS NOT NULL) AND (events_from IS NULL OR switched_at IS NOT NULL)),
     CONSTRAINT ads_settings_times CHECK (switched_at >= events_from)
   )`,
  `CREATE INDEX ads_settings_switched_by_idx ON ads_settings (switched_by)`,
  `CREATE INDEX ads_settings_updated_by_idx ON ads_settings (updated_by)`,
  // The first switch on sets it; it never moves after (no act before it is ever sent, no backfill).
  `CREATE TRIGGER ads_settings_events_from BEFORE UPDATE OF events_from ON ads_settings
     FOR EACH ROW WHEN (OLD.events_from IS NOT NULL AND NEW.events_from IS DISTINCT FROM OLD.events_from)
     EXECUTE FUNCTION orbes_reject_mutation('conversions are sent from the first switch on, never earlier nor later')`,
  `CREATE TRIGGER ads_settings_touch_updated_at BEFORE UPDATE ON ads_settings
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  // ── ads_channel_platforms ────────────────────────────────────────────────
  `CREATE TABLE ads_channel_platforms (
     channel_id uuid NOT NULL CONSTRAINT ads_channel_platforms_channel_id_fkey REFERENCES link_channels (id) ON DELETE RESTRICT,
     platform   text NOT NULL CONSTRAINT ads_channel_platforms_platform_check CHECK (platform IN (${PLATFORMS})),
     CONSTRAINT ads_channel_platforms_pkey PRIMARY KEY (channel_id, platform)
   )`,

  // ── ad_consents ──────────────────────────────────────────────────────────
  `CREATE TABLE ad_consents (
     id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     device_id    integer     NULL CONSTRAINT ad_consents_device_id_fkey REFERENCES tracking_devices (id) ON DELETE RESTRICT,
     account_id   uuid        NULL CONSTRAINT ad_consents_account_id_fkey REFERENCES accounts (id) ON DELETE RESTRICT,
     choice       text        NOT NULL CONSTRAINT ad_consents_choice_check CHECK (choice IN (${CHOICES})),
     source       text        NOT NULL CONSTRAINT ad_consents_source_check CHECK (source IN (${SOURCES})),
     text_version text        NOT NULL CONSTRAINT ad_consents_text_version_check CHECK (text_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
     user_agent   text        NULL CONSTRAINT ad_consents_user_agent_check CHECK (char_length(user_agent) BETWEEN 1 AND ${USER_AGENT_MAX}),
     chosen_at    timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ad_consents_subject CHECK (num_nonnulls(device_id, account_id) >= 1),
     CONSTRAINT ad_consents_user_agent CHECK (user_agent IS NULL OR choice = 'GRANTED')
   )`,
  // The latest choice of an account, of a device.
  `CREATE INDEX ad_consents_account_idx ON ad_consents (account_id, chosen_at DESC)`,
  `CREATE INDEX ad_consents_device_idx ON ad_consents (device_id, chosen_at DESC)`,
  `CREATE TRIGGER ad_consents_immutable BEFORE UPDATE ON ad_consents
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('an advertising choice is never changed; a new choice is a new row')`,

  // ── ad_clicks ────────────────────────────────────────────────────────────
  `CREATE TABLE ad_clicks (
     id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     device_id  integer     NOT NULL CONSTRAINT ad_clicks_device_id_fkey REFERENCES tracking_devices (id) ON DELETE RESTRICT,
     account_id uuid        NULL CONSTRAINT ad_clicks_account_id_fkey REFERENCES accounts (id) ON DELETE RESTRICT,
     kind       text        NOT NULL CONSTRAINT ad_clicks_kind_check CHECK (kind IN (${CLICK_KINDS})),
     click_id   text        NOT NULL CONSTRAINT ad_clicks_click_id_check CHECK (char_length(click_id) BETWEEN 1 AND ${CLICK_ID_MAX} AND click_id ~ '^[!-~]+$'),
     clicked_at timestamptz NOT NULL,
     CONSTRAINT ad_clicks_click_key UNIQUE (device_id, kind, click_id)
   )`,
  `CREATE INDEX ad_clicks_account_idx ON ad_clicks (account_id)`,
  `CREATE TRIGGER ad_clicks_immutable_identity BEFORE UPDATE ON ad_clicks
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'device_id', 'kind', 'click_id', 'clicked_at')`,

  // ── ad_events ────────────────────────────────────────────────────────────
  `CREATE TABLE ad_events (
     id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     platform      text        NOT NULL CONSTRAINT ad_events_platform_check CHECK (platform IN (${PLATFORMS})),
     conversion_id bigint      NOT NULL CONSTRAINT ad_events_conversion_id_fkey REFERENCES acquisition_conversions (id) ON DELETE RESTRICT,
     kind          text        NOT NULL CONSTRAINT ad_events_kind_check CHECK (kind IN (${EVENT_KINDS})),
     status        text        NOT NULL DEFAULT 'QUEUED' CONSTRAINT ad_events_status_check CHECK (status IN (${EVENT_STATUSES})),
     skip_reason   text        NULL CONSTRAINT ad_events_skip_reason_check CHECK (skip_reason IN (${SKIP_REASONS})),
     attempts      smallint    NOT NULL DEFAULT 0 CONSTRAINT ad_events_attempts_check CHECK (attempts >= 0),
     not_before    timestamptz NOT NULL DEFAULT now(),
     last_error    text        NULL CONSTRAINT ad_events_last_error_check CHECK (char_length(last_error) BETWEEN 1 AND ${ERROR_MAX}),
     created_at    timestamptz NOT NULL DEFAULT now(),
     sent_at       timestamptz NULL,
     settled_at    timestamptz NULL,
     CONSTRAINT ad_events_key UNIQUE (platform, conversion_id, kind),
     CONSTRAINT ad_events_skipped CHECK ((status = 'SKIPPED') = (skip_reason IS NOT NULL)),
     CONSTRAINT ad_events_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
     CONSTRAINT ad_events_settled CHECK ((status = 'QUEUED') = (settled_at IS NULL)),
     CONSTRAINT ad_events_failed CHECK (status <> 'FAILED' OR last_error IS NOT NULL)
   )`,
  // The sender: the QUEUED events due, oldest first.
  `CREATE INDEX ad_events_due ON ad_events (status, not_before)`,
  // A conversion's events (an account's right of access and its lock, through its conversions); it leads the foreign key.
  `CREATE INDEX ad_events_conversion_idx ON ad_events (conversion_id)`,
  `CREATE TRIGGER ad_events_immutable_identity BEFORE UPDATE ON ad_events
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'platform', 'conversion_id', 'kind', 'created_at')`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no advertising conversion: refused while the switch is on or a consent, a click id or an
  // event would be lost.
  `DO $$
   DECLARE on_n bigint; consents_n bigint; clicks_n bigint; events_n bigint;
   BEGIN
     SELECT count(*) INTO on_n FROM ads_settings WHERE enabled;
     SELECT count(*) INTO consents_n FROM ad_consents;
     SELECT count(*) INTO clicks_n FROM ad_clicks;
     SELECT count(*) INTO events_n FROM ad_events;
     IF on_n > 0 OR consents_n > 0 OR clicks_n > 0 OR events_n > 0 THEN
       RAISE EXCEPTION 'migration 0065_ad_conversions cannot be rolled back: % switches on, % advertising choices, % click ids and % ad events exist', on_n, consents_n, clicks_n, events_n;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS ad_events`,
  `DROP TABLE IF EXISTS ad_clicks`,
  `DROP TABLE IF EXISTS ad_consents`,
  `DROP TABLE IF EXISTS ads_channel_platforms`,
  `DROP TABLE IF EXISTS ads_settings`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
