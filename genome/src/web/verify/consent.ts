/**
 * The advertising choice in the collector app (lot M4 plan §3.3, §3.4; macro scope K27 A4): what the consent banner
 * (views/consent-banner.ts) and YOUR PROFILE's ADVERTISING MEASUREMENT (views/account.ts) answer, and the ad platforms'
 * click ids the page load's address carried (arrival.ts readClicks), held in memory only until the choice is known.
 *
 *   start    once the first screen is drawn (main.ts App.start, never on a boutique board), GET /api/v1/consent:
 *              off            the click ids dropped, the address left exactly as it is: nothing shown, nothing sent (today);
 *              on, GRANTED    the click ids sent once with the choice repeated (POST /api/v1/consent's `clicks`), then
 *                             taken out of the address (arrival.ts cleanClicks);
 *              on, DECLINED   the click ids dropped and taken out of the address;
 *              on, no choice  the click ids kept in memory, the banner wanted (bannerWanted): ACCEPT sends them,
 *                             DECLINE drops them, each then taking them out of the address.
 *            A request that fails or answers what this app cannot read: as off (nothing shown, nothing sent).
 *   choose   the banner's answer (POST /api/v1/consent): thrown when it could not be saved (the banner says so and keeps
 *            the click ids for the next try); 409 ADS_OFF (switched off meanwhile): as off.
 *   chosen   YOUR PROFILE's switch saved (PUT /api/v1/account/ads-consent): the banner gone, the click ids dropped and
 *            taken out of the address (that switch carries none).
 *   session  a sign-in or a sign-out: the choice read again (the account's own, the server carrying the device's at
 *            sign-up and sign-in), only while on.
 *
 * Nothing is written to storage. The automated-browser rule of the recording (seen.ts) is not this one's: the choice is
 * the collector's own act, asked in tests with the switch on. The API, the address and the history are parameters, so it
 * is tested with plain stubs (test/web/verify-arrival.test.ts).
 */
import type { ApiClient } from './api.js';
import { ApiError } from './api.js';
import { cleanClicks, hasClicks, type AdClicks, type ArrivalHistory, type ArrivalLocation } from './arrival.js';
import type { AdsChoice, AdsConsentState } from './types.js';

/**
 * The screens the banner never covers (plan §3.4): the LIVE RELEASE's page (its room, its queue, SOLD OUT's vault door and
 * the screens before and after it), the scanner and what follows a scan on its own screen (VERIFYING…, a problem of the
 * scan, a computer's SCAN page), a certificate, the password reset, the boutique board, THE VAULT page and its openings
 * (the legal pages are another app). It waits for the next other screen.
 */
export const CONSENT_NEVER_ON: readonly string[] = Object.freeze(['live', 'scan', 'verifying', 'message', 'scanPage', 'certificate', 'reset', 'board', 'vault']);

/** Whether the banner may stand on `screen` (none before the first screen). */
export const consentScreenAllowed = (screen: string | null): boolean => screen !== null && screen !== '' && !CONSENT_NEVER_ON.includes(screen);

export interface AdsConsentDeps {
  api: Pick<ApiClient, 'consent' | 'chooseConsent'>;
  /** The address as it stands when a choice is known (the router may have moved it since the page loaded). */
  location(): Pick<ArrivalLocation, 'pathname' | 'search' | 'hash'>;
  history: ArrivalHistory;
  /** Told whenever bannerWanted may have changed. */
  onChange(): void;
}

export class AdsConsent {
  private deps: AdsConsentDeps | null = null;
  /** The click ids the page load's address carried, in memory only; null once sent or dropped. */
  private clicks: AdClicks | null = null;
  private state: AdsConsentState | null = null;
  /** Bumped on each read: an older answer is dropped. */
  private gen = 0;
  private readied: () => void = () => {};
  /**
   * Settled once the choice was first read (or found unreadable): YOUR PROFILE asks the account's choice only while on,
   * so a collector never makes that request while conversions are switched off.
   */
  readonly ready: Promise<void> = new Promise<void>((resolve) => (this.readied = resolve));

  /** The click ids held (tests: what is still in memory). */
  get held(): AdClicks | null {
    return this.clicks ? { ...this.clicks } : null;
  }

  /** Whether conversions are switched on, as last read (false until read). */
  get on(): boolean {
    return this.state?.on === true;
  }

  /** The banner is wanted: switched on and no choice held. */
  get bannerWanted(): boolean {
    return this.state?.on === true && this.state.choice === null;
  }

  /** The page load's click ids (arrival.ts readClicks), held until the choice is read. */
  hold(clicks: AdClicks): void {
    this.clicks = hasClicks(clicks) ? { ...clicks } : null;
  }

  /** Read the choice and act on the click ids (see the header). Never thrown. */
  async start(deps: AdsConsentDeps): Promise<void> {
    this.deps = deps;
    await this.read();
  }

  /** A sign-in or a sign-out: the choice read again while on (the banner follows the account's). Never thrown. */
  async session(): Promise<void> {
    if (!this.deps || !this.on) return;
    await this.read();
  }

  private async read(): Promise<void> {
    const deps = this.deps;
    if (!deps) return;
    const gen = ++this.gen;
    let state: AdsConsentState;
    try {
      state = await deps.api.consent();
    } catch {
      if (gen !== this.gen) return;
      // Unknown: as off, nothing shown or sent (the address untouched).
      this.state = null;
      this.clicks = null;
      this.readied();
      deps.onChange();
      return;
    }
    if (gen !== this.gen) return;
    this.state = state;
    this.readied();
    if (!state.on) {
      // Off: dropped, the address left as it is.
      this.clicks = null;
    } else if (state.choice === 'DECLINED') {
      this.drop();
    } else if (state.choice === 'GRANTED') {
      const clicks = this.clicks;
      this.drop();
      // Sent once, the choice repeated; a failure is not tried again (they are never stored here).
      if (hasClicks(clicks)) await deps.api.chooseConsent('GRANTED', clicks).catch(() => undefined);
    }
    deps.onChange();
  }

  /**
   * The banner's ACCEPT or DECLINE: ACCEPT sends the click ids held, DECLINE drops them; once saved, taken out of the
   * address and the banner gone. Thrown when it could not be saved (the click ids kept for another try).
   */
  async choose(choice: AdsChoice): Promise<void> {
    const deps = this.deps;
    if (!deps) return;
    this.gen++;
    try {
      this.state = await deps.api.chooseConsent(choice, choice === 'GRANTED' ? this.clicks : null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ADS_OFF') {
        // Switched off meanwhile: as off, the banner gone, nothing more sent.
        this.state = { on: false, choice: null, textVersion: this.state?.textVersion ?? '' };
        this.clicks = null;
        deps.onChange();
        return;
      }
      throw e;
    }
    this.drop();
    deps.onChange();
  }

  /** YOUR PROFILE's ADVERTISING MEASUREMENT saved as `choice`: the banner gone, the click ids dropped. */
  chosen(choice: AdsChoice): void {
    if (!this.state?.on) return;
    this.gen++;
    this.state = { ...this.state, choice };
    this.drop();
    this.deps?.onChange();
  }

  /** The click ids forgotten and taken out of the address (switched on, a choice made). */
  private drop(): void {
    this.clicks = null;
    if (this.deps) cleanClicks(this.deps.location(), this.deps.history);
  }
}

/** The app's one advertising choice (main.ts starts it; YOUR PROFILE's switch tells it). */
export const adsConsent = new AdsConsent();
