/**
 * The Segments page (Clients), `#/segments` (plan LIVE RELEASE+, choice 27, N5: The console → Segments): saved groups
 * of collectors, each read live wherever it decides something — a LIVE RELEASE's access rule (the release page says
 * FOR SELECTED COLLECTORS, never the segment's name) and the audience of a post of the circle.
 *
 *  - The list: each segment, its rules in words, its collectors now, what uses it, when it last changed; NEW SEGMENT
 *    (OPERATOR).
 *  - A segment's page, `#/segments/:segmentId` (and `#/segments/new`): the builder over the four groups of criteria —
 *    releases taken part in and pieces secured; tier, models and collections owned; sizes and country; interest,
 *    answers to the question after and last activity — each rule matched or not, ALL or ANY of them, a group of rules
 *    one level down; the count of collectors it matches now, read again as the rules change, and the rules in words.
 *    SAVE, DELETE (nothing may use it), and its members as a CSV (the emails masked for an AUDITOR). An AUDITOR reads the
 *    rules in words, the count, what uses it, and the CSV.
 * Model in model/segments.ts; routes in server/routes/admin/segments.ts. Each change is audited by the server.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import {
  criteriaWords,
  criterionChoices,
  defaultRule,
  isSegmentGroup,
  listItems,
  membersLine,
  releaseChoices,
  releaseLabel,
  segmentActions,
  segmentProblem,
  SEGMENT_LIMITS,
  SEGMENT_TIER_LABELS,
  usedByLine,
} from '../model/segments.js';
import { href } from '../router.js';
import type { Segment, SegmentGroup, SegmentOptions, SegmentRule } from '../types.js';
import { button, checkbox, defList, field, input, linkButton, pageHeader, section, select, table } from '../ui/components.js';
import { confirmAction } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'Saved groups of collectors, read live wherever they decide: the access rule of a LIVE RELEASE (its page says FOR SELECTED COLLECTORS, never the name) and the audience of a post of the circle.';

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
  const save = button(segment ? 'Save' : 'Create segment', { kind: 'primary', testId: 'segment-save' });
  const remove = segment
    ? button('Delete', { kind: 'ghost', testId: 'segment-delete', disabled: !segmentActions(segment, ctx.session.admin.role).remove, title: usedByLine(segment) ? 'A release or a post of the circle uses it.' : undefined })
    : null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let asked = 0;
  /** After every change: the problem, else the rules in words and, a moment later, the count (as saved: the server's, at once). */
  const changed = (): void => {
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
    const typed = (values: string[], label: string, placeholder: string, known: string[], set: (xs: string[]) => void): HTMLElement[] => {
      const t = input('items', { value: values.join(', '), placeholder, maxlength: 400 });
      t.setAttribute('aria-label', label);
      t.addEventListener('input', () => {
        set(listItems(t.value));
        onChange();
      });
      return [t, h('span', { class: 'segment__unit' }, known.length ? `Known: ${known.slice(0, 12).join(' · ')}` : 'Separated by commas')];
    };
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
        return many(r.modelIds, options.models.map((m) => ({ id: m.id, label: [m.name, m.type, m.variant].filter((x): x is string => !!x).join(' · ') })), 'Models', (ids) => (r.modelIds = ids));
      case 'OWNS_COLLECTION':
        return many(r.collectionIds, options.collections.map((c) => ({ id: c.id, label: c.name })), 'Collections', (ids) => (r.collectionIds = ids));
      case 'SIZE':
        return typed(r.sizes, 'Sizes', '52, 54', options.sizes, (xs) => (r.sizes = xs));
      case 'COUNTRY':
        return typed(r.countries, 'Countries', 'FR, IT', options.countries, (xs) => (r.countries = xs));
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

/** The releases whose access rule it is, the posts of the circle whose audience it is. */
function usedSection(s: Segment): HTMLElement {
  const none = s.usedBy.releases.length + s.usedBy.posts.length === 0;
  return section(
    'Used by',
    none
      ? h('p', { class: 'notice' }, 'Nothing yet: choose it in a LIVE RELEASE’s access, or as a post’s audience in the circle.')
      : defList([
          ...s.usedBy.releases.map((r) => ({ label: 'Release', value: h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: r.id }) } }, r.title), note: 'Its access rule' })),
          ...s.usedBy.posts.map((p) => ({ label: 'Circle', value: h('a', { class: 'idlink', attrs: { href: href('circlePost', { postId: p.id }) } }, p.title), note: 'Its audience' })),
        ]),
    { id: 'segment-used' },
  );
}
