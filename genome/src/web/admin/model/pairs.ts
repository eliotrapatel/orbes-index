/**
 * A model's Pairs well with in the console (plan NEXT-NINE, §3.7 BP-34), as pure functions the Lookbook page and the
 * tests share: the two or three models its sheet in THE COLLECTION ends with, in their order, picked on a main model or
 * a model alone (a variant's sheet is its main model's).
 *
 *  - the table's words: each pick's model (`MONOLITHE · Blue`), its place in the lookbook, whether the sheet shows it
 *    (Everyone, Owners of the salon's tier, Not shown: hidden, Not shown: discontinued);
 *  - none picked: what the sheet shows now (`Shown now: ZENITH, MONOLITHE ARCHITECTURALE`, or why nothing);
 *  - the Edit pairs dialog's options (every model but this one and its variants, never a discontinued one) and what the
 *    server would refuse, said before anything is sent.
 *
 * The server checks everything again (services/catalog.ts setPairs); the fallback's size (3) is a constant there.
 */
import type { LookbookState, Model, ModelPair, PairShown } from '../types.js';

/** At most this many models (model_pairs.position 1 to 3). */
export const PAIRS_MAX = 3;

/** The section's words, as the plan has them. */
export const PAIRS_TEXT = Object.freeze({
  lead: 'Two or three models shown at the end of its sheet in THE COLLECTION, in this order. None picked: the sheet shows up to three other models of its collection, the newest first.',
  none: 'None picked.',
  dialogTitle: 'Pairs well with',
  fields: ['First model', 'Second model', 'Third model (optional)'] as const,
  count: 'Pick two or three models, or none: the sheet then shows other models of its collection.',
  twice: 'Each model is picked once.',
  unchanged: 'Nothing has changed.',
  save: 'Save pairs',
  saved: 'Pairs saved.',
  variant: 'Set on its main model',
  variantNote: 'Its sheet is its main model’s: the pairs are the same for every dot.',
});

/** What the Shown column says of a pick. */
const SHOWN_LABELS: Readonly<Record<PairShown, string>> = Object.freeze({
  EVERYONE: 'Everyone',
  SALON: 'Owners of the salon’s tier',
  HIDDEN: 'Not shown: hidden',
  DISCONTINUED: 'Not shown: discontinued',
});

export function shownLabel(shown: PairShown): string {
  return SHOWN_LABELS[shown] ?? SHOWN_LABELS.HIDDEN;
}

/** A model with its label among its variants: `MONOLITHE · Blue`; the name alone without one. */
export function pairModelLabel(m: { name: string; label: string | null }): string {
  return m.label ? `${m.name} · ${m.label}` : m.name;
}

const LOOKBOOK_WORDS: Readonly<Record<LookbookState, string>> = Object.freeze({ PUBLIC: 'Public', RESERVED: 'Reserved', HIDDEN: 'Hidden' });

/** A model's place in the lookbook, in a word. */
export function lookbookWord(state: LookbookState): string {
  return LOOKBOOK_WORDS[state] ?? state;
}

/** The section's note: `2 of 3`, or `None picked`. */
export function pairsNote(pairs: readonly ModelPair[]): string {
  return pairs.length ? `${pairs.length} of ${PAIRS_MAX}` : 'None picked';
}

/** None picked: what the sheet shows now, or why it shows nothing. */
export function shownNow(m: Pick<Model, 'collection' | 'pairsFallback'>): string {
  const fallback = m.pairsFallback ?? [];
  if (fallback.length) return `Shown now: ${fallback.map(pairModelLabel).join(', ')}`;
  if (!m.collection) return 'Shown now: nothing (the model has no collection)';
  return `Shown now: nothing (no other public model in ${m.collection.name ?? 'its collection'})`;
}

/**
 * The dialog's options: None, then every model but `m` and its variants (its own group), each `NAME · Label — Public`,
 * in the catalogue's order; a discontinued model is left out, unless it is picked already (it stays, to be replaced).
 */
export function pairOptions(m: Pick<Model, 'id' | 'pairs'>, models: readonly Pick<Model, 'id' | 'name' | 'variantLabel' | 'variantOf' | 'lookbook' | 'discontinuedAt'>[]): { value: string; label: string }[] {
  const picked = new Set((m.pairs ?? []).map((p) => p.id));
  const options = models
    .filter((x) => x.id !== m.id && x.variantOf?.id !== m.id && (x.discontinuedAt === null || picked.has(x.id)))
    .map((x) => ({ value: x.id, label: `${pairModelLabel({ name: x.name, label: x.variantLabel })} — ${lookbookWord(x.lookbook)}` }));
  return [{ value: '', label: 'None' }, ...options];
}

/** The three selects' values: the picks in their order, '' for None. */
export function pairFormValues(m: Pick<Model, 'pairs'>): string[] {
  const ids = (m.pairs ?? []).slice().sort((a, b) => a.position - b.position).map((p) => p.id);
  return Array.from({ length: PAIRS_MAX }, (_, i) => ids[i] ?? '');
}

/** The models the three selects name, in order, the None ones left out. */
export function pairsChange(values: readonly (string | undefined)[]): string[] {
  return values.map((v) => (v ?? '').trim()).filter((v) => v !== '');
}

/** What the server would refuse, or Nothing has changed; null when the picks may be sent. */
export function pairsProblem(m: Pick<Model, 'pairs'>, values: readonly (string | undefined)[]): string | null {
  const ids = pairsChange(values);
  if (ids.length === 1) return PAIRS_TEXT.count;
  if (new Set(ids).size !== ids.length) return PAIRS_TEXT.twice;
  const before = pairFormValues(m).filter((v) => v !== '');
  if (before.length === ids.length && before.every((x, i) => x === ids[i])) return PAIRS_TEXT.unchanged;
  return null;
}
