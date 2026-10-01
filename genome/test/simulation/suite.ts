/**
 * Vitest wrapper around the counterfeit scenarios: each scenario runs once in
 * its own world (beforeAll), then the assertions read its recorded checks.
 * The scenario files are split so vitest can run them in parallel and each
 * file stays well under two minutes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Check, DbFactory } from './lab.js';
import { runScenario, scenario, unexpected, type ScenarioResult } from './scenarios.js';

/** Generous: a scenario takes 5–25 s alone, more when vitest runs files in parallel. */
export const SCENARIO_TIMEOUT_MS = 115_000;

function show(c: Check): string {
  return `${c.status} ${c.id} ${c.title} — expected ${c.expected}, observed ${c.observed}${c.note ? ` (${c.note})` : ''}`;
}

export function scenarioSuite(ids: readonly number[], opts: { dbFactory?: DbFactory; label?: string } = {}): void {
  for (const id of ids) {
    const s = scenario(id);
    describe(`${opts.label ?? 'counterfeit simulation'} §27 scenario ${id}: ${s.title}`, () => {
      let r: ScenarioResult;
      beforeAll(async () => {
        r = await runScenario(s, opts.dbFactory ? { dbFactory: opts.dbFactory } : {});
      }, SCENARIO_TIMEOUT_MS);

      it('every check passes (gaps and detection limits aside)', () => {
        expect(r.checks.length).toBeGreaterThan(3);
        expect(unexpected(s, r).map(show)).toEqual([]);
      });

      it('documented gaps and detection limits are exactly the known ones', () => {
        const ids = (status: Check['status']) => r.checks.filter((c) => c.status === status).map((c) => c.id).sort();
        expect(ids('GAP')).toEqual([...s.knownGaps].sort());
        expect(ids('LIMIT')).toEqual([...s.knownLimits].sort());
      });

      it('no edited, forged or corrupted byte string is ever answered AUTHENTIC*', () => {
        expect(r.forged.authentic, r.forged.states).toBe(0);
      });

      it('every public response is redacted', () => {
        const redaction = r.checks.find((c) => c.id === `${id}z`);
        expect(redaction && show(redaction)).toMatch(/^PASS /);
        expect(r.responses).toBeGreaterThan(0);
      });

      it('genuine artifacts photographed by phones never trip the genome cross-check', () => {
        expect(r.genomeChecks.MISMATCH ?? 0).toBe(0);
      });
    });
  }
}
