/**
 * A model's Sizes in the console (plan NEXT-NINE, §3.4 AC-01; plan NEXT LOT §3.3), as pure functions the Lookbook page,
 * the Catalogue and the tests share:
 *
 *  - the size type (plan NEXT LOT §3.3): Ring size, Bracelet size, Necklace length, Watch (one size) or One size; « To
 *    give » until it is given (its sizes kept as they are), a variant without one still reading its main model's
 *    preselection (« Reads Ring size from MONOLITHE »). The Size type dialog preselects the type the model's size kind or
 *    the whole words of its Type point to (`preselectedType`), and says what giving it does (`sizeTypeLive`);
 *  - its declared sizes, each its own SKU: offered or set aside, flagged off its type's list or of the same measure as
 *    another (`sizeState`, `offListWarning`); the Sizes dialog ticks them from the type's list (`tickChanges`: what it
 *    adds, removes and sets aside); Remove and Reinstate, one size at a time (`removeDialog`, `reinstateDialog`);
 *  - the Catalogue's line under a model's Type (`catalogueSizeLine`), and ADD A VARIANT's line on the sizes it copies
 *    (`variantSizesLine`);
 *  - which saved size of a collector (YOUR SIZES) preselects the model's size, and the measures each of its sizes fits:
 *    a size's fit, in the type's unit (a French ring size, or centimetres), stored in whole millimetres; empty, the
 *    size's label itself is read (« By its label (52) »); what the server would refuse in the Edit dialog, said before
 *    anything is sent.
 *
 * The server checks everything again (services/sizes.ts); the lists, ranges and units are constants, never a setting.
 */
import { formatDate } from '../format.js';
import type { ModelSizeRow, ModelSizes, ModelSizesChange, SizeKind, SizeType } from '../types.js';

/** What each size kind (YOUR SIZES' preselection, next-nine) is called in the console. */
export const SIZE_KIND_NAMES: Readonly<Record<SizeKind, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  WRIST: 'Wrist (watches)',
  NECKLACE: 'Necklace length',
});

/** What each size type is called in the console's choices (plan NEXT LOT §3.3): a watch is one size. */
export const SIZE_TYPE_CHOICES: Readonly<Record<SizeType, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  NECKLACE: 'Necklace length',
  WATCH: 'Watch (one size)',
  ONE_SIZE: 'One size',
});

/** A size type in a sentence (as the server's SIZE_TYPE_WORDS): « not on the Ring size list ». */
export const SIZE_TYPE_WORDS: Readonly<Record<SizeType, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  NECKLACE: 'Necklace length',
  WATCH: 'Watch',
  ONE_SIZE: 'One size',
});

/** The section's Size type row, per type. */
export const SIZE_TYPE_LINES: Readonly<Record<SizeType, string>> = Object.freeze({
  RING: 'Ring size · French sizes 40 to 76',
  BRACELET: 'Bracelet size · 14 to 24 cm, by 0.5 cm',
  NECKLACE: 'Necklace length · 35 to 100 cm, by 1 cm',
  WATCH: 'Watch · one size',
  ONE_SIZE: 'One size',
});

/** The types whose sizes are ticked from a list. */
export const LISTED_SIZE_TYPES: readonly SizeType[] = Object.freeze(['RING', 'BRACELET', 'NECKLACE'] as const);

/** The `New model` dialog's Size type (plan NEXT LOT §3.3 item 6b): required, Choose first. */
export const NEW_MODEL_SIZE_TYPE = Object.freeze({
  options: Object.freeze([{ value: '', label: 'Choose' }, ...(Object.keys(SIZE_TYPE_CHOICES) as SizeType[]).map((t) => ({ value: t, label: SIZE_TYPE_CHOICES[t] }))]),
  hint: 'A ring’s, a bracelet’s or a necklace’s sizes are ticked next, on its page.',
});

