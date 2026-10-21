/**
 * The CAMPAIGN tab of a release (plan MACRO M1 §2.2, scope C2 and C3), `?tab=campaign` on the draw's page
 * (views/drop.ts) and the LIVE RELEASE's (views/live.ts); never on an after-room's, whose sales are its release's.
 * Words and rows in model/campaign.ts; the image in ui/countdown-card.ts; the server in services/campaign.ts.
 *
 *   - Links: one row per channel in its order, with the release's link, its address and Copy, or « No link yet »; a
 *     row opens the link's page, where its cost is set. MAKE THE LINKS (OPERATOR, once published, not cancelled) makes
 *     one link per channel still without one, in one click; the tab is then read again.
 *   - Countdown image: TEASER (the default) or FULL (once the release's name and photograph are public), a preview at
 *     reduced size of the very PNG DOWNLOAD saves (`orbes-<date>-teaser.png`). The choice is not stored.
 *   - Readout: per link under the last link, entries, buyers, revenue, cost and return, OTHER SOURCES and the TOTAL;
 *     « Figures appear once entries open. » before the first entry.
 * The tab reads its campaign after the page is drawn: the house's loading() while it is read, failure() with Try
 * again when it cannot be.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  CAMPAIGN_COPY as K,
  campaignLinkLines,
  costCell,
  countdownCardModel,
  countdownWords,
  fullChoice,
  linkPageHref,
  makeLinksState,
  readoutNote,
  readoutRows,
  releaseTabHref,
  type CampaignLinkLine,
  type CountdownKind,
  type CountdownRelease,
  type ReadoutRow,
  type ReleaseTab,
} from '../model/campaign.js';
import { addressText } from '../model/links.js';
import { can } from '../model/permissions.js';
import type { ReleaseCampaign } from '../types.js';
import { busy, button, copyButton, emptyState, failure, loading, section, statusMark, table } from '../ui/components.js';
import { prepareCountdownCard } from '../ui/countdown-card.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The page's two tabs, RELEASE · CAMPAIGN, as links (the house's local tabs, the current one underlined). */
export function releaseTabs(page: 'drop' | 'liveRelease', dropId: string, current: ReleaseTab): HTMLElement {
  const items: { tab: ReleaseTab; label: string }[] = [
    { tab: 'release', label: K.tabRelease },
    { tab: 'campaign', label: K.tabCampaign },
  ];
  return h(
    'nav',
    { class: ['range', 'release__tabs'], attrs: { 'aria-label': K.tabs, 'data-testid': 'release-tabs' } },
    ...items.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: releaseTabHref(page, dropId, t.tab), 'aria-current': t.tab === current ? 'page' : null, 'data-testid': `release-tab-${t.tab}` } }, t.label),
    ]),
  );
}

/** The CAMPAIGN tab's sections, under the page's header and tabs. */
export function campaignTab(ctx: ViewContext, dropId: string, release: CountdownRelease): HTMLElement {
  const root = h('div', { class: 'campaign', data: { testid: 'campaign' } });
  const read = () => {
    mount(root, loading(K.loading));
    ctx.api.releaseCampaign(dropId).then(
      (c) => mount(root, ...campaignSections(ctx, c, release, read)),
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return;
        mount(root, h('div', { data: { testid: 'campaign-failed' } }, failure(K.failed, read)));
      },
    );
  };
  read();
  return root;
}

function campaignSections(ctx: ViewContext, c: ReleaseCampaign, release: CountdownRelease, reread: () => void): Child[] {
  return [linksSection(ctx, c, reread), imageSection(ctx, release), readoutSection(c)];
}

// ── Links ────────────────────────────────────────────────────────────────────────────────────────────────────────

function linksSection(ctx: ViewContext, c: ReleaseCampaign, reread: () => void): HTMLElement {
  const state = makeLinksState(c, can(ctx.session.admin.role, 'manageLinks'));
  const make = button(K.makeLinks, { kind: 'primary', testId: 'campaign-make-links' });
  make.addEventListener('click', () => {
    void busy(make, () => ctx.api.makeCampaignLinks(c.release.id), K.making).then(
      (r) => {
        notify(r.made.length > 0 ? K.made(r.made.length) : K.noneMade);
        reread();
      },
      (e: unknown) => notifyError(e),
    );
  });
  const rows = campaignLinkLines(c.channels);
  return section(
    K.links,
    [
      state.line ? h('p', { class: 'campaign__line', data: { testid: 'campaign-links-line' } }, state.line) : null,
      rows.length === 0
        ? null
        : h(
            'div',
            { class: 'campaign__links' },
            table<CampaignLinkLine>(
            [
              {
                label: K.channel,
                cell: (r) =>
                  r.channel === null
                    ? null
                    : h('span', null, h('span', { class: 'campaign__channel', data: { testid: 'campaign-channel' } }, r.channel), r.uncovered ? h('span', { class: 'cell-sub' }, K.noActiveLink) : null),
                kind: ['nowrap'],
              },
              {
                label: K.link,
                cell: (r) =>
                  r.link
                    ? h(
                        'span',
                        { class: 'campaign__link' },
                        h('a', { class: 'idlink campaign__name', attrs: { href: linkPageHref(r.link.id), 'data-testid': 'campaign-link-name' } }, r.link.name),
                        r.link.archivedAt ? h('span', { class: 'row-marks' }, statusMark(K.archived, 'outline')) : null,
                        h(
                          'span',
                          { class: 'campaign__address' },
                          h('span', { class: 'mono', data: { testid: 'campaign-link-address' } }, addressText(r.link.address)),
                          r.link.archivedAt ? null : copyButton(r.link.address, K.copy),
                        ),
                      )
                    : h('span', { class: 'soft', data: { testid: 'campaign-no-link' } }, K.noLink),
                kind: ['wide', 'wrap'],
              },
              { label: K.cost, cell: (r) => (r.link ? costCell(r.link) : ''), kind: ['num', 'nowrap'] },
            ],
            rows,
            { onRow: (r) => (r.link ? linkPageHref(r.link.id) : null), caption: K.links },
            ),
          ),
      rows.length === 0 ? null : h('p', { class: 'campaign__foot soft' }, K.costOnLink),
    ],
    { id: 'campaign-links', note: K.linksNote, tools: state.offer ? [make] : [] },
  );
}

