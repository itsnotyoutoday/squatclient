import data from './functions.generated.json';

/** Function names harvested from the game's help files by `npm run gen:functions` (lowercase, sorted). */
export const FUNCTION_NAMES: readonly string[] = data.functions;
export const FUNCTION_SOURCES: readonly string[] = data.sources;

const known = new Set<string>(FUNCTION_NAMES);

/** Case-insensitive membership test (MUSH function names are case-insensitive). */
export function isKnownFunction(name: string): boolean {
  return known.has(name.toLowerCase());
}
