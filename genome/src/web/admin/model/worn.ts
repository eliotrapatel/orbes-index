/**
 * The WORN page (plan MACRO M2 §2.4, scope D31 G2; views/worn.ts; server: routes/admin/worn.ts, services/worn.ts) —
 * pure helpers, no DOM: the words, the page's address, who may review, the credit exactly as it will read under the
 * photograph (G3: the first name and the country, plus the Instagram name when chosen; never a variant), the three
 * reasons in staff words and in the words the owner reads, the statuses and who ended a photograph, the published
 * photographs grouped by model, the badge, a model page's line, and J/K between the cards to review.
 *
 *  - TO REVIEW: oldest first; PUBLISH, or REFUSE with one of the three reasons (OPERATOR). An AUDITOR reads, the
 *    owners' emails masked by the server.
 *  - PUBLISHED: by model (a model's filter reads its whole group, every variant), each with TAKE DOWN and a reason.
 *  - ENDED: refused, withdrawn, taken down or ended rows, their photographs erased, with who and when.
 *  - Every time in Paris. Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { formatAge, formatCount, humanize } from '../format.js';
import { WORN_REFUSALS, type AdminRole, type AdminWornPhoto, type Model, type WornCredit, type WornQueue, type WornRefusal, type WornStatus, type WornSummary } from '../types.js';
import { instagramHref } from './client-profile.js';
import { parisDateTime } from './links.js';
import { can } from './permissions.js';
import type { Tone } from './tone.js';

export const WORN_COPY = Object.freeze({
  title: 'WORN',
  lead: 'The photographs owners send from their pieces, read here before they appear at the foot of the model’s sheet with the owner’s first name and country. Nothing appears until it is published.',
  tabs: 'WORN',
  review: 'To review',
  published: 'Published',
  ended: 'Ended',
  // TO REVIEW
  nothingToReview: 'Nothing to review.',
  reviewNote: 'Oldest first. J and K move between the photographs.',
  credit: 'The credit, as it will read',
  creditNote: 'Under the photograph on the sheet. Never the piece, its variant or the owner’s account.',
  piece: 'Piece',
  model: 'Model',
  owner: 'Owner',
  sent: 'Sent',
  consent: 'Consent',
  publish: 'Publish',
  refuse: 'Refuse…',
  refuseTitle: 'Refuse this photograph',
  refuseBody: 'It is not shown, and it is erased. The owner reads the reason on the piece and may send another.',
  refuseConfirm: 'Refuse',
  reason: 'Reason',
  chooseReason: 'Choose a reason',
  ownerReads: 'The owner reads',
  published_: 'Published: it is on the model’s sheet.',
  refused: 'Refused: the photograph is erased.',
  stale: 'Someone has reviewed it already: the list is read again.',
  readOnly: 'An OPERATOR publishes, refuses or takes down.',
  photoErased: 'Erased',
  // PUBLISHED
  nothingPublished: 'No photograph published yet.',
  nothingPublishedModel: 'No photograph of this model published yet.',
  allModels: 'All models',
  modelFilter: 'Model',
  since: 'Published',
  notShown: 'Not shown now',
  notShownNote: 'Its owner’s account is locked, or the piece has just left its owner: it ends at the next housekeeping.',
  takeDown: 'Take down…',
  takeDownTitle: 'Take this photograph down',
  takeDownBody: 'It leaves the model’s sheet at once, and it is erased. The owner reads the reason on the piece.',
  takeDownConfirm: 'Take down',
  takenDown: 'Taken down: the photograph is erased.',
  // ENDED
  nothingEnded: 'Nothing has ended yet.',
  endedNote: 'Their photographs are erased: only the record stays.',
  status: 'Status',
  who: 'By',
  // The badge
  badgeLabel: ' to review',
  // A model's page
  modelLine: 'WORN',
  modelNote: 'Every variant’s photographs together, as the sheet shows them.',
  unread: 'Could not be read.',
});

/** A refusal in staff words (the console) and in the words the owner reads on the piece (plan MACRO M2 §2.3, §11 note 11). */
export const WORN_REFUSAL_WORDS: Readonly<Record<WornRefusal, { label: string; owner: string }>> = Object.freeze({
  PIECE_NOT_VISIBLE: { label: 'The piece is not clearly visible', owner: 'The piece is not clearly visible.' },
  QUALITY: { label: 'Not sharp enough', owner: 'The photograph is not sharp enough.' },
  NOT_SUITABLE: { label: 'Cannot be shown in WORN', owner: 'This photograph cannot be shown in WORN.' },
});

