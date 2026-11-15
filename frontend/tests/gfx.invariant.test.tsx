import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { planScene, MIN_TEXT, MIN_TEXT_STRIP_H, stripBasis } from '../src/gfx/port';
import { DEFAULT_CONFIG } from '../src/gfx/scene';
import type { SceneConfig } from '../src/gfx/types';
import { MockEngine } from '../src/api/mock';

const cfg = (o: Partial<SceneConfig> = {}): SceneConfig => ({ ...DEFAULT_CONFIG, ...o });

describe('the text port and input are never covered (planScene)', () => {
  it('turns every scene that could cover the text into a strip that leaves the text its share', () => {
    for (const dock of ['left', 'right', 'float', 'full', 'top', 'bottom'] as const) {
      const p = planScene(cfg({ dock, size: '100%', margin: [0, 0, 0, 0] }), { w: 900, h: 600 });
      if (dock === 'full' || dock === 'left' || dock === 'right' || dock === 'float' || dock === 'top' || dock === 'bottom') {
        expect(p.mode).toBe('strip'); // no port declared: no frame, so a strip, whatever size was asked
        if (p.mode === 'strip') expect(stripBasis(p.size)).toContain(`calc(100% - ${MIN_TEXT_STRIP_H}px)`);
      }
    }
    expect(stripBasis('100%')).toBe(`max(0px, min(100%, calc(100% - ${MIN_TEXT_STRIP_H}px)))`);
  });
  it('allows the frame layout only with a usable text port', () => {
    const ok = cfg({ w: 1600, h: 900, port: [240, 640, 860, 182] });
    const p = planScene(ok, { w: 1100, h: 720 });
    expect(p.mode).toBe('frame');
    if (p.mode === 'frame') {
      expect(p.out.w).toBeGreaterThanOrEqual(MIN_TEXT.w);
    }
    // too small a pane for the scene plus a usable port: the graphics hide, the text stays
    expect(planScene(ok, { w: 380, h: 300 }).mode).toBe('hidden');
    // a port that leaves the pane (a script asking for the moon) is refused
    expect(planScene(cfg({ port: [0, 0, 99999, 99999] }), { w: 900, h: 600 }).mode).toBe('hidden');
    expect(planScene(ok, { w: 0, h: 0 }).mode).toBe('hidden');
  });
  it('a port too small is refused', () => {
    expect(planScene(cfg({ w: 1600, h: 900, port: [0, 0, 40, 40] }), { w: 1600, h: 900 }).mode).toBe('hidden');
    expect(planScene(cfg({ w: 1600, h: 900, port: [0, 0, 40, 40] }), { w: 1600, h: 900 }).mode).toBe('hidden');
  });
});

vi.mock('../src/gfx/renderer', () => ({
  GfxRenderer: class {
    static supported(): boolean { return true; }
    constructor() { throw new Error('boom: the GL context could not be created'); }
  },
}));

describe('a failing renderer leaves the text and input usable', () => {
  afterEach(() => vi.restoreAllMocks());
  it('drops the graphics, reports it once and keeps the DOM text and input', async () => {
    const { GfxProvider, GfxPane } = await import('../src/gfx/GfxHost');
    const engine = new MockEngine();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <GfxProvider engine={engine}>
        <div className="lay-mush">
          <GfxPane sessionId="s1" />
          <div data-testid="text" role="log">the game output</div>
        </div>
        <input aria-label="game input" />
      </GfxProvider>,
    );
    await act(async () => {
      (engine as unknown as { emit(e: string, p: unknown): void }).emit?.('gfx', [{ op: 'scene', session: 's1', scene: 'x', open: true, dock: 'full' }, { op: 'create', session: 's1', scene: 'x', id: 'r', type: 'rect', props: { w: 5, h: 5 } }]);
    });
    expect(screen.getByTestId('text')).toBeTruthy();
    expect(screen.getByLabelText('game input')).toBeTruthy();
    expect(document.querySelector('.gfx-scene')).toBeNull(); // closed after the failure, not left covering anything
    expect(errors).toHaveBeenCalled(); // the failure was reported, once the scene was mounted and failed
    errors.mockRestore();
  });
});

describe('graphics are per session', () => {
  afterEach(() => vi.restoreAllMocks());
  const ops = [{ op: 'scene', session: 's2', scene: 'lcars', open: true, dock: 'full' }, { op: 'create', session: 's2', scene: 'lcars', id: 'r', type: 'rect', props: { w: 5, h: 5 } }];
  const emit = (engine: MockEngine, e: string, p: unknown): void => (engine as unknown as { emit(e: string, p: unknown): void }).emit(e, p);
  it('a scene of session s2 is not mounted by the pane of s1', async () => {
    const { GfxProvider, GfxPane } = await import('../src/gfx/GfxHost');
    const engine = new MockEngine();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<GfxProvider engine={engine}><GfxPane sessionId="s1" /></GfxProvider>);
    await act(async () => { emit(engine, 'gfx', ops); });
    expect(errors).not.toHaveBeenCalled(); // nothing tried to draw it (the mocked renderer fails when it does)
  });
  it('the pane of s2 mounts it, and a removed session loses its scene', async () => {
    const { GfxProvider, GfxPane } = await import('../src/gfx/GfxHost');
    const engine = new MockEngine();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<GfxProvider engine={engine}><GfxPane sessionId="s2" /></GfxProvider>);
    await act(async () => { emit(engine, 'gfx', ops); });
    expect(errors).toHaveBeenCalled();
    errors.mockClear();
    await act(async () => { emit(engine, 'session-removed', { id: 's2' }); emit(engine, 'gfx', [{ op: 'scene', session: 's2', scene: 'lcars', open: false }]); });
    expect(document.querySelector('[data-scene="lcars"]')).toBeNull();
  });
});
