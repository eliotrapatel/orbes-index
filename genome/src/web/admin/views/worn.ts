/**
 * The WORN page, `#/worn` (plan MACRO M2 §2.4, scope D31 G2): the photographs owners send from their pieces, read here
 * before they appear at the foot of the model's sheet (server: routes/admin/worn.ts, services/worn.ts). In the Clients
 * group under House messages, its sidebar link carries the count TO REVIEW (main.ts). Its three tabs:
 *
 *  - TO REVIEW (`?tab=review`, the default), oldest first: each card the photograph large, the credit exactly as it
 *    will read, the piece (its serial, its page), the model and its variant (its page), the owner (the client sheet;
 *    the email masked for an AUDITOR by the server), sent at and the consent, in Paris; PUBLISH, or REFUSE… with one of
 *    the three reasons, the words the owner will read shown first (OPERATOR). J and K move between the cards.
 *  - PUBLISHED (`?tab=published`, `&model=` a model's group, every variant): the photographs by model, newest first,
 *    each its credit, piece and date, whether everyone sees it now, and TAKE DOWN… with a reason (OPERATOR).
 *  - ENDED (`?tab=ended`): refused, withdrawn, taken down and ended rows, their photographs erased, with why, who and
 *    when.
 * Model in model/worn.ts. Every review is audited by the server. Every time in Paris.
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatAge } from '../format.js';
import { parisDateTime } from '../model/links.js';
import {
  consentText,
  creditLine,
  endedWho,
  endedWhy,
  groupByModel,
  modelOptions,
  modelText,
  ownerReads,
  photoAlt,
  refusalOptions,
  refusalProblem,
  statusWords,
  stepCard,
  tabText,
  waitingLine,
  WORN_COPY as C,
  WORN_PAGE_SIZES,
  WORN_QUEUE_OF,
  WORN_TABS,
  wornActions,
  wornParams,
  type WornParams,
} from '../model/worn.js';
import { href, productHref } from '../router.js';
import type { AdminWornPhoto, Model, Paged, WornRefusal, WornSummary } from '../types.js';
import { busy, button, defList, emptyState, field, filterBar, linkButton, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function wornView(ctx: ViewContext): Promise<HTMLElement> {
  const params = wornParams(ctx.route.query);
  const review = wornActions(ctx.session.admin.role).review;
  const [summary, page, models] = await Promise.all([
    // The tabs' counts: the page stands without them.
    ctx.api.wornSummary().catch(() => null),
    ctx.api.worn({ queue: WORN_QUEUE_OF[params.tab], model: params.model, page: params.page, pageSize: WORN_PAGE_SIZES[params.tab] }),
    params.tab === 'published' ? ctx.api.models().then((r) => r.items) : Promise.resolve([]),
  ]);
  const header = pageHeader({
    eyebrow: 'Clients',
    title: C.title,
    lead: C.lead,
    actions: [linkButton('House messages', href('houseMessages'), 'ghost'), linkButton('Catalogue', href('catalogue'), 'ghost')],
  });
  const go = (n: number) => ctx.setQuery({ page: n > 1 ? n : null });
  const body =
    params.tab === 'review'
      ? reviewTab(ctx, page, summary, review, go)
      : params.tab === 'published'
        ? publishedTab(ctx, page, params, models, review, go)
        : endedTab(page, go);
  return h('div', { class: 'view view--worn' }, header, tabs(params, summary), body);
}

/** TO REVIEW · PUBLISHED · ENDED, as links (the console's local tabs), each with its count when known. */
function tabs(p: WornParams, summary: WornSummary | null): HTMLElement {
  return h(
    'nav',
    { class: ['range', 'worn__tabs'], attrs: { 'aria-label': C.tabs } },
    ...WORN_TABS.flatMap((t, i) => {
      const { words, count } = tabText(t, summary);
      return [
        i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
        h(
          'a',
          { class: 'range__tab', attrs: { href: href('worn', {}, { tab: t }), 'aria-current': p.tab === t ? 'page' : null, 'data-testid': `worn-tab-${t}` } },
          words,
          count === null ? null : h('span', { class: ['range__figure', 'worn__tab-count'] }, count),
        ),
      ];
    }),
  );
}

