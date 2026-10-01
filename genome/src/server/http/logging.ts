/**
 * Logging for the HTTP server.
 *
 * Fastify's pino logger is configured so that request logs carry the method,
 * the path WITHOUT its query string and the request id, never the client IP,
 * cookies, the CSRF header or Set-Cookie values. Services log through the
 * same logger (AppContext.log), attached once the Fastify instance exists.
 */
import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Logger } from '../types.js';

type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

function pathOnly(url: unknown): string {
  if (typeof url !== 'string') return '';
  const q = url.indexOf('?');
  return (q === -1 ? url : url.slice(0, q)).slice(0, 300);
}

/** pino options for Fastify: level by environment, IP-free serializers, secrets redacted. */
export function loggerOptions(config: Pick<AppConfig, 'env'>, level?: string): LoggerOption {
  return {
    level: level ?? (config.env === 'production' ? 'info' : config.env === 'test' ? 'warn' : 'debug'),
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        'headers.cookie',
        'headers["x-csrf-token"]',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req(req: { method?: string; url?: string; id?: string }) {
        return { method: req.method, url: pathOnly(req.url), reqId: req.id };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
  } as LoggerOption;
}

export interface ForwardingLogger extends Logger {
  /** Route all further output to `target` (e.g. `app.log`). */
  attach(target: Logger): void;
}

/**
 * A Logger usable before the Fastify instance (and its pino logger) exists:
 * it writes JSON lines to stderr until `attach()` hands it the real logger.
 * Lets createContext() log during startup while buildApp() comes after it.
 */
export function createForwardingLogger(stream: { write(s: string): unknown } = process.stderr): ForwardingLogger {
  let target: Logger | undefined;
  const early = (level: 'info' | 'warn' | 'error') => (o: object | string, m?: string) => {
    const base = typeof o === 'string' ? { msg: o } : { ...o, ...(m !== undefined ? { msg: m } : {}) };
    try {
      stream.write(`${JSON.stringify({ level, time: Date.now(), ...base })}\n`);
    } catch {
      // Unserialisable context: never let logging take the process down.
      stream.write(`${JSON.stringify({ level, time: Date.now(), msg: m ?? String(o) })}\n`);
    }
  };
  const fallback: Logger = { info: early('info'), warn: early('warn'), error: early('error') };
  return {
    info: (o, m) => (target ?? fallback).info(o, m),
    warn: (o, m) => (target ?? fallback).warn(o, m),
    error: (o, m) => (target ?? fallback).error(o, m),
    attach(t: Logger) {
      target = t;
    },
  };
}
