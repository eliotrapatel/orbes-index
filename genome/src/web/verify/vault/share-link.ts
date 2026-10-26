/**
 * INVITE A FRIEND and GIVE IT (lot Q3, step Q3.11; plan §3.5, §3.10; N10, N33): a link handed to the device's share
 * sheet where it has one (the link alone, titled ORBES), else copied. A share sheet the collector closes is left at that;
 * a refused share copies instead. Nothing is sent to ORBES but the link's own reading by the friend.
 */
import { VAULT } from '../copy.js';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The parts of navigator a share uses (the tests' stand-in). */
export interface LinkNavigator {
  share?(data: ShareData): Promise<void>;
  canShare?(data: ShareData): boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export async function shareLink(url: string, nav: LinkNavigator = navigator as LinkNavigator): Promise<ShareOutcome> {
  const data: ShareData = { title: VAULT.share.title, url };
  let can = false;
  try {
    can = typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data));
  } catch {
    can = false;
  }
  if (can) {
    try {
      await nav.share!(data);
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (!nav.clipboard) return 'failed';
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
