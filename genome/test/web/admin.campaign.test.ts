/**
 * The CAMPAIGN tab of a release in the console (plan MACRO M1 §2.2 and §2.4, scope C2 and C3; src/web/admin/model/
 * campaign.ts and ui/countdown-card.ts): the tabs from the address, the Links rows, MAKE THE LINKS offered or why not,
 * the readout's rows and returns, the times in Paris, when FULL can be chosen, the image's words for TEASER and FULL
 * (never a name nor a photograph on TEASER), and its drawing on a recording 2D context (pure geometry, as
 * verify.story-card.test.ts reads the collector's card). The canvas itself is drawn in Chromium by admin.links.e2e.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONOGRAM_PATHS } from '../../src/core/render/monogram.js';
import {
  CAMPAIGN_COPY as K,
  campaignLinkLines,
  countdownCardModel,
  countdownName,
  countdownWords,
  fullChoice,
  livePublicAt,
  makeLinksState,
  parisMoment,
  readoutNote,
  readoutReturn,
  readoutRows,
  releaseTab,
  releaseTabHref,
  type CountdownCardModel,
  type CountdownRelease,
} from '../../src/web/admin/model/campaign.js';
import type { CampaignChannel, LinkView, ReleaseCampaign } from '../../src/web/admin/types.js';
import { COUNTDOWN_CARD, drawCountdownCard, type CountdownContext, type CountdownPhoto } from '../../src/web/admin/ui/countdown-card.js';

const PHOTO = `/api/v1/media/${'a'.repeat(64)}`;
const FONTS = { display: '"Gravesend Sans", "Helvetica Neue", sans-serif', reading: '"Helvetica Neue", sans-serif' };
const NOW = new Date('2026-10-21T08:00:00.000Z');

/** A 2D context that records what is drawn (as verify.story-card.test.ts's). */
class Recorder implements CountdownContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  transform: number[] = [1, 0, 0, 1, 0, 0];
  rects: { x: number; y: number; w: number; h: number; fill: unknown }[] = [];
  strokes: { x: number; y: number; w: number; h: number; stroke: string; width: number }[] = [];
  texts: { text: string; x: number; y: number; font: string; fill: string }[] = [];
  paths: { transform: number[]; alpha: number; fill: string }[] = [];
  images: number[][] = [];
  gradients: { box: number[]; stops: [number, string][] }[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: this.fillStyle });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokes.push({ x, y, w, h, stroke: String(this.strokeStyle), width: this.lineWidth });
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, font: this.font, fill: String(this.fillStyle) });
  }
  measureText(text: string): { width: number } {
    const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.7 };
  }
  setTransform(...m: number[]): void {
    this.transform = m;
  }
  fill(): void {
    this.paths.push({ transform: this.transform, alpha: this.globalAlpha, fill: String(this.fillStyle) });
  }
  drawImage(_img: CountdownPhoto, ...box: number[]): void {
    this.images.push(box);
  }
  createLinearGradient(...box: number[]): CanvasGradient {
    const g = { box, stops: [] as [number, string][], addColorStop: (at: number, c: string) => g.stops.push([at, c]) };
    this.gradients.push(g);
    return g as unknown as CanvasGradient;
  }
  /** The letters drawn, joined into their lines (one line per y); a gap of two advances is a space. */
  lines(): { text: string; y: number; size: number; fill: string; left: number; right: number }[] {
    const out: { text: string; y: number; size: number; fill: string; left: number; right: number }[] = [];
    for (const t of this.texts) {
      const size = Number(/(\d+)px/.exec(t.font)![1]);
      const line = out.find((l) => l.y === t.y);
      if (!line) out.push({ text: t.text, y: t.y, size, fill: t.fill, left: t.x, right: t.x + size * 0.7 });
      else {
        const gap = t.x - (line.right - size * 0.7);
        line.text += gap > size * 1.6 && gap > size * 0.7 * 2 ? ` ${t.text}` : t.text;
        line.right = t.x + size * 0.7;
      }
    }
    return out;
  }
}

