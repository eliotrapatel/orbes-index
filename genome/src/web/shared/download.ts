/**
 * Saving a file the server answered as an attachment (a code artifact in the
 * console, an ownership certificate's PDF in the verify app). Such answers
 * are fetched as blobs (with the page's credentials) and handed to the
 * browser through a short-lived object URL rather than a plain link.
 */
export function saveDownload(d: { blob: Blob; filename: string; contentType?: string }): void {
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
