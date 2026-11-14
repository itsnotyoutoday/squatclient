import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { buildReport, gatherDiagnostics, gatherRender } from '../src/lib/diagnostics';
import type { DiagData } from '../src/lib/diagnostics';
import { MAX_PROBLEMS, clearProblems, getProblems, recordProblem } from '../src/lib/problems';
import { REDACTED, redact, safeValue } from '../src/lib/redact';
import { resetStores, useSettings, useUi } from '../src/state/stores';
import { DEFAULT_SETTINGS } from '../src/api/types';

const PAIR = 'ABCD-EFGH';
const HEX = 'deadbeefcafebabe0123456789abcdef0123';
const TOKEN = 'tok_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d';
const PW = 'hunter2secret';
const HOST = 'mush.secret-game.example.org';
const FPR = 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';

describe('redact', () => {
  it('removes passwords, tokens, pairing codes, hex, fingerprints and url credentials', () => {
    const cases = [
      `password=${PW}`,
      `{"password":"${PW}"}`,
      `connect failed: pwd: ${PW}`,
      `token ${TOKEN}`,
      `Authorization: Bearer ${TOKEN}`,
      `pairing code ${PAIR} rejected`,
      `key ${HEX}`,
      `fingerprint ${FPR}`,
      `wss://user:${PW}@host/path`,
      `api_key = ${TOKEN}`,
    ];
    for (const c of cases) {
      const r = redact(c);
      for (const secret of [PW, TOKEN, PAIR, HEX, FPR]) expect(r).not.toContain(secret);
    }
    expect(redact(`code ${PAIR}`)).toContain(REDACTED);
  });

  it('keeps ordinary text, and hides hosts and addresses on request', () => {
    expect(redact('Layout "x" Lua: attempt to index nil')).toBe('Layout "x" Lua: attempt to index nil');
    expect(redact('cannot reach 10.1.2.3:4201')).toBe('cannot reach [ip]');
    expect(redact(`cannot reach ${HOST}:4201`)).not.toContain(HOST);
    expect(redact(`dns ${HOST}`, { hosts: [HOST] })).toBe('dns [host]');
    expect(redact('cannot reach 10.1.2.3', { network: false })).toContain('10.1.2.3');
  });

  it('safeValue hides secret-named settings entirely', () => {
    expect(safeValue('apiToken', 'abc')).toBe(REDACTED);
    expect(safeValue('fontSize', 14)).toBe('14');
    expect(safeValue('fontFamily', 'JetBrains Mono')).toBe('"JetBrains Mono"');
  });
});

describe('problem log', () => {
  beforeEach(clearProblems);
  it('is bounded, redacted and collapses repeats', () => {
    for (let i = 0; i < MAX_PROBLEMS + 30; i++) recordProblem('toast', `distinct ${i}`, i * 10000);
    expect(getProblems()).toHaveLength(MAX_PROBLEMS);
    expect(getProblems().at(-1)?.message).toBe(`distinct ${MAX_PROBLEMS + 29}`);
    clearProblems();
    recordProblem('error', `boom ${PAIR}`, 1000);
    recordProblem('error', `boom ${PAIR}`, 1500);
    expect(getProblems()).toHaveLength(1);
    expect(getProblems()[0].count).toBe(2);
    expect(getProblems()[0].message).not.toContain(PAIR);
  });
});

