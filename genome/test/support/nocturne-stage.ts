/**
 * The NOCTURNE stage: each variant of the demo (test/support/nocturne-demo.ts) seeded on its own stage
 * (test/support/ui-stage.ts) over one web build, with a browser whose fake camera films that stage's piece to register,
 * and the states of test/support/nocturne-states.ts run on them in order. Shared by the parity tool (scripts/parity.ts)
 * and the NOCTURNE browser tests; the content baseline's file and shape.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { buildWeb } from '../../scripts/build-web.js';
import { createManualClock } from '../../src/server/types.js';
import { NOCTURNE_ADMIN, NOCTURNE_CLIENT_SERVICES, NOCTURNE_NOW, seedNocturne, type DemoVariant, type NocturneDemo } from './nocturne-demo.js';
import { runOrder, type UiState } from './nocturne-states.js';
import { cameraClip, CHROMIUM_PATH, startUiStage, type UiStage } from './ui-stage.js';

/** The content baseline (scripts/parity.ts --baseline; test/web/nocturne.content.e2e.test.ts). */
export const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'nocturne-baseline.json');

export interface BaselineState {
  title: string;
  refs: readonly string[];
  variant: DemoVariant;
  /** The account the phone held, or null (a visitor). */
  as: string | null;
  /** Every visible text value, in page order, server-written parts masked («id», «ref», «code»…). */
  values: string[];
}

export interface Baseline {
  /** What the file is, for whoever opens it. */
  about: string;
  /** The stage's fixed clock. */
  now: string;
  states: Record<string, BaselineState>;
}

/** The stage's configuration for the demo: its console user, ORBES Client Services, ORBES Care, limits out of the way. */
export const NOCTURNE_CONFIG = Object.freeze({
  bootstrapAdmin: NOCTURNE_ADMIN,
  clientServices: NOCTURNE_CLIENT_SERVICES,
  careSubscribeUrl: 'https://example.com/orbes-care',
  rateLimits: { verifyPerMinute: 100_000, authPerMinute: 100_000, apiPerMinute: 100_000, adminPerMinute: 100_000 },
});

export interface NocturneStage {
  stage: UiStage;
  demo: NocturneDemo;
  browser: Browser;
  close(): Promise<void>;
}

/** The demo `variant` seeded on its own stage, and a browser whose fake camera films its piece to register. */
export async function startNocturneStage(webDir: string, variant: DemoVariant, workDir: string): Promise<NocturneStage> {
  const clock = createManualClock(NOCTURNE_NOW);
  let demo: NocturneDemo | undefined;
  const stage = await startUiStage({
    webDir,
    clock: clock.now,
    config: NOCTURNE_CONFIG,
    seed: async (ctx) => {
      demo = await seedNocturne(ctx, clock, variant);
    },
  });
  try {
    const filmed = demo!.codes.first ?? demo!.codes.yours ?? Object.values(demo!.codes)[0];
    const args = ['--no-sandbox'];
    if (filmed) {
      const clip = join(workDir, `camera-${variant}.y4m`);
      cameraClip(filmed, clip);
      args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${clip}`);
    }
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args });
    return {
      stage,
      demo: demo!,
      browser,
      async close() {
        await browser.close().catch(() => {});
        await stage.close();
      },
    };
  } catch (e) {
    await stage.close().catch(() => {});
    throw e;
  }
}

/**
 * Run `each` on every state of `states`, variant by variant (a stage each, over one web build), in the order a run
 * reaches them (runOrder: the states that write last). `log` says each stage's start.
 */
export async function eachState(
  states: readonly UiState[],
  each: (s: UiState, run: { stage: UiStage; demo: NocturneDemo; browser: Browser }) => Promise<void>,
  log: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'orbes-nocturne-'));
  try {
    const webDir = join(workDir, 'web');
    await buildWeb({ outDir: webDir, mode: 'production' });
    const ordered = runOrder(states);
    for (const variant of [...new Set(ordered.map((s) => s.variant))]) {
      const t = Date.now();
      const st = await startNocturneStage(webDir, variant, workDir);
      log(`${variant}: stage ready (${Date.now() - t} ms)`);
      try {
        for (const s of ordered.filter((x) => x.variant === variant)) await each(s, st);
      } finally {
        await st.close();
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
