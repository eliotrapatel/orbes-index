/**
 * CLUB > THE VAULT, `#/club?tab=vault` (lot Q3, step Q3.12; plan §4.1, §4.3, §4.4; vault/SCOPE.md E12 "the table, a
 * switch per source, GIVE A VAULT (collector or segment), the switch on each LIVE release, the report"), in the console's
 * existing patterns (D62: no console mockup): sections, tables, dialogs and definition lists as Club → Drops and Tiers.
 *
 *  - The table (OPERATOR edits; an AUDITOR reads): one row per reward in its order, its kind, what it is, its odds
 *    (1 IN N; I WAS THERE's published, the rest), quantity, given, left and state; New reward (a dialog by kind: the
 *    model picker, never a vault-only model for a product and only one for a VAULT EDITION; the add-on picker, add-ons of
 *    kind PRODUCT only, a SERVICE never offered, E7), Edit, Deactivate (never deleted), Activate, Up and Down. Under it
 *    the odds' sum and the floor's published odds; a save above one in one is refused in its words (VAULT_ODDS_OVER).
 *  - Sources (an ADMIN edits): each of the seven, its switch, vaults per occasion and its cap in its own words, OP-29's
 *    defaults beside (D27).
 *  - GIVE A VAULT (§4.4): to a collector (OPERATOR) or a segment (ADMIN), a note for Client Services never shown to the
 *    collector; the reach shown first (test entrants and inactive accounts left out, N25), then GIVE. The same dialog
 *    gives from the client sheet (views/owner.ts).
 *  - The report (§4.3, N29): a period of Paris days (the last 30 by default), the vaults by source and state, the rewards
 *    won by kind and by row with their count, value and cost, the credits given and used, the total cost, the
 *    quantities left; Download CSV. No REVOKE anywhere (N36).
 * Words in model/vault.ts; text through h() only (CSP-safe).
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate } from '../format.js';
import { can } from '../model/permissions.js';
import {
  capText,
  costText,
  givenText,
  giveInput,
  giveProblem,
  giveToOptions,
  moneyList,
  movedOrder,
  NEW_REWARD_KINDS,
  oddsSumLine,
  perOccasionText,
  reportPeriod,
  reportPeriodProblem,
  reportPeriodText,
  reportSummary,
  rewardAddonOptions,
  rewardFormValues,
  rewardInput,
  rewardModelOptions,
  rewardOddsLine,
  rewardProblem,
  rewardUnchanged,
  rewardWhat,
  rowOddsText,
  rowStatus,
  sourceDefaultText,
  sourceFormValues,
  sourceInput,
  sourceIsDefault,
  sourceProblem,
  sourceUnchanged,
  tableRows,
  takesAddon,
  takesAmount,
  takesModel,
  VAULT_CAP_SCOPES,
  VAULT_COPY as C,
  VAULT_KIND_HINTS,
  VAULT_KIND_LABELS,
  VAULT_LIMITS,
  VAULT_SOURCE_NAMES,
  VAULT_SOURCE_WHEN,
  reachLines,
  type RewardForm,
} from '../model/vault.js';
import { href } from '../router.js';
import { HOUSE_CURRENCIES, VAULT_REWARD_MODES, type AddonView, type Model, type SegmentName, type VaultGiven, type VaultReport, type VaultRewardSetting, type VaultSettings, type VaultSourceSetting } from '../types.js';
import type { AdminApi } from '../api.js';
import { busy, button, defList, field, filterBar, input, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The Club page's THE VAULT tab. */
export async function vaultTab(ctx: ViewContext): Promise<HTMLElement> {
  const role = ctx.session.admin.role;
  const period = reportPeriod(ctx.route.query);
  const [settings, models, addons, segments, report] = await Promise.all([
    ctx.api.vaultSettings(),
    ctx.api.models(),
    ctx.api.addons(),
    can(role, 'giveVaultToSegment') ? ctx.api.segmentNames() : Promise.resolve([] as SegmentName[]),
    ctx.api.vaultReport(period),
  ]);
  return h(
    'div',
    { class: 'vault', data: { testid: 'vault-tab' } },
    tableSection(ctx, settings, models.items, addons.items),
    sourcesSection(ctx, settings),
    giveSection(ctx, settings, segments),
    ...reportSections(ctx, report),
  );
}

