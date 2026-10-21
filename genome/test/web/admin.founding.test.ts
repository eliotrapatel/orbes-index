/**
 * The Founding list of the console (plan MACRO M1 §3.2 and §3.5, scope F3 and F4; src/web/admin/model/founding.ts):
 * the filters from the address, the KPIs, the bars by country and by source, a person's row in words (Paris), the
 * phrase Remove asks for (the server's), the segment Make the segment makes and finds again, who may do what; and,
 * with it, a draw's Access (everyone or a segment, until the publication) and the link dialog's LANDING destination.
 * The page itself is driven in Chromium by admin.segments.e2e.
 */
import { describe, expect, it } from 'vitest';
import { removePhrase as serverRemovePhrase, type FoundingEntry as ServerFoundingEntry, type FoundingSummary as ServerFoundingSummary } from '../../src/server/services/founding.js';
import { formatCount } from '../../src/web/admin/format.js';
import { dropChange, dropFormValues, dropInput, drawAccessText } from '../../src/web/admin/model/club.js';
import {
  channelBars,
  countryBars,
  countryChoices,
  filtered,
  foundingActions,
  foundingFilters,
  foundingKpis,
  foundingParams,
  foundingSegmentName,
  foundingSegmentOf,
  FOUNDING_COPY,
  FOUNDING_SEGMENT_CRITERIA,
  isFoundingSegment,
  kindBars,
  peopleLine,
  removePhrase,
  sourceChoices,
  sourceRows,
  sourceText,
  statusText,
  unsubscribedDay,
} from '../../src/web/admin/model/founding.js';
import { DESTINATION_ORDER, destinationText, linkInput } from '../../src/web/admin/model/links.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: the console's rows and figures are what the server sends.
export const foundingEntryFits = (e: Json<ServerFoundingEntry>): web.FoundingEntry => e;
export const foundingSummaryFits = (s: Json<ServerFoundingSummary>): web.FoundingSummary => s;

const SUMMARY: web.FoundingSummary = {
  total: 8,
  matched: 3,
  unsubscribed: 1,
  countries: [
    { country: 'FR', name: 'France', count: 4 },
    { country: 'GB', name: 'United Kingdom', count: 2 },
    { country: 'BE', name: 'Belgium', count: 1 },
    { country: 'CH', name: 'Switzerland', count: 1 },
  ],
  kinds: [
    { kind: 'LINK', count: 5 },
    { kind: 'DIRECT', count: 2 },
    { kind: 'SITE', count: 1 },
  ],
  channels: [
    { name: 'Instagram', count: 4 },
    { name: null, count: 3 },
    { name: 'TikTok', count: 1 },
  ],
  sources: [
    { kind: 'LINK', label: 'Bio', channel: 'Instagram', linkId: 'l1', count: 4 },
    { kind: 'DIRECT', label: 'Direct', channel: null, linkId: null, count: 2 },
    { kind: 'SITE', label: 'vogue.fr', channel: null, linkId: null, count: 1 },
    { kind: 'LINK', label: 'Teaser', channel: 'TikTok', linkId: 'l2', count: 1 },
  ],
};

const ENTRY: web.FoundingEntry = {
  id: '1a2b3c4d-0000-4000-8000-000000000001',
  email: 'ada@example.com',
  firstName: 'Ada',
  country: 'FR',
  source: { kind: 'LINK', label: 'Bio', channel: 'Instagram', linkId: 'l1' },
  joinedAt: '2026-10-21T18:00:00.000Z',
  consentAt: '2026-10-21T18:00:00.000Z',
  consentVersion: '2026-10-15',
  accountId: null,
  matchedAt: null,
  unsubscribedAt: null,
};

const segment = (id: string, name: string, criteria: web.SegmentGroup, createdAt = '2026-10-21T08:00:00.000Z'): web.Segment => ({
  id,
  name,
  criteria,
  count: 3,
  usedBy: { releases: [], posts: [] },
  createdAt,
  createdBy: null,
  updatedAt: createdAt,
});

