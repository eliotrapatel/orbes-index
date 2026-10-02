/**
 * Holding a page while leaving it would lose something that exists nowhere
 * else: the claim codes of a batch, shown once, until they are saved.
 *
 * While a page is held, the browser asks before the tab is closed or
 * reloaded (`beforeunload`), and the console asks, in its own dialog,
 * before another view replaces it: main.ts calls `confirmLeave` on every
 * navigation (hashchange) and on sign-out, and a view's own "start again"
 * does too. Leaving anyway, or saving what was held, releases the page.
 */
import { h } from '../../shared/dom.js';
import { openDialog } from './dialog.js';

let held: string | null = null;

function onBeforeUnload(ev: BeforeUnloadEvent): void {
  ev.preventDefault();
  // Older engines show their prompt only when returnValue is set; its text is the browser's own.
  ev.returnValue = '';
}

/** Hold the page with the message the console's dialog shows; returns the release. */
export function holdPage(message: string): () => void {
  if (held === null) window.addEventListener('beforeunload', onBeforeUnload);
  held = message;
  return releasePage;
}

/** Nothing would be lost any more (saved, hidden, or the session ended). */
export function releasePage(): void {
  if (held === null) return;
  held = null;
  window.removeEventListener('beforeunload', onBeforeUnload);
}

/** What leaving would lose now, or null. */
export function heldMessage(): string | null {
  return held;
}

/**
 * True when the page may be left: nothing is held, or the admin chose to
 * leave anyway (the page is then released). False: the admin stays.
 */
export async function confirmLeave(): Promise<boolean> {
  const message = held;
  if (message === null) return true;
  const ok = await openDialog({
    title: 'Leave this page?',
    eyebrow: 'Claim codes',
    body: h('p', { class: 'dialog__text' }, message),
    confirmLabel: 'Leave',
    cancelLabel: 'Stay',
    danger: true,
  });
  if (ok === null) return false;
  releasePage();
  return true;
}
