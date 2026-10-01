/**
 * ORBES canonical product identity.
 *
 * Text form  `O{YY}-{C}-{NNNNN}`, e.g. `O26-J-00184`:
 *   YY     production year − 2000, two digits
 *   C      category code, one letter A–Z, resolved through the category registry
 *   NNNNN  serial, zero-padded to at least 5 digits (1..999 999)
 *
 * Packed form (u32, big-endian when serialised): `yy:7 | category:5 | serial:20`.
 * The packed form is what the signed CODE-01 payload carries and what GENOME-01
 * permutes, so both representations must be bijective with the validated
 * identity. That is why parsing is strict: every identity has exactly one
 * accepted spelling, and a lookalike string (lowercase, missing padding, extra
 * leading zero, stray whitespace) is an error rather than an alias.
 *
 * Category letters are NOT hardcoded here: the registry owns them and maps each
 * letter to an immutable 5-bit index. Only the index enters the packed form.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

export interface ProductIdentity {
  /** 2000..2099 */
  year: number;
  /** 1..31 (0 reserved) */
  categoryIndex: number;
  /** 1..999 999 */
  serial: number;
}

export interface CategoryInfo {
  /** Single letter A–Z. */
  code: string;
  /** Immutable 5-bit index 1..31. */
  index: number;
  name: string;
}

export interface CategoryResolver {
  byCode(code: string): CategoryInfo | undefined;
  byIndex(index: number): CategoryInfo | undefined;
}

export class IdentityError extends Error {
  override readonly name = 'IdentityError';
}

const YEAR_BASE = 2000;
const YEAR_MAX = 2099;
const CATEGORY_INDEX_MAX = 31;
const SERIAL_MAX = 999_999;
const SERIAL_MIN_DIGITS = 5;

const CATEGORY_SHIFT = 2 ** 20;
const YEAR_SHIFT = 2 ** 25;
const SERIAL_MASK = 0xfffff;
const CATEGORY_MASK = 0x1f;

const CATEGORY_CODE = /^[A-Z]$/;
const PRODUCT_ID = /^O(\d{2})-([A-Z])-(\d{5,6})$/;

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function assertValidIdentity(id: ProductIdentity): void {
  if (id === null || typeof id !== 'object') throw new IdentityError('identity must be an object');
  if (!isIntInRange(id.year, YEAR_BASE, YEAR_MAX)) throw new IdentityError(`year ${id.year} is outside ${YEAR_BASE}..${YEAR_MAX}`);
  if (!isIntInRange(id.categoryIndex, 1, CATEGORY_INDEX_MAX)) {
    throw new IdentityError(`category index ${id.categoryIndex} is outside 1..${CATEGORY_INDEX_MAX}`);
  }
  if (!isIntInRange(id.serial, 1, SERIAL_MAX)) throw new IdentityError(`serial ${id.serial} is outside 1..${SERIAL_MAX}`);
}

/** u32: (year − 2000) << 25 | categoryIndex << 20 | serial. Throws IdentityError on out-of-range fields. */
export function packIdentity(id: ProductIdentity): number {
  assertValidIdentity(id);
  // Multiplication instead of `<<`: years ≥ 2064 set bit 31, which `<<` would turn negative.
  return (id.year - YEAR_BASE) * YEAR_SHIFT + id.categoryIndex * CATEGORY_SHIFT + id.serial;
}

/**
 * Inverse of packIdentity. The packed space has more values than valid
 * identities (years 2100..2127, category 0, serials 0 and > 999 999); those are
 * rejected so that a decoded payload can never name an identity that could not
 * have been issued.
 */
export function unpackIdentity(packed: number): ProductIdentity {
  if (!isIntInRange(packed, 0, 0xffffffff)) throw new IdentityError(`packed identity ${packed} is not a u32`);
  const id: ProductIdentity = {
    year: YEAR_BASE + Math.floor(packed / YEAR_SHIFT),
    categoryIndex: Math.floor(packed / CATEGORY_SHIFT) & CATEGORY_MASK,
    serial: packed & SERIAL_MASK,
  };
  assertValidIdentity(id);
  return id;
}

