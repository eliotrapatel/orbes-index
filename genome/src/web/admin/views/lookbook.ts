/**
 * A model's lookbook (P-R02), `#/catalogue/:modelId`, reached from the
 * Catalogue's model row (Lookbook) and from no link of the sidebar. What its
 * sheet shows on /verify (THE COLLECTION) is set here:
 *
 *  - Publication: its place, Hidden, Public (everyone) or Reserved (the
 *    owners of an ORBES piece), and the address of its sheet (proposed from
 *    its name; fixed once first published);
 *  - Private salon (P-X08): a Reserved model's price, as THE PRIVATE SALON
 *    shows it, and the tier it is shown from (TITANE, PLATINE, PALLADIUM);
 *  - Story: plain paragraphs, previewed as the client reads them (shared
 *    renderer, src/web/shared/lookbook.ts), since a hidden model's sheet
 *    answers 404 in public;
 *  - Specifications: one `Label: value` line each, previewed as rows;
 *  - Gallery: the reference photograph is the cover (Catalogue → Photo);
 *    up to eight more, each added through the photograph dialog (re-encoded
 *    by the canvas, ui/photo.ts), moved earlier or later, given its
 *    alternative text, or removed;
 *  - Variants (plan NOCTURNE, N1): its label among its model's dots and the
 *    dot's colour, its variants (each its dot, its page), and ADD A VARIANT:
 *    a model copied from this one (type, collection, story, specifications
 *    and care), asked its label, colour and SKU prefix, then its reference
 *    photograph; its page opens next, for its gallery, material, prices and
 *    publication. A variant's page names its main model.
 *  - Sizes (plan NEXT-NINE, AC-01; plan NEXT LOT §3.3): its size type (To
 *    give until it is given) and its declared sizes, each its own SKU, offered
 *    or set aside: Edit size type, Tick sizes (a ring, a bracelet, a
 *    necklace), Remove (removed when unused, otherwise set aside) and
 *    Reinstate; which saved size of a collector (YOUR SIZES) preselects the
 *    model's size, and the measures each of its sizes fits. ADD A VARIANT
 *    copies its offered sizes (and asks its size type when it has none).
 *  - Pairs well with (plan NEXT-NINE, BP-34), last as on the sheet: the two
 *    or three models its sheet ends with, in their order, each with whether
 *    the sheet shows it; none picked, what it shows now; Edit pairs, three
 *    selects. A variant's page links to its main model, where they are set.
 *
 * OPERATOR edits (editCatalog, photograph), an AUDITOR reads. Each change is
 * one request, audited by the server (model.update, model.gallery.*,
 * model.sizes.update, model.sizes.declare, model.pairs), then
 * the page is read again.
 */
