/**
 * Product page (master spec §22).
 *
 *   PRODUCT O26-J-00184 · GENOME [visual] · CODE STATUS · SIGNATURE ·
 *   SCAN COUNT · OWNERSHIP · WARRANTY · ANOMALIES
 *
 * Photographs (F-04): the piece's own (added or replaced here by an
 * OPERATOR, as at issuance) and its model's reference photograph (set in
 * the Catalogue), both shown above the GENOME of its authentic results.
 *
 * The signature line is the server's live re-verification of the stored
 * code (payload fields, hash, key trust and Ed25519), not a stored flag.
 * Actions are offered according to the lifecycle snapshot and the admin's
 * role; destructive ones ask for a typed confirmation.
 */
import { h } from '../../shared/dom.js';
import { anomalyName, formatDate, formatDateTime, humanize, isoDay, shortHash, summarizeDetails, versionLabel } from '../format.js';
import { can } from '../model/permissions.js';
import { PIECE_PHOTO_IMPACT } from '../model/photo.js';
import { openAnomalies, productActions, productAttributes, productSheet, type ProductActions } from '../model/product.js';
import { confirmationPhrase } from '../model/registry.js';
import { retailerOptions } from '../model/sale.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { SERVICE_TYPES, type IssuedCodeJson, type ProductDetail, type ProductStatus, type Retailer } from '../types.js';
import { artifactPanel } from '../ui/artifacts.js';
import { anomalyStatus, button, defList, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { genomeFigure } from '../ui/figures.js';
import { photoDialog, photoThumb } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** A code re-issued on this page, kept (in memory only) so its preview survives reloads until dismissed. */
let freshCode: { productId: string; code: IssuedCodeJson; glyphs: number[] } | null = null;

/**
 * Forget any re-issued code held for preview. Called whenever the session
 * ends: the framed data is scannable and must never be shown to the next
 * admin signing in on the same tab.
 */
export function resetProductViewState(): void {
  freshCode = null;
}

export async function productView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.productId;
  const [d, scans] = await Promise.all([ctx.api.product(id), ctx.api.scans({ productId: id, pageSize: 10 })]);
  if (freshCode && freshCode.productId !== d.product.productId) freshCode = null;
  const role = ctx.session.admin.role;
  const actions = productActions(d, role);
  const p = d.product;

  // ── Hero: genome + spec §22 fact sheet ──────────────────────────────────
  const sheet = productSheet(d);
  const hero = h(
    'div',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero__genome' },
      d.genome ? genomeFigure(d.genome, { size: 'lg' }) : h('div', { class: 'figure figure--lg figure--empty' }, 'NO GENOME'),
      d.genome
        ? h(
            'div',
            { class: 'hero__caption' },
            h('span', { class: 'hero__caption-label' }, 'Genome'),
            mono(d.genome.fingerprint),
            h('span', { class: 'hero__caption-sub' }, d.genome.versionLabel),
            h('span', { class: 'hero__caption-ids mono' }, d.genome.ids.join('\u00a0· ')),
          )
        : null,
    ),
    h(
      'dl',
      { class: 'sheet', data: { testid: 'product-sheet' } },
      ...sheet.map((r) =>
        h(
          'div',
          { class: ['sheet__row', `sheet__row--${r.key}`], data: { row: r.key } },
          h('dt', { class: 'sheet__label' }, r.label),
          h(
            'dd',
            { class: 'sheet__value' },
            r.key === 'product'
              ? h('span', { class: 'sheet__id' }, r.value)
              : r.mono
                ? mono(r.value)
                : r.plain
                  ? h('span', { class: 'sheet__plain' }, r.value)
                  : statusMark(r.value, r.tone),
            r.note ? h('span', { class: 'sheet__note' }, r.note) : null,
          ),
        ),
      ),
    ),
  );

  const parts: (HTMLElement | null)[] = [
    pageHeader({
      eyebrow: 'Product',
      title: p.productId,
      identifier: true,
      lead: [humanize(p.model.name), humanize(p.model.type), humanize(p.category.name), humanize(p.material)].join(' · '),
      actions: [linkButton('All products', href('products'), 'ghost')],
    }),
    hero,
  ];

  if (freshCode && actions.canDownload) parts.push(freshCodePanel(ctx, freshCode));
  parts.push(actionsPanel(ctx, d, actions));

  const active = d.codes.find((c) => c.status === 'ACTIVE');
  if (active && actions.canDownload) {
    parts.push(
      section('Print artifacts', artifactPanel(ctx.api, { codeId: active.id }), {
        note: `Code issue ${active.issue} · ${versionLabel('CODE', active.codeVersion)}`,
        id: 'artifacts',
      }),
    );
  }

  parts.push(section('Product', defList(productAttributes(d).map((a) => ({ label: a.label, value: a.mono ? mono(a.value) : a.value })), 'deflist--cols'), { id: 'attributes' }));
  parts.push(photographsPanel(ctx, d));
  parts.push(codesPanel(d, actions));
  parts.push(ownershipPanel(d));
  parts.push(warrantyPanel(d));
  parts.push(anomaliesPanel(d));
  parts.push(historyPanel(d));
  parts.push(
    section(
      'Verification events',
      table(
        [
          { label: 'When', cell: (r) => formatDateTime(r.occurredAt), kind: ['nowrap'] },
          { label: 'Event', cell: (r) => humanize(r.eventType) },
          { label: 'Result', cell: (r) => statusMark(humanize(r.state), toneOf('verification', r.state)), kind: ['wide'] },
          { label: 'Genome', cell: (r) => humanize(r.authentication?.genomeCheck) },
          { label: 'Risk', cell: (r) => (r.authentication ? String(r.authentication.riskScore) : '—'), kind: ['num'] },
          { label: 'Country', cell: (r) => r.country ?? '—', kind: ['nowrap'] },
        ],
        scans.items,
        { empty: 'This product has not been scanned.' },
      ),
      { note: `${d.scans.count} in total`, tools: [linkButton('All events', href('scans', {}, { productId: p.productId }), 'ghost')] },
    ),
  );

  return h('div', { class: 'view view--product', data: { product: p.productId } }, ...parts);
}

