/**
 * The emails in the console (plan MACRO M1 §4.3, scope E0, E1 and F6; src/web/admin/model/emails.ts and
 * model/email-frame.ts): the console's types held to the server's answers at compile time, the page's address, the
 * channel and the switches in words, the words being written checked as the server checks them, the outbox in words
 * (Paris), who may do what, the founding announcement's panel (what may be sent, the phrase, the server's own), and how
 * an email's HTML is read and drawn without markup (its tree, its `<style>` rules for a scheme and a width, its links
 * and images). The page and the panel are driven in Chromium by admin.segments.e2e.
 */
import { describe, expect, it } from 'vitest';
import { EMAIL_DEFAULTS, EMAIL_PLACEHOLDERS } from '../../src/server/email/copy.js';
import { renderEmail } from '../../src/server/email/render.js';
import { announcementPhrase as serverPhrase, type AnnouncementState as ServerAnnouncementState } from '../../src/server/services/email-triggers.js';
import type { EmailKindWords, OutboxCounts, OutboxEntry } from '../../src/server/services/email.js';
import { EMAIL_KINDS as SERVER_KINDS } from '../../src/server/db/schema.js';
import {
  decodeEntities,
  emailCssRules,
  findElement,
  frameHref,
  frameImageSrc,
  isFrameClass,
  mediaApplies,
  mediaKey,
  parseEmailHtml,
  simpleSelector,
  styleTexts,
  type EmailElement,
} from '../../src/web/admin/model/email-frame.js';
import {
  announcementEmailsText,
  announcementOffer,
  announcementPhrase,
  bodyProblem,
  channelRows,
  chosenRelease,
  EMAIL_KIND_INFO,
  emailsActions,
  emailsParams,
  isDraftChanged,
  kindChoices,
  outboxFilters,
  outboxKpis,
  outboxLine,
  outboxWhen,
  reachText,
  recipientKind,
  sendBody,
  sentText,
  statusTone,
  subjectProblem,
  switchOnBody,
  switchState,
  unknownLine,
  unknownPlaceholders,
  wordsChange,
  wordsState,
} from '../../src/web/admin/model/emails.js';
import { formatCount } from '../../src/web/admin/format.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

// The console's types read what the server sends (compile time).
export const outboxFits = (e: Json<OutboxEntry>): web.OutboxEmail => e;
export const countsFit = (c: Json<OutboxCounts>): web.EmailOutboxCounts => c;
export const kindFits = (k: Json<EmailKindWords>): Omit<web.EmailKindView, 'placeholders' | 'defaults'> => k;
export const announcementFits = (a: Json<ServerAnnouncementState>): web.AnnouncementState => a;

const NOW = new Date('2026-11-02T09:00:00.000Z');
const kind = (over: Partial<web.EmailKindView> = {}): web.EmailKindView => ({
  kind: 'ORDER_SHIPPED',
  enabled: false,
  words: { ...EMAIL_DEFAULTS.ORDER_SHIPPED },
  edited: { subject: false, body: false },
  placeholders: EMAIL_PLACEHOLDERS.ORDER_SHIPPED.map((name) => ({ name, words: name })),
  defaults: { ...EMAIL_DEFAULTS.ORDER_SHIPPED },
  ...over,
});
const release = (over: Partial<web.AnnouncementRelease> = {}): web.AnnouncementRelease => ({
  id: '5a1b2c3d-0000-4000-8000-000000000001',
  mode: 'DRAW',
  title: 'The first draw',
  words: 'The first draw',
  opensAt: '2026-11-05T18:00:00.000Z',
  closesAt: '2026-11-06T18:00:00.000Z',
  announced: true,
  emails: { queued: 0, sent: 0, failed: 0, cancelled: 0 },
  scheduledAt: null,
  ...over,
});

