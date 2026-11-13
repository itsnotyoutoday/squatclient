import type { Theme } from './schema';

export const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  kind: 'dark',
  fg: '#d4d7dd',
  bg: '#14161a',
  cursor: '#f0c674',
  selection: '#2f4a6d',
  link: '#6cb6ff',
  // Matches a classic macOS terminal palette so game colours look the same as in tinyfugue:
  // slots 1,2,3,6,8,10,12,13,14,15 were measured from a real terminal screenshot; 0,4,5,7,9,11
  // are estimated to fit the same family (tune them via Settings > theme import if needed).
  ansi: [
    '#000000', // 0 black (estimated)
    '#d6492e', // 1 red
    '#41c731', // 2 green
    '#b8b72f', // 3 yellow
    '#5f38cc', // 4 blue (estimated)
    '#cc3dcc', // 5 magenta (estimated)
    '#40c5d1', // 6 cyan
    '#cbcccd', // 7 white (estimated)
    '#909090', // 8 bright black
    '#ff5a37', // 9 bright red (estimated)
    '#39ed29', // 10 bright green
    '#ecec2d', // 11 bright yellow (estimated)
    '#7646ff', // 12 bright blue
    '#ff4cff', // 13 bright magenta
    '#32f4f4', // 14 bright cyan
    '#ededed', // 15 bright white
  ],
  chrome: {
    panel: '#1b1e23',
    panelAlt: '#22262c',
    border: '#2d3239',
    text: '#d4d7dd',
    textDim: '#8a919c',
    accent: '#4c8dff',
    accentText: '#ffffff',
    danger: '#e5484d',
    warn: '#e5a13b',
    ok: '#46a758',
  },
};

export const light: Theme = {
  id: 'light',
  name: 'Light',
  kind: 'light',
  fg: '#24292f',
  bg: '#fbfbfa',
  cursor: '#0550ae',
  selection: '#b6d4fe',
  link: '#0550ae',
  ansi: [
    '#24292f',
    '#c4262e',
    '#1a7f37',
    '#8a5a00',
    '#0550ae',
    '#8250df',
    '#0a7c8c',
    '#6e7781',
    '#57606a',
    '#e5484d',
    '#2da44e',
    '#b08800',
    '#2b6fdc',
    '#a475f9',
    '#1b9aa8',
    '#8c959f',
  ],
  chrome: {
    panel: '#f0efec',
    panelAlt: '#e7e6e2',
    border: '#d4d2cc',
    text: '#24292f',
    textDim: '#6a717a',
    accent: '#0969da',
    accentText: '#ffffff',
    danger: '#cf222e',
    warn: '#9a6700',
    ok: '#1a7f37',
  },
};

export const highContrast: Theme = {
  id: 'high-contrast',
  name: 'High contrast',
  kind: 'dark',
  fg: '#ffffff',
  bg: '#000000',
  cursor: '#ffff00',
  selection: '#0044cc',
  link: '#5cc8ff',
  ansi: [
    '#000000',
    '#ff5555',
    '#55ff55',
    '#ffff55',
    '#6e9bff',
    '#ff77ff',
    '#55ffff',
    '#e6e6e6',
    '#9a9a9a',
    '#ff8080',
    '#80ff80',
    '#ffff80',
    '#9dbbff',
    '#ff99ff',
    '#80ffff',
    '#ffffff',
  ],
  chrome: {
    panel: '#000000',
    panelAlt: '#101010',
    border: '#ffffff',
    text: '#ffffff',
    textDim: '#cfcfcf',
    accent: '#ffff00',
    accentText: '#000000',
    danger: '#ff5555',
    warn: '#ffff55',
    ok: '#55ff55',
  },
};

export const BUILTIN_THEMES: readonly Theme[] = [dark, light, highContrast];
