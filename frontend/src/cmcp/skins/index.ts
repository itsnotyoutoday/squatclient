import type { Skin } from './types';
import { tng } from './tng';
import { ferengi, klingon, ops, romulan, soft, tos } from './themes';

/** The built-in skins (data tables; a loaded theme pack replaces them). */
export const SKINS: Record<string, Skin> = { tng, soft, klingon, romulan, tos, ferengi, ops };
export const skinFor = (theme: string): Skin | undefined => SKINS[theme];
export type { Skin } from './types';
