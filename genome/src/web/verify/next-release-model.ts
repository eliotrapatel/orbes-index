/**
 * A model's next release (plan NOCTURNE, screen 5, step N6; C6): the plate row of its sheet, under its dots — the
 * release whose model is the sheet's or one of its variants: a LIVE RELEASE announced, its room open or live (the one
 * that opens first), else a draw open, soon open or in its early access (the one that opens first), as NOW chooses what
 * leads (a LIVE RELEASE before a draw). Its kind, then its variant and its day and hour, never a countdown:
 *
 *   ● LIVE RELEASE                                   ›
 *     IN BLUE, THURSDAY 21:00 PARIS
 *
 * A LIVE RELEASE says its time in Paris (its weekday within the coming six days, else its date: THURSDAY 22 OCTOBER ·
 * 21:00 PARIS); a draw says when its entries open or close, in UTC, as THE RELEASES do. A release whose model is not
 * named yet (its name's stage to come) has no model to match: none is said. Pure (no DOM) and unit-tested.
 */
import { LIVE, LOOKBOOK, NOW } from './copy.js';
import { PARIS, zonedTime } from './live-model.js';
import { drawLeads } from './nocturne-model.js';
import { isReleaseId, releaseCards, releasePath } from './releases-model.js';
import type { DropCard, LiveCard } from './types.js';
import { formatDateTime } from './view-model.js';

export interface NextReleaseModel {
  id: string;
  href: string;
  /** LIVE RELEASE, LIVE RELEASE · THE ROOM IS OPEN, LIVE RELEASE · LIVE NOW; DRAW · ENTRIES OPEN … */
  kind: string;
  /** `IN BLUE,` when the release names its variant; null otherwise. */
  variant: string | null;
  /** `THURSDAY 21:00 PARIS`, `ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC`: never parted. */
  when: string;
}

/** Within this, a LIVE RELEASE says its weekday alone (no weekday comes twice). */
const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

function liveRow(c: LiveCard, now: number): NextReleaseModel | null {
  const at = Date.parse(c.opensAt);
  const paris = zonedTime(at, PARIS);
  if (!paris) return null;
  const weekday = paris.day.split(' ')[0] ?? paris.day;
  const kind = c.phase === 'ROOM' ? `${LIVE.kind} · ${LIVE.phase.ROOM}` : c.phase === 'LIVE' ? `${LIVE.kind} · ${LIVE.phase.LIVE}` : LIVE.kind;
  const variant = typeof c.variant === 'string' && c.variant.trim() ? LOOKBOOK.next.variant(c.variant.trim()) : null;
  return { id: c.id, href: releasePath(c.id), kind, variant, when: Math.abs(at - now) < WEEK_MS ? LOOKBOOK.next.week(weekday, paris.time) : LIVE.paris(paris.day, paris.time) };
}

function drawRow(d: DropCard): NextReleaseModel | null {
  const card = releaseCards([d])[0];
  if (!card) return null;
  const soon = card.state === 'UPCOMING';
  const time = formatDateTime(soon ? d.opensAt : d.closesAt, 0);
  const label = d.model?.variant;
  return {
    id: card.id,
    href: card.href,
    kind: `${NOW.draw} · ${card.stateLabel}`,
    variant: typeof label === 'string' && label.trim() ? LOOKBOOK.next.variant(label.trim()) : null,
    when: soon ? LOOKBOOK.next.opens(time) : LOOKBOOK.next.closes(time),
  };
}

/**
 * The next release of a model and its variants (`slugs`, the addresses of their sheets), from THE RELEASES' lists, at
 * `now` (ms): the LIVE RELEASE that opens first, else the draw that opens first; null without one.
 */
export function nextRelease(slugs: readonly string[], live: readonly LiveCard[], drops: readonly DropCard[], now: number): NextReleaseModel | null {
  const mine = (slug: unknown) => typeof slug === 'string' && slugs.includes(slug);
  const found: { at: number; live: boolean; row: () => NextReleaseModel | null }[] = [];
  for (const c of live) {
    if (c?.kind !== 'LIVE' || !isReleaseId(c.id) || !(c.phase === 'ANNOUNCED' || c.phase === 'ROOM' || c.phase === 'LIVE') || !mine(c.lookbook)) continue;
    const at = Date.parse(c.opensAt);
    if (Number.isFinite(at)) found.push({ at, live: true, row: () => liveRow(c, now) });
  }
  for (const d of drops) {
    if (!isReleaseId(d?.id) || typeof d.title !== 'string' || !drawLeads(d) || !mine(d.model?.lookbook)) continue;
    const at = Date.parse(d.opensAt);
    if (Number.isFinite(at)) found.push({ at, live: false, row: () => drawRow(d) });
  }
  found.sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at);
  for (const f of found) {
    const row = f.row();
    if (row) return row;
  }
  return null;
}
