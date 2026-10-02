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
 */
import { byId, focusFirst, h, mount } from '../shared/dom.js';
import { monogramSvg } from '../shared/monogram.js';
import { AdminApi, ApiError } from './api.js';
import { formatDateTime } from './format.js';
import { can, saleOnly, type Capability } from './model/permissions.js';
import { href, parseHash, type Route, type RouteName } from './router.js';
import type { AdminSession } from './types.js';
import { failure, loading } from './ui/components.js';
import { notify, notifyError } from './ui/toast.js';
import { anomaliesView } from './views/anomalies.js';
import { auditView } from './views/audit.js';
import { catalogueView } from './views/catalogue.js';
import { codesView } from './views/codes.js';
import type { View, ViewContext } from './views/context.js';
import { dashboardView } from './views/dashboard.js';
import { generatorView } from './views/generator.js';
import { genomesView } from './views/genomes.js';
import { keysView } from './views/keys.js';
import { loginView } from './views/login.js';
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
  { group: 'Overview', items: [{ route: 'dashboard', label: 'Dashboard' }, { route: 'generator', label: 'Generator', cap: 'issue' }] },
  {
    group: 'Registry',
    items: [
      { route: 'products', label: 'Products' },
      { route: 'genomes', label: 'Genomes' },
      { route: 'codes', label: 'Codes' },
      { route: 'catalogue', label: 'Catalogue' },
    ],
  },
  { group: 'Activity', items: [{ route: 'scans', label: 'Verification events' }, { route: 'anomalies', label: 'Anomalies' }] },
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
  anomalies: { view: anomaliesView, title: 'Anomalies', nav: 'anomalies' },
  owners: { view: ownersView, title: 'Owners', nav: 'owners' },
  warranties: { view: warrantiesView, title: 'Warranties', nav: 'warranties' },
  revocations: { view: revocationsView, title: 'Revocations', nav: 'revocations' },
  keys: { view: keysView, title: 'Keys', nav: 'keys' },
  audit: { view: auditView, title: 'Audit log', nav: 'audit' },
  team: { view: teamView, title: 'Team', nav: 'team' },
  retailers: { view: retailersView, title: 'Points of sale', nav: 'retailers' },
  sale: { view: saleView, title: 'Sale mode', nav: 'sale' },
};

const app = byId('app');
const api = new AdminApi();
let session: AdminSession | null = null;
let renderSeq = 0;
/** The console's sidebar and top bar, or the sale shell of the sale mode (A-08). */
type ShellKind = 'console' | 'sale';
/** `forced`: built for the NEW PASSWORD screen of a temporary password, without CHANGE PASSWORD. The sale shell has no nav or crumb. */
let shell: { kind: ShellKind; root: HTMLElement; view: HTMLElement; nav: HTMLElement | null; crumb: HTMLElement | null; forced: boolean } | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** Where a session starts: the sale mode for a seller, the dashboard otherwise. */
function home(s: AdminSession | null): string {
  return s && saleOnly(s.admin.role) ? href('sale') : href('dashboard');
}

function setTitle(t: string): void {
  document.title = `${t} — ORBES Genome Console`;
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
  return { kind: 'sale', root, view, nav: null, crumb: null, forced: s.admin.passwordChangeRequired };
}

function buildShell(s: AdminSession): NonNullable<typeof shell> {
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
        h('ul', { class: 'side__list' }, ...items.map((i) => h('li', null, h('a', { class: 'side__link', attrs: { href: href(i.route) }, data: { route: i.route } }, i.label)))),
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
  return { kind: 'console', root, view, nav, crumb, forced };
}

function ensureShell(s: AdminSession, kind: ShellKind = 'console'): NonNullable<typeof shell> {
  if (!shell || !app.contains(shell.root) || shell.kind !== kind) {
    shell = kind === 'sale' ? buildSaleShell(s) : buildShell(s);
    mount(app, shell.root);
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
  resetProductViewState();
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
  try {
    await api.logout();
  } catch (e) {
    notifyError(e);
  }
  session = null;
  // An explicit sign-out starts the next session on the dashboard (an expired session resumes where it was).
  history.replaceState(null, '', location.pathname + location.search);
  showLogin();
}

api.onUnauthorized = () => {
  if (!session) return;
  session = null;
  showLogin('Your session has ended. Sign in again.');
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
  if (!s) return showLogin();
  // A seller's console is the sale mode: every screen, its own account's included, is framed by the sale shell.
  const seller = saleOnly(s.admin.role);
  const accountShell: ShellKind = seller ? 'sale' : 'console';

  // A temporary password (a staff account created on the Team page): its own password comes first.
  if (s.admin.passwordChangeRequired) {
    if (shell && !shell.forced) shell = null; // a 403 PASSWORD_CHANGE_REQUIRED under a full shell: drop its CHANGE PASSWORD
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

window.addEventListener('hashchange', () => void route());

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
