/**
 * The Segments page (Clients), `#/segments` (plan LIVE RELEASE+, choice 27, N5: The console → Segments): saved groups
 * of collectors, each read live wherever it decides something — a LIVE RELEASE's access rule (the release page says
 * FOR SELECTED COLLECTORS, never the segment's name) and the audience of a post of the circle.
 *
 *  - The list: each segment, its rules in words, its collectors now, what uses it, when it last changed; NEW SEGMENT
 *    (OPERATOR).
 *  - A segment's page, `#/segments/:segmentId` (and `#/segments/new`): the builder over the groups of criteria —
 *    releases taken part in and pieces secured; tier, models and collections owned; sizes and country; interest,
 *    answers to the question after and last activity; then the customer intelligence lot's (plan CUSTOMER INTELLIGENCE
 *    §3.0 (g), §3.6 C.5.1): city, age, how they heard and tags; wishlist and favourite pieces and finishes; what they
 *    look at, devices and places; where they come from; the engagement score (with its notice while a rule reads it) —
 *    each rule matched or not, ALL or ANY of them, a group of rules one level down; the count of collectors it matches
 *    now, read again as the rules change, and the rules in words.
 *    SAVE, DELETE (nothing may use it), and its members as a CSV (the emails masked for an AUDITOR). An AUDITOR reads the
 *    rules in words, the count, what uses it, and the CSV.
 * Model in model/segments.ts; routes in server/routes/admin/segments.ts. Each change is audited by the server.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import {
  cityLabel,
  cityValue,
  commaItems,
  criteriaWords,
  criterionChoices,
  defaultRule,
  DEVICE_KIND_LABELS,
  DEVICE_SYSTEM_LABELS,
  heardLabel,
  isSegmentGroup,
  LAST_SOURCE_AT_LABELS,
  linkLabel,
  listItems,
  membersLine,
  modelLabel,
  OPENED_IN_LABELS,
  readsScore,
  releaseChoices,
  releaseLabel,
  segmentActions,
  SEGMENT_COPY,
  segmentProblem,
  SEGMENT_LIMITS,
  SEGMENT_TIER_LABELS,
  tasteChoicesFor,
  tasteLabel,
  usedByLine,
} from '../model/segments.js';
import { tagValue } from '../model/client-notes.js';
import { LINE_LABELS } from '../model/links.js';
import { APP_WORDS } from '../model/owner-intelligence.js';
import { href } from '../router.js';
import { LAST_SOURCE_AT, type Segment, type SegmentGroup, type SegmentOptions, type SegmentRule } from '../types.js';
import { button, checkbox, defList, field, input, linkButton, pageHeader, section, select, table } from '../ui/components.js';
import { confirmAction } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'Saved groups of collectors, read live wherever they decide: the access rule of a LIVE RELEASE or a draw (its page says FOR SELECTED COLLECTORS, never the name) and the audience of a post of the circle.';

/** The count is read again this long after the last change of the rules. */
const COUNT_DELAY_MS = 300;

export async function segmentsView(ctx: ViewContext): Promise<HTMLElement> {
  const [list, options] = await Promise.all([ctx.api.segments(), ctx.api.segmentOptions()]);
  const acts = segmentActions(null, ctx.session.admin.role);
  return h(
    'div',
    { class: 'view view--segments' },
    pageHeader({ eyebrow: 'Clients', title: 'Segments', lead: LEAD, actions: acts.edit ? [linkButton('New segment', href('segmentNew'), 'primary')] : [] }),
    section(
      'Segments',
      table<Segment>(
        [
          { label: 'Segment', cell: (s) => h('a', { class: 'idlink', attrs: { href: href('segment', { segmentId: s.id }), 'data-testid': 'segment-link' } }, s.name), kind: ['nowrap'] },
          { label: 'Who', cell: (s) => h('span', { class: 'cell-details' }, criteriaWords(s.criteria, options)), kind: ['wide'] },
          { label: 'Collectors now', cell: (s) => h('span', { data: { testid: 'segment-row-count' } }, membersLine(s.count)), kind: ['nowrap', 'num'] },
          { label: 'Used by', cell: (s) => usedByLine(s) ?? '—', kind: ['nowrap'] },
          { label: 'Changed', cell: (s) => formatDateTime(s.updatedAt), kind: ['nowrap'] },
        ],
        list,
        {
          caption: 'Segments',
          empty: 'No segment yet. A segment names collectors by the releases they took part in, what they hold, their sizes and country, their interest and their answers.',
          onRow: (s) => href('segment', { segmentId: s.id }),
        },
      ),
      { id: 'segments-list' },
    ),
  );
}

