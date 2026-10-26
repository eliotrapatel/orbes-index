/**
 * Links → Ad platforms, `#/links/ads` (macro scope of 2026-10-20, K27 A1 to A5; lot M4 plan §3.5, step M4.12): the
 * server-side conversions' one switch and their settings, from GET /api/admin/ads and /api/admin/ads/events
 * (routes/admin/ads.ts). Entered from the Links page's Ad platforms; Links in the sidebar. The console's patterns: a fact
 * sheet, sections with their tools, a dialog per change, a toast and the page read again.
 *
 *   - CONVERSIONS: ON / OFF, when it was switched and by whom (Paris time), the first act it counts; off, the sentence
 *     « Conversions are off. Nothing is captured or sent, and collectors see no banner. »; SWITCH ON / SWITCH OFF (ADMIN,
 *     the typed phrase; the dialog says what goes live).
 *   - Platforms: Meta, TikTok and Google, each KEYS PRESENT / KEYS MISSING (never a key), API version, last send, last
 *     error, its events queued, sent, failed and skipped, its test code; SEND A TEST EVENT (ADMIN, while on) and Test codes.
 *   - Channels: each link channel and the platforms it maps to (tick boxes saved per channel, ADMIN); none mapped, said.
 *   - Google conversion actions: the four resource names (Edit, ADMIN).
 *   - Consent: this month's choices, accepted and declined; none, said.
 *   - Events: the latest, by status and platform (kept in the address), no person named; none, said.
 *
 * An AUDITOR reads it all, without a button. Text through h() only (CSP-safe).
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  ACT_LABELS,
  ACTS,
  AD_PLATFORMS_TEXT as T,
  adPlatformActions,
  anyChannelMapped,
  channelChange,
  channelPlatformsText,
  consentEmpty,
  countCells,
  EVENT_STATUS_LABELS,
  eventsEmptyText,
  eventsFilter,
  eventsQuery,
  GOOGLE_ACTION_FIELDS,
  googleActionsForm,
  googleActionsInput,
  googleActionsProblem,
  keysLabel,
  lastErrorText,
  lastSendText,
  monthLabel,
  PLATFORM_APIS,
  PLATFORM_LABELS,
  platformOptions,
  SKIP_LABELS,
  statusOptions,
  switchLine,
  testCodeText,
  testCodesForm,
  testCodesInput,
  testCodesProblem,
  testEventBody,
  testResultLines,
  type EventsFilter,
} from '../model/ad-platforms.js';
import { parisDateTime } from '../model/links.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { ADS_PLATFORMS, ADS_TEST_EVENT_CODE_MAX, type AdEventStatus, type AdEventView, type AdsPlatform, type AdsPlatformView, type AdsSettings, type AdsTestResult } from '../types.js';
import { button, checkbox, defList, emptyState, field, filterBar, linkButton, mono, pageHeader, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

// ── Conversions ──────────────────────────────────────────────────────────────────────────────────────────────────

function switchDialog(ctx: ViewContext, s: AdsSettings): void {
  const on = !s.on;
  void openDialog({
    title: on ? T.switchOnTitle : T.switchOffTitle,
    eyebrow: `${T.eyebrow} · ${T.title}`,
    body: h('p', { class: 'dialog__text', data: { testid: 'ads-switch-body' } }, on ? T.switchOnBody : T.switchOffBody),
    phrase: on ? s.phrases.on : s.phrases.off,
    phraseHint: on ? T.switchOnHint : T.switchOffHint,
    danger: !on,
    confirmLabel: on ? T.switchOnConfirm : T.switchOffConfirm,
    submit: async () => {
      await ctx.api.setAdsSwitch(on, on ? s.phrases.on : s.phrases.off);
    },
  }).then((r) => {
    if (!r) return;
    notify(on ? T.switchedOnToast : T.switchedOffToast);
    ctx.reload();
  });
}

function conversionsSection(ctx: ViewContext, s: AdsSettings, manage: boolean): HTMLElement {
  const line = switchLine(s);
  const tools = manage ? [button(s.on ? T.switchOff : T.switchOn, { kind: s.on ? 'secondary' : 'primary', testId: 'ads-switch', onClick: () => switchDialog(ctx, s) })] : [];
  return section(
    T.conversions,
    [
      h(
        'p',
        { class: 'adplat__state', data: { testid: 'ads-state' } },
        h('span', { class: 'adplat__state-label' }, `${T.conversionsLabel}:`),
        statusMark(s.on ? T.on : T.off, s.on ? 'solid' : 'muted'),
      ),
      h('p', { class: 'adplat__line', data: { testid: s.on ? 'ads-on' : 'ads-off' } }, s.on ? T.onLine : T.offLine),
      defList([
        { label: T.switched, value: h('span', { data: { testid: 'ads-switched' } }, line ?? T.neverSwitched) },
        ...(s.eventsFrom ? [{ label: T.eventsFrom, value: parisDateTime(s.eventsFrom), note: T.eventsFromNote }] : []),
      ]),
    ],
    { tools, class: 'adplat__conversions' },
  );
}

// ── Platforms ────────────────────────────────────────────────────────────────────────────────────────────────────

function testCodesDialog(ctx: ViewContext, s: AdsSettings): void {
  const current = testCodesForm(s);
  void openDialog({
    title: T.testCodesTitle,
    eyebrow: `${T.eyebrow} · ${T.title}`,
    body: h('p', { class: 'dialog__text' }, T.testCodesBody),
    fields: [
      { name: 'meta', label: `${PLATFORM_LABELS.META} · ${T.testCode}`, maxlength: ADS_TEST_EVENT_CODE_MAX, value: current.meta, hint: T.testCodeHint(PLATFORM_LABELS.META) },
      { name: 'tiktok', label: `${PLATFORM_LABELS.TIKTOK} · ${T.testCode}`, maxlength: ADS_TEST_EVENT_CODE_MAX, value: current.tiktok, hint: T.testCodeHint(PLATFORM_LABELS.TIKTOK) },
    ],
    validate: (v) => testCodesProblem(v, current),
    confirmLabel: T.testCodesConfirm,
    submit: async (v) => {
      await ctx.api.setAdsTestCodes(testCodesInput(v));
    },
  }).then((r) => {
    if (!r) return;
    notify(T.testCodesSaved);
    ctx.reload();
  });
}

function testResultDialog(r: AdsTestResult): void {
  const l = testResultLines(r);
  void openDialog({
    title: `${T.sendTest} · ${PLATFORM_LABELS[r.platform].toUpperCase()}`,
    eyebrow: `${T.eyebrow} · ${T.title}`,
    body: [
      h('p', { class: 'adplat__result', data: { testid: 'ads-test-result' } }, statusMark(l.mark, l.ok ? 'solid' : 'alert'), h('span', { class: 'cell-sub' }, l.status)),
      h('p', { class: ['mono', 'adplat__answer'], data: { testid: 'ads-test-answer' } }, l.answer),
    ],
    noCancel: true,
    confirmLabel: T.testDone,
  });
}

function sendTestDialog(ctx: ViewContext, p: AdsPlatformView): void {
  let result: AdsTestResult | null = null;
  void openDialog({
    title: T.sendTest,
    eyebrow: `${T.eyebrow} · ${T.title} · ${PLATFORM_LABELS[p.platform]}`,
    body: h('p', { class: 'dialog__text' }, testEventBody(p)),
    confirmLabel: T.sendTestConfirm,
    working: T.sendTestWorking,
    submit: async () => {
      result = await ctx.api.sendAdsTest(p.platform);
    },
  }).then((r) => {
    if (!r || !result) return;
    testResultDialog(result);
    ctx.reload();
  });
}

function platformBlock(ctx: ViewContext, s: AdsSettings, p: AdsPlatformView, acts: { manage: boolean; test: boolean }): HTMLElement {
  const err = lastErrorText(p);
  const test = acts.test
    ? button(T.sendTest, { kind: 'secondary', testId: 'ads-test', disabled: !p.ready, title: p.ready ? undefined : T.testNoKeys, onClick: () => sendTestDialog(ctx, p) })
    : null;
  return h(
    'article',
    { class: 'adplat__platform', data: { testid: 'ads-platform', platform: p.platform } },
    h(
      'header',
      { class: 'adplat__platform-head' },
      h('h3', { class: 'adplat__platform-name' }, PLATFORM_LABELS[p.platform]),
      h('span', { class: 'cell-sub' }, PLATFORM_APIS[p.platform]),
      h('span', { class: 'adplat__keys', data: { testid: 'ads-keys' } }, statusMark(keysLabel(p), p.ready ? 'solid' : 'outline')),
    ),
    h(
      'dl',
      { class: 'adplat__counts', attrs: { 'aria-label': T.events } },
      ...countCells(p).map((c) => h('div', { class: 'adplat__count', data: { status: c.status } }, h('dt', null, c.label), h('dd', { data: { testid: `ads-count-${c.status}` } }, c.value))),
    ),
    defList([
      { label: T.apiVersion, value: h('span', { class: 'mono', data: { testid: 'ads-api-version' } }, p.apiVersion) },
      { label: T.lastSend, value: h('span', { data: { testid: 'ads-last-send' } }, lastSendText(p)) },
      { label: T.lastError, value: err ? h('span', { class: 'adplat__error', data: { testid: 'ads-last-error' } }, err.error) : h('span', { data: { testid: 'ads-last-error' } }, T.none), ...(err ? { note: err.at } : {}) },
      { label: T.testCode, value: p.platform === 'GOOGLE' || !p.testCode ? testCodeText(p) : mono(p.testCode) },
    ], 'adplat__facts'),
    test ? h('div', { class: 'adplat__platform-tools' }, test) : null,
  );
}

function platformsSection(ctx: ViewContext, s: AdsSettings, acts: { manage: boolean; test: boolean }): HTMLElement {
  const byPlatform = ADS_PLATFORMS.map((x) => s.platforms.find((p) => p.platform === x)).filter((p): p is AdsPlatformView => p !== undefined);
  return section(
    T.platforms,
    [
      acts.manage && !s.on ? h('p', { class: 'adplat__line', data: { testid: 'ads-test-off' } }, T.testWhileOff) : null,
      h('div', { class: 'adplat__platforms' }, ...byPlatform.map((p) => platformBlock(ctx, s, p, acts))),
    ],
    { note: T.platformsNote, tools: acts.manage ? [button(T.testCodes, { kind: 'secondary', testId: 'ads-test-codes', onClick: () => testCodesDialog(ctx, s) })] : [] },
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────────────────────────────────────────

function channelRow(ctx: ViewContext, c: AdsSettings['channels'][number], manage: boolean): HTMLElement {
  const name = h('span', { class: 'adplat__channel-name', data: { testid: 'ads-channel-name' } }, c.name);
  if (!manage) {
    return h('div', { class: 'adplat__channel', data: { testid: 'ads-channel', channel: c.id } }, name, h('span', { class: 'adplat__channel-platforms', data: { testid: 'ads-channel-platforms' } }, channelPlatformsText(c.platforms)));
  }
  const boxes = ADS_PLATFORMS.map((p) => {
    const box = checkbox(`platform-${p}`, PLATFORM_LABELS[p], c.platforms.includes(p));
    box.querySelector('input')!.value = p;
    box.setAttribute('data-testid', `ads-channel-${p}`);
    return box;
  });
  const ticked = (): AdsPlatform[] => boxes.filter((b) => b.querySelector('input')!.checked).map((b) => b.querySelector('input')!.value as AdsPlatform);
  const save = button(T.save, { kind: 'ghost', testId: 'ads-channel-save', disabled: true });
  const sync = () => {
    save.disabled = !channelChange(c.platforms, ticked()).changed;
  };
  for (const b of boxes) b.querySelector('input')!.addEventListener('change', sync);
  save.addEventListener('click', async () => {
    const change = channelChange(c.platforms, ticked());
    if (!change.changed) return;
    save.disabled = true;
    try {
      await ctx.api.setAdsChannel(c.id, change.platforms);
      notify(T.channelSaved(c.name));
      ctx.reload();
    } catch (e) {
      notifyError(e);
      sync();
    }
  });
  return h(
    'div',
    { class: 'adplat__channel', data: { testid: 'ads-channel', channel: c.id } },
    name,
    h('span', { class: 'adplat__channel-boxes', attrs: { role: 'group', 'aria-label': c.name } }, ...boxes),
    save,
  );
}

function channelsSection(ctx: ViewContext, s: AdsSettings, manage: boolean): HTMLElement {
  const body: Child[] = [h('p', { class: 'adplat__line' }, T.channelsNote)];
  if (s.channels.length === 0) body.push(h('div', { data: { testid: 'ads-channels-empty' } }, emptyState(T.noChannel)));
  else {
    if (!anyChannelMapped(s)) body.push(h('div', { data: { testid: 'ads-channels-empty' } }, emptyState(T.channelsEmpty)));
    body.push(h('div', { class: 'adplat__channels' }, ...s.channels.map((c) => channelRow(ctx, c, manage))));
  }
  return section(T.channels, body);
}

// ── Google conversion actions ────────────────────────────────────────────────────────────────────────────────────

function googleDialog(ctx: ViewContext, s: AdsSettings): void {
  const current = googleActionsForm(s);
  void openDialog({
    title: T.googleTitle,
    eyebrow: `${T.eyebrow} · ${T.title}`,
    body: h('p', { class: 'dialog__text' }, T.googleBody),
    fields: GOOGLE_ACTION_FIELDS.map((f) => ({ name: f.name, label: ACT_LABELS[f.kind], maxlength: 80, value: current[f.name], hint: T.googleHint })),
    validate: (v) => googleActionsProblem(v, current),
    confirmLabel: T.googleConfirm,
    submit: async (v) => {
      await ctx.api.setAdsGoogleActions(googleActionsInput(v));
    },
  }).then((r) => {
    if (!r) return;
    notify(T.googleSaved);
    ctx.reload();
  });
}

function googleSection(ctx: ViewContext, s: AdsSettings, manage: boolean): HTMLElement {
  return section(
    T.googleActions,
    [
      h('p', { class: 'adplat__line' }, T.googleNote),
      defList(
        ACTS.map((kind) => {
          const name = s.googleActions[kind];
          return { label: ACT_LABELS[kind], value: name ? h('span', { class: ['mono', 'adplat__action'], data: { testid: 'ads-google-action' } }, name) : h('span', { class: 'soft', data: { testid: 'ads-google-action' } }, T.notNamed) };
        }),
      ),
    ],
    { tools: manage ? [button(T.edit, { kind: 'secondary', testId: 'ads-google-edit', onClick: () => googleDialog(ctx, s) })] : [] },
  );
}

// ── Consent ──────────────────────────────────────────────────────────────────────────────────────────────────────

function consentSection(s: AdsSettings): HTMLElement {
  return section(
    T.consent,
    [
      h('p', { class: 'adplat__line' }, T.consentLine),
      consentEmpty(s)
        ? h('div', { data: { testid: 'ads-consent-empty' } }, emptyState(T.consentEmpty))
        : defList([
            { label: T.accepted, value: h('span', { class: 'adplat__figure', data: { testid: 'ads-consent-granted' } }, String(s.consent.granted)) },
            { label: T.declined, value: h('span', { class: 'adplat__figure', data: { testid: 'ads-consent-declined' } }, String(s.consent.declined)) },
          ]),
    ],
    { note: monthLabel(s.consent.month) },
  );
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────

function eventsSection(ctx: ViewContext, f: EventsFilter, events: AdEventView[] | null): HTMLElement {
  const go = (next: EventsFilter) => ctx.navigate(href('adPlatforms', {}, eventsQuery(next)), { keepScroll: true });
  const status = select('status', statusOptions(), f.status ?? '');
  status.setAttribute('data-testid', 'ads-events-status');
  status.addEventListener('change', () => go({ ...f, status: (status.value || null) as AdEventStatus | null }));
  const platform = select('platform', platformOptions(), f.platform ?? '');
  platform.setAttribute('data-testid', 'ads-events-platform');
  platform.addEventListener('change', () => go({ ...f, platform: (platform.value || null) as AdsPlatform | null }));
  const list =
    events === null
      ? h('div', { data: { testid: 'ads-events-failed' } }, emptyState(T.eventsFailed), button(T.tryAgain, { kind: 'secondary', onClick: () => ctx.reload() }))
      : events.length === 0
        ? h('div', { data: { testid: 'ads-events-empty' } }, emptyState(eventsEmptyText(f)))
        : h(
            'div',
            { data: { testid: 'ads-events' } },
            table<AdEventView>(
              [
                {
                  label: T.created,
                  cell: (e) => h('span', null, parisDateTime(e.createdAt), e.sentAt ? h('span', { class: 'cell-sub', data: { testid: 'ads-event-sent' } }, `${T.sent} ${parisDateTime(e.sentAt)}`) : null),
                  kind: ['nowrap'],
                },
                { label: T.platform, cell: (e) => PLATFORM_LABELS[e.platform], kind: ['nowrap'] },
                { label: T.act, cell: (e) => ACT_LABELS[e.kind], kind: ['nowrap'] },
                {
                  label: T.status,
                  kind: ['nowrap'],
                  cell: (e) =>
                    h(
                      'span',
                      { data: { testid: 'ads-event-status' } },
                      statusMark(EVENT_STATUS_LABELS[e.status], toneOf('adEvent', e.status)),
                      e.skipReason ? h('span', { class: 'cell-sub' }, SKIP_LABELS[e.skipReason]) : null,
                    ),
                },
                { label: T.attempts, cell: (e) => String(e.attempts), kind: ['num'] },
                { label: T.error, cell: (e) => (e.lastError ? h('span', { class: 'adplat__error' }, e.lastError) : '—'), kind: ['wide'] },
              ],
              events,
              { caption: T.eventsCaption },
            ),
          );
  return section(T.events, [filterBar(field(T.status, status), field(T.platform, platform)), list], { note: T.eventsNote, class: 'adplat__events' });
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function adPlatformsView(ctx: ViewContext): Promise<HTMLElement> {
  const f = eventsFilter(ctx.route.query);
  const [s, events] = await Promise.all([
    ctx.api.adsSettings(),
    ctx.api.adsEvents({ ...(f.status ? { status: f.status } : {}), ...(f.platform ? { platform: f.platform } : {}) }).catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
      return null;
    }),
  ]);
  const acts = adPlatformActions(ctx.session.admin.role, s);
  return h(
    'div',
    { class: 'view view--ad-platforms' },
    pageHeader({ eyebrow: T.eyebrow, title: T.title, lead: T.lead, actions: [linkButton(T.links, href('links'), 'ghost')] }),
    conversionsSection(ctx, s, acts.manage),
    platformsSection(ctx, s, acts),
    channelsSection(ctx, s, acts.manage),
    googleSection(ctx, s, acts.manage),
    consentSection(s),
    eventsSection(ctx, f, events),
  );
}
