import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutputPane } from '../src/components/output/OutputPane';
import { getBuffer, resetStores, useSessions, useSettings } from '../src/state/stores';
import { DEFAULT_SETTINGS } from '../src/api/types';
import type { Line } from '../src/api/types';
import { mkLine, stubLayout } from './helpers';

let restore: () => void;
beforeEach(() => {
  restore = stubLayout(600, 20);
  resetStores();
});
afterEach(() => restore());

function load(id: string, n: number, mk: (i: number) => Line = (i) => mkLine(id, i)): void {
  const lines = Array.from({ length: n }, (_, i) => mk(i + 1));
  getBuffer(id).merge(lines);
  useSessions.getState().bump([id]);
}

describe('OutputPane virtualisation', () => {
  it('renders only a window of rows for 100k lines', () => {
    load('s1', 100_000);
    render(<OutputPane sessionId="s1" />);
    const rows = document.querySelectorAll('.row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(120);
    // scrolling to the live end moves the window there (still a small window)
    const out = screen.getByTestId('output');
    out.scrollTop = 100_000 * 20 - 600;
    fireEvent.scroll(out);
    const after = document.querySelectorAll('.row');
    expect(after.length).toBeLessThan(120);
    const seqs = [...after].map((r) => Number((r as HTMLElement).dataset.seq));
    expect(Math.max(...seqs)).toBeGreaterThan(99_900);
  });

  it('renders coloured spans with exact colours', () => {
    load('s1', 1, () =>
      mkLine('s1', 1, [
        { s: 'red', fg: 196 },
        { s: 'true', fg: '#123456', bg: '#abcdef' },
        { s: 'ansi', fg: 1 },
      ]),
    );
    render(<OutputPane sessionId="s1" />);
    const spans = [...document.querySelectorAll('.row .text span')] as HTMLElement[];
    const byText = (t: string): HTMLElement => spans.find((s) => s.textContent === t) as HTMLElement;
    expect(byText('red').style.color).toBe('rgb(255, 0, 0)');
    expect(byText('true').style.color).toBe('rgb(18, 52, 86)');
    expect(byText('true').style.backgroundColor).toBe('rgb(171, 205, 239)');
    expect(byText('ansi').style.color).toBe('rgb(224, 108, 117)'); // dark theme ansi[1] #e06c75
  });

  it('shows a timestamp gutter only when enabled, excluded from selection', () => {
    load('s1', 3);
    const { rerender } = render(<OutputPane sessionId="s1" />);
    expect(document.querySelector('.ts')).toBeNull();
    act(() => useSettings.getState().set({ ...DEFAULT_SETTINGS, timestamps: true }));
    rerender(<OutputPane sessionId="s1" />);
    const ts = document.querySelector('.ts');
    expect(ts).not.toBeNull();
    expect(ts?.getAttribute('aria-hidden')).toBe('true');
  });

  it('makes only http(s) links clickable', () => {
    load('s1', 1, () =>
      mkLine('s1', 1, [
        { s: 'go https://ok.example/x and javascript:alert(1)' },
        { s: 'bad', link: 'javascript:alert(1)' },
      ]),
    );
    render(<OutputPane sessionId="s1" />);
    const anchors = document.querySelectorAll('.row a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://ok.example/x');
  });

  it('keeps plain text copyable: DOM text equals the line text', () => {
    load('s1', 1, () =>
      mkLine('s1', 1, [
        { s: 'café \u{1F600} ', fg: 2 },
        { s: '日本', b: true },
      ]),
    );
    render(<OutputPane sessionId="s1" />);
    expect(document.querySelector('.row .text')?.textContent).toBe('café \u{1F600} 日本');
  });

  it('pauses when scrolled up, counts unread, and jumps back to live', () => {
    load('s1', 500);
    render(<OutputPane sessionId="s1" />);
    const out = screen.getByTestId('output');
    Object.defineProperty(out, 'scrollHeight', { value: 10_000, configurable: true });
    // user at bottom first
    out.scrollTop = 9400;
    fireEvent.scroll(out);
    expect(screen.queryByText(/jump to live/)).toBeNull();
    // scroll up
    out.scrollTop = 5000;
    fireEvent.scroll(out);
    expect(screen.getByText(/jump to live/)).toBeInTheDocument();
    expect(useSessions.getState().paused.s1.paused).toBe(true);
    // new lines arrive: no auto-scroll, unread counted
    const top = out.scrollTop;
    act(() => {
      getBuffer('s1').merge([mkLine('s1', 501), mkLine('s1', 502), mkLine('s1', 503)]);
      useSessions.getState().bump(['s1']);
    });
    expect(out.scrollTop).toBe(top);
    expect(screen.getByText(/3 new lines/)).toBeInTheDocument();
    expect(useSessions.getState().paused.s1.unread).toBe(3);
    // jump to live
    fireEvent.click(screen.getByText(/jump to live/));
    expect(screen.queryByText(/jump to live/)).toBeNull();
    expect(useSessions.getState().paused.s1).toEqual({ paused: false, unread: 0 });
  });

  it('does not pause when pauseOnScroll is off', () => {
    act(() => useSettings.getState().set({ ...DEFAULT_SETTINGS, pauseOnScroll: false }));
    load('s1', 500);
    render(<OutputPane sessionId="s1" />);
    const out = screen.getByTestId('output');
    Object.defineProperty(out, 'scrollHeight', { value: 10_000, configurable: true });
    out.scrollTop = 9400;
    fireEvent.scroll(out);
    out.scrollTop = 100;
    fireEvent.scroll(out);
    expect(screen.queryByText(/jump to live/)).toBeNull();
  });

  it('exposes the output as a log landmark with a label', () => {
    load('s1', 2);
    render(<OutputPane sessionId="s1" />);
    expect(screen.getByRole('log', { name: 'Game output' })).toBeInTheDocument();
  });
});
