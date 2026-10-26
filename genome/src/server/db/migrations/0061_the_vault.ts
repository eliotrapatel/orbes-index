/**
 * 0061 — THE VAULT (lot Q3, step Q3.1; vault/SCOPE.md CURRENT STATE E1: "A platform-wide concept. ONE vault, ONE house
 * table for every source."): additive, new tables and three columns.
 *
 * `vault_sources`: one row per source (D3: LIVE, PIECE, TIER, WORN, FRIEND, PROFILE, HOUSE), inserted here with OP-29's
 * defaults ("i must be able to configure all that as i want": every limit is a setting of CLUB > THE VAULT): `enabled`
 * (true), `per_occasion` (the vaults one occasion gives, 1 to 10, default 1), `cap` (the most an account receives per the
 * source's scope, 1 to 100, default 1: LIVE per release, PIECE per piece, TIER per tier, WORN per piece, FRIEND per
 * friend, PROFILE ever; NULL no cap; HOUSE always NULL, each gift being its own), `updated_by`/`updated_at`. The LIVE
 * source also needs each release's own switch, off by default (D4). A source is never deleted nor renamed.
 *
 * `vault_rewards`: the one house table (D1, D2, D19, D25, D28). `kind` CREDIT, ADDON, GUARANTEED, PRODUCT,
 * VAULT_EDITION, THE_PIECE, CREDIT_TO_GIVE or I_WAS_THERE (no access, status or service reward: D64); `odds_in` ("1 IN
 * N", 1 to 1 000 000) and `quantity` (the limit, OP-26: ≥ 0), both NULL exactly on I_WAS_THERE (the floor never runs
 * out); `given` (≤ quantity); `amount_minor` + `currency` on CREDIT and CREDIT_TO_GIVE only; `model_id` on VAULT_EDITION
 * and on a PRODUCT that is a piece, `addon_id` on ADDON and on a PRODUCT that is an add-on (exactly one on a PRODUCT),
 * none on the others; `mode` FREE or RIGHT_TO_BUY on a PRODUCT only (VAULT_EDITION and THE_PIECE are free by rule);
 * `line` (1 to 120 characters, staff's words) on a VAULT_EDITION only; `active`; `position` (the console's order);
 * created and updated by and at. An `addon_id` names an add-on of kind PRODUCT only, never a SERVICE (E7 "No access,
 * status or service rewards": `vault_rewards_addon_product`, a trigger since a CHECK cannot read `addon_items`; an
 * add-on's kind is fixed at its creation, 0059). The I WAS THERE floor (D2): one row exactly, inserted here
 * (`vault_rewards_floor_key`), never inactive (`vault_rewards_floor_active`) and never deleted; a row given once is
 * never deleted either, only made inactive (`vault_rewards_kept`). The sum of 1/odds_in over the active rows ≤ 1 is the
 * service's, at each save (a CHECK cannot read other rows; N15).
 *
 * `vaults`: each vault given (D1, D3, D5, D17).
 *  - `account_id`, `source`, and the occasion by source, each source its own columns and no other (`vaults_occasion`):
 *    LIVE `drop_id` + `entry_id`; PIECE `product_id`; TIER `tier` (1 to 3); WORN `product_id` + `worn_photo_id`; FRIEND
 *    `friend_account_id` (never the account itself); PROFILE none; HOUSE `given_by` (the staff member), with
 *    `segment_id` (a gift to a segment) and `note` (staff's, ≤ 500, never shown to the collector) when given;
 *  - `occasion_key`, the occasion as the caps count it (`LIVE:<drop>`, `PIECE:<product>`, `TIER:<n>`,
 *    `WORN:<product>`, `FRIEND:<account>`, `PROFILE`, `HOUSE:<the gift's uuid>`, held to its columns by
 *    `vaults_occasion`), and `occasion_index` (1 to 1 000 = 10 per occasion × a cap of 100): `vaults_occasion_key`
 *    (`account_id`, `occasion_key`, `occasion_index`) unique while not revoked, so two passes, a retry or two processes
 *    never give one twice, and a vault revoked can be given again;
 *  - `given_at`, `waits_until` = `given_at` + 30 days of 24 hours (D17, `vaults_waits`; whatever the session's time
 *    zone, so a change of summer time never moves it), `opened_at`;
 *  - `revoked_at` + `revoked_reason`, both or neither, RETURNED only (round 5 "A RETURNED PIECE TAKES ITS VAULT BACK",
 *    D5: a PIECE vault, never opened; no manual revoke, N36), and once revoked it stays so;
 *  - the outcome, written once at the opening and never after (`vaults_outcome`, `vaults_guard`): `reward_id`,
 *    `reward_kind`, `prize` (≤ 40), `prize_line` (≤ 160), `odds_text` ("1 IN 200"), `rare`, `value_minor` +
 *    `currency`, `cost_minor`; and the link to what it gave, each set once (`grant_id` → tier_grants, `order_id` →
 *    orders, `guarantee_id` → house_guarantees; 0062 adds the gift's);
 *  - every column naming the occasion never changes (`vaults_immutable_identity`), but a segment's id may be cleared
 *    (to NULL, never to another: `vaults_segment`), as a sent house message's, so a segment can still be deleted;
 *    never deleted (`vaults_no_delete`: "a vault is revoked, never deleted").
 *
 * `vault_occasions_before` (N7, N34; D68 "Sources give from the deployment on"): `account_id` + `occasion_key`
 * (`TIER:1`, `TIER:2`, `TIER:3`), written once by `up`: for each account (whatever its status), a row per tier it holds
 * at the migration, its pieces counted as services/club.ts `clubCounts` counts them (open ownerships, the club's
 * excluded statuses REVOKED, COUNTERFEIT_FLAGGED and RETIRED, and the REPLACEMENT exception), against the thresholds
 * 1 / 5 / 10 (CLUB_TIER_THRESHOLDS); test entrants left out (they never get a vault, D9). Read by the TIER source only
 * (a key here = a tier reached before the deploy: no vault); never written after, never shown.
 *
 * `invitations` (A FRIEND, N10): `account_id` (the inviter, its key), `code` (12 Crockford base32 characters, unique; a
 * personal link that names nobody), `created_at`; made once, never changed nor deleted. `accounts` gains `invited_by`
 * (never the account itself) and `invited_at`, both or neither, set once and never changed after
 * (`accounts_invited_once`).
 *
 * `drops.vault_on` (D4: "staff switch per LIVE release, off by default"): false by default, true only on a LIVE release
 * that is not an after-room (`drops_vault_on`; N20). `models.vault_only` (D19: VAULT EDITION, "a catalogue product
 * marked vault-only, never sold"), false by default. `house_deliveries.source` gains VAULT (D18, D21): a vault's arrival
 * and its receipt, their title and words rendered at delivery, no moment, no message, no piece reference.
 *
 * Every foreign key leads a full index, ON DELETE RESTRICT. On the previous image (Q2) during the roll-out: tables it
 * never reads, columns with defaults it never names; nothing it writes changes. `down` refuses, naming the counts,
 * while a vault, an invitation, an invited account, a vault message, a reward other than the floor, a source's setting
 * changed from its default, a release with its vault on or a vault-only model exists; otherwise it drops what `up`
 * added, `vault_occasions_before` and the inserted rows included: the schema of 0060 exactly. One statement per array
 * entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts, and test/db/migrations-0061.test.ts that the tiers' literals match services/club.ts.
/** The sources (schema.ts VAULT_SOURCES), in their order. */
const SOURCES = ['LIVE', 'PIECE', 'TIER', 'WORN', 'FRIEND', 'PROFILE', 'HOUSE'] as const;
/** The kinds of reward (schema.ts VAULT_REWARD_KINDS). */
const KINDS = `'CREDIT','ADDON','GUARANTEED','PRODUCT','VAULT_EDITION','THE_PIECE','CREDIT_TO_GIVE','I_WAS_THERE'`;
/** A PRODUCT's mode (schema.ts VAULT_REWARD_MODES). */
const MODES = `'FREE','RIGHT_TO_BUY'`;
/** Why a vault was taken back (schema.ts VAULT_REVOKED_REASONS): a returned piece only (D5, N36). */
const REVOKED_REASONS = `'RETURNED'`;
/** Where a house delivery comes from, before (0052) and since (schema.ts HOUSE_DELIVERY_SOURCES). */
const DELIVERY_SOURCES_0052 = `'MOMENT','CUSTOM'`;
const DELIVERY_SOURCES = `'MOMENT','CUSTOM','VAULT'`;
/** The occasions written before the deploy (schema.ts VAULT_OCCASIONS_BEFORE). */
const OCCASIONS_BEFORE = `'TIER:1','TIER:2','TIER:3'`;

