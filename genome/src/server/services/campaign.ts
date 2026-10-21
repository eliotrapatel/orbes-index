/**
 * The CAMPAIGN tab of a release (plan MACRO M1 §2.1, scope C2), for draws and LIVE RELEASES alike: its tracked links, one
 * per channel made in one click, and what each brought in. `ctx.services.campaign`; routes/admin/drops.ts.
 *
 *   campaign   GET /api/admin/releases/:id/campaign (AUDITOR): the release; the channels in their order (LinkService),
 *              each with the release's links in it (`links.drop_id`, the newest first, archived ones included: they
 *              keep redirecting and counting); the channels still without an active link to it; the readout. Read in one
 *              REPEATABLE READ, READ ONLY transaction, as GROWTH and the Links page read.
 *   makeLinks  POST /api/admin/releases/:id/campaign/links (OPERATOR, the scope's C2 default « one link per channel made in
 *              one click »): for each channel without an active link to the release, one link through LinkService.create
 *              (its LINK source with it, audited `link.create` by LinkService), all in one transaction under the release's
 *              advisory lock (ADVISORY_LOCK.RELEASE_CAMPAIGN), so two clicks at once make each link once; a second click
 *              makes none. Each link goes to the release's page (destination RELEASE), is named `<release title> ·
 *              <channel>` (cut to LINK_NAME_MAX), has no cost (set on the link's own page afterwards, as today) and an
 *              address from the release's opening day in Paris and the channel, `release-5-nov-instagram`, with `-2`,
 *              `-3`… when taken (src/shared/link-code.ts): never the release's title, which may name the piece before
 *              it is public (the house's public-facing rule). The click is audited `drop.campaign.links` with the count
 *              and the codes; one that makes none is not audited. Refused: a DRAFT (409 CAMPAIGN_NOT_PUBLISHED: a link
 *              goes to a published release only), a cancelled release (409 CAMPAIGN_CANCELLED).
 *
 * The readout (scope C2: « after the release, the readout per link: entries, buyers, revenue, and cost and return where
 * the link has a cost »), under the LAST-LINK attribution (plan §11 note 4): each entry and each order is credited to
 * its conversion's `last_source_id` (acquisition_conversions, written by the conversions job within minutes), as the
 * Links page's LAST LINK and GROWTH's per-order attribution read it; first-link is not shown.
 *
 *   - entries   the release's draw entries or LIVE entries, whatever became of them (as the Links page counts them);
 *   - buyers    the accounts with an order of the release (or of its after-room, whose guests come from its line) paid,
 *               not GIFT, not CANCELLED or RETURNED (GROWTH's purchase); each buyer once, on the last link of its first
 *               such order (by payment), so the rows add up to the buyers;
 *   - revenue   every invoice less every credit note of the orders of the release (and of its after-room), in the
 *               release's currency (its price's; else growth.ts currenciesOf's, the console's one default), never
 *               converted: a returned order nets to zero, a size exchange's invoice counts on its original's link;
 *   - cost and return: the link's cost, and revenue ÷ cost (two decimals; null for a cost of 0), only when its cost is
 *               in the readout's currency.
 *
 * Rows: each of the release's links (archived ones included), in the channels' order then the newest first; then OTHER
 * SOURCES, every entry, buyer and revenue whose last link is not one of them (another link, campaign tags, a referring
 * site, Direct, Before tracking, the console's device, or no conversion written yet); then the TOTAL, which the rows
 * add up to exactly. Counted collectors only (population.ts countedCollector: no test entrant, no team account, no
 * DELETED account). The stage: UPCOMING before the release opens to its first entry (a draw's early access, else its
 * opening; a LIVE RELEASE's room), SO_FAR from then, FINAL once it has ended (a draw drawn, a LIVE RELEASE over) or was
 * cancelled. An after-room has no campaign of its own (404 DROP_NOT_FOUND): its sales are its release's.
 *
 * Revenue is read from the release's orders and invoices, never from a payment record: an order of the release paid
 * through a future Shopify checkout and invoiced by the platform counts the same (scope S1, S2).
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { HOUSE_CURRENCIES, type DropMode, type HouseCurrency } from '../db/schema.js';
import { conflict } from '../errors.js';
import { freeCode, suggestCode } from '../../shared/link-code.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { LinkReturn } from './acquisition-report.js';
import type { AuditService } from './audit.js';
import { dropNotFound, earlyAccessOpensAt } from './drops.js';
import { currenciesOf } from './growth.js';
import { LINK_NAME_MAX, type LinkService, type LinkView } from './links.js';
import { livePhase, roomOpensAt } from './live.js';
import { countedCollector } from './population.js';
import { PARIS_TIME_ZONE } from './schedule.js';

/** Where a release's readout stands. */
export const CAMPAIGN_STAGES = ['UPCOMING', 'SO_FAR', 'FINAL'] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