/** The reason's select: a first empty choice, then the three. */
export function refusalOptions(): { value: string; label: string; disabled?: boolean }[] {
  return [{ value: '', label: WORN_COPY.chooseReason, disabled: true }, ...WORN_REFUSALS.map((r) => ({ value: r, label: WORN_REFUSAL_WORDS[r].label }))];
}

export function isRefusal(v: unknown): v is WornRefusal {
  return typeof v === 'string' && (WORN_REFUSALS as readonly string[]).includes(v);
}

/** The dialog's check: one of the three. */
export function refusalProblem(v: string | undefined): string | null {
  return isRefusal(v) ? null : 'Choose a reason.';
}

/** What the owner will read, for the reason chosen; null before one is. */
export function ownerReads(v: string | undefined): string | null {
  return isRefusal(v) ? WORN_REFUSAL_WORDS[v].owner : null;
}

// ── The page's address ───────────────────────────────────────────────────────────────────────────────────────────

export type WornTab = 'review' | 'published' | 'ended';
export const WORN_TABS: readonly WornTab[] = ['review', 'published', 'ended'];
export const WORN_QUEUE_OF: Readonly<Record<WornTab, WornQueue>> = Object.freeze({ review: 'TO_REVIEW', published: 'PUBLISHED', ended: 'ENDED' });

