/**
 * Standard boxes and weights in the console (macro scope of 2026-10-20, D16 B1 and B2; lot M3 plan §1.3): pure helpers,
 * no DOM.
 *
 *  - Orders → Settings → Boxes: the words, a box's sides, weight, cost and state as the table reads them, and its
 *    dialog's checks (the bounds of migration 0054, the 95 × 62 mm certificate card taken flat in either orientation)
 *    and what it sends (only what changed on an edit; the cost and its currency together).
 *  - A model's Packing: its box and packed weight, its own or (a variant) its main model's, « As MONOLITHE » in the box
 *    select, the packed weight's check, and the Catalogue's Box cell.
 *  - A parcel's Packing: the box to use with its source line, THE PARCEL'S WEIGHT or what it misses, the values recorded
 *    at PACKED, and CHANGE BOX's options. Never a cost: the agent reads these.
 * The server stays the authority (422 BOX_TOO_SMALL_FOR_CARD, 409 BOX_NAME_TAKEN, BOX_IN_USE, BOX_SET_ASIDE).
 */
import { formatCount } from '../format.js';
import { BOX_COST_MINOR_MAX, BOX_EMPTY_WEIGHT_G_MAX, BOX_INSIDE_MM_MAX, BOX_NAME_MAX, CERTIFICATE_CARD_MM, PACKED_WEIGHT_G_MAX } from '../types.js';
import type { BoxInput, BoxRef, BoxView, Model, ModelPacking, ParcelPacking } from '../types.js';
import { formatMoney, parseMoney } from './live.js';

/** The bounds of a box and a packed weight (migration 0054, mirrored in types.ts). */
export const BOX_LIMITS = Object.freeze({ name: BOX_NAME_MAX, insideMm: BOX_INSIDE_MM_MAX, emptyWeightG: BOX_EMPTY_WEIGHT_G_MAX, costMinor: BOX_COST_MINOR_MAX, packedWeightG: PACKED_WEIGHT_G_MAX });

/** The certificate card's rule, as the box dialog says it under the sides. */
export const CARD_RULE = `Inside, it must take the ${CERTIFICATE_CARD_MM.long} × ${CERTIFICATE_CARD_MM.short} mm certificate card flat.`;

// ── Orders → Settings → Boxes ──────────────────────────────────────────────

export const BOXES_TEXT = Object.freeze({
  lead: 'The house’s boxes. Each model is given its box on its page; Logistics then reads, on every parcel, the box to use and the parcel’s weight.',
  empty: 'No box yet. Add your boxes: each model is then given its box.',
  add: 'New box',
  addTitle: 'New box',
  editTitle: 'Edit the box',
  eyebrow: 'Settings · Boxes',
  added: 'Box added.',
  saved: 'Box saved.',
  unchanged: 'Nothing has changed.',
  costHint: 'Optional. What one box costs, in units: 1.20, or 12.',
  currencyHint: 'With a cost: any currency with cents, such as EUR, GBP, USD or CHF.',
  setAsideTitle: 'Set the box aside',
  setAsideText: 'It is no longer offered for a model or a parcel. The parcels packed in it keep it. A model that packs in it needs another box first.',
  setAside: 'Set aside',
  setAsideDone: 'Box set aside.',
  reinstateTitle: 'Reinstate the box',
  reinstateText: 'It is offered again for the models and the parcels.',
  reinstate: 'Reinstate',
  reinstateDone: 'Box reinstated.',
});

/** A box's inside sides: `120 × 90 × 40 mm`. */
export function boxSides(b: Pick<BoxRef, 'insideLengthMm' | 'insideWidthMm' | 'insideHeightMm'>): string {
  return `${formatCount(b.insideLengthMm)} × ${formatCount(b.insideWidthMm)} × ${formatCount(b.insideHeightMm)} mm`;
}

/** Grams as the console reads them: `1 240 g`. */
export function grams(n: number): string {
  return `${formatCount(n)} g`;
}

/** A box's cost, or '—'. */
export function boxCostText(b: Pick<BoxView, 'costMinor' | 'currency'>): string {
  return b.costMinor === null || !b.currency ? '—' : formatMoney(b.costMinor, b.currency);
}

/** A box's state as its mark reads. */
export function boxState(b: Pick<BoxRef, 'active'>): 'ACTIVE' | 'SET ASIDE' {
  return b.active ? 'ACTIVE' : 'SET ASIDE';
}

/** A box named with its sides, and SET ASIDE when it is: `CUBE 80 · 120 × 90 × 40 mm`. */
export function boxWords(b: Pick<BoxRef, 'name' | 'insideLengthMm' | 'insideWidthMm' | 'insideHeightMm' | 'active'>): string {
  return `${b.name} · ${boxSides(b)}${b.active ? '' : ' · SET ASIDE'}`;
}

