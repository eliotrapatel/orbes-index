/**
 * THE HOUSE'S GUARANTEE in the console (plan NEXT-NINE, §3.3 IN-01), as pure functions: its states and what it covers in
 * words, the Grant dialog's options, defaults, checks and request, its toast, the Change dialog, the defaults of Orders
 * → Settings, and the lines of a release's page (the Guaranteed row, the run-the-draw dialog). The server checks each
 * value again (services/guarantees.ts); these only spare a round trip.
 */
import { formatDate, humanize } from '../format.js';
import type { DialogValues } from '../ui/dialog.js';
import type { Drop, Guarantee, GuaranteeChange, GuaranteeGrant, GuaranteeInput, GuaranteeScope, GuaranteeSettings, GuaranteeState, LiveRelease, Model } from '../types.js';

/** As services/guarantees.ts: the pieces, the days of validity, the note. */
export const GUARANTEE_LIMITS = Object.freeze({ pieces: { min: 1, max: 5 }, validDays: { min: 1, max: 730 }, note: 500 });

export const GUARANTEE_STATE_LABELS: Readonly<Record<GuaranteeState, string>> = Object.freeze({
  WAITING: 'WAITING FOR A RELEASE',
  SET_ASIDE: 'SET ASIDE',
  ENTERED: 'ENTERED',
  USED: 'USED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
});

/** The client sheet's note above the table. */
export const GUARANTEE_SECTION_NOTE = 'A guaranteed place at a coming release, granted by Client Services. Personal, used once.';

/** What the Grant dialog's « Covers » offers, the next release of a model first (the default). */
export const COVER_OPTIONS: readonly { value: GuaranteeScope; label: string }[] = Object.freeze([
  { value: 'MODEL', label: 'The next release of a model' },
  { value: 'COLLECTION', label: 'The next release of a collection' },
  { value: 'RELEASE', label: 'A chosen release' },
]);

