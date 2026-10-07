/**
 * Code generator (master spec §21): issue a product identity, derive its
 * genome, sign the canonical payload with the active key and produce the
 * printable code.
 *
 * Result: genome, on-screen code (rendered in the browser from the signed
 * data with the core encoder: the exact cells that will be printed),
 * SVG / PNG / PDF downloads with print options, and the one-time claim
 * code (no photograph of the piece is offered: plan NOCTURNE, decision 9,
 * the model's photograph is the reference for every piece of it; the product
 * page keeps the ones taken before, for ORBES staff). The claim code exists only in
 * this page's memory: it is never stored client-side and disappears when
 * the operator leaves or hides it.
 * While it is shown, the certificate card that carries it (PDF, the card 79t,
 * claim code in plain sight) can be downloaded; the server checks the code
 * against its hash before printing it, and the button goes with Copy when
 * the code is hidden.
 *
 * Batch (`#/generator?mode=batch`): one template (category, model,
 * material, production batch and date, policy, claim code or not), then a
 * quantity or a CSV of one row per piece (size, sku, serial; read as
 * UTF-8, or as Windows-1252 when it is not, as Excel saves a plain CSV),
 * checked line by line before anything is signed; the preview and "Sign 120
 * products" (POST /api/admin/products/batch, automatically in requests of
 * 50, the pieces that name their serial first). The result is given piece
 * by piece: signed pieces stay signed when others fail. Their claim codes
 * are held in this page's memory only, as for one product; until they are
 * saved (certificate cards, results file) or hidden, leaving the page asks
 * first (ui/leave-guard.ts), and a session that ends meanwhile leaves the
 * page on screen (main.ts).
 */
import { bracket } from '../../shared/corners.js';
import { focusFirst, h, mount } from '../../shared/dom.js';
import { ApiError, type CertificateOptions } from '../api.js';
import { formatCount, formatDate, humanize, isoDay, shortHash, versionLabel } from '../format.js';
import {
  BATCH_HEADER,
  BATCH_OUTCOME_LABELS,
  batchCertificateItems,
  batchPlanText,
  batchProblemText,
  batchRequests,
  batchResultRows,
  batchResultsCsv,
  batchResultsFilename,
  batchSigningOrder,
  batchSummary,
  buildIssueBatch,
  buildIssueInput,
  certificateRequests,
  decodeBatchCsv,
  formatClaimCode,
  ISSUE_BATCH_LIMITS,
  issuedModelRows,
  modelsFor,
  parseBatchCsv,
  POLICY_OPTIONS,
  quantityRows,
  sheetPartFilename,
  signBatchLabel,
  type BatchCsvEncoding,
  type BatchOutcome,
  type BatchPart,
  type BatchProblem,
  type BatchResultRow,
  type BatchRow,
  type BatchTemplateForm,
  type IssueForm,
} from '../model/generator.js';
import { can } from '../model/permissions.js';
import type { Tone } from '../model/tone.js';
import { modelChoice } from '../model/variants.js';
import { href, productHref } from '../router.js';
import type { Category, Collection, IssueResponse, Model } from '../types.js';
import { artifactPanel } from '../ui/artifacts.js';
import {
  busy,
  button,
  checkbox,
  copyButton,
  defList,
  field,
  input,
  linkButton,
  mono,
  pageHeader,
  section,
  select,
  setFieldError,
  statusMark,
  table,
  type Column,
} from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { genomeFigure } from '../ui/figures.js';
import { confirmLeave, holdPage } from '../ui/leave-guard.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function generatorView(ctx: ViewContext): Promise<HTMLElement> {
  const role = ctx.session.admin.role;
  if (!can(role, 'issue')) {
    return h('div', { class: 'view' }, pageHeader({ eyebrow: 'Generator', title: 'Issue a product', lead: 'Issuing requires the OPERATOR role.' }));
  }
  const [cats, models, cols] = await Promise.all([ctx.api.categories(), ctx.api.models(), ctx.api.collections()]);
  const root = h('div', { class: 'view view--generator' });
  // The form was long: start the result (claim codes first) at the top.
  const show = (...nodes: HTMLElement[]) => {
    mount(root, ...nodes);
    window.scrollTo(0, 0);
    focusFirst(root);
  };
  // Only what is offered for new pieces: active categories and models (an inactive one issues nothing: 409).
  const categories = cats.items.filter((c) => c.active);
  const offered = models.items.filter((m) => m.active);
  if (ctx.route.query.mode === 'batch') {
    mount(root, ...batchFormScreen(ctx, categories, offered, cols.items, (outcome) => show(...batchResultScreen(ctx, outcome))));
  } else {
    mount(root, ...formScreen(ctx, categories, offered, cols.items, (r) => show(...resultScreen(ctx, r, offered))));
  }
  return root;
}

