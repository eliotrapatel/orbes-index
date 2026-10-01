/**
 * Catalogue: categories (ADMIN; their 5-bit index is permanent once
 * assigned and is part of every product identity), collections and models
 * (OPERATOR). The generator issues products against these.
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize } from '../format.js';
import { can } from '../model/permissions.js';
import { button, mono, pageHeader, section, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function catalogueView(ctx: ViewContext): Promise<HTMLElement> {
  const [cats, cols, models] = await Promise.all([ctx.api.categories(), ctx.api.collections(), ctx.api.models()]);
  const role = ctx.session.admin.role;
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

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

  const newModel = () =>
    void openDialog({
      title: 'New model',
      eyebrow: 'Catalogue',
      fields: [
        { name: 'categoryCode', label: 'Category', kind: 'select', required: true, options: cats.items.map((c) => ({ value: c.code, label: `${humanize(c.name)} · ${c.code}` })) },
        { name: 'collectionId', label: 'Collection', kind: 'select', options: [{ value: '', label: 'None' }, ...cols.items.map((c) => ({ value: c.id, label: humanize(c.name) }))] },
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

  return h(
    'div',
    { class: 'view view--catalogue' },
    pageHeader({ eyebrow: 'Registry', title: 'Catalogue', lead: 'Categories, collections and models that products are issued against.' }),
    section(
      'Categories',
      table(
        [
          { label: 'Index', cell: (c) => mono(String(c.index).padStart(2, '0')), kind: ['num'] },
          { label: 'Letter', cell: (c) => mono(c.code), kind: ['nowrap'] },
          { label: 'Name', cell: (c) => humanize(c.name), kind: ['wide'] },
          { label: 'Warranty', cell: (c) => `${c.warrantyMonths} MONTHS`, kind: ['nowrap'] },
          { label: 'Active', cell: (c) => (c.active ? 'YES' : 'NO'), kind: ['nowrap'] },
          { label: 'Created', cell: (c) => formatDate(c.createdAt), kind: ['nowrap'] },
        ],
        cats.items,
        { empty: 'No category.' },
      ),
      { tools: can(role, 'createCategory') ? [button('New category', { kind: 'ghost', onClick: newCategory })] : [] },
    ),
    section(
      'Models',
      table(
        [
          { label: 'Model', cell: (m) => humanize(m.name) },
          { label: 'Type', cell: (m) => humanize(m.type) },
          { label: 'Category', cell: (m) => `${humanize(m.category.name)} · ${m.category.code}`, kind: ['nowrap'] },
          { label: 'Collection', cell: (m) => humanize(m.collection?.name) },
          { label: 'SKU prefix', cell: (m) => mono(m.skuPrefix), kind: ['nowrap'] },
          { label: 'Default material', cell: (m) => humanize(m.defaultMaterial), kind: ['wide'] },
        ],
        models.items,
        { empty: 'No model.' },
      ),
      { tools: can(role, 'createCatalog') && cats.items.length ? [button('New model', { kind: 'ghost', onClick: newModel })] : [] },
    ),
    section(
      'Collections',
      table(
        [
          { label: 'Collection', cell: (c) => humanize(c.name), kind: ['wide'] },
          { label: 'Models', cell: (c) => String(c.models), kind: ['num'] },
          { label: 'Created', cell: (c) => formatDate(c.createdAt), kind: ['nowrap'] },
        ],
        cols.items,
        { empty: 'No collection.' },
      ),
      { tools: can(role, 'createCatalog') ? [button('New collection', { kind: 'ghost', onClick: newCollection })] : [] },
    ),
  );
}
