import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog } from '../src/components/dialogs/SettingsDialog';
import { MockEngine } from '../src/api/mock';
import { DEFAULT_SETTINGS } from '../src/api/types';
import { useSettings, useUi } from '../src/state/stores';

describe('Settings: consoles and sound', () => {
  it('shows the CMCP section and saves a console theme, the sound folder and volumes', async () => {
    const engine = new MockEngine();
    const save = vi.spyOn(engine, 'saveSettings');
    vi.spyOn(engine, 'pickFolder').mockResolvedValue('/home/me/sounds');
    useUi.setState({ engine });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    render(<SettingsDialog />);
    expect(screen.getByText(/Game consoles \(CMCP\) and sound/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Console theme'), { target: { value: 'klingon' } });
    expect(useSettings.getState().settings.consoleTheme).toBe('klingon');
    fireEvent.click(screen.getAllByText('Browse...').slice(-1)[0]);
    await vi.waitFor(() => expect(useSettings.getState().settings.soundFolder).toBe('/home/me/sounds'));
    fireEvent.change(screen.getByLabelText('Master volume'), { target: { value: '35' } });
    expect(useSettings.getState().settings.soundVolume).toBe(35);
    fireEvent.change(screen.getByLabelText('alert volume'), { target: { value: '10' } });
    expect(useSettings.getState().settings.soundCategoryVolumes).toEqual({ alert: 10 });
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ consoleTheme: 'klingon', soundFolder: '/home/me/sounds', soundVolume: 35 });
  });
});