export interface WornParams {
  tab: WornTab;
  /** PUBLISHED of a model's group (its id, a variant's or its main model's). */
  model: string | null;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `#/worn?tab=published&model=<id>&page=2`: a model alone opens PUBLISHED (a model page's line links there). */
export function wornParams(query: Readonly<Record<string, string | undefined>>): WornParams {
  const model = UUID.test(query.model ?? '') ? query.model!.toLowerCase() : null;
  const asked = WORN_TABS.find((t) => t === query.tab) ?? null;
  const tab: WornTab = model && (asked === null || asked === 'published') ? 'published' : (asked ?? 'review');
  const n = Number(query.page);
  return { tab, model: tab === 'published' ? model : null, page: Number.isInteger(n) && n > 0 ? n : 1 };
}

/** How many a page holds: the cards to review are large, the published grid holds more, the ended rows most. */
export const WORN_PAGE_SIZES: Readonly<Record<WornTab, number>> = Object.freeze({ review: 10, published: 24, ended: 50 });

/** PUBLISH, REFUSE and TAKE DOWN (OPERATOR); an AUDITOR reads. */
export function wornActions(role: AdminRole | null | undefined): { review: boolean } {
  return { review: can(role, 'reviewWorn') };
}

// ── The figures ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The sidebar's badge: the count to review, nothing at none. */
export function wornBadge(toReview: number): string {
  return Number.isFinite(toReview) && toReview > 0 ? formatCount(toReview) : '';
}

/** A tab's words, and its count when it is known (TO REVIEW and PUBLISHED; the count reads in --font). */
export function tabText(tab: WornTab, summary: WornSummary | null): { words: string; count: string | null } {
  const words = tab === 'review' ? WORN_COPY.review : tab === 'published' ? WORN_COPY.published : WORN_COPY.ended;
  if (!summary || tab === 'ended') return { words, count: null };
  return { words, count: formatCount(tab === 'review' ? summary.toReview : summary.published) };
}

/** Over the cards: how many wait and since when (`3 to review · the oldest sent 2 H AGO`); null at none. */
export function waitingLine(summary: WornSummary | null, now: Date): string | null {
  if (!summary || summary.toReview < 1) return null;
  const oldest = summary.oldestToReviewAt ? ` · the oldest sent ${formatAge(summary.oldestToReviewAt, now)}` : '';
  return `${formatCount(summary.toReview)} to review${oldest}`;
}

/** A model page's line (plan MACRO M2 §2.4), its label WORN and this value: `8 published`, `None published`. */
export function modelWornText(published: number | null): string {
  if (published === null) return WORN_COPY.unread;
  return published > 0 ? `${formatCount(published)} published` : 'None published';
}

/** The group a model's WORN reads (the sheet shows every variant's together): its main model's id for a variant. */
export function wornGroupOf(m: Pick<Model, 'id' | 'variantOf'>): string {
  return m.variantOf?.id ?? m.id;
}

// ── A photograph ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The credit exactly as it will read under the photograph (G3, plan MACRO M2 §2.3): `CAMILLE · FRANCE` in the label
 * face, then `@camille.m` (its Instagram address) when its owner chose it. Never a variant, a serial or an account.
 */
export function creditLine(c: WornCredit): { line: string; handle: string | null; href: string | null } {
  const line = `${c.firstName.trim()} · ${c.country.trim()}`.toUpperCase();
  const name = c.instagram?.trim() ? c.instagram.trim() : null;
  return { line, handle: name ? `@${name}` : null, href: name ? instagramHref(name) : null };
}

/** The model and its variant, as staff read it (the credit never carries the variant): `MONOLITHE · BLUE`. */
export function modelText(m: AdminWornPhoto['model']): string {
  return m.variantLabel ? `${humanize(m.name)} · ${humanize(m.variantLabel)}` : humanize(m.name);
}

/** The consent given: its version, then when, in Paris. */
export function consentText(p: Pick<AdminWornPhoto, 'consentVersion' | 'consentAt'>): string {
  return `Version ${p.consentVersion} · ${parisDateTime(p.consentAt)}`;
}

/** The photograph's alternative text: whose, of what (staff only). */
export function photoAlt(p: Pick<AdminWornPhoto, 'credit' | 'model'>): string {
  return `Photograph sent by ${p.credit.firstName.trim()}, ${p.credit.country.trim()}, wearing ${modelText(p.model)}`;
}

const STATUS_WORDS: Readonly<Record<WornStatus, { text: string; tone: Tone }>> = Object.freeze({
  PENDING: { text: 'To review', tone: 'alert' },
  PUBLISHED: { text: 'Published', tone: 'solid' },
  REFUSED: { text: 'Refused', tone: 'muted' },
  WITHDRAWN: { text: 'Withdrawn', tone: 'muted' },
  TAKEN_DOWN: { text: 'Taken down', tone: 'outline' },
  ENDED: { text: 'Ended', tone: 'muted' },
});

export function statusWords(s: WornStatus): { text: string; tone: Tone } {
  return STATUS_WORDS[s];
}

/** Why a photograph ended: the reason in staff words, the owner's withdrawal, or the piece leaving its owner. */
export function endedWhy(p: Pick<AdminWornPhoto, 'status' | 'refusal'>): string {
  if ((p.status === 'REFUSED' || p.status === 'TAKEN_DOWN') && p.refusal) return WORN_REFUSAL_WORDS[p.refusal].label;
  if (p.status === 'WITHDRAWN') return 'Withdrawn by its owner';
  if (p.status === 'ENDED') return 'The piece left its owner';
  return '—';
}

/** Who ended it: the reviewer's email, the owner, or the housekeeping. */
export function endedWho(p: Pick<AdminWornPhoto, 'status' | 'reviewedBy'>): string {
  if (p.status === 'REFUSED' || p.status === 'TAKEN_DOWN') return p.reviewedBy?.email ?? '—';
  if (p.status === 'WITHDRAWN') return 'The owner';
  if (p.status === 'ENDED') return 'ORBES, automatically';
  return '—';
}

/** The published photographs of a page, by model in the order they come (newest first), each group its model's name. */
export function groupByModel(items: readonly AdminWornPhoto[]): { key: string; title: string; items: AdminWornPhoto[] }[] {
  const groups = new Map<string, { key: string; title: string; items: AdminWornPhoto[] }>();
  for (const p of items) {
    const key = p.model.name.trim().toUpperCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, title: humanize(p.model.name), items: [] }));
    g.items.push(p);
  }
  return [...groups.values()];
}

/** The model filter's choices: the main models (a variant's photographs are its main model's group), by name. */
export function modelOptions(models: readonly Pick<Model, 'id' | 'name' | 'variantOf'>[]): { value: string; label: string }[] {
  return [
    { value: '', label: WORN_COPY.allModels },
    ...models
      .filter((m) => !m.variantOf)
      .map((m) => ({ value: m.id, label: humanize(m.name) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
  ];
}

// ── J/K ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The card J (next) or K (previous) moves to from `current` (-1: none focused yet: J takes the first, K the last),
 * held within the list; null for any other key, or with no card.
 */
export function stepCard(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  const k = key.toLowerCase();
  if (k !== 'j' && k !== 'k') return null;
  if (current < 0) return k === 'j' ? 0 : count - 1;
  return k === 'j' ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}