/** What a row brought in. */
export interface CampaignFigures {
  entries: number;
  buyers: number;
  revenueMinor: number;
}

/** One of the release's links in the readout. */
export interface CampaignLinkRow {
  link: LinkView;
  figures: CampaignFigures;
  /** Revenue ÷ cost when the link's cost is in the readout's currency; null otherwise (no cost, another currency). */
  returns: LinkReturn | null;
}

export interface CampaignReadout {
  stage: CampaignStage;
  /** When the release opens to its first entry (see the header). */
  opensAt: Date;
  currency: HouseCurrency;
  links: CampaignLinkRow[];
  /** OTHER SOURCES: whatever no link of the release brought in. */
  other: CampaignFigures;
  /** The rows added up. */
  total: CampaignFigures;
}

/** A channel of the console, with the release's links in it. */
export interface CampaignChannel {
  id: string;
  name: string;
  position: number;
  /** The release's links in this channel, the newest first, archived ones included. */
  links: LinkView[];
  /** Whether one of them is active (not archived): MAKE THE LINKS leaves this channel alone. */
  covered: boolean;
}

export interface ReleaseCampaign {
  release: { id: string; mode: DropMode; title: string; opensAt: Date; closesAt: Date; published: boolean; cancelled: boolean };
  channels: CampaignChannel[];
  /** The channels still without an active link to the release, in their order. */
  missing: { id: string; name: string }[];
  readout: CampaignReadout;
}