/** Vaults one occasion gives (schema.ts VAULT_PER_OCCASION). */
const PER_OCCASION_MIN = 1;
const PER_OCCASION_MAX = 10;
/** The most an account receives per a source's scope (schema.ts VAULT_CAP). */
const CAP_MIN = 1;
const CAP_MAX = 100;
/** An occasion's vaults, their index at most (schema.ts VAULT_OCCASION_INDEX_MAX = per occasion × cap at most). */
const OCCASION_INDEX_MAX = PER_OCCASION_MAX * CAP_MAX;
/** "1 IN N", N at most (schema.ts VAULT_ODDS_IN_MAX). */
const ODDS_IN_MAX = 1_000_000;
/** A credit's amount at most, in minor units (schema.ts VAULT_AMOUNT_MINOR_MAX, as an order's). */
const AMOUNT_MAX = 100_000_000;
/** A VAULT EDITION's line (schema.ts VAULT_REWARD_LINE_MAX). */
const LINE_MAX = 120;
/** The console's order (schema.ts VAULT_REWARD_POSITION_MAX). */
const POSITION_MAX = 10_000;
/** A HOUSE vault's note (schema.ts VAULT_NOTE_MAX). */
const NOTE_MAX = 500;
/** The reveal's large words and their line (schema.ts VAULT_PRIZE_MAX, VAULT_PRIZE_LINE_MAX). */
const PRIZE_MAX = 40;
const PRIZE_LINE_MAX = 160;
/** How long a vault waits on THE VAULT page (schema.ts VAULT_WAIT_DAYS; D17). */
const WAIT_DAYS = 30;
/** A personal invitation's code: 12 characters of Crockford's base32 (schema.ts INVITATION_CODE_PATTERN). */
const INVITATION_CODE = '^[0-9A-HJKMNP-TV-Z]{12}$';

