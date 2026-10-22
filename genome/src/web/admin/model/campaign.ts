/**
 * The CAMPAIGN tab of a release (plan MACRO M1 §2.2, scope C2 and C3), shared by the draw's page (views/drop.ts) and the
 * LIVE RELEASE's (views/live.ts) — pure helpers, no DOM: the words, the page's tab from its address, the Links rows (one
 * per channel, or per link of it), the readout's rows, and the countdown image's words for TEASER and FULL.
 *
 *  - The tabs: RELEASE (the page as it was) and CAMPAIGN (`?tab=campaign`); an after-room has no campaign of its own.
 *  - MAKE THE LINKS (OPERATOR) once the release is published and not cancelled, while a channel has no active link.
 *  - The countdown image is made for ORBES's own accounts, never a collector's share card (K53 is NO): TEASER by default
 *    (the monogram, the date and time in Paris, « A RELEASE »: no photograph, no name, while the house names no piece in
 *    public), FULL (the model's photograph, its name and the date) only once the release's name and photograph are
 *    public. The choice is made on the tab, per release, and nothing is stored.
 *  - A set's release (macro scope K44 T1, plan MACRO M3 §5.3): its tab as a model's; its FULL image draws its pieces'
 *    photographs side by side (two to four tiles in the photo square, ui/countdown-card.ts) with the set's name, and
 *    falls back to TEASER while any piece's photograph is missing.
 *  - Every time in Paris. Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { formatCount } from '../format.js';
import { href } from '../router.js';
import type { CampaignChannel, CampaignFigures, CampaignStage, HouseCurrency, LinkReturn, LinkView, ReleaseCampaign } from '../types.js';
import { money } from './growth.js';
import { ratioText } from './links.js';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CAMPAIGN_COPY = Object.freeze({
  tabs: 'Release',
  tabRelease: 'Release',
  tabCampaign: 'Campaign',
  links: 'Links',
  linksNote: 'One tracked link per channel, each to the release’s page',
  makeLinks: 'Make the links',
  making: 'Making…',
  made: (n: number) => (n === 1 ? 'One link made.' : `${formatCount(n)} links made.`),
  noneMade: 'Every channel already has its link.',
  noLink: 'No link yet',
  noActiveLink: 'No active link',
  archived: 'ARCHIVED',
  copy: 'Copy',
  costOnLink: 'Cost is set on each link’s page.',
  draft: 'Publish the release before making its links: a link goes to a published release only.',
  cancelled: 'A cancelled release takes no new link. Its links keep working where they are posted.',
  allCovered: 'Every channel has its link.',
  noChannel: 'No channel yet. Add the channels on the Links page.',
  channel: 'Channel',
  link: 'Link',
  cost: 'Cost',
  image: 'Countdown image',
  imageNote: '1080 × 1920 · for ORBES’s own accounts',
  teaser: 'Teaser',
  full: 'Full',
  choice: 'Image',
  teaserLine: 'The monogram, the date and time in Paris and « A RELEASE ». No photograph, no name.',
  fullLine: 'The model’s photograph, its name, the date and time in Paris.',
  fullSetLine: 'The pieces’ photographs side by side, the set’s name, the date and time in Paris.',
  fullSetNoPhoto: 'FULL needs each piece’s photograph: add it on each model’s page.',
  fullLater: (when: string) => `FULL can be chosen once the release’s name and photograph are public: ${when}.`,
  fullNotPublished: 'FULL can be chosen once the release is published and its name and photograph are public.',
  fullNoPhoto: 'FULL needs the model’s photograph: add it on the model’s page.',
  fullCancelled: 'A cancelled release has no FULL image.',
  download: 'Download',
  drawing: 'Drawing the image…',
  drawFailed: 'The image could not be drawn in this browser.',
  previewAlt: (kind: CountdownKind) => (kind === 'teaser' ? 'The countdown image, TEASER' : 'The countdown image, FULL'),
  readout: 'Readout',
  readoutNote: 'Last link · counted collectors only',
  upcoming: 'Figures appear once entries open.',
  stage: { UPCOMING: 'Upcoming', SO_FAR: 'So far', FINAL: 'Final' } as Readonly<Record<CampaignStage, string>>,
  entries: 'Entries',
  buyers: 'Buyers',
  revenue: 'Revenue',
  returns: 'Return',
  other: 'OTHER SOURCES',
  otherSub: 'Other links, campaign tags, sites, direct, before tracking',
  total: 'TOTAL',
  notIn: (c: HouseCurrency) => `Not in ${c}`,
  loading: 'Reading the campaign',
  failed: 'The campaign could not be read.',
  tryAgain: 'Try again',
});

// ── The tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const RELEASE_TABS = ['release', 'campaign'] as const;
export type ReleaseTab = (typeof RELEASE_TABS)[number];

/** The page's tab from its address: CAMPAIGN only when asked, RELEASE otherwise. */
export function releaseTab(query: Readonly<Record<string, string | undefined>>): ReleaseTab {
  return query.tab === 'campaign' ? 'campaign' : 'release';
}

