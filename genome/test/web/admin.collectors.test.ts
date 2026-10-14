/**
 * The Collectors page in the console (plan CUSTOMER INTELLIGENCE §3.6 C.6.1, C.13 « admin.collectors.test.ts »; step
 * 9.2's shell, the model's helpers with steps 9.9 and on): who reads it, where it is routed, its words.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLLECTORS_PAGE_COPY } from '../../src/web/admin/model/collectors.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { parseHash } from '../../src/web/admin/router.js';

describe('the Collectors page (§3.6 C.6.1)', () => {
  it('is read from AUDITOR; never by RETAIL nor LOGISTICS', () => {
    expect(CAPABILITY_MIN_ROLE.readCollectors).toBe('AUDITOR');
    for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(can(role, 'readCollectors'), role).toBe(false);
    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) expect(can(role, 'readCollectors'), role).toBe(true);
  });

  it('is routed at #/collectors, its query kept', () => {
    expect(parseHash('#/collectors?p=7d&c=FR')).toMatchObject({ name: 'collectors', query: { p: '7d', c: 'FR' } });
  });

  it('sits under Clients right after Owners in the sidebar', () => {
    const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/admin/main.ts'), 'utf8');
    const clients = main.slice(main.indexOf("group: 'Clients'"), main.indexOf("group: 'Security'"));
    const routes = [...clients.matchAll(/route: '(\w+)'/g)].map((m) => m[1]);
    expect(routes.slice(0, 4)).toEqual(['messages', 'owners', 'collectors', 'club']);
    expect(clients).toContain("{ route: 'collectors', label: 'Collectors', cap: 'readCollectors' }");
  });

  it('writes the plan’s header and notes, calmly', () => {
    expect(COLLECTORS_PAGE_COPY).toMatchObject({
      eyebrow: 'Clients',
      title: 'Collectors',
      lead: 'Who the collectors are, where they come from, what they like, the devices they use and how engaged they are, over the period you choose. Every figure opens its collectors. Test entrants and the team’s own accounts are left out.',
      growthTeam: 'GROWTH still counts the team’s accounts.',
      parisMonths: 'Months are Paris months; GROWTH counts UTC months.',
    });
    const words = JSON.stringify(COLLECTORS_PAGE_COPY);
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|craft|product/i);
  });
});
