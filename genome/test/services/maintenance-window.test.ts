/**
 * The forbidden windows (plan PURGE §W, D16, R3, G2): the night is [03:00, 05:30) UTC OR [04:00, 06:30) Paris, the
 * hub backups [03:00, 03:10) and [03:45, 03:55) Paris all year. Absolute cases a shared mistake cannot pass, a walk
 * of every minute of four days (a winter day, a summer day and both change days of 2026) against a reference that
 * knows nothing of Intl, and the console's words computed for the date. The SQL copy of the rule
 * (`orbes_maintenance_window`, migration 0066) is walked against this one by the migration's tests.
 */
import { describe, expect, it } from 'vitest';
import { MAINTENANCE_MARGIN_MS, maintenanceWindow, parisClock, windowWords } from '../../src/server/services/maintenance-window.js';

const MIN = 60_000;
const at = (iso: string) => new Date(iso);
const kind = (iso: string, marginMs = 0) => maintenanceWindow(at(iso), marginMs)?.kind ?? null;

/** The last Sunday of a month (m from 1) of year y, as a UTC date number. */
function lastSunday(y: number, m: number): number {
  const last = new Date(Date.UTC(y, m, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** Paris's offset in hours by the EU rule (summer time from the last Sunday of March to the last Sunday of October, 01:00 UTC). */
function referenceOffset(t: number): number {
  const y = new Date(t).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 3), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 10), 1);
  return t >= start && t < end ? 2 : 1;
}

/** The rule written again from its words, with the reference offset. */
function referenceKind(t: number): 'NIGHT' | 'BACKUP' | null {
  const utc = Math.floor((t % 86_400_000) / MIN);
  const paris = (utc + referenceOffset(t) * 60) % 1440;
  if ((utc >= 180 && utc < 330) || (paris >= 240 && paris < 390)) return 'NIGHT';
  if ((paris >= 180 && paris < 190) || (paris >= 225 && paris < 235)) return 'BACKUP';
  return null;
}

function referenceWithin(t: number, marginMs: number): 'NIGHT' | 'BACKUP' | null {
  return referenceKind(t) ?? (marginMs > 0 ? referenceKind(t + marginMs) : null);
}

