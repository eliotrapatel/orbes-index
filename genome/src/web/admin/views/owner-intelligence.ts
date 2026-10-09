/**
 * The client sheet's Intelligence section (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.4, C.11, step 5.7): read
 * after the sheet from GET /api/admin/owners/:id/intelligence, so a slow or failing read never keeps Client Services
 * from the sheet. Loading, then its blocks; the whole read failing says so with Try again; one block failing says so
 * under its own heading, the others stand.
 *   2. Origin (§3.4 A.10.5): the first visit, the sign-up's last link, the latest purchase's; a link's name opens its
 *      page on Links.
 *   3. Wishlist (§3.2 W.9): the client's open wishes, each model opening its Catalogue page.
 *   4. What they look at, 5. Devices, 6. Places (§3.3 T.4.1): the rows, then Most viewed models (with « Show all », 50 a
 *      page, C.11), Releases viewed, the devices and the places with DB-IP's attribution; an AUDITOR reads no city.
 * Block 1, the engagement score, ships with I2: absent until then. The words are model/owner-intelligence.ts.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { dayText, parisDayText } from '../model/client-profile.js';
import {
  browsingRows,
  deviceText,
  durationText,
  INTELLIGENCE_COPY as I,
  intelligenceNote,
  nothingRecorded,
  openedInText,
  originRows,
  placeText,
  releaseTimeText,
  showAllModels,
  wishMark,
} from '../model/owner-intelligence.js';
import { href } from '../router.js';
import type { CollectorBrowsing, FailedBlock, OwnerOrigin, OwnerSheet, StaffWish, ViewedModel } from '../types.js';
import { button, defList, loading, section, table } from '../ui/components.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const failedBlock = <T extends object>(b: T | FailedBlock): b is FailedBlock => (b as FailedBlock).failed === true;

/** A failure line under a block's heading, with its button. */
function blockFailure(text: string, label: string, retry: () => void): HTMLElement {
  return h('div', { class: 'failure', attrs: { role: 'alert' }, data: { testid: 'intelligence-block-failed' } }, h('p', { class: 'failure__text' }, text), button(label, { kind: 'secondary', onClick: retry }));
}

const subtitle = (text: string) => h('h3', { class: 'panel__subtitle' }, text);

/** A model with its variant on its own line (H1's variant line), opening its Catalogue page. */
function modelCell(m: { modelId: string; name: string | null; variant: string | null }, mark: string | null = null): HTMLElement {
  return h(
    'span',
    null,
    h('a', { class: 'idlink', attrs: { href: href('model', { modelId: m.modelId }) } }, m.name ?? I.withdrawn),
    mark ? ` ${mark}` : null,
    m.variant ? h('span', { class: 'cell-sub cell-sub--variant' }, m.variant) : null,
  );
}

function originBlock(o: OwnerOrigin): HTMLElement {
  return h(
    'div',
    { data: { testid: 'intelligence-origin' } },
    defList(
      originRows(o).map((r) => ({
        label: r.label,
        value: r.linkId ? h('a', { class: 'idlink', attrs: { href: href('link', { linkId: r.linkId }) } }, r.text) : r.text,
      })),
    ),
  );
}

function wishlistBlock(list: StaffWish[]): HTMLElement {
  return h(
    'div',
    { data: { testid: 'intelligence-wishlist' } },
    h('p', { class: 'soft intelligence__note' }, I.wishlistNote),
    table<StaffWish>(
      [
        { label: 'Model', cell: (w) => modelCell({ modelId: w.modelId, name: w.name, variant: w.variant?.label ?? null }, wishMark(w)) },
        { label: 'Collection', cell: (w) => w.collection ?? '—' },
        { label: 'Wished since', cell: (w) => parisDayText(w.addedAt), kind: ['nowrap'] },
      ],
      list,
      { empty: I.wishlistEmpty, caption: I.wishlist },
    ),
  );
}

function modelsTable(models: ViewedModel[]): HTMLElement {
  return table<ViewedModel>(
    [
      { label: 'Model', cell: (m) => modelCell(m) },
      { label: 'Views', cell: (m) => formatCount(m.views), kind: ['num'] },
      { label: 'Time', cell: (m) => durationText(m.seconds), kind: ['nowrap'] },
      { label: 'Last viewed', cell: (m) => parisDayText(m.lastAt), kind: ['nowrap'] },
    ],
    models,
    { empty: '—', caption: I.models },
  );
}

/** Most viewed models: the five most, then « Show all », 50 a page, with « Show 50 more » while more are left (C.11). */
function mostViewed(ctx: ViewContext, accountId: string, b: CollectorBrowsing): HTMLElement {
  const box = h('div', { data: { testid: 'intelligence-models' } });
  let shown: ViewedModel[] = [];
  let page = 0;
  const draw = (all: boolean, total: number) => {
    const more = all ? shown.length < total : showAllModels(b);
    const next = button(all ? I.showMore : I.showAll, { kind: 'ghost', testId: 'intelligence-models-more' });
    next.addEventListener('click', () => {
      next.disabled = true;
      void ctx.api.viewedModels(accountId, page + 1).then((r) => {
        page = r.page;
        shown = [...shown, ...r.items];
        draw(true, r.total);
      }, (e) => {
        next.disabled = false;
        notifyError(e);
      });
    });
    mount(box, modelsTable(all ? shown : b.models), more ? next : null);
  };
  draw(false, b.modelsViewed);
  return box;
}

