import type { Span } from './types';

const t = (s: string, rest: Omit<Span, 's'> = {}): Span => ({ s, ...rest });

function hsl(h: number): string {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.5 - 0.5 * Math.min(k - 3, 9 - k, 1)));
  };
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function ansi16Line(): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < 16; i++)
    out.push(t(` ${i.toString().padStart(2)} `, { bg: i, fg: i < 8 && i !== 0 ? 0 : 15 }));
  return out;
}

export function cubeLine(row: number): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < 36; i++) out.push(t('  ', { bg: 16 + row * 36 + i }));
  return out;
}

export function greyLine(): Span[] {
  const out: Span[] = [];
  for (let i = 232; i < 256; i++) out.push(t('  ', { bg: i }));
  return out;
}

export function gradientLine(width = 60): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < width; i++) out.push(t('█', { fg: hsl((i / width) * 360) }));
  return out;
}

export function truecolorBgLine(width = 60): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < width; i++) {
    const v = Math.round((i / (width - 1)) * 255);
    out.push(
      t(' ', { bg: `#${v.toString(16).padStart(2, '0')}40${(255 - v).toString(16).padStart(2, '0')}` }),
    );
  }
  return out;
}

export const attrLine: Span[] = [
  t('bold', { b: true }),
  t(' '),
  t('dim', { dim: true }),
  t(' '),
  t('italic', { i: true }),
  t(' '),
  t('underline', { u: true }),
  t(' '),
  t('strike', { st: true }),
  t(' '),
  t('blink', { blink: true }),
  t(' '),
  t('reverse', { rev: true }),
  t(' '),
  t('rev+red', { rev: true, fg: 1 }),
  t(' '),
  t('all', { b: true, i: true, u: true, st: true, fg: '#ff8800', bg: '#102030' }),
];

export const linkLine: Span[] = [
  t('See the '),
  t('help wiki', { link: 'https://example.com/wiki', u: true, fg: 12 }),
  t(' or visit https://example.org/path?q=1 (also www.example.net). Not a link: javascript:alert(1)'),
];

export const unicodeLines: Span[][] = [
  [t('UTF-8: café naïve — “smart quotes” ☃ ♥ → λ €')],
  [t('Emoji: 😀 🚀 🌈 👍🏽 🇯🇵 family 👨‍👩‍👧')],
  [t('CJK: 日本語のテキスト 中文文本 한국어 メッセージ')],
  [t('Combining: é ä ñ ô ž  Box: ╔══╗ ║ok║ ╚══╝')],
];

export const roomLines: Span[][] = [
  [t('The Grand Atrium', { fg: 14, b: true }), t('(#123RJ)', { fg: 8 })],
  [t('A vast marble hall. Sunlight pours through a '), t('stained-glass dome', { fg: 13 }), t('.')],
  [t('Contents:', { fg: 2 })],
  [t('  A brass lamp', { fg: 11 }), t(' and '), t('a sleepy cat', { fg: '#ffb86c' })],
  [
    t('Obvious exits: '),
    t('North', { fg: 10, b: true }),
    t(', '),
    t('East', { fg: 10, b: true }),
    t(', '),
    t('Out', { fg: 10, b: true }),
  ],
];

export function chatterLine(n: number): Span[] {
  const who = ['Aria', 'Bram', 'Cass', 'Dov'][n % 4];
  const col = [9, 10, 11, 12][n % 4];
  return [
    t(`${who}`, { fg: col, b: true }),
    t(` says, "message number ${n} — the quick brown fox jumps over the lazy dog."`),
  ];
}

/** One scripted line group per tick, so streaming output shows every rendering feature. */
export function sampleGroup(n: number): Span[][] {
  switch (n % 8) {
    case 0:
      return [ansi16Line()];
    case 1:
      return [gradientLine()];
    case 2:
      return [attrLine];
    case 3:
      return [linkLine];
    case 4:
      return unicodeLines;
    case 5:
      return roomLines;
    case 6:
      return [cubeLine(n % 6), greyLine(), truecolorBgLine()];
    default:
      return [chatterLine(n)];
  }
}
