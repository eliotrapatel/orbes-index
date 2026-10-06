/**
 * 0025 — the messages between a collector and ORBES Client Services (plan NEXT-NINE of 2026-10-06, §3.1 CS-01, step 1.1:
 * « All the places where they can contact the client services should actually be a button that sends a message to the
 * console »). The collector writes from the app; Client Services answer in the console; the answers are read in the
 * account's MESSAGES. Nothing is emailed, and messages carry no files.
 *
 * `client_conversations`: one per collector (`client_conversations_account_key`). Its `status` is TO_ANSWER (the
 * collector wrote last, or wrote again after it was closed), ANSWERED or CLOSED; `waiting_since` is set exactly while it
 * is TO_ANSWER (`client_conversations_waiting`: the first collector message not answered yet), `closed_at` and
 * `closed_by` exactly while it is CLOSED (`client_conversations_closed`). `answered_by` is the staff member who answers
 * it (set by the first answer, by Take it or by an ADMIN's assignment). `last_message_at` the time of its latest
 * message, `collector_read_at` the time up to which the collector has read the answers. id, account_id and created_at
 * never change. The Messages board reads it by status, then waiting time, then latest message
 * (`client_conversations_board_idx`).
 *
 * `client_messages`: the messages of a conversation, oldest first (`client_messages_conversation_idx`). `author`
 * COLLECTOR or STAFF, with the staff member exactly on a STAFF message (`client_messages_author`). `body` plain text of 1
 * to 4 000 characters once trimmed (the service holds a collector to 2 000). What a collector's message concerns:
 * `context_kind` PIECE, ORDER, RELEASE, SCAN or MODEL with its `context_label` (1 to 120 characters, a snapshot written
 * by the server) both or neither (`client_messages_label`), never on a STAFF message (`client_messages_staff_plain`),
 * and the row it names (`client_messages_context`): a PIECE its product_id, an ORDER its order_id, a RELEASE its drop_id,
 * a MODEL its model_id (and the shop request it may concern), a SCAN its `scan_ref` (the 8 capital hex characters of the
 * scan's REF), the piece it may name and `scan_event_id`, without a foreign key: the scan retention (services/
 * scan-retention.ts) clears it when it deletes the scan, and keeps the REF. A message without a kind names nothing.
 * A message is never changed (every column but scan_event_id is guarded), never deleted and never truncated: messages
 * are kept with the account.
 *
 * Every foreign key leads an index (`client_conversations_account_key`, `client_conversations_answered_by_idx`,
 * `client_conversations_closed_by_idx`, `client_messages_conversation_idx`, and one per column the context names); ON
 * DELETE RESTRICT like every other. Compatible with the previous image: two new tables it never reads. No row is
 * inserted. `down` drops the two tables: the schema of 0024 exactly. One statement per array entry (PGlite's extended
 * protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const STATUSES = `'TO_ANSWER','ANSWERED','CLOSED'`;
const AUTHORS = `'COLLECTOR','STAFF'`;
const CONTEXTS = `'PIECE','ORDER','RELEASE','SCAN','MODEL'`;

/** The longest message a row holds (services/messages.ts MESSAGE_LIMITS.staff), and the longest label (MESSAGE_LIMITS.label). */
const BODY_MAX = 4000;
const LABEL_MAX = 120;

/** The columns a message's context names, each one NULL but those `kept`. */
const CONTEXT_IDS = ['product_id', 'order_id', 'drop_id', 'model_id', 'shop_request_id', 'scan_event_id', 'scan_ref'];
const only = (kind: string, required: readonly string[], kept: readonly string[] = []) =>
  `(context_kind IS NOT DISTINCT FROM '${kind}' AND ${required.map((c) => `${c} IS NOT NULL`).join(' AND ')} AND ${CONTEXT_IDS.filter((c) => !required.includes(c) && !kept.includes(c))
    .map((c) => `${c} IS NULL`)
    .join(' AND ')})`;

/** Every column of a message but `scan_event_id`, which the scan retention clears. */
const MESSAGE_COLUMNS = [
  'id', 'conversation_id', 'author', 'admin_id', 'body', 'context_kind', 'context_label', 'product_id', 'order_id', 'drop_id', 'model_id', 'shop_request_id',
  'scan_ref', 'created_at',
];

