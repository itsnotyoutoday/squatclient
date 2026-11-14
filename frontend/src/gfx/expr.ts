/**
 * Binding expressions: a small, safe expression language evaluated by the renderer whenever a variable it reads
 * changes. `=lc_core * 1.8`, `lc_alert == "red" ? "#ff0000" : "#ff9900"`, templates "STARDATE {lc_sd|%.1f}".
 * No eval: the source is parsed into closures.
 */
import { mixColor, parseColor, toHex } from './color';

export type Value = number | string | boolean | undefined;

export interface EvalCtx {
  /** The value of a variable (TF variable, gmcp:Pkg.field, msdp:NAME), undefined when unknown. */
  get(name: string): Value;
  /** Seconds since the scene started (for time()). */
  time: number;
}

export interface Compiled<T> {
  run(ctx: EvalCtx): T;
  /** Names the source reads (re-evaluate when one of them changes). */
  deps: Set<string>;
  /** Reads time() or rand(): re-evaluate every frame. */
  volatile: boolean;
}

type Node = (c: EvalCtx) => Value;

const num = (v: Value): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};
const str = (v: Value): string => (v === undefined ? '' : typeof v === 'number' ? fmtNum(v) : String(v));
const truthy = (v: Value): boolean => (typeof v === 'string' ? v !== '' && v !== '0' && v.toLowerCase() !== 'off' : !!v);
const isNumLike = (v: Value): boolean => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

/** printf-style: %d %i %f %s %x %X %o %e %c %% with flags - + 0 space, width and precision. */
export function sprintf(spec: string, v: Value): string {
  return spec.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([dioxXfFeEgGsc%])/g, (_m, flags: string, w: string, p: string, conv: string) => {
    if (conv === '%') return '%';
    let s: string;
    const n = num(v);
    switch (conv) {
      case 'd': case 'i': s = String(Math.trunc(n)); break;
      case 'x': s = Math.trunc(n).toString(16); break;
      case 'X': s = Math.trunc(n).toString(16).toUpperCase(); break;
      case 'o': s = Math.trunc(n).toString(8); break;
      case 'f': case 'F': s = n.toFixed(p === undefined ? 6 : +p); break;
      case 'e': case 'E': s = n.toExponential(p === undefined ? 6 : +p); break;
      case 'g': case 'G': s = String(Number(n.toPrecision(p === undefined ? 6 : Math.max(1, +p)))); break;
      case 'c': s = String.fromCharCode(n); break;
      default: s = str(v); if (p !== undefined) s = s.slice(0, +p);
    }
    if (flags.includes('+') && n >= 0 && 'dif'.includes(conv)) s = '+' + s;
    else if (flags.includes(' ') && n >= 0 && 'dif'.includes(conv)) s = ' ' + s;
    const width = w ? +w : 0;
    if (s.length < width) {
      if (flags.includes('-')) s = s.padEnd(width);
      else if (flags.includes('0') && conv !== 's') {
        const sign = /^[-+ ]/.test(s) ? s[0] : '';
        s = sign + s.slice(sign.length).padStart(width - sign.length, '0');
      } else s = s.padStart(width);
    }
    return s;
  });
}

