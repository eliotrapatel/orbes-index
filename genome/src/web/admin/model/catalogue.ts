/**
 * The catalogue's edits (A-10), as pure functions the view and the tests
 * share: what a model's change sends, how many issued pieces a change of a
 * model, a collection or a category touches, and the care block exactly as a
 * client reads it on /verify.
 *
 * A model's name, care instructions and collection, and a collection's name,
 * are read live by the public result of every piece issued with them: the
 * console says how many before anything is saved. Its category and SKU
 * prefix never change (the server refuses them).
 *
 * DISCONTINUED (P-R06): an ADMIN discontinues a model (inactive for good,
 * said DISCONTINUED with the year on the results of its pieces, its lookbook
 * sheet and their ownership certificates) and may reinstate it, each after a
 * typed phrase. A discontinued model's edit has no status: it is offered
 * again only by reinstating it.
 */
import { DEFAULT_CARE } from '../../shared/care.js';
import { formatCount } from '../format.js';
import type { Model, ModelChange } from '../types.js';

/** The edit dialog's values (every control of a native form reads as a string). */
export interface ModelForm {
  name: string;
  defaultMaterial: string;
  careInstructions: string;
  collectionId: string;
  /** `active` or `inactive`. */
  status: string;
}

export const MODEL_STATUS_OPTIONS: readonly { value: 'active' | 'inactive'; label: string }[] = Object.freeze([
  { value: 'active', label: 'Active — offered for new pieces' },
  { value: 'inactive', label: 'Inactive — no new piece' },
]);

/** The status of a model in the catalogue's list: DISCONTINUED (P-R06) before ACTIVE or INACTIVE. */
export function modelStatus(m: Pick<Model, 'active' | 'discontinuedAt'>): 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' {
  if (m.discontinuedAt) return 'DISCONTINUED';
  return m.active ? 'ACTIVE' : 'INACTIVE';
}

/** The year (UTC) a model was discontinued, as /verify says it (DISCONTINUED · 2027); null while it is not. */
export function discontinuedYear(m: Pick<Model, 'discontinuedAt'>): number | null {
  const y = m.discontinuedAt ? Number(/^(\d{4})-/.exec(m.discontinuedAt)?.[1]) : NaN;
  return Number.isInteger(y) ? y : null;
}

/** The phrase an ADMIN types to discontinue or reinstate a model: the action and its SKU prefix (unique, never changes). */
export function discontinuePhrase(action: 'discontinue' | 'reinstate', m: Pick<Model, 'skuPrefix'>): string {
  return `${action === 'discontinue' ? 'DISCONTINUE' : 'REINSTATE'} ${m.skuPrefix}`;
}

/** Said before a model is discontinued: what its pieces keep, what /verify says of them, what stops, and that it can be undone. */
export function discontinueImpact(m: Pick<Model, 'products' | 'active'>, year: number): string {
  const n = Number.isFinite(m.products) && m.products > 0 ? m.products : 0;
  return [
    n === 0 ? 'No piece has been issued with this model yet.' : `Its ${formatCount(n)} issued ${n === 1 ? 'piece keeps' : 'pieces keep'} verifying as before.`,
    `The result of each on /verify, its sheet in the lookbook and their ownership certificates say DISCONTINUED · ${year}.`,
    m.active ? 'No new piece can be issued with it, and the generator stops offering it.' : 'It stays inactive: no new piece can be issued with it.',
    'An ADMIN can reinstate it.',
  ].join(' ');
}

/** Said before a discontinued model is reinstated: it is offered again, and its pieces are no longer said DISCONTINUED. */
export function reinstateImpact(m: Pick<Model, 'discontinuedAt'>): string {
  const year = discontinuedYear(m);
  return [
    year === null ? 'Discontinued.' : `Discontinued in ${year}.`,
    'Reinstated, it is active again: the generator offers it for new pieces, and the results of its pieces, its sheet in the lookbook and their ownership certificates no longer say DISCONTINUED.',
  ].join(' ');
}

/** The form a model opens with. */
export function modelForm(m: Model): ModelForm {
  return {
    name: m.name,
    defaultMaterial: m.defaultMaterial ?? '',
    careInstructions: m.careInstructions ?? '',
    collectionId: m.collection?.id ?? '',
    status: m.active ? 'active' : 'inactive',
  };
}

/**
 * What PATCH /api/admin/models/:id sends: only the fields that differ from the model, trimmed as the server
 * keeps them ('' clears the material, the care instructions or the collection). Empty when nothing changed.
 */
export function modelChange(m: Model, f: ModelForm): ModelChange {
  const out: ModelChange = {};
  const name = f.name.trim();
  if (name !== m.name) out.name = name;
  const material = f.defaultMaterial.trim();
  if (material !== (m.defaultMaterial ?? '')) out.defaultMaterial = material;
  const care = f.careInstructions.trim();
  if (care !== (m.careInstructions ?? '')) out.careInstructions = care;
  if (f.collectionId !== (m.collection?.id ?? '')) out.collectionId = f.collectionId;
  // A discontinued model has no status to edit (P-R06): only Reinstate offers it again.
  const active = f.status !== 'inactive';
  if (!m.discontinuedAt && active !== m.active) out.active = active;
  return out;
}

function pieces(n: number): string {
  return `${formatCount(n)} issued ${n === 1 ? 'piece' : 'pieces'}`;
}

/**
 * Said before a model is saved: its name and care instructions reach every piece issued with it, and its collection
 * every such piece that has no collection of its own (product_overview reads the piece's collection, else the model's).
 */
export function modelImpact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return 'Touches no issued piece yet. The pieces issued with this model will read its name and care instructions on /verify, and its collection unless they have their own.';
  }
  return `Touches ${pieces(n)}: the result of each on /verify reads this model’s name and care instructions, and its collection unless the piece has its own, as soon as they are saved.`;
}

/**
 * Said before a category is deactivated or activated (ADMIN): how many pieces were issued in it, and that none of
 * their results changes; only new issuance stops or starts again. `active`: the category's state before the change.
 */
export function categoryImpact(n: number, active: boolean): string {
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  const issued = count === 0 ? null : `Its ${formatCount(count)} issued ${count === 1 ? 'piece keeps' : 'pieces keep'} verifying as before: no public result changes.`;
  if (active) {
    return [
      issued ?? 'No piece has been issued in this category yet.',
      'No new piece can be issued in it, and the generator stops offering it; it can be activated again.',
    ].join(' ');
  }
  return ['The category receives new pieces again: the generator offers it with its active models.', issued].filter(Boolean).join(' ');
}

/** Said before a collection is renamed: the name reaches every piece shown in it. */
export function collectionImpact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'Touches no issued piece yet.';
  return `Touches ${pieces(n)}: the result of each on /verify reads the new name as soon as it is saved.`;
}

/**
 * The care block as the client reads it (the CARE tab of /verify, verify/view-model.ts): the instructions as the
 * server keeps them (trimmed), or the general care text when there are none.
 */
export function carePreview(careInstructions: string | null | undefined): { text: string; general: boolean } {
  const care = (careInstructions ?? '').trim();
  return care ? { text: care, general: false } : { text: DEFAULT_CARE, general: true };
}
