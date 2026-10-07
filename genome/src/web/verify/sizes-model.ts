/**
 * YOUR SIZES (plan NEXT-NINE, §3.4 AC-01), as pure functions the account sheet and the tests share: the four sizes a
 * collector keeps (a ring size, a bracelet size, a wrist for watches, a necklace length), the choices of each field,
 * how a size reads (`52`, `16.5 CM`), the row's line (`RING 52 · WRIST 16.5 CM`, or NOT SET), and the form's values
 * read back as the sizes PUT /api/v1/account/sizes takes (a ring size, centimetres; null: cleared).
 *
 * The ranges are the server's (services/sizes.ts SIZE_RANGES), never a setting: a ring 40 to 76 (French sizes), a
 * bracelet 14 to 24 cm and a wrist 12 to 24 cm by 0.5, a necklace 35 to 100 cm by 1.
 */
import { ACCOUNT_SIZES } from './copy.js';
import type { AccountSizes, SizeKind } from './types.js';

/** The kinds, in the order the view and the row's line read them. */
export const SIZE_KINDS: readonly SizeKind[] = Object.freeze(['RING', 'BRACELET', 'WRIST', 'NECKLACE']);

/** Each kind's range in its unit (a French ring size; centimetres) and its step. */
export const SIZE_RANGES: Readonly<Record<SizeKind, Readonly<{ min: number; max: number; step: number; cm: boolean }>>> = Object.freeze({
  RING: Object.freeze({ min: 40, max: 76, step: 1, cm: false }),
  BRACELET: Object.freeze({ min: 14, max: 24, step: 0.5, cm: true }),
  WRIST: Object.freeze({ min: 12, max: 24, step: 0.5, cm: true }),
  NECKLACE: Object.freeze({ min: 35, max: 100, step: 1, cm: true }),
});

/** No size saved: the sheet's sizes before they are read, and after every one is cleared. */
export const NO_SIZES: Readonly<AccountSizes> = Object.freeze({ RING: null, BRACELET: null, WRIST: null, NECKLACE: null });

/** A size as the collector reads it: `52`, or `16.5 CM`. */
export function sizeText(kind: SizeKind, value: number): string {
  return SIZE_RANGES[kind].cm ? `${value} CM` : String(value);
}

/** One field's choices: NOT SET (value ''), then every size of its range, each as it reads (`16.5 CM`). */
export function sizeOptions(kind: SizeKind): { value: string; label: string }[] {
  const r = SIZE_RANGES[kind];
  const out: { value: string; label: string }[] = [{ value: '', label: ACCOUNT_SIZES.notSet }];
  // Whole tenths, so that 0.5 steps add up exactly.
  for (let t = Math.round(r.min * 10); t <= Math.round(r.max * 10); t += Math.round(r.step * 10)) {
    const v = t / 10;
    out.push({ value: String(v), label: sizeText(kind, v) });
  }
  return out;
}

/** The row's line: each size saved as `RING 52`, in the order ring, bracelet, wrist, necklace, joined by ' · '; NOT SET for none. */
export function sizesSummary(sizes: Readonly<AccountSizes> | null): string {
  const parts = SIZE_KINDS.flatMap((k) => {
    const v = sizes?.[k];
    return typeof v === 'number' ? [`${ACCOUNT_SIZES.short[k]} ${sizeText(k, v)}`] : [];
  });
  return parts.length ? parts.join(' · ') : ACCOUNT_SIZES.notSet;
}

/** A field's value for a size saved ('' for none, or a value its range does not hold). */
export function sizeFieldValue(kind: SizeKind, value: number | null | undefined): string {
  if (typeof value !== 'number') return '';
  return sizeOptions(kind).some((o) => o.value === String(value)) ? String(value) : '';
}

/** The form's values read back as the sizes to save: each a number, or null (NOT SET). */
export function sizesFromForm(values: Readonly<Record<SizeKind, string>>): AccountSizes {
  const out = { ...NO_SIZES } as AccountSizes;
  for (const k of SIZE_KINDS) {
    const v = (values[k] ?? '').trim();
    const n = v === '' ? null : Number(v);
    out[k] = n !== null && Number.isFinite(n) ? n : null;
  }
  return out;
}

/** Each field's label and hint (only the unit: no guide to measuring). */
export const SIZE_FIELDS: readonly { kind: SizeKind; label: string; hint: string }[] = Object.freeze([
  { kind: 'RING', label: ACCOUNT_SIZES.ring, hint: ACCOUNT_SIZES.ringHint },
  { kind: 'BRACELET', label: ACCOUNT_SIZES.bracelet, hint: ACCOUNT_SIZES.cmHint },
  { kind: 'WRIST', label: ACCOUNT_SIZES.wrist, hint: ACCOUNT_SIZES.cmHint },
  { kind: 'NECKLACE', label: ACCOUNT_SIZES.necklace, hint: ACCOUNT_SIZES.cmHint },
]);
