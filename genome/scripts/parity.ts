/**
 * The parity tool of NOCTURNE (plan NOCTURNE, Fidelity, rules 2, 4 and 5): the real screens of /verify and /legal set
 * beside the 43 validated boards, on the stage of the screen captures (test/support/ui-stage.ts, scripts/capture-ui.ts)
 * with the NOCTURNE demo (test/support/nocturne-demo.ts: the boards' content, on a fixed clock, Monday 5 October 2026,
 * 18:49 in Paris) and the states it reaches (test/support/nocturne-states.ts).
 *
 *   cd genome && npx tsx scripts/parity.ts [C1,C9,…] [--out DIR] [--ref DIR]
 *       each board given (all 43 by default): the real screen of its state (BOARD_STATES) at 390 × 844 CSS px, scale 2,
 *       the whole page (the viewport grown to its height, so its fixed elements sit at its foot), its motion finished (as the boards were shot), into <out>/<C-id>.real.png, and
 *       <out>/<C-id>.pair.png: the board (<ref>/<C-id>-<name>.png) at the left, the real screen at the right, the same
 *       width, a label above each. C21 and C26, stand-in images of the room (fidelity rule 6), are set beside their
 *       state's before-capture instead (docs/assets/ui/nocturne-before/<live-xx|plus-xx>-*.png). A board of several
 *       states (BOARD_SECTIONS: C40) has each further state set beside it too, <C-id>.<state>.real.png and
 *       <C-id>.<state>.pair.png, each compared with its section. Boards may be given apart (C2 C40) or joined (C2,C40)
 *   npx tsx scripts/parity.ts --live [room,after-room-door,…] [--out DIR]
 *       the states given (by default every state whose refs name a before-capture, live-xx or plus-xx): the real
 *       screen into <out>/live/<state>.real.png, and <out>/live/<state>.pair.png: its before-capture at the left
 *   npx tsx scripts/parity.ts --states now-signed-in,room [--out DIR]
 *       those states (`all`: every state; a variant's name: its states), into <out>/<state>.png
 *   npx tsx scripts/parity.ts --stress [--out DIR]
 *       every extreme case (fidelity rule 5) into <out>/stress/<state>.png, and what overflows in each
 *   npx tsx scripts/parity.ts --board [--out DIR] [--ref DIR]
 *       the board for the owner's OK before deployment (fidelity rule 8): <out>/board.html, every pair already captured
 *       in <out> (the runs above) in the boards' order, C1 to C43, each with its C-id and its title (the board's own,
 *       read from <ref>/../preview/<C-id>-*.html) and its further sections; then the stress cases (<out>/stress, with
 *       what overflows in each), then the LIVE screens beside their before-captures (<out>/live). The images are
 *       linked, not embedded: the page stays beside them. A pair not captured is named as missing
 *   npx tsx scripts/parity.ts --baseline [--states a,b] [--baseline-file FILE]
 *       every state the stage reaches, each visible text value recorded (ids and references written by the server
 *       masked: maskVolatile), into test/fixtures/nocturne-baseline.json (the content test's baseline); with --states,
 *       those states only (a new state, or one whose way there changed), every other entry's values left as they are
 *
 * Default out: $ORBES_PARITY_OUT, else the scratchpad of the NOCTURNE workflow. Default ref: $ORBES_PARITY_REF, else the
 * canvas's shots (.claude/orbes-run/nocturne-ref/shots of the main checkout). Chromium: $ORBES_CHROMIUM.
 * Each variant of the demo is its own stage (a fresh database, seeded in a few seconds); the browser plays a hand-held
 * clip of that stage's piece to register (its codes are signed by that stage's key).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { NOCTURNE_NOW, type DemoVariant, type NocturneDemo } from '../test/support/nocturne-demo.js';
import { BASELINE_FILE, eachState, type Baseline, type BaselineState } from '../test/support/nocturne-stage.js';
import { BOARD_SECTIONS, BOARD_STATES, maskVolatile, openState, overflows, settle, stateById, UI_STATES, visibleTexts, type UiState } from '../test/support/nocturne-states.js';
import { fullScreenshot, type UiStage } from '../test/support/ui-stage.js';

const GENOME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = process.env.ORBES_PARITY_OUT ?? '/private/tmp/claude-501/-Users-eliotrapatel-orbes-index/aae31500-d9d4-4f0f-8fd8-de1e75946007/scratchpad/parity';
const DEFAULT_REF = process.env.ORBES_PARITY_REF ?? canvasShots(GENOME_DIR);
/** The captures of the LIVE screens taken at N0 on the app before NOCTURNE (fidelity rule 6). */
const BEFORE_DIR = join(GENOME_DIR, '..', 'docs', 'assets', 'ui', 'nocturne-before');
/** The boards that are stand-in images of the room: their screens are compared with N0's before-captures (fidelity rule 6). */
const STAND_IN_BOARDS: readonly string[] = ['C21', 'C26'];

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
    return await shoot(opened.page, state);
  } finally {
    await opened.close();
  }
}

