/**
 * Client-side mirror of the engine's validation (`ValidateObject`, `ValidateAttrName`): used to reject bad
 * input early with a clear message. The engine validates again; this is never the only check.
 */

const reDbref = /^#-?\d+$/;
const reAttr = /^[A-Za-z0-9_.~`-]{1,128}$/;

/** Error text, or null when `o` is a dbref or a plain object name / keyword (`me`, `here`, `*Player`). */
export function checkObject(o: string): string | null {
  if (reDbref.test(o)) return null;
  if (o === '') return 'Enter an object: #123, me, here or a name';
  if (o.startsWith('#')) return `"${o}" is not a dbref (use #123)`;
  if (o.length > 128) return 'That name is too long';
  if (o !== o.trim()) return 'Remove the spaces around the name';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(o)) return 'Control characters are not allowed';
  if (/[[\](){},;%\\=^|]/.test(o)) return 'Names cannot contain brackets, commas, ; % \\ = ^ or |';
  return null;
}

/** Error text, or null when `a` is a legal attribute name. */
export function checkAttrName(a: string): string | null {
  return reAttr.test(a) ? null : `"${a}" is not a valid attribute name (letters, digits and _ . ~ - \` only)`;
}

export const isDbref = (s: string): boolean => reDbref.test(s);
