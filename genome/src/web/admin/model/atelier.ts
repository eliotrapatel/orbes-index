/**
 * The atelier in the console (plan LIVE RELEASE+: Registry › Atelier, the work sheets) — pure helpers, no DOM.
 *
 *  - The words: whom pieces to make are for (a release, the private salon, the stock), a SKU, a step.
 *  - The list's filters read from the page's query, kept to the values the server takes; the work sheets' selection.
 *  - What each role may do with a piece to make now (OPERATOR: start it, finish it, cancel one made for the stock;
 *    print its work sheet), mirroring services/atelier.ts.
 *  - The dialogs: a piece finished (its material, batch, production date, claim code), a transfer, a count corrected, a
 *    minimum, pieces to make for the stock: what the server would refuse before anything is sent, and what to send.
 */
import { formatCount } from '../format.js';
import { can } from './permissions.js';
import { BENCH_VIEWS, type AdminRole, type BenchFilters, type BenchItem, type BenchOrigin, type BenchView, type IssueBenchInput, type SkuRef } from '../types.js';

/** The bounds of services/atelier.ts and services/stock.ts (test/web/admin.orders.test.ts compares them). */
export const ATELIER_LIMITS = Object.freeze({ make: 50, sheets: 100, threshold: 10_000, move: 10_000, note: 500, material: 200, batch: 100 });
/** The material of a reserved identity whose model names none: the atelier confirms it when it issues the piece. */
export const RESERVED_MATERIAL_PENDING = 'TO BE CONFIRMED';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whom pieces to make are for, as the atelier names it. */
export function originLabel(o: BenchOrigin): string {
  return o.kind === 'RELEASE' ? o.release.title : o.kind === 'SALON' ? 'PRIVATE SALON' : 'FOR STOCK';
}

/** A SKU as the atelier names it: `MONOLITHE · 52`, `MONOLITHE · ONE SIZE`. */
export function skuLabel(k: SkuRef): string {
  return `${k.model.name} · ${k.sizeLabel ?? 'ONE SIZE'}`;
}

/** The list's filters from the page's query: only the values the server takes. */
export function benchFilters(query: Record<string, string>): BenchFilters {
  const f: BenchFilters = {};
  if ((BENCH_VIEWS as readonly string[]).includes(query.view ?? '')) f.view = query.view as BenchView;
  if (query.origin === 'SALON' || query.origin === 'STOCK' || UUID_RE.test(query.origin ?? '')) f.origin = query.origin === 'SALON' || query.origin === 'STOCK' ? query.origin : query.origin!.toLowerCase();
  if (UUID_RE.test(query.skuId ?? '')) f.skuId = query.skuId!.toLowerCase();
  if (UUID_RE.test(query.locationId ?? '')) f.locationId = query.locationId!.toLowerCase();
  return f;
}

/** The work sheets' selection from their page's query: one piece (`id`), or an origin, a SKU and a location. */
export function sheetsSelection(query: Record<string, string>): { benchItemIds?: string[]; origin?: string; skuId?: string; locationId?: string } {
  if (UUID_RE.test(query.id ?? '')) return { benchItemIds: [query.id!.toLowerCase()] };
  const f = benchFilters(query);
  return { ...(f.origin ? { origin: f.origin } : {}), ...(f.skuId ? { skuId: f.skuId } : {}), ...(f.locationId ? { locationId: f.locationId } : {}) };
}

export interface BenchActions {
  start: boolean;
  done: boolean;
  cancel: boolean;
  sheet: boolean;
}

/** What `role` may do with a piece to make now (services/atelier.ts BENCH_TRANSITIONS). */
export function benchActions(b: BenchItem, role: AdminRole | null | undefined): BenchActions {
  const ok = can(role, 'manageAtelier');
  const open = b.status === 'TO_MAKE' || b.status === 'IN_PROGRESS';
  return {
    start: ok && b.status === 'TO_MAKE',
    done: ok && b.status === 'IN_PROGRESS',
    cancel: ok && open && b.order === null,
    sheet: can(role, 'printWorkSheets') && open,
  };
}

