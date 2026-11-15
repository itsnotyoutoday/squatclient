import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GfxRuntime } from '../src/gfx/runtime';
import { MockEngine } from '../src/api/mock';
import { CmcpController } from '../src/cmcp/controller';
import { SKINS } from '../src/cmcp/skins';
import type { CmcpUI } from '../src/cmcp/types';
import type { GfxOp } from '../src/api/types';

const fx = (n: string): CmcpUI => JSON.parse(readFileSync(`public/cmcp/${n}.json`, 'utf8')) as CmcpUI;
const hit = (a: number[], b: number[]): boolean => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

function run(theme: string, notice: CmcpUI['notice'], reduce = false) {
  const engine = new MockEngine();
  const rt = new GfxRuntime();
  rt.paused = true;
  const ops: GfxOp[] = [];
  const apply = rt.apply.bind(rt);
  rt.apply = (o: GfxOp[]): void => { ops.push(...o); apply(o); };
  const ctl = new CmcpController(engine, () => rt);
  ctl.reduceMotion = reduce;
  ctl.attach();
  const ui = { ...fx('sensors'), session: 's1', notice, status: { alert: 'green', hull: { cur: 80, max: 100 }, core_pct: 60, name: 'SS Test' } } as CmcpUI;
  ui.tree!.session = 's1';
  ui.tree!.theme = theme;
  engine.pushCmcp(ui);
  return { ops, engine, ctl };
}
const props = (ops: GfxOp[], id: string): Record<string, unknown> | undefined => ops.filter((o) => o.op === 'create' && o.id === id).at(-1)?.props as Record<string, unknown> | undefined;

describe('the notice line', () => {
  it('draws one line from the model, absent without a notice', () => {
    expect(props(run('tng', undefined).ops, 'notice.tx')).toBeUndefined();
    const r = run('tng', { id: 'pack:theme:romulan', kind: 'download', state: 'active', text: 'Downloading Romulan theme pack 37%' });
    expect(props(r.ops, 'notice.tx')?.text).toBe('Downloading Romulan theme pack 37%');
  });
  it('is red-roled for failures', () => {
    const r = run('tng', { id: 'x', kind: 'download', state: 'failed', text: 'Could not download X: using built-in' });
    expect(props(r.ops, 'notice.bg')?.stroke).toBe(SKINS.tng.pal.normal.r);
  });
  it('fades in over 150 ms for a new notice, at once with reduced motion', () => {
    const tw = (ops: GfxOp[]): GfxOp[] => ops.filter((o) => o.op === 'tween' && o.target === 'notice.bg');
    const n = { id: 'n1', kind: 'info', state: 'done', text: 'hello' };
    expect(tw(run('tng', n).ops)[0]).toMatchObject({ dur: 0.15 });
    expect(tw(run('tng', n, true).ops)).toHaveLength(0);
  });
  it('an update of the same notice does not fade again', () => {
    const r = run('tng', { id: 'n1', kind: 'download', state: 'active', text: 'Downloading A pack 10%' });
    r.ops.length = 0;
    r.engine.pushCmcp({ ...fx('sensors'), session: 's1', rev: 99, notice: { id: 'n1', kind: 'download', state: 'done', text: 'Downloaded A pack' }, status: { alert: 'green' } } as CmcpUI);
    expect(r.ops.filter((o) => o.op === 'tween' && o.target === 'notice.bg')).toHaveLength(0);
  });
  it.each(Object.keys(SKINS))('in %s it never covers the text port, the nav column or the buttons', (name) => {
    const r = run(name, { id: 'n', kind: 'download', state: 'done', text: 'Downloaded Romulan theme pack' });
    const bg = props(r.ops, 'notice.bg') as { x: number; y: number; w: number; h: number };
    const bar = [bg.x, bg.y, bg.w, bg.h];
    const sk = SKINS[name];
    for (const rect of [sk.port.rect, sk.port.expanded, sk.side.port, sk.side.content, sk.content]) expect(hit(bar, rect), `${name} ${rect}`).toBe(false);
    const b = sk.nav.button;
    sk.nav.items.forEach((_, i) => expect(hit(bar, [b.x + i * (b.dx ?? 0), b.y + i * (b.dy ?? 0), b.w, b.h])).toBe(false));
    for (const x of [sk.log.button, sk.off.button]) expect(hit(bar, [x.x, x.y, x.w, x.h])).toBe(false);
  });
});

describe('the notice pill never covers a title text of the frame', () => {
  it.each(Object.keys(SKINS))('in %s the widest pill is placed clear of every text of the frame', async (name) => {
    const { frameShapes, measureText, noticeX } = await import('../src/cmcp/skinframe');
    const { NOTICE_H, NOTICE_MAX } = await import('../src/cmcp/controller');
    const sk = SKINS[name];
    const vars = { ship: 'ACS PATHFINDER', class: 'NEBULA CLASS', game: 'CMCP TESTGAME', mode: 'COMMAND', title: 'COMMAND', hull: '100', core: '96', lock: 'KHV Tolghan', alert: 'YELLOW', screen: 'command' };
    const texts = frameShapes(sk.frame, sk.pal.normal, vars, 'fr.', sk.font.family).filter((p) => p.type === 'text').map((p) => p.props as { x: number; y: number; text: string; size: number; align?: string; weight?: string });
    const x = noticeX(texts, NOTICE_MAX, NOTICE_H, sk.font.family);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + NOTICE_MAX).toBeLessThanOrEqual(1600);
    for (const t of texts) {
      if (!t.text) continue;
      const w = measureText(t.text, t.size, sk.font.family, t.weight ?? '700');
      const x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
      expect(hit([x, 2, NOTICE_MAX, NOTICE_H], [x0, t.y - t.size * 0.4, w, t.size * 0.8]), `${name}: pill at ${x} covers "${t.text}" at ${t.x},${t.y}`).toBe(false);
    }
  });
});
