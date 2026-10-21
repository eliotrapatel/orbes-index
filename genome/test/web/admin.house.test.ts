/**
 * The House messages page of the console (plan MACRO M2 §1.6, scope D24 M1 and M2; src/web/admin/model/house-messages.ts
 * and ui/house-preview.ts): the console's types held to the server's answers at compile time, the page's address, who
 * may do what, the moments' switches and figures in words, the words being written checked as the server checks them,
 * a custom message's audience, reach, status and times (Paris), the send dialog's Paris date and time read as the server
 * reads it, the preview's item, and the preview's tokens pinned to the collector's sheets (value for value, as the
 * countdown card is to the story card). The page is driven in Chromium by admin.messages.e2e.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdminHouseMessage, AdminHouseMessageDetail } from '../../src/server/services/house-messages.js';
import { tierAudienceLabel as serverTierLabel } from '../../src/server/services/house-messages.js';
import type { HouseMomentFigures, HouseMomentPreview as ServerPreview, HouseMomentView as ServerMomentView } from '../../src/server/services/house-moments.js';
import { parisLocalInstant as serverParisLocal } from '../../src/server/services/schedule.js';
import { HOUSE_DEFAULT_WORDS, HOUSE_LINK_WORDS, HOUSE_PLACEHOLDERS } from '../../src/shared/house-words.js';
import {
  audienceDraftOf,
  audienceOf,
  authorLine,
  bodyProblem,
  customPreview,
  defaultScheduleValue,
  HOUSE_MOMENT_INFO,
  HOUSE_PLACEHOLDER_WORDS,
  houseActions,
  houseParams,
  isMomentDraftChanged,
  messageOffer,
  messagesLine,
  momentFigures,
  momentSwitch,
  momentWords,
  momentWordsChange,
  momentWordsState,
  parisInputValue,
  parisLocalInstant,
  reachedText,
  reachText,
  readText,
  sameAudience,
  scheduleProblem,
  sendLine,
  sentToast,
  shareText,
  statusWhen,
  switchOnBody,
  TIER_CHOICES,
  tierAudienceLabel,
  titleProblem,
  unknownLine,
  unknownPlaceholders,
} from '../../src/web/admin/model/house-messages.js';
import { CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import type { HouseMessage, HouseMessageDetail, HouseMomentPreview, HouseMomentView } from '../../src/web/admin/types.js';
import { formatCount } from '../../src/web/admin/format.js';

type Iso = string;
import { HOUSE_MOMENTS } from '../../src/web/admin/types.js';
import { HOUSE_PREVIEW, previewProperties } from '../../src/web/admin/ui/house-preview.js';
import { ACCOUNT_SIZES, LOOKBOOK, MESSAGES, PIECES, TIER } from '../../src/web/verify/copy.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../src/web');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');

// ── The console's types, held to the server's answers (JSON: dates as strings) ─────────────────────────────────────

type Json<T> = T extends Date ? Iso : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertType = <T extends true>(_: T) => _;
assertType<Same<Json<ServerMomentView & { figures: HouseMomentFigures }>, HouseMomentView>>(true);
assertType<Same<Json<ServerPreview>, HouseMomentPreview>>(true);
assertType<Same<Json<AdminHouseMessage>, HouseMessage>>(true);
assertType<Same<Json<AdminHouseMessageDetail>, HouseMessageDetail>>(true);

const ID = '0b6d7c4e-2f0a-4c5e-9a51-6f0a8b2d3e10';
const SEG = '7f1e2d3c-4b5a-4968-8776-655443322110';

function moment(over: Partial<HouseMomentView> = {}): HouseMomentView {
  return {
    moment: 'FIRST_REGISTRATION',
    enabled: false,
    enabledAt: null,
    title: null,
    body: null,
    defaults: { ...HOUSE_DEFAULT_WORDS.FIRST_REGISTRATION },
    placeholders: [...HOUSE_PLACEHOLDERS.FIRST_REGISTRATION],
    links: ['CARE', 'SIZES'],
    updatedAt: null,
    figures: { delivered30: 0, read30: 0, delivered: 0, read: 0 },
    ...over,
  };
}

function message(over: Partial<HouseMessage> = {}): HouseMessage {
  return {
    id: ID,
    title: 'THE WINTER PIECES',
    body: 'Dear {firstName},\n\nThe winter pieces are in THE COLLECTION.',
    status: 'DRAFT',
    audience: { segmentId: null, tier: 2, label: 'PLATINE and above' },
    sendAt: null,
    sentAt: null,
    reach: null,
    read: null,
    shareRead: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    createdBy: { id: 'a', email: 'op@orbes.test' },
    updatedAt: '2026-10-21T08:30:00.000Z',
    updatedBy: null,
    sentBy: null,
    cancelledAt: null,
    cancelledBy: null,
    ...over,
  };
}

describe('the House messages page: its address and who may do what', () => {
  it('reads the tab, a moment, a message and the status from the address; a message or a moment opens its own tab', () => {
    expect(houseParams({})).toEqual({ tab: 'moments', moment: null, message: null, status: null });
    expect(houseParams({ tab: 'messages', status: 'SENT' })).toEqual({ tab: 'messages', moment: null, message: null, status: 'SENT' });
    expect(houseParams({ moment: 'NINETY_DAYS' })).toEqual({ tab: 'moments', moment: 'NINETY_DAYS', message: null, status: null });
    expect(houseParams({ message: 'new' }).tab).toBe('messages');
    expect(houseParams({ message: ID.toUpperCase() }).message).toBe(ID);
    expect(houseParams({ message: 'x', moment: 'NOPE', status: 'SENDING', tab: 'other' })).toEqual({ tab: 'moments', moment: null, message: null, status: null });
  });

  it('lets an AUDITOR read, an OPERATOR write and an ADMIN switch and send, as the server', () => {
    expect([CAPABILITY_MIN_ROLE.editHouseMessages, CAPABILITY_MIN_ROLE.switchHouseMoments, CAPABILITY_MIN_ROLE.sendHouseMessages]).toEqual(['OPERATOR', 'ADMIN', 'ADMIN']);
    expect(houseActions('AUDITOR')).toEqual({ edit: false, switch: false, send: false });
    expect(houseActions('OPERATOR')).toEqual({ edit: true, switch: false, send: false });
    expect(houseActions('ADMIN')).toEqual({ edit: true, switch: true, send: true });
    expect(houseActions('RETAIL')).toEqual({ edit: false, switch: false, send: false });
    const admin = houseActions('ADMIN');
    expect(messageOffer(null, admin)).toEqual({ editable: true, send: null, cancel: false, remove: false });
    expect(messageOffer({ status: 'DRAFT' }, admin)).toEqual({ editable: true, send: 'SEND', cancel: false, remove: true });
    expect(messageOffer({ status: 'SCHEDULED' }, admin)).toEqual({ editable: true, send: 'RESCHEDULE', cancel: true, remove: false });
    expect(messageOffer({ status: 'SENT' }, admin)).toEqual({ editable: false, send: null, cancel: false, remove: false });
    expect(messageOffer({ status: 'CANCELLED' }, admin)).toEqual({ editable: false, send: null, cancel: false, remove: false });
    expect(messageOffer({ status: 'SCHEDULED' }, houseActions('OPERATOR'))).toEqual({ editable: true, send: null, cancel: false, remove: false });
    expect(messageOffer({ status: 'DRAFT' }, houseActions('AUDITOR'))).toEqual({ editable: false, send: null, cancel: false, remove: false });
  });
});

describe('MOMENTS in words', () => {
  it('names every moment and what triggers it, and every placeholder', () => {
    expect(Object.keys(HOUSE_MOMENT_INFO)).toEqual([...HOUSE_MOMENTS]);
    for (const m of HOUSE_MOMENTS) for (const p of HOUSE_PLACEHOLDERS[m]) expect(HOUSE_PLACEHOLDER_WORDS[p], p).toBeTruthy();
  });

  it('says a switch, the no-back-fill sentence, the words state and the figures', () => {
    expect(momentSwitch(moment())).toEqual({ text: 'OFF', tone: 'muted', note: 'Not sent.' });
    expect(momentSwitch(moment({ enabled: true, enabledAt: '2026-10-21T08:00:00.000Z' }))).toEqual({ text: 'ON', tone: 'solid', note: 'Since 21 OCT 2026 · 10:00 Paris' });
    expect(switchOnBody('NINETY_DAYS')).toBe(
      '90 days away: Ninety days without a visit: no sign-in, session or scan, ORBES writes this message in the collector’s MESSAGES. From now on: nothing is sent for what happened before.',
    );
    expect(momentWordsState(moment())).toBe('Default words');
    expect(momentWordsState(moment({ title: 'X' }))).toBe('Edited: title');
    expect(momentWordsState(moment({ body: 'Y' }))).toBe('Edited: words');
    expect(momentWordsState(moment({ title: 'X', body: 'Y' }))).toBe('Edited');
    expect(momentFigures({ delivered30: 0, read30: 0, delivered: 0, read: 0 })).toEqual({ days30: 'None yet', all: 'None yet' });
    expect(momentFigures({ delivered30: 3, read30: 2, delivered: 1204, read: 806 })).toEqual({ days30: '3 delivered · 2 read · 67 %', all: `${formatCount(1204)} delivered · 806 read · 67 %` });
    expect([shareText(0, 0), shareText(1, 3), shareText(3, 3)]).toEqual(['—', '33 %', '100 %']);
  });

  it('checks the words as the server does, and sends only what changed (the default’s words as null)', () => {
    expect(titleProblem('', true)).toBeNull();
    expect(titleProblem('')).toBe('Write a title.');
    expect(titleProblem('A'.repeat(81))).toBe('At most 80 characters.');
    expect(titleProblem('ONE\nTWO')).toBe('One line.');
    expect(bodyProblem('')).toBe('Write the message.');
    expect(bodyProblem('x'.repeat(2001))).toBe(`At most ${formatCount(2000)} characters.`);
    expect(bodyProblem('x'.repeat(2000))).toBeNull();
    expect(unknownPlaceholders({ title: '{piece}', body: '{amount} {firstName} {nope}' }, ['firstName', 'piece'])).toEqual(['{amount}', '{nope}']);
    expect(unknownLine(['{amount}'], ['firstName', 'piece'])).toBe('{amount} cannot be used here. The words may hold {firstName}, {piece}.');
    expect(unknownLine([], ['firstName'])).toBeNull();
    const m = moment();
    expect(momentWords(m)).toEqual(HOUSE_DEFAULT_WORDS.FIRST_REGISTRATION);
    expect(isMomentDraftChanged(m, momentWords(m))).toBe(false);
    expect(momentWordsChange(m, { title: 'WELCOME', body: m.defaults.body })).toEqual({ title: 'WELCOME' });
    expect(momentWordsChange(moment({ title: 'WELCOME' }), { title: m.defaults.title, body: m.defaults.body })).toEqual({ title: null });
    expect(momentWordsChange(moment({ body: 'Edited.' }), { title: m.defaults.title, body: '  ' })).toEqual({ body: null });
  });
});

describe('MESSAGES in words', () => {
  it('names a tier as the server does, and reads an audience from the select', () => {
    for (const t of [1, 2, 3] as const) expect(tierAudienceLabel(t)).toBe(serverTierLabel(t));
    expect(TIER_CHOICES.map((c) => c.label)).toEqual(['TITANE and above', 'PLATINE and above', 'PALLADIUM']);
    expect(audienceDraftOf(null)).toEqual({ kind: 'TIER', segmentId: '', tier: '2' });
    expect(audienceDraftOf(message({ audience: { segmentId: SEG, tier: null, label: 'Founding' } }))).toEqual({ kind: 'SEGMENT', segmentId: SEG, tier: '2' });
    expect(audienceOf({ kind: 'TIER', segmentId: '', tier: '3' })).toEqual({ tier: 3 });
    expect(audienceOf({ kind: 'SEGMENT', segmentId: SEG, tier: '' })).toEqual({ segmentId: SEG });
    expect(audienceOf({ kind: 'SEGMENT', segmentId: '', tier: '2' })).toBeNull();
    expect(audienceOf({ kind: 'TIER', segmentId: '', tier: '4' })).toBeNull();
    expect(sameAudience({ tier: 2 }, { tier: 2 })).toBe(true);
    expect(sameAudience({ tier: 2 }, { segmentId: SEG })).toBe(false);
  });

  it('says the reach, the status and its time in Paris, reached and read', () => {
    expect([reachText(0), reachText(1), reachText(1204)]).toEqual(['Reaches nobody now.', 'Reaches 1 collector now.', `Reaches ${formatCount(1204)} collectors now.`]);
    const now = new Date('2026-10-21T08:40:00.000Z');
    expect(statusWhen(message(), now)).toBe('Saved 21 OCT 2026 · 10:30 Paris');
    expect(statusWhen(message({ status: 'SCHEDULED', sendAt: '2026-10-21T16:00:00.000Z' }), now)).toBe('Goes 21 OCT 2026 · 18:00 Paris');
    expect(statusWhen(message({ status: 'SCHEDULED', sendAt: '2026-10-21T08:40:00.000Z' }), now)).toBe('Goes within 30 seconds');
    expect(statusWhen(message({ status: 'SENT', sentAt: '2026-10-21T16:00:12.000Z' }), now)).toBe('Sent 21 OCT 2026 · 18:00 Paris');
    expect(statusWhen(message({ status: 'CANCELLED', cancelledAt: '2026-10-21T09:00:00.000Z' }), now)).toBe('Cancelled 21 OCT 2026 · 11:00 Paris');
    expect([reachedText(message()), readText(message())]).toEqual(['—', '—']);
    const sent = message({ status: 'SENT', reach: 1204, read: 806, shareRead: 806 / 1204 });
    expect([reachedText(sent), readText(sent)]).toEqual([formatCount(1204), '806 · 67 %']);
    expect(readText(message({ status: 'SENT', reach: 0, read: 0, shareRead: null }))).toBe('0 · —');
    expect([messagesLine(1, false), messagesLine(3, true)]).toEqual(['1 message', '3 messages match the status']);
  });

  it('reads a date and time in Paris as the server reads it, the clocks’ changes included', () => {
    for (const v of ['2026-10-21T18:00', '2026-10-25T02:30', '2026-03-29T02:30', '2026-03-29T03:00', '2026-12-31T23:59', '2027-02-30T10:00', 'nope']) {
      expect(parisLocalInstant(v)?.toISOString() ?? null, v).toBe(serverParisLocal(v)?.toISOString() ?? null);
    }
    expect(parisLocalInstant('2026-10-21T18:00')?.toISOString()).toBe('2026-10-21T16:00:00.000Z');
    expect(parisInputValue('2026-10-21T16:00:00.000Z')).toBe('2026-10-21T18:00');
    expect(parisInputValue('2026-12-01T09:05:00.000Z')).toBe('2026-12-01T10:05');
    expect(parisInputValue(null)).toBe('');
    const now = new Date('2026-10-21T08:40:00.000Z');
    expect(defaultScheduleValue(now)).toBe('2026-10-21T12:00');
    expect(scheduleProblem('', now)).toBe('Choose a date and a time.');
    expect(scheduleProblem('2026-10-21T10:00', now)).toBe('Choose a time to come, in Paris.');
    expect(scheduleProblem('2026-10-21T10:40', now)).toBeNull();
    expect(scheduleProblem('2026-03-29T02:30', now)).toBe('This time does not exist in Paris: choose another.');
    expect(scheduleProblem('2027-12-01T10:00', now)).toBe('A message is scheduled at most a year ahead.');
    expect(sendLine('PLATINE and above', 1204, { now: true })).toBe(
      `To PLATINE and above. Reaches ${formatCount(1204)} collectors now. It reaches their MESSAGES within 30 seconds. The audience is counted again when it goes, and frozen there.`,
    );
    expect(sendLine('Founding', null, { now: false, value: '2026-10-21T18:00' })).toBe('To Founding. It goes 21 OCT 2026 · 18:00 Paris. The audience is counted again when it goes, and frozen there.');
    expect(sentToast({ sendAt: '2026-10-21T08:40:00.000Z' }, now)).toBe('Sent: it reaches MESSAGES within 30 seconds.');
    expect(sentToast({ sendAt: '2026-10-21T16:00:00.000Z' }, now)).toBe('Scheduled: it goes 21 OCT 2026 · 18:00 Paris.');
  });

  it('draws a custom message as its collector reads it: {firstName} filled, the author line in Paris, no link', () => {
    expect(authorLine('ORBES', new Date('2026-10-21T08:02:00.000Z'))).toBe('ORBES · 21 OCT 2026 · 10:02');
    expect(customPreview({ title: ' FOR {firstName} ', body: 'Dear {firstName},\r\n\r\nWords.' }, new Date('2026-01-05T09:00:00.000Z'), 'ORBES')).toEqual({
      author: 'ORBES · 5 JAN 2026 · 10:00',
      title: 'FOR Camille',
      body: 'Dear Camille,\n\nWords.',
      links: [],
    });
  });
});

describe('the preview, value for value the collector’s', () => {
  /** A custom property's first value in a sheet. */
  const token = (css: string, name: string): string => {
    const m = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`).exec(css);
    if (!m) throw new Error(`no ${name}`);
    return m[1]!.trim();
  };
  /** The declarations of the first rule whose selector ends with `selector`. */
  const rule = (css: string, selector: string): Record<string, string> => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule ${selector}`);
    return Object.fromEntries(
      m[1]!
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.includes(':'))
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    );
  };
  const brand = read('shared/brand.css');
  const light = read('shared/light.css');
  const desktop = read('shared/desktop.css');
  const nocturne = read('shared/nocturne.css');
  const styles = read('verify/styles.css');
  const messages = read('shared/desktop-messages.css');
  const d = (name: string) => token(desktop, name);

  it('takes the vault’s colours in DARK and the light mode’s in LIGHT', () => {
    const dark = HOUSE_PREVIEW.modes.dark;
    expect([dark.ground, dark.ink, dark.soft, dark.hairline]).toEqual(['--vault-ground', '--vault-ink', '--vault-soft', '--vault-hairline'].map((n) => token(brand, n)));
    const l = HOUSE_PREVIEW.modes.light;
    expect([l.ground, l.ink, l.soft, l.hairline]).toEqual(['--vault-ground', '--vault-ink', '--vault-soft', '--vault-hairline'].map((n) => token(light, n)));
  });

  it('takes the phone’s MESSAGES: its margin, an item’s room, the author, title, words and link', () => {
    const p = HOUSE_PREVIEW.widths.phone;
    expect(p.width).toBe('390px');
    expect(p.margin).toBe(token(brand, '--n-margin'));
    expect(rule(styles, '.n-messages__item').padding).toBe(`${p.item} 0`);
    expect(rule(nocturne, '.n-lb')).toMatchObject({ color: `var(--vault-${p.authorInk})`, 'font-size': 'var(--n-fs-lb)', 'letter-spacing': 'var(--n-track-lb)' });
    expect([p.authorSize, p.authorTrack]).toEqual([token(brand, '--n-fs-lb'), token(brand, '--n-track-lb')]);
    expect([p.titleSize, p.titleTrack]).toEqual([token(brand, '--n-fs-t3'), token(brand, '--n-track-t3')]);
    expect([p.textSize, p.textLeading]).toEqual([token(brand, '--n-fs-tx'), token(brand, '--n-lh-tx')]);
    expect(rule(styles, '.n-messages__body')).toMatchObject({ 'margin-top': p.textGap, color: 'var(--vault-ink)' });
    expect([p.linkSize, p.linkTrack]).toEqual([token(brand, '--n-fs-tl'), token(brand, '--n-track-tl')]);
  });

  it('takes the computer’s messages page: an item’s room, the author in ink, the words at their measure, the scale', () => {
    const c = HOUSE_PREVIEW.widths.computer;
    expect(rule(messages, '.d-msg__message')).toMatchObject({ padding: 'var(--d-s5) 0' });
    expect(c.item).toBe(d('--d-s5'));
    expect(rule(messages, '.d-msg__message--house .d-msg__author')).toMatchObject({ color: `var(--vault-${c.authorInk})` });
    expect(token(desktop, '--n-fs-lb')).toBe('var(--d-fs-label)');
    expect(token(desktop, '--n-track-lb')).toBe('var(--d-tr-label)');
    expect([c.authorSize, c.authorTrack]).toEqual([d('--d-fs-label'), d('--d-tr-label')]);
    expect([c.titleSize, c.titleTrack]).toEqual([token(desktop, '--n-fs-t3'), d('--d-tr-label')]);
    const body = rule(messages, '.d-msg__body');
    expect(body).toMatchObject({ 'max-width': c.measure, margin: 'var(--d-s3) 0 0', 'font-size': 'var(--d-fs-text)', 'line-height': c.textLeading });
    expect([c.textSize, c.textGap]).toEqual([d('--d-fs-text'), d('--d-s3')]);
    expect(token(desktop, '--n-fs-tl')).toBe('var(--d-fs-menu)');
    expect([c.linkSize, c.linkTrack]).toEqual([d('--d-fs-menu'), d('--d-tr-label')]);
  });

  it('carries every value as a custom property, and the console draws them through the CSSOM only', () => {
    const props = previewProperties('light', 'computer');
    expect(props['--hp-ground']).toBe('#ffffff');
    expect(props['--hp-author']).toBe(HOUSE_PREVIEW.modes.light.ink);
    expect(previewProperties('dark', 'phone')['--hp-author']).toBe(HOUSE_PREVIEW.modes.dark.soft);
    const admin = read('admin/styles.css');
    for (const name of Object.keys(props)) expect(admin, name).toContain(`var(${name})`);
    for (const f of ['admin/ui/house-preview.ts', 'admin/views/house-messages.ts']) expect(read(f), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|setAttribute\('style'/);
  });

  it('writes each link as the app names its place', () => {
    expect(HOUSE_LINK_WORDS).toEqual({
      CARE: 'CARING FOR YOUR PIECE',
      SIZES: ACCOUNT_SIZES.title,
      IN_USE: TIER.inUse,
      MY_PIECES: PIECES.title,
      PIECE: PIECES.seePiece,
      COLLECTION: LOOKBOOK.title,
    });
    expect(MESSAGES.title).toBe('MESSAGES');
  });
});
