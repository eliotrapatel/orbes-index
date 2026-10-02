/**
 * Anomaly triage view model: the list's filters as the view keeps them in
 * its URL, the badge on Anomalies and the tab title, the links into the
 * verification events of a finding's window, and the decision dialog's
 * chained actions (mark the piece, revoke its code, then resolve the
 * finding, each reason citing the finding). Pure: unit-tested without a
 * browser; the server is the authority on every rule.
 */
import { formatCount, humanize } from '../format.js';
import { href } from '../router.js';
import type { AdminRole, AnomalyContext, AnomalyFilters, AnomalyRecord, AnomalyScan, AnomalyStatus, ProductStatus } from '../types.js';
import { can } from './permissions.js';
import { confirmationPhrase, type TriageMove } from './registry.js';

// ── Filters ────────────────────────────────────────────────────────────────

const FILTER_KEYS = ['status', 'severity', 'type', 'productId', 'sort'] as const;

/** The list's filters and order from the route query (blank values dropped). */
export function anomalyFiltersFrom(query: Readonly<Record<string, string | undefined>>): AnomalyFilters {
  const out: AnomalyFilters = {};
  for (const k of FILTER_KEYS) {
    const v = query[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

const CANONICAL_PRODUCT_ID = /^O\d{2}-[A-Z]-\d{5,6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a product reference the list can filter by, as the server reads it (`productRef`): a full
 * canonical id (O26-J-00184) or a product's uuid. Blank means no filter. Checked before the filter is
 * applied, so a partial id never turns the page into a refusal.
 */
export function isProductFilter(value: string): boolean {
  const v = value.trim();
  return v === '' || (v.length <= 64 && (CANONICAL_PRODUCT_ID.test(v) || UUID.test(v)));
}

/** True when a filter narrows the list (the order does not). */
export function hasAnomalyFilters(f: AnomalyFilters): boolean {
  return !!(f.status || f.severity || f.type || f.productId);
}

/** The Sort select: most severe first (the server's default, kept out of the URL), highest risk, last seen. */
export const SORT_OPTIONS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '', label: 'Severity, then risk' },
  { value: 'risk', label: 'Risk' },
  { value: 'lastSeen', label: 'Last seen' },
]);

/** The Sort select's value for an order in the URL (`severity` is the default, shown as such). */
export function sortValue(sort: string | undefined): string {
  return !sort || sort === 'severity' ? '' : sort;
}

/** The Type select: every type the server can record (its summary), plus the one in the URL if the server no longer lists it. */
export function typeOptions(types: readonly string[], current?: string): { value: string; label: string }[] {
  const all = current && !types.includes(current) ? [...types, current] : [...types];
  return [{ value: '', label: 'All types' }, ...all.map((t) => ({ value: t, label: humanize(t) }))];
}

// ── Badge and title ────────────────────────────────────────────────────────

/** The badge's text: the count of OPEN HIGH + CRITICAL findings, `99+` beyond 99, empty when none waits. */
export function badgeText(attention: number): string {
  if (!Number.isFinite(attention) || attention < 1) return '';
  return attention > 99 ? '99+' : String(Math.floor(attention));
}

/** The tab title, prefixed `(3)` while OPEN HIGH or CRITICAL findings wait: `(3) Anomalies — ORBES Genome Console`. */
export function consoleTitle(page: string, attention: number): string {
  const badge = badgeText(attention);
  return `${badge ? `(${badge}) ` : ''}${page} — ORBES Genome Console`;
}

// ── Links ──────────────────────────────────────────────────────────────────

/** The finding's window in Verification events (product findings only: the registry filters by product). */
export function windowScansHref(c: Pick<AnomalyContext, 'product' | 'window'>): string | null {
  if (!c.product) return null;
  return href('scans', {}, { productId: c.product.productId, from: c.window.from, to: c.window.to });
}

/** One scan in Verification events: the second it was made in, with that scan marked. */
export function scanHref(scan: Pick<AnomalyScan, 'id' | 'occurredAt'>, productId: string | null): string {
  const t = Date.parse(scan.occurredAt);
  const from = Number.isFinite(t) ? Math.floor(t / 1000) * 1000 : 0;
  return href('scans', {}, { productId: productId ?? undefined, from: new Date(from).toISOString(), to: new Date(from + 999).toISOString(), scan: scan.id });
}

/** `FR 3 · JP 1 · UNKNOWN 2`, most scans first. */
export function countriesLine(countries: readonly { country: string | null; scans: number }[]): string {
  return countries.map((c) => `${c.country ?? 'UNKNOWN'} ${formatCount(c.scans)}`).join(' · ');
}

// ── Decision ───────────────────────────────────────────────────────────────

/** The marks the decision dialog can set on the piece, in this order. */
export const MARKS = ['COUNTERFEIT_FLAGGED', 'STOLEN'] as const satisfies readonly ProductStatus[];
export type Mark = (typeof MARKS)[number];

/** The dialog's tick box for each mark, and for the code. */
export const MARK_FIELDS: Readonly<Record<Mark, string>> = Object.freeze({ COUNTERFEIT_FLAGGED: 'markCounterfeit', STOLEN: 'markStolen' });
export const REVOKE_FIELD = 'revokeCode';

/** Longest reasons the chained routes accept: a transition's (1 000) and a code revocation's (500). */
export const REASON_MAX = Object.freeze({ transition: 1000, revoke: 500 });

export interface DecisionOffer {
  /** product id (canonical) the marks apply to. */
  productId: string | null;
  /** Marks the product's lifecycle allows now and the role may set (OPERATOR). */
  marks: Mark[];
  /** The ACTIVE code an ADMIN may revoke. */
  revoke: { codeId: string; issue: number } | null;
}

/**
 * What the decision dialog offers besides the triage move: only for a finding that can be
 * resolved, the marks its product's lifecycle allows (transition: OPERATOR) and the revocation
 * of its ACTIVE code (ADMIN), as the server rules them.
 */
export function decisionOffer(c: Pick<AnomalyContext, 'product' | 'code'> | null, role: AdminRole, moves: readonly TriageMove[]): DecisionOffer {
  const resolvable = moves.some((m) => m.to === 'RESOLVED');
  const allowed = c?.product?.lifecycle.allowed ?? [];
  return {
    productId: c?.product?.productId ?? null,
    marks: resolvable && can(role, 'transition') ? MARKS.filter((m) => allowed.includes(m)) : [],
    revoke: resolvable && c?.code?.status === 'ACTIVE' && can(role, 'revokeCode') ? { codeId: c.code.id, issue: c.code.issue } : null,
  };
}

/** True when the anomaly's decision may offer actions, so the dialog first reads its context. */
export function decisionNeedsContext(a: Pick<AnomalyRecord, 'status' | 'productUuid' | 'codeId'>, role: AdminRole): boolean {
  return (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED') && !!(a.productUuid || a.codeId) && (can(role, 'transition') || can(role, 'revokeCode'));
}

export type DecisionStep =
  | { key: string; kind: 'mark'; to: Mark; label: string }
  | { key: string; kind: 'revoke'; codeId: string; label: string }
  | { key: string; kind: 'status'; to: AnomalyStatus; label: string };

const ticked = (v: Readonly<Record<string, string>>, name: string) => v[name] === 'true';

function chosenMarks(v: Readonly<Record<string, string>>, offer: DecisionOffer): Mark[] {
  return offer.marks.filter((m) => ticked(v, MARK_FIELDS[m]));
}

/** The decision's steps in the order they run: mark the piece, revoke its code, then record the decision. */
export function decisionSteps(v: Readonly<Record<string, string>>, offer: DecisionOffer): DecisionStep[] {
  const steps: DecisionStep[] = chosenMarks(v, offer).map((to) => ({ key: `mark:${to}`, kind: 'mark', to, label: `Mark the piece ${humanize(to)}` }));
  if (offer.revoke && ticked(v, REVOKE_FIELD)) steps.push({ key: `revoke:${offer.revoke.codeId}`, kind: 'revoke', codeId: offer.revoke.codeId, label: 'Revoke the code' });
  const to = v.status as AnomalyStatus;
  if (to) steps.push({ key: `status:${to}`, kind: 'status', to, label: `Record the finding ${humanize(to)}` });
  return steps;
}

/** The dialog's check: a closing move needs a note; acting on the piece resolves the finding; one mark at a time. */
export function decisionError(v: Readonly<Record<string, string>>, offer: DecisionOffer, moves: readonly TriageMove[]): string | null {
  if (moves.find((m) => m.to === v.status)?.noteRequired && !v.note?.trim()) return 'Explain the decision in the note.';
  const marks = chosenMarks(v, offer);
  if (marks.length > 1) return 'Mark the piece counterfeit flagged or stolen, not both.';
  const acting = marks.length > 0 || (!!offer.revoke && ticked(v, REVOKE_FIELD));
  if (acting && v.status !== 'RESOLVED') return 'Marking the piece or revoking its code resolves the finding: choose Resolve.';
  return null;
}

/**
 * True when the decision is destructive, as the product page rules the same actions: it revokes the
 * code, or marks the piece COUNTERFEIT FLAGGED (a STOLEN mark is not, there or here). The dialog then
 * wears the oxblood rule and a danger confirm (BRAND §6).
 */
export function decisionDanger(v: Readonly<Record<string, string>>, offer: DecisionOffer): boolean {
  return decisionSteps(v, offer).some((s) => s.kind === 'revoke' || (s.kind === 'mark' && s.to === 'COUNTERFEIT_FLAGGED'));
}

/** The typed confirmation a ticked code revocation needs (`REVOKE ISSUE 1`), as on the product page; null otherwise. */
export function decisionPhrase(v: Readonly<Record<string, string>>, offer: DecisionOffer): string | null {
  return offer.revoke && ticked(v, REVOKE_FIELD) ? confirmationPhrase('revoke-code', offer.revoke.issue) : null;
}

/**
 * The reason each chained action records: it cites the finding, so the product's status history,
 * the code's revocation and the audit log lead back to it. Cut to the route's limit.
 */
export function decisionReason(a: Pick<AnomalyRecord, 'id' | 'type'>, note: string | undefined, max: number): string {
  const head = `Anomaly ${a.id} (${humanize(a.type)})`;
  const n = note?.trim();
  const full = n ? `${head}: ${n}` : head;
  return full.length > max ? `${full.slice(0, max - 1)}…` : full;
}

/** The toast after a recorded decision: `Finding RESOLVED · piece COUNTERFEIT FLAGGED · code revoked.` */
export function decisionSummary(steps: readonly DecisionStep[]): string {
  const parts = steps.map((s) => (s.kind === 'status' ? `Finding ${humanize(s.to)}` : s.kind === 'mark' ? `piece ${humanize(s.to)}` : 'code revoked'));
  const status = parts.findIndex((p) => p.startsWith('Finding'));
  const ordered = status > 0 ? [parts[status], ...parts.filter((_, i) => i !== status)] : parts;
  return `${ordered.join(' · ')}.`;
}
