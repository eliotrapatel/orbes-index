/**
 * The countries each location serves, in the console (macro scope of 2026-10-20, K11 Z1; plan MACRO M3 §3.3, step
 * M3.7): pure helpers, no DOM, for Orders → Settings → Locations (views/settings.ts). SERVES names them in English,
 * alphabetically; Edit countries (ADMIN) chooses them one by one, and a country another location serves is said to move
 * here before it is saved and in the toast after (PUT /api/admin/locations/:id/countries answers `moved`). The server
 * stays the authority (services/stock.ts setLocationCountries).
 */
import { COUNTRY_CODES, countryName } from '../../../shared/countries.js';
import type { LocationCountriesResult, StockLocation } from '../types.js';

export const LOCATION_COUNTRIES_TEXT = Object.freeze({
  lead: 'A collector counts at the location that serves their country when ORBES orders a model by size. A country no location serves counts at the default location.',
  serves: 'Serves',
  edit: 'Edit countries',
  title: 'The countries it serves',
  body: 'Its collectors count here when ORBES orders a model by size: their default address’s country, else their profile’s. A country is served by one location at most.',
  add: 'Add a country',
  addPlaceholder: 'Choose a country',
  chosen: 'Countries',
  none: 'None: its collectors count at the default location.',
  noneDefault: 'None chosen: as the default location, it counts every country no other location serves.',
  saved: 'Countries saved.',
});

const byName = (a: string, b: string) => countryName(a).localeCompare(countryName(b), 'en');

/** A location's countries as SERVES names them: English names, alphabetically. */
export function servedNames(codes: readonly string[]): string[] {
  return [...codes].sort(byName).map(countryName);
}

/** The Add a country select: the placeholder, then every country not chosen yet, by name. */
export function countryAddOptions(chosen: readonly string[]): { value: string; label: string }[] {
  const taken = new Set(chosen);
  return [
    { value: '', label: LOCATION_COUNTRIES_TEXT.addPlaceholder },
    ...COUNTRY_CODES.filter((c) => !taken.has(c))
      .map((c) => ({ value: c, label: countryName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
  ];
}

/** The countries chosen here that another location serves now: they move here once saved. */
export function countriesMovingHere(chosen: readonly string[], location: Pick<StockLocation, 'id'>, all: readonly Pick<StockLocation, 'id' | 'name' | 'countries'>[]): LocationCountriesResult['moved'] {
  return [...chosen].sort(byName).flatMap((country) => {
    const from = all.find((l) => l.id !== location.id && l.countries.includes(country));
    return from ? [{ country, from: { id: from.id, name: from.name } }] : [];
  });
}

/** « Belgium and Luxembourg » / « Belgium, Germany and Luxembourg ». */
function namesList(codes: readonly string[]): string {
  const names = codes.map(countryName);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The moved countries, a sentence per location they leave: « Belgium moves here from LOGISTICS WAREHOUSE. » */
function movedSentences(moved: LocationCountriesResult['moved'], verb: { one: string; many: string }): string[] {
  const from = new Map<string, { name: string; codes: string[] }>();
  for (const m of moved) {
    const g = from.get(m.from.id) ?? { name: m.from.name, codes: [] };
    g.codes.push(m.country);
    from.set(m.from.id, g);
  }
  return [...from.values()].map((g) => `${namesList(g.codes)} ${g.codes.length === 1 ? verb.one : verb.many} here from ${g.name}.`);
}

/** Said in Edit countries before saving: what moves here, or null. */
export function movingLine(moved: LocationCountriesResult['moved']): string | null {
  return moved.length ? movedSentences(moved, { one: 'moves', many: 'move' }).join(' ') : null;
}

/** The toast once saved: « Countries saved. Belgium moved here from LOGISTICS WAREHOUSE. » */
export function countriesSavedToast(moved: LocationCountriesResult['moved']): string {
  return [LOCATION_COUNTRIES_TEXT.saved, ...movedSentences(moved, { one: 'moved', many: 'moved' })].join(' ');
}

/** Whether two lists hold the same countries, whatever their order. */
export function sameCountries(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  return x.size === new Set(b).size && b.every((c) => x.has(c));
}