// ── The countdown image ──────────────────────────────────────────────────────────────────────────────────────────

function imageSection(ctx: ViewContext, release: CountdownRelease): HTMLElement {
  let kind: CountdownKind = 'teaser';
  let blob: Blob | null = null;
  let url: string | null = null;
  let turn = 0;
  const full = fullChoice(release, ctx.now());
  const choiceButton = (k: CountdownKind, label: string) =>
    h('button', { class: ['range__tab', 'campaign__choice'], attrs: { type: 'button', 'aria-pressed': k === kind ? 'true' : 'false', disabled: k === 'full' && !full.available, 'data-testid': `campaign-image-${k}` } }, label);
  const teaserBtn = choiceButton('teaser', K.teaser);
  const fullBtn = choiceButton('full', K.full);
  const line = h('p', { class: 'campaign__line', data: { testid: 'campaign-image-line' } });
  const fullLine = full.available ? null : h('p', { class: 'campaign__line soft', data: { testid: 'campaign-full-line' } }, full.line);
  const preview = h('div', { class: 'campaign__preview', data: { testid: 'campaign-preview' } });
  const download = button(K.download, { kind: 'primary', testId: 'campaign-download', disabled: true });
  let filename = '';
  download.addEventListener('click', () => {
    if (blob) saveDownload({ blob, filename, contentType: 'image/png' });
  });

  const draw = () => {
    const mine = ++turn;
    const m = countdownCardModel(release, kind, ctx.now());
    teaserBtn.setAttribute('aria-pressed', String(kind === 'teaser'));
    fullBtn.setAttribute('aria-pressed', String(kind === 'full'));
    line.textContent = kind === 'teaser' ? K.teaserLine : K.fullLine;
    download.disabled = true;
    blob = null;
    if (!m) {
      mount(preview, h('p', { class: 'campaign__line' }, K.drawFailed));
      return;
    }
    filename = m.filename;
    mount(preview, loading(K.drawing));
    void prepareCountdownCard(m).then((b) => {
      if (mine !== turn) return;
      if (url) URL.revokeObjectURL(url);
      url = null;
      if (!b) {
        mount(preview, h('div', { data: { testid: 'campaign-image-failed' } }, failure(K.drawFailed, draw)));
        return;
      }
      blob = b;
      url = URL.createObjectURL(b);
      mount(preview, h('img', { class: 'campaign__image', attrs: { src: url, alt: `${K.previewAlt(m.kind)}: ${countdownWords(m).join('. ')}`, width: '270', height: '480', 'data-testid': 'campaign-image', 'data-filename': m.filename } }));
      download.disabled = false;
    });
  };
  teaserBtn.addEventListener('click', () => {
    if (kind === 'teaser') return;
    kind = 'teaser';
    draw();
  });
  fullBtn.addEventListener('click', () => {
    if (kind === 'full' || !full.available) return;
    kind = 'full';
    draw();
  });
  draw();

  return section(
    K.image,
    h(
      'div',
      { class: 'campaign__image-box' },
      preview,
      h(
        'div',
        { class: 'campaign__image-side' },
        h('div', { class: ['range', 'campaign__choices'], attrs: { role: 'group', 'aria-label': K.choice } }, teaserBtn, h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }), fullBtn),
        line,
        fullLine,
        h('div', { class: 'campaign__download' }, download),
      ),
    ),
    { id: 'campaign-image', note: K.imageNote },
  );
}

// ── The readout ──────────────────────────────────────────────────────────────────────────────────────────────────

function readoutSection(c: ReleaseCampaign): HTMLElement {
  const rows = readoutRows(c);
  const body =
    rows.length === 0
      ? h('div', { data: { testid: 'campaign-readout-empty' } }, emptyState(K.upcoming))
      : h(
          'div',
          { class: 'campaign__readout', data: { testid: 'campaign-readout' } },
          table<ReadoutRow>(
            [
              {
                label: K.link,
                cell: (r) =>
                  h(
                    'span',
                    { class: ['campaign__row-name', `campaign__row-name--${r.kind}`], data: { testid: 'campaign-readout-row', kind: r.kind } },
                    r.linkId ? h('a', { class: 'idlink', attrs: { href: linkPageHref(r.linkId) } }, r.name) : h('span', { class: 'campaign__heading' }, r.name),
                    r.sub ? h('span', { class: 'cell-sub' }, r.sub) : null,
                  ),
                kind: ['wide', 'wrap'],
              },
              { label: K.entries, cell: (r) => r.entries, kind: ['num'] },
              { label: K.buyers, cell: (r) => r.buyers, kind: ['num'] },
              { label: K.revenue, cell: (r) => r.revenue, kind: ['num', 'nowrap'] },
              { label: K.cost, cell: (r) => r.cost, kind: ['num', 'nowrap'] },
              { label: K.returns, cell: (r) => h('span', null, r.returns, r.returnsSub ? h('span', { class: 'cell-sub' }, r.returnsSub) : null), kind: ['num', 'nowrap'] },
            ],
            rows,
            { caption: K.readout },
          ),
        );
  return section(K.readout, body, { id: 'campaign-readout', note: readoutNote(c.readout.stage) });
}
