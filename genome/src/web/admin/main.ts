/**
 * ORBES GENOME console — entry point (built by scripts/build-web.ts from
 * src/web/admin/main.ts + index.html).
 *
 * A tiny hash router over async views. The session lives in the httpOnly
 * `orbes_admin` cookie; this script only holds the profile and the CSRF
 * token returned by GET /api/admin/auth/me. A staff account signed in with
 * its temporary password sees only the password change (A-02); then, when
 * the server enforces MFA and this admin has not enrolled, the only
 * reachable screen is enrolment.
 *
 * Two shells: the console (sidebar, top bar) and the sale shell (A-08), a
 * phone-first frame with the sale mode alone in it. A seller (RETAIL) only
 * ever gets the sale shell: the sale mode, its own security page and
 * password, sign-out; any other address leads back to `#/sale`. The other
 * roles open the sale mode from the sidebar and return with CONSOLE.
 *
 * While signed in, the Anomalies link carries a badge, the count of OPEN
 * HIGH and CRITICAL findings (GET /api/admin/anomalies/summary), also
 * prefixed to the tab title as `(3)`: asked on every navigation and every
 * minute while the tab is visible (ui/attention.ts), only by a role that
 * sees the link; the Anomalies view gives the count it reads itself. The
 * refresh is a background request: it never signs the admin out.
 *
 * A view may hold its page (ui/leave-guard.ts: a batch's claim codes not yet
 * saved): navigating away or signing out then asks first. A session that
 * ends while the page is held (a 401) leaves the page on screen, so what it
 * holds can still be saved (the batch's results file is made in the
 * browser); the sign-in comes once the page is left.
 */
import { byId, focusFirst, h, mount } from '../shared/dom.js';
import { monogramSvg } from '../shared/monogram.js';
import { AdminApi, ApiError } from './api.js';
import { formatDateTime } from './format.js';
import { badgeText, consoleTitle } from './model/anomalies.js';
import { can, saleOnly, type Capability } from './model/permissions.js';
import { href, parseHash, type Route, type RouteName } from './router.js';
import type { AdminSession } from './types.js';
import { startAttentionPoll, type AttentionPoll } from './ui/attention.js';
import { failure, loading } from './ui/components.js';
import { confirmLeave, heldMessage, releasePage } from './ui/leave-guard.js';
import { notify, notifyError } from './ui/toast.js';
import { analyticsView } from './views/analytics.js';
import { documentsView, documentView } from './views/documents.js';
import { anomaliesView } from './views/anomalies.js';
import { auditView } from './views/audit.js';
import { casesView } from './views/cases.js';
import { catalogueView } from './views/catalogue.js';
import { codesView, resetCodesViewState } from './views/codes.js';
import type { View, ViewContext } from './views/context.js';
import { dashboardView } from './views/dashboard.js';
import { generatorView } from './views/generator.js';
import { genomesView } from './views/genomes.js';
import { keysView } from './views/keys.js';
import { loginView } from './views/login.js';
import { ownerView } from './views/owner.js';
import { ownersView } from './views/owners.js';
import { openPasswordDialog, passwordView } from './views/password.js';
import { productView, resetProductViewState } from './views/product.js';
import { productsView } from './views/products.js';
import { retailersView } from './views/retailers.js';
import { revocationsView } from './views/revocations.js';
import { disposeSaleView, saleView } from './views/sale.js';
import { scansView } from './views/scans.js';
import { securityView } from './views/security.js';
import { teamView } from './views/team.js';
import { warrantiesView } from './views/warranties.js';

