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
- Changes: none to the data. It is downloaded monthly
  (`genome/scripts/geoip-update.ts`) and read as published; values are
  rounded at lookup time.

The database file itself is not part of this repository.
