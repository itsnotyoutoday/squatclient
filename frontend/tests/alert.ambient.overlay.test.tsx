import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useSessions } from '../src/state/stores';
import { useAmbient, usePane } from '../src/cmcp/pane';
import { AlertAmbientOverlay } from '../src/components/AlertAmbientOverlay';

beforeEach(() => {
  useSessions.setState({ fg: 's1' } as never);
  useAmbient.setState({ by: {} });
  usePane.setState({ by: {} });
});

describe('the alert ambience in the plain text UI (a room, the dock)', () => {
  it('draws nothing on a green alert, and an edge plus glow on a red one', () => {
    render(<AlertAmbientOverlay />);
    expect(screen.queryByTestId('alert-ambient')).toBeNull();
    act(() => useAmbient.getState().set('s1', { edge: '#ff2020' }));
    const el = screen.getByTestId('alert-ambient');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.boxShadow).toContain('#ff2020');
    act(() => useAmbient.getState().set('s1', undefined));
    expect(screen.queryByTestId('alert-ambient')).toBeNull();
  });
  it('is the scene that draws it when a console screen is up', () => {
    act(() => useAmbient.getState().set('s1', { edge: '#ff2020' }));
    act(() => usePane.getState().set('s1', true, false));
    render(<AlertAmbientOverlay />);
    expect(screen.queryByTestId('alert-ambient')).toBeNull();
    act(() => usePane.getState().set('s1', true, true)); // screen switched off: the text has the area again
    expect(screen.getByTestId('alert-ambient')).toBeTruthy();
  });
  it('only the foreground session shows its ambience', () => {
    act(() => useAmbient.getState().set('s2', { edge: '#ffcc33' }));
    render(<AlertAmbientOverlay />);
    expect(screen.queryByTestId('alert-ambient')).toBeNull();
  });
});
