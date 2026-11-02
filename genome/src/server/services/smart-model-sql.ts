/**
 * The query of ORBES Smart Model's export (lot EXPORT SMART MODEL, services/smart-model-export.ts): the constant `SQL` of
 * the Mac's orbes-sync.mjs v1.2.0, copied as it is (format orbes-console/2). The lot's contract makes it the reference:
 * the console runs it statement by statement on one connection (BEGIN … READ ONLY, the SET LOCALs, the LIVE guard, the
 * query, ROLLBACK), with `__SINCE__` replaced by a checked Paris day. Never edit it here: a new version of the script
 * brings a new copy, and test/services/smart-model-export.test.ts holds its SHA-256.
 */
/** The script version this copy comes from (sent as `meta.tool`, as the script does). */
export const SMART_MODEL_SQL_VERSION = '1.2.0';

export const SMART_MODEL_SQL = `-- ORBES console → ORBES Smart Model: what has been sold, read in ONE read-only transaction. Nothing is written.
-- Format orbes-console/2. The first Paris day to send (YYYY-MM-DD, checked) is the only value put into this query.
-- Rules (the owner's decisions of 31 Oct 2026, ORBES-outil-interne-specs.md):
--   * a sale = the root order + the orders travelling with it (with_order_id) + its EXCHANGE orders (recursively);
--   * test accounts (test_entrants) are left out; the team's accounts are kept;
--   * a sale's day is the Paris day of its first payment (paid_at); a sale never paid is not sent;
--   * units = pieces: no welcome GIFT, no piece won at 0 in THE VAULT, no add-on; an exchanged piece counts once (its
--     EXCHANGE order); a cancelled piece doesn't count; a returned piece stays sold and is also counted as returned;
--   * revenue = invoice lines except SHIPPING, after credits, no VAT (the tool has none); the documents of an exchanged
--     piece and of a piece cancelled after payment cancel each other and are left out; refunds = the credit notes left;
--   * amounts stay in minor units of the sale's currency: the app converts them with the owner's Margin rates (sent too);
--   * the account's email is read (the owner's choice, 31 Oct 2026: customers are linked by email with Shopify); no
--     name, address, phone, engraving, note or tracking number is. Account and order ids leave this query only to be
--     replaced on the Mac by keyed fingerprints (HMAC) before anything is sent.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL enable_nestloop = off;
-- Never during a LIVE release: stop here if one is open (or about to open).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM drops d
     WHERE d.mode = 'LIVE' AND d.published_at IS NOT NULL AND d.ended_at IS NULL
       AND now() >= d.opens_at - make_interval(mins => coalesce(d.room_opens_minutes, 0)::int + 15)
       AND now() < d.closes_at + interval '15 minutes'
  ) THEN
    RAISE EXCEPTION 'ORBES-SYNC-LIVE: a LIVE release is open: try again once it has ended';
  END IF;
END
$$;
WITH RECURSIVE
sale_of (order_id, sale_id) AS (
  SELECT o.id, coalesce(o.with_order_id, o.id) FROM orders o WHERE o.channel <> 'EXCHANGE'
  UNION ALL
  SELECT x.id, s.sale_id FROM orders x JOIN sale_of s ON s.order_id = x.exchange_of_order_id WHERE x.channel = 'EXCHANGE'
),
counted AS (
  SELECT o.id, o.account_id, o.channel, o.status, o.model_id, o.price_minor, o.currency, o.buyer_country,
         o.reserved_at, o.paid_at, o.returned_at, s.sale_id,
         EXISTS (SELECT 1 FROM orders x WHERE x.exchange_of_order_id = o.id) AS exchanged,
         (o.channel = 'VAULT' AND coalesce(o.price_minor, 0) = 0) AS vault_won
    FROM orders o JOIN sale_of s ON s.order_id = o.id
   WHERE NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = o.account_id)
),
docs AS (
  SELECT c.sale_id, i.kind, i.currency, i.issued_at, l.value->>'kind' AS line_kind, (l.value->>'amountMinor')::bigint AS amount_minor
    FROM counted c
    JOIN invoices i ON i.order_id = c.id
    CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(value)
   WHERE NOT c.exchanged AND c.status <> 'CANCELLED'
),
money AS (
  SELECT sale_id,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'INVOICE' AND line_kind <> 'SHIPPING'), 0)     AS revenue_minor,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'INVOICE' AND line_kind = 'CREDIT'), 0)       AS credits_minor,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'INVOICE' AND line_kind = 'SHIPPING'), 0)     AS shipping_minor,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'CREDIT_NOTE' AND line_kind <> 'SHIPPING'), 0) AS refunded_minor,
         max(issued_at) FILTER (WHERE kind = 'CREDIT_NOTE')                                            AS last_refund_at,
         string_agg(DISTINCT currency, ',' ORDER BY currency)                                         AS doc_currencies
    FROM docs GROUP BY sale_id
),
credit_kinds AS (
  SELECT c.sale_id, array_agg(DISTINCT CASE WHEN vg.id IS NOT NULL THEN 'VAULT_GIFT' ELSE g.kind END) AS kinds
    FROM counted c
    JOIN credit_uses u ON u.order_id = c.id AND u.released_at IS NULL
    JOIN tier_grants g ON g.id = u.grant_id
    LEFT JOIN vault_gifts vg ON vg.grant_id = g.id
   WHERE NOT c.exchanged
   GROUP BY c.sale_id
),
pieces AS (
  SELECT c.sale_id,
         count(*) FILTER (WHERE c.channel <> 'GIFT' AND NOT c.exchanged AND NOT c.vault_won AND c.status <> 'CANCELLED') AS units,
         count(*) FILTER (WHERE c.channel <> 'GIFT' AND NOT c.exchanged AND NOT c.vault_won AND c.status = 'RETURNED')  AS units_returned,
         count(*) FILTER (WHERE c.channel = 'GIFT' AND c.status <> 'CANCELLED')                                          AS gift_units,
         count(*) FILTER (WHERE c.vault_won AND c.status <> 'CANCELLED')                                                 AS vault_won_units,
         count(*) FILTER (WHERE c.channel = 'EXCHANGE')                                                                  AS exchanges,
         coalesce(bool_and(c.status = 'CANCELLED') FILTER (WHERE c.channel <> 'GIFT'), false)                            AS all_cancelled,
         min(c.paid_at) FILTER (WHERE c.channel <> 'GIFT')                                                               AS first_paid_at,
         max(c.returned_at) FILTER (WHERE c.channel <> 'GIFT' AND NOT c.exchanged AND c.status = 'RETURNED')             AS last_returned_at
    FROM counted c GROUP BY c.sale_id
),
per_model AS (
  SELECT c.sale_id, coalesce(m.variant_of, m.id)::text AS main_model_id, count(*) AS n
    FROM counted c JOIN models m ON m.id = c.model_id
   WHERE c.channel <> 'GIFT' AND NOT c.exchanged AND NOT c.vault_won AND c.status <> 'CANCELLED'
   GROUP BY 1, 2
),
products AS (
  SELECT sale_id, jsonb_object_agg(main_model_id, n) AS units_by_main_model FROM per_model GROUP BY sale_id
),
sales AS (
  SELECT r.id, r.account_id, coalesce(a.email_normalized, lower(trim(a.email))) AS email, r.channel, r.currency, r.buyer_country, r.reserved_at,
         p.first_paid_at, p.last_returned_at, p.units, p.units_returned, p.gift_units, p.vault_won_units, p.exchanges,
         CASE WHEN p.all_cancelled THEN 'cancelled'
              WHEN coalesce(m.revenue_minor, 0) = 0 THEN 'free'
              ELSE 'paid' END AS status,
         coalesce(m.revenue_minor, 0) AS revenue_minor, coalesce(m.credits_minor, 0) AS credits_minor,
         coalesce(m.shipping_minor, 0) AS shipping_minor, coalesce(m.refunded_minor, 0) AS refunded_minor,
         m.last_refund_at, m.doc_currencies,
         coalesce(pr.units_by_main_model, '{}'::jsonb) AS units_by_main_model,
         coalesce(k.kinds, ARRAY[]::text[]) AS credit_kinds
    FROM counted r
    JOIN pieces p ON p.sale_id = r.id
    LEFT JOIN accounts a ON a.id = r.account_id
    LEFT JOIN money m ON m.sale_id = r.id
    LEFT JOIN products pr ON pr.sale_id = r.id
    LEFT JOIN credit_kinds k ON k.sale_id = r.id
   WHERE r.id = r.sale_id AND p.first_paid_at IS NOT NULL
),
ranked AS (
  -- a customer's order number among their paid sales of at least one piece (1 = their first ever), whole history
  SELECT s.*,
         CASE WHEN s.status = 'paid' AND s.units > 0
              THEN count(*) FILTER (WHERE s.status = 'paid' AND s.units > 0)
                     OVER (PARTITION BY s.account_id ORDER BY s.first_paid_at, s.id ROWS UNBOUNDED PRECEDING)
         END AS customer_rank
    FROM sales s
),
sent AS (
  SELECT s.*, src.kind AS source_kind, l.code AS link_code, l.name AS link_name, lc.name AS link_channel,
         (SELECT array_agg(acp.platform ORDER BY acp.platform) FROM ads_channel_platforms acp WHERE acp.channel_id = l.channel_id) AS platforms,
         src.utm_source, src.utm_medium, src.utm_campaign, src.utm_content, src.utm_term, src.site
    FROM ranked s
    LEFT JOIN acquisition_conversions ac ON ac.kind = 'ORDER' AND ac.ref_id = s.id
    LEFT JOIN acquisition_sources src ON src.id = ac.last_source_id
    LEFT JOIN links l ON l.id = src.link_id
    LEFT JOIN link_channels lc ON lc.id = l.channel_id
   WHERE s.first_paid_at >= ('__SINCE__'::date::timestamp AT TIME ZONE 'Europe/Paris')
)
SELECT 'ORBES-SYNC-JSON:' || json_build_object(
  'format', 'orbes-console/2',
  'since', '__SINCE__',
  'dbNow', now(),
  'rates', (SELECT coalesce(json_agg(json_build_object('currency', r.currency, 'eurRate', r.eur_rate) ORDER BY r.currency), '[]'::json) FROM currency_rates r),
  -- stock per main model: in hand (the stock journal's sum), held for orders (STOCK) and awaited (AWAITING pre-orders),
  -- and in hand at the end of each Paris month from the first day sent (add-ons left out)
  'stock', json_build_object(
    'asOf', now(),
    'now', (
      WITH moved AS (
        SELECT coalesce(m.variant_of, m.id) AS main_id, sum(sm.delta)::int AS on_hand
          FROM stock_movements sm JOIN skus k ON k.id = sm.sku_id JOIN models m ON m.id = k.model_id
         GROUP BY 1),
      held AS (
        SELECT coalesce(m.variant_of, m.id) AS main_id,
               count(*) FILTER (WHERE h.reservation = 'STOCK')::int AS reserved,
               count(*) FILTER (WHERE h.reservation = 'AWAITING')::int AS awaiting
          FROM stock_holds h JOIN skus k ON k.id = h.sku_id JOIN models m ON m.id = k.model_id
         GROUP BY 1),
      owed AS (
        -- what sent supplier orders still owe (as the console's own proposal counts it)
        SELECT coalesce(m.variant_of, m.id) AS main_id,
               sum(greatest(0, l.quantity - l.accepted_quantity - l.credited_quantity - l.rest_cancelled_quantity))::int AS expected
          FROM supplier_order_lines l JOIN supplier_orders o ON o.id = l.supplier_order_id
          JOIN skus k ON k.id = l.sku_id JOIN models m ON m.id = k.model_id
         WHERE o.status IN ('SENT', 'EXPECTED', 'PARTLY_RECEIVED')
         GROUP BY 1),
      ids AS (SELECT main_id FROM moved UNION SELECT main_id FROM held UNION SELECT main_id FROM owed)
      SELECT coalesce(json_agg(json_build_object('id', i.main_id, 'onHand', coalesce(mv.on_hand, 0), 'reserved', coalesce(h.reserved, 0),
               'awaiting', coalesce(h.awaiting, 0), 'expected', coalesce(ow.expected, 0)) ORDER BY i.main_id), '[]'::json)
        FROM ids i LEFT JOIN moved mv ON mv.main_id = i.main_id LEFT JOIN held h ON h.main_id = i.main_id LEFT JOIN owed ow ON ow.main_id = i.main_id),
    'monthEnds', (
      WITH d AS (
        SELECT date_trunc('month', sm.created_at AT TIME ZONE 'Europe/Paris')::date AS month, coalesce(m.variant_of, m.id) AS main_id, sum(sm.delta)::int AS delta
          FROM stock_movements sm JOIN skus k ON k.id = sm.sku_id JOIN models m ON m.id = k.model_id
         GROUP BY 1, 2),
      span AS (SELECT main_id, min(month) AS first FROM d GROUP BY 1),
      months AS (
        SELECT s.main_id, g::date AS month
          FROM span s, generate_series(s.first, date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') g),
      run AS (
        SELECT mo.main_id, mo.month, (sum(coalesce(d.delta, 0)) OVER (PARTITION BY mo.main_id ORDER BY mo.month))::int AS on_hand
          FROM months mo LEFT JOIN d ON d.main_id = mo.main_id AND d.month = mo.month)
      SELECT coalesce(json_agg(json_build_object('month', to_char(month, 'YYYY-MM'), 'id', main_id, 'onHand', on_hand) ORDER BY month, main_id), '[]'::json)
        FROM run WHERE month >= date_trunc('month', '__SINCE__'::date)::date)
  ),
  'models', (
    SELECT coalesce(json_agg(json_build_object(
             'id', m.id, 'name', m.name, 'type', m.type, 'sizeType', m.size_type, 'category', c.code, 'categoryName', c.name,
             'vaultOnly', m.vault_only, 'active', m.active, 'basePriceMinor', m.base_price_minor, 'baseCurrency', m.base_currency,
             'variants', (SELECT count(*) FROM models v WHERE v.variant_of = m.id))
           ORDER BY c.code, m.name, m.id), '[]'::json)
      FROM models m JOIN categories c ON c.id = m.category_id
     WHERE m.variant_of IS NULL),
  'sales', (
    SELECT coalesce(json_agg(json_build_object(
             'order', s.id, 'account', s.account_id, 'email', s.email,
             'day', to_char(s.first_paid_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             'reservedDay', to_char(s.reserved_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             'channel', s.channel, 'status', s.status, 'currency', s.currency, 'docCurrencies', s.doc_currencies,
             'country', s.buyer_country,
             'units', s.units, 'unitsReturned', s.units_returned, 'giftUnits', s.gift_units, 'vaultWonUnits', s.vault_won_units,
             'exchanges', s.exchanges, 'models', s.units_by_main_model,
             'revenueMinor', s.revenue_minor, 'creditsMinor', s.credits_minor, 'shippingMinor', s.shipping_minor,
             'refundedMinor', s.refunded_minor,
             'refundedDay', to_char(s.last_refund_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             'returnedDay', to_char(s.last_returned_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
             'creditKinds', s.credit_kinds, 'customerRank', s.customer_rank,
             'source', CASE WHEN s.source_kind IS NULL THEN NULL ELSE json_build_object(
               'kind', s.source_kind, 'link', s.link_code, 'linkName', s.link_name, 'channel', s.link_channel,
               'platforms', s.platforms, 'utmSource', s.utm_source, 'utmMedium', s.utm_medium, 'utmCampaign', s.utm_campaign,
               'utmContent', s.utm_content, 'utmTerm', s.utm_term, 'site', s.site) END)
           ORDER BY s.first_paid_at, s.id), '[]'::json)
      FROM sent s)
)::text AS out;
ROLLBACK;
`;
