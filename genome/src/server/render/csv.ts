/**
 * CSV for print shops and workshops (RFC 4180, UTF-8 without BOM, CRLF, a
 * header row, every field quoted): the certificate cards' variable-data file
 * (certificate.ts) and the print sheet's manifest (artifact.ts).
 */

/** Content type of every CSV download. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8; header=present';

/**
 * One CSV field: always quoted (RFC 4180), and a value a spreadsheet would
 * read as a formula (= + - @, tab, carriage return) is prefixed with an
 * apostrophe, so opening the file never runs anything.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Rows (the first one is the header) as a CSV document, CRLF-terminated. */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