export const UP: readonly string[] = [
  // ── client_conversations ─────────────────────────────────────────────────
  `CREATE TABLE client_conversations (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id        uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     status            text        NOT NULL DEFAULT 'TO_ANSWER' CHECK (status IN (${STATUSES})),
     answered_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     waiting_since     timestamptz NULL,
     last_message_at   timestamptz NOT NULL,
     collector_read_at timestamptz NULL,
     closed_at         timestamptz NULL,
     closed_by         uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT client_conversations_account_key UNIQUE (account_id),
     CONSTRAINT client_conversations_waiting CHECK ((status = 'TO_ANSWER') = (waiting_since IS NOT NULL)),
     CONSTRAINT client_conversations_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND closed_by IS NOT NULL))
   )`,
  `CREATE INDEX client_conversations_answered_by_idx ON client_conversations (answered_by)`,
  `CREATE INDEX client_conversations_closed_by_idx ON client_conversations (closed_by)`,
  `CREATE INDEX client_conversations_board_idx ON client_conversations (status, waiting_since, last_message_at)`,
  `CREATE TRIGGER client_conversations_immutable_identity BEFORE UPDATE ON client_conversations
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'created_at')`,

  // ── client_messages ──────────────────────────────────────────────────────
  `CREATE TABLE client_messages (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     conversation_id uuid        NOT NULL REFERENCES client_conversations (id) ON DELETE RESTRICT,
     author          text        NOT NULL CHECK (author IN (${AUTHORS})),
     admin_id        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     body            text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND ${BODY_MAX}),
     context_kind    text        NULL CHECK (context_kind IN (${CONTEXTS})),
     context_label   text        NULL CHECK (length(btrim(context_label)) BETWEEN 1 AND ${LABEL_MAX}),
     product_id      uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     order_id        uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     drop_id         uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     model_id        uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     shop_request_id uuid        NULL REFERENCES shop_requests (id) ON DELETE RESTRICT,
     scan_event_id   uuid        NULL,
     scan_ref        char(8)     NULL CHECK (scan_ref ~ '^[0-9A-F]{8}$'),
     created_at      timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT client_messages_author CHECK ((author = 'STAFF') = (admin_id IS NOT NULL)),
     CONSTRAINT client_messages_label CHECK ((context_kind IS NULL) = (context_label IS NULL)),
     CONSTRAINT client_messages_staff_plain CHECK (author = 'COLLECTOR' OR context_kind IS NULL),
     CONSTRAINT client_messages_context CHECK (
       (context_kind IS NULL AND ${CONTEXT_IDS.map((c) => `${c} IS NULL`).join(' AND ')})
       OR ${only('PIECE', ['product_id'])}
       OR ${only('ORDER', ['order_id'])}
       OR ${only('RELEASE', ['drop_id'])}
       OR ${only('SCAN', ['scan_ref'], ['product_id', 'scan_event_id'])}
       OR ${only('MODEL', ['model_id'], ['shop_request_id'])})
   )`,
  `CREATE INDEX client_messages_conversation_idx ON client_messages (conversation_id, created_at)`,
  `CREATE INDEX client_messages_admin_id_idx ON client_messages (admin_id)`,
  `CREATE INDEX client_messages_product_id_idx ON client_messages (product_id)`,
  `CREATE INDEX client_messages_order_id_idx ON client_messages (order_id)`,
  `CREATE INDEX client_messages_drop_id_idx ON client_messages (drop_id)`,
  `CREATE INDEX client_messages_model_id_idx ON client_messages (model_id)`,
  `CREATE INDEX client_messages_shop_request_id_idx ON client_messages (shop_request_id)`,
  // The scan retention finds the messages of the scans it deletes.
  `CREATE INDEX client_messages_scan_event_idx ON client_messages (scan_event_id) WHERE scan_event_id IS NOT NULL`,
  `CREATE TRIGGER client_messages_immutable BEFORE UPDATE ON client_messages
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${MESSAGE_COLUMNS.map((c) => `'${c}'`).join(', ')})`,
  `CREATE TRIGGER client_messages_no_delete BEFORE DELETE ON client_messages
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('messages are kept with the account')`,
  `CREATE TRIGGER client_messages_no_truncate BEFORE TRUNCATE ON client_messages
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('messages are kept with the account')`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS client_messages`, `DROP TABLE IF EXISTS client_conversations`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