/** The section's and its dialogs' words, as the plan has them. */
export const SIZES_TEXT = Object.freeze({
  intro: 'The sizes this model is made in. Each size is its own SKU, with its own stock in LOGISTICS, at 0 to begin with.',
  offers: 'New releases, supplier orders and the private salon offer only the sizes offered here.',
  lead: 'Which saved size of a collector preselects this model’s size, in I’LL BE THERE, the LIVE ready check and a salon request. The collector confirms it each time.',
  empty: 'No sizes yet. Give this model its size type, then tick its sizes.',
  toGive: 'To give',
  toGiveNote: 'Its sizes are kept as they are until you give it its type.',
  fitHint: 'Empty: the size’s label itself is read, for example 52 or 17.5 CM.',
  saved: 'Sizes saved.',
  tickText:
    'Tick the sizes this model is made in. A ticked size gets its SKU and its stock line in LOGISTICS, at 0. An unticked size is removed, or set aside when it has stock, orders or pieces: nothing new offers it, and it can be reinstated.',
  tickCaption: 'In centimetres.',
  tickThen: 'Then tick its sizes.',
  nothingChanges: 'Nothing changes.',
  leaveOne: 'Leave at least one size offered.',
  lastOffered: 'A model keeps at least one size offered.',
  reinstateText: 'New releases, supplier orders and the private salon offer it again.',
  removed: 'Size removed.',
  setAside: 'Size set aside.',
  reinstated: 'Size reinstated.',
});

/** ONE SIZE: a SKU without a label. */
export const ONE_SIZE_LABEL = 'ONE SIZE';

// ── The type's list (as services/sizes.ts) ─────────────────────────────────

/** Each listed type's measures in whole millimetres, and how they read (the server's SIZE_RANGES). */
const LIST_RANGES: Readonly<Record<'RING' | 'BRACELET' | 'NECKLACE', { min: number; max: number; step: number; cm: boolean }>> = Object.freeze({
  RING: { min: 40, max: 76, step: 1, cm: false },
  BRACELET: { min: 140, max: 240, step: 5, cm: true },
  NECKLACE: { min: 350, max: 1000, step: 10, cm: true },
});

const listed = (type: SizeType | null): type is 'RING' | 'BRACELET' | 'NECKLACE' => type !== null && (LISTED_SIZE_TYPES as readonly string[]).includes(type);

/** The sizes a type's model is ticked from: '40' to '76', '14', '14.5' to '24', '35' to '100'; none for the others. */
export function standardSizes(type: SizeType | null): string[] {
  if (!listed(type)) return [];
  const r = LIST_RANGES[type];
  const out: string[] = [];
  for (let mm = r.min; mm <= r.max; mm += r.step) out.push(String(r.cm ? mm / 10 : mm));
  return out;
}

