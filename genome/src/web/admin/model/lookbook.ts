/**
 * A model's lookbook in the console (P-R02, Catalogue → Lookbook,
 * `#/catalogue/:modelId`), as pure functions the view and the tests share:
 * its place (Hidden, Public, Reserved) and the address of its sheet, what
 * each says before it is saved, the specifications held to the server's rule
 * before they are sent, and the gallery's order.
 *
 * The server keeps the rules (CatalogService, MediaService): an address
 * another model has is 409 SLUG_TAKEN, and a published model's address never
 * changes (409 SLUG_LOCKED). The console says so before anything is sent.
 */
import { LOOKBOOK_SLUG_MAX, LOOKBOOK_SLUG_RE, specsProblem } from '../../shared/lookbook.js';
import { formatCount } from '../format.js';
import type { GalleryImage, LookbookState, Model, ModelChange } from '../types.js';

/** Mirrors the server's GALLERY_MAX (services/media.ts): the photographs of a gallery, beside the cover. */
export const GALLERY_MAX = 8;
/** Mirrors the server's GALLERY_ALT_MAX: a gallery photograph's alternative text, one line. */
export const GALLERY_ALT_MAX = 200;

export const LOOKBOOK_STATE_OPTIONS: readonly { value: LookbookState; label: string }[] = Object.freeze([
  { value: 'HIDDEN', label: 'Hidden — not in the lookbook' },
  { value: 'PUBLIC', label: 'Public — everyone, in THE COLLECTION' },
  { value: 'RESERVED', label: 'Reserved — the owners of an ORBES piece' },
]);

/** The public address of a model's sheet. */
export function sheetAddress(slug: string): string {
  return `/verify/lookbook/${slug}`;
}

/** An address proposed from the model's name: `MONOLITHE II` → `monolithe-ii` (accents dropped, words joined by hyphens). */
export function proposeSlug(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  let slug = '';
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > LOOKBOOK_SLUG_MAX) {
      // Whole words only, but never nothing: a first word longer than an address is cut.
      if (!slug) slug = w.slice(0, LOOKBOOK_SLUG_MAX);
      break;
    }
    slug = next;
  }
  return slug;
}

/** The Publication dialog's values (every control of a native form reads as a string). */
export interface PublicationForm {
  lookbook: string;
  slug: string;
}

/** The form the Publication dialog opens with: the model's place, and its address (proposed from its name when it has none). */
export function publicationForm(m: Model): PublicationForm {
  return { lookbook: m.lookbook, slug: m.slug ?? proposeSlug(m.name) };
}

/** What the server would refuse in the Publication dialog, said before anything is sent; null when it may be sent. */
export function publicationProblem(m: Model, f: PublicationForm): string | null {
  const slug = f.slug.trim().toLowerCase();
  if (m.publishedAt && slug !== (m.slug ?? '')) return 'The address of a model published in the lookbook never changes: links to its sheet are out.';
  if (slug && (slug.length > LOOKBOOK_SLUG_MAX || !LOOKBOOK_SLUG_RE.test(slug))) {
    return `The address is 1–${LOOKBOOK_SLUG_MAX} lower-case letters and digits, words joined by single hyphens: monolithe-ring.`;
  }
  if (f.lookbook !== 'HIDDEN' && !slug) return 'A model shown in the lookbook needs the address of its sheet.';
  return null;
}

/** What PATCH /api/admin/models/:id sends from the Publication dialog: only what differs ('' clears the address). */
export function publicationChange(m: Model, f: PublicationForm): ModelChange {
  const out: ModelChange = {};
  if (f.lookbook !== m.lookbook && (f.lookbook === 'HIDDEN' || f.lookbook === 'PUBLIC' || f.lookbook === 'RESERVED')) out.lookbook = f.lookbook;
  const slug = f.slug.trim().toLowerCase();
  if (slug !== (m.slug ?? '')) out.slug = slug;
  return out;
}

/** Said in the Publication dialog: where the model is shown, and what its first publication fixes. */
export function publicationImpact(m: Model): string {
  const first = m.publishedAt
    ? 'Its address is fixed since it was first published.'
    : 'Its address is fixed once it is first shown (Public or Reserved): choose it with care, links to its sheet will be shared.';
  return `Public: listed in THE COLLECTION on /verify for everyone, and named under the authentic results of its pieces. Reserved: listed for the owners of an ORBES piece only (its photographs stay public). Hidden: in neither. ${first}`;
}

/** The story's or the specifications' change: only when they differ, trimmed as the server keeps them ('' clears it). */
export function textChange(current: string | null, typed: string): string | null {
  const next = typed.replace(/\r\n?/g, '\n').trim();
  return next === (current ?? '') ? null : next;
}

export { specsProblem };

/** The alternative text the sheet gives a photograph whose own is empty (verify/copy.ts PHOTOS.modelAlt). */
export function defaultAlt(m: Pick<Model, 'name' | 'type'>): string {
  return `The ${[m.name, m.type].map((x) => x.trim().toUpperCase()).filter((x) => x.length > 0).join(' ')} model, photographed by ORBES`;
}

/** The gallery as PATCH /api/admin/models/:id/gallery takes it: every photograph once, in order, its alternative text ('' default). */
export function galleryOrder(gallery: readonly GalleryImage[]): { sha256: string; alt: string }[] {
  return [...gallery].sort((a, b) => a.position - b.position).map((g) => ({ sha256: g.sha256, alt: g.alt ?? '' }));
}

/** The gallery with the photograph at `index` moved by `delta` (−1 earlier, +1 later); unchanged at an end. */
export function galleryMoved(gallery: readonly GalleryImage[], index: number, delta: -1 | 1): { sha256: string; alt: string }[] {
  const order = galleryOrder(gallery);
  const to = index + delta;
  if (index < 0 || index >= order.length || to < 0 || to >= order.length) return order;
  const [item] = order.splice(index, 1);
  order.splice(to, 0, item!);
  return order;
}

/** The gallery with one photograph's alternative text replaced. */
export function galleryWithAlt(gallery: readonly GalleryImage[], sha256: string, alt: string): { sha256: string; alt: string }[] {
  return galleryOrder(gallery).map((g) => (g.sha256 === sha256 ? { sha256, alt: alt.trim() } : g));
}

/** Said before a photograph is added to the gallery: where it is shown, and how many places are left. */
export function galleryImpact(m: Model): string {
  const left = GALLERY_MAX - m.gallery.length;
  const where =
    m.lookbook === 'HIDDEN'
      ? 'Shown on the model’s sheet once it is in the lookbook'
      : `Shown at once on the model’s sheet (${m.lookbook === 'PUBLIC' ? 'everyone' : 'the owners of an ORBES piece'}), after its cover`;
  return `${where}, in the order of the gallery. ${left === 1 ? 'One place is left' : `${formatCount(left)} places are left`} of ${GALLERY_MAX}. Every photograph at /api/v1/media is public, as the result’s are.`;
}
