/**
 * A warranty claim's page (plan ORBES CARE of 2026-10-15, §2(b); `#/warranty-claims/:claimId`, under Warranties), built
 * like a PRIVATE CARE request's page: the piece, the claimant and the registered owner, the basis (Lifetime warranty,
 * 2-year warranty, Legal guarantee), the client's conversation, the free replacement (a lifetime claim only), each step's
 * date and who took it, and the steps (every one an OPERATOR's, answer 11):
 *
 *   OPEN         SEND LABEL (the PDF, its carrier and tracking: the client downloads it from the piece's ORBES CARE tab),
 *                REFUSE (a reason of the basis's list, for a case that needs no piece), CLOSE (a note)
 *   LABEL_SENT   RECEIVED (an INSPECTION record opens, the piece IN SERVICE until the claim ends), CLOSE
 *   RECEIVED     DECIDE (only what the claim's warranty allows now, the server's `decision`), and on a 2-year claim within
 *                the legal guarantee MOVE TO THE LEGAL GUARANTEE (the LEGAL claim's page follows; each links the other)
 *   DECIDED      SHIP (the new piece, or the piece back): DONE
 *
 * The free replacement is never offered twice: the server filters the outcomes (`decision.outcomes`) and refuses it.
 * Each change is audited, and the page is read again. Nothing is written in the client's messages.
 */
import { h } from '../../shared/dom.js';
import { formatDate, formatDateTime, humanize, isoDay } from '../format.js';
import { labelFileProblem, shipmentText } from '../model/care.js';
import {
  amountAsked,
  CLAIM_ACTION_LABELS,
  CLAIM_BASIS_LABELS,
  CLAIM_STATUS_LABELS,
  claimActions,
  claimHref,
  decisionBasisLine,
  decisionChoices,
  decisionNote,
  decisionText,
  refusalOptions,
  type ClaimAction,
} from '../model/claims.js';
import { parseMoney } from '../model/live.js';
import { STATUS_LABELS } from '../model/messages.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { Carrier, ClaimSheet, WarrantyClaimOutcome, WarrantyClaimRefusal } from '../types.js';
import { button, defList, field, input, linkButton, pageHeader, section, statusMark } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

function shipment(s: ClaimSheet['label'] | ClaimSheet['return'], testid: string): HTMLElement | string {
  if (!s) return '—';
  return h('a', { class: 'idlink', attrs: { href: s.trackingUrl, target: '_blank', rel: 'noopener noreferrer', 'data-testid': testid } }, shipmentText(s));
}

function carrierOptions(carriers: Carrier[]): { value: string; label: string }[] {
  return [{ value: '', label: 'Choose a carrier' }, ...carriers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))];
}

function who(at: string | null, by: { email: string } | null): string {
  if (!at) return '—';
  return by ? `${formatDateTime(at)} · ${by.email}` : formatDateTime(at);
}

const NOTE_MAX = 500;