/** SINGLE PIECE · BATCH: the two ways to issue, each its own URL. */
function modeTabs(current: 'single' | 'batch'): HTMLElement {
  const tab = (mode: 'single' | 'batch', label: string, link: string) =>
    h('a', { class: 'gen__mode', attrs: { href: link, 'aria-current': mode === current ? 'page' : null, 'data-testid': `mode-${mode}` } }, label);
  return h(
    'nav',
    { class: 'gen__modes', attrs: { 'aria-label': 'Issue' } },
    tab('single', 'Single piece', href('generator')),
    h('span', { class: 'gen__modes-dot', attrs: { 'aria-hidden': 'true' } }),
    tab('batch', 'Batch', href('generator', {}, { mode: 'batch' })),
  );
}

/** The catalogue comes first: without a category and a model, nothing can be issued. */
function catalogueRequired(header: HTMLElement): HTMLElement[] {
  return [
    header,
    section(
      'Catalogue required',
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'prose' }, 'A product is issued against an active category and an active model. Create or reactivate them in the catalogue first.'),
        linkButton('Open the catalogue', href('catalogue'), 'primary'),
      ),
    ),
  ];
}

/**
 * The controls a single product and a batch share (category, model, collection, material,
 * production batch and date, identity year, policy, claim code), wired together: the model list
 * follows the category, the model fills its material and collection.
 */
function productControls(categories: Category[], models: Model[], collections: Collection[], now: Date) {
  const category = select('categoryCode', categories.map((c) => ({ value: c.code, label: `${humanize(c.name)} · ${c.code}` })));
  const model = select('modelId', []);
  const collection = select('collectionId', [{ value: '', label: 'None' }, ...collections.map((c) => ({ value: c.id, label: humanize(c.name) }))]);
  const material = input('material', { maxlength: 200 });
  const batch = input('productionBatch', { maxlength: 100, placeholder: 'e.g. B-2026-09-A', mono: true });
  const prodDate = input('productionDate', { type: 'date', value: isoDay(now), max: isoDay(now) });
  const year = input('year', { type: 'number', placeholder: String(now.getUTCFullYear()), min: 2000, max: 2099, inputmode: 'numeric' });
  const policy = select('authPolicy', POLICY_OPTIONS.map((p) => ({ value: p.value, label: p.label })), 'PRINTED_CODE');
  const policyHint = h('span', null, POLICY_OPTIONS[0].note);

  const applyModel = () => {
    const m = models.find((x) => x.id === model.value);
    if (!m) return;
    if (m.defaultMaterial && (!material.value || material.dataset.auto === '1')) {
      material.value = m.defaultMaterial;
      material.dataset.auto = '1';
    }
    if (m.collection?.id) collection.value = m.collection.id;
  };
  const fillModels = () => {
    const list = modelsFor(models, category.value);
    mount(model, ...list.map((m) => h('option', { attrs: { value: m.id } }, modelChoice(m, m.skuPrefix))));
    if (list.length === 0) mount(model, h('option', { attrs: { value: '' } }, 'No model in this category'));
    applyModel();
  };
  material.addEventListener('input', () => delete material.dataset.auto);
  category.addEventListener('change', fillModels);
  model.addEventListener('change', applyModel);
  policy.addEventListener('change', () => (policyHint.textContent = POLICY_OPTIONS.find((p) => p.value === policy.value)?.note ?? ''));
  fillModels();
  return { category, model, collection, material, batch, prodDate, year, policy, policyHint };
}