export async function segmentView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.name === 'segment' ? (ctx.route.params.segmentId ?? '') : null;
  const [segment, options] = await Promise.all([id ? ctx.api.segment(id) : Promise.resolve(null), ctx.api.segmentOptions()]);
  const acts = segmentActions(segment, ctx.session.admin.role);
  const header = pageHeader({
    eyebrow: 'Clients · Segments',
    title: segment?.name ?? 'New segment',
    lead: acts.edit
      ? 'Choose who belongs: each rule matched or not, every rule (ALL) or any (ANY), a group of rules within. The count says how many collectors it matches now.'
      : 'Who belongs, in words, and how many collectors it matches now.',
    actions: [linkButton('All segments', href('segments'), 'ghost')],
  });
  const csv = segment ? csvButton(ctx, segment) : null;
  const used = segment ? usedSection(segment) : null;
  if (!acts.edit) {
    if (!segment) return h('div', { class: 'view view--segment' }, header, h('p', { class: 'notice' }, 'An OPERATOR builds the segments.'));
    return h(
      'div',
      { class: 'view view--segment' },
      header,
      section(
        'The segment',
        defList([
          { label: 'Who', value: h('span', { data: { testid: 'segment-words' } }, criteriaWords(segment.criteria, options)) },
          { label: 'Collectors now', value: h('span', { data: { testid: 'segment-count' } }, membersLine(segment.count)) },
          { label: 'Changed', value: formatDateTime(segment.updatedAt), note: segment.createdBy ? `Created by ${segment.createdBy.email}` : undefined },
        ]),
        { id: 'segment-facts', tools: csv ? [csv] : [] },
      ),
      used,
    );
  }
  return h('div', { class: 'view view--segment' }, header, builder(ctx, segment, options, csv), used);
}

