import { checkAttrName, checkObject } from './validate';

export type EditCommand =
  /** open the editor view; with a target, open it (and an attribute when given) */
  { kind: 'open'; target?: string; attr?: string } | { kind: 'bad'; message: string };

/**
 * `/edit` is a UI feature, recognised before text reaches the engine (like `/help`).
 * `/edit` | `/edit #12` | `/edit #12/CMD` | `/edit me` | `/edit Some Name/ATTR`. Null when the line is not an /edit command.
 */
export function parseEditCommand(line: string): EditCommand | null {
  const m = /^\s*\/edit(?:\s+([\s\S]*?))?\s*$/i.exec(line);
  if (!m) return null;
  const arg = (m[1] ?? '').trim();
  if (arg === '') return { kind: 'open' };
  if (/[\r\n]/.test(arg)) return { kind: 'bad', message: '/edit takes a single line' };
  const slash = arg.lastIndexOf('/');
  const target = slash < 0 ? arg : arg.slice(0, slash).trim();
  const attrPart = slash < 0 ? undefined : arg.slice(slash + 1).trim();
  const te = checkObject(target);
  if (te) return { kind: 'bad', message: te };
  if (attrPart === undefined) return { kind: 'open', target };
  const ae = checkAttrName(attrPart);
  if (ae) return { kind: 'bad', message: ae };
  return { kind: 'open', target, attr: attrPart.toUpperCase() };
}
