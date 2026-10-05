/**
 * The circle (P-X01) in the console: the Club page's Circle tab, and a post's
 * page, `#/club/circle/:postId`, reached from its row (no link of its own in
 * the sidebar).
 *
 * The tab: every post, the latest created first, with its kind, the tiers that
 * read it, its state and what it gathered (answers, votes); New note, New
 * invitation and New poll (OPERATOR) open the dialog of their kind, which
 * creates the post unpublished and opens its page.
 *
 * A post's page:
 *  - Post: its kind, state, tiers, event (UTC), place and places, options,
 *    links (a release, a model of the lookbook, an address on youtube.com,
 *    vimeo.com or theorbes.com) and its page on /verify once published; Edit
 *    (any field but the kind), Publish and Withdraw (OPERATOR);
 *  - Text: the body as a member reads it (shared/lookbook.ts, the paragraphs
 *    of the lookbook's story);
 *  - Photographs: up to four, through the photograph dialog (re-encoded by
 *    the canvas, ui/photo.ts), moved earlier or later, described or removed;
 *  - Answers (an invitation): YES and NO, the places left, each account
 *    (its email masked for an AUDITOR, a link to its sheet);
 *  - Results (a poll): the votes of each option.
 *
 * Each change is one request, audited by the server, then the page is read
 * again. An AUDITOR reads.
 */
