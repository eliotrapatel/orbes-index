/**
 * The TEST PURGE's plan (lot PURGE, plan §A.1 to §A.3, M17, H11): what the purge of an ended test may delete, and what
 * keeps a row where it is. Migration 0066_test_purge holds the same plan in the database (`orbes_purge_plan()` and the
 * table `purge_delete_tables`, both written by the migration's superuser only); test/db/migrations-0066.test.ts keeps
 * the three equal and checks the plan against `pg_constraint`: every foreign key into `accounts`, `orders`,
 * `drop_entries` and `live_entries`, and into every other table whose rows the purge deletes, is classed here, so a
 * future migration that adds one fails CI until it is classed.
 *
 *   DELETE  the purge deletes the referencing rows with the row they name, children first (every foreign key is ON
 *           DELETE RESTRICT): an order's events, an entry's sizes, a test account's own settings.
 *   BLOCK   a referencing row keeps the row it names, and with it what holds it: an order with an invoice, a parcel or a
 *           return stays with its entry and its account; a test account named by a row of the founding list, by
 *           another account (its personal invitation, a friend's vault) or by anything a person or the house made
 *           stays whole, and the referencing row is never touched.
 *
 * The owner-column rule (H11): a column referencing `accounts` is DELETE only when it is the row's own owner column
 * (`account_id`, NOT NULL: the row belongs to that account); every other referencing column (an inviter, a friend, a
 * transfer's two sides, a device's link) is BLOCK.
 *
 * Inside a release under purge (steps 1 to 9) the run's own entries, orders, sets sold and interests of its test
 * accounts are deleted by the purge's own steps; once those are done, any such row left (another release's, or one an
 * order holds) keeps its account: at step 10 the four are BLOCK.
 */

/** A foreign key's class (see the header). */
export type PurgeClass = 'DELETE' | 'BLOCK';

/** One foreign key: the referencing table and its columns (in the key's order), the table referenced, its class and why. */
export interface PurgeReference {
  readonly table: string;
  readonly columns: string;
  readonly references: string;
  readonly kind: PurgeClass;
  readonly why: string;
}

const ref = (table: string, columns: string, references: string, kind: PurgeClass, why: string): PurgeReference => Object.freeze({ table, columns, references, kind, why });

const STEP_10 = 'a test account’s own row, deleted with it at step 10 (purge_delete_tables)';
const PERSON = 'something a person or the house made for this account: it keeps the account';
const RELEASE_ROWS = 'the release’s own rows of the test are deleted by steps 1 to 9; any left (another release’s, or one an order holds) keeps the account';