describe('the Emails page (plan MACRO M1 §4.3)', () => {
  it('names the eleven kinds the server knows, each with its moment and who receives it', () => {
    expect(Object.keys(EMAIL_KIND_INFO).sort()).toEqual([...SERVER_KINDS].sort());
    expect(kindChoices().map((c) => c.value)).toEqual(['', ...SERVER_KINDS]);
    for (const k of SERVER_KINDS) expect(EMAIL_KIND_INFO[k].name.length).toBeGreaterThan(3);
  });

  it('reads its address: the kind open, the outbox filtered; anything unreadable is nothing', () => {
    expect(emailsParams({ kind: 'ORDER_SHIPPED', status: 'FAILED', okind: 'PASSWORD_RESET' })).toEqual({ kind: 'ORDER_SHIPPED', status: 'FAILED', outboxKind: 'PASSWORD_RESET' });
    expect(emailsParams({ kind: 'NOPE', status: 'sent', okind: '' })).toEqual({ kind: null, status: null, outboxKind: null });
    expect(outboxFilters(emailsParams({ status: 'QUEUED' }))).toEqual({ status: 'QUEUED' });
    expect(outboxFilters(emailsParams({}))).toEqual({});
  });

  it('says the channel and each switch: off sends nothing; on while the channel is off will send once it is on', () => {
    expect(channelRows({ on: false })).toEqual([{ label: 'Channel', value: 'OFF', note: 'No email provider in the server’s .env: nothing is sent.' }]);
    expect(channelRows({ on: true, host: 'smtp.example', from: 'hello@theorbes.com' }).map((r) => r.value)).toEqual(['ON', 'smtp.example', 'hello@theorbes.com']);
    expect(switchState({ enabled: false }, true)).toMatchObject({ text: 'OFF', tone: 'muted' });
    expect(switchState({ enabled: true }, true)).toMatchObject({ text: 'ON', tone: 'solid' });
    expect(switchState({ enabled: true }, false)).toEqual({ text: 'ON', tone: 'outline', note: 'Will send once the channel is on.' });
    expect(switchOnBody('ORDER_SHIPPED', false)).toBe('Order shipped: An order leaves, with its tracking page, ORBES writes this email to the buyer. Will send once the channel is on.');
    expect(wordsState({ edited: { subject: false, body: false } })).toBe('Default words');
    expect(wordsState({ edited: { subject: true, body: false } })).toBe('Edited: subject');
    expect(wordsState({ edited: { subject: true, body: true } })).toBe('Edited');
  });

  it('checks the words being written as the server does, names the placeholders this email does not fill, and sends only what changed', () => {
    expect(subjectProblem('')).toBe('Write a subject.');
    expect(subjectProblem('a\nb')).toBe('One line.');
    expect(subjectProblem('x'.repeat(151))).toBe('At most 150 characters.');
    expect(subjectProblem('On its way')).toBeNull();
    expect(bodyProblem('  ')).toBe('Write the words.');
    expect(bodyProblem('x'.repeat(5001))).toBe(`At most ${formatCount(5000)} characters.`);
    const k = kind();
    expect(unknownPlaceholders({ subject: '{orderRef} {giftWrap}', body: '{firstName} {giftWrap} {note}' }, k.placeholders)).toEqual(['giftWrap', 'note']);
    expect(unknownLine(['giftWrap'])).toBe('{giftWrap} is not filled by this email: it stays as written.');
    expect(unknownLine(['a', 'b'])).toBe('{a}, {b} are not filled by this email: they stay as written.');
    expect(unknownLine([])).toBeNull();
    expect(isDraftChanged(k, k.words)).toBe(false);
    expect(wordsChange(k, { ...k.words, subject: 'On its way: {orderRef} ' })).toEqual({ subject: 'On its way: {orderRef}' });
    // Written back to the default words: the default (null), never a copy of them.
    const edited = kind({ words: { subject: 'Edited', body: k.words.body }, edited: { subject: true, body: false } });
    expect(wordsChange(edited, { subject: EMAIL_DEFAULTS.ORDER_SHIPPED.subject, body: k.words.body })).toEqual({ subject: null });
  });

  it('writes the outbox in words, in Paris: due, tried again, sent, failed, cancelled; whom each is for', () => {
    const row = { status: 'QUEUED' as const, attempts: 0, notBefore: '2026-11-05T18:00:00.000Z', sentAt: null, settledAt: null };
    expect(outboxWhen(row)).toBe('Due 05 NOV 2026 · 19:00 Paris');
    expect(outboxWhen({ ...row, attempts: 2 })).toBe('Tried twice · again 05 NOV 2026 · 19:00 Paris');
    expect(outboxWhen({ ...row, status: 'SENT', attempts: 1, sentAt: '2026-11-05T18:01:00.000Z' })).toBe('Sent 05 NOV 2026 · 19:01 Paris');
    expect(outboxWhen({ ...row, status: 'FAILED', attempts: 5, settledAt: '2026-11-05T20:00:00.000Z' })).toBe('After 5 times · 05 NOV 2026 · 21:00 Paris');
    expect(statusTone('FAILED')).toBe('alert');
    expect(outboxKpis({ queued: 2, sent: 1200, failed: 0, cancelled: 3 }).map((x) => [x.label, x.value, x.note])).toEqual([
      ['Queued', '2', 'TO BE SENT'],
      ['Sent', formatCount(1200), 'IN 90 DAYS'],
      ['Failed', '0', 'NONE'],
      ['Cancelled', '3', 'NEVER SENT'],
    ]);
    expect(recipientKind({ accountId: null, preregistrationId: 'p' })).toBe('Founding list');
    expect(recipientKind({ accountId: 'a', preregistrationId: null })).toBe('Account');
    expect(recipientKind({ accountId: null, preregistrationId: null })).toBe('Test');
    expect(outboxLine(1, true)).toBe('1 email matches the filters');
    expect(outboxLine(3, false)).toBe('3 emails');
  });

  it('lets an AUDITOR read, an OPERATOR write the words, an ADMIN switch, test and send the founding announcement (as the server)', () => {
    expect([CAPABILITY_MIN_ROLE.readEmails, CAPABILITY_MIN_ROLE.editEmailWords, CAPABILITY_MIN_ROLE.switchEmails, CAPABILITY_MIN_ROLE.sendAnnouncement]).toEqual(['AUDITOR', 'OPERATOR', 'ADMIN', 'ADMIN']);
    expect(emailsActions('AUDITOR')).toEqual({ switch: false, edit: false });
    expect(emailsActions('OPERATOR')).toEqual({ switch: false, edit: true });
    expect(emailsActions('ADMIN')).toEqual({ switch: true, edit: true });
    for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(can(role, 'readEmails'), role).toBe(false);
  });
});

