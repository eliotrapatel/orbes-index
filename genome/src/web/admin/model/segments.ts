/**
 * The Segments page (Clients) of the console (plan LIVE RELEASE+, choice 27, N5) — pure helpers, no DOM.
 *
 *  - The bounds the server holds a segment to (services/segments.ts), mirrored and tested.
 *  - The groups of criteria (the four of choice 27, then the customer intelligence lot's five: plan CUSTOMER
 *    INTELLIGENCE §3.0 (g), §3.6 C.5.1) and each criterion's words: in the builder's choices, and for a segment said in
 *    one line (`criteriaWords`: « ALL OF took part in at least 3 releases · tier PLATINE or PALLADIUM »).
 *  - A criterion as the builder starts it (`defaultRule`), what the server would refuse in the rules being built, said
 *    before anything is sent (`segmentProblem`), and what may be done by whom.
 *  - The words of the lot's controls: the device lists, the kinds of source, LAST_SOURCE's act, a retired taste, the
 *    model picker's hint, the notice while a rule reads the engagement score.
 *
 * The server keeps every rule (SegmentService): these only say a refusal before it is asked for.
 */
import { countryName } from '../../../shared/countries.js';
import { fold } from '../../../shared/fold.js';
import { formatCount, formatDateTime } from '../format.js';
import { tagProblem, tagValue } from './client-notes.js';
import { LINE_LABELS } from './links.js';
import { APP_WORDS } from './owner-intelligence.js';
import { can } from './permissions.js';
import {
  SEGMENT_CRITERIA,
  type AdminRole,
  type DeviceKind,
  type DeviceSystem,
  type LastSourceAt,
  type OpenedIn,
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
  age: Object.freeze({ min: 0, max: 120 }),
  city: 80,
  tag: 32,
  viewDays: Object.freeze({ min: 1, max: 395 }),
  viewMin: Object.freeze({ min: 1, max: 100 }),
  score: Object.freeze({ min: 0, max: 100 }),
});

/** The groups of criteria, as the builder heads them: the four of choice 27, then the lot's five (§3.6 C.5.1). */
export const SEGMENT_GROUP_LABELS: Readonly<Record<SegmentCriterionGroup, string>> = Object.freeze({
  RELEASES: 'Releases taken part in and pieces secured',
  CLUB: 'Tier, models and collections owned',
  PROFILE: 'Sizes and country',
  SIGNALS: 'Interest, answers and last activity',
  PERSON: 'City, age, how they heard and tags',
  TASTES: 'Wishlist and favourite pieces and finishes',
  BROWSING: 'What they look at, devices and places',
  ORIGIN: 'Where they come from',
  ENGAGEMENT: 'Engagement score',
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
  CITY: 'City',
  AGE: 'Age between … and …',
  HEARD_FROM: 'How they heard of ORBES',
  TAGGED: 'Tagged',
  WISHES_MODEL: 'Wishes for a model',
  WISHES_COLLECTION: 'Wishes for a model of a collection',
  FAVOURITE_PIECE: 'Favourite pieces',
  FAVOURITE_FINISH: 'Favourite finishes',
  VIEWED_MODEL: 'Viewed a model',
  VIEWED_RELEASE: 'Viewed a release',
  DEVICE: 'Device',
  PLACE: 'Seen from',
  FIRST_SOURCE: 'Came first through',
  LAST_SOURCE: 'Came last through',
  FOUNDING_LIST: 'On the founding list',
  SCORE: 'Engagement score from … to …',
});

/** The words of the lot's controls (§3.2 W.6, §3.5 SB.3.4, §3.6 C.5.1). */
export const SEGMENT_COPY = Object.freeze({
  /** Under the model picker of WISHES_MODEL and VIEWED_MODEL: naming a main model includes its variants. */
  modelHint: 'A main model includes its variants. Tick a variant alone to target only it.',
  /** Under the builder while a rule reads the engagement score. */
  scoreNotice: 'Scores are calculated each morning. Accounts created since then have none yet.',
  retired: '(no longer in the collection)',
  setAside: '(set aside)',
  archived: '(archived)',
  from: 'From',
  to: 'To',
});