const done = (ctx: ViewContext, msg: string) => (r: unknown) => {
  if (!r) return;
  notify(msg);
  ctx.reload();
};

// ── The table ─────────────────────────────────────────────────────────────────────────────────────────────────

function tableSection(ctx: ViewContext, s: VaultSettings, models: readonly Model[], addons: readonly AddonView[]): HTMLElement {
  const manage = can(ctx.session.admin.role, 'manageVaultTable');
  const rows = tableRows(s);

  const fields = (r: VaultRewardSetting | null, v: RewardForm): DialogField[] => {
    const kindOf = (x: Record<string, string>) => (r ? r.kind : x.kind);
    const form = (x: Record<string, string>) => ({ kind: kindOf(x), productOf: x.productOf ?? 'MODEL' });
    return [
      ...(r ? [] : [{ name: 'kind', label: 'Kind', kind: 'select' as const, required: true, options: NEW_REWARD_KINDS.map((k) => ({ value: k, label: VAULT_KIND_LABELS[k] })), value: v.kind }]),
      { name: 'amount', label: 'Amount', maxlength: 12, value: v.amount, hint: 'In units: 25, or 25.50.', shown: (x) => takesAmount(kindOf(x)) },
      { name: 'currency', label: 'Currency', kind: 'select', options: HOUSE_CURRENCIES.map((c) => ({ value: c, label: c })), value: v.currency, shown: (x) => takesAmount(kindOf(x)) },
      {
        name: 'productOf',
        label: 'From the catalogue',
        kind: 'select',
        options: [
          { value: 'MODEL', label: 'A model' },
          { value: 'ADDON', label: 'An add-on' },
        ],
        value: v.productOf,
        shown: (x) => kindOf(x) === 'PRODUCT',
      },
      { name: 'modelId', label: 'Model', kind: 'select', options: rewardModelOptions(models, 'PRODUCT', r?.modelId ?? null), value: v.modelId, hint: 'A model sold: a vault-only model is a VAULT EDITION.', shown: (x) => kindOf(x) === 'PRODUCT' && takesModel(form(x)) },
      { name: 'editionModelId', label: 'Vault-only model', kind: 'select', options: rewardModelOptions(models, 'VAULT_EDITION', r?.modelId ?? null), value: v.modelId, hint: 'Marked VAULT ONLY in the Catalogue’s model form.', shown: (x) => kindOf(x) === 'VAULT_EDITION' },
      { name: 'addonId', label: 'Add-on', kind: 'select', options: rewardAddonOptions(addons, r?.addonId ?? null), value: v.addonId, hint: 'Add-ons of kind PRODUCT only: a service is never a reward.', shown: (x) => takesAddon(form(x)) },
      { name: 'mode', label: 'Given', kind: 'select', options: VAULT_REWARD_MODES.map((m) => ({ value: m, label: m === 'FREE' ? 'FREE: an order at 0, claimed within 30 days' : 'RIGHT TO BUY: 24 hours, at its usual price' })), value: v.mode, shown: (x) => kindOf(x) === 'PRODUCT' },
      { name: 'line', label: 'Its line', maxlength: VAULT_LIMITS.line, value: v.line, hint: 'Under its name at the reveal. Empty: the house’s line.', shown: (x) => kindOf(x) === 'VAULT_EDITION' },
      { name: 'oddsIn', label: 'Odds', required: true, maxlength: 7, value: v.oddsIn, hint: 'One in this number: 200 reads 1 IN 200.' },
      { name: 'quantity', label: 'Quantity', required: true, maxlength: 9, value: v.quantity, hint: r ? `The limit, at least what was given (${formatCount(r.given)}). Once reached, its chance goes to I WAS THERE.` : 'The limit. Once reached, its chance goes to I WAS THERE.' },
      ...(r ? [{ name: 'active', label: 'Active', kind: 'checkbox' as const, value: v.active, hint: 'Inactive, it is never drawn; the vaults it gave keep what they held.' }] : []),
    ];
  };
  // The vault-only model has its own picker: the form's model is the one shown for the kind.
  const values = (x: Record<string, string>, kind: string): Record<string, string> => (kind === 'VAULT_EDITION' ? { ...x, modelId: x.editionModelId ?? '' } : x);

  const open = (r: VaultRewardSetting | null) => {
    const v = rewardFormValues(r);
    void openDialog({
      title: r ? C.editReward : C.newReward,
      eyebrow: r ? `${C.eyebrow} · ${VAULT_KIND_LABELS[r.kind]}` : C.eyebrow,
      body: r ? h('p', { class: 'dialog__text' }, `${rewardWhat(r)}. Its kind never changes: add another row.`) : undefined,
      fields: fields(r, v),
      live: (x) => {
        const kind = r ? r.kind : x.kind;
        const line = rewardOddsLine(s, x, r);
        return [
          h('p', { class: 'dialog__text soft', data: { testid: 'vault-kind-hint' } }, VAULT_KIND_HINTS[kind as keyof typeof VAULT_KIND_HINTS] ?? ''),
          line ? h('p', { class: 'dialog__text', data: { testid: 'vault-odds-preview' } }, line) : null,
        ];
      },
      validate: (x) => {
        const kind = r ? r.kind : x.kind;
        const vals = values(x, kind);
        return rewardProblem(s, vals, r, addons) ?? (r && rewardUnchanged(r, vals) ? 'Nothing has changed.' : null);
      },
      confirmLabel: r ? 'Save reward' : 'Add reward',
      submit: async (x) => {
        const kind = r ? r.kind : x.kind;
        const vals = { ...values(x, kind), kind };
        if (r) await ctx.api.updateVaultReward(r.id, rewardInput(vals, { withKind: false }));
        else await ctx.api.createVaultReward(rewardInput(vals, { withKind: true }));
      },
    }).then(done(ctx, r ? C.saved : C.added));
  };

  const deactivate = (r: VaultRewardSetting) =>
    void openDialog({
      title: 'Deactivate the reward',
      eyebrow: `${C.eyebrow} · ${VAULT_KIND_LABELS[r.kind]}`,
      body: h('p', { class: 'dialog__text' }, `${rewardWhat(r)}: never drawn from now on, its chance to I WAS THERE. It is never deleted: the vaults it gave keep what they held, and Edit makes it active again.`),
      confirmLabel: C.deactivate,
      submit: async () => {
        await ctx.api.deactivateVaultReward(r.id);
      },
    }).then(done(ctx, C.deactivated));

  const activate = (r: VaultRewardSetting) =>
    void openDialog({
      title: 'Activate the reward',
      eyebrow: `${C.eyebrow} · ${VAULT_KIND_LABELS[r.kind]}`,
      body: h('p', { class: 'dialog__text' }, `${rewardWhat(r)}: drawn again at ${rowOddsText(r, s.floor)}, while the odds of the active rewards stay within one in one.`),
      confirmLabel: C.activate,
      submit: async () => {
        await ctx.api.updateVaultReward(r.id, rewardInput({ ...rewardFormValues(r), kind: r.kind, active: 'true' }, { withKind: false }));
      },
    }).then(done(ctx, C.activated));

  const move = (r: VaultRewardSetting, by: -1 | 1, btn: HTMLButtonElement) => {
    const ids = movedOrder(rows, r.id, by);
    if (!ids) return;
    void busy(btn, async () => {
      try {
        await ctx.api.orderVaultRewards(ids);
        notify(C.moved);
        ctx.reload();
      } catch (e) {
        notifyError(e);
      }
    });
  };

  const columns: Column<VaultRewardSetting>[] = [
    {
      label: 'Kind',
      cell: (r) => h('span', null, h('span', { data: { testid: 'vault-row-kind' } }, VAULT_KIND_LABELS[r.kind]), r.rare ? h('span', { class: 'cell-sub' }, 'RARE') : null),
      kind: ['nowrap'],
    },
    { label: 'What it is', cell: (r) => h('span', { data: { testid: 'vault-row-what' } }, rewardWhat(r)), kind: ['wide'] },
    { label: 'Odds', cell: (r) => h('span', { data: { testid: 'vault-row-odds' } }, rowOddsText(r, s.floor)), kind: ['nowrap'] },
    { label: 'Quantity', cell: (r) => (r.quantity === null ? '—' : formatCount(r.quantity)), kind: ['num'] },
    { label: 'Given', cell: (r) => formatCount(r.given), kind: ['num'] },
    { label: 'Left', cell: (r) => h('span', { data: { testid: 'vault-row-left' } }, r.left === null ? '—' : formatCount(r.left)), kind: ['num'] },
    {
      label: 'State',
      cell: (r) => {
        const st = rowStatus(r);
        return h('span', { data: { testid: 'vault-row-state' } }, statusMark(st.text, st.tone));
      },
      kind: ['nowrap'],
    },
  ];
  if (manage) {
    columns.push({
      label: 'Action',
      kind: ['actions', 'wrap'],
      cell: (r) => {
        const i = rows.indexOf(r);
        const up = button(C.up, { kind: 'ghost', testId: 'vault-row-up' });
        const down = button(C.down, { kind: 'ghost', testId: 'vault-row-down' });
        up.disabled = i === 0;
        down.disabled = i === rows.length - 1;
        up.addEventListener('click', () => move(r, -1, up));
        down.addEventListener('click', () => move(r, 1, down));
        // Two pairs (the row's own, its place) that wrap as pairs on a narrow screen, never one button alone.
        return h(
          'span',
          { class: 'row-actions' },
          r.kind === 'I_WAS_THERE'
            ? null
            : h(
                'span',
                { class: 'row-actions vault__pair' },
                button('Edit', { kind: 'ghost', testId: 'vault-row-edit', onClick: () => open(r) }),
                r.active ? button(C.deactivate, { kind: 'ghost', testId: 'vault-row-deactivate', onClick: () => deactivate(r) }) : button(C.activate, { kind: 'ghost', testId: 'vault-row-activate', onClick: () => activate(r) }),
              ),
          rows.length > 1 ? h('span', { class: 'row-actions vault__pair' }, up, down) : null,
        );
      },
    });
  }
  return section(
    C.table,
    [
      h('p', { class: 'notice' }, C.tableNote),
      h('div', { data: { testid: 'vault-table' } }, table(columns, rows, { caption: C.table })),
      h('p', { class: 'footnote', data: { testid: 'vault-odds-sum' } }, oddsSumLine(s)),
      rows.length === 1 ? h('p', { class: 'footnote', data: { testid: 'vault-floor-only' } }, C.noReward) : null,
    ],
    { id: 'vault-table', tools: manage ? [button(C.newReward, { kind: 'primary', testId: 'vault-new-reward', onClick: () => open(null) })] : [] },
  );
}

