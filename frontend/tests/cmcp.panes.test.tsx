import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TreeView } from '../src/cmcp/TreeView';
import { drawsAsPage, exitsOf } from '../src/cmcp/dom';
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

  it('a ship console keeps the scene; a place and a ship room are drawn as a page', () => {
    const ui = (type: string, scope: string): CmcpUI =>
      ({
        v2: true,
        ctx: { type, scope, key: 'k', layout: 'l', surface: 'screen', ambient: false },
      }) as unknown as CmcpUI;
    expect(drawsAsPage(ui('world.place', 'world'))).toBe(true);
    expect(drawsAsPage(ui('ship.shiproom', 'ship'))).toBe(true);
    expect(drawsAsPage(ui('ship.console', 'ship'))).toBe(false);
    expect(drawsAsPage({ v2: false } as CmcpUI)).toBe(false);
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