interface NavItem {
  route: RouteName;
  label: string;
  cap?: Capability;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'generator', label: 'Generator', cap: 'issue' },
      { route: 'documents', label: 'Documents' },
    ],
  },
  {
    group: 'Registry',
    items: [
      { route: 'products', label: 'Products' },
      { route: 'genomes', label: 'Genomes' },
      { route: 'codes', label: 'Codes' },
      { route: 'catalogue', label: 'Catalogue' },
    ],
  },
  {
    group: 'Activity',
    items: [
      { route: 'scans', label: 'Verification events' },
      { route: 'anomalies', label: 'Anomalies' },
      { route: 'cases', label: 'Cases' },
      { route: 'analytics', label: 'Analytics' },
    ],
  },
  {
    group: 'Clients',
    items: [
      { route: 'owners', label: 'Owners' },
      { route: 'warranties', label: 'Warranties' },
      { route: 'retailers', label: 'Points of sale' },
      { route: 'sale', label: 'Sale mode', cap: 'sell' },
    ],
  },
  {
    group: 'Security',
    items: [
      { route: 'revocations', label: 'Revocations' },
      { route: 'keys', label: 'Keys' },
      { route: 'audit', label: 'Audit log' },
      { route: 'team', label: 'Team', cap: 'manageAdmins' },
    ],
  },
];

const VIEWS: Partial<Record<RouteName, { view: View; title: string; nav: RouteName }>> = {
  dashboard: { view: dashboardView, title: 'Dashboard', nav: 'dashboard' },
  generator: { view: generatorView, title: 'Generator', nav: 'generator' },
  products: { view: productsView, title: 'Products', nav: 'products' },
  product: { view: productView, title: 'Product', nav: 'products' },
  genomes: { view: genomesView, title: 'Genomes', nav: 'genomes' },
  codes: { view: codesView, title: 'Codes', nav: 'codes' },
  catalogue: { view: catalogueView, title: 'Catalogue', nav: 'catalogue' },
  scans: { view: scansView, title: 'Verification events', nav: 'scans' },
  analytics: { view: analyticsView, title: 'Analytics', nav: 'analytics' },
  anomalies: { view: anomaliesView, title: 'Anomalies', nav: 'anomalies' },
  cases: { view: casesView, title: 'Cases', nav: 'cases' },
  owners: { view: ownersView, title: 'Owners', nav: 'owners' },
  owner: { view: ownerView, title: 'Owner', nav: 'owners' },
  warranties: { view: warrantiesView, title: 'Warranties', nav: 'warranties' },
  revocations: { view: revocationsView, title: 'Revocations', nav: 'revocations' },
  keys: { view: keysView, title: 'Keys', nav: 'keys' },
  audit: { view: auditView, title: 'Audit log', nav: 'audit' },
  team: { view: teamView, title: 'Team', nav: 'team' },
  retailers: { view: retailersView, title: 'Points of sale', nav: 'retailers' },
  sale: { view: saleView, title: 'Sale mode', nav: 'sale' },
  documents: { view: documentsView, title: 'Documents', nav: 'documents' },
  document: { view: documentView, title: 'Document', nav: 'documents' },
};

const app = byId('app');
const api = new AdminApi();
let session: AdminSession | null = null;
let renderSeq = 0;
/** The console's sidebar and top bar, or the sale shell of the sale mode (A-08). */
type ShellKind = 'console' | 'sale';
/**
 * `forced`: built for the NEW PASSWORD screen of a temporary password, without CHANGE PASSWORD. The sale shell has
 * no nav, crumb or badge (`badge`: the count of OPEN HIGH and CRITICAL findings on the Anomalies link).
 */
let shell: {
  kind: ShellKind;
  root: HTMLElement;
  view: HTMLElement;
  nav: HTMLElement | null;
  crumb: HTMLElement | null;
  badge: HTMLElement | null;
  forced: boolean;
} | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let pageTitle = 'Orbes';
/** OPEN HIGH + CRITICAL findings, as last read (0 when signed out). */
let attention = 0;
let attentionPoll: AttentionPoll | null = null;
/** The session ended while a page was held: that page stays until it is left, then the sign-in says why. */
let endedWhileHeld = false;
/** The notice that said so: taken down with the page. */
let endedNotice: HTMLElement | null = null;

const SESSION_ENDED = 'Your session has ended. Sign in again.';
const SESSION_ENDED_HELD =
  'Your session has ended. This page stays open so that you can save what it holds: Download results (CSV) needs no session. Then leave the page to sign in again.';

