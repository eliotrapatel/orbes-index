/**
 * The Club (Clients), `#/club`: what the owners' club of /verify offers, one
 * tab each (`?tab=`): Drops (P-R03), the releases of a model in a limited
 * number of pieces, entered from /verify and drawn by tier; Circle (P-X01),
 * what ORBES publishes for the owners of a piece (views/circle.ts); Tiers
 * (P-X04), the words of each tier's benefits (views/tiers.ts); Requests
 * (P-X08), what owners requested from THE PRIVATE SALON (views/requests.ts).
 *
 * Drops: the LIVE RELEASES first (the plan of 2026-10-04: an instant drop
 * lived in real time), each with its state, T0, its pieces and price, its
 * line and its confirmed reservations; New live release (OPERATOR) creates a
 * DRAFT with its essentials, its seed drawn and committed at once, its other
 * settings by default; its row opens its page (`#/club/live/:dropId`,
 * views/live.ts). Then the draws: every drop, the latest created first, with
 * its state, its window of entries (UTC), its pieces and its entries; New
 * release (OPERATOR) creates a DRAFT whose seed is drawn and committed at
 * once. A drop's row opens its page (`#/club/drops/:dropId`): its facts,
 * publication, cancellation, the draw (ADMIN) and its entries. An AUDITOR
 * reads.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import { formatMoney, liveStateLabel, newLiveInput, newLiveProblem, newLiveValues } from '../model/live.js';
import { CLUB_TABS, clubTab, DROP_LIMITS, dropFormValues, dropInput, dropProblem, placesTaken } from '../model/club.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { Drop, LiveCard, Model } from '../types.js';
import { button, pageHeader, pager, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { circleTab } from './circle.js';
import { newLiveFields } from './live.js';
import { pageParam, type ViewContext } from './context.js';
import { requestsTab } from './requests.js';
import { tiersTab } from './tiers.js';

/** The fields of a drop's dialog: the active models to choose from, its values. */
export function dropFields(models: readonly Model[], values: Record<string, string>, opts: { model: boolean }): DialogField[] {
  const options = models.filter((m) => m.active || m.id === values.modelId).map((m) => ({ value: m.id, label: `${humanize(m.name)} · ${humanize(m.type)}` }));
  return [
    ...(opts.model ? [{ name: 'modelId', label: 'Model', kind: 'select' as const, required: true, options: [{ value: '', label: 'Choose a model' }, ...options], value: values.modelId }] : []),
    { name: 'title', label: 'Title', required: true, maxlength: DROP_LIMITS.title, value: values.title, hint: 'As the release’s page names it on /verify.' },
    { name: 'description', label: 'Description', kind: 'textarea', rows: 5, maxlength: DROP_LIMITS.description, value: values.description, hint: 'Plain paragraphs, a blank line between two. Optional.' },
    { name: 'quantity', label: 'Pieces', required: true, maxlength: 5, value: values.quantity, hint: `The places of the draw: 1 to ${formatCount(DROP_LIMITS.quantity)}.` },
    { name: 'opensAt', label: 'Entries open (UTC)', kind: 'datetime', required: true, value: values.opensAt },
    { name: 'closesAt', label: 'Entries close (UTC)', kind: 'datetime', required: true, value: values.closesAt, hint: 'The draw follows the close, run by an ADMIN.' },
    {
      name: 'purchaseWindowHours',
      label: 'Place held (hours)',
      required: true,
      maxlength: 3,
      value: values.purchaseWindowHours,
      hint: `How long a place drawn or reserved is held for its entrant: ${DROP_LIMITS.windowMin} to ${DROP_LIMITS.windowMax} hours, ${DROP_LIMITS.windowDefault} by default.`,
    },
    {
      name: 'earlyAccessHours',
      label: 'Early access (hours)',
      required: true,
      maxlength: 3,
      value: values.earlyAccessHours,
      hint: `Before entries open, PLATINE and PALLADIUM owners reserve a place directly, first come, first served, within the pieces: ${DROP_LIMITS.earlyMin} to ${DROP_LIMITS.earlyMax} hours, ${DROP_LIMITS.earlyDefault} by default, ${DROP_LIMITS.earlyMin} for none. The draw gives the places left.`,
    },
  ];
}

