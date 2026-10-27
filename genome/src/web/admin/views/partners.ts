/**
 * Club → Partners (macro scope of 2026-10-20, K49 P1 to P4; lot M4 plan §2.3, step M4.7): the brands that pay ORBES for
 * an experience offered to the circle. Entered from the Club's Circle tab (its Partners button, after New note, New
 * invitation and New poll); Club in the sidebar. Three pages, the console's patterns (a table, a fact sheet, a dialog per
 * change, a toast and the page read again):
 *
 *   #/club/partners                    every partner: brand, contact, experiences, invoiced, paid, ACTIVE / SET ASIDE;
 *                                      New partner and Edit (the fields of P1), Set aside and Reinstate (OPERATOR).
 *   #/club/partners/:partnerId         a partner: its details (the contact's email and phone masked for an AUDITOR), its
 *                                      experiences (title, date in Paris, amount, state, invoice number, paid date), New
 *                                      experience (OPERATOR, an ACTIVE partner).
 *   #/club/partner-experiences/:id     an experience: its facts and documents (each PDF), its invitations of the circle
 *                                      (tier and segment as the circle shows them, YES and places), ISSUE THE INVOICE
 *                                      (ADMIN, a confirmation naming the number, the partner and the amount), RECORD
 *                                      PAYMENT (ADMIN, a Paris day), CANCEL (with its credit note once invoiced), and
 *                                      GUESTS FOR THE PARTNER: the headcount and the names shared (OPERATOR), their list.
 *
 * The server keeps every rule and audits each change (services/partners.ts); an AUDITOR reads.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount, formatDateTime } from '../format.js';
import { audienceLine } from '../model/circle.js';
import { parisDayText } from '../model/client-profile.js';
import { parisToday } from '../model/guarantees.js';
import { formatMoney } from '../model/live.js';
import {
  amountsText,
  billingCountryOptions,
  billingLines,
  billingMissing,
  cancelText,
  contactLine,
  eventDay,
  EXPERIENCE_STATE_LABELS,
  experienceActions,
  experienceChange,
  experienceFormValues,
  experienceInput,
  experienceLead,
  experienceProblem,
  guestsLine,
  issueText,
  monthsOfYearSoFar,
  nextInvoiceNumber,
  paidOnProblem,
  partnerActions,
  partnerChange,
  partnerFormValues,
  partnerInput,
  partnerProblem,
  partnerState,
  PARTNER_LIMITS,
  PARTNERS_TEXT as T,
} from '../model/partners.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { HOUSE_CURRENCIES, type Partner, type PartnerDetail, type PartnerExperience, type PartnerExperienceCard, type PartnerGuests, type PartnerInvitation } from '../types.js';
import { busy, button, defList, emptyState, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

// ── Shared ─────────────────────────────────────────────────────────────────

const stateMark = (p: Pick<Partner, 'active'>) => {
  const s = partnerState(p);
  return h('span', { data: { testid: 'partner-state' } }, statusMark(s.label, toneOf('partner', s.key)));
};

const experienceMark = (e: Pick<PartnerExperienceCard, 'status'>) => h('span', { data: { testid: 'experience-state' } }, statusMark(EXPERIENCE_STATE_LABELS[e.status], toneOf('partnerExperience', e.status)));

/** The fields of a partner's dialog (P1). */
function partnerFields(values: Record<string, string>): DialogField[] {
  return [
    { name: 'brand', label: 'Brand', required: true, maxlength: PARTNER_LIMITS.brand, value: values.brand, hint: 'As the circle shows it to the guests: « WITH <BRAND> ». One partner per brand.' },
    { name: 'contactName', label: 'Contact', maxlength: PARTNER_LIMITS.name, value: values.contactName, hint: 'The person ORBES deals with. Optional.' },
    { name: 'contactEmail', label: 'Email', kind: 'email', maxlength: PARTNER_LIMITS.email, value: values.contactEmail, hint: 'Optional.' },
    { name: 'contactPhone', label: 'Phone', maxlength: PARTNER_LIMITS.phone, value: values.contactPhone, hint: 'Optional.' },
    { name: 'billingName', label: 'Billing name', maxlength: PARTNER_LIMITS.name, value: values.billingName, hint: 'As its invoices print it: needed to issue one.' },
    { name: 'billingAddress', label: 'Billing address', kind: 'textarea', rows: 3, maxlength: PARTNER_LIMITS.billingAddress, value: values.billingAddress, hint: 'Its lines as its invoices print them: needed to issue one.' },
    { name: 'billingCountry', label: 'Billing country', kind: 'select', options: billingCountryOptions(), value: values.billingCountry, hint: 'Needed to issue an invoice.' },
    { name: 'companyNumber', label: 'Company number', maxlength: PARTNER_LIMITS.companyNumber, value: values.companyNumber, hint: 'Printed on its invoices when given. Optional.' },
    { name: 'note', label: 'Note', kind: 'textarea', rows: 3, maxlength: PARTNER_LIMITS.note, value: values.note, hint: 'For ORBES only. Optional.' },
  ];
}

