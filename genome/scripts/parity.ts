/**
 * The parity tool of NOCTURNE (plan NOCTURNE, Fidelity, rules 2, 4 and 5): the real screens of /verify and /legal set
 * beside the 43 validated boards, on the stage of the screen captures (test/support/ui-stage.ts, scripts/capture-ui.ts)
 * with the NOCTURNE demo (test/support/nocturne-demo.ts: the boards' content, on a fixed clock, Monday 5 October 2026,
 * 18:49 in Paris) and the states it reaches (test/support/nocturne-states.ts).
 *
 *   cd genome && npx tsx scripts/parity.ts [C1,C9,…] [--out DIR] [--ref DIR]
 *       each board given (all 43 by default): the real screen of its state (BOARD_STATES) at 390 × 844 CSS px, scale 2,
 *       the whole page, its motion finished (as the boards were shot), into <out>/<C-id>.real.png, and
 *       <out>/<C-id>.pair.png: the board (<ref>/<C-id>-<name>.png) at the left, the real screen at the right, the same
 *       width, a label above each
 *   npx tsx scripts/parity.ts --states now-signed-in,room [--out DIR]
 *       those states (`all`: every state; a variant's name: its states), into <out>/<state>.png
 *   npx tsx scripts/parity.ts --stress [--out DIR]
 *       every extreme case (fidelity rule 5) into <out>/stress/<state>.png, and what overflows in each
 *   npx tsx scripts/parity.ts --baseline [--baseline-file FILE]
 *       every state the stage reaches, each visible text value recorded (ids and references written by the server
 *       masked: maskVolatile), into test/fixtures/nocturne-baseline.json (the content test's baseline)
 *
 * Default out: $ORBES_PARITY_OUT, else the scratchpad of the NOCTURNE workflow. Default ref: $ORBES_PARITY_REF, else the
 * canvas's shots (.claude/orbes-run/nocturne-ref/shots of the main checkout). Chromium: $ORBES_CHROMIUM.
 * Each variant of the demo is its own stage (a fresh database, seeded in a few seconds); the browser plays a hand-held
 * clip of that stage's piece to register (its codes are signed by that stage's key).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { NOCTURNE_NOW, type DemoVariant, type NocturneDemo } from '../test/support/nocturne-demo.js';
import { BASELINE_FILE, eachState, type Baseline, type BaselineState } from '../test/support/nocturne-stage.js';
import { BOARD_STATES, maskVolatile, openState, overflows, stateById, UI_STATES, visibleTexts, type UiState } from '../test/support/nocturne-states.js';
import type { UiStage } from '../test/support/ui-stage.js';

const GENOME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = process.env.ORBES_PARITY_OUT ?? '/private/tmp/claude-501/-Users-eliotrapatel-orbes-index/aae31500-d9d4-4f0f-8fd8-de1e75946007/scratchpad/parity';
const DEFAULT_REF = process.env.ORBES_PARITY_REF ?? canvasShots(GENOME_DIR);

/** The canvas's shots: .claude/orbes-run/nocturne-ref/shots in the first directory above `from` that holds them. */
function canvasShots(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const shots = join(dir, '.claude', 'orbes-run', 'nocturne-ref', 'shots');
    if (existsSync(shots)) return shots;
    if (dirname(dir) === dir) return join(from, 'nocturne-ref-shots');
  }
}

const log = (line: string) => process.stdout.write(`${line}\n`);

// ── Captures ───────────────────────────────────────────────────────────────

async function capture(browser: Browser, stage: UiStage, demo: NocturneDemo, state: UiState): Promise<Buffer> {
  const opened = await openState(browser, stage, demo, state);
  try {
    return await opened.page.screenshot({ type: 'png', fullPage: !state.viewport, animations: 'disabled' });
  } finally {
    await opened.close();
  }
}

/** The board `id`'s image in `refDir` (`C1-Now.png` for C1). */
function boardFile(refDir: string, id: string): string | null {
  const f = readdirSync(refDir).find((n) => n.startsWith(`${id}-`) && n.endsWith('.png'));
  return f ? join(refDir, f) : null;
}

/** The board at the left, the real screen at the right, each 780 px wide (390 CSS px at 2×), a label above each. */
async function pair(browser: Browser, board: Buffer | null, boardLabel: string, real: Buffer, realLabel: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1640, height: 400 }, deviceScaleFactor: 1 });
  try {
    const img = (png: Buffer | null) => (png ? `<img src="data:image/png;base64,${png.toString('base64')}" width="780">` : '<div class="none">NO BOARD</div>');
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;background:#2b2b2b;font:600 22px/1.3 Helvetica,Arial,sans-serif;color:#f6f2ea}
        .row{display:flex;gap:40px;padding:24px 20px 40px;align-items:flex-start}
        .col{width:780px}.label{height:44px;letter-spacing:.06em}.col img{display:block}
        .none{width:780px;height:300px;border:1px dashed #888;display:flex;align-items:center;justify-content:center}
      </style><div class="row"><div class="col"><div class="label">${boardLabel}</div>${img(board)}</div><div class="col"><div class="label">${realLabel}</div>${img(real)}</div></div>`,
    );
    await page.evaluate(async () => Promise.all([...document.images].map((i) => i.decode())));
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}

async function captureBoards(ids: string[], out: string, refDir: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  const byState = new Map<string, string[]>();
  for (const id of ids) {
    const s = BOARD_STATES[id];
    if (!s) throw new Error(`unknown board ${id} (C1 to C43)`);
    byState.set(s, [...(byState.get(s) ?? []), id]);
  }
  const failures: string[] = [];
  await eachState(
    [...byState.keys()].map(stateById),
    async (state, { stage, demo, browser }) => {
      let real: Buffer;
      try {
        real = await capture(browser, stage, demo, state);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        log(`  ${state.id}: FAILED ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      for (const id of byState.get(state.id)!) {
        writeFileSync(join(out, `${id}.real.png`), real);
        const file = boardFile(refDir, id);
        const board = file ? readFileSync(file) : null;
        const label = file ? file.slice(file.lastIndexOf('/') + 1) : `${id} (not found in ${refDir})`;
        writeFileSync(join(out, `${id}.pair.png`), await pair(browser, board, `BOARD ${label}`, real, `REAL ${id} · ${state.id}`));
        log(`  ${id}: ${state.id}`);
      }
    },
  );
  if (failures.length) throw new Error(`${failures.length} capture(s) failed:\n${failures.join('\n')}`);
}