// ── Photographs ────────────────────────────────────────────────────────────

/**
 * The piece's own photograph and its model's reference photograph. /verify shows the model's alone on an authentic
 * result (plan NOCTURNE, decision 9: the model is the reference for a piece); the piece's own stays in the records,
 * for ORBES staff only.
 */
function photographsPanel(ctx: ViewContext, d: ProductDetail): HTMLElement {
  const p = d.product;
  const canPhotograph = can(ctx.session.admin.role, 'photograph');
  const label = p.photoUrl ? 'Replace the photo of this piece' : 'Add a photo of this piece';
  const piece = h(
    'figure',
    { class: 'photo-pair__item', data: { testid: 'product-photo' } },
    photoThumb(p.photoUrl, `${p.productId}: the photograph of this piece`, 'lg'),
    h('figcaption', { class: 'photo-pair__caption' }, 'This piece'),
    canPhotograph
      ? button(label, {
          kind: 'ghost',
          testId: 'product-photo-edit',
          onClick: () =>
            void photoDialog({
              title: label,
              eyebrow: p.productId,
              impact: PIECE_PHOTO_IMPACT,
              current: p.photoUrl,
              currentAlt: `${p.productId}: the current photograph`,
              save: async (photo) => {
                await ctx.api.setProductPhoto(p.productId, photo);
              },
              remove: async () => {
                await ctx.api.removeProductPhoto(p.productId);
              },
            }).then((r) => {
              if (r) done(ctx, r === 'removed' ? 'Photograph removed.' : 'Photograph saved.');
            }),
        })
      : null,
  );
  const model = h(
    'figure',
    { class: 'photo-pair__item', data: { testid: 'model-photo' } },
    photoThumb(p.model.imageUrl, `${humanize(p.model.name)} ${humanize(p.model.type)}: reference photograph`, 'lg'),
    h('figcaption', { class: 'photo-pair__caption' }, 'The model'),
    linkButton('Catalogue', href('catalogue'), 'ghost'),
  );
  return section('Photographs', h('div', { class: 'photo-pair' }, piece, model), { id: 'photographs', note: 'The model’s on its authentic results on /verify; the piece’s for ORBES staff only' });
}

