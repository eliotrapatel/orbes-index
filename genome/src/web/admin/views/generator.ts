/**
 * Code generator (master spec §21): issue a product identity, derive its
 * genome, sign the canonical payload with the active key and produce the
 * printable code.
 *
 * Result: genome, on-screen code (rendered in the browser from the signed
 * data with the core encoder: the exact cells that will be printed),
 * SVG / PNG / PDF downloads with print options, and the one-time claim
 * code. The claim code exists only in this page's memory: it is never
 * stored client-side and disappears when the operator leaves or hides it.
 */
import { bracket } from '../../shared/corners.js';
import { focusFirst, h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatDate, humanize, isoDay, shortHash, versionLabel } from '../format.js';
import { buildIssueInput, formatClaimCode, modelsFor, POLICY_OPTIONS, type IssueForm } from '../model/generator.js';
import { can } from '../model/permissions.js';
import { href, productHref } from '../router.js';
import type { Category, Collection, IssueResponse, Model } from '../types.js';
import { artifactPanel } from '../ui/artifacts.js';
import { busy, button, checkbox, copyButton, defList, field, input, linkButton, mono, pageHeader, section, select, setFieldError } from '../ui/components.js';
import { genomeFigure } from '../ui/figures.js';
import type { ViewContext } from './context.js';

export async function generatorView(ctx: ViewContext): Promise<HTMLElement> {
  const role = ctx.session.admin.role;
  if (!can(role, 'issue')) {
    return h('div', { class: 'view' }, pageHeader({ eyebrow: 'Generator', title: 'Issue a product', lead: 'Issuing requires the OPERATOR role.' }));
  }
  const [cats, models, cols] = await Promise.all([ctx.api.categories(), ctx.api.models(), ctx.api.collections()]);
  const root = h('div', { class: 'view view--generator' });
  mount(
    root,
    ...formScreen(ctx, cats.items.filter((c) => c.active), models.items, cols.items, (r) => {
      mount(root, ...resultScreen(ctx, r));
      // The form was long: start the result (claim code first) at the top.
      window.scrollTo(0, 0);
      focusFirst(root);
    }),
  );
  return root;
}

