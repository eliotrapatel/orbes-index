/**
 * A model's Sizes in the console (plan NEXT-NINE, §3.4 AC-01), as pure functions the Lookbook page and the tests share:
 * which saved size of a collector (YOUR SIZES) preselects the model's size, in I'LL BE THERE, the LIVE ready check and a
 * salon request, and the measures each of its sizes fits. The collector confirms it each time.
 *
 *  - the size type: None, Ring size, Bracelet size, Wrist (watches) or Necklace length; a variant set to None reads its
 *    main model's (« Reads Ring size from MONOLITHE »);
 *  - a size's fit, in the type's unit (a French ring size, or centimetres), stored in whole millimetres; empty, the
 *    size's label itself is read (« By its label (52) »);
 *  - what the server would refuse in the Edit dialog, said before anything is sent.
 *
 * The server checks everything again (services/sizes.ts); the ranges and units are constants, never a setting.
 */
import type { ModelSizeRow, ModelSizes, ModelSizesChange, SizeKind, SizeType } from '../types.js';

/** What each size type is called in the console. */
export const SIZE_KIND_NAMES: Readonly<Record<SizeKind, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  WRIST: 'Wrist (watches)',
  NECKLACE: 'Necklace length',
});

/** The Size type's choices, None first (the default). */
export const SIZE_KIND_OPTIONS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '', label: 'None' },
  ...(Object.keys(SIZE_KIND_NAMES) as SizeKind[]).map((k) => ({ value: k, label: SIZE_KIND_NAMES[k] })),
]);

/** What each size type is called in the console's choices (plan NEXT LOT §3.3): a watch is one size. */
export const SIZE_TYPE_CHOICES: Readonly<Record<SizeType, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  NECKLACE: 'Necklace length',
  WATCH: 'Watch (one size)',
  ONE_SIZE: 'One size',
});

/** The `New model` dialog's Size type (plan NEXT LOT §3.3 item 6b): required, Choose first. */
export const NEW_MODEL_SIZE_TYPE = Object.freeze({
  options: Object.freeze([{ value: '', label: 'Choose' }, ...(Object.keys(SIZE_TYPE_CHOICES) as SizeType[]).map((t) => ({ value: t, label: SIZE_TYPE_CHOICES[t] }))]),
  hint: 'A ring’s, a bracelet’s or a necklace’s sizes are ticked next, on its page.',
});

/** The section's words, as the plan has them. */
export const SIZES_TEXT = Object.freeze({
  lead: 'Which saved size of a collector preselects this model’s size, in I’LL BE THERE, the LIVE ready check and a salon request. The collector confirms it each time.',
  empty: 'No sizes yet. A model’s sizes appear here once a release or a piece names them.',
  fitHint: 'Empty: the size’s label itself is read, for example 52 or 17.5 CM.',
  saved: 'Sizes saved.',
});

/** A fit's bounds, in whole millimetres (skus_fit). */
const FIT_MM = Object.freeze({ min: 1, max: 1000 });

/** The kind that applies: the model's own, or a variant's main model's. */
export function effectiveKind(s: Pick<ModelSizes, 'sizeKind' | 'inherited'>): SizeKind | null {
  return s.sizeKind ?? s.inherited?.sizeKind ?? null;
}

/** The Size type row: its name, « Reads Ring size from MONOLITHE » for a variant without one, or None. */
export function sizeKindLine(s: Pick<ModelSizes, 'sizeKind' | 'inherited'>): string {
  if (s.sizeKind) return SIZE_KIND_NAMES[s.sizeKind];
  if (s.inherited) return `Reads ${SIZE_KIND_NAMES[s.inherited.sizeKind]} from ${s.inherited.from}`;
  return 'None';
}

/** The unit a kind's fit is typed in: centimetres, or a French ring size (no unit). */
const inCm = (kind: SizeKind) => kind !== 'RING';

/** Whole millimetres as the kind's unit reads them: 52, or 17.5 (centimetres). */
export function mmToUnit(kind: SizeKind, mm: number): string {
  return inCm(kind) ? String(mm / 10) : String(mm);
}

/** A size's Fits cell: '16 to 17.5 cm', '51 to 53', or 'By its label (52)'. */
export function fitsText(kind: SizeKind | null, row: Pick<ModelSizeRow, 'label' | 'fitMinMm' | 'fitMaxMm'>): string {
  if (kind !== null && row.fitMinMm !== null && row.fitMaxMm !== null) {
    return `${mmToUnit(kind, row.fitMinMm)} to ${mmToUnit(kind, row.fitMaxMm)}${inCm(kind) ? ' cm' : ''}`;
  }
  return `By its label (${row.label})`;
}

/** The Edit dialog's fields' label suffix: the type's unit. */
export function fitUnitLabel(kind: SizeKind): string {
  return inCm(kind) ? 'cm' : 'French size';
}

/** The Edit dialog's starting values, in the type's unit; empty without a fit. */
export function fitFormValues(kind: SizeKind, row: Pick<ModelSizeRow, 'fitMinMm' | 'fitMaxMm'>): { fitFrom: string; fitTo: string } {
  return {
    fitFrom: row.fitMinMm === null ? '' : mmToUnit(kind, row.fitMinMm),
    fitTo: row.fitMaxMm === null ? '' : mmToUnit(kind, row.fitMaxMm),
  };
}

/** A value typed in the kind's unit as whole millimetres ('17.5' or '17,5' cm → 175); null when empty; NaN when not a measure. */
function unitToMm(kind: SizeKind, v: string | undefined): number | null {
  const t = (v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const mm = inCm(kind) ? Number(t) * 10 : Number(t);
  return Math.abs(mm - Math.round(mm)) < 1e-6 ? Math.round(mm) : Number.NaN;
}

/** What the server would refuse in the Edit dialog, or null. */
export function fitProblem(kind: SizeKind, v: { fitFrom?: string; fitTo?: string }): string | null {
  const from = unitToMm(kind, v.fitFrom);
  const to = unitToMm(kind, v.fitTo);
  if ((from === null) !== (to === null)) return 'Give Fits from and Fits to, or neither.';
  if (from === null || to === null) return null;
  const unit = inCm(kind) ? 'a measure in centimetres, to the millimetre' : 'a whole size';
  for (const mm of [from, to]) {
    if (!Number.isFinite(mm) || mm < FIT_MM.min || mm > FIT_MM.max) return `A fit is ${unit}.`;
  }
  if (from > to) return 'Fits from is at most Fits to.';
  return null;
}

/** The request the Edit dialog sends for one size: its fit in whole millimetres, or none. */
export function fitChange(kind: SizeKind, row: Pick<ModelSizeRow, 'skuId'>, v: { fitFrom?: string; fitTo?: string }): ModelSizesChange {
  return { fits: [{ skuId: row.skuId, fitMinMm: unitToMm(kind, v.fitFrom), fitMaxMm: unitToMm(kind, v.fitTo) }] };
}

/** Whether the Edit dialog changes the size's fit. */
export function fitChanged(kind: SizeKind, row: Pick<ModelSizeRow, 'skuId' | 'fitMinMm' | 'fitMaxMm'>, v: { fitFrom?: string; fitTo?: string }): boolean {
  const f = fitChange(kind, row, v).fits![0]!;
  return f.fitMinMm !== row.fitMinMm || f.fitMaxMm !== row.fitMaxMm;
}

/** The request the Size type dialog sends: the kind chosen, '' for None. */
export function kindChange(value: string): ModelSizesChange {
  return { sizeKind: value === '' ? null : (value as SizeKind) };
}