function browsingBlocks(ctx: ViewContext, accountId: string, b: CollectorBrowsing): Child[] {
  if (nothingRecorded(b)) return [subtitle(I.looks), h('p', { class: 'soft', data: { testid: 'intelligence-browsing' } }, I.nothing)];
  return [
    subtitle(I.looks),
    h(
      'div',
      { data: { testid: 'intelligence-browsing' } },
      defList(browsingRows(b).map((r) => ({ label: r.label, value: r.text, note: r.note }))),
      h('h4', { class: 'intelligence__table-title' }, I.models),
      mostViewed(ctx, accountId, b),
      h('h4', { class: 'intelligence__table-title' }, I.releases),
      h(
        'div',
        { data: { testid: 'intelligence-releases' } },
        table(
        [
          {
            label: 'Release',
            cell: (r) => (r.title ? h('a', { class: 'idlink', attrs: { href: r.live ? href('liveRelease', { dropId: r.dropId }) : href('drop', { dropId: r.dropId }) } }, r.title) : I.withdrawn),
          },
          { label: 'Views', cell: (r) => formatCount(r.views), kind: ['num'] },
          { label: 'Time', cell: (r) => releaseTimeText(r), kind: ['nowrap'] },
          { label: 'Last viewed', cell: (r) => parisDayText(r.lastAt), kind: ['nowrap'] },
        ],
        b.releases,
        { empty: '—', caption: I.releases },
        ),
      ),
    ),
    subtitle(I.devices),
    h(
      'div',
      { data: { testid: 'intelligence-devices' } },
      table(
        [
          { label: 'Device', cell: (d) => deviceText(d) },
          { label: 'Opened in', cell: (d) => openedInText(d), kind: ['nowrap'] },
          { label: 'First seen', cell: (d) => parisDayText(d.firstSeenAt), kind: ['nowrap'] },
          { label: 'Last seen', cell: (d) => parisDayText(d.lastSeenAt), kind: ['nowrap'] },
        ],
        b.devices,
        { empty: '—', caption: I.devices },
      ),
    ),
    subtitle(I.places),
    h(
      'div',
      { data: { testid: 'intelligence-places' } },
      table(
        [
          { label: 'Place', cell: (p) => placeText(p) },
          { label: 'Days', cell: (p) => formatCount(p.days), kind: ['num'] },
          { label: 'Last seen', cell: (p) => dayText(p.lastDay), kind: ['nowrap'] },
        ],
        b.places,
        { empty: '—', caption: I.places },
      ),
      b.citiesWithheld
        ? h('p', { class: 'soft intelligence__foot', data: { testid: 'intelligence-places-foot' } }, I.citiesWithheld)
        : h('p', { class: 'soft intelligence__foot', data: { testid: 'intelligence-places-foot' } }, I.placesFoot, h('a', { class: 'idlink', attrs: { href: I.dbIpHref, target: '_blank', rel: 'noopener noreferrer' } }, I.dbIp), '.'),
    ),
  ];
}

/** The Intelligence section, after Tags and private notes (C.4.1); its blocks read after the sheet. */
export function intelligenceSection(ctx: ViewContext, sheet: OwnerSheet): HTMLElement {
  const accountId = sheet.owner.id;
  const body = h('div', { class: 'intelligence', data: { testid: 'intelligence' } });
  const panel = section(I.title, body, { id: 'intelligence', note: I.note });
  const note = panel.querySelector<HTMLElement>('.panel__note');
  const read = () => {
    mount(body, loading(I.loading));
    ctx.api.ownerIntelligence(accountId).then(
      (i) => {
        if (note) note.textContent = intelligenceNote(sheet.owner.createdAt, i.recordingSince);
        mount(
          body,
          // 1. The engagement score: with I2.
          subtitle(I.origin),
          failedBlock(i.origin) ? blockFailure(I.originFailed, I.tryAgain, read) : originBlock(i.origin),
          subtitle(I.wishlist),
          failedBlock(i.wishlist) ? blockFailure(I.wishlistFailed, I.tryAgain, read) : wishlistBlock(i.wishlist),
          ...(failedBlock(i.browsing) ? [subtitle(I.looks), blockFailure(I.browsingFailed, I.retry, read)] : browsingBlocks(ctx, accountId, i.browsing)),
        );
      },
      () => {
        mount(
          body,
          h('div', { class: 'failure', attrs: { role: 'alert' }, data: { testid: 'intelligence-failed' } }, h('p', { class: 'failure__text' }, I.failed), button(I.tryAgain, { kind: 'secondary', onClick: read })),
        );
      },
    );
  };
  read();
  return panel;
}
