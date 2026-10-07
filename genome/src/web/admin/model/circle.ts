/**
 * The Circle tab of the console's Club page (P-X01) — pure helpers, no DOM.
 *
 *  - A post's dialog by kind (a NOTE, an INVITATION, a POLL): its fields as
 *    the form holds them (the event's time as a `datetime-local` value read
 *    in UTC, the poll's options one per line), what the server would refuse
 *    before anything is sent (the bounds of services/circle.ts, the hosts of
 *    a link), the body of a new post, and the change of one.
 *  - Who may do what now: write, publish and withdraw (OPERATOR); an AUDITOR
 *    reads.
 *  - How the page says a post: its kind, the tiers that read it, its state,
 *    its answers and its poll's results.
 *
 * The server keeps every rule (CircleService): these only say a refusal
 * before it is asked for.
 */
import { formatCount, percent } from '../format.js';
import { CIRCLE_EXPERIENCES, type AdminRole, type CircleExperience, type CirclePost, type CirclePostChange, type CirclePostInput, type CirclePostKind, type CircleStats, type ClubProgram, type Drop, type Model } from '../types.js';
import { localUtc, utcInstant } from './club.js';
import type { BarRow } from './dashboard.js';
import { can } from './permissions.js';

/** The bounds the server holds a post to (services/circle.ts, media.ts CIRCLE_PHOTOS_MAX). */
export const CIRCLE_LIMITS = Object.freeze({
  title: 120,
  body: 6000,
  place: 200,
  capacity: 10_000,
  optionsMin: 2,
  optionsMax: 6,
  option: 40,
  url: 500,
  photos: 4,
  alt: 200,
});

/** Mirrors the server's CIRCLE_LINK_HOSTS (services/circle.ts): a link goes to one of them, or a subdomain. */
export const CIRCLE_LINK_HOSTS: readonly string[] = Object.freeze(['theorbes.com', 'youtube.com', 'vimeo.com']);

export const CIRCLE_KIND_LABELS: Readonly<Record<CirclePostKind, string>> = Object.freeze({ NOTE: 'Note', INVITATION: 'Invitation', POLL: 'Poll' });

/** What an invitation may be (BP-19 T7): an experience of the tier program, its tier set in THE PROGRAM. */
export const CIRCLE_EXPERIENCE_LABELS: Readonly<Record<CircleExperience, string>> = Object.freeze({
  MEMBERS_EVENING: 'Members’ evening',
  LAUNCH_PREVIEW: 'Launch preview',
  PARTNER_EXPERIENCE: 'Partner experience',
});

/** The Experience select of an invitation's dialog: None, then each experience. */
export const CIRCLE_EXPERIENCE_OPTIONS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '', label: 'None' },
  ...CIRCLE_EXPERIENCES.map((e) => ({ value: e, label: CIRCLE_EXPERIENCE_LABELS[e] })),
]);

/** The tier field's hint once an experience is chosen: the tier is THE PROGRAM's, locked. */
export const EXPERIENCE_TIER_HINT = 'Set in Club → Tiers, THE PROGRAM.';

/** The tier THE PROGRAM names for an experience (services/club-program.ts experienceTier). */
export function experienceTier(p: Pick<ClubProgram, 'experienceMembersEveningMinTier' | 'experienceLaunchPreviewMinTier' | 'experiencePartnerMinTier'>, e: CircleExperience): 1 | 2 | 3 {
  return e === 'MEMBERS_EVENING' ? p.experienceMembersEveningMinTier : e === 'LAUNCH_PREVIEW' ? p.experienceLaunchPreviewMinTier : p.experiencePartnerMinTier;
}

/** A post's kind as the list says it, its experience beside it: `Invitation · Members’ evening`. */
export function kindLine(p: Pick<CirclePost, 'kind' | 'experience'>): string {
  return p.experience ? `${CIRCLE_KIND_LABELS[p.kind]} · ${CIRCLE_EXPERIENCE_LABELS[p.experience]}` : CIRCLE_KIND_LABELS[p.kind];
}

