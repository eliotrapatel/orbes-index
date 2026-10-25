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
 * settings by default, its sizes proposed from the stock at its location then
 * the planner's demand once its model is chosen (plan LIVE RELEASE+, choice
 * 13: written into its sizes while they are the default or the last proposal,
 * never over sizes typed by hand); its row opens its page (`#/club/live/:dropId`,
 * views/live.ts). Each New dialog asks first WHAT IT SELLS (macro scope K44
 * T1, plan MACRO M3 §5.3): A MODEL, or A SET (Catalogue → Sets), whose
 * sizes are then given per piece (a draw's fields of pieces per piece, « Sets
 * on sale » and the even rule said; a LIVE RELEASE's lines per piece, proposed
 * per piece from the stock then the planner). Then the draws: every drop, the latest created first, with
 * its state, its window of entries (UTC), its pieces and its entries; New
 * release (OPERATOR) creates a DRAFT whose seed is drawn and committed at
 * once, in two dialogs (plan NEXT LOT §3.6.F): its model, then its fields with
 * one field of pieces per offered size of that model, the pieces in all and
 * what the stock gives each size below. A drop's row opens its page (`#/club/drops/:dropId`): its facts,
 * publication, cancellation, the draw (ADMIN) and its entries. An AUDITOR
 * reads. On the right, the server's status (plan TEST ENTRANTS,
 * views/server-status.ts) and the test running, whatever its release, with
 * STOP (ADMIN).
 */