// ── Actions ────────────────────────────────────────────────────────────────

function done(ctx: ViewContext, message: string): void {
  notify(message);
  ctx.reload();
}

/**
 * The point of sale comes from the register (A-08), never typed: the active points of sale of
 * GET /api/admin/retailers, the country defaulting to the chosen one's. The API still takes the
 * free-text `retailer` of older records; the console no longer sends it.
 */
async function activateWarrantyDialog(ctx: ViewContext, pid: string): Promise<void> {
  let retailers: Retailer[];
  try {
    retailers = (await ctx.api.retailers({ activeOnly: true })).items;
  } catch (e) {
    notifyError(e, 'The points of sale could not be loaded.');
    return;
  }
  const options = retailerOptions(retailers);
  const r = await openDialog({
    title: 'Activate the warranty',
    eyebrow: pid,
    fields: [
      { name: 'purchaseDate', label: 'Purchase date', kind: 'date', value: isoDay(ctx.now()), required: true },
      {
        name: 'retailerId',
        label: 'Point of sale',
        kind: 'select',
        options: [{ value: '', label: options.length ? 'None recorded' : 'No point of sale registered' }, ...options],
        hint: options.length ? 'From the register of points of sale (Clients · Points of sale).' : 'An ADMIN adds them on the Points of sale page.',
      },
      { name: 'country', label: 'Country', maxlength: 2, hint: 'Two-letter ISO code, e.g. FR; by default the country of the point of sale.' },
    ],
    validate: (v) => (v.country && !/^[A-Za-z]{2}$/.test(v.country.trim()) ? 'Country is a two-letter code.' : null),
    confirmLabel: 'Activate',
    submit: async (v) => {
      await ctx.api.activateWarranty(pid, {
        purchaseDate: v.purchaseDate,
        ...(v.retailerId ? { retailerId: v.retailerId } : {}),
        ...(v.country?.trim() ? { country: v.country.trim().toUpperCase() } : {}),
      });
    },
  });
  if (r) done(ctx, 'Warranty activated.');
}

