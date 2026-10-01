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
 *
 * Clients are keyed by the peppered hash of their IP (IPv6 grouped by /64);
 * raw addresses are never kept, not even in the in-memory store.
 *
 * The store is in-process: with several instances each enforces its own
 * budget (put a shared store or the edge in front for a global limit).
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';
import { tooManyRequests } from '../errors.js';
import { rateLimitKeyOf } from './client.js';

export const RATE_GROUPS = ['verify', 'auth', 'admin', 'api'] as const;
export type RateGroup = (typeof RATE_GROUPS)[number];

const WINDOW_MS = 60_000;
/** Clients tracked per group (LRU). Larger than the plugin default so a wide botnet cannot evict counters cheaply. */
const TRACKED_CLIENTS = 50_000;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Overrides the scope's rate-limit group for one route. */
    rateGroup?: RateGroup;
  }
}

export type RateLimiters = Readonly<Record<RateGroup, onRequestAsyncHookHandler>>;

export function groupLimits(config: Pick<AppConfig, 'rateLimits'>): Record<RateGroup, number> {
  return {
    verify: config.rateLimits.verifyPerMinute,
    auth: config.rateLimits.authPerMinute,
    admin: config.rateLimits.adminPerMinute,
    api: config.rateLimits.apiPerMinute,
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
    const check = app.createRateLimit(options);
    hooks[group] = async (request, reply) => {
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
  return Object.freeze(hooks);
}

/** onRequest hook applying the route's `config.rateGroup`, else the scope's default group. */
export function rateLimitHook(limiters: RateLimiters, scopeGroup: RateGroup): onRequestAsyncHookHandler {
  return async function rateLimited(request, reply) {
    const group = request.routeOptions.config.rateGroup ?? scopeGroup;
    await limiters[group].call(this, request, reply);
  };
}
