/**
 * The Collectors page's words (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6.1, §3.0 (d), (e); step 9.2): the page
 * under Clients, after Owners, read from AUDITOR (`readCollectors`). Its controls, panels and comparisons come with
 * steps 9.9 and 9.10. Pure: no DOM; every word here is checked by admin.brand.test.ts.
 */

export const COLLECTORS_PAGE_COPY = Object.freeze({
  eyebrow: 'Clients',
  title: 'Collectors',
  lead: 'Who the collectors are, where they come from, what they like, the devices they use and how engaged they are, over the period you choose. Every figure opens its collectors. Test entrants and the team’s own accounts are left out.',
  /** §3.0 (d): GROWTH is unchanged. */
  growthTeam: 'GROWTH still counts the team’s accounts.',
  /** §3.0 (e): the page counts Paris months. */
  parisMonths: 'Months are Paris months; GROWTH counts UTC months.',
});
