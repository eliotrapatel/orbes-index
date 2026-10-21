/**
 * ADD TO CALENDAR (plan MACRO M1 §2.1, scope C1: « draws and LIVE »): the one `.ics` writer of a release's public
 * calendar file, shared by the LIVE RELEASES (services/live-room.ts `liveCalendar`, GET /api/v1/live/:id/calendar.ics,
 * byte for byte what it wrote before this file) and the draws (services/drops.ts `calendar`, GET
 * /api/v1/drops/:id/calendar.ics).
 *
 *   releaseIcs   one VCALENDAR holding one VEVENT: its UID, DTSTAMP, DTSTART and DTEND in UTC, its summary, description
 *                and page address, then one display alarm per `alarms` entry, each this many minutes before the start.
 *                Lines folded at 75 octets (RFC 5545 §3.1, never inside a character), CRLF after every line, text
 *                escaped (§3.3.11). No ATTENDEE, no ORGANIZER: a release's file names no one.
 *   foldIcsLine  the folding, exported for the tests.
 *
 * Pure: no database, no clock (the caller passes `now`, the file's DTSTAMP).
 */

/** A release's first alarm: this many minutes before its event starts (a LIVE room's opening, a draw's entries). */
export const CALENDAR_ALARM_MINUTES = 10;

/** An alarm: this many minutes before the event, saying `description`. */
export interface IcsAlarm {
  minutes: number;
  description: string;
}

export interface ReleaseIcsInput {
  /** PRODID, the product that wrote the file: `-//ORBES//LIVE RELEASE//EN`, `-//ORBES//DRAW//EN`. */
  prodId: string;
  /** UID, unique and stable for the release: `<kind>-<id>@<host>`, so a second import updates the first. */
  uid: string;
  now: Date;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  /** The release's page. */
  url: string;
  /** In order: each one its VALARM. */
  alarms: readonly IcsAlarm[];
}

/** An instant in UTC, RFC 5545's basic form: `20261105T175500Z`. */
export const icsTime = (t: Date): string => `${new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;

/** TEXT escaped (RFC 5545 §3.3.11): backslash, semicolon, comma, newline. */
export const icsText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A negative DURATION of whole minutes: `-PT10M`, `-PT4H` when they make whole hours. */
export const icsBefore = (minutes: number): string => (minutes > 0 && minutes % 60 === 0 ? `-PT${minutes / 60}H` : `-PT${minutes}M`);

/** RFC 5545 §3.1: lines of at most 75 octets, continued on the next after a space; never inside a character. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** A release's calendar file (see the header). */
export function releaseIcs(input: ReleaseIcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${input.prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsTime(input.now)}`,
    `DTSTART:${icsTime(input.start)}`,
    `DTEND:${icsTime(input.end)}`,
    `SUMMARY:${icsText(input.summary)}`,
    `DESCRIPTION:${icsText(input.description)}`,
    `URL:${input.url}`,
    ...input.alarms.flatMap((a) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.description)}`, `TRIGGER:${icsBefore(a.minutes)}`, 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