/** The tiers a post reaches, by its lowest one. */
export const CIRCLE_TIER_OPTIONS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '1', label: 'Every owner (TITANE and up)' },
  { value: '2', label: 'PLATINE and PALLADIUM' },
  { value: '3', label: 'PALLADIUM only' },
]);

/** The tiers that read a post: `TITANE and up`, `PLATINE and up`, `PALLADIUM`. */
export function tierReach(minTier: number): string {
  return minTier >= 3 ? 'PALLADIUM' : minTier === 2 ? 'PLATINE and up' : 'TITANE and up';
}

/** Who reads a post: its tiers, and its segment when it names one (`TITANE and up · segment REGULARS`). */
export function audienceLine(p: Pick<CirclePost, 'minTier' | 'segment'>): string {
  return p.segment ? `${tierReach(p.minTier)} · segment ${p.segment.name}` : tierReach(p.minTier);
}

/** The page of a post on /verify (a member opens it there). */
export function circleAddress(p: Pick<CirclePost, 'id'>): string {
  return `/verify/circle/${p.id}`;
}

/** The dialog's values of a post: its own, or a new one's of `kind` (an invitation a week ahead at 19:00 UTC). */
export function circleFormValues(kind: CirclePostKind, p: CirclePost | null, now: Date): Record<string, string> {
  if (p) {
    return {
      title: p.title,
      body: p.body ?? '',
      minTier: String(p.minTier),
      eventAt: localUtc(p.eventAt),
      eventPlace: p.eventPlace ?? '',
      capacity: p.capacity === null ? '' : String(p.capacity),
      pollOptions: (p.pollOptions ?? []).join('\n'),
      dropId: p.drop?.id ?? '',
      modelId: p.model?.id ?? '',
      externalUrl: p.externalUrl ?? '',
      segmentId: p.segment?.id ?? '',
      experience: p.experience ?? '',
    };
  }
  const event = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7, 19));
  return {
    title: '',
    body: '',
    minTier: '1',
    eventAt: kind === 'INVITATION' ? localUtc(event.toISOString()) : '',
    eventPlace: '',
    capacity: '',
    pollOptions: '',
    dropId: '',
    modelId: '',
    externalUrl: '',
    segmentId: '',
    experience: '',
  };
}

