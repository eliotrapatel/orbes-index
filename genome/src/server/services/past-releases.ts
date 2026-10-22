/**
 * THE RELEASES' PAST (plan LIVE RELEASE+ of 2026-10-04, choice 5 and decisions 28 to 30): the releases that have ended,
 * public, and what an account took part in. Read only.
 *
 *   page           GET /api/v1/releases/past: every release ended, the newest first (by its opening), LIVE RELEASES and
 *                  draws together, a page at a time;
 *   participation  GET /api/v1/account/participation: the releases the signed-in account took part in, each with
 *                  whether it secured a piece there (services/participation.ts, the access rule's own count).
 *
 * Ended: a LIVE RELEASE once over (sold out, closed, or ended by ORBES: its end recorded and no turn or hold left to run
 * to its deadline, as the room's `over`), the moment its page answers in its final state, announced before its end (one
 * ended before its announcement was never announced); a draw once drawn (before its draw, its entrants still wait: it
 * stays with the releases to come). Never a draft, a cancelled release, nor an after-room (decision 28: hidden, even
 * after the release).
 *
 * A card says only what was announced (choice 5: no end figure): the photograph, the name, the opening date and the
 * quantity line as announced (decision 29, « 25 PIECES » even when pieces were added live; a draw's pieces, which never
 * change once published). A LIVE RELEASE's parts each from its stage (services/live.ts liveStages), read at its end
 * (stagesAt): one ended before its name was revealed is named nowhere, even once the time set for its name has passed.
 * No count of entries, of pieces confirmed or left, no reason of the end, no interest.
 *
 * THE RELEASES OF THIS MODEL (plan NEXT-NINE of 2026-10-06, §3.6 CO-01): a model's sheet lists its past releases by the
 * same rule (`endedReleases`, the query PAST reads): `modelReleases` gives each one's id, kind, opening and variant,
 * nothing more (services/lookbook.ts, the sheet's `releases`).
 *
 * THE SET (macro scope K44 T1; plan MACRO M3 §5.2): a set's release is its own entry of PAST (ADAPTED), under its set's
 * name (`set`), its pieces' names and photographs each at its stage as a model's are (a LIVE RELEASE's name and
 * photograph stages; a draw's from its publication), its quantity line in sets (« 25 SETS »), its `model` all null:
 * never attributed to one of its models. A model's sheet never lists a set's release (EXCLUDED: `modelReleases` reads
 * a model's releases only; the set's releases are its own, Catalogue → Sets).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow } from '../db/schema.js';
import { makePage, pageOffset, systemClock, type Clock, type Page, type PageRequest } from '../types.js';
import { liveStages, stagesAt } from './live.js';
import { defaultQuantityLine } from './live-console.js';
import { mediaUrl } from './media.js';
import { releasesTakenPart, type ReleaseTakenPart } from './participation.js';
import { releaseOffers, type ReleaseOffer } from './release-offer.js';

/** A release of THE RELEASES' PAST. */
export interface PastReleaseCard {
  id: string;
  kind: 'LIVE' | 'DRAW';
  /** The release's title; a LIVE RELEASE's from its name's stage (null before it). */
  title: string | null;
  /**
   * Its model: its name, type and collection, and its label among its variants (NOCTURNE N1: « Blue », MONOLITHE in blue;
   * null without one); a LIVE RELEASE's from its name's stage, null before it.
   */
  model: { name: string | null; type: string | null; collection: string | null; variant: string | null };
  /** The model's photograph (`/api/v1/media/<sha256>`); a LIVE RELEASE's from its photograph's stage; null without one. */
  imageUrl: string | null;
  /** The opening: a LIVE RELEASE's T0, a draw's opening of its entries. */
  opensAt: Date;
  /** The quantity as announced: a LIVE RELEASE's line (« 25 PIECES »), a draw's pieces; a set's release, its sets (« 25 SETS »). */
  quantityLine: string;
  /**
   * Macro scope K44 T1: a set's release, its set's name and its pieces in order, each its model's name and variant (at the
   * name stage, null before) and photograph (at the photo stage, null before or without one); absent on a model's release.
   */
  set?: { name: string | null; pieces: { name: string | null; variant: string | null; imageUrl: string | null }[] };
}

/** The releases an account took part in (GET /api/v1/account/participation). */
export interface AccountParticipation {
  /** How many: « You have taken part in N releases ». */
  count: number;
  releases: ReleaseTakenPart[];
}

type PastRow = DropRow & {
  model_name: string | null;
  model_variant: string | null;
  model_type: string | null;
  model_image: string | null;
  collection: string | null;
};

/** A set's quantity line as announced (« 25 SETS »). */
export const setQuantityLine = (quantity: number): string => `${quantity} ${quantity === 1 ? 'SET' : 'SETS'}`;

export interface PastReleaseServiceDeps {
  db: Db;
  clock?: Clock;
}

export class PastReleaseService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: PastReleaseServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** A page of the releases ended at now, the newest opening first. */
  async page(req: PageRequest): Promise<Page<PastReleaseCard>> {
    const now = this.clock();
    const ended = endedReleases(this.db);
    const total = await ended.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    // A model's release with its model; a set's (macro scope K44) with its set's pieces, read after.
    const rows = await ended
      .leftJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('collections as c', 'c.id', 'm.collection_id')
      .selectAll('d')
      .select(['m.name as model_name', 'm.variant_label as model_variant', 'm.type as model_type', 'm.image_sha256 as model_image', 'c.name as collection'])
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .limit(req.pageSize)
      .offset(pageOffset(req))
      .execute();
    const offers = await releaseOffers(this.db, rows.filter((r) => r.set_id !== null));
    return makePage(
      rows.map((r) => card(r, now, offers.get(r.id))),
      Number(total.n),
      req,
    );
  }

  /** The releases the account took part in at now, and whether it secured a piece in each. */
  async participation(accountId: string): Promise<AccountParticipation> {
    const releases = await releasesTakenPart(this.db, accountId, this.clock());
    return { count: releases.length, releases };
  }
}

