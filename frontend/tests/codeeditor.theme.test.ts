import { BUILTIN_THEMES } from '../src/themes';
import type { Theme } from '../src/themes/schema';

// vitest blanks `?raw` css and the project has no node typings, so read the file through a typed dynamic import
const nodeFs = 'node:fs';
const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, enc: string): string };
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const css = fs.readFileSync(`${cwd}/src/styles/codeeditor.css`, 'utf8');

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--mc-[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const darkBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const lightBlock = /:root\[style\*='color-scheme: light'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

function resolve(expr: string, t: Theme): string {
  const m = /^var\((--[a-z0-9-]+)(?:,\s*(#[0-9a-f]{3,6}))?\)$/i.exec(expr);
  if (!m) throw new Error(`unsupported expression ${expr}`);
  const name = m[1];
  const ansi = /^--ansi-(\d+)$/.exec(name);
  if (ansi) return t.ansi[Number(ansi[1])];
  const map: Record<string, string> = {
    '--link': t.link,
    '--cursor': t.cursor,
    '--ui-text-dim': t.chrome.textDim,
    '--ui-accent': t.chrome.accent,
    '--ui-danger': t.chrome.danger,
    '--ui-warn': t.chrome.warn,
  };
  if (!(name in map)) throw new Error(`unmapped variable ${name}`);
  return map[name];
}

const lum = (hex: string): number => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('code editor token colours', () => {
  const base = vars(darkBlock);
  const light = { ...base, ...vars(lightBlock) };
  const tokens = Object.keys(base).filter((k) => !/-bg$|-error$|-warn$/.test(k));

  it('defines a colour for every highlight class', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(15);
    for (const cls of ['function', 'function-unknown', 'bracket', 'brace', 'comment', 'dbref', 'pattern']) {
      expect(css).toContain(`.mc-${cls}`);
    }
  });

  it.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))(
    'is readable (>= 4.5:1) on the %s theme',
    (_id, t) => {
      const set = t.kind === 'light' ? light : base;
      const low: string[] = [];
      for (const k of tokens) {
        const c = contrast(resolve(set[k], t), t.bg);
        if (c < 4.5) low.push(`${k} ${resolve(set[k], t)} on ${t.bg} = ${c.toFixed(2)}`);
      }
      expect(low).toEqual([]);
    },
  );
});
