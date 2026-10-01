/**
 * Approximate geographic centroids of ISO 3166-1 alpha-2 countries and
 * territories (plus the widely used user-assigned XK, Kosovo).
 *
 * Used only for coarse anomaly detection (impossible travel, contract §2.5)
 * when a scan carries a country but no coordinates. Values are rough centres
 * (≈ 0.1°–1° accuracy is plenty: the rules work in hundreds of kilometres);
 * they are not suitable for anything that needs real geography.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

// [lat, lon], degrees. Kept as a compact literal table; frozen into COUNTRY_CENTROIDS below.
const TABLE: Record<string, readonly [number, number]> = {
  AD: [42.55, 1.6], AE: [23.42, 53.85], AF: [33.94, 67.71], AG: [17.06, -61.8], AI: [18.22, -63.07],
  AL: [41.15, 20.17], AM: [40.07, 45.04], AO: [-11.2, 17.87], AQ: [-75.25, -0.07], AR: [-38.42, -63.62],
  AS: [-14.27, -170.13], AT: [47.52, 14.55], AU: [-25.27, 133.78], AW: [12.52, -69.97], AX: [60.18, 19.92],
  AZ: [40.14, 47.58], BA: [43.92, 17.68], BB: [13.19, -59.54], BD: [23.68, 90.36], BE: [50.5, 4.47],
  BF: [12.24, -1.56], BG: [42.73, 25.49], BH: [25.93, 50.64], BI: [-3.37, 29.92], BJ: [9.31, 2.32],
  BL: [17.9, -62.83], BM: [32.32, -64.76], BN: [4.54, 114.73], BO: [-16.29, -63.59], BQ: [12.18, -68.24],
  BR: [-14.24, -51.93], BS: [25.03, -77.4], BT: [27.51, 90.43], BV: [-54.42, 3.41], BW: [-22.33, 24.68],
  BY: [53.71, 27.95], BZ: [17.19, -88.5], CA: [56.13, -106.35], CC: [-12.16, 96.87], CD: [-4.04, 21.76],
  CF: [6.61, 20.94], CG: [-0.23, 15.83], CH: [46.82, 8.23], CI: [7.54, -5.55], CK: [-21.24, -159.78],
  CL: [-35.68, -71.54], CM: [7.37, 12.35], CN: [35.86, 104.2], CO: [4.57, -74.3], CR: [9.75, -83.75],
  CU: [21.52, -77.78], CV: [16.0, -24.01], CW: [12.17, -68.99], CX: [-10.45, 105.69], CY: [35.13, 33.43],
  CZ: [49.82, 15.47], DE: [51.17, 10.45], DJ: [11.83, 42.59], DK: [56.26, 9.5], DM: [15.41, -61.37],
  DO: [18.74, -70.16], DZ: [28.03, 1.66], EC: [-1.83, -78.18], EE: [58.6, 25.01], EG: [26.82, 30.8],
  EH: [24.22, -12.89], ER: [15.18, 39.78], ES: [40.46, -3.75], ET: [9.15, 40.49], FI: [61.92, 25.75],
  FJ: [-16.58, 179.41], FK: [-51.8, -59.52], FM: [7.43, 150.55], FO: [61.89, -6.91], FR: [46.23, 2.21],
  GA: [-0.8, 11.61], GB: [55.38, -3.44], GD: [12.26, -61.6], GE: [42.32, 43.36], GF: [3.93, -53.13],
  GG: [49.47, -2.59], GH: [7.95, -1.02], GI: [36.14, -5.35], GL: [71.71, -42.6], GM: [13.44, -15.31],
  GN: [9.95, -9.7], GP: [17.0, -62.07], GQ: [1.65, 10.27], GR: [39.07, 21.82], GS: [-54.43, -36.59],
  GT: [15.78, -90.23], GU: [13.44, 144.79], GW: [11.8, -15.18], GY: [4.86, -58.93], HK: [22.4, 114.11],
  HM: [-53.08, 73.5], HN: [15.2, -86.24], HR: [45.1, 15.2], HT: [18.97, -72.29], HU: [47.16, 19.5],
  ID: [-0.79, 113.92], IE: [53.41, -8.24], IL: [31.05, 34.85], IM: [54.24, -4.55], IN: [20.59, 78.96],
  IO: [-6.34, 71.88], IQ: [33.22, 43.68], IR: [32.43, 53.69], IS: [64.96, -19.02], IT: [41.87, 12.57],
  JE: [49.21, -2.13], JM: [18.11, -77.3], JO: [30.59, 36.24], JP: [36.2, 138.25], KE: [-0.02, 37.91],
  KG: [41.2, 74.77], KH: [12.57, 104.99], KI: [-3.37, -168.73], KM: [-11.88, 43.87], KN: [17.36, -62.78],
  KP: [40.34, 127.51], KR: [35.91, 127.77], KW: [29.31, 47.48], KY: [19.51, -80.57], KZ: [48.02, 66.92],
  LA: [19.86, 102.5], LB: [33.85, 35.86], LC: [13.91, -60.98], LI: [47.17, 9.56], LK: [7.87, 80.77],
  LR: [6.43, -9.43], LS: [-29.61, 28.23], LT: [55.17, 23.88], LU: [49.82, 6.13], LV: [56.88, 24.6],
  LY: [26.34, 17.23], MA: [31.79, -7.09], MC: [43.75, 7.41], MD: [47.41, 28.37], ME: [42.71, 19.37],
  MF: [18.08, -63.05], MG: [-18.77, 46.87], MH: [7.13, 171.18], MK: [41.61, 21.75], ML: [17.57, -4.0],
  MM: [21.91, 95.96], MN: [46.86, 103.85], MO: [22.2, 113.54], MP: [17.33, 145.38], MQ: [14.64, -61.02],
  MR: [21.01, -10.94], MS: [16.74, -62.19], MT: [35.94, 14.38], MU: [-20.35, 57.55], MV: [3.2, 73.22],
  MW: [-13.25, 34.3], MX: [23.63, -102.55], MY: [4.21, 101.98], MZ: [-18.67, 35.53], NA: [-22.96, 18.49],
  NC: [-20.9, 165.62], NE: [17.61, 8.08], NF: [-29.04, 167.95], NG: [9.08, 8.68], NI: [12.87, -85.21],
  NL: [52.13, 5.29], NO: [60.47, 8.47], NP: [28.39, 84.12], NR: [-0.52, 166.93], NU: [-19.05, -169.87],
  NZ: [-40.9, 174.89], OM: [21.51, 55.92], PA: [8.54, -80.78], PE: [-9.19, -75.02], PF: [-17.68, -149.41],
  PG: [-6.31, 143.96], PH: [12.88, 121.77], PK: [30.38, 69.35], PL: [51.92, 19.15], PM: [46.94, -56.27],
  PN: [-24.7, -127.44], PR: [18.22, -66.59], PS: [31.95, 35.23], PT: [39.4, -8.22], PW: [7.51, 134.58],
  PY: [-23.44, -58.44], QA: [25.35, 51.18], RE: [-21.12, 55.54], RO: [45.94, 24.97], RS: [44.02, 21.01],
  RU: [61.52, 105.32], RW: [-1.94, 29.87], SA: [23.89, 45.08], SB: [-9.65, 160.16], SC: [-4.68, 55.49],
  SD: [12.86, 30.22], SE: [60.13, 18.64], SG: [1.35, 103.82], SH: [-24.14, -10.03], SI: [46.15, 15.0],
  SJ: [77.55, 23.67], SK: [48.67, 19.7], SL: [8.46, -11.78], SM: [43.94, 12.46], SN: [14.5, -14.45],
  SO: [5.15, 46.2], SR: [3.92, -56.03], SS: [6.88, 31.31], ST: [0.19, 6.61], SV: [13.79, -88.9],
  SX: [18.04, -63.07], SY: [34.8, 39.0], SZ: [-26.52, 31.47], TC: [21.69, -71.8], TD: [15.45, 18.73],
  TF: [-49.28, 69.35], TG: [8.62, 0.82], TH: [15.87, 100.99], TJ: [38.86, 71.28], TK: [-8.97, -171.86],
  TL: [-8.87, 125.73], TM: [38.97, 59.56], TN: [33.89, 9.54], TO: [-21.18, -175.2], TR: [38.96, 35.24],
  TT: [10.69, -61.22], TV: [-7.11, 177.65], TW: [23.7, 120.96], TZ: [-6.37, 34.89], UA: [48.38, 31.17],
  UG: [1.37, 32.29], UM: [19.28, 166.65], US: [37.09, -95.71], UY: [-32.52, -55.77], UZ: [41.38, 64.59],
  VA: [41.9, 12.45], VC: [12.98, -61.29], VE: [6.42, -66.59], VG: [18.42, -64.64], VI: [18.34, -64.9],
  VN: [14.06, 108.28], VU: [-15.38, 166.96], WF: [-13.77, -177.16], WS: [-13.76, -172.1], XK: [42.6, 20.9],
  YE: [15.55, 48.52], YT: [-12.83, 45.17], ZA: [-30.56, 22.94], ZM: [-13.13, 27.85], ZW: [-19.02, 29.15],
};

/** Country code → approximate centroid. Frozen. */
export const COUNTRY_CENTROIDS: Readonly<Record<string, Readonly<LatLon>>> = Object.freeze(
  Object.fromEntries(Object.entries(TABLE).map(([code, [lat, lon]]) => [code, Object.freeze({ lat, lon })])),
);

