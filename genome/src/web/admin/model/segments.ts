/**
 * The Segments page (Clients) of the console (plan LIVE RELEASE+, choice 27, N5) — pure helpers, no DOM.
 *
 *  - The bounds the server holds a segment to (services/segments.ts), mirrored and tested.
 *  - The four groups of criteria and each criterion's words: in the builder's choices, and for a segment said in one
 *    line (`criteriaWords`: « ALL OF took part in at least 3 releases · tier PLATINE or PALLADIUM »).
 *  - A criterion as the builder starts it (`defaultRule`), what the server would refuse in the rules being built, said
 *    before anything is sent (`segmentProblem`), and what may be done by whom.
 *
 * The server keeps every rule (SegmentService): these only say a refusal before it is asked for.
 */
import { formatCount, formatDateTime } from '../format.js';
import { can } from './permissions.js';
import {
  SEGMENT_CRITERIA,
  type AdminRole,
  type Segment,
  type SegmentCriterionGroup,
  type SegmentGroup,
  type SegmentOptions,
  type SegmentRule,
  type SegmentRuleKind,
} from '../types.js';

/** The bounds of services/segments.ts SEGMENT_LIMITS (test/web/admin.segments.test.ts compares them). */
export const SEGMENT_LIMITS = Object.freeze({
  name: 60,
  rules: 20,
  depth: 2,
  items: 50,
  count: Object.freeze({ min: 1, max: 100 }),
  days: Object.freeze({ min: 1, max: 3650 }),
  sizeLabel: 12,
});

/** The four groups of criteria (choice 27), as the builder heads them. */
export const SEGMENT_GROUP_LABELS: Readonly<Record<SegmentCriterionGroup, string>> = Object.freeze({
  RELEASES: 'Releases taken part in and pieces secured',
  CLUB: 'Tier, models and collections owned',
  PROFILE: 'Sizes and country',
  SIGNALS: 'Interest, answers and last activity',
});

/** Each criterion as the builder's choice names it. */
export const SEGMENT_RULE_LABELS: Readonly<Record<SegmentRuleKind, string>> = Object.freeze({
  PARTICIPATIONS: 'Took part in at least … releases',
  TOOK_PART: 'Took part in a release',
  SECURED: 'Secured at least … pieces',
  SECURED_IN: 'Secured a piece in a release',
  TIER: 'Tier now',
  OWNS_MODEL: 'Holds a piece of a model',
  OWNS_COLLECTION: 'Holds a piece of a collection',
  SIZE: 'Size',
  COUNTRY: 'Country',
  INTEREST: 'Said I’LL BE THERE',
  ANSWER: 'Answered the question after',
  ACTIVE: 'Active in the last … days',
});

/** The tiers as a criterion names them: 0 is an account that holds no piece. */
export const SEGMENT_TIER_LABELS: readonly string[] = Object.freeze(['NO TIER', 'TITANE', 'PLATINE', 'PALLADIUM']);

/** The builder's choice of a criterion, by group (for its <optgroup>s). */
export function criterionChoices(): { group: SegmentCriterionGroup; label: string; kinds: { value: SegmentRuleKind; label: string }[] }[] {
  return (Object.keys(SEGMENT_CRITERIA) as SegmentCriterionGroup[]).map((group) => ({
    group,
    label: SEGMENT_GROUP_LABELS[group],
    kinds: SEGMENT_CRITERIA[group].map((k) => ({ value: k, label: SEGMENT_RULE_LABELS[k] })),
  }));
}

/** Whether a rule of a tree is a group. */
export const isSegmentGroup = (r: SegmentRule | SegmentGroup): r is SegmentGroup => (r as SegmentGroup).match !== undefined;

/** The releases a criterion may name: every one for taking part and securing; LIVE ones for I'LL BE THERE; those asking a question for an answer. */
export function releaseChoices(o: SegmentOptions, kind: SegmentRuleKind): SegmentOptions['releases'] {
  if (kind === 'INTEREST') return o.releases.filter((r) => r.mode === 'LIVE');
  if (kind === 'ANSWER') return o.releases.filter((r) => r.mode === 'LIVE' && r.answers !== null && r.answers.length > 0);
  return o.releases;
}

/** A release as a choice names it: `MONOLITHE — LIVE · LIVE RELEASE · 11 OCT 2026`. */
export function releaseLabel(r: SegmentOptions['releases'][number]): string {
  return `${r.title} · ${r.mode === 'LIVE' ? 'LIVE RELEASE' : 'DRAW'} · ${formatDateTime(r.opensAt).slice(0, 11)}`;
}