/** DEVICE's lists, as its checkboxes say them. */
export const DEVICE_KIND_LABELS: Readonly<Record<DeviceKind, string>> = Object.freeze({ PHONE: 'Phone', TABLET: 'Tablet', COMPUTER: 'Computer', UNKNOWN: 'Unknown device' });
export const DEVICE_SYSTEM_LABELS: Readonly<Record<DeviceSystem, string>> = Object.freeze({
  IOS: 'iOS',
  ANDROID: 'Android',
  MACOS: 'macOS',
  WINDOWS: 'Windows',
  CHROMEOS: 'ChromeOS',
  LINUX: 'Linux',
  OTHER: 'Another system',
});
export const OPENED_IN_LABELS: Readonly<Record<OpenedIn, string>> = Object.freeze({ BROWSER: 'In a browser', IN_APP: 'Inside an app', HOME_SCREEN: 'From the home screen' });
/** LAST_SOURCE's act, as its select says it and as its words close it. */
export const LAST_SOURCE_AT_LABELS: Readonly<Record<LastSourceAt, string>> = Object.freeze({ SIGNUP: 'Sign-up', PURCHASE: 'Purchase', EITHER: 'Either' });
const LAST_SOURCE_AT_WORDS: Readonly<Record<LastSourceAt, string>> = Object.freeze({ SIGNUP: 'sign-up', PURCHASE: 'purchase', EITHER: 'sign-up or purchase' });

/** Whether the rules being built read the engagement score (the builder's notice). */
export function readsScore(g: SegmentGroup): boolean {
  return g.rules.some((r) => (isSegmentGroup(r) ? readsScore(r) : r.kind === 'SCORE'));
}

/** A model as the pickers list it, as OWNS_MODEL's does: `MONOLITHE · RING · Blue`. */
export function modelLabel(m: SegmentOptions['models'][number]): string {
  return [m.name, m.type, m.variant].filter((x): x is string => !!x).join(' · ');
}

/** A city as CITY keeps it: folded like `orbes_fold`, so the builder's draft is what the server saves. */
export function cityValue(v: string): string {
  return fold(v.replace(/\s+/gu, ' ').trim());
}

/** A list typed in one field and separated by commas, each item kept whole (a city or a tag may hold spaces), once. */
export function commaItems(text: string, each: (x: string) => string = (x) => x.trim()): string[] {
  return [
    ...new Set(
      text
        .split(/[,;]+/)
        .map((x) => each(x))
        .filter((x) => x.length > 0),
    ),
  ];
}

/** A city kept folded, as the options show it (the most often typed), else as kept. */
export function cityLabel(folded: string, o: SegmentOptions): string {
  return o.cities.find((c) => cityValue(c) === folded) ?? folded;
}

/** The choices of FAVOURITE_PIECE or FAVOURITE_FINISH: the options', then a key the rule holds that they no longer list. */
export function tasteChoicesFor(kind: 'FAVOURITE_PIECE' | 'FAVOURITE_FINISH', held: readonly string[], o: SegmentOptions): { key: string; label: string; swatch: string | null; retired: boolean }[] {
  const listed: { key: string; label: string; swatch: string | null; retired: boolean }[] = kind === 'FAVOURITE_PIECE' ? o.tastes.pieces.map((x) => ({ ...x, swatch: null })) : o.tastes.finishes;
  return [...listed, ...held.filter((k) => !listed.some((x) => x.key === k)).map((k) => ({ key: k, label: k, swatch: null, retired: true }))];
}

/** A taste as a choice says it: its label, a retired one with « (no longer in the collection) ». */
export function tasteLabel(t: { label: string; retired: boolean }): string {
  return t.retired ? `${t.label} ${SEGMENT_COPY.retired}` : t.label;
}

/** An answer of « How did you hear about ORBES? » as a choice says it, one set aside marked. */
export function heardLabel(a: SegmentOptions['heardOptions'][number]): string {
  return a.setAside ? `${a.label} ${SEGMENT_COPY.setAside}` : a.label;
}