function actionsPanel(ctx: ViewContext, d: ProductDetail, a: ProductActions): HTMLElement | null {
  const api = ctx.api;
  const pid = d.product.productId;
  const groups: HTMLElement[] = [];
  const group = (title: string, ...buttons: (HTMLElement | null)[]) => {
    const b = buttons.filter((x): x is HTMLElement => x !== null);
    if (b.length) groups.push(h('div', { class: 'actions__group' }, h('p', { class: 'actions__title' }, title), h('div', { class: 'actions__buttons' }, ...b)));
  };

  group(
    'Lifecycle',
    a.transitions.length
      ? button('Change status', { testId: 'action-transition', onClick: () => void transitionDialog(ctx, d, a.transitions) })
      : null,
    a.canReinstate
      ? button('Reinstate', {
          testId: 'action-reinstate',
          onClick: () =>
            void openDialog({
              title: `Reinstate ${pid}`,
              eyebrow: 'Lifecycle',
              body: h('p', { class: 'dialog__text' }, `The product returns to ${humanize(d.lifecycle.returnTo)}. Its codes are not reactivated automatically.`),
              fields: [{ name: 'reason', label: 'Reason', kind: 'textarea', maxlength: 1000 }],
              confirmLabel: 'Reinstate',
              submit: async (v) => {
                await api.reinstate(pid, v.reason?.trim() || undefined);
              },
            }).then((r) => r && done(ctx, `${pid} reinstated.`)),
        })
      : null,
  );

  group(
    'Code',
    a.canReissue
      ? button('Re-issue code', {
          testId: 'action-reissue',
          onClick: () =>
            void openDialog({
              title: 'Re-issue the code',
              eyebrow: pid,
              body: h('p', { class: 'dialog__text' }, 'A new code (next issue number) is signed with the active key. The current code becomes SUPERSEDED and verifies as REVOKED.'),
              fields: [{ name: 'reason', label: 'Reason', kind: 'textarea', required: true, maxlength: 500, hint: 'e.g. engraving damaged, label replaced.' }],
              confirmLabel: 'Sign new code',
              submit: async (v) => {
                const r = await api.reissueCode(pid, v.reason.trim());
                freshCode = { productId: pid, code: r.code, glyphs: d.genome ? [...d.genome.glyphs] : [] };
              },
            }).then((r) => r && done(ctx, 'New code signed.')),
        })
      : null,
    a.revocableCodeId
      ? button('Revoke code', {
          kind: 'danger',
          onClick: () => {
            const code = d.codes.find((c) => c.id === a.revocableCodeId)!;
            void openDialog({
              title: `Revoke code issue ${code.issue}`,
              eyebrow: pid,
              danger: true,
              body: h('p', { class: 'dialog__text' }, 'Every scan of this code will answer REVOKED. The product keeps its identity and can receive a new code.'),
              fields: [{ name: 'reason', label: 'Reason', kind: 'textarea', required: true, maxlength: 500 }],
              phrase: confirmationPhrase('revoke-code', code.issue),
              confirmLabel: 'Revoke code',
              submit: async (v) => {
                await api.revokeCode(code.id, v.reason.trim());
              },
            }).then((r) => r && done(ctx, `Code issue ${code.issue} revoked.`));
          },
        })
      : null,
  );

  group(
    'Warranty',
    a.canActivateWarranty
      ? button('Activate warranty', {
          testId: 'action-warranty',
          onClick: () => void activateWarrantyDialog(ctx, pid),
        })
      : null,
    a.canExtendWarranty
      ? button('Extend warranty', {
          testId: 'action-warranty-extend',
          onClick: () =>
            void openDialog({
              title: 'Extend the warranty',
              eyebrow: pid,
              body: h('p', { class: 'dialog__text' }, `The end date moves by whole months from the start date (now ${formatDate(d.warranty?.endDate ?? null)}).`),
              fields: [{ name: 'months', label: 'Months to add', hint: 'From 1 to 120.', required: true, maxlength: 3, value: '12' }],
              validate: (v) => (/^\d{1,3}$/.test(v.months.trim()) && Number(v.months) >= 1 && Number(v.months) <= 120 ? null : 'Enter a whole number of months from 1 to 120.'),
              confirmLabel: 'Extend',
              submit: async (v) => {
                await api.extendWarranty(pid, Number(v.months.trim()));
              },
            }).then((r) => r && done(ctx, 'Warranty extended.')),
        })
      : null,
    a.canVoidWarranty
      ? button('Void warranty', {
          kind: 'danger',
          onClick: () =>
            void openDialog({
              title: 'Void the warranty',
              eyebrow: pid,
              danger: true,
              body: h('p', { class: 'dialog__text' }, 'A void warranty cannot be reactivated from the console.'),
              fields: [{ name: 'reason', label: 'Reason', kind: 'textarea', required: true, maxlength: 1000 }],
              confirmLabel: 'Void warranty',
              submit: async (v) => {
                await api.voidWarranty(pid, v.reason.trim());
              },
            }).then((r) => r && done(ctx, 'Warranty voided.')),
        })
      : null,
  );

  group(
    'Service',
    a.canOpenService
      ? button('Open service record', {
          onClick: () =>
            void openDialog({
              title: 'Open a service record',
              eyebrow: pid,
              body: h('p', { class: 'dialog__text' }, 'The product moves to SERVICED until the record is completed.'),
              fields: [
                { name: 'type', label: 'Service', kind: 'select', options: SERVICE_TYPES.filter((t) => t !== 'YEARLY_CARE').map((t) => ({ value: t, label: humanize(t) })), required: true },
                { name: 'location', label: 'Location', maxlength: 200 },
                { name: 'performedBy', label: 'Performed by', maxlength: 200 },
                { name: 'notes', label: 'Notes', kind: 'textarea', maxlength: 4000 },
              ],
              confirmLabel: 'Open record',
              submit: async (v) => {
                await api.openService(pid, {
                  type: v.type as (typeof SERVICE_TYPES)[number],
                  ...(v.location?.trim() ? { location: v.location.trim() } : {}),
                  ...(v.performedBy?.trim() ? { performedBy: v.performedBy.trim() } : {}),
                  ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}),
                });
              },
            }).then((r) => r && done(ctx, 'Service record opened.')),
        })
      : null,
    ...a.completableServices.map((s) =>
      button(`Complete ${humanize(s.type)}`, {
        onClick: () =>
          void openDialog({
            title: `Complete ${humanize(s.type)}`,
            eyebrow: pid,
            fields: [{ name: 'notes', label: 'Closing notes', kind: 'textarea', maxlength: 4000 }],
            confirmLabel: 'Complete',
            submit: async (v) => {
              await api.completeService(s.id, v.notes?.trim() || undefined);
            },
          }).then((r) => r && done(ctx, 'Service record completed.')),
      }),
    ),
  );

  group(
    'Ownership',
    a.canConfirmOwnership
      ? button('Confirm ownership', {
          onClick: () =>
            void openDialog({
              title: 'Confirm ownership',
              eyebrow: pid,
              body: h('p', { class: 'dialog__text' }, 'Confirm only after client services has reviewed proof of purchase. The owner becomes verified; a REGISTERED product becomes OWNED.'),
              confirmLabel: 'Confirm ownership',
              submit: async () => {
                await api.confirmOwnership(pid);
              },
            }).then((r) => r && done(ctx, 'Ownership confirmed.')),
        })
      : null,
  );

  if (groups.length === 0) return null;
  return section('Actions', h('div', { class: 'actions' }, ...groups), { id: 'actions', note: 'Every action is signed into the audit log' });
}

