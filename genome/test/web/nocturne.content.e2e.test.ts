/**
 * NOCTURNE's content test (plan NOCTURNE, fidelity rule 4), its structure: the baseline holds every state the stage
 * reaches, every validated board has its state, the shards (test/web/nocturne.content-<shard>.e2e.test.ts, one per
 * CONTENT_SHARDS entry) hold every state once, and MOVED lists only values of the baseline. The browser runs are the
 * shards' (test/web/nocturne.content.harness.ts says how a value is checked).
 */
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_VARIANTS } from '../support/nocturne-demo.js';
import { BOARD_STATES, normalizeText, stateById, UI_STATES } from '../support/nocturne-states.js';
import { CONTENT_SHARDS, contentShard, MOVED, readBaseline } from './nocturne.content.harness.js';

const baseline = readBaseline();

describe('NOCTURNE content baseline', () => {
  it('covers every state the stage reaches, and every validated board has its state', () => {
    expect(Object.keys(baseline.states).sort()).toEqual(UI_STATES.map((s) => s.id).sort());
    for (let i = 1; i <= 43; i++) expect(BOARD_STATES[`C${i}`], `C${i}`).toBeDefined();
    for (const id of Object.values(BOARD_STATES)) expect(() => stateById(id)).not.toThrow();
    for (const s of UI_STATES) expect(DEMO_VARIANTS).toContain(s.variant);
    expect(new Set(UI_STATES.map((s) => s.id)).size).toBe(UI_STATES.length);
  });

  it('records values, and lists no move that is not a value of its state', () => {
    for (const [id, s] of Object.entries(baseline.states)) expect(s.values.length, id).toBeGreaterThan(0);
    for (const m of MOVED) {
      expect(m.reason.trim().length, `${m.state}: ${m.value}`).toBeGreaterThan(0);
      expect(m.now.trim().length, `${m.state}: ${m.value}`).toBeGreaterThan(0);
      expect(baseline.states[m.state]?.values.map(normalizeText), `${m.state}: ${m.value}`).toContain(normalizeText(m.value));
    }
  });

  it('runs every state in exactly one shard, each shard in its own test file', () => {
    const names = Object.keys(CONTENT_SHARDS);
    const held = names.flatMap((n) => contentShard(n).map((s) => s.id));
    expect([...held].sort()).toEqual(UI_STATES.map((s) => s.id).sort());
    expect(new Set(held).size).toBe(held.length);
    // About twenty states a shard, so each fits its time limit.
    for (const n of names) expect(contentShard(n).length, n).toBeLessThanOrEqual(28);
    const files = readdirSync(dirname(fileURLToPath(import.meta.url))).filter((f) => /^nocturne\.content-.+\.e2e\.test\.ts$/.test(f));
    expect(files.sort()).toEqual(names.map((n) => `nocturne.content-${n}.e2e.test.ts`).sort());
  });
});
