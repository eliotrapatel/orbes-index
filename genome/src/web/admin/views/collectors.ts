/**
 * The Collectors page, `#/collectors` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6.1; step 9.2): the page's shell
 * under Clients, after Owners, for AUDITOR and up (`readCollectors`). Its header and its notes; the controls and the
 * panels (GET /api/admin/collectors/report) come with steps 9.9 and 9.10.
 */
import { h } from '../../shared/dom.js';
import { COLLECTORS_PAGE_COPY as C } from '../model/collectors.js';
import { pageHeader } from '../ui/components.js';
import type { ViewContext } from './context.js';

export async function collectorsView(_ctx: ViewContext): Promise<HTMLElement> {
  return h(
    'div',
    { class: 'view view--collectors', data: { testid: 'collectors' } },
    pageHeader({ eyebrow: C.eyebrow, title: C.title, lead: C.lead }),
    h('p', { class: 'footnote' }, `${C.growthTeam} ${C.parisMonths}`),
  );
}
