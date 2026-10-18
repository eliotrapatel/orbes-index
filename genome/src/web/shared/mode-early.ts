/**
 * The light mode before the first paint (shared/mode.ts): a page's `mode.ts` entry is loaded by a plain `<script>` in
 * the shell's head, before its stylesheet, so a collector who chose LIGHT MODE never sees the dark ground first.
 * Self-contained on purpose (no import, no name left on the page): the key and the value are shared/prefs.ts
 * MODE_PREF_KEY and MODE_LIGHT, the colour shared/mode.ts MODE_THEME_COLOURS.light (test/web/verify.mode.test.ts).
 * A storage that cannot be read leaves the default, dark.
 */
(() => {
  try {
    if (localStorage.getItem('orbes.mode') !== 'light') return;
    document.documentElement.dataset.mode = 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff');
  } catch {
    /* the default */
  }
})();

/*
 * Desktop (BRIEF §4; shared/desktop.ts): before the first paint, a phone or a tablet (Q2: an Android, iOS or iPadOS
 * device, a tablet with its keyboard or trackpad included, one whose Chrome asks for the computer's site among them, or a
 * screen whose main pointer is a finger) is marked
 * `html.d-touch`, which every rule of shared/desktop.css excludes, so it keeps the phone layout even where it answers
 * the desktop's media query as a computer would; a computer with a touch screen is marked `html.d-tap` (its desktop
 * controls' hit areas reach 44 px); and scrollbars that take room are marked `html.d-scrollbars` (desktop.css keeps
 * their gutter then, so the centred menu never shifts). The test is shared/desktop.ts `phoneOrTablet`, written again
 * here (test/web/desktop.switch.test.ts runs both on the same devices).
 */
(() => {
  const root = document.documentElement;
  try {
    const n = navigator as Navigator & { userAgentData?: { platform?: string } };
    const ua = n.userAgent || '';
    const points = n.maxTouchPoints || 0;
    const phone =
      /^(android|ios|ipados)$/i.test(n.userAgentData?.platform || '') ||
      /Android|iPhone|iPad|iPod/i.test(ua) ||
      ((/Macintosh/i.test(ua) || n.platform === 'MacIntel') && points > 0) ||
      (/^Linux (arm|aarch64)/i.test(n.platform || '') && !/CrOS/.test(ua) && points > 0) ||
      matchMedia('(pointer: coarse)').matches;
    if (phone) root.classList.add('d-touch');
    else if (points > 0) root.classList.add('d-tap');
  } catch {
    /* a computer */
  }
  // Scrollbars that take room (a mouse, or "always show"): the page keeps their gutter, so the centred menu never
  // shifts between a short page and a long one (BRIEF §10.20). Overlay scrollbars (a trackpad) take none, and neither
  // does a browser that hides them: no empty gutter is kept for those.
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden';
    root.appendChild(probe);
    if (probe.offsetWidth - probe.clientWidth > 0) root.classList.add('d-scrollbars');
    probe.remove();
  } catch {
    /* no gutter */
  }
})();
