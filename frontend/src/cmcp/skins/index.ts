import type { Skin } from './types';
import { tng } from './tng';

/** The built-in skins (data tables; a loaded theme pack replaces them). */
export const SKINS: Record<string, Skin> = { tng };
export const skinFor = (theme: string): Skin | undefined => SKINS[theme];
export type { Skin } from './types';
