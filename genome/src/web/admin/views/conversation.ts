/**
 * A conversation of the Messages board (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; `#/messages/:conversationId`).
 *
 * Head: the client (its sheet), the tier, the priority tag, the status and who answers, and the client's open yearly
 * care (BP-19 T6) as a link to its request. `Take it` (OPERATOR) makes the
 * reader the one who answers; an ADMIN chooses any active OPERATOR or ADMIN; `Close conversation` (OPERATOR, after a
 * confirmation). The thread: each message with its author (the client, or the staff member's email) and its time, and
 * on the client's what it concerns, a link to its page (a scan's to its verification event while the scan retention
 * keeps it). The answer box (OPERATOR): plain text, no attachment; the client reads it in their account, signed ORBES
 * Client Services. A closed conversation reopens by itself when the client writes again.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, isoDay } from '../format.js';
import { claimablePieces, claimHref, discontinuedText, openBasisOptions, warrantyKindText, warrantyRefusal } from '../model/claims.js';
import { tierName } from '../model/club.js';
import { can } from '../model/permissions.js';
import { ANSWER_HINT, ANSWER_SENT, answeringText, answerProblem, canAnswer, canAssign, CONVERSATION_CLOSED, MESSAGE_LIMITS, priorityTag, STATUS_LABELS } from '../model/messages.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { Conversation, ConversationMessage } from '../types.js';
import { busy, button, defList, field, pageHeader, section, select, setFieldError, statusMark, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { careLink, concernsCell } from './messages.js';

function messageItem(m: ConversationMessage, client: string): HTMLElement {
  return h(
    'li',
    { class: ['thread__item', m.author === 'STAFF' ? 'thread__item--staff' : null], attrs: { 'data-testid': 'thread-message', 'data-author': m.author } },
    h('p', { class: 'thread__meta' }, h('span', { class: 'thread__author' }, m.author === 'STAFF' ? (m.admin?.email ?? 'ORBES Client Services') : client), h('span', { class: 'thread__time' }, formatDateTime(m.at))),
    m.concerns ? h('p', { class: 'thread__concerns' }, 'Concerns ', concernsCell(m.concerns)) : null,
    h('p', { class: 'thread__body' }, m.body),
  );
}

export async function conversationView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.conversationId;
  const [c, staff] = await Promise.all([
    ctx.api.conversation(id),
    canAssign(ctx.session.admin.role) ? ctx.api.admins().then((r) => r.items.filter((a) => !a.disabled && (a.role === 'OPERATOR' || a.role === 'ADMIN'))) : Promise.resolve(null),
  ]);
  const role = ctx.session.admin.role;
  const act = (fn: () => Promise<Conversation>, done?: string) =>
    fn().then(() => {
      if (done) notify(done);
      ctx.reload();
    }, notifyError);

  const actions: HTMLElement[] = [];
  if (canAnswer(role) && c.answeredBy?.id !== ctx.session.admin.id) {
    actions.push(button('Take it', { kind: 'secondary', testId: 'take-conversation', onClick: () => void act(() => ctx.api.takeConversation(c.id)) }));
  }
  // Plan ORBES CARE (answers 3, 11): a claim is a normal message; Client Services open its record from the conversation.
  if (can(role, 'handleClaims')) {
    actions.push(button('Open a warranty claim', { kind: 'secondary', testId: 'open-claim', onClick: () => void openClaimDialog(ctx, c) }));
  }
  if (canAnswer(role) && c.status !== 'CLOSED') {
    actions.push(
      button('Close conversation', {
        kind: 'ghost',
        testId: 'close-conversation',
        onClick: () =>
          void openDialog({
            title: 'Close conversation',
            eyebrow: c.account.email,
            body: h('p', { class: 'dialog__text' }, 'The conversation leaves To answer. The client does not see it closed; if they write again, it reopens by itself.'),
            confirmLabel: 'Close conversation',
            submit: async () => {
              await ctx.api.closeConversation(c.id);
            },
          }).then((done) => {
            if (!done) return;
            notify(CONVERSATION_CLOSED);
            ctx.reload();
          }, notifyError),
      }),
    );
  }

  const assign = staff
    ? (() => {
        const choose = select('answering', [{ value: '', label: '—' }, ...staff.map((a) => ({ value: a.id, label: a.email }))], c.answeredBy?.id ?? '');
        choose.setAttribute('data-testid', 'assign-conversation');
        choose.addEventListener('change', () => {
          if (choose.value) void act(() => ctx.api.assignConversation(c.id, choose.value));
        });
        return field('Assign to', choose);
      })()
    : null;

  const tag = priorityTag(c.priority);
  const head = defList([
    { label: 'Client', value: h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: c.account.id }), 'data-testid': 'conversation-client' } }, c.account.email) },
    { label: 'Tier', value: h('span', { attrs: { 'data-testid': 'conversation-tier' } }, tierName(c.tier.level)), note: 'In the club now' },
    ...(tag ? [{ label: 'Priority', value: h('span', { class: 'messages__priority', attrs: { 'data-testid': 'conversation-priority' } }, tag) }] : []),
    { label: 'Status', value: h('span', { attrs: { 'data-testid': 'conversation-status' } }, statusMark(STATUS_LABELS[c.status], toneOf('conversation', c.status))), note: c.waitingSince ? `Waiting since ${formatDateTime(c.waitingSince)}` : undefined },
    { label: 'Answering', value: h('span', { attrs: { 'data-testid': 'conversation-answering' } }, answeringText(c)) },
    ...(c.care ? [{ label: 'Yearly care', value: careLink(c.care), note: 'Open: on the Yearly care board' }] : []),
  ]);

  const answer = (() => {
    if (!canAnswer(role)) return null;
    const box = textarea('body', { rows: 5, maxlength: MESSAGE_LIMITS.staff });
    box.setAttribute('data-testid', 'answer-body');
    const send = button('Send answer', { kind: 'primary', type: 'submit', testId: 'answer-send' });
    const form = h('form', { class: 'thread__answer', attrs: { 'data-testid': 'answer-form', novalidate: true } }, field('Answer', box, { hint: ANSWER_HINT, wide: true }), send);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const problem = answerProblem(box.value);
      setFieldError(form, 'body', problem ?? undefined);
      if (problem) return;
      void busy(send, async () => {
        await ctx.api.answerConversation(c.id, box.value.trim());
        notify(ANSWER_SENT);
        ctx.reload();
      }, 'Sending…').catch(notifyError);
    });
    return form;
  })();

  return h(
    'div',
    { class: 'view view--conversation' },
    pageHeader({ eyebrow: 'Messages', title: c.account.email, identifier: true, actions }),
    section('Conversation', [head, assign], { id: 'conversation' }),
    section('Thread', [h('ol', { class: 'thread', attrs: { 'data-testid': 'thread' } }, ...c.messages.map((m) => messageItem(m, c.account.email))), answer], { id: 'thread' }),
  );
}

/**
 * Open a warranty claim (plan ORBES CARE §2(b)), in two steps. First the piece: one of those registered to the client,
 * or of its orders (the legal guarantee is the buyer's). Then what it is claimed under: the ORBES warranty (for the
 * registered owner only, answer 3), named as the server will record it, read from the piece (Lifetime warranty or
 * 2-year warranty, answer 12: staff never choose it), or the legal guarantee within its 2 years; and a note. The claim's
 * page follows.
 */
