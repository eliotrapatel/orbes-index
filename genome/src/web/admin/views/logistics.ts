/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.3, `#/logistics`): the page of a LOGISTICS login, a person at the
 * logistics agent, and its only one (`logisticsOnly`: any other address leads back here). Its tabs (To ship,
 * Receptions, Stock, Returns, Corrections) and ORBES staff's view of it come with step 5.11, where it takes the Atelier's
 * place in the sidebar; until then it holds its header.
 */
import { h } from '../../shared/dom.js';
import { pageHeader } from '../ui/components.js';
import type { ViewContext } from './context.js';

/** The page's lead (plan NEXT LOT §3.5.3). */
export const LOGISTICS_LEAD =
  'The stock of every model, variant and size at each location, the receptions from the suppliers, and the orders to ship. The agent counts what arrives and ships; ORBES confirms each reception, which gives every piece its ORBES identity and its card.';

export async function logisticsView(_ctx: ViewContext): Promise<HTMLElement> {
  return h('div', { class: 'view view--logistics', data: { testid: 'logistics' } }, pageHeader({ eyebrow: 'Registry', title: 'Logistics', lead: LOGISTICS_LEAD }));
}
