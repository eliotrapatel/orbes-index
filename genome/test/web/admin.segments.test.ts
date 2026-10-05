/**
 * The console's Segments page, pure (web/admin/model/segments.ts) and its API client (web/admin/api.ts), with the
 * circle's segment audience (web/admin/model/circle.ts): the bounds and criteria mirror the server's; a criterion as the
 * builder starts it; what the server would refuse, said before anything is sent; a segment in words; what each role may
 * do; the client's paths and bodies.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT_CRITERIA as SERVER_CRITERIA, SEGMENT_LIMITS as SERVER_LIMITS, SEGMENT_MATCHES as SERVER_MATCHES, SEGMENT_RULE_KINDS as SERVER_KINDS } from '../../src/server/services/segments.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import { audienceLine, circleChange, circleInput } from '../../src/web/admin/model/circle.js';
import {
  criteriaWords,
  criterionChoices,
  defaultRule,
  listItems,
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
import { SEGMENT_CRITERIA, SEGMENT_MATCHES, SEGMENT_RULE_KINDS, type CirclePost, type Segment, type SegmentGroup, type SegmentOptions } from '../../src/web/admin/types.js';

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
    { id: 'm2', name: 'ORBIT', type: 'PENDANT' },
  ],
  collections: [{ id: 'c1', name: 'NOCTURNE' }],
  sizes: ['50', '52'],
  countries: ['FR', 'IT'],
};

describe('the Segments page mirrors the server', () => {
  it('holds the same bounds, criteria by group and ways to match', () => {
    expect(SEGMENT_LIMITS).toEqual({ ...SERVER_LIMITS, count: { ...SERVER_LIMITS.count }, days: { ...SERVER_LIMITS.days } });
    expect(JSON.parse(JSON.stringify(SEGMENT_CRITERIA))).toEqual(JSON.parse(JSON.stringify(SERVER_CRITERIA)));
    expect([...SEGMENT_RULE_KINDS]).toEqual([...SERVER_KINDS]);
    expect([...SEGMENT_MATCHES]).toEqual([...SERVER_MATCHES]);
    // Every criterion has its words, in its group of the four of choice 27.
    expect(criterionChoices().map((g) => [g.label, g.kinds.map((k) => k.value)])).toEqual([
      ['Releases taken part in and pieces secured', ['PARTICIPATIONS', 'TOOK_PART', 'SECURED', 'SECURED_IN']],
      ['Tier, models and collections owned', ['TIER', 'OWNS_MODEL', 'OWNS_COLLECTION']],
      ['Sizes and country', ['SIZE', 'COUNTRY']],
      ['Interest, answers and last activity', ['INTEREST', 'ANSWER', 'ACTIVE']],
    ]);
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
    const used = { usedBy: { releases: [{ id: 'r', title: 'R' }], posts: [{ id: 'p', title: 'P' }, { id: 'q', title: 'Q' }] } };
    expect(usedByLine(used)).toBe('1 release · 2 posts of the circle');
    expect(usedByLine({ usedBy: { releases: [], posts: [] } })).toBeNull();
  });

  it('lets an OPERATOR build, change and delete a segment nothing uses; an AUDITOR reads', () => {
    const free = { usedBy: { releases: [], posts: [] } };
    const used = { usedBy: { releases: [{ id: 'r', title: 'R' }], posts: [] } };
    expect(segmentActions(free, 'AUDITOR')).toEqual({ edit: false, remove: false });
    expect(segmentActions(free, 'OPERATOR')).toEqual({ edit: true, remove: true });
    expect(segmentActions(used, 'ADMIN')).toEqual({ edit: true, remove: false });
    expect(segmentActions(null, 'OPERATOR')).toEqual({ edit: true, remove: false });
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
      `GET /api/admin/segments/${ID}`,
      'GET /api/admin/segments/options',
      'POST /api/admin/segments/count',
      'POST /api/admin/segments',
      `PATCH /api/admin/segments/${ID}`,
      `DELETE /api/admin/segments/${ID}`,
      `GET /api/admin/segments/${ID}/members.csv`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : c.init.body));
    expect(bodies[3]).toEqual({ criteria: tree });
    expect(bodies[4]).toEqual({ name: 'Buyers', criteria: tree });
    expect(bodies[5]).toEqual({ name: 'Collectors' });
    // The live count is a background read: a 401 there leaves the session to the admin's next action.
    answers.push(json({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }, 401));
    await expect(api.segmentCount(tree)).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(0);
  });
});
