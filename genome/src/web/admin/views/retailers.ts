/**
 * Points of sale (A-08): the register a warranty's point of sale is chosen
 * from, in the product page's Activate warranty dialog and in the sale mode
 * of a seller's phone, so a boutique is never typed three ways.
 *
 * Every reading role sees the list; an ADMIN adds a point of sale, renames
 * or moves one, and deactivates one that closes (it leaves the lists and
 * refuses new activations; it is never deleted, the warranties of its sales
 * keep naming it). Every change is recorded in the audit log.
 */
import { h } from '../../shared/dom.js';
import { formatDate } from '../format.js';
import { can } from '../model/permissions.js';
import type { Retailer } from '../types.js';
import { button, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogValues } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const COUNTRY_HINT = 'Two-letter ISO code, e.g. FR: the purchase country of its sales.';

function countryProblem(v: DialogValues): string | null {
  return v.country && !/^[A-Za-z]{2}$/.test(v.country.trim()) ? 'Country is a two-letter code.' : null;
}

export async function retailersView(ctx: ViewContext): Promise<HTMLElement> {
  const list = (await ctx.api.retailers()).items;
  const admin = can(ctx.session.admin.role, 'manageRetailers');

  const act = (p: Promise<unknown>, done: string) =>
    p.then(
      (r) => {
        if (!r) return;
        notify(done);
        ctx.reload();
      },
      (e: unknown) => notifyError(e),
    );

  const create = admin
    ? button('New point of sale', {
        kind: 'primary',
        testId: 'retailer-create',
        onClick: () =>
          void act(
            openDialog({
              title: 'New point of sale',
              body: h('p', { class: 'dialog__text' }, 'A boutique, a department store or the online shop. Sellers then choose it from a list when a warranty starts.'),
              fields: [
                { name: 'name', label: 'Name', required: true, maxlength: 120, hint: 'As the client knows it, e.g. ORBES Paris — Saint-Honoré.' },
                { name: 'city', label: 'City', maxlength: 80 },
                { name: 'country', label: 'Country', maxlength: 2, hint: COUNTRY_HINT },
              ],
              validate: countryProblem,
              confirmLabel: 'Add point of sale',
              submit: async (v) => {
                await ctx.api.createRetailer({
                  name: v.name.trim(),
                  ...(v.city?.trim() ? { city: v.city.trim() } : {}),
                  ...(v.country?.trim() ? { country: v.country.trim().toUpperCase() } : {}),
                });
              },
            }),
            'Point of sale added.',
          ),
      })
    : null;

  function rowActions(r: Retailer): HTMLElement | string {
    if (!admin) return '—';
    const edit = button('Edit', {
      kind: 'ghost',
      testId: 'retailer-edit',
      onClick: () =>
        void act(
          openDialog({
            title: 'Edit the point of sale',
            eyebrow: r.name,
            body: h('p', { class: 'dialog__text' }, 'A new name shows on every warranty of its sales, past ones included.'),
            fields: [
              { name: 'name', label: 'Name', required: true, maxlength: 120, value: r.name },
              { name: 'city', label: 'City', maxlength: 80, value: r.city ?? '' },
              { name: 'country', label: 'Country', maxlength: 2, hint: COUNTRY_HINT, value: r.country ?? '' },
            ],
            validate: countryProblem,
            confirmLabel: 'Save',
            submit: async (v) => {
              await ctx.api.updateRetailer(r.id, { name: v.name.trim(), city: v.city?.trim() || null, country: v.country?.trim() ? v.country.trim().toUpperCase() : null });
            },
          }),
          'Point of sale saved.',
        ),
    });
    const toggle = r.active
      ? button('Deactivate', {
          kind: 'danger',
          testId: 'retailer-deactivate',
          onClick: () =>
            void act(
              openDialog({
                title: 'Deactivate the point of sale',
                eyebrow: r.name,
                danger: true,
                body: h('p', { class: 'dialog__text' }, 'For a closed boutique. It leaves the lists and no warranty can start there; the warranties of its sales keep naming it. It can be reactivated.'),
                confirmLabel: 'Deactivate',
                submit: async () => {
                  await ctx.api.updateRetailer(r.id, { active: false });
                },
              }),
              `${r.name} is no longer offered.`,
            ),
        })
      : button('Reactivate', {
          kind: 'ghost',
          testId: 'retailer-reactivate',
          onClick: () =>
            void act(
              ctx.api.updateRetailer(r.id, { active: true }).then(() => true),
              `${r.name} is offered again.`,
            ),
        });
    return h('span', { class: 'retailers__actions' }, edit, toggle);
  }

  return h(
    'div',
    { class: 'view view--retailers' },
    pageHeader({
      eyebrow: 'Clients',
      title: 'Points of sale',
      lead: 'Where pieces are sold: the list a warranty’s point of sale is chosen from, in the console and in the sale mode. A point of sale is deactivated, never deleted.',
      actions: create ? [create] : [],
    }),
    section(
      'Register',
      table(
        [
          { label: 'Name', cell: (r) => r.name, kind: ['wide'] },
          { label: 'City', cell: (r) => r.city ?? '—', kind: ['nowrap'] },
          { label: 'Country', cell: (r) => r.country ?? '—', kind: ['nowrap'] },
          { label: 'State', cell: (r) => (r.active ? statusMark('ACTIVE', 'solid') : statusMark('INACTIVE', 'muted')), kind: ['nowrap'] },
          { label: 'Since', cell: (r) => formatDate(r.createdAt), kind: ['nowrap'] },
          { label: 'Actions', cell: rowActions, kind: ['actions'] },
        ],
        list,
        { empty: admin ? 'No point of sale yet. Add the boutiques and the online shop.' : 'No point of sale yet. An ADMIN adds them here.', caption: 'Points of sale' },
      ),
      { note: admin ? 'Every change is recorded in the audit log' : undefined },
    ),
  );
}