async function transitionDialog(ctx: ViewContext, d: ProductDetail, allowed: ProductStatus[]): Promise<void> {
  const pid = d.product.productId;
  const options = allowed.map((s) => ({ value: s, label: humanize(s) + (s === d.lifecycle.returnTo ? ' (return)' : '') }));
  // Revocation is the only irreversible move here: it gets its own typed confirmation.
  const first = await openDialog({
    title: 'Change lifecycle status',
    eyebrow: `${pid} · currently ${humanize(d.lifecycle.status)}`,
    fields: [
      { name: 'to', label: 'New status', kind: 'select', options, required: true },
      { name: 'reason', label: 'Reason', kind: 'textarea', maxlength: 1000, hint: 'Recorded in the status history and the audit log.' },
    ],
    confirmLabel: 'Continue',
  });
  if (!first) return;
  const to = first.to as ProductStatus;
  const revoking = to === 'REVOKED';
  const ok = await openDialog({
    title: revoking ? `Revoke ${pid}` : `${humanize(d.lifecycle.status)} → ${humanize(to)}`,
    eyebrow: 'Confirm',
    danger: revoking || to === 'COUNTERFEIT_FLAGGED' || to === 'RETIRED',
    body: h(
      'p',
      { class: 'dialog__text' },
      revoking
        ? 'Every scan of this product will answer REVOKED. Only an ADMIN can reinstate it.'
        : to === 'RETIRED'
          ? 'RETIRED is terminal: the product can never leave this status.'
          : `The product moves to ${humanize(to)}.`,
    ),
    ...(revoking ? { phrase: confirmationPhrase('revoke-product', pid) } : {}),
    confirmLabel: revoking ? 'Revoke product' : 'Apply',
    submit: async () => {
      await ctx.api.transition(pid, to, first.reason?.trim() || undefined);
    },
  });
  if (ok) done(ctx, `${pid} is now ${humanize(to)}.`);
}