// ── Sources ───────────────────────────────────────────────────────────────────────────────────────────────────

function sourcesSection(ctx: ViewContext, s: VaultSettings): HTMLElement {
  const admin = can(ctx.session.admin.role, 'manageVaultSources');
  const edit = (x: VaultSourceSetting) => {
    const v = sourceFormValues(x);
    const capped = VAULT_CAP_SCOPES[x.source] !== null;
    void openDialog({
      title: `${VAULT_SOURCE_NAMES[x.source]}`,
      eyebrow: `${C.eyebrow} · ${C.sources}`,
      body: [h('p', { class: 'dialog__text' }, VAULT_SOURCE_WHEN[x.source]), h('p', { class: 'dialog__text soft' }, sourceDefaultText(x.source))],
      fields: [
        { name: 'enabled', label: 'On', kind: 'checkbox', value: v.enabled, hint: 'Off: this occasion gives no vault from now on; the vaults given stay.' },
        { name: 'perOccasion', label: 'Vaults per occasion', required: true, maxlength: 2, value: v.perOccasion, hint: `From ${VAULT_LIMITS.perOccasion.min} to ${VAULT_LIMITS.perOccasion.max}.` },
        ...(capped
          ? [{ name: 'cap', label: `Cap, ${VAULT_CAP_SCOPES[x.source]}`, required: true, maxlength: 3, value: v.cap, hint: `How many times an account receives them ${VAULT_CAP_SCOPES[x.source]}: from ${VAULT_LIMITS.cap.min} to ${VAULT_LIMITS.cap.max}.${x.source === 'LIVE' ? ' The terms say a LIVE release gives at most one vault per account: change them before raising it.' : ''}` }]
          : []),
      ],
      validate: (val) => sourceProblem(x.source, val) ?? (sourceUnchanged(x, val) ? 'Nothing has changed.' : null),
      confirmLabel: 'Save source',
      submit: async (val) => {
        await ctx.api.setVaultSource(x.source, sourceInput(x.source, val));
      },
    }).then(done(ctx, C.sourceSaved));
  };
  const columns: Column<VaultSourceSetting>[] = [
    { label: 'Source', cell: (x) => h('span', null, h('span', { data: { testid: 'vault-source-name' } }, VAULT_SOURCE_NAMES[x.source]), h('span', { class: 'cell-sub' }, VAULT_SOURCE_WHEN[x.source])), kind: ['wide'] },
    { label: 'Switch', cell: (x) => h('span', { data: { testid: 'vault-source-switch' } }, statusMark(x.enabled ? 'ON' : 'OFF', x.enabled ? 'solid' : 'muted')), kind: ['nowrap'] },
    { label: 'Per occasion', cell: (x) => perOccasionText(x.perOccasion), kind: ['nowrap'] },
    {
      label: 'Cap',
      cell: (x) => h('span', null, h('span', { data: { testid: 'vault-source-cap' } }, capText(x.source, x.cap)), h('span', { class: 'cell-sub' }, sourceIsDefault(x) ? 'The default' : sourceDefaultText(x.source))),
    },
    { label: 'Changed', cell: (x) => (x.updatedBy ? h('span', null, formatDate(x.updatedAt), h('span', { class: 'cell-sub' }, x.updatedBy.email)) : '—'), kind: ['nowrap'] },
  ];
  if (admin) columns.push({ label: 'Action', kind: ['actions'], cell: (x) => button('Edit', { kind: 'ghost', testId: `vault-source-edit-${x.source}`, onClick: () => edit(x) }) });
  return section(C.sources, [h('p', { class: 'notice' }, C.sourcesNote), h('div', { data: { testid: 'vault-sources' } }, table(columns, s.sources, { caption: C.sources }))], { id: 'vault-sources' });
}