export interface CampaignServiceDeps {
  db: Db;
  audit: AuditService;
  links: LinkService;
  clock?: Clock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notPublished = () => conflict('CAMPAIGN_NOT_PUBLISHED', 'Publish the release before making its links.');
const cancelledRelease = () => conflict('CAMPAIGN_CANCELLED', 'A cancelled release takes no new link.');
const zero = (): CampaignFigures => ({ entries: 0, buyers: 0, revenueMinor: 0 });
const ratio = (revenue: number, cost: number): number | null => (cost > 0 ? Math.round((revenue / cost) * 100) / 100 : null);

/** The release's opening day in Paris, for its links' addresses: `5 nov` → `release-5-nov-<channel>`. */
export function campaignDay(opensAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS_TIME_ZONE, day: 'numeric', month: 'short' }).formatToParts(opensAt);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}`;
}

/** A campaign link's name: `<title> · <channel>`, the title cut (with …) so that it holds LINK_NAME_MAX. */
export function campaignLinkName(title: string, channel: string): string {
  const tail = ` · ${channel}`;
  const room = LINK_NAME_MAX - tail.length;
  const t = title.trim();
  return `${t.length > room ? `${t.slice(0, Math.max(1, room - 1)).trimEnd()}…` : t}${tail}`;
}

/** A campaign link's suggested address, before `-2`, `-3`…: the release's opening day in Paris and the channel. */
export function campaignCodeBase(opensAt: Date, channel: string): string {
  const base = suggestCode(`release ${campaignDay(opensAt)} ${channel}`);
  return base.length >= 3 ? base : suggestCode(`release ${campaignDay(opensAt)}`);
}

interface ReleaseRow {
  id: string;
  mode: DropMode;
  title: string;
  opens_at: Date;
  closes_at: Date;
  published_at: Date | null;
  cancelled_at: Date | null;
  drawn_at: Date | null;
  ended_at: Date | null;
  announce_at: Date | null;
  room_opens_minutes: number | null;
  early_access_hours: number;
  early_access_platine_hours: number | null;
  parent_drop_id: string | null;
  currency: string | null;
}

export class CampaignService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly links: LinkService;
  private readonly clock: Clock;

  constructor(deps: CampaignServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.links = deps.links;
    this.clock = deps.clock ?? systemClock;
  }

  /** The release's campaign (see the header); 404 DROP_NOT_FOUND for an unknown id or an after-room. */
  async campaign(dropId: string): Promise<ReleaseCampaign> {
    const id = this.idOf(dropId);
    return this.readOnly(async (tx) => {
      const d = await this.release(tx, id);
      const channels = await this.links.channels(tx);
      const mine = (await this.links.list({ archived: true }, tx)).filter((l) => l.destination === 'RELEASE' && l.dropId === id);
      const grouped: CampaignChannel[] = channels.map((c) => {
        const links = mine.filter((l) => l.channel.id === c.id);
        return { id: c.id, name: c.name, position: c.position, links, covered: links.some((l) => l.archivedAt === null) };
      });
      return {
        release: { id: d.id, mode: d.mode, title: d.title, opensAt: d.opens_at, closesAt: d.closes_at, published: d.published_at !== null, cancelled: d.cancelled_at !== null },
        channels: grouped,
        missing: grouped.filter((c) => !c.covered).map((c) => ({ id: c.id, name: c.name })),
        readout: await this.readout(tx, d, grouped.flatMap((c) => c.links)),
      };
    });
  }

  /** MAKE THE LINKS (see the header): the links made, then the campaign as it now reads. */
  async makeLinks(dropId: string, actor: Actor): Promise<{ made: LinkView[]; campaign: ReleaseCampaign }> {
    const id = this.idOf(dropId);
    const made = await inTransaction(this.db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.RELEASE_CAMPAIGN, Number.parseInt(id.replace(/-/g, '').slice(0, 8), 16) | 0);
      const d = await this.release(tx, id);
      if (d.published_at === null) throw notPublished();
      if (d.cancelled_at !== null) throw cancelledRelease();
      const channels = await this.links.channels(tx);
      const active = await tx.selectFrom('links').select('channel_id').where('drop_id', '=', id).where('destination', '=', 'RELEASE').where('archived_at', 'is', null).execute();
      const covered = new Set(active.map((l) => l.channel_id));
      const out: LinkView[] = [];
      for (const c of channels) {
        if (covered.has(c.id)) continue;
        const base = campaignCodeBase(d.opens_at, c.name);
        const taken = new Set((await tx.selectFrom('links').select('code').where('code', 'like', `${base.slice(0, 26)}%`).execute()).map((r) => r.code));
        const code = freeCode(base, (x) => taken.has(x));
        out.push(await this.links.create({ name: campaignLinkName(d.title, c.name), channelId: c.id, destination: 'RELEASE', dropId: id, code }, actor, tx));
      }
      if (out.length > 0) {
        await this.audit.record(
          { actor, action: 'drop.campaign.links', targetType: 'drop', targetId: id, details: { dropId: id, count: out.length, codes: out.map((l) => l.code) } },
          tx,
        );
      }
      return out;
    });
    return { made, campaign: await this.campaign(id) };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async release(tx: Db, id: string): Promise<ReleaseRow> {
    const d = await tx
      .selectFrom('drops')
      .select([
        'id',
        'mode',
        'title',
        'opens_at',
        'closes_at',
        'published_at',
        'cancelled_at',
        'drawn_at',
        'ended_at',
        'announce_at',
        'room_opens_minutes',
        'early_access_hours',
        'early_access_platine_hours',
        'parent_drop_id',
        'currency',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!d || d.parent_drop_id !== null) throw dropNotFound();
    return d as ReleaseRow;
  }

  /** The readout (see the header), over the release's links `links`. */
  private async readout(tx: Db, d: ReleaseRow, links: LinkView[]): Promise<CampaignReadout> {
    const now = this.clock();
    const known = (c: string | null): c is HouseCurrency => c !== null && (HOUSE_CURRENCIES as readonly string[]).includes(c);
    const currency = known(d.currency) ? d.currency : (await currenciesOf(tx, undefined)).currency;
    const live = d.mode === 'LIVE';
    const opensAt = live ? roomOpensAt(d) : (earlyAccessOpensAt(d) ?? d.opens_at);
    const ended = d.cancelled_at !== null || (live ? livePhase(d, now) === 'ENDED' : d.drawn_at !== null);
    const stage: CampaignStage = ended ? 'FINAL' : now.getTime() >= opensAt.getTime() ? 'SO_FAR' : 'UPCOMING';

    // The release's orders: its own and its after-room's.
    const orders = sql`o.drop_id IN (SELECT r.id FROM drops r WHERE r.id = ${d.id}::uuid OR r.parent_drop_id = ${d.id}::uuid)`;
    const lastLink = (kind: string, ref: string) =>
      sql`LEFT JOIN acquisition_conversions c ON c.kind = ${kind} AND c.ref_id = ${sql.ref(ref)} LEFT JOIN acquisition_sources k ON k.id = c.last_source_id`;
    const entryTable = live ? sql`live_entries` : sql`drop_entries`;
    // One after the other: a transaction is one connection.
    const entries = await sql<{ link_id: string | null; n: number }>`
        SELECT k.link_id, count(*)::int AS n
          FROM ${entryTable} e ${lastLink(live ? 'LIVE_ENTRY' : 'DRAW_ENTRY', 'e.id')}
         WHERE e.drop_id = ${d.id}::uuid AND ${countedCollector('e.account_id')}
         GROUP BY k.link_id`.execute(tx);
    const buyers = await sql<{ link_id: string | null; n: number }>`
        SELECT b.link_id, count(*)::int AS n FROM (
          SELECT DISTINCT ON (o.account_id) o.account_id, k.link_id
            FROM orders o ${lastLink('ORDER', 'o.id')}
           WHERE ${orders} AND o.paid_at IS NOT NULL AND o.channel <> 'GIFT' AND o.status NOT IN ('CANCELLED', 'RETURNED')
             AND ${countedCollector('o.account_id')}
           ORDER BY o.account_id, o.paid_at, o.id) b
         GROUP BY b.link_id`.execute(tx);
    const revenue = await sql<{ link_id: string | null; amount: number }>`
        SELECT k.link_id, sum(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint AS amount
          FROM invoices i JOIN orders o ON o.id = i.order_id ${lastLink('ORDER', 'o.id')}
         WHERE ${orders} AND o.channel <> 'GIFT' AND i.currency = ${currency} AND ${countedCollector('o.account_id')}
         GROUP BY k.link_id`.execute(tx);

    const ours = new Set(links.map((l) => l.id));
    const by = new Map<string, CampaignFigures>();
    const other = zero();
    const row = (linkId: string | null): CampaignFigures => {
      if (linkId === null || !ours.has(linkId)) return other;
      let f = by.get(linkId);
      if (!f) by.set(linkId, (f = zero()));
      return f;
    };
    for (const r of entries.rows) row(r.link_id).entries += Number(r.n);
    for (const r of buyers.rows) row(r.link_id).buyers += Number(r.n);
    for (const r of revenue.rows) row(r.link_id).revenueMinor += Number(r.amount);

    const rows: CampaignLinkRow[] = links.map((link) => {
      const figures = by.get(link.id) ?? zero();
      const returns =
        link.cost && link.cost.currency === currency
          ? { revenueMinor: figures.revenueMinor, costMinor: link.cost.minor, currency, ratio: ratio(figures.revenueMinor, link.cost.minor) }
          : null;
      return { link, figures, returns };
    });
    const total = [...rows.map((r) => r.figures), other].reduce(
      (t, f) => ({ entries: t.entries + f.entries, buyers: t.buyers + f.buyers, revenueMinor: t.revenueMinor + f.revenueMinor }),
      zero(),
    );
    return { stage, opensAt, currency, links: rows, other, total };
  }

  private idOf(id: unknown): string {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw dropNotFound();
    return id.toLowerCase();
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: the readout's figures all see one moment. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      return fn(tx);
    });
  }
}
