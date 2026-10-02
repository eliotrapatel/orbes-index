/**
 * CSV for print shops and workshops (RFC 4180, UTF-8 without BOM, CRLF, a
 * header row, every field quoted): the certificate cards' variable-data file
 * (certificate.ts) and the print sheet's manifest (artifact.ts). The fields
 * and documents come from the core (src/core/render/csv.ts), which the
 * console shares for a batch's results.
 */
export { csvDocument, csvField } from '../../core/render/csv.js';

/** Content type of every CSV download. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8; header=present';