async function captureStates(ids: string[], out: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  const failures: string[] = [];
  await eachState(ids.map(stateById), async (state, { stage, demo, browser }) => {
    try {
      writeFileSync(join(out, `${state.id}.png`), await capture(browser, stage, demo, state));
      log(`  ${state.id}`);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      log(`  ${state.id}: FAILED ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  });
  if (failures.length) throw new Error(`${failures.length} state(s) not reached:\n${failures.join('\n')}`);
}

/** Every extreme case, captured, with what overflows in each. */
async function captureStress(out: string): Promise<void> {
  const dir = join(out, 'stress');
  mkdirSync(dir, { recursive: true });
  const report: string[] = [];
  await eachState(
    UI_STATES.filter((s) => s.stress),
    async (state, { stage, demo, browser }) => {
      const opened = await openState(browser, stage, demo, state);
      try {
        writeFileSync(join(dir, `${state.id}.png`), await opened.page.screenshot({ type: 'png', fullPage: true, animations: 'disabled' }));
        const found = await overflows(opened.page);
        report.push(`${state.id}: ${found.length === 0 ? 'nothing overflows' : `\n  ${found.join('\n  ')}`}`);
        log(`  ${state.id}: ${found.length} overflow(s)`);
      } finally {
        await opened.close();
      }
    },
  );
  writeFileSync(join(dir, 'overflow.txt'), `${report.join('\n')}\n`);
  log(report.join('\n'));
}

// ── The content baseline ───────────────────────────────────────────────────

async function recordBaseline(file: string): Promise<void> {
  const states: Record<string, BaselineState> = {};
  await eachState(UI_STATES, async (state, { stage, demo, browser }) => {
    const opened = await openState(browser, stage, demo, state);
    try {
      const values = [...new Set((await visibleTexts(opened.page)).map(maskVolatile))];
      states[state.id] = { title: state.title, refs: state.refs, variant: state.variant, as: state.as ?? null, values };
      log(`  ${state.id}: ${values.length} values`);
    } finally {
      await opened.close();
    }
  });
  const ordered: Record<string, BaselineState> = {};
  for (const s of UI_STATES) if (states[s.id]) ordered[s.id] = states[s.id]!;
  const baseline: Baseline = {
    about:
      'NOCTURNE content baseline (plan NOCTURNE, fidelity rule 4): every text value the app showed at 5efd4c9, state by state, recorded by scripts/parity.ts --baseline on the NOCTURNE demo; «…» marks a part written by the server (an id, a reference, a code). test/web/nocturne.content.e2e.test.ts checks that each value is still shown in its state.',
    now: NOCTURNE_NOW.toISOString(),
    states: ordered,
  };
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  log(`${Object.keys(ordered).length} states, ${Object.values(ordered).reduce((n, s) => n + s.values.length, 0)} values in ${file}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let out = DEFAULT_OUT;
  let ref = DEFAULT_REF;
  let mode: 'boards' | 'states' | 'stress' | 'baseline' = 'boards';
  let list: string[] = [];
  let baselineFile = BASELINE_FILE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') out = resolve(argv[++i] ?? '');
    else if (a === '--ref') ref = resolve(argv[++i] ?? '');
    else if (a === '--stress') mode = 'stress';
    else if (a === '--baseline') mode = 'baseline';
    else if (a === '--baseline-file') baselineFile = resolve(argv[++i] ?? '');
    else if (a === '--states') {
      mode = 'states';
      list = (argv[++i] ?? '').split(',').filter(Boolean);
    } else if (/^C\d+(,C\d+)*$/.test(a)) list = a.split(',');
    else throw new Error(`unknown argument ${a} (C1,C2,…; --states a,b; --stress; --baseline; --out DIR; --ref DIR)`);
  }
  if (mode === 'boards') await captureBoards(list.length ? list : Object.keys(BOARD_STATES), out, ref);
  else if (mode === 'states') await captureStates(list.flatMap((x) => (x === 'all' ? UI_STATES.map((s) => s.id) : UI_STATES.some((s) => s.variant === x) ? UI_STATES.filter((s) => s.variant === x).map((s) => s.id) : [x])), out);
  else if (mode === 'stress') await captureStress(out);
  else await recordBaseline(baselineFile);
  if (mode !== 'baseline') log(`out: ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    process.stderr.write(`parity: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  });
}
