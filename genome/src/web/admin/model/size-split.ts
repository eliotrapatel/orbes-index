/**
 * ORDER A MODEL in the console (macro scope of 2026-10-20, K11 Z1 and Z2; plan MACRO M3 §3.3, step M3.7): pure helpers,
 * no DOM, for the Supplier orders page's panel (views/order-a-model.ts). The model choices (each main model, then its
 * variants under it, naturally sorted), the checks of PIECES and of each TO ORDER, the lines staff leave (0 removes
 * one), the total kept in view with its warning (never a refusal), the source and unmatched lines, what ADD TO DRAFTS
 * sends and how its answer is said. The server stays the authority (services/size-split.ts: 409 MODEL_NO_SIZES;
 * services/supplier-orders.ts addSplitToDrafts: 409 SKU_NO_SUPPLIER, SIZE_SET_ASIDE, all or nothing).
 *
 * Counts only: a proposal never names a collector, and nothing here reads one.
 */
import { formatCount, humanize } from '../format.js';
import type { Model, SizeSplitProposal, SplitDraftsResult } from '../types.js';

/** The pieces a split shares, at most (services/size-split.ts SPLIT_QUANTITY_MAX), and a line's (SUPPLIER_ORDER_LIMITS.quantity). */
export const SPLIT_LIMITS = Object.freeze({ quantity: 10_000, line: 10_000 });

export const SPLIT_TEXT = Object.freeze({
  open: 'Order a model',
  eyebrow: 'Supplier orders',
  title: 'Order a model',
  lead: 'The console proposes how the pieces are shared by size and by location, from past orders net of size exchanges and the saved sizes of the collectors who wish for or own that kind of piece. Change any line: nothing goes to a draft until you add it.',
  model: 'Model',
  modelPlaceholder: 'Choose a model',
  pieces: 'Pieces',
  piecesHint: `1 to ${formatCount(10_000)}.`,
  locations: 'Locations',
  locationsHint: 'Where the pieces may go. Every location at first.',
  propose: 'Propose',
  proposing: 'Proposing…',
  stale: 'The model, the pieces or the locations changed: propose again.',
  chooseModel: 'Choose a model.',
  chooseLocation: 'Choose at least one location.',
  noSizes: 'This model has no offered size: declare its sizes in the Catalogue.',
  openModel: 'Open the model',
  caption: 'The split by size and location',
  add: 'Add to drafts',
  adding: 'Adding…',
  close: 'Close',
  done: 'Done',
  nothingToAdd: 'Every line is at 0: nothing to add.',
  lineProblem: `To order: a whole number, 0 to ${formatCount(10_000)}.`,
  zeroNote: 'A line at 0 is left out.',
  unsaved: 'The lines you changed are not in a draft yet: leaving discards them.',
  discardTitle: 'Discard the split?',
  discardBody: 'The lines you changed are not in a draft yet. Closing the panel discards them.',
  discard: 'Discard',
  stay: 'Stay',
  addedTitle: 'Added to the drafts',
  addedNote: 'Each draft is completed and sent from its page, as any other.',
  failed: 'The split could not be proposed just now. Try again.',
});

/** The table's columns, in order (SIZE · LOCATION · ORDERS · SAVED SIZES · PROPOSED · TO ORDER). */
export const SPLIT_COLUMNS = Object.freeze(['Size', 'Location', 'Orders', 'Saved sizes', 'Proposed', 'To order'] as const);

/** Two names compared as people read them: ORBIT 2 before ORBIT 10. */
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/**
 * The MODEL select's choices: each active main model by name (naturally), then its active variants under it by label,
 * « — STEEL »; a variant whose main model is not offered is named in full. An inactive model is not ordered again.
 */
export function splitModelChoices(models: readonly Model[]): { value: string; label: string }[] {
  const active = models.filter((m) => m.active);
  const mains = active.filter((m) => !m.variantOf || !active.some((x) => x.id === m.variantOf!.id));
  const label = (m: Model) => [humanize(m.name), ...(m.variantLabel ? [humanize(m.variantLabel)] : [])].join(' · ');
  const out: { value: string; label: string }[] = [{ value: '', label: SPLIT_TEXT.modelPlaceholder }];
  for (const m of [...mains].sort((a, b) => natural(a.name, b.name) || natural(a.variantLabel ?? '', b.variantLabel ?? '') || natural(a.skuPrefix, b.skuPrefix))) {
    out.push({ value: m.id, label: label(m) });
    if (m.variantOf) continue;
    const variants = active.filter((v) => v.variantOf?.id === m.id).sort((a, b) => natural(a.variantLabel ?? '', b.variantLabel ?? '') || natural(a.skuPrefix, b.skuPrefix));
    for (const v of variants) out.push({ value: v.id, label: `— ${humanize(v.variantLabel ?? v.name)}` });
  }
  return out;
}