function formScreen(ctx: ViewContext, categories: Category[], models: Model[], collections: Collection[], onIssued: (r: IssueResponse) => void): HTMLElement[] {
  const header = pageHeader({
    eyebrow: 'Generator',
    title: 'Issue a product',
    lead: 'Identity → genome → signed payload → ORBES CODE. The serial is allocated atomically; the code is signed with the active key.',
  });
  if (categories.length === 0 || models.length === 0) {
    return [
      header,
      section(
        'Catalogue required',
        h(
          'div',
          { class: 'stack' },
          h('p', { class: 'prose' }, 'A product is issued against a category and a model. Create them in the catalogue first.'),
          linkButton('Open the catalogue', href('catalogue'), 'primary'),
        ),
      ),
    ];
  }

  const now = ctx.now();
  const category = select('categoryCode', categories.map((c) => ({ value: c.code, label: `${humanize(c.name)} · ${c.code}` })));
  const model = select('modelId', []);
  const collection = select('collectionId', [{ value: '', label: 'None' }, ...collections.map((c) => ({ value: c.id, label: humanize(c.name) }))]);
  const material = input('material', { maxlength: 200 });
  const variant = input('variant', { maxlength: 100, placeholder: 'e.g. 52' });
  const batch = input('productionBatch', { maxlength: 100, placeholder: 'e.g. B-2026-09-A', mono: true });
  const prodDate = input('productionDate', { type: 'date', value: isoDay(now), max: isoDay(now) });
  const year = input('year', { type: 'number', placeholder: String(now.getUTCFullYear()), min: 2000, max: 2099, inputmode: 'numeric' });
  const serial = input('serial', { type: 'number', placeholder: 'Next available', min: 1, max: 999999, inputmode: 'numeric' });
  const sku = input('sku', { maxlength: 64, placeholder: 'Derived from the model', mono: true });
  const policy = select('authPolicy', POLICY_OPTIONS.map((p) => ({ value: p.value, label: p.label })), 'PRINTED_CODE');
  const policyHint = h('span', null, POLICY_OPTIONS[0].note);
  const claim = checkbox('withClaimSecret', 'Issue a one-time claim code (shown once, stored as a hash)', true);

  const preview = h('div', { class: 'gen__identity' });
  const summary = () => {
    const c = categories.find((x) => x.code === category.value);
    const y = Number(year.value) || now.getUTCFullYear();
    const yy = String(y % 100).padStart(2, '0');
    const s = serial.value ? String(Number(serial.value)).padStart(5, '0') : '·····';
    mount(
      preview,
      h('p', { class: 'gen__identity-label' }, 'Identity'),
      h('p', { class: 'gen__identity-id' }, `O${yy}-${c?.code ?? '·'}-${s}`),
      h('p', { class: 'gen__identity-note' }, 'GENOME-01 · CODE-01 · Ed25519'),
    );
  };

  const fillModels = () => {
    const list = modelsFor(models, category.value);
    mount(model, ...list.map((m) => h('option', { attrs: { value: m.id } }, `${humanize(m.name)} · ${humanize(m.type)} · ${m.skuPrefix}`)));
    if (list.length === 0) mount(model, h('option', { attrs: { value: '' } }, 'No model in this category'));
    applyModel();
  };
  const applyModel = () => {
    const m = models.find((x) => x.id === model.value);
    if (!m) return;
    if (m.defaultMaterial && (!material.value || material.dataset.auto === '1')) {
      material.value = m.defaultMaterial;
      material.dataset.auto = '1';
    }
    if (m.collection?.id) collection.value = m.collection.id;
  };
  material.addEventListener('input', () => delete material.dataset.auto);
  category.addEventListener('change', () => {
    fillModels();
    summary();
  });
  model.addEventListener('change', applyModel);
  year.addEventListener('input', summary);
  serial.addEventListener('input', summary);
  policy.addEventListener('change', () => (policyHint.textContent = POLICY_OPTIONS.find((p) => p.value === policy.value)?.note ?? ''));
  fillModels();
  summary();

  const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const submit = button('Issue & sign', { kind: 'primary', type: 'submit', testId: 'issue-submit' });
  const form = h(
    'form',
    { class: 'gen__form', attrs: { novalidate: true, 'data-testid': 'issue-form' } },
    h('p', { class: 'form-group' }, 'Product'),
    h(
      'div',
      { class: 'grid grid--2' },
      field('Category', category, { required: true }),
      field('Model', model, { required: true }),
      field('Collection', collection),
      field('Material', material, { required: true, hint: 'Defaults to the model material.' }),
      field('Variant', variant, { hint: 'Size, colour or finish.' }),
      field('SKU', sku, { hint: 'Optional override.' }),
    ),
    h('p', { class: 'form-group' }, 'Production'),
    h('div', { class: 'grid grid--3' }, field('Production batch', batch), field('Production date', prodDate), field('Identity year', year, { hint: 'Defaults to this year.' })),
    h('p', { class: 'form-group' }, 'Authentication'),
    h(
      'div',
      { class: 'grid grid--2' },
      field('Policy', policy),
      field('Explicit serial', serial, { hint: 'Leave empty to allocate the next serial.' }),
    ),
    h('p', { class: 'cfield__hint gen__policy-hint' }, policyHint),
    claim,
    error,
    h('div', { class: 'form-actions' }, submit, h('span', { class: 'form-actions__note' }, 'Signing is irreversible: the identity and serial are consumed.')),
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    error.textContent = '';
    const values: IssueForm = {
      categoryCode: category.value,
      modelId: model.value,
      collectionId: collection.value,
      material: material.value,
      variant: variant.value,
      productionBatch: batch.value,
      productionDate: prodDate.value,
      year: year.value,
      serial: serial.value,
      sku: sku.value,
      authPolicy: policy.value,
      withClaimSecret: (claim.querySelector('input') as HTMLInputElement).checked,
    };
    const fields = Object.keys(values) as (keyof IssueForm)[];
    for (const k of fields) setFieldError(form, k, undefined);
    const built = buildIssueInput(values, ctx.now());
    if (!built.ok) {
      for (const [k, msg] of Object.entries(built.errors)) setFieldError(form, k, msg);
      error.textContent = 'Check the highlighted fields.';
      return;
    }
    void busy(submit, async () => {
      try {
        onIssued(await ctx.api.issue(built.value));
      } catch (e) {
        error.textContent = e instanceof ApiError ? e.message : 'The product could not be issued.';
      }
    }, 'Signing…');
  });

  return [header, h('div', { class: 'grid grid--gen' }, section('Issue form', form), h('aside', { class: 'gen__aside' }, bracket(preview), asideNotes()))];
}