/** New partner: created ACTIVE, then its page. */
function newPartner(ctx: ViewContext): void {
  let created: string | null = null;
  void openDialog({
    title: 'NEW PARTNER',
    eyebrow: 'Club · Partners',
    body: h('p', { class: 'dialog__text' }, 'A brand that pays ORBES for an experience offered to the circle. Its billing details are needed only to issue its invoice.'),
    fields: partnerFields(partnerFormValues(null)),
    validate: partnerProblem,
    confirmLabel: 'Create partner',
    submit: async (v) => {
      created = (await ctx.api.createPartner(partnerInput(v))).id;
    },
  }).then((r) => {
    if (!r || !created) return;
    notify('Partner created.');
    ctx.navigate(href('clubPartner', { partnerId: created }));
  });
}

/** Edit: only what changed is sent. */
function editPartner(ctx: ViewContext, p: Partner): void {
  void openDialog({
    title: 'EDIT THE PARTNER',
    eyebrow: `Club · Partners · ${p.brand}`,
    body: h('p', { class: 'dialog__text' }, 'An invoice already issued keeps the billing details it was issued with.'),
    fields: partnerFields(partnerFormValues(p)),
    validate: (v) => partnerProblem(v) ?? (Object.keys(partnerChange(p, v)).length === 0 ? 'Nothing has changed.' : null),
    confirmLabel: 'Save partner',
    submit: async (v) => {
      await ctx.api.updatePartner(p.id, partnerChange(p, v));
    },
  }).then((r) => {
    if (!r) return;
    notify('Partner saved.');
    ctx.reload();
  });
}

/** Set aside, or reinstate. */
function toggleAside(ctx: ViewContext, p: Partner): void {
  const aside = p.active;
  void openDialog({
    title: aside ? 'SET THE PARTNER ASIDE' : 'REINSTATE THE PARTNER',
    eyebrow: `Club · Partners · ${p.brand}`,
    body: h(
      'p',
      { class: 'dialog__text' },
      aside ? 'It is offered for no new experience. Its experiences, invoices and invitations go on as they are.' : 'It can be offered for a new experience again.',
    ),
    confirmLabel: aside ? 'Set aside' : 'Reinstate',
    submit: async () => {
      if (aside) await ctx.api.setPartnerAside(p.id);
      else await ctx.api.reinstatePartner(p.id);
    },
  }).then((r) => {
    if (!r) return;
    notify(aside ? 'Partner set aside.' : 'Partner reinstated.');
    ctx.reload();
  });
}