const FUNCS: Record<string, (a: Value[], c: EvalCtx) => Value> = {
  abs: (a) => Math.abs(num(a[0])), sin: (a) => Math.sin(num(a[0])), cos: (a) => Math.cos(num(a[0])),
  tan: (a) => Math.tan(num(a[0])), atan2: (a) => Math.atan2(num(a[0]), num(a[1])), sqrt: (a) => Math.sqrt(num(a[0])),
  pow: (a) => Math.pow(num(a[0]), num(a[1])), min: (a) => Math.min(...a.map(num)), max: (a) => Math.max(...a.map(num)),
  floor: (a) => Math.floor(num(a[0])), ceil: (a) => Math.ceil(num(a[0])), round: (a) => Math.round(num(a[0])),
  trunc: (a) => Math.trunc(num(a[0])), sign: (a) => Math.sign(num(a[0])), fract: (a) => num(a[0]) - Math.floor(num(a[0])),
  mod: (a) => { const b = num(a[1]); return b === 0 ? 0 : ((num(a[0]) % b) + b) % b; },
  clamp: (a) => Math.min(Math.max(num(a[0]), num(a[1])), num(a[2])),
  mix: (a) => num(a[0]) + (num(a[1]) - num(a[0])) * num(a[2]),
  step: (a) => (num(a[1]) < num(a[0]) ? 0 : 1),
  smoothstep: (a) => { const t = Math.min(Math.max((num(a[2]) - num(a[0])) / (num(a[1]) - num(a[0]) || 1), 0), 1); return t * t * (3 - 2 * t); },
  int: (a) => Math.trunc(num(a[0])), num: (a) => num(a[0]), str: (a) => str(a[0]),
  len: (a) => str(a[0]).length, upper: (a) => str(a[0]).toUpperCase(), lower: (a) => str(a[0]).toLowerCase(),
  substr: (a) => str(a[0]).substr(num(a[1]), a[2] === undefined ? undefined : num(a[2])),
  pad: (a) => { const n = num(a[1]); const s = str(a[0]); return n < 0 ? s.padEnd(-n) : s.padStart(n); },
  trunc_s: (a) => str(a[0]).slice(0, num(a[1])),
  fmt: (a) => sprintf(str(a[1]), a[0]),
  'if': (a) => (truthy(a[0]) ? a[1] : a[2]),
  color: (a) => toHex(mixColor(parseColor(str(a[0])), parseColor(str(a[1])), Math.min(Math.max(num(a[2]), 0), 1))),
  rgb: (a) => toHex([num(a[0]) / 255, num(a[1]) / 255, num(a[2]) / 255, 1]),
  time: (_a, c) => c.time,
  rand: (a) => { const s = Math.sin(num(a[0]) * 12.9898) * 43758.5453; return s - Math.floor(s); },
  has: () => 0,
};
const VOLATILE_FUNCS = new Set(['time']);

interface Tok { t: 'n' | 's' | 'id' | 'op' | 'end'; v: string; }

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'n', v: m[0] }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) j++; s += src[j++]; }
      if (j >= src.length) throw new Error('unterminated string');
      out.push({ t: 's', v: s }); i = j + 1; continue;
    }
    const idm = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_]+(?:[.][A-Za-z0-9_]+)*)?(?:[.][A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
    if (idm) { out.push({ t: 'id', v: idm[0] }); i += idm[0].length; continue; }
    const op = /^(\*\*|==|!=|<=|>=|&&|\|\||=~|!~|[-+*/%<>!?:(),])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  out.push({ t: 'end', v: '' });
  return out;
}

export function compileExpr(src: string): Compiled<Value> {
  const toks = lex(src);
  let p = 0;
  const deps = new Set<string>();
  let volatile = false;
  const peek = (): Tok => toks[p];
  const eat = (v?: string): Tok => {
    const t = toks[p];
    if (v !== undefined && t.v !== v) throw new Error(`expected "${v}" but found "${t.v || 'end'}"`);
    p++;
    return t;
  };
  const isOp = (v: string): boolean => peek().t === 'op' && peek().v === v;

  const ternary = (): Node => {
    const c = or();
    if (isOp('?')) {
      eat('?');
      const a = ternary();
      eat(':');
      const b = ternary();
      return (x) => (truthy(c(x)) ? a(x) : b(x));
    }
    return c;
  };
  const bin = (next: () => Node, ops: string[], f: (op: string, a: Value, b: Value) => Value): (() => Node) => () => {
    let l = next();
    while (peek().t === 'op' && ops.includes(peek().v)) {
      const op = eat().v;
      const r = next();
      const ll = l;
      l = (x) => f(op, ll(x), r(x));
    }
    return l;
  };
  const unary = (): Node => {
    if (isOp('!')) { eat(); const a = unary(); return (x) => (truthy(a(x)) ? 0 : 1); }
    if (isOp('-')) { eat(); const a = unary(); return (x) => -num(a(x)); }
    if (isOp('+')) { eat(); return unary(); }
    return power();
  };
  const power = (): Node => {
    const b = primary();
    if (isOp('**')) { eat(); const e = unary(); return (x) => Math.pow(num(b(x)), num(e(x))); }
    return b;
  };
  const mul = bin(unary, ['*', '/', '%'], (op, a, b) => {
    const x = num(a), y = num(b);
    return op === '*' ? x * y : op === '/' ? (y === 0 ? 0 : x / y) : y === 0 ? 0 : x % y;
  });
  const add = bin(mul, ['+', '-'], (op, a, b) => {
    if (op === '+' && ((typeof a === 'string' && !isNumLike(a)) || (typeof b === 'string' && !isNumLike(b)))) return str(a) + str(b);
    return op === '+' ? num(a) + num(b) : num(a) - num(b);
  });
  const rel = bin(add, ['<', '>', '<=', '>='], (op, a, b) => {
    const num2 = isNumLike(a) && isNumLike(b);
    const x = num2 ? num(a) : str(a), y = num2 ? num(b) : str(b);
    return (op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y) ? 1 : 0;
  });
  const eq = bin(rel, ['==', '!=', '=~', '!~'], (op, a, b) => {
    const same = op === '=~' || op === '!~' ? str(a) === str(b) : isNumLike(a) && isNumLike(b) ? num(a) === num(b) : str(a) === str(b);
    return (op === '==' || op === '=~' ? same : !same) ? 1 : 0;
  });
  const and = (): Node => {
    let l = eq();
    while (isOp('&&')) { eat(); const r = eq(); const ll = l; l = (x) => (truthy(ll(x)) && truthy(r(x)) ? 1 : 0); }
    return l;
  };
  const or = (): Node => {
    let l = and();
    while (isOp('||')) { eat(); const r = and(); const ll = l; l = (x) => (truthy(ll(x)) || truthy(r(x)) ? 1 : 0); }
    return l;
  };
  const primary = (): Node => {
    const t = eat();
    if (t.t === 'n') { const v = parseFloat(t.v); return () => v; }
    if (t.t === 's') { const v = t.v; return () => v; }
    if (t.t === 'op' && t.v === '(') { const e = ternary(); eat(')'); return e; }
    if (t.t === 'id') {
      if (isOp('(')) {
        eat('(');
        const args: Node[] = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { eat(','); args.push(ternary()); } }
        eat(')');
        const f = FUNCS[t.v];
        if (!f) throw new Error(`unknown function ${t.v}()`);
        if (VOLATILE_FUNCS.has(t.v) || t.v === 'rand') volatile = true;
        return (x) => f(args.map((a) => a(x)), x);
      }
      if (t.v === 'true') return () => 1;
      if (t.v === 'false') return () => 0;
      deps.add(t.v);
      const name = t.v;
      return (x) => x.get(name);
    }
    throw new Error(`unexpected "${t.v || 'end of expression'}"`);
  };

  const root = ternary();
  if (peek().t !== 'end') throw new Error(`unexpected "${peek().v}"`);
  return { run: (c) => root(c), deps, volatile };
}

