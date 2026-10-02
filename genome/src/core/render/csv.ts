/**
 * CSV for print shops and workshops (RFC 4180, UTF-8 without BOM, CRLF, a
 * header row, every field quoted): the certificate cards' variable-data file
 * and the print sheet's manifest (src/server/render), and the results of a
 * batch issued in the console (src/web/admin/model/generator.ts). It lives in
 * the core because the console bundles it and the production image ships
 * src/core and src/server only.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

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
