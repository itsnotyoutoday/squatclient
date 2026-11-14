import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { evaluateLayout } from '../src/layout/runtime';
import { resetLayoutData, useLayoutData } from '../src/layout/store';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  resetLayoutData();
  clearHistories();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
});

// what the Go compiler (esbuild, CommonJS) produces for a layout with a gauge, hand-written here
const GAUGE_LAYOUT = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = function Layout() {
  return React.createElement(App, null,
    React.createElement(Mush),
    React.createElement(Gauge, { label: "HP", value: "gmcp:Char.Vitals.hp", max: "gmcp:Char.Vitals.maxhp" }),
    React.createElement(InputBar));
};`;

async function boot(): Promise<string> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().fg).toBeTruthy());
  return useSessions.getState().fg as string;
}
const use = (layout: string): void =>
  act(() => useSettings.setState({ settings: { ...useSettings.getState().settings, layout } }));

describe('user layouts', () => {
  it('a compiled user layout runs with the layout names in scope, and follows live data', async () => {
    const sid = await boot();
    engine.setLayout('mine', '<App>...</App>', GAUGE_LAYOUT);
    use('mine');
    act(() => useLayoutData.getState().ingestGmcp(sid, 'Char.Vitals', { hp: 40, maxhp: 80 }));
    const g = await screen.findByRole('progressbar', { name: 'HP' });
    expect(g).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByLabelText('Command input')).toBeInTheDocument(); // the shell's parts are all there
  });

  it('asks before running a layout nobody allowed, shows its source, and runs it once allowed', async () => {
    const sid = await boot();
    engine.setLayout('stranger', '<App>the source text</App>', GAUGE_LAYOUT, { allowed: false });
    use('stranger');
    act(() => useLayoutData.getState().ingestGmcp(sid, 'Char.Vitals', { hp: 1, maxhp: 2 }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/runs in this window/);
    expect(screen.queryByRole('progressbar', { name: 'HP' })).toBeNull(); // not running
    await userEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(screen.getByText('<App>the source text</App>')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow and use' }));
    expect(await screen.findByRole('progressbar', { name: 'HP' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Use classic" keeps the layout from running', async () => {
    await boot();
    engine.setLayout('nope', 'x', GAUGE_LAYOUT, { allowed: false });
    use('nope');
    await userEvent.click(await screen.findByRole('button', { name: 'Use classic' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Command input')).toBeInTheDocument();
  });

  it('a compile error or a missing layout shows a notice and the classic layout', async () => {
    await boot();
    engine.setLayout('broken', 'x', '', { allowed: true }); // the mock reports "cannot compile"
    use('broken');
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot compile/);
    expect(screen.getByLabelText('Command input')).toBeInTheDocument();
    use('ghost');
    expect(await screen.findByText(/no layout named "ghost"/)).toBeInTheDocument();
  });

  it('a layout that throws when evaluated falls back with the reason', async () => {
    await boot();
    engine.setLayout('boom', 'x', 'throw new Error("syntax kaput");');
    use('boom');
    expect(await screen.findByRole('alert')).toHaveTextContent(/syntax kaput/);
  });

  it('its <style> is added while the layout is in use and removed after', async () => {
    await boot();
    engine.setLayout('styled', 'x', GAUGE_LAYOUT, { css: '.lay-gauge { outline: 1px solid red }' });
    use('styled');
    await waitFor(() => expect(document.head.querySelector('style[data-layout="styled"]')).not.toBeNull());
    use('classic');
    await waitFor(() => expect(document.head.querySelector('style[data-layout="styled"]')).toBeNull());
  });

  it('editing the files reloads the layout in use', async () => {
    const sid = await boot();
    engine.setLayout('live', 'x', GAUGE_LAYOUT);
    use('live');
    act(() => useLayoutData.getState().ingestGmcp(sid, 'Char.Vitals', { hp: 5, maxhp: 10 }));
    await screen.findByRole('progressbar', { name: 'HP' });
    const text = GAUGE_LAYOUT.replace('"HP"', '"Health"');
    engine.setLayout('live', 'x2', text);
    expect(await screen.findByRole('progressbar', { name: 'Health' })).toBeInTheDocument();
  });
});

describe('evaluateLayout', () => {
  it('provides react and the layout API and nothing else', () => {
    const C = evaluateLayout(
      'exports.default = function L() { return React.createElement("div", null, typeof Gauge); };',
    );
    expect(typeof C).toBe('function');
    expect(() => evaluateLayout('const fs = require("fs"); exports.default = () => null;')).toThrow(
      /cannot import "fs"/,
    );
    expect(() => evaluateLayout('exports.default = 5;')).toThrow(/default export/);
    expect(() =>
      evaluateLayout('const sq = require("squat"); exports.default = function L() { return sq.Mush; };'),
    ).not.toThrow();
  });
});
