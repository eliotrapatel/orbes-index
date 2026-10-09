/**
 * Rate limiting per route group (contract §3) with @fastify/rate-limit.
 *
 * One limiter per group, created with `createRateLimit`, so every route of a
 * group draws from the SAME per-client budget (the plugin's per-route config
 * would give each route its own counter, letting a client spread a brute
 * force over login + register + accept).
 *
 *   verify  POST /api/v1/verify                            config.rateLimits.verifyPerMinute
 *   auth    logins, registration, claim & transfer codes   config.rateLimits.authPerMinute
 *   admin   every other /api/admin route                    config.rateLimits.adminPerMinute
 *   api     remaining public/account routes                 config.rateLimits.apiPerMinute
 *   media   GET /api/v1/media/:sha256 (the photographs)     apiPerMinute × MEDIA_RATE_FACTOR
 *   live    the LIVE RELEASES (/api/v1/live…), per network  apiPerMinute × LIVE_NETWORK_RATE_FACTOR
 *           and, for a signed-in account, per account too   apiPerMinute (`liveAccount`)
 *   seen    POST /api/v1/seen (the views the app records)    apiPerMinute × SEEN_RATE_FACTOR
 *
 * The photographs have their own, higher budget (P-R02): a lookbook sheet
 * shows up to nine of them, and the customers of a boutique share its wifi
 * (one address): drawn from the `api` budget, a few sheets would refuse the
 * next lookup. It follows RATE_LIMIT_API_PER_MINUTE (no variable of its own:
 * the configuration has four files to keep in step, deploy/vps included).
 *
 * The views (plan CUSTOMER INTELLIGENCE §3.3 T.8.7) have their own budget too: the customers of a boutique share one
 * address, and views drawn from `api` would refuse their other requests. It follows RATE_LIMIT_API_PER_MINUTE.
 *
 * The LIVE RELEASES (routes/live.ts) draw on two budgets at once: their
 * network's, before anything else, wide enough for the collectors of a
 * boutique who share its wifi during a release (each polls its room every
 * 2 s when its stream is lost); and, once the session guard has found the
 * account, the account's own, so that one account cannot spend its
 * network's budget alone, whatever addresses it comes from. No variable of
 * their own either: both follow RATE_LIMIT_API_PER_MINUTE.
 *
 * Clients are keyed by the peppered hash of their IP (IPv6 grouped by /64),
 * accounts by the peppered hash of their id; raw addresses are never kept,
 * not even in the in-memory store.
 *
 * The store is in-process: with several instances each enforces its own
 * budget (put a shared store or the edge in front for a global limit).
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';
import { tooManyRequests } from '../errors.js';
import { pseudonymize, rateLimitKeyOf } from './client.js';

export const RATE_GROUPS = ['verify', 'auth', 'admin', 'api', 'media', 'live', 'seen'] as const;
export type RateGroup = (typeof RATE_GROUPS)[number];

/** The `media` group's budget, as a multiple of the `api` one (120 → 600 photographs a minute per client). */
export const MEDIA_RATE_FACTOR = 5;

/** The `live` group's budget per network, as a multiple of the `api` one (120 → 1 200 requests a minute per network). */
export const LIVE_NETWORK_RATE_FACTOR = 10;

/** The `seen` group's budget, as a multiple of the `api` one (120 → 240 batches of views a minute per client). */
export const SEEN_RATE_FACTOR = 2;

const WINDOW_MS = 60_000;
/** Clients tracked per group (LRU). Larger than the plugin default so a wide botnet cannot evict counters cheaply. */
const TRACKED_CLIENTS = 50_000;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Overrides the scope's rate-limit group for one route. */
    rateGroup?: RateGroup;
  }
}

export type RateLimiters = Readonly<Record<RateGroup, onRequestAsyncHookHandler>> & {
  /** The LIVE RELEASES' budget per signed-in account (apiPerMinute), run after the session guard; nothing without an account. */
  readonly liveAccount: onRequestAsyncHookHandler;
};

export function groupLimits(config: Pick<AppConfig, 'rateLimits'>): Record<RateGroup, number> {
  return {
    verify: config.rateLimits.verifyPerMinute,
    auth: config.rateLimits.authPerMinute,
    admin: config.rateLimits.adminPerMinute,
    api: config.rateLimits.apiPerMinute,
    media: config.rateLimits.apiPerMinute * MEDIA_RATE_FACTOR,
    live: config.rateLimits.apiPerMinute * LIVE_NETWORK_RATE_FACTOR,
    seen: config.rateLimits.apiPerMinute * SEEN_RATE_FACTOR,
  };
}

/**
 * Register the plugin (no global limit) and build one onRequest hook per group.
 * `rateLimitHook(limiters, scopeGroup)` then picks the route's group.
 */
export async function registerRateLimits(app: FastifyInstance, config: Pick<AppConfig, 'rateLimits' | 'ipHashPepper'>): Promise<RateLimiters> {
  await app.register(rateLimit, { global: false });
  const limits = groupLimits(config);
  const hooks = {} as Record<RateGroup, onRequestAsyncHookHandler>;
  for (const group of RATE_GROUPS) {
    // `cache` sizes this group's LRU store (read by the store's child(); absent from the typings, hence not inline).
    const options = { max: limits[group], timeWindow: WINDOW_MS, cache: TRACKED_CLIENTS, keyGenerator: (req: FastifyRequest) => rateLimitKeyOf(config.ipHashPepper, req) };
    hooks[group] = enforce(app.createRateLimit(options));
  }
  const accountOptions = {
    max: config.rateLimits.apiPerMinute,
    timeWindow: WINDOW_MS,
    cache: TRACKED_CLIENTS,
    keyGenerator: (req: FastifyRequest) => pseudonymize(config.ipHashPepper, 'account', `rl:live:${req.orbes.account?.account.id ?? ''}`),
  };
  const perAccount = enforce(app.createRateLimit(accountOptions));
  const liveAccount: onRequestAsyncHookHandler = async function liveAccount(request, reply) {
    if (request.orbes.account) await perAccount.call(this, request, reply);
  };
  return Object.freeze({ ...hooks, liveAccount });
}

/** The hook of one budget: through while it lasts, then 429 RATE_LIMITED with Retry-After. */
function enforce(check: ReturnType<FastifyInstance['createRateLimit']>): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const r = await check(request);
    if (r.isAllowed) return;
    reply.header('x-ratelimit-limit', r.max);
    reply.header('x-ratelimit-remaining', Math.max(0, r.remaining));
    reply.header('x-ratelimit-reset', r.ttlInSeconds);
    if (r.isExceeded) {
      reply.header('retry-after', Math.max(1, r.ttlInSeconds));
      throw tooManyRequests('Too many requests. Please try again later.');
    }
  };
}

/** onRequest hook applying the route's `config.rateGroup`, else the scope's default group. */
export function rateLimitHook(limiters: RateLimiters, scopeGroup: RateGroup): onRequestAsyncHookHandler {
  return async function rateLimited(request, reply) {
    const group = request.routeOptions.config.rateGroup ?? scopeGroup;
    await limiters[group].call(this, request, reply);
  };
}