describe('the founding announcement’s panel (E1, F6)', () => {
  const ready = { channel: true, enabled: true, reach: 3 };

  it('asks for the server’s own phrase', () => {
    for (const id of ['5a1b2c3d-0000-4000-8000-000000000001', 'abcdef12-3456-4789-8abc-def012345678']) expect(announcementPhrase(id)).toBe(serverPhrase(id));
  });

  it('chooses the release asked for, else the first not yet sent, else the soonest', () => {
    const a = release({ id: 'a', emails: { queued: 3, sent: 0, failed: 0, cancelled: 0 } });
    const b = release({ id: 'b' });
    expect(chosenRelease({ releases: [a, b] }, null)?.id).toBe('b');
    expect(chosenRelease({ releases: [a, b] }, 'a')?.id).toBe('a');
    expect(chosenRelease({ releases: [a] }, 'gone')?.id).toBe('a');
    expect(chosenRelease({ releases: [] }, null)).toBeNull();
  });

  it('offers Send now and Send at the opening once the channel, the switch and the list allow, each refusal in words', () => {
    expect(announcementOffer(ready, release(), NOW)).toEqual({ blocked: null, now: { ok: true, why: null }, atOpening: { ok: true, why: null, shown: true }, cancel: false });
    expect(announcementOffer({ ...ready, channel: false }, release(), NOW).now).toEqual({ ok: false, why: 'No email provider in the server’s .env: nothing is sent.' });
    expect(announcementOffer({ ...ready, enabled: false }, release(), NOW).blocked).toBe('Switch the founding announcement on first, on the Emails page.');
    expect(announcementOffer({ ...ready, reach: 0 }, release(), NOW).blocked).toBe('Nobody on the list to write to.');
    // A LIVE RELEASE not announced: at its opening only.
    const live = announcementOffer(ready, release({ mode: 'LIVE', announced: false }), NOW);
    expect(live.now).toEqual({ ok: false, why: 'This release is not announced yet: send it at its opening.' });
    expect(live.atOpening.ok).toBe(true);
    // Once open, its opening is now: Send now alone.
    expect(announcementOffer(ready, release({ opensAt: '2026-11-01T18:00:00.000Z' }), NOW).atOpening.shown).toBe(false);
    expect(announcementOffer(ready, release({ emails: { queued: 2, sent: 0, failed: 0, cancelled: 0 } }), NOW).cancel).toBe(true);
  });

  it('says to whom, when and how the release is named, then what was written', () => {
    expect(reachText(1)).toBe('1 person on the list');
    expect(sendBody(ready, release(), 'OPENING')).toBe(
      'To 3 people on the founding list who have not unsubscribed, at the release’s opening, 05 NOV 2026 · 19:00 Paris. Each person receives it once for this release; those who already have it are left out. The email names the release “The first draw”.',
    );
    expect(announcementEmailsText({ queued: 2, sent: 1, failed: 0, cancelled: 4 })).toBe('2 queued · 1 sent · 4 cancelled');
    expect(announcementEmailsText({ queued: 0, sent: 0, failed: 0, cancelled: 0 })).toBe('None yet');
    expect(sentText(0, NOW.toISOString(), NOW)).toBe('Everyone on the list already has it for this release.');
    expect(sentText(3, '2026-11-05T18:00:00.000Z', NOW)).toBe('3 emails written, to go 05 NOV 2026 · 19:00 Paris.');
    expect(sentText(1, NOW.toISOString(), NOW)).toBe('1 email written.');
  });
});

