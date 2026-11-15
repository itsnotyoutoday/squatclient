import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { SYSTEM_THEME, findTheme, setPortalLook, useSystemLook } from '../src/themes';
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
  useSystemLook.setState({ dark: true, highContrast: false });
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
    act(() => void engine.pushLine(other, [{ s: 'Saeihr pages you: hello' }]));
    await waitFor(() => expect(engine.notified).toHaveLength(1));
    expect(engine.notified[0]).toMatchObject({ body: 'Saeihr pages you: hello', session: other });
    act(() => void engine.pushLine(other, [{ s: 'and a second line' }]));
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.notified).toHaveLength(1);
  });

  it('stays quiet when the setting is off, and a click on one brings the world forward', async () => {
    const { fg, other } = await boot();
    useSettings.getState().set({ ...useSettings.getState().settings, notifications: false });
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

describe('Follow the system theme', () => {
  it('is dark, light or high contrast as the operating system asks', () => {
    useSystemLook.setState({ dark: true, highContrast: false });
    expect(findTheme(SYSTEM_THEME)).toBe(dark);
    useSystemLook.setState({ dark: false, highContrast: false });
    expect(findTheme(SYSTEM_THEME)).toBe(light);
    useSystemLook.setState({ dark: false, highContrast: true });
    expect(findTheme(SYSTEM_THEME)).toBe(highContrast);
  });

  it('on Linux the desktop portal decides, and a later change from it is followed', () => {
    setPortalLook({ dark: false, highContrast: false });
    expect(findTheme(SYSTEM_THEME)).toBe(light);
    setPortalLook({ dark: true, highContrast: true });
    expect(findTheme(SYSTEM_THEME)).toBe(highContrast);
  });
});