function resolveByIndex(index: number, resolver: CategoryResolver): CategoryInfo {
  const info = resolver.byIndex(index);
  // The resolver is external data (the category registry): re-check what it returns.
  if (!info || info.index !== index || !CATEGORY_CODE.test(info.code)) {
    throw new IdentityError(`no category with index ${index}`);
  }
  return info;
}

/** Canonical text form, e.g. `O26-J-00184`. */
export function formatProductId(id: ProductIdentity, resolver: CategoryResolver): string {
  assertValidIdentity(id);
  const { code } = resolveByIndex(id.categoryIndex, resolver);
  const yy = String(id.year - YEAR_BASE).padStart(2, '0');
  return `O${yy}-${code}-${String(id.serial).padStart(SERIAL_MIN_DIGITS, '0')}`;
}

/**
 * Strict canonical parser: accepts exactly the strings formatProductId
 * produces for a category the resolver knows. Throws IdentityError.
 */
export function parseProductId(s: string, resolver: CategoryResolver): ProductIdentity {
  if (typeof s !== 'string') throw new IdentityError('product id must be a string');
  // JS `$` without the m flag anchors at the very end (no trailing-newline
  // allowance), and `\d` is ASCII-only, so no Unicode digit lookalikes pass.
  const m = PRODUCT_ID.exec(s);
  if (!m) throw new IdentityError('product id is not in canonical form O{YY}-{C}-{NNNNN}');
  const [, yy, code, digits] = m;
  if (digits.length > SERIAL_MIN_DIGITS && digits[0] === '0') {
    throw new IdentityError('product id serial has a non-canonical leading zero');
  }
  const info = resolver.byCode(code);
  if (!info || info.code !== code) throw new IdentityError(`unknown category code ${code}`);
  const id: ProductIdentity = { year: YEAR_BASE + Number(yy), categoryIndex: info.index, serial: Number(digits) };
  assertValidIdentity(id);
  // Round-trip through the index, as formatProductId does: a registry that
  // maps a second letter to the same index must not create a second spelling.
  if (resolveByIndex(id.categoryIndex, resolver).code !== code) {
    throw new IdentityError(`category code ${code} is not the canonical code of index ${id.categoryIndex}`);
  }
  return id;
}

/**
 * In-memory resolver over a fixed category list (tests, tools, offline
 * rendering). Rejects malformed entries and duplicate codes or indices,
 * because either would make the letter ↔ index mapping ambiguous.
 */
export function staticCategoryResolver(list: CategoryInfo[]): CategoryResolver {
  const byCode = new Map<string, CategoryInfo>();
  const byIndex = new Map<number, CategoryInfo>();
  for (const entry of list) {
    if (typeof entry.code !== 'string' || !CATEGORY_CODE.test(entry.code)) {
      throw new IdentityError(`category code ${String(entry.code)} is not a single letter A-Z`);
    }
    if (!isIntInRange(entry.index, 1, CATEGORY_INDEX_MAX)) {
      throw new IdentityError(`category index ${entry.index} is outside 1..${CATEGORY_INDEX_MAX}`);
    }
    if (byCode.has(entry.code)) throw new IdentityError(`duplicate category code ${entry.code}`);
    if (byIndex.has(entry.index)) throw new IdentityError(`duplicate category index ${entry.index}`);
    // Frozen copies: later mutation of the caller's objects cannot remap identities.
    const info = Object.freeze({ code: entry.code, index: entry.index, name: entry.name });
    byCode.set(info.code, info);
    byIndex.set(info.index, info);
  }
  return {
    byCode: (code) => byCode.get(code),
    byIndex: (index) => byIndex.get(index),
  };
}
