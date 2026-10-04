/**
 * The intelligence of a LIVE RELEASE on its console page (views/live.ts; model/live-intelligence.ts; server:
 * services/live-insights.ts): the readings of its stage, each a panel with its figures and, under them, HOW IT IS READ,
 * the rule and the figures it used, as the server wrote them. The live alerts and the live sell-out forecast are drawn
 * on the live board (`liveSignals`), which its stream keeps current; the other readings are read with the page, and
 * read again with it (READ AGAIN, or after an action). A reading that could not be read says so, the page stands.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import {
  clockText,
  durationText,
  funnelBars,
  LIVE_ALERT_LABELS,
  LIVE_BOT_SIGN_LABELS,
  LIVE_COMPARISON_COLUMNS,
  liveReadings,
  pressureText,
  rangeText,
  sellOutText,
  shareText,
  type LiveReading,
} from '../model/live-intelligence.js';
import { formatMoney, liveEntryActions, tierLabel } from '../model/live.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type {
  LiveAudienceForecast,
  LiveBoard,
  LiveBotRadar,
  LiveCollectorInsights,
  LiveDemandRadar,
  LiveRelease,
  LiveReleaseComparison,
  LiveReleasePlan,
  LiveReleaseReport,
} from '../types.js';
import { barList, button, defList, kpi, section, statusMark, table } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The readings of a release, as read with its page: null for one not shown at its stage, 'failed' for one not read. */
export interface LiveIntelligence {
  plan: LiveReleasePlan | null | 'failed';
  forecast: LiveAudienceForecast | null | 'failed';
  radar: LiveDemandRadar | null | 'failed';
  bots: LiveBotRadar | null | 'failed';
  report: LiveReleaseReport | null | 'failed';
  collectors: LiveCollectorInsights | null | 'failed';
  comparison: LiveReleaseComparison | null | 'failed';
}

/** Read the readings of the release's stage at once; one that fails leaves the others. */
export async function loadLiveIntelligence(api: ViewContext['api'], r: LiveRelease): Promise<LiveIntelligence> {
  const shown = new Set(liveReadings(r));
  const read = <T>(reading: LiveReading, fn: () => Promise<T>): Promise<T | null | 'failed'> => (shown.has(reading) ? fn().catch(() => 'failed' as const) : Promise.resolve(null));
  const [plan, forecast, radar, bots, report, collectors, comparison] = await Promise.all([
    read('plan', () => api.liveReleasePlan(r.id)),
    read('forecast', () => api.liveAudienceForecast(r.id)),
    read('radar', () => api.liveDemandRadar(r.id)),
    read('bots', () => api.liveBotRadar(r.id)),
    read('report', () => api.liveReport(r.id)),
    read('collectors', () => api.liveCollectors(r.id)),
    read('comparison', () => api.liveComparison(r.id)),
  ]);
  return { plan, forecast, radar, bots, report, collectors, comparison };
}

/** HOW IT IS READ: the rule and its figures, as the server wrote them. */
export function reasoning(lines: readonly string[], testId: string): HTMLElement {
  return h(
    'div',
    { class: 'live__why', data: { testid: testId } },
    h('p', { class: 'live__why-title' }, 'How it is read'),
    h('ul', { class: 'live__why-lines' }, ...lines.map((l) => h('li', null, l))),
  );
}

const figures = (...items: [label: string, value: string, note: string, testId: string][]) =>
  h(
    'div',
    { class: ['kpis', 'live__intel-figures'] },
    ...items.map(([label, value, note, testId]) => {
      const el = kpi(label, value, note);
      el.setAttribute('data-testid', testId);
      return el;
    }),
  );

const subtitle = (text: string) => h('h3', { class: 'panel__subtitle' }, text);
const tierName = (t: number) => tierLabel(t);
const failed = (title: string, id: string) => section(title, h('p', { class: 'notice' }, 'This reading could not be read: read the page again.'), { id });

