/**
 * Margin settings (macro scope of 2026-10-20, K43 N1 and N2; lot M4 plan §1.3, step M4.4): #/growth/margin-settings,
 * reached from Growth's Margin, Growth's page in the sidebar. What the margin counts as costs, from
 * GET /api/admin/margin/settings; every reader of Growth reads it (AUDITOR and above), an ADMIN writes it, as Orders →
 * Settings (routes/admin/margin.ts). Five sections, Orders → Settings' patterns (a table, Set / Edit / Clear in the row,
 * a dialog per change, a toast and the page read again):
 *
 *   - Currencies: each currency that appears and its rate (`1 GBP = 1.150000 EUR`), the missing ones marked "No rate:
 *     left out of the margin"; Set a rate for any other.
 *   - Outbound shipping: the bands, a row per country (ALL OTHER COUNTRIES last), each band `up to 500 g · € 6.90` with
 *     Edit and Remove; Add a band.
 *   - Packaging: POUCH and CARD per piece, THE VAULT CARD per card packed (D61); each box's cost is in Orders →
 *     Settings → Boxes.
 *   - Returns and claims allowance: each active category, its percent.
 *   - PRIVATE CARE and warranty: one PRIVATE CARE service and each claim outcome.
 *
 * Nothing personal is shown or sent: keys, amounts and currencies only.
 */
import { h, type Child } from '../../shared/dom.js';
import {
  allowanceField,
  allowanceProblem,
  allowanceRows,
  allowanceText,
  bandChange,
  bandCountryOptions,
  bandFormValues,
  bandGroups,
  bandInput,
  bandProblem,
  bandText,
  careKeys,
  countryLabel,
  currencyRows,
  MARGIN_SETTINGS_TEXT as T,
  packagingKeys,
  percentValue,
  rateField,
  rateProblem,
  rateValue,
  unitCostFormValues,
  unitCostInput,
  unitCostLabel,
  unitCostNote,
  unitCostProblem,
  unitCostText,
  type BandForm,
  type BandGroup,
  type CurrencyRow,
  type UnitCostForm,
} from '../model/margin-settings.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import type { AllowanceView, MarginSettings, ShippingCostView, UnitCostView } from '../types.js';
import { button, emptyState, linkButton, pageHeader, section, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

type Done = (msg: string) => (v: unknown) => void;

export async function marginSettingsView(ctx: ViewContext): Promise<HTMLElement> {
  const s = await ctx.api.marginSettings();
  const admin = can(ctx.session.admin.role, 'manageMargin');
  const done: Done = (msg) => (v) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };
  return h(
    'div',
    { class: 'view view--margin-settings' },
    pageHeader({ eyebrow: T.eyebrow, title: T.title, lead: T.lead, actions: [linkButton(T.growth, href('growth'), 'ghost')] }),
    currenciesSection(ctx, s, admin, done),
    shippingSection(ctx, s, admin, done),
    packagingSection(ctx, s, admin, done),
    allowanceSection(ctx, s, admin, done),
    careSection(ctx, s, admin, done),
  );
}

/** A row's buttons, only for an ADMIN. */
function actions(admin: boolean, ...buttons: (HTMLButtonElement | null)[]): Child {
  return admin ? h('span', { class: 'row-actions' }, ...buttons) : null;
}

/** A dialog that asks before something is cleared or removed. */
function confirmClear(o: { title: string; eyebrow: string; text: string; label: string; danger?: boolean; submit: () => Promise<unknown> }): Promise<unknown> {
  return openDialog({
    title: o.title,
    eyebrow: o.eyebrow,
    body: h('p', { class: 'dialog__text' }, o.text),
    confirmLabel: o.label,
    danger: o.danger ?? false,
    submit: async () => {
      await o.submit();
    },
  });
}

// ── Currencies ─────────────────────────────────────────────────────────────