function planted(): DiagData {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    appVersionFromUi: '1.0.0',
    go: {
      app: {
        version: '1.0.0',
        commit: 'abc',
        buildDate: '2026-01-01',
        buildType: 'production',
        engineVersion: 'v0.1.0',
        swpVersion: 1,
      },
      platform: {
        os: 'windows',
        osName: 'Windows 11 Pro 23H2',
        osVersion: '10.0.22631.3007',
        arch: 'amd64',
        goVersion: 'go1.24',
        locale: 'en-GB',
        timezone: 'Europe/London (GMT, UTC+00:00)',
        numCPU: 8,
        notes: ['running under Wine'],
      },
      webview: { engine: 'WebView2', version: '120.0.2210.91', note: '' },
      paths: {
        config: '~\\AppData\\Roaming\\SquatClient',
        data: '~\\AppData\\Roaming\\SquatClient',
        logs: '~\\AppData\\Roaming\\SquatClient\\logs',
      },
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edg/120',
    language: 'en-GB',
    jsTimezone: 'Europe/London',
    display: {
      innerWidth: 1100,
      innerHeight: 700,
      outerWidth: 1100,
      outerHeight: 760,
      screenWidth: 1920,
      screenHeight: 1080,
      availWidth: 1920,
      availHeight: 1040,
      devicePixelRatio: 1.25,
      colorScheme: 'dark',
      reducedMotion: false,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      fonts: [{ family: 'JetBrains Mono', fontsCheck: true, installed: false }],
      resolvedFont: '',
    },
    render: {
      css: [{ test: 'overflow-wrap:anywhere', ok: true }],
      liveRow: null,
      liveText: null,
      probeRow: { 'white-space': 'pre-wrap' },
      probeText: { 'min-width': '0px' },
      paneClientWidth: 800,
      rowWidth: 784,
      charWidthDom: 8.4,
      charWidthCanvas: 8.4,
      charsPerLine: 93,
      wrapTests: [
        { name: 'unbroken string', chars: 300, height: 100, lineHeight: 20, lines: 5, wrapped: true },
      ],
    },
    settings: { ...DEFAULT_SETTINGS, password: PW, apiToken: TOKEN, note: `x ${PAIR}` },
    squatters: [
      {
        kind: 'squatterd',
        paired: true,
        state: 'connected',
        features: ['history'],
        sessions: 1,
        host: HOST,
        port: 4400,
        problem: `auth ${PAIR}`,
      },
    ],
    sessions: [
      {
        state: 'connected',
        link: 'attached',
        via: 'sq1',
        gameType: 'pennmush',
        tls: true,
        remoteEcho: false,
        tf: false,
        host: HOST,
        port: 4201,
      },
    ],
    problems: [
      { ts: 0, source: 'error', message: `password=${PW} ${HEX}`, count: 1 },
      { ts: 0, source: 'toast', message: `connect ${HOST}:4201 failed with token ${TOKEN}`, count: 2 },
    ],
  };
}

describe('buildReport', () => {
  it('never contains planted secrets, and leaves hostnames out by default', () => {
    const t = buildReport(planted(), { includeHostnames: false });
    for (const s of [PW, TOKEN, PAIR, HEX, FPR, HOST]) expect(t).not.toContain(s);
    expect(t).toContain('Windows 11 Pro 23H2');
    expect(t).toContain('WebView2');
    expect(t).toContain('LIVE WRAP TEST');
    expect(t).toContain('WRAPPED');
    expect(t).toContain('NONE of the listed fonts is installed');
  });

  it('includes hostnames only when asked, but never the secrets', () => {
    const t = buildReport(planted(), { includeHostnames: true });
    expect(t).toContain(`host=${HOST}:4201`);
    for (const s of [PW, TOKEN, PAIR, HEX]) expect(t).not.toContain(s);
  });

  it('has every section', () => {
    const t = buildReport(planted(), { includeHostnames: false });
    for (const h of [
      'App',
      'Platform',
      'Web view',
      'Display',
      'Rendering checks',
      'Settings',
      'Squatters and sessions',
      'Recent problems',
      'Paths',
    ]) {
      expect(t).toContain(`== ${h}`);
    }
  });

  it('says so when the native info is unavailable', () => {
    const d = planted();
    d.go = null;
    d.goError = 'Wails binding App.Diagnostics is not available';
    expect(buildReport(d, { includeHostnames: false })).toContain('unavailable');
  });
});

describe('gathering in the DOM', () => {
  it('runs the wrap test and fills every section without throwing', async () => {
    const d = await gatherDiagnostics({
      engine: new MockEngine(),
      settings: DEFAULT_SETTINGS,
      squatters: [],
      sessions: [],
    });
    expect(d.render.wrapTests.map((t) => t.name)).toEqual([
      'unbroken string',
      'long spaced string',
      'control (white-space:pre)',
    ]);
    expect(d.render.css.length).toBeGreaterThan(5);
    expect(gatherRender().probeRow).toBeTruthy();
    expect(buildReport(d, { includeHostnames: false })).toContain('== Rendering checks');
  });
});

describe('Diagnostics dialog', () => {
  beforeEach(() => resetStores());
  it('opens from the Help menu and shows the report', async () => {
    window.history.replaceState({}, '', '/?platform=windows');
    render(<App engine={new MockEngine({ scenario: 'demo' })} />);
    await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
    act(() => useUi.getState().openDialog(null));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Help' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Diagnostics/ }));
    expect(await screen.findByRole('dialog', { name: 'Diagnostics' })).toBeInTheDocument();
    const box = (await screen.findByLabelText('Diagnostics report')) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain('== Platform'));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as file...' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Include hostnames/)).not.toBeChecked();
  });
});