describe('maintenanceWindow: absolute cases', () => {
  it('summer time (15 July 2026): 01:05 UTC BACKUP, 01:30 UTC allowed, 02:30 and 05:15 UTC NIGHT', () => {
    expect(kind('2026-07-15T01:05:00Z')).toBe('BACKUP'); // 03:05 Paris
    expect(kind('2026-07-15T01:50:00Z')).toBe('BACKUP'); // 03:50 Paris
    expect(kind('2026-07-15T01:30:00Z')).toBeNull(); // 03:30 Paris
    expect(kind('2026-07-15T02:30:00Z')).toBe('NIGHT'); // 04:30 Paris: NIGHT through the Paris half only
    expect(kind('2026-07-15T05:15:00Z')).toBe('NIGHT'); // 07:15 Paris: NIGHT through the UTC half only
    expect(kind('2026-07-15T01:59:59Z')).toBeNull();
    expect(kind('2026-07-15T02:00:00Z')).toBe('NIGHT'); // 04:00 Paris
    expect(kind('2026-07-15T05:29:59Z')).toBe('NIGHT');
    expect(kind('2026-07-15T05:30:00Z')).toBeNull(); // 07:30 Paris
  });

  it('winter time (15 January 2026): 02:05 UTC BACKUP, 01:05 UTC allowed; 03:00 and 05:29 UTC NIGHT, 05:30 UTC allowed', () => {
    expect(kind('2026-01-15T02:05:00Z')).toBe('BACKUP'); // 03:05 Paris
    expect(kind('2026-01-15T02:50:00Z')).toBe('BACKUP'); // 03:50 Paris
    expect(kind('2026-01-15T01:05:00Z')).toBeNull(); // 02:05 Paris
    expect(kind('2026-01-15T02:10:00Z')).toBeNull(); // 03:10 Paris: the backup is over
    expect(kind('2026-01-15T02:55:00Z')).toBeNull();
    expect(kind('2026-01-15T02:59:59Z')).toBeNull();
    expect(kind('2026-01-15T03:00:00Z')).toBe('NIGHT');
    expect(kind('2026-01-15T05:29:00Z')).toBe('NIGHT');
    expect(kind('2026-01-15T05:30:00Z')).toBeNull();
  });

  it('refuses a call that would still run when a window starts: 02:57 UTC with 5 minutes, 01:59:30 UTC (winter) with 1 minute', () => {
    expect(kind('2026-01-15T02:57:00Z')).toBeNull();
    expect(kind('2026-01-15T02:57:00Z', MAINTENANCE_MARGIN_MS.reset)).toBe('NIGHT');
    expect(kind('2026-01-15T01:59:30Z')).toBeNull();
    expect(kind('2026-01-15T01:59:30Z', MAINTENANCE_MARGIN_MS.purgeBatch)).toBe('BACKUP');
    expect(kind('2026-01-15T01:58:59Z', MAINTENANCE_MARGIN_MS.purgeBatch)).toBeNull();
    // The window itself still wins over the margin: a call inside a window is refused for that window.
    expect(maintenanceWindow(at('2026-01-15T02:08:00Z'), MAINTENANCE_MARGIN_MS.reset)).toEqual({
      kind: 'BACKUP',
      startsAt: at('2026-01-15T02:00:00Z'),
      endsAt: at('2026-01-15T02:10:00Z'),
    });
  });

  it('both change days: 29 March 2026 (summer time from 01:00 UTC) and 25 October 2026 (winter time from 01:00 UTC)', () => {
    // 29 March: the clocks go from 02:00 to 03:00 Paris at 01:00 UTC, so the backups are at 01:00 and 01:45 UTC.
    expect(kind('2026-03-29T01:00:00Z')).toBe('BACKUP');
    expect(kind('2026-03-29T01:45:00Z')).toBe('BACKUP');
    expect(kind('2026-03-29T02:00:00Z')).toBe('NIGHT'); // 04:00 Paris
    expect(kind('2026-03-29T05:29:00Z')).toBe('NIGHT');
    expect(kind('2026-03-29T05:30:00Z')).toBeNull();
    expect(maintenanceWindow(at('2026-03-29T03:00:00Z'))).toEqual({ kind: 'NIGHT', startsAt: at('2026-03-29T02:00:00Z'), endsAt: at('2026-03-29T05:30:00Z') });
    // 25 October: 02:00–03:00 Paris happens twice (00:00–02:00 UTC); 03:00 Paris is 02:00 UTC.
    expect(kind('2026-10-25T00:30:00Z')).toBeNull(); // 02:30 Paris, summer time
    expect(kind('2026-10-25T01:30:00Z')).toBeNull(); // 02:30 Paris, winter time
    expect(kind('2026-10-25T01:05:00Z')).toBeNull();
    expect(kind('2026-10-25T02:05:00Z')).toBe('BACKUP');
    expect(kind('2026-10-25T02:50:00Z')).toBe('BACKUP');
    expect(kind('2026-10-25T02:59:00Z')).toBeNull();
    expect(kind('2026-10-25T03:00:00Z')).toBe('NIGHT');
    expect(maintenanceWindow(at('2026-10-25T04:00:00Z'))).toEqual({ kind: 'NIGHT', startsAt: at('2026-10-25T03:00:00Z'), endsAt: at('2026-10-25T05:30:00Z') });
    // The next spring change, 28 March 2027 (the purge runs after launch too).
    expect(kind('2027-03-28T01:05:00Z')).toBe('BACKUP');
    expect(kind('2027-03-28T02:05:00Z')).toBe('NIGHT');
  });

  it('refuses what is not an instant or a margin outside 0 to 5 minutes', () => {
    expect(() => maintenanceWindow(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => maintenanceWindow(at('2026-01-15T12:00:00Z'), -1)).toThrow(RangeError);
    expect(() => maintenanceWindow(at('2026-01-15T12:00:00Z'), 5 * MIN + 1)).toThrow(RangeError);
    expect(() => windowWords(at('2026-01-15T12:00:00Z'), Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(maintenanceWindow(at('2026-01-15T12:00:00Z'), 5 * MIN)).toBeNull();
  });
});

describe('maintenanceWindow: every minute of four days against the reference', () => {
  const days = ['2026-01-15', '2026-07-15', '2026-03-29', '2026-10-25'];
  for (const day of days) {
    it(`${day}: margins 0, 1 and 5 minutes, at :00 and :30 seconds`, () => {
      const start = Date.parse(`${day}T00:00:00Z`);
      const mismatches: string[] = [];
      for (let m = 0; m < 1440; m++) {
        for (const s of [0, 30_000]) {
          const t = start + m * MIN + s;
          for (const margin of [0, MAINTENANCE_MARGIN_MS.purgeBatch, MAINTENANCE_MARGIN_MS.reset]) {
            const got = maintenanceWindow(new Date(t), margin)?.kind ?? null;
            const want = referenceWithin(t, margin);
            if (got !== want) mismatches.push(`${new Date(t).toISOString()} +${margin / MIN}min: ${got} != ${want}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe('windowWords: Paris first, UTC in parentheses, computed for the date', () => {
  it('the night ends at 06:30 Paris in winter time and at 07:30 Paris in summer time', () => {
    expect(windowWords(at('2026-01-15T04:00:00Z'))).toBe(
      "The platform's night maintenance runs from 04:00 to 06:30 Paris (03:00–05:30 UTC). Try again at 06:30.",
    );
    expect(windowWords(at('2026-07-15T02:30:00Z'))).toBe(
      "The platform's night maintenance runs from 04:00 to 07:30 Paris (02:00–05:30 UTC). Try again at 07:30.",
    );
    expect(windowWords(at('2026-07-15T05:15:00Z'))).toBe(
      "The platform's night maintenance runs from 04:00 to 07:30 Paris (02:00–05:30 UTC). Try again at 07:30.",
    );
    // Both change days read the hours of their own date.
    expect(windowWords(at('2026-03-29T03:00:00Z'))).toBe(
      "The platform's night maintenance runs from 04:00 to 07:30 Paris (02:00–05:30 UTC). Try again at 07:30.",
    );
    expect(windowWords(at('2026-10-25T03:00:00Z'))).toBe(
      "The platform's night maintenance runs from 04:00 to 06:30 Paris (03:00–05:30 UTC). Try again at 06:30.",
    );
  });

  it('the backups always read 03:00–03:10 and 03:45–03:55 Paris, the UTC hours those of the date', () => {
    expect(windowWords(at('2026-01-15T02:05:00Z'))).toBe('The hub backup runs from 03:00 to 03:10 Paris (02:00–02:10 UTC). Try again at 03:10.');
    expect(windowWords(at('2026-01-15T02:50:00Z'))).toBe('The hub backup runs from 03:45 to 03:55 Paris (02:45–02:55 UTC). Try again at 03:55.');
    expect(windowWords(at('2026-07-15T01:05:00Z'))).toBe('The hub backup runs from 03:00 to 03:10 Paris (01:00–01:10 UTC). Try again at 03:10.');
    expect(windowWords(at('2026-07-15T01:50:00Z'))).toBe('The hub backup runs from 03:45 to 03:55 Paris (01:45–01:55 UTC). Try again at 03:55.');
  });

  it('within the margin: the window that is about to start, and when to try again', () => {
    expect(windowWords(at('2026-01-15T01:59:30Z'), MAINTENANCE_MARGIN_MS.purgeBatch)).toBe('The hub backup starts at 03:00 Paris; try again at 03:10.');
    expect(windowWords(at('2026-07-15T00:57:00Z'), MAINTENANCE_MARGIN_MS.reset)).toBe('The hub backup starts at 03:00 Paris; try again at 03:10.');
    expect(windowWords(at('2026-07-15T01:42:00Z'), MAINTENANCE_MARGIN_MS.reset)).toBe('The hub backup starts at 03:45 Paris; try again at 03:55.');
    expect(windowWords(at('2026-01-15T02:57:00Z'), MAINTENANCE_MARGIN_MS.reset)).toBe("The platform's night maintenance starts at 04:00 Paris; try again at 06:30.");
    expect(windowWords(at('2026-07-15T01:57:00Z'), MAINTENANCE_MARGIN_MS.reset)).toBe("The platform's night maintenance starts at 04:00 Paris; try again at 07:30.");
  });

  it('outside every window: null, whatever the margin', () => {
    for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T01:30:00Z', '2026-01-15T05:30:00Z', '2026-07-15T05:30:00Z']) {
      expect(windowWords(at(iso))).toBeNull();
      expect(windowWords(at(iso), MAINTENANCE_MARGIN_MS.reset)).toBeNull();
    }
  });

  it('parisClock reads the Paris clock of the date', () => {
    expect(parisClock(at('2026-01-15T03:00:00Z'))).toBe('04:00');
    expect(parisClock(at('2026-07-15T03:00:00Z'))).toBe('05:00');
  });
});
