import type { EngineAPI } from '../api/types';

/**
 * The page's side of the diagnostics log (docs/DIAGNOSTICS.md): a cheap fire-and-forget logger that forwards to the Go side (which redacts and
 * writes), providers that describe the page's state for the snapshots, error hooks, the environment header, and the pure logic of the
 * "Send Diagnostics Log" walkthrough (steps, the issue-form URL). Nothing here uploads anything.
 */

let engine: EngineAPI | null = null;
let on = false;

/** Called once the engine is known and again whenever the logging switch changes. */
export function setDiagEngine(e: EngineAPI | null, enabled: boolean): void {
  engine = e;
  on = enabled;
}
export const diagEnabled = (): boolean => on;

/** One line of the timeline; layer is ui, web-audio, error, snapshot, session...; session is the engine's session id (the world name is looked up there). */
export function diagLog(layer: string, text: string, session = ''): void {
  if (!on || !engine) return;
  try {
    void engine.diagLog(layer, session, text).catch(() => undefined);
  } catch {
    /* logging must never break the page */
  }
}

// ---- state providers (snapshots)

const providers = new Map<string, () => string[]>();

/** A part of the page describes its own state for the snapshots ("tabs", "audio"...); returns the unregister function. */
export function registerDiagProvider(name: string, fn: () => string[]): () => void {
  providers.set(name, fn);
  return () => {
    if (providers.get(name) === fn) providers.delete(name);
  };
}

/** Writes one snapshot line per provider line (the Go side writes its own when it asks for this one). */
export function logPageSnapshot(why: string): void {
  for (const [name, fn] of providers) {
    try {
      for (const l of fn()) diagLog('snapshot', `${name}: ${l}`);
    } catch (e) {
      diagLog('error', `snapshot provider ${name} failed: ${String(e)}`);
    }
  }
  if (providers.size === 0) diagLog('snapshot', `page: no providers (${why})`);
}

// ---- errors

function stackOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message} | ${(e.stack ?? '').split('\n').slice(0, 12).join(' | ')}`;
  try {
    return typeof e === 'string' ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** window.onerror, unhandled rejections and console.error / console.warn go to the log with their stack. Returns the function that undoes it. */
export function installDiagHooks(): () => void {
  const onError = (ev: ErrorEvent): void => diagLog('error', `window.onerror: ${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno} ${ev.error ? stackOf(ev.error) : ''}`);
  const onRej = (ev: PromiseRejectionEvent): void => diagLog('error', `unhandledrejection: ${stackOf(ev.reason)}`);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRej);
  const origErr = console.error;
  const origWarn = console.warn;
  let inHook = false;
  const wrap = (level: 'error' | 'warn', orig: (...a: unknown[]) => void) => (...a: unknown[]): void => {
    orig.apply(console, a);
    if (inHook) return;
    inHook = true;
    try {
      diagLog(level === 'error' ? 'error' : 'ui', `console.${level}: ${a.map(stackOf).join(' ')}`);
    } finally {
      inHook = false;
    }
  };
  console.error = wrap('error', origErr);
  console.warn = wrap('warn', origWarn);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRej);
    console.error = origErr;
    console.warn = origWarn;
  };
}

/** The web view's side of the environment header: engine version, display, locale, audio decode support, WebGL. */
export function logEnvironment(): void {
  try {
    const a = document.createElement('audio');
    const can = (t: string): string => a.canPlayType(t) || 'no';
    let gl = 'none';
    try {
      const c = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      gl = c ? 'yes' : 'no';
    } catch {
      gl = 'error';
    }
    const AC = (window as unknown as { AudioContext?: unknown }).AudioContext;
    diagLog('session', `env web: ua=${navigator.userAgent} screen=${screen.width}x${screen.height} dpr=${window.devicePixelRatio} window=${window.innerWidth}x${window.innerHeight} locale=${navigator.language} webgl=${gl} audioContext=${AC ? 'yes' : 'no'}`);
    diagLog('session', `env web audio decode: ogg=${can('audio/ogg; codecs="vorbis"')} mp3=${can('audio/mpeg')} wav=${can('audio/wav')} aac=${can('audio/aac')} flac=${can('audio/flac')}`);
  } catch (e) {
    diagLog('error', `environment probe failed: ${stackOf(e)}`);
  }
}

// ---- the walkthrough

export type WizardStep = 'included' | 'save' | 'tell' | 'done';
export const WIZARD_STEPS: WizardStep[] = ['included', 'save', 'tell', 'done'];
export const STEP_TITLES: Record<WizardStep, string> = {
  included: "What's included",
  save: 'Save the file',
  tell: 'Tell us what happened',
  done: 'Done',
};

export interface WizardState {
  step: WizardStep;
  currentOnly: boolean;
  note: string;
  zip: { path: string; size: number } | null;
  issueOpened: boolean;
}
export const initialWizard = (): WizardState => ({ step: 'included', currentOnly: false, note: '', zip: null, issueOpened: false });

/** The step number (1-based) and how many there are. */
export const stepNumber = (s: WizardStep): number => WIZARD_STEPS.indexOf(s) + 1;

/** Step 1 can always go on; step 2 needs the zip to exist; step 3 can go to the optional last step at any time (the issue form is opened by its own button). */
export function canAdvance(s: WizardState): boolean {
  if (s.step === 'save') return s.zip !== null;
  return s.step !== 'done';
}
export function wizardNext(s: WizardState): WizardState {
  if (!canAdvance(s)) return s;
  return { ...s, step: WIZARD_STEPS[WIZARD_STEPS.indexOf(s.step) + 1] };
}
export function wizardBack(s: WizardState): WizardState {
  const i = WIZARD_STEPS.indexOf(s.step);
  return i <= 0 ? s : { ...s, step: WIZARD_STEPS[i - 1] };
}
/** Changing what is included makes a zip built earlier stale: it is forgotten (and must be saved again). */
export function wizardSetIncluded(s: WizardState, patch: Partial<Pick<WizardState, 'currentOnly' | 'note'>>): WizardState {
  const changed = (patch.currentOnly !== undefined && patch.currentOnly !== s.currentOnly) || (patch.note !== undefined && patch.note !== s.note);
  return { ...s, ...patch, zip: changed ? null : s.zip };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- the issue form URL

/** Defence in depth: the Go side already removed secrets from the lines it hands over; this removes the obvious ones from anything else that goes into a URL. */
export function scrub(s: string): string {
  return s
    .replace(/\b(connect|create)(\s+)("[^"]*"|'[^']*'|\S+)(\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2$3$4[redacted]')
    .replace(/(\/(?:squatter\s+)?pair\w*\s+)\S+/gi, '$1[redacted]')
    .replace(/(pair(?:ing)?[ _-]?code\s*[:=]\s*)("[^"]*"|\S+)/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*)("[^"]*"|(?:bearer\s+|basic\s+)?\S+)/gi, '$1[redacted]')
    .replace(/("?(?:password|passwd|passphrase|pass|pw|secret|token|api[_-]?key|private[_-]?key|cookie|bearer)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, '$1[redacted]')
    .replace(/(\b(?:password|passwd|passphrase)\s+(?:is|was)\s+)\S+/gi, '$1[redacted]')
    .replace(/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[redacted]@')
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, (m) => (/^[0-9a-fA-F]+$/.test(m) || m.includes('//') ? m : '[redacted-token]'));
}

export interface IssueInfo {
  repoSlug: string;
  build: string;
  os: string;
  arch: string;
  mode: string;
  /** the kind of game the active world is ("cobra", "mush", "tinyfugue"...), "" when unknown */
  worldType?: string;
  /** the app's own last error lines (already redacted by the Go side) */
  errors: string[];
  note: string;
}

/** The longest issue-form address the walkthrough opens (browsers and GitHub cope with more, but a short address survives copying and redirects). */
export const ISSUE_URL_MAX = 1800;

export interface IssueFields {
  title: string;
  build: string;
  os: string;
  mode: string;
  summary: string;
  what: string;
}

/** The text that goes into the form's fields, shortened so the whole address stays under the cap. The full log is never part of it. */
export function issueFields(i: IssueInfo): IssueFields {
  const errs = i.errors.map((l) => scrub(l.trim())).filter(Boolean);
  const note = scrub(i.note.trim());
  const firstErr = errs.length ? errs[errs.length - 1].replace(/^.*?\[error\]\s*/, '').slice(0, 70) : '';
  return {
    title: `[alpha] ${firstErr || 'problem report'}`,
    build: scrub(i.build),
    os: `${i.os} ${i.arch}`.trim(),
    mode: `${i.mode}${i.worldType ? ' / ' + i.worldType : ''}`,
    summary: errs.join('\n'),
    what: note,
  };
}

const enc = (kv: Record<string, string>): string =>
  Object.entries(kv)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** https://github.com/<repo>/issues/new?template=diagnostics.yml&title=...&build=...: every value URL-encoded, the length capped (the summary and the note shrink first). */
export function buildIssueUrl(i: IssueInfo): string {
  const f = issueFields(i);
  const base = `https://github.com/${i.repoSlug}/issues/new?template=diagnostics.yml&`;
  const make = (): string => base + enc({ title: f.title, build: f.build, os: f.os, mode: f.mode, summary: f.summary, what: f.what });
  let url = make();
  // shorten until it fits: the summary loses its oldest lines, then each field is cut in turn (summary, note, title); build, OS and mode stay
  for (let guard = 0; url.length > ISSUE_URL_MAX && guard < 4000; guard++) {
    if (f.summary.includes('\n')) {
      f.summary = f.summary.slice(f.summary.indexOf('\n') + 1);
    } else {
      const key = (['summary', 'what', 'title'] as const).find((k) => f[k].length > 0);
      if (!key) break;
      const cut = Math.max(8, Math.ceil((url.length - ISSUE_URL_MAX) / 2));
      f[key] = f[key].slice(0, Math.max(0, f[key].length - cut));
    }
    url = make();
  }
  return url;
}

/** The address of the repository's issue list (step 4's link). */
export const issuesUrl = (repoSlug: string): string => `https://github.com/${repoSlug}/issues`;

/** The private-delivery sentence of step 3, from the build's contact constants. */
export function privateDeliveryText(c: { contactName: string; contactHost: string; contactPort: number }): string {
  return `If you don't want to attach the file to a public issue, submit the issue without it and say so, or contact ${c.contactName} at ${c.contactHost} port ${c.contactPort} to arrange another private way to deliver it.`;
}