/** Where a session starts: the sale mode for a seller, the dashboard otherwise. */
function home(s: AdminSession | null): string {
  return s && saleOnly(s.admin.role) ? href('sale') : href('dashboard');
}

function setTitle(t: string): void {
  pageTitle = t;
  document.title = consoleTitle(pageTitle, attention);
}

/** Show the count on the Anomalies link and in the tab title. */
function showAttention(count: number): void {
  attention = count;
  const text = badgeText(count);
  if (shell?.badge) {
    shell.badge.hidden = text === '';
    shell.badge.querySelector('.side__badge-count')!.textContent = text;
  }
  document.title = consoleTitle(pageTitle, attention);
}

/**
 * Start the badge's refresh once signed in (and past MFA), or ask again after a navigation. `viewReads`:
 * the view about to render reads the count itself (Anomalies), so nothing is asked twice.
 */
function watchAttention(viewReads: boolean): void {
  if (attentionPoll) {
    if (!viewReads) void attentionPoll.refresh();
    return;
  }
  const poll: AttentionPoll = startAttentionPoll({
    load: async () => (await api.anomalySummary({ background: true })).attention,
    apply: showAttention,
    immediate: !viewReads,
    // The session ended: the refresh stopped itself; the next navigation starts it again, or meets the ended session.
    onEnded: () => {
      if (attentionPoll === poll) attentionPoll = null;
    },
  });
  attentionPoll = poll;
}

/** Stop the badge's refresh and clear the count it shows (signed out, or back to enrolment). */
function forgetAttention(): void {
  attentionPoll?.stop();
  attentionPoll = null;
  showAttention(0);
}

/** Navigate to `hash`, re-rendering even when it is already current (hashchange would not fire). */
function goTo(hash: string): void {
  if (location.hash === hash) void route();
  else location.hash = hash;
}

/** After enrolment (2FA) or the forced password change the profile changed: rebuild the shell so the sidebar reflects it. */
function enrolled(next: string): () => void {
  return () => {
    shell = null;
    goTo(next);
  };
}

// ── Shell ──────────────────────────────────────────────────────────────────

/** CHANGE PASSWORD, for every role at any time (A-02), except beside the NEW PASSWORD screen of a temporary password. */
function passwordButton(s: AdminSession, className: string): HTMLElement | null {
  // That screen is the change itself, and a change made beside it would leave the console on a form that
  // asks for the temporary password, which no longer works.
  if (s.admin.passwordChangeRequired) return null;
  const password = h('button', { class: className, attrs: { type: 'button', 'data-testid': 'change-password' } }, 'Change password');
  password.addEventListener('click', () => {
    void openPasswordDialog(api, s).then((changed) => {
      if (!changed) return;
      notify('Password changed. Your other sessions have ended.');
      // Whatever the screen, a changed password is no longer a temporary one.
      if (session?.admin.passwordChangeRequired) {
        session.admin.passwordChangeRequired = false;
        enrolled(home(session))();
      }
    });
  });
  return password;
}

/**
 * The sale shell (A-08): the word ORBES over the view, as in the sidebar, the account and its links under it;
 * full width on a phone, a narrow column on a desk. No monogram: like the verification app's scanner, a
 * scanning screen keeps the small word alone (BRAND §3.9).
 */
function buildSaleShell(s: AdminSession): NonNullable<typeof shell> {
  const signOut = h('button', { class: 'saleshell__link', attrs: { type: 'button', 'data-testid': 'sign-out' } }, 'Sign out');
  signOut.addEventListener('click', () => void logout());
  const view = h('main', { class: 'saleshell__view', id: 'view', attrs: { tabindex: '-1' } });
  const root = h(
    'div',
    { class: 'saleshell', data: { testid: 'sale-shell' } },
    h(
      'header',
      { class: 'saleshell__bar' },
      h('a', { class: 'saleshell__brand', attrs: { href: href('sale') } }, h('span', { class: ['wordmark', 'saleshell__wordmark'] }, 'Orbes'), h('span', { class: 'saleshell__mode' }, 'Genome console')),
      can(s.admin.role, 'read') ? h('a', { class: 'saleshell__link', attrs: { href: href('dashboard'), 'data-testid': 'to-console' } }, 'Console') : null,
    ),
    view,
    h(
      'footer',
      { class: 'saleshell__foot' },
      h('p', { class: 'saleshell__who' }, s.admin.email),
      h('p', { class: 'saleshell__role' }, `${s.admin.role}${s.admin.totpEnabled ? ' · 2FA' : ''}`),
      h('div', { class: 'saleshell__links' }, h('a', { class: 'saleshell__link', attrs: { href: href('security') } }, 'Security'), passwordButton(s, 'saleshell__link'), signOut),
    ),
  );
  return { kind: 'sale', root, view, nav: null, crumb: null, badge: null, forced: s.admin.passwordChangeRequired };
}

