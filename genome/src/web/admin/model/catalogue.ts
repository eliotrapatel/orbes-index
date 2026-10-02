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
  const active = f.status !== 'inactive';
  if (active !== m.active) out.active = active;
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