import { h, type Child } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import {
  answersLine,
  audienceLine,
  circleActions,
  circleAddress,
  circleChange,
  circleFormValues,
  circleInput,
  circleLead,
  circleProblem,
  CIRCLE_KIND_LABELS,
  CIRCLE_LIMITS,
  CIRCLE_LINK_HOSTS,
  CIRCLE_TIER_OPTIONS,
  linkableDrops,
  linkableModels,
  pollResultLines,
} from '../model/circle.js';
import { galleryMoved, galleryWithAlt } from '../model/lookbook.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { CIRCLE_RSVP_ANSWERS, type CircleAnswer, type CirclePhoto, type CirclePost, type CirclePostKind, type CircleRsvpAnswer, type Drop, type Model, type SegmentName } from '../types.js';
import { barList, button, defList, emptyState, field, filterBar, linkButton, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { photoDialog, photoThumb } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** The state of a post as its mark says it. */
const stateOf = (p: Pick<CirclePost, 'published'>) => (p.published ? 'PUBLISHED' : 'UNPUBLISHED');
const stateMark = (p: Pick<CirclePost, 'published'>) => statusMark(p.published ? 'Published' : 'Not published', toneOf('circle', stateOf(p)));

/** The fields of a post's dialog of `kind`: its words and tiers, the fields of its kind, its links. */
export function circleFields(kind: CirclePostKind, values: Record<string, string>, drops: readonly Drop[], models: readonly Model[], segments: readonly SegmentName[]): DialogField[] {
  const out: DialogField[] = [
    { name: 'title', label: 'Title', required: true, maxlength: CIRCLE_LIMITS.title, value: values.title, hint: 'As the circle names it on /verify.' },
    {
      name: 'body',
      label: 'Text',
      kind: 'textarea',
      rows: 8,
      maxlength: CIRCLE_LIMITS.body,
      value: values.body,
      hint: 'Plain paragraphs, a blank line between two; no Markdown: what you type is shown as it is. Optional.',
    },
    { name: 'minTier', label: 'Read by', kind: 'select', options: [...CIRCLE_TIER_OPTIONS], value: values.minTier, hint: 'An owner below these tiers does not see the post.' },
    {
      name: 'segmentId',
      label: 'Segment',
      kind: 'select',
      options: [{ value: '', label: 'Every owner of these tiers' }, ...segments.map((x) => ({ value: x.id, label: x.name }))],
      value: values.segmentId,
      hint: 'Only its members among these owners read the post, read again at each visit; nobody sees its name.',
    },
  ];
  if (kind === 'INVITATION') {
    out.push(
      { name: 'eventAt', label: 'Event (UTC)', kind: 'datetime', required: true, value: values.eventAt, hint: 'Answers close when it begins.' },
      { name: 'eventPlace', label: 'Place', maxlength: CIRCLE_LIMITS.place, value: values.eventPlace, hint: 'Optional.' },
      { name: 'capacity', label: 'Places', maxlength: 5, value: values.capacity, hint: `The answers YES taken, 1 to ${formatCount(CIRCLE_LIMITS.capacity)}. Empty: no limit.` },
    );
  }
  if (kind === 'POLL') {
    out.push({
      name: 'pollOptions',
      label: 'Options',
      kind: 'textarea',
      rows: 6,
      maxlength: CIRCLE_LIMITS.optionsMax * (CIRCLE_LIMITS.option + 1),
      required: true,
      value: values.pollOptions,
      hint: `One per line, ${CIRCLE_LIMITS.optionsMin} to ${CIRCLE_LIMITS.optionsMax}, each of ${CIRCLE_LIMITS.option} characters at most. They no longer change once a vote is cast.`,
    });
  }
  out.push(
    { name: 'dropId', label: 'Release', kind: 'select', options: [{ value: '', label: 'None' }, ...linkableDrops(drops, values.dropId || null)], value: values.dropId, hint: 'Its page on /verify, once published.' },
    { name: 'modelId', label: 'Model', kind: 'select', options: [{ value: '', label: 'None' }, ...linkableModels(models, values.modelId || null)], value: values.modelId, hint: 'Its sheet in THE COLLECTION.' },
    { name: 'externalUrl', label: 'Link', maxlength: CIRCLE_LIMITS.url, value: values.externalUrl, hint: `An https address on ${CIRCLE_LINK_HOSTS.join(', ')}; its host is shown beside it. Optional.` },
  );
  return out;
}

/** What a dialog of `kind` says first. */
const KIND_LEADS: Readonly<Record<CirclePostKind, string>> = Object.freeze({
  NOTE: 'Words and photographs for the owners: a piece of news, the story of a making, a film.',
  INVITATION: 'An event the owners answer YES or NO, until it begins, within its places.',
  POLL: 'A question with its options: each owner votes once, and reads the results after voting.',
});

/** The Circle tab of the Club page: every post, and the three ways to write one. */
export async function circleTab(ctx: ViewContext): Promise<HTMLElement> {
  const [list, drops, models, segments] = await Promise.all([ctx.api.circlePosts(pageParam(ctx), 50), ctx.api.drops(1, 50), ctx.api.models(), ctx.api.segmentNames()]);
  const canManage = can(ctx.session.admin.role, 'manageCircle');

  let created: string | null = null;
  const newPost = (kind: CirclePostKind) =>
    void openDialog({
      title: `New ${CIRCLE_KIND_LABELS[kind].toLowerCase()}`,
      eyebrow: 'Club · Circle',
      body: [h('p', { class: 'dialog__text' }, KIND_LEADS[kind]), h('p', { class: 'dialog__text' }, 'Created unpublished: nobody reads it until it is published.')],
      fields: circleFields(kind, circleFormValues(kind, null, ctx.now()), drops.items, models.items, segments),
      validate: (v) => circleProblem(kind, v),
      confirmLabel: `Create ${CIRCLE_KIND_LABELS[kind].toLowerCase()}`,
      submit: async (v) => {
        created = (await ctx.api.createCirclePost(circleInput(kind, v))).id;
      },
    }).then((r) => {
      if (!r || !created) return;
      notify('Post created, not published yet.');
      ctx.navigate(href('circlePost', { postId: created }));
    });

  return section(
    'Circle',
    [
      table<CirclePost>(
        [
          {
            label: 'Post',
            cell: (p) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('circlePost', { postId: p.id }), 'data-testid': 'circle-link' } }, p.title), h('span', { class: 'cell-sub' }, CIRCLE_KIND_LABELS[p.kind])),
            kind: ['wide'],
          },
          { label: 'Read by', cell: (p) => audienceLine(p), kind: ['nowrap'] },
          { label: 'State', cell: (p) => stateMark(p), kind: ['nowrap'] },
          { label: 'Published', cell: (p) => (p.publishedAt ? formatDateTime(p.publishedAt) : '—'), kind: ['nowrap'] },
          { label: 'Photos', cell: (p) => formatCount(p.photos.length), kind: ['num'] },
          {
            label: 'Gathered',
            cell: (p) => (p.kind === 'INVITATION' ? answersLine(p) : p.kind === 'POLL' ? `${formatCount(p.results?.total ?? 0)} ${p.results?.total === 1 ? 'vote' : 'votes'}` : '—'),
            kind: ['nowrap'],
          },
        ],
        list.items,
        {
          empty: 'Nothing in the circle yet. A post reaches the owners of an ORBES piece on /verify, by tier: a note, an invitation they answer, or a poll.',
          caption: 'Circle',
          onRow: (p) => href('circlePost', { postId: p.id }),
        },
      ),
      pager(list, (p) => ctx.setQuery({ page: p })),
    ],
    {
      id: 'circle',
      tools: canManage
        ? [
            button('New note', { kind: 'primary', testId: 'circle-new-note', onClick: () => newPost('NOTE') }),
            button('New invitation', { kind: 'ghost', testId: 'circle-new-invitation', onClick: () => newPost('INVITATION') }),
            button('New poll', { kind: 'ghost', testId: 'circle-new-poll', onClick: () => newPost('POLL') }),
          ]
        : [],
    },
  );
}

