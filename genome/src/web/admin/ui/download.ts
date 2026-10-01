/**
 * Saving server artifacts. Downloads are attachments behind the admin
 * cookie, so they are fetched as blobs (with credentials) and handed to the
 * browser through a short-lived object URL rather than a plain link.
 */
import type { Download } from '../api.js';

export function saveDownload(d: Download): void {
  const url = URL.createObjectURL(d.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = d.filename;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed; the download keeps its own reference.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