/** A box named with its sides, whatever its state: what a parcel packed in it recorded, and its slip. */
export function boxPlain(b: Pick<BoxRef, 'name' | 'insideLengthMm' | 'insideWidthMm' | 'insideHeightMm'>): string {
  return `${b.name} · ${boxSides(b)}`;
}

/** Whether inside sides take the certificate card flat, in either orientation (`boxes_card_fits`). */
export function cardFits(lengthMm: number, widthMm: number): boolean {
  return Math.max(lengthMm, widthMm) >= CERTIFICATE_CARD_MM.long && Math.min(lengthMm, widthMm) >= CERTIFICATE_CARD_MM.short;
}

export type BoxForm = Record<'name' | 'insideLengthMm' | 'insideWidthMm' | 'insideHeightMm' | 'emptyWeightG' | 'cost' | 'currency', string>;

/** The box dialog's values as it opens: the box's, or empty for a new one. */
export function boxFormValues(b: BoxView | null): BoxForm {
  return {
    name: b?.name ?? '',
    insideLengthMm: b ? String(b.insideLengthMm) : '',
    insideWidthMm: b ? String(b.insideWidthMm) : '',
    insideHeightMm: b ? String(b.insideHeightMm) : '',
    emptyWeightG: b ? String(b.emptyWeightG) : '',
    cost: b && b.costMinor !== null ? moneyText(b.costMinor) : '',
    currency: b?.currency ?? '',
  };
}

/** Cents as a field shows them: `12`, `1.20`. */
function moneyText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** A whole number typed (spaces allowed) within its bounds; null otherwise. */
function whole(text: string | undefined, min: number, max: number): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

const SIDES = [
  ['insideLengthMm', 'The inside length'],
  ['insideWidthMm', 'The inside width'],
  ['insideHeightMm', 'The inside height'],
] as const;

/** The box dialog's check: what the server would refuse, said before anything is sent. */
export function boxProblem(v: Partial<BoxForm>): string | null {
  const name = (v.name ?? '').trim();
  if (!name) return 'Name the box.';
  if (name.length > BOX_LIMITS.name) return `A name has at most ${BOX_LIMITS.name} characters.`;
  if (/[\r\n]/.test(name)) return 'A name holds on one line.';
  for (const [field, label] of SIDES) {
    if (whole(v[field], 1, BOX_LIMITS.insideMm) === null) return `${label} is a whole number of millimetres, 1 to ${formatCount(BOX_LIMITS.insideMm)}.`;
  }
  if (!cardFits(whole(v.insideLengthMm, 1, BOX_LIMITS.insideMm)!, whole(v.insideWidthMm, 1, BOX_LIMITS.insideMm)!)) {
    return `This box cannot take the ${CERTIFICATE_CARD_MM.long} × ${CERTIFICATE_CARD_MM.short} mm certificate card flat.`;
  }
  if (whole(v.emptyWeightG, 1, BOX_LIMITS.emptyWeightG) === null) return `The empty weight is a whole number of grams, 1 to ${formatCount(BOX_LIMITS.emptyWeightG)}.`;
  const cost = (v.cost ?? '').trim();
  const currency = (v.currency ?? '').trim();
  if (cost !== '') {
    const minor = parseMoney(cost);
    if (minor === null || minor > BOX_LIMITS.costMinor) return 'A cost reads 1.20, or 12.';
    if (!/^[A-Za-z]{3}$/.test(currency)) return 'A cost needs its currency, a three-letter code such as EUR.';
  } else if (currency !== '') return 'Enter the cost, or leave the currency empty.';
  return null;
}

/** What the box dialog sends to add a box (its values checked by `boxProblem`). */
export function boxInput(v: BoxForm): Required<BoxInput> {
  const cost = v.cost.trim();
  return {
    name: v.name.trim(),
    insideLengthMm: whole(v.insideLengthMm, 1, BOX_LIMITS.insideMm)!,
    insideWidthMm: whole(v.insideWidthMm, 1, BOX_LIMITS.insideMm)!,
    insideHeightMm: whole(v.insideHeightMm, 1, BOX_LIMITS.insideMm)!,
    emptyWeightG: whole(v.emptyWeightG, 1, BOX_LIMITS.emptyWeightG)!,
    costMinor: cost === '' ? null : parseMoney(cost),
    currency: cost === '' ? null : v.currency.trim().toUpperCase(),
  };
}

