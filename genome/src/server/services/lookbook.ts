/**
 * The lookbook of the models (P-R02; API §8.8 and §10.9, DATABASE §5.3 and §5.28).
 *
 * A model the console publishes (CatalogService.updateModel: `lookbook`,
 * `slug`, `story`, `specs`) has a sheet at `/verify/lookbook/<slug>`: its
 * reference photograph (the cover) and its gallery (`model_images`,
 * MediaService), its story, its specifications, its care and its collection,
 * and, once an ADMIN discontinued it (P-R06), the year it was.
 *
 *   HIDDEN    nowhere (every model, until the console shows it);
 *   PUBLIC    listed for everyone (GET /api/v1/lookbook, /:slug), and named
 *             by the AUTHENTIC results of its pieces (`product.lookbook`);
 *   RESERVED  listed for the owners of a piece only (the club, ClubService):
 *             unlisted, not confidential. Its sheet answers 404 to the
 *             public, but its photographs stay public at /api/v1/media/…
 *             P-X08: THE PRIVATE SALON. A RESERVED model is shown from the
 *             tier `private_min_tier` up (1 TITANE by default), with its
 *             price (`price_label`, salonFacts); below that tier its sheet is
 *             the same 404 as any model not in the collection. An owner
 *             requests it from its sheet (services/salon.ts).
 *
 * VARIANTS (plan NOCTURNE, N1, migration 0024): a model and its variants are one entry of a list, led by the main
 * model (or, when it is not shown there, by its first variant shown), whose `variants` are the dots: each model of the
 * group shown in that list, the main model first, then its variants in the order they were added, each with its
 * address, label, colour and photograph (and, in THE PRIVATE SALON, its price and tier). A sheet is the sheet of the
 * model its address names, whose `variants` hold each model of its group the reader may see, with its photographs and
 * facts (its specifications, care, discontinuation and salon), the one asked `selected`: a variant's own address opens
 * the sheet with that variant selected. A model shown alone has no dots (`variants` empty).
 *
 * NOW (plan NOCTURNE, N3): each entry of a list says when it was last added to the collection (`publishedAt`, the
 * latest first shown of its models there, each dot its own), so NOW leads with the newest; and an entry and a sheet
 * carry the sizes of their models (`sizes`, addition 8), from lot E's SKUs of the model and its variants.
 *
 * This module holds the rules both sides share: the address (`slug`), the
 * story (plain paragraphs, no Markdown: what is typed is what is shown), the
 * specifications (one `Label: value` line each; no figure in a label, since
 * labels are set in the display face, whose one is its capital I); then the
 * reads of the public routes and of the club (the gallery's bounds are
 * MediaService's, which stores its photographs). The
 * lists carry no story (the verify client refuses answers over 256 000
 * characters): a sheet does.
 *
 * THE RELEASES OF THIS MODEL (plan NEXT-NINE of 2026-10-06, §3.6 CO-01): a sheet carries the past releases of its
 * model's whole group (`releases`), by THE RELEASES' PAST's rule (services/past-releases.ts modelReleases), each only
 * its id, kind, opening and variant, the same whichever dot is asked.
 *
 * PAIRS WELL WITH (§3.7 BP-34): a sheet carries the models its very last section shows (`pairs`, `pairsOf`): the two or
 * three the console picked on its main model (`model_pairs`, CatalogService.setPairs), each the reader may see, else up
 * to three of its collection; never a price.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { LookbookState } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { mediaUrl } from './media.js';
import { modelReleases, type ModelRelease } from './past-releases.js';
import { sizesOnce, skuSizes } from './stock.js';

/** The address of a sheet: lower-case letters and digits, words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
export const STORY_MAX = 4000;
export const SPECS_MAX = 1000;
/** A specification's label, set in the display face: no figure (Gravesend's one is its capital I), at most 40 characters. */
export const SPEC_LABEL_MAX = 40;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A RESERVED model's price as THE PRIVATE SALON shows it (P-X08, models.price_label): 1 to 60 characters once trimmed. */
export const PRICE_LABEL_MAX = 60;

/**
 * The price of a model of the salon as the console sends it: trimmed, one line, 1 to PRICE_LABEL_MAX characters
 * (« € 4 800 », « Price on request »); null, '' or blank text: no price shown (returned as null).
 */