/** A criterion as the builder starts it: its first choice where it names one ('' when there is none yet). */
export function defaultRule(kind: SegmentRuleKind, o: SegmentOptions): SegmentRule {
  const first = (k: SegmentRuleKind) => releaseChoices(o, k)[0]?.id ?? '';
  switch (kind) {
    case 'PARTICIPATIONS':
      return { kind, min: 3 };
    case 'TOOK_PART':
    case 'SECURED_IN':
      return { kind, dropId: first(kind) };
    case 'SECURED':
      return { kind, min: 1 };
    case 'TIER':
      return { kind, tiers: [2, 3] };
    case 'OWNS_MODEL':
      return { kind, modelIds: o.models[0] ? [o.models[0].id] : [] };
    case 'OWNS_COLLECTION':
      return { kind, collectionIds: o.collections[0] ? [o.collections[0].id] : [] };
    case 'SIZE':
      return { kind, sizes: o.sizes[0] ? [o.sizes[0]] : [] };
    case 'COUNTRY':
      return { kind, countries: o.countries[0] ? [o.countries[0]] : [] };
    case 'INTEREST':
      return { kind, dropId: null };
    case 'ANSWER':
      return { kind, dropId: first(kind), answer: 1 };
    case 'ACTIVE':
      return { kind, days: 90 };
  }
}

/** A list typed in one field, `52, 54` or `FR IT`: each item trimmed, in capitals, once. */
export function listItems(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => x.length > 0),
    ),
  ];
}

const inRange = (n: number, b: { min: number; max: number }) => Number.isInteger(n) && n >= b.min && n <= b.max;

/** What the server would refuse in one criterion, null when it may be sent. */
export function ruleProblem(r: SegmentRule, o: SegmentOptions): string | null {
  const label = SEGMENT_RULE_LABELS[r.kind].replace(' … ', ' N ');
  const items = (xs: readonly unknown[], what: string) => (xs.length < 1 ? `${label}: choose at least one ${what}.` : xs.length > SEGMENT_LIMITS.items ? `${label}: at most ${SEGMENT_LIMITS.items}.` : null);
  const release = (id: string) => (id && o.releases.some((x) => x.id === id) ? null : `${label}: choose the release.`);
  switch (r.kind) {
    case 'PARTICIPATIONS':
    case 'SECURED':
      return inRange(r.min, SEGMENT_LIMITS.count) ? null : `${label}: a whole number from ${SEGMENT_LIMITS.count.min} to ${SEGMENT_LIMITS.count.max}.`;
    case 'TOOK_PART':
    case 'SECURED_IN':
      return release(r.dropId);
    case 'TIER':
      return items(r.tiers, 'tier');
    case 'OWNS_MODEL':
      return items(r.modelIds, 'model');
    case 'OWNS_COLLECTION':
      return items(r.collectionIds, 'collection');
    case 'SIZE':
      return items(r.sizes, 'size') ?? (r.sizes.some((s) => s.length > SEGMENT_LIMITS.sizeLabel) ? `A size has at most ${SEGMENT_LIMITS.sizeLabel} characters.` : null);
    case 'COUNTRY':
      return items(r.countries, 'country') ?? (r.countries.some((c) => !/^[A-Z]{2}$/.test(c)) ? 'A country is its two letters: FR, IT, US.' : null);
    case 'INTEREST':
      return r.dropId === null ? null : release(r.dropId);
    case 'ANSWER': {
      const d = o.releases.find((x) => x.id === r.dropId);
      if (!d || !d.answers) return `${label}: choose a LIVE RELEASE that asks it.`;
      return r.answer >= 1 && r.answer <= d.answers.length ? null : `${label}: choose one of its answers.`;
    }
    case 'ACTIVE':
      return inRange(r.days, SEGMENT_LIMITS.days) ? null : `${label}: a whole number of days from ${SEGMENT_LIMITS.days.min} to ${formatCount(SEGMENT_LIMITS.days.max)}.`;
  }
}