/** The credit exactly as it will read under the photograph: the line in the label face, then the Instagram name. */
function creditBlock(p: AdminWornPhoto): HTMLElement {
  const c = creditLine(p.credit);
  return h(
    'p',
    { class: 'worn-credit', data: { testid: 'worn-credit' } },
    h('span', { class: 'worn-credit__line' }, c.line),
    c.handle && c.href ? h('a', { class: 'worn-credit__handle', attrs: { href: c.href, target: '_blank', rel: 'noopener noreferrer' } }, c.handle) : null,
  );
}

/** The photograph, sized by its own width and height so nothing moves as it arrives; « Erased » once it is. */
function photo(p: AdminWornPhoto, kind: 'large' | 'tile'): HTMLElement {
  if (!p.photoUrl) return h('span', { class: ['worn-photo', `worn-photo--${kind}`, 'worn-photo--erased'] }, C.photoErased);
  return h('img', {
    class: ['worn-photo', `worn-photo--${kind}`],
    attrs: { src: p.photoUrl, alt: photoAlt(p), width: p.width ?? undefined, height: p.height ?? undefined, decoding: 'async', loading: kind === 'tile' ? 'lazy' : 'eager', 'data-testid': 'worn-photo' },
  });
}

const pieceLink = (p: AdminWornPhoto) => h('a', { class: ['idlink', 'mono'], attrs: { href: productHref(p.piece.productId), 'data-testid': 'worn-piece' } }, p.piece.productId);
const modelLink = (p: AdminWornPhoto) => h('a', { class: 'idlink', attrs: { href: href('model', { modelId: p.model.id }), 'data-testid': 'worn-model' } }, modelText(p.model));
const ownerLink = (p: AdminWornPhoto) =>
  h('a', { class: ['idlink', 'worn__email'], attrs: { href: href('owner', { accountId: p.owner.accountId }), 'data-testid': 'worn-owner' } }, p.owner.email);

/** REFUSE or TAKE DOWN: a reason from the three, the words the owner will read shown as it is chosen. */
function reasonDialog(o: { title: string; body: string; confirm: string; eyebrow: string; submit: (r: WornRefusal) => Promise<void> }): Promise<boolean> {
  return openDialog({
    title: o.title,
    eyebrow: o.eyebrow,
    body: h('p', { class: 'dialog__text' }, o.body),
    fields: [{ name: 'reason', label: C.reason, kind: 'select', options: refusalOptions(), value: '', required: true }],
    live: (v) => {
      const words = ownerReads(v.reason);
      return words ? h('p', { class: 'worn__owner-reads', data: { testid: 'worn-owner-reads' } }, h('span', { class: 'worn__owner-reads-label' }, C.ownerReads), h('span', null, words)) : null;
    },
    validate: (v) => refusalProblem(v.reason),
    confirmLabel: o.confirm,
    danger: true,
    submit: (v) => o.submit(v.reason as WornRefusal),
  }).then((r) => r !== null);
}

// ── TO REVIEW ────────────────────────────────────────────────────────────────────────────────────────────────────

function reviewTab(ctx: ViewContext, page: Paged<AdminWornPhoto>, summary: WornSummary | null, review: boolean, go: (n: number) => void): HTMLElement {
  const now = ctx.now();
  const cards = page.items.map((p) => reviewCard(ctx, p, review, now));
  const list = h('ol', { class: 'worn__queue', data: { testid: 'worn-queue' } }, ...cards.map((c) => h('li', null, c)));
  if (cards.length > 0) keysBetween(list, cards);
  const waiting = waitingLine(summary, now);
  return section(
    C.review,
    page.items.length === 0
      ? [h('div', { data: { testid: 'worn-empty' } }, emptyState(C.nothingToReview))]
      : [
          h('p', { class: 'worn__lead', data: { testid: 'worn-waiting' } }, waiting ? `${waiting}. ` : null, C.reviewNote),
          review ? null : h('p', { class: 'worn__read-only', data: { testid: 'worn-read-only' } }, C.readOnly),
          list,
          pager(page, go),
        ],
    { id: 'review' },
  );
}