/** A tab's address on the draw's page (`drop`) or the LIVE RELEASE's (`liveRelease`). */
export function releaseTabHref(page: 'drop' | 'liveRelease', dropId: string, tab: ReleaseTab): string {
  return href(page, { dropId }, tab === 'campaign' ? { tab: 'campaign' } : {});
}

// ── Links ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One row of the Links table: a channel's link, or the channel without one. */
export interface CampaignLinkLine {
  key: string;
  /** The channel's name on its first row only. */
  channel: string | null;
  /** The channel has links, all archived (shown under its name). */
  uncovered: boolean;
  link: LinkView | null;
}

/** The Links rows: per channel in its order, each of its links (the active ones first), or one row « No link yet ». */
export function campaignLinkLines(channels: readonly CampaignChannel[]): CampaignLinkLine[] {
  const out: CampaignLinkLine[] = [];
  for (const c of channels) {
    if (c.links.length === 0) {
      out.push({ key: `${c.id}:none`, channel: c.name, uncovered: false, link: null });
      continue;
    }
    const ordered = [...c.links.filter((l) => l.archivedAt === null), ...c.links.filter((l) => l.archivedAt !== null)];
    ordered.forEach((l, i) => out.push({ key: `${c.id}:${l.id}`, channel: i === 0 ? c.name : null, uncovered: i === 0 && !c.covered, link: l }));
  }
  return out;
}

/** What MAKE THE LINKS can do now: offered (OPERATOR, published, not cancelled, a channel without a link), or why not. */
export function makeLinksState(c: Pick<ReleaseCampaign, 'release' | 'missing' | 'channels'>, canManage: boolean): { offer: boolean; line: string | null } {
  if (c.channels.length === 0) return { offer: false, line: CAMPAIGN_COPY.noChannel };
  if (c.release.cancelled) return { offer: false, line: CAMPAIGN_COPY.cancelled };
  if (!c.release.published) return { offer: false, line: canManage ? CAMPAIGN_COPY.draft : null };
  if (c.missing.length === 0) return { offer: false, line: CAMPAIGN_COPY.allCovered };
  return { offer: canManage, line: null };
}

/** A link's cost as the tables write it: `€ 100`, '—' without one. */
export function costCell(link: Pick<LinkView, 'cost'>): string {
  return link.cost ? money(link.cost.minor, link.cost.currency) : '—';
}

// ── The readout ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReadoutRow {
  key: string;
  kind: 'link' | 'other' | 'total';
  name: string;
  sub: string | null;
  linkId: string | null;
  entries: string;
  buyers: string;
  revenue: string;
  cost: string;
  returns: string;
  /** Under the return: « Revenue € 480 for € 100 ». */
  returnsSub: string | null;
}

/** RETURN: '—' without a cost, « Not in EUR » when the link's cost is in another currency, `×4.8` otherwise. */
export function readoutReturn(link: Pick<LinkView, 'cost'>, r: LinkReturn | null, currency: HouseCurrency): { text: string; sub: string | null } {
  if (!link.cost) return { text: '—', sub: null };
  if (link.cost.currency !== currency || !r) return { text: CAMPAIGN_COPY.notIn(currency), sub: null };
  return { text: r.ratio === null ? '—' : ratioText(r.ratio), sub: `${CAMPAIGN_COPY.revenue} ${money(r.revenueMinor, r.currency)} for ${money(r.costMinor, r.currency)}` };
}

const figures = (f: CampaignFigures, currency: HouseCurrency) => ({ entries: formatCount(f.entries), buyers: formatCount(f.buyers), revenue: money(f.revenueMinor, currency) });

