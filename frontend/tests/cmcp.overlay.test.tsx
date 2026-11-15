import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { CmcpOverlays } from '../src/cmcp/OverlayLayer';
import { useOverlays } from '../src/cmcp/overlays';
import { draw, type Ctx } from '../src/cmcp/widgets';
import { findTextport, place } from '../src/cmcp/layout';
import { MockEngine } from '../src/api/mock';
import { useUi } from '../src/state/stores';
import type { CmcpNode } from '../src/cmcp/types';

const node = (w: string, props: Record<string, unknown>, layout: CmcpNode['layout'] = {}, children?: CmcpNode[]): CmcpNode => ({ path: w + Math.random(), widget: w, props, layout, enabled: true, events: ['heading', 'speed', 'warp', 'stop', 'engage', 'course', 'dock', 'undock'], children });
const tokens = { 'color.bg': '#000000', 'color.panel': '#111111', 'color.text': '#ffffff', 'color.dim': '#888888', 'color.accent': '#ff9900', 'color.accent2': '#33ccff', 'color.ok': '#00ff00', 'color.warn': '#ffff00', 'color.alert': '#ff0000', radius: 4 };

describe('helm-controls typed entry', () => {
  const helm = node('helm-controls', { bearing: { az: 258, mark: -30 }, warp: { factor: 2, max: 9 }, speed_mps: 0, selected: 11 }, { weight: 1 });
  const root = node('label', {}, { dir: 'col' }, [helm, { ...node('textport', {}, { size: 140, hasSize: true }), events: [] }]);
  const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tree: { tokens } as never, local: new Map(), history: new Map(), images: new Map(), readonly: false, reduceMotion: true, overlays: [], ...over });

  it('collects three typed inputs, none over the text port, and none while read-only', () => {
    const placed = place(root, { x: 0, y: 0, w: 1200, h: 675 });
    const c = ctx();
    draw(placed, c);
    expect(c.overlays!.map((o) => o.event)).toEqual(['heading', 'speed', 'warp']);
    const tp = findTextport(placed)!.rect;
    for (const o of c.overlays!) {
      const over = o.x < tp.x + tp.w && o.x + o.w > tp.x && o.y < tp.y + tp.h && o.y + o.h > tp.y;
      expect(over, `${o.id} is over the text port`).toBe(false);
    }
    const ro = ctx({ readonly: true });
    draw(placed, ro);
    expect(ro.overlays).toHaveLength(0);
    // the heading input shows the current bearing and builds an absolute {az, mark}
    expect(c.overlays![0].value).toBe('258');
    expect(c.overlays![0].build(90)).toEqual({ az: 90, mark: -30 });
  });

  it('sends the typed value on Enter, rejects out-of-range numbers, and keeps keys away from the scene', async () => {
    const engine = new MockEngine();
    useUi.setState({ engine });
    const placed = place(root, { x: 0, y: 0, w: 1200, h: 675 });
    const c = ctx();
    draw(placed, c);
    useOverlays.getState().set('s1', 1200, 675, c.overlays!);
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(675);
    render(<div style={{ width: 1200, height: 675 }}><CmcpOverlays session="s1" fit="contain" /></div>);
    const warp = await screen.findByLabelText('Warp factor');
    fireEvent.change(warp, { target: { value: '12' } });
    fireEvent.keyDown(warp, { key: 'Enter' });
    expect(engine.cmcpCalls.filter((x) => x.fn === 'cmcpEvent')).toHaveLength(0);
    fireEvent.change(warp, { target: { value: '5' } });
    fireEvent.keyDown(warp, { key: 'Enter' });
    await vi.waitFor(() => expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpEvent', args: [expect.any(String), 'warp', 5] }));
    act(() => useOverlays.getState().clear('s1'));
    w.mockRestore();
    h.mockRestore();
  });
});