/** A whole number typed (spaces allowed between thousands), or null. */
function wholeOf(v: string | null | undefined): number | null {
  const s = (v ?? '').replace(/[\s  ]/g, '');
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

/** PIECES as a number, or null when it is not 1 to 10 000. */
export function piecesOf(v: string | null | undefined): number | null {
  const n = wholeOf(v);
  return n !== null && n >= 1 && n <= SPLIT_LIMITS.quantity ? n : null;
}

/** What PIECES says when it cannot be proposed, or null. */
export function piecesProblem(v: string | null | undefined): string | null {
  return piecesOf(v) === null ? `Pieces: a whole number, 1 to ${formatCount(SPLIT_LIMITS.quantity)}.` : null;
}

/** A TO ORDER as a number (empty: 0, the line left out), or null when it is not 0 to 10 000. */
export function toOrderOf(v: string | null | undefined): number | null {
  if ((v ?? '').trim() === '') return 0;
  const n = wholeOf(v);
  return n !== null && n <= SPLIT_LIMITS.line ? n : null;
}

/** A line's key: its size and its location. */
export function splitLineKey(l: { sku: { id: string }; location: { id: string } }): string {
  return `${l.sku.id}:${l.location.id}`;
}

/** The TO ORDER values staff left, by line key (the proposed figure where nothing was typed). */
export type SplitEdits = ReadonlyMap<string, string>;

/** Each line's TO ORDER now: its number, or null while what is typed is not one. */
export function splitQuantities(p: Pick<SizeSplitProposal, 'lines'>, edits: SplitEdits): (number | null)[] {
  return p.lines.map((l) => {
    const typed = edits.get(splitLineKey(l));
    return typed === undefined ? l.proposed : toOrderOf(typed);
  });
}

/** Whether a TO ORDER differs from what the console proposed (the page is then held). */
export function splitEdited(p: Pick<SizeSplitProposal, 'lines'>, edits: SplitEdits): boolean {
  const q = splitQuantities(p, edits);
  return p.lines.some((l, i) => q[i] !== l.proposed);
}

/** The pieces to order in all (null while a line is not a number). */
export function splitTotal(p: Pick<SizeSplitProposal, 'lines'>, edits: SplitEdits): number | null {
  const q = splitQuantities(p, edits);
  return q.some((n) => n === null) ? null : q.reduce<number>((s, n) => s + (n ?? 0), 0);
}

/** « 10 of 10 pieces »: the total kept in view, against the pieces asked. */
export function splitTotalLine(total: number, asked: number): string {
  return `${formatCount(total)} of ${formatCount(asked)} ${asked === 1 ? 'piece' : 'pieces'}`;
}

/** The warning when the lines no longer add up to the pieces asked (never a refusal), or null. */
export function splitTotalWarning(total: number, asked: number): string | null {
  if (total === asked) return null;
  const d = Math.abs(total - asked);
  return `${formatCount(d)} ${total > asked ? 'more' : 'fewer'} than the ${formatCount(asked)} asked.`;
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Where the proposal comes from: its orders and saved sizes, or the even split with no data, and where. */
export function splitSourceLine(p: Pick<SizeSplitProposal, 'source' | 'totals' | 'locations' | 'sizeKind'>): string {
  const kindNote = p.sizeKind === null ? ' Saved sizes are not read for a model without a size type or of one size.' : '';
  if (p.source === 'EVEN') {
    const at = p.locations.find((l) => l.isDefault) ?? p.locations[0];
    return `No orders or saved sizes yet: split evenly${at ? ` at ${at.name}` : ''}.${kindNote}`;
  }
  return `From ${plural(p.totals.orders, 'order', 'orders')}, net of size exchanges, and ${plural(p.totals.savedSizes, 'saved size', 'saved sizes')}.${kindNote}`;
}

/** The saved sizes matching none of the model's sizes, counted apart; null when there are none. */
export function splitUnmatchedLine(unmatched: number): string | null {
  if (unmatched <= 0) return null;
  return `${plural(unmatched, 'saved size matches', 'saved sizes match')} none of its sizes: not counted.`;
}

/** ADD TO DRAFTS' body: every line above 0, each size and location once. Null while a line is not a number. */
export function splitDraftLines(p: Pick<SizeSplitProposal, 'lines'>, edits: SplitEdits): { skuId: string; locationId: string; quantity: number }[] | null {
  const q = splitQuantities(p, edits);
  if (q.some((n) => n === null)) return null;
  return p.lines.flatMap((l, i) => (q[i]! > 0 ? [{ skuId: l.sku.id, locationId: l.location.id, quantity: q[i]! }] : []));
}

/** The toast after ADD TO DRAFTS, naming the drafts: « 13 pieces added to 2 drafts: SO-1A2B3C4D, SO-5E6F7A8B. » */
export function splitAddedToast(r: SplitDraftsResult): string {
  const refs = r.drafts.map((d) => d.reference).join(', ');
  return r.drafts.length === 1
    ? `${plural(r.pieces, 'piece', 'pieces')} added to the draft ${refs}.`
    : `${plural(r.pieces, 'piece', 'pieces')} added to ${formatCount(r.drafts.length)} drafts: ${refs}.`;
}

/** A draft written, under its reference: « MAISON NORD · FRANCE WAREHOUSE · 9 pieces on 2 lines ». */
export function splitDraftWords(d: SplitDraftsResult['drafts'][number]): string {
  return `${d.supplier.name} · ${d.location.name} · ${plural(d.pieces, 'piece', 'pieces')} on ${plural(d.lines, 'line', 'lines')}`;
}