/** What Edit sends: only what differs from the box, the cost and its currency together; null when nothing does. */
export function boxChange(b: BoxView, v: BoxForm): BoxInput | null {
  const next = boxInput(v);
  const out: BoxInput = {};
  if (next.name !== b.name) out.name = next.name;
  if (next.insideLengthMm !== b.insideLengthMm) out.insideLengthMm = next.insideLengthMm;
  if (next.insideWidthMm !== b.insideWidthMm) out.insideWidthMm = next.insideWidthMm;
  if (next.insideHeightMm !== b.insideHeightMm) out.insideHeightMm = next.insideHeightMm;
  if (next.emptyWeightG !== b.emptyWeightG) out.emptyWeightG = next.emptyWeightG;
  if (next.costMinor !== b.costMinor || next.currency !== b.currency) {
    out.costMinor = next.costMinor;
    out.currency = next.currency;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── A model's Packing ──────────────────────────────────────────────────────

export const MODEL_PACKING_TEXT = Object.freeze({
  title: 'Packing',
  lead: 'The box its pieces are packed in, and their packed weight. Logistics reads both on every parcel: the box to use, and the parcel’s weight.',
  weightHint: 'The piece as it is packed, with its pouch and card, without the box.',
  none: 'None',
  noBox: 'No box yet.',
  noWeight: 'Not set',
  noBoxes: 'No box yet: add the house’s boxes in Orders → Settings first.',
  saved: 'Packing saved.',
  unchanged: 'Nothing has changed.',
});

/** « As MONOLITHE »: a variant's choice to read its main model's. */
export function asMain(name: string): string {
  return `As ${name}`;
}

/** The main model a variant reads its packing from, by name; null for a model alone or a main model. */
function mainOf(m: Pick<Model, 'packing' | 'variantOf'>): string | null {
  return m.packing.inherited?.from.name ?? m.variantOf?.name ?? null;
}

/** The model page's BOX row: its box with its sides, and « As MONOLITHE, its main model. » when it reads that one's. */
export function modelBoxRow(m: Pick<Model, 'packing' | 'variantOf'>): { value: string; note: string | null } {
  const p = m.packing;
  const note = p.inherited?.box ? `${asMain(p.inherited.from.name)}, its main model.` : null;
  return { value: p.box ? boxWords(p.box) : MODEL_PACKING_TEXT.noBox, note };
}

/** The model page's PACKED WEIGHT row: grams, or Not set; « As MONOLITHE, its main model. » when it reads that one's. */
export function modelWeightRow(m: Pick<Model, 'packing' | 'variantOf'>): { value: string; note: string } {
  const p = m.packing;
  return {
    value: p.packedWeightG === null ? MODEL_PACKING_TEXT.noWeight : grams(p.packedWeightG),
    note: p.inherited?.packedWeightG ? `${asMain(p.inherited.from.name)}, its main model.` : MODEL_PACKING_TEXT.weightHint,
  };
}

/** The Packing dialog's values as it opens: the model's own box and weight, '' for none (or its main model's). */
export function packingFormValues(m: Pick<Model, 'packing'>): { boxId: string; packedWeightG: string } {
  const p = m.packing;
  return {
    boxId: p.box && !p.inherited?.box ? p.box.id : '',
    packedWeightG: p.packedWeightG !== null && !p.inherited?.packedWeightG ? String(p.packedWeightG) : '',
  };
}

/**
 * The BOX select: « None » (a variant: « As MONOLITHE ») first, its value '', then the active boxes by name, and the
 * model's own box even when it is set aside (so a box kept is not lost).
 */
export function packingBoxOptions(boxes: readonly BoxRef[], m: Pick<Model, 'packing' | 'variantOf'>): { value: string; label: string }[] {
  const main = mainOf(m);
  const own = packingFormValues(m).boxId;
  return [
    { value: '', label: main ? asMain(main) : MODEL_PACKING_TEXT.none },
    ...boxes.filter((b) => b.active || b.id === own).map((b) => ({ value: b.id, label: boxWords(b) })),
  ];
}

/** The packed weight's check: empty (none, or the main model's), or whole grams within the bound. */
export function packingProblem(v: Record<string, string>): string | null {
  const t = (v.packedWeightG ?? '').trim();
  if (t !== '' && whole(t, 1, BOX_LIMITS.packedWeightG) === null) return `The packed weight is a whole number of grams, 1 to ${formatCount(BOX_LIMITS.packedWeightG)}.`;
  return null;
}

/** What the Packing dialog sends (PUT /api/admin/models/:id/packing): both fields, null for none. */
export function packingInput(v: Record<string, string>): { boxId: string | null; packedWeightG: number | null } {
  const t = (v.packedWeightG ?? '').trim();
  return { boxId: v.boxId ? v.boxId : null, packedWeightG: t === '' ? null : whole(t, 1, BOX_LIMITS.packedWeightG) };
}

/** Whether the Packing dialog changes anything. */
export function packingChanged(m: Pick<Model, 'packing'>, v: Record<string, string>): boolean {
  const before = packingFormValues(m);
  const after = packingInput(v);
  return (after.boxId ?? '') !== before.boxId || (after.packedWeightG === null ? '' : String(after.packedWeightG)) !== before.packedWeightG;
}

/** The Catalogue's Box cell: the box's name ('—' when none), and « As MONOLITHE » under it when it is the main model's. */
export function catalogueBoxCell(m: Pick<Model, 'packing'>): { value: string; sub: string | null } {
  const p = m.packing;
  return { value: p.box ? p.box.name : '—', sub: p.box && p.inherited?.box ? asMain(p.inherited.from.name) : null };
}

// ── A parcel's Packing ─────────────────────────────────────────────────────

export const PARCEL_BOX_TEXT = Object.freeze({
  box: 'Box',
  weight: 'The parcel’s weight',
  noBox: 'None yet',
  noneRecorded: 'None recorded',
  notRecorded: 'Not recorded',
  recorded: 'As recorded when the parcel was packed.',
  weightNote: 'The box’s empty weight and each piece as it is packed.',
  change: 'Change box',
  changeTitle: 'Change the box',
  changeText: 'Another of the house’s boxes for this parcel. The parcel’s weight follows it.',
  changed: 'Box changed.',
  unchanged: 'Nothing has changed.',
});

/** Words joined as a sentence says them: `A`, `A and B`, `A, B and C`. */
export function joinWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** « No box is set for MONOLITHE · Steel: choose one. » */
export function noBoxLine(models: readonly string[]): string {
  return models.length ? `No box is set for ${joinWords(models)}: choose one.` : 'No box is set: choose one.';
}

/** Where the box to use comes from, as its line says it. */
export function boxSourceLine(p: Pick<ParcelPacking, 'box' | 'boxSource' | 'pieces' | 'modelsWithoutBox'>): string {
  if (!p.box) return noBoxLine(p.modelsWithoutBox);
  const source =
    p.boxSource === 'CHOSEN'
      ? 'Chosen while packing.'
      : p.boxSource === 'LARGEST'
        ? 'The largest of the pieces’ boxes: check the fit.'
        : p.pieces > 1
          ? 'Every piece’s box.'
          : 'The piece’s box.';
  return p.boxSource !== 'CHOSEN' && p.modelsWithoutBox.length ? `${source} No box is set for ${joinWords(p.modelsWithoutBox)}.` : source;
}

/** The parcel's BOX row: the box with its sides and its source line; once packed, the box recorded. */
export function parcelBoxRow(p: ParcelPacking): { value: string; note: string | null } {
  if (p.recorded) return p.box ? { value: boxPlain(p.box), note: PARCEL_BOX_TEXT.recorded } : { value: PARCEL_BOX_TEXT.noneRecorded, note: null };
  return { value: p.box ? boxWords(p.box) : PARCEL_BOX_TEXT.noBox, note: boxSourceLine(p) };
}

const OVER = /^over (\d+) g$/;

/** What a weight misses: « Unknown: no weight for MONOLITHE and ORBITE, and no box ». */
export function missingLine(missing: readonly string[]): string {
  const models = missing.filter((m) => m !== 'box' && !OVER.test(m));
  const over = missing.map((m) => OVER.exec(m)).find((x) => x !== null);
  const parts = [
    ...(models.length ? [`no weight for ${joinWords(models)}`] : []),
    ...(missing.includes('box') ? ['no box'] : []),
    ...(over ? [`over ${grams(Number(over[1]))}`] : []),
  ];
  return `Unknown: ${parts.length <= 1 ? (parts[0] ?? 'not computed') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`}`;
}

/** THE PARCEL'S WEIGHT: grams, or what it misses; once packed, as recorded (a parcel packed before boxes: Not recorded). */
export function parcelWeightRow(p: ParcelPacking): { value: string; note: string | null } {
  const value = p.weightG !== null ? grams(p.weightG) : p.missing.length ? missingLine(p.missing) : p.recorded ? PARCEL_BOX_TEXT.notRecorded : missingLine([]);
  return { value, note: p.recorded ? (p.weightG !== null || p.missing.length ? PARCEL_BOX_TEXT.recorded : null) : PARCEL_BOX_TEXT.weightNote };
}

/** CHANGE BOX's options: the active boxes, each with its sides. */
export function changeBoxOptions(p: Pick<ParcelPacking, 'boxes'>): { value: string; label: string }[] {
  return p.boxes.map((b) => ({ value: b.id, label: boxWords(b) }));
}

/** The packing slip's box and weight: the box with its sides (« To be chosen » without one), and the weight's words. */
export function slipParcel(p: ParcelPacking): { box: string; weight: string } {
  return { box: p.box ? boxPlain(p.box) : p.recorded ? PARCEL_BOX_TEXT.noneRecorded : 'To be chosen', weight: parcelWeightRow(p).value };
}
