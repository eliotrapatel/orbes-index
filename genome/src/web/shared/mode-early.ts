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