async function openClaimDialog(ctx: ViewContext, c: Conversation): Promise<void> {
  let pieces;
  try {
    const sheet = await ctx.api.owner(c.account.id);
    pieces = claimablePieces(sheet.pieces, sheet.orders);
  } catch (e) {
    notifyError(e, 'The client’s pieces could not be loaded.');
    return;
  }
  if (pieces.length === 0) {
    notify('This client holds no piece and has no order with a piece.');
    return;
  }
  const first = await openDialog({
    title: 'Open a warranty claim',
    eyebrow: c.account.email,
    body: h('p', { class: 'dialog__text' }, 'The piece the client wrote about. Its prepaid label and the claim’s progress show in its ORBES CARE tab.'),
    fields: [{ name: 'piece', label: 'Piece', kind: 'select', required: true, options: pieces.map((p) => ({ value: p.productId, label: p.label })) }],
    confirmLabel: 'Continue',
  });
  if (!first?.piece) return;
  const pid = first.piece;
  let d;
  try {
    d = await ctx.api.product(pid);
  } catch (e) {
    notifyError(e, 'The piece could not be loaded.');
    return;
  }
  const registered = d.ownership.current?.accountId === c.account.id;
  const today = isoDay(ctx.now());
  const options = openBasisOptions(registered, d.warrantyClaims.legalUntil, today);
  const firstOpen = options.find((o) => !o.disabled);
  let opened: string | null = null;
  const ok = await openDialog({
    title: 'Open a warranty claim',
    eyebrow: `${pid} · ${c.account.email}`,
    fields: [
      { name: 'basis', label: 'Under', kind: 'select', required: true, options, value: firstOpen?.value ?? 'WARRANTY' },
      { name: 'note', label: 'Note', kind: 'textarea', maxlength: 500, hint: 'What the client wrote about, by phone or in Messages. Staff only.' },
    ],
    live: (v) => {
      const lines: string[] = [];
      if (v.basis === 'LEGAL') lines.push('Legal guarantee: replacement, repair, price reduction or refund; never a credit.');
      else {
        const refusal = warrantyRefusal(registered);
        lines.push(refusal ?? warrantyKindText(d.warrantyClaims.lifetime));
      }
      const gone = discontinuedText(d.warrantyClaims);
      if (gone) lines.push(gone);
      return lines.map((t) => h('p', { class: 'dialog__text', data: { testid: 'claim-open-text' } }, t));
    },
    validate: (v) => (options.find((o) => o.value === v.basis)?.disabled ? (v.basis === 'WARRANTY' ? warrantyRefusal(registered) : 'The legal guarantee does not apply: more than 2 years after delivery.') : null),
    confirmLabel: 'Open the claim',
    submit: async (v) => {
      opened = (await ctx.api.openWarrantyClaim({ conversationId: c.id, productId: pid, basis: v.basis === 'LEGAL' ? 'LEGAL' : 'WARRANTY', note: v.note ?? '' })).id;
    },
  });
  if (!ok || !opened) return;
  notify('Warranty claim opened.');
  ctx.navigate(claimHref(opened));
}