/** A document's PDF as a small button. */
function pdfButton(ctx: ViewContext, doc: { id: string; number: string }, testId: string): HTMLButtonElement {
  const b = button('PDF', { kind: 'ghost', testId });
  b.setAttribute('aria-label', `${doc.number}, PDF`);
  b.addEventListener('click', () =>
    void busy(b, async () => {
      try {
        saveDownload(await ctx.api.partnerInvoicePdf(doc.id));
      } catch (e) {
        notifyError(e, 'The document could not be produced.');
      }
    }),
  );
  return b;
}

// ── #/club/partners ────────────────────────────────────────────────────────

export async function partnersView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.partners();
  const acts = partnerActions(null, ctx.session.admin.role);
  const rowActions = (p: Partner): Child =>
    acts.manage
      ? h(
          'span',
          { class: 'row-actions' },
          button(T.edit, { kind: 'ghost', testId: 'partner-edit', onClick: () => editPartner(ctx, p) }),
          button(p.active ? T.setAside : T.reinstate, { kind: 'ghost', testId: p.active ? 'partner-set-aside' : 'partner-reinstate', onClick: () => toggleAside(ctx, p) }),
        )
      : null;
  return h(
    'div',
    { class: 'view view--partners' },
    pageHeader({ eyebrow: T.eyebrow, title: T.title, lead: T.lead, actions: [linkButton(T.circle, href('club', {}, { tab: 'circle' }), 'ghost')] }),
    section(
      T.title,
      table<Partner>(
        [
          {
            label: 'Brand',
            cell: (p) => h('a', { class: ['idlink', 'partners__brand'], attrs: { href: href('clubPartner', { partnerId: p.id }), 'data-testid': 'partner-link' } }, p.brand),
            kind: ['wide'],
          },
          {
            label: 'Contact',
            cell: (p) =>
              h(
                'span',
                { class: 'partners__contact', data: { testid: 'partner-contact', contact: contactLine(p) } },
                p.contact.name ?? (p.contact.email || p.contact.phone ? null : '—'),
                ...[p.contact.email, p.contact.phone].filter((x): x is string => !!x).map((x) => h('span', { class: p.contact.name ? 'cell-sub' : 'partners__contact-line' }, x)),
              ),
          },
          { label: 'Experiences', cell: (p) => formatCount(p.experienceCount), kind: ['num'] },
          { label: 'Invoiced', cell: (p) => h('span', { data: { testid: 'partner-invoiced' } }, amountsText(p.invoiced)), kind: ['num', 'nowrap'] },
          { label: 'Paid', cell: (p) => h('span', { data: { testid: 'partner-paid' } }, amountsText(p.paid)), kind: ['num', 'nowrap'] },
          { label: 'State', cell: (p) => stateMark(p), kind: ['nowrap'] },
          ...(acts.manage ? [{ label: 'Actions', cell: rowActions, kind: ['actions', 'wrap'] as ('actions' | 'wrap')[], hiddenLabel: true }] : []),
        ],
        list.items,
        { empty: T.empty, caption: T.title, onRow: (p) => href('clubPartner', { partnerId: p.id }) },
      ),
      {
        id: 'partners',
        note: `${formatCount(list.items.length)} ${list.items.length === 1 ? 'partner' : 'partners'}`,
        tools: acts.manage ? [button(T.newPartner, { kind: 'primary', testId: 'partner-new', onClick: () => newPartner(ctx) })] : [],
      },
    ),
  );
}

// ── #/club/partners/:partnerId ─────────────────────────────────────────────

function experienceFields(values: Record<string, string>, withAmount: boolean): DialogField[] {
  return [
    { name: 'title', label: 'Title', required: true, maxlength: PARTNER_LIMITS.title, value: values.title, hint: 'As its invoice says it: « Partner experience · <title> · <date> ».' },
    { name: 'eventOn', label: 'Event (Paris)', kind: 'date', required: true, value: values.eventOn, hint: 'The day of the event in Paris.' },
    ...(withAmount
      ? ([
          { name: 'amount', label: 'Amount', required: true, maxlength: 13, value: values.amount, hint: 'What the partner pays ORBES, as 12000 or 12000.50; no VAT.' },
          { name: 'currency', label: 'Currency', kind: 'select', options: HOUSE_CURRENCIES.map((c) => ({ value: c, label: c })), value: values.currency },
        ] satisfies DialogField[])
      : []),
    { name: 'note', label: 'Note', kind: 'textarea', rows: 3, maxlength: PARTNER_LIMITS.note, value: values.note, hint: 'For ORBES only. Optional.' },
  ];
}

