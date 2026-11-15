import { describe, expect, it } from 'vitest';
import { MockEngine } from '../src/api/mock';
import { PaneRenderer, usePaneHost } from '../src/cmcp/panes';
import type { CmcpNode, CmcpTree, CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/gfx/types';

// CMCP 2 panes (spec 20.14): a context presented on a dock/panel/float is drawn in addition to the main screen as its own scene, with no text port,
// and a click on one of its buttons goes to the engine as an event of THAT pane.
const node = (path: string, widget: string, props: Record<string, unknown> = {}, extra: Partial<CmcpNode> = {}): CmcpNode => ({ path, widget, props, layout: {}, enabled: true, ...extra });
const root = (): CmcpNode => ({ ...node('0', 'label', { text: '' }), layout: { dir: 'col', gap: 6 }, children: [
  node('0.0', 'label', { text: 'Dock status' }),
  { ...node('0.1', 'button', { text: 'MAP' }), events: ['click'] },
] });
const tree = (): CmcpTree => ({ session: 's1', generation: 1, screen: 'fspace-concourse/briefing', title: 'Dock status', theme: 'tng', themeSource: 'builtin', layout: 'stacked', portCapPx: 0, alertMode: 'full',
  view: { state: 'default', portDefault: 'balanced', fraction: 0.5, calm: false }, tokens: { 'color.bg': '#001122' }, packKey: 'k', root: root(), ui: {} } as unknown as CmcpTree);
const ui = (panes: CmcpUI['panes']): CmcpUI => ({ session: 's1', rev: 1, panes } as unknown as CmcpUI);
const pane = { surface: 'dock', key: 'panel:briefing', ctx: 2, type: 'world.briefing', scope: 'world', title: 'Dock status', layout: 'fspace-concourse/briefing', dock: 'right', resizable: true, size: { w: 320, h: 420 }, tree: tree() };

describe('CMCP 2 panes', () => {
  const run = () => {
    const engine = new MockEngine();
    const ops: GfxOp[] = [];
    const r = new PaneRenderer(engine, (_s, o) => ops.push(...o));
    return { engine, ops, r };
  };

  it('draws a dock context as its own scene, tells the window about it, and takes it away when it leaves the stack', () => {
    const { ops, r } = run();
    r.sync(ui([pane] as CmcpUI['panes']));
    expect(ops.find((o) => o.op === 'scene' && o.scene === 'cmcp.pane.panel:briefing')).toMatchObject({ open: true, w: 320, h: 420 });
    expect(ops.some((o) => o.op === 'create' && o.scene === 'cmcp.pane.panel:briefing')).toBe(true);
    expect(usePaneHost.getState().by.s1).toEqual([expect.objectContaining({ key: 'panel:briefing', surface: 'dock', title: 'Dock status', dock: 'right', resizable: true, ready: true })]);
    r.sync(ui([]));
    expect(ops.some((o) => o.op === 'scene' && o.scene === 'cmcp.pane.panel:briefing' && o.open === false)).toBe(true);
    expect(usePaneHost.getState().by.s1).toEqual([]);
  });

  it('a click on a pane button sends an event of that pane, not of the main screen', async () => {
    const { engine, ops, r } = run();
    r.sync(ui([pane] as CmcpUI['panes']));
    const btn = ops.find((o) => o.op === 'on' && o.scene === 'cmcp.pane.panel:briefing');
    expect(btn).toBeTruthy();
    expect(r.handle('s1', { scene: 'cmcp.pane.panel:briefing', id: (btn as unknown as { id: string }).id, event: 'click', x: 0, y: 0 })).toBe(true);
    await Promise.resolve();
    const call = engine.cmcpCalls.at(-1);
    expect(call).toMatchObject({ fn: 'cmcpPaneEvent', session: 's1' });
    expect(call?.args.slice(0, 3)).toEqual(['panel:briefing', '0.1', 'click']);
    expect(r.handle('s1', { scene: 'cmcp', id: 'x', event: 'click', x: 0, y: 0 })).toBe(false); // the main scene is not a pane's
  });

  it('shows the title only while the layout is still coming', () => {
    const { ops, r } = run();
    r.sync(ui([{ ...pane, tree: null }] as unknown as CmcpUI['panes']));
    expect(ops).toHaveLength(0);
    expect(usePaneHost.getState().by.s1[0]).toMatchObject({ ready: false, title: 'Dock status' });
  });
});