export async function warrantyClaimView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.claimId ?? '';
  const [s, carriers] = await Promise.all([ctx.api.warrantyClaim(id), ctx.api.carriers().then((r) => r.items)]);
  const today = isoDay(ctx.now());
  const done = (msg: string) => (ok: unknown) => {
    if (!ok) return;
    notify(msg);
    ctx.reload();
  };
  const eyebrow = `${s.piece.productId} · ${CLAIM_BASIS_LABELS[s.basis]}`;
  const tracking = { name: 'tracking', label: 'Tracking number', required: true, maxlength: 40 } as const;
  const carrier = { name: 'carrierId', label: 'Carrier', kind: 'select' as const, required: true, options: carrierOptions(carriers) };
  const reasons = refusalOptions(s.basis, s.decision.refusalReasons);
  /** The LEGAL claim MOVE TO THE LEGAL GUARANTEE answered: its page follows. */
  let moved: string | null = null;

  const open: Record<ClaimAction, () => void> = {
    label: () => {
      const file = input('label', { type: 'file' });
      file.accept = 'application/pdf,.pdf';
      file.setAttribute('data-testid', 'claim-label-file');
      void openDialog({
        title: 'Send label',
        eyebrow,
        body: [
          h(
            'p',
            { class: 'dialog__text' },
            s.account
              ? 'The prepaid label shows in the piece’s ORBES CARE tab of the client’s app, with its carrier and tracking number. Nothing is written in their messages.'
              : 'This buyer has no ORBES account: send them the label by email as well. The claim shows nowhere in the app.',
          ),
          field('Label', file, { wide: true, hint: 'The PDF itself, at most 2 MB.' }),
        ],
        confirmLabel: 'Send label',
        fields: [carrier, tracking],
        validate: () => labelFileProblem(file.files?.[0] ?? null),
        submit: async (v) => {
          await ctx.api.sendClaimLabel(s.id, file.files![0]!, v.carrierId ?? '', (v.tracking ?? '').trim());
        },
      }).then(done('Label sent.'), notifyError);
    },
    refuse: () => {
      void openDialog({
        title: 'Refuse the claim',
        eyebrow,
        body: h('p', { class: 'dialog__text' }, 'For a case that needs no piece, for example a lost piece. The claim ends at once.'),
        confirmLabel: 'Refuse',
        fields: [{ name: 'reason', label: 'Reason', kind: 'select', required: true, options: [{ value: '', label: 'Choose a reason' }, ...reasons] }],
        validate: (v) => (v.reason ? null : 'Choose the reason of the refusal.'),
        submit: async (v) => {
          await ctx.api.decideWarrantyClaim(s.id, { outcome: 'REFUSED', refusalReason: v.reason as WarrantyClaimRefusal });
        },
      }).then(done('Claim refused.'), notifyError);
    },
    close: () => {
      void openDialog({
        title: 'Close the claim',
        eyebrow,
        body: h('p', { class: 'dialog__text' }, 'The client never sent the piece, or withdrew. The client reads that the claim was closed.'),
        confirmLabel: 'Close the claim',
        cancelLabel: 'Keep it',
        fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: NOTE_MAX, hint: 'Staff only.' }],
        submit: async (v) => {
          await ctx.api.cancelWarrantyClaim(s.id, (v.note ?? '').trim());
        },
      }).then(done('Claim closed.'), notifyError);
    },
    receive: () => {
      void openDialog({
        title: 'Received',
        eyebrow,
        body: h('p', { class: 'dialog__text' }, 'The piece is with ORBES: an INSPECTION service record opens and the piece reads IN SERVICE until the claim ends.'),
        confirmLabel: 'Received',
        submit: async () => {
          await ctx.api.receiveWarrantyClaim(s.id);
        },
      }).then(done('Received.'), notifyError);
    },
    decide: () => {
      const replacing = (v: Record<string, string>) => v.outcome === 'REPLACEMENT';
      void openDialog({
        title: 'Decide',
        eyebrow,
        body: h('p', { class: 'dialog__text' }, `${CLAIM_BASIS_LABELS[s.basis]}: only what it allows is offered.`),
        confirmLabel: 'Decide',
        fields: [
          {
            name: 'outcome',
            label: 'Decision',
            kind: 'select',
            required: true,
            options: [{ value: '', label: 'Choose a decision' }, ...decisionChoices(s)],
          },
          { name: 'reason', label: 'Reason', kind: 'select', options: [{ value: '', label: 'Choose a reason' }, ...reasons], shown: (v) => v.outcome === 'REFUSED' },
          {
            name: 'replacement',
            label: 'ORBES identity of the replacement',
            maxlength: 40,
            hint: 'An ISSUED piece of the same SKU, never sold, e.g. O26-J-00201.',
            shown: replacing,
          },
          { name: 'otherSize', label: 'Another size, as the client asked', kind: 'checkbox', hint: 'Another SKU of the same model: recorded in the audit log.', shown: replacing },
          {
            name: 'amount',
            label: 'Amount',
            maxlength: 12,
            hint: 'In units, e.g. 450. A price reduction: at most the price paid.',
            shown: (v) => amountAsked(v.outcome, s.decision),
          },
        ],
        live: (v) => {
          const note = decisionNote(s, v.outcome);
          const value = decisionBasisLine(s.decision, v.outcome);
          return [
            value ? h('p', { class: 'dialog__text', data: { testid: 'claim-decision-value' } }, value) : null,
            note ? h('p', { class: 'dialog__text', data: { testid: 'claim-decision-note' } }, note) : null,
          ].filter((x): x is HTMLParagraphElement => x !== null);
        },
        validate: (v) => {
          if (!v.outcome) return 'Choose a decision.';
          if (v.outcome === 'REFUSED' && !v.reason) return 'Choose the reason of the refusal.';
          if (v.outcome === 'REPLACEMENT' && !(v.replacement ?? '').trim()) return 'Enter the ORBES identity of the replacement.';
          if (amountAsked(v.outcome, s.decision) && !parseMoney(v.amount)) return 'Enter the amount, in units.';
          return null;
        },
        submit: async (v) => {
          const outcome = v.outcome as WarrantyClaimOutcome;
          await ctx.api.decideWarrantyClaim(s.id, {
            outcome,
            ...(outcome === 'REFUSED' ? { refusalReason: v.reason as WarrantyClaimRefusal } : {}),
            ...(outcome === 'REPLACEMENT' ? { replacementProductId: (v.replacement ?? '').trim().toUpperCase(), ...(v.otherSize === 'true' ? { otherSize: true } : {}) } : {}),
            ...(amountAsked(outcome, s.decision) ? { valueMinor: parseMoney(v.amount)! } : {}),
          });
        },
      }).then(done('Decided.'), notifyError);
    },
    legal: () => {
      void openDialog({
        title: 'Move to the legal guarantee',
        eyebrow,
        body: h(
          'p',
          { class: 'dialog__text' },
          'For a defect ORBES can neither repair nor replace: the claim continues under the legal guarantee, the piece stays with ORBES.',
        ),
        confirmLabel: 'Move to the legal guarantee',
        fields: [{ name: 'note', label: 'Note', kind: 'textarea', maxlength: NOTE_MAX, hint: 'Required for a boutique sale: the receipt’s facts. Staff only.' }],
        submit: async (v) => {
          const legal = await ctx.api.moveWarrantyClaimToLegal(s.id, v.note ?? '');
          moved = legal.id;
        },
      }).then((ok) => {
        if (!ok || !moved) return;
        notify('Moved to the legal guarantee.');
        ctx.navigate(claimHref(moved));
      }, notifyError);
    },
    ship: () => {
      const replacement = s.outcome === 'REPLACEMENT';
      void openDialog({
        title: 'Ship',
        eyebrow,
        body: h(
          'p',
          { class: 'dialog__text' },
          replacement
            ? `The new piece ${s.replacement?.productId ?? ''} ships to the client: its warranty starts today, of its model’s kind. The client registers it with the certificate card in its box.`
            : 'The piece returns to the client: its INSPECTION record is completed and the piece takes back its status.',
        ),
        confirmLabel: 'Ship',
        fields: [
          carrier,
          tracking,
          ...(replacement
            ? [{ name: 'replacement', label: 'Another identity', maxlength: 40, hint: 'Only when the one kept aside can no longer be it: of the same SKU, never sold.' }]
            : []),
        ],
        submit: async (v) => {
          const again = (v.replacement ?? '').trim().toUpperCase();
          await ctx.api.shipWarrantyClaim(s.id, { carrierId: v.carrierId ?? '', tracking: (v.tracking ?? '').trim(), ...(again ? { replacementProductId: again } : {}) });
        },
      }).then(done('Shipped.'), notifyError);
    },
  };

  const actions = claimActions(s, ctx.session.admin.role, today).map((a) =>
    button(CLAIM_ACTION_LABELS[a], { kind: a === 'close' || a === 'refuse' ? 'ghost' : 'secondary', testId: `claim-${a}`, onClick: () => open[a]() }),
  );

  const link = (to: string, text: string, testid: string) => h('a', { class: 'idlink', attrs: { href: to, 'data-testid': testid } }, text);
  const f = s.freeReplacement;
  const facts = defList([
    { label: 'Status', value: h('span', { attrs: { 'data-testid': 'claim-status' } }, statusMark(CLAIM_STATUS_LABELS[s.status], toneOf('claim', s.status))) },
    { label: 'Basis', value: h('span', { attrs: { 'data-testid': 'claim-basis' } }, CLAIM_BASIS_LABELS[s.basis]), note: s.basis === 'LEGAL' ? undefined : 'Read from the piece when the claim was opened' },
    { label: 'Piece', value: link(productHref(s.piece.productId), s.piece.productId, 'claim-piece'), note: s.piece.model },
    ...(s.rootProductId !== s.piece.productId ? [{ label: 'Original piece', value: link(productHref(s.rootProductId), s.rootProductId, 'claim-root') }] : []),
    {
      label: 'Claimant',
      value: s.account ? link(href('owner', { accountId: s.account.id }), s.account.email, 'claim-client') : h('span', { attrs: { 'data-testid': 'claim-client' } }, 'No ORBES account'),
      note: s.account ? undefined : 'A boutique sale: the receipt is in the note',
    },
    { label: 'Registered owner', value: s.registeredOwner ? link(href('owner', { accountId: s.registeredOwner.id }), s.registeredOwner.email, 'claim-owner') : 'NONE' },
    {
      label: 'Messages',
      value: s.conversation
        ? link(href('conversation', { conversationId: s.conversation.conversationId }), STATUS_LABELS[s.conversation.status], 'claim-conversation')
        : h('span', { attrs: { 'data-testid': 'claim-conversation' } }, 'No conversation'),
    },
    {
      label: 'Warranty',
      value: `${s.warranty.lifetime ? 'Lifetime' : '2 years'} · ${humanize(s.warranty.status)}`,
      note: s.warranty.startDate ? `${formatDate(s.warranty.startDate)} → ${s.warranty.lifetime ? 'Lifetime' : formatDate(s.warranty.endDate)}` : undefined,
    },
    ...(s.modelDiscontinued ? [{ label: 'Model', value: 'No longer made' }] : []),
    ...(f
      ? [
          {
            label: 'Free replacement',
            value: f.available ? h('span', { attrs: { 'data-testid': 'claim-free' } }, 'Available') : h('span', { attrs: { 'data-testid': 'claim-free' } }, `Used · ${formatDate(f.decidedAt)} · `, link(claimHref(f.claimId), 'claim', 'claim-free-link')),
            note: 'Once per original purchase',
          },
        ]
      : []),
    { label: 'Legal guarantee', value: s.legalUntil ? `Until ${formatDate(s.legalUntil)}` : '—' },
    { label: 'Opened', value: who(s.openedAt, s.openedBy) },
    { label: 'Label', value: shipment(s.label, 'claim-label-shipment'), note: s.label ? `Sent ${formatDateTime(s.label.at)}${s.label.pdf ? '' : ' · its PDF erased'}` : undefined },
    { label: 'Received', value: s.receivedAt ? formatDateTime(s.receivedAt) : '—' },
    { label: 'Decision', value: h('span', { attrs: { 'data-testid': 'claim-decision' } }, decisionText(s)) },
    { label: 'Decided', value: who(s.decidedAt, s.decidedBy) },
    { label: 'Shipped', value: shipment(s.return, 'claim-return-shipment'), note: s.return ? formatDateTime(s.return.at) : undefined },
    { label: 'Done', value: s.doneAt ? formatDateTime(s.doneAt) : '—' },
    ...(s.cancelledAt ? [{ label: 'Closed', value: formatDateTime(s.cancelledAt) }] : []),
    ...(s.continues ? [{ label: 'Continues', value: link(claimHref(s.continues), 'The 2-year claim', 'claim-continues') }] : []),
    ...(s.continuedBy ? [{ label: 'Continued under the legal guarantee', value: link(claimHref(s.continuedBy), 'The legal guarantee’s claim', 'claim-continued') }] : []),
    ...(s.note ? [{ label: 'Note', value: h('span', { class: 'claim__note' }, s.note), note: 'Staff only' }] : []),
  ]);

  return h(
    'div',
    { class: 'view view--warranty-claim', data: { claim: s.id } },
    pageHeader({
      eyebrow: 'Warranty claim',
      title: s.piece.productId,
      identifier: true,
      lead: `${CLAIM_BASIS_LABELS[s.basis]} · ${s.piece.model}`,
      actions: [...actions, linkButton('All claims', href('warranties', {}, { tab: 'claims' }), 'ghost')],
    }),
    section('The claim', facts, { id: 'warranty-claim' }),
  );
}