describe('the Founding list (plan MACRO M1 §3.2)', () => {
  it('reads its filters from the address, and nothing unreadable', () => {
    expect(foundingParams({})).toEqual({ matched: null, unsubscribed: null, country: null, source: null });
    const p = foundingParams({ matched: 'yes', unsub: 'no', country: 'fr', source: 'LINK' });
    expect(p).toEqual({ matched: 'yes', unsubscribed: 'no', country: 'FR', source: 'LINK' });
    expect(foundingFilters(p)).toEqual({ matched: true, unsubscribed: false, country: 'FR', sourceKind: 'LINK' });
    expect(filtered(p)).toBe(true);
    expect(foundingParams({ matched: 'maybe', unsub: '1', country: 'France', source: 'link' })).toEqual({ matched: null, unsubscribed: null, country: null, source: null });
    expect(foundingFilters(foundingParams({}))).toEqual({});
    expect(filtered(foundingParams({}))).toBe(false);
  });

  it('offers the countries on the list by name, the one chosen even when nobody is left in it; the sources in the Links page’s words', () => {
    expect(countryChoices(SUMMARY, null).map((c) => c.label)).toEqual(['Every country', 'BE · Belgium', 'FR · France', 'CH · Switzerland', 'GB · United Kingdom']);
    expect(countryChoices(SUMMARY, 'IT').map((c) => c.value)).toContain('IT');
    expect(sourceChoices().map((c) => c.label)).toEqual(['Every source', 'Links', 'Campaign tags', 'Referring sites', 'Direct']);
  });

  it('says its KPIs: on the list, matched to an account, unsubscribed, countries', () => {
    expect(foundingKpis(SUMMARY).map((k) => [k.label, k.value, k.note])).toEqual([
      ['On the list', '8', 'FROM THEORBES.COM'],
      ['Matched to an account', '3', '38% OF THE LIST'],
      ['Unsubscribed', '1', 'NO EMAILS'],
      ['Countries', '4', 'MOST: FRANCE'],
    ]);
    const none = foundingKpis({ total: 0, matched: 0, unsubscribed: 0, countries: [], kinds: [], channels: [], sources: [] });
    expect(none.map((k) => k.note)).toEqual(['FROM THEORBES.COM', '0% OF THE LIST', 'NONE', 'NONE YET']);
  });

  it('draws the bars by country (the rest together), by kind of source and by channel, each scaled to the largest, its share of the list', () => {
    const countries = countryBars(SUMMARY, 2);
    expect(countries.map((b) => [b.label, b.value, b.share, b.fraction])).toEqual([
      ['FR · France', 4, '50%', 1],
      ['GB · United Kingdom', 2, '25%', 0.5],
      ['2 other countries', 2, '25%', 0.5],
    ]);
    expect(countryBars(SUMMARY).map((b) => b.key)).toEqual(['FR', 'GB', 'BE', 'CH']);
    expect(kindBars(SUMMARY).map((b) => [b.label, b.value])).toEqual([
      ['Links', 5],
      ['Direct', 2],
      ['Referring sites', 1],
    ]);
    expect(channelBars(SUMMARY).map((b) => [b.label, b.value])).toEqual([
      ['Instagram', 4],
      ['Without a link', 3],
      ['TikTok', 1],
    ]);
  });

  it('lists the sources one by one: a link opens its page, the others nothing', () => {
    expect(sourceRows(SUMMARY)).toEqual([
      { label: 'Bio', kind: 'Links', channel: 'Instagram', linkId: 'l1', count: '4', share: '50%' },
      { label: 'Direct', kind: 'Direct', channel: '—', linkId: null, count: '2', share: '25%' },
      { label: 'vogue.fr', kind: 'Referring sites', channel: '—', linkId: null, count: '1', share: '13%' },
      { label: 'Teaser', kind: 'Links', channel: 'TikTok', linkId: 'l2', count: '1', share: '13%' },
    ]);
  });

  it('says a person in words: the source with its channel, unsubscribed on its Paris day, the count of the list', () => {
    expect(sourceText(ENTRY)).toBe('Bio (Instagram)');
    expect(sourceText({ source: { kind: 'SITE', label: 'vogue.fr', channel: null, linkId: null } })).toBe('vogue.fr');
    expect(statusText(ENTRY)).toBe('On the list');
    // 23:30 UTC on 21 October is already 22 October in Paris.
    expect(statusText({ unsubscribedAt: '2026-10-21T23:30:00.000Z' })).toBe('Unsubscribed');
    expect(unsubscribedDay({ unsubscribedAt: '2026-10-21T23:30:00.000Z' })).toBe('22 OCT 2026');
    expect(unsubscribedDay(ENTRY)).toBeNull();
    expect([peopleLine(1, false), peopleLine(1240, false), peopleLine(2, true)]).toEqual(['1 person', `${formatCount(1240)} people`, '2 people match the filters']);
    expect(FOUNDING_COPY.empty).toBe('Nobody yet. The theorbes.com form adds people here.');
  });

  it('asks Remove for the server’s own phrase', () => {
    expect(removePhrase(ENTRY.id)).toBe('REMOVE 1A2B3C4D');
    expect(removePhrase(ENTRY.id)).toBe(serverRemovePhrase(ENTRY.id));
  });

  it('lets an AUDITOR read, an OPERATOR download and make the segment, an ADMIN remove', () => {
    expect([CAPABILITY_MIN_ROLE.readFounding, CAPABILITY_MIN_ROLE.exportFounding, CAPABILITY_MIN_ROLE.removeFounding]).toEqual(['AUDITOR', 'OPERATOR', 'ADMIN']);
    expect(foundingActions('AUDITOR')).toEqual({ csv: false, remove: false, makeSegment: false });
    expect(foundingActions('OPERATOR')).toEqual({ csv: true, remove: false, makeSegment: true });
    expect(foundingActions('ADMIN')).toEqual({ csv: true, remove: true, makeSegment: true });
    for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(can(role, 'readFounding'), role).toBe(false);
  });

  it('makes one segment, « Founding list », with the FOUNDING_LIST rule, and finds it again (never a negated or a mixed one)', () => {
    expect(FOUNDING_SEGMENT_CRITERIA).toEqual({ match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }] });
    expect(isFoundingSegment(FOUNDING_SEGMENT_CRITERIA)).toBe(true);
    expect(isFoundingSegment({ match: 'ANY', rules: [{ kind: 'FOUNDING_LIST' }] })).toBe(true);
    expect(isFoundingSegment({ match: 'ALL', rules: [{ kind: 'FOUNDING_LIST', not: true }] })).toBe(false);
    expect(isFoundingSegment({ match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }, { kind: 'TIER', tiers: [2] }] })).toBe(false);
    expect(isFoundingSegment({ match: 'ALL', rules: [{ match: 'ANY', rules: [{ kind: 'FOUNDING_LIST' }] }] })).toBe(false);
    const other = segment('s1', 'Founding list', { match: 'ALL', rules: [{ kind: 'TIER', tiers: [2] }] });
    const later = segment('s3', 'Early list', FOUNDING_SEGMENT_CRITERIA, '2026-10-22T08:00:00.000Z');
    const first = segment('s2', 'Founding list 2', FOUNDING_SEGMENT_CRITERIA);
    expect(foundingSegmentOf([other])).toBeNull();
    expect(foundingSegmentOf([later, other, first])?.id).toBe('s2');
    expect(foundingSegmentName([])).toBe('Founding list');
    expect(foundingSegmentName(['Size 58'])).toBe('Founding list');
    expect(foundingSegmentName(['founding list', 'Founding list 2'])).toBe('Founding list 3');
  });
});

