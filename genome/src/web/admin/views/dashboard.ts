/**
 * Dashboard (master spec §21): the registry at a glance. Four figures,
 * products by lifecycle status and open anomalies by severity as hairline
 * bars, the signing key in force and the latest verification events.
 */
import { h } from '../../shared/dom.js';
import { formatAge, formatDateTime, humanize } from '../format.js';
import { dashboardKpis, severityBars, statusBars } from '../model/dashboard.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { barList, defList, kpi, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import type { ViewContext } from './context.js';

export async function dashboardView(ctx: ViewContext): Promise<HTMLElement> {
  const d = await ctx.api.dashboard();
  const now = ctx.now();

  const figures = h('div', { class: 'kpis' }, ...dashboardKpis(d).map((k) => kpi(k.label, k.value, k.note, k.tone)));

  const products = section('Products by status', barList(statusBars(d.products.byStatus), { link: (r) => href('products', {}, { status: r.key }) }), {
    note: `${d.products.total} total`,
    tools: [linkButton('All products', href('products'), 'ghost')],
  });

  const anomalies = section('Open anomalies', barList(severityBars(d.anomalies.openBySeverity), { link: (r) => href('anomalies', {}, { status: 'OPEN', severity: r.key }) }), {
    note: 'Open and acknowledged',
    tools: [linkButton('Triage', href('anomalies', {}, { status: 'OPEN' }), 'ghost')],
  });

  const key = section(
    'Signing key',
    d.activeKey
      ? defList([
          { label: 'Key id', value: mono(`#${d.activeKey.keyId}`) },
          { label: 'Kid', value: mono(d.activeKey.kid) },
          { label: 'Algorithm', value: 'ED25519' },
          { label: 'Active since', value: formatDateTime(d.activeKey.activatedAt) },
        ])
      : h('p', { class: 'critical-text' }, 'No active signing key. Issuance is halted until a key is rotated in.'),
    { tools: [linkButton('Keys', href('keys'), 'ghost')] },
  );

  const recent = section(
    'Recent verification events',
    table(
      [
        { label: 'When', cell: (r) => h('span', { attrs: { title: formatDateTime(r.occurredAt, { seconds: true }) } }, formatAge(r.occurredAt, now)), kind: ['nowrap'] },
        { label: 'Product', cell: (r) => (r.productId ? h('a', { class: 'idlink', attrs: { href: productHref(r.productId) } }, r.productId) : h('span', { class: 'soft' }, 'Unregistered')) },
        { label: 'Event', cell: (r) => humanize(r.eventType) },
        { label: 'Result', cell: (r) => statusMark(humanize(r.state), toneOf('verification', r.state)), kind: ['wide'] },
        { label: 'Country', cell: (r) => r.country ?? '—', kind: ['nowrap'] },
      ],
      d.recentEvents,
      { empty: 'No verification yet.', onRow: (r) => (r.productId ? productHref(r.productId) : null), caption: 'Recent verification events' },
    ),
    { tools: [linkButton('All events', href('scans'), 'ghost')] },
  );

  return h(
    'div',
    { class: 'view view--dashboard' },
    pageHeader({
      eyebrow: 'Overview',
      title: 'Dashboard',
      lead: `Registry state at ${formatDateTime(d.generatedAt)}`,
      actions: can(ctx.session.admin.role, 'issue') ? [linkButton('Issue a product', href('generator'), 'primary')] : [],
    }),
    figures,
    h('div', { class: 'grid grid--dash' }, products, h('div', { class: 'stack' }, anomalies, key)),
    recent,
  );
}
