/**
 * Links → Ad platforms (macro scope of 2026-10-20, K27 A1 to A5; lot M4 plan §3.2, §3.5; services/ads.ts): the
 * server-side conversions' one switch and their settings. An AUDITOR reads (never a key: each platform's keys are
 * "present" or "missing"; no account, no email); an ADMIN switches, maps, names and tests.
 *
 *   GET  /api/admin/ads                          AUDITOR  the switch (since when, by whom), each platform's readiness (true
 *                                                         or false), API version, last send, last error, its events by
 *                                                         status and its test code; the channels and their platforms; the
 *                                                         Google conversion actions; the choices of this Paris month
 *   PUT  /api/admin/ads/switch                   ADMIN    SWITCH ON / SWITCH OFF, the typed phrase (409 ADS_NO_PLATFORM:
 *                                                         no platform has its keys)
 *   PUT  /api/admin/ads/channels/:channelId      ADMIN    a link channel's platforms (404 CHANNEL_NOT_FOUND)
 *   PUT  /api/admin/ads/google-actions           ADMIN    each act's Google Ads conversion action
 *   PUT  /api/admin/ads/test-codes               ADMIN    Meta's and TikTok's test event codes
 *   POST /api/admin/ads/test/:platform           ADMIN    SEND A TEST EVENT, its answer (409 ADS_OFF while off,
 *                                                         ADS_NO_PLATFORM without its keys)
 *   GET  /api/admin/ads/events?status=&platform= AUDITOR  the latest events: kind, platform, status, times, error
 *
 * Audited by AdsService (`ads.switch`, `ads.channels`, `ads.google_actions`, `ads.test_codes`, `ads.test`). Validation:
 * the ads schemas of http/schemas.ts (400 VALIDATION_FAILED). Never stored by a cache (http/security.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  adsChannelBody,
  adsChannelParams,
  adsEventsQuery,
  adsGoogleActionsBody,
  adsPlatformParams,
  adsSwitchBody,
  adsTestCodesBody,
  emptyBody,
  parse,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminAdsRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { ads } = ctx.services;

  app.get('/api/admin/ads', async () => ads.read());

  app.put('/api/admin/ads/switch', { config: ADMIN }, async (request) => {
    const b = parse(adsSwitchBody, request.body);
    return ads.setSwitch(b.on, b.phrase, adminActor(request));
  });

  app.put('/api/admin/ads/channels/:channelId', { config: ADMIN }, async (request) => {
    const { channelId } = parse(adsChannelParams, request.params);
    const b = parse(adsChannelBody, request.body);
    return ads.setChannelPlatforms(channelId, b.platforms, adminActor(request));
  });

  app.put('/api/admin/ads/google-actions', { config: ADMIN }, async (request) => {
    const b = parse(adsGoogleActionsBody, request.body);
    return ads.setGoogleActions({ SIGNUP: b.signup, DRAW_ENTRY: b.drawEntry, LIVE_ENTRY: b.liveEntry, PAID_ORDER: b.paidOrder }, adminActor(request));
  });

  app.put('/api/admin/ads/test-codes', { config: ADMIN }, async (request) => {
    const b = parse(adsTestCodesBody, request.body);
    return ads.setTestCodes({ meta: b.meta, tiktok: b.tiktok }, adminActor(request));
  });

  app.post('/api/admin/ads/test/:platform', { config: ADMIN }, async (request) => {
    const { platform } = parse(adsPlatformParams, request.params);
    parse(emptyBody, request.body);
    return ads.sendTest(platform, adminActor(request));
  });

  app.get('/api/admin/ads/events', async (request) => {
    const q = parse(adsEventsQuery, request.query);
    return ads.events({ ...(q.status ? { status: q.status } : {}), ...(q.platform ? { platform: q.platform } : {}) });
  });
};