/** Every foreign key the purge meets, by the table it references (M17). */
export const PURGE_REFERENCES: readonly PurgeReference[] = Object.freeze([
  // ── accounts ─────────────────────────────────────────────────────────────
  ref('account_addresses', 'account_id', 'accounts', 'BLOCK', 'BLOCK BY NAME: a person’s address book (H11)'),
  ref('account_notes', 'account_id', 'accounts', 'BLOCK', 'the staff’s notes on a collector'),
  ref('account_profiles', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('account_recovery_codes', 'account_id', 'accounts', 'BLOCK', 'a recovery code issued by the staff for a person'),
  ref('account_scores', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('account_sizes', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('account_sources', 'account_id', 'accounts', 'BLOCK', 'where a sign-up came from (a test account never signs up)'),
  ref('account_tags', 'account_id', 'accounts', 'BLOCK', 'the staff’s tags on a collector'),
  ref('account_tastes', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('account_wishes', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('accounts', 'invited_by', 'accounts', 'BLOCK', 'BLOCK BY NAME: ANOTHER account signed up through this one’s personal invitation (H11)'),
  ref('acquisition_conversions', 'account_id', 'accounts', 'BLOCK', 'a conversion the advertising outbox may send'),
  ref('acquisition_touches', 'account_id', 'accounts', 'BLOCK', 'a link followed by a person'),
  ref('ad_clicks', 'account_id', 'accounts', 'BLOCK', 'a platform’s click id held with consent'),
  ref('ad_consents', 'account_id', 'accounts', 'BLOCK', 'BLOCK BY NAME: a person’s advertising choice, the proof of consent (H11)'),
  ref('care_requests', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('circle_poll_votes', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('circle_rsvps', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('claim_code_renewals', 'account_id', 'accounts', 'BLOCK', 'a claim code made for a buyer'),
  ref('client_conversations', 'account_id', 'accounts', 'BLOCK', 'Client Services’ conversation with a person (its messages are kept with the account)'),
  ref('collector_history', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('collector_places', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('collector_view_months', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('collector_view_totals', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('collector_views', 'account_id', 'accounts', 'BLOCK', 'a device’s view, the account only its attribution (not the owner column)'),
  ref('drop_entries', 'account_id', 'accounts', 'BLOCK', RELEASE_ROWS),
  ref('email_outbox', 'account_id', 'accounts', 'BLOCK', 'an email written for a person'),
  ref('email_preferences', 'account_id', 'accounts', 'DELETE', STEP_10),
  ref('house_deliveries', 'account_id', 'accounts', 'BLOCK', 'a house message delivered, kept with the account'),
  ref('house_guarantees', 'account_id', 'accounts', 'BLOCK', 'a house guarantee given'),
  ref('invitations', 'account_id', 'accounts', 'BLOCK', 'an invitation link, made once'),
  ref('live_entries', 'account_id', 'accounts', 'BLOCK', RELEASE_ROWS),
  ref('live_interest', 'account_id', 'accounts', 'BLOCK', RELEASE_ROWS),
  ref('orders', 'account_id', 'accounts', 'BLOCK', RELEASE_ROWS),
  ref('ownership', 'account_id', 'accounts', 'BLOCK', 'a piece owned'),
  ref('ownership_transfers', 'from_account_id', 'accounts', 'BLOCK', 'a transfer’s side, not the owner column'),
  ref('ownership_transfers', 'to_account_id', 'accounts', 'BLOCK', 'a transfer’s side, not the owner column'),
  ref('preregistrations', 'account_id', 'accounts', 'BLOCK', 'BLOCK BY NAME: the founding list, real sign-ups (H11, F31)'),
  ref('release_answers', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('scan_events', 'account_id', 'accounts', 'BLOCK', 'a scan of a piece'),
  ref('set_sales', 'account_id', 'accounts', 'BLOCK', RELEASE_ROWS),
  ref('shop_requests', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('test_entrants', 'account_id', 'accounts', 'DELETE', 'the pool’s row, deleted last with the account (M15)'),
  ref('tier_grants', 'account_id', 'accounts', 'DELETE', `${STEP_10}; a grant an order, a credit use, a vault or a claim names keeps it`),
  ref('tracking_device_accounts', 'account_id', 'accounts', 'BLOCK', 'a device’s link to the account'),
  ref('tracking_devices', 'account_id', 'accounts', 'BLOCK', 'a device’s link to the account, not the owner column'),
  ref('vault_gifts', 'accepted_by', 'accounts', 'BLOCK', 'a credit given, accepted once'),
  ref('vault_occasions_before', 'account_id', 'accounts', 'BLOCK', 'THE VAULT’s occasions'),
  ref('vaults', 'account_id', 'accounts', 'BLOCK', 'a vault, revoked and never deleted'),
  ref('vaults', 'friend_account_id', 'accounts', 'BLOCK', 'BLOCK BY NAME: ANOTHER collector’s vault naming this account as friend (H11)'),
  ref('warranty_claims', 'account_id', 'accounts', 'BLOCK', PERSON),
  ref('worn_photos', 'account_id', 'accounts', 'BLOCK', PERSON),

  // ── orders ───────────────────────────────────────────────────────────────
  ref('bench_items', 'order_id', 'orders', 'BLOCK', 'a piece on the bench'),
  ref('claim_code_renewals', 'order_id', 'orders', 'BLOCK', 'a claim code made for the buyer'),
  ref('client_messages', 'order_id', 'orders', 'BLOCK', 'BLOCK BY NAME: Client Services’ messages, kept with the account (H11)'),
  ref('credit_uses', 'order_id', 'orders', 'DELETE', 'a credit already given back, applied by no staff member; one still taken off, or applied by the staff, keeps the order'),
  ref('invoices', 'order_id', 'orders', 'BLOCK', 'an invoice or a credit note: its number is never reused nor gapped'),
  ref('order_addon_items', 'order_id', 'orders', 'DELETE', 'its add-on units, cancelled or removed; one invoiced, from a vault, held, shipped or on a store keeps the order'),
  ref('order_cases', 'exchange_order_id', 'orders', 'BLOCK', 'a case’s exchange'),
  ref('order_cases', 'order_id', 'orders', 'BLOCK', 'a case opened on the order'),
  ref('order_events', 'order_id', 'orders', 'DELETE', 'its events (append-only: the purge’s bypass)'),
  ref('orders', 'exchange_of_order_id', 'orders', 'BLOCK', 'an exchange of the order'),
  ref('orders', 'with_order_id', 'orders', 'DELETE', 'the orders travelling with it (a GIFT, the 2nd to 5th piece): deleted children first; one blocking keeps the whole group'),
  ref('returns', 'order_id', 'orders', 'BLOCK', 'a return'),
  ref('shipment_items', 'order_id', 'orders', 'BLOCK', 'a parcel’s item'),
  ref('shipments', 'order_id', 'orders', 'BLOCK', 'a parcel'),
  ref('stock_movements', 'order_id', 'orders', 'BLOCK', 'the stock ledger, append-only'),
  ref('vaults', 'order_id', 'orders', 'BLOCK', 'a vault given with the order'),

  // ── drop_entries, live_entries ───────────────────────────────────────────
  ref('addon_choices', 'drop_entry_id', 'drop_entries', 'DELETE', 'the entry’s add-on choices'),
  ref('drop_entry_sizes', 'entry_id,drop_id', 'drop_entries', 'DELETE', 'the entry’s sizes'),
  ref('orders', 'drop_entry_id', 'drop_entries', 'DELETE', 'the entry’s orders; one blocking keeps the entry'),
  ref('addon_choices', 'live_entry_id', 'live_entries', 'DELETE', 'the entry’s add-on choices'),
  ref('after_room_guests', 'entry_id', 'live_entries', 'DELETE', 'its after-room place (positions keep their gaps, 0023)'),
  ref('live_entry_sizes', 'entry_id,drop_id', 'live_entries', 'DELETE', 'the entry’s sizes'),
  ref('orders', 'live_entry_id', 'live_entries', 'DELETE', 'the entry’s orders; one blocking keeps the entry'),
  ref('vaults', 'entry_id', 'live_entries', 'BLOCK', 'a vault given for the entry'),

  // ── the other tables whose rows the purge deletes ────────────────────────
  ref('live_interest_sizes', 'drop_id,account_id', 'live_interest', 'DELETE', 'an I’LL BE THERE’s sizes, deleted first'),
  ref('stock_movements', 'order_addon_item_id,order_id,sku_id', 'order_addon_items', 'BLOCK', 'the stock ledger, append-only'),
  ref('orders', 'set_sale_id,account_id', 'set_sales', 'DELETE', 'the set’s orders, deleted before it'),
  ref('test_run_entrants', 'account_id', 'test_entrants', 'BLOCK', 'the run’s own rows are deleted at step 9; another test’s row keeps the account'),
  ref('credit_uses', 'grant_id', 'tier_grants', 'BLOCK', 'a credit use of the grant (its order still exists)'),
  ref('orders', 'gift_grant_id', 'tier_grants', 'BLOCK', 'a GIFT order of the grant still exists'),
  ref('vault_gifts', 'grant_id', 'tier_grants', 'BLOCK', 'a credit given from the grant'),
  ref('vaults', 'grant_id', 'tier_grants', 'BLOCK', 'a vault of the grant'),
  ref('warranty_claims', 'grant_id', 'tier_grants', 'BLOCK', 'a claim on the grant'),
]);

/**
 * The tables whose rows the purge deletes (steps 1 to 10): every foreign key into one of them is classed above. `sessions`,
 * `event_journal` and `audit_logs` name what they concern by text, without a foreign key.
 */
export const PURGE_ROW_TABLES: readonly string[] = Object.freeze([
  'accounts', 'account_profiles', 'account_scores', 'account_sizes', 'addon_choices', 'after_room_guests', 'audit_logs', 'collector_history',
  'collector_places', 'collector_view_months', 'collector_view_totals', 'credit_uses', 'drop_entries', 'drop_entry_sizes', 'email_preferences',
  'event_journal', 'live_entries', 'live_entry_sizes', 'live_interest', 'live_interest_sizes', 'order_addon_items', 'order_events', 'orders',
  'sessions', 'set_sales', 'test_entrants', 'test_run_entrants', 'tier_grants',
]);

/**
 * Step 10's DELETE-class tables referencing `accounts`, children first (`purge_delete_tables`, its `ord`): the rows of a
 * test account deleted with it, in one call; `test_entrants` last, then the account itself. `sessions`
 * (`subject_type = 'account'`, no foreign key) are deleted first, by name.
 */
export const PURGE_DELETE_TABLES: readonly { readonly table: string; readonly column: string }[] = Object.freeze(
  [
    'account_sizes',
    'account_profiles',
    'email_preferences',
    'account_scores',
    'collector_history',
    'collector_places',
    'collector_view_months',
    'collector_view_totals',
    'tier_grants',
    'test_entrants',
  ].map((table) => Object.freeze({ table, column: 'account_id' })),
);

/** The append-only tables the purge's bypass deletes from (`orbes_reject_mutation`, purpose `purge`, DELETE only). */
export const PURGE_GUARDED_TABLES: readonly string[] = Object.freeze(['audit_logs', 'order_events', 'event_journal', 'credit_uses', 'tier_grants']);

/** The references classed BLOCK BY NAME (H11, F31): real-person data and the rows of ANOTHER account. */
export const PURGE_BLOCK_BY_NAME: readonly string[] = Object.freeze([
  'preregistrations.account_id',
  'account_addresses.account_id',
  'ad_consents.account_id',
  'client_messages.order_id',
  'accounts.invited_by',
  'vaults.friend_account_id',
]);

/** A reference's key, as the tests and the database's plan write it: `table(columns)->references`. */
export const purgeReferenceKey = (r: Pick<PurgeReference, 'table' | 'columns' | 'references'>): string => `${r.table}(${r.columns})->${r.references}`;