describe('an email’s HTML in the console, never as markup (model/email-frame.ts)', () => {
  const rendered = renderEmail({
    kind: 'FOUNDING_ANNOUNCEMENT',
    words: EMAIL_DEFAULTS.FOUNDING_ANNOUNCEMENT,
    values: { firstName: 'Léa <b>&', release: 'The first draw', opensAt: new Date('2026-11-05T18:00:00.000Z'), link: 'https://verify.theorbes.com/verify/releases/x' },
    origin: 'https://verify.theorbes.com',
    unsubscribeUrl: 'https://verify.theorbes.com/verify/unsubscribe#f.x',
  });

  const texts = (n: EmailElement): string => n.children.map((c) => (typeof c === 'string' ? c : texts(c))).join('');
  const all = (n: EmailElement, tag: string): EmailElement[] => n.children.flatMap((c) => (typeof c === 'string' ? [] : [...(c.tag === tag ? [c] : []), ...all(c, tag)]));

  it('reads email/render.ts’s HTML into a tree: its body, its words with their entities, its links, its one image, its style', () => {
    const doc = parseEmailHtml(rendered.html);
    const body = findElement(doc, 'body')!;
    expect(body.attrs.class).toBe('o-ground');
    expect(body.attrs.style).toContain('background:#0a0a0a');
    const words = texts(body);
    expect(words).toContain('Léa <b>&,');
    expect(words).toContain('The first draw opens Thursday 5 November at 19:00, Paris time.');
    expect(all(body, 'a').map((a) => a.attrs.href)).toEqual(['https://verify.theorbes.com/verify/releases/x', 'https://verify.theorbes.com/verify/unsubscribe#f.x']);
    expect(all(body, 'img').map((i) => i.attrs.src)).toEqual(['https://verify.theorbes.com/api/v1/email/monogram.png']);
    expect(all(doc, 'script')).toEqual([]);
    expect(styleTexts(doc).join('')).toContain('prefers-color-scheme: light');
  });

  it('keeps a script, a comment or a stray end tag as words or leaves them out, never as an element that runs', () => {
    const doc = parseEmailHtml('<!DOCTYPE html><body><!-- a note --><p onclick="x()">A &amp; B &#39;C&#x2019;</p></span><script>alert(1)</script><img src=x onerror=y><br/>end');
    const body = findElement(doc, 'body')!;
    expect(texts(all(body, 'p')[0]!)).toBe('A & B \'C’');
    expect(body.children.at(-1)).toBe('end');
    expect(all(body, 'p')[0]!.attrs).toEqual({ onclick: 'x()' });
    expect(all(body, 'script')[0]!.children).toEqual(['alert(1)']);
    expect(decodeEntities('&nbsp;&middot;&unknown;&#0;')).toBe(' ·&unknown;&#0;');
  });

  it('reads its <style> into rules, applied for the scheme and the width chosen; nothing that reaches out', () => {
    const rules = emailCssRules(styleTexts(parseEmailHtml(rendered.html)).join('\n'));
    const light = rules.filter((r) => r.media === '(prefers-color-scheme: light)');
    expect(light.flatMap((r) => r.selectors)).toEqual(['.o-ground', '.o-ink', '.o-soft', '.o-rule', '.o-button']);
    expect(light[0]!.decls).toEqual([{ prop: 'background', value: '#ffffff', important: true }]);
    expect(rules.find((r) => r.selectors.includes('a'))?.decls).toEqual([{ prop: 'color', value: 'inherit', important: false }]);
    expect(mediaApplies('(prefers-color-scheme: light)', { scheme: 'light', width: 800 })).toBe(true);
    expect(mediaApplies('(prefers-color-scheme: light)', { scheme: 'dark', width: 800 })).toBe(false);
    expect(mediaApplies('(max-width:620px)', { scheme: 'dark', width: 462 })).toBe(true);
    expect(mediaApplies('(max-width:620px)', { scheme: 'dark', width: 700 })).toBe(false);
    expect(mediaApplies('print', { scheme: 'dark', width: 700 })).toBe(false);
    expect(mediaApplies(null, { scheme: 'dark', width: 700 })).toBe(true);
    expect(mediaKey(rules, { scheme: 'light', width: 400 })).not.toBe(mediaKey(rules, { scheme: 'light', width: 900 }));
    expect(emailCssRules('.o-x{background:url(https://tracker.example/p.png);color:red}')[0]!.decls).toEqual([{ prop: 'color', value: 'red', important: false }]);
    expect(emailCssRules('@import url(x.css); @font-face{src:x} .a{color:red}').map((r) => r.selectors)).toEqual([['.a']]);
    expect(simpleSelector('.o-ink')).toEqual({ kind: 'class', name: 'o-ink' });
    expect(simpleSelector('a')).toEqual({ kind: 'tag', name: 'a' });
    expect(simpleSelector(':root')).toBeNull();
    expect(simpleSelector('script')).toBeNull();
    expect(isFrameClass('o-ground')).toBe(true);
    expect(isFrameClass('cbtn')).toBe(false);
  });

  it('opens its links in a new tab only when http(s), and shows images from the console’s own origin (the monogram read there)', () => {
    expect(frameHref('https://verify.theorbes.com/verify')).toBe('https://verify.theorbes.com/verify');
    expect(frameHref('javascript:alert(1)')).toBeNull();
    expect(frameHref('https://user:pw@example.com/')).toBeNull();
    expect(frameHref(null)).toBeNull();
    const origin = 'http://127.0.0.1:4000';
    expect(frameImageSrc('https://verify.theorbes.com/api/v1/email/monogram.png', origin)).toBe(`${origin}/api/v1/email/monogram.png`);
    expect(frameImageSrc(`${origin}/x.png`, origin)).toBe(`${origin}/x.png`);
    expect(frameImageSrc('https://tracker.example/p.png', origin)).toBeNull();
    expect(frameImageSrc('https://verify.theorbes.com/api/v1/email/monogram.png?u=1', origin)).toBeNull();
  });
});
