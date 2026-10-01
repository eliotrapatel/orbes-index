/**
 * Domain errors: the only errors whose message may reach a client.
 *
 * `publicMessage` is written for end users and must never contain internal
 * state (risk scores, thresholds, raw statuses, SQL, stack traces). Anything
 * diagnostic goes in `internal`, which the HTTP layer logs but never returns.
 */

export class DomainError extends Error {
  override readonly name = 'DomainError';

  /**
   * @param code          stable machine-readable code, UPPER_SNAKE (e.g. 'NOT_FOUND')
   * @param httpStatus    status the HTTP layer answers with (4xx; 5xx only for deliberate unavailability)
   * @param publicMessage safe, client-facing message
   * @param internal      optional diagnostic context — logged, never serialised to clients
   */
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly publicMessage: string,
    readonly internal?: { detail?: string; cause?: unknown; [k: string]: unknown },
  ) {
    super(publicMessage, internal?.cause !== undefined ? { cause: internal.cause } : undefined);
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new TypeError(`DomainError code must be UPPER_SNAKE: ${code}`);
    if (!Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) {
      throw new TypeError(`DomainError httpStatus must be 4xx/5xx: ${httpStatus}`);
    }
  }

  /** The exact body the API returns for this error. */
  toResponse(): { error: { code: string; message: string } } {
    return { error: { code: this.code, message: this.publicMessage } };
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

// Shorthands for the common cases, so codes and statuses stay consistent across services.

export const badRequest = (code: string, message: string, detail?: string): DomainError =>
  new DomainError(code, 400, message, detail ? { detail } : undefined);

export const validationError = (message = 'The request is invalid.', detail?: string): DomainError =>
  new DomainError('VALIDATION_FAILED', 400, message, detail ? { detail } : undefined);

export const unauthorized = (message = 'Authentication required.'): DomainError =>
  new DomainError('UNAUTHORIZED', 401, message);

export const forbidden = (message = 'You are not allowed to perform this action.'): DomainError =>
  new DomainError('FORBIDDEN', 403, message);

export const notFound = (what = 'Resource', code = 'NOT_FOUND'): DomainError =>
  new DomainError(code, 404, `${what} not found.`);

export const conflict = (code: string, message: string, detail?: string): DomainError =>
  new DomainError(code, 409, message, detail ? { detail } : undefined);

export const tooManyRequests = (message = 'Too many attempts. Please try again later.'): DomainError =>
  new DomainError('RATE_LIMITED', 429, message);