/** The options typed one per line: blank lines dropped, each trimmed. */
export function pollOptionLines(text: string | undefined): string[] {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** What the server would refuse in a link, said before it is sent; null for none or an accepted one. */
export function circleLinkProblem(link: string | undefined): string | null {
  const s = (link ?? '').trim();
  if (s === '') return null;
  const refuse = `A link is an https address on ${CIRCLE_LINK_HOSTS.join(', ')} (or one of their subdomains).`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return refuse;
  }
  const host = url.hostname.toLowerCase();
  if (/\s/.test(s) || url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return refuse;
  if (!CIRCLE_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return refuse;
  if (url.href.length > CIRCLE_LIMITS.url) return `A link has at most ${CIRCLE_LIMITS.url} characters.`;
  return null;
}

const wholeNumber = (v: string | undefined): number | null => (/^\s*\d{1,6}\s*$/.test(v ?? '') ? Number(v) : null);

/** What the server would refuse in the dialog's values of a post of `kind`, said before anything is sent; null when they hold. */
export function circleProblem(kind: CirclePostKind, v: Record<string, string>): string | null {
  const title = (v.title ?? '').trim();
  if (!title) return 'Give the post a title.';
  if (title.length > CIRCLE_LIMITS.title) return `A title has at most ${CIRCLE_LIMITS.title} characters.`;
  if ((v.body ?? '').trim().length > CIRCLE_LIMITS.body) return `The text has at most ${CIRCLE_LIMITS.body} characters.`;
  if (!['1', '2', '3'].includes(v.minTier ?? '1')) return 'Choose the tiers that read it.';
  if (kind === 'INVITATION') {
    if (!utcInstant(v.eventAt)) return 'Use the date and time picker (UTC) for the event.';
    if ((v.eventPlace ?? '').trim().length > CIRCLE_LIMITS.place) return `The place has at most ${CIRCLE_LIMITS.place} characters.`;
    if ((v.capacity ?? '').trim() !== '') {
      const n = wholeNumber(v.capacity);
      if (n === null || n < 1 || n > CIRCLE_LIMITS.capacity) return `An invitation has 1 to ${formatCount(CIRCLE_LIMITS.capacity)} places, or none for no limit.`;
    }
  }
  if (kind === 'POLL') {
    const options = pollOptionLines(v.pollOptions);
    if (options.length < CIRCLE_LIMITS.optionsMin || options.length > CIRCLE_LIMITS.optionsMax) return `A poll has ${CIRCLE_LIMITS.optionsMin} to ${CIRCLE_LIMITS.optionsMax} options, one per line.`;
    if (options.some((o) => o.length > CIRCLE_LIMITS.option)) return `An option has at most ${CIRCLE_LIMITS.option} characters.`;
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return 'Each option of a poll is different.';
  }
  return circleLinkProblem(v.externalUrl);
}

/** The body of a new post (POST /api/admin/circle/posts), from values circleProblem accepted: the fields of its kind only. */
export function circleInput(kind: CirclePostKind, v: Record<string, string>): CirclePostInput {
  const body = (v.body ?? '').trim();
  const link = (v.externalUrl ?? '').trim();
  const out: CirclePostInput = {
    kind,
    title: v.title.trim(),
    body: body === '' ? null : body,
    minTier: Number(v.minTier ?? '1'),
    dropId: v.dropId ? v.dropId : null,
    modelId: v.modelId ? v.modelId : null,
    externalUrl: link === '' ? null : link,
    ...(v.segmentId ? { segmentId: v.segmentId } : {}),
  };
  if (kind === 'INVITATION') {
    out.experience = (CIRCLE_EXPERIENCES as readonly string[]).includes(v.experience ?? '') ? (v.experience as CircleExperience) : null;
    out.eventAt = utcInstant(v.eventAt);
    out.eventPlace = (v.eventPlace ?? '').trim() === '' ? null : v.eventPlace.trim();
    out.capacity = (v.capacity ?? '').trim() === '' ? null : Number(v.capacity);
  }
  if (kind === 'POLL') out.pollOptions = pollOptionLines(v.pollOptions);
  return out;
}

/** The fields of a post that differ from the dialog's values (PATCH /api/admin/circle/posts/:id); {} when nothing changed. */
export function circleChange(p: CirclePost, v: Record<string, string>): CirclePostChange {
  const next = circleInput(p.kind, v);
  const out: CirclePostChange = {};
  if (next.title !== p.title) out.title = next.title;
  if ((next.body ?? null) !== (p.body ?? null)) out.body = next.body ?? null;
  if (next.minTier !== p.minTier) out.minTier = next.minTier;
  if (p.kind === 'INVITATION') {
    if ((next.experience ?? null) !== (p.experience ?? null)) out.experience = next.experience ?? null;
    // An experience's tier is THE PROGRAM's: the server sets it, whatever is sent.
    if (next.experience) delete out.minTier;
    if (next.eventAt && Date.parse(next.eventAt) !== Date.parse(p.eventAt ?? '')) out.eventAt = next.eventAt;
    if ((next.eventPlace ?? null) !== p.eventPlace) out.eventPlace = next.eventPlace ?? null;
    if ((next.capacity ?? null) !== p.capacity) out.capacity = next.capacity ?? null;
  }
  if (p.kind === 'POLL' && JSON.stringify(next.pollOptions ?? []) !== JSON.stringify(p.pollOptions ?? [])) out.pollOptions = next.pollOptions ?? [];
  if ((next.dropId ?? null) !== (p.drop?.id ?? null)) out.dropId = next.dropId ?? null;
  if ((next.modelId ?? null) !== (p.model?.id ?? null)) out.modelId = next.modelId ?? null;
  if ((next.externalUrl ?? null) !== p.externalUrl) out.externalUrl = next.externalUrl ?? null;
  if ((next.segmentId ?? null) !== (p.segment?.id ?? null)) out.segmentId = next.segmentId ?? null;
  return out;
}

/** The releases a post may link: every one but a cancelled one, the post's own kept. */
export function linkableDrops(drops: readonly Drop[], current: string | null): { value: string; label: string }[] {
  return drops.filter((d) => d.state !== 'CANCELLED' || d.id === current).map((d) => ({ value: d.id, label: d.state === 'DRAFT' ? `${d.title} (draft: no link until published)` : d.title }));
}

/** The models a post may link: those shown in the lookbook (a hidden one has no sheet), the post's own kept. */
export function linkableModels(models: readonly Model[], current: string | null): { value: string; label: string }[] {
  return models
    .filter((m) => m.lookbook !== 'HIDDEN' || m.id === current)
    .map((m) => ({ value: m.id, label: `${[m.name, m.type, m.variantLabel].filter((x): x is string => !!x).join(' · ')}${m.lookbook === 'HIDDEN' ? ' (hidden: no link)' : m.lookbook === 'RESERVED' ? ' (reserved)' : ''}` }));
}

export interface CircleActions {
  /** Change any field but the kind. */
  edit: boolean;
  publish: boolean;
  unpublish: boolean;
  /** Add, order, describe and remove its photographs. */
  photograph: boolean;
}

/** What `role` may do to the post now (the server checks again; this only hides what would be refused). */
export function circleActions(p: Pick<CirclePost, 'published'>, role: AdminRole | null | undefined): CircleActions {
  const manage = can(role, 'manageCircle');
  return { edit: manage, publish: manage && !p.published, unpublish: manage && p.published, photograph: manage };
}

/** One line under the page's title: what the post is now, and for whom. */
export function circleLead(p: CirclePost): string {
  const tiers = p.minTier >= 3 ? 'the PALLADIUM owners' : p.minTier === 2 ? 'the PLATINE and PALLADIUM owners' : 'every owner of an ORBES piece';
  const reach = p.segment ? `${tiers} who belong to the segment ${p.segment.name}` : tiers;
  if (!p.published) return `Not in the circle: nobody reads it on /verify. Once published, ${reach} read it.`;
  return `In the circle on /verify: ${reach} read it.`;
}

/** A poll's results as the page lists them: each option, its votes and its share. */
export function pollResultLines(p: Pick<CirclePost, 'pollOptions' | 'results'>): { option: string; votes: number; share: string }[] {
  const options = p.pollOptions ?? [];
  const counts = p.results?.counts ?? [];
  const total = p.results?.total ?? 0;
  return options.map((option, i) => ({ option, votes: counts[i] ?? 0, share: percent(counts[i] ?? 0, total) }));
}

/** The answers of an invitation in one line: `2 YES · 1 NO · 18 PLACES LEFT`. */
export function answersLine(p: Pick<CirclePost, 'answers' | 'capacity'>): string {
  const yes = p.answers.YES ?? 0;
  const parts = [`${formatCount(yes)} yes`, `${formatCount(p.answers.NO ?? 0)} no`];
  if (p.capacity !== null) parts.push(`${formatCount(Math.max(0, p.capacity - yes))} of ${formatCount(p.capacity)} places left`);
  return parts.join(' · ');
}

// ── The panel The Circle of Analytics ──────────────────────────────────────

/** The members of the club by tier now, as hairline bars: TITANE, PLATINE, PALLADIUM, each with its share. */
export function circleMemberBars(s: Pick<CircleStats, 'members'>): BarRow[] {
  const tiers = ['TITANE', 'PLATINE', 'PALLADIUM'] as const;
  const most = Math.max(1, ...tiers.map((t) => s.members[t]));
  return tiers.map((t) => ({ key: t, label: t, value: s.members[t], fraction: s.members[t] / most, share: percent(s.members[t], s.members.total), tone: 'solid' }));
}

/** The days of the window the circle was visited, the latest first. */
export function circleVisitDays(s: Pick<CircleStats, 'visits'>): { day: string; visits: number }[] {
  return s.visits.daily.filter((d) => d.visits > 0).reverse();
}
