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
 * This module holds the rules both sides share: the address (`slug`), the
 * story (plain paragraphs, no Markdown: what is typed is what is shown), the
 * specifications (one `Label: value` line each; no figure in a label, since
 * labels are set in the display face, whose one is its capital I); then the
 * reads of the public routes and of the club (the gallery's bounds are
 * MediaService's, which stores its photographs). The
 * lists carry no story (the verify client refuses answers over 256 000
 * characters): a sheet does.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { LookbookState } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
import { mediaUrl } from './media.js';

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

/** One model of a list (GET /api/v1/lookbook, the club's reserved models): no story, no gallery. */
export interface LookbookCard {
  slug: string;
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  /** The model's reference photograph, else the first photograph of its gallery (`/api/v1/media/<sha256>`); null without either. */
  imageUrl: string | null;
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
}

export interface LookbookServiceDeps {
  db: Db;
}

export class LookbookService {
  private readonly db: Db;

  constructor(deps: LookbookServiceDeps) {
    this.db = deps.db;
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
   * A model's sheet by its address: a PUBLIC model, or for `tier` ≥ 1 (an owner, ClubService) a RESERVED one whose
   * `private_min_tier` it reaches, with its price and tier (`salon`). Anything else (HIDDEN, unknown, malformed, a RESERVED
   * model above the reader's tier) is the same 404 LOOKBOOK_NOT_FOUND.
   */
  async sheet(slug: string, opts: { tier?: number } = {}): Promise<LookbookSheet> {
    return (await this.sheetOf(slug, opts)).sheet;
  }

  /** The sheet (`sheet`) and its model's id, for the club's request (services/salon.ts). */
  async sheetOf(slug: string, opts: { tier?: number } = {}): Promise<{ modelId: string; sheet: LookbookSheet }> {
    const key = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (key.length > SLUG_MAX || !SLUG_RE.test(key)) throw lookbookNotFound();
    const tier = opts.tier ?? 0;
    const shown: LookbookState[] = tier >= 1 ? ['PUBLIC', 'RESERVED'] : ['PUBLIC'];
    const m = await this.db
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
        'c.code as category_code',
        'c.name as category_name',
        'col.name as collection',
      ])
      .where('m.slug', '=', key)
      .where('m.lookbook', 'in', shown)
      .executeTakeFirst();
    if (!m || !m.slug || m.lookbook === 'HIDDEN') throw lookbookNotFound();
    // P-X08: below the model's tier, the salon has no such model.
    if (m.lookbook === 'RESERVED' && m.private_min_tier > tier) throw lookbookNotFound();
    const gallery = await this.db.selectFrom('model_images').select(['sha256', 'alt']).where('model_id', '=', m.id).orderBy('position').execute();
    const sheet: LookbookSheet = {
      slug: m.slug,
      lookbook: m.lookbook,
      name: m.name,
      type: m.type,
      category: { code: m.category_code.trim(), name: m.category_name },
      collection: m.collection,
      coverUrl: mediaUrl(m.image_sha256),
      // The cover is shown once: a gallery photograph made the reference photograph since is left out here.
      gallery: gallery.flatMap((g) => {
        const url = g.sha256 === m.image_sha256 ? null : mediaUrl(g.sha256);
        return url ? [{ url, alt: g.alt }] : [];
      }),
      story: m.story,
      specs: parseSpecs(m.specs),
      care: m.care_instructions,
      discontinuedYear: m.discontinued_at ? m.discontinued_at.getUTCFullYear() : null,
      ...(m.lookbook === 'RESERVED' ? { salon: salonFacts(m) } : {}),
    };
    return { modelId: m.id, sheet };
  }

  private async cards(state: 'PUBLIC' | 'RESERVED', tier = 0): Promise<(LookbookCard | SalonCard)[]> {
    const rows = await this.db
      .selectFrom('models as m')
      .innerJoin('categories as c', 'c.id', 'm.category_id')
      .leftJoin('collections as col', 'col.id', 'm.collection_id')
      .select((eb) => [
        'm.slug',
        'm.name',
        'm.type',
        'm.image_sha256',
        'm.price_label',
        'm.private_min_tier',
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
    return rows.map((r) => ({
      slug: r.slug!,
      name: r.name,
      type: r.type,
      category: { code: r.category_code.trim(), name: r.category_name },
      collection: r.collection,
      imageUrl: mediaUrl(r.image_sha256) ?? mediaUrl(r.first_image),
      // P-X08: the salon's price and tier, on its cards only (the public list names neither).
      ...(state === 'RESERVED' ? salonFacts(r) : {}),
    }));
  }
}

/** A RESERVED model's price and tier as the salon gives them; a stored tier out of 1..3 (never written) reads 3, the safest. */
function salonFacts(r: { price_label: string | null; private_min_tier: number }): SalonFacts {
  const t = r.private_min_tier;
  return { priceLabel: r.price_label, minTier: t === 1 || t === 2 ? t : 3 };
}
