/**
 * The console's links (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.3, A.7.1 `LinkService`, A.11; migration 0043
 * `links`, `link_channels`; step 4.3): a short ORBES address, `verify.theorbes.com/go/<code>`, that staff paste in a bio,
 * a story or an influencer's brief, grouped by channel, with where it leads in the app and what it cost.
 *
 *   channels      the channels in their order, each with how many links name it (archived ones included).
 *   createChannel / updateChannel / deleteChannel   a name once whatever its case (409 CHANNEL_NAME_TAKEN), an order
 *                 0 to 999; removed only while no link names it (409 CHANNEL_IN_USE). Audited `link_channel.create`,
 *                 `.update` (what changed, before and after), `.delete`.
 *   list / get    the links, the archived ones only when asked, each with its addresses: the short one and the direct
 *                 one « for places that refuse a redirect » (A.3), which counts the same.
 *   create        a name, a channel, a destination (a release that exists and is published, a model that is active,
 *                 or a page of the app), an address (by default the name's suggestion, `-2`, `-3`… when taken: the
 *                 console's own rule, src/shared/link-code.ts), an optional cost in one of the house's currencies and a
 *                 note. The link and its LINK source in one transaction; two staff taking one address at once: the
 *                 unique index decides, 409 LINK_CODE_TAKEN. Audited `link.create`.
 *   update        its name, channel, destination, cost and note; never its address (400: « A link’s address never
 *                 changes. Make a new link. »), so a posted link never breaks. Audited `link.update` with the changed
 *                 fields only, before and after; nothing changed, nothing audited.
 *   archive / unarchive  it leaves the list's default view, or comes back; an archived link keeps redirecting and
 *                 counting. Audited `link.archive`, `link.unarchive`.
 *   resolve       `GET /go/<code>`'s destination, read at each request (a model's current slug, so a renamed sheet never
 *                 breaks a link): `/verify/releases/<id>`, `/verify/lookbook/<slug>`, `/verify`, `/verify/releases`,
 *                 `/verify/lookbook`, `/verify/club`, `/verify/releases/how`; null for an unknown code. One read by the
 *                 unique index, no write: a visit is counted by the app's arrival, never here (preview robots fetch
 *                 links too).
 *   destinations  what the dialog offers: the published releases (DRAW or LIVE, not cancelled), the latest 50 by their
 *                 opening, and the active models, main models and variants, by name.
 *
 * Only ORBES pages are ever destinations: `/go` is no open redirect.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { HOUSE_CURRENCIES, LINK_DESTINATIONS, type HouseCurrency, type LinkDestination } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { freeCode, LINK_CODE_RE, suggestCode } from '../../shared/link-code.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';

/** A link's name, at most. */
export const LINK_NAME_MAX = 80;
/** A channel's name, at most. */
export const CHANNEL_NAME_MAX = 40;
/** A link's note, at most. */
export const LINK_NOTE_MAX = 500;
/** A cost's ceiling, in minor units (migration 0043 `links_cost_minor_check`). */
export const LINK_COST_MAX = 100_000_000_000;
/** The releases the dialog offers, at most. */
export const DESTINATION_RELEASES = 50;