const COUNTRY_RE = /^[A-Z]{2}$/;

/** True for a syntactically valid upper-case alpha-2 code that has a centroid. */
export function isKnownCountry(code: unknown): code is string {
  return typeof code === 'string' && COUNTRY_RE.test(code) && Object.hasOwn(COUNTRY_CENTROIDS, code);
}

/** Approximate centroid of `code` (upper-case alpha-2), or undefined when unknown. */
export function countryCentroid(code: string | null | undefined): LatLon | undefined {
  if (!isKnownCountry(code)) return undefined;
  const c = COUNTRY_CENTROIDS[code];
  return { lat: c.lat, lon: c.lon };
}

/**
 * Rough distance (km) from a country's centroid to its farthest populated
 * edge, for countries where it exceeds the default. Used to turn a
 * centroid-to-centroid distance into a LOWER bound of the real distance
 * (d − rA − rB), so travel between large or elongated countries is only
 * called impossible when even the most favourable placement is. Overseas
 * territories with their own code (GF, RE, PF, …) are not included in
 * their parent's radius.
 */
const RADIUS_KM: Record<string, number> = {
  RU: 3500, CA: 2500, US: 2500, CN: 2500, BR: 2200, AU: 2200, ID: 2700, IN: 1700, AR: 1900, KZ: 1500,
  DZ: 1200, CD: 1200, GL: 1500, SA: 1100, MX: 1500, SD: 1000, LY: 900, IR: 1100, MN: 1100, PE: 1000,
  TD: 900, NE: 900, AO: 800, ML: 1000, ZA: 900, CO: 900, ET: 800, BO: 800, MR: 800, EG: 700,
  TZ: 700, NG: 700, VE: 700, PK: 900, NA: 800, MZ: 1000, TR: 900, CL: 2200, ZM: 700, MM: 1000,
  AF: 700, SS: 700, SO: 900, CF: 700, UA: 700, MG: 800, BW: 600, KE: 600, FR: 600, YE: 700,
  TH: 900, ES: 700, TM: 600, CM: 700, PG: 800, SE: 900, UZ: 800, MA: 900, IQ: 600, PY: 500,
  ZW: 450, JP: 1200, DE: 450, CG: 600, FI: 700, VN: 900, MY: 1000, NO: 1000, CI: 450, PL: 400,
  OM: 600, IT: 700, PH: 1000, EC: 600, BF: 450, NZ: 800, GA: 400, GN: 450, GB: 600, UG: 350,
  GH: 400, RO: 400, LA: 600, GY: 450, BY: 400, KG: 450, SN: 400, SY: 400, KH: 350, UY: 300,
  TN: 450, SR: 300, BD: 400, NP: 500, TJ: 400, GR: 500, NI: 300, KP: 400, MW: 450, ER: 500,
  BJ: 400, HN: 350, LR: 300, BG: 300, CU: 600, GT: 300, IS: 300, KR: 350, HU: 300, PT: 500,
  JO: 300, AT: 350, RS: 300, AE: 300, CZ: 280, IE: 250, GE: 300, LK: 250, LT: 250, LV: 250,
  HR: 400, BA: 250, CR: 250, SK: 250, DO: 250, EE: 250, DK: 300, NL: 200, CH: 200, BT: 200,
  TW: 250, GW: 200, MD: 200, AZ: 300, AM: 150, AL: 200, IL: 250, SB: 600, GQ: 400, HT: 200,
  BZ: 200, NC: 300, FJ: 400, TL: 200, BS: 400, VU: 500, GM: 200, JM: 150, CV: 300, PF: 1500,
  KM: 200, MU: 300, KI: 2000, FM: 1500, MH: 800, TV: 400, PW: 300, CK: 1000, TO: 400, SC: 600,
  MV: 500, AQ: 2000, TF: 1500, GS: 300, UM: 2000, SJ: 500, EH: 600, SL: 200, TG: 300, LS: 150,
  BI: 150, RW: 150, MK: 150, DJ: 150, SV: 150, SI: 150, KW: 150, ME: 150, LB: 150, CY: 150,
};
/** Small countries and territories. */
export const DEFAULT_COUNTRY_RADIUS_KM = 150;

/** Approximate centroid-to-edge distance of `code` in km (default for small or unknown countries). */
export function countryRadiusKm(code: string | null | undefined): number {
  return typeof code === 'string' && Object.hasOwn(RADIUS_KM, code) ? RADIUS_KM[code] : DEFAULT_COUNTRY_RADIUS_KM;
}