function currenciesSection(ctx: ViewContext, s: MarginSettings, admin: boolean, done: Done): HTMLElement {
  const rows = currencyRows(s);
  const set = (row: CurrencyRow | null) =>
    void openDialog({
      title: T.rateTitle,
      eyebrow: row ? `${T.title} · ${row.currency}` : `${T.title} · ${T.currencies}`,
      fields: [
        ...(row ? [] : [{ name: 'currency', label: 'Currency', required: true, maxlength: 3, value: '', hint: T.rateCurrencyHint }]),
        { name: 'rate', label: row ? `1 ${row.currency} in euros` : 'One unit in euros', required: true, maxlength: 20, value: rateField(row?.eurRate ?? null), hint: T.rateHint },
      ],
      validate: (v) => {
        const currency = row ? row.currency : (v.currency ?? '');
        const problem = rateProblem({ currency, rate: v.rate });
        if (problem) return problem;
        return row && row.eurRate !== null && Number(rateValue(v.rate)) === Number(row.eurRate) ? T.unchanged : null;
      },
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setMarginRate((row ? row.currency : v.currency!).trim().toUpperCase(), rateValue(v.rate));
      },
    }).then(done(T.rateSaved));
  const clear = (row: CurrencyRow) =>
    void confirmClear({ title: T.clearRateTitle, eyebrow: `${T.title} · ${row.currency}`, text: T.clearRateText, label: T.clear, submit: () => ctx.api.clearMarginRate(row.currency) }).then(done(T.rateCleared));
  return section(
    T.currencies,
    [
      h('p', { class: 'notice' }, T.currenciesLead),
      rows.length
        ? table<CurrencyRow>(
            [
              { label: 'Currency', cell: (r) => h('span', { data: { testid: 'margin-currency' } }, r.currency), kind: ['nowrap'] },
              {
                label: 'Rate',
                cell: (r) =>
                  r.eurRate === null
                    ? h('span', { class: 'margin-settings__missing', data: { testid: 'margin-rate' } }, T.noRate)
                    : h('span', { class: 'margin-band__text', data: { testid: 'margin-rate' } }, r.text),
                kind: ['wide'],
              },
              {
                label: '',
                cell: (r) =>
                  actions(
                    admin,
                    button(r.eurRate === null ? T.set : T.edit, { kind: 'ghost', testId: 'margin-rate-set', onClick: () => set(r) }),
                    r.eurRate === null ? null : button(T.clear, { kind: 'ghost', testId: 'margin-rate-clear', onClick: () => clear(r) }),
                  ),
                kind: ['actions', 'wrap'],
              },
            ],
            rows,
            { caption: T.currencies },
          )
        : h('div', { data: { testid: 'margin-currencies-empty' } }, emptyState(T.currenciesEmpty)),
    ],
    { id: 'margin-currencies', tools: admin ? [button(T.setRate, { kind: 'ghost', testId: 'margin-rate-add', onClick: () => set(null) })] : [] },
  );
}

// ── Outbound shipping ──────────────────────────────────────────────────────