// ── The dialogs ────────────────────────────────────────────────────────────

const today = (now: Date) => now.toISOString().slice(0, 10);

/** A piece finished: its material (required while still to be confirmed), its batch, its production date. */
export function issueProblem(b: BenchItem, v: Record<string, string>, now: Date): string | null {
  const material = (v.material ?? '').trim();
  if (!material && b.piece.material === RESERVED_MATERIAL_PENDING) return 'Confirm the material of the piece.';
  if (material === RESERVED_MATERIAL_PENDING) return 'Confirm the material of the piece.';
  if (material.length > ATELIER_LIMITS.material) return `A material has at most ${ATELIER_LIMITS.material} characters.`;
  if ((v.productionBatch ?? '').trim().length > ATELIER_LIMITS.batch) return `A batch has at most ${ATELIER_LIMITS.batch} characters.`;
  const date = (v.productionDate ?? '').trim();
  if (date) {
    const d = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return 'The production date is a day.';
    if (date > today(new Date(now.getTime() + 86_400_000))) return 'The production date cannot be in the future.';
  }
  return null;
}

/** The dialog's values when it opens: the material as reserved (empty while to be confirmed), today, a claim code. */
export function issueValues(b: BenchItem, now: Date): Record<string, string> {
  return { material: b.piece.material === RESERVED_MATERIAL_PENDING ? '' : b.piece.material, productionBatch: '', productionDate: today(now), withClaimSecret: 'true' };
}

export function issueInput(v: Record<string, string>): IssueBenchInput {
  const material = (v.material ?? '').trim();
  const batch = (v.productionBatch ?? '').trim();
  const date = (v.productionDate ?? '').trim();
  return { ...(material ? { material } : {}), ...(batch ? { productionBatch: batch } : {}), ...(date ? { productionDate: date } : {}), withClaimSecret: v.withClaimSecret === 'true' };
}

const wholeIn = (text: string | undefined, min: number, max: number): number | null => {
  const t = (text ?? '').trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** A transfer: pieces of the SKU from one location to another. */
export function transferProblem(v: Record<string, string>): string | null {
  if (!UUID_RE.test(v.fromLocationId ?? '') || !UUID_RE.test(v.toLocationId ?? '')) return 'Choose both locations.';
  if (v.fromLocationId === v.toLocationId) return 'A transfer goes to another location.';
  if (wholeIn(v.quantity, 1, ATELIER_LIMITS.move) === null) return `Move 1 to ${formatCount(ATELIER_LIMITS.move)} pieces.`;
  if ((v.note ?? '').trim().length > ATELIER_LIMITS.note) return `A note has at most ${ATELIER_LIMITS.note} characters.`;
  return null;
}

/** A count corrected: up or down, never 0, with why. */
export function adjustProblem(v: Record<string, string>): string | null {
  const n = wholeIn(v.delta, -ATELIER_LIMITS.move, ATELIER_LIMITS.move);
  if (n === null || n === 0) return 'Correct the count by a number of pieces, up (12) or down (-2).';
  const note = (v.note ?? '').trim();
  if (!note) return 'Say in the note why the count changes.';
  if (note.length > ATELIER_LIMITS.note) return `A note has at most ${ATELIER_LIMITS.note} characters.`;
  return null;
}

/** A minimum: 1 to 10 000 pieces, or none (empty). */
export function thresholdProblem(v: Record<string, string>): string | null {
  const t = (v.minimum ?? '').trim();
  if (t === '') return null;
  return wholeIn(t, 1, ATELIER_LIMITS.threshold) === null ? `A minimum is 1 to ${formatCount(ATELIER_LIMITS.threshold)} pieces, or none.` : null;
}

export function thresholdValue(v: Record<string, string>): number | null {
  const t = (v.minimum ?? '').trim();
  return t === '' ? null : Number(t);
}

/** Pieces to make for the stock: 1 to 50 at a time. */
export function makeProblem(v: Record<string, string>): string | null {
  return wholeIn(v.quantity, 1, ATELIER_LIMITS.make) === null ? `Make 1 to ${ATELIER_LIMITS.make} pieces at a time.` : null;
}
