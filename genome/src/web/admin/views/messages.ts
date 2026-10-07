/**
 * The Messages board (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; `#/messages`), the first item of Clients: one
 * conversation per client. Clients write from the app (WRITE TO ORBES CLIENT SERVICES); the answers appear in their
 * account, under MESSAGES. No email is sent, and no answer time is promised anywhere.
 *
 * Filters: To answer (n) · Answered · Closed · All; Everyone · Mine · Unassigned; a search by the client's email or a
 * scan's REF. Columns: the priority (`Priority · PALLADIUM` or `Priority · PLATINE`, the tier read now), the client (its
 * sheet; the email masked for an AUDITOR), what the messages concern (the latest, then `+N more`; a link to its page),
 * the last message's excerpt, the waiting time, the status and who answers. A client's open yearly care (BP-19 T6) adds
 * `Yearly care · O26-J-00184` under what the messages concern, a link to its request. The server orders the rows: To answer first,
 * PALLADIUM, then PLATINE, then the rest, the longest waiting first; then the others, newest first. Each row opens its
 * conversation (views/conversation.ts).
 */
import { h } from '../../shared/dom.js';
import { formatAge, formatDateTime } from '../format.js';
import {
  BOARD_EMPTY,
  BOARD_LEAD,
  boardFilters,
  boardQuery,
  concernsHref,
  concernsText,
  moreText,
  priorityTag,
  STATUS_FILTERS,
  STATUS_LABELS,
  statusFilterLabel,
  WHO_FILTERS,
} from '../model/messages.js';
import { careHref, careLinkText } from '../model/care.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { ConversationRow } from '../types.js';
import { button, field, filterBar, input, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

/** The concerns cell: the latest place (a link to its page when it has one), then `+N more`. */
export function concernsCell(c: ConversationRow['concerns'], more = 0): HTMLElement {
  const link = c ? concernsHref(c) : null;
  const text = concernsText(c);
  const extra = moreText(more);
  return h(
    'span',
    { attrs: { 'data-testid': 'conversation-concerns' } },
    link ? h('a', { class: 'idlink', attrs: { href: link } }, text) : h('span', null, text),
    extra ? h('span', { class: 'cell-sub' }, extra) : null,
  );
}

/**
 * The client's open yearly care (BP-19 T6): `Yearly care · O26-J-00184`, a link to its page on the Yearly care board.
 * It changes neither the conversation's status nor its place in the order.
 */
export function careLink(care: NonNullable<ConversationRow['care']>): HTMLElement {
  return h('a', { class: 'idlink cell-sub', attrs: { href: careHref(care), 'data-testid': 'conversation-care' } }, careLinkText(care));
}

export async function messagesView(ctx: ViewContext): Promise<HTMLElement> {
  const f = boardFilters(ctx.route.query);
  const list = await ctx.api.messages(boardQuery(f, pageParam(ctx)));

  const status = select('status', STATUS_FILTERS.map((s) => ({ value: s.value, label: statusFilterLabel(s.value, list.toAnswer) })), f.status);
  status.addEventListener('change', () => ctx.setQuery({ status: status.value === 'TO_ANSWER' ? undefined : status.value, page: undefined }));
  const who = select('who', WHO_FILTERS.map((w) => ({ value: w.value, label: w.label })), f.who);
  who.addEventListener('change', () => ctx.setQuery({ who: who.value, page: undefined }));
  const search = input('q', { value: f.q, placeholder: 'Client email or REF', maxlength: 254 });
  const find = h(
    'form',
    { class: 'filters__form', attrs: { role: 'search', 'data-testid': 'messages-search' } },
    filterBar(field('Search', search), field('Status', status), field('Answering', who), button('Search', { kind: 'secondary', type: 'submit' })),
  );
  find.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ q: search.value.trim(), page: undefined });
  });

  return h(
    'div',
    { class: 'view view--messages' },
    pageHeader({ eyebrow: 'Clients', title: 'Messages', lead: BOARD_LEAD }),
    find,
    section(
      'Conversations',
      [
        table<ConversationRow>(
          [
            {
              label: 'Priority',
              cell: (r) => {
                const tag = priorityTag(r.priority);
                return tag ? h('span', { class: 'messages__priority', attrs: { 'data-testid': 'conversation-priority' } }, tag) : '';
              },
              kind: ['nowrap'],
            },
            {
              label: 'Client',
              cell: (r) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: r.account.id }), 'data-testid': 'conversation-client' } }, r.account.email),
              kind: ['nowrap'],
            },
            { label: 'Concerns', cell: (r) => (r.care ? h('span', null, concernsCell(r.concerns, r.moreConcerns), careLink(r.care)) : concernsCell(r.concerns, r.moreConcerns)) },
            {
              label: 'Last message',
              cell: (r) =>
                h('span', null, h('span', { attrs: { 'data-testid': 'conversation-excerpt' } }, r.lastMessage.excerpt), h('span', { class: 'cell-sub' }, `${r.lastMessage.author === 'STAFF' ? 'Answer' : 'Client'} · ${formatDateTime(r.lastMessage.at)}`)),
              kind: ['wide'],
            },
            { label: 'Waiting since', cell: (r) => (r.waitingSince ? h('span', { attrs: { title: formatDateTime(r.waitingSince) } }, formatAge(r.waitingSince, ctx.now())) : '—'), kind: ['nowrap'] },
            { label: 'Status', cell: (r) => statusMark(STATUS_LABELS[r.status], toneOf('conversation', r.status)), kind: ['nowrap'] },
            { label: 'Answering', cell: (r) => r.answeredBy?.email ?? '—', kind: ['nowrap'] },
          ],
          list.items,
          { empty: BOARD_EMPTY, onRow: (r) => href('conversation', { conversationId: r.id }), caption: 'Conversations' },
        ),
        pager(list, (p) => ctx.setQuery({ page: p })),
      ],
      { id: 'messages' },
    ),
  );
}