/** The tabs of the Club page: links, the current one marked (as the Analytics window's). */
function clubTabs(current: string): HTMLElement {
  return h(
    'nav',
    { class: 'range club__tabs', attrs: { 'aria-label': 'Club' } },
    ...CLUB_TABS.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: href('club', {}, { tab: t.id }), 'aria-current': t.id === current ? 'page' : null, 'data-testid': `club-tab-${t.id}` } }, t.label),
    ]),
  );
}

/** What each tab of the Club page is, said under its title. */
const CLUB_LEADS = Object.freeze({
  drops:
    'What the owners’ club of /verify offers. Drops: a model released in a limited number of pieces. A LIVE RELEASE is lived in real time: a room, a line at T0 by tier then at random, a turn to hold the seal, PAY. A draw is reserved directly by PLATINE and PALLADIUM owners during its early access, then entered by ORBES accounts and drawn by tier, then seniority, then the order of a seed committed when the release was published.',
  circle:
    'What the owners’ club of /verify offers. Circle: what ORBES publishes for the owners of a piece, by tier: notes, invitations they answer YES or NO, and polls whose results they read once they have voted.',
  tiers:
    'What the owners’ club of /verify offers. Tiers: TITANE, PLATINE and PALLADIUM, reached with 1, 3 and 5 pieces held now. MY PIECES shows each owner the tier, its benefits and the way to the next; the words of the benefits are set here.',
  requests:
    'What the owners’ club of /verify offers. Requests: the models of the private salon (the lookbook’s Reserved models, each from its tier, with its price) that owners asked for. ORBES Client Services contacts each client and concludes the sale, then closes the request with a note.',
});

export async function clubView(ctx: ViewContext): Promise<HTMLElement> {
  const tab = clubTab(ctx.route.query);
  const body = tab === 'circle' ? await circleTab(ctx) : tab === 'tiers' ? await tiersTab(ctx) : tab === 'requests' ? await requestsTab(ctx) : await dropsTab(ctx);
  return h(
    'div',
    { class: 'view view--club' },
    pageHeader({ eyebrow: 'Clients', title: 'Club', lead: CLUB_LEADS[tab], actions: [clubTabs(tab)] }),
    body,
  );
}

