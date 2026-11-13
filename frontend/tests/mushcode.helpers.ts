/** Deterministic PRNG + random softcode generators shared by the mushcode tests. */
export type Rand = () => number;

export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SOFTCODE_ALPHABET = [
  ...'()[]{},;%\\#@&$^:=<>!|+-.* \t\n\rabcxyzAB019',
  'add',
  'iter',
  'q<',
  '@@',
  '%q',
  '%=<',
  '##',
  '#-1',
  '@set ',
  '&A ',
  '$x:',
  '^y:',
];

export function randomString(r: Rand, alphabet: string[], maxLen: number): string {
  const n = Math.floor(r() * maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}

const pick = <T>(r: Rand, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const FNS = ['add', 'mul', 'iter', 'if', 'strcat', 'u', 'get', 'setq', 'switch', 'myfn', 'elements', 'lnum'];
const WORDS = ['foo', 'bar baz', 'Hello there', '42', '-7', '3.14', '#123', '#-1', 'x y z', '|', ' ', '  '];
const SUBS = ['%0', '%1', '%#', '%!', '%q0', '%q<n>', '%r', '%b', '%%', '%va', '%=<a>', '##', '%i0', '%xr'];
const ESCS = ['\\,', '\\)', '\\(', '\\[', '\\{', '\\\\', '%,', '%(', '%)'];

/** A random single-line piece of softcode, mostly well-formed, sometimes sloppy. */
export function randomSoftcode(r: Rand, depth = 0): string {
  const parts = 1 + Math.floor(r() * 3);
  let s = '';
  for (let i = 0; i < parts; i++) {
    const x = r();
    if (x < 0.34 && depth < 4) {
      const argc = Math.floor(r() * 4);
      const args: string[] = [];
      for (let a = 0; a < argc; a++)
        args.push(pick(r, ['', ' ', '  ']) + randomSoftcode(r, depth + 1) + pick(r, ['', '', ' ']));
      s += pick(r, FNS) + '(' + args.join(',') + ')';
    } else if (x < 0.46 && depth < 4) s += '[' + randomSoftcode(r, depth + 1) + ']';
    else if (x < 0.56 && depth < 4) s += '{' + randomSoftcode(r, depth + 1) + '}';
    else if (x < 0.62 && depth < 4) s += '(' + randomSoftcode(r, depth + 1) + ')';
    else if (x < 0.74) s += pick(r, SUBS);
    else if (x < 0.8) s += pick(r, ESCS);
    else if (x < 0.84) s += pick(r, [',', ';', '(', ')', '{', '}', '[', ']', '\\', '%']);
    else s += pick(r, WORDS);
  }
  return s;
}