export const PIECES_OPTIONS = Object.freeze(
  Array.from({ length: GUARANTEE_LIMITS.pieces.max }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i === 0 ? 'piece' : 'pieces'}` })),
);

/** The hints of the Grant dialog, as the plan words them. */
export const GRANT_HINTS = Object.freeze({
  model: 'A main model covers its variants; a variant covers itself.',
  pieces:
    'In a draw: selected first for these pieces. In a LIVE RELEASE: first in line in the size chosen, for up to this many pieces or the release’s limit per collector, whichever is higher.',
  validUntil: 'It covers a release that opens by this date.',
  visible: 'Off: nothing appears in the client’s account or on the release page for them. Once drawn, the draw’s public list still shows the line, unmarked.',
  note: 'For Client Services: why it was granted. Never shown in the app and never in the audit log; included if the client asks for a copy of their data.',
});

/** The Revoke dialog's sentence. */
export const REVOKE_TEXT = 'The client’s entry, if any, stays as an ordinary entry. Recorded in the audit log.';

/** `2 pieces`. */
export const piecesText = (n: number): string => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** A model as the guarantee names it in the console: `MONOLITHE · Blue` for a variant (its label after it). */
export function modelLabel(m: { name: string; variant: string | null }): string {
  return m.variant ? `${m.name} · ${m.variant}` : m.name;
}

/** The Covers column: `Next release of MONOLITHE`, `Next release of the ÉCLIPSE collection`, or the release's title. */
export function coversText(g: Pick<Guarantee, 'target'>): string {
  if (g.target.kind === 'MODEL') return `Next release of ${modelLabel(g.target)}`;
  if (g.target.kind === 'COLLECTION') return `Next release of the ${g.target.name} collection`;
  return g.target.name;
}

/** The active models a guarantee may cover, a variant as `MONOLITHE · Blue`, by name. */
export function modelOptions(models: readonly Model[]): { value: string; label: string }[] {
  return models
    .filter((m) => m.active && !m.discontinuedAt)
    .map((m) => ({ value: m.id, label: m.variantOf ? `${m.variantOf.name} · ${m.variantLabel ?? ''}`.trim() : m.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A release the dialog offers, with its access rule as the hint the dialog shows once chosen. */
export interface ReleaseOption {
  value: string;
  label: string;
  rule: string;
}

/** Who enters a draw: any ORBES account (its early access aside). */
export const DRAW_RULE = 'A draw: any ORBES account enters; PLATINE and PALLADIUM reserve a place directly during their early access.';

/**
 * The releases a guarantee may be granted for: the draws in DRAFT, UPCOMING or OPEN, and the LIVE RELEASES not ended nor
 * cancelled (an after-room never: the console's list has none), each with its access rule.
 */
export function releaseOptions(draws: readonly Drop[], lives: readonly LiveRelease[]): ReleaseOption[] {
  const out: ReleaseOption[] = [];
  for (const d of draws) {
    if (d.state !== 'DRAFT' && d.state !== 'UPCOMING' && d.state !== 'OPEN') continue;
    out.push({ value: d.id, label: `${d.title} · DRAW · ${humanize(d.state)}`, rule: DRAW_RULE });
  }
  for (const r of lives) {
    if (r.phase === 'ENDED' || r.phase === 'CANCELLED' || r.over || r.afterRoomOf) continue;
    out.push({ value: r.id, label: `${r.title} · LIVE RELEASE · ${humanize(r.phase)}`, rule: `A LIVE RELEASE for ${r.access.text}. A holder of the guarantee enters whatever the rule.` });
  }
  return out;
}

/** The Grant dialog's starting values, from Orders → Settings. */
export function grantValues(s: Pick<GuaranteeSettings, 'pieces' | 'visible' | 'defaultValidUntil'>): DialogValues {
  return { scope: 'MODEL', modelId: '', collectionId: '', releaseId: '', pieces: String(s.pieces), validUntil: s.defaultValidUntil, visible: s.visible ? 'true' : '', note: '' };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function pieceCount(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= GUARANTEE_LIMITS.pieces.min && n <= GUARANTEE_LIMITS.pieces.max ? n : null;
}

/** What blocks a grant before it is sent: the target of its scope, the pieces, the date, the note. */
export function grantProblem(v: DialogValues, today: string): string | null {
  const scope = v.scope as GuaranteeScope;
  if (scope === 'MODEL' && !v.modelId) return 'Choose the model.';
  if (scope === 'COLLECTION' && !v.collectionId) return 'Choose the collection.';
  if (scope === 'RELEASE' && !v.releaseId) return 'Choose the release.';
  if (scope !== 'MODEL' && scope !== 'COLLECTION' && scope !== 'RELEASE') return 'Choose what the guarantee covers.';
  return termsProblem(v, today);
}

function termsProblem(v: DialogValues, today: string): string | null {
  if (pieceCount(v.pieces) === null) return `A guarantee covers ${GUARANTEE_LIMITS.pieces.min} to ${GUARANTEE_LIMITS.pieces.max} pieces.`;
  if (!DATE.test(v.validUntil ?? '')) return 'Enter the date it is valid until.';
  if (v.validUntil < today) return 'Valid until is today or later.';
  if ((v.note ?? '').trim().length > GUARANTEE_LIMITS.note) return `A note has at most ${GUARANTEE_LIMITS.note} characters.`;
  return null;
}

/** The request of a grant. */
export function grantInput(v: DialogValues): GuaranteeInput {
  const scope = v.scope as GuaranteeScope;
  const note = (v.note ?? '').trim();
  return {
    scope,
    targetId: scope === 'MODEL' ? v.modelId : scope === 'COLLECTION' ? v.collectionId : v.releaseId,
    pieces: pieceCount(v.pieces) ?? 1,
    validUntil: v.validUntil,
    visible: v.visible === 'true',
    note: note === '' ? null : note,
  };
}

/** The toast after a grant: where it was set aside, or that it waits for the next release. */
export function grantToast(out: Pick<GuaranteeGrant, 'setAsideFor'>): string {
  return out.setAsideFor ? `Guarantee granted. Set aside for ${out.setAsideFor.title}.` : 'Guarantee granted. It is set aside when the next release is published.';
}

/** The Change dialog's values: its pieces, its validity (its day), shown, its note. */
export function changeValues(g: Pick<Guarantee, 'pieces' | 'validUntil' | 'visible' | 'note'>): DialogValues {
  return { pieces: String(g.pieces), validUntil: g.validUntil.slice(0, 10), visible: g.visible ? 'true' : '', note: g.note ?? '' };
}

/** What blocks a change: its terms, or nothing changed. */
export function changeProblem(g: Pick<Guarantee, 'pieces' | 'validUntil' | 'visible' | 'note'>, v: DialogValues, today: string): string | null {
  const termsAt = v.validUntil === g.validUntil.slice(0, 10) ? { ...v, validUntil: v.validUntil > today ? v.validUntil : today } : v;
  return termsProblem(termsAt, today) ?? (Object.keys(changeInput(g, v)).length === 0 ? 'Nothing has changed.' : null);
}

/** Only what changed. */
export function changeInput(g: Pick<Guarantee, 'pieces' | 'validUntil' | 'visible' | 'note'>, v: DialogValues): GuaranteeChange {
  const out: GuaranteeChange = {};
  const pieces = pieceCount(v.pieces);
  if (pieces !== null && pieces !== g.pieces) out.pieces = pieces;
  if (v.validUntil && v.validUntil !== g.validUntil.slice(0, 10)) out.validUntil = v.validUntil;
  const visible = v.visible === 'true';
  if (visible !== g.visible) out.visible = visible;
  const note = (v.note ?? '').trim();
  if ((note === '' ? null : note) !== g.note) out.note = note === '' ? null : note;
  return out;
}

/** Change and Revoke, while the guarantee is ACTIVE (its computed state not EXPIRED aside: an ACTIVE one may still be revoked). */
export function guaranteeActions(g: Pick<Guarantee, 'status'>, canGrant: boolean): { change: boolean; revoke: boolean } {
  const open = canGrant && g.status === 'ACTIVE';
  return { change: open, revoke: open };
}

/** The Valid until column: its day (Paris). */
export const validUntilText = (g: Pick<Guarantee, 'validUntil'>): string => formatDate(g.validUntil);

/** A release's Guaranteed row: `2 places · 3 pieces`, or `None`. */
export function guaranteedText(t: { places: number; pieces: number }): string {
  if (t.places === 0) return 'None';
  return `${t.places} ${t.places === 1 ? 'place' : 'places'} · ${piecesText(t.pieces)}`;
}

/** The pieces a draw gives now: its quantity less the pieces held or sold and those its guaranteed entries take first. */
export function placesLeftForDraw(d: Pick<Drop, 'quantity' | 'heldPieces' | 'guaranteedEntered'>): number {
  return Math.max(0, d.quantity - d.heldPieces - d.guaranteedEntered.pieces);
}

/** The run-the-draw dialog's sentence on the guaranteed places, or null when none waits. */
export function drawGuaranteeLine(d: Pick<Drop, 'quantity' | 'heldPieces' | 'guaranteedEntered'>): string | null {
  const g = d.guaranteedEntered;
  if (g.places === 0) return null;
  const left = placesLeftForDraw(d);
  return `${g.places} guaranteed ${g.places === 1 ? 'place' : 'places'}, ${piecesText(g.pieces)}, ${g.places === 1 ? 'is' : 'are'} selected first; the draw ranks the other entries for the ${left} ${left === 1 ? 'place' : 'places'} left.`;
}

/** The defaults' dialog values. */
export function settingsValues(s: Pick<GuaranteeSettings, 'validDays' | 'pieces' | 'visible'>): DialogValues {
  return { validDays: String(s.validDays), pieces: String(s.pieces), visible: s.visible ? 'true' : '' };
}

export function settingsProblem(v: DialogValues): string | null {
  const days = Number(v.validDays);
  if (!Number.isInteger(days) || days < GUARANTEE_LIMITS.validDays.min || days > GUARANTEE_LIMITS.validDays.max) {
    return `Valid for is ${GUARANTEE_LIMITS.validDays.min} to ${GUARANTEE_LIMITS.validDays.max} days.`;
  }
  if (pieceCount(v.pieces) === null) return `A guarantee covers ${GUARANTEE_LIMITS.pieces.min} to ${GUARANTEE_LIMITS.pieces.max} pieces.`;
  return null;
}

export function settingsInput(v: DialogValues): Pick<GuaranteeSettings, 'validDays' | 'pieces' | 'visible'> {
  return { validDays: Number(v.validDays), pieces: pieceCount(v.pieces) ?? 1, visible: v.visible === 'true' };
}

/** The settings warn when a LIVE RELEASE's stock is below the pieces the house guarantees for it (the server refuses the save). */
export function stockWarning(stock: number, guaranteed: { pieces: number }): string | null {
  return guaranteed.pieces > stock ? `${piecesText(guaranteed.pieces)} of this release ${guaranteed.pieces === 1 ? 'is' : 'are'} guaranteed by the house: the stock cannot go below.` : null;
}

/** The day of `now` in Paris, `YYYY-MM-DD`: what « today » means for a validity. */
export function parisToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
