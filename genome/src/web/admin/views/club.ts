/**
 * The Club (Clients), `#/club`: what the owners' club of /verify offers, one
 * tab each (`?tab=`). P-R03 opens it with Drops: the releases of a model in
 * a limited number of pieces, entered from /verify and drawn by tier.
 *
 * Drops: every drop, the latest created first, with its state, its window of
 * entries (UTC), its pieces and its entries; New release (OPERATOR) creates a
 * DRAFT whose seed is drawn and committed at once. A drop's row opens its
 * page (`#/club/drops/:dropId`): its facts, publication, cancellation, the
 * draw (ADMIN) and its entries. An AUDITOR reads.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import { CLUB_TABS, clubTab, DROP_LIMITS, dropFormValues, dropInput, dropProblem, placesTaken } from '../model/club.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { Drop, Model } from '../types.js';
import { button, pageHeader, pager, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

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
      hint: `How long a place drawn is held for its entrant: ${DROP_LIMITS.windowMin} to ${DROP_LIMITS.windowMax} hours, ${DROP_LIMITS.windowDefault} by default.`,
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

export async function clubView(ctx: ViewContext): Promise<HTMLElement> {
  const tab = clubTab(ctx.route.query);
  const [list, models] = await Promise.all([ctx.api.drops(pageParam(ctx), 50), ctx.api.models()]);
  const canManage = can(ctx.session.admin.role, 'manageDrops');

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

  const drops = section(
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

  return h(
    'div',
    { class: 'view view--club' },
    pageHeader({
      eyebrow: 'Clients',
      title: 'Club',
      lead: 'What the owners’ club of /verify offers. Drops: a model released in a limited number of pieces, entered by ORBES accounts and drawn by tier, then seniority, then the order of a seed committed when the release was published.',
      actions: [clubTabs(tab)],
    }),
    drops,
  );
}