import { h } from '../../shared/dom.js';
import { specRows, storyBlock } from '../../shared/lookbook.js';
import { formatDate, humanize } from '../format.js';
import {
  defaultAlt,
  GALLERY_ALT_MAX,
  GALLERY_MAX,
  galleryImpact,
  galleryMoved,
  galleryWithAlt,
  LOOKBOOK_STATE_OPTIONS,
  publicationChange,
  publicationForm,
  publicationImpact,
  publicationProblem,
  PRICE_LABEL_MAX,
  SALON_TIER_OPTIONS,
  salonChange,
  salonForm,
  salonImpact,
  salonProblem,
  salonTierName,
  sheetAddress,
  specsProblem,
  textChange,
  type PublicationForm,
} from '../model/lookbook.js';
import { can } from '../model/permissions.js';
import { modelPhotoImpact } from '../model/photo.js';
import { lookbookWord, pairFormValues, pairModelLabel, pairOptions, pairsChange, pairsNote, pairsProblem, PAIRS_TEXT, shownLabel, shownNow } from '../model/pairs.js';
import {
  canTick,
  effectiveKind,
  fitChange,
  fitChanged,
  fitFormValues,
  fitProblem,
  fitsText,
  fitUnitLabel,
  initiallyTicked,
  offListWarning,
  preselectedType,
  reinstateDialog,
  removable,
  removeDialog,
  SIZE_TYPE_WORDS,
  sizesCountLine,
  sizeState,
  sizeText,
  sizeTypeChange,
  sizeTypeLive,
  sizeTypeOptions,
  sizeTypeRow,
  sizeTypeText,
  SIZES_TEXT,
  tickChanges,
  tickedOf,
  tickField,
  tickLine,
  tickProblem,
  variantSizesLine,
  VARIANT_IMPACT,
} from '../model/sizes.js';
import { toneOf } from '../model/tone.js';
import { dotChange, dotFormValues, dotProblem, keepsLabel, proposeVariantPrefix, VARIANT_LABEL_MAX, variantFormValues, variantInput, variantProblem } from '../model/variants.js';
import { href } from '../router.js';
import type { GalleryImage, Model, ModelPair, ModelSizeRow, ModelVariant, SizeType } from '../types.js';
import { button, checkbox, defList, emptyState, linkButton, mono, pageHeader, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { photoDialog, photoThumb } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/**
 * A model created with a ring's, a bracelet's or a necklace's size type (plan NEXT LOT §3.3 item 6b): its page opens on
 * the Sizes dialog at once, once. Set by the Catalogue's New model.
 */
let pendingTick: string | null = null;
export function tickSizesOnOpen(modelId: string): void {
  pendingTick = modelId;
}

export async function lookbookView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.modelId ?? '';
  const [m, sizing] = await Promise.all([ctx.api.model(id), ctx.api.modelSizes(id)]);
  const role = ctx.session.admin.role;
  const canEdit = can(role, 'editCatalog');
  const canPhotograph = can(role, 'photograph');
  const eyebrow = `${humanize(m.name)} · ${m.skuPrefix}`;
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  // ── Publication ──────────────────────────────────────────────────────────
  const editPublication = () => {
    const form = publicationForm(m);
    void openDialog({
      title: 'Publication',
      eyebrow,
      body: h('p', { class: 'dialog__text', data: { testid: 'lookbook-impact' } }, publicationImpact(m)),
      fields: [
        { name: 'lookbook', label: 'Place in the lookbook', kind: 'select', options: [...LOOKBOOK_STATE_OPTIONS], value: form.lookbook },
        ...(m.publishedAt
          ? []
          : [{ name: 'slug', label: 'Address', maxlength: 80, value: form.slug, hint: 'Lower-case words joined by hyphens: /verify/lookbook/monolithe-ring. Proposed from the name.' }]),
      ],
      validate: (v) => {
        const f: PublicationForm = { lookbook: v.lookbook, slug: v.slug ?? m.slug ?? '' };
        return publicationProblem(m, f) ?? (Object.keys(publicationChange(m, f)).length === 0 ? 'Nothing has changed.' : null);
      },
      confirmLabel: 'Save publication',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, publicationChange(m, { lookbook: v.lookbook, slug: v.slug ?? m.slug ?? '' }));
      },
    }).then(done('Publication saved.'));
  };

  const address = m.slug ? sheetAddress(m.slug) : null;
  const publication = section(
    'Publication',
    defList([
      { label: 'Place', value: h('span', { data: { testid: 'lookbook-state' } }, statusMark(m.lookbook, toneOf('lookbook', m.lookbook))) },
      {
        label: 'Address',
        value: address
          ? m.lookbook === 'PUBLIC'
            ? h('a', { class: 'mono', attrs: { href: address, target: '_blank', rel: 'noopener', 'data-testid': 'lookbook-address' } }, address)
            : h('span', { data: { testid: 'lookbook-address' } }, mono(address))
          : '—',
        note: m.publishedAt ? 'Fixed since its first publication: links to its sheet are out.' : undefined,
      },
      { label: 'First published', value: m.publishedAt ? formatDate(m.publishedAt) : 'Never' },
    ]),
    { id: 'publication', tools: canEdit ? [button('Edit', { kind: 'ghost', testId: 'lookbook-edit', onClick: editPublication })] : [] },
  );

  // ── Variants (NOCTURNE N1) ───────────────────────────────────────────────
  const editDot = () =>
    void openDialog({
      title: 'Label and colour',
      eyebrow,
      body: h(
        'p',
        { class: 'dialog__text', data: { testid: 'variant-dot-impact' } },
        keepsLabel(m)
          ? 'Its name among its model’s dots, and the dot’s colour, as THE COLLECTION shows them. A variant, and a model with variants, keep theirs.'
          : 'Its name among its model’s dots once it has variants, and the dot’s colour. Empty: none.',
      ),
      fields: [
        { name: 'label', label: 'Label', maxlength: VARIANT_LABEL_MAX, value: dotFormValues(m).label, hint: 'One line: Steel.' },
        { name: 'swatch', label: 'Colour', kind: 'color', value: dotFormValues(m).swatch },
      ],
      validate: (v) => dotProblem(m, v, siblingLabels(m)) ?? (Object.keys(dotChange(m, v)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save label',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, dotChange(m, v));
      },
    }).then(done('Label saved.'));

  // ADD A VARIANT: a model copied from this one; its reference photograph next, then its own page.
  const addVariant = () => {
    let created: Model | null = null;
    const withPrefix = (v: Record<string, string>) => ({ ...v, skuPrefix: v.skuPrefix?.trim() ? v.skuPrefix : proposeVariantPrefix(m, v.label) });
    const values = variantFormValues(m);
    void openDialog({
      title: 'Add a variant',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text', data: { testid: 'variant-impact' } }, VARIANT_IMPACT),
        m.variantLabel === null ? h('p', { class: 'dialog__text' }, 'This model is one of the dots too: give it its own label and colour.') : null,
      ],
      fields: [
        ...(m.variantLabel === null
          ? [
              { name: 'mainLabel', label: 'This model’s label', required: true, maxlength: VARIANT_LABEL_MAX, value: values.mainLabel, hint: 'One line: Steel.' },
              { name: 'mainSwatch', label: 'This model’s colour', kind: 'color' as const, value: values.mainSwatch },
            ]
          : []),
        { name: 'label', label: 'Label', required: true, maxlength: VARIANT_LABEL_MAX, value: values.label, hint: 'Its name among the dots: Blue.' },
        { name: 'swatch', label: 'Colour', kind: 'color', value: values.swatch },
        { name: 'skuPrefix', label: 'SKU prefix', maxlength: 32, value: values.skuPrefix, hint: 'Its own, never changed: it starts every SKU issued with it. Empty: the one proposed below.' },
        // Plan NEXT LOT §3.3 item 6: a variant made now is a new model, given its size type; its main model's when it has one.
        ...(sizing.sizeType === null
          ? [{ name: 'sizeType', label: 'Size type', kind: 'select' as const, required: true, options: sizeTypeOptions(null), value: preselectedType(null, effectiveKind(sizing), m.type) }]
          : []),
      ],
      live: (v) => {
        const sizesLine = variantSizesLine(sizing, withPrefix(v).skuPrefix.trim().toUpperCase());
        return [
          h('p', { class: 'dialog__text', data: { testid: 'variant-prefix' } }, `SKU prefix: ${withPrefix(v).skuPrefix || '—'}`),
          sizesLine ? h('p', { class: 'dialog__text', data: { testid: 'variant-sizes' } }, sizesLine) : null,
        ];
      },
      validate: (v) => variantProblem(m, withPrefix(v)),
      confirmLabel: 'Add the variant',
      submit: async (v) => {
        created = await ctx.api.createVariant(m.id, variantInput({ variantLabel: m.variantLabel, sizeType: sizing.sizeType }, withPrefix(v)));
      },
    }).then(async (r) => {
      const v = created;
      if (!r || !v) return;
      notify('Variant added.');
      if (canPhotograph) {
        await photoDialog({
          title: 'Reference photograph',
          eyebrow: `${humanize(v.name)} · ${v.skuPrefix}`,
          impact: modelPhotoImpact(0),
          current: null,
          currentAlt: '',
          save: async (photo) => {
            await ctx.api.setModelImage(v.id, photo);
          },
          // No photograph is in place yet: nothing to remove.
          remove: async () => {},
        });
      }
      location.hash = href('model', { modelId: v.id });
    });
  };

  const variantColumns: Column<ModelVariant>[] = [
    { label: 'Variant', cell: (v) => dotLabel(v.swatch, v.label), kind: ['nowrap'] },
    { label: 'Photo', cell: (v) => photoThumb(v.imageUrl, `${humanize(v.name)}${v.label ? ` in ${v.label}` : ''}: reference photograph`), kind: ['nowrap'] },
    { label: 'SKU prefix', cell: (v) => mono(v.skuPrefix), kind: ['nowrap'] },
    { label: 'Lookbook', cell: (v) => statusMark(v.lookbook, toneOf('lookbook', v.lookbook)), kind: ['nowrap'] },
    { label: 'Status', cell: (v) => (v.active ? 'ACTIVE' : 'INACTIVE'), kind: ['nowrap'] },
    { label: 'Action', kind: ['actions'], cell: (v) => withTestId(linkButton('Open', href('model', { modelId: v.id }), 'ghost'), 'variant-open') },
  ];
  const variants = section(
    'Variants',
    m.variantOf
      ? defList([
          {
            label: 'Variant of',
            value: h('a', { attrs: { href: href('model', { modelId: m.variantOf.id }), 'data-testid': 'variant-main' } }, `${humanize(m.variantOf.name)}${m.variantOf.label ? ` · ${humanize(m.variantOf.label)}` : ''}`),
            note: 'Its other variants are on its main model’s page, where one is added.',
          },
          { label: 'Its dot', value: h('span', { data: { testid: 'variant-own' } }, dotLabel(m.variantSwatch, m.variantLabel)) },
        ])
      : [
          defList([
            {
              label: 'This model',
              value: h('span', { data: { testid: 'variant-own' } }, dotLabel(m.variantSwatch, m.variantLabel)),
              note: m.variantLabel === null ? 'No label yet: its first variant gives it one, as it is one of the dots.' : undefined,
            },
          ]),
          h('div', { data: { testid: 'variant-list' } }, table(variantColumns, m.variants, { empty: 'No variant yet.', caption: 'Variants' })),
        ],
    {
      id: 'variants',
      note: m.variantOf ? 'A variant' : `${m.variants.length} ${m.variants.length === 1 ? 'variant' : 'variants'}`,
      tools: canEdit
        ? [
            button('Edit label', { kind: 'ghost', testId: 'variant-dot-edit', onClick: editDot }),
            ...(m.variantOf ? [] : [button('Add a variant', { kind: 'ghost', testId: 'variant-add', onClick: addVariant })]),
          ]
        : [],
    },
  );

  // ── Sizes (AC-01; plan NEXT LOT §3.3) ──────────────────────────────────
  const kind = effectiveKind(sizing);
  const type = sizing.sizeType;
  const editType = () =>
    void openDialog({
      title: 'Size type',
      eyebrow,
      body: h('p', { class: 'dialog__text', data: { testid: 'size-type-text' } }, sizeTypeText(m.skuPrefix)),
      fields: [{ name: 'sizeType', label: 'Size type', kind: 'select', required: true, options: sizeTypeOptions(type), value: preselectedType(type, kind, m.type) }],
      live: (v) => sizeTypeLive(sizing, v.sizeType ?? '', m.skuPrefix).map((line) => h('p', { class: 'dialog__text', data: { testid: 'size-type-live' } }, line)),
      validate: (v) => (v.sizeType === type ? 'Nothing has changed.' : null),
      confirmLabel: 'Save size type',
      submit: async (v) => {
        await ctx.api.setModelSizes(m.id, sizeTypeChange(v.sizeType ?? ''));
      },
    }).then(done(SIZES_TEXT.saved));
  const tickSizes = () => {
    if (!canTick(sizing)) return;
    const before = initiallyTicked(sizing);
    const changes = (v: Record<string, string>) => tickChanges(sizing, tickedOf(sizing.list, v));
    void openDialog({
      title: 'Sizes',
      eyebrow: `${eyebrow} · ${SIZE_TYPE_WORDS[type!]}`,
      body: [
        h('p', { class: 'dialog__text' }, SIZES_TEXT.tickText),
        type === 'RING' ? null : h('p', { class: 'dialog__text soft', data: { testid: 'size-grid-caption' } }, SIZES_TEXT.tickCaption),
        h('div', { class: 'size-grid', data: { testid: 'size-grid' }, attrs: { role: 'group', 'aria-label': 'Sizes' } }, ...sizing.list.map((l) => checkbox(tickField(l), l, before.has(l)))),
      ],
      live: (v) => h('p', { class: 'dialog__text', data: { testid: 'size-tick-line' } }, tickLine(changes(v))),
      validate: (v) => tickProblem(changes(v)),
      confirmLabel: 'Save sizes',
      submit: async (v) => {
        await ctx.api.setModelSizes(m.id, { ticked: tickedOf(sizing.list, v) });
      },
    }).then(done(SIZES_TEXT.saved));
  };
  if (pendingTick === m.id) {
    pendingTick = null;
    if (canEdit && canTick(sizing) && sizing.sizes.length === 0) queueMicrotask(tickSizes);
  }
  const editFit = (row: ModelSizeRow) => {
    if (kind === null || row.label === null) return;
    const unit = fitUnitLabel(kind);
    void openDialog({
      title: 'Size',
      eyebrow: `${eyebrow} · ${row.label}`,
      fields: [
        { name: 'fitFrom', label: `Fits from (${unit})`, maxlength: 8, value: fitFormValues(kind, row).fitFrom, hint: SIZES_TEXT.fitHint },
        { name: 'fitTo', label: `Fits to (${unit})`, maxlength: 8, value: fitFormValues(kind, row).fitTo },
      ],
      validate: (v) => fitProblem(kind, v) ?? (fitChanged(kind, row, v) ? null : 'Nothing has changed.'),
      confirmLabel: 'Save size',
      submit: async (v) => {
        await ctx.api.setModelSizes(m.id, fitChange(kind, row, v));
      },
    }).then(done(SIZES_TEXT.saved));
  };
  const removeSize = (row: ModelSizeRow) => {
    const d = removeDialog(row);
    let outcome: 'REMOVED' | 'SET_ASIDE' | null = null;
    void openDialog({
      title: d.title,
      eyebrow,
      body: d.text.map((t) => h('p', { class: 'dialog__text', data: { testid: 'size-remove-text' } }, t)),
      confirmLabel: d.confirm,
      submit: async () => {
        outcome = (await ctx.api.removeModelSize(m.id, row.skuId)).outcome;
      },
    }).then((r) => done(outcome === 'REMOVED' ? SIZES_TEXT.removed : SIZES_TEXT.setAside)(r));
  };
  const reinstateSize = (row: ModelSizeRow) => {
    const d = reinstateDialog(row);
    void openDialog({
      title: d.title,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, d.text),
      confirmLabel: d.confirm,
      submit: async () => {
        await ctx.api.reinstateModelSize(m.id, row.skuId);
      },
    }).then(done(SIZES_TEXT.reinstated));
  };
  const sizeActions = (r: ModelSizeRow): HTMLElement | null => {
    if (!canEdit) return null;
    const buttons: HTMLElement[] = [];
    if (kind !== null && r.label !== null) buttons.push(button('Edit', { kind: 'ghost', testId: 'model-size-edit', onClick: () => editFit(r) }));
    if (r.setAsideAt === null) {
      const remove = button('Remove', { kind: 'ghost', testId: 'model-size-remove', onClick: () => removeSize(r) });
      if (!removable(sizing, r)) {
        remove.disabled = true;
        remove.title = SIZES_TEXT.lastOffered;
      }
      buttons.push(remove);
    } else {
      buttons.push(button('Reinstate', { kind: 'ghost', testId: 'model-size-reinstate', onClick: () => reinstateSize(r) }));
    }
    return h('span', { class: 'row-actions' }, ...buttons);
  };
  const sizeColumns: Column<ModelSizeRow>[] = [
    { label: 'Size', cell: (r) => h('span', { data: { testid: 'model-size-label' } }, sizeText(r.label)), kind: ['nowrap'] },
    { label: 'SKU', cell: (r) => mono(r.code), kind: ['nowrap'] },
    { label: 'Fits', cell: (r) => h('span', { data: { testid: 'model-size-fits' } }, fitsText(kind, r)) },
    { label: 'State', cell: (r) => h('span', { data: { testid: 'model-size-state' } }, sizeState(type, r)) },
    { label: 'Actions', kind: ['actions'], cell: sizeActions },
  ];
  const typeRow = sizeTypeRow(sizing);
  const warning = offListWarning(sizing);
  const sizesSection = section(
    'Sizes',
    [
      h('p', { class: 'prose', data: { testid: 'model-sizes-intro' } }, SIZES_TEXT.intro, ' ', SIZES_TEXT.offers),
      h('p', { class: 'prose', data: { testid: 'model-sizes-lead' } }, SIZES_TEXT.lead),
      defList([
        {
          label: 'Size type',
          value: h(
            'span',
            null,
            h('span', { data: { testid: 'model-size-kind' } }, typeRow.value),
            ...typeRow.notes.map((n) => h('span', { class: 'deflist__note', data: { testid: 'model-size-type-note' } }, n)),
          ),
        },
        ...(sizing.sizes.length ? [{ label: 'Sizes', value: h('span', { data: { testid: 'model-sizes-count' } }, sizesCountLine(sizing)) } as const] : []),
      ]),
      warning ? h('p', { class: 'panel__text', data: { testid: 'model-sizes-off-list' } }, warning) : null,
      sizing.sizes.length
        ? h('div', { data: { testid: 'model-sizes' } }, table(sizeColumns, sizing.sizes, { empty: SIZES_TEXT.empty, caption: 'Sizes' }))
        : emptyState(SIZES_TEXT.empty),
    ],
    {
      id: 'sizes',
      tools: canEdit
        ? [
            button('Edit size type', { kind: 'ghost', testId: 'model-size-kind-edit', onClick: editType }),
            ...(canTick(sizing) ? [button('Tick sizes', { kind: 'ghost', testId: 'model-sizes-tick', onClick: tickSizes })] : []),
          ]
        : [],
    },
  );

  // ── Private salon (P-X08) ────────────────────────────────────────────────
  const editSalon = () => {
    const form = salonForm(m);
    void openDialog({
      title: 'Private salon',
      eyebrow,
      body: h('p', { class: 'dialog__text', data: { testid: 'salon-impact' } }, salonImpact(m)),
      fields: [
        { name: 'priceLabel', label: 'Price', maxlength: PRICE_LABEL_MAX, value: form.priceLabel, hint: 'As the salon shows it: € 4 800, or Price on request. Empty: no price shown.' },
        { name: 'minTier', label: 'Shown from', kind: 'select', options: [...SALON_TIER_OPTIONS], value: form.minTier },
      ],
      validate: (v) => {
        const f = { priceLabel: v.priceLabel, minTier: v.minTier };
        return salonProblem(f) ?? (Object.keys(salonChange(m, f)).length === 0 ? 'Nothing has changed.' : null);
      },
      confirmLabel: 'Save private salon',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, salonChange(m, { priceLabel: v.priceLabel, minTier: v.minTier }));
      },
    }).then(done('Private salon saved.'));
  };

  const salon = section(
    'Private salon',
    defList([
      { label: 'Price', value: h('span', { data: { testid: 'salon-price' } }, m.priceLabel ?? 'None shown') },
      { label: 'Shown from', value: h('span', { data: { testid: 'salon-tier' } }, salonTierName(m.privateMinTier)), note: salonImpact(m) },
    ]),
    { id: 'salon', tools: canEdit ? [button('Edit', { kind: 'ghost', testId: 'salon-edit', onClick: editSalon })] : [] },
  );

  // ── Story ────────────────────────────────────────────────────────────────
  const editStory = () =>
    void openDialog({
      title: 'Story',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'Read on the model’s sheet, under its photographs. A hidden model’s sheet is not public: the preview below is how a client will read it.'),
      fields: [
        {
          name: 'story',
          label: 'Story',
          kind: 'textarea',
          rows: 12,
          maxlength: 4000,
          value: m.story ?? '',
          hint: 'Plain paragraphs, a blank line between two; no Markdown: what you type is shown as it is. Empty: no story.',
        },
      ],
      live: (v) => sheetPreview('The story', storyBlock(v.story, { className: 'sheet-preview__story', paragraphClass: 'prose sheet-preview__paragraph' }), 'story-preview'),
      validate: (v) => (textChange(m.story, v.story) === null ? 'Nothing has changed.' : null),
      confirmLabel: 'Save story',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, { story: textChange(m.story, v.story) ?? '' });
      },
    }).then(done('Story saved.'));

  const story = section('Story', sheetPreview('The story', storyBlock(m.story, { className: 'sheet-preview__story', paragraphClass: 'prose sheet-preview__paragraph' }), 'story-shown'), {
    id: 'story',
    tools: canEdit ? [button('Edit story', { kind: 'ghost', testId: 'story-edit', onClick: editStory })] : [],
  });

  // ── Specifications ───────────────────────────────────────────────────────
  const editSpecs = () =>
    void openDialog({
      title: 'Specifications',
      eyebrow,
      fields: [
        {
          name: 'specs',
          label: 'Specifications',
          kind: 'textarea',
          rows: 8,
          maxlength: 1000,
          value: m.specs ?? '',
          hint: 'One per line, as Label: value (Metal: 925 sterling silver). A label has no figure: it is set in the display face. Empty: none.',
        },
      ],
      live: (v) => sheetPreview('Specifications', specsBlock(v.specs), 'specs-preview'),
      validate: (v) => specsProblem(v.specs) ?? (textChange(m.specs, v.specs) === null ? 'Nothing has changed.' : null),
      confirmLabel: 'Save specifications',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, { specs: textChange(m.specs, v.specs) ?? '' });
      },
    }).then(done('Specifications saved.'));

  const specs = section('Specifications', sheetPreview('Specifications', specsBlock(m.specs), 'specs-shown'), {
    id: 'specifications',
    tools: canEdit ? [button('Edit specifications', { kind: 'ghost', testId: 'specs-edit', onClick: editSpecs })] : [],
  });

  // ── Gallery ──────────────────────────────────────────────────────────────
  const addPhoto = () =>
    void photoDialog({
      title: 'Gallery photograph',
      eyebrow,
      impact: galleryImpact(m),
      current: null,
      currentAlt: '',
      save: async (photo) => {
        await ctx.api.addGalleryImage(m.id, photo);
      },
      // No photograph is in place in this dialog: nothing to remove (removal is the gallery's Remove).
      remove: async () => {},
    }).then((r) => done('Photograph added.')(r));

  // Earlier / Later: one request, then the page read again; a refusal (the gallery changed meanwhile) is said.
  const arrange = (order: { sha256: string; alt: string }[], message: string) =>
    void ctx.api.arrangeGallery(m.id, order).then(
      () => done(message)(true),
      (e: unknown) => notifyError(e, 'The gallery could not be saved.'),
    );

  const editAlt = (g: GalleryImage) =>
    void openDialog({
      title: 'Alternative text',
      eyebrow: `${eyebrow} · ${String(g.position).padStart(2, '0')}`,
      body: [
        h('p', { class: 'dialog__text' }, 'What the photograph shows, for a client who does not see it (a screen reader says it). Empty: the sheet says what every photograph of the model says:'),
        h('p', { class: 'dialog__text' }, defaultAlt(m)),
      ],
      fields: [{ name: 'alt', label: 'Alternative text', maxlength: GALLERY_ALT_MAX, value: g.alt ?? '' }],
      validate: (v) => (v.alt.trim() === (g.alt ?? '') ? 'Nothing has changed.' : null),
      confirmLabel: 'Save alternative text',
      submit: async (v) => {
        await ctx.api.arrangeGallery(m.id, galleryWithAlt(m.gallery, g.sha256, v.alt));
      },
    }).then(done('Alternative text saved.'));

  const removePhoto = (g: GalleryImage) =>
    void openDialog({
      title: 'Remove from the gallery',
      eyebrow: `${eyebrow} · ${String(g.position).padStart(2, '0')}`,
      danger: true,
      body: h('p', { class: 'dialog__text' }, 'The photograph leaves the model’s sheet at once; the next ones move up. Used nowhere else, it is deleted.'),
      confirmLabel: 'Remove photograph',
      submit: async () => {
        await ctx.api.removeGalleryImage(m.id, g.sha256);
      },
    }).then(done('Photograph removed.'));

  const sorted = [...m.gallery].sort((a, b) => a.position - b.position);
  const items = sorted.map((g, i) =>
    h(
      'li',
      { class: 'gallery-edit__item', data: { testid: 'gallery-item', sha256: g.sha256 } },
      photoThumb(g.url, g.alt ?? defaultAlt(m), 'lg'),
      h('p', { class: 'gallery-edit__position' }, String(g.position).padStart(2, '0')),
      h('p', { class: ['gallery-edit__alt', g.alt ? null : 'gallery-edit__alt--default'], data: { testid: 'gallery-alt-text' } }, g.alt ?? `Default: ${defaultAlt(m)}`),
      canPhotograph
        ? h(
            'div',
            { class: 'row-actions gallery-edit__actions' },
            button('Earlier', { kind: 'ghost', testId: 'gallery-earlier', disabled: i === 0, onClick: () => arrange(galleryMoved(m.gallery, i, -1), 'Gallery saved.') }),
            button('Later', { kind: 'ghost', testId: 'gallery-later', disabled: i === sorted.length - 1, onClick: () => arrange(galleryMoved(m.gallery, i, 1), 'Gallery saved.') }),
            button('Alt text', { kind: 'ghost', testId: 'gallery-alt', onClick: () => editAlt(g) }),
            button('Remove', { kind: 'ghost', testId: 'gallery-remove', onClick: () => removePhoto(g) }),
          )
        : null,
    ),
  );
  const full = m.gallery.length >= GALLERY_MAX;
  const gallery = section(
    'Gallery',
    [
      h(
        'div',
        { class: 'gallery-edit__cover' },
        photoThumb(m.imageUrl, `${defaultAlt(m)}: the cover`, 'lg'),
        h('p', { class: 'gallery-edit__note' }, m.imageUrl ? 'The cover: the reference photograph, set with Photo on the Catalogue’s row.' : 'No cover yet: the reference photograph is set with Photo on the Catalogue’s row.'),
      ),
      sorted.length ? h('ol', { class: 'gallery-edit', data: { testid: 'gallery' } }, ...items) : emptyState('No photograph in the gallery yet.'),
    ],
    {
      id: 'gallery',
      note: `${m.gallery.length} of ${GALLERY_MAX}`,
      tools: canPhotograph ? [button(full ? 'Gallery full' : 'Add a photograph', { kind: 'ghost', testId: 'gallery-add', disabled: full, onClick: addPhoto })] : [],
    },
  );

  // ── Pairs well with (BP-34), last as on the sheet ──────────────────────
  const editPairs = async () => {
    let options: { value: string; label: string }[];
    try {
      options = pairOptions(m, (await ctx.api.models()).items);
    } catch (e) {
      notifyError(e, 'The models could not be read.');
      return;
    }
    const values = pairFormValues(m);
    const r = await openDialog({
      title: PAIRS_TEXT.dialogTitle,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, PAIRS_TEXT.lead),
      fields: PAIRS_TEXT.fields.map((label, i) => ({ name: `pair${i + 1}`, label, kind: 'select' as const, options, value: values[i] ?? '' })),
      validate: (v) => pairsProblem(m, [v.pair1, v.pair2, v.pair3]),
      confirmLabel: PAIRS_TEXT.save,
      submit: async (v) => {
        await ctx.api.setModelPairs(m.id, pairsChange([v.pair1, v.pair2, v.pair3]));
      },
    });
    done(PAIRS_TEXT.saved)(r);
  };
  const pairColumns: Column<ModelPair>[] = [
    { label: 'Position', cell: (p) => h('span', { data: { testid: 'pair-position' } }, String(p.position)), kind: ['num', 'nowrap'] },
    { label: 'Model', cell: (p) => h('span', { class: 'variant-label', data: { testid: 'pair-model' } }, dotOnly(p.swatch), pairModelLabel(p)) },
    { label: 'Lookbook', cell: (p) => h('span', { data: { testid: 'pair-lookbook' } }, lookbookWord(p.lookbook)), kind: ['nowrap'] },
    { label: 'Shown', cell: (p) => h('span', { data: { testid: 'pair-shown' } }, shownLabel(p.shown)) },
  ];
  const pairs = m.pairs ?? [];
  const pairsSection = m.variantOf
    ? section(
        'Pairs well with',
        defList([
          {
            label: PAIRS_TEXT.variant,
            value: h('a', { attrs: { href: href('model', { modelId: m.variantOf.id }), 'data-testid': 'pairs-main' } }, `${humanize(m.variantOf.name)}${m.variantOf.label ? ` · ${humanize(m.variantOf.label)}` : ''}`),
            note: PAIRS_TEXT.variantNote,
          },
        ]),
        { id: 'pairs', note: pairsNote(pairs) },
      )
    : section(
        'Pairs well with',
        [
          h('p', { class: 'prose', data: { testid: 'pairs-lead' } }, PAIRS_TEXT.lead),
          pairs.length
            ? h('div', { data: { testid: 'pairs' } }, table(pairColumns, pairs, { caption: 'Pairs well with' }))
            : h('div', { data: { testid: 'pairs-none' } }, emptyState(PAIRS_TEXT.none), h('p', { class: 'prose', data: { testid: 'pairs-shown-now' } }, shownNow(m))),
        ],
        { id: 'pairs', note: pairsNote(pairs), tools: canEdit ? [button('Edit pairs', { kind: 'ghost', testId: 'pairs-edit', onClick: () => void editPairs() })] : [] },
      );

  return h(
    'div',
    { class: 'view view--lookbook' },
    pageHeader({
      eyebrow: 'Catalogue · Lookbook',
      // A variant's page says which one it is (N1): MONOLITHE · BLUE.
      title: m.variantLabel ? `${humanize(m.name)} · ${humanize(m.variantLabel)}` : humanize(m.name),
      // A model's name may hold a figure: the title is then set in the reading face, as a record's id is.
      identifier: /\d/.test(m.name),
      lead: 'The model’s sheet in THE COLLECTION on /verify: where it is shown, its address, its story, its specifications and its photographs. Its care is the model’s care instructions (Edit, on the Catalogue’s row).',
      actions: [linkButton('All models', `${href('catalogue')}`, 'ghost')],
    }),
    publication,
    variants,
    sizesSection,
    salon,
    story,
    specs,
    gallery,
    pairsSection,
  );
}

