/**
 * The tiers of the club (P-X04) in the console: the Club page's Tiers tab.
 *
 * One panel per tier, TITANE, PLATINE and PALLADIUM: the pieces held now it
 * starts from (1, 3 and 5, a constant of the code: never changed here, so a
 * setting never contradicts the published rule of a draw), its benefits as
 * /verify lists them at the head of MY PIECES, one per line, and whether they
 * are the words by default or the console's (with the time of the change).
 * Edit benefits (OPERATOR) opens the dialog of the words, what the tier adds
 * to the ones below it; Restore default removes the console's words. Each
 * change is one request, audited by the server (`club.tier.update`), then the
 * tab is read again. An AUDITOR reads.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import { benefitLines, TIER_LIMITS, tierBenefitsChange, tierBenefitsProblem, tierThreshold } from '../model/club.js';
import { can } from '../model/permissions.js';
import type { ClubTierSheet } from '../types.js';
import { button, defList, section, statusMark } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The Tiers tab: the three tiers, each with its benefits. */
export async function tiersTab(ctx: ViewContext): Promise<HTMLElement> {
  const { items } = await ctx.api.clubTiers();
  const canManage = can(ctx.session.admin.role, 'manageClubTiers');
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  const edit = (t: ClubTierSheet) =>
    void openDialog({
      title: `${t.tier} benefits`,
      eyebrow: 'Club · Tiers',
      body: h(
        'p',
        { class: 'dialog__text' },
        `What ${t.tier} adds to the tiers below it, one benefit per line, as MY PIECES lists them on /verify for its owners and as the next tier for the ones below. Leave it empty to restore the words by default.`,
      ),
      fields: [
        {
          name: 'benefits',
          label: 'Benefits',
          kind: 'textarea',
          rows: 6,
          maxlength: TIER_LIMITS.benefits * 2,
          value: t.benefits,
          hint: `One per line: at most ${TIER_LIMITS.lines} lines and ${TIER_LIMITS.benefits} characters. In English, as /verify speaks.`,
        },
      ],
      validate: (v) => tierBenefitsProblem(v) ?? (tierBenefitsChange(t, v) === undefined ? 'Nothing has changed.' : null),
      confirmLabel: 'Save benefits',
      submit: async (v) => {
        await ctx.api.updateClubTier(t.tier, tierBenefitsChange(t, v) ?? null);
      },
    }).then(done(`${t.tier} benefits saved.`));

  const restore = (t: ClubTierSheet) =>
    void openDialog({
      title: `Restore the ${t.tier} benefits`,
      eyebrow: 'Club · Tiers',
      body: [
        h('p', { class: 'dialog__text' }, 'The console’s words give way to the words by default, at once on /verify:'),
        h('ul', { class: 'tier__lines' }, ...benefitLines(t.defaultBenefits).map((l) => h('li', null, l))),
      ],
      confirmLabel: 'Restore default',
      submit: async () => {
        await ctx.api.updateClubTier(t.tier, null);
      },
    }).then(done(`${t.tier} benefits restored.`));

  return h(
    'div',
    { class: 'tiers' },
    ...items.map((t) =>
      section(
        t.tier,
        defList([
          { label: 'Reached', value: tierThreshold(t), note: 'A constant of the code: a setting could contradict the published rule of a draw.' },
          { label: 'Benefits', value: h('ul', { class: 'tier__lines', data: { testid: `tier-benefits-${t.tier}` } }, ...benefitLines(t.benefits).map((l) => h('li', null, l))) },
          {
            label: 'Words',
            value: h(
              'span',
              { data: { testid: `tier-words-${t.tier}` } },
              t.edited ? statusMark('Edited', 'solid') : statusMark('Default', 'muted'),
              t.edited && t.updatedAt ? h('span', { class: 'cell-sub' }, formatDateTime(t.updatedAt)) : null,
            ),
          },
        ]),
        {
          id: `tier-${t.tier.toLowerCase()}`,
          tools: canManage
            ? [
                button('Edit benefits', { kind: 'primary', testId: `tier-edit-${t.tier}`, onClick: () => edit(t) }),
                t.edited ? button('Restore default', { testId: `tier-restore-${t.tier}`, onClick: () => restore(t) }) : null,
              ].filter((b): b is HTMLButtonElement => b !== null)
            : [],
        },
      ),
    ),
  );
}
