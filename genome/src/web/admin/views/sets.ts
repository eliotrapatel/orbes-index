/**
 * THE SET in the console (macro scope of 2026-10-20, K44 T1; lot M3 plan §5.3, step M3.17): Catalogue → Sets, placed
 * after Add-ons by views/catalogue.ts.
 *
 *  - The table: the set's name and code, its pieces in order, its base price, its releases, ACTIVE / SET ASIDE with its
 *    Shopify link. Empty: « No set yet: group 2 to 4 models sold at one price. »
 *  - New set and Edit (OPERATOR): its name, code, 2 to 4 pieces chosen among the models and variants, in order, and its
 *    price; once a release names it, its pieces are frozen (the dialog says so and keeps them). Set aside / Reinstate;
 *    Shopify (its product's id pasted back: the set is one product, its pieces their models' own variants).
 * The words are in model/sets.ts; the server audits each change (set.create, .update, .set_aside, .reinstate, .shopify).
 */
import { h } from '../../shared/dom.js';
import { humanize } from '../format.js';
import { can } from '../model/permissions.js';
import {
  SET_LIMITS,
  SET_PIECE_FIELDS,
  SETS_TEXT,
  setChange,
  setCreateInput,
  setFormValues,
  setModelOptions,
  setPiecesLines,
  setPriceText,
  setProblem,
  setReleasesText,
  setShopifyInput,
  setShopifyProblem,
  setShopifyStatus,
  setState,
} from '../model/sets.js';
import { href } from '../router.js';
import { ORDER_CURRENCIES, type Model, type SetView } from '../types.js';
import { button, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const lines = (items: readonly string[], testid: string): HTMLElement =>
  h('span', { class: 'addon-lines', data: { testid } }, ...items.map((x) => h('span', { class: 'addon-lines__line' }, x)));

/** The Sets section of the Catalogue. */
export function setsSection(ctx: ViewContext, sets: readonly SetView[], models: readonly Model[]): HTMLElement {
  const canEdit = can(ctx.session.admin.role, 'editCatalog');
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  const edit = (s: SetView | null) => {
    const values = setFormValues(s);
    const frozen = !!s && s.releases.length > 0;
    const held = s ? s.pieces.map((p) => p.model.id) : [];
    const options = setModelOptions(models, held);
    const pieceFields: DialogField[] = SET_PIECE_FIELDS.map((name, i) => ({
      name,
      label: `Piece ${i + 1}`,
      kind: 'select' as const,
      required: i < SET_LIMITS.piecesMin,
      options: [{ value: '', label: i < SET_LIMITS.piecesMin ? 'Choose a model' : 'None' }, ...(frozen ? options.filter((o) => held.includes(o.value)) : options)],
      value: values[name],
      hint: frozen ? undefined : SETS_TEXT.pieceHint(i + 1),
    }));
    void openDialog({
      title: s ? SETS_TEXT.editTitle : SETS_TEXT.addTitle,
      eyebrow: s ? humanize(s.name) : SETS_TEXT.eyebrow,
      body: [h('p', { class: 'dialog__text' }, SETS_TEXT.piecesLead), frozen ? h('p', { class: 'dialog__text', data: { testid: 'set-frozen' } }, SETS_TEXT.frozen) : null],
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: SET_LIMITS.name, value: values.name, hint: SETS_TEXT.nameHint },
        { name: 'code', label: 'Code', required: true, maxlength: SET_LIMITS.code, value: values.code, hint: SETS_TEXT.codeHint },
        ...pieceFields,
        { name: 'price', label: 'Price', maxlength: 14, value: values.price, hint: SETS_TEXT.priceHint },
        { name: 'currency', label: 'Currency', kind: 'select', options: ORDER_CURRENCIES.map((c) => ({ value: c, label: c })), value: values.currency },
      ],
      validate: (v) => setProblem(v, s) ?? (s && Object.keys(setChange(s, v)).length === 0 ? SETS_TEXT.unchanged : null),
      confirmLabel: s ? 'Save' : 'Add',
      submit: async (v) => {
        if (s) await ctx.api.updateSet(s.id, setChange(s, v));
        else await ctx.api.createSet(setCreateInput(v));
      },
    }).then(done(s ? SETS_TEXT.saved : SETS_TEXT.added));
  };

  const toggle = (s: SetView) =>
    void openDialog({
      title: s.active ? SETS_TEXT.setAsideTitle : SETS_TEXT.reinstateTitle,
      eyebrow: humanize(s.name),
      body: h('p', { class: 'dialog__text' }, s.active ? SETS_TEXT.setAsideText : SETS_TEXT.reinstateText),
      confirmLabel: s.active ? SETS_TEXT.setAside : SETS_TEXT.reinstate,
      submit: async () => {
        if (s.active) await ctx.api.setSetAside(s.id);
        else await ctx.api.reinstateSet(s.id);
      },
    }).then(done(s.active ? SETS_TEXT.setAsideDone : SETS_TEXT.reinstateDone));

  // S5: one Shopify product per set, its id pasted back.
  const shopify = (s: SetView) =>
    void openDialog({
      title: SETS_TEXT.shopifyTitle,
      eyebrow: humanize(s.name),
      body: h('p', { class: 'dialog__text' }, SETS_TEXT.shopifyText(s.code)),
      fields: [{ name: 'productId', label: 'Product', maxlength: 300, value: s.shopifyProductId ?? '', hint: 'Empty: the set is no longer linked.' }],
      validate: (v) => setShopifyProblem(s, v),
      confirmLabel: 'Save the id',
      submit: async (v) => {
        await ctx.api.linkSetShopify(s.id, setShopifyInput(v));
      },
    }).then(done(SETS_TEXT.shopifySaved));

  const columns: Column<SetView>[] = [
    {
      label: 'Set',
      cell: (s) => h('span', null, h('span', { data: { testid: 'set-name' } }, humanize(s.name)), h('span', { class: 'cell-sub mono', data: { testid: 'set-code' } }, s.code)),
      kind: ['wide'],
    },
    { label: 'Pieces', cell: (s) => lines(setPiecesLines(s), 'set-pieces') },
    { label: 'Price', cell: (s) => h('span', { class: s.basePriceMinor === null ? 'soft' : undefined, data: { testid: 'set-price' } }, setPriceText(s)), kind: ['nowrap'] },
    {
      label: 'Releases',
      cell: (s) =>
        h(
          'span',
          null,
          h('span', { class: s.releases.length ? undefined : 'soft', data: { testid: 'set-releases' } }, setReleasesText(s)),
          // Its latest releases by their titles, each opening its page; its pieces are then frozen.
          ...s.releases.slice(0, 3).map((r) =>
            h('a', { class: ['cell-sub', 'sets__release'], attrs: { href: r.mode === 'LIVE' ? href('liveRelease', { dropId: r.id }) : href('drop', { dropId: r.id }), 'data-testid': 'set-release' } }, r.title),
          ),
          s.releases.length > 3 ? h('span', { class: 'cell-sub' }, `and ${s.releases.length - 3} more`) : null,
        ),
    },
    {
      label: 'Status · Shopify',
      cell: (s) =>
        h(
          'span',
          null,
          h('span', { data: { testid: 'set-state' } }, statusMark(setState(s), s.active ? 'solid' : 'muted')),
          h('span', { class: 'cell-sub', data: { testid: 'set-shopify' } }, setShopifyStatus(s)),
        ),
      kind: ['nowrap'],
    },
    ...(canEdit
      ? [
          {
            label: '',
            cell: (s: SetView) =>
              h(
                'span',
                { class: 'row-actions' },
                button('Edit', { kind: 'ghost', testId: 'set-edit', onClick: () => edit(s) }),
                button(SETS_TEXT.shopify, { kind: 'ghost', testId: 'set-shopify-id', onClick: () => shopify(s) }),
                button(s.active ? SETS_TEXT.setAside : SETS_TEXT.reinstate, { kind: 'ghost', testId: 'set-toggle', onClick: () => toggle(s) }),
              ),
            kind: ['actions' as const, 'wrap' as const],
          },
        ]
      : []),
  ];

  return section(
    SETS_TEXT.title,
    [h('p', { class: 'panel__text' }, SETS_TEXT.lead), h('div', { class: 'sets__table', data: { testid: 'sets-table' } }, table(columns, [...sets], { empty: SETS_TEXT.empty, caption: SETS_TEXT.title }))],
    { id: 'sets', tools: canEdit ? [button(SETS_TEXT.add, { kind: 'ghost', testId: 'set-add', onClick: () => edit(null) })] : [] },
  );
}
