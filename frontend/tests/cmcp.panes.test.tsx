import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TreeView } from '../src/cmcp/TreeView';
import { exitsOf, serverLevelOf } from '../src/cmcp/dom';
import type { CmcpNode, CmcpTree, CmcpUI } from '../src/cmcp/types';

// CMCP 2 contexts that are not ship consoles are drawn as page elements: text, a table of choices, plain buttons; never the scene.
afterEach(cleanup);
const node = (
  path: string,
  widget: string,
  props: Record<string, unknown> = {},
  extra: Partial<CmcpNode> = {},
): CmcpNode => ({ path, widget, props, layout: {}, enabled: true, ...extra });
const root = (): CmcpNode => ({
  ...node('0', 'label', {}, { layout: { dir: 'col', gap: 6 } }),
  children: [
    node('0.0', 'label', { text: 'Spacedock Concourse', style: 'title' }),
    node(
      '0.1',
      'table',
      {
        columns: [
          { key: 'name', title: 'SHIP' },
          { key: 'class', title: 'CLASS' },
        ],
        rows: [
          { name: 'KHV Drakhar', class: 'cruiser' },
          { name: 'ACS Resolute', class: 'cruiser' },
        ],
        selectable: true,
        selected: '1',
      },
      { events: ['select'] },
    ),
    node('0.2', 'button', { text: 'BOARD', tone: 'accent' }, { events: ['click'] }),
    node('0.3', 'button', { text: 'HOME', tone: 'warn' }, { events: ['click'], enabled: false }),
    node('0.4', 'textport', {}),
  ],
});
const tree = {
  session: 's1',
  generation: 1,
  screen: 'x',
  title: 'Spacedock Concourse',
  theme: 'tng',
  tokens: {},
  packKey: 'k',
  root: root(),
  ui: {},
} as unknown as CmcpTree;

describe('CMCP 2 page elements', () => {
  it('draws text, a selectable table with the chosen row marked, and plain buttons; no text port', () => {
    const send = vi.fn();
    render(<TreeView tree={tree} send={send} />);
    expect(screen.getByText('Spacedock Concourse')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'SHIP' })).toBeTruthy();
    expect(screen.getByText('ACS Resolute').closest('tr')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByText('KHV Drakhar'));
    expect(send).toHaveBeenCalledWith('0.1', 'select', '0');
    fireEvent.click(screen.getByRole('button', { name: 'BOARD' }));
    expect(send).toHaveBeenCalledWith('0.2', 'click');
    expect(screen.getByRole('button', { name: 'HOME' })).toHaveProperty('disabled', true); // a disabled node is not clickable
    expect(document.querySelector('[data-textport]')).toBeNull();
  });

  it('reads the level the game allows for the context, and treats an absent one as the full console', async () => {
    const { effectiveLevel } = await import('../src/cmcp/level');
    const ui = (level?: number): CmcpUI => ({ v2: true, ctx: { type: 'world.place', scope: 'world', key: 'k', layout: 'l', surface: 'screen', ambient: false, level } } as unknown as CmcpUI);
    expect(serverLevelOf(ui(2))).toBe(2);
    expect(serverLevelOf(ui())).toBe(3); // absent: the game allows everything
    expect(serverLevelOf(ui(9))).toBe(3); // out of range: ignored
    // what is drawn is the lower of the game's level and the player's cap, never higher than the game allows
    expect(effectiveLevel(3, 'scene')).toBe(3);
    expect(effectiveLevel(3, 'widgets')).toBe(2);
    expect(effectiveLevel(2, 'scene')).toBe(2);
    expect(effectiveLevel(1, 'scene')).toBe(1);
    expect(effectiveLevel(2, 'text')).toBe(1);
  });

  it('lists the exits a room puts in its data, as names or {name, cmd}', () => {
    const ui = {
      ctx: { data: { exits: ['Turbolift', { name: 'Ready Room', cmd: 'ready' }, 7, {}] } },
    } as unknown as CmcpUI;
    expect(exitsOf(ui)).toEqual([
      { name: 'Turbolift', cmd: 'Turbolift' },
      { name: 'Ready Room', cmd: 'ready' },
    ]);
    expect(exitsOf({ ctx: { data: {} } } as unknown as CmcpUI)).toEqual([]);
  });
});

describe('the CMCP level chip', () => {
  it('shows the protocol version and changes what the client draws with', async () => {
    const { StatusBar } = await import('../src/components/statusbar/StatusBar');
    const { useCmcpDom } = await import('../src/cmcp/dom');
    const { useCmcpLevel } = await import('../src/cmcp/level');
    const { useSessions, useUi } = await import('../src/state/stores');
    useUi.setState({ consoleOpen: false });
    useSessions.setState({ fg: 's1', sessions: { s1: { id: 's1', name: 'Test', state: 'connected', unread: 0 } } as never });
    useCmcpDom.getState().set('s1', { main: null, title: '', readonly: false, panes: [], exits: [], on: true, proto: 2, serverLevel: 3, level: 3 });
    render(<StatusBar />);
    const sel = screen.getByLabelText("How far this client may draw the game's screens") as HTMLSelectElement;
    expect(sel.value).toBe('scene'); // no cap by default: whatever the game allows
    expect([...sel.options].map((o) => o.textContent)).toEqual(['3 Full console', '2 Widgets', '1 Text only']);
    expect(screen.getByTitle(/The game allows up to/).textContent).toContain('CMCP 2');
    fireEvent.change(sel, { target: { value: 'widgets' } });
    expect(useCmcpLevel.getState().by.s1).toBe('widgets');
    // a game that allows only widgets says so on the levels above it
    act(() => useCmcpDom.getState().set('s1', { main: null, title: '', readonly: false, panes: [], exits: [], on: true, proto: 2, serverLevel: 2, level: 2 }));
    expect([...(screen.getByLabelText("How far this client may draw the game's screens") as HTMLSelectElement).options].map((o) => o.textContent))
      .toEqual(['3 Full console (game allows less)', '2 Widgets', '1 Text only']);
  });
});

