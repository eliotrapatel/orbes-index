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
 * is saved, and the model's shows its care block as the client reads it on
 * /verify. A model's category and SKU prefix never change.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, humanize } from '../format.js';
import { carePreview, collectionImpact, MODEL_STATUS_OPTIONS, modelChange, modelForm, modelImpact, type ModelForm } from '../model/catalogue.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import type { Category, Collection, Model } from '../types.js';
import { button, mono, pageHeader, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function catalogueView(ctx: ViewContext): Promise<HTMLElement> {
  const [cats, cols, models] = await Promise.all([ctx.api.categories(), ctx.api.collections(), ctx.api.models()]);
  const role = ctx.session.admin.role;
  const canEdit = can(role, 'editCatalog');
  const canToggle = can(role, 'activateCategory');
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

  // ADMIN. Reversible, and nothing issued changes: no typed phrase.
  const toggleCategory = (c: Category) =>
    void openDialog({
      title: c.active ? 'Deactivate category' : 'Activate category',
      eyebrow: `${humanize(c.name)} · ${c.code}`,
      body: h(
        'p',
        { class: 'dialog__text' },
        c.active
          ? 'No new piece can be issued in this category, and the generator stops offering it. Its pieces keep verifying as before, and the category can be activated again.'
          : 'The category receives new pieces again: the generator offers it with its active models.',
      ),
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

  const newModel = () =>
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
      ],
      validate: (v) => (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.skuPrefix.trim()) ? 'SKU prefix: letters, digits, dot, underscore, hyphen.' : null),
      confirmLabel: 'Create model',
      submit: async (v) => {
        await ctx.api.createModel({
          categoryCode: v.categoryCode,
          name: v.name.trim(),
          type: v.type.trim(),
          skuPrefix: v.skuPrefix.trim(),
          ...(v.collectionId ? { collectionId: v.collectionId } : {}),
          ...(v.defaultMaterial?.trim() ? { defaultMaterial: v.defaultMaterial.trim() } : {}),
          ...(v.careInstructions?.trim() ? { careInstructions: v.careInstructions.trim() } : {}),
        });
      },
    }).then(done('Model created.'));

  // Only what differs is sent; the category and the SKU prefix are not fields at all.
  const editModel = (m: Model) => {
    const form = modelForm(m);
    void openDialog({
      title: 'Edit model',
      eyebrow: `${humanize(m.name)} · ${m.skuPrefix}`,
      body: [
        h('p', { class: 'dialog__text', data: { testid: 'catalogue-impact' } }, modelImpact(m.products)),
        h('p', { class: 'dialog__text' }, `Its category (${humanize(m.category.name)} · ${m.category.code}) and its SKU prefix (${m.skuPrefix}) never change: they are written in the pieces already issued.`),
      ],
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: 100, value: form.name },
        { name: 'collectionId', label: 'Collection', kind: 'select', options: collectionOptions, value: form.collectionId },
        { name: 'defaultMaterial', label: 'Default material', maxlength: 200, value: form.defaultMaterial, hint: 'Proposed by the generator; each piece keeps its own material.' },
        { name: 'careInstructions', label: 'Care instructions', kind: 'textarea', rows: 5, maxlength: 2000, value: form.careInstructions, hint: 'Empty: the client reads the general care text.' },
        { name: 'status', label: 'Status', kind: 'select', options: [...MODEL_STATUS_OPTIONS], value: form.status },
      ],
      live: (v) => careBlock(v.careInstructions),
      validate: (v) => (Object.keys(modelChange(m, v as unknown as ModelForm)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save model',
      submit: async (v) => {
        await ctx.api.updateModel(m.id, modelChange(m, v as unknown as ModelForm));
      },
    }).then(done('Model saved.'));
  };

  const categoryColumns: Column<Category>[] = [
    { label: 'Index', cell: (c) => mono(String(c.index).padStart(2, '0')), kind: ['num'] },
    { label: 'Letter', cell: (c) => mono(c.code), kind: ['nowrap'] },
    { label: 'Name', cell: (c) => humanize(c.name), kind: ['wide'] },
    { label: 'Warranty', cell: (c) => `${c.warrantyMonths} MONTHS`, kind: ['nowrap'] },
    { label: 'Status', cell: (c) => activeMark(c.active), kind: ['nowrap'] },
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
    { label: 'Model', cell: (m) => humanize(m.name) },
    { label: 'Type', cell: (m) => humanize(m.type) },
    { label: 'Category', cell: (m) => `${humanize(m.category.name)} · ${m.category.code}`, kind: ['nowrap'] },
    { label: 'Collection', cell: (m) => humanize(m.collection?.name) },
    { label: 'SKU prefix', cell: (m) => mono(m.skuPrefix), kind: ['nowrap'] },
    { label: 'Default material', cell: (m) => humanize(m.defaultMaterial), kind: ['wide'] },
    { label: 'Status', cell: (m) => activeMark(m.active), kind: ['nowrap'] },
    { label: 'Issued', cell: (m) => formatCount(m.products), kind: ['num'] },
  ];
  if (canEdit) {
    modelColumns.push({ label: 'Action', kind: ['actions'], cell: (m) => button('Edit', { kind: 'ghost', testId: 'edit-model', onClick: () => editModel(m) }) });
  }

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
      lead: 'Categories, collections and models that products are issued against. A model’s name, care instructions and collection, and a collection’s name, read on the result of every piece issued with them.',
    }),
    section('Categories', table(categoryColumns, cats.items, { empty: 'No category.', caption: 'Categories' }), {
      id: 'categories',
      tools: can(role, 'createCategory') ? [button('New category', { kind: 'ghost', onClick: newCategory })] : [],
    }),
    section('Models', table(modelColumns, models.items, { empty: 'No model.', caption: 'Models' }), {
      id: 'models',
      tools: can(role, 'createCatalog') && cats.items.length ? [button('New model', { kind: 'ghost', onClick: newModel })] : [],
    }),
    section('Collections', table(collectionColumns, cols.items, { empty: 'No collection.', caption: 'Collections' }), {
      id: 'collections',
      tools: can(role, 'createCatalog') ? [button('New collection', { kind: 'ghost', onClick: newCollection })] : [],
    }),
  );
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
