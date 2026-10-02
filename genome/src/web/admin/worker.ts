/**
 * The console's decoder Web Worker (A-08, the sale mode): the verification
 * app's own worker (verify/worker.ts: an RGBA frame in, ORBES CODE data out,
 * through frame-decoder.ts and the isomorphic core decoder), bundled for
 * /admin by scripts/build-web.ts as `admin-worker-<hash>.js` and named in
 * index.html (`<meta name="orbes-worker">`). The console's main bundle never
 * carries the decoder: views/sale.ts talks to this worker through
 * DecoderClient (verify/scanner.ts). It reads bytes and reports them; the
 * server decides (POST /api/admin/sale/lookup).
 */
import '../verify/worker.js';