function shippingSection(ctx: ViewContext, s: MarginSettings, admin: boolean, done: Done): HTMLElement {
  const groups = bandGroups(s.shippingCosts);
  const edit = (b: ShippingCostView | null) => {
    const values = bandFormValues(b);
    void openDialog({
      title: b ? T.editBandTitle : T.addBandTitle,
      eyebrow: b ? `${countryLabel(b.country)} · ${bandText(b)}` : T.bandEyebrow,
      fields: [
        { name: 'country', label: 'Country', kind: 'select', options: bandCountryOptions(), value: values.country, hint: 'ALL OTHER COUNTRIES: every country without a band of its own.' },
        { name: 'maxWeightG', label: 'Up to, in grams', required: true, maxlength: 7, value: values.maxWeightG, hint: 'The heaviest parcel this band takes, in grams: 500.' },
        { name: 'cost', label: 'Cost', required: true, maxlength: 12, value: values.cost, hint: 'What the carrier is paid for such a parcel: 6.90.' },
        { name: 'currency', label: 'Currency', required: true, maxlength: 3, value: values.currency, hint: T.currencyHint },
      ],
      validate: (v) => bandProblem(v) ?? (b && bandChange(b, v as BandForm) === null ? T.unchanged : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        if (b) await ctx.api.updateShippingCost(b.id, bandChange(b, v as BandForm)!);
        else await ctx.api.addShippingCost(bandInput(v as BandForm));
      },
    }).then(done(b ? T.bandSaved : T.bandAdded));
  };
  const remove = (b: ShippingCostView) =>
    void confirmClear({
      title: T.removeBandTitle,
      eyebrow: `${countryLabel(b.country)} · ${bandText(b)}`,
      text: T.removeBandText,
      label: T.remove,
      danger: true,
      submit: () => ctx.api.removeShippingCost(b.id),
    }).then(done(T.bandRemoved));
  const bands = (g: BandGroup) =>
    h(
      'ul',
      { class: 'margin-bands' },
      ...g.bands.map((b) =>
        h(
          'li',
          { class: 'margin-band', data: { testid: 'margin-band' } },
          h('span', { class: 'margin-band__text' }, bandText(b)),
          actions(admin, button(T.edit, { kind: 'ghost', testId: 'margin-band-edit', onClick: () => edit(b) }), button(T.remove, { kind: 'ghost', testId: 'margin-band-remove', onClick: () => remove(b) })),
        ),
      ),
    );
  return section(
    T.shipping,
    [
      h('p', { class: 'notice' }, T.shippingLead),
      groups.length
        ? table<BandGroup>(
            [
              { label: 'Country', cell: (g) => h('span', { data: { testid: 'margin-band-country' } }, g.label), kind: ['nowrap'] },
              { label: 'Bands', cell: (g) => bands(g), kind: ['wide'] },
            ],
            groups,
            { caption: T.shipping },
          )
        : h('div', { data: { testid: 'margin-bands-empty' } }, emptyState(T.shippingEmpty)),
      h('p', { class: 'margin-settings__line' }, T.shippingNote),
    ],
    { id: 'margin-shipping', tools: admin ? [button(T.addBand, { kind: 'ghost', testId: 'margin-band-add', onClick: () => edit(null) })] : [] },
  );
}

// ── Unit costs: Packaging, PRIVATE CARE and warranty ───────────────────────

function unitCostTable(ctx: ViewContext, items: UnitCostView[], admin: boolean, done: Done, caption: string): HTMLElement {
  const set = (u: UnitCostView) => {
    const values = unitCostFormValues(u);
    void openDialog({
      title: T.costTitle,
      eyebrow: `${T.title} · ${unitCostLabel(u.key)}`,
      fields: [
        { name: 'cost', label: 'Cost', required: true, maxlength: 12, value: values.cost, hint: T.costHint },
        { name: 'currency', label: 'Currency', required: true, maxlength: 3, value: values.currency, hint: T.currencyHint },
      ],
      validate: (v) => unitCostProblem(u, v),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setUnitCost(u.key, unitCostInput(v as UnitCostForm));
      },
    }).then(done(T.costSaved));
  };
  const clear = (u: UnitCostView) =>
    void confirmClear({ title: T.clearCostTitle, eyebrow: `${T.title} · ${unitCostLabel(u.key)}`, text: T.clearCostText, label: T.clear, submit: () => ctx.api.clearUnitCost(u.key) }).then(done(T.costCleared));
  return table<UnitCostView>(
    [
      { label: 'Cost of', cell: (u) => h('span', { data: { testid: 'margin-unit', key: u.key } }, unitCostLabel(u.key), h('span', { class: 'cell-sub' }, unitCostNote(u.key))), kind: ['wide'] },
      {
        label: 'Cost',
        cell: (u) => h('span', { class: [u.costMinor === null ? 'margin-settings__missing' : null], data: { testid: 'margin-unit-cost' } }, unitCostText(u)),
        kind: ['num', 'nowrap'],
      },
      {
        label: '',
        cell: (u) =>
          actions(
            admin,
            button(u.costMinor === null ? T.set : T.edit, { kind: 'ghost', testId: 'margin-unit-set', onClick: () => set(u) }),
            u.costMinor === null ? null : button(T.clear, { kind: 'ghost', testId: 'margin-unit-clear', onClick: () => clear(u) }),
          ),
        kind: ['actions', 'wrap'],
      },
    ],
    items,
    { caption },
  );
}

