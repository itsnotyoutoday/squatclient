/** Colors of the graphics layer: RGBA floats 0..1 (straight alpha). */
export type RGBA = [number, number, number, number];

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00aa00', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080', orange: '#ff9900', purple: '#800080',
  pink: '#ffc0cb', brown: '#8b4513', darkgray: '#404040', darkgrey: '#404040', lightgray: '#c0c0c0',
  lightgrey: '#c0c0c0', brightred: '#ff5555', brightgreen: '#55ff55', brightyellow: '#ffff55',
  brightblue: '#5555ff', brightmagenta: '#ff55ff', brightcyan: '#55ffff', brightwhite: '#ffffff',
  default: '#c0c0c0',
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** xterm 256-color palette entry N. */
export function xterm256(n: number): RGBA {
  const base = [
    [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
    [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ];
  if (n < 16) return [base[n][0] / 255, base[n][1] / 255, base[n][2] / 255, 1];
  if (n >= 232) {
    const g = (8 + (n - 232) * 10) / 255;
    return [g, g, g, 1];
  }
  const i = n - 16;
  const lv = (v: number): number => (v === 0 ? 0 : (55 + v * 40) / 255);
  return [lv(Math.floor(i / 36)), lv(Math.floor(i / 6) % 6), lv(i % 6), 1];
}

const cache = new Map<string, RGBA>();

/** Parses #rgb #rrggbb #rrggbbaa, rgb()/rgba(), names, 256:N. Unknown text gives magenta (visible, never silent). */
export function parseColor(s: unknown): RGBA {
  if (Array.isArray(s) && s.length >= 3) return [s[0], s[1], s[2], s[3] ?? 1] as RGBA;
  if (typeof s !== 'string') return [1, 0, 1, 1];
  const hit = cache.get(s);
  if (hit) return hit;
  const out = parseUncached(s.trim());
  if (cache.size > 2000) cache.clear();
  cache.set(s, out);
  return out;
}

function parseUncached(t: string): RGBA {
  const lower = t.toLowerCase();
  if (lower === 'none' || lower === 'transparent') return [0, 0, 0, 0];
  const name = NAMED[lower];
  if (name) return parseUncached(name);
  let m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 6) h += 'ff';
    if (h.length === 8) {
      return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGBA;
    }
  }
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(t);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [clamp01(+m[1] / 255), clamp01(+m[2] / 255), clamp01(+m[3] / 255), clamp01(a)];
  }
  m = /^256:(\d{1,3})$/.exec(t);
  if (m && +m[1] < 256) return xterm256(+m[1]);
  return [1, 0, 1, 1];
}

export function mixColor(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export function toHex(c: RGBA): string {
  const h = (v: number): string => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]) + (c[3] < 1 ? h(c[3]) : '');
}

/** True when the value parses as a color (used to decide whether a tween interpolates colors). */
export function isColorLike(v: unknown): boolean {
  return typeof v === 'string' && (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v) || /^256:\d+$/.test(v) || v.toLowerCase() in NAMED);
}