import { h, mount } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import { formatMoney, liveSizesField, liveStateLabel, newLiveInput, newLiveProblem, newLiveValues, parseSetSizes, sizeMixLine, sizeMixText } from '../model/live.js';
import {
  CLUB_TABS,
  clubTab,
  DRAW_ACCESS_HINT,
  DRAW_SIZES_HINT,
  DRAW_SIZES_LEAD,
  drawSizeValues,
  drawStockLines,
  DROP_LIMITS,
  dropFormValues,
  dropInput,
  dropProblem,
  NO_DRAW_SIZES,
  offeredLabels,
  piecesInAll,
  placesTaken,
  sizeField,
  sizeFieldLabel,
} from '../model/club.js';
import { can } from '../model/permissions.js';
import { sizeMixEmptyLine } from '../model/sizes.js';
import { toneOf } from '../model/tone.js';
import {
  OFFER_TEXT,
  pieceTotals,
  quantityWords,
  releaseOfferLine,
  setDrawSizeValues,
  setDrawSizesOf,
  setDrawSizesProblem,
  setOptions,
  setPieceSizes,
  setSizeField,
  setsOnSaleLines,
  type SetPieceSizes,
} from '../model/sets.js';
import { modelChoice } from '../model/variants.js';
import { href } from '../router.js';
import { LIVE_CURRENCIES, ORDER_CURRENCIES, type AddonPickable, type Drop, type LiveCard, type LiveCurrency, type LiveSizeMix, type Model, type SegmentName, type SetSizeMix, type SetView } from '../types.js';
import type { Child } from '../../shared/dom.js';
import type { AdminApi } from '../api.js';
import { button, pageHeader, pager, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { circleTab } from './circle.js';
import { newLiveFields } from './live.js';
import { reasoning } from './live-intelligence.js';
import { pageParam, type ViewContext } from './context.js';
import { requestsTab } from './requests.js';
import { serverStatusPanel, withServerPanel } from './server-status.js';
import { tiersTab } from './tiers.js';

/** The model of a drop's first dialog (plan NEXT LOT §3.6.F): the active models to choose from. */
export function dropModelField(models: readonly Model[], modelId: string): DialogField {
  const options = models.filter((m) => m.active || m.id === modelId).map((m) => ({ value: m.id, label: modelChoice(m) }));
  return { name: 'modelId', label: 'Model', kind: 'select', required: true, options: [{ value: '', label: 'Choose a model' }, ...options], value: modelId };
}

/** The set of a release (macro scope K44 T1): the active sets to choose from (one set aside kept when it is the release's). */
export function releaseSetField(sets: readonly SetView[], setId: string, shown?: DialogField['shown']): DialogField {
  return { name: 'setId', label: 'Set', kind: 'select', required: true, options: [{ value: '', label: OFFER_TEXT.chooseSet }, ...setOptions(sets, setId)], value: setId, hint: sets.length ? undefined : OFFER_TEXT.noSet, ...(shown ? { shown } : {}) };
}

/** WHAT IT SELLS (macro scope K44 T1): A MODEL, or A SET, then the one chosen; A MODEL by default. */
export function offerFields(models: readonly Model[], sets: readonly SetView[], v: { offer?: string; modelId?: string; setId?: string } = {}): DialogField[] {
  return [
    {
      name: 'offer',
      label: OFFER_TEXT.label,
      kind: 'select',
      required: true,
      options: [
        { value: 'MODEL', label: OFFER_TEXT.model },
        { value: 'SET', label: OFFER_TEXT.set },
      ],
      value: v.offer ?? 'MODEL',
    },
    { ...dropModelField(models, v.modelId ?? ''), shown: (x) => x.offer !== 'SET' },
    releaseSetField(sets, v.setId ?? '', (x) => x.offer === 'SET'),
  ];
}

/** What WHAT IT SELLS lacks: its model, or its set. */
export function offerProblem(v: Record<string, string>): string | null {
  if (v.offer === 'SET') return v.setId ? null : 'Choose the set of the release.';
  return v.modelId ? null : 'Choose the model of the release.';
}

/**
 * A set draw's fields of pieces (macro scope K44 T1): per piece, one per offered size of its model, labelled with the
 * piece and the size (« AURA · Size 52 »).
 */
export function setDrawSizeFields(pieces: readonly SetPieceSizes[], values: Record<string, string>): DialogField[] {
  return pieces.flatMap((p) => p.labels.map((l) => ({ name: setSizeField(p.piece, l), label: `${p.name} · ${sizeFieldLabel(l)}`, maxlength: 5, value: values[setSizeField(p.piece, l)] ?? '' })));
}

/** What a set draw's dialog says above its fields of pieces. */
export function setDrawSizesBody(pieces: readonly SetPieceSizes[]): HTMLElement[] {
  return [
    h('p', { class: 'dialog__text', data: { testid: 'draw-set-lead' } }, 'The sizes each piece’s model declares. Give each size its pieces; 0 leaves it out. Its quantity is in sets: each piece’s sizes add up to the same sets before the draw is published.'),
    ...pieces.filter((p) => p.labels.length === 0).map((p) => h('p', { class: 'dialog__text', data: { testid: 'draw-no-sizes' } }, `${p.name} offers no size: declare its sizes in the Catalogue.`)),
  ];
}

/** A set's pieces with their offered sizes, and what the stock at the default location gives each (null when unread). */
export async function drawSizesOfSet(api: AdminApi, setId: string): Promise<{ set: SetView; pieces: SetPieceSizes[]; available: ((piece: number, label: string) => number) | null }> {
  const [set, mix] = await Promise.all([api.set(setId), api.setSizeMix(setId, null).catch(() => null)]);
  const stock = new Map<string, number>((mix?.pieces ?? []).flatMap((p) => p.mix.sizes.map((x) => [`${p.piece}:${x.label.toUpperCase()}`, x.fromStock] as const)));
  return { set, pieces: setPieceSizes(set), available: mix ? (piece, label) => stock.get(`${piece}:${label.toUpperCase()}`) ?? 0 : null };
}

/** Below a set draw's fields, as they are typed: « Sets on sale », the even rule while the pieces differ, then each size the stock does not cover. */
export function setDrawSizesPreview(v: Record<string, string>, pieces: readonly SetPieceSizes[], available: ((piece: number, label: string) => number) | null): Child[] {
  const sizes = setDrawSizesOf(v);
  const lines = setsOnSaleLines(
    pieceTotals(sizes, pieces.length),
    pieces.map((p) => p.name),
    'DRAW',
  );
  const short = available
    ? sizes
        .filter((s) => (s.pieces ?? 0) > 0)
        .flatMap((s) => {
          const fromStock = Math.min(s.pieces!, Math.max(0, available(s.piece, s.label)));
          const name = pieces.find((p) => p.piece === s.piece)?.name ?? `Piece ${s.piece}`;
          return s.pieces! - fromStock > 0 ? [`${name} · ${s.label}: ${formatCount(fromStock)} in stock, ${formatCount(s.pieces! - fromStock)} will wait for supplier stock.`] : [];
        })
    : [];
  return [
    h('p', { class: 'dialog__text', data: { testid: 'draw-sets-on-sale' } }, lines.onSale),
    lines.uneven ? h('p', { class: 'dialog__text', data: { testid: 'draw-sets-uneven' } }, lines.uneven) : null,
    ...short.map((line) => h('p', { class: 'dialog__text soft', data: { testid: 'draw-stock-line' } }, line)),
  ];
}

/**
 * A draw's fields of pieces, one per offered size of its model, labelled with the size (plan NEXT LOT §3.6.F): in
 * place of the Pieces field of before.
 */
export function drawSizeFields(labels: readonly string[], values: Record<string, string>): DialogField[] {
  return labels.map((l) => ({ name: sizeField(l), label: sizeFieldLabel(l), maxlength: 5, value: values[sizeField(l)] ?? '' }));
}

/**
 * The fields of a drop's dialog: the active models to choose from, its values, its model's sizes (plan NEXT LOT §3.6.F),
 * and its Access (plan MACRO M1 §3.2, F4) when the segments are given: everyone, or a segment.
 */
export function dropFields(
  models: readonly Model[],
  values: Record<string, string>,
  opts: { model: boolean; sizes: readonly string[]; segments?: readonly SegmentName[]; setPieces?: readonly SetPieceSizes[] },
): DialogField[] {
  return [
    ...(opts.model ? [dropModelField(models, values.modelId ?? '')] : []),
    { name: 'title', label: 'Title', required: true, maxlength: DROP_LIMITS.title, value: values.title, hint: 'As the release’s page names it on /verify.' },
    { name: 'description', label: 'Description', kind: 'textarea', rows: 5, maxlength: DROP_LIMITS.description, value: values.description, hint: 'Plain paragraphs, a blank line between two. Optional.' },
    // Macro scope K44 T1: a set's draw, its fields of pieces per piece.
    ...(opts.setPieces ? setDrawSizeFields(opts.setPieces, values) : drawSizeFields(opts.sizes, values)),
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
    { name: 'earlyAccessHours', label: 'Early access, PALLADIUM (hours)', required: true, maxlength: 3, value: values.earlyAccessHours },
    {
      name: 'earlyAccessPlatineHours',
      label: 'Early access, PLATINE (hours)',
      required: true,
      maxlength: 3,
      value: values.earlyAccessPlatineHours,
      hint: 'Before entries open, PALLADIUM owners, then PLATINE owners, reserve a place directly, first come, first served, within the pieces. PALLADIUM’s window is at least PLATINE’s; 0 for none. The draw gives the places left.',
    },
    ...(opts.segments
      ? [
          {
            name: 'accessSegmentId',
            label: 'Access',
            kind: 'select' as const,
            options: [{ value: '', label: 'Everyone' }, ...opts.segments.map((x) => ({ value: x.id, label: `Segment ${x.name}` }))],
            value: values.accessSegmentId ?? '',
            hint: DRAW_ACCESS_HINT,
          },
        ]
      : []),
    // NOCTURNE (addition 5): the price shown on the draw's card and page, which its orders take.
    opts.setPieces
      ? { name: 'price', label: 'Price', maxlength: 14, value: values.price, hint: 'One price for the set, in units: 4200, or 4200.50. Shown on the release’s card and page; shared over its pieces’ orders by their base prices. Empty: none (the orders’ prices are entered by Client Services).' }
      : { name: 'price', label: 'Price', maxlength: 14, value: values.price, hint: 'Per piece, in units: 4200, or 4200.50. Shown on the release’s card and page; each order of the draw takes it. Empty: none (the order’s price is entered by Client Services).' },
    { name: 'currency', label: 'Currency', kind: 'select', options: ORDER_CURRENCIES.map((c) => ({ value: c, label: c })), value: values.currency },
  ];
}

/**
 * What a draw's dialog says above its sizes' fields (plan NEXT LOT §3.6.F): the lead, and the hint for a model that
 * declares more sizes than a draw takes; the line of a model with none in their place.
 */
export function drawSizesBody(labels: readonly string[]): HTMLElement[] {
  if (labels.length === 0) return [h('p', { class: 'dialog__text', data: { testid: 'draw-no-sizes' } }, NO_DRAW_SIZES)];
  return [
    h('p', { class: 'dialog__text', data: { testid: 'draw-sizes-lead' } }, DRAW_SIZES_LEAD),
    ...(labels.length > DROP_LIMITS.sizes ? [h('p', { class: 'dialog__text soft', data: { testid: 'draw-sizes-hint' } }, DRAW_SIZES_HINT)] : []),
  ];
}

/** A model's offered sizes and what the stock at the default location gives each (null when it cannot be read). */
export async function drawSizesOfModel(api: AdminApi, modelId: string): Promise<{ labels: string[]; available: ((label: string) => number) | null }> {
  const [sizes, mix] = await Promise.all([api.modelSizes(modelId), api.liveSizeMix(modelId, null).catch((): LiveSizeMix | null => null)]);
  const stock = new Map<string, number>((mix?.sizes ?? []).map((x) => [x.label.toUpperCase(), x.fromStock]));
  return { labels: offeredLabels(sizes), available: mix ? (label: string) => stock.get(label.toUpperCase()) ?? 0 : null };
}

/** Below a draw's sizes' fields, as they are typed: the pieces in all, then each size the stock does not cover. */
export function drawSizesPreview(v: Record<string, string>, available: ((label: string) => number) | null): Child[] {
  return [
    h('p', { class: 'dialog__text', data: { testid: 'draw-pieces-in-all' } }, piecesInAll(v)),
    ...(available ? drawStockLines(v, available).map((line) => h('p', { class: 'dialog__text soft', data: { testid: 'draw-stock-line' } }, line)) : []),
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
    'What the owners’ club of /verify offers. Tiers: TITANE, PLATINE and PALLADIUM, reached with 1, 5 and 10 pieces held now. MY PIECES shows each owner the tier, its benefits and the way to the next; the words of the benefits are set here.',
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
  const [list, models, live, locations, sets] = await Promise.all([
    ctx.api.drops(pageParam(ctx), 50),
    ctx.api.models(),
    ctx.api.liveReleases(Number(ctx.route.query.lpage) || 1, 20),
    ctx.api.locations().catch(() => ({ items: [] })),
    // Macro scope K44 T1: the sets a release may sell (none when they cannot be read: A MODEL still works).
    ctx.api.sets().catch(() => ({ items: [] as SetView[] })),
  ]);
  const canManage = can(ctx.session.admin.role, 'manageDrops');

  let createdLive: string | null = null;
  // The size mix of each model and location, read once per dialog.
  const mixes = new Map<string, Promise<LiveSizeMix | 'failed'>>();
  let proposed: string | null = null;
  const startSizes = newLiveValues(ctx.now()).sizes;
  // Macro scope K44 T1: a set's size mix, per piece, read once per set and location.
  const setMixes = new Map<string, Promise<SetSizeMix | 'failed'>>();
  const setProposed = new Map<number, string>();
  const setOf = (id: string | undefined) => sets.items.find((x) => x.id === id) ?? null;
  const pieceNamesOf = (id: string | undefined) => (setOf(id) ? setPieceSizes(setOf(id)!).map((p) => p.name) : []);
  const setSizeMix = (v: Record<string, string>) => {
    const set = setOf(v.setId);
    if (!set) return h('p', { class: 'dialog__text soft', data: { testid: 'live-size-mix' } }, 'Choose the set: each piece’s sizes are proposed from the stock at the location, then from the planner.');
    const names = setPieceSizes(set).map((p) => p.name);
    const key = `${set.id}|${v.locationId ?? ''}`;
    let read = setMixes.get(key);
    if (!read) {
      read = ctx.api.setSizeMix(set.id, v.locationId || null).catch(() => 'failed' as const);
      setMixes.set(key, read);
    }
    // What the typed lines give: the sets on sale, the scarcest piece's.
    const typed = parseSetSizes(v, names);
    const onSale =
      'problem' in typed
        ? null
        : (() => {
            const lines = setsOnSaleLines(pieceTotals(typed.sizes, names.length), names, 'LIVE');
            return [h('p', { class: 'dialog__text', data: { testid: 'live-sets-on-sale' } }, lines.onSale), lines.uneven ? h('p', { class: 'dialog__text soft', data: { testid: 'live-sets-uneven' } }, lines.uneven) : null];
          })();
    const holder = h('div', { class: 'live__mix', data: { testid: 'live-size-mix' } }, h('p', { class: 'dialog__text soft' }, 'Reading the stock and the planner…'));
    void read.then((mix) => {
      const form = holder.closest('form');
      // Each piece's field named by its model.
      names.forEach((name, i) => {
        const label = form?.querySelector<HTMLElement>(`.cfield[data-field="${liveSizesField(i + 1)}"] .cfield__label`);
        if (label?.firstChild) label.firstChild.textContent = `Sizes · ${name}`;
      });
      if (mix === 'failed') {
        mount(holder, h('p', { class: 'dialog__text soft' }, 'The sizes could not be proposed just now: set them by hand.'));
        return;
      }
      mount(
        holder,
        h('p', { class: 'live__mix-title' }, 'Proposed sizes'),
        ...mix.pieces.map((p) => h('p', { class: 'dialog__text', data: { testid: 'live-size-mix-line' } }, `${names[p.piece - 1] ?? `Piece ${p.piece}`}: ${sizeMixText(p.mix) ? sizeMixLine(p.mix) : sizeMixEmptyLine(p.mix)}`)),
        mix.sets > 0 ? h('p', { class: 'dialog__text soft' }, `${formatCount(mix.sets)} ${mix.sets === 1 ? 'set' : 'sets'} proposed: the scarcest piece’s.`) : null,
        reasoning(mix.reasoning, 'live-size-mix-why'),
      );
      // Written into each piece's lines while they are empty or the last proposal: lines typed by hand stay.
      for (const p of mix.pieces) {
        const text = sizeMixText(p.mix);
        const area = form?.querySelector<HTMLTextAreaElement>(`textarea[name="${liveSizesField(p.piece)}"]`);
        if (!text || !area) continue;
        if (area.value === text) setProposed.set(p.piece, text);
        else if (area.value.trim() === '' || area.value === setProposed.get(p.piece)) {
          area.value = text;
          setProposed.set(p.piece, text);
          area.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
    return [holder, ...(onSale ?? [])];
  };
  const sizeMix = (v: Record<string, string>) => {
    if (v.offer === 'SET') return setSizeMix(v);
    if (!v.modelId) return h('p', { class: 'dialog__text soft', data: { testid: 'live-size-mix' } }, 'Choose the model: its sizes are proposed from the stock at the location, then from the planner.');
    const key = `${v.modelId}|${v.locationId ?? ''}`;
    let read = mixes.get(key);
    if (!read) {
      read = ctx.api.liveSizeMix(v.modelId, v.locationId || null).catch(() => 'failed' as const);
      mixes.set(key, read);
    }
    const holder = h('div', { class: 'live__mix', data: { testid: 'live-size-mix' } }, h('p', { class: 'dialog__text soft' }, 'Reading the stock and the planner…'));
    void read.then((mix) => {
      if (mix === 'failed') {
        mount(holder, h('p', { class: 'dialog__text soft' }, 'The sizes could not be proposed just now: set them by hand.'));
        return;
      }
      const text = sizeMixText(mix);
      mount(
        holder,
        h('p', { class: 'live__mix-title' }, 'Proposed sizes'),
        h('p', { class: 'dialog__text', data: { testid: 'live-size-mix-line' } }, text ? sizeMixLine(mix) : sizeMixEmptyLine(mix)),
        reasoning(mix.reasoning, 'live-size-mix-why'),
      );
      // Written into the sizes while they are the default or the last proposal: sizes typed by hand stay.
      const area = holder.closest('form')?.querySelector<HTMLTextAreaElement>('textarea[name="sizes"]');
      if (!text || !area) return;
      if (area.value === text) proposed = text;
      else if (area.value.trim() === startSizes || area.value === proposed) {
        area.value = text;
        proposed = text;
        area.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    return holder;
  };
  const newLive = async () => {
    // Each dialog reads the stock afresh.
    mixes.clear();
    proposed = null;
    setMixes.clear();
    setProposed.clear();
    // Lot Q2, step Q2.7 (D3, N7): the add-ons it may offer in each currency, ticked at first (one unread: the server's default).
    const lists = await Promise.all(LIVE_CURRENCIES.map((c) => ctx.api.addonPickable('LIVE', c).then((x) => [c, x.items] as const).catch(() => null)));
    const pickable = Object.fromEntries(lists.filter((x) => x !== null)) as Partial<Record<LiveCurrency, AddonPickable[]>>;
    void openDialog({
      title: 'New live release',
      eyebrow: 'Club · Drops',
      body: h(
        'p',
        { class: 'dialog__text' },
        'A draft: nothing of it is public until it is published. Its seed is drawn now and committed by its fingerprint: it orders the line within a tier at T0. Every other setting takes its default and is set on its page.',
      ),
      fields: newLiveFields(models.items, newLiveValues(ctx.now()), locations.items, sets.items, pickable),
      live: sizeMix,
      validate: (v) => newLiveProblem(v, pieceNamesOf(v.setId)),
      confirmLabel: 'Create release',
      submit: async (v) => {
        createdLive = (await ctx.api.createLiveRelease(newLiveInput(v, pieceNamesOf(v.setId)))).id;
      },
    }).then((r) => {
      if (!r || !createdLive) return;
      notify('Live release created as a draft.');
      ctx.navigate(href('liveRelease', { dropId: createdLive }));
    });
  };

  const liveSection = section(
    'Live releases',
    [
      table<LiveCard>(
        [
          {
            label: 'Release',
            cell: (d) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: d.id }), 'data-testid': 'live-link' } }, d.title), h('span', { class: 'cell-sub', data: { testid: 'live-offer' } }, releaseOfferLine(d))),
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
    { id: 'live-releases', tools: canManage ? [button('New live release', { kind: 'primary', testId: 'live-new', onClick: () => void newLive() })] : [] },
  );

  let created: string | null = null;
  // Plan NEXT LOT §3.6.F: two dialogs, the model first (a draw's sizes are its model's), then its fields.
  // Macro scope K44 T1: WHAT IT SELLS first, A MODEL or A SET; a set's sizes are given per piece.
  const newDrop = async () => {
    // The early access by default: THE PROGRAM's (BP-19 T3), read when the dialog opens.
    // Plan MACRO M1 §3.2 (F4): the segments a draw may be opened to, read with it.
    const [program, segments] = await Promise.all([ctx.api.clubProgram(), ctx.api.segmentNames()]);
    const chosen = await openDialog({
      title: 'New release',
      eyebrow: 'Club · Drops',
      body: h('p', { class: 'dialog__text' }, 'What it sells first: a draw’s sizes and their pieces are its model’s offered sizes, or each piece’s of a set.'),
      fields: offerFields(models.items, sets.items),
      validate: offerProblem,
      confirmLabel: 'Next',
    });
    if (!chosen) return;
    if (chosen.offer === 'SET') {
      const setId = chosen.setId;
      const { set, pieces, available } = await drawSizesOfSet(ctx.api, setId);
      void openDialog({
        title: 'New release',
        eyebrow: `Club · Drops · ${humanize(set.name)} · ${set.pieces.length} pieces`,
        body: [
          h(
            'p',
            { class: 'dialog__text' },
            'A draft: nothing of it is public until it is published. Its seed is drawn now and committed by its fingerprint, which its page shows from the publication on: the draw cannot be run with another.',
          ),
          ...setDrawSizesBody(pieces),
        ],
        fields: dropFields(models.items, { ...dropFormValues(null, ctx.now(), { palladium: program.earlyAccessPalladiumHours, platine: program.earlyAccessPlatineHours }), ...setDrawSizeValues(pieces, null) }, { model: false, sizes: [], segments, setPieces: pieces }),
        live: (v) => setDrawSizesPreview(v, pieces, available),
        validate: (v) => dropProblem({ ...v, setId }, (x) => setDrawSizesProblem(x, pieces)),
        confirmLabel: 'Create release',
        submit: async (v) => {
          created = (await ctx.api.createDrop(dropInput({ ...v, setId }))).id;
        },
      }).then((r) => {
        if (!r || !created) return;
        notify('Release created as a draft.');
        ctx.navigate(href('drop', { dropId: created }));
      });
      return;
    }
    const modelId = chosen.modelId;
    const { labels, available } = await drawSizesOfModel(ctx.api, modelId);
    const model = models.items.find((m) => m.id === modelId);
    void openDialog({
      title: 'New release',
      eyebrow: `Club · Drops${model ? ` · ${modelChoice(model)}` : ''}`,
      body: [
        h(
          'p',
          { class: 'dialog__text' },
          'A draft: nothing of it is public until it is published. Its seed is drawn now and committed by its fingerprint, which its page shows from the publication on: the draw cannot be run with another.',
        ),
        ...drawSizesBody(labels),
      ],
      fields: dropFields(models.items, { ...dropFormValues(null, ctx.now(), { palladium: program.earlyAccessPalladiumHours, platine: program.earlyAccessPlatineHours }), ...drawSizeValues(labels, null) }, { model: false, sizes: labels, segments }),
      live: (v) => (labels.length > 0 ? drawSizesPreview(v, available) : []),
      validate: (v) => dropProblem({ ...v, modelId }),
      confirmLabel: 'Create release',
      submit: async (v) => {
        created = (await ctx.api.createDrop(dropInput({ ...v, modelId }))).id;
      },
    }).then((r) => {
      if (!r || !created) return;
      notify('Release created as a draft.');
      ctx.navigate(href('drop', { dropId: created }));
    });
  };

  const drawsSection = section(
    'Drops',
    [
      table<Drop>(
        [
          {
            label: 'Release',
            cell: (d) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('drop', { dropId: d.id }), 'data-testid': 'drop-link' } }, d.title), h('span', { class: 'cell-sub', data: { testid: 'drop-offer' } }, releaseOfferLine(d))),
            kind: ['wide'],
          },
          { label: 'State', cell: (d) => statusMark(humanize(d.state), toneOf('drop', d.state)), kind: ['nowrap'] },
          { label: 'Entries open', cell: (d) => formatDateTime(d.opensAt), kind: ['nowrap'] },
          { label: 'Entries close', cell: (d) => formatDateTime(d.closesAt), kind: ['nowrap'] },
          // Macro scope K44 T1: a set's draw counts sets.
          { label: 'Pieces', cell: (d) => (d.set ? h('span', null, formatCount(d.quantity), h('span', { class: 'cell-sub' }, quantityWords(d.quantity, true).split(' ')[1]!.toUpperCase())) : formatCount(d.quantity)), kind: ['num'] },
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
    { id: 'drops', tools: canManage ? [button('New release', { kind: 'ghost', testId: 'drop-new', onClick: () => void newDrop() })] : [] },
  );
  // The server's status on the right (plan TEST ENTRANTS), with the test running, whatever its release.
  return withServerPanel([h('div', { class: 'club__drops' }, liveSection, drawsSection)], serverStatusPanel(ctx, { activeTest: true }));
}
