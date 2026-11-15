import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { useScreenHelp } from '../src/cmcp/pane';
import type { CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;

/** the engine's screen model for a science console: sensors, tactical (own/viewable) in the menu; medical and power locked (listed only by "more...") */
const ALL = [
  { id: 'std.sensors', title: 'Sensors', available: true, active: true, state: 'own' },
  { id: 'std.tactical', title: 'Tactical', available: true, active: false, state: 'viewable' },
  { id: 'std.power', title: 'Power', available: false, active: false, state: 'locked', hint: 'man engineering to use' },
  { id: 'std.medical', title: 'Medical', available: false, active: false, state: 'locked', hint: 'man medical to use' },
];

function setup() {
  const engine = new MockEngine();
  const rt = new GfxRuntime();
  rt.paused = true;
  const ops: GfxOp[] = [];
  const apply = rt.apply.bind(rt);
  rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
  const ctl = new CmcpController(engine, () => rt);
  const hints: string[] = [];
  ctl.onHint = (t) => hints.push(t);
  ctl.attach();
  const ui = { ...fx('sensors'), session: 's1', screens: ALL.filter((o) => o.available), allScreens: ALL, status: { alert: 'green' } } as CmcpUI;
  ui.tree!.session = 's1';
  ui.tree!.theme = 'tng';
  engine.pushCmcp(ui);
  const texts = (): string[] => ops.filter((o) => o.op === 'create' && String(o.id).startsWith('menu.') && (o.props as { text?: string })?.text).map((o) => String((o.props as { text: string }).text));
  return { engine, ctl, ops, hints, texts };
}

describe('the screen menu with keyboard focus', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } useScreenHelp.getState().close(); });

  it('Alt+M opens the menu on the current screen, with a one-time hint; Esc leaves it', () => {
    const { ctl, hints } = setup();
    expect(ctl.menuOpen('s1')).toBe(false);
    expect(ctl.toggleMenu('s1')).toBe(true);
    expect(ctl.menuOpen('s1')).toBe(true);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/Up\/Down/);
    expect(ctl.menuKey('s1', 'Escape')).toBe(true);
    expect(ctl.menuOpen('s1')).toBe(false);
    ctl.toggleMenu('s1');
    expect(hints).toHaveLength(1); // the hint is shown once
  });

  it('Up and Down move over the AVAILABLE screens and the "more..." row only, wrapping; keys it does not own are not handled', () => {
    const { ctl, ops } = setup();
    ctl.toggleMenu('s1');
    // sensors (current) -> tactical -> more... -> sensors
    expect(ctl.menuKey('s1', 'ArrowDown')).toBe(true);
    expect(ctl.menuKey('s1', 'ArrowDown')).toBe(true);
    expect(ctl.menuKey('s1', 'ArrowDown')).toBe(true);
    expect(ctl.menuKey('s1', 'ArrowUp')).toBe(true);
    expect(ctl.menuKey('s1', 'a')).toBe(false);
    const all = JSON.stringify(ops);
    expect(all).not.toMatch(/POWER|MEDICAL|LOCKED/);
  });

  it('Enter opens the highlighted screen through the engine and closes the menu', () => {
    const { ctl, engine } = setup();
    ctl.toggleMenu('s1');
    ctl.menuKey('s1', 'ArrowDown'); // tactical
    ctl.menuKey('s1', 'Enter');
    expect(ctl.menuOpen('s1')).toBe(false);
    expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpShowScreen', args: ['std.tactical'] });
  });

  it('Enter on "More screens..." opens the popover listing every screen with the console that provides it', () => {
    const { ctl, engine } = setup();
    ctl.toggleMenu('s1');
    ctl.menuKey('s1', 'End'); // the "more..." row
    ctl.menuKey('s1', 'Enter');
    expect(ctl.menuOpen('s1')).toBe(false);
    expect(engine.cmcpCalls.some((c) => c.fn === 'cmcpShowScreen')).toBe(false);
    const rows = useScreenHelp.getState().rows;
    expect(rows?.map((r) => r.id)).toEqual(ALL.map((o) => o.id));
    expect(rows?.find((r) => r.id === 'std.power')?.console).toBe('engineering');
    expect(rows?.find((r) => r.id === 'std.medical')?.console).toBe('medical');
    expect(rows?.find((r) => r.id === 'std.sensors')?.available).toBe(true);
  });

  it('Home and End jump to the first and last row', () => {
    const { ctl, engine } = setup();
    ctl.toggleMenu('s1');
    ctl.menuKey('s1', 'ArrowDown');
    ctl.menuKey('s1', 'Home');
    ctl.menuKey('s1', 'Enter');
    expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpShowScreen', args: ['std.sensors'] });
  });
});