/** The readout's rows: each of the release's links, then OTHER SOURCES, then the TOTAL; none before its first entry. */
export function readoutRows(c: Pick<ReleaseCampaign, 'readout'>): ReadoutRow[] {
  const r = c.readout;
  if (r.stage === 'UPCOMING') return [];
  const rows: ReadoutRow[] = r.links.map((x) => {
    const ret = readoutReturn(x.link, x.returns, r.currency);
    return {
      key: `link:${x.link.id}`,
      kind: 'link',
      name: x.link.name,
      sub: `${x.link.channel.name}${x.link.archivedAt ? ` · ${CAMPAIGN_COPY.archived}` : ''}`,
      linkId: x.link.id,
      ...figures(x.figures, r.currency),
      cost: costCell(x.link),
      returns: ret.text,
      returnsSub: ret.sub,
    };
  });
  rows.push({ key: 'other', kind: 'other', name: CAMPAIGN_COPY.other, sub: CAMPAIGN_COPY.otherSub, linkId: null, ...figures(r.other, r.currency), cost: '', returns: '', returnsSub: null });
  rows.push({ key: 'total', kind: 'total', name: CAMPAIGN_COPY.total, sub: null, linkId: null, ...figures(r.total, r.currency), cost: '', returns: '', returnsSub: null });
  return rows;
}

/** The readout's note: its stage, and how it counts. */
export function readoutNote(stage: CampaignStage): string {
  return stage === 'UPCOMING' ? CAMPAIGN_COPY.readoutNote : `${CAMPAIGN_COPY.stage[stage]} · ${CAMPAIGN_COPY.readoutNote}`;
}

export const linkPageHref = (id: string): string => href('link', { linkId: id });

// ── The countdown image (C3) ─────────────────────────────────────────────────────────────────────────────────────