export function normalizePriceLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The price must be text.');
  const s = v.trim().replace(/\s+/g, ' ');
  if (s === '') return null;
  if (CONTROL_CHARS.test(s)) throw validationError('The price contains invalid characters.');
  if (s.length > PRICE_LABEL_MAX) throw validationError(`The price must be at most ${PRICE_LABEL_MAX} characters.`);
  return s;
}

/** The lowest tier a RESERVED model is shown to (P-X08, models.private_min_tier): 1 TITANE, 2 PLATINE or 3 PALLADIUM. */
export function normalizeMinTier(v: unknown): 1 | 2 | 3 {
  if (v !== 1 && v !== 2 && v !== 3) throw validationError('The tier of the private salon must be 1 (TITANE), 2 (PLATINE) or 3 (PALLADIUM).');
  return v;
}

/** A model's place in the lookbook, as it changes (CatalogService.updateModel). */
export const LOOKBOOK_SHOWN: readonly LookbookState[] = ['PUBLIC', 'RESERVED'];

/** Said as the verification app's sheet says it (verify/copy.ts LOOKBOOK.notFound): the lookbook is THE COLLECTION there. */
export const lookbookNotFound = () => new DomainError('LOOKBOOK_NOT_FOUND', 404, 'This model is not in the ORBES collection.');

/** `null` clears it; otherwise trimmed, lower-cased, and held to SLUG_RE and SLUG_MAX. */
export function normalizeSlug(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s.length > SLUG_MAX || !SLUG_RE.test(s)) {
    throw validationError(`The address (slug) is 1–${SLUG_MAX} lower-case letters and digits, words joined by single hyphens: monolithe-ring.`);
  }
  return s;
}

