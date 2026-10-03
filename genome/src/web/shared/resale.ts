/**
 * The second-hand guidance (J-02), the notice under AUTHENTIC — REGISTERED. Once a piece is registered, every copy of
 * its code reads AUTHENTIC — REGISTERED as well (BRAND §4.6): only a transfer code, which the registered owner alone
 * can create, shows that the seller holds the registration. Never on OWNERSHIP VERIFIED (the viewer's own piece) nor
 * on FIRST REGISTRATION (no owner yet, so no transfer code can exist). The same sentence, word for word, is on the
 * certificate card's verso and in the FAQ (docs/launch/PACKAGING-KIT.md §3, checked by its test): changing it here
 * means changing it there.
 *
 * Shared by the verification app (verify/copy.ts exports it, view-model.ts shows it) and the FAQ of the legal pages
 * (legal/content/faq.ts, J-06), which answers BUYING A PIECE SECOND-HAND? with this very sentence.
 */
export const RESALE_GUIDANCE =
  'Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.';
