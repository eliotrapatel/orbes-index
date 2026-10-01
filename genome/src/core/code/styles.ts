/**
 * Brand presentations of ORBES CODE-01 (ink on paper), BRAND-DESIGN-SYSTEM
 * §2.4 and ORBES-CODE-SPEC §8.3.
 *
 * A module of its own (no encoder, no ECC) so that screens which only need a
 * colourway — the GENOME on the ivory plates of /verify and the console —
 * can import it without pulling the encoder into their bundle.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */
import type { SvgStyle } from '../render/svg.js';

export const ORBES_CODE_STYLES = {
  /** Black on white, the reference rendition. */
  classic: { ink: '#0A0A0A', paper: '#FFFFFF' },
  /** White on black; decoders must enable inverted reading. */
  inverted: { ink: '#FFFFFF', paper: '#0A0A0A' },
  /** Soft black on ivory, for paper goods and leather tags (and the GENOME on ivory plates on screen). */
  ivory: { ink: '#111111', paper: '#F6F2EA' },
} as const satisfies Record<string, SvgStyle>;