/** The builder: the name, the rules, the count now, SAVE and DELETE. */
function builder(ctx: ViewContext, segment: Segment | null, options: SegmentOptions, csv: HTMLButtonElement | null): HTMLElement {
  const draft: SegmentGroup = segment ? (JSON.parse(JSON.stringify(segment.criteria)) as SegmentGroup) : { match: 'ALL', rules: [defaultRule('PARTICIPATIONS', options)] };
  const name = input('name', { value: segment?.name ?? '', maxlength: SEGMENT_LIMITS.name });
  const tree = h('div', { class: 'segment__tree', data: { testid: 'segment-tree' } });
  const count = h('p', { class: 'segment__count', attrs: { 'aria-live': 'polite' }, data: { testid: 'segment-count' } });
  const countNote = h('p', { class: 'segment__count-note' }, 'Collectors it matches now, read again as the rules change.');
  const words = h('p', { class: 'segment__words', data: { testid: 'segment-words' } });
  const problem = h('p', { class: 'segment__problem', attrs: { role: 'status' }, data: { testid: 'segment-problem' } });
  const scoreNotice = h('p', { class: 'notice segment__notice', data: { testid: 'segment-score-notice' } }, SEGMENT_COPY.scoreNotice);
  const save = button(segment ? 'Save' : 'Create segment', { kind: 'primary', testId: 'segment-save' });
  const remove = segment
    ? button('Delete', { kind: 'ghost', testId: 'segment-delete', disabled: !segmentActions(segment, ctx.session.admin.role).remove, title: usedByLine(segment) ? 'A release, a post of the circle or a house message not sent yet uses it.' : undefined })
    : null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let asked = 0;
  /** After every change: the problem, else the rules in words and, a moment later, the count (as saved: the server's, at once). */
  const changed = (): void => {
    scoreNotice.hidden = !readsScore(draft);
    const p = segmentProblem(draft, options);
    problem.textContent = p ?? '';
    problem.hidden = p === null;
    words.textContent = p ? '' : criteriaWords(draft, options);
    if (timer) clearTimeout(timer);
    const mine = ++asked;
    if (p) {
      count.textContent = '—';
      return;
    }
    if (segment && JSON.stringify(draft) === JSON.stringify(segment.criteria)) {
      count.textContent = membersLine(segment.count);
      return;
    }
    count.textContent = '…';
    timer = setTimeout(async () => {
      try {
        const { count: n } = await ctx.api.segmentCount(draft);
        if (mine === asked && count.isConnected) count.textContent = membersLine(n);
      } catch {
        if (mine === asked && count.isConnected) count.textContent = '—';
      }
    }, COUNT_DELAY_MS);
  };

  const redraw = (): void => {
    tree.replaceChildren(groupEl(draft, 1, null));
    changed();
  };

  /** A group: ALL or ANY of its rules; the segment's own, or one within it. */
  const groupEl = (g: SegmentGroup, depth: number, parent: SegmentGroup | null): HTMLElement => {
    const match = select(
      'match',
      [
        { value: 'ALL', label: 'every rule (ALL)' },
        { value: 'ANY', label: 'any rule (ANY)' },
      ],
      g.match,
    );
    match.setAttribute('aria-label', depth === 1 ? 'The segment matches' : 'The group matches');
    match.addEventListener('change', () => {
      g.match = match.value === 'ANY' ? 'ANY' : 'ALL';
      changed();
    });
    const addRule = button(depth === 1 ? 'Add a rule' : 'Add a rule to the group', {
      kind: 'ghost',
      testId: depth === 1 ? 'segment-add-rule' : 'segment-group-add-rule',
      onClick: () => {
        g.rules.push(defaultRule('PARTICIPATIONS', options));
        redraw();
      },
    });
    const tools: HTMLElement[] = [addRule];
    if (depth < SEGMENT_LIMITS.depth) {
      tools.push(
        button('Add a group', {
          kind: 'ghost',
          testId: 'segment-add-group',
          onClick: () => {
            g.rules.push({ match: 'ANY', rules: [defaultRule('SIZE', options)] });
            redraw();
          },
        }),
      );
    }
    if (parent) {
      tools.push(
        button('Remove the group', {
          kind: 'ghost',
          testId: 'segment-remove-group',
          onClick: () => {
            parent.rules.splice(parent.rules.indexOf(g), 1);
            redraw();
          },
        }),
      );
    }
    return h(
      'div',
      { class: ['segment__group', depth > 1 ? 'segment__group--inner' : null], data: { testid: depth > 1 ? 'segment-group' : 'segment-root' } },
      h('p', { class: 'segment__group-head' }, depth === 1 ? 'Collectors who match ' : 'A group: collectors who match ', match, ' of:'),
      ...g.rules.map((r) => (isSegmentGroup(r) ? groupEl(r, depth + 1, g) : ruleEl(r, g))),
      h('div', { class: 'segment__group-tools' }, ...tools),
    );
  };

  /** A rule: matched or not, its criterion, its value, REMOVE. */
  const ruleEl = (r: SegmentRule, g: SegmentGroup): HTMLElement => {
    const replace = (next: SegmentRule): void => {
      g.rules[g.rules.indexOf(r)] = next;
      redraw();
    };
    const not = select(
      'not',
      [
        { value: '', label: 'Matches' },
        { value: 'not', label: 'Does not match' },
      ],
      r.not ? 'not' : '',
    );
    not.setAttribute('aria-label', 'Matches or not');
    not.addEventListener('change', () => {
      if (not.value === 'not') r.not = true;
      else delete r.not;
      changed();
    });
    const kind = h(
      'select',
      { class: 'cinput cinput--select', attrs: { name: 'kind', 'aria-label': 'Criterion' } },
      ...criterionChoices().map((c) => h('optgroup', { attrs: { label: c.label } }, ...c.kinds.map((k) => h('option', { attrs: { value: k.value } }, k.label)))),
    );
    kind.value = r.kind;
    kind.addEventListener('change', () => replace({ ...defaultRule(kind.value as SegmentRule['kind'], options), ...(r.not ? { not: true } : {}) }));
    const remove = button('Remove', {
      kind: 'ghost',
      testId: 'segment-remove-rule',
      onClick: () => {
        g.rules.splice(g.rules.indexOf(r), 1);
        redraw();
      },
    });
    return h('div', { class: 'segment__rule', data: { testid: 'segment-rule' } }, not, kind, h('div', { class: 'segment__value' }, ...valueOf(r, () => changed(), () => redraw())), remove);
  };

  /** The controls of a rule's value, each change written into the rule. */
  const valueOf = (r: SegmentRule, onChange: () => void, onRedraw: () => void): HTMLElement[] => {
    const whole = (value: number, label: string, unit: string, set: (n: number) => void): HTMLElement[] => {
      const n = input('value', { value: Number.isFinite(value) ? String(value) : '', inputmode: 'numeric', maxlength: 4 });
      n.classList.add('segment__number');
      n.setAttribute('aria-label', label);
      n.addEventListener('input', () => {
        set(/^\s*\d{1,4}\s*$/.test(n.value) ? Number(n.value) : Number.NaN);
        onChange();
      });
      return [n, h('span', { class: 'segment__unit' }, unit)];
    };
    const release = (value: string | null, kind: SegmentRule['kind'], any: boolean, set: (id: string | null) => void, redrawAfter = false): HTMLSelectElement => {
      const choices = releaseChoices(options, kind);
      const s = select(
        'release',
        [
          ...(any ? [{ value: '', label: 'Any LIVE RELEASE' }] : choices.length ? [] : [{ value: '', label: 'No release yet' }]),
          ...choices.map((d) => ({ value: d.id, label: releaseLabel(d) })),
        ],
        value ?? '',
      );
      s.setAttribute('aria-label', 'Release');
      s.addEventListener('change', () => {
        set(s.value || null);
        if (redrawAfter) onRedraw();
        else onChange();
      });
      return s;
    };
    const many = (values: string[], choices: { id: string; label: string }[], label: string, set: (ids: string[]) => void): HTMLElement[] => {
      const s = h('select', { class: 'cinput cinput--multi', attrs: { name: 'items', multiple: true, size: Math.max(2, Math.min(5, choices.length)), 'aria-label': label } }, ...choices.map((c) => h('option', { attrs: { value: c.id } }, c.label)));
      for (const o of Array.from(s.options)) o.selected = values.includes(o.value);
      s.addEventListener('change', () => {
        set(Array.from(s.selectedOptions).map((o) => o.value));
        onChange();
      });
      return [s, h('span', { class: 'segment__unit' }, choices.length ? 'one or more' : 'none yet')];
    };
    const typed = (values: string[], label: string, placeholder: string, known: string[], set: (xs: string[]) => void, items: (text: string) => string[] = listItems): HTMLElement[] => {
      const t = input('items', { value: values.join(', '), placeholder, maxlength: 400 });
      t.setAttribute('aria-label', label);
      t.addEventListener('input', () => {
        set(items(t.value));
        onChange();
      });
      return [t, h('span', { class: 'segment__unit' }, known.length ? `Known: ${known.slice(0, 12).join(' · ')}` : 'Separated by commas')];
    };
    /** Two whole numbers, From and To (AGE, SCORE): three figures each. */
    const range = (rule: { min: number; max: number }, label: string): HTMLElement[] => {
      const bound = (key: 'min' | 'max', words: string): HTMLElement => {
        const n = input(key, { value: Number.isFinite(rule[key]) ? String(rule[key]) : '', inputmode: 'numeric', maxlength: 3 });
        n.classList.add('segment__number');
        n.setAttribute('aria-label', `${label}: ${words.toLowerCase()}`);
        n.addEventListener('input', () => {
          rule[key] = /^\s*\d{1,3}\s*$/.test(n.value) ? Number(n.value) : Number.NaN;
          onChange();
        });
        return h('label', { class: 'segment__bound' }, h('span', { class: 'segment__unit' }, words), n);
      };
      return [bound('min', SEGMENT_COPY.from), bound('max', SEGMENT_COPY.to)];
    };
    /** A row of checkboxes (a finish with its dot); `set` receives the values ticked, in the row's order. */
    const checks = <T extends string>(choices: { value: T; label: string; swatch?: string | null }[], ticked: readonly T[], label: string, set: (xs: T[]) => void): HTMLElement => {
      let now = [...ticked];
      return h(
        'div',
        { class: 'segment__checks', attrs: { role: 'group', 'aria-label': label } },
        ...choices.map((c) => {
          const box = checkbox(`${label}-${c.value}`, c.label, now.includes(c.value));
          if (c.swatch) {
            const d = h('span', { class: 'variant-dot', attrs: { 'aria-hidden': 'true' } });
            d.style.backgroundColor = c.swatch;
            box.querySelector('.ccheck__label')!.prepend(d, ' ');
          }
          box.querySelector('input')!.addEventListener('change', (e) => {
            const on = (e.target as HTMLInputElement).checked;
            now = choices.map((x) => x.value).filter((v) => (v === c.value ? on : now.includes(v)));
            set(now);
            onChange();
          });
          return box;
        }),
      );
    };
    /** One of a rule's lists, headed by its name. */
    const list = (heading: string, ...children: HTMLElement[]): HTMLElement => h('div', { class: 'segment__list' }, h('span', { class: 'segment__unit' }, heading), ...children);
    /** An optional list of a rule (DEVICE, PLACE, FIRST_SOURCE, LAST_SOURCE): left out of the rule when empty. */
    const optional = <R extends object, K extends keyof R>(rule: R, key: K) => (xs: unknown[]): void => {
      if (xs.length) rule[key] = xs as R[K];
      else delete rule[key];
    };
    const hint = (text: string): HTMLElement => h('p', { class: 'segment__hint', data: { testid: 'segment-model-hint' } }, text);
    const models = options.models.map((m) => ({ id: m.id, label: modelLabel(m) }));
    const sources = (rule: Extract<SegmentRule, { kind: 'FIRST_SOURCE' | 'LAST_SOURCE' }>): HTMLElement[] => [
      list('Channels', ...many(rule.channelIds ?? [], options.channels.map((c) => ({ id: c.id, label: c.name })), 'Channels', optional(rule, 'channelIds'))),
      list('Links', ...many(rule.linkIds ?? [], options.links.map((l) => ({ id: l.id, label: linkLabel(l) })), 'Links', optional(rule, 'linkIds'))),
      list('Sources', checks(options.sourceKinds.map((k) => ({ value: k, label: LINE_LABELS[k] })), rule.kinds ?? [], 'Sources', optional(rule, 'kinds'))),
    ];
    switch (r.kind) {
      case 'PARTICIPATIONS':
        return whole(r.min, 'Releases taken part in, at least', 'releases', (n) => (r.min = n));
      case 'SECURED':
        return whole(r.min, 'Pieces secured, at least', 'pieces', (n) => (r.min = n));
      case 'ACTIVE':
        return whole(r.days, 'Days', 'days', (n) => (r.days = n));
      case 'TOOK_PART':
      case 'SECURED_IN':
        return [release(r.dropId, r.kind, false, (v) => (r.dropId = v ?? ''))];
      case 'INTEREST':
        return [release(r.dropId, r.kind, true, (v) => (r.dropId = v))];
      case 'ANSWER': {
        const d = options.releases.find((x) => x.id === r.dropId);
        const answer = select(
          'answer',
          (d?.answers ?? []).map((a, i) => ({ value: String(i + 1), label: a })),
          String(r.answer),
        );
        answer.setAttribute('aria-label', 'Answer');
        answer.addEventListener('change', () => {
          r.answer = Number(answer.value);
          onChange();
        });
        return [
          release(
            r.dropId,
            r.kind,
            false,
            (v) => {
              r.dropId = v ?? '';
              r.answer = 1;
            },
            true,
          ),
          answer,
        ];
      }
      case 'TIER':
        return [
          h(
            'div',
            { class: 'segment__checks', attrs: { role: 'group', 'aria-label': 'Tiers' } },
            ...SEGMENT_TIER_LABELS.map((label, tier) => {
              const box = checkbox(`tier-${tier}`, label, r.tiers.includes(tier));
              box.querySelector('input')!.addEventListener('change', (e) => {
                const on = (e.target as HTMLInputElement).checked;
                r.tiers = [0, 1, 2, 3].filter((t) => (t === tier ? on : r.tiers.includes(t)));
                onChange();
              });
              return box;
            }),
          ),
        ];
      case 'OWNS_MODEL':
        return many(r.modelIds, models, 'Models', (ids) => (r.modelIds = ids));
      case 'OWNS_COLLECTION':
        return many(r.collectionIds, options.collections.map((c) => ({ id: c.id, label: c.name })), 'Collections', (ids) => (r.collectionIds = ids));
      case 'SIZE':
        return typed(r.sizes, 'Sizes', '52, 54', options.sizes, (xs) => (r.sizes = xs));
      case 'COUNTRY':
        return typed(r.countries, 'Countries', 'FR, IT', options.countries, (xs) => (r.countries = xs));
      // The lot's (plan CUSTOMER INTELLIGENCE §3.6 C.5.1).
      case 'CITY':
        return typed(
          r.cities.map((c) => cityLabel(c, options)),
          'Cities',
          'Lyon, Milan',
          options.cities,
          (xs) => (r.cities = xs),
          (text) => commaItems(text, cityValue),
        );
      case 'AGE':
        return range(r, 'Age');
      case 'SCORE':
        return range(r, 'Engagement score');
      case 'HEARD_FROM':
        return many(r.optionIds, options.heardOptions.map((a) => ({ id: a.id, label: heardLabel(a) })), 'Answers', (ids) => (r.optionIds = ids));
      case 'TAGGED':
        return typed(r.tags, 'Tags', 'VIP, PRESS', options.tags.map((t) => t.tag), (xs) => (r.tags = xs), (text) => commaItems(text, tagValue));
      case 'WISHES_MODEL':
        return [...many(r.modelIds, models, 'Models', (ids) => (r.modelIds = ids)), hint(SEGMENT_COPY.modelHint)];
      case 'WISHES_COLLECTION':
        return many(r.collectionIds, options.collections.map((c) => ({ id: c.id, label: c.name })), 'Collections', (ids) => (r.collectionIds = ids));
      case 'FAVOURITE_PIECE':
        return [checks(tasteChoicesFor(r.kind, r.pieces, options).map((t) => ({ value: t.key, label: tasteLabel(t) })), r.pieces, 'Favourite pieces', (xs) => (r.pieces = xs))];
      case 'FAVOURITE_FINISH':
        return [checks(tasteChoicesFor(r.kind, r.finishes, options).map((t) => ({ value: t.key, label: tasteLabel(t), swatch: t.swatch })), r.finishes, 'Favourite finishes', (xs) => (r.finishes = xs))];
      case 'VIEWED_MODEL':
        // The models on their own line, then « N views or more · N last days » together, each figure beside its unit.
        return [
          list('Models', ...many(r.modelIds, models, 'Models', (ids) => (r.modelIds = ids))),
          ...whole(r.min, 'Views, at least', 'views or more', (n) => (r.min = n)),
          ...whole(r.days, 'In the last days', 'last days', (n) => (r.days = n)),
          hint(SEGMENT_COPY.modelHint),
        ];
      case 'VIEWED_RELEASE':
        return [release(r.dropId, r.kind, false, (v) => (r.dropId = v ?? '')), ...whole(r.min, 'Views, at least', 'views or more', (n) => (r.min = n))];
      case 'DEVICE':
        return [
          list('Device', checks(options.devices.kinds.map((k) => ({ value: k, label: DEVICE_KIND_LABELS[k] })), r.kinds ?? [], 'Device', optional(r, 'kinds'))),
          list('System', checks(options.devices.systems.map((k) => ({ value: k, label: DEVICE_SYSTEM_LABELS[k] })), r.systems ?? [], 'System', optional(r, 'systems'))),
          list('Opened', checks(options.devices.openedIn.map((k) => ({ value: k, label: OPENED_IN_LABELS[k] })), r.openedIn ?? [], 'Opened', optional(r, 'openedIn'))),
          list('App', checks(options.devices.apps.map((k) => ({ value: k, label: APP_WORDS[k] })), r.apps ?? [], 'App', optional(r, 'apps'))),
          ...whole(r.days, 'In the last days', 'last days', (n) => (r.days = n)),
        ];
      case 'PLACE':
        return [
          list('Places', ...many(r.placeIds?.map(String) ?? [], options.places.map((x) => ({ id: String(x.id), label: x.label })), 'Places', (ids) => optional(r, 'placeIds')(ids.map(Number)))),
          list('Countries', ...typed(r.countries ?? [], 'Countries', 'FR, IT', options.countries, optional(r, 'countries'))),
          ...whole(r.days, 'In the last days', 'last days', (n) => (r.days = n)),
        ];
      case 'FIRST_SOURCE':
        return sources(r);
      // Plan MACRO M1 §3.1 (F4): nothing to choose, the founding list's matched accounts.
      case 'FOUNDING_LIST':
        return [];
      case 'LAST_SOURCE': {
        const at = select(
          'at',
          LAST_SOURCE_AT.map((x) => ({ value: x, label: LAST_SOURCE_AT_LABELS[x] })),
          r.at,
        );
        at.setAttribute('aria-label', 'Before');
        at.addEventListener('change', () => {
          r.at = (LAST_SOURCE_AT as readonly string[]).includes(at.value) ? (at.value as typeof r.at) : 'EITHER';
          onChange();
        });
        return [...sources(r), list('Before', at)];
      }
    }
  };

  save.addEventListener('click', async () => {
    const p = segmentProblem(draft, options, name.value);
    if (p) {
      problem.textContent = p;
      problem.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      if (segment) {
        const change: { name?: string; criteria?: SegmentGroup } = {};
        if (name.value.trim() !== segment.name) change.name = name.value.trim();
        if (JSON.stringify(draft) !== JSON.stringify(segment.criteria)) change.criteria = draft;
        if (!change.name && !change.criteria) {
          notify('Nothing has changed.');
          return;
        }
        await ctx.api.updateSegment(segment.id, change);
        notify('Segment saved.');
        ctx.reload();
      } else {
        const created = await ctx.api.createSegment({ name: name.value.trim(), criteria: draft });
        notify('Segment created.');
        ctx.navigate(href('segment', { segmentId: created.id }));
      }
    } catch (e) {
      notifyError(e);
    } finally {
      save.disabled = false;
    }
  });

  remove?.addEventListener('click', async () => {
    if (!segment) return;
    const ok = await confirmAction('Delete the segment', `${segment.name} is deleted: nothing uses it. Its collectors are not touched.`, 'Delete segment', true);
    if (!ok) return;
    try {
      await ctx.api.deleteSegment(segment.id);
      notify('Segment deleted.');
      ctx.navigate(href('segments'));
    } catch (e) {
      notifyError(e);
    }
  });

  redraw();
  return h(
    'div',
    { class: 'segment' },
    section(
      'The segment',
      [
        h('div', { class: 'segment__name' }, field('Name', name, { hint: 'Seen in the console only: a release says FOR SELECTED COLLECTORS.', required: true })),
        tree,
        scoreNotice,
        problem,
      ],
      { id: 'segment-builder' },
    ),
    section('Now', [h('div', { class: 'segment__now' }, count, countNote), words], {
      id: 'segment-now',
      tools: [save, ...(remove ? [remove] : []), ...(csv ? [csv] : [])],
    }),
  );
}