/** What the server would refuse in the rules being built (and the name, when given), said first; null when they may be sent. */
export function segmentProblem(criteria: SegmentGroup, o: SegmentOptions, name?: string): string | null {
  if (name !== undefined) {
    const n = name.trim();
    if (!n) return 'Give the segment a name.';
    if (n.length > SEGMENT_LIMITS.name) return `A name has at most ${SEGMENT_LIMITS.name} characters.`;
  }
  const group = (g: SegmentGroup, depth: number): string | null => {
    if (g.rules.length < 1) return depth === 1 ? 'Add a rule: a segment names who belongs to it.' : 'A group holds at least one rule.';
    if (g.rules.length > SEGMENT_LIMITS.rules) return `A group holds at most ${SEGMENT_LIMITS.rules} rules.`;
    for (const r of g.rules) {
      const p = isSegmentGroup(r) ? (depth >= SEGMENT_LIMITS.depth ? 'A group within a group holds rules only.' : group(r, depth + 1)) : ruleProblem(r, o);
      if (p) return p;
    }
    return null;
  };
  return group(criteria, 1);
}

const either = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** One criterion in words: `took part in at least 3 releases`, `not tier PLATINE or PALLADIUM`. */
export function ruleWords(r: SegmentRule, o: SegmentOptions): string {
  const release = (id: string | null) => (id ? (o.releases.find((x) => x.id === id)?.title ?? 'a release no longer listed') : 'any LIVE RELEASE');
  let w: string;
  switch (r.kind) {
    case 'PARTICIPATIONS':
      w = `took part in at least ${plural(r.min, 'release', 'releases')}`;
      break;
    case 'TOOK_PART':
      w = `took part in ${release(r.dropId)}`;
      break;
    case 'SECURED':
      w = `secured at least ${plural(r.min, 'piece', 'pieces')}`;
      break;
    case 'SECURED_IN':
      w = `secured a piece in ${release(r.dropId)}`;
      break;
    case 'TIER':
      w = `tier ${either(r.tiers.map((t) => SEGMENT_TIER_LABELS[t] ?? String(t)))}`;
      break;
    case 'OWNS_MODEL':
      w = `holds a piece of ${either(r.modelIds.map((id) => o.models.find((m) => m.id === id)?.name ?? 'a model'))}`;
      break;
    case 'OWNS_COLLECTION':
      w = `holds a piece of the ${either(r.collectionIds.map((id) => o.collections.find((c) => c.id === id)?.name ?? 'a collection'))} collection`;
      break;
    case 'SIZE':
      w = `size ${either(r.sizes)}`;
      break;
    case 'COUNTRY':
      w = `country ${either(r.countries)}`;
      break;
    case 'INTEREST':
      w = `said I’LL BE THERE to ${release(r.dropId)}`;
      break;
    case 'ANSWER': {
      const d = o.releases.find((x) => x.id === r.dropId);
      w = `answered ${d?.answers?.[r.answer - 1] ?? `answer ${r.answer}`} after ${release(r.dropId)}`;
      break;
    }
    case 'ACTIVE':
      w = `active in the last ${plural(r.days, 'day', 'days')}`;
      break;
  }
  return r.not ? `not ${w}` : w;
}

/** A tree in one line: `ALL OF took part in at least 3 releases · (ANY OF size 52 · country FR)`. */
export function criteriaWords(g: SegmentGroup, o: SegmentOptions, nested = false): string {
  const parts = g.rules.map((r) => (isSegmentGroup(r) ? criteriaWords(r, o, true) : ruleWords(r, o)));
  const line = `${g.match === 'ALL' ? 'ALL OF' : 'ANY OF'} ${parts.join(' · ')}`;
  return nested ? `(${line})` : line;
}

/** The members of a segment now: `143 COLLECTORS`. */
export function membersLine(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'COLLECTOR' : 'COLLECTORS'}`;
}

/** What uses a segment: `2 releases · 1 post`, or null when nothing does. */
export function usedByLine(s: Pick<Segment, 'usedBy'>): string | null {
  const parts = [
    s.usedBy.releases.length ? plural(s.usedBy.releases.length, 'release', 'releases') : null,
    s.usedBy.posts.length ? plural(s.usedBy.posts.length, 'post of the circle', 'posts of the circle') : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? parts.join(' · ') : null;
}

export interface SegmentActions {
  /** Create, rename, change the rules. */
  edit: boolean;
  /** Delete: nothing uses it. */
  remove: boolean;
}

/** What `role` may do to a segment (the server checks again; this only hides what would be refused). */
export function segmentActions(s: Pick<Segment, 'usedBy'> | null, role: AdminRole | null | undefined): SegmentActions {
  const manage = can(role, 'manageSegments');
  return { edit: manage, remove: manage && s !== null && usedByLine(s) === null };
}