function buildShell(s: AdminSession): NonNullable<typeof shell> {
  // The count reads in Helvetica Neue inside the display-face link; screen readers hear what it counts.
  const badge = h(
    'span',
    { class: 'side__badge', attrs: { hidden: true, 'data-testid': 'anomaly-badge' } },
    h('span', { class: 'side__badge-count' }),
    h('span', { class: 'visually-hidden' }, ' open HIGH or CRITICAL'),
  );
  const nav = h(
    'nav',
    { class: 'side__nav', attrs: { 'aria-label': 'Console' } },
    ...NAV.map((g) => {
      const items = g.items.filter((i) => !i.cap || can(s.admin.role, i.cap));
      if (items.length === 0) return null;
      return h(
        'div',
        { class: 'side__group' },
        h('p', { class: 'side__group-title' }, g.group),
        h(
          'ul',
          { class: 'side__list' },
          ...items.map((i) => h('li', null, h('a', { class: 'side__link', attrs: { href: href(i.route) }, data: { route: i.route } }, i.label, i.route === 'anomalies' ? badge : null))),
        ),
      );
    }),
  );
  const signOut = h('button', { class: 'side__signout', attrs: { type: 'button', 'data-testid': 'sign-out' } }, 'Sign out');
  signOut.addEventListener('click', () => void logout());
  const forced = s.admin.passwordChangeRequired;
  const password = passwordButton(s, 'side__small');
  const clock = h('span', { class: 'topbar__clock' });
  const tick = () => (clock.textContent = formatDateTime(new Date()));
  tick();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tick, 30_000);

  const crumb = h('span', { class: 'topbar__crumb' });
  const view = h('main', { class: 'main__view', id: 'view', attrs: { tabindex: '-1' } });
  const root = h(
    'div',
    { class: 'console' },
    h(
      'aside',
      { class: 'side' },
      h(
        'a',
        { class: 'side__brand', attrs: { href: href('dashboard') } },
        monogramSvg({ class: 'side__monogram', decorative: true }),
        h('span', { class: ['wordmark', 'side__wordmark'] }, 'Orbes'),
        h('span', { class: 'side__product' }, 'Genome console'),
      ),
      nav,
      h(
        'div',
        { class: 'side__foot' },
        h('p', { class: 'side__who' }, s.admin.email),
        h('p', { class: 'side__role' }, `${s.admin.role}${s.admin.totpEnabled ? ' · 2FA' : ''}`),
        // SECURITY and SIGN OUT on the first line, CHANGE PASSWORD under them: three words do not fit the 184 px of the foot.
        h('div', { class: 'side__foot-links' }, h('a', { class: 'side__small', attrs: { href: href('security') } }, 'Security'), signOut, password),
        h('p', { class: 'side__place' }, 'Paris'),
      ),
    ),
    h('div', { class: 'main' }, h('header', { class: 'topbar' }, crumb, h('span', { class: 'topbar__env' }, 'Internal'), clock), view),
  );
  return { kind: 'console', root, view, nav, crumb, badge, forced };
}

function ensureShell(s: AdminSession, kind: ShellKind = 'console'): NonNullable<typeof shell> {
  if (!shell || !app.contains(shell.root) || shell.kind !== kind) {
    shell = kind === 'sale' ? buildSaleShell(s) : buildShell(s);
    mount(app, shell.root);
    showAttention(attention);
  }
  return shell;
}