function reviewCard(ctx: ViewContext, p: AdminWornPhoto, review: boolean, now: Date): HTMLElement {
  const eyebrow = `${modelText(p.model)} · ${p.piece.productId}`;
  const stale = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'WORN_STATE') {
      notify(C.stale, 'error');
      ctx.reload();
    } else notifyError(e);
  };
  const publish = button(C.publish, {
    kind: 'primary',
    testId: 'worn-publish',
    onClick: () =>
      void busy(publish, () => ctx.api.publishWorn(p.id), 'Publishing…').then(
        () => {
          notify(C.published_);
          ctx.reload();
        },
        stale,
      ),
  });
  const refuse = button(C.refuse, {
    kind: 'ghost',
    testId: 'worn-refuse',
    onClick: () =>
      void reasonDialog({ title: C.refuseTitle, body: C.refuseBody, confirm: C.refuseConfirm, eyebrow, submit: (r) => ctx.api.refuseWorn(p.id, r) }).then((done) => {
        if (!done) return;
        notify(C.refused);
        ctx.reload();
      }),
  });
  return h(
    'article',
    { class: 'worn-card', attrs: { tabindex: '-1', 'aria-label': `${photoAlt(p)}, sent ${parisDateTime(p.sentAt)}` }, data: { testid: 'worn-card', id: p.id } },
    h('div', { class: 'worn-card__ground' }, photo(p, 'large')),
    h(
      'div',
      { class: 'worn-card__facts' },
      h('p', { class: 'worn-card__label' }, C.credit),
      creditBlock(p),
      h('p', { class: 'worn-card__note' }, C.creditNote),
      defList(
        [
          { label: C.piece, value: pieceLink(p) },
          { label: C.model, value: modelLink(p) },
          { label: C.owner, value: ownerLink(p) },
          { label: C.sent, value: h('span', { data: { testid: 'worn-sent' } }, parisDateTime(p.sentAt)), note: formatAge(p.sentAt, now) },
          { label: C.consent, value: consentText(p) },
        ],
        'worn-card__list',
      ),
      review ? h('div', { class: 'worn-card__actions' }, publish, refuse) : null,
    ),
  );
}

