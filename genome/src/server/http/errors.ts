/**
 * Error handling for the HTTP layer.
 *
 * Every error leaves the server as `{ error: { code, message } }` and nothing
 * else: no stack traces, no SQL, no internal statuses. DomainError carries its
 * own public message; zod and Fastify framework errors are mapped to stable
 * codes; anything unexpected becomes a generic 500 whose details only reach
 * the server log (without request bodies, cookies or driver `detail` fields,
 * which can echo submitted values).
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError, isDomainError } from '../errors.js';

export interface ErrorBody {
  error: { code: string; message: string };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Public message for a zod failure: field path plus the issue text (never the submitted value). */
export function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'The request is invalid.';
  if (issue.code === 'unrecognized_keys') {
    const where = issue.path.length > 0 ? ` in ${issue.path.join('.')}` : '';
    return `The request contains unknown fields${where}: ${issue.keys.slice(0, 5).join(', ')}.`;
  }
  const path = issue.path.map(String).join('.');
  // zod's default texts ("Invalid input: expected string, received number") are value-free.
  const text = issue.message.endsWith('.') ? issue.message : `${issue.message}.`;
  return path ? `${path}: ${text}` : text;
}

/** Turn a zod error into the DomainError the handler answers with. */
export function fromZod(err: z.ZodError): DomainError {
  return new DomainError('VALIDATION_FAILED', 400, zodMessage(err), { detail: 'zod' });
}

interface Mapped {
  status: number;
  body: ErrorBody;
  /** Log level: client mistakes are routine, server faults are errors. */
  level: 'info' | 'warn' | 'error';
}

const FRAMEWORK_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Request bodies must be JSON (Content-Type: application/json).',
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { status: 400, code: 'BAD_REQUEST', message: 'The request body length is invalid.' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: 'INVALID_JSON', message: 'The request body is empty; send a JSON object.' },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
  FST_ERR_BAD_URL: { status: 400, code: 'BAD_REQUEST', message: 'The request URL is invalid.' },
  FST_ERR_ASYNC_CONSTRAINT: { status: 400, code: 'BAD_REQUEST', message: 'The request is invalid.' },
};

export function mapError(err: unknown): Mapped {
  if (isDomainError(err)) {
    return { status: err.httpStatus, body: err.toResponse(), level: err.httpStatus >= 500 ? 'error' : 'info' };
  }
  if (err instanceof z.ZodError) {
    return { status: 400, body: errorBody('VALIDATION_FAILED', zodMessage(err)), level: 'info' };
  }
  const fe = err as Partial<FastifyError> & { type?: string; status?: number };
  if (typeof fe?.code === 'string' && FRAMEWORK_ERRORS[fe.code]) {
    const m = FRAMEWORK_ERRORS[fe.code];
    return { status: m.status, body: errorBody(m.code, m.message), level: 'info' };
  }
  // JSON.parse failures surface as SyntaxError with statusCode 400.
  if (err instanceof SyntaxError && fe.statusCode === 400) {
    return { status: 400, body: errorBody('INVALID_JSON', 'The request body is not valid JSON.'), level: 'info' };
  }
  const status = typeof fe?.statusCode === 'number' ? fe.statusCode : typeof fe?.status === 'number' ? fe.status : 500;
  if (status === 429) {
    return { status, body: errorBody('RATE_LIMITED', 'Too many requests. Please try again later.'), level: 'info' };
  }
  if (status >= 400 && status < 500) {
    // Prototype poisoning, malformed headers, … : Fastify's own texts are safe but not stable; use ours.
    return { status, body: errorBody(status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', status === 404 ? 'Not found.' : 'The request is invalid.'), level: 'info' };
  }
  return { status: 500, body: errorBody('INTERNAL_ERROR', 'An unexpected error occurred. Please try again later.'), level: 'error' };
}

/** What the log gets: enough to debug, nothing that echoes client data. */
function logFields(err: unknown, status: number): Record<string, unknown> {
  if (isDomainError(err)) {
    const fields: Record<string, unknown> = { code: err.code, status };
    if (err.internal?.detail !== undefined) fields.detail = err.internal.detail;
    if (status >= 500 && err.internal?.cause instanceof Error) fields.cause = { name: err.internal.cause.name, message: err.internal.cause.message };
    return fields;
  }
  if (err instanceof z.ZodError) return { code: 'VALIDATION_FAILED', status };
  const e = err as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
  const fields: Record<string, unknown> = {
    status,
    err: {
      name: typeof e?.name === 'string' ? e.name : 'Error',
      message: typeof e?.message === 'string' ? e.message.slice(0, 500) : String(err).slice(0, 500),
      ...(typeof e?.code === 'string' ? { code: e.code } : {}),
      // Stacks stay server-side, and only for genuine faults.
      ...(status >= 500 && typeof e?.stack === 'string' ? { stack: e.stack } : {}),
    },
  };
  return fields;
}

export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const mapped = mapError(err);
    const fields = { reqId: request.id, route: request.routeOptions?.url, ...logFields(err, mapped.status) };
    if (mapped.level === 'error') request.log.error(fields, 'request failed');
    else if (mapped.level === 'warn') request.log.warn(fields, 'request rejected');
    else request.log.info(fields, 'request rejected');
    if (mapped.status >= 500 || mapped.status === 401 || mapped.status === 403) reply.header('cache-control', 'no-store');
    return reply.code(mapped.status).type('application/json; charset=utf-8').send(mapped.body);
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(404).type('application/json; charset=utf-8').send(errorBody('NOT_FOUND', 'Not found.'));
  });
}
