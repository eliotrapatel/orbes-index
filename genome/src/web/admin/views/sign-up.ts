/**
 * The Sign-up page, `#/sign-up` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.10; step 1.10), reached from the
 * Owners page's header (no sidebar item): what a new account is asked, then the answers to « How did you hear about
 * ORBES? » with how many collectors gave each (test entrants and the team's own accounts left out). Everyone in the
 * console reads it; an ADMIN adds an answer (last before Other), renames one, moves it up or down, sets it aside or
 * offers it again, each audited (`heard_option.*`). Other is never set aside nor moved: Edit only. At most 12 answers
 * are offered at once. Carriers' editor (views/settings.ts) is the pattern.
 */
import { h } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { can } from '../model/permissions.js';
import { heardInOrder, heardLabelProblem, HEARD_LABEL_MAX, mayOfferMore, movedOrder, SIGN_UP_COPY as C } from '../model/sign-up.js';
import { href } from '../router.js';
import type { HeardOptionView } from '../types.js';
import { button, defList, linkButton, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function signUpView(ctx: ViewContext): Promise<HTMLElement> {
  const { options } = await ctx.api.heardOptions();
  const admin = can(ctx.session.admin.role, 'manageHeardOptions');
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };
  const ordered = heardInOrder(options);

  const edit = (o: HeardOptionView | null) =>
    void openDialog({
      title: o ? C.editTitle : C.add,
      eyebrow: o ? o.label : C.heard,
      body: o ? h('p', { class: 'dialog__text' }, C.editText) : undefined,
      fields: [{ name: 'label', label: C.field, required: true, maxlength: HEARD_LABEL_MAX, value: o?.label ?? '', hint: C.fieldHint }],
      validate: (v) => (o && v.label.trim() === o.label ? C.unchanged : heardLabelProblem(v.label, options, o?.id) ?? (!o && !mayOfferMore(options) ? C.limit : null)),
      confirmLabel: o ? C.editConfirm : C.addConfirm,
      submit: async (v) => {
        if (o) await ctx.api.updateHeardOption(o.id, { label: v.label.trim() });
        else await ctx.api.createHeardOption(v.label.trim());
      },
    }).then(done(o ? C.saved : C.added));

  const toggle = (o: HeardOptionView) =>
    void openDialog({
      title: o.active ? C.setAsideTitle : C.offerAgainTitle,
      eyebrow: o.label,
      body: h('p', { class: 'dialog__text' }, o.active ? C.setAsideText : C.offerAgainText),
      validate: () => (!o.active && !mayOfferMore(options) ? C.limit : null),
      confirmLabel: o.active ? C.setAsideAction : C.offerAgain,
      submit: async () => {
        await ctx.api.updateHeardOption(o.id, { active: !o.active });
      },
    }).then(done(o.active ? C.setAsideDone : C.offeredAgain));

  // Move up / Move down: at once, no dialog, the whole new order sent.
  const move = async (o: HeardOptionView, by: -1 | 1) => {
    const ids = movedOrder(options, o.id, by);
    if (!ids) return;
    try {
      await ctx.api.orderHeardOptions(ids);
      notify(C.orderSaved);
      ctx.reload();
    } catch (e) {
      notifyError(e);
    }
  };

  const movable = ordered.filter((o) => !o.other);
  const actions = (o: HeardOptionView) => {
    if (!admin) return null;
    const i = movable.findIndex((m) => m.id === o.id);
    return h(
      'span',
      { class: 'row-actions' },
      button(C.edit, { kind: 'ghost', testId: 'heard-edit', onClick: () => edit(o) }),
      o.other ? null : button(C.moveUp, { kind: 'ghost', testId: 'heard-up', disabled: i <= 0, onClick: () => void move(o, -1) }),
      o.other ? null : button(C.moveDown, { kind: 'ghost', testId: 'heard-down', disabled: i < 0 || i >= movable.length - 1, onClick: () => void move(o, 1) }),
      o.other ? null : button(o.active ? C.setAsideAction : C.offerAgain, { kind: 'ghost', testId: 'heard-toggle', onClick: () => toggle(o) }),
    );
  };

  return h(
    'div',
    { class: 'view view--sign-up' },
    pageHeader({ eyebrow: C.eyebrow, title: C.title, lead: C.lead, actions: [linkButton('Owners', href('owners'), 'ghost')] }),
    section(C.asked, defList(C.askedRows.map((r) => ({ label: r.label, value: r.value }))), { id: 'sign-up-asked' }),
    section(
      C.heard,
      table<HeardOptionView>(
        [
          {
            label: C.columns.answer,
            cell: (o) => h('span', null, h('span', { data: { testid: 'heard-label' } }, o.label), o.other ? h('span', { class: 'cell-sub' }, C.otherNote) : null),
            kind: ['wide'],
          },
          { label: C.columns.given, cell: (o) => h('span', { data: { testid: 'heard-given' } }, formatCount(o.given ?? 0)), kind: ['num'] },
          { label: C.columns.status, cell: (o) => statusMark(o.active ? C.offered : C.setAside, o.active ? 'solid' : 'muted'), kind: ['nowrap'] },
          { label: '', cell: actions, kind: ['actions'] },
        ],
        ordered,
        { caption: C.heard, empty: C.empty },
      ),
      { id: 'sign-up-heard', note: C.givenNote, tools: admin ? [button(C.add, { kind: 'ghost', testId: 'heard-add', onClick: () => edit(null) })] : [] },
    ),
  );
}