function packagingSection(ctx: ViewContext, s: MarginSettings, admin: boolean, done: Done): HTMLElement {
  return section(
    T.packaging,
    [
      h('p', { class: 'notice' }, T.packagingLead),
      unitCostTable(ctx, packagingKeys(s), admin, done, T.packaging),
      h('p', { class: 'margin-settings__line', data: { testid: 'margin-boxes-line' } }, `${T.boxesLine} `, h('a', { class: 'idlink', attrs: { href: href('settings') } }, T.boxesLink)),
    ],
    { id: 'margin-packaging' },
  );
}

function careSection(ctx: ViewContext, s: MarginSettings, admin: boolean, done: Done): HTMLElement {
  return section(
    T.care,
    [h('p', { class: 'notice' }, T.careLead), unitCostTable(ctx, careKeys(s), admin, done, T.care), h('p', { class: 'margin-settings__line', data: { testid: 'margin-care-hint' } }, T.careHint)],
    { id: 'margin-care' },
  );
}

// ── Returns and claims allowance ───────────────────────────────────────────

function allowanceSection(ctx: ViewContext, s: MarginSettings, admin: boolean, done: Done): HTMLElement {
  const rows = allowanceRows(s);
  const set = (a: AllowanceView) =>
    void openDialog({
      title: T.allowanceTitle,
      eyebrow: `${T.title} · ${a.name}`,
      fields: [{ name: 'percent', label: 'Allowance (%)', required: true, maxlength: 8, value: allowanceField(a.allowanceBp), hint: T.allowanceHint }],
      validate: (v) => allowanceProblem(a, v.percent),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setAllowance(a.categoryId, percentValue(v.percent));
      },
    }).then(done(T.allowanceSaved));
  const clear = (a: AllowanceView) =>
    void confirmClear({ title: T.clearAllowanceTitle, eyebrow: `${T.title} · ${a.name}`, text: T.clearAllowanceText, label: T.clear, submit: () => ctx.api.clearAllowance(a.categoryId) }).then(done(T.allowanceCleared));
  return section(
    T.allowance,
    [
      h('p', { class: 'notice' }, T.allowanceLead),
      table<AllowanceView>(
        [
          {
            label: 'Category',
            cell: (a) => h('span', { data: { testid: 'margin-category' } }, a.name, h('span', { class: 'cell-sub' }, a.active ? a.code : `${a.code} · ${T.inactive}`)),
            kind: ['wide'],
          },
          {
            label: 'Allowance',
            cell: (a) => h('span', { class: [a.allowanceBp === null ? 'margin-settings__missing' : null], data: { testid: 'margin-allowance' } }, allowanceText(a.allowanceBp)),
            kind: ['num', 'nowrap'],
          },
          {
            label: '',
            cell: (a) =>
              actions(
                admin,
                button(a.allowanceBp === null ? T.set : T.edit, { kind: 'ghost', testId: 'margin-allowance-set', onClick: () => set(a) }),
                a.allowanceBp === null ? null : button(T.clear, { kind: 'ghost', testId: 'margin-allowance-clear', onClick: () => clear(a) }),
              ),
            kind: ['actions', 'wrap'],
          },
        ],
        rows,
        { empty: T.allowanceEmpty, caption: T.allowance },
      ),
    ],
    { id: 'margin-allowance' },
  );
}