// ── GIVE A VAULT ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * GIVE A VAULT (§4.4): the first dialog names the collector (or the segment, an ADMIN's) and the note for Client Services,
 * reads the reach (a dry run); the second shows it and gives. `accountId`: the client sheet's collector, named already.
 * The press's own id (`giftId`) is kept while the dialog is open, so a GIVE sent again after a failure skips the members
 * already reached.
 */
export async function giveVaultDialog(ctx: ViewContext, opts: { accountId?: string; email?: string; segments?: readonly SegmentName[]; perOccasion?: number } = {}): Promise<boolean> {
  const api: AdminApi = ctx.api;
  const admin = can(ctx.session.admin.role, 'giveVaultToSegment') && !opts.accountId;
  const segments = opts.segments ?? [];
  let reach: VaultGiven | null = null;
  const first = await openDialog({
    title: C.giveTitle,
    eyebrow: opts.email ? `${C.eyebrow} · ${opts.email}` : C.eyebrow,
    body: h('p', { class: 'dialog__text' }, C.giveText),
    fields: [
      ...(admin && segments.length ? [{ name: 'to', label: 'To', kind: 'select' as const, options: giveToOptions(true), value: 'COLLECTOR' }] : []),
      ...(opts.accountId ? [] : [{ name: 'email', label: 'Collector’s email', kind: 'email' as const, maxlength: 254, value: '', shown: (x: Record<string, string>) => x.to !== 'SEGMENT' }]),
      ...(admin && segments.length
        ? [{ name: 'segmentId', label: 'Segment', kind: 'select' as const, options: [{ value: '', label: 'Choose a segment' }, ...segments.map((x) => ({ value: x.id, label: x.name }))], value: '', hint: 'Its members as it reads now: one vault to each.', shown: (x: Record<string, string>) => x.to === 'SEGMENT' }]
        : []),
      { name: 'note', label: 'Note for Client Services', kind: 'textarea', rows: 3, maxlength: VAULT_LIMITS.note, value: '', hint: 'Why it is given. Never shown to the collector.' },
    ],
    validate: (x) => (opts.accountId ? ((x.note ?? '').trim().length > VAULT_LIMITS.note ? `The note: at most ${VAULT_LIMITS.note} characters.` : null) : giveProblem(x)),
    confirmLabel: 'Show the reach',
    working: 'Reading…',
    submit: async (x) => {
      reach = await api.giveVault(giveInput(x, { accountId: opts.accountId, dryRun: true }));
    },
  });
  if (!first || !reach) return false;
  const read: VaultGiven = reach;
  const perOccasion = opts.perOccasion ?? (await api.vaultSettings().then((s) => s.sources.find((x) => x.source === 'HOUSE')?.perOccasion ?? 1).catch(() => 1));
  const giftId = crypto.randomUUID();
  let given: VaultGiven | null = null;
  const second = await openDialog({
    title: C.giveTitle,
    eyebrow: opts.email ? `${C.eyebrow} · ${opts.email}` : C.eyebrow,
    body: [
      h('div', { data: { testid: 'vault-give-reach' } }, ...reachLines(read, perOccasion).map((l) => h('p', { class: 'dialog__text' }, l))),
      first.note?.trim() ? h('p', { class: 'dialog__text soft' }, `Note for Client Services: ${first.note.trim()}`) : null,
    ],
    confirmLabel: 'Give',
    validate: () => (read.reach === 0 ? 'Nobody to give a vault to.' : null),
    submit: async () => {
      given = await api.giveVault(giveInput(first, { accountId: opts.accountId, dryRun: false, giftId }));
    },
  });
  if (!second || !given) return false;
  notify(givenText(given));
  return true;
}

