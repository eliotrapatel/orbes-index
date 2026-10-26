/**
 * THE VAULT on a LIVE RELEASE's pages (lot Q3, step Q3.10; plan §3.3, §3.4; D50, D51, D65; N28): Q1's `LiveDeps.vault`
 * slot filled. On SOLD OUT for your size (under its sentence, before LEAVE THE LINE) and on the end page of a release
 * sold out whole (under its sentence, before THE RELEASES), the entry's own vault of that release while it waits: its
 * door (vault-box.ts), its opening (vault-opening.ts), OPEN ANOTHER leading to THE VAULT page once it has closed (N3).
 * No vault (the release's switch off, opened or kept past its 30 days elsewhere, a test account, signed out, or not read):
 * its slot stays hidden, nothing is shown and the page is Q1's. The after-room's door carries none (N18).
 */
import { isDesktop, onDesktopChange } from '../../shared/desktop.js';
import type { ApiClient } from '../api.js';
import type { VaultDoorView } from '../types.js';
import type { LiveVault } from '../views/live.js';
import { VAULT } from '../copy.js';
import { giftUrl, iWasThere, parisYmd, revealAction, type VaultOpenedAction } from '../vault-model.js';
import { saveIWasThere } from './i-was-there.js';
import { shareLink } from './share-link.js';
import { vaultBox } from './vault-box.js';
import { VaultOpening, type VaultSound } from './vault-opening.js';

export interface LiveVaultDeps {
  api: Pick<ApiClient, 'liveVault' | 'openVault'>;
  sound: VaultSound;
  /** A refusal's sentence (views/forms.ts messageOf). */
  messageOf(error: unknown): string;
  /** OPEN ANOTHER: THE VAULT page (N3). */
  onVaultPage(): void;
  /** The frame whose rect the pointer is read over (the page on show). */
  surface(): HTMLElement | null;
}

/** THE VAULT for a LIVE RELEASE's page: one per page, its door read once per release. */
export function liveVault(deps: LiveVaultDeps): LiveVault {
  const doors = new Map<string, Promise<VaultDoorView | null>>();
  const door = (dropId: string): Promise<VaultDoorView | null> => {
    let read = doors.get(dropId);
    if (!read) {
      read = deps.api.liveVault(dropId).catch(() => null);
      doors.set(dropId, read);
      // A door not read (offline) is read again at the next page.
      void read.then((d) => {
        if (d === null) doors.delete(dropId);
      });
    }
    return read;
  };
  return {
    waits: async (dropId) => (await door(dropId)) !== null,
    mount(slot, at, ctx) {
      let disposed = false;
      let opening: VaultOpening | null = null;
      let unwatch: (() => void) | null = null;
      const takeDown = (): void => {
        opening?.dispose();
        opening = null;
        unwatch?.();
        unwatch = null;
        slot.classList.remove('has-vault');
        slot.replaceChildren();
        slot.hidden = true;
      };
      if (ctx.entryId) {
        void door(ctx.dropId).then((d) => {
          if (disposed || !d) return;
          const parts = vaultBox(at, !isDesktop());
          slot.replaceChildren(parts.root);
          slot.classList.add('has-vault');
          slot.hidden = false;
          unwatch = onDesktopChange((desktop) => parts.root.classList.toggle('vault-box--phone', !desktop));
          opening = new VaultOpening(parts, {
            open: () => deps.api.openVault(d.id),
            sound: deps.sound,
            surface: deps.surface(),
            messageOf: deps.messageOf,
            // Opened: this release's door is not shown again (N28).
            onOpened: () => doors.set(ctx.dropId, Promise.resolve(null)),
            // SAVE THE IMAGE (I WAS THERE) or GIVE IT (a credit to give) under the box, above OPEN ANOTHER (N33).
            action: (r) => revealButton(revealAction(r, iWasThere('LIVE', d.label, d.detail, parisYmd(d.givenAt)))),
            // OPEN ANOTHER: THE VAULT page; the door it opened is not shown here again (N28).
            onAgain: () => {
              takeDown();
              deps.onVaultPage();
            },
          });
        });
      }
      return () => {
        disposed = true;
        takeDown();
      };
    },
  };
}

/** The reveal's action as a text link under the box (N33): SAVE THE IMAGE saves the card, GIVE IT shares its link. */
function revealButton(a: VaultOpenedAction | null): HTMLElement | null {
  if (!a || a.kind === 'given') return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'textlink vlt__act';
  b.textContent = a.kind === 'save' ? VAULT.page.save : VAULT.page.give;
  b.addEventListener('click', () => {
    if (a.kind === 'save') void saveIWasThere(a.image);
    else
      void shareLink(giftUrl(location.origin, a.code)).then((out) => {
        if (out === 'copied') b.textContent = VAULT.page.copied;
      });
  });
  return b;
}
