import type { DiagReport, EngineAPI, SessionInfo, Settings, SquatterConfig } from '../api/types';
import { getProblems } from './problems';
import type { Problem } from './problems';
import { redact, safeValue } from './redact';

/** Everything the report shows, gathered once; buildReport turns it into text (pure, testable). */
export interface DiagData {
  generatedAt: string;
  appVersionFromUi: string;
  go: DiagReport | null;
  goError?: string;
  userAgent: string;
  language: string;
  jsTimezone: string;
  display: DisplayInfo;
  render: RenderInfo;
  settings: Partial<Settings> & Record<string, unknown>;
  squatters: SquatterSummary[];
  sessions: SessionSummary[];
  problems: readonly Problem[];
}

export interface FontProbe {
  family: string;
  /** document.fonts.check() */
  fontsCheck: boolean;
  /** canvas width differs from the generic fallbacks, i.e. a real font answered */
  installed: boolean;
}

export interface DisplayInfo {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  devicePixelRatio: number;
  colorScheme: string;
  reducedMotion: boolean;
  fontFamily: string;
  fontSize: number;
  fonts: FontProbe[];
  /** the first listed family that is installed ('' = none, the generic fallback is used) */
  resolvedFont: string;
}

export interface WrapTest {
  name: string;
  chars: number;
  height: number;
  lineHeight: number;
  lines: number;
  wrapped: boolean;
}

export interface RenderInfo {
  css: { test: string; ok: boolean }[];
  /** computed style of the live output pane's first .row / .text ('' name = none mounted) */
  liveRow: Record<string, string> | null;
  liveText: Record<string, string> | null;
  /** computed style of the probe row used by the wrap test (always available) */
  probeRow: Record<string, string>;
  probeText: Record<string, string>;
  paneClientWidth: number | null;
  rowWidth: number;
  charWidthDom: number;
  charWidthCanvas: number;
  charsPerLine: number;
  wrapTests: WrapTest[];
}

export interface SquatterSummary {
  kind: string;
  paired: boolean;
  state: string;
  problem?: string;
  automation?: string;
  role?: string;
  instance?: string;
  features: string[];
  sessions?: number;
  /** only printed when "include hostnames" is on */
  host: string;
  port: number;
}

export interface SessionSummary {
  state: string;
  link?: string;
  via: string;
  gameType?: string;
  gameFamily?: string;
  gameTypeSource?: string;
  tls: boolean;
  tlsVerify?: string;
  encoding?: string;
  remoteEcho: boolean;
  tf: boolean;
  /** only printed when "include hostnames" is on */
  host: string;
  port: number;
}

export interface ReportOptions {
  includeHostnames: boolean;
}

// ---------------------------------------------------------------- the report text

const KEY_W = 24;
const kv = (k: string, v: unknown): string =>
  `${(k + ':').padEnd(KEY_W)}${v === undefined || v === '' ? '-' : String(v)}`;
const yn = (b: boolean): string => (b ? 'yes' : 'NO');

function section(title: string, lines: string[]): string {
  return [`== ${title} ==`, ...lines].join('\n');
}

function styleLines(label: string, s: Record<string, string> | null): string[] {
  if (!s) return [kv(label, '(not mounted: open a connection first)')];
  return [label + ':', ...Object.entries(s).map(([k, v]) => `  ${(k + ':').padEnd(KEY_W - 2)}${v}`)];
}

function hostsOf(d: DiagData): string[] {
  return [...d.squatters.map((s) => s.host), ...d.sessions.map((s) => s.host)].filter(Boolean);
}

function countBy<T>(xs: readonly T[], f: (x: T) => string): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return m.size === 0 ? 'none' : [...m].map(([k, n]) => `${k} x${n}`).join(', ');
}