/**
 * The club's tiers at the migration, as services/club.ts reads them (held to CLUB_TIER_THRESHOLDS and
 * CLUB_EXCLUDED_STATUSES by test/db/migrations-0061.test.ts).
 */
export const TIER_THRESHOLDS: readonly number[] = [1, 5, 10];
export const EXCLUDED_STATUSES: readonly string[] = ['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'];

const UUID = `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

/** A line of 1 to `max` characters, trimmed, without control characters. */
const line = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;

/** The occasion's columns; each source names its own and no other. */
const OCCASION_COLUMNS = ['drop_id', 'entry_id', 'product_id', 'tier', 'worn_photo_id', 'friend_account_id', 'given_by', 'segment_id', 'note'] as const;
type OccasionColumn = (typeof OCCASION_COLUMNS)[number];

function occasion(required: readonly OccasionColumn[], optional: readonly OccasionColumn[], key: string): string {
  const parts = OCCASION_COLUMNS.filter((c) => !optional.includes(c)).map((c) => `${c} IS ${required.includes(c) ? 'NOT NULL' : 'NULL'}`);
  return `(${[...parts, key].join(' AND ')})`;
}

const OCCASION: Record<(typeof SOURCES)[number], string> = {
  LIVE: occasion(['drop_id', 'entry_id'], [], `occasion_key = 'LIVE:' || drop_id::text`),
  PIECE: occasion(['product_id'], [], `occasion_key = 'PIECE:' || product_id::text`),
  TIER: occasion(['tier'], [], `occasion_key = 'TIER:' || tier::text`),
  WORN: occasion(['product_id', 'worn_photo_id'], [], `occasion_key = 'WORN:' || product_id::text`),
  FRIEND: occasion(['friend_account_id'], [], `friend_account_id <> account_id AND occasion_key = 'FRIEND:' || friend_account_id::text`),
  PROFILE: occasion([], [], `occasion_key = 'PROFILE'`),
  HOUSE: occasion(['given_by'], ['segment_id', 'note'], `occasion_key ~ '^HOUSE:${UUID}$'`),
};

/** The outcome, written once at the opening. */
const OUTCOME = ['opened_at', 'reward_id', 'reward_kind', 'prize', 'prize_line', 'odds_text', 'rare', 'value_minor', 'currency', 'cost_minor'];
const row = (prefix: string, columns: readonly string[]) => `ROW(${columns.map((c) => `${prefix}.${c}`).join(', ')})`;

/** A vault's identity: what it was given for, to whom and when. */
const VAULT_IDENTITY = `'id', 'account_id', 'source', 'drop_id', 'entry_id', 'product_id', 'tier', 'worn_photo_id', 'friend_account_id', 'given_by', 'note', 'occasion_key', 'occasion_index', 'given_at', 'waits_until'`;

/** The defaults of OP-29: one per occasion, at most one per scope, the house without a cap. */
const defaults = SOURCES.map((s) => `('${s}', true, 1, ${s === 'HOUSE' ? 'NULL' : '1'})`).join(', ');

/** The house_deliveries_source shapes of 0052, and VAULT's. */
const DELIVERY_SHAPE_0052 = `(source = 'MOMENT' AND moment IS NOT NULL AND title IS NOT NULL AND body IS NOT NULL AND house_message_id IS NULL)
       OR (source = 'CUSTOM' AND house_message_id IS NOT NULL AND moment IS NULL AND title IS NULL AND body IS NULL AND piece_ref IS NULL)`;
const DELIVERY_SHAPE = `${DELIVERY_SHAPE_0052}
       OR (source = 'VAULT' AND title IS NOT NULL AND body IS NOT NULL AND moment IS NULL AND house_message_id IS NULL AND piece_ref IS NULL)`;

/**
 * Each account's tiers held at the migration (test entrants left out): its pieces as `clubCounts` counts them, against
 * the thresholds. The statement `up` runs once.
 */
export const OCCASIONS_BEFORE_INSERT = `INSERT INTO vault_occasions_before (account_id, occasion_key)
   SELECT h.account_id, 'TIER:' || t.tier
     FROM (SELECT o.account_id, count(*) AS pieces
             FROM ownership o
             JOIN products p ON p.id = o.product_id
            WHERE o.ended_at IS NULL
              AND (p.status NOT IN (${EXCLUDED_STATUSES.map((s) => `'${s}'`).join(', ')}) OR (p.status = 'REVOKED' AND EXISTS (
                    SELECT 1 FROM warranty_claims wc
                     WHERE wc.product_id = p.id AND wc.account_id = o.account_id AND wc.outcome = 'REPLACEMENT'
                       AND NOT EXISTS (SELECT 1 FROM ownership wo WHERE wo.product_id = wc.replacement_product_id))))
              AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = o.account_id)
            GROUP BY o.account_id) h
     JOIN (VALUES ${TIER_THRESHOLDS.map((n, i) => `(${i + 1}, ${n})`).join(', ')}) AS t (tier, threshold) ON h.pieces >= t.threshold`;

export const UP: readonly string[] = [
  // ── vault_sources: the seven sources and their limits ───────────────────
  `CREATE TABLE vault_sources (
     source       text        PRIMARY KEY CONSTRAINT vault_sources_source_check CHECK (source IN (${SOURCES.map((s) => `'${s}'`).join(',')})),
     enabled      boolean     NOT NULL DEFAULT true,
     per_occasion smallint    NOT NULL DEFAULT 1 CONSTRAINT vault_sources_per_occasion_check CHECK (per_occasion BETWEEN ${PER_OCCASION_MIN} AND ${PER_OCCASION_MAX}),
     cap          smallint    NULL CONSTRAINT vault_sources_cap_check CHECK (cap BETWEEN ${CAP_MIN} AND ${CAP_MAX}),
     updated_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT vault_sources_house_cap CHECK (source <> 'HOUSE' OR cap IS NULL)
   )`,
  `CREATE INDEX vault_sources_updated_by_idx ON vault_sources (updated_by)`,
  `CREATE TRIGGER vault_sources_touch_updated_at BEFORE UPDATE ON vault_sources
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER vault_sources_immutable_identity BEFORE UPDATE ON vault_sources
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('source')`,
  `CREATE TRIGGER vault_sources_no_delete BEFORE DELETE ON vault_sources
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a vault source is switched off, never deleted')`,
  `INSERT INTO vault_sources (source, enabled, per_occasion, cap) VALUES ${defaults}`,

  // ── vault_rewards: the one house table ──────────────────────────────────
  `CREATE TABLE vault_rewards (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     kind         text        NOT NULL CONSTRAINT vault_rewards_kind_check CHECK (kind IN (${KINDS})),
     odds_in      integer     NULL CONSTRAINT vault_rewards_odds_in_check CHECK (odds_in BETWEEN 1 AND ${ODDS_IN_MAX}),
     quantity     integer     NULL CONSTRAINT vault_rewards_quantity_check CHECK (quantity >= 0),
     given        integer     NOT NULL DEFAULT 0 CONSTRAINT vault_rewards_given_check CHECK (given >= 0),
     amount_minor integer     NULL CONSTRAINT vault_rewards_amount_minor_check CHECK (amount_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     currency     text        NULL CONSTRAINT vault_rewards_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     model_id     uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     addon_id     uuid        NULL REFERENCES addon_items (id) ON DELETE RESTRICT,
     mode         text        NULL CONSTRAINT vault_rewards_mode_check CHECK (mode IN (${MODES})),
     line         text        NULL CONSTRAINT vault_rewards_line_check CHECK (${line('line', LINE_MAX)}),
     active       boolean     NOT NULL DEFAULT true,
     position     smallint    NOT NULL DEFAULT 0 CONSTRAINT vault_rewards_position_check CHECK (position BETWEEN 0 AND ${POSITION_MAX}),
     created_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT vault_rewards_floor CHECK ((kind = 'I_WAS_THERE') = (odds_in IS NULL) AND (kind = 'I_WAS_THERE') = (quantity IS NULL)),
     CONSTRAINT vault_rewards_floor_active CHECK (kind <> 'I_WAS_THERE' OR active),
     CONSTRAINT vault_rewards_given_limit CHECK (quantity IS NULL OR given <= quantity),
     CONSTRAINT vault_rewards_amount CHECK ((kind IN ('CREDIT', 'CREDIT_TO_GIVE')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL)),
     CONSTRAINT vault_rewards_product CHECK (CASE kind
       WHEN 'PRODUCT' THEN (model_id IS NULL) <> (addon_id IS NULL)
       WHEN 'VAULT_EDITION' THEN model_id IS NOT NULL AND addon_id IS NULL
       WHEN 'ADDON' THEN addon_id IS NOT NULL AND model_id IS NULL
       ELSE model_id IS NULL AND addon_id IS NULL END),
     CONSTRAINT vault_rewards_mode CHECK ((kind = 'PRODUCT') = (mode IS NOT NULL)),
     CONSTRAINT vault_rewards_line CHECK (line IS NULL OR kind = 'VAULT_EDITION')
   )`,
  // One I WAS THERE floor (D2).
  `CREATE UNIQUE INDEX vault_rewards_floor_key ON vault_rewards (kind) WHERE kind = 'I_WAS_THERE'`,
  `CREATE INDEX vault_rewards_model_idx ON vault_rewards (model_id)`,
  `CREATE INDEX vault_rewards_addon_idx ON vault_rewards (addon_id)`,
  `CREATE INDEX vault_rewards_created_by_idx ON vault_rewards (created_by)`,
  `CREATE INDEX vault_rewards_updated_by_idx ON vault_rewards (updated_by)`,
  `CREATE TRIGGER vault_rewards_touch_updated_at BEFORE UPDATE ON vault_rewards
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER vault_rewards_immutable_identity BEFORE UPDATE ON vault_rewards
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'kind', 'created_by', 'created_at')`,
  `CREATE TRIGGER vault_rewards_kept BEFORE DELETE ON vault_rewards
     FOR EACH ROW WHEN (OLD.kind = 'I_WAS_THERE' OR OLD.given > 0)
     EXECUTE FUNCTION orbes_reject_mutation('the I WAS THERE floor and a reward given are never deleted, only made inactive')`,
  // No service as a reward (E7 "No access, status or service rewards"; D64).
  `CREATE FUNCTION orbes_vault_rewards_addon_product() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW.addon_id IS NOT NULL AND EXISTS (SELECT 1 FROM addon_items WHERE id = NEW.addon_id AND kind = 'SERVICE') THEN
       RAISE EXCEPTION 'a service cannot be a vault''s reward'
         USING ERRCODE = 'check_violation', CONSTRAINT = 'vault_rewards_addon_product', TABLE = 'vault_rewards';
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER vault_rewards_addon_product BEFORE INSERT OR UPDATE OF addon_id ON vault_rewards
     FOR EACH ROW EXECUTE FUNCTION orbes_vault_rewards_addon_product()`,
  `INSERT INTO vault_rewards (kind, active, position) VALUES ('I_WAS_THERE', true, 0)`,

  // ── drops, models: the switch on each LIVE release, the vault-only model ─
  `ALTER TABLE drops ADD COLUMN vault_on boolean NOT NULL DEFAULT false`,
  `ALTER TABLE drops ADD CONSTRAINT drops_vault_on CHECK (NOT vault_on OR (mode = 'LIVE' AND parent_drop_id IS NULL))`,
  `ALTER TABLE models ADD COLUMN vault_only boolean NOT NULL DEFAULT false`,

  // ── accounts, invitations: A FRIEND ─────────────────────────────────────
  `ALTER TABLE accounts ADD COLUMN invited_by uuid NULL CONSTRAINT accounts_invited_by_fkey REFERENCES accounts (id) ON DELETE RESTRICT`,
  `ALTER TABLE accounts ADD COLUMN invited_at timestamptz NULL`,
  `ALTER TABLE accounts ADD CONSTRAINT accounts_invited CHECK ((invited_by IS NULL) = (invited_at IS NULL) AND invited_by <> id)`,
  `CREATE INDEX accounts_invited_by_idx ON accounts (invited_by)`,
  `CREATE TRIGGER accounts_invited_once BEFORE UPDATE OF invited_by, invited_at ON accounts
     FOR EACH ROW WHEN (OLD.invited_by IS NOT NULL AND (NEW.invited_by IS DISTINCT FROM OLD.invited_by OR NEW.invited_at IS DISTINCT FROM OLD.invited_at))
     EXECUTE FUNCTION orbes_reject_mutation('an account''s inviter is set once')`,
  `CREATE TABLE invitations (
     account_id uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     code       text        NOT NULL CONSTRAINT invitations_code_check CHECK (code ~ '${INVITATION_CODE}'),
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT invitations_code_key UNIQUE (code)
   )`,
  `CREATE TRIGGER invitations_immutable BEFORE UPDATE ON invitations
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('account_id', 'code', 'created_at')`,
  `CREATE TRIGGER invitations_no_delete BEFORE DELETE ON invitations
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('an invitation link is made once')`,

  // ── vaults: each vault given ────────────────────────────────────────────
  `CREATE TABLE vaults (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id        uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     source            text        NOT NULL CONSTRAINT vaults_source_check CHECK (source IN (${SOURCES.map((s) => `'${s}'`).join(',')})),
     drop_id           uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     entry_id          uuid        NULL REFERENCES live_entries (id) ON DELETE RESTRICT,
     product_id        uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     tier              smallint    NULL CONSTRAINT vaults_tier_check CHECK (tier BETWEEN 1 AND 3),
     worn_photo_id     uuid        NULL REFERENCES worn_photos (id) ON DELETE RESTRICT,
     friend_account_id uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     given_by          uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     segment_id        uuid        NULL REFERENCES segments (id) ON DELETE RESTRICT,
     note              text        NULL CONSTRAINT vaults_note_check CHECK (char_length(note) BETWEEN 1 AND ${NOTE_MAX} AND note = btrim(note)),
     occasion_key      text        NOT NULL,
     occasion_index    smallint    NOT NULL CONSTRAINT vaults_occasion_index_check CHECK (occasion_index BETWEEN 1 AND ${OCCASION_INDEX_MAX}),
     given_at          timestamptz NOT NULL DEFAULT now(),
     waits_until       timestamptz NOT NULL,
     opened_at         timestamptz NULL,
     revoked_at        timestamptz NULL,
     revoked_reason    text        NULL CONSTRAINT vaults_revoked_reason_check CHECK (revoked_reason IN (${REVOKED_REASONS})),
     reward_id         uuid        NULL REFERENCES vault_rewards (id) ON DELETE RESTRICT,
     reward_kind       text        NULL CONSTRAINT vaults_reward_kind_check CHECK (reward_kind IN (${KINDS})),
     prize             text        NULL CONSTRAINT vaults_prize_check CHECK (${line('prize', PRIZE_MAX)}),
     prize_line        text        NULL CONSTRAINT vaults_prize_line_check CHECK (${line('prize_line', PRIZE_LINE_MAX)}),
     odds_text         text        NULL CONSTRAINT vaults_odds_text_check CHECK (odds_text ~ '^1 IN [1-9][0-9]{0,6}$'),
     rare              boolean     NULL,
     value_minor       integer     NULL CONSTRAINT vaults_value_minor_check CHECK (value_minor >= 0),
     currency          text        NULL CONSTRAINT vaults_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     cost_minor        integer     NULL CONSTRAINT vaults_cost_minor_check CHECK (cost_minor >= 0),
     grant_id          uuid        NULL REFERENCES tier_grants (id) ON DELETE RESTRICT,
     order_id          uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     guarantee_id      uuid        NULL REFERENCES house_guarantees (id) ON DELETE RESTRICT,
     CONSTRAINT vaults_occasion CHECK (CASE source
       ${SOURCES.map((s) => `WHEN '${s}' THEN ${OCCASION[s]}`).join('\n       ')}
       ELSE false END),
     CONSTRAINT vaults_waits CHECK (waits_until = given_at + interval '${WAIT_DAYS * 24} hours'),
     CONSTRAINT vaults_revoked CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL) AND (revoked_at IS NULL OR source = 'PIECE')),
     CONSTRAINT vaults_opened_or_revoked CHECK (opened_at IS NULL OR revoked_at IS NULL),
     CONSTRAINT vaults_outcome CHECK (
       (opened_at IS NULL) = (reward_id IS NULL) AND (opened_at IS NULL) = (reward_kind IS NULL) AND (opened_at IS NULL) = (prize IS NULL)
       AND (opened_at IS NULL) = (odds_text IS NULL) AND (opened_at IS NULL) = (rare IS NULL)
       AND (value_minor IS NULL) = (currency IS NULL)
       AND (opened_at IS NOT NULL OR (prize_line IS NULL AND value_minor IS NULL AND cost_minor IS NULL AND grant_id IS NULL AND order_id IS NULL AND guarantee_id IS NULL)))
   )`,
  // Two passes, a retry or two processes never give one twice; a vault revoked can be given again.
  `CREATE UNIQUE INDEX vaults_occasion_key ON vaults (account_id, occasion_key, occasion_index) WHERE revoked_at IS NULL`,
  // THE VAULT page: an account's vaults, waiting and opened.
  `CREATE INDEX vaults_account_idx ON vaults (account_id, opened_at, waits_until)`,
  `CREATE INDEX vaults_drop_idx ON vaults (drop_id)`,
  `CREATE INDEX vaults_entry_idx ON vaults (entry_id)`,
  `CREATE INDEX vaults_product_idx ON vaults (product_id)`,
  `CREATE INDEX vaults_worn_photo_idx ON vaults (worn_photo_id)`,
  `CREATE INDEX vaults_friend_account_idx ON vaults (friend_account_id)`,
  `CREATE INDEX vaults_given_by_idx ON vaults (given_by)`,
  `CREATE INDEX vaults_segment_idx ON vaults (segment_id)`,
  `CREATE INDEX vaults_reward_idx ON vaults (reward_id)`,
  `CREATE INDEX vaults_grant_idx ON vaults (grant_id)`,
  `CREATE INDEX vaults_order_idx ON vaults (order_id)`,
  `CREATE INDEX vaults_guarantee_idx ON vaults (guarantee_id)`,
  `CREATE TRIGGER vaults_immutable_identity BEFORE UPDATE ON vaults
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${VAULT_IDENTITY})`,
  // A segment deleted after its gift: its id is cleared, never changed to another.
  `CREATE TRIGGER vaults_segment BEFORE UPDATE OF segment_id ON vaults
     FOR EACH ROW WHEN (NEW.segment_id IS NOT NULL AND NEW.segment_id IS DISTINCT FROM OLD.segment_id)
     EXECUTE FUNCTION orbes_reject_mutation('a vault keeps its segment, or loses it')`,
  `CREATE FUNCTION orbes_vaults_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF OLD.opened_at IS NOT NULL AND ${row('NEW', OUTCOME)} IS DISTINCT FROM ${row('OLD', OUTCOME)} THEN
       RAISE EXCEPTION 'a vault''s outcome is written once, at its opening' USING ERRCODE = 'OR001';
     END IF;
     IF OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at, NEW.revoked_reason) IS DISTINCT FROM ROW(OLD.revoked_at, OLD.revoked_reason) THEN
       RAISE EXCEPTION 'a vault taken back stays taken back' USING ERRCODE = 'OR001';
     END IF;
     IF (OLD.grant_id IS NOT NULL AND NEW.grant_id IS DISTINCT FROM OLD.grant_id)
        OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
        OR (OLD.guarantee_id IS NOT NULL AND NEW.guarantee_id IS DISTINCT FROM OLD.guarantee_id) THEN
       RAISE EXCEPTION 'what a vault gave is linked once' USING ERRCODE = 'OR001';
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER vaults_guard BEFORE UPDATE ON vaults
     FOR EACH ROW EXECUTE FUNCTION orbes_vaults_guard()`,
  `CREATE TRIGGER vaults_no_delete BEFORE DELETE ON vaults
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a vault is revoked, never deleted')`,

  // ── vault_occasions_before: the tiers held at the migration ─────────────
  `CREATE TABLE vault_occasions_before (
     account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     occasion_key text NOT NULL CONSTRAINT vault_occasions_before_occasion_key_check CHECK (occasion_key IN (${OCCASIONS_BEFORE})),
     CONSTRAINT vault_occasions_before_pkey PRIMARY KEY (account_id, occasion_key)
   )`,
  OCCASIONS_BEFORE_INSERT,

  // ── house_deliveries: a vault's arrival and its receipt ─────────────────
  `ALTER TABLE house_deliveries DROP CONSTRAINT house_deliveries_source`,
  `ALTER TABLE house_deliveries DROP CONSTRAINT house_deliveries_source_check`,
  `ALTER TABLE house_deliveries ADD CONSTRAINT house_deliveries_source_check CHECK (source IN (${DELIVERY_SOURCES}))`,
  `ALTER TABLE house_deliveries ADD CONSTRAINT house_deliveries_source CHECK (
       ${DELIVERY_SHAPE})`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no vault: refused while anything it cannot keep exists.
  `DO $$
   DECLARE vaults_n bigint; invitations_n bigint; invited_n bigint; messages_n bigint; rewards_n bigint; settings_n bigint; releases_n bigint; models_n bigint;
   BEGIN
     SELECT count(*) INTO vaults_n FROM vaults;
     SELECT count(*) INTO invitations_n FROM invitations;
     SELECT count(*) INTO invited_n FROM accounts WHERE invited_by IS NOT NULL;
     SELECT count(*) INTO messages_n FROM house_deliveries WHERE source = 'VAULT';
     SELECT count(*) INTO rewards_n FROM vault_rewards WHERE kind <> 'I_WAS_THERE';
     SELECT count(*) INTO settings_n FROM vault_sources
      WHERE NOT enabled OR per_occasion <> 1 OR cap IS DISTINCT FROM (CASE WHEN source = 'HOUSE' THEN NULL ELSE 1 END);
     SELECT count(*) INTO releases_n FROM drops WHERE vault_on;
     SELECT count(*) INTO models_n FROM models WHERE vault_only;
     IF vaults_n > 0 OR invitations_n > 0 OR invited_n > 0 OR messages_n > 0 OR rewards_n > 0 OR settings_n > 0 OR releases_n > 0 OR models_n > 0 THEN
       RAISE EXCEPTION 'migration 0061_the_vault cannot be rolled back: % vaults, % invitations, % invited accounts, % vault messages, % vault rewards, % vault source settings, % releases with their vault on and % vault-only models exist', vaults_n, invitations_n, invited_n, messages_n, rewards_n, settings_n, releases_n, models_n;
     END IF;
   END $$`,
  `ALTER TABLE house_deliveries DROP CONSTRAINT IF EXISTS house_deliveries_source`,
  `ALTER TABLE house_deliveries DROP CONSTRAINT IF EXISTS house_deliveries_source_check`,
  `ALTER TABLE house_deliveries ADD CONSTRAINT house_deliveries_source_check CHECK (source IN (${DELIVERY_SOURCES_0052}))`,
  `ALTER TABLE house_deliveries ADD CONSTRAINT house_deliveries_source CHECK (
       ${DELIVERY_SHAPE_0052})`,
  `DROP TABLE IF EXISTS vault_occasions_before`,
  `DROP TABLE IF EXISTS vaults`,
  `DROP FUNCTION IF EXISTS orbes_vaults_guard()`,
  `DROP TABLE IF EXISTS invitations`,
  `DROP TRIGGER IF EXISTS accounts_invited_once ON accounts`,
  `DROP INDEX IF EXISTS accounts_invited_by_idx`,
  `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_invited`,
  `ALTER TABLE accounts DROP COLUMN IF EXISTS invited_at`,
  `ALTER TABLE accounts DROP COLUMN IF EXISTS invited_by`,
  `ALTER TABLE models DROP COLUMN IF EXISTS vault_only`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_vault_on`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS vault_on`,
  `DROP TABLE IF EXISTS vault_rewards`,
  `DROP FUNCTION IF EXISTS orbes_vault_rewards_addon_product()`,
  `DROP TABLE IF EXISTS vault_sources`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