/** Line breaks as \n, the text trimmed; '' and null clear it. */
export function plainText(v: unknown, label: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/**
 * The story: plain paragraphs separated by a blank line, at most STORY_MAX characters. No Markdown: the sheet shows
 * the words as typed (`storyParagraphs`, src/web/shared/lookbook.ts, renders them in both apps). Lines are trimmed and
 * runs of blank lines kept to one.
 */
export function normalizeStory(v: unknown): string | null {
  const s = plainText(v, 'The story', STORY_MAX);
  if (s === null) return null;
  return s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export interface SpecLine {
  label: string;
  value: string;
}

/**
 * The specifications, one `Label: value` line each: the label before the first colon (1–40 characters, no figure,
 * since it is set in the display face), the value after it (not empty). Blank lines are dropped. Throws a
 * VALIDATION_FAILED that names the line. `parseSpecs` reads what this keeps.
 */
export function normalizeSpecs(v: unknown): string | null {
  const s = plainText(v, 'The specifications', SPECS_MAX);
  if (s === null) return null;
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out = lines.map((line, i) => {
    const colon = line.indexOf(':');
    const label = colon < 0 ? '' : line.slice(0, colon).trim();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    if (!label || !value) throw validationError(`Specifications, line ${i + 1}: write it as Label: value (for example, Metal: 925 sterling silver).`);
    if (label.length > SPEC_LABEL_MAX) throw validationError(`Specifications, line ${i + 1}: a label has at most ${SPEC_LABEL_MAX} characters.`);
    if (/[0-9]/.test(label)) throw validationError(`Specifications, line ${i + 1}: a label has no figure (labels are set in the display face); put the figures in the value.`);
    return `${label}: ${value}`;
  });
  return out.join('\n');
}

/** The lines of stored specifications (normalizeSpecs), as label and value; a line without its colon is skipped. */
export function parseSpecs(specs: string | null | undefined): SpecLine[] {
  if (!specs) return [];
  const out: SpecLine[] = [];
  for (const line of specs.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

/** How the audit log records a story: its length and SHA-256, never its words (`model.update`). */
export function storyFingerprint(story: string | null): { length: number; sha256: string } | null {
  return story === null ? null : { length: story.length, sha256: createHash('sha256').update(story, 'utf8').digest('hex') };
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** A model's dot among its variants (N1): its label (« Steel ») and colour (`#RRGGBB`). */
export interface VariantDot {
  label: string;
  swatch: string;
}

/** One dot of a list's entry (N1): a model of the group, by the address of its sheet, with its photograph. */
export interface LookbookCardVariant extends VariantDot {
  slug: string;
  name: string;
  type: string;
  /** Its reference photograph, else the first of its gallery; null without either. */
  imageUrl: string | null;
  /** THE PRIVATE SALON's cards only: its price shown (null: none) and the lowest tier it is shown to. */
  priceLabel?: string | null;
  minTier?: 1 | 2 | 3;
  /** When it was first shown (models.published_at; plan NOCTURNE, N3: NOW's collection reads it). */
  publishedAt: Date | null;
}

/** One model of a list (GET /api/v1/lookbook, the club's reserved models): no story, no gallery. */
export interface LookbookCard {
  slug: string;
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  /** The model's reference photograph, else the first photograph of its gallery (`/api/v1/media/<sha256>`); null without either. */
  imageUrl: string | null;
  /** N1: this model's own dot, or null for a model without a label. */
  variant: VariantDot | null;
  /** N1: the dots, this model's and its variants' shown in this list (the main model first); empty for a model alone. */
  variants: LookbookCardVariant[];
  /**
   * N3: when the entry was last added to the collection, the latest first shown of its models in this list (NOW leads
   * with the PUBLIC entry most recently published, plan NOCTURNE, What leads).
   */
  publishedAt: Date | null;
  /** N3 (addition 8): the sizes of its models in this list, from their SKUs (`16`, `17`, `18`); none in one size. */
  sizes: string[];
}

/** What THE PRIVATE SALON adds to a RESERVED model (P-X08): its price shown, and the lowest tier it is shown to. */
export interface SalonFacts {
  /** null: no price shown. */
  priceLabel: string | null;
  /** 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  minTier: 1 | 2 | 3;
}

/** One model of THE PRIVATE SALON (GET /api/v1/club/lookbook): a card, its price and its tier. */
export type SalonCard = LookbookCard & SalonFacts;

export interface LookbookImage {
  url: string;
  /** null: the sheet says what it shows (the model's name and type). */
  alt: string | null;
}

/**
 * A model of a sheet's group (N1), as the sheet switches to it with its dot: its address, photographs and facts, and
 * its place in THE PRIVATE SALON.
 */
export interface LookbookSheetVariant extends VariantDot {
  slug: string;
  /** The model whose address the sheet was asked for. */
  selected: boolean;
  lookbook: 'PUBLIC' | 'RESERVED';
  name: string;
  type: string;
  collection: string | null;
  coverUrl: string | null;
  gallery: LookbookImage[];
  /** N6: its own story (a variant's is copied from its main model, then may be its own). */
  story: string | null;
  specs: SpecLine[];
  care: string | null;
  discontinuedYear: number | null;
  /** A RESERVED one's price and tier (THE PRIVATE SALON); absent on a PUBLIC one. */
  salon?: SalonFacts;
}

/** A model's sheet (GET /api/v1/lookbook/:slug, the club's sheet). */
export interface LookbookSheet {
  slug: string;
  lookbook: 'PUBLIC' | 'RESERVED';
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  /** The reference photograph, shown first; null without one. */
  coverUrl: string | null;
  /** The gallery, in its order. */
  gallery: LookbookImage[];
  story: string | null;
  specs: SpecLine[];
  /** The model's care instructions; null: the general care text of /verify. */
  care: string | null;
  /** The year (UTC) the model was discontinued (P-R06), said « DISCONTINUED · <year> » on the sheet; null while it is not. */
  discontinuedYear: number | null;
  /** P-X08: a RESERVED model's price and tier (THE PRIVATE SALON); absent on a PUBLIC sheet. */
  salon?: SalonFacts;
  /** N1: this model's own dot, or null for a model without a label. */
  variant: VariantDot | null;
  /** N1: the dots of its group the reader may see, the main model first, this one `selected`; empty for a model alone. */
  variants: LookbookSheetVariant[];
  /** N3 (addition 8): the sizes of the models of its group the reader may see, from their SKUs; none in one size. */
  sizes: string[];
  /**
   * Plan NEXT-NINE, CO-01 (THE RELEASES OF THIS MODEL): the past releases of its whole group (the model and every one of
   * its variants, whatever the dot), the newest opening first, each exactly {id, kind, opensAt, variant}; empty for a
   * model never released (services/past-releases.ts modelReleases).
   */
  releases: ModelRelease[];
  /**
   * Plan NEXT-NINE, BP-34 (PAIRS WELL WITH): the models its very last section shows, the same whichever dot is asked
   * (`pairsOf`); empty: no section.
   */
  pairs: ModelPair[];
}

/** The fallback of PAIRS WELL WITH (BP-34): at most this many models of the sheet's collection when none is picked or shown. */
export const PAIRS_FALLBACK_MAX = 3;

/** A card of PAIRS WELL WITH (BP-34): a model the reader may see, its sheet's address, its photograph; no price, no dots. */
export interface ModelPair {
  slug: string;
  name: string;
  type: string;
  /** Its label among its variants when the model shown is itself a variant (« Blue »: MONOLITHE IN BLUE); else null. */
  variant: string | null;
  /** Its reference photograph, else the first of its gallery; null without either. */
  imageUrl: string | null;
  /** A model of THE PRIVATE SALON (RESERVED), shown to an owner of its tier. */
  reserved: boolean;
}

/**
 * PAIRS WELL WITH (plan NEXT-NINE, BP-34) of the sheet of the group led by `rootId` (its main model, or a model alone),
 * for a reader of `tier` (0 signed out, or an account that holds no piece): (a) the picks of the main model
 * (`pairPicks`) when at least one of them shows; (b) else what the sheet shows without them (`pairsFallbackOf`).
 */
export async function pairsOf(db: Db, rootId: string, collectionId: string | null, tier: number): Promise<ModelPair[]> {
  const picks = await pairPicks(db, rootId, tier);
  return picks.length > 0 ? picks : pairsFallbackOf(db, rootId, collectionId, tier);
}

/** The models a reader of `tier` may see (PUBLIC; RESERVED only from its `private_min_tier`), never discontinued nor without an address. */
function visiblePairs(db: Db, tier: number) {
  const shown: LookbookState[] = tier >= 1 ? ['PUBLIC', 'RESERVED'] : ['PUBLIC'];
  return db
    .selectFrom('models as m')
    .select((eb) => [
      'm.id',
      'm.slug',
      'm.name',
      'm.type',
      'm.lookbook',
      'm.image_sha256',
      'm.variant_of',
      'm.variant_label',
      'm.created_at',
      'm.published_at',
      eb.selectFrom('model_images as mi').select('mi.sha256').whereRef('mi.model_id', '=', 'm.id').orderBy('mi.position').limit(1).as('first_image'),
    ])
    .where('m.slug', 'is not', null)
    .where('m.discontinued_at', 'is', null)
    .where('m.lookbook', 'in', shown)
    .where((eb) => eb.or([eb('m.lookbook', '<>', 'RESERVED'), eb('m.private_min_tier', '<=', tier)]));
}

type PairRow = Awaited<ReturnType<ReturnType<typeof visiblePairs>['execute']>>[number];

function pairCard(r: PairRow): ModelPair {
  return {
    slug: r.slug!,
    name: r.name,
    type: r.type,
    variant: r.variant_of !== null ? r.variant_label : null,
    imageUrl: mediaUrl(r.image_sha256) ?? mediaUrl(r.first_image),
    reserved: r.lookbook === 'RESERVED',
  };
}

/**
 * BP-34 (a): the picks of the main model `rootId` (`model_pairs`), in their order, each a reader of `tier` may see,
 * `variant` set only when the pick is itself a variant; empty when none shows.
 */
export async function pairPicks(db: Db, rootId: string, tier: number): Promise<ModelPair[]> {
  const picks = await visiblePairs(db, tier)
    .innerJoin('model_pairs as p', 'p.paired_model_id', 'm.id')
    .where('p.model_id', '=', rootId)
    .orderBy('p.position')
    .execute();
  return picks.map(pairCard);
}

/**
 * BP-34 (b): what the sheet of the group led by `rootId` shows when none of its picks shows, whatever its picks: the
 * models of the sheet's collection (`collectionId`) a reader of `tier` may see, one per variant group (its lead: the
 * main model, else its first variant shown), never the sheet's own group, the latest published first, then by name, at
 * most PAIRS_FALLBACK_MAX; a model with no collection gets none.
 */
export async function pairsFallbackOf(db: Db, rootId: string, collectionId: string | null, tier: number): Promise<ModelPair[]> {
  if (collectionId === null) return [];
  const rows = await visiblePairs(db, tier)
    .where('m.collection_id', '=', collectionId)
    .where('m.id', '<>', rootId)
    .where((eb) => eb.or([eb('m.variant_of', 'is', null), eb('m.variant_of', '<>', rootId)]))
    .execute();
  const groups = new Map<string, PairRow[]>();
  for (const r of rows) groups.set(r.variant_of ?? r.id, [...(groups.get(r.variant_of ?? r.id) ?? []), r]);
  const latest = (g: readonly PairRow[]) => Math.max(...g.map((r) => (r.published_at ? r.published_at.getTime() : -Infinity)));
  return [...groups.entries()]
    .map(([root, g]) => ({ lead: sortGroup(g, root)[0]!, at: latest(g) }))
    .sort((a, b) => b.at - a.at || (a.lead.name < b.lead.name ? -1 : a.lead.name > b.lead.name ? 1 : 0) || (a.lead.slug! < b.lead.slug! ? -1 : 1))
    .slice(0, PAIRS_FALLBACK_MAX)
    .map(({ lead }) => pairCard(lead));
}

export interface LookbookServiceDeps {
  db: Db;
  /** CO-01: the moment a LIVE RELEASE's stages are read at (its name revealed by its end). */
  clock?: Clock;
}

export class LookbookService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: LookbookServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** The PUBLIC models, by collection (models without one last), then by name. */
  listPublic(): Promise<LookbookCard[]> {
    return this.cards('PUBLIC');
  }

  /**
   * THE PRIVATE SALON (P-X08): the RESERVED models shown to `tier` (those whose `private_min_tier` it reaches), each with
   * its price and tier; none below TITANE. ClubService reads the account's tier.
   */
  async listReserved(tier: number): Promise<SalonCard[]> {
    if (!(tier >= 1)) return [];
    return (await this.cards('RESERVED', tier)) as SalonCard[];
  }

  /**
   * THE PRIVATE SALON locked below its tier (plan NOCTURNE, screen 5): the lowest tier above `tier` from which a RESERVED
   * model is shown (one with an address), 2 PLATINE or 3 PALLADIUM; null when none lies above it. Never a model.
   */
  async reservedFromAbove(tier: number): Promise<2 | 3 | null> {
    const row = await this.db
      .selectFrom('models')
      .select((eb) => eb.fn.min('private_min_tier').as('from'))
      .where('lookbook', '=', 'RESERVED')
      .where('slug', 'is not', null)
      .where('private_min_tier', '>', Math.max(1, Math.floor(tier)))
      .executeTakeFirst();
    const from = row?.from === null || row?.from === undefined ? null : Number(row.from);
    return from === 2 || from === 3 ? from : null;
  }

  /**
   * A model's sheet by its address: a PUBLIC model, or for `tier` ≥ 1 (an owner, ClubService) a RESERVED one whose
   * `private_min_tier` it reaches, with its price and tier (`salon`). Anything else (HIDDEN, unknown, malformed, a RESERVED
   * model above the reader's tier) is the same 404 LOOKBOOK_NOT_FOUND.
   */
  async sheet(slug: string, opts: { tier?: number } = {}): Promise<LookbookSheet> {
    return (await this.sheetOf(slug, opts)).sheet;
  }

  /**
   * The sheet (`sheet`) and its model's id, for the club's request (services/salon.ts), with the ids of the models of
   * its dots by their address (`variantIds`, N1: each RESERVED one is requested on its own).
   */
  async sheetOf(slug: string, opts: { tier?: number } = {}): Promise<{ modelId: string; sheet: LookbookSheet; variantIds: Record<string, string> }> {
    const key = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (key.length > SLUG_MAX || !SLUG_RE.test(key)) throw lookbookNotFound();
    const tier = opts.tier ?? 0;
    const m = await this.sheetRows(tier).where('m.slug', '=', key).executeTakeFirst();
    if (!m || !m.slug || m.lookbook === 'HIDDEN') throw lookbookNotFound();
    // P-X08: below the model's tier, the salon has no such model.
    if (m.lookbook === 'RESERVED' && m.private_min_tier > tier) throw lookbookNotFound();
    // N1: the models of its group the reader may see, with their galleries.
    const root = m.variant_of ?? m.id;
    const group = sortGroup(await this.sheetRows(tier).where((eb) => eb.or([eb('m.id', '=', root), eb('m.variant_of', '=', root)])).execute(), root);
    const ids = group.length > 1 ? group.map((g) => g.id) : [m.id];
    // CO-01: the releases of the whole group, the variants the reader may not see included (a past release is public);
    // BP-34: the pairs of its main model, the fallback from the main model's collection.
    const whole = await this.db.selectFrom('models').select(['id', 'collection_id']).where((eb) => eb.or([eb('id', '=', root), eb('variant_of', '=', root)])).execute();
    const collectionId = whole.find((g) => g.id === root)?.collection_id ?? null;
    const [galleries, sizes, releases, pairs] = await Promise.all([
      this.db.selectFrom('model_images').select(['model_id', 'sha256', 'alt']).where('model_id', 'in', ids).orderBy('model_id').orderBy('position').execute(),
      skuSizes(this.db, group.map((g) => g.id)),
      modelReleases(this.db, whole.map((g) => g.id), this.clock()),
      pairsOf(this.db, root, collectionId, tier),
    ]);
    const galleryOf = (r: SheetRow): LookbookImage[] =>
      // The cover is shown once: a gallery photograph made the reference photograph since is left out here.
      galleries
        .filter((g) => g.model_id === r.id)
        .flatMap((g) => {
          const url = g.sha256 === r.image_sha256 ? null : mediaUrl(g.sha256);
          return url ? [{ url, alt: g.alt }] : [];
        });
    const lookbookOf = (r: SheetRow) => r.lookbook as 'PUBLIC' | 'RESERVED';
    const sheet: LookbookSheet = {
      slug: m.slug,
      lookbook: lookbookOf(m),
      name: m.name,
      type: m.type,
      category: { code: m.category_code.trim(), name: m.category_name },
      collection: m.collection,
      coverUrl: mediaUrl(m.image_sha256),
      gallery: galleryOf(m),
      story: m.story,
      specs: parseSpecs(m.specs),
      care: m.care_instructions,
      discontinuedYear: m.discontinued_at ? m.discontinued_at.getUTCFullYear() : null,
      ...(m.lookbook === 'RESERVED' ? { salon: salonFacts(m) } : {}),
      variant: dotOf(m),
      variants: dotted(group).map((g) => ({
        slug: g.slug!,
        label: g.variant_label!,
        swatch: g.variant_swatch!,
        selected: g.id === m.id,
        lookbook: lookbookOf(g),
        name: g.name,
        type: g.type,
        collection: g.collection,
        coverUrl: mediaUrl(g.image_sha256),
        gallery: galleryOf(g),
        story: g.story,
        specs: parseSpecs(g.specs),
        care: g.care_instructions,
        discontinuedYear: g.discontinued_at ? g.discontinued_at.getUTCFullYear() : null,
        ...(g.lookbook === 'RESERVED' ? { salon: salonFacts(g) } : {}),
      })),
      sizes: sizesOnce(group.flatMap((g) => sizes.get(g.id) ?? [])),
      releases,
      pairs,
    };
    return { modelId: m.id, sheet, variantIds: Object.fromEntries(dotted(group).map((g) => [g.slug!, g.id])) };
  }

  /**
   * The models a sheet may show to `tier`: shown with their address, PUBLIC, or for an owner (`tier` ≥ 1) RESERVED from a
   * tier it reaches (P-X08: below it, the salon has no such model). Anything else is not found.
   */
  private sheetRows(tier: number) {
    const shown: LookbookState[] = tier >= 1 ? ['PUBLIC', 'RESERVED'] : ['PUBLIC'];
    return this.db
      .selectFrom('models as m')
      .innerJoin('categories as c', 'c.id', 'm.category_id')
      .leftJoin('collections as col', 'col.id', 'm.collection_id')
      .select([
        'm.id',
        'm.slug',
        'm.lookbook',
        'm.name',
        'm.type',
        'm.story',
        'm.specs',
        'm.care_instructions',
        'm.image_sha256',
        'm.discontinued_at',
        'm.price_label',
        'm.private_min_tier',
        'm.variant_of',
        'm.variant_label',
        'm.variant_swatch',
        'm.created_at',
        'c.code as category_code',
        'c.name as category_name',
        'col.name as collection',
      ])
      .where('m.slug', 'is not', null)
      .where('m.lookbook', 'in', shown)
      .where((eb) => eb.or([eb('m.lookbook', '<>', 'RESERVED'), eb('m.private_min_tier', '<=', tier)]));
  }

  private async cards(state: 'PUBLIC' | 'RESERVED', tier = 0): Promise<(LookbookCard | SalonCard)[]> {
    const rows = await this.db
      .selectFrom('models as m')
      .innerJoin('categories as c', 'c.id', 'm.category_id')
      .leftJoin('collections as col', 'col.id', 'm.collection_id')
      .select((eb) => [
        'm.id',
        'm.slug',
        'm.name',
        'm.type',
        'm.image_sha256',
        'm.price_label',
        'm.private_min_tier',
        'm.variant_of',
        'm.variant_label',
        'm.variant_swatch',
        'm.created_at',
        'm.published_at',
        'c.code as category_code',
        'c.name as category_name',
        'col.name as collection',
        eb.selectFrom('model_images as mi').select('mi.sha256').whereRef('mi.model_id', '=', 'm.id').orderBy('mi.position').limit(1).as('first_image'),
      ])
      .where('m.lookbook', '=', state)
      .where('m.slug', 'is not', null)
      .$if(state === 'RESERVED', (qb) => qb.where('m.private_min_tier', '<=', tier))
      .orderBy(sql`col.name IS NULL`)
      .orderBy('col.name')
      .orderBy('m.name')
      .orderBy('m.slug')
      .execute();
    // N1: a model and its variants shown here are one entry, where the first of them comes, led by the main model.
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r.variant_of ?? r.id, [...(groups.get(r.variant_of ?? r.id) ?? []), r]);
    const imageOf = (r: (typeof rows)[number]) => mediaUrl(r.image_sha256) ?? mediaUrl(r.first_image);
    const sizes = await skuSizes(this.db, rows.map((r) => r.id));
    const latest = (group: typeof rows): Date | null =>
      group.reduce<Date | null>((at, g) => (g.published_at && (!at || g.published_at.getTime() > at.getTime()) ? g.published_at : at), null);
    const out: (LookbookCard | SalonCard)[] = [];
    const done = new Set<string>();
    for (const r of rows) {
      const root = r.variant_of ?? r.id;
      if (done.has(root)) continue;
      done.add(root);
      const group = sortGroup(groups.get(root)!, root);
      const lead = group[0]!;
      out.push({
        slug: lead.slug!,
        name: lead.name,
        type: lead.type,
        category: { code: lead.category_code.trim(), name: lead.category_name },
        collection: lead.collection,
        imageUrl: imageOf(lead),
        // P-X08: the salon's price and tier, on its cards only (the public list names neither).
        ...(state === 'RESERVED' ? salonFacts(lead) : {}),
        variant: dotOf(lead),
        variants: dotted(group).map((g) => ({
          slug: g.slug!,
          name: g.name,
          type: g.type,
          label: g.variant_label!,
          swatch: g.variant_swatch!,
          imageUrl: imageOf(g),
          ...(state === 'RESERVED' ? salonFacts(g) : {}),
          publishedAt: g.published_at,
        })),
        publishedAt: latest(group),
        sizes: sizesOnce(group.flatMap((g) => sizes.get(g.id) ?? [])),
      });
    }
    return out;
  }
}

/** The models of a group, the main model (`root`) first, then its variants in the order they were added. */
function sortGroup<T extends { id: string; created_at: Date }>(rows: readonly T[], root: string): T[] {
  return [...rows].sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/** A model's own dot: its label and colour, or null without them. */
function dotOf(r: { variant_label: string | null; variant_swatch: string | null }): VariantDot | null {
  return r.variant_label !== null && r.variant_swatch !== null ? { label: r.variant_label, swatch: r.variant_swatch } : null;
}

/** The dots of a group: its models with an address, a label and a colour, when there are two or more; none for a model alone. */
function dotted<T extends { slug: string | null; variant_label: string | null; variant_swatch: string | null }>(group: readonly T[]): T[] {
  const dots = group.filter((g) => g.slug !== null && g.variant_label !== null && g.variant_swatch !== null);
  return dots.length > 1 ? dots : [];
}

type SheetRow = {
  id: string;
  image_sha256: string | null;
  lookbook: LookbookState;
};

/** A RESERVED model's price and tier as the salon gives them; a stored tier out of 1..3 (never written) reads 3, the safest. */
function salonFacts(r: { price_label: string | null; private_min_tier: number }): SalonFacts {
  const t = r.private_min_tier;
  return { priceLabel: r.price_label, minTier: t === 1 || t === 2 ? t : 3 };
}
