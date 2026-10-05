/**
 * The sentence a form of the verification app shows under its fields when a request fails (views/forms.ts): the
 * network, the rate limit, an ended session, a 5xx, else the server's own words. A wrong email or password at
 * sign-in is a 401 as well, and must read as the server wrote it, not as an ended session.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/web/verify/api.js';
import { REQUEST_ERRORS } from '../../src/web/verify/copy.js';
import { messageOf } from '../../src/web/verify/views/forms.js';

describe('the sentence of a failed form request', () => {
  it('says a wrong email or password as the server words it, never as an ended session', () => {
    expect(messageOf(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'))).toBe('Invalid email or password.');
  });

  it('says any other 401 is an ended session', () => {
    expect(messageOf(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe('Your session has ended. Please sign in again.');
  });

  it('says the network, the rate limit and a server failure in its own words, and a refusal in the server\'s', () => {
    expect(messageOf(new ApiError(0, 'NETWORK', 'offline'))).toBe(REQUEST_ERRORS.network);
    expect(messageOf(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(REQUEST_ERRORS.rateLimited);
    expect(messageOf(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toBe('This could not be completed just now. Please try again in a moment.');
    expect(messageOf(new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.'))).toBe('An account with this email already exists.');
    expect(messageOf(new Error('boom'))).toBe('This could not be completed. Please try again.');
  });
});