/**
 * The state's picture: the viewport alone (`viewport`), or the whole page with the viewport grown to its height first
 * (fullScreenshot), so the fixed elements (the corner brackets, the SCAN ring) sit at the page's foot as in the
 * before-captures, the page settled again at that size; its motion finished, as the boards were shot.
 */
export async function shoot(page: Page, state: UiState): Promise<Buffer> {
  if (state.viewport) return page.screenshot({ type: 'png', animations: 'disabled' });
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  if (height > TALL_PAGE) return tallScreenshot(page, height);
  return fullScreenshot(page, { settle: (p) => settle(p), animations: 'disabled' });
}

/** The tallest page captured whole, in CSS px: Chromium captures 16 384 device px at most (8 192 CSS px at 2×). */
const TALL_PAGE = 7_600;
/** A taller page (the terms of use): its first 6 000 CSS px, a marked cut, then its last 1 500 (its foot). */
const TALL_TOP = 6_000;
const TALL_FOOT = 1_500;

/** A page too tall for one capture: its top and its foot, one under the other, a hatched band of 24 CSS px between. */
async function tallScreenshot(page: Page, height: number): Promise<Buffer> {
  const size = page.viewportSize();
  if (!size) throw new Error('page has no viewport');
  const part = async (viewport: number, y: number): Promise<Buffer> => {
    await page.setViewportSize({ width: size.width, height: viewport });
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await settle(page);
    return page.screenshot({ type: 'png', animations: 'disabled' });
  };
  let top: Buffer;
  let foot: Buffer;
  try {
    top = await part(TALL_TOP, 0);
    foot = await part(TALL_FOOT, height - TALL_FOOT);
  } finally {
    await page.setViewportSize(size);
  }
  const sheet = await page.context().newPage();
  try {
    await sheet.setViewportSize({ width: size.width, height: 400 });
    const img = (png: Buffer) => `<img src="data:image/png;base64,${png.toString('base64')}" width="${size.width}">`;
    await sheet.setContent(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#2b2b2b}img{display:block}.cut{height:24px;background:repeating-linear-gradient(45deg,#2b2b2b 0 6px,#555 6px 12px)}</style>${img(top)}<div class="cut"></div>${img(foot)}`,
    );
    await sheet.evaluate(async () => Promise.all([...document.images].map((i) => i.decode())));
    return await sheet.screenshot({ type: 'png', fullPage: true });
  } finally {
    await sheet.close();
  }
}

/** The board `id`'s image in `refDir` (`C1-Now.png` for C1). */
function boardFile(refDir: string, id: string): string | null {
  const f = readdirSync(refDir).find((n) => n.startsWith(`${id}-`) && n.endsWith('.png'));
  return f ? join(refDir, f) : null;
}

/** The before-capture a state names (its first ref live-xx or plus-xx), or null. */
function beforeRef(state: UiState): string | null {
  return state.refs.find((r) => /^(live|plus)-\d+$/.test(r)) ?? null;
}