export const COUNTDOWN_KINDS = ['teaser', 'full'] as const;
export type CountdownKind = (typeof COUNTDOWN_KINDS)[number];

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** An instant's day and time in Paris: `5 NOVEMBER 2026`, `20:00`, and `2026-11-05` for the file's name; null when unreadable. */
export function parisMoment(at: string | Date | null | undefined): { date: string; time: string; day: string } | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  const month = Number(p.month);
  return {
    date: `${Number(p.day)} ${MONTHS[month - 1]} ${p.year}`,
    time: `${p.hour}:${p.minute}`,
    day: `${p.year}-${String(month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
  };
}

/** What the FULL image needs to know of the release: whether and from when its name and photograph are public. */
export interface CountdownRelease {
  mode: 'DRAW' | 'LIVE';
  /** T0 of a LIVE RELEASE, the opening of a draw's entries. */
  opensAt: string;
  published: boolean;
  cancelled: boolean;
  /** When the release's name and photograph are both public (a draw's: its publication; a LIVE RELEASE's: the later of its NAME and PHOTO stages); null while unknown (a draft). */
  publicAt: string | null;
  /** The model's name with its variant (MONOLITHE · Blue → MONOLITHE IN BLUE) and its photograph (this origin's media route). */
  model: { name: string; variant: string | null; photo: string | null };
  /**
   * Macro scope K44 T1: a set's release, its 2 to 4 pieces in the set's order, each its photograph (`model` is then the
   * set: its name, no variant, no photograph of its own); absent for a model's.
   */
  pieces?: { name: string; variant: string | null; photo: string | null }[];
}

/** The release the CAMPAIGN tab draws, completed by its campaign's offer: a set's name and its pieces' photographs. */
export function withOffer(r: CountdownRelease, offer: ReleaseCampaign['offer']): CountdownRelease {
  if (!offer || offer.kind !== 'SET') return r;
  return { ...r, model: { name: offer.name, variant: null, photo: null }, pieces: offer.pieces.map((p) => ({ name: p.name, variant: p.variant, photo: p.photo })) };
}

/** The photographs FULL draws: a set's every piece's, a model's own. */
export function countdownPhotos(r: Pick<CountdownRelease, 'model' | 'pieces'>): (string | null)[] {
  return r.pieces ? r.pieces.map((p) => p.photo) : [r.model.photo];
}

/** The media route of this origin only: a canvas never draws another origin's photograph. */
export const MEDIA_PATH = /^\/api\/v1\/media\/[0-9a-f]{64}$/;

/** Whether FULL can be chosen now, and why not. */
export function fullChoice(r: CountdownRelease, now: Date): { available: boolean; line: string } {
  if (r.cancelled) return { available: false, line: CAMPAIGN_COPY.fullCancelled };
  if (!r.published || !r.publicAt) return { available: false, line: CAMPAIGN_COPY.fullNotPublished };
  if (Date.parse(r.publicAt) > now.getTime()) {
    const m = parisMoment(r.publicAt);
    return { available: false, line: CAMPAIGN_COPY.fullLater(m ? `${m.date} · ${m.time} Paris` : '—') };
  }
  const set = r.pieces !== undefined;
  if (set && (r.pieces!.length < 2 || r.pieces!.some((p) => !p.photo || !MEDIA_PATH.test(p.photo) || !p.name.trim()))) return { available: false, line: CAMPAIGN_COPY.fullSetNoPhoto };
  if (!set && (!r.model.photo || !MEDIA_PATH.test(r.model.photo))) return { available: false, line: CAMPAIGN_COPY.fullNoPhoto };
  return { available: true, line: set ? CAMPAIGN_COPY.fullSetLine : CAMPAIGN_COPY.fullLine };
}

/** The image's words and photograph: nothing else is drawn. */
export interface CountdownCardModel {
  kind: CountdownKind;
  /** The boxed label: « A RELEASE » (TEASER), LIVE RELEASE or DRAW (FULL). */
  label: string;
  /** TEASER: the date; FULL: the name, on its lines. */
  title: string[];
  /** TEASER: `20:00 PARIS`; FULL: `5 NOVEMBER 2026 · 20:00 PARIS`. */
  when: string;
  /** FULL only: a model's photograph (a set's: its first piece's). */
  photo: string | null;
  /** FULL of a set's release (macro scope K44 T1): its 2 to 4 pieces' photographs, side by side; absent otherwise. */
  photos?: string[];
  /** `orbes-2026-11-05-teaser.png` */
  filename: string;
}

export const COUNTDOWN_WORDS = Object.freeze({
  wordmark: 'ORBES',
  teaserLabel: 'A RELEASE',
  kind: { DRAW: 'DRAW', LIVE: 'LIVE RELEASE' } as Readonly<Record<'DRAW' | 'LIVE', string>>,
  paris: 'PARIS',
  site: 'THEORBES.COM',
  set: 'THE SET',
});

/** A model named with its variant, on two lines when it has one: [MONOLITHE, IN BLUE]. */
export function countdownName(name: string, variant: string | null): string[] {
  const n = name.trim().replace(/\s+/g, ' ').toUpperCase();
  const v = (variant ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return v ? [n, `IN ${v}`] : [n];
}

/** The image of `kind` (FULL falls back to TEASER while it cannot be chosen); null when the opening is unreadable. */
export function countdownCardModel(r: CountdownRelease, kind: CountdownKind, now: Date): CountdownCardModel | null {
  const m = parisMoment(r.opensAt);
  if (!m) return null;
  const full = kind === 'full' && fullChoice(r, now).available && r.model.name.trim().length > 0;
  if (!full) {
    return { kind: 'teaser', label: COUNTDOWN_WORDS.teaserLabel, title: [m.date], when: `${m.time} ${COUNTDOWN_WORDS.paris}`, photo: null, filename: `orbes-${m.day}-teaser.png` };
  }
  if (r.pieces) {
    const photos = r.pieces.map((p) => p.photo!);
    return {
      kind: 'full',
      label: COUNTDOWN_WORDS.kind[r.mode],
      // THE SET over its name, on two lines, as a model's name over its variant.
      title: [COUNTDOWN_WORDS.set, ...countdownName(r.model.name, null)],
      when: `${m.date} · ${m.time} ${COUNTDOWN_WORDS.paris}`,
      photo: photos[0]!,
      photos,
      filename: `orbes-${m.day}-full.png`,
    };
  }
  return {
    kind: 'full',
    label: COUNTDOWN_WORDS.kind[r.mode],
    title: countdownName(r.model.name, r.model.variant),
    when: `${m.date} · ${m.time} ${COUNTDOWN_WORDS.paris}`,
    photo: r.model.photo,
    filename: `orbes-${m.day}-full.png`,
  };
}

/** The image's words, top to bottom: its preview's alternative text and what the tests read. */
export function countdownWords(m: CountdownCardModel): string[] {
  return [COUNTDOWN_WORDS.wordmark, m.label, m.title.join(' '), m.when, COUNTDOWN_WORDS.site];
}

/** A LIVE RELEASE's name and photograph are public at the later of its NAME and PHOTO stages. */
export function livePublicAt(stages: { nameAt: string; photoAt: string } | null): string | null {
  if (!stages) return null;
  return Date.parse(stages.nameAt) >= Date.parse(stages.photoAt) ? stages.nameAt : stages.photoAt;
}