/** The live alerts and the live sell-out forecast, on the live board (drawn again with each board). */
export function liveSignals(b: LiveBoard): { alerts: HTMLElement | null; sellOut: HTMLElement | null } {
  const alerts = b.alerts.length
    ? h(
        'div',
        { class: 'live__alerts', data: { testid: 'live-alerts' } },
        ...b.alerts.map((a) =>
          h(
            'div',
            { class: 'live__alert', data: { testid: `live-alert-${a.kind.toLowerCase()}` } },
            h('p', { class: 'live__alert-head' }, statusMark(LIVE_ALERT_LABELS[a.kind], 'alert'), h('span', { class: 'live__alert-text' }, a.text), h('span', { class: 'cell-sub' }, `Since ${clockText(a.since)}`)),
            reasoning(a.reasoning, 'live-alert-why'),
          ),
        ),
      )
    : null;
  const f = b.sellOut;
  const sellOut = f
    ? h(
        'div',
        { class: 'live__sellout', data: { testid: 'live-sellout' } },
        h('p', { class: 'live__sellout-head' }, h('span', { class: 'live__message-label' }, 'Sell-out forecast'), h('span', { class: 'live__sellout-text', data: { testid: 'live-sellout-text' } }, sellOutText(f))),
        reasoning([...f.reasoning, ...f.sizes.flatMap((s) => s.reasoning.map((l) => `${s.size.label}: ${l}`))], 'live-sellout-why'),
      )
    : null;
  return { alerts, sellOut };
}

/** The sell-out forecast of one size, for the live board's table. */
export function sizeSellOut(b: LiveBoard, sizeId: string): string {
  const s = b.sellOut?.sizes.find((x) => x.size.id === sizeId);
  return s ? sellOutText(s) : '—';
}