const photo = (width: number, height: number): CountdownPhoto => ({ width, height }) as unknown as CountdownPhoto;

function link(over: Partial<LinkView> = {}): LinkView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'release-5-nov-instagram',
    name: 'The November release · Instagram',
    channel: { id: 'c-ig', name: 'Instagram' },
    destination: 'RELEASE',
    dropId: 'd1',
    modelId: null,
    cost: null,
    note: null,
    address: 'https://verify.theorbes.com/go/release-5-nov-instagram',
    directAddress: 'https://verify.theorbes.com/verify/releases/d1?o=release-5-nov-instagram',
    archivedAt: null,
    createdBy: { id: 'a', email: 'console@orbes.test' },
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...over,
  };
}

const RELEASE: CountdownRelease = {
  mode: 'LIVE',
  // 5 November 2026, 20:00 in Paris (CET, UTC+1).
  opensAt: '2026-11-05T19:00:00.000Z',
  published: true,
  cancelled: false,
  publicAt: '2026-10-20T08:00:00.000Z',
  model: { name: 'Monolithe', variant: 'Blue', photo: PHOTO },
};

function campaign(over: Partial<ReleaseCampaign> = {}): ReleaseCampaign {
  return {
    release: { id: 'd1', mode: 'LIVE', title: 'The November release', opensAt: RELEASE.opensAt, closesAt: '2026-11-05T21:00:00.000Z', published: true, cancelled: false },
    channels: [],
    missing: [],
    readout: { stage: 'UPCOMING', opensAt: RELEASE.opensAt, currency: 'EUR', links: [], other: { entries: 0, buyers: 0, revenueMinor: 0 }, total: { entries: 0, buyers: 0, revenueMinor: 0 } },
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(readonly d: string) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('the CAMPAIGN tab: tabs, links and readout (C2)', () => {
  it('opens CAMPAIGN only when the address asks for it, on the draw\'s and the LIVE RELEASE\'s pages', () => {
    expect(releaseTab({})).toBe('release');
    expect(releaseTab({ tab: 'campaign' })).toBe('campaign');
    expect(releaseTab({ tab: 'CAMPAIGN' })).toBe('release');
    expect(releaseTab({ tab: 'drops' })).toBe('release');
    expect(releaseTabHref('drop', 'd1', 'campaign')).toBe('#/club/drops/d1?tab=campaign');
    expect(releaseTabHref('liveRelease', 'd1', 'campaign')).toBe('#/club/live/d1?tab=campaign');
    expect(releaseTabHref('drop', 'd1', 'release')).toBe('#/club/drops/d1');
  });

  it('lists each channel in its order: its active links first, its archived ones after, or one « No link yet » row', () => {
    const active = link();
    const old = link({ id: '22222222-2222-4222-8222-222222222222', code: 'old-ig', archivedAt: '2026-10-19T08:00:00.000Z' });
    const tiktokOld = link({ id: '33333333-3333-4333-8333-333333333333', channel: { id: 'c-tt', name: 'TikTok' }, archivedAt: '2026-10-19T08:00:00.000Z' });
    const channels: CampaignChannel[] = [
      { id: 'c-ig', name: 'Instagram', position: 1, links: [old, active], covered: true },
      { id: 'c-tt', name: 'TikTok', position: 2, links: [tiktokOld], covered: false },
      { id: 'c-nl', name: 'Newsletter', position: 3, links: [], covered: false },
    ];
    expect(campaignLinkLines(channels).map((l) => [l.channel, l.link?.id ?? null, l.uncovered])).toEqual([
      ['Instagram', active.id, false],
      [null, old.id, false],
      ['TikTok', tiktokOld.id, true],
      ['Newsletter', null, false],
    ]);
  });

  it('offers MAKE THE LINKS to an OPERATOR on a published release while a channel lacks its link; says why not otherwise', () => {
    const ch: CampaignChannel[] = [{ id: 'c-ig', name: 'Instagram', position: 1, links: [], covered: false }];
    const open = campaign({ channels: ch, missing: [{ id: 'c-ig', name: 'Instagram' }] });
    expect(makeLinksState(open, true)).toEqual({ offer: true, line: null });
    expect(makeLinksState(open, false)).toEqual({ offer: false, line: null });
    expect(makeLinksState({ ...open, release: { ...open.release, published: false } }, true)).toEqual({ offer: false, line: K.draft });
    expect(makeLinksState({ ...open, release: { ...open.release, published: false } }, false)).toEqual({ offer: false, line: null });
    expect(makeLinksState({ ...open, release: { ...open.release, cancelled: true } }, true)).toEqual({ offer: false, line: K.cancelled });
    expect(makeLinksState({ ...open, missing: [] }, true)).toEqual({ offer: false, line: K.allCovered });
    expect(makeLinksState({ ...open, channels: [], missing: [] }, true)).toEqual({ offer: false, line: K.noChannel });
  });

  it('shows no figure before the first entry; then each link, OTHER SOURCES and the TOTAL, SO FAR then FINAL', () => {
    expect(readoutRows(campaign())).toEqual([]);
    expect(readoutNote('UPCOMING')).toBe('Last link · counted collectors only');
    expect(K.upcoming).toBe('Figures appear once entries open.');
    const li = link({ cost: { minor: 10_000, currency: 'EUR' } });
    const lt = link({ id: '44444444-4444-4444-8444-444444444444', name: 'The November release · TikTok', channel: { id: 'c-tt', name: 'TikTok' }, cost: { minor: 5_000, currency: 'GBP' } });
    const la = link({ id: '55555555-5555-4555-8555-555555555555', name: 'Old', archivedAt: '2026-10-19T08:00:00.000Z' });
    const c = campaign({
      readout: {
        stage: 'SO_FAR',
        opensAt: RELEASE.opensAt,
        currency: 'EUR',
        links: [
          { link: li, figures: { entries: 1, buyers: 2, revenueMinor: 48_000 }, returns: { revenueMinor: 48_000, costMinor: 10_000, currency: 'EUR', ratio: 4.8 } },
          { link: lt, figures: { entries: 1, buyers: 0, revenueMinor: 20_000 }, returns: null },
          { link: la, figures: { entries: 1_250, buyers: 0, revenueMinor: 0 }, returns: null },
        ],
        other: { entries: 2, buyers: 1, revenueMinor: 15_000 },
        total: { entries: 1_254, buyers: 3, revenueMinor: 83_000 },
      },
    });
    const rows = readoutRows(c);
    const plain = (x: string | null) => (typeof x === 'string' ? x.replace(/\s/g, ' ') : x);
    expect(rows.map((r) => [r.kind, r.name, r.sub, r.entries, r.buyers, r.revenue, r.cost, r.returns].map(plain))).toEqual([
      ['link', li.name, 'Instagram', '1', '2', '€ 480', '€ 100', '×4.8'],
      ['link', lt.name, 'TikTok', '1', '0', '€ 200', '£ 50', 'Not in EUR'],
      ['link', 'Old', 'Instagram · ARCHIVED', '1 250', '0', '€ 0', '—', '—'],
      ['other', 'OTHER SOURCES', K.otherSub, '2', '1', '€ 150', '', ''],
      ['total', 'TOTAL', null, '1 254', '3', '€ 830', '', ''],
    ].map((r) => r.map((x) => (typeof x === 'string' ? x.replace(/ /g, ' ') : x))));
    expect(rows[0]!.returnsSub?.replace(/ | /g, ' ')).toBe('Revenue € 480 for € 100');
    expect(readoutNote('SO_FAR')).toBe('So far · Last link · counted collectors only');
    expect(readoutNote('FINAL')).toBe('Final · Last link · counted collectors only');
  });

  it('gives a return only for a cost in the readout\'s currency, with no ratio for a cost of 0', () => {
    expect(readoutReturn(link(), null, 'EUR')).toEqual({ text: '—', sub: null });
    expect(readoutReturn(link({ cost: { minor: 0, currency: 'EUR' } }), { revenueMinor: 0, costMinor: 0, currency: 'EUR', ratio: null }, 'EUR').text).toBe('—');
    expect(readoutReturn(link({ cost: { minor: 100, currency: 'GBP' } }), null, 'EUR')).toEqual({ text: 'Not in EUR', sub: null });
  });
});

describe('the CAMPAIGN tab: the countdown image\'s words (C3)', () => {
  it('reads every time in Paris: the day and time, summer or winter, across midnight; the file\'s day', () => {
    expect(parisMoment('2026-11-05T19:00:00.000Z')).toEqual({ date: '5 NOVEMBER 2026', time: '20:00', day: '2026-11-05' });
    expect(parisMoment('2026-07-01T18:30:00.000Z')).toEqual({ date: '1 JULY 2026', time: '20:30', day: '2026-07-01' });
    expect(parisMoment('2026-11-10T23:30:00.000Z')).toEqual({ date: '11 NOVEMBER 2026', time: '00:30', day: '2026-11-11' });
    for (const bad of [null, undefined, '', 'tomorrow']) expect(parisMoment(bad)).toBeNull();
  });

  it('opens FULL only once the release\'s name and photograph are public, with the model\'s photograph, never on a cancelled release', () => {
    expect(fullChoice(RELEASE, NOW)).toEqual({ available: true, line: K.fullLine });
    expect(fullChoice({ ...RELEASE, published: false, publicAt: null }, NOW)).toEqual({ available: false, line: K.fullNotPublished });
    expect(fullChoice({ ...RELEASE, cancelled: true }, NOW)).toEqual({ available: false, line: K.fullCancelled });
    expect(fullChoice({ ...RELEASE, publicAt: '2026-10-28T19:00:00.000Z' }, NOW)).toEqual({ available: false, line: K.fullLater('28 OCTOBER 2026 · 20:00 Paris') });
    expect(fullChoice({ ...RELEASE, model: { ...RELEASE.model, photo: null } }, NOW)).toEqual({ available: false, line: K.fullNoPhoto });
    expect(fullChoice({ ...RELEASE, model: { ...RELEASE.model, photo: 'https://elsewhere.test/a.jpg' } }, NOW).available).toBe(false);
    // A LIVE RELEASE's name and photograph are both public at the later of its two stages.
    expect(livePublicAt({ nameAt: '2026-10-25T08:00:00.000Z', photoAt: '2026-10-28T08:00:00.000Z' })).toBe('2026-10-28T08:00:00.000Z');
    expect(livePublicAt({ nameAt: '2026-10-29T08:00:00.000Z', photoAt: '2026-10-28T08:00:00.000Z' })).toBe('2026-10-29T08:00:00.000Z');
    expect(livePublicAt(null)).toBeNull();
  });

  it('TEASER (the default): the date and time in Paris and « A RELEASE », no photograph, no name; FULL: the photograph, the name and the date', () => {
    const teaser = countdownCardModel(RELEASE, 'teaser', NOW)!;
    expect(teaser).toEqual({ kind: 'teaser', label: 'A RELEASE', title: ['5 NOVEMBER 2026'], when: '20:00 PARIS', photo: null, filename: 'orbes-2026-11-05-teaser.png' });
    expect(countdownWords(teaser)).toEqual(['ORBES', 'A RELEASE', '5 NOVEMBER 2026', '20:00 PARIS', 'THEORBES.COM']);
    expect(JSON.stringify(teaser)).not.toMatch(/MONOLITHE|BLUE|media|LIVE|DRAW/i);
    const full = countdownCardModel(RELEASE, 'full', NOW)!;
    expect(full).toEqual({ kind: 'full', label: 'LIVE RELEASE', title: ['MONOLITHE', 'IN BLUE'], when: '5 NOVEMBER 2026 · 20:00 PARIS', photo: PHOTO, filename: 'orbes-2026-11-05-full.png' });
    expect(countdownCardModel({ ...RELEASE, mode: 'DRAW', model: { ...RELEASE.model, variant: null } }, 'full', NOW)).toMatchObject({ label: 'DRAW', title: ['MONOLITHE'] });
    // FULL asked while it cannot be chosen draws the TEASER.
    expect(countdownCardModel({ ...RELEASE, publicAt: '2026-10-28T19:00:00.000Z' }, 'full', NOW)).toEqual(teaser);
    expect(countdownCardModel({ ...RELEASE, opensAt: 'soon' }, 'teaser', NOW)).toBeNull();
    expect(countdownName('  Halo ', ' gold  rose ')).toEqual(['HALO', 'IN GOLD ROSE']);
  });
});

describe('the CAMPAIGN tab: drawing the countdown image (C3)', () => {
  const TEASER: CountdownCardModel = { kind: 'teaser', label: 'A RELEASE', title: ['5 NOVEMBER 2026'], when: '20:00 PARIS', photo: null, filename: 'orbes-2026-11-05-teaser.png' };
  const FULL: CountdownCardModel = { kind: 'full', label: 'LIVE RELEASE', title: ['MONOLITHE', 'IN BLUE'], when: '5 NOVEMBER 2026 · 20:00 PARIS', photo: PHOTO, filename: 'orbes-2026-11-05-full.png' };

  it('is 1080 × 1920 (9:16) on the vault\'s ground, in the story card\'s values', () => {
    expect(COUNTDOWN_CARD).toMatchObject({ width: 1080, height: 1920, ground: '#0a0a0a', ivory: '#f6f2ea', ash: '#a7a29a', hairline: 'rgba(246,242,234,0.62)' });
    expect(COUNTDOWN_CARD.width / COUNTDOWN_CARD.height).toBeCloseTo(9 / 16);
    expect(COUNTDOWN_CARD.wordmark).toEqual({ size: 44, tracking: 0.62, top: 132 });
    expect(COUNTDOWN_CARD.label).toEqual({ size: 30, tracking: 0.46, padY: 20, padX: 26, border: 2 });
    expect(COUNTDOWN_CARD.site).toEqual({ gap: 26, size: 22, tracking: 0.5, bottom: 1810 });
  });

  it('TEASER: the ground, ORBES, the monogram large and centred, A RELEASE in its hairline box, the date, the time, THEORBES.COM; no photograph', () => {
    const ctx = new Recorder();
    drawCountdownCard(ctx, TEASER, null, FONTS);
    expect(ctx.rects[0]).toEqual({ x: 0, y: 0, w: 1080, h: 1920, fill: '#0a0a0a' });
    expect(ctx.images).toEqual([]);
    expect(ctx.gradients).toEqual([]);
    const lines = ctx.lines();
    expect(lines.map((l) => l.text)).toEqual(['ORBES', 'A RELEASE', '5 NOVEMBER 2026', '20:00 PARIS', 'THEORBES.COM']);
    expect(lines.map((l) => l.fill)).toEqual(['#f6f2ea', '#f6f2ea', '#f6f2ea', '#a7a29a', '#a7a29a']);
    const ys = lines.map((l) => l.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    // The monogram: its five outlines, 360 × 360 at y 560, centred, ivory at 0.9.
    expect(ctx.paths).toHaveLength(MONOGRAM_PATHS.length);
    for (const p of ctx.paths) expect(p).toEqual({ transform: [360 / 500, 0, 0, 360 / 500, (1080 - 360) / 2, 560], alpha: 0.9, fill: '#f6f2ea' });
    const box = 2 + 20 + 30 * 1.2 + 20 + 2;
    expect(ctx.strokes).toHaveLength(1);
    expect(ctx.strokes[0]).toMatchObject({ y: 1040 + 1, h: box - 2, stroke: 'rgba(246,242,234,0.62)', width: 2 });
    expect(ctx.strokes[0]!.x + ctx.strokes[0]!.w / 2).toBeCloseTo(540);
    expect(ys[1]).toBeCloseTo(1040 + box / 2);
    // The block sits under the monogram and around the image's middle; the site ends at y 1810.
    expect(1040).toBeGreaterThan(560 + 360);
    expect(ys[4]).toBeCloseTo(1810 - (22 * 1.2) / 2);
    // Every line centred, inside the image.
    for (const l of lines) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.right).toBeLessThanOrEqual(1080);
    }
    // The date's figures in the reading face, its words in Gravesend.
    const date = ctx.texts.filter((t) => t.y === ys[2]);
    expect(date.find((t) => t.text === '5')!.font).toMatch(/^400 \d+px "Helvetica Neue"/);
    expect(date.find((t) => t.text === 'N')!.font).toMatch(/^500 \d+px "Gravesend Sans"/);
  });

  it('TEASER fits a wide date within 960 px', () => {
    const ctx = new Recorder();
    drawCountdownCard(ctx, { ...TEASER, title: ['30 SEPTEMBER 2026'] }, null, FONTS);
    const date = ctx.lines().find((l) => l.text === '30 SEPTEMBER 2026')!;
    expect(date.right - date.left).toBeLessThanOrEqual(960 + 1);
  });

  it('FULL: the photograph in its 1080 window at y 250 and its fade, the kind in its box, the name, the date, the small monogram over THEORBES.COM', () => {
    const ctx = new Recorder();
    drawCountdownCard(ctx, FULL, photo(800, 1200), FONTS);
    expect(ctx.images).toEqual([[0, 200, 800, 800, 0, 250, 1080, 1080]]);
    expect(ctx.gradients.map((g) => g.box)).toEqual([[0, 250, 0, 1330]]);
    const lines = ctx.lines();
    expect(lines.map((l) => l.text)).toEqual(['ORBES', 'LIVE RELEASE', 'MONOLITHE', 'IN BLUE', '5 NOVEMBER 2026 · 20:00 PARIS', 'THEORBES.COM']);
    expect(lines.map((l) => l.size)).toEqual([44, 30, 88, 88, 26, 22]);
    const box = 2 + 20 + 30 * 1.2 + 20 + 2;
    expect(lines[1]!.y).toBeCloseTo(1190 + box / 2);
    expect(lines[2]!.y).toBeCloseTo(1190 + box + 56 + (88 * 1.12) / 2);
    expect(ctx.paths).toHaveLength(MONOGRAM_PATHS.length);
    const siteTop = 1810 - 22 * 1.2;
    for (const p of ctx.paths) expect(p.transform).toEqual([56 / 500, 0, 0, 56 / 500, (1080 - 56) / 2, siteTop - 26 - 56]);
    // A wider photograph: the full width, centred in its window.
    const wide = new Recorder();
    drawCountdownCard(wide, FULL, photo(1600, 900), FONTS);
    expect(wide.images).toEqual([[0, 0, 1600, 900, 0, 250 + (1080 - 607.5) / 2, 1080, 607.5]]);
  });

  it('FULL shrinks a long name to 960 px, then breaks it between its words', () => {
    const ctx = new Recorder();
    drawCountdownCard(ctx, { ...FULL, title: ['THE VERY LONG NAME OF A MODEL FOR A RELEASE'] }, photo(1000, 1000), FONTS);
    const title = ctx.lines().filter((l) => l.fill === '#f6f2ea' && l.size <= 72 && l.size >= 56);
    expect(title.length).toBeGreaterThan(1);
    for (const l of title) expect(l.right - l.left).toBeLessThanOrEqual(960 + 1);
  });
});