function formScreen(ctx: ViewContext, categories: Category[], models: Model[], collections: Collection[], onIssued: (r: IssueResponse) => void): HTMLElement[] {
  const header = pageHeader({
    eyebrow: 'Generator',
    title: 'Issue a product',
    lead: 'Identity → genome → signed payload → ORBES CODE. The serial is allocated atomically; the code is signed with the active key.',
    actions: [modeTabs('single')],
  });
  if (categories.length === 0 || models.length === 0) return catalogueRequired(header);

  const now = ctx.now();
  const { category, model, collection, material, batch, prodDate, year, policy, policyHint } = productControls(categories, models, collections, now);
  const variant = input('variant', { maxlength: 100, placeholder: 'e.g. 52' });
  const serial = input('serial', { type: 'number', placeholder: 'Next available', min: 1, max: 999999, inputmode: 'numeric' });
  const sku = input('sku', { maxlength: 64, placeholder: 'Derived from the model', mono: true });
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

  category.addEventListener('change', summary);
  year.addEventListener('input', summary);
  serial.addEventListener('input', summary);
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
      field('Size', variant, { hint: 'The size of this piece, as its SKU says it. Empty: one size.' }),
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

function resultScreen(ctx: ViewContext, r: IssueResponse, models: readonly Model[]): HTMLElement[] {
  const { product: p, genome: g, code: c } = r;

  const claim = r.claimCode ? claimPanel(ctx, p.productId, r.claimCode) : null;

  return [
    pageHeader({
      eyebrow: 'Generator · issued',
      title: p.productId,
      identifier: true,
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
            { label: 'Glyphs', value: mono(g.ids.join('\u00a0· ')) },
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
            // Plan NEXT LOT §3.1: its model, then its variant (with a label), from the catalogue the form loaded.
            ...issuedModelRows(p.modelId, models),
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

function claimPanel(ctx: ViewContext, productId: string, code: string): HTMLElement {
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
      card.remove();
    },
  });
  const copy = copyButton(value, 'Copy');
  const card = button('Download certificate card', { kind: 'ghost', testId: 'download-certificate' });
  card.addEventListener('click', () => {
    void busy(card, async () => {
      try {
        saveDownload(await ctx.api.certificates([{ productId, claimCode: code }], { format: 'pdf', layout: 'card' }));
      } catch (e) {
        notifyError(e, 'The certificate card could not be produced.');
      }
    }, 'Rendering…');
  });
  const panel = bracket(
    h(
      'section',
      { class: 'claim', attrs: { 'aria-label': 'One-time claim code' } },
      h('p', { class: 'claim__label' }, 'Claim code · shown once'),
      text,
      h('p', { class: 'claim__note' }, 'Place it inside the packaging, never on the product. Only its scrypt hash is stored; it cannot be displayed again.'),
      h('div', { class: 'claim__tools' }, copy, card, hide),
    ),
  );
  return panel;
}

// ── Batch ──────────────────────────────────────────────────────────────────

/** A batch once its requests are done: one row per piece, in order. */
interface BatchDone {
  rows: BatchResultRow[];
  productionBatch: string | undefined;
}

const OUTCOME_TONE: Readonly<Record<BatchOutcome, Tone>> = { ISSUED: 'solid', FAILED: 'alert', NO_ANSWER: 'alert', SKIPPED: 'muted', NOT_SENT: 'muted' };

/** Problems listed under the preview, at most this many (the rest counted). */
const PROBLEMS_SHOWN = 12;
/** Pieces previewed before signing, at most this many (the rest counted). */
const PREVIEW_ROWS = 10;

/**
 * An answer the server gave with its own error code means the request was refused before any
 * piece was signed (the batch route only refuses before signing). No answer, an unreadable one,
 * or a proxy's page (HTTP_502…) leaves it unknown: the server may have signed some pieces.
 */
function refusedBeforeSigning(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status >= 400 && !/^HTTP_\d+$/.test(e.code) && e.code !== 'BAD_RESPONSE';
}

function batchFormScreen(ctx: ViewContext, categories: Category[], models: Model[], collections: Collection[], onDone: (d: BatchDone) => void): HTMLElement[] {
  const header = pageHeader({
    eyebrow: 'Generator',
    title: 'Issue a batch',
    lead: 'One template for every piece, then a quantity or a CSV of one row per piece. Each piece is signed as a single product is; a piece that fails never undoes the others.',
    actions: [modeTabs('batch')],
  });
  if (categories.length === 0 || models.length === 0) return catalogueRequired(header);

  const now = ctx.now();
  const c = productControls(categories, models, collections, now);
  const claim = checkbox('withClaimSecret', 'Issue a one-time claim code for each piece (shown once, stored as a hash)', true);
  const claimBox = claim.querySelector('input') as HTMLInputElement;

  const source = select(
    'source',
    [
      { value: 'csv', label: 'A CSV file, one row per piece' },
      { value: 'quantity', label: 'A quantity of identical pieces' },
    ],
    'csv',
  );
  const file = h('input', { class: ['cinput', 'cinput--file'], attrs: { type: 'file', name: 'csv', accept: '.csv,text/csv', 'data-testid': 'batch-file' } });
  const quantity = input('quantity', { type: 'number', min: 1, max: ISSUE_BATCH_LIMITS.maxPieces, inputmode: 'numeric', placeholder: 'e.g. 120' });
  const variant = input('variant', { maxlength: 100, placeholder: 'e.g. 50 ML' });
  const sku = input('sku', { maxlength: 64, placeholder: 'Derived from the model', mono: true });
  const csvFields = h(
    'div',
    { class: 'batch__source' },
    field('CSV file', file, { hint: `First line: ${BATCH_HEADER} (each optional; a serial is allocated when absent). Comma or semicolon.`, wide: true }),
  );
  const quantityFields = h(
    'div',
    { class: ['grid', 'grid--3', 'batch__source'], attrs: { hidden: true } },
    field('Quantity', quantity, { hint: `1 to ${formatCount(ISSUE_BATCH_LIMITS.maxPieces)} pieces.` }),
    field('Size', variant, { hint: 'The same for every piece.' }),
    field('SKU', sku, { hint: 'Optional override.' }),
  );

  // The file as last read: its pieces, or what is wrong with it.
  let fileRows: BatchRow[] = [];
  let fileProblems: BatchProblem[] = [];
  let fileEncoding: BatchCsvEncoding = 'utf-8';
  let fileSeq = 0;
  let signing = false;

  const templateForm = (): BatchTemplateForm => ({
    categoryCode: c.category.value,
    modelId: c.model.value,
    collectionId: c.collection.value,
    material: c.material.value,
    productionBatch: c.batch.value,
    productionDate: c.prodDate.value,
    year: c.year.value,
    authPolicy: c.policy.value,
    withClaimSecret: claimBox.checked,
  });
  const pieces = (): { rows: BatchRow[]; problems: BatchProblem[] } => {
    if (source.value === 'quantity') {
      if (!quantity.value.trim()) return { rows: [], problems: [] };
      const q = quantityRows(quantity.value, variant.value, sku.value);
      return q.ok ? { rows: q.rows, problems: [] } : { rows: [], problems: [{ line: null, message: q.error }] };
    }
    return { rows: fileRows, problems: fileProblems };
  };

  const count = h('p', { class: 'gen__identity-id', data: { testid: 'batch-count' } });
  const plan = h('p', { class: 'gen__identity-note', attrs: { 'aria-live': 'polite' }, data: { testid: 'batch-plan' } });
  const aside = h('div', { class: 'gen__identity' }, h('p', { class: 'gen__identity-label' }, 'Batch'), count, plan);
  // Re-mounted only when the problems change, so a screen reader hears them once, not on every keystroke.
  const problemsList = h('ul', { class: 'batch__problems', attrs: { 'aria-live': 'polite' }, data: { testid: 'batch-problems' } });
  let problemsShown = '';
  const previewHost = h('div', { class: 'batch__preview', data: { testid: 'batch-preview' } });
  const submit = button('', { kind: 'primary', type: 'submit', testId: 'batch-submit' });
  const progress = h('span', { class: 'form-actions__note', attrs: { 'aria-live': 'polite' }, data: { testid: 'batch-progress' } }, 'Signing is irreversible: every piece consumes an identity and a serial.');
  const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' } });

  const setSubmitLabel = (n: number) => {
    const [before, figure, after] = signBatchLabel(n);
    mount(submit, before, figure ? h('span', { class: 'cbtn__figure' }, figure) : null, after);
  };

  const renderPreview = () => {
    // What the last attempt to sign said no longer applies to what has changed since.
    error.textContent = '';
    const { rows, problems } = pieces();
    let shown = problems;
    let requests = Math.ceil(rows.length / ISSUE_BATCH_LIMITS.perRequest);
    if (problems.length === 0 && rows.length > 0) {
      const built = buildIssueBatch(templateForm(), rows, ctx.now());
      if (built.ok) requests = batchRequests(built.template, built.items).length;
      else shown = built.problems; // the template's own errors show on its fields when signing
    }
    count.textContent = rows.length > 0 ? formatCount(rows.length) : '·····';
    plan.textContent = rows.length > 0 ? batchPlanText(rows.length, requests) : 'No piece yet';
    setSubmitLabel(rows.length);
    const texts = shown.slice(0, PROBLEMS_SHOWN).map(batchProblemText);
    if (shown.length > PROBLEMS_SHOWN) texts.push(`And ${formatCount(shown.length - PROBLEMS_SHOWN)} more.`);
    if (texts.join('\n') !== problemsShown) {
      problemsShown = texts.join('\n');
      mount(problemsList, ...texts.map((t) => h('li', { class: 'batch__problem' }, t)));
    }
    if (rows.length === 0) {
      mount(previewHost);
      return;
    }
    const fromFile = rows[0].line !== null;
    const columns: Column<BatchRow & { piece: number }>[] = [
      { label: fromFile ? 'Line' : 'Piece', cell: (r) => String(r.line ?? r.piece), kind: ['num'] },
      { label: 'Size', cell: (r) => r.variant.trim() || '—' },
      { label: 'SKU', cell: (r) => (r.sku.trim() ? mono(r.sku.trim()) : h('span', { class: 'soft' }, 'From the model')), kind: ['nowrap'] },
      { label: 'Serial', cell: (r) => (r.serial.trim() ? r.serial.trim() : h('span', { class: 'soft' }, 'Next')), kind: ['num', 'wide'] },
    ];
    const first = rows.slice(0, PREVIEW_ROWS).map((r, i) => ({ ...r, piece: i + 1 }));
    mount(
      previewHost,
      fromFile && fileEncoding === 'windows-1252'
        ? h('p', { class: 'batch__more', data: { testid: 'batch-encoding' } }, 'The file is not UTF-8: it was read as Windows-1252, as Excel saves a plain CSV. Check the accents below before signing.')
        : null,
      table(columns, first, { caption: 'Pieces to sign' }),
      rows.length > PREVIEW_ROWS ? h('p', { class: 'batch__more' }, `The first ${PREVIEW_ROWS} of ${formatCount(rows.length)} pieces.`) : null,
    );
  };

  source.addEventListener('change', () => {
    csvFields.hidden = source.value !== 'csv';
    quantityFields.hidden = source.value !== 'quantity';
    renderPreview();
  });
  file.addEventListener('change', async () => {
    const seq = ++fileSeq;
    const f = file.files?.[0];
    let rows: BatchRow[] = [];
    let problems: BatchProblem[] = [];
    let encoding: BatchCsvEncoding = 'utf-8';
    if (f && f.size > ISSUE_BATCH_LIMITS.maxFileBytes) problems = [{ line: null, message: 'The file is larger than 1 MB.' }];
    else if (f) {
      // Read as bytes: Blob.text() would turn a Windows-1252 accent into U+FFFD without a word.
      const decoded = decodeBatchCsv(await f.arrayBuffer());
      encoding = decoded.encoding;
      const parsed = parseBatchCsv(decoded.text);
      if (parsed.ok) rows = parsed.rows;
      else problems = parsed.problems;
    }
    if (seq !== fileSeq) return; // a newer file was chosen meanwhile
    fileRows = rows;
    fileProblems = problems;
    fileEncoding = encoding;
    renderPreview();
  });

  const form = h(
    'form',
    { class: 'gen__form', attrs: { novalidate: true, 'data-testid': 'batch-form' } },
    h('p', { class: 'form-group' }, 'Product'),
    h('div', { class: 'grid grid--2' }, field('Category', c.category, { required: true }), field('Model', c.model, { required: true }), field('Collection', c.collection), field('Material', c.material, { required: true, hint: 'Defaults to the model material.' })),
    h('p', { class: 'form-group' }, 'Production'),
    h('div', { class: 'grid grid--3' }, field('Production batch', c.batch, { hint: 'Every piece gets it: the batch is found again in Products and Codes.' }), field('Production date', c.prodDate), field('Identity year', c.year, { hint: 'Defaults to this year.' })),
    h('p', { class: 'form-group' }, 'Authentication'),
    h('div', { class: 'grid grid--2' }, field('Policy', c.policy)),
    h('p', { class: 'cfield__hint gen__policy-hint' }, c.policyHint),
    claim,
    h('p', { class: 'form-group' }, 'Pieces'),
    h('div', { class: 'grid grid--2' }, field('Pieces from', source)),
    csvFields,
    quantityFields,
    problemsList,
    previewHost,
    error,
    h('div', { class: 'form-actions' }, submit, progress),
  );
  // Any change can change what is checked (a variant typed for a quantity, the template's size).
  form.addEventListener('input', (ev) => {
    if (ev.target !== file) renderPreview();
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (signing) return;
    error.textContent = '';
    for (const k of ['categoryCode', 'modelId', 'collectionId', 'material', 'productionBatch', 'productionDate', 'year', 'authPolicy'] as const) setFieldError(form, k, undefined);
    const { rows, problems } = pieces();
    if (problems.length > 0) {
      error.textContent = 'Fix the pieces listed above.';
      return;
    }
    if (rows.length === 0) {
      error.textContent = source.value === 'csv' ? 'Choose a CSV file.' : 'Enter a quantity.';
      return;
    }
    const built = buildIssueBatch(templateForm(), rows, ctx.now());
    if (!built.ok) {
      renderPreview();
      for (const [k, msg] of Object.entries(built.templateErrors)) setFieldError(form, k, msg);
      error.textContent = Object.keys(built.templateErrors).length > 0 ? 'Check the highlighted fields.' : 'Fix the pieces listed above.';
      return;
    }
    void sign(built.template, built.items, built.lines);
  });

  /**
   * One request after the other (one batch at a time per admin); a request that fails stops the rest.
   * The pieces that name their serial go first (batchSigningOrder), so an allocated serial never takes
   * one a later request names. A session that ends meanwhile (401) keeps the page (main.ts): the
   * requests already answered, and their claim codes, still reach the result screen.
   */
  const sign = async (template: Parameters<typeof batchRequests>[0], items: Parameters<typeof batchRequests>[1], lines: (number | null)[]) => {
    signing = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    const release = holdPage(
      template.withClaimSecret
        ? 'The batch is being signed. Leaving now would lose its results, and the claim codes of the pieces already signed.'
        : 'The batch is being signed. Leaving now would lose its results.',
    );
    const order = batchSigningOrder(items);
    const requests = batchRequests(template, order.map((i) => items[i]));
    const parts: BatchPart[] = [];
    let issued = 0;
    progress.textContent = `Signing… 0 of ${formatCount(items.length)}`;
    for (const r of requests) {
      // The admin left (and chose to): nothing more is signed that nobody would see.
      if (!form.isConnected) break;
      try {
        const response = await ctx.api.issueBatch(template, r.items);
        parts.push({ start: r.start, count: r.items.length, kind: 'answered', response });
        issued += response.issued;
        progress.textContent = `Signing… ${formatCount(issued)} of ${formatCount(items.length)}`;
        // The server stopped its batch (signing unavailable): the next requests would stop the same way.
        if (response.skipped > 0) break;
      } catch (e) {
        parts.push(
          e instanceof ApiError && e.status === 401
            ? { start: r.start, count: r.items.length, kind: 'refused', message: 'Not signed: the session ended before this request. Sign in again, then sign this piece.' }
            : refusedBeforeSigning(e)
              ? { start: r.start, count: r.items.length, kind: 'refused', message: e.message }
              : { start: r.start, count: r.items.length, kind: 'unanswered', message: 'No answer from the server: it may have signed this piece. Look for it in Products before signing it again.' },
        );
        break;
      }
    }
    release();
    // Replaced meanwhile (the admin left, and chose to): the results have no page to show on.
    if (!form.isConnected) return;
    onDone({ rows: batchResultRows(lines, items, parts, order), productionBatch: template.productionBatch });
  };

  renderPreview();
  return [header, h('div', { class: 'grid grid--gen' }, section('Batch form', form), h('aside', { class: 'gen__aside' }, bracket(aside), asideNotes()))];
}

function batchResultScreen(ctx: ViewContext, d: BatchDone): HTMLElement[] {
  const { rows, productionBatch } = d;
  const sum = batchSummary(rows);
  const title = sum.issued === sum.pieces ? 'Batch signed' : sum.issued > 0 ? 'Batch partly signed' : 'Batch not signed';
  const again = button('Issue another batch', { kind: 'secondary', testId: 'batch-again' });
  again.addEventListener('click', () => {
    void confirmLeave().then((ok) => ok && ctx.reload());
  });
  const actions = [
    linkButton('Open in Products', productionBatch ? href('products', {}, { productionBatch }) : href('products'), 'primary'),
    productionBatch && sum.issued > 0 ? linkButton('Print the codes', href('codes', {}, { productionBatch })) : null,
    again,
  ].filter((x): x is HTMLAnchorElement | HTMLButtonElement => x !== null);

  const tableHost = h('div', { class: 'batch__results', data: { testid: 'batch-results' } });
  const fromFile = rows.some((r) => r.line !== null);
  const renderTable = () => {
    const columns: Column<BatchResultRow>[] = [
      { label: fromFile ? 'Line' : 'Piece', cell: (r) => String(r.line ?? r.piece), kind: ['num'] },
      { label: 'Status', cell: (r) => statusMark(BATCH_OUTCOME_LABELS[r.status], OUTCOME_TONE[r.status]), kind: ['nowrap'] },
      { label: 'Product', cell: (r) => (r.status === 'ISSUED' && r.productId ? h('a', { class: 'idlink', attrs: { href: productHref(r.productId) } }, r.productId) : '—'), kind: ['nowrap'] },
      { label: 'Size', cell: (r) => r.variant || '—' },
      { label: 'SKU', cell: (r) => mono(r.sku), kind: ['nowrap'] },
      { label: 'Serial', cell: (r) => (r.serial === undefined ? '—' : String(r.serial)), kind: ['num'] },
      { label: 'Claim code', cell: (r) => (r.claimCode ? mono(formatClaimCode(r.claimCode)) : r.status === 'ISSUED' && hidden ? '•••• - •••• - ••••' : '—'), kind: ['nowrap'] },
      { label: 'Message', cell: (r) => r.message ?? '', kind: ['wide'] },
    ];
    mount(tableHost, table(columns, rows, { caption: 'Results, piece by piece' }));
  };

  let hidden = false;
  // Released when the claim codes are saved or hidden (a no-op when this page never held them).
  let release = () => {};
  const saved = h('p', { class: 'batch__saved', attrs: { 'aria-live': 'polite' }, data: { testid: 'batch-saved' } });
  const markSaved = (text: string) => {
    release();
    saved.textContent = text;
  };

  const results = button('Download results (CSV)', { kind: sum.claimCodes > 0 ? 'secondary' : 'ghost', testId: 'batch-download-results' });
  results.addEventListener('click', () => {
    const csv = batchResultsCsv(rows);
    saveDownload({ blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename: batchResultsFilename(productionBatch, ctx.now(), rows.length), contentType: 'text/csv' });
    if (!hidden && sum.claimCodes > 0) markSaved('Results saved, with the claim codes.');
  });

  let claim: HTMLElement | null = null;
  if (sum.claimCodes > 0) {
    release = holdPage(
      `The ${formatCount(sum.claimCodes)} claim codes of this batch are on this page and nowhere else. Leave without saving the certificate cards or the results file?`,
    );
    const layout = select(
      'certificateLayout',
      [
        { value: 'card', label: 'Cards, one per page' },
        { value: 'sheet', label: 'Sheets of eight cards' },
        { value: 'csv', label: 'CSV for the print shop' },
      ],
      'card',
    );
    const layoutField = field('Card format', layout, { hint: '95 × 62 mm cards, A4 sheets of eight, or the print shop’s file.' });
    const cards = button('Download certificate cards', { kind: 'secondary', testId: 'batch-certificates' });
    cards.addEventListener('click', () => {
      const parts = certificateRequests(batchCertificateItems(rows), layout.value === 'sheet' ? 'sheet' : 'card');
      const opts: CertificateOptions = layout.value === 'csv' ? { format: 'csv' } : { format: 'pdf', layout: layout.value === 'sheet' ? 'sheet' : 'card' };
      void busy(cards, async () => {
        // One request at a time: the server renders one certificate request per admin at once.
        for (let i = 0; i < parts.length; i++) {
          try {
            const file = await ctx.api.certificates(parts[i], opts);
            saveDownload({ ...file, filename: sheetPartFilename(file.filename, i + 1, parts.length) });
          } catch (e) {
            notifyError(e, 'The certificate cards could not be produced.');
            saved.textContent = parts.length > 1 ? `Part ${i + 1} of ${parts.length} could not be produced${i > 0 ? '; the parts before it were saved' : ''}.` : '';
            return;
          }
        }
        markSaved(parts.length > 1 ? `Certificate cards saved, in ${parts.length} files.` : 'Certificate cards saved.');
      }, 'Rendering…');
    });
    const note = h(
      'p',
      { class: 'claim__note' },
      `${formatCount(sum.claimCodes)} claim codes, one per signed piece, are in the table below and nowhere else: only their scrypt hashes are stored. ` +
        'Save the certificate cards, or the results file, which holds them (keep it as you would the cards), before leaving this page.',
    );
    const hide = button('I have recorded them — hide', { kind: 'ghost', testId: 'batch-hide' });
    hide.addEventListener('click', () => {
      // Drop the only copies the console holds.
      for (const r of rows) delete r.claimCode;
      hidden = true;
      release();
      panel.classList.add('is-hidden');
      note.textContent = 'The claim codes are hidden: the console no longer holds them.';
      layoutField.remove();
      cards.remove();
      hide.remove();
      renderTable();
    });
    const panel = h(
      'section',
      { class: ['claim', 'claim--batch'], attrs: { 'aria-label': 'One-time claim codes' } },
      h('p', { class: 'claim__label' }, 'Claim codes · shown once'),
      note,
      h('div', { class: 'claim__tools' }, layoutField, cards, results, hide),
      saved,
    );
    claim = bracket(panel);
  }

  renderTable();
  return [
    pageHeader({ eyebrow: 'Generator · batch', title, lead: `${sum.text}${productionBatch ? ` Production batch ${productionBatch}.` : ''}`, actions }),
    claim,
    section('Pieces', tableHost, {
      note: `${formatCount(sum.issued)} signed · ${formatCount(sum.pieces - sum.issued)} not signed`,
      tools: claim ? [] : [results],
      id: 'batch-pieces',
    }),
  ].filter((x): x is HTMLElement => x !== null);
}