/** The before-capture `ref`'s image (`live-05-room.png` for live-05). */
function beforeFile(ref: string): string | null {
  if (!existsSync(BEFORE_DIR)) return null;
  const f = readdirSync(BEFORE_DIR).find((n) => n.startsWith(`${ref}-`) && n.endsWith('.png'));
  return f ? join(BEFORE_DIR, f) : null;
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
  /** The further states of a board of several (BOARD_SECTIONS), each paired with that board. */
  const sections = new Map<string, string[]>();
  for (const id of ids) {
    const s = BOARD_STATES[id];
    if (!s) throw new Error(`unknown board ${id} (C1 to C43)`);
    byState.set(s, [...(byState.get(s) ?? []), id]);
    for (const extra of BOARD_SECTIONS[id] ?? []) sections.set(extra, [...(sections.get(extra) ?? []), id]);
  }
  const failures: string[] = [];
  await eachState(
    [...new Set([...byState.keys(), ...sections.keys()])].map(stateById),
    async (state, { stage, demo, browser }) => {
      let real: Buffer;
      try {
        real = await capture(browser, stage, demo, state);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        log(`  ${state.id}: FAILED ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      for (const id of sections.get(state.id) ?? []) {
        writeFileSync(join(out, `${id}.${state.id}.real.png`), real);
        const file = boardFile(refDir, id);
        const name = file ? file.slice(file.lastIndexOf('/') + 1) : `${id} (not found in ${refDir})`;
        writeFileSync(join(out, `${id}.${state.id}.pair.png`), await pair(browser, file ? readFileSync(file) : null, `BOARD ${name} (its section)`, real, `REAL ${id} · ${state.id}`));
        log(`  ${id}: ${state.id} (a section)`);
      }
      for (const id of byState.get(state.id) ?? []) {
        writeFileSync(join(out, `${id}.real.png`), real);
        // A stand-in board of the room: its screen is set beside its before-capture, not the board.
        const before = STAND_IN_BOARDS.includes(id) ? beforeRef(state) : null;
        const file = before ? beforeFile(before) : boardFile(refDir, id);
        const left = file ? readFileSync(file) : null;
        const name = file ? file.slice(file.lastIndexOf('/') + 1) : `${id} (not found in ${before ? BEFORE_DIR : refDir})`;
        const label = before ? `BEFORE ${name} (${id} is a stand-in)` : `BOARD ${name}`;
        writeFileSync(join(out, `${id}.pair.png`), await pair(browser, left, label, real, `REAL ${id} · ${state.id}`));
        log(`  ${id}: ${state.id}${before ? ` beside ${before}` : ''}`);
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

/** Each state beside its before-capture (live-xx, plus-xx): the LIVE screens keep their look (fidelity rule 6). */
async function captureLive(ids: string[], out: string): Promise<void> {
  const dir = join(out, 'live');
  mkdirSync(dir, { recursive: true });
  const states = ids.length ? ids.map(stateById) : UI_STATES.filter((s) => beforeRef(s) !== null);
  for (const s of states) if (!beforeRef(s)) throw new Error(`${s.id} names no before-capture (live-xx, plus-xx)`);
  const failures: string[] = [];
  await eachState(states, async (state, { stage, demo, browser }) => {
    try {
      const real = await capture(browser, stage, demo, state);
      writeFileSync(join(dir, `${state.id}.real.png`), real);
      const ref = beforeRef(state)!;
      const file = beforeFile(ref);
      const label = file ? file.slice(file.lastIndexOf('/') + 1) : `${ref} (not found in ${BEFORE_DIR})`;
      writeFileSync(join(dir, `${state.id}.pair.png`), await pair(browser, file ? readFileSync(file) : null, `BEFORE ${label}`, real, `REAL ${state.id}`));
      log(`  ${state.id} beside ${ref}`);
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
        writeFileSync(join(dir, `${state.id}.png`), await shoot(opened.page, state));
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

// ── The board ──────────────────────────────────────────────────────────────

/** The board `id`'s title, as the canvas wrote it (`C1 NOW: a LIVE RELEASE leads, a draw under it`), without its C-id. */
function boardTitle(refDir: string, id: string): string {
  const preview = join(refDir, '..', 'preview');
  const file = existsSync(preview) ? readdirSync(preview).find((n) => n.startsWith(`${id}-`) && n.endsWith('.html')) : undefined;
  const title = file ? /<title>([^<]*)<\/title>/.exec(readFileSync(join(preview, file), 'utf8'))?.[1] : undefined;
  return title ? decodeEntities(title).replace(new RegExp(`^${id}\\s+`), '') : id;
}

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27|rsquo|lsquo|hellip|middot|times|rsaquo);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", rsquo: '’', lsquo: '‘', hellip: '…', middot: '·', times: '×', rsaquo: '›' })[e] ?? _);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The stress report of --stress (<out>/stress/overflow.txt): what overflows in each state, by its id. */
function stressReport(dir: string): Map<string, string> {
  const file = join(dir, 'overflow.txt');
  const report = new Map<string, string>();
  if (!existsSync(file)) return report;
  let current: string | null = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([a-z0-9-]+): ?(.*)$/.exec(line);
    if (m) {
      current = m[1]!;
      report.set(current, m[2]!);
    } else if (current && line.trim()) report.set(current, `${report.get(current)}\n${line.trim()}`.trim());
  }
  return report;
}

/** <out>/board.html: every pair captured in `out`, in the boards' order, then the stress cases and the LIVE screens. */
function writeBoard(out: string, refDir: string): void {
  const ids = Object.keys(BOARD_STATES);
  const missing: string[] = [];
  const figure = (file: string, caption: string, alt: string): string => {
    if (!existsSync(join(out, file))) {
      missing.push(file);
      return `<figure class="missing"><figcaption>${escapeHtml(caption)}</figcaption><p>NOT CAPTURED: ${escapeHtml(file)}</p></figure>`;
    }
    return `<figure><figcaption>${escapeHtml(caption)}</figcaption><a href="${encodeURI(file)}"><img src="${encodeURI(file)}" alt="${escapeHtml(alt)}" loading="lazy"></a></figure>`;
  };
  const boards = ids.map((id) => {
    const title = boardTitle(refDir, id);
    const state = stateById(BOARD_STATES[id]!);
    const stand = STAND_IN_BOARDS.includes(id) ? ` · a stand-in of the room: beside its before-capture (${beforeRef(state) ?? 'none'}), fidelity rule 6` : '';
    const sections = (BOARD_SECTIONS[id] ?? []).map((s) => figure(`${id}.${s}.pair.png`, `${id} · ${s} · ${stateById(s).title} (its section of the board)`, `${id}, ${s}: the board at the left, the real screen at the right`));
    return `<section id="${id}"><h2><span class="id">${id}</span> ${escapeHtml(title)}</h2><p class="meta">Real state: ${escapeHtml(state.id)} · ${escapeHtml(state.title)}${escapeHtml(stand)}</p>${figure(`${id}.pair.png`, `${id} · the board at the left, the real screen at the right`, `${id}, ${title}: the board at the left, the real screen at the right`)}${sections.join('')}</section>`;
  });
  const stressDir = join(out, 'stress');
  const report = stressReport(stressDir);
  const stress = UI_STATES.filter((s) => s.stress).map((s) => {
    const found = report.get(s.id);
    const line = found === undefined ? 'not measured' : found;
    return `<section class="half" id="stress-${s.id}"><h3>${escapeHtml(s.id)}</h3><p class="meta">${escapeHtml(s.title)}</p><p class="${found === 'nothing overflows' ? 'ok' : 'warn'}">${escapeHtml(line)}</p>${figure(`stress/${s.id}.png`, s.id, `${s.title}, an extreme case`)}</section>`;
  });
  const live = UI_STATES.filter((s) => beforeRef(s) !== null).map(
    (s) => `<section id="live-${s.id}"><h3>${escapeHtml(s.id)} <span class="meta">beside ${escapeHtml(beforeRef(s)!)}</span></h3><p class="meta">${escapeHtml(s.title)}</p>${figure(`live/${s.id}.pair.png`, `${s.id} · before NOCTURNE at the left, now at the right`, `${s.title}: before NOCTURNE at the left, now at the right`)}</section>`,
  );
  const toc = ids.map((id) => `<a href="#${id}">${id}</a>`).join(' ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NOCTURNE board</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#1d1d1d;color:#f6f2ea;font:15px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}
header,main{max-width:1700px;margin:0 auto;padding:0 24px}
header{padding-top:32px;padding-bottom:16px;border-bottom:1px solid #444}
h1{font-size:22px;letter-spacing:.08em;margin:0 0 8px}
h2{font-size:18px;letter-spacing:.04em;margin:0 0 4px}
h3{font-size:15px;margin:0 0 4px}
.id{display:inline-block;min-width:48px;color:#a7a29a}
.meta{color:#a7a29a;font-size:13px;margin:0 0 12px}
nav{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px}
nav a,a{color:#f6f2ea}
section{padding:36px 0;border-bottom:1px solid #333}
figure{margin:16px 0 0}
figcaption{font-size:12px;color:#a7a29a;margin-bottom:6px}
img{display:block;max-width:100%;height:auto;background:#2b2b2b}
.missing p,.warn{color:#e0b36a;white-space:pre-wrap;font-size:13px}
.ok{color:#9fc79f;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:0 32px}
.half img{max-width:420px}
</style></head><body>
<header><h1>NOCTURNE · the 43 boards beside the real screens</h1>
<p class="meta">At the left of each pair, the board the owner validated (nocturne-ref/shots, 390 px at 2×); at the right, the real screen at the same size, on the NOCTURNE demo (scripts/parity.ts). Live data differs by design: the time, ids and references, a countdown's digits, each piece's own GENOME glyphs. C21 and C26 are stand-ins of the room: each is set beside its capture from before NOCTURNE. Then the extreme cases (fidelity rule 5) and the LIVE screens before and after (fidelity rule 6).</p>
<nav>${toc} <a href="#stress">STRESS</a> <a href="#live">LIVE</a></nav>
${missing.length ? `<p class="warn">Not captured (${missing.length}): ${escapeHtml(missing.join(', '))}</p>` : ''}</header>
<main>
${boards.join('\n')}
<section id="stress"><h2>The extreme cases (fidelity rule 5)</h2><p class="meta">Each captured whole, with what overflows its column or its box (nothing, when all holds).</p><div class="grid">${stress.join('\n')}</div></section>
<section id="live"><h2>The LIVE screens, before NOCTURNE and now (fidelity rule 6)</h2><p class="meta">At the left the capture taken before the change (docs/assets/ui/nocturne-before), at the right the screen now: inside the room, no rail and no ring; the pages that end a visit gain the header, the rail and the ring.</p>${live.join('\n')}</section>
</main></body></html>
`;
  writeFileSync(join(out, 'board.html'), html);
  log(`${ids.length} boards, ${stress.length} stress cases, ${live.length} LIVE pairs in ${join(out, 'board.html')}`);
  if (missing.length) log(`not captured (${missing.length}):\n  ${missing.join('\n  ')}`);
}

// ── The content baseline ───────────────────────────────────────────────────

/**
 * Record the baseline of `ids` (every state when empty) into `file`. Recording some states only, every other entry keeps
 * its values (its title and refs follow the state's definition); a state no longer defined is dropped.
 */
async function recordBaseline(file: string, ids: string[]): Promise<void> {
  const previous: Record<string, BaselineState> = ids.length && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Baseline).states : {};
  const states: Record<string, BaselineState> = {};
  for (const s of UI_STATES) {
    const kept = previous[s.id];
    if (kept && !ids.includes(s.id)) states[s.id] = { ...kept, title: s.title, refs: s.refs };
  }
  await eachState(ids.length ? ids.map(stateById) : UI_STATES, async (state, { stage, demo, browser }) => {
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
  let mode: 'boards' | 'states' | 'stress' | 'baseline' | 'live' | 'board' = 'boards';
  let list: string[] = [];
  let baselineFile = BASELINE_FILE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') out = resolve(argv[++i] ?? '');
    else if (a === '--ref') ref = resolve(argv[++i] ?? '');
    else if (a === '--stress') mode = 'stress';
    else if (a === '--baseline') mode = 'baseline';
    else if (a === '--board') mode = 'board';
    else if (a === '--live') {
      mode = 'live';
      if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) list = argv[++i]!.split(',').filter(Boolean);
    }
    else if (a === '--baseline-file') baselineFile = resolve(argv[++i] ?? '');
    else if (a === '--states') {
      if (mode !== 'baseline') mode = 'states';
      list = (argv[++i] ?? '').split(',').filter(Boolean);
    } else if (/^C\d+(,C\d+)*$/.test(a)) list.push(...a.split(','));
    else throw new Error(`unknown argument ${a} (C1,C2,…; --states a,b; --live [a,b]; --stress; --board; --baseline [--states a,b]; --out DIR; --ref DIR)`);
  }
  if (mode === 'board') writeBoard(out, ref);
  else if (mode === 'boards') await captureBoards(list.length ? list : Object.keys(BOARD_STATES), out, ref);
  else if (mode === 'live') await captureLive(list, out);
  else if (mode === 'states') await captureStates(list.flatMap((x) => (x === 'all' ? UI_STATES.map((s) => s.id) : UI_STATES.some((s) => s.variant === x) ? UI_STATES.filter((s) => s.variant === x).map((s) => s.id) : [x])), out);
  else if (mode === 'stress') await captureStress(out);
  else await recordBaseline(baselineFile, list);
  if (mode !== 'baseline') log(`out: ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    process.stderr.write(`parity: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  });
}
