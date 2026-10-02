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
 */
import { byId, focusFirst, h, mount } from '../shared/dom.js';
import { monogramSvg } from '../shared/monogram.js';
import { AdminApi, ApiError } from './api.js';
import { formatDateTime } from './format.js';
import { can, type Capability } from './model/permissions.js';
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
import { revocationsView } from './views/revocations.js';
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
  { group: 'Clients', items: [{ route: 'owners', label: 'Owners' }, { route: 'warranties', label: 'Warranties' }] },
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
};

const app = byId('app');
const api = new AdminApi();
let session: AdminSession | null = null;
let renderSeq = 0;
/** `forced`: built for the NEW PASSWORD screen of a temporary password, without CHANGE PASSWORD. */
let shell: { root: HTMLElement; view: HTMLElement; nav: HTMLElement; crumb: HTMLElement; forced: boolean } | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

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
  // Every role, at any time (A-02), except on the NEW PASSWORD screen of a temporary password: that
  // screen is the change itself, and a change made beside it would leave the console on a form that
  // asks for the temporary password, which no longer works.
  const forced = s.admin.passwordChangeRequired;
  let password: HTMLElement | null = null;
  if (!forced) {
    password = h('button', { class: 'side__small', attrs: { type: 'button', 'data-testid': 'change-password' } }, 'Change password');
    password.addEventListener('click', () => {
      void openPasswordDialog(api, s).then((changed) => {
        if (!changed) return;
        notify('Password changed. Your other sessions have ended.');
        // Whatever the screen, a changed password is no longer a temporary one.
        if (session?.admin.passwordChangeRequired) {
          session.admin.passwordChangeRequired = false;
          enrolled(href('dashboard'))();
        }
      });
    });
  }
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
  return { root, view, nav, crumb, forced };
}

function ensureShell(s: AdminSession): NonNullable<typeof shell> {
  if (!shell || !app.contains(shell.root)) {
    shell = buildShell(s);
    mount(app, shell.root);
  }
  return shell;
}

function markNav(active: RouteName | null): void {
  if (!shell) return;
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
  setTitle('Sign in');
  mount(
    app,
    loginView(
      api,
      (s) => {
        session = s;
        const r = parseHash(location.hash);
        goTo(r.name === 'login' ? href('dashboard') : location.hash || href('dashboard'));
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
  const r = parseHash(location.hash);
  const s = session;
  if (!s) return showLogin();

  // A temporary password (a staff account created on the Team page): its own password comes first.
  if (s.admin.passwordChangeRequired) {
    if (shell && !shell.forced) shell = null; // a 403 PASSWORD_CHANGE_REQUIRED under a full shell: drop its CHANGE PASSWORD
    const sh = ensureShell(s);
    markNav(null);
    sh.crumb.textContent = 'Account · Password';
    setTitle('New password');
    mount(sh.view, passwordView(api, s, enrolled(href('dashboard'))));
    return;
  }

  // MFA enforced and not passed: an enrolled admin signs in again with the code; others enrol first.
  if (s.mfaRequired && !s.mfaPassed) {
    if (s.admin.totpEnabled) return showLogin('Two-factor authentication is required. Sign in with your code.');
    const sh = ensureShell(s);
    markNav(null);
    sh.crumb.textContent = 'Account · Security';
    setTitle('Security');
    mount(sh.view, securityView(api, s, enrolled(href('dashboard')), { forced: true }));
    return;
  }

  if (r.name === 'login') {
    goTo(href('dashboard'));
    return;
  }

  const sh = ensureShell(s);
  const seq = ++renderSeq;
  const scrollY = opts.keepScroll ? window.scrollY : 0;

  if (r.name === 'security') {
    markNav(null);
    sh.crumb.textContent = 'Account · Security';
    setTitle('Security');
    mount(sh.view, securityView(api, s, enrolled(href('security'))));
    return;
  }

  const entry = r.name === 'not-found' ? undefined : VIEWS[r.name];
  if (!entry) {
    markNav(null);
    sh.crumb.textContent = 'Not found';
    setTitle('Not found');
    mount(sh.view, failure('This page does not exist.'));
    return;
  }
  markNav(entry.nav);
  const group = NAV.find((g) => g.items.some((i) => i.route === entry.nav))?.group ?? '';
  sh.crumb.textContent = r.name === 'product' ? `${group} · Products · ${r.params.productId}` : `${group} · ${entry.title}`;
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