/** A link as a choice says it: `Instagram bio · Instagram`, an archived one marked. */
export function linkLabel(l: SegmentOptions['links'][number]): string {
  return `${l.name} · ${l.channel}${l.archived ? ` ${SEGMENT_COPY.archived}` : ''}`;
}

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
    // The lot's (§3.6 C.5.1): the first choice of the options, the bounds the plan names.
    case 'CITY':
      return { kind, cities: o.cities[0] ? [cityValue(o.cities[0])] : [] };
    case 'AGE':
      return { kind, min: 25, max: 34 };
    case 'HEARD_FROM':
      return { kind, optionIds: o.heardOptions[0] ? [o.heardOptions[0].id] : [] };
    case 'TAGGED':
      return { kind, tags: o.tags[0] ? [o.tags[0].tag] : [] };
    case 'WISHES_MODEL':
      return { kind, modelIds: o.models[0] ? [o.models[0].id] : [] };
    case 'WISHES_COLLECTION':
      return { kind, collectionIds: o.collections[0] ? [o.collections[0].id] : [] };
    case 'FAVOURITE_PIECE':
      return { kind, pieces: o.tastes.pieces[0] ? [o.tastes.pieces[0].key] : [] };
    case 'FAVOURITE_FINISH':
      return { kind, finishes: o.tastes.finishes[0] ? [o.tastes.finishes[0].key] : [] };
    case 'VIEWED_MODEL':
      return { kind, modelIds: o.models[0] ? [o.models[0].id] : [], min: 1, days: 30 };
    case 'VIEWED_RELEASE':
      return { kind, dropId: o.releases[0]?.id ?? '', min: 1 };
    case 'DEVICE':
      return { kind, kinds: ['PHONE'], days: 90 };
    case 'PLACE':
      return { kind, countries: o.countries[0] ? [o.countries[0]] : [], days: 90 };
    case 'FIRST_SOURCE':
      return { kind, channelIds: o.channels[0] ? [o.channels[0].id] : [] };
    case 'LAST_SOURCE':
      return { kind, linkIds: o.links[0] ? [o.links[0].id] : [], at: 'EITHER' };
    case 'FOUNDING_LIST':
      return { kind };
    case 'SCORE':
      return { kind, min: 60, max: 100 };
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
  const days = (n: number) => (inRange(n, SEGMENT_LIMITS.viewDays) ? null : `${label} in the last N days: from ${SEGMENT_LIMITS.viewDays.min} to ${SEGMENT_LIMITS.viewDays.max}.`);
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
    // The lot's (§3.6 C.5.1).
    case 'CITY':
      return items(r.cities, 'city') ?? (r.cities.some((c) => [...c].length > SEGMENT_LIMITS.city) ? `A city has at most ${SEGMENT_LIMITS.city} characters.` : null);
    case 'AGE':
      return inRange(r.min, SEGMENT_LIMITS.age) && inRange(r.max, SEGMENT_LIMITS.age) && r.min <= r.max
        ? null
        : `Age between N and N: whole years from ${SEGMENT_LIMITS.age.min} to ${SEGMENT_LIMITS.age.max}, the first not above the second.`;
    case 'HEARD_FROM':
      return items(r.optionIds, 'answer');
    case 'TAGGED':
      return items(r.tags, 'tag') ?? r.tags.map((t) => tagProblem(t, [])).find((p) => p !== null) ?? null;
    case 'WISHES_MODEL':
      return items(r.modelIds, 'model');
    case 'WISHES_COLLECTION':
      return items(r.collectionIds, 'collection');
    case 'FAVOURITE_PIECE':
      return items(r.pieces, 'piece');
    case 'FAVOURITE_FINISH':
      return items(r.finishes, 'finish');
    case 'VIEWED_MODEL':
      return (
        items(r.modelIds, 'model') ??
        (inRange(r.min, SEGMENT_LIMITS.viewMin) ? null : `Viewed a model at least N times: from ${SEGMENT_LIMITS.viewMin.min} to ${SEGMENT_LIMITS.viewMin.max}.`) ??
        (inRange(r.days, SEGMENT_LIMITS.viewDays) ? null : `Viewed a model in the last N days: from ${SEGMENT_LIMITS.viewDays.min} to ${SEGMENT_LIMITS.viewDays.max}.`)
      );
    case 'VIEWED_RELEASE':
      return release(r.dropId) ?? (inRange(r.min, SEGMENT_LIMITS.viewMin) ? null : `Viewed a release at least N times: from ${SEGMENT_LIMITS.viewMin.min} to ${SEGMENT_LIMITS.viewMin.max}.`);
    case 'DEVICE': {
      const lists: (readonly string[])[] = [r.kinds ?? [], r.systems ?? [], r.openedIn ?? [], r.apps ?? []];
      if (lists.every((x) => x.length === 0)) return 'Device: tick at least one.';
      return lists.map((x) => (x.length > SEGMENT_LIMITS.items ? `${label}: at most ${SEGMENT_LIMITS.items}.` : null)).find((p) => p !== null) ?? days(r.days);
    }
    case 'PLACE': {
      const lists: (readonly unknown[])[] = [r.countries ?? [], r.placeIds ?? []];
      if (lists.every((x) => x.length === 0)) return `${label}: choose at least one place.`;
      if (lists.some((x) => x.length > SEGMENT_LIMITS.items)) return `${label}: at most ${SEGMENT_LIMITS.items}.`;
      return (r.countries ?? []).some((c) => !/^[A-Z]{2}$/.test(c)) ? 'A country is its two letters: FR, IT, US.' : days(r.days);
    }
    case 'FIRST_SOURCE':
    case 'LAST_SOURCE': {
      const lists: (readonly string[])[] = [r.channelIds ?? [], r.linkIds ?? [], r.kinds ?? []];
      if (lists.every((x) => x.length === 0)) return `${label}: choose at least one channel, link or source.`;
      return lists.some((x) => x.length > SEGMENT_LIMITS.items) ? `${label}: at most ${SEGMENT_LIMITS.items}.` : null;
    }
    case 'FOUNDING_LIST':
      return null;
    case 'SCORE':
      return inRange(r.min, SEGMENT_LIMITS.score) && inRange(r.max, SEGMENT_LIMITS.score) && r.min <= r.max
        ? null
        : `Engagement score: two whole numbers from ${SEGMENT_LIMITS.score.min} to ${SEGMENT_LIMITS.score.max}, the first not above the second.`;
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
    // The lot's (§3.6 C.5.1, §3.2 W.6, §3.3 T.4.3, §3.5 SB.3.4).
    case 'CITY':
      w = `city ${either(r.cities.map((c) => cityLabel(c, o)))}`;
      break;
    case 'AGE':
      w = r.min === r.max ? `age ${r.min}` : `age ${r.min} to ${r.max}`;
      break;
    case 'HEARD_FROM':
      w = `how they heard: ${either(r.optionIds.map((id) => o.heardOptions.find((x) => x.id === id)?.label ?? 'an answer no longer listed'))}`;
      break;
    case 'TAGGED':
      w = `tagged ${either(r.tags)}`;
      break;
    case 'WISHES_MODEL': {
      const models = either(r.modelIds.map((id) => wishedModel(id, o)));
      return r.not ? `does not wish for ${models}` : `wishes for ${models}`;
    }
    case 'WISHES_COLLECTION': {
      const collections = either(r.collectionIds.map((id) => o.collections.find((c) => c.id === id)?.name ?? 'a collection no longer listed'));
      return r.not ? `does not wish for a model of ${collections}` : `wishes for a model of ${collections}`;
    }
    case 'FAVOURITE_PIECE':
    case 'FAVOURITE_FINISH': {
      const [what, keys] = r.kind === 'FAVOURITE_PIECE' ? (['favourite pieces', r.pieces] as const) : (['favourite finishes', r.finishes] as const);
      const names = either(keys.map((k) => tasteChoicesFor(r.kind, keys, o).find((x) => x.key === k)!.label));
      return r.not ? `${what} do not include ${names}` : `${what} include ${names}`;
    }
    case 'VIEWED_MODEL':
      w = `viewed ${either(r.modelIds.map((id) => wishedModel(id, o)))} ${times(r.min)} in the last ${plural(r.days, 'day', 'days')}`;
      break;
    case 'VIEWED_RELEASE':
      w = `viewed the release ${o.releases.find((x) => x.id === r.dropId)?.title ?? 'no longer listed'} ${times(r.min)}`;
      break;
    case 'DEVICE':
      w = `used ${deviceWords(r)}, in the last ${plural(r.days, 'day', 'days')}`;
      break;
    case 'PLACE': {
      const places = [...(r.placeIds ?? []).map((id) => o.places.find((x) => x.id === id)?.label ?? 'a place no longer listed'), ...(r.countries ?? []).map((c) => countryName(c))];
      w = `seen from ${either(places)} in the last ${plural(r.days, 'day', 'days')}`;
      break;
    }
    case 'FIRST_SOURCE':
      w = `came first through ${either(sourceNames(r, o))}`;
      break;
    case 'LAST_SOURCE':
      w = `came last through ${either(sourceNames(r, o))} (${LAST_SOURCE_AT_WORDS[r.at]})`;
      break;
    case 'FOUNDING_LIST':
      w = 'on the founding list';
      break;
    case 'SCORE':
      w = `engagement score ${r.min} to ${r.max}`;
      break;
  }
  return r.not ? `not ${w}` : w;
}

