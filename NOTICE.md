# Third-party notices

## IP geolocation data

**IP Geolocation by DB-IP** — <https://db-ip.com>

The ORBES GENOME CODE verification service (`genome/`), when configured with
`GEO_MODE=mmdb`, uses the DB-IP "IP to City Lite" database to derive a coarse
location (country and coordinates rounded to about 10 km) from the client IP
address of a scan. The location is used only for internal anomaly scoring
(impossible travel, geographic dispersion); raw IP addresses are never stored.

- Data: DB-IP.com "IP to City Lite", <https://db-ip.com/db/download/ip-to-city-lite>
- Copyright: © DB-IP.com
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>
- Changes: none to the data. DB-IP publishes a new edition monthly; the VPS
  checks for it weekly (`genome/scripts/geoip-update.ts`, systemd timer
  `orbes-geoip`) and reads it as published; values are rounded at lookup time.

The database file itself is not part of this repository.

## Fonts

**Gravesend Sans Medium** — Rian Hughes / Device, <http://devicefonts.co.uk>

The verification app (`/verify`) and the console (`/admin`) set their
wordmark, titles and labels in Gravesend Sans Medium, the brand's display
face (BRAND-DESIGN-SYSTEM §3.1).

- File: `genome/src/web/shared/fonts/gravesend-sans-500.woff2`, served from
  `/assets/` of the verification service. theorbes.com does not use it; a
  proposal waits for the owner's agreement (`docs/launch/THEORBES-FONT.md`).
- Copyright: © 2019 Rian Hughes / Device. All rights reserved.
- Licence: commercial, not open source. ORBES supplied the font and is
  responsible for holding a web (webfont) licence that covers its use on
  the domains that serve it. The repository carries the file only to build
  these apps; it is not licensed for any other use.
- Repository: the file is committed to this source repository
  (github.com/eliotrapatel/orbes-index), so every clone holds it. Many
  commercial font licences forbid keeping font files in a source repository,
  a public one above all. **To confirm with the owner:** the licence must
  allow it at the repository's visibility. If it does not, keep the
  repository private, or remove the file from it (and from its history) and
  fetch it at build time from a private store. Other sites cannot load the
  font from ours (`Cross-Origin-Resource-Policy: same-origin`, no CORS
  header), so this is a question of licence scope, not of hotlinking.
- Changes: a subset of the supplied OpenType (CFF) file, converted to WOFF2
  with fontTools: Basic Latin and the punctuation the interfaces use, kerning
  kept, other OpenType features removed. The copyright and designer names
  are kept in the file. The command is in BRAND-DESIGN-SYSTEM §3.1.

Helvetica Neue and the other families of the reading stack are not shipped:
they come from the visitor's device.