function giveSection(ctx: ViewContext, s: VaultSettings, segments: readonly SegmentName[]): HTMLElement {
  const house = s.sources.find((x) => x.source === 'HOUSE');
  const give = () => void giveVaultDialog(ctx, { segments, perOccasion: house?.perOccasion }).then((ok) => ok && ctx.reload(), notifyError);
  return section(
    C.giveSection,
    defList([
      { label: 'From', value: 'THE HOUSE', note: house ? `${house.enabled ? 'On' : 'Off: switch it on in Sources first'} · ${perOccasionText(house.perOccasion)} to each` : undefined },
      { label: 'How', value: h('span', { class: 'cell-details' }, C.giveText) },
    ]),
    { id: 'vault-give', tools: can(ctx.session.admin.role, 'giveVault') ? [button(C.give, { kind: 'primary', testId: 'vault-give', onClick: give })] : [] },
  );
}

// ── The report ────────────────────────────────────────────────────────────────────────────────────────────────

function reportSections(ctx: ViewContext, r: VaultReport): HTMLElement[] {
  const go = (from: string, to: string) => ctx.navigate(href('club', {}, { tab: 'vault', from, to }), { keepScroll: true });
  const from = input('from', { type: 'date', value: r.from });
  const to = input('to', { type: 'date', value: r.to });
  from.setAttribute('data-testid', 'vault-report-from');
  to.setAttribute('data-testid', 'vault-report-to');
  const problem = h('p', { class: 'returns__problem', attrs: { role: 'alert' } });
  const apply = button(C.apply, { kind: 'secondary', testId: 'vault-report-apply' });
  apply.addEventListener('click', () => {
    const bad = reportPeriodProblem(from.value, to.value);
    if (bad) {
      problem.textContent = bad;
      return;
    }
    go(from.value, to.value);
  });
  const csv = button(C.csv, { kind: 'ghost', testId: 'vault-report-csv' });
  csv.addEventListener('click', () =>
    void busy(csv, async () => {
      try {
        saveDownload(await ctx.api.vaultReportCsv({ from: r.from, to: r.to }));
      } catch (e) {
        notifyError(e);
      }
    }),
  );

  const kindColumns: Column<VaultReport['byKind'][number]>[] = [
    { label: 'Kind', cell: (x) => VAULT_KIND_LABELS[x.kind], kind: ['wide'] },
    { label: 'Won', cell: (x) => formatCount(x.won), kind: ['num'] },
    { label: 'Value', cell: (x) => moneyList(x.value), kind: ['nowrap'] },
    { label: 'Cost', cell: (x) => costText(x), kind: ['nowrap'] },
  ];
  const rowColumns: Column<VaultReport['rows'][number]>[] = [
    { label: 'Reward', cell: (x) => h('span', null, VAULT_KIND_LABELS[x.kind], h('span', { class: 'cell-sub' }, rewardWhat(x))), kind: ['wide'] },
    { label: 'Won', cell: (x) => formatCount(x.won), kind: ['num'] },
    { label: 'Value', cell: (x) => moneyList(x.value), kind: ['nowrap'] },
    { label: 'Cost', cell: (x) => costText(x), kind: ['nowrap'] },
    { label: 'Left', cell: (x) => h('span', { data: { testid: 'vault-report-left' } }, x.left === null ? '—' : `${formatCount(x.left)} of ${formatCount(x.quantity ?? 0)}`), kind: ['nowrap'] },
  ];
  const sourceColumns: Column<VaultReport['given'][number]>[] = [
    { label: 'Source', cell: (x) => VAULT_SOURCE_NAMES[x.source], kind: ['wide'] },
    { label: 'Given', cell: (x) => formatCount(x.count), kind: ['num'] },
  ];
  return [
    section(
      C.report,
      [
        h('div', { class: 'returns__filters', data: { testid: 'vault-report-filters' } }, filterBar(field(C.from, from), field(C.to, to), h('div', { class: 'cfield returns__apply' }, apply), problem)),
        h(
          'p',
          { class: 'board__summary', data: { testid: 'vault-report-summary' } },
          h('span', { class: 'board__figures' }, reportSummary(r)),
          h('span', { class: 'board__delays', data: { testid: 'vault-report-period' } }, reportPeriodText(r)),
        ),
        defList([
          { label: 'Total cost', value: h('span', { data: { testid: 'vault-report-cost' } }, costText({ cost: r.totalCost, costUnknown: r.costUnknown })), note: 'Credits at face value; a piece or an add-on given free at its supplier unit price where known, else unknown. Shipping and packaging apart.' },
          { label: 'Credits given', value: h('span', { data: { testid: 'vault-report-credits-given' } }, moneyList(r.credits.given)) },
          { label: 'Credits used', value: h('span', { data: { testid: 'vault-report-credits-used' } }, moneyList(r.credits.used)) },
        ]),
        h('div', { data: { testid: 'vault-report-sources' } }, table(sourceColumns, r.given, { caption: 'Vaults given by source' })),
      ],
      { id: 'vault-report', tools: [csv] },
    ),
    section(
      'Rewards won',
      [
        h('div', { data: { testid: 'vault-report-kinds' } }, table(kindColumns, r.byKind, { caption: 'Rewards won by kind' })),
        h('div', { data: { testid: 'vault-report-rows' } }, table(rowColumns, r.rows, { caption: 'Rewards won by row' })),
      ],
      { id: 'vault-report-won', note: reportPeriodText(r) },
    ),
  ];
}
