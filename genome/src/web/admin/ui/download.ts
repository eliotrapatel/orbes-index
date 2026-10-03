/**
 * Saving server artifacts. Downloads are attachments behind the admin
 * cookie, so they are fetched as blobs (with credentials) and handed to the
 * browser through a short-lived object URL rather than a plain link: the
 * helper the verify app shares (shared/download.ts).
 */
export { saveDownload } from '../../shared/download.js';
