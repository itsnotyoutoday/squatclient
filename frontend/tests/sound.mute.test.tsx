import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MockEngine } from '../src/api/mock';
import { useSessions, useSettings, useUi } from '../src/state/stores';
import { useSoundMute } from '../src/state/soundMute';
import { GlobalMuteButton, WorldMuteButton } from '../src/components/SoundButtons';
import { DEFAULT_SETTINGS } from '../src/api/types';

let engine: MockEngine;
beforeEach(() => {
  engine = new MockEngine();
  useUi.setState({ engine } as never);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, soundMuted: false } } as never);
  useSessions.setState({ sessions: {}, fg: null } as never);
  useSoundMute.setState({ by: {} });
});

describe('the global mute button', () => {
  it('toggles soundMuted from a click, with an aria label and the key in its tooltip', async () => {
    render(<GlobalMuteButton />);
    const b = screen.getByRole('button', { name: 'Mute all sound' });
    expect(b.getAttribute('title')).toMatch(/Alt\+Shift\+M/);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { fireEvent.click(b); });
    expect(useSettings.getState().settings.soundMuted).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute all sound' }).getAttribute('aria-pressed')).toBe('true');
    expect((await engine.getSettings()).soundMuted).toBe(true);
  });
  it('toggles with Alt+Shift+M', async () => {
    render(<GlobalMuteButton />);
    await act(async () => { fireEvent.keyDown(window, { key: 'M', code: 'KeyM', altKey: true, shiftKey: true }); });
    expect(useSettings.getState().settings.soundMuted).toBe(true);
    await act(async () => { fireEvent.keyDown(window, { key: 'M', code: 'KeyM', altKey: true, shiftKey: true }); });
    expect(useSettings.getState().settings.soundMuted).toBe(false);
  });
  it('does not react to Alt+M (the CMCP screen menu)', async () => {
    render(<GlobalMuteButton />);
    await act(async () => { fireEvent.keyDown(window, { key: 'm', code: 'KeyM', altKey: true }); });
    expect(useSettings.getState().settings.soundMuted).toBe(false);
  });
});

describe('the world mute button', () => {
  it('mutes only this world through the engine and shows it', async () => {
    render(<WorldMuteButton session="s1" />);
    const b = screen.getByRole('button', { name: 'Mute sound for this world' });
    await act(async () => { fireEvent.click(b); });
    expect(engine.worldMuted.s1).toBe(true);
    expect(useSoundMute.getState().by.s1).toBe('world');
    expect(screen.getByRole('button', { name: 'Unmute sound for this world' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unmute sound for this world' })); });
    expect(engine.worldMuted.s1).toBe(false);
    expect(useSoundMute.getState().by.s1).toBe('');
  });
  it('shows the global mute (dim, slashed) without changing the world setting', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, soundMuted: true } } as never);
    render(<WorldMuteButton session="s1" />);
    const b = screen.getByRole('button', { name: 'Sound is muted by the global mute' });
    expect(b.className).toMatch(/globalmuted/);
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });
  it('the engine reports what mutes a session: global wins over world', async () => {
    await engine.setWorldSoundMuted('s1', true);
    expect(await engine.soundMuteState('s1')).toBe('world');
    await engine.saveSettings({ ...DEFAULT_SETTINGS, soundMuted: true });
    expect(await engine.soundMuteState('s1')).toBe('global');
  });
});

describe('the tab menu', () => {
  it('has "Mute sound for this world" and flips it', async () => {
    const { TabMenu } = await import('../src/components/tabs/TabMenu');
    const session = { id: 's1', name: 'W', host: 'h', port: 1, tls: false, state: 'connected', startedAt: 0, firstSeq: 0, lastSeq: 0, unread: 0, attached: 1, remoteEcho: false, via: 'direct', worldId: 'w1' } as never;
    const { unmount } = render(<TabMenu session={session} x={10} y={10} onClose={() => undefined} onCloseSession={() => undefined} />);
    await act(async () => { fireEvent.click(screen.getByText('Mute sound for this world')); });
    expect(engine.worldMuted.s1).toBe(true);
    unmount();
    render(<TabMenu session={session} x={10} y={10} onClose={() => undefined} onCloseSession={() => undefined} />);
    expect(screen.getByText('Unmute sound for this world')).toBeTruthy();
  });
});