/** The panels of the release's readings, in the order its page shows them. */
export function liveIntelligenceSections(ctx: ViewContext, r: LiveRelease, data: LiveIntelligence, board: LiveBoard | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  const role = ctx.session.admin.role;
  const again = (reading: string) => button('Read again', { kind: 'ghost', testId: `live-intel-again-${reading}`, onClick: () => ctx.reload() });

  // ── The release planner ──────────────────────────────────────────────────
  if (data.plan === 'failed') out.push(failed('Release planner', 'live-plan'));
  else if (data.plan) {
    const p = data.plan;
    const stock = r.sizes.reduce((n, s) => n + s.stock, 0);
    const eligible = [3, 2, 1, 0].map((t) => `${tierName(t)} ${formatCount(p.eligibleByTier[t] ?? 0)}`).join(' · ');
    out.push(
      section(
        'Release planner',
        [
          figures(
            ['Suggested', p.quantity === null ? '—' : formatCount(p.quantity), p.quantity === null ? 'NO AUDIENCE TO FORECAST YET' : `FOR ABOUT ${formatCount(p.forecast.expected)} AT THE OPENING`, 'live-plan-quantity'],
            ['Per person', p.demandPerPerson.toFixed(2), p.pastReleases ? `FROM ${formatCount(p.pastReleases)} PAST ${p.pastReleases === 1 ? 'RELEASE' : 'RELEASES'}` : 'ASSUMED', 'live-plan-rate'],
            ['Eligible', formatCount(p.forecast.eligible), 'ACCOUNTS THE RULE LETS IN', 'live-plan-eligible'],
            ['In the settings', formatCount(stock), `${formatCount(r.sizes.length)} ${r.sizes.length === 1 ? 'SIZE' : 'SIZES'}`, 'live-plan-stock'],
          ),
          table(
            [
              { label: 'Size', cell: (s) => h('span', { class: 'live__size' }, s.label), kind: ['nowrap'] },
              { label: 'Stock now', cell: (s) => formatCount(s.stock), kind: ['num'] },
              { label: 'Interest', cell: (s) => formatCount(s.interest), kind: ['num'] },
              { label: 'Collectors', cell: (s) => formatCount(s.collectors), kind: ['num'] },
              { label: 'Suggested', cell: (s) => h('span', { data: { testid: 'live-plan-size' } }, s.suggested === null ? '—' : formatCount(s.suggested)), kind: ['num'] },
            ],
            p.sizes,
            { caption: 'The size mix suggested' },
          ),
          h('p', { class: 'footnote' }, `Eligible by tier: ${eligible}. The collectors: eligible accounts whose latest ${humanize(p.modelType)} is in the size.`),
          p.otherSizes.length ? h('p', { class: 'footnote' }, `Also held, not offered: ${p.otherSizes.map((s) => `${s.label}: ${formatCount(s.collectors)}`).join(' · ')}.`) : null,
          reasoning(p.reasoning, 'live-plan-why'),
        ],
        { id: 'live-plan', note: 'Before the announcement' },
      ),
    );
  }

  // ── The audience forecast ────────────────────────────────────────────────
  if (data.forecast === 'failed') out.push(failed('Audience forecast', 'live-forecast'));
  else if (data.forecast) {
    const f = data.forecast;
    out.push(
      section(
        'Audience forecast',
        [
          figures(
            ['At the opening', f.basis === 'NONE' ? '—' : formatCount(f.expected), f.basis === 'NONE' ? 'NO BASIS YET' : f.low === f.high ? 'EXPECTED' : `BETWEEN ${rangeText(f)}`, 'live-forecast-expected'],
            ['Interest', formatCount(f.interest), 'I’LL BE THERE', 'live-forecast-interest'],
            ['Eligible', formatCount(f.eligible), 'ACCOUNTS THE RULE LETS IN', 'live-forecast-eligible'],
            ['In the room', f.inRoom === null ? '—' : formatCount(f.inRoom), f.inRoom === null ? 'ONCE IT OPENS' : 'NOW', 'live-forecast-room'],
          ),
          h(
            'p',
            { class: 'live__capacity', data: { testid: 'live-forecast-capacity' } },
            f.aboveCapacity ? statusMark('ABOVE THE ROOM’S LIMIT', 'alert') : statusMark('WITHIN THE ROOM’S LIMIT', 'solid'),
            h('span', { class: 'cell-sub' }, `The server holds ${formatCount(f.capacity)} in the room${f.capacityProvisional ? ' (provisional, until the load test measures it)' : ''}.`),
          ),
          reasoning(f.reasoning, 'live-forecast-why'),
        ],
        { id: 'live-forecast', note: 'The room at the opening', tools: r.phase === 'ROOM' ? [again('forecast')] : [] },
      ),
    );
  }

  // ── The demand radar ─────────────────────────────────────────────────────
  if (data.radar === 'failed') out.push(failed('Demand radar', 'live-radar'));
  else if (data.radar) {
    const d = data.radar;
    const suggested = d.sizes.filter((s) => s.addPieces !== null && s.addPieces > 0);
    out.push(
      section(
        'Demand radar',
        [
          figures(
            [d.roomOpen ? 'In the room' : 'Interest', formatCount(d.roomOpen ? d.inRoom : d.interest), d.roomOpen ? 'NOW' : 'I’LL BE THERE', 'live-radar-people'],
            ['Pieces', formatCount(d.stock), d.quantityLine, 'live-radar-stock'],
            ['Pressure', pressureText(d.pressure), 'WANTED FOR EACH PIECE', 'live-radar-pressure'],
            ['Sold out', d.sellOutAt ? clockText(d.sellOutAt, false) : '—', d.sellOutAt ? 'EXPECTED, UTC' : 'NOT EVERY SIZE', 'live-radar-sellout'],
          ),
          table(
            [
              { label: 'Size', cell: (s) => h('span', { class: 'live__size' }, s.label), kind: ['nowrap'] },
              { label: 'Stock', cell: (s) => formatCount(s.stock), kind: ['num'] },
              { label: 'Interest', cell: (s) => formatCount(s.interest), kind: ['num'] },
              { label: 'Room', cell: (s) => formatCount(s.inRoom), kind: ['num'] },
              { label: 'Wanted', cell: (s) => formatCount(s.demand), kind: ['num'] },
              { label: 'Pressure', cell: (s) => pressureText(s.pressure), kind: ['num'] },
              { label: 'Expected', cell: (s) => (s.sellsOut ? `Sold out about ${clockText(s.sellOutAt)}` : `About ${formatCount(s.expectedSold)} confirmed`), kind: ['nowrap'] },
              { label: 'Suggestion', cell: (s) => h('span', { data: { testid: 'live-radar-add' } }, s.addPieces !== null && s.addPieces > 0 ? `Add ${formatCount(s.addPieces)}` : '—') },
            ],
            d.sizes,
            { caption: 'Demand by size' },
          ),
          suggested.length
            ? h(
                'p',
                { class: 'live__promise', data: { testid: 'live-radar-promise' } },
                `Adding pieces is suggested in ${suggested.map((s) => s.label).join(', ')}. The announcement says « ${d.quantityLine} »: adding pieces after a fixed number was announced contradicts it, and every addition is recorded and reported.`,
              )
            : null,
          subtitle('By tier'),
          table(
            [
              { label: 'Tier', cell: (t) => tierName(t.tier), kind: ['nowrap'] },
              { label: 'Interest', cell: (t) => formatCount(t.interest), kind: ['num'] },
              { label: 'Room', cell: (t) => formatCount(t.inRoom), kind: ['num'] },
            ],
            [...d.byTier].reverse(),
            { caption: 'Interest and presence by tier' },
          ),
          reasoning(d.reasoning, 'live-radar-why'),
        ],
        { id: 'live-radar', note: 'Before the opening', tools: [again('radar')] },
      ),
    );
  }

  // ── The release report ───────────────────────────────────────────────────
  if (data.report === 'failed') out.push(failed('Release report', 'live-report'));
  else if (data.report) {
    const rep = data.report;
    const csv = button('Download CSV', { kind: 'ghost', testId: 'live-report-csv' });
    csv.addEventListener('click', async () => {
      csv.disabled = true;
      try {
        saveDownload(await ctx.api.liveReportCsv(r.id));
      } catch (e) {
        notifyError(e);
      } finally {
        csv.disabled = false;
      }
    });
    const confirmed = rep.sizes.reduce((n, s) => n + s.confirmedPieces, 0);
    const stock = rep.sizes.reduce((n, s) => n + s.stock, 0);
    const unserved = rep.sizes.reduce((n, s) => n + s.unservedPieces, 0);
    out.push(
      section(
        'Release report',
        [
          figures(
            ['Sold out in', rep.sellOutMs === null ? '—' : durationText(rep.sellOutMs), rep.sellOutMs === null ? 'NOT SOLD OUT' : 'FROM THE OPENING', 'live-report-sellout'],
            ['Confirmed', formatCount(confirmed), `OF ${formatCount(stock)} PIECES`, 'live-report-confirmed'],
            ['Unserved', formatCount(unserved), 'PIECES NEVER OFFERED A TURN', 'live-report-unserved'],
            ['Revenue', formatMoney(rep.piecesRevenueMinor + rep.addonsRevenueMinor, rep.currency), `${formatMoney(rep.addonsRevenueMinor, rep.currency)} IN ADD-ONS`, 'live-report-revenue'],
          ),
          subtitle('The funnel'),
          h('div', { data: { testid: 'live-report-funnel' } }, barList(funnelBars(rep.funnel))),
          subtitle('By size'),
          table(
            [
              { label: 'Size', cell: (s) => h('span', { class: 'live__size' }, s.label), kind: ['nowrap'] },
              { label: 'Stock', cell: (s) => (s.added ? `${formatCount(s.stock)} (${formatCount(s.added)} added)` : formatCount(s.stock)), kind: ['num'] },
              { label: 'Confirmed', cell: (s) => formatCount(s.confirmedPieces), kind: ['num'] },
              { label: 'Sold out in', cell: (s) => durationText(s.sellOutMs), kind: ['num'] },
              { label: 'Unserved', cell: (s) => formatCount(s.unservedPieces), kind: ['num'] },
              { label: 'Missed', cell: (s) => formatCount(s.missed), kind: ['num'] },
              { label: 'Ended holds', cell: (s) => formatCount(s.expired), kind: ['num'] },
              { label: 'Next time', cell: (s) => h('span', { data: { testid: 'live-report-next' } }, formatCount(s.nextDemand)), kind: ['num'] },
            ],
            rep.sizes,
            { caption: 'The report by size' },
          ),
          subtitle('By tier'),
          table(
            [
              { label: 'Tier', cell: (t) => tierName(t.tier), kind: ['nowrap'] },
              { label: 'Entries', cell: (t) => formatCount(t.entries), kind: ['num'] },
              { label: 'Turns', cell: (t) => formatCount(t.turns), kind: ['num'] },
              { label: 'Secured', cell: (t) => formatCount(t.secured), kind: ['num'] },
              { label: 'Confirmed', cell: (t) => formatCount(t.confirmed), kind: ['num'] },
              { label: 'Missed', cell: (t) => formatCount(t.missed), kind: ['num'] },
              { label: 'Ended holds', cell: (t) => formatCount(t.expired), kind: ['num'] },
            ],
            [...rep.byTier].reverse(),
            { caption: 'The report by tier' },
          ),
          rep.addons.length
            ? [
                subtitle('Add-ons'),
                table(
                  [
                    { label: 'Add-on', cell: (a) => a.label, kind: ['wide'] },
                    { label: 'Reservations', cell: (a) => formatCount(a.reservations), kind: ['num'] },
                    { label: 'Pieces', cell: (a) => formatCount(a.pieces), kind: ['num'] },
                    { label: 'Revenue', cell: (a) => formatMoney(a.revenueMinor, rep.currency), kind: ['num', 'nowrap'] },
                  ],
                  rep.addons,
                  { caption: 'The add-ons chosen with the confirmed reservations' },
                ),
              ]
            : null,
          subtitle('Pieces added'),
          rep.additions.length
            ? table(
                [
                  { label: 'When', cell: (a) => formatDateTime(a.at, { seconds: true }), kind: ['nowrap'] },
                  { label: 'Size', cell: (a) => h('span', { class: 'live__size' }, a.size), kind: ['nowrap'] },
                  { label: 'Pieces', cell: (a) => formatCount(a.pieces), kind: ['num'] },
                  { label: 'Stock', cell: (a) => `${formatCount(a.before)} → ${formatCount(a.after)}`, kind: ['num'] },
                ],
                rep.additions,
                { caption: 'The pieces added after the announcement' },
              )
            : h('p', { class: 'notice', data: { testid: 'live-report-no-addition' } }, `None: the release kept to « ${rep.quantityLine} ».`),
          h(
            'p',
            { class: 'live__next', data: { testid: 'live-report-plan' } },
            h('span', { class: 'live__message-label' }, 'Next time'),
            h('span', null, `${formatCount(rep.next.quantity)} ${rep.next.quantity === 1 ? 'piece' : 'pieces'}: ${rep.next.sizes.map((s) => `${s.label} × ${formatCount(s.pieces)}`).join(' · ')}`),
          ),
          reasoning(rep.reasoning, 'live-report-why'),
        ].flat(),
        { id: 'live-report', note: rep.final ? 'Final' : 'So far: turns and holds still run', tools: [csv] },
      ),
    );
  }

  // ── The collector insights ───────────────────────────────────────────────
  if (data.collectors === 'failed') out.push(failed('Collector insights', 'live-collectors'));
  else if (data.collectors) {
    const c = data.collectors;
    const conversion = <T extends { entered: number; confirmed: number; conversion: number | null }>(first: { label: string; cell: (x: T) => Child }) => [
      first,
      { label: 'Entered', cell: (x: T) => formatCount(x.entered), kind: ['num' as const] },
      { label: 'Confirmed', cell: (x: T) => formatCount(x.confirmed), kind: ['num' as const] },
      { label: 'Conversion', cell: (x: T) => shareText(x.conversion), kind: ['num' as const] },
    ];
    out.push(
      section(
        'Collector insights',
        [
          h(
            'div',
            { class: ['grid', 'grid--2', 'live__intel-pair'] },
            h('div', null, subtitle('By tier'), table(conversion({ label: 'Tier', cell: (t: (typeof c.byTier)[number]) => tierName(t.tier) }), [...c.byTier].reverse(), { caption: 'Conversion by tier' })),
            h('div', null, subtitle('By country'), table(conversion({ label: 'Country', cell: (x: (typeof c.byCountry)[number]) => x.country ?? 'Unknown' }), c.byCountry, { caption: 'Conversion by country', empty: 'Nobody entered.' })),
          ),
          defList([
            { label: 'Repeat collectors', value: h('span', { data: { testid: 'live-collectors-repeat' } }, `${formatCount(c.repeat.entered)} · ${shareText(c.repeat.conversion)} converted`), note: 'Entered an earlier LIVE RELEASE' },
            { label: 'First time', value: `${formatCount(c.firstTime.entered)} · ${shareText(c.firstTime.conversion)} converted` },
          ]),
          subtitle('Came without a piece'),
          table(
            [
              { label: 'Account', cell: (x) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: x.accountId }), 'data-testid': 'live-collectors-account' } }, x.email), kind: ['wide'] },
              { label: 'Tier', cell: (x) => tierName(x.tier), kind: ['nowrap'] },
              { label: 'Size', cell: (x) => h('span', { class: 'live__size' }, x.size), kind: ['nowrap'] },
              { label: 'Status', cell: (x) => statusMark(humanize(x.status), toneOf('liveEntry', x.status)) },
              { label: 'Place', cell: (x) => (x.position === null ? h('span', { class: 'soft' }, '—') : formatCount(x.position)), kind: ['num'] },
              { label: 'Country', cell: (x) => x.country ?? '—', kind: ['nowrap'] },
            ],
            c.unsecured.items,
            { caption: 'Who came but secured no piece', empty: 'Everyone who came secured a piece.' },
          ),
          c.unsecured.total > c.unsecured.items.length ? h('p', { class: 'footnote' }, `The first ${formatCount(c.unsecured.items.length)} of ${formatCount(c.unsecured.total)}, the highest tiers first.`) : null,
          reasoning(c.reasoning, 'live-collectors-why'),
        ],
        { id: 'live-collectors', note: `${formatCount(c.unsecured.total)} without a piece` },
      ),
    );
  }

  // ── The bot radar ────────────────────────────────────────────────────────
  if (data.bots === 'failed') out.push(failed('Bot radar', 'live-bots'));
  else if (data.bots) {
    const b = data.bots;
    const remove = (btn: HTMLButtonElement, entryId: string) => async () => {
      btn.disabled = true;
      try {
        await ctx.api.removeLiveEntry(r.id, entryId);
        notify('Entry removed.');
        ctx.reload();
      } catch (e) {
        notifyError(e);
        btn.disabled = false;
      }
    };
    out.push(
      section(
        'Bot radar',
        [
          figures(
            ['Entries', formatCount(b.entries), 'READ BY THE RULES BELOW', 'live-bots-entries'],
            ['With a sign', formatCount(b.flagged), b.flagged ? 'TO LOOK AT' : 'NONE', 'live-bots-flagged'],
            ['Networks', formatCount(b.networks.length), b.networks.length ? b.networks.map((n) => `${formatCount(n.entries)} ENTRIES`).join(' · ') : 'NONE CROWDED', 'live-bots-networks'],
            ['Holds', formatCount(b.bySign.GESTURE_FLOOR + b.bySign.GESTURE_REPEAT), 'MACHINE-REGULAR', 'live-bots-holds'],
          ),
          table(
            [
              { label: 'Place', cell: (x) => (x.position === null ? h('span', { class: 'soft' }, '—') : formatCount(x.position)), kind: ['num'] },
              { label: 'Account', cell: (x) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: x.accountId }), 'data-testid': 'live-bots-account' } }, x.email), kind: ['wide'] },
              { label: 'Tier', cell: (x) => tierName(x.tier), kind: ['nowrap'] },
              { label: 'Size', cell: (x) => h('span', { class: 'live__size' }, x.size.label), kind: ['nowrap'] },
              { label: 'Status', cell: (x) => statusMark(humanize(x.status), toneOf('liveEntry', x.status)) },
              {
                label: 'Signs',
                cell: (x) =>
                  h(
                    'span',
                    { class: 'live__signs', data: { testid: 'live-bots-signs' } },
                    ...x.signs.map((s) => statusMark(LIVE_BOT_SIGN_LABELS[s], 'alert')),
                    ...x.reasons.map((line) => h('span', { class: 'cell-sub' }, line)),
                  ),
              },
              {
                label: '',
                cell: (x) => {
                  if (!x.open || !board || !liveEntryActions({ status: x.status }, board, role).remove) return null;
                  const btn = button('Remove', { kind: 'ghost', testId: 'live-bots-remove' });
                  btn.addEventListener('click', () => void remove(btn, x.entryId)());
                  return h('span', { class: 'row-actions' }, btn);
                },
                kind: ['actions'],
              },
            ],
            b.items,
            { caption: 'The entries with a sign', empty: 'No entry shows a sign.' },
          ),
          b.flagged > b.items.length ? h('p', { class: 'footnote' }, `The first ${formatCount(b.items.length)} of ${formatCount(b.flagged)}, the most signs first.`) : null,
          reasoning(b.reasoning, 'live-bots-why'),
        ],
        { id: 'live-bots', note: 'Removal: one tap, ADMIN', tools: r.phase === 'ENDED' ? [] : [again('bots')] },
      ),
    );
  }

  // ── The release comparison ───────────────────────────────────────────────
  if (data.comparison === 'failed') out.push(failed('Release comparison', 'live-comparison'));
  else if (data.comparison && data.comparison.releases.length > 1) {
    const cmp = data.comparison;
    out.push(
      section(
        'Release comparison',
        [
          table(
            [
              {
                label: 'Release',
                cell: (x) => h('span', null, x.current ? x.title : h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: x.id }) } }, x.title), h('span', { class: 'cell-sub' }, formatDateTime(x.opensAt))),
                kind: ['wide'],
              },
              ...LIVE_COMPARISON_COLUMNS.map((c) => ({ label: c.label, cell: c.cell, kind: ['num' as const, 'nowrap' as const] })),
            ],
            cmp.releases,
            { caption: 'The releases side by side', current: (x) => x.current },
          ),
          reasoning(cmp.reasoning, 'live-comparison-why'),
        ],
        { id: 'live-comparison', note: `${formatCount(cmp.releases.length)} releases` },
      ),
    );
  }
  return out;
}