function asideNotes(): HTMLElement {
  return h(
    'div',
    { class: 'gen__notes' },
    h('p', { class: 'gen__notes-title' }, 'What is produced'),
    h(
      'ol',
      { class: 'gen__steps' },
      h('li', null, 'Canonical identity O{YY}-{C}-{NNNNN}'),
      h('li', null, 'GENOME-01 — eight glyphs, a public bijection of the identity'),
      h('li', null, '13-byte payload signed with Ed25519 by the active key'),
      h('li', null, 'Reed-Solomon protected orbital code, CODE-01'),
    ),
    h('p', { class: 'gen__notes-foot' }, 'A printed code proves that ORBES issued the data. It does not, by itself, prove that an object is genuine.'),
  );
}

function resultScreen(ctx: ViewContext, r: IssueResponse): HTMLElement[] {
  const { product: p, genome: g, code: c } = r;

  const claim = r.claimCode ? claimPanel(r.claimCode) : null;

  return [
    pageHeader({
      eyebrow: 'Generator · issued',
      title: p.productId,
      lead: `Signed with key #${c.keyId} on ${formatDate(c.issuedAt)}. ${humanize(p.status)}.`,
      actions: [
        linkButton('Open product page', productHref(p.productId), 'primary'),
        button('Issue another', { kind: 'secondary', onClick: () => ctx.reload(), testId: 'issue-another' }),
      ],
    }),
    claim,
    h(
      'div',
      { class: 'grid grid--result' },
      section(
        'Genome',
        h(
          'div',
          { class: 'stack' },
          genomeFigure(g, { size: 'md' }),
          defList([
            { label: 'Fingerprint', value: mono(g.fingerprint) },
            { label: 'Version', value: g.versionLabel },
            { label: 'Glyphs', value: mono(g.ids.join(' · ')) },
          ]),
        ),
      ),
      section(
        'Signed code',
        h(
          'div',
          { class: 'stack' },
          defList([
            { label: 'Product', value: p.productId },
            { label: 'Code', value: `${versionLabel('CODE', c.codeVersion)} · ISSUE ${c.issue}` },
            { label: 'Signing key', value: mono(`#${c.keyId}`) },
            { label: 'Nonce', value: mono(c.nonce) },
            { label: 'Payload SHA-256', value: mono(c.payloadHash, shortHash(c.payloadHash, 12, 8)) },
            { label: 'Claim code', value: r.claimCode ? 'ISSUED · SHOWN ONCE' : 'NONE' },
            { label: 'Policy', value: humanize(p.authPolicy.replace(/\+/g, ' + ')) },
          ]),
        ),
      ),
    ),
    section('Code & print files', artifactPanel(ctx.api, { codeId: c.id, preview: { data: c.data, glyphs: g.glyphs } }), {
      note: 'Preview rendered from the signed data',
      id: 'artifacts',
    }),
  ].filter((x): x is HTMLElement => x !== null);
}

function claimPanel(code: string): HTMLElement {
  const value = formatClaimCode(code);
  const text = h('p', { class: 'claim__code mono', data: { testid: 'claim-code' } }, value);
  const hide = button('I have recorded it — hide', {
    kind: 'ghost',
    onClick: () => {
      // Drop the only copy the console holds.
      text.textContent = '•••• - •••• - ••••';
      panel.classList.add('is-hidden');
      hide.remove();
      copy.remove();
    },
  });
  const copy = copyButton(value, 'Copy');
  const panel = bracket(
    h(
      'section',
      { class: 'claim', attrs: { 'aria-label': 'One-time claim code' } },
      h('p', { class: 'claim__label' }, 'Claim code · shown once'),
      text,
      h('p', { class: 'claim__note' }, 'Place it inside the packaging, never on the product. Only its scrypt hash is stored; it cannot be displayed again.'),
      h('div', { class: 'claim__tools' }, copy, hide),
    ),
  );
  return panel;
}
