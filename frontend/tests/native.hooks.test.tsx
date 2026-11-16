import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { findTheme } from '../src/themes';
import { dark, highContrast, light } from '../src/themes/builtin';
import { stubLayout } from './helpers';

let engine: MockEngine;
beforeEach(() => {
  stubLayout();
  resetStores();
  clearHistories();
  vi.spyOn(document, 'hasFocus').mockImplementation(() => false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function boot(): Promise<{ fg: string; other: string }> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().order.length).toBeGreaterThan(1));
  const s = useSessions.getState();
  return { fg: s.fg as string, other: s.order.find((id) => id !== s.fg) as string };
}

describe('icon badge', () => {
  it('shows the unread count of the worlds you are not looking at, and clears it', async () => {
    const { other } = await boot();
    await waitFor(() => expect(engine.badge.at(-1)).toBeDefined());
    const before = engine.badge.at(-1) ?? 0;
    act(() => void engine.pushLine(other, [{ s: 'new' }]));
    await waitFor(() => expect(engine.badge.at(-1)).toBe(before + 1));
    useSettings.getState().set({ ...useSettings.getState().settings, iconBadge: false });
    await waitFor(() => expect(engine.badge.at(-1)).toBe(0));
  });
});

describe('native notifications', () => {
  it('notifies once for new text in a world that is not in front, with its first line, and not again at once', async () => {
    const { other } = await boot();
    useSettings.getState().set({ ...useSettings.getState().settings, notifications: true });
    act(() => void engine.pushLine(other, [{ s: 'Saeihr pages you: hello' }]));
    await waitFor(() => expect(engine.notified).toHaveLength(1));
    expect(engine.notified[0]).toMatchObject({ body: 'Saeihr pages you: hello', session: other });
    act(() => void engine.pushLine(other, [{ s: 'and a second line' }]));
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.notified).toHaveLength(1);
  });

  it('stays quiet until the player turns them on, and a click on one brings the world forward', async () => {
    const { fg, other } = await boot();
    expect(useSettings.getState().settings.notifications).toBe(false); // off until asked for: some people find them a pest
    act(() => void engine.pushLine(other, [{ s: 'silent' }]));
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.notified).toHaveLength(0);
    expect(useSessions.getState().fg).toBe(fg);
    act(() =>
      (engine as unknown as { emit(e: string, p: unknown): void }).emit('notify-click', { session: other }),
    );
    await waitFor(() => expect(useSessions.getState().fg).toBe(other));
  });
});

describe('the window does not follow the system look', () => {
  it('uses the dark theme by default, and the OS colour scheme does not change it', () => {
    expect(useSettings.getState().settings.theme).toBe('dark');
    const mq = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: q.includes('light') || q.includes('contrast'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    expect(findTheme(useSettings.getState().settings.theme)).toBe(dark);
    mq.mockRestore();
  });

  it('migrates a settings file that still says "system" to the dark theme', () => {
    expect(findTheme('system')).toBe(dark); // the engine rewrites it too; this is the belt and braces
  });

  it('still offers light and high contrast to anyone who picks them', () => {
    expect(findTheme('light')).toBe(light);
    expect(findTheme('high-contrast')).toBe(highContrast);
  });
});