/**
 * The releases ended (THE RELEASES' PAST's rule, read by PAST and by a model's sheet, services/lookbook.ts
 * modelReleases): published, never cancelled, never an after-room; a draw once drawn; a LIVE RELEASE once over, its end
 * recorded after its announcement and no turn or hold left to run.
 */
export function endedReleases(db: Db) {
  return db
    .selectFrom('drops as d')
    .where('d.published_at', 'is not', null)
    .where('d.cancelled_at', 'is', null)
    .where('d.parent_drop_id', 'is', null)
    .where((eb) =>
      eb.or([
        eb.and([eb('d.mode', '=', 'DRAW'), eb('d.drawn_at', 'is not', null)]),
        eb.and([
          eb('d.mode', '=', 'LIVE'),
          eb('d.ended_at', 'is not', null),
          eb(sql<Date>`coalesce(d.announce_at, d.published_at)`, '<=', eb.ref('d.ended_at')),
          eb.not(
            eb.exists(
              eb.selectFrom('live_entries as e').select('e.id').whereRef('e.drop_id', '=', 'd.id').where('e.status', 'in', ['TURN', 'SECURED']),
            ),
          ),
        ]),
      ]),
    );
}

/**
 * A past release of a model, as its sheet lists it (plan NEXT-NINE of 2026-10-06, §3.6 CO-01, THE RELEASES OF THIS
 * MODEL): its id (its page), its kind, its opening and its model's label among its variants (« Blue »; null for a model
 * alone). Nothing else: no title, no quantity, no end figure, no mark of the reader's part.
 */
export interface ModelRelease {
  id: string;
  kind: 'LIVE' | 'DRAW';
  opensAt: Date;
  variant: string | null;
}

/**
 * The releases ended (`endedReleases`) of the models `modelIds` (a model and its variants), the newest opening first,
 * then by id; every one, no limit. A LIVE RELEASE is kept only once its name was revealed by its end (its stages read at
 * `now`, as PAST names it): one ended before its name stage is named nowhere.
 */
export async function modelReleases(db: Db, modelIds: readonly string[], now: Date): Promise<ModelRelease[]> {
  if (modelIds.length === 0) return [];
  // A model's releases only (macro scope K44, EXCLUDED): a set's release names no model and is listed under its set.
  const rows = await endedReleases(db)
    .innerJoin('models as m', 'm.id', 'd.model_id')
    .where('d.model_id', 'in', [...modelIds])
    .selectAll('d')
    .select('m.variant_label as model_variant')
    .orderBy('d.opens_at', 'desc')
    .orderBy('d.id')
    .execute();
  return rows
    .filter((r) => r.mode !== 'LIVE' || liveStages(r, stagesAt(r, now))?.name === true)
    .map((r) => ({ id: r.id, kind: r.mode === 'LIVE' ? 'LIVE' : 'DRAW', opensAt: r.opens_at, variant: r.model_variant }));
}

function card(r: PastRow, now: Date, offer?: ReleaseOffer): PastReleaseCard {
  if (offer && offer.kind === 'SET') return setCard(r, now, offer);
  if (r.mode === 'LIVE') {
    // Over, announced before its end (the query's rule): its stages as they stood at its end.
    const stages = liveStages(r, stagesAt(r, now))!;
    return {
      id: r.id,
      kind: 'LIVE',
      title: stages.name ? r.title : null,
      model: {
        name: stages.name ? r.model_name : null,
        type: stages.name ? r.model_type : null,
        collection: stages.name ? r.collection : null,
        variant: stages.name ? r.model_variant : null,
      },
      imageUrl: stages.photo ? mediaUrl(r.model_image) : null,
      opensAt: r.opens_at,
      quantityLine: r.quantity_line ?? '',
    };
  }
  return {
    id: r.id,
    kind: 'DRAW',
    title: r.title,
    model: { name: r.model_name, type: r.model_type, collection: r.collection, variant: r.model_variant },
    imageUrl: mediaUrl(r.model_image),
    opensAt: r.opens_at,
    quantityLine: defaultQuantityLine(r.quantity),
  };
}

/**
 * A set's release in PAST (macro scope K44 T1, ADAPTED): its own entry under its set's name, its pieces' names at the name
 * stage and photographs at the photo stage (a draw's both from its publication), its model all null, its line in sets.
 */
function setCard(r: PastRow, now: Date, offer: Extract<ReleaseOffer, { kind: 'SET' }>): PastReleaseCard {
  const stages = r.mode === 'LIVE' ? liveStages(r, stagesAt(r, now))! : { name: true, photo: true };
  return {
    id: r.id,
    kind: r.mode === 'LIVE' ? 'LIVE' : 'DRAW',
    title: stages.name ? r.title : null,
    model: { name: null, type: null, collection: null, variant: null },
    imageUrl: null,
    opensAt: r.opens_at,
    quantityLine: r.mode === 'LIVE' ? (r.quantity_line ?? '') : setQuantityLine(r.quantity),
    set: {
      name: stages.name ? offer.set.name : null,
      pieces: offer.pieces.map((p) => ({ name: stages.name ? p.model.name : null, variant: stages.name ? p.model.variant : null, imageUrl: stages.photo ? p.model.imageUrl : null })),
    },
  };
}