/** A pick's dot, its colour set through the CSSOM; nothing for a model without one. */
function dotOnly(swatch: string | null): HTMLElement | null {
  if (!swatch) return null;
  const dot = h('span', { class: 'variant-dot', attrs: { 'aria-hidden': 'true' } });
  dot.style.backgroundColor = swatch;
  return dot;
}

/** The labels a model's label may not take: its main model's (a variant), or its variants' (a main model). */
function siblingLabels(m: Model): string[] {
  return (m.variantOf ? [m.variantOf.label] : m.variants.map((v) => v.label)).filter((x): x is string => typeof x === 'string');
}

/** A dot and its label, the dot's colour set through the CSSOM, its code in the reading face; « None » without a label. */
function dotLabel(swatch: string | null, label: string | null): HTMLElement {
  const dot = h('span', { class: ['variant-dot', swatch ? null : 'variant-dot--none'], attrs: { 'aria-hidden': 'true' } });
  if (swatch) dot.style.backgroundColor = swatch;
  return h('span', { class: 'variant-label' }, dot, h('span', null, label ?? 'None', label && swatch ? ' · ' : null, label && swatch ? mono(swatch) : null));
}

function withTestId<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.testid = id;
  return el;
}

/** A part of the sheet as the client reads it on /verify: its section label, then the words (or a line saying there are none). */
function sheetPreview(heading: string, content: HTMLElement | null, testId: string): HTMLElement {
  return h(
    'div',
    { class: 'sheet-preview', data: { testid: testId } },
    h('p', { class: 'care-preview__label' }, 'As the client reads it'),
    h(
      'div',
      { class: 'sheet-preview__panel' },
      h('p', { class: 'sheet-preview__heading' }, heading),
      content ?? h('p', { class: 'sheet-preview__empty' }, 'Nothing yet: the sheet leaves this part out.'),
    ),
  );
}

/** The specifications as the sheet's rows (label, value), from what is typed. */
function specsBlock(specs: string | null | undefined): HTMLElement | null {
  const rows = specRows(specs);
  if (rows.length === 0) return null;
  return h(
    'dl',
    { class: 'sheet-preview__rows' },
    ...rows.map((r) => h('div', { class: 'sheet-preview__row' }, h('dt', { class: 'sheet-preview__label' }, r.label), h('dd', { class: 'sheet-preview__value' }, r.value))),
  );
}