function freshCodePanel(ctx: ViewContext, f: NonNullable<typeof freshCode>): HTMLElement {
  const dismiss = button('Dismiss', {
    kind: 'ghost',
    onClick: () => {
      freshCode = null;
      ctx.reload();
    },
  });
  return section(
    `New code · issue ${f.code.issue}`,
    [
      h('p', { class: 'notice' }, 'This preview is the exact code that was signed. Download the print files now; the preview is not kept after you leave this page.'),
      artifactPanel(ctx.api, { codeId: f.code.id, preview: f.glyphs.length === 8 ? { data: f.code.data, glyphs: f.glyphs } : undefined }),
    ],
    { tools: [dismiss], class: 'panel--fresh', id: 'fresh-code' },
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

function codesPanel(d: ProductDetail, a: ProductActions): HTMLElement {
  return section(
    'Codes',
    table(
      [
        { label: 'Issue', cell: (c) => String(c.issue), kind: ['num'] },
        { label: 'Status', cell: (c) => statusMark(humanize(c.status), toneOf('code', c.status)), kind: ['nowrap'] },
        {
          label: 'Signature',
          cell: (c) => (c.verification.valid ? statusMark('VALID', 'solid') : statusMark(`INVALID · ${humanize(c.verification.reason)}`, 'critical')),
          kind: ['nowrap'],
        },
        { label: 'Key', cell: (c) => mono(`#${c.keyId}`), kind: ['nowrap'] },
        { label: 'Version', cell: (c) => versionLabel('CODE', c.codeVersion), kind: ['nowrap'] },
        { label: 'Issued', cell: (c) => formatDate(c.issuedAt), kind: ['nowrap'] },
        { label: 'Nonce', cell: (c) => mono(c.nonce), kind: ['nowrap'] },
        { label: 'Payload SHA-256', cell: (c) => mono(c.payloadHash, shortHash(c.payloadHash, 10, 6)), kind: ['wide'] },
        { label: 'Revoked', cell: (c) => (c.revokedAt ? h('span', { attrs: { title: c.revocationReason ?? '' } }, formatDate(c.revokedAt)) : '—'), kind: ['nowrap'] },
      ],
      [...d.codes].sort((x, y) => y.issue - x.issue),
      { empty: 'No code issued.' },
    ),
    { id: 'codes', note: a.canDownload ? 'Signature re-verified live on every load' : 'Signature re-verified live · downloads need OPERATOR' },
  );
}

function ownershipPanel(d: ProductDetail): HTMLElement {
  const cur = d.ownership.current;
  return section(
    'Ownership',
    [
      defList([
        { label: 'State', value: statusMark(humanize(d.product.ownershipState), toneOf('ownership', d.product.ownershipState)) },
        {
          label: 'Current owner',
          value: cur ? h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: cur.accountId }), 'data-testid': 'current-owner' } }, mono(cur.accountId, shortHash(cur.accountId, 8, 4))) : 'NONE',
          note: cur ? `${cur.verified ? 'VERIFIED' : 'UNVERIFIED'} · ${humanize(cur.acquiredVia)} · SINCE ${formatDate(cur.since)}` : undefined,
        },
        { label: 'Transfer', value: cur?.transferPending ? statusMark('PENDING', 'outline') : 'NONE' },
      ]),
      table(
        [
          // The owner's sheet (A-06); the email is masked for an AUDITOR by the server.
          {
            label: 'Owner',
            cell: (o) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: o.accountId }) } }, o.email), o.displayName ? h('span', { class: 'cell-sub' }, o.displayName) : null),
            kind: ['wide'],
          },
          { label: 'Acquired', cell: (o) => humanize(o.acquiredVia) },
          { label: 'Verified', cell: (o) => (o.verified ? 'YES' : 'NO') },
          { label: 'From', cell: (o) => formatDate(o.startedAt), kind: ['nowrap'] },
          { label: 'Until', cell: (o) => (o.endedAt ? `${formatDate(o.endedAt)} · ${humanize(o.endedReason)}` : 'CURRENT'), kind: ['nowrap'] },
        ],
        d.ownership.owners,
        { empty: 'Never registered.' },
      ),
      d.ownership.transfers.length
        ? table(
            [
              { label: 'Transfer', cell: (t) => mono(t.id, shortHash(t.id, 8, 4)) },
              { label: 'Status', cell: (t) => humanize(t.status) },
              { label: 'Created', cell: (t) => formatDateTime(t.createdAt), kind: ['nowrap'] },
              { label: 'Expires', cell: (t) => formatDateTime(t.expiresAt), kind: ['nowrap'] },
              { label: 'Completed', cell: (t) => formatDateTime(t.completedAt), kind: ['nowrap'] },
            ],
            d.ownership.transfers,
          )
        : null,
    ].filter((x): x is HTMLElement => x !== null),
    { id: 'ownership' },
  );
}

