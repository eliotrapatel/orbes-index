/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. Check value for ASCII "123456789" is 0x29B1.
 *
 * Used after Reed-Solomon decoding to catch the rare miscorrection (a damaged
 * read that lands on a different valid RS codeword) before any signature work.
 */

const POLY = 0x1021;

/** Table of the CRC of every byte value shifted into the high byte of the register. */
const TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let b = 0; b < 256; b++) {
    let crc = b << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ POLY : crc << 1;
    table[b] = crc;
  }
  return table;
})();

export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ TABLE[(crc >>> 8) ^ bytes[i]]) & 0xffff;
  return crc;
}