/** J and K between the cards while the page is shown (never while typing, nor with a dialog open); it lets go once left. */
function keysBetween(list: HTMLElement, cards: HTMLElement[]): void {
  const onKey = (ev: KeyboardEvent) => {
    if (!list.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (document.querySelector('dialog[open]')) return;
    const current = cards.findIndex((c) => c.contains(document.activeElement));
    const next = stepCard(ev.key, current, cards.length);
    if (next === null) return;
    ev.preventDefault();
    cards[next]!.focus({ preventScroll: true });
    cards[next]!.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  document.addEventListener('keydown', onKey);
}

// ── PUBLISHED ────────────────────────────────────────────────────────────────────────────────────────────────────

function publishedTab(
  ctx: ViewContext,
  page: Paged<AdminWornPhoto>,
  params: WornParams,
  models: Pick<Model, 'id' | 'name' | 'variantOf'>[],
  review: boolean,
  go: (n: number) => void,
): HTMLElement {
  const filter = select('model', modelOptions(models), params.model ?? '');
  filter.setAttribute('data-testid', 'worn-filter-model');
  filter.addEventListener('change', () => ctx.setQuery({ model: filter.value || null, page: null }));
  const groups = groupByModel(page.items);
  return section(
    C.published,
    [
      filterBar(field(C.modelFilter, filter)),
      review || page.items.length === 0 ? null : h('p', { class: 'worn__read-only', data: { testid: 'worn-read-only' } }, C.readOnly),
      page.items.length === 0
        ? h('div', { data: { testid: 'worn-empty' } }, emptyState(params.model ? C.nothingPublishedModel : C.nothingPublished))
        : h(
            'div',
            { class: 'worn__groups' },
            ...groups.map((g) =>
              h(
                'div',
                { class: 'worn__group', data: { testid: 'worn-group' } },
                h('h3', { class: 'worn__group-title' }, g.title),
                h('ul', { class: 'worn__grid' }, ...g.items.map((p) => h('li', null, publishedTile(ctx, p, review)))),
              ),
            ),
          ),
      pager(page, go),
    ],
    { id: 'published' },
  );
}

function publishedTile(ctx: ViewContext, p: AdminWornPhoto, review: boolean): HTMLElement {
  const takeDown = button(C.takeDown, {
    kind: 'ghost',
    testId: 'worn-take-down',
    onClick: () =>
      void reasonDialog({
        title: C.takeDownTitle,
        body: C.takeDownBody,
        confirm: C.takeDownConfirm,
        eyebrow: `${modelText(p.model)} · ${p.piece.productId}`,
        submit: (r) => ctx.api.takeDownWorn(p.id, r),
      }).then((done) => {
        if (!done) return;
        notify(C.takenDown);
        ctx.reload();
      }),
  });
  return h(
    'figure',
    { class: 'worn-tile', data: { testid: 'worn-tile', id: p.id } },
    h('div', { class: 'worn-tile__frame' }, photo(p, 'tile')),
    h(
      'figcaption',
      { class: 'worn-tile__caption' },
      creditBlock(p),
      h('span', { class: 'worn-tile__line' }, modelLink(p)),
      h('span', { class: 'worn-tile__line' }, pieceLink(p)),
      h('span', { class: ['worn-tile__line', 'worn-tile__date'] }, `${C.since} ${parisDateTime(p.publishedAt)}`),
      p.shown ? null : h('span', { class: 'worn-tile__hidden', attrs: { title: C.notShownNote }, data: { testid: 'worn-not-shown' } }, statusMark(C.notShown, 'outline')),
      review ? h('span', { class: 'worn-tile__actions' }, takeDown) : null,
    ),
  );
}

// ── ENDED ────────────────────────────────────────────────────────────────────────────────────────────────────────

function endedTab(page: Paged<AdminWornPhoto>, go: (n: number) => void): HTMLElement {
  const rows: Child = table<AdminWornPhoto>(
    [
      {
        label: C.status,
        cell: (p) => h('span', null, statusMark(statusWords(p.status).text, statusWords(p.status).tone), h('span', { class: 'cell-sub', data: { testid: 'worn-why' } }, endedWhy(p))),
      },
      { label: C.piece, cell: (p) => h('span', null, pieceLink(p), h('span', { class: 'cell-sub' }, modelText(p.model))), kind: ['nowrap'] },
      {
        label: 'Credit',
        cell: (p) => {
          const c = creditLine(p.credit);
          return h('span', null, `${p.credit.firstName} · ${p.credit.country}`, c.handle ? h('span', { class: 'cell-sub' }, c.handle) : null);
        },
      },
      { label: C.owner, cell: (p) => h('span', { class: 'cell-email' }, ownerLink(p)), kind: ['email'] },
      {
        label: C.ended,
        cell: (p) =>
          h(
            'span',
            null,
            parisDateTime(p.endedAt),
            h('span', { class: ['cell-sub', 'worn__by'], data: { testid: 'worn-who' } }, `${C.who} ${endedWho(p)}`),
            h('span', { class: 'cell-sub' }, `${C.sent} ${parisDateTime(p.sentAt)}`),
          ),
        kind: ['nowrap'],
      },
    ],
    page.items,
    { empty: C.nothingEnded, caption: C.ended },
  );
  return section(C.ended, [h('div', { data: { testid: page.items.length ? 'worn-ended' : 'worn-empty' } }, rows), pager(page, go)], { id: 'ended', note: C.endedNote });
}