function warrantyPanel(d: ProductDetail): HTMLElement {
  const w = d.warranty;
  return section(
    'Warranty & service',
    [
      defList([
        { label: 'Status', value: statusMark(humanize(w?.status ?? 'NOT_STARTED'), toneOf('warranty', w?.status ?? 'NOT_STARTED')) },
        { label: 'Period', value: w?.startDate ? `${formatDate(w.startDate)} → ${formatDate(w.endDate)}` : '—', note: w ? `${w.durationMonths} months` : undefined },
        { label: 'Purchase', value: w?.purchaseDate ? formatDate(w.purchaseDate) : '—', note: [w?.retailer, w?.country].filter(Boolean).join(' · ') || undefined },
        ...(w?.voidedAt ? [{ label: 'Voided', value: formatDate(w.voidedAt), note: w.voidReason ?? undefined }] : []),
      ]),
      table(
        [
          { label: 'Service', cell: (s) => humanize(s.type) },
          { label: 'Status', cell: (s) => statusMark(humanize(s.status), toneOf('service', s.status)), kind: ['nowrap'] },
          { label: 'Location', cell: (s) => s.location ?? '—' },
          { label: 'By', cell: (s) => s.performedBy ?? '—' },
          { label: 'Opened', cell: (s) => formatDate(s.openedAt), kind: ['nowrap'] },
          { label: 'Closed', cell: (s) => formatDate(s.closedAt), kind: ['nowrap'] },
          { label: 'Notes', cell: (s) => s.notes ?? '', kind: ['wide'] },
        ],
        d.services,
        { empty: 'No service record.' },
      ),
    ],
    { id: 'warranty' },
  );
}

function anomaliesPanel(d: ProductDetail): HTMLElement {
  const open = openAnomalies(d).length;
  return section(
    'Anomalies',
    table(
      [
        { label: 'Finding', cell: (x) => anomalyName(x.type) },
        { label: 'Severity', cell: (x) => statusMark(x.severity, toneOf('severity', x.severity)), kind: ['nowrap'] },
        { label: 'Status', cell: (x) => anomalyStatus(x), kind: ['nowrap'] },
        { label: 'Seen', cell: (x) => String(x.occurrences), kind: ['num'] },
        { label: 'Last', cell: (x) => formatDateTime(x.lastSeenAt), kind: ['nowrap'] },
        { label: 'Details', cell: (x) => h('span', { class: 'cell-details' }, summarizeDetails(x.details)), kind: ['wide'] },
      ],
      d.anomalies,
      { empty: 'No anomaly recorded for this product.' },
    ),
    // Triage this product's findings: the list filtered by the product, most severe first.
    { id: 'anomalies', note: open ? `${open} open` : 'None open', tools: [linkButton('Triage', href('anomalies', {}, { productId: d.product.productId }), 'ghost')] },
  );
}

function historyPanel(d: ProductDetail): HTMLElement {
  const steps = [...d.statusHistory].reverse();
  return section(
    'Status history',
    steps.length
      ? h(
          'ol',
          { class: 'timeline' },
          ...steps.map((s) =>
            h(
              'li',
              { class: 'timeline__item' },
              h('span', { class: 'timeline__when' }, formatDateTime(s.at)),
              h('span', { class: 'timeline__move' }, s.from ? `${humanize(s.from)} → ` : '', h('strong', null, humanize(s.to))),
              h('span', { class: 'timeline__who' }, `${s.actorType.toUpperCase()}${s.actorId ? ` · ${shortHash(s.actorId, 8, 4)}` : ''}`),
              s.reason ? h('span', { class: 'timeline__reason' }, s.reason) : null,
            ),
          ),
        )
      : h('p', { class: 'soft micro' }, 'No history.'),
    { id: 'history' },
  );
}