describe('a pane takes the game theme colours', () => {
  it('puts the screen tokens on the tree as CSS variables', () => {
    const t = { ...tree, tokens: { 'color.accent': '#ff9900', 'color.text': '#e8e0d0', 'font.title': 'Antonio' } } as unknown as CmcpTree;
    const { container } = render(<TreeView tree={t} send={() => undefined} />);
    const el = container.querySelector('.cmcp-tree') as HTMLElement;
    expect(el.style.getPropertyValue('--cmcp-accent')).toBe('#ff9900');
    expect(el.style.getPropertyValue('--cmcp-text')).toBe('#e8e0d0');
    // the heading font is the theme's; the body keeps the window's own game font, so aligned columns line up
    expect(el.style.getPropertyValue('--cmcp-font-title')).toContain('Antonio');
    expect(el.style.getPropertyValue('--cmcp-font')).toBe('');
  });
});

describe('where a page-drawn screen goes', () => {
  it('sits in the side column with the panes, never as a card over the game text', async () => {
    const { PaneHosts } = await import('../src/cmcp/PaneHost');
    const { useCmcpDom } = await import('../src/cmcp/dom');
    const { useSessions } = await import('../src/state/stores');
    useSessions.setState({ fg: 's1', sessions: { s1: { id: 's1', name: 'T', state: 'connected', unread: 0 } } as never });
    useCmcpDom.getState().set('s1', { main: tree, title: 'ACS Resolute Bridge', readonly: false, panes: [], exits: [], on: true, proto: 2, serverLevel: 3, level: 3 });
    const { container } = render(<PaneHosts><p>the game text</p></PaneHosts>);
    const aside = container.querySelector('aside.cmcp-dock');
    expect(aside).toBeTruthy();
    expect(aside?.querySelector('.cmcp-pane')).toBeTruthy(); // the screen is a pane of the column
    expect(container.querySelector('.with-panes-main')?.textContent).toBe('the game text'); // nothing of it sits over the text
  });
});

describe('a pane keeps its own level', () => {
  it('is shown when the main context is text only, and hidden when the player caps below its own level', async () => {
    const { CmcpController } = await import('../src/cmcp/controller');
    const { useCmcpDom } = await import('../src/cmcp/dom');
    const { useCmcpLevel } = await import('../src/cmcp/level');
    const { MockEngine } = await import('../src/api/mock');
    const { GfxRuntime } = await import('../src/gfx/runtime');
    const rt = new GfxRuntime();
    rt.paused = true;
    const ctl = new CmcpController(new MockEngine(), () => rt);
    const model = (cap?: 'widgets' | 'text') => {
      if (cap) useCmcpLevel.getState().set('s9', cap);
      ctl.onUi({ session: 's9', rev: Math.random(), state: 'ready', proto: 2, v2: true, tree: null,
        ctx: { type: 'world.place', scope: 'world', key: 'k', layout: 'l', surface: 'screen', ambient: false, level: 1 },
        panes: [{ surface: 'dock', key: 'panel:briefing', ctx: 2, type: 'world.briefing', scope: 'world', layout: 'l', level: 2, tree }],
      } as unknown as CmcpUI);
      return useCmcpDom.getState().by.s9;
    };
    expect(model().level).toBe(1); // the concourse itself: text only
    expect(model().panes.map((p) => p.key)).toEqual(['panel:briefing']); // the guide dock is still there
    expect(model('text').panes).toEqual([]); // the player capped everything at text: the pane goes too
  });
});

describe('the hit shake with no console screen up', () => {
  it('nudges the game output, and stops when the shake does', async () => {
    const { CmcpController } = await import('../src/cmcp/controller');
    const { useShake } = await import('../src/cmcp/pane');
    const { MockEngine } = await import('../src/api/mock');
    const { GfxRuntime } = await import('../src/gfx/runtime');
    const engine = new MockEngine();
    const rt = new GfxRuntime();
    rt.paused = true;
    const ctl = new CmcpController(engine, () => rt);
    const off = ctl.attach();
    engine.pushCmcpPulse({ session: 's5', active: false, level: 1, phase: 'on', shake: { active: true, x: 4.8, y: -2 } });
    expect(useShake.getState().by.s5).toEqual({ x: 4.8, y: -2 });
    engine.pushCmcpPulse({ session: 's5', active: false, level: 1, phase: 'on', shake: { active: false, x: 0, y: 0 } });
    expect(useShake.getState().by.s5).toBeUndefined();
    off();
  });
});