export async function partnerView(ctx: ViewContext): Promise<HTMLElement> {
  const p: PartnerDetail = await ctx.api.partner(ctx.route.params.partnerId ?? '');
  const role = ctx.session.admin.role;
  const acts = partnerActions(p, role);
  const eyebrow = `Club · Partners · ${p.brand}`;

  const newExperience = () => {
    let created: string | null = null;
    void openDialog({
      title: 'NEW EXPERIENCE',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `A deal with ${p.brand}, recorded as a draft: nothing is invoiced until an ADMIN issues its invoice. Its invitations are written in Club → Circle.`),
      fields: experienceFields(experienceFormValues(null), true),
      validate: (v) => experienceProblem(v),
      confirmLabel: 'Create experience',
      submit: async (v) => {
        created = (await ctx.api.createPartnerExperience(p.id, experienceInput(v))).id;
      },
    }).then((r) => {
      if (!r || !created) return;
      notify('Experience created.');
      ctx.navigate(href('partnerExperience', { experienceId: created }));
    });
  };

  const masked = !can(role, 'readClientEmails');
  const billing = billingLines(p);
  const missing = billingMissing(p);
  const rows: { label: string; value: Child; note?: string }[] = [
    { label: 'State', value: stateMark(p), note: p.active ? undefined : T.setAsideNote },
    { label: 'Contact', value: h('span', { data: { testid: 'partner-contact-name' } }, p.contact.name ?? '—') },
    { label: 'Email', value: h('span', { data: { testid: 'partner-email' } }, p.contact.email ?? '—'), note: masked && p.contact.email ? T.maskedNote : undefined },
    { label: 'Phone', value: h('span', { data: { testid: 'partner-phone' } }, p.contact.phone ?? '—'), note: masked && p.contact.phone ? T.maskedNote : undefined },
    {
      label: 'Billing',
      value: billing.length ? h('span', { class: 'partners__lines', data: { testid: 'partner-billing' } }, ...billing.map((l) => h('span', null, l))) : '—',
      note: missing.length ? `Its invoice needs its ${missing.join(', ')}.` : undefined,
    },
    { label: 'Note', value: p.note ? h('span', { class: 'partners__note' }, p.note) : '—' },
    { label: 'Created', value: `${formatDateTime(p.createdAt)}${p.createdBy ? ` · ${p.createdBy.email}` : ''}` },
  ];
  const tools = acts.manage
    ? [button(T.edit, { kind: 'ghost', testId: 'partner-edit', onClick: () => editPartner(ctx, p) }), button(p.active ? T.setAside : T.reinstate, { kind: 'ghost', testId: p.active ? 'partner-set-aside' : 'partner-reinstate', onClick: () => toggleAside(ctx, p) })]
    : [];

  return h(
    'div',
    { class: 'view view--partner' },
    pageHeader({
      eyebrow: 'Clients · Club · Partners',
      title: p.brand,
      identifier: /\d/.test(p.brand),
      lead: `${p.active ? 'Offered for new experiences.' : 'Set aside: offered for no new experience.'} Invoiced ${amountsText(p.invoiced)}; paid ${amountsText(p.paid)}.`,
      actions: [linkButton(T.allPartners, href('clubPartners'), 'ghost')],
    }),
    section('Partner', defList(rows), { id: 'partner', tools }),
    section(
      T.experiences,
      table<PartnerExperienceCard>(
        [
          {
            label: 'Experience',
            cell: (e) => h('a', { class: ['idlink', 'partners__title'], attrs: { href: href('partnerExperience', { experienceId: e.id }), 'data-testid': 'experience-link' } }, e.title),
            kind: ['wide'],
          },
          { label: 'Event', cell: (e) => eventDay(e.eventOn), kind: ['nowrap'] },
          { label: 'Amount', cell: (e) => formatMoney(e.amountMinor, e.currency), kind: ['num', 'nowrap'] },
          { label: 'State', cell: (e) => experienceMark(e), kind: ['nowrap'] },
          {
            label: 'Invoice',
            cell: (e) => (e.invoice ? h('span', null, mono(e.invoice.number), e.creditNote ? h('span', { class: 'cell-sub' }, `Cancelled by ${e.creditNote.number}`) : null) : '—'),
            kind: ['nowrap'],
          },
          { label: 'Paid', cell: (e) => (e.paidOn ? eventDay(e.paidOn) : '—'), kind: ['nowrap'] },
        ],
        p.experiences,
        { empty: T.noExperience, caption: T.experiences, onRow: (e) => href('partnerExperience', { experienceId: e.id }) },
      ),
      {
        id: 'partner-experiences',
        note: `${formatCount(p.experiences.length)} ${p.experiences.length === 1 ? 'experience' : 'experiences'}`,
        tools: acts.newExperience ? [button(T.newExperience, { kind: 'primary', testId: 'experience-new', onClick: newExperience })] : [],
      },
    ),
  );
}

