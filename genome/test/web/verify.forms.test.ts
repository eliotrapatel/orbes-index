/**
 * The sentence a form of the verification app shows under its fields when a request fails (views/forms.ts): the
 * network, the rate limit, an ended session, a 5xx, else the server's own words. A wrong email or password at
 * sign-in is a 401 as well, and must read as the server wrote it, not as an ended session.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/web/verify/api.js';
import { REQUEST_ERRORS, SIGN_UP } from '../../src/web/verify/copy.js';
import { messageOf, MIN_PASSWORD, signUpProblem } from '../../src/web/verify/views/forms.js';

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

describe('CREATE ACCOUNT\'s checks before it is sent (plan CUSTOMER INTELLIGENCE §3.1 P.4.1, P.7)', () => {
  const ok = { firstName: 'Camille', lastName: 'Laurent', email: 'camille@example.com', password: 'correct horse battery', country: 'FR' };

  it('sends a form with both names, an email, a password of 12 characters or more and a country', () => {
    expect(signUpProblem(ok)).toBeNull();
    expect(signUpProblem({ ...ok, password: 'x'.repeat(MIN_PASSWORD) })).toBeNull();
    // Names in any script, with accents: the server is the judge of the rest.
    expect(signUpProblem({ ...ok, firstName: 'Zoë', lastName: '王' })).toBeNull();
  });

  it('says each missing field in the collector\'s words, naming the field to correct', () => {
    expect(signUpProblem({ ...ok, firstName: '   ' })).toEqual({ message: 'Enter your first name.', field: 'firstName' });
    expect(signUpProblem({ ...ok, lastName: '' })).toEqual({ message: 'Enter your last name.', field: 'lastName' });
    expect(signUpProblem({ ...ok, email: ' ' })).toEqual({ message: 'Enter your email address.', field: 'email' });
    expect(signUpProblem({ ...ok, password: 'too short' })).toEqual({ message: `Choose a password of at least ${MIN_PASSWORD} characters.`, field: 'password' });
    expect(signUpProblem({ ...ok, country: '' })).toEqual({ message: 'Choose your country.', field: 'country' });
    // Not a country of the list (a code the select never offers).
    expect(signUpProblem({ ...ok, country: 'EU' })).toEqual({ message: SIGN_UP.noCountry, field: 'country' });
    expect([SIGN_UP.noFirstName, SIGN_UP.noLastName, SIGN_UP.noCountry]).toEqual(['Enter your first name.', 'Enter your last name.', 'Choose your country.']);
  });

  it('checks in the form\'s order: the first name, the last name, the email, the password, then the country', () => {
    const empty = { firstName: '', lastName: '', email: '', password: '', country: '' };
    const order: string[] = [];
    let v = { ...empty };
    for (const [field, value] of [['firstName', 'Camille'], ['lastName', 'Laurent'], ['email', 'camille@example.com'], ['password', 'correct horse battery'], ['country', 'FR']] as const) {
      order.push(signUpProblem(v)!.field);
      v = { ...v, [field]: value };
    }
    expect(order).toEqual(['firstName', 'lastName', 'email', 'password', 'country']);
    expect(signUpProblem(v)).toBeNull();
  });
});
