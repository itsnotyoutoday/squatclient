import { checkAttrName, checkObject } from './validate';

/** A reference to another attribute found in softcode, e.g. `u(#12/FN_X)` or `v(ATTR)`. */
export interface AttrRef {
  /** the function it was written with, lower case */
  fn: string;
  /** dbref, `me`, `here` or a name; undefined = the attribute lives on the current object */
  object?: string;
  attr: string;
  /** text range covering `fn(` through the attribute argument */
  start: number;
  end: number;
}

// first argument is `obj/attr` or just `attr`
const SLASH_OPTIONAL = new Set(['u', 'ufun', 'ulocal', 'udefault', 'uldefault']);
// first argument must be `obj/attr`
const SLASH_REQUIRED = new Set(['get', 'get_eval', 'eval', 'default', 'edefault']);
// first argument is just the attribute (of the current object)
const ATTR_ONLY = new Set(['v']);
// `fn(obj, attr, ...)`
const OBJ_ATTR = new Set(['xget', 'hasattr', 'hasattrp', 'hasattrval']);

/** Arguments of the call whose `(` is at `open`: [text, start, end] of the first `count` top-level arguments. */
function leadingArgs(text: string, open: number, count: number): [string, number, number][] | null {
  const out: [string, number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        if (c !== ')') return null;
        out.push([text.slice(start, i), start, i]);
        return out;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      out.push([text.slice(start, i), start, i]);
      if (out.length >= count) return out;
      start = i + 1;
    } else if (c === '\n') {
      // calls may be expanded over several lines; that is fine
    }
  }
  return null;
}

const isLiteral = (s: string): boolean => !/[[\]%(){}\\]/.test(s);

function objectOk(o: string): boolean {
  return o !== '' && isLiteral(o) && checkObject(o) === null;
}

/** All attribute references in `text`, in order. Dynamic references (`u(%0/X)`, `[...]`) are ignored. */
export function findRefs(text: string): AttrRef[] {
  const refs: AttrRef[] = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const fn = m[1].toLowerCase();
    const open = m.index + m[0].length - 1;
    const start = m.index;
    if (SLASH_OPTIONAL.has(fn) || SLASH_REQUIRED.has(fn)) {
      const a = leadingArgs(text, open, 1)?.[0];
      if (!a) continue;
      const arg = a[0].trim();
      if (!isLiteral(arg)) continue;
      const slash = arg.lastIndexOf('/');
      if (slash < 0) {
        if (SLASH_REQUIRED.has(fn) || checkAttrName(arg) !== null) continue;
        refs.push({ fn, attr: arg.toUpperCase(), start, end: a[2] });
      } else {
        const obj = arg.slice(0, slash).trim();
        const attr = arg.slice(slash + 1).trim();
        if (!objectOk(obj) || checkAttrName(attr) !== null) continue;
        refs.push({ fn, object: obj, attr: attr.toUpperCase(), start, end: a[2] });
      }
    } else if (ATTR_ONLY.has(fn)) {
      const a = leadingArgs(text, open, 1)?.[0];
      const arg = a?.[0].trim() ?? '';
      if (!a || !isLiteral(arg) || checkAttrName(arg) !== null || /^\d+$/.test(arg)) continue;
      // v() also takes substitution-like names (v(a) is the %va register): only treat names of attribute length > 1
      if (arg.length < 2) continue;
      refs.push({ fn, attr: arg.toUpperCase(), start, end: a[2] });
    } else if (OBJ_ATTR.has(fn)) {
      const a = leadingArgs(text, open, 2);
      if (!a || a.length < 2) continue;
      const obj = a[0][0].trim();
      const attr = a[1][0].trim();
      if (!objectOk(obj) || !isLiteral(attr) || checkAttrName(attr) !== null) continue;
      refs.push({ fn, object: obj, attr: attr.toUpperCase(), start, end: a[1][2] });
    }
  }
  return refs;
}

/** The reference under `offset` (inside `fn(` ... argument), or null. */
export function refAt(text: string, offset: number): AttrRef | null {
  let best: AttrRef | null = null;
  for (const r of findRefs(text)) {
    if (offset >= r.start && offset <= r.end && (!best || r.start > best.start)) best = r;
  }
  return best;
}
