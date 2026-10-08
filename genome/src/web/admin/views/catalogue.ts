/**
 * Catalogue: categories (ADMIN; their 5-bit index is permanent once
 * assigned and is part of every product identity), collections and models
 * (OPERATOR). The generator issues products against these.
 *
 * Editable (A-10): a model's name, default material, care instructions,
 * collection and status (Edit, on its row), a collection's name (Rename),
 * and, for an ADMIN, whether a category receives new pieces (Deactivate /
 * Activate). A model's name, care instructions and collection, and a
 * collection's name, read live on the result of every piece issued with
 * them: each dialog says how many issued pieces it touches before anything
 * is saved (a category's, that its issued pieces keep verifying as before),
 * and the model's shows its care block as the client reads it on /verify.
 * A model's category and SKU prefix never change. Its reference photograph
 * (Photo, on its row; F-04) is shown above the GENOME on the authentic
 * results of its pieces: the dialog says how many first. Its sheet in the
 * lookbook (P-R02: its place, address, story, specifications and gallery) is
 * set on its own page, Lookbook on its row (`#/catalogue/:modelId`), which
 * every role that reads the catalogue opens. An ADMIN discontinues a model
 * (P-R06: Discontinue, on its row, after a typed phrase; inactive, said
 * DISCONTINUED with the year on /verify) and reinstates it (Reinstate, the
 * same way); a discontinued model's edit has no status.
 *
 * Shopify readiness (plan LIVE RELEASE+, N2): a model's base price and its
 * care guide are set in its edit (the price of the Shopify product export,
 * releases keeping their own; the care guide MY PIECES shows with each order
 * of the model). SHOPIFY EXPORT (every role that reads) downloads the product
 * CSV of the models priced in the store's currency (a model and its variants
 * one product, plan NOCTURNE N1); Shopify on a row (OPERATOR)
 * takes back the ids the store gives the product and each size, which link
 * both sides. Nothing is sent to Shopify.
 *
 * Variants (plan NOCTURNE, N1): a model's row says its place among them (its
 * label, the model it is a variant of, or how many it has); they are set on
 * its page (Lookbook on its row: VARIANTS, ADD A VARIANT).
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, humanize } from '../format.js';
import {
  basePriceProblem,
  CARE_GUIDE_MAX,
  carePreview,
  categoryImpact,
  collectionImpact,
  discontinuedYear,
  discontinueImpact,
  discontinuePhrase,
  MODEL_STATUS_OPTIONS,
  modelChange,
  modelForm,
  modelImpact,
  modelStatus,
  reinstateImpact,
  type ModelForm,
} from '../model/catalogue.js';
import { can } from '../model/permissions.js';
import { basePriceText, productExportSummary, SHOPIFY_CURRENCY_OPTIONS, shopifyLinkInput, shopifyLinkProblem, shopifyStatus, shopifyValues, variantField } from '../model/shopify.js';
import { modelPhotoImpact } from '../model/photo.js';
import { catalogueSizeLine, LISTED_SIZE_TYPES, NEW_MODEL_SIZE_TYPE } from '../model/sizes.js';
import { variantLine } from '../model/variants.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { ORDER_CURRENCIES, type Category, type Collection, type Model, type SizeType } from '../types.js';
import { button, linkButton, mono, pageHeader, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { photoDialog, photoThumb } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { tickSizesOnOpen } from './lookbook.js';

export async function catalogueView(ctx: ViewContext): Promise<HTMLElement> {
  const [cats, cols, models] = await Promise.all([ctx.api.categories(), ctx.api.collections(), ctx.api.models()]);
  const role = ctx.session.admin.role;
  const canEdit = can(role, 'editCatalog');
  const canToggle = can(role, 'activateCategory');
  const canPhotograph = can(role, 'photograph');
  const canDiscontinue = can(role, 'discontinueModel');
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };
  const collectionOptions = [{ value: '', label: 'None' }, ...cols.items.map((c) => ({ value: c.id, label: humanize(c.name) }))];

  const newCategory = () =>
    void openDialog({
      title: 'New category',
      eyebrow: 'Catalogue',
      danger: true,
      body: h('p', { class: 'dialog__text' }, 'The category receives the lowest free index (1–31). Index and letter are permanent: they are encoded in every product identity of this category.'),
      fields: [
        { name: 'code', label: 'Letter (A–Z)', required: true, maxlength: 1 },
        { name: 'name', label: 'Name', required: true, maxlength: 64 },
        { name: 'warrantyMonths', label: 'Warranty (months)', value: '24', maxlength: 3 },
      ],
      validate: (v) =>
        !/^[A-Za-z]$/.test(v.code.trim()) ? 'The letter must be A–Z.' : v.warrantyMonths && !/^\d{1,3}$/.test(v.warrantyMonths.trim()) ? 'Warranty is a number of months.' : null,
      confirmLabel: 'Create category',
      submit: async (v) => {
        await ctx.api.createCategory({
          code: v.code.trim().toUpperCase(),
          name: v.name.trim(),
          ...(v.warrantyMonths?.trim() ? { warrantyMonths: Number(v.warrantyMonths.trim()) } : {}),
        });
      },
    }).then(done('Category created.'));

  // ADMIN. Reversible, and nothing issued changes (said with the count of its pieces first): no typed phrase.
  const toggleCategory = (c: Category) =>
    void openDialog({
      title: c.active ? 'Deactivate category' : 'Activate category',
      eyebrow: `${humanize(c.name)} · ${c.code}`,
      body: h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, categoryImpact(c.products, c.active)),
      confirmLabel: c.active ? 'Deactivate' : 'Activate',
      submit: async () => {
        await ctx.api.setCategoryActive(c.code, !c.active);
      },
    }).then(done(c.active ? 'Category deactivated.' : 'Category activated.'));

  const newCollection = () =>
    void openDialog({
      title: 'New collection',
      eyebrow: 'Catalogue',
      fields: [{ name: 'name', label: 'Name', required: true, maxlength: 100 }],
      confirmLabel: 'Create collection',
      submit: async (v) => {
        await ctx.api.createCollection(v.name.trim());
      },
    }).then(done('Collection created.'));

  const renameCollection = (c: Collection) =>
    void openDialog({
      title: 'Rename collection',
      eyebrow: humanize(c.name),
      body: h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, collectionImpact(c.products)),
      fields: [{ name: 'name', label: 'Name', required: true, maxlength: 100, value: c.name }],
      validate: (v) => (v.name.trim() === c.name ? 'Nothing has changed.' : null),
      confirmLabel: 'Rename collection',
      submit: async (v) => {
        await ctx.api.renameCollection(c.id, v.name.trim());
      },
    }).then(done('Collection renamed.'));

  const newModel = () => {
    let created: Model | null = null;
    void openDialog({
      title: 'New model',
      eyebrow: 'Catalogue',
      fields: [
        { name: 'categoryCode', label: 'Category', kind: 'select', required: true, options: cats.items.map((c) => ({ value: c.code, label: `${humanize(c.name)} · ${c.code}` })) },
        { name: 'collectionId', label: 'Collection', kind: 'select', options: collectionOptions },
        { name: 'name', label: 'Name (e.g. MONOLITHE)', required: true, maxlength: 100 },
        { name: 'type', label: 'Type (e.g. RING)', required: true, maxlength: 60 },
        { name: 'skuPrefix', label: 'SKU prefix (e.g. MNL-RG)', required: true, maxlength: 32 },
        { name: 'defaultMaterial', label: 'Default material', maxlength: 200 },
        { name: 'careInstructions', label: 'Care instructions', kind: 'textarea', maxlength: 2000 },
        // Plan NEXT LOT §3.3 item 6b: every new model is given its size type.
        { name: 'sizeType', label: 'Size type', kind: 'select', required: true, options: [...NEW_MODEL_SIZE_TYPE.options], value: '', hint: NEW_MODEL_SIZE_TYPE.hint },
      ],
      validate: (v) => (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.skuPrefix.trim()) ? 'SKU prefix: letters, digits, dot, underscore, hyphen.' : null),
      confirmLabel: 'Create model',
      submit: async (v) => {
        created = await ctx.api.createModel({
          categoryCode: v.categoryCode,
          name: v.name.trim(),
          type: v.type.trim(),
          skuPrefix: v.skuPrefix.trim(),
          sizeType: v.sizeType as SizeType,
          ...(v.collectionId ? { collectionId: v.collectionId } : {}),
          ...(v.defaultMaterial?.trim() ? { defaultMaterial: v.defaultMaterial.trim() } : {}),
          ...(v.careInstructions?.trim() ? { careInstructions: v.careInstructions.trim() } : {}),
        });
      },
    }).then((r) => {
      const m: Model | null = created;
      // Plan NEXT LOT §3.3 item 6b: a ring's, a bracelet's or a necklace's sizes are ticked next, on its page, at once.
      if (r && m && m.sizeType !== null && LISTED_SIZE_TYPES.includes(m.sizeType)) {
        notify('Model created.');
        tickSizesOnOpen(m.id);
        location.hash = href('model', { modelId: m.id });
        return;
      }
      done('Model created.')(r);
    });
  };

  // Only what differs is sent; the category and the SKU prefix are not fields at all.
  const editModel = (m: Model) => {
    const form = modelForm(m);
    void openDialog({
      title: 'Edit model',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      body: [
        h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, modelImpact(m.products)),
        h('p', { class: 'dialog__text' }, `Its category (${humanize(m.category.name)} · ${m.category.code}) and its SKU prefix (${m.skuPrefix}) never change: they are written in the pieces already issued.`),
        // P-R06: no status for a discontinued model; only Reinstate (an ADMIN's) offers it again.
        m.discontinuedAt
          ? h('p', { class: 'dialog__text', data: { testid: 'model-discontinued-note' } }, 'Discontinued: it stays inactive until an ADMIN reinstates it.')
          : null,
      ],
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: 100, value: form.name },
        { name: 'collectionId', label: 'Collection', kind: 'select', options: collectionOptions, value: form.collectionId },
        { name: 'defaultMaterial', label: 'Default material', maxlength: 200, value: form.defaultMaterial, hint: 'Proposed by the generator; each piece keeps its own material.' },
        { name: 'careInstructions', label: 'Care instructions', kind: 'textarea', rows: 5, maxlength: 2000, value: form.careInstructions, hint: 'Empty: the client reads the general care text.' },
        ...(m.discontinuedAt ? [] : [{ name: 'status', label: 'Status', kind: 'select' as const, options: [...MODEL_STATUS_OPTIONS], value: form.status }]),
        { name: 'basePrice', label: 'Base price', maxlength: 14, value: form.basePrice, hint: 'The price of the Shopify product export, in units: 4800, or 4800.50. Each release keeps its own. Empty: none.' },
        { name: 'baseCurrency', label: 'Currency', kind: 'select', options: ORDER_CURRENCIES.map((c) => ({ value: c, label: c })), value: form.baseCurrency },
        { name: 'careGuide', label: 'Care guide', kind: 'textarea', rows: 6, maxlength: CARE_GUIDE_MAX, value: form.careGuide, hint: 'MY PIECES shows it with each order of this model. Empty: its care instructions stand in.' },
      ],
      live: (v) => careBlock(v.careInstructions),
      validate: (v) => basePriceProblem(v as unknown as ModelForm) ?? (Object.keys(modelChange(m, v as unknown as ModelForm)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save model',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, modelChange(m, v as unknown as ModelForm));
      },
    }).then(done('Model saved.'));
  };

  // P-R06, ADMIN: reversible, but it changes what /verify says of every piece issued with the model, so a typed phrase.
  const discontinueModel = (m: Model) =>
    void openDialog({
      title: 'Discontinue model',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      danger: true,
      body: h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, discontinueImpact(m, ctx.now().getUTCFullYear())),
      phrase: discontinuePhrase('discontinue', m),
      confirmLabel: 'Discontinue',
      submit: async () => {
        await ctx.api.discontinueModel(m.id);
      },
    }).then(done('Model discontinued.'));

  const reinstateModel = (m: Model) =>
    void openDialog({
      title: 'Reinstate model',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      body: h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, reinstateImpact(m)),
      phrase: discontinuePhrase('reinstate', m),
      confirmLabel: 'Reinstate',
      submit: async () => {
        await ctx.api.reinstateModel(m.id);
      },
    }).then(done('Model reinstated.'));

  // The reference photograph: chosen, previewed as it will be sent, saved; or removed.
  const modelPhoto = (m: Model) =>
    void photoDialog({
      title: 'Reference photograph',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      impact: modelPhotoImpact(m.products),
      current: m.imageUrl,
      currentAlt: `${humanize(m.name)} ${humanize(m.type)}: the current reference photograph`,
      save: async (photo) => {
        await ctx.api.setModelImage(m.id, photo);
      },
      remove: async () => {
        await ctx.api.removeModelImage(m.id);
      },
    }).then((r) => done(r === 'removed' ? 'Photograph removed.' : 'Photograph saved.')(r));

  // N2, OPERATOR: the ids Shopify gave the model's product and each of its sizes, pasted back.
  const linkShopify = async (m: Model) => {
    let product;
    try {
      product = await ctx.api.modelShopify(m.id);
    } catch (e) {
      notifyError(e);
      return;
    }
    const p = product;
    const values = shopifyValues(p);
    void openDialog({
      title: 'Shopify ids',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      body: [
        h('p', { class: 'dialog__text' }, `Once the product export is imported, paste here the id Shopify gave the product (handle ${p.handle}) and each of its variants: the number at the end of its address in Shopify’s admin, or the address itself. They link both sides; nothing is sent to Shopify.`),
      ],
      fields: [
        { name: 'productId', label: 'Product', maxlength: 300, value: values.productId, hint: 'Empty: the model is no longer linked, nor its sizes.' },
        // The label in the display face carries no figure: the size and its SKU are said under the field.
        ...p.variants.map((x, i) => ({ name: variantField(i), label: 'Variant', maxlength: 300, value: values[variantField(i)], hint: `${x.size === null ? 'One size' : `Size ${x.size}`} · SKU ${x.sku}` })),
      ],
      validate: (v) => shopifyLinkProblem(p, v),
      confirmLabel: 'Save the ids',
      submit: async (v) => {
        await ctx.api.linkModelShopify(m.id, shopifyLinkInput(p, v));
      },
    }).then(done('Shopify ids saved.'));
  };

  // N2: the product CSV in Shopify's import format, in the store's currency.
  const exportProducts = () =>
    void openDialog({
      title: 'Shopify product export',
      eyebrow: 'Catalogue',
      body: h(
        'p',
        { class: 'dialog__text' },
        'A file in Shopify’s product import format: one product per model, its sizes as variants with their SKUs, its base price and its photographs; a model and its variants are one product, by Variant and Size. Nothing is sent to Shopify.',
      ),
      fields: [{ name: 'currency', label: 'The store’s currency', kind: 'select', options: [...SHOPIFY_CURRENCY_OPTIONS], value: models.items.find((x) => x.baseCurrency)?.baseCurrency ?? 'EUR' }],
      live: (v) => h('p', { class: 'dialog__text', data: { testid: 'shopify-export-summary' } }, productExportSummary(models.items, v.currency)),
      confirmLabel: 'Download',
      submit: async (v) => {
        saveDownload(await ctx.api.shopifyProductsCsv(v.currency));
      },
    }).then((r) => r && notify('Shopify product export downloaded.'));

  const categoryColumns: Column<Category>[] = [
    { label: 'Index', cell: (c) => mono(String(c.index).padStart(2, '0')), kind: ['num'] },
    { label: 'Letter', cell: (c) => mono(c.code), kind: ['nowrap'] },
    { label: 'Name', cell: (c) => humanize(c.name), kind: ['wide'] },
    { label: 'Warranty', cell: (c) => `${c.warrantyMonths} MONTHS`, kind: ['nowrap'] },
    { label: 'Status', cell: (c) => activeMark(c.active), kind: ['nowrap'] },
    { label: 'Issued', cell: (c) => formatCount(c.products), kind: ['num'] },
    { label: 'Created', cell: (c) => formatDate(c.createdAt), kind: ['nowrap'] },
  ];
  if (canToggle) {
    categoryColumns.push({
      label: 'Action',
      kind: ['actions'],
      cell: (c) => button(c.active ? 'Deactivate' : 'Activate', { kind: 'ghost', testId: 'toggle-category', onClick: () => toggleCategory(c) }),
    });
  }

  const modelColumns: Column<Model>[] = [
    { label: 'Photo', cell: (m) => photoThumb(m.imageUrl, `${humanize(m.name)} ${humanize(m.type)}: reference photograph`), kind: ['nowrap'] },
    // NOCTURNE N1: a model and its variants share a name; the row says which one it is.
    {
      label: 'Model',
      cell: (m) => {
        const line = variantLine(m);
        return line ? h('span', null, humanize(m.name), h('span', { class: 'cell-sub', data: { testid: 'model-variant' } }, line)) : humanize(m.name);
      },
    },
    // Plan NEXT LOT §3.3 item 5: its size type and how many sizes it offers, or that it is to give.
    { label: 'Type', cell: (m) => h('span', null, humanize(m.type), h('span', { class: 'cell-sub', data: { testid: 'model-size-type' } }, catalogueSizeLine(m))) },
    { label: 'Category', cell: (m) => `${humanize(m.category.name)} · ${m.category.code}`, kind: ['nowrap'] },
    { label: 'Collection', cell: (m) => humanize(m.collection?.name) },
    { label: 'SKU prefix', cell: (m) => mono(m.skuPrefix), kind: ['nowrap'] },
    { label: 'Default material', cell: (m) => humanize(m.defaultMaterial), kind: ['wide'] },
    { label: 'Status', cell: (m) => h('span', { data: { testid: 'model-active' } }, modelStatusMark(m)), kind: ['nowrap'] },
    { label: 'Lookbook', cell: (m) => h('span', { data: { testid: 'model-lookbook-state' } }, statusMark(m.lookbook, toneOf('lookbook', m.lookbook))), kind: ['nowrap'] },
    { label: 'Issued', cell: (m) => formatCount(m.products), kind: ['num'] },
    // N2: the base price, and under it how far the model is linked to its Shopify product.
    {
      label: 'Price · Shopify',
      cell: (m) =>
        h(
          'span',
          null,
          h('span', { class: [m.basePriceMinor === null ? 'soft' : null], data: { testid: 'model-base-price' } }, basePriceText(m)),
          h('span', { class: 'cell-sub', data: { testid: 'model-shopify' } }, shopifyStatus(m)),
        ),
      kind: ['nowrap'],
    },
  ];
  // Lookbook (P-R02) opens the model's page for every role that reads; Edit and Photo are the mutating roles';
  // Discontinue and Reinstate (P-R06) an ADMIN's.
  modelColumns.push({
    label: 'Action',
    kind: ['actions'],
    cell: (m) =>
      h(
        'span',
        { class: 'row-actions' },
        canEdit ? button('Edit', { kind: 'ghost', testId: 'edit-model', onClick: () => editModel(m) }) : null,
        canPhotograph ? button('Photo', { kind: 'ghost', testId: 'model-photo', onClick: () => modelPhoto(m) }) : null,
        canEdit ? button('Shopify', { kind: 'ghost', testId: 'model-shopify-ids', onClick: () => void linkShopify(m) }) : null,
        canDiscontinue
          ? m.discontinuedAt
            ? button('Reinstate', { kind: 'ghost', testId: 'reinstate-model', onClick: () => reinstateModel(m) })
            : button('Discontinue', { kind: 'ghost', testId: 'discontinue-model', onClick: () => discontinueModel(m) })
          : null,
        withTestId(linkButton('Lookbook', href('model', { modelId: m.id }), 'ghost'), 'model-lookbook'),
      ),
  });

  const collectionColumns: Column<Collection>[] = [
    { label: 'Collection', cell: (c) => humanize(c.name), kind: ['wide'] },
    { label: 'Models', cell: (c) => formatCount(c.models), kind: ['num'] },
    { label: 'Issued', cell: (c) => formatCount(c.products), kind: ['num'] },
    { label: 'Created', cell: (c) => formatDate(c.createdAt), kind: ['nowrap'] },
  ];
  if (canEdit) {
    collectionColumns.push({ label: 'Action', kind: ['actions'], cell: (c) => button('Rename', { kind: 'ghost', testId: 'rename-collection', onClick: () => renameCollection(c) }) });
  }

  return h(
    'div',
    { class: 'view view--catalogue' },
    pageHeader({
      eyebrow: 'Registry',
      title: 'Catalogue',
      lead: 'Categories, collections and models that products are issued against. A model’s name, care instructions, collection and reference photograph, and a collection’s name, read on the result of every piece issued with them. A model’s sheet in the lookbook is set on its Lookbook page; its base price and care guide in its edit, and its Shopify product through the export and the ids pasted back.',
    }),
    section('Categories', table(categoryColumns, cats.items, { empty: 'No category.', caption: 'Categories' }), {
      id: 'categories',
      tools: can(role, 'createCategory') ? [button('New category', { kind: 'ghost', onClick: newCategory })] : [],
    }),
    section('Models', table(modelColumns, models.items, { empty: 'No model.', caption: 'Models' }), {
      id: 'models',
      tools: [
        button('Shopify export', { kind: 'ghost', testId: 'shopify-products-export', onClick: exportProducts }),
        ...(can(role, 'createCatalog') && cats.items.length ? [button('New model', { kind: 'ghost', onClick: newModel })] : []),
      ],
    }),
    section('Collections', table(collectionColumns, cols.items, { empty: 'No collection.', caption: 'Collections' }), {
      id: 'collections',
      tools: can(role, 'createCatalog') ? [button('New collection', { kind: 'ghost', onClick: newCollection })] : [],
    }),
  );
}

function withTestId<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.testid = id;
  return el;
}

/** ACTIVE, INACTIVE, or DISCONTINUED with its year as the mark's title (P-R06). */
function modelStatusMark(m: Model): HTMLElement {
  const status = modelStatus(m);
  const mark = statusMark(status, toneOf('catalogue', status));
  const year = discontinuedYear(m);
  if (year !== null) mark.title = `Discontinued in ${year}`;
  return mark;
}

function activeMark(active: boolean): HTMLElement {
  const status = active ? 'ACTIVE' : 'INACTIVE';
  return statusMark(status, toneOf('catalogue', status));
}

/**
 * The care block as the client reads it on /verify: the CARE tab, then the instructions in brand.css `.prose`, as
 * verify's carePanel sets them (verify/views/panels.ts), or the general care text when there are none.
 */
function careBlock(careInstructions: string | undefined): HTMLElement {
  const care = carePreview(careInstructions);
  return h(
    'div',
    { class: 'care-preview', data: { testid: 'care-preview', general: care.general ? 'true' : 'false' } },
    h('p', { class: 'care-preview__label' }, 'As the client reads it'),
    h(
      'div',
      { class: 'care-preview__panel' },
      h('p', { class: 'care-preview__tabs' }, h('span', { class: 'care-preview__tab' }, 'Care')),
      h('p', { class: 'prose care-preview__text', text: care.text }),
    ),
    care.general ? h('p', { class: 'care-preview__note' }, 'No care instructions of its own: the general care text of /verify.') : null,
  );
}