describe('a draw’s Access (plan MACRO M1 §3.2, F4)', () => {
  const draft = { accessSegment: null } as unknown as web.Drop;
  const base = {
    modelId: 'm1',
    title: 'MONOLITHE — release I',
    description: '',
    'size:52': '3',
    opensAt: '2026-11-05T19:00',
    closesAt: '2026-11-07T19:00',
    purchaseWindowHours: '48',
    earlyAccessHours: '4',
    earlyAccessPlatineHours: '2',
    price: '',
    currency: 'EUR',
  };

  it('starts at Everyone, sends a segment only when one is chosen, and says it', () => {
    expect(dropFormValues(null, new Date('2026-10-21T08:00:00.000Z')).accessSegmentId).toBe('');
    expect(dropInput({ ...base, accessSegmentId: '' })).not.toHaveProperty('accessSegmentId');
    expect(dropInput({ ...base, accessSegmentId: 'seg-1' }).accessSegmentId).toBe('seg-1');
    expect(drawAccessText(draft)).toBe('Everyone');
    expect(drawAccessText({ accessSegment: { id: 'seg-1', name: 'Founding list' } })).toBe('Segment Founding list');
  });

  it('changes a draft’s segment, and back to everyone (null); nothing when it is the same or the dialog has no Access', () => {
    const d = {
      model: { id: 'm1' },
      title: 'MONOLITHE — release I',
      description: null,
      sizes: [{ label: '52', pieces: 3 }],
      opensAt: '2026-11-05T19:00:00.000Z',
      closesAt: '2026-11-07T19:00:00.000Z',
      purchaseWindowHours: 48,
      earlyAccessHours: 4,
      earlyAccessPlatineHours: 2,
      priceMinor: null,
      currency: null,
      accessSegment: null,
    } as unknown as web.Drop;
    expect(dropFormValues({ ...d, accessSegment: { id: 'seg-1', name: 'Founding list' } }, new Date()).accessSegmentId).toBe('seg-1');
    expect(dropChange(d, { ...base, accessSegmentId: 'seg-1' })).toEqual({ accessSegmentId: 'seg-1' });
    expect(dropChange(d, { ...base, accessSegmentId: '' })).toEqual({});
    expect(dropChange(d, base)).toEqual({});
    const opened = { ...d, accessSegment: { id: 'seg-1', name: 'Founding list' } } as web.Drop;
    expect(dropChange(opened, { ...base, accessSegmentId: 'seg-1' })).toEqual({});
    expect(dropChange(opened, { ...base, accessSegmentId: '' })).toEqual({ accessSegmentId: null });
  });
});

describe('the link dialog’s LANDING destination (plan MACRO M1 §3.2, F3)', () => {
  it('offers theorbes.com (founding list), last, naming neither a release nor a model', () => {
    expect(DESTINATION_ORDER.at(-1)).toBe('LANDING');
    const form = { name: 'Bio', channelId: 'c1', destination: 'LANDING', dropId: 'd1', modelId: 'm1', code: 'bio-landing', cost: '', currency: 'EUR', note: '' };
    expect(linkInput(form, true)).toEqual({ name: 'Bio', channelId: 'c1', destination: 'LANDING', dropId: null, modelId: null, code: 'bio-landing', cost: null, note: null });
    expect(destinationText({ destination: 'LANDING', dropId: null, modelId: null }, null)).toBe('theorbes.com (founding list)');
  });
});