/** The whole report as plain text. Redaction is applied here, to everything that is free text. */
export function buildReport(d: DiagData, o: ReportOptions): string {
  const hosts = o.includeHostnames ? [] : hostsOf(d);
  const clean = (s: string): string => redact(s, { hosts, network: !o.includeHostnames });
  const out: string[] = [];
  out.push(`SquatClient diagnostics, ${d.generatedAt}`);
  out.push(
    `Hostnames: ${o.includeHostnames ? 'INCLUDED' : 'left out'}. Passwords, keys, tokens and fingerprints are never included.`,
  );
  out.push('');

  const g = d.go;
  out.push(
    section('App', [
      kv('Version', g?.app.version || d.appVersionFromUi),
      kv('Commit', g?.app.commit),
      kv('Build date', g?.app.buildDate),
      kv('Build type', g?.app.buildType),
      kv('Engine module', g?.app.engineVersion),
      kv('SWP protocol', g ? g.app.swpVersion : undefined),
      ...(d.goError ? [kv('Native info', `unavailable (${clean(d.goError)})`)] : []),
    ]),
    '',
  );
  out.push(
    section('Platform', [
      kv('OS', g ? `${g.platform.osName || g.platform.os} (${g.platform.os})` : undefined),
      kv('OS version', g?.platform.osVersion),
      kv('Architecture', g?.platform.arch),
      kv('Go', g?.platform.goVersion),
      kv('CPUs', g?.platform.numCPU),
      kv('Locale', g?.platform.locale),
      kv('Browser language', d.language),
      kv('Time zone', g?.platform.timezone),
      kv('Time zone (browser)', d.jsTimezone),
      kv('Notes', g?.platform.notes?.length ? g.platform.notes.join('; ') : 'none'),
    ]),
    '',
  );
  out.push(
    section('Web view', [
      kv('Engine', g?.webview.engine),
      kv('Version', g?.webview.version || (g?.webview.note ? `(${g.webview.note})` : '')),
      kv('userAgent', clean(d.userAgent)),
    ]),
    '',
  );

  const dp = d.display;
  out.push(
    section('Display', [
      kv('Window inner size', `${dp.innerWidth} x ${dp.innerHeight}`),
      kv('Window outer size', `${dp.outerWidth} x ${dp.outerHeight}`),
      kv(
        'Screen size',
        `${dp.screenWidth} x ${dp.screenHeight} (available ${dp.availWidth} x ${dp.availHeight})`,
      ),
      kv('devicePixelRatio', dp.devicePixelRatio),
      kv('prefers-color-scheme', dp.colorScheme),
      kv('prefers-reduced-motion', dp.reducedMotion ? 'reduce' : 'no-preference'),
      kv('Font family', clean(dp.fontFamily)),
      kv('Font size', `${dp.fontSize}px`),
      kv('Resolved to', dp.resolvedFont || 'NONE of the listed fonts is installed (generic fallback used)'),
      ...dp.fonts.map(
        (f) =>
          `  ${f.family.padEnd(KEY_W - 2)}document.fonts.check=${f.fontsCheck}  installed=${f.installed}`,
      ),
    ]),
    '',
  );

  const r = d.render;
  out.push(
    section('Rendering checks', [
      ...r.css.map((c) => kv(`CSS ${c.test}`, yn(c.ok))),
      ...styleLines('Output pane .row (live)', r.liveRow),
      ...styleLines('Output pane .text (live)', r.liveText),
      ...styleLines('Probe .row (wrap test)', r.probeRow),
      ...styleLines('Probe .text (wrap test)', r.probeText),
      kv('Output pane clientWidth', r.paneClientWidth ?? '(not mounted)'),
      kv('Row width used', r.rowWidth),
      kv('Char width (DOM)', `${r.charWidthDom.toFixed(3)}px`),
      kv('Char width (canvas)', `${r.charWidthCanvas.toFixed(3)}px`),
      kv('Characters per line', r.charsPerLine),
      'LIVE WRAP TEST (rendered off-screen in a row styled like the output pane):',
      ...r.wrapTests.map(
        (t) =>
          `  ${t.name.padEnd(KEY_W + 12)} ${t.chars} chars, height ${t.height}px, line ${t.lineHeight}px => ${t.lines} line(s): ${t.wrapped ? 'WRAPPED' : 'DID NOT WRAP'}`,
      ),
    ]),
    '',
  );

  const sKeys = Object.keys(d.settings).sort();
  out.push(
    section(
      'Settings',
      sKeys.length ? sKeys.map((k) => kv(k, safeValue(k, d.settings[k]))) : ['(none loaded)'],
    ),
    '',
  );

  const sq = d.squatters;
  const ss = d.sessions;
  const sqLines: string[] = [
    kv('Squatters', `${sq.length} (${countBy(sq, (x) => x.kind)})`),
    kv(
      'Squatter states',
      countBy(sq, (x) => x.state),
    ),
    kv('Sessions', `${ss.length} (${countBy(ss, (x) => x.state)})`),
    kv(
      'Link states',
      countBy(
        ss.filter((x) => x.link),
        (x) => x.link ?? '',
      ),
    ),
    kv(
      'Routes',
      countBy(ss, (x) => (x.via === 'direct' ? 'direct' : 'via squatter')),
    ),
    kv(
      'Game types',
      countBy(ss, (x) => x.gameType ?? 'undetected'),
    ),
  ];
  sq.forEach((x, i) =>
    sqLines.push(
      `Squatter ${i + 1}: kind=${x.kind} paired=${x.paired} state=${x.state}${x.problem ? ` problem=${clean(x.problem)}` : ''}` +
        `${x.automation ? ` automation=${x.automation}` : ''}${x.role ? ` role=${x.role}` : ''}` +
        `${x.sessions !== undefined ? ` sessions=${x.sessions}` : ''}` +
        ` features=[${x.features.join(',')}]` +
        (o.includeHostnames ? ` host=${x.host}:${x.port}` : ''),
    ),
  );
  ss.forEach((x, i) =>
    sqLines.push(
      `Session ${i + 1}: state=${x.state}${x.link ? ` link=${x.link}` : ''} route=${x.via === 'direct' ? 'direct' : 'squatter'}` +
        ` game=${x.gameType ?? '-'}${x.gameFamily ? `/${x.gameFamily}` : ''}${x.gameTypeSource ? ` (${x.gameTypeSource})` : ''}` +
        ` tls=${x.tls}${x.tlsVerify ? `/${x.tlsVerify}` : ''} encoding=${x.encoding ?? '-'} remoteEcho=${x.remoteEcho}${x.tf ? ' tinyfugue' : ''}` +
        (o.includeHostnames ? ` host=${x.host}:${x.port}` : ''),
    ),
  );
  out.push(section('Squatters and sessions', sqLines), '');

  const pr = d.problems;
  out.push(
    section(
      `Recent problems (last ${pr.length}, newest last; secrets redacted)`,
      pr.length
        ? pr.map(
            (p) =>
              `${new Date(p.ts).toISOString().slice(11, 19)} [${p.source}]${p.count > 1 ? ` x${p.count}` : ''} ${clean(p.message)}`,
          )
        : ['none recorded since the window opened'],
    ),
    '',
  );

  out.push(
    section('Paths (home shown as ~)', [
      kv('Config', g?.paths.config),
      kv('Data', g?.paths.data),
      kv('Logs', g?.paths.logs),
    ]),
  );
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- gathering (needs a live DOM)

const STYLE_PROPS = [
  'white-space',
  'overflow-wrap',
  'word-break',
  'min-width',
  'width',
  'display',
  'position',
  'font-family',
  'font-size',
  'line-height',
];

function computed(el: Element | null): Record<string, string> | null {
  if (!el) return null;
  const cs = getComputedStyle(el);
  const o: Record<string, string> = {};
  for (const p of STYLE_PROPS) o[p] = cs.getPropertyValue(p) || '(empty)';
  return o;
}

function supports(test: string): boolean {
  try {
    const [p, v] = test.split(':');
    return typeof CSS !== 'undefined' && CSS.supports(p.trim(), v.trim());
  } catch {
    return false;
  }
}

const CSS_TESTS = [
  'overflow-wrap:anywhere',
  'overflow-wrap:break-word',
  'word-break:break-word',
  'white-space:pre-wrap',
  'display:flex',
  'display:grid',
  'container-type:inline-size',
  'contain:strict',
];

function splitFamilies(f: string): string[] {
  return f
    .split(',')
    .map((x) => x.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}
const GENERIC = new Set([
  'monospace',
  'serif',
  'sans-serif',
  'system-ui',
  'cursive',
  'fantasy',
  'ui-monospace',
  'ui-sans-serif',
]);

export function probeFonts(families: string[], size: number): FontProbe[] {
  const ctx = document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmmmlliWW@0123456789';
  const width = (font: string): number => {
    if (!ctx) return 0;
    ctx.font = `${size}px ${font}`;
    return ctx.measureText(sample).width;
  };
  const baseMono = width('monospace');
  const baseSerif = width('serif');
  const baseSans = width('sans-serif');
  return families.map((family) => {
    let fontsCheck = false;
    try {
      fontsCheck = document.fonts?.check(`${size}px "${family}"`) ?? false;
    } catch {
      /* not supported */
    }
    let installed = GENERIC.has(family.toLowerCase());
    if (!installed && ctx) {
      const q = `"${family}"`;
      installed =
        width(`${q}, monospace`) !== baseMono ||
        width(`${q}, serif`) !== baseSerif ||
        width(`${q}, sans-serif`) !== baseSans;
    }
    return { family, fontsCheck, installed };
  });
}

function makeHost(pane: Element | null, width: number): HTMLDivElement {
  const host = document.createElement('div');
  const cs = pane
    ? getComputedStyle(pane)
    : getComputedStyle(document.querySelector('.app') ?? document.body);
  Object.assign(host.style, {
    position: 'absolute',
    left: '-99999px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${width}px`,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight === 'normal' ? '1.2' : cs.lineHeight,
    fontVariantLigatures: 'none',
    tabSize: '8',
  });
  host.setAttribute('aria-hidden', 'true');
  return host;
}

const UNBROKEN = 'x'.repeat(300);
const SPACED =
  Array.from({ length: 50 }, (_, i) => `word${String(i).padStart(2, '0')}`).join(' ') +
  ' ' +
  'tail'.repeat(5);

export function gatherRender(): RenderInfo {
  const pane = document.querySelector<HTMLElement>('.output');
  const liveRowEl = pane?.querySelector('.row') ?? null;
  const liveTextEl = pane?.querySelector('.row .text') ?? null;
  const paneWidth = pane ? pane.clientWidth : null;
  const padding = pane
    ? parseFloat(getComputedStyle(pane).paddingLeft || '0') +
      parseFloat(getComputedStyle(pane).paddingRight || '0')
    : 16;
  const rowWidth = Math.max(60, Math.floor((paneWidth ?? Math.max(200, window.innerWidth - 40)) - padding));
  const host = makeHost(pane, rowWidth);
  document.body.appendChild(host);
  try {
    const mk = (text: string, cls = 'row'): { row: HTMLElement; span: HTMLElement } => {
      const row = document.createElement('div');
      row.className = cls;
      const span = document.createElement('span');
      span.className = 'text';
      span.textContent = text;
      row.appendChild(span);
      host.appendChild(row);
      return { row, span };
    };
    const one = mk('M');
    const lh =
      one.row.getBoundingClientRect().height || parseFloat(getComputedStyle(one.row).lineHeight) || 16;
    const probeRow = computed(one.row) ?? {};
    const probeText = computed(one.span) ?? {};
    const run = (name: string, text: string, cls = 'row'): WrapTest => {
      const { row } = mk(text, cls);
      const h = row.getBoundingClientRect().height;
      const lines = Math.max(1, Math.round(h / lh));
      return {
        name,
        chars: text.length,
        height: Math.round(h * 100) / 100,
        lineHeight: Math.round(lh * 100) / 100,
        lines,
        wrapped: h > lh * 1.5,
      };
    };
    const wrapTests = [run('unbroken string', UNBROKEN), run('long spaced string', SPACED)];
    // control: the same unbroken string without the app's wrap rules, to show what "not wrapping" looks like
    const ctl = document.createElement('div');
    ctl.style.cssText = 'white-space:pre;position:absolute;top:0;left:0;width:100%';
    ctl.textContent = UNBROKEN;
    host.appendChild(ctl);
    const ch = ctl.getBoundingClientRect().height;
    wrapTests.push({
      name: 'control (white-space:pre)',
      chars: UNBROKEN.length,
      height: Math.round(ch * 100) / 100,
      lineHeight: Math.round(lh * 100) / 100,
      lines: Math.max(1, Math.round(ch / lh)),
      wrapped: ch > lh * 1.5,
    });

    const m = document.createElement('span');
    m.style.cssText = 'white-space:pre;position:absolute;top:0;left:0';
    m.textContent = '0'.repeat(100);
    host.appendChild(m);
    const charDom = m.getBoundingClientRect().width / 100;
    const ctx = document.createElement('canvas').getContext('2d');
    let charCanvas = 0;
    if (ctx) {
      const cs = getComputedStyle(host);
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      charCanvas = ctx.measureText('0').width;
    }
    return {
      css: CSS_TESTS.map((t) => ({ test: t, ok: supports(t) })),
      liveRow: computed(liveRowEl),
      liveText: computed(liveTextEl),
      probeRow,
      probeText,
      paneClientWidth: paneWidth,
      rowWidth,
      charWidthDom: charDom,
      charWidthCanvas: charCanvas,
      charsPerLine: charDom > 0 ? Math.floor(rowWidth / charDom) : 0,
      wrapTests,
    };
  } finally {
    host.remove();
  }
}

function gatherDisplay(settings: Settings): DisplayInfo {
  const pane = document.querySelector('.output');
  const family = pane ? getComputedStyle(pane).fontFamily : settings.fontFamily;
  const size = pane ? parseFloat(getComputedStyle(pane).fontSize) || settings.fontSize : settings.fontSize;
  const mq = (q: string): boolean => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const fonts = probeFonts(splitFamilies(family), size);
  const first = fonts.find((f) => f.installed && !GENERIC.has(f.family.toLowerCase()));
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenWidth: screen.width,
    screenHeight: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    devicePixelRatio: window.devicePixelRatio,
    colorScheme: mq('(prefers-color-scheme: dark)')
      ? 'dark'
      : mq('(prefers-color-scheme: light)')
        ? 'light'
        : 'no-preference',
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    fontFamily: family,
    fontSize: size,
    fonts,
    resolvedFont: first?.family ?? '',
  };
}

export function summariseSquatters(list: readonly SquatterConfig[]): SquatterSummary[] {
  return list.map((s) => ({
    kind: s.kind ?? 'squatterd',
    paired: s.paired,
    state: s.state ?? 'unknown',
    problem: s.problem,
    automation: s.automation,
    role: s.role,
    instance: undefined, // an id of someone's TinyFugue: not needed, left out
    features: s.features ?? [],
    sessions: s.sessions,
    host: s.host,
    port: s.port,
  }));
}

export function summariseSessions(list: readonly SessionInfo[]): SessionSummary[] {
  return list.map((s) => ({
    state: s.state,
    link: s.link,
    via: s.via,
    gameType: s.gameType,
    gameFamily: s.gameFamily,
    gameTypeSource: s.gameTypeSource,
    tls: s.tls,
    tlsVerify: s.tlsVerify,
    encoding: s.encoding,
    remoteEcho: s.remoteEcho,
    tf: !!s.tf,
    host: s.host,
    port: s.port,
  }));
}

export interface GatherInput {
  engine: EngineAPI | null;
  settings: Settings;
  squatters: readonly SquatterConfig[];
  sessions: readonly SessionInfo[];
  appVersion?: string;
}

export async function gatherDiagnostics(i: GatherInput): Promise<DiagData> {
  let go: DiagReport | null = null;
  let goError: string | undefined;
  try {
    go = (await i.engine?.diagnostics()) ?? null;
  } catch (e) {
    goError = e instanceof Error ? e.message : String(e);
  }
  return {
    generatedAt: new Date().toISOString(),
    appVersionFromUi: i.appVersion ?? '',
    go,
    goError,
    userAgent: navigator.userAgent,
    language: navigator.languages?.join(', ') || navigator.language,
    jsTimezone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return '';
      }
    })(),
    display: gatherDisplay(i.settings),
    render: gatherRender(),
    settings: { ...i.settings },
    squatters: summariseSquatters(i.squatters),
    sessions: summariseSessions(i.sessions),
    problems: [...getProblems()],
  };
}
