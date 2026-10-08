/**
 * A model's variants in the console (plan NOCTURNE, N1), as pure functions the views and the tests share: a variant
 * IS a model, linked to its main model, with its label among the model's dots (« Steel ») and the dot's colour
 * (#RRGGBB). The main model carries its own label and colour too: it is one of the dots.
 *
 *  - how a model is named where one is chosen (« MONOLITHE · BRACELET · BLUE »), so that a model and its variants,
 *    which share a name, are told apart;
 *  - ADD A VARIANT: the dialog's values, what the server would refuse before anything is sent, the SKU prefix proposed
 *    (the main model's, its last part the label's first letters: MNL-ST, Blue → MNL-BL), the body sent;
 *  - a label and its colour changed on a model's page, together (a variant and a model with variants keep theirs).
 *
 * The server checks everything again (services/catalog.ts); this only says a mistake before it is sent.
 */
import { humanize } from '../format.js';
import type { Model, ModelChange, SizeType, VariantInput } from '../types.js';

/** A variant's label, at most (services/catalog.ts VARIANT_LABEL_MAX, models.variant_label's CHECK). */
export const VARIANT_LABEL_MAX = 40;
/** A SKU prefix, as the server holds it (createModel). */
const SKU_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SWATCH_RE = /^#?[0-9A-Fa-f]{6}$/;
/** The colour a new dot's picker opens on: the ash of /verify's secondary text. */
export const SWATCH_DEFAULT = '#a7a29a';

/** A model as a choice names it: its name and type, then its label when it has one (« MONOLITHE · BRACELET · BLUE »). */
export function modelChoice(m: Pick<Model, 'name' | 'type' | 'variantLabel'>, ...more: string[]): string {
  return [humanize(m.name), humanize(m.type), ...(m.variantLabel ? [humanize(m.variantLabel)] : []), ...more].join(' · ');
}

/**
 * What the Catalogue's row says of a model's place among variants: « VARIANT OF MONOLITHE · BLUE », « STEEL · 2
 * VARIANTS », its label alone, or nothing for a model without one.
 */
export function variantLine(m: Pick<Model, 'variantLabel' | 'variantOf' | 'variants'>): string | null {
  if (m.variantOf) return `Variant of ${humanize(m.variantOf.name)}${m.variantLabel ? ` · ${humanize(m.variantLabel)}` : ''}`;
  if (m.variants.length > 0) return `${m.variantLabel ? `${humanize(m.variantLabel)} · ` : ''}${m.variants.length} ${m.variants.length === 1 ? 'variant' : 'variants'}`;
  return m.variantLabel ? humanize(m.variantLabel) : null;
}

/** A label as the server keeps it: trimmed, runs of spaces kept to one. */
export function variantLabelText(v: string | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, ' ');
}

/** A colour as the server keeps it: `#RRGGBB` in capitals; null when it is not one. */
export function swatchOf(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (!SWATCH_RE.test(s)) return null;
  return `#${s.replace(/^#/, '').toUpperCase()}`;
}

/** What the server refuses in a label, or null. */
function labelProblem(v: string | undefined, whose: string): string | null {
  const s = variantLabelText(v);
  if (s === '') return `Give ${whose} a label: Steel.`;
  if (s.length > VARIANT_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(s)) return `A label is one line of 1 to ${VARIANT_LABEL_MAX} characters.`;
  return null;
}

/** The SKU prefix proposed for a new variant: the main model's, its last part the label's first two letters or digits. */
export function proposeVariantPrefix(main: Pick<Model, 'skuPrefix'>, label: string | undefined): string {
  const code = variantLabelText(label)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
  if (!code) return '';
  const cut = main.skuPrefix.lastIndexOf('-');
  return `${cut > 0 ? main.skuPrefix.slice(0, cut) : main.skuPrefix}-${code}`.slice(0, 32);
}

/** The labels a model and its variants hold, lower-cased: a new one is another. */
function takenLabels(main: Pick<Model, 'variantLabel' | 'variants'>): Set<string> {
  return new Set([main.variantLabel, ...main.variants.map((v) => v.label)].filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()));
}

