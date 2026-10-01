/**
 * ORBES GENOME CODE — public core API.
 *
 * One import site for everything the isomorphic core offers (CONTRACTS.md
 * §1–§8): bytes, geometry, error correction, product identity, the signed
 * CODE-01 payload, GENOME-01, the shared SVG renderer, the CODE-01 encoder
 * and decoder, and Ed25519 verification. Each module directory keeps its own
 * barrel as the authority on what it makes public (the decoder, for one,
 * exposes only its entry points, never its pipeline stages); this file only
 * composes them, so a module's public surface is decided in one place.
 *
 * Isomorphic: no Node.js or DOM dependencies. Server-only code (node:crypto
 * signing, key storage) lives under src/server and is never re-exported here.
 */

export * from './bytes.js';
export * from './geometry.js';
export * from './ecc/index.js';
export * from './identity.js';
export * from './payload.js';
export * from './verify/ed25519.js';
export * from './genome/index.js';
export * from './render/svg.js';
export * from './code/index.js';
export * from './decoder/index.js';
