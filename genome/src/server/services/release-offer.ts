/**
 * What a release sells (migration 0057, macro scope K44 T1; lot M3 plan §0 and §5.2, step M3.13): a model, or a set of
 * 2 to 4 models (`drops_one_offer`, exactly one). Until a set's release can be made (M3.15, M3.16), no flow creates one,
 * so the readers that mean a model's release read its model through `releaseModelId`, which refuses the other offer
 * rather than pass on a NULL; M3.14 replaces each with a set-aware read (kept, excluded or adapted, plan §5.2).
 */

/** The model a release sells; throws on a set's release (no model), which these readers never meet yet. */
export function releaseModelId(d: { readonly model_id: string | null }): string {
  if (d.model_id === null) throw new Error('This release sells a set, not a model.');
  return d.model_id;
}