/** The Drops tab: the LIVE RELEASES and New live release; every drop of the draw, and New release. */
async function dropsTab(ctx: ViewContext): Promise<HTMLElement> {
  const [list, models, live] = await Promise.all([ctx.api.drops(pageParam(ctx), 50), ctx.api.models(), ctx.api.liveReleases(Number(ctx.route.query.lpage) || 1, 20)]);
  const canManage = can(ctx.session.admin.role, 'manageDrops');

  let createdLive: string | null = null;
  const newLive = () =>
    void openDialog({
      title: 'New live release',
      eyebrow: 'Club · Drops',
      body: h(
        'p',
        { class: 'dialog__text' },
        'A draft: nothing of it is public until it is published. Its seed is drawn now and committed by its fingerprint: it orders the line within a tier at T0. Every other setting takes its default and is set on its page.',
      ),
      fields: newLiveFields(models.items, newLiveValues(ctx.now())),
      validate: newLiveProblem,
      confirmLabel: 'Create release',
      submit: async (v) => {
        createdLive = (await ctx.api.createLiveRelease(newLiveInput(v))).id;
      },
    }).then((r) => {
      if (!r || !createdLive) return;
      notify('Live release created as a draft.');
      ctx.navigate(href('liveRelease', { dropId: createdLive }));
    });

  const liveSection = section(
    'Live releases',
    [
      table<LiveCard>(
        [
          {
            label: 'Release',
            cell: (d) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: d.id }), 'data-testid': 'live-link' } }, d.title), h('span', { class: 'cell-sub' }, `${humanize(d.model.name)} · ${humanize(d.model.type)}`)),
            kind: ['wide'],
          },
          { label: 'State', cell: (d) => statusMark(liveStateLabel(d), toneOf('livePhase', d.phase)), kind: ['nowrap'] },
          { label: 'Opening', cell: (d) => formatDateTime(d.opensAt), kind: ['nowrap'] },
          { label: 'Pieces', cell: (d) => h('span', null, formatCount(d.quantity), h('span', { class: 'cell-sub' }, d.quantityLine)), kind: ['num'] },
          { label: 'Price', cell: (d) => formatMoney(d.priceMinor, d.currency), kind: ['num', 'nowrap'] },
          { label: 'In line', cell: (d) => formatCount((d.entries.WAITING ?? 0) + (d.entries.QUEUED ?? 0) + (d.entries.TURN ?? 0) + (d.entries.SECURED ?? 0)), kind: ['num'] },
          { label: 'Confirmed', cell: (d) => formatCount(d.entries.CONFIRMED ?? 0), kind: ['num'] },
        ],
        live.items,
        {
          empty: 'No live release yet. A LIVE RELEASE is announced, then lived in real time: a room, a fair line at T0, a turn to hold the seal, PAY.',
          caption: 'Live releases',
          onRow: (d) => href('liveRelease', { dropId: d.id }),
        },
      ),
      pager(live, (p) => ctx.setQuery({ lpage: p })),
    ],
    { id: 'live-releases', tools: canManage ? [button('New live release', { kind: 'primary', testId: 'live-new', onClick: newLive })] : [] },
  );

  let created: string | null = null;
  const newDrop = () =>
    void openDialog({
      title: 'New release',
      eyebrow: 'Club · Drops',
      body: h(
        'p',
        { class: 'dialog__text' },
        'A draft: nothing of it is public until it is published. Its seed is drawn now and committed by its fingerprint, which its page shows from the publication on: the draw cannot be run with another.',
      ),
      fields: dropFields(models.items, dropFormValues(null, ctx.now()), { model: true }),
      validate: dropProblem,
      confirmLabel: 'Create release',
      submit: async (v) => {
        created = (await ctx.api.createDrop(dropInput(v))).id;
      },
    }).then((r) => {
      if (!r || !created) return;
      notify('Release created as a draft.');
      ctx.navigate(href('drop', { dropId: created }));
    });

  const drawsSection = section(
    'Drops',
    [
      table<Drop>(
        [
          {
            label: 'Release',
            cell: (d) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('drop', { dropId: d.id }), 'data-testid': 'drop-link' } }, d.title), h('span', { class: 'cell-sub' }, `${humanize(d.model.name)} · ${humanize(d.model.type)}`)),
            kind: ['wide'],
          },
          { label: 'State', cell: (d) => statusMark(humanize(d.state), toneOf('drop', d.state)), kind: ['nowrap'] },
          { label: 'Entries open', cell: (d) => formatDateTime(d.opensAt), kind: ['nowrap'] },
          { label: 'Entries close', cell: (d) => formatDateTime(d.closesAt), kind: ['nowrap'] },
          { label: 'Pieces', cell: (d) => formatCount(d.quantity), kind: ['num'] },
          { label: 'Entered', cell: (d) => formatCount(Object.entries(d.entries).filter(([s]) => s !== 'WITHDRAWN').reduce((n, [, c]) => n + c, 0)), kind: ['num'] },
          { label: 'Held or sold', cell: (d) => formatCount(placesTaken(d)), kind: ['num'] },
        ],
        list.items,
        {
          empty: 'No release yet. A release offers a model in a limited number of pieces: ORBES accounts enter it on /verify, then an ADMIN runs its draw.',
          caption: 'Drops',
          onRow: (d) => href('drop', { dropId: d.id }),
        },
      ),
      pager(list, (p) => ctx.setQuery({ page: p })),
    ],
    { id: 'drops', tools: canManage ? [button('New release', { kind: 'primary', testId: 'drop-new', onClick: newDrop })] : [] },
  );
  return h('div', { class: 'club__drops' }, liveSection, drawsSection);
}
