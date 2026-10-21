/**
 * The console's Segments page, pure (web/admin/model/segments.ts) and its API client (web/admin/api.ts), with the
 * circle's segment audience (web/admin/model/circle.ts): the bounds and criteria mirror the server's; a criterion as the
 * builder starts it; what the server would refuse, said before anything is sent; a segment in words; what each role may
 * do; the client's paths and bodies.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT_CRITERIA as SERVER_CRITERIA, SEGMENT_LIMITS as SERVER_LIMITS, SEGMENT_MATCHES as SERVER_MATCHES, SEGMENT_RULE_KINDS as SERVER_KINDS, SEGMENT_SOURCE_KINDS } from '../../src/server/services/segments.js';
import { LAST_SOURCE_AT as SERVER_LAST_SOURCE_AT } from '../../src/server/services/acquisition-filters.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import { audienceLine, circleChange, circleInput } from '../../src/web/admin/model/circle.js';
import {
  cityLabel,
  cityValue,
  commaItems,
  criteriaWords,
  criterionChoices,
  defaultRule,
  heardLabel,
  linkLabel,
  listItems,
  modelLabel,
  readsScore,
  SEGMENT_COPY,
  tasteChoicesFor,
  tasteLabel,
  membersLine,
  releaseChoices,
  ruleProblem,
  ruleWords,
  segmentActions,
  segmentProblem,
  SEGMENT_LIMITS,
  SEGMENT_RULE_LABELS,
  usedByLine,
} from '../../src/web/admin/model/segments.js';
import {
  DEVICE_KINDS,
  DEVICE_SYSTEMS,
  IN_APPS,
  LAST_SOURCE_AT,
  OPENED_IN,
  SEGMENT_CRITERIA,
  SEGMENT_MATCHES,
  SEGMENT_RULE_KINDS,
  SOURCE_KINDS,
  type CirclePost,
  type Segment,
  type SegmentGroup,
  type SegmentOptions,
} from '../../src/web/admin/types.js';

const LIVE = 'd1d1d1d1-0000-4000-8000-000000000001';
const DRAW = 'd2d2d2d2-0000-4000-8000-000000000002';
const QUIET = 'd3d3d3d3-0000-4000-8000-000000000003';
const OPTIONS: SegmentOptions = {
  releases: [
    { id: LIVE, title: 'MONOLITHE — LIVE', mode: 'LIVE', opensAt: '2026-11-11T18:00:00.000Z', answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'] },
    { id: DRAW, title: 'ORBIT — RELEASE I', mode: 'DRAW', opensAt: '2026-10-01T09:00:00.000Z', answers: null },
    { id: QUIET, title: 'HALO — LIVE', mode: 'LIVE', opensAt: '2026-09-01T09:00:00.000Z', answers: null },
  ],
  models: [
    { id: 'm1', name: 'MONOLITHE', type: 'RING' },
    { id: 'm3', name: 'MONOLITHE', type: 'RING', variant: 'Blue' },
    { id: 'm2', name: 'ORBIT', type: 'PENDANT' },
  ],
  collections: [{ id: 'c1', name: 'NOCTURNE' }],
  sizes: ['50', '52'],
  countries: ['FR', 'IT'],
  // The customer intelligence lot's lists (plan CUSTOMER INTELLIGENCE §3.6 C.5.2).
  cities: ['Lyon', 'Saint-Étienne', 'Milan'],
  heardOptions: [
    { id: 'h1', label: 'A friend', setAside: false },
    { id: 'h2', label: 'The press', setAside: true },
  ],
  tags: [
    { tag: 'VIP', accounts: 12 },
    { tag: 'PRESS', accounts: 3 },
  ],
  tastes: {
    pieces: [
      { key: 'RING', label: 'RING', retired: false },
      { key: 'CUFF', label: 'CUFF', retired: false },
      { key: 'BROOCH', label: 'BROOCH', retired: true },
    ],
    finishes: [
      { key: 'GOLD', label: 'Gold', swatch: '#C9A227', retired: false },
      { key: 'ROSE GOLD', label: 'Rose gold', swatch: null, retired: true },
    ],
  },
  channels: [
    { id: 'ch1', name: 'Instagram' },
    { id: 'ch2', name: 'Press' },
  ],
  sourceKinds: ['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'],
  links: [
    { id: 'l2', name: 'Instagram bio', channel: 'Instagram', archived: false },
    { id: 'l1', name: 'Press feature', channel: 'Press', archived: true },
  ],
  places: [
    { id: 7, label: 'Paris, France' },
    { id: 9, label: 'Milan, Italy' },
  ],
  devices: {
    kinds: ['PHONE', 'TABLET', 'COMPUTER', 'UNKNOWN'],
    systems: ['IOS', 'ANDROID', 'MACOS', 'WINDOWS', 'CHROMEOS', 'LINUX', 'OTHER'],
    openedIn: ['BROWSER', 'IN_APP', 'HOME_SCREEN'],
    apps: ['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'THREADS', 'SNAPCHAT', 'PINTEREST', 'LINKEDIN', 'GOOGLE', 'WECHAT', 'LINE', 'OTHER'],
  },
};

describe('the Segments page mirrors the server', () => {
  it('holds the same bounds, criteria by group and ways to match', () => {
    expect(SEGMENT_LIMITS).toEqual({ ...SERVER_LIMITS, count: { ...SERVER_LIMITS.count }, days: { ...SERVER_LIMITS.days } });
    // The customer intelligence lot's groups (plan CUSTOMER INTELLIGENCE §3.0 (g), steps 8.1 to 8.7): the builder now
    // mirrors every group the server holds, in its order.
    expect(JSON.parse(JSON.stringify(SEGMENT_CRITERIA))).toEqual(JSON.parse(JSON.stringify(SERVER_CRITERIA)));
    expect([...SEGMENT_RULE_KINDS]).toEqual([...SERVER_KINDS]);
    expect(Object.values(SERVER_CRITERIA).flat()).toEqual([...SERVER_KINDS]);
    expect([...SEGMENT_MATCHES]).toEqual([...SERVER_MATCHES]);
    expect([...LAST_SOURCE_AT]).toEqual([...SERVER_LAST_SOURCE_AT]);
    // Every criterion has its words, in its group: the four of choice 27 unchanged, then the lot's five.
    expect(criterionChoices().map((g) => [g.label, g.kinds.map((k) => k.value)])).toEqual([
      ['Releases taken part in and pieces secured', ['PARTICIPATIONS', 'TOOK_PART', 'SECURED', 'SECURED_IN']],
      ['Tier, models and collections owned', ['TIER', 'OWNS_MODEL', 'OWNS_COLLECTION']],
      ['Sizes and country', ['SIZE', 'COUNTRY']],
      ['Interest, answers and last activity', ['INTEREST', 'ANSWER', 'ACTIVE']],
      ['City, age, how they heard and tags', ['CITY', 'AGE', 'HEARD_FROM', 'TAGGED']],
      ['Wishlist and favourite pieces and finishes', ['WISHES_MODEL', 'WISHES_COLLECTION', 'FAVOURITE_PIECE', 'FAVOURITE_FINISH']],
      ['What they look at, devices and places', ['VIEWED_MODEL', 'VIEWED_RELEASE', 'DEVICE', 'PLACE']],
      ['Where they come from', ['FIRST_SOURCE', 'LAST_SOURCE', 'FOUNDING_LIST']],
      ['Engagement score', ['SCORE']],
    ]);
    expect(SEGMENT_RULE_KINDS.slice(12).map((k) => SEGMENT_RULE_LABELS[k])).toEqual([
      'City',
      'Age between … and …',
      'How they heard of ORBES',
      'Tagged',
      'Wishes for a model',
      'Wishes for a model of a collection',
      'Favourite pieces',
      'Favourite finishes',
      'Viewed a model',
      'Viewed a release',
      'Device',
      'Seen from',
      'Came first through',
      'Came last through',
      'On the founding list',
      'Engagement score from … to …',
    ]);
    // The lists the builder offers are the server's: every kind of source FIRST_SOURCE takes, every device list.
    expect(OPTIONS.sourceKinds).toEqual([...SEGMENT_SOURCE_KINDS]);
    for (const k of SEGMENT_SOURCE_KINDS) expect(SOURCE_KINDS).toContain(k);
    expect(OPTIONS.devices).toEqual({ kinds: [...DEVICE_KINDS], systems: [...DEVICE_SYSTEMS], openedIn: [...OPENED_IN], apps: [...IN_APPS] });
    for (const k of SEGMENT_RULE_KINDS) expect(SEGMENT_RULE_LABELS[k], k).toBeTruthy();
  });
});

describe('the builder', () => {
  it('starts each criterion with its first choice, and names the releases each may', () => {
    expect(defaultRule('PARTICIPATIONS', OPTIONS)).toEqual({ kind: 'PARTICIPATIONS', min: 3 });
    expect(defaultRule('TOOK_PART', OPTIONS)).toEqual({ kind: 'TOOK_PART', dropId: LIVE });
    expect(defaultRule('INTEREST', OPTIONS)).toEqual({ kind: 'INTEREST', dropId: null });
    expect(defaultRule('ANSWER', OPTIONS)).toEqual({ kind: 'ANSWER', dropId: LIVE, answer: 1 });
    expect(defaultRule('TIER', OPTIONS)).toEqual({ kind: 'TIER', tiers: [2, 3] });
    expect(defaultRule('SIZE', OPTIONS)).toEqual({ kind: 'SIZE', sizes: ['50'] });
    expect(defaultRule('OWNS_MODEL', { ...OPTIONS, models: [] })).toEqual({ kind: 'OWNS_MODEL', modelIds: [] });
    expect(releaseChoices(OPTIONS, 'SECURED_IN').map((r) => r.id)).toEqual([LIVE, DRAW, QUIET]);
    expect(releaseChoices(OPTIONS, 'INTEREST').map((r) => r.id)).toEqual([LIVE, QUIET]);
    expect(releaseChoices(OPTIONS, 'ANSWER').map((r) => r.id)).toEqual([LIVE]);
    expect(listItems(' 52, 54;54  m ')).toEqual(['52', '54', 'M']);
  });

  it('says what the server would refuse before anything is sent', () => {
    const tree = (...rules: SegmentGroup['rules']): SegmentGroup => ({ match: 'ALL', rules });
    expect(segmentProblem(tree(), OPTIONS)).toBe('Add a rule: a segment names who belongs to it.');
    expect(segmentProblem(tree({ kind: 'SECURED', min: 1 }), OPTIONS, ' ')).toBe('Give the segment a name.');
    expect(segmentProblem(tree({ kind: 'SECURED', min: 1 }), OPTIONS, 'x'.repeat(61))).toBe('A name has at most 60 characters.');
    expect(segmentProblem(tree({ kind: 'SECURED', min: 1 }), OPTIONS, 'Buyers')).toBeNull();
    expect(ruleProblem({ kind: 'PARTICIPATIONS', min: Number.NaN }, OPTIONS)).toBe('Took part in at least N releases: a whole number from 1 to 100.');
    expect(ruleProblem({ kind: 'TOOK_PART', dropId: '' }, OPTIONS)).toBe('Took part in a release: choose the release.');
    expect(ruleProblem({ kind: 'TIER', tiers: [] }, OPTIONS)).toBe('Tier now: choose at least one tier.');
    expect(ruleProblem({ kind: 'COUNTRY', countries: ['FRA'] }, OPTIONS)).toBe('A country is its two letters: FR, IT, US.');
    expect(ruleProblem({ kind: 'SIZE', sizes: ['X'.repeat(13)] }, OPTIONS)).toBe('A size has at most 12 characters.');
    expect(ruleProblem({ kind: 'ANSWER', dropId: DRAW, answer: 1 }, OPTIONS)).toBe('Answered the question after: choose a LIVE RELEASE that asks it.');
    expect(ruleProblem({ kind: 'ANSWER', dropId: LIVE, answer: 4 }, OPTIONS)).toBe('Answered the question after: choose one of its answers.');
    expect(ruleProblem({ kind: 'ACTIVE', days: 4000 }, OPTIONS)).toBe(`Active in the last N days: a whole number of days from 1 to ${formatCount(3650)}.`);
    expect(ruleProblem({ kind: 'INTEREST', dropId: null }, OPTIONS)).toBeNull();
    // A group within a group holds rules only; a group holds one rule at least.
    expect(segmentProblem(tree({ match: 'ANY', rules: [{ match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] }] }), OPTIONS)).toBe('A group within a group holds rules only.');
    expect(segmentProblem(tree({ match: 'ANY', rules: [] }), OPTIONS)).toBe('A group holds at least one rule.');
    expect(segmentProblem(tree(...Array.from({ length: 21 }, () => ({ kind: 'SECURED' as const, min: 1 }))), OPTIONS)).toBe('A group holds at most 20 rules.');
  });

  it('says a segment in words, its members and what uses it', () => {
    const tree: SegmentGroup = {
      match: 'ALL',
      rules: [
        { kind: 'PARTICIPATIONS', min: 3 },
        { kind: 'SECURED_IN', dropId: LIVE, not: true },
        { match: 'ANY', rules: [{ kind: 'SIZE', sizes: ['50', '52'] }, { kind: 'COUNTRY', countries: ['FR'] }, { kind: 'TIER', tiers: [2, 3] }] },
      ],
    };
    expect(criteriaWords(tree, OPTIONS)).toBe('ALL OF took part in at least 3 releases · not secured a piece in MONOLITHE — LIVE · (ANY OF size 50 or 52 · country FR · tier PLATINE or PALLADIUM)');
    expect(ruleWords({ kind: 'OWNS_MODEL', modelIds: ['m1', 'm2'] }, OPTIONS)).toBe('holds a piece of MONOLITHE or ORBIT');
    expect(ruleWords({ kind: 'OWNS_COLLECTION', collectionIds: ['c1'] }, OPTIONS)).toBe('holds a piece of the NOCTURNE collection');
    expect(ruleWords({ kind: 'INTEREST', dropId: null }, OPTIONS)).toBe('said I’LL BE THERE to any LIVE RELEASE');
    expect(ruleWords({ kind: 'ANSWER', dropId: LIVE, answer: 2 }, OPTIONS)).toBe('answered ANOTHER FINISH after MONOLITHE — LIVE');
    expect(ruleWords({ kind: 'ACTIVE', days: 1 }, OPTIONS)).toBe('active in the last 1 day');
    expect(ruleWords({ kind: 'TIER', tiers: [0] }, OPTIONS)).toBe('tier NO TIER');
    expect([membersLine(0), membersLine(1), membersLine(1240)]).toEqual(['0 COLLECTORS', '1 COLLECTOR', `${formatCount(1240)} COLLECTORS`]);
    const used = { usedBy: { releases: [{ id: 'r', title: 'R', mode: 'LIVE' as const }], posts: [{ id: 'p', title: 'P' }, { id: 'q', title: 'Q' }] } };
    expect(usedByLine(used)).toBe('1 release · 2 posts of the circle');
    expect(usedByLine({ usedBy: { releases: [], posts: [] } })).toBeNull();
  });

  it('lets an OPERATOR build, change and delete a segment nothing uses; an AUDITOR reads', () => {
    const free = { usedBy: { releases: [], posts: [] } };
    const used = { usedBy: { releases: [{ id: 'r', title: 'R', mode: 'LIVE' as const }], posts: [] } };
    expect(segmentActions(free, 'AUDITOR')).toEqual({ edit: false, remove: false });
    expect(segmentActions(free, 'OPERATOR')).toEqual({ edit: true, remove: true });
    expect(segmentActions(used, 'ADMIN')).toEqual({ edit: true, remove: false });
    expect(segmentActions(null, 'OPERATOR')).toEqual({ edit: true, remove: false });
  });
});

describe('the builder: the customer intelligence criteria (plan CUSTOMER INTELLIGENCE §3.6 C.5.1, step 8.7)', () => {
  const tree = (...rules: SegmentGroup['rules']): SegmentGroup => ({ match: 'ALL', rules });

  it('starts each new criterion with the first choice of the options and the bounds the plan names', () => {
    expect(defaultRule('CITY', OPTIONS)).toEqual({ kind: 'CITY', cities: ['lyon'] });
    expect(defaultRule('AGE', OPTIONS)).toEqual({ kind: 'AGE', min: 25, max: 34 });
    expect(defaultRule('HEARD_FROM', OPTIONS)).toEqual({ kind: 'HEARD_FROM', optionIds: ['h1'] });
    expect(defaultRule('TAGGED', OPTIONS)).toEqual({ kind: 'TAGGED', tags: ['VIP'] });
    expect(defaultRule('WISHES_MODEL', OPTIONS)).toEqual({ kind: 'WISHES_MODEL', modelIds: ['m1'] });
    expect(defaultRule('WISHES_COLLECTION', OPTIONS)).toEqual({ kind: 'WISHES_COLLECTION', collectionIds: ['c1'] });
    expect(defaultRule('FAVOURITE_PIECE', OPTIONS)).toEqual({ kind: 'FAVOURITE_PIECE', pieces: ['RING'] });
    expect(defaultRule('FAVOURITE_FINISH', OPTIONS)).toEqual({ kind: 'FAVOURITE_FINISH', finishes: ['GOLD'] });
    expect(defaultRule('VIEWED_MODEL', OPTIONS)).toEqual({ kind: 'VIEWED_MODEL', modelIds: ['m1'], min: 1, days: 30 });
    // The latest release: the options list them the newest first.
    expect(defaultRule('VIEWED_RELEASE', OPTIONS)).toEqual({ kind: 'VIEWED_RELEASE', dropId: LIVE, min: 1 });
    expect(defaultRule('DEVICE', OPTIONS)).toEqual({ kind: 'DEVICE', kinds: ['PHONE'], days: 90 });
    expect(defaultRule('PLACE', OPTIONS)).toEqual({ kind: 'PLACE', countries: ['FR'], days: 90 });
    expect(defaultRule('FIRST_SOURCE', OPTIONS)).toEqual({ kind: 'FIRST_SOURCE', channelIds: ['ch1'] });
    // The newest link, before either act.
    expect(defaultRule('LAST_SOURCE', OPTIONS)).toEqual({ kind: 'LAST_SOURCE', linkIds: ['l2'], at: 'EITHER' });
    expect(defaultRule('SCORE', OPTIONS)).toEqual({ kind: 'SCORE', min: 60, max: 100 });
    // Plan MACRO M1 §3.1 (F4): nothing to choose, nothing to refuse.
    expect(defaultRule('FOUNDING_LIST', OPTIONS)).toEqual({ kind: 'FOUNDING_LIST' });
    // Nothing to choose from yet: an empty choice, which the problem names.
    const bare: SegmentOptions = { ...OPTIONS, cities: [], heardOptions: [], tags: [], tastes: { pieces: [], finishes: [] }, channels: [], links: [] };
    expect(defaultRule('CITY', bare)).toEqual({ kind: 'CITY', cities: [] });
    expect(ruleProblem(defaultRule('TAGGED', bare), bare)).toBe('Tagged: choose at least one tag.');
    expect(ruleProblem(defaultRule('FIRST_SOURCE', bare), bare)).toBe('Came first through: choose at least one channel, link or source.');
    // Every default with something to choose from may be sent as it is.
    for (const k of SEGMENT_RULE_KINDS) expect(ruleProblem(defaultRule(k, OPTIONS), OPTIONS), k).toBeNull();
  });

  it('says what the server would refuse in the new criteria before anything is sent', () => {
    expect(ruleProblem({ kind: 'AGE', min: 35, max: 25 }, OPTIONS)).toBe('Age between N and N: whole years from 0 to 120, the first not above the second.');
    expect(ruleProblem({ kind: 'AGE', min: 25, max: 121 }, OPTIONS)).toBe('Age between N and N: whole years from 0 to 120, the first not above the second.');
    expect(ruleProblem({ kind: 'SCORE', min: 80, max: 60 }, OPTIONS)).toBe('Engagement score: two whole numbers from 0 to 100, the first not above the second.');
    expect(ruleProblem({ kind: 'SCORE', min: Number.NaN, max: 60 }, OPTIONS)).toBe('Engagement score: two whole numbers from 0 to 100, the first not above the second.');
    expect(ruleProblem({ kind: 'DEVICE', days: 90 }, OPTIONS)).toBe('Device: tick at least one.');
    expect(ruleProblem({ kind: 'DEVICE', kinds: ['PHONE'], days: 396 }, OPTIONS)).toBe('Device in the last N days: from 1 to 395.');
    expect(ruleProblem({ kind: 'VIEWED_MODEL', modelIds: ['m1'], min: 1, days: 400 }, OPTIONS)).toBe('Viewed a model in the last N days: from 1 to 395.');
    expect(ruleProblem({ kind: 'VIEWED_MODEL', modelIds: ['m1'], min: 101, days: 30 }, OPTIONS)).toBe('Viewed a model at least N times: from 1 to 100.');
    expect(ruleProblem({ kind: 'VIEWED_MODEL', modelIds: [], min: 1, days: 30 }, OPTIONS)).toBe('Viewed a model: choose at least one model.');
    expect(ruleProblem({ kind: 'VIEWED_RELEASE', dropId: '', min: 1 }, OPTIONS)).toBe('Viewed a release: choose the release.');
    expect(ruleProblem({ kind: 'WISHES_COLLECTION', collectionIds: [] }, OPTIONS)).toBe('Wishes for a model of a collection: choose at least one collection.');
    expect(ruleProblem({ kind: 'FAVOURITE_PIECE', pieces: [] }, OPTIONS)).toBe('Favourite pieces: choose at least one piece.');
    expect(ruleProblem({ kind: 'FAVOURITE_FINISH', finishes: [] }, OPTIONS)).toBe('Favourite finishes: choose at least one finish.');
    expect(ruleProblem({ kind: 'HEARD_FROM', optionIds: [] }, OPTIONS)).toBe('How they heard of ORBES: choose at least one answer.');
    expect(ruleProblem({ kind: 'PLACE', days: 90 }, OPTIONS)).toBe('Seen from: choose at least one place.');
    expect(ruleProblem({ kind: 'PLACE', countries: ['FRA'], days: 90 }, OPTIONS)).toBe('A country is its two letters: FR, IT, US.');
    expect(ruleProblem({ kind: 'CITY', cities: Array.from({ length: 51 }, (_, i) => `c${i}`) }, OPTIONS)).toBe('City: at most 50.');
    expect(ruleProblem({ kind: 'CITY', cities: ['x'.repeat(81)] }, OPTIONS)).toBe('A city has at most 80 characters.');
    expect(ruleProblem({ kind: 'TAGGED', tags: ['#VIP'] }, OPTIONS)).toBe('A tag is 1 to 32 letters, digits or spaces (and & ’ - .).');
    expect(ruleProblem({ kind: 'LAST_SOURCE', at: 'SIGNUP' }, OPTIONS)).toBe('Came last through: choose at least one channel, link or source.');
    expect(ruleProblem({ kind: 'LAST_SOURCE', kinds: ['DIRECT'], at: 'SIGNUP' }, OPTIONS)).toBeNull();
    expect(segmentProblem(tree({ kind: 'SCORE', min: 60, max: 100 }, { match: 'ANY', rules: [{ kind: 'AGE', min: 40, max: 30 }] }), OPTIONS)).toBe('Age between N and N: whole years from 0 to 120, the first not above the second.');
  });

  it('says each new criterion in words, the plan\'s example among them', () => {
    const example = tree(
      { kind: 'AGE', min: 25, max: 34 },
      { kind: 'TAGGED', tags: ['VIP', 'PRESS'] },
      { kind: 'WISHES_MODEL', modelIds: ['m1'] },
      { kind: 'FIRST_SOURCE', channelIds: ['ch1'] },
      { kind: 'LAST_SOURCE', linkIds: ['l2'], at: 'SIGNUP' },
      { kind: 'SCORE', min: 60, max: 100 },
      { kind: 'DEVICE', kinds: ['PHONE'], systems: ['IOS'], apps: ['INSTAGRAM'], days: 90 },
      { kind: 'VIEWED_MODEL', modelIds: ['m2'], min: 3, days: 30 },
      { kind: 'FAVOURITE_PIECE', pieces: ['RING'] },
      { kind: 'HEARD_FROM', optionIds: ['h1'] },
      { kind: 'CITY', cities: ['lyon', 'milan'] },
    );
    expect(criteriaWords(example, OPTIONS)).toBe(
      'ALL OF age 25 to 34 · tagged VIP or PRESS · wishes for MONOLITHE · came first through Instagram · came last through Instagram bio (sign-up) · engagement score 60 to 100 · used an iPhone, inside Instagram, in the last 90 days · viewed ORBIT at least 3 times in the last 30 days · favourite pieces include RING · how they heard: A friend · city Lyon or Milan',
    );
    expect(ruleWords({ kind: 'WISHES_MODEL', modelIds: ['m3', 'm2'] }, OPTIONS)).toBe('wishes for MONOLITHE · Blue or ORBIT');
    expect(ruleWords({ kind: 'WISHES_MODEL', modelIds: ['m3'], not: true }, OPTIONS)).toBe('does not wish for MONOLITHE · Blue');
    expect(ruleWords({ kind: 'WISHES_COLLECTION', collectionIds: ['c1'] }, OPTIONS)).toBe('wishes for a model of NOCTURNE');
    expect(ruleWords({ kind: 'FAVOURITE_PIECE', pieces: ['RING', 'CUFF'] }, OPTIONS)).toBe('favourite pieces include RING or CUFF');
    expect(ruleWords({ kind: 'FAVOURITE_PIECE', pieces: ['RING'], not: true }, OPTIONS)).toBe('favourite pieces do not include RING');
    expect(ruleWords({ kind: 'FAVOURITE_FINISH', finishes: ['GOLD'] }, OPTIONS)).toBe('favourite finishes include Gold');
    // A key the options no longer list reads as kept.
    expect(ruleWords({ kind: 'FAVOURITE_FINISH', finishes: ['SILVER'] }, OPTIONS)).toBe('favourite finishes include SILVER');
    expect(ruleWords({ kind: 'SCORE', min: 60, max: 100, not: true }, OPTIONS)).toBe('not engagement score 60 to 100');
    expect(ruleWords({ kind: 'AGE', min: 30, max: 30 }, OPTIONS)).toBe('age 30');
    expect(ruleWords({ kind: 'VIEWED_RELEASE', dropId: DRAW, min: 1 }, OPTIONS)).toBe('viewed the release ORBIT — RELEASE I at least once');
    expect(ruleWords({ kind: 'VIEWED_MODEL', modelIds: ['m1'], min: 2, days: 1 }, OPTIONS)).toBe('viewed MONOLITHE at least twice in the last 1 day');
    expect(ruleWords({ kind: 'DEVICE', kinds: ['PHONE', 'TABLET'], systems: ['ANDROID'], openedIn: ['BROWSER'], days: 30 }, OPTIONS)).toBe('used a phone or a tablet on Android, in a browser, in the last 30 days');
    expect(ruleWords({ kind: 'DEVICE', openedIn: ['HOME_SCREEN'], days: 7 }, OPTIONS)).toBe('used a device, from the home screen, in the last 7 days');
    expect(ruleWords({ kind: 'PLACE', placeIds: [7], countries: ['IT'], days: 90 }, OPTIONS)).toBe('seen from Paris, France or Italy in the last 90 days');
    expect(ruleWords({ kind: 'FIRST_SOURCE', kinds: ['BEFORE', 'STAFF'] }, OPTIONS)).toBe('came first through Before tracking or Console device');
    expect(ruleWords({ kind: 'LAST_SOURCE', linkIds: ['l1'], kinds: ['SITE'], at: 'EITHER' }, OPTIONS)).toBe('came last through Press feature or Referring sites (sign-up or purchase)');
    expect(ruleWords({ kind: 'LAST_SOURCE', channelIds: ['ch2'], at: 'PURCHASE', not: true }, OPTIONS)).toBe('not came last through Press (purchase)');
    expect(ruleWords({ kind: 'HEARD_FROM', optionIds: ['h1', 'h2'] }, OPTIONS)).toBe('how they heard: A friend or The press');
    expect(ruleWords({ kind: 'FOUNDING_LIST' }, OPTIONS)).toBe('on the founding list');
    expect(ruleWords({ kind: 'FOUNDING_LIST', not: true }, OPTIONS)).toBe('not on the founding list');
  });

  it('names the choices of the controls, keeps a city folded and a tag in capitals, and knows when the score is read', () => {
    expect(modelLabel(OPTIONS.models[1]!)).toBe('MONOLITHE · RING · Blue');
    expect(heardLabel(OPTIONS.heardOptions[1]!)).toBe('The press (set aside)');
    expect(linkLabel(OPTIONS.links[1]!)).toBe('Press feature · Press (archived)');
    expect(tasteChoicesFor('FAVOURITE_FINISH', ['GOLD', 'SILVER'], OPTIONS).map((t) => [tasteLabel(t), t.swatch])).toEqual([
      ['Gold', '#C9A227'],
      ['Rose gold (no longer in the collection)', null],
      ['SILVER (no longer in the collection)', null],
    ]);
    expect(tasteChoicesFor('FAVOURITE_PIECE', [], OPTIONS).map(tasteLabel)).toEqual(['RING', 'CUFF', 'BROOCH (no longer in the collection)']);
    expect(commaItems(' Saint-Étienne, saint-etienne ;New  York,', cityValue)).toEqual(['saint-etienne', 'new york']);
    expect(cityLabel('saint-etienne', OPTIONS)).toBe('Saint-Étienne');
    expect(cityLabel('paris', OPTIONS)).toBe('paris');
    expect(commaItems('friend of the house, vip,VIP', (x) => x.replace(/\s+/g, ' ').trim().toUpperCase())).toEqual(['FRIEND OF THE HOUSE', 'VIP']);
    expect(readsScore(tree({ kind: 'AGE', min: 1, max: 2 }))).toBe(false);
    expect(readsScore(tree({ kind: 'AGE', min: 1, max: 2 }, { match: 'ANY', rules: [{ kind: 'SCORE', min: 60, max: 100, not: true }] }))).toBe(true);
    expect(SEGMENT_COPY.modelHint).toBe('A main model includes its variants. Tick a variant alone to target only it.');
    expect(SEGMENT_COPY.scoreNotice).toBe('Scores are calculated each morning. Accounts created since then have none yet.');
  });
});

describe('the circle’s audience by segment', () => {
  const post = { id: 'p', kind: 'NOTE', title: 'For the regulars', body: null, minTier: 2, eventAt: null, eventPlace: null, capacity: null, pollOptions: null, drop: null, model: null, externalUrl: null, segment: null } as unknown as CirclePost;
  it('says who reads a post, and sends its segment only when one is chosen or changed', () => {
    expect(audienceLine(post)).toBe('PLATINE and up');
    expect(audienceLine({ ...post, segment: { id: 's', name: 'Regulars' } })).toBe('PLATINE and up · segment Regulars');
    expect(circleInput('NOTE', { title: 'A', minTier: '1', segmentId: '' })).not.toHaveProperty('segmentId');
    expect(circleInput('NOTE', { title: 'A', minTier: '1', segmentId: 's' })).toMatchObject({ segmentId: 's' });
    expect(circleChange(post, { title: post.title, minTier: '2', segmentId: 's' })).toEqual({ segmentId: 's' });
    expect(circleChange({ ...post, segment: { id: 's', name: 'Regulars' } }, { title: post.title, minTier: '2', segmentId: '' })).toEqual({ segmentId: null });
  });
});

describe('AdminApi: the segments', () => {
  it('reads, counts, builds, changes, deletes them and saves their CSV on their paths; the count a background read', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Response[] = [];
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return answers.shift() ?? json({});
    };
    let unauthorized = 0;
    const api = new AdminApi({ fetch, onUnauthorized: () => unauthorized++ });
    api.setCsrf('tok');
    const ID = '5e5e5e5e-0000-4000-8000-000000000005';
    const tree: SegmentGroup = { match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] };
    answers.push(json({ items: [{ id: ID }] }));
    expect((await api.segments()).map((s: Pick<Segment, 'id'>) => s.id)).toEqual([ID]);
    answers.push(json({ items: [{ id: ID, name: 'Buyers' }] }));
    expect(await api.segmentNames()).toEqual([{ id: ID, name: 'Buyers' }]);
    await api.segment(ID);
    await api.segmentOptions();
    await api.segmentCount(tree);
    await api.createSegment({ name: 'Buyers', criteria: tree });
    await api.updateSegment(ID, { name: 'Collectors' });
    answers.push(new Response(null, { status: 204 }));
    await api.deleteSegment(ID);
    answers.push(new Response('"email"\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="orbes-segment-buyers.csv"' } }));
    expect((await api.segmentCsv(ID)).filename).toBe('orbes-segment-buyers.csv');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/segments',
      'GET /api/admin/segments/names',
      `GET /api/admin/segments/${ID}`,
      'GET /api/admin/segments/options',
      'POST /api/admin/segments/count',
      'POST /api/admin/segments',
      `PATCH /api/admin/segments/${ID}`,
      `DELETE /api/admin/segments/${ID}`,
      `GET /api/admin/segments/${ID}/members.csv`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : c.init.body));
    expect(bodies[4]).toEqual({ criteria: tree });
    expect(bodies[5]).toEqual({ name: 'Buyers', criteria: tree });
    expect(bodies[6]).toEqual({ name: 'Collectors' });
    // The live count is a background read: a 401 there leaves the session to the admin's next action.
    answers.push(json({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }, 401));
    await expect(api.segmentCount(tree)).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(0);
  });
});
