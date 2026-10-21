/**
 * ADD TO CALENDAR's one writer (plan MACRO M1 §2.1, C1; services/calendar.ts): the LIVE RELEASE's .ics written by it is
 * byte for byte the file the room wrote before (the SHA-256 of three files recorded from production's live-room.ts
 * before the move: a name, none, and a long name with every escaped character and a room opening a minute before);
 * a draw's (services/drops.ts drawCalendar): its event from the opening of its entries to their close, an alarm 10
 * minutes before (one alarm, as a LIVE RELEASE's, an early access or not), its page's address, no personal data.
 * The routes are test/api/live.test.ts's (unchanged) and test/api/drops.test.ts's.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CALENDAR_ALARM_MINUTES, foldIcsLine, icsBefore, icsText, icsTime, releaseIcs } from '../../src/server/services/calendar.js';
import { drawCalendar } from '../../src/server/services/drops.js';
import { foldIcsLine as liveFold, liveCalendar, LIVE_CALENDAR_ALARM_MINUTES } from '../../src/server/services/live-room.js';

const ID = '0f6c1f9e-3b1a-4c55-9d7e-2a4b6c8d0e12';
const ORIGIN = 'https://verify.theorbes.com';
const NOW = new Date('2026-10-21T06:41:07.123Z');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('the shared .ics writer (services/calendar.ts)', () => {
  const live = { id: ID, roomOpensAt: new Date('2026-11-05T17:55:00Z'), opensAt: new Date('2026-11-05T18:00:00Z'), closesAt: new Date('2026-11-05T19:30:00Z'), now: NOW, origin: ORIGIN };

  it('writes a LIVE RELEASE’s file byte for byte as the room wrote it before the move', () => {
    const named = liveCalendar({ ...live, name: 'MONOLITHE' });
    expect(named).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//ORBES//LIVE RELEASE//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:live-${ID}@verify.theorbes.com`,
        'DTSTAMP:20261021T064107Z',
        'DTSTART:20261105T175500Z',
        'DTEND:20261105T193000Z',
        'SUMMARY:LIVE RELEASE · MONOLITHE · ORBES',
        'DESCRIPTION:The room opens 5 minutes before the release. https://verify.the',
        ` orbes.com/verify/releases/${ID}`,
        'URL:https://verify.theorbes.com/verify/releases/0f6c1f9e-3b1a-4c55-9d7e-2a4',
        ' b6c8d0e12',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:LIVE RELEASE · MONOLITHE · ORBES',
        'TRIGGER:-PT10M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    // The three files recorded from production's live-room.ts (00317bcc0b4a) before the writer moved.
    expect(sha(named)).toBe('e04003bdd69b8a194e997b6980f3e98b508775e58bb342f67d573a8029646251');
    expect(sha(liveCalendar({ ...live, name: null }))).toBe('995b064ce90a86f1117319ce020a991faa7e231dcb1d8abf5e9ab041848018ff');
    const long = liveCalendar({ ...live, name: `LA NUIT, LE JOUR; À L\\ÉTÉ ${'é'.repeat(40)}`, roomOpensAt: new Date('2026-11-05T17:59:00Z') });
    expect(sha(long)).toBe('248655f88bbe42b3459be9e4f8ca2b8cb33b80c13c823502001a873f893bdf06');
    expect(LIVE_CALENDAR_ALARM_MINUTES).toBe(CALENDAR_ALARM_MINUTES);
    expect(liveFold).toBe(foldIcsLine);
  });

  it('times in UTC, escapes text, folds at 75 octets never inside a character, and writes whole hours as hours', () => {
    expect(icsTime(new Date('2026-11-05T17:55:09.999Z'))).toBe('20261105T175509Z');
    expect(icsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    expect([icsBefore(10), icsBefore(60), icsBefore(240), icsBefore(90)]).toEqual(['-PT10M', '-PT1H', '-PT4H', '-PT90M']);
    const folded = foldIcsLine(`SUMMARY:${'€'.repeat(40)}`);
    expect(folded.split('\r\n ').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(unfold(folded)).toBe(`SUMMARY:${'€'.repeat(40)}`);
    const file = releaseIcs({ prodId: '-//ORBES//TEST//EN', uid: 'x@h', now: NOW, start: NOW, end: NOW, summary: 'S', description: 'D', url: 'https://h/x', alarms: [] });
    expect(file).not.toContain('VALARM');
    expect(file.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
  });
});

describe('a draw’s ADD TO CALENDAR (services/drops.ts drawCalendar)', () => {
  const draw = { id: ID, name: 'MONOLITHE', opensAt: new Date('2026-11-05T09:00:00Z'), closesAt: new Date('2026-11-07T21:00:00Z'), now: NOW, origin: ORIGIN };
  const alarms = (file: string) => [...unfold(file).matchAll(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:([^\r]+)\r\nTRIGGER:([^\r]+)\r\nEND:VALARM/g)].map((m) => [m[1], m[2]]);

  it('is one event from the opening of the entries to their close, with its page, its name and an alarm 10 minutes before', () => {
    const file = drawCalendar(draw);
    const u = unfold(file);
    expect(file.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(u).toContain('PRODID:-//ORBES//DRAW//EN');
    expect(u).toContain(`UID:draw-${ID}@verify.theorbes.com`);
    expect(u).toContain('DTSTAMP:20261021T064107Z');
    expect(u).toContain('DTSTART:20261105T090000Z');
    expect(u).toContain('DTEND:20261107T210000Z');
    expect(u).toContain('SUMMARY:DRAW · MONOLITHE · ORBES');
    expect(u).toContain(`DESCRIPTION:Entries open at the start of this event and close at its end. ${ORIGIN}/verify/releases/${ID}`);
    expect(u).toContain(`URL:${ORIGIN}/verify/releases/${ID}`);
    expect(alarms(file)).toEqual([['DRAW · MONOLITHE · ORBES', '-PT10M']]);
    expect(u).not.toMatch(/ATTENDEE|ORGANIZER|@example\.com/);
  });

});