/** A part of the post as the member reads it on /verify, or a line saying there is none. */
function memberPreview(heading: string, content: HTMLElement | null, testId: string): HTMLElement {
  return h(
    'div',
    { class: 'sheet-preview', data: { testid: testId } },
    h('p', { class: 'care-preview__label' }, 'As the member reads it'),
    h('div', { class: 'sheet-preview__panel' }, h('p', { class: 'sheet-preview__heading' }, heading), content ?? h('p', { class: 'sheet-preview__empty' }, 'No text: the post shows its title and photographs.')),
  );
}

export async function circlePostView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.postId ?? '';
  const answer = CIRCLE_RSVP_ANSWERS.find((a) => a === ctx.route.query.answer) as CircleRsvpAnswer | undefined;
  const p = await ctx.api.circlePost(id);
  const [drops, models, segments, answers] = await Promise.all([
    ctx.api.drops(1, 50),
    ctx.api.models(),
    ctx.api.segmentNames(),
    p.kind === 'INVITATION' ? ctx.api.circleAnswers(id, { ...(answer ? { answer } : {}), page: pageParam(ctx), pageSize: 50 }) : Promise.resolve(null),
  ]);
  const role = ctx.session.admin.role;
  const acts = circleActions(p, role);
  const eyebrow = `${CIRCLE_KIND_LABELS[p.kind]} · ${p.id.slice(0, 8).toUpperCase()}`;
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  // ── The post ─────────────────────────────────────────────────────────────
  const edit = () =>
    void openDialog({
      title: `Edit the ${CIRCLE_KIND_LABELS[p.kind].toLowerCase()}`,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, p.published ? 'Published: a change shows in the circle at once. Its kind never changes.' : 'Not published: nobody reads it yet. Its kind never changes.'),
      fields: circleFields(p.kind, circleFormValues(p.kind, p, ctx.now()), drops.items, models.items, segments),
      validate: (v) => circleProblem(p.kind, v) ?? (Object.keys(circleChange(p, v)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save post',
      submit: async (v) => {
        await ctx.api.updateCirclePost(p.id, circleChange(p, v));
      },
    }).then(done('Post saved.'));

  const publish = () =>
    void openDialog({
      title: 'Publish the post',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `It shows in the circle on /verify from now on, for ${audienceLine(p)}.`),
      confirmLabel: 'Publish',
      submit: async () => {
        await ctx.api.publishCirclePost(p.id);
      },
    }).then(done('Post published.'));

  const unpublish = () =>
    void openDialog({
      title: 'Withdraw the post',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'It leaves the circle at once: no member reads it any more. Its answers and votes are kept, and it can be published again.'),
      confirmLabel: 'Withdraw',
      submit: async () => {
        await ctx.api.unpublishCirclePost(p.id);
      },
    }).then(done('Post withdrawn.'));

  const links: Child[] = [];
  const rows: { label: string; value: Child; note?: string }[] = [
    { label: 'State', value: h('span', { data: { testid: 'circle-state' } }, stateMark(p)) },
    { label: 'Kind', value: CIRCLE_KIND_LABELS[p.kind] },
    { label: 'Read by', value: h('span', { data: { testid: 'circle-audience' } }, audienceLine(p)), note: p.segment ? 'Its members, read again at each visit' : undefined },
    { label: 'Published', value: p.publishedAt ? formatDateTime(p.publishedAt) : 'Not yet' },
    { label: 'Created', value: `${formatDateTime(p.createdAt)}${p.createdBy ? ` · ${p.createdBy.email}` : ''}` },
  ];
  if (p.kind === 'INVITATION') {
    rows.push(
      { label: 'Event', value: formatDateTime(p.eventAt), note: 'Answers close when it begins.' },
      { label: 'Place', value: p.eventPlace ?? '—' },
      { label: 'Places', value: p.capacity === null ? 'No limit' : formatCount(p.capacity) },
    );
  }
  if (p.kind === 'POLL') rows.push({ label: 'Options', value: h('span', { class: 'cell-details' }, (p.pollOptions ?? []).join(' · ')), note: p.results && p.results.total > 0 ? 'Votes are cast: the options no longer change.' : undefined });
  if (p.drop) links.push(h('span', { class: 'cell-sub' }, `Release: ${p.drop.title} · ${humanize(p.drop.state)}`));
  if (p.model) links.push(h('span', { class: 'cell-sub' }, `Model: ${humanize(p.model.name)} · ${humanize(p.model.type)} · ${p.model.lookbook === 'HIDDEN' ? 'hidden from the lookbook: no link shown' : humanize(p.model.lookbook)}`));
  if (p.externalUrl) links.push(h('a', { class: 'mono', attrs: { href: p.externalUrl, target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'circle-external' } }, p.externalUrl));
  rows.push({ label: 'Links', value: links.length ? h('span', null, ...links) : 'None' });
  if (p.published) rows.push({ label: 'Page', value: h('a', { class: 'mono', attrs: { href: circleAddress(p), target: '_blank', rel: 'noopener', 'data-testid': 'circle-page' } }, circleAddress(p)), note: 'A member signed in opens it.' });
  const tools = [
    acts.edit ? button('Edit', { kind: 'ghost', testId: 'circle-edit', onClick: edit }) : null,
    acts.publish ? button('Publish', { kind: 'primary', testId: 'circle-publish', onClick: publish }) : null,
    acts.unpublish ? button('Withdraw', { kind: 'ghost', testId: 'circle-unpublish', onClick: unpublish }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const post = section('Post', defList(rows), { id: 'post', tools });

  const text = section('Text', memberPreview(p.title, storyBlock(p.body, { className: 'sheet-preview__story', paragraphClass: 'prose sheet-preview__paragraph' }), 'circle-text'), { id: 'text' });

  // ── Photographs ──────────────────────────────────────────────────────────
  const defaultAlt = `${p.title}, photographed by ORBES`;
  const addPhoto = () =>
    void photoDialog({
      title: 'Photograph of the post',
      eyebrow,
      impact: `Shown on the post in the circle, in its order; the first one heads it in the feed. ${CIRCLE_LIMITS.photos - p.photos.length} of ${CIRCLE_LIMITS.photos} places left. Every photograph at /api/v1/media is public, as the result’s are.`,
      current: null,
      currentAlt: '',
      save: async (photo) => {
        await ctx.api.addCirclePhoto(p.id, photo);
      },
      remove: async () => {},
    }).then((r) => done('Photograph added.')(r));

  const arrange = (order: { sha256: string; alt: string }[], message: string) =>
    void ctx.api.arrangeCirclePhotos(p.id, order).then(
      () => done(message)(true),
      (e: unknown) => notifyError(e, 'The photographs could not be saved.'),
    );

  const editAlt = (g: CirclePhoto) =>
    void openDialog({
      title: 'Alternative text',
      eyebrow: `${eyebrow} · ${String(g.position).padStart(2, '0')}`,
      body: [h('p', { class: 'dialog__text' }, 'What the photograph shows, for a member who does not see it (a screen reader says it). Empty: the post says'), h('p', { class: 'dialog__text' }, defaultAlt)],
      fields: [{ name: 'alt', label: 'Alternative text', maxlength: CIRCLE_LIMITS.alt, value: g.alt ?? '' }],
      validate: (v) => (v.alt.trim() === (g.alt ?? '') ? 'Nothing has changed.' : null),
      confirmLabel: 'Save alternative text',
      submit: async (v) => {
        await ctx.api.arrangeCirclePhotos(p.id, galleryWithAlt(p.photos, g.sha256, v.alt));
      },
    }).then(done('Alternative text saved.'));

  const removePhoto = (g: CirclePhoto) =>
    void openDialog({
      title: 'Remove the photograph',
      eyebrow: `${eyebrow} · ${String(g.position).padStart(2, '0')}`,
      danger: true,
      body: h('p', { class: 'dialog__text' }, 'It leaves the post at once; the next ones move up. Used nowhere else, it is deleted.'),
      confirmLabel: 'Remove photograph',
      submit: async () => {
        await ctx.api.removeCirclePhoto(p.id, g.sha256);
      },
    }).then(done('Photograph removed.'));

  const sorted = [...p.photos].sort((a, b) => a.position - b.position);
  const items = sorted.map((g, i) =>
    h(
      'li',
      { class: 'gallery-edit__item', data: { testid: 'circle-photo', sha256: g.sha256 } },
      photoThumb(g.url, g.alt ?? defaultAlt, 'lg'),
      h('p', { class: 'gallery-edit__position' }, String(g.position).padStart(2, '0')),
      h('p', { class: ['gallery-edit__alt', g.alt ? null : 'gallery-edit__alt--default'] }, g.alt ?? `Default: ${defaultAlt}`),
      acts.photograph
        ? h(
            'div',
            { class: 'row-actions gallery-edit__actions' },
            button('Earlier', { kind: 'ghost', testId: 'circle-photo-earlier', disabled: i === 0, onClick: () => arrange(galleryMoved(p.photos, i, -1), 'Photographs saved.') }),
            button('Later', { kind: 'ghost', testId: 'circle-photo-later', disabled: i === sorted.length - 1, onClick: () => arrange(galleryMoved(p.photos, i, 1), 'Photographs saved.') }),
            button('Alt text', { kind: 'ghost', testId: 'circle-photo-alt', onClick: () => editAlt(g) }),
            button('Remove', { kind: 'ghost', testId: 'circle-photo-remove', onClick: () => removePhoto(g) }),
          )
        : null,
    ),
  );
  const full = p.photos.length >= CIRCLE_LIMITS.photos;
  const photos = section('Photographs', sorted.length ? h('ol', { class: 'gallery-edit', data: { testid: 'circle-photos' } }, ...items) : emptyState('No photograph yet.'), {
    id: 'photos',
    note: `${p.photos.length} of ${CIRCLE_LIMITS.photos}`,
    tools: acts.photograph ? [button(full ? 'Photographs full' : 'Add a photograph', { kind: 'ghost', testId: 'circle-photo-add', disabled: full, onClick: addPhoto })] : [],
  });

  // ── Answers (an invitation) and results (a poll) ─────────────────────────
  const extra: HTMLElement[] = [];
  if (p.kind === 'INVITATION' && answers) {
    const filter = select('answer', [{ value: '', label: 'All' }, ...CIRCLE_RSVP_ANSWERS.map((a) => ({ value: a, label: humanize(a) }))], answer ?? '');
    filter.addEventListener('change', () => ctx.setQuery({ answer: filter.value, page: undefined }));
    extra.push(
      section(
        'Answers',
        [
          filterBar(field('Answer', filter)),
          table<CircleAnswer>(
            [
              { label: 'Account', cell: (a) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: a.accountId }), 'data-testid': 'answer-account' } }, a.email), kind: ['wide'] },
              { label: 'Answer', cell: (a) => h('span', { data: { testid: 'answer-value' } }, statusMark(a.answer, toneOf('circleAnswer', a.answer))), kind: ['nowrap'] },
              { label: 'Answered', cell: (a) => formatDateTime(a.answeredAt), kind: ['nowrap'] },
            ],
            answers.items,
            { empty: answer ? 'No answer of this kind.' : 'No answer yet.', caption: 'Answers' },
          ),
          pager(answers, (n) => ctx.setQuery({ page: n })),
        ],
        { id: 'answers', note: answersLine(p) },
      ),
    );
  }
  if (p.kind === 'POLL') {
    const lines = pollResultLines(p);
    const most = Math.max(1, ...lines.map((l) => l.votes));
    extra.push(
      section(
        'Results',
        lines.length && (p.results?.total ?? 0) > 0
          ? barList(lines.map((l, i) => ({ key: String(i), label: l.option, value: l.votes, fraction: l.votes / most, share: l.share, tone: 'solid' as const })))
          : emptyState('No vote yet. Each owner votes once, and reads the results after voting.'),
        { id: 'results', note: `${formatCount(p.results?.total ?? 0)} ${p.results?.total === 1 ? 'vote' : 'votes'}` },
      ),
    );
  }

  return h(
    'div',
    { class: 'view view--circle' },
    pageHeader({
      eyebrow: 'Clients · Club · Circle',
      title: p.title,
      // A title may hold a figure: it is then set in the reading face, as a record's id is.
      identifier: /\d/.test(p.title),
      lead: circleLead(p),
      actions: [linkButton('All posts', href('club', {}, { tab: 'circle' }), 'ghost')],
    }),
    post,
    text,
    photos,
    ...extra,
  );
}
