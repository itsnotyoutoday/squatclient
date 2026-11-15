import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { skinFromTheme } from '../src/cmcp/skins/pack';
import { SKINS } from '../src/cmcp/skins';
import type { CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

const dir = '../../cmcp/examples/themes/';
const have = existsSync(dir + 'klingon.gpu.json');
const doc = (f: string): Record<string, unknown> => JSON.parse(readFileSync(dir + f, 'utf8')) as Record<string, unknown>;
const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;

describe.skipIf(!have)('skins from theme packs', () => {
  it('maps the pack format: nav screen, stacked block, slots, text maps, alert_edge, motion, recolour', () => {
    const { skin, notes } = skinFromTheme(doc('klingon.gpu.json'), SKINS.klingon);
    const d = doc('klingon.gpu.json') as { frame: unknown[]; nav: { items: { screen: string }[] } };
    expect(skin.source).toBe('pack');
    expect(skin.frame.length).toBe(d.frame.length);
    expect(skin.nav.items.map((i) => i.screens[0])).toEqual(d.nav.items.map((i) => i.screen.replace('std.', '')));
    expect(skin.port.rect).toEqual([240, 509, 1340, 315]); // the stacked block's port is the stacked default
    expect(skin.side.port).toEqual([240, 100, 768, 724]); // the top level is the side layout
    expect(skin.side.content).toEqual([1018, 100, 562, 724]);
    expect(skin.sideArrange?.sensors?.['radar#0']).toBeTruthy();
    expect(skin.sideSlots?.['plot#0']).toBeTruthy();
    expect(skin.slots?.['plot#0']).toBeTruthy();
    expect(skin.maxCols).toBe(80);
    expect(skin.alertEdge?.width).toBe(8);
    expect(skin.motion?.alertMs).toBe(800);
    expect(notes.every((n) => typeof n === 'string')).toBe(true);
    const fer = skinFromTheme(doc('ferengi.gpu.json'), SKINS.ferengi).skin;
    expect(fer.alertRecolour).toBe('edge');
    expect(fer.frame.some((s) => s.t === 'text' && typeof s.text === 'object')).toBe(true); // by/map text
  });

  const run = (source: 'pack' | 'builtin', edit?: (d: Record<string, unknown>) => void) => {
    const engine = new MockEngine();
    const d = doc('klingon-1.0.1.gpu.json');
    edit?.(d);
    engine.cmcpThemeDocs.klingon = d;
    const rt = new GfxRuntime();
    rt.paused = true;
    const ops: GfxOp[] = [];
    const apply = rt.apply.bind(rt);
    rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
    const ctl = new CmcpController(engine, () => rt);
    ctl.attach();
    const ui = { ...fx('sensors'), session: 's1', status: { alert: 'green', hull: { cur: 80, max: 100 }, core_pct: 60, name: 'SS Test' } } as CmcpUI;
    ui.tree!.session = 's1';
    ui.tree!.theme = 'klingon';
    ui.tree!.themeSource = source;
    ui.tree!.themeVersion = '1.0.1';
    engine.pushCmcp(ui);
    return { ops, ctl, engine };
  };
  /** the final props of a primitive: its create, then every set and tween target applied in order */
  const created = (ops: GfxOp[], id: string): Record<string, unknown> | undefined => {
    let cur: Record<string, unknown> | undefined;
    for (const o of ops) {
      if (o.op === 'create' && o.id === id) cur = { ...(o.props as Record<string, unknown>) };
      else if (o.op === 'delete' && o.id === id) cur = undefined;
      else if (o.op === 'set' && o.id === id && cur) Object.assign(cur, o.props);
      else if (o.op === 'tween' && o.target === id && cur) for (const [k, v] of Object.entries(o.tracks as Record<string, { to: unknown }>)) cur[k] = v.to;
    }
    return cur;
  };

  it('a downloaded theme with a changed colour or frame renders differently from the built-in skin', async () => {
    const built = run('builtin');
    const same = run('pack');
    await new Promise((r) => setTimeout(r, 20));
    // the same theme data as the built-in (a 1.0.1 of the same look) draws, and asks the engine for the document once
    expect(same.engine.cmcpCalls.filter((c) => c.fn === 'cmcpThemeDoc')).toHaveLength(1);
    const changed = run('pack', (d) => {
      ((d.pal as { normal: Record<string, string> }).normal).x = '#00ff88'; // the port frame role
      (d.frame as Record<string, unknown>[])[0] = { type: 'rect', id: 'topplate', x: 20, y: 14, w: 1560, h: 40, fill: '#00ff88' };
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(created(changed.ops, 'portframe')?.stroke).toBe('#00ff88');
    expect(created(built.ops, 'portframe')?.stroke).not.toBe('#00ff88');
    const frameOf = (ops: GfxOp[]): string => JSON.stringify(created(ops, 'fr.topplate'));
    expect(frameOf(changed.ops)).not.toBe(frameOf(built.ops));
    expect(created(changed.ops, 'fr.topplate')?.fill).toBe('#00ff88');
  });

  it('falls back to the built-in table when the pack cannot be read', async () => {
    const r = run('pack');
    r.engine.cmcpThemeDocs = {};
    await new Promise((x) => setTimeout(x, 20));
    expect(created(r.ops, 'portframe')).toBeTruthy();
  });
});