/** A model a rule names, with its variant label: `MONOLITHE · Blue`. */
function wishedModel(id: string, o: SegmentOptions): string {
  const m = o.models.find((x) => x.id === id);
  return m ? [m.name, m.variant].filter((x): x is string => !!x).join(' · ') : 'a model no longer listed';
}

/** At least once, twice, 3 times. */
const times = (n: number) => (n === 1 ? 'at least once' : n === 2 ? 'at least twice' : `at least ${formatCount(n)} times`);

/** DEVICE's lists in words: `an iPhone, inside Instagram`, `a phone or a tablet on Android, in a browser`. */
function deviceWords(r: Extract<SegmentRule, { kind: 'DEVICE' }>): string {
  const kinds = r.kinds ?? [];
  const systems = r.systems ?? [];
  const named: Partial<Record<string, string>> = { 'PHONE IOS': 'an iPhone', 'TABLET IOS': 'an iPad', 'PHONE ANDROID': 'an Android phone', 'TABLET ANDROID': 'an Android tablet' };
  const article: Record<DeviceKind, string> = { PHONE: 'a phone', TABLET: 'a tablet', COMPUTER: 'a computer', UNKNOWN: 'an unknown device' };
  const one = kinds.length === 1 && systems.length === 1 ? named[`${kinds[0]} ${systems[0]}`] : undefined;
  const parts: string[] = [];
  if (one) parts.push(one);
  else {
    const device = kinds.length ? either(kinds.map((k) => article[k])) : 'a device';
    parts.push(systems.length ? `${device} on ${either(systems.map((x) => DEVICE_SYSTEM_LABELS[x]))}` : device);
  }
  if (r.openedIn?.length) parts.push(either(r.openedIn.map((x) => OPENED_IN_LABELS[x].toLowerCase())));
  if (r.apps?.length) parts.push(`inside ${either(r.apps.map((x) => APP_WORDS[x]))}`);
  return parts.join(', ');
}

/** The channels, links and kinds of source a rule names. */
function sourceNames(r: Extract<SegmentRule, { kind: 'FIRST_SOURCE' | 'LAST_SOURCE' }>, o: SegmentOptions): string[] {
  return [
    ...(r.channelIds ?? []).map((id) => o.channels.find((c) => c.id === id)?.name ?? 'a channel no longer listed'),
    ...(r.linkIds ?? []).map((id) => o.links.find((l) => l.id === id)?.name ?? 'a link no longer listed'),
    ...(r.kinds ?? []).map((k) => LINE_LABELS[k]),
  ];
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

/** What uses a segment: `2 releases · 1 post of the circle · 1 house message`, or null when nothing does. */
export function usedByLine(s: Pick<Segment, 'usedBy'>): string | null {
  const parts = [
    s.usedBy.releases.length ? plural(s.usedBy.releases.length, 'release', 'releases') : null,
    s.usedBy.posts.length ? plural(s.usedBy.posts.length, 'post of the circle', 'posts of the circle') : null,
    // Plan MACRO M2 §1.6: a house message not sent yet (draft or scheduled) whose audience it is.
    s.usedBy.houseMessages.length ? plural(s.usedBy.houseMessages.length, 'house message', 'house messages') : null,
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