const LABEL_RE = /^(?:SIZE\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(MM|CM)?$/;

/** The list's label a size's label reads as ('SIZE 52' → '52', '17,5 cm' → '17.5'), by its measure; null off the list. */
export function listEntryOf(type: SizeType | null, label: string | null | undefined): string | null {
  if (!listed(type) || typeof label !== 'string') return null;
  const m = LABEL_RE.exec(label.trim().toUpperCase());
  if (!m) return null;
  const r = LIST_RANGES[type];
  const n = Number(m[1]!.replace(',', '.'));
  const unit = m[2] ?? (r.cm ? 'CM' : 'MM');
  const mm = Math.round(unit === 'MM' ? n : n * 10);
  const entry = String(r.cm ? mm / 10 : mm);
  return standardSizes(type).includes(entry) ? entry : null;
}

/** A SKU's code as the server derives it (services/stock.ts deriveSku): the prefix, then the size. */
export function deriveSku(prefix: string, label?: string | null): string {
  const p = prefix.trim().toUpperCase();
  if (!label) return p.slice(0, 64);
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return (slug ? `${p}-${slug}` : p).slice(0, 64);
}

/** A size as a list names it: « 52 », or « ONE SIZE ». */
export const sizeText = (label: string | null): string => label ?? ONE_SIZE_LABEL;
/** A size as a sentence names it: « Size 52 », or « ONE SIZE ». */
export const sizeName = (label: string | null): string => (label === null ? ONE_SIZE_LABEL : `Size ${label}`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── The section ────────────────────────────────────────────────────────────

/** The Size type row: its line, or « To give » with its notes (a variant's main model's preselection first). */
export function sizeTypeRow(s: Pick<ModelSizes, 'sizeType' | 'inherited'>): { value: string; notes: string[] } {
  if (s.sizeType !== null) return { value: SIZE_TYPE_LINES[s.sizeType], notes: [] };
  return { value: SIZES_TEXT.toGive, notes: [...(s.inherited ? [`Reads ${SIZE_KIND_NAMES[s.inherited.sizeKind]} from ${s.inherited.from}`] : []), SIZES_TEXT.toGiveNote] };
}

/** The Sizes row: « 6 offered », and « · 1 set aside » when there are any. */
export function sizesCountLine(s: Pick<ModelSizes, 'offered' | 'setAside'>): string {
  return `${s.offered} offered${s.setAside > 0 ? ` · ${s.setAside} set aside` : ''}`;
}

/**
 * A size's State cell: Offered (flagged off its type's list, or of the same measure as another), or Set aside and when
 * (the console's formatDate, a UTC day as every console date; declared at the H1 hand-over for the owner to decide).
 */
export function sizeState(type: SizeType | null, row: Pick<ModelSizeRow, 'setAsideAt' | 'onList' | 'sameAs'>): string {
  if (row.setAsideAt !== null) return `Set aside · ${formatDate(row.setAsideAt)}`;
  if (type !== null && !row.onList) return `Offered · Not on the ${SIZE_TYPE_WORDS[type]} list`;
  if (row.sameAs !== null) return `Offered · Same measure as ${row.sameAs}`;
  return 'Offered';
}

/** Above the table: offered sizes off the given type's list; null when none (or no type). */
export function offListWarning(s: Pick<ModelSizes, 'sizeType' | 'sizes'>): string | null {
  if (s.sizeType === null) return null;
  const n = s.sizes.filter((r) => r.setAsideAt === null && !r.onList).length;
  if (n === 0) return null;
  return n === 1
    ? `1 size is not on the ${SIZE_TYPE_WORDS[s.sizeType]} list. It stays offered until you remove it.`
    : `${n} sizes are not on the ${SIZE_TYPE_WORDS[s.sizeType]} list. They stay offered until you remove them.`;
}

/** Whether the section offers Tick sizes: a ring, a bracelet, a necklace. */
export const canTick = (s: Pick<ModelSizes, 'sizeType'>): boolean => listed(s.sizeType);

// ── The Size type dialog ───────────────────────────────────────────────────

/** Its text, the single SKU a watch or a model of one size has computed from the model's prefix. */
export function sizeTypeText(prefix: string): string {
  return `A ring’s sizes are ticked from French sizes 40 to 76, a bracelet’s from 14 to 24 cm by 0.5 cm, a necklace’s from 35 to 100 cm by 1 cm. A watch, like a model of one size, has a single SKU: ${deriveSku(prefix)}.`;
}

/** Its choices: Choose first while the model has no type (a type, once given, is never cleared). */
export function sizeTypeOptions(current: SizeType | null): { value: string; label: string }[] {
  const types = (Object.keys(SIZE_TYPE_CHOICES) as SizeType[]).map((t) => ({ value: t, label: SIZE_TYPE_CHOICES[t] }));
  return current === null ? [{ value: '', label: 'Choose' }, ...types] : types;
}

const KIND_TYPE: Readonly<Record<SizeKind, SizeType>> = Object.freeze({ RING: 'RING', BRACELET: 'BRACELET', NECKLACE: 'NECKLACE', WRIST: 'WATCH' });
const TYPE_WORDS: readonly [string, SizeType][] = Object.freeze([
  ['RING', 'RING'],
  ['BRACELET', 'BRACELET'],
  ['CUFF', 'BRACELET'],
  ['BANGLE', 'BRACELET'],
  ['NECKLACE', 'NECKLACE'],
  ['PENDANT', 'NECKLACE'],
  ['WATCH', 'WATCH'],
] as const);

/**
 * The type the dialog starts on: the model's own; else the one its size kind points to (WRIST: a watch); else the whole
 * words of its Type (RING; BRACELET, CUFF, BANGLE; NECKLACE, PENDANT; WATCH: 'SIGNET RING' a ring, 'EARRING' none); else
 * '' (Choose).
 */
export function preselectedType(current: SizeType | null, kind: SizeKind | null, typeText: string | null | undefined): SizeType | '' {
  if (current !== null) return current;
  if (kind !== null) return KIND_TYPE[kind];
  const words = new Set((typeText ?? '').toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  for (const [word, type] of TYPE_WORDS) if (words.has(word)) return type;
  return '';
}

/** The live line under the field: what giving that type does, its offered sizes off the new list named. */
export function sizeTypeLive(s: Pick<ModelSizes, 'sizes'>, chosen: string, prefix: string): string[] {
  if (chosen === '') return [];
  const type = chosen as SizeType;
  const offered = s.sizes.filter((r) => r.setAsideAt === null);
  if (listed(type)) {
    const off = offered.filter((r) => listEntryOf(type, r.label) === null).map((r) => sizeText(r.label));
    if (off.length === 0) return [SIZES_TEXT.tickThen];
    const head = off.length === 1 ? `1 size is not on the ${SIZE_TYPE_WORDS[type]} list: ${off[0]}. It stays offered until you remove it.` : `${off.length} sizes are not on the ${SIZE_TYPE_WORDS[type]} list: ${off.join(', ')}. They stay offered until you remove them.`;
    return [SIZES_TEXT.tickThen, head];
  }
  const one = s.sizes.find((r) => r.label === null);
  const others = offered.some((r) => r.label !== null);
  return [`Its one size, ONE SIZE (SKU ${one?.code ?? deriveSku(prefix)}), is offered at once.${others ? ' Its other sizes stay offered until you remove them.' : ''}`];
}

/** The request the Size type dialog sends. */
export function sizeTypeChange(value: string): ModelSizesChange {
  return { sizeType: value as SizeType };
}

// ── The Sizes dialog (Tick sizes) ──────────────────────────────────────────

/** A box's field name in the grid. */
export const tickField = (label: string): string => `tick:${label}`;

/** The list's sizes ticked at first: those an offered size reads as. */
export function initiallyTicked(s: Pick<ModelSizes, 'sizeType' | 'sizes'>): Set<string> {
  return new Set(s.sizes.filter((r) => r.setAsideAt === null).map((r) => listEntryOf(s.sizeType, r.label)).filter((x): x is string => x !== null));
}

/** The list's sizes ticked in the dialog's values, in the list's order. */
export function tickedOf(list: readonly string[], values: Record<string, string>): string[] {
  return list.filter((l) => values[tickField(l)] === 'true');
}

/** What ticking `ticked` changes: the sizes added (created or reinstated), removed and set aside; the sizes left offered. */
export function tickChanges(s: Pick<ModelSizes, 'sizeType' | 'sizes' | 'list'>, ticked: readonly string[]): { adds: string[]; removes: string[]; setsAside: string[]; offeredAfter: number } {
  const before = initiallyTicked(s);
  const now = new Set(ticked);
  const adds = s.list.filter((l) => now.has(l) && !before.has(l));
  const removes = new Set<string>();
  const setsAside = new Set<string>();
  let takenOff = 0;
  for (const r of s.sizes) {
    if (r.setAsideAt !== null) continue;
    const entry = listEntryOf(s.sizeType, r.label);
    if (entry === null || now.has(entry)) continue;
    takenOff += 1;
    (r.used ? setsAside : removes).add(entry);
  }
  const offered = s.sizes.filter((r) => r.setAsideAt === null).length;
  const inList = (set: Set<string>) => s.list.filter((l) => set.has(l));
  return { adds, removes: inList(removes), setsAside: inList(setsAside), offeredAfter: offered - takenOff + adds.length };
}

/** The dialog's live line: « Adds 50, 54 · Removes 60 · Sets aside 58. », or « Nothing changes. » */
export function tickLine(c: { adds: string[]; removes: string[]; setsAside: string[] }): string {
  const parts = [
    c.adds.length ? `Adds ${c.adds.join(', ')}` : null,
    c.removes.length ? `Removes ${c.removes.join(', ')}` : null,
    c.setsAside.length ? `Sets aside ${c.setsAside.join(', ')}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? `${parts.join(' · ')}.` : SIZES_TEXT.nothingChanges;
}

/** What the server would refuse: no size left offered; nothing changed. */
export function tickProblem(c: { adds: string[]; removes: string[]; setsAside: string[]; offeredAfter: number }): string | null {
  if (c.offeredAfter <= 0) return SIZES_TEXT.leaveOne;
  if (c.adds.length + c.removes.length + c.setsAside.length === 0) return 'Nothing has changed.';
  return null;
}

// ── Remove and Reinstate ───────────────────────────────────────────────────

/** Remove's confirm dialog for one size: removed when nothing uses it, otherwise set aside (and the orders waiting for it). */
export function removeDialog(row: Pick<ModelSizeRow, 'label' | 'code' | 'used' | 'awaiting'>): { title: string; text: string[]; confirm: string } {
  const named = sizeName(row.label);
  const title = row.label === null ? `Remove ${ONE_SIZE_LABEL}` : `Remove size ${row.label}`;
  if (!row.used) return { title, text: [`${named} has no stock, order or piece: it is removed, with its SKU ${row.code}.`], confirm: 'Remove' };
  const text = [
    `${named} has stock, orders or pieces, so it is set aside. New releases, supplier orders and the private salon no longer offer it. Its stock, pieces, orders and history keep it, and you can reinstate it.`,
  ];
  if (row.awaiting > 0) {
    const of = row.label === null ? ONE_SIZE_LABEL : `size ${row.label}`;
    text.push(`${row.awaiting === 1 ? '1 order waits' : `${row.awaiting} orders wait`} for ${of}: once it is set aside, the supplier-order draft no longer orders it for them.`);
  }
  return { title, text, confirm: 'Set aside' };
}

/** Reinstate's confirm dialog. */
export function reinstateDialog(row: Pick<ModelSizeRow, 'label'>): { title: string; text: string; confirm: string } {
  return { title: row.label === null ? `Reinstate ${ONE_SIZE_LABEL}` : `Reinstate size ${row.label}`, text: SIZES_TEXT.reinstateText, confirm: 'Reinstate' };
}

/** Whether Remove is pressed on this size: an offered one, never the last offered. */
export function removable(s: Pick<ModelSizes, 'offered'>, row: Pick<ModelSizeRow, 'setAsideAt'>): boolean {
  return row.setAsideAt === null && s.offered > 1;
}

// ── The Catalogue and ADD A VARIANT ────────────────────────────────────────

/** The line under a model's Type in the Catalogue: its size type and how many sizes it offers, or that it is to give. */
export function catalogueSizeLine(m: { sizeType: SizeType | null; sizesOffered: number }): string {
  if (m.sizeType === null) return 'Size type to give';
  if (m.sizeType === 'WATCH') return 'Watch · one size';
  if (m.sizeType === 'ONE_SIZE') return 'One size';
  return `${SIZE_TYPE_WORDS[m.sizeType]} · ${plural(m.sizesOffered, 'size', 'sizes')}`;
}

/** ADD A VARIANT's first sentence (plan NEXT LOT §3.3 item 6: « and sizes »), the rest unchanged. */
export const VARIANT_IMPACT =
  'A model of its own, copied from this one: its type, collection, story, specifications, care and sizes. Its label, colour and SKU prefix are its own; its photographs come next, then its material, prices and publication, on its page. It stays hidden from THE COLLECTION until it is published.';

/** ADD A VARIANT's line on the sizes it copies (the main model's offered ones), its first SKU under the variant's prefix; null without one. */
export function variantSizesLine(s: Pick<ModelSizes, 'sizeType' | 'sizes'>, variantPrefix: string): string | null {
  const offered = s.sizes.filter((r) => r.setAsideAt === null);
  if (offered.length === 0) return null;
  if (s.sizeType === 'WATCH' || s.sizeType === 'ONE_SIZE') return 'Its one size is copied.';
  const labels = offered.map((r) => sizeText(r.label)).join(', ');
  const copied = s.sizeType === null ? `Its sizes are copied: ${labels}.` : `Its sizes are copied: ${SIZE_TYPE_WORDS[s.sizeType]}, ${labels}.`;
  return `${copied} Each gets its own SKU under its own prefix (${deriveSku(variantPrefix || '—', offered[0]!.label)}), at 0 in LOGISTICS. Change them on its page; later changes to this model never reach it.`;
}

/** The size mix's line when it proposes nothing, the model's offered sizes named when it has any. */
export function sizeMixEmptyLine(mix: { offered?: readonly string[] }): string {
  const among = mix.offered && mix.offered.length ? `, among ${mix.offered.join(' · ')}` : '';
  return `Nothing in stock and nothing the planner can tell apart yet: set the sizes by hand${among}.`;
}

/** A fit's bounds, in whole millimetres (skus_fit). */
const FIT_MM = Object.freeze({ min: 1, max: 1000 });

/** The kind that applies: the model's own, or a variant's main model's. */
export function effectiveKind(s: Pick<ModelSizes, 'sizeKind' | 'inherited'>): SizeKind | null {
  return s.sizeKind ?? s.inherited?.sizeKind ?? null;
}

/** The unit a kind's fit is typed in: centimetres, or a French ring size (no unit). */
const inCm = (kind: SizeKind) => kind !== 'RING';

/** Whole millimetres as the kind's unit reads them: 52, or 17.5 (centimetres). */
export function mmToUnit(kind: SizeKind, mm: number): string {
  return inCm(kind) ? String(mm / 10) : String(mm);
}

/** A size's Fits cell: '16 to 17.5 cm', '51 to 53', or 'By its label (52)'; ONE SIZE has none ('—'). */
export function fitsText(kind: SizeKind | null, row: Pick<ModelSizeRow, 'label' | 'fitMinMm' | 'fitMaxMm'>): string {
  if (row.label === null) return '—';
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