// ── #/club/partner-experiences/:experienceId ───────────────────────────────

/** The next P- number, read from this year's partner documents (the latest month holding an invoice); null when unread. */
async function readNextNumber(ctx: ViewContext): Promise<string | null> {
  const now = ctx.now();
  try {
    for (const month of monthsOfYearSoFar(now)) {
      const list = await ctx.api.partnerInvoices(month);
      if (list.items.some((i) => i.kind === 'INVOICE')) return nextInvoiceNumber([list], now.getUTCFullYear());
    }
    return nextInvoiceNumber([], now.getUTCFullYear());
  } catch {
    return null;
  }
}

export async function partnerExperienceView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.experienceId ?? '';
  const [e, guests] = await Promise.all([ctx.api.partnerExperience(id), ctx.api.partnerGuests(id).catch(() => 'failed' as const)]);
  const role = ctx.session.admin.role;
  const acts = experienceActions(e, role);
  const eyebrow = `Club · Partners · ${e.partner.brand}`;
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  const edit = () => {
    const draft = e.status === 'DRAFT';
    void openDialog({
      title: 'EDIT THE EXPERIENCE',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, draft ? 'A draft: every field changes.' : 'Its amount and currency are those of its invoice: only its title, date and note change here.'),
      fields: experienceFields(experienceFormValues(e), draft),
      validate: (v) => experienceProblem(v, { amount: draft }) ?? (Object.keys(experienceChange(e, v)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save experience',
      submit: async (v) => {
        await ctx.api.updatePartnerExperience(e.id, experienceChange(e, v));
      },
    }).then(done('Experience saved.'));
  };

  const issue = async (b: HTMLButtonElement) => {
    const number = await busy(b, () => readNextNumber(ctx), 'Reading…');
    void openDialog({
      title: T.issueTitle,
      eyebrow,
      body: [
        h('p', { class: 'dialog__text', data: { testid: 'issue-text' } }, issueText(number, e.partner.brand, e.amountMinor, e.currency)),
        h('p', { class: 'dialog__text soft' }, 'Issued by CONGLOMERAT LLC to the partner’s billing details, one line, without VAT; its PDF is on this page once issued.'),
      ],
      confirmLabel: T.issue,
      submit: async () => {
        await ctx.api.issuePartnerInvoice(e.id);
      },
    }).then(done('Invoice issued.'));
  };

  const pay = (mode: 'record' | 'correct') =>
    void openDialog({
      title: mode === 'record' ? T.recordPaymentTitle : T.correctPaymentTitle,
      eyebrow,
      body: h(
        'p',
        { class: 'dialog__text' },
        mode === 'record'
          ? `The day ${e.partner.brand}’s transfer of ${amountOf(e)} arrived, in Paris. Growth counts it in that day’s month.`
          : `Recorded as ${e.paidOn ? eventDay(e.paidOn) : '—'}. The correction is kept in the audit log with the previous date.`,
      ),
      fields: [{ name: 'paidOn', label: 'Paid on (Paris)', kind: 'date', required: true, value: e.paidOn ?? parisToday(ctx.now()), hint: 'Never after today.' }],
      validate: (v) => paidOnProblem(v.paidOn, ctx.now()) ?? (mode === 'correct' && v.paidOn === e.paidOn ? 'Nothing has changed.' : null),
      confirmLabel: mode === 'record' ? T.recordPayment : 'Save the date',
      submit: async (v) => {
        await ctx.api.recordPartnerPayment(e.id, v.paidOn.trim());
      },
    }).then(done(mode === 'record' ? 'Payment recorded.' : 'Payment date corrected.'));

  const cancel = () =>
    void openDialog({
      title: T.cancelTitle,
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text', data: { testid: 'cancel-text' } }, cancelText(e)),
      confirmLabel: e.status === 'DRAFT' ? 'Cancel the experience' : 'Cancel and issue the credit note',
      cancelLabel: 'Keep it',
      submit: async () => {
        await ctx.api.cancelPartnerExperience(e.id);
      },
    }).then(done('Experience cancelled.'));

  // ── The experience ──
  const doc = (d: { id: string; number: string; issuedAt: string } | null, testId: string): Child =>
    d ? h('span', { class: 'partners__doc', data: { testid: testId } }, mono(d.number), h('span', { class: 'cell-sub' }, `Issued ${parisDayText(d.issuedAt)} (Paris)`), pdfButton(ctx, d, `${testId}-pdf`)) : '—';
  const rows: { label: string; value: Child; note?: string }[] = [
    { label: 'Partner', value: h('a', { class: 'idlink', attrs: { href: href('clubPartner', { partnerId: e.partner.id }), 'data-testid': 'experience-partner' } }, e.partner.brand), note: e.partner.active ? undefined : 'Set aside.' },
    { label: 'State', value: experienceMark(e) },
    { label: 'Event', value: h('span', { data: { testid: 'experience-event' } }, eventDay(e.eventOn)), note: 'In Paris.' },
    { label: 'Amount', value: h('span', { data: { testid: 'experience-amount' } }, formatMoney(e.amountMinor, e.currency)), note: 'Without VAT.' },
    { label: 'Invoice', value: doc(e.invoice, 'experience-invoice') },
  ];
  if (e.creditNote) rows.push({ label: 'Credit note', value: doc(e.creditNote, 'experience-credit-note') });
  rows.push({ label: 'Paid on', value: h('span', { data: { testid: 'experience-paid-on' } }, e.paidOn ? eventDay(e.paidOn) : '—'), note: e.paidRecordedBy && e.paidRecordedAt ? `Recorded ${formatDateTime(e.paidRecordedAt)} · ${e.paidRecordedBy.email}` : undefined });
  if (e.cancelledAt) rows.push({ label: 'Cancelled', value: `${formatDateTime(e.cancelledAt)}${e.cancelledBy ? ` · ${e.cancelledBy.email}` : ''}` });
  rows.push({ label: 'Note', value: e.note ? h('span', { class: 'partners__note' }, e.note) : '—' }, { label: 'Created', value: `${formatDateTime(e.createdAt)}${e.createdBy ? ` · ${e.createdBy.email}` : ''}` });

  const issueButton = acts.issue ? button(T.issue, { kind: 'primary', testId: 'experience-issue' }) : null;
  issueButton?.addEventListener('click', () => void issue(issueButton));
  const tools = [
    acts.edit ? button(T.edit, { kind: 'ghost', testId: 'experience-edit', onClick: edit }) : null,
    issueButton,
    acts.pay ? button(acts.pay === 'record' ? T.recordPayment : T.correctPayment, { kind: acts.pay === 'record' ? 'primary' : 'ghost', testId: 'experience-pay', onClick: () => pay(acts.pay!) }) : null,
    acts.cancel ? button(T.cancel, { kind: 'ghost', testId: 'experience-cancel', onClick: cancel }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);

  return h(
    'div',
    { class: 'view view--partner-experience' },
    pageHeader({
      eyebrow: `Clients · Club · Partners · ${e.partner.brand}`,
      title: e.title,
      identifier: /\d/.test(e.title),
      lead: experienceLead(e),
      actions: [linkButton(e.partner.brand, href('clubPartner', { partnerId: e.partner.id }), 'ghost')],
    }),
    section('Experience', defList(rows), { id: 'experience', tools }),
    invitationsSection(e),
    guestsSection(ctx, e, guests, acts.guests),
  );
}

const amountOf = (e: Pick<PartnerExperience, 'amountMinor' | 'currency'>) => formatMoney(e.amountMinor, e.currency);

function invitationsSection(e: PartnerExperience): HTMLElement {
  return section(
    T.invitations,
    table<PartnerInvitation>(
      [
        { label: 'Invitation', cell: (i) => h('a', { class: ['idlink', 'partners__title'], attrs: { href: href('circlePost', { postId: i.id }), 'data-testid': 'experience-invitation' } }, i.title), kind: ['wide'] },
        { label: 'Read by', cell: (i) => audienceLine(i), kind: ['nowrap'] },
        { label: 'State', cell: (i) => statusMark(i.published ? 'Published' : 'Not published', toneOf('circle', i.published ? 'PUBLISHED' : 'UNPUBLISHED')), kind: ['nowrap'] },
        { label: 'Event', cell: (i) => formatDateTime(i.eventAt), kind: ['nowrap'] },
        { label: 'Yes', cell: (i) => h('span', { data: { testid: 'invitation-yes' } }, formatCount(i.yes)), kind: ['num'] },
        { label: 'Places', cell: (i) => (i.capacity === null ? 'No limit' : formatCount(i.capacity)), kind: ['num', 'nowrap'] },
      ],
      e.invitations,
      { empty: T.noInvitation, caption: T.invitations, onRow: (i) => href('circlePost', { postId: i.id }) },
    ),
    { id: 'experience-invitations', note: `${formatCount(e.invitations.length)} ${e.invitations.length === 1 ? 'invitation' : 'invitations'}` },
  );
}

function guestsSection(ctx: ViewContext, e: PartnerExperience, g: PartnerGuests | 'failed', names: boolean): HTMLElement {
  if (g === 'failed') return section(T.guests, emptyState('The guests could not be read. Reload the page.'), { id: 'experience-guests' });
  const download = names ? button(T.download, { kind: 'ghost', testId: 'guests-csv' }) : null;
  download?.addEventListener('click', () =>
    void busy(download, async () => {
      try {
        saveDownload(await ctx.api.partnerGuestsCsv(e.id));
      } catch (err) {
        notifyError(err);
      }
    }),
  );
  const shared = g.shared;
  return section(
    T.guests,
    [
      h('p', { class: 'partners__guests', data: { testid: 'guests-line' } }, guestsLine(g)),
      h('p', { class: 'notice' }, T.guestsLead),
      shared === undefined
        ? h('p', { class: 'soft', data: { testid: 'guests-hidden' } }, T.namesHidden)
        : table<{ firstName: string; lastName: string }>(
            [
              { label: 'First name', cell: (n) => n.firstName },
              { label: 'Last name', cell: (n) => n.lastName, kind: ['wide'] },
            ],
            shared,
            { empty: T.noName, caption: T.guests },
          ),
    ],
    { id: 'experience-guests', tools: download ? [download] : [] },
  );
}