/** Where each destination of the app leads, but a release's and a model's own pages. */
const PAGE_PATHS: Readonly<Record<Exclude<LinkDestination, 'RELEASE' | 'MODEL'>, string>> = {
  NOW: '/verify',
  RELEASES: '/verify/releases',
  COLLECTION: '/verify/lookbook',
  CLUB: '/verify/club',
  HOW: '/verify/releases/how',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A channel as the console reads it. */
export interface ChannelView {
  id: string;
  name: string;
  position: number;
  /** The links that name it, archived ones included. */
  links: number;
}

/** A link as the console reads it. */
export interface LinkView {
  id: string;
  code: string;
  name: string;
  channel: { id: string; name: string };
  destination: LinkDestination;
  dropId: string | null;
  modelId: string | null;
  cost: { minor: number; currency: HouseCurrency } | null;
  note: string | null;
  /** The short address, `https://verify.theorbes.com/go/<code>`. */
  address: string;
  /** The direct address « for places that refuse a redirect », the destination with `?o=<code>`; it counts the same. */
  directAddress: string;
  archivedAt: Date | null;
  createdBy: { id: string; email: string };
  createdAt: Date;
  updatedAt: Date;
}

/** What the New link dialog offers (§3.4 A.10.2). */
export interface LinkDestinations {
  releases: { id: string; title: string; mode: 'DRAW' | 'LIVE'; opensAt: Date; model: string }[];
  models: { id: string; name: string; variantLabel: string | null; variantOf: string | null; slug: string | null }[];
}

export interface LinkInput {
  name: unknown;
  channelId: unknown;
  destination: unknown;
  dropId?: unknown;
  modelId?: unknown;
  code?: unknown;
  cost?: unknown;
  note?: unknown;
}

export type LinkPatch = Partial<LinkInput>;

export interface ChannelInput {
  name?: unknown;
  position?: unknown;
}

export interface LinkServiceDeps {
  db: Db;
  audit: AuditService;
  /** The app's own origin (config.publicOrigin): the links' addresses are built on it. */
  publicOrigin: string;
  clock?: Clock;
}

// ── Refusals, in the console's words (§3.4 A.7.2) ─────────────────────────────────────────────────────────────────

const linkNotFound = () => notFound('Link', 'LINK_NOT_FOUND');
const channelNotFound = () => notFound('Channel', 'CHANNEL_NOT_FOUND');
const codeTaken = () => conflict('LINK_CODE_TAKEN', 'Another link already uses this address.');
const channelNameTaken = () => conflict('CHANNEL_NAME_TAKEN', 'Another channel has this name.');
const channelInUse = () => conflict('CHANNEL_IN_USE', 'Links use this channel: move them to another first.');
const noName = () => validationError('Give the link a name.');
const badCode = () => validationError('The address is 3 to 32 letters, figures or dashes, in lower case.');
const noDestination = () => validationError('Choose where the link goes.');
const badCost = () => validationError('The cost is an amount with cents, in one currency.');
const codeFixed = () => validationError('A link’s address never changes. Make a new link.');

/** The console user acting, or null (a script). */
const adminIdOf = (actor: Actor): string | null => (actor.type === 'admin' && typeof actor.id === 'string' ? actor.id : null);

/** A name trimmed, or null when it is empty or not text. */
const trimmed = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/** The columns a link's row reads into a view. */
interface LinkRowJoined {
  id: string;
  code: string;
  name: string;
  channel_id: string;
  channel_name: string;
  destination: LinkDestination;
  drop_id: string | null;
  model_id: string | null;
  model_slug: string | null;
  cost_minor: number | null;
  cost_currency: HouseCurrency | null;
  note: string | null;
  archived_at: Date | null;
  created_by: string;
  created_by_email: string;
  created_at: Date;
  updated_at: Date;
}

/** The path a destination leads to (a model with no address yet: THE COLLECTION). */
export function destinationPath(destination: LinkDestination, dropId: string | null, modelSlug: string | null): string {
  if (destination === 'RELEASE') return dropId ? `/verify/releases/${dropId}` : PAGE_PATHS.RELEASES;
  if (destination === 'MODEL') return modelSlug ? `/verify/lookbook/${modelSlug}` : PAGE_PATHS.COLLECTION;
  return PAGE_PATHS[destination];
}

export class LinkService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private readonly origin: string;

  constructor(deps: LinkServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.origin = deps.publicOrigin.replace(/\/+$/, '');
  }

  // ── Channels ────────────────────────────────────────────────────────────

  /** The channels in their order, each with its links. */
  async channels(db: Db = this.db): Promise<ChannelView[]> {
    const rows = await db
      .selectFrom('link_channels as c')
      .select(['c.id', 'c.name', 'c.position', (eb) => eb.selectFrom('links as l').select((e) => e.fn.countAll<number>().as('n')).whereRef('l.channel_id', '=', 'c.id').as('links')])
      .orderBy('c.position')
      .orderBy(sql`lower(c.name)`)
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, position: r.position, links: Number(r.links ?? 0) }));
  }

  /** Add a channel, last unless a position is given. */
  async createChannel(input: ChannelInput, actor: Actor): Promise<ChannelView> {
    const name = this.channelName(input?.name);
    const asked = input?.position === undefined ? undefined : this.position(input.position);
    try {
      const id = await inTransaction(this.db, async (tx) => {
        const last = await tx.selectFrom('link_channels').select((eb) => eb.fn.max('position').as('p')).executeTakeFirst();
        const position = asked ?? Math.min(999, Number(last?.p ?? 0) + 10);
        const row = await tx.insertInto('link_channels').values({ name, position, created_by: adminIdOf(actor), created_at: this.clock() }).returning('id').executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'link_channel.create', targetType: 'link_channel', targetId: row.id, details: { channelId: row.id, name, position } }, tx);
        return row.id;
      });
      return this.channel(id);
    } catch (e) {
      if (isUniqueViolation(e, 'link_channels_name_key')) throw channelNameTaken();
      throw e;
    }
  }

  /** Rename a channel or move it. Nothing changed, nothing audited. */
  async updateChannel(id: string, input: ChannelInput, actor: Actor): Promise<ChannelView> {
    const channelId = this.idOf(id, channelNotFound);
    const name = input?.name === undefined ? undefined : this.channelName(input.name);
    const position = input?.position === undefined ? undefined : this.position(input.position);
    try {
      await inTransaction(this.db, async (tx) => {
        const row = await tx.selectFrom('link_channels').select(['id', 'name', 'position']).where('id', '=', channelId).forUpdate().executeTakeFirst();
        if (!row) throw channelNotFound();
        const next = { name: name ?? row.name, position: position ?? row.position };
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const k of ['name', 'position'] as const) {
          if (next[k] !== row[k]) {
            before[k] = row[k];
            after[k] = next[k];
          }
        }
        if (Object.keys(after).length === 0) return;
        await tx.updateTable('link_channels').set(next).where('id', '=', channelId).execute();
        await this.audit.record({ actor, action: 'link_channel.update', targetType: 'link_channel', targetId: channelId, details: { channelId, before, after } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'link_channels_name_key')) throw channelNameTaken();
      throw e;
    }
    return this.channel(channelId);
  }

  /** Remove a channel no link names (archived ones included). */
  async deleteChannel(id: string, actor: Actor): Promise<void> {
    const channelId = this.idOf(id, channelNotFound);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('link_channels').select(['id', 'name']).where('id', '=', channelId).forUpdate().executeTakeFirst();
      if (!row) throw channelNotFound();
      const used = await tx.selectFrom('links').select('id').where('channel_id', '=', channelId).limit(1).executeTakeFirst();
      if (used) throw channelInUse();
      await tx.deleteFrom('link_channels').where('id', '=', channelId).execute();
      await this.audit.record({ actor, action: 'link_channel.delete', targetType: 'link_channel', targetId: channelId, details: { channelId, name: row.name } }, tx);
    });
  }

  private async channel(id: string): Promise<ChannelView> {
    const found = (await this.channels()).find((c) => c.id === id);
    if (!found) throw channelNotFound();
    return found;
  }

  private channelName(v: unknown): string {
    const name = trimmed(v);
    if (name === null) throw validationError('Give the channel a name.');
    if (name.length > CHANNEL_NAME_MAX) throw validationError(`A channel’s name is ${CHANNEL_NAME_MAX} characters at most.`);
    return name;
  }

  private position(v: unknown): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 999) throw validationError('A channel’s place is a whole number from 0 to 999.');
    return v;
  }

  // ── Links ───────────────────────────────────────────────────────────────

  /** The links, by channel and newest first; the archived ones only when asked. */
  async list(opts: { archived?: boolean } = {}, db: Db = this.db): Promise<LinkView[]> {
    let q = this.joined(db);
    if (!opts.archived) q = q.where('l.archived_at', 'is', null);
    const rows = await q.orderBy('c.position').orderBy(sql`lower(c.name)`).orderBy('l.created_at', 'desc').orderBy('l.id').execute();
    return rows.map((r) => this.view(r));
  }

  /** One link, archived or not; 404 LINK_NOT_FOUND. */
  async get(id: string, db: Db = this.db): Promise<LinkView> {
    const linkId = this.idOf(id, linkNotFound);
    const row = await this.joined(db).where('l.id', '=', linkId).executeTakeFirst();
    if (!row) throw linkNotFound();
    return this.view(row);
  }

  /** Make a link and its LINK source (see the header). */
  async create(input: LinkInput, actor: Actor): Promise<LinkView> {
    const name = this.linkName(input?.name);
    const note = this.note(input?.note);
    const cost = this.cost(input?.cost);
    const asked = input?.code === undefined || input.code === null ? null : this.code(input.code);
    const author = adminIdOf(actor);
    if (!author) throw validationError('A link is made by a console user.');
    try {
      const id = await inTransaction(this.db, async (tx) => {
        const channelId = await this.existingChannel(tx, input?.channelId);
        const target = await this.destination(tx, input?.destination, input?.dropId, input?.modelId);
        let code = asked;
        if (code === null) {
          const base = suggestCode(name);
          if (!LINK_CODE_RE.test(base)) throw badCode();
          const taken = new Set(
            (await tx.selectFrom('links').select('code').where('code', 'like', `${base.slice(0, 26).replace(/[\\%_]/g, (c) => `\\${c}`)}%`).execute()).map((r) => r.code),
          );
          code = freeCode(base, (c) => taken.has(c));
        }
        const now = this.clock();
        const row = await tx
          .insertInto('links')
          .values({
            code,
            name,
            channel_id: channelId,
            destination: target.destination,
            drop_id: target.dropId,
            model_id: target.modelId,
            cost_minor: cost?.minor ?? null,
            cost_currency: cost?.currency ?? null,
            note,
            created_by: author,
            created_at: now,
            updated_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx.insertInto('acquisition_sources').values({ kind: 'LINK', link_id: row.id, key: `L:${row.id}`, created_at: now }).execute();
        await this.audit.record(
          {
            actor,
            action: 'link.create',
            targetType: 'link',
            targetId: row.id,
            details: { linkId: row.id, code, name, channelId, destination: target.destination, dropId: target.dropId, modelId: target.modelId, cost },
          },
          tx,
        );
        return row.id;
      });
      return this.get(id);
    } catch (e) {
      if (isUniqueViolation(e, 'links_code_key')) throw codeTaken();
      throw e;
    }
  }

  /** Change a link's name, channel, destination, cost or note, never its address. */
  async update(id: string, patch: LinkPatch, actor: Actor): Promise<LinkView> {
    const linkId = this.idOf(id, linkNotFound);
    if (patch?.code !== undefined) throw codeFixed();
    const name = patch?.name === undefined ? undefined : this.linkName(patch.name);
    const note = patch?.note === undefined ? undefined : this.note(patch.note);
    const cost = patch?.cost === undefined ? undefined : this.cost(patch.cost);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('links').selectAll().where('id', '=', linkId).forUpdate().executeTakeFirst();
      if (!row) throw linkNotFound();
      const channelId = patch?.channelId === undefined ? row.channel_id : await this.existingChannel(tx, patch.channelId);
      const target =
        patch?.destination === undefined && patch?.dropId === undefined && patch?.modelId === undefined
          ? { destination: row.destination, dropId: row.drop_id, modelId: row.model_id }
          : await this.destination(tx, patch?.destination ?? row.destination, patch?.dropId, patch?.modelId);
      const prev = {
        name: row.name,
        channelId: row.channel_id,
        destination: row.destination,
        dropId: row.drop_id,
        modelId: row.model_id,
        cost: row.cost_minor === null || row.cost_currency === null ? null : { minor: Number(row.cost_minor), currency: row.cost_currency },
        note: row.note,
      };
      const next = { name: name ?? row.name, channelId, ...target, cost: cost === undefined ? prev.cost : cost, note: note === undefined ? row.note : note };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of Object.keys(prev) as (keyof typeof prev)[]) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
          before[k] = prev[k];
          after[k] = next[k];
        }
      }
      if (Object.keys(after).length === 0) return;
      await tx
        .updateTable('links')
        .set({
          name: next.name,
          channel_id: next.channelId,
          destination: next.destination,
          drop_id: next.dropId,
          model_id: next.modelId,
          cost_minor: next.cost?.minor ?? null,
          cost_currency: next.cost?.currency ?? null,
          note: next.note,
          updated_at: this.clock(),
        })
        .where('id', '=', linkId)
        .execute();
      await this.audit.record({ actor, action: 'link.update', targetType: 'link', targetId: linkId, details: { linkId, before, after } }, tx);
    });
    return this.get(linkId);
  }

  /** Take a link out of the list's default view; it keeps redirecting and counting. */
  archive(id: string, actor: Actor): Promise<LinkView> {
    return this.setArchived(id, true, actor);
  }

  /** Bring an archived link back into the list. */
  unarchive(id: string, actor: Actor): Promise<LinkView> {
    return this.setArchived(id, false, actor);
  }

  private async setArchived(id: string, archived: boolean, actor: Actor): Promise<LinkView> {
    const linkId = this.idOf(id, linkNotFound);
    const by = adminIdOf(actor);
    if (archived && !by) throw validationError('A link is archived by a console user.');
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('links').select(['id', 'code', 'archived_at']).where('id', '=', linkId).forUpdate().executeTakeFirst();
      if (!row) throw linkNotFound();
      if ((row.archived_at !== null) === archived) return;
      await tx
        .updateTable('links')
        .set(archived ? { archived_at: this.clock(), archived_by: by!, updated_at: this.clock() } : { archived_at: null, archived_by: null, updated_at: this.clock() })
        .where('id', '=', linkId)
        .execute();
      await this.audit.record({ actor, action: archived ? 'link.archive' : 'link.unarchive', targetType: 'link', targetId: linkId, details: { linkId, code: row.code } }, tx);
    });
    return this.get(linkId);
  }

  /** `GET /go/<code>`'s destination path, or null for an unknown code (see the header). */
  async resolve(code: string): Promise<string | null> {
    const c = typeof code === 'string' ? code.trim().toLowerCase() : '';
    if (!LINK_CODE_RE.test(c)) return null;
    const row = await this.db
      .selectFrom('links as l')
      .leftJoin('models as m', 'm.id', 'l.model_id')
      .select(['l.destination', 'l.drop_id', 'm.slug as model_slug'])
      .where('l.code', '=', c)
      .executeTakeFirst();
    return row ? destinationPath(row.destination, row.drop_id, row.model_slug) : null;
  }

  /** The releases and the models the dialog offers (see the header). */
  async destinations(): Promise<LinkDestinations> {
    const [releases, models] = await Promise.all([
      this.db
        .selectFrom('drops as d')
        .innerJoin('models as m', 'm.id', 'd.model_id')
        .select(['d.id', 'd.title', 'd.mode', 'd.opens_at', 'm.name as model'])
        .where('d.published_at', 'is not', null)
        .where('d.cancelled_at', 'is', null)
        .orderBy('d.opens_at', 'desc')
        .orderBy('d.id')
        .limit(DESTINATION_RELEASES)
        .execute(),
      this.db
        .selectFrom('models as m')
        .leftJoin('models as main', 'main.id', 'm.variant_of')
        .select(['m.id', 'm.name', 'm.variant_label', 'm.variant_of', 'm.slug', 'main.name as main_name'])
        .where('m.active', '=', true)
        .orderBy(sql`lower(coalesce(main.name, m.name))`)
        .orderBy(sql`m.variant_of IS NOT NULL`)
        .orderBy(sql`lower(coalesce(m.variant_label, ''))`)
        .orderBy('m.id')
        .execute(),
    ]);
    return {
      releases: releases.map((r) => ({ id: r.id, title: r.title, mode: r.mode, opensAt: r.opens_at, model: r.model })),
      models: models.map((m) => ({ id: m.id, name: m.main_name ?? m.name, variantLabel: m.variant_label, variantOf: m.variant_of, slug: m.slug })),
    };
  }

  // ── Checks ──────────────────────────────────────────────────────────────

  private joined(db: Db) {
    return db
      .selectFrom('links as l')
      .innerJoin('link_channels as c', 'c.id', 'l.channel_id')
      .innerJoin('admin_users as a', 'a.id', 'l.created_by')
      .leftJoin('models as m', 'm.id', 'l.model_id')
      .select([
        'l.id',
        'l.code',
        'l.name',
        'l.channel_id',
        'c.name as channel_name',
        'l.destination',
        'l.drop_id',
        'l.model_id',
        'm.slug as model_slug',
        'l.cost_minor',
        'l.cost_currency',
        'l.note',
        'l.archived_at',
        'l.created_by',
        'a.email as created_by_email',
        'l.created_at',
        'l.updated_at',
      ]);
  }

  private view(r: LinkRowJoined): LinkView {
    const path = destinationPath(r.destination, r.drop_id, r.model_slug);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      channel: { id: r.channel_id, name: r.channel_name },
      destination: r.destination,
      dropId: r.drop_id,
      modelId: r.model_id,
      cost: r.cost_minor === null || r.cost_currency === null ? null : { minor: Number(r.cost_minor), currency: r.cost_currency },
      note: r.note,
      address: `${this.origin}/go/${r.code}`,
      directAddress: `${this.origin}${path}?o=${r.code}`,
      archivedAt: r.archived_at,
      createdBy: { id: r.created_by, email: r.created_by_email },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private idOf(id: unknown, missing: () => Error): string {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
    return id.toLowerCase();
  }

  private async existingChannel(tx: Db, v: unknown): Promise<string> {
    const id = this.idOf(v, channelNotFound);
    const row = await tx.selectFrom('link_channels').select('id').where('id', '=', id).executeTakeFirst();
    if (!row) throw channelNotFound();
    return row.id;
  }

  /** A destination checked: a page of the app, a published release, an active model; 400 « Choose where the link goes. » */
  private async destination(tx: Db, destination: unknown, dropId: unknown, modelId: unknown): Promise<{ destination: LinkDestination; dropId: string | null; modelId: string | null }> {
    if (typeof destination !== 'string' || !(LINK_DESTINATIONS as readonly string[]).includes(destination)) throw noDestination();
    const d = destination as LinkDestination;
    const given = (v: unknown) => v !== undefined && v !== null;
    if (d === 'RELEASE') {
      if (given(modelId) || typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw noDestination();
      const drop = await tx.selectFrom('drops').select(['id', 'published_at']).where('id', '=', dropId.toLowerCase()).executeTakeFirst();
      if (!drop || drop.published_at === null) throw noDestination();
      return { destination: d, dropId: drop.id, modelId: null };
    }
    if (d === 'MODEL') {
      if (given(dropId) || typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw noDestination();
      const model = await tx.selectFrom('models').select(['id', 'active']).where('id', '=', modelId.toLowerCase()).executeTakeFirst();
      if (!model || !model.active) throw noDestination();
      return { destination: d, dropId: null, modelId: model.id };
    }
    if (given(dropId) || given(modelId)) throw noDestination();
    return { destination: d, dropId: null, modelId: null };
  }

  private linkName(v: unknown): string {
    const name = trimmed(v);
    if (name === null) throw noName();
    if (name.length > LINK_NAME_MAX) throw validationError(`A link’s name is ${LINK_NAME_MAX} characters at most.`);
    return name;
  }

  private code(v: unknown): string {
    if (typeof v !== 'string' || !LINK_CODE_RE.test(v.trim())) throw badCode();
    return v.trim();
  }

  private note(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') throw validationError(`A note is ${LINK_NOTE_MAX} characters at most.`);
    const note = v.trim();
    if (note.length > LINK_NOTE_MAX) throw validationError(`A note is ${LINK_NOTE_MAX} characters at most.`);
    return note.length === 0 ? null : note;
  }

  private cost(v: unknown): { minor: number; currency: HouseCurrency } | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') throw badCost();
    const { minor, currency } = v as { minor?: unknown; currency?: unknown };
    if (typeof minor !== 'number' || !Number.isSafeInteger(minor) || minor < 0 || minor > LINK_COST_MAX) throw badCost();
    if (typeof currency !== 'string' || !(HOUSE_CURRENCIES as readonly string[]).includes(currency)) throw badCost();
    return { minor, currency: currency as HouseCurrency };
  }
}
