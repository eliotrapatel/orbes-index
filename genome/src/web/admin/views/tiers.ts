/**
 * The tiers of the club (P-X04) in the console: the Club page's Tiers tab.
 *
 * One panel per tier, TITANE, PLATINE and PALLADIUM: the pieces held now it
 * starts from (1, 5 and 10, a constant of the code: never changed here, so a
 * setting never contradicts the published rule of a draw), its benefits as
 * /verify lists them at the head of MY PIECES, one per line, and whether they
 * are the words by default or the console's (with the time of the change).
 * Edit benefits (OPERATOR) opens the dialog of the words, what the tier adds
 * to the ones below it; Restore default removes the console's words. Each
 * change is one request, audited by the server (`club.tier.update`), then the
 * tab is read again. An AUDITOR reads.
 *
 * THE PROGRAM (plan NEXT-NINE, BP-19 T2), above the panels: every figure of
 * the tiers' benefits the owner called configurable, who changed it and when;
 * Edit program (ADMIN; OPERATOR and AUDITOR read) changes it whole, audited
 * `club.program.update`. Each panel lists its tier's program lines as /verify
 * shows them, above its words.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import { benefitLines, TIER_LIMITS, tierBenefitsChange, tierBenefitsProblem, tierThreshold } from '../model/club.js';
import { can } from '../model/permissions.js';
import {
  careOptions,
  careText,
  changedText,
  channelsText,
  creditText,
  fromTier,
  giftOptions,
  giftText,
  hoursText,
  priorityText,
  programChanged,
  programInput,
  programProblem,
  programValues,
  SHIPPING_FREE_LABELS,
} from '../model/program.js';
import { CREDIT_CHANNELS, HOUSE_CURRENCIES, SHIPPING_FREE_LEVELS, type ClubProgramSheet, type ClubTierSheet } from '../types.js';
import type { Child } from '../../shared/dom.js';
import { button, defList, section, statusMark } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The Tiers tab: the three tiers, each with its benefits. */
export async function tiersTab(ctx: ViewContext): Promise<HTMLElement> {
  const [{ items }, program] = await Promise.all([ctx.api.clubTiers(), ctx.api.clubProgram()]);
  const canManage = can(ctx.session.admin.role, 'manageClubTiers');
  const canProgram = can(ctx.session.admin.role, 'manageClubProgram');
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
    programSection(ctx, program, canProgram, done),
    ...items.map((t) =>
      section(
        t.tier,
        defList([
          { label: 'Reached', value: tierThreshold(t), note: 'A constant of the code: a setting could contradict the published rule of a draw.' },
          {
            label: 'Program',
            value: program.lines[t.tier].length
              ? h('ul', { class: 'tier__lines', data: { testid: `tier-program-${t.tier}` } }, ...program.lines[t.tier].map((l) => h('li', null, l)))
              : h('span', { data: { testid: `tier-program-${t.tier}` } }, 'None'),
            note: 'From THE PROGRAM above, as /verify shows it.',
          },
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

const TIER_OPTIONS = [
  { value: '1', label: 'TITANE' },
  { value: '2', label: 'PLATINE' },
  { value: '3', label: 'PALLADIUM' },
];

/**
 * THE PROGRAM: every figure of the tiers' benefits, who changed them and when; Edit program (ADMIN) changes them whole.
 */
function programSection(ctx: ViewContext, p: ClubProgramSheet, admin: boolean, done: (msg: string) => (r: unknown) => void): HTMLElement {
  const gift = (m: ClubProgramSheet['gifts']['platine']) => giftText(m);
  const platineGift = gift(p.gifts.platine);
  const palladiumGift = gift(p.gifts.palladium);
  const row = (label: string, value: Child, testid: string, note?: string | null) => ({ label, value: h('span', { data: { testid } }, value), ...(note ? { note } : {}) });
  const edit = () =>
    void openDialog({
      title: 'Edit the program',
      eyebrow: 'Club · Tiers',
      body: h('p', { class: 'dialog__text' }, 'The figures of the tiers’ benefits, as /verify states them. The thresholds (1, 5 and 10 pieces held) stay a constant of the code.'),
      fields: [
        {
          name: 'earlyAccessPalladiumHours',
          label: 'Early access by default, PALLADIUM (hours)',
          required: true,
          maxlength: 3,
          value: programValues(p).earlyAccessPalladiumHours,
          hint: 'Each draw takes these when created; its own dialog changes them. PALLADIUM’s window is at least PLATINE’s. 0: none. HOW RELEASES WORK on /verify states these default times.',
        },
        { name: 'earlyAccessPlatineHours', label: 'Early access by default, PLATINE (hours)', required: true, maxlength: 3, value: programValues(p).earlyAccessPlatineHours },
        { name: 'shippingFreePlatine', label: 'Free shipping, PLATINE', kind: 'select', options: SHIPPING_FREE_LEVELS.map((l) => ({ value: l, label: SHIPPING_FREE_LABELS[l] })), value: p.shippingFreePlatine },
        { name: 'shippingFreePalladium', label: 'Free shipping, PALLADIUM', kind: 'select', options: SHIPPING_FREE_LEVELS.map((l) => ({ value: l, label: SHIPPING_FREE_LABELS[l] })), value: p.shippingFreePalladium },
        { name: 'carePiecesPlatine', label: 'Yearly care, PLATINE', kind: 'select', options: careOptions(false), value: programValues(p).carePiecesPlatine },
        { name: 'carePiecesPalladium', label: 'Yearly care, PALLADIUM', kind: 'select', options: careOptions(true), value: programValues(p).carePiecesPalladium },
        {
          name: 'messagesPriorityMinTier',
          label: 'Messages first, from',
          kind: 'select',
          options: [
            { value: '0', label: 'Off' },
            { value: '2', label: 'PLATINE' },
            { value: '3', label: 'PALLADIUM' },
          ],
          value: String(p.messagesPriorityMinTier),
          hint: 'The Messages board puts these conversations first and marks them. No answer time is promised.',
        },
        {
          name: 'giftPlatineModelId',
          label: 'Welcome gift, PLATINE',
          kind: 'select',
          options: giftOptions(p, p.gifts.platine),
          value: p.giftPlatineModelId ?? '',
          hint: 'A model of several sizes: Client Services chooses the size on the gift’s order.',
        },
        { name: 'giftPalladiumModelId', label: 'Welcome gift, PALLADIUM', kind: 'select', options: giftOptions(p, p.gifts.palladium), value: p.giftPalladiumModelId ?? '' },
        { name: 'creditPlatine', label: 'Credit, PLATINE', required: true, maxlength: 12, value: programValues(p).creditPlatine, hint: 'An amount in units: 50, or 50.50. 0: none.' },
        { name: 'creditPalladium', label: 'Credit, PALLADIUM', required: true, maxlength: 12, value: programValues(p).creditPalladium },
        {
          name: 'creditCurrency',
          label: 'Credit currency',
          kind: 'select',
          options: HOUSE_CURRENCIES.map((c) => ({ value: c, label: c })),
          value: p.creditCurrency,
          hint: 'The credit applies only to orders in this currency.',
        },
        { name: 'creditValidityMonths', label: 'Credit valid (months)', required: true, maxlength: 2, value: String(p.creditValidityMonths) },
        { name: 'creditDraw', label: 'Credit usable on a draw', kind: 'checkbox', value: programValues(p).creditDraw },
        { name: 'creditLive', label: 'Credit usable on a LIVE RELEASE', kind: 'checkbox', value: programValues(p).creditLive },
        { name: 'creditSalon', label: 'Credit usable on the private salon', kind: 'checkbox', value: programValues(p).creditSalon },
        { name: 'experienceMembersEveningMinTier', label: 'Members’ evening, from', kind: 'select', options: TIER_OPTIONS, value: String(p.experienceMembersEveningMinTier) },
        { name: 'experienceLaunchPreviewMinTier', label: 'Launch previews, from', kind: 'select', options: TIER_OPTIONS, value: String(p.experienceLaunchPreviewMinTier) },
        { name: 'experiencePartnerMinTier', label: 'Partner experiences, from', kind: 'select', options: TIER_OPTIONS, value: String(p.experiencePartnerMinTier) },
      ],
      validate: (v) => programProblem(v) ?? (programChanged(p, programInput(v)) ? null : 'Nothing has changed.'),
      confirmLabel: 'Save program',
      submit: async (v) => {
        await ctx.api.updateClubProgram(programInput(v));
      },
    }).then(done('Program saved.'));
  return section(
    'THE PROGRAM',
    [
      h('p', { class: 'notice' }, 'The figures of the tiers’ benefits, as /verify states them. Everyone reads them; an ADMIN changes them.'),
      defList([
        row('Early access by default', `PALLADIUM ${hoursText(p.earlyAccessPalladiumHours)} · PLATINE ${hoursText(p.earlyAccessPlatineHours)}`, 'program-early'),
        row('Free shipping', `PLATINE ${SHIPPING_FREE_LABELS[p.shippingFreePlatine]} · PALLADIUM ${SHIPPING_FREE_LABELS[p.shippingFreePalladium]}`, 'program-shipping', 'Deliveries only: returns are unchanged.'),
        row('Yearly care', `PLATINE ${careText(p.carePiecesPlatine)} · PALLADIUM ${careText(p.carePiecesPalladium)}`, 'program-care'),
        row('Messages first', priorityText(p.messagesPriorityMinTier), 'program-priority'),
        row('Welcome gift, PLATINE', platineGift.value, 'program-gift-platine', platineGift.note),
        row('Welcome gift, PALLADIUM', palladiumGift.value, 'program-gift-palladium', palladiumGift.note),
        row('Credit, PLATINE', creditText(p.creditPlatineMinor, p), 'program-credit-platine'),
        row('Credit, PALLADIUM', creditText(p.creditPalladiumMinor, p), 'program-credit-palladium'),
        row('Credit usable on', channelsText(p.creditChannels.filter((c) => CREDIT_CHANNELS.includes(c))), 'program-credit-channels', `Orders in ${p.creditCurrency} only.`),
        row('Members’ evening', fromTier(p.experienceMembersEveningMinTier), 'program-evening'),
        row('Launch previews', fromTier(p.experienceLaunchPreviewMinTier), 'program-previews'),
        row('Partner experiences', fromTier(p.experiencePartnerMinTier), 'program-partner'),
        row('Set', changedText(p), 'program-changed'),
      ]),
    ],
    { id: 'tier-program', tools: admin ? [button('Edit program', { kind: 'primary', testId: 'program-edit', onClick: edit })] : [] },
  );
}
