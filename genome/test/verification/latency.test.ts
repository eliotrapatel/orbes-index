/**
 * Contract §2.4 step 12: p95 < 300 ms per verification (excluding network).
 * 200 sequential verifications on in-memory PGlite, over a realistic mix:
 * first-registration scans (token minted), owner scans, plain AUTHENTIC
 * scans with a full genome reading, and a growing per-code scan history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, createWorld, issue, issueActivated, registerOwner, verify, type World } from './world.js';
import type { IssueResult } from '../../src/server/services/issuance.js';

const N = 200;

describe('verification latency', () => {
  let w: World;
  const products: { r: IssueResult; owner?: string }[] = [];

  beforeAll(async () => {
    w = await createWorld();
    for (let i = 0; i < 8; i++) products.push({ r: await issue(w) });
    for (let i = 0; i < 6; i++) products.push({ r: await issueActivated(w) });
    for (let i = 0; i < 6; i++) {
      const r = await issueActivated(w);
      const owner = await createAccount(w);
      await registerOwner(w, r, owner);
      products.push({ r, owner });
    }
    // Warm-up (JIT, prepared plans): not measured.
    for (const p of products.slice(0, 5)) await verify(w, p.r.code.data);
  });
  afterAll(() => w.close());

  it(`p95 of ${N} sequential verifications < 300 ms`, async () => {
    const times: number[] = [];
    const states = new Map<string, number>();
    const countries = ['FR', 'FR', 'FR', 'GB', 'IT'];
    for (let i = 0; i < N; i++) {
      const p = products[i % products.length];
      w.clock.advance(17_000);
      const t = performance.now();
      const out = await verify(
        w,
        { code: p.r.code.data, genome: { glyphs: p.r.genome.glyphs, confidence: p.r.genome.glyphs.map(() => 0.9) } },
        {
          deviceHash: `device-${i % 7}`,
          ipHash: `ip-${i % 5}`,
          accountId: p.owner && i % 2 === 0 ? p.owner : undefined,
          geo: { country: countries[i % countries.length] },
        },
      );
      times.push(performance.now() - t);
      states.set(out.state, (states.get(out.state) ?? 0) + 1);
    }
    times.sort((a, b) => a - b);
    const q = (p: number) => times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const report = {
      n: N,
      meanMs: +mean.toFixed(2),
      p50Ms: +q(0.5).toFixed(2),
      p95Ms: +q(0.95).toFixed(2),
      p99Ms: +q(0.99).toFixed(2),
      maxMs: +times[times.length - 1].toFixed(2),
      states: Object.fromEntries(states),
    };
    console.log(`[verification latency] ${JSON.stringify(report)}`);
    expect(q(0.95)).toBeLessThan(300);
  });
});