/** The values ADD A VARIANT opens with. */
export function variantFormValues(main: Pick<Model, 'variantLabel' | 'variantSwatch'>): Record<string, string> {
  return {
    ...(main.variantLabel === null ? { mainLabel: '', mainSwatch: SWATCH_DEFAULT } : {}),
    label: '',
    swatch: SWATCH_DEFAULT,
    skuPrefix: '',
  };
}

/** What the server would refuse in ADD A VARIANT, or null. */
export function variantProblem(main: Pick<Model, 'skuPrefix' | 'variantLabel' | 'variants' | 'variantOf'>, v: Record<string, string>): string | null {
  if (main.variantOf) return 'This model is a variant: add the variant to its main model.';
  if (main.variantLabel === null) {
    const own = labelProblem(v.mainLabel, 'this model');
    if (own) return own;
    if (!swatchOf(v.mainSwatch)) return 'This model’s colour is #RRGGBB: choose it with the picker.';
  }
  const label = labelProblem(v.label, 'the variant');
  if (label) return label;
  if (!swatchOf(v.swatch)) return 'The variant’s colour is #RRGGBB: choose it with the picker.';
  const taken = takenLabels(main);
  if (main.variantLabel === null) taken.add(variantLabelText(v.mainLabel).toLowerCase());
  if (taken.has(variantLabelText(v.label).toLowerCase())) return 'This model or another of its variants already has this label.';
  const prefix = (v.skuPrefix ?? '').trim();
  if (!prefix || prefix.length > 32 || !SKU_PREFIX_RE.test(prefix)) return 'SKU prefix: 1 to 32 letters, digits, dots, underscores or hyphens.';
  if (prefix.toUpperCase() === main.skuPrefix.toUpperCase()) return 'A variant has its own SKU prefix.';
  return null;
}

/** What POST /api/admin/models/:id/variants sends, from values variantProblem accepted. */
export function variantInput(main: Pick<Model, 'variantLabel'> & { sizeType?: SizeType | null }, v: Record<string, string>): VariantInput {
  return {
    label: variantLabelText(v.label),
    swatch: swatchOf(v.swatch)!,
    skuPrefix: v.skuPrefix.trim().toUpperCase(),
    ...(main.variantLabel === null ? { mainLabel: variantLabelText(v.mainLabel), mainSwatch: swatchOf(v.mainSwatch)! } : {}),
    // Plan NEXT LOT §3.3 item 6: its size type when its main model has none (its main model's is copied otherwise).
    ...(main.sizeType === null && v.sizeType ? { sizeType: v.sizeType as SizeType } : {}),
  };
}

/** Whether a model keeps its label: a variant does, and a model with variants (each is one of the dots). */
export function keepsLabel(m: Pick<Model, 'variantOf' | 'variants'>): boolean {
  return m.variantOf !== null || m.variants.length > 0;
}

/** The values a model's label dialog opens with. */
export function dotFormValues(m: Pick<Model, 'variantLabel' | 'variantSwatch'>): Record<string, string> {
  return { label: m.variantLabel ?? '', swatch: (m.variantSwatch ?? SWATCH_DEFAULT).toLowerCase() };
}

/** What the server would refuse in a model's label and colour, or null; '' clears both on a model alone. */
export function dotProblem(m: Pick<Model, 'variantOf' | 'variants' | 'variantLabel' | 'variantSwatch'>, v: Record<string, string>, siblings: readonly string[]): string | null {
  const label = variantLabelText(v.label);
  if (label === '') {
    if (keepsLabel(m)) return 'A variant, and a model with variants, keep their label: each is one of the model’s dots.';
    return null;
  }
  const problem = labelProblem(label, 'the model');
  if (problem) return problem;
  if (!swatchOf(v.swatch)) return 'The colour is #RRGGBB: choose it with the picker.';
  if (siblings.some((s) => s.toLowerCase() === label.toLowerCase())) return 'This model or another of its variants already has this label.';
  return null;
}

/** What PATCH /api/admin/models/:id sends for a label and its colour: both, or null for both; {} when nothing changed. */
export function dotChange(m: Pick<Model, 'variantLabel' | 'variantSwatch'>, v: Record<string, string>): ModelChange {
  const label = variantLabelText(v.label);
  const next = label === '' ? { variantLabel: null, variantSwatch: null } : { variantLabel: label, variantSwatch: swatchOf(v.swatch) };
  return next.variantLabel === m.variantLabel && next.variantSwatch === m.variantSwatch ? {} : next;
}