function setCrumb(sh: NonNullable<typeof shell>, text: string): void {
  if (sh.crumb) sh.crumb.textContent = text;
}

function markNav(active: RouteName | null): void {
  if (!shell?.nav) return;
  for (const a of Array.from(shell.nav.querySelectorAll<HTMLAnchorElement>('.side__link'))) {
    const on = a.dataset.route === active;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ── Session ────────────────────────────────────────────────────────────────

function showLogin(notice?: string): void {
  renderSeq++;
  shell = null;
  endedWhileHeld = false;
  endedNotice?.remove();
  endedNotice = null;
  // Whatever a view held (a batch's claim codes) left with it.
  releasePage();
  forgetAttention();
  resetProductViewState();
  resetCodesViewState();
  disposeSaleView();
  setTitle('Sign in');
  mount(
    app,
    loginView(
      api,
      (s) => {
        session = s;
        const r = parseHash(location.hash);
        goTo(r.name === 'login' ? home(s) : location.hash || home(s));
      },
      notice ? { notice } : {},
    ),
  );
}

async function logout(): Promise<void> {
  if (!(await confirmLeave())) return;
  // A session that has already ended has nothing to close on the server.
  if (session) {
    try {
      await api.logout();
    } catch (e) {
      notifyError(e);
    }
  }
  session = null;
  // An explicit sign-out starts the next session on the dashboard (an expired session resumes where it was).
  history.replaceState(null, '', location.pathname + location.search);
  showLogin();
}

/**
 * A request answered 401: the session has ended. A held page (a batch's claim codes not yet saved, or
 * a batch being signed) is not replaced: the console says so once and keeps it, so its codes can still
 * be saved with the results file, which the browser makes without the server. Leaving it then asks as
 * ever, and the next view is the sign-in (route()). A request after it is released signs in at once.
 */
api.onUnauthorized = () => {
  if (!session && !endedWhileHeld) return;
  session = null;
  if (heldMessage() !== null) {
    if (!endedWhileHeld) {
      endedWhileHeld = true;
      forgetAttention();
      endedNotice = notify(SESSION_ENDED_HELD, 'error');
    }
    return;
  }
  showLogin(SESSION_ENDED);
};

// ── Routing ────────────────────────────────────────────────────────────────

function makeContext(r: Route, s: AdminSession): ViewContext {
  return {
    api,
    session: s,
    route: r,
    now: () => new Date(),
    navigate: (hash) => {
      location.hash = hash.startsWith('#') ? hash.slice(1) : hash;
    },
    reload: () => void route({ keepScroll: true }),
    attention: (count) => {
      if (attentionPoll) attentionPoll.set(count);
      else showAttention(count);
    },
    setQuery: (q) => {
      const merged: Record<string, string> = { ...r.query };
      for (const [k, v] of Object.entries(q)) {
        if (v === undefined || v === null || v === '') delete merged[k];
        else merged[k] = String(v);
      }
      const qs = Object.entries(merged)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      location.hash = `${r.path}${qs ? `?${qs}` : ''}`;
    },
  };
}

async function route(opts: { keepScroll?: boolean } = {}): Promise<void> {
  // Whatever comes next, the camera of a sale screen being left stops now.
  disposeSaleView();
  const r = parseHash(location.hash);
  const s = session;
  if (!s) return showLogin(endedWhileHeld ? SESSION_ENDED : undefined);
  // A seller's console is the sale mode: every screen, its own account's included, is framed by the sale shell.
  const seller = saleOnly(s.admin.role);
  const accountShell: ShellKind = seller ? 'sale' : 'console';

  // A temporary password (a staff account created on the Team page): its own password comes first.
  if (s.admin.passwordChangeRequired) {
    if (shell && !shell.forced) shell = null; // a 403 PASSWORD_CHANGE_REQUIRED under a full shell: drop its CHANGE PASSWORD
    // The password comes first: the badge's refresh would only be refused (PASSWORD_CHANGE_REQUIRED) meanwhile.
    forgetAttention();
    const sh = ensureShell(s, accountShell);
    markNav(null);
    setCrumb(sh, 'Account · Password');
    setTitle('New password');
    mount(sh.view, passwordView(api, s, enrolled(home(s))));
    return;
  }

  // MFA enforced and not passed: an enrolled admin signs in again with the code; others enrol first.
  if (s.mfaRequired && !s.mfaPassed) {
    if (s.admin.totpEnabled) return showLogin('Two-factor authentication is required. Sign in with your code.');
    // Enrolment comes first: the badge's refresh would only be refused (MFA_REQUIRED) meanwhile.
    forgetAttention();
    const sh = ensureShell(s, accountShell);
    markNav(null);
    setCrumb(sh, 'Account · Security');
    setTitle('Security');
    mount(sh.view, securityView(api, s, enrolled(home(s)), { forced: true }));
    return;
  }

  if (r.name === 'login') {
    goTo(home(s));
    return;
  }
  // Nothing of the registry for a seller (the server refuses it anyway): any other address leads to the sale mode.
  if (seller && r.name !== 'sale' && r.name !== 'security') {
    goTo(href('sale'));
    return;
  }

  const sh = ensureShell(s, seller || r.name === 'sale' ? 'sale' : 'console');
  const seq = ++renderSeq;
  const scrollY = opts.keepScroll ? window.scrollY : 0;
  // Only a role that sees the Anomalies link asks for its count (the Anomalies view reads it itself); never a seller,
  // whose sale shell has no such link.
  if (sh.nav && sh.badge && sh.nav.contains(sh.badge)) watchAttention(r.name === 'anomalies');

  if (r.name === 'security') {
    markNav(null);
    setCrumb(sh, 'Account · Security');
    setTitle('Security');
    mount(sh.view, securityView(api, s, enrolled(href('security'))));
    return;
  }

  const entry = r.name === 'not-found' ? undefined : VIEWS[r.name];
  if (!entry) {
    markNav(null);
    setCrumb(sh, 'Not found');
    setTitle('Not found');
    mount(sh.view, failure('This page does not exist.'));
    return;
  }
  markNav(entry.nav);
  const group = NAV.find((g) => g.items.some((i) => i.route === entry.nav))?.group ?? '';
  setCrumb(sh, r.name === 'product' ? `${group} · Products · ${r.params.productId}` : `${group} · ${entry.title}`);
  setTitle(r.name === 'product' ? r.params.productId : entry.title);
  if (!opts.keepScroll) mount(sh.view, loading());

  try {
    const el = await entry.view(makeContext(r, s));
    if (seq !== renderSeq) return; // a newer navigation won
    mount(sh.view, el);
    if (opts.keepScroll) window.scrollTo(0, scrollY);
    else {
      window.scrollTo(0, 0);
      focusFirst(sh.view);
    }
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e instanceof ApiError && e.status === 401) return; // onUnauthorized already showed the login
    if (e instanceof ApiError && e.code === 'MFA_REQUIRED') {
      s.mfaPassed = false;
      return void route();
    }
    if (e instanceof ApiError && e.code === 'PASSWORD_CHANGE_REQUIRED') {
      s.admin.passwordChangeRequired = true;
      return void route();
    }
    const message = e instanceof ApiError ? (e.status === 404 ? 'Not found in the registry.' : e.message) : 'The console could not render this page.';
    mount(sh.view, failure(message, () => void route()));
  }
}

/**
 * A navigation away from a held page (a batch's claim codes not yet saved) is put back until the
 * admin chooses: staying keeps the page as it was; leaving releases it and goes where they asked.
 */
async function navigated(ev: HashChangeEvent): Promise<void> {
  if (heldMessage() === null) return route();
  const target = location.hash;
  history.replaceState(null, '', ev.oldURL);
  if (await confirmLeave()) location.hash = target;
}

window.addEventListener('hashchange', (ev) => void navigated(ev));

async function boot(): Promise<void> {
  mount(app, loading('Orbes'));
  try {
    session = await api.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return showLogin();
    mount(app, failure(e instanceof ApiError ? e.message : 'The console could not start.', () => void boot()));
    return;
  }
  await route();
}

void boot();