/** Splits `expr|filter|filter:arg` at single pipes outside quotes and parentheses. */
function splitFilters(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) {
      if (s[i + 1] === '|') { cur += '||'; i++; continue; }
      out.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function applyFilter(f: string, v: Value): Value {
  f = f.trim();
  if (f.startsWith('%')) return sprintf(f, v);
  const [name, ...rest] = f.split(':');
  const arg = rest.join(':');
  switch (name) {
    case 'upper': return str(v).toUpperCase();
    case 'lower': return str(v).toLowerCase();
    case 'title': return str(v).replace(/\b\w/g, (m) => m.toUpperCase());
    case 'trim': return str(v).trim();
    case 'int': return Math.trunc(num(v));
    case 'round': return Math.round(num(v));
    case 'k': { const n = num(v); return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : str(v); }
    case 'default': return str(v) === '' ? arg : v;
    case 'pad': { const n = +arg || 0; return n < 0 ? str(v).padEnd(-n) : str(v).padStart(n); }
    case 'rpad': return str(v).padEnd(+arg || 0);
    case 'trunc': return str(v).slice(0, +arg || 0);
    default: return v;
  }
}

/** A text template: "HULL {lc_hull|%3d}%  {lc_alert|upper}". `\{` is a literal brace. */
export function compileTemplate(src: string): Compiled<string> {
  const parts: (string | { e: Compiled<Value>; filters: string[] })[] = [];
  const deps = new Set<string>();
  let volatile = false;
  let lit = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && (src[i + 1] === '{' || src[i + 1] === '}' || src[i + 1] === '\\')) { lit += src[++i]; continue; }
    if (c === '{') {
      let depth = 1, j = i + 1;
      while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      if (depth !== 0) throw new Error('unclosed {');
      const [ex, ...filters] = splitFilters(src.slice(i + 1, j - 1));
      const e = compileExpr(ex);
      e.deps.forEach((d) => deps.add(d));
      volatile ||= e.volatile;
      if (lit) { parts.push(lit); lit = ''; }
      parts.push({ e, filters });
      i = j - 1;
      continue;
    }
    lit += c;
  }
  if (lit) parts.push(lit);
  return {
    deps, volatile,
    run: (c) => parts.map((p) => (typeof p === 'string' ? p : str(p.filters.reduce((v, f) => applyFilter(f, v), p.e.run(c))))).join(''),
  };
}

/** True when a text has {…} template tags. */
export const hasTemplate = (s: string): boolean => /(^|[^\\])\{/.test(s);
