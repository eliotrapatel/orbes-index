/**
 * THE RELEASES' PAST (plan LIVE RELEASE+ of 2026-10-04, choice 5 and decisions 28 to 30): the releases that have ended,
 * public, and what an account took part in. Read only.
 *
 *   page           GET /api/v1/releases/past: every release ended, the newest first (by its opening), LIVE RELEASES and
 *                  draws together, a page at a time;
 *   participation  GET /api/v1/account/participation: the releases the signed-in account took part in, each with
 *                  whether it secured a piece there (services/participation.ts, the access rule's own count).
 *
 * Ended: a LIVE RELEASE announced whose end is recorded or whose time is over (sold out, closed, or ended by ORBES); a
 * draw once drawn (before its draw, its entrants still wait: it stays with the releases to come). Never a draft, a
 * cancelled release, nor an after-room (decision 28: hidden, even after the release).
 *
 * A card says only what was announced (choice 5: no end figure): the photograph, the name, the opening date and the
 * quantity line as announced (decision 29, « 25 PIECES » even when pieces were added live; a draw's pieces, which never
 * change once published). A LIVE RELEASE's parts each from its stage (services/live.ts liveStages), as everywhere: one
 * ended before its name was revealed is named nowhere. No count of entries, of pieces confirmed or left, no reason of
 * the end, no interest.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow } from '../db/schema.js';
import { makePage, pageOffset, systemClock, type Clock, type Page, type PageRequest } from '../types.js';
import { liveStages } from './live.js';
import { defaultQuantityLine } from './live-console.js';
import { mediaUrl } from './media.js';
import { releasesTakenPart, type ReleaseTakenPart } from './participation.js';

/** A release of THE RELEASES' PAST. */
export interface PastReleaseCard {
  id: string;
  kind: 'LIVE' | 'DRAW';
  /** The release's title; a LIVE RELEASE's from its name's stage (null before it). */
  title: string | null;
  /** Its model: its name, type and collection (a LIVE RELEASE's from its name's stage, null before it). */
  model: { name: string | null; type: string | null; collection: string | null };
  /** The model's photograph (`/api/v1/media/<sha256>`); a LIVE RELEASE's from its photograph's stage; null without one. */
  imageUrl: string | null;
  /** The opening: a LIVE RELEASE's T0, a draw's opening of its entries. */
  opensAt: Date;
  /** The quantity as announced: a LIVE RELEASE's line (« 25 PIECES »), a draw's pieces. */
  quantityLine: string;
}

/** The releases an account took part in (GET /api/v1/account/participation). */
export interface AccountParticipation {
  /** How many: « You have taken part in N releases ». */
  count: number;
  releases: ReleaseTakenPart[];
}

type PastRow = DropRow & {
  model_name: string;
  model_type: string;
  model_image: string | null;
  collection: string | null;
};

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
    const ended = this.ended(now);
    const total = await ended.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await ended
      .innerJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('collections as c', 'c.id', 'm.collection_id')
      .selectAll('d')
      .select(['m.name as model_name', 'm.type as model_type', 'm.image_sha256 as model_image', 'c.name as collection'])
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .limit(req.pageSize)
      .offset(pageOffset(req))
      .execute();
    return makePage(
      rows.map((r) => card(r, now)),
      Number(total.n),
      req,
    );
  }

  /** The releases the account took part in at now, and whether it secured a piece in each. */
  async participation(accountId: string): Promise<AccountParticipation> {
    const releases = await releasesTakenPart(this.db, accountId, this.clock());
    return { count: releases.length, releases };
  }

  /** The releases ended at `now`: published, never cancelled, never an after-room. */
  private ended(now: Date) {
    return this.db
      .selectFrom('drops as d')
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.parent_drop_id', 'is', null)
      .where((eb) =>
        eb.or([
          eb.and([eb('d.mode', '=', 'DRAW'), eb('d.drawn_at', 'is not', null)]),
          eb.and([
            eb('d.mode', '=', 'LIVE'),
            eb(sql<Date>`coalesce(d.announce_at, d.published_at)`, '<=', now),
            eb.or([eb('d.ended_at', 'is not', null), eb('d.closes_at', '<=', now)]),
          ]),
        ]),
      );
  }
}

function card(r: PastRow, now: Date): PastReleaseCard {
  if (r.mode === 'LIVE') {
    // Announced (the query's rule): its stages are known.
    const stages = liveStages(r, now)!;
    return {
      id: r.id,
      kind: 'LIVE',
      title: stages.name ? r.title : null,
      model: { name: stages.name ? r.model_name : null, type: stages.name ? r.model_type : null, collection: stages.name ? r.collection : null },
      imageUrl: stages.photo ? mediaUrl(r.model_image) : null,
      opensAt: r.opens_at,
      quantityLine: r.quantity_line ?? '',
    };
  }
  return {
    id: r.id,
    kind: 'DRAW',
    title: r.title,
    model: { name: r.model_name, type: r.model_type, collection: r.collection },
    imageUrl: mediaUrl(r.model_image),
    opensAt: r.opens_at,
    quantityLine: defaultQuantityLine(r.quantity),
  };
}