/** The CSV of a segment's members now (the emails masked for an AUDITOR). */
function csvButton(ctx: ViewContext, s: Segment): HTMLButtonElement {
  const b = button('Members (CSV)', { kind: 'ghost', testId: 'segment-csv' });
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      saveDownload(await ctx.api.segmentCsv(s.id));
    } catch (e) {
      notifyError(e);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

/** The releases whose access rule it is, the posts of the circle and the house messages not sent yet whose audience it is. */
function usedSection(s: Segment): HTMLElement {
  const houseMessages = s.usedBy.houseMessages;
  const none = s.usedBy.releases.length + s.usedBy.posts.length + houseMessages.length === 0;
  return section(
    'Used by',
    none
      ? h('p', { class: 'notice' }, 'Nothing yet: choose it in a release’s access, a LIVE RELEASE’s or a draw’s, as a post’s audience in the circle, or as a house message’s audience.')
      : defList([
          // Plan MACRO M1 §3.2 (F4): a draw may be opened to a segment too; each release opens its own page.
          ...s.usedBy.releases.map((r) => ({ label: 'Release', value: h('a', { class: 'idlink', attrs: { href: r.mode === 'DRAW' ? href('drop', { dropId: r.id }) : href('liveRelease', { dropId: r.id }) } }, r.title), note: 'Its access rule' })),
          ...s.usedBy.posts.map((p) => ({ label: 'Circle', value: h('a', { class: 'idlink', attrs: { href: href('circlePost', { postId: p.id }) } }, p.title), note: 'Its audience' })),
          // Plan MACRO M2 §1.6: a house message's audience, until it is sent (a sent one keeps the segment's name).
          ...houseMessages.map((m) => ({
            label: 'House message',
            value: h('a', { class: 'idlink', attrs: { href: href('houseMessages', {}, { tab: 'messages', message: m.id }), 'data-testid': 'segment-used-house' } }, m.title),
            note: `Its audience · ${m.status === 'SCHEDULED' ? 'Scheduled' : 'Draft'}`,
          })),
        ]),
    { id: 'segment-used' },
  );
}
