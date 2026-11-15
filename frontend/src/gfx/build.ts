/**
 * Turns a scene into a flat, ordered draw list (and the hit-test list). No GL here: the renderer consumes the items.
 * World matrices are in scene (logical) coordinates.
 */
import { parseColor, type RGBA } from './color';
import { flattenPath, invert, mul, trs, triangulate, pointInPolygon, distToSegment, apply, type Mat } from './geom';
import type { GfxNode, Scene } from './scene';
import { Emitter, particleStyle, type ParticleStyle } from './particles';
import type { PixelCanvas } from './canvas';

export type Blend = 'normal' | 'add' | 'screen' | 'multiply';
export interface Paint { kind: 0 | 1 | 2; c: [RGBA, RGBA, RGBA]; o: [number, number, number]; g: [number, number, number, number] }
export interface ShadowSpec { dx: number; dy: number; blur: number; alpha: number; color: RGBA }

interface Common { m: Mat; opacity: number; glow: number; blend: Blend }
export interface ShapeItem extends Common {
  k: 'shape'; type: number; cx: number; cy: number; hw: number; hh: number; P: [number, number, number, number]; R: [number, number, number, number];
  fill: Paint; stroke: RGBA; sw: number; shadow?: ShadowSpec;
}
export interface MeshItem extends Common { k: 'mesh'; key: string; verts: Float32Array; idx: Uint32Array; fill: Paint; owner: GfxNode }
export interface CustomItem extends Common { k: 'custom'; shader: string; w: number; h: number; pad: number; u: Record<string, number | number[]> }
export interface StarsItem extends Common { k: 'stars'; node: GfxNode; w: number; h: number; time: number; speed: number; fov: number; streak: number; look: [number, number]; size: number; count: number; seed: number }
export interface CanvasItem extends Common { k: 'pcanvas'; node: GfxNode; pc: PixelCanvas; w: number; h: number }
export interface ParticlesItem extends Common { k: 'particles'; em: Emitter; style: ParticleStyle; local: boolean }
export interface TextItem extends Common {
  k: 'text'; text: string; font: string; size: number; weight: string; italic: boolean; align: string; baseline: string; letterSpacing: number;
  maxWidth: number; color: RGBA; cellW: number; owner: GfxNode; shadow?: ShadowSpec;
}
export interface ImageItem extends Common { k: 'image'; src: string; w: number; h: number; tint: RGBA }
export interface LayerBegin extends Common { k: 'lbegin'; blur: number; shadow?: ShadowSpec; clip?: number[] }
export interface LayerEnd { k: 'lend' }
export interface ClipBegin { k: 'cbegin'; rect: [number, number, number, number] }
export interface ClipEnd { k: 'cend' }
export type Item = ShapeItem | MeshItem | CustomItem | StarsItem | CanvasItem | ParticlesItem | TextItem | ImageItem | LayerBegin | LayerEnd | ClipBegin | ClipEnd;

export interface BuildEnv {
  defaultFont: string;
  getVar(name: string): number | string | undefined;
  canvases: Map<string, PixelCanvas>;
  /** an object the host defined (/gfx shader): used to size custom shader nodes; unknown names draw nothing */
  hasShader(name: string): boolean;
}

const TRANSPARENT: RGBA = [0, 0, 0, 0];
const solid = (c: RGBA): Paint => ({ kind: 0, c: [c, c, c], o: [0, 1, 1], g: [0, 0, 0, 0] });

/** A fill value (color string or gradient object) in the bounding box [x0,y0,x1,y1] of the object. */
export function paintOf(v: unknown, box: [number, number, number, number]): Paint {
  if (v === undefined || v === null || v === 'none') return solid(TRANSPARENT);
  if (typeof v === 'object' && !Array.isArray(v)) {
    const g = v as { type?: string; stops?: [number, string][]; angle?: number; x1?: number; y1?: number; x2?: number; y2?: number; cx?: number; cy?: number; r?: number };
    const stops = (g.stops ?? []).slice(0, 3);
    if (stops.length >= 2) {
      const cols = stops.map((s) => parseColor(s[1]));
      const offs = stops.map((s) => s[0]);
      while (cols.length < 3) { cols.push(cols[cols.length - 1]); offs.push(1); }
      const [x0, y0, x1, y1] = box;
      const w = x1 - x0, h = y1 - y0;
      let geom: [number, number, number, number];
      let kind: 1 | 2 = 1;
      if (g.type === 'radial') {
        kind = 2;
        geom = [x0 + (g.cx ?? 0.5) * w, y0 + (g.cy ?? 0.5) * h, (g.r ?? 0.5) * Math.max(w, h), 0];
      } else if (g.x1 !== undefined) {
        geom = [x0 + g.x1 * w, y0 + (g.y1 ?? 0) * h, x0 + (g.x2 ?? 1) * w, y0 + (g.y2 ?? 0) * h];
      } else {
        const a = ((g.angle ?? 90) * Math.PI) / 180; // CSS-like: 0 = up, 90 = left to right
        const dx = Math.sin(a), dy = -Math.cos(a);
        const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
        const cx = x0 + w / 2, cy = y0 + h / 2;
        geom = [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half];
      }
      return { kind, c: [cols[0], cols[1], cols[2]], o: [offs[0], offs[1], offs[2]], g: geom };
    }
  }
  return solid(parseColor(v));
}

function shadowOf(n: GfxNode): ShadowSpec | undefined {
  const s = n.props.shadow as { dx?: number; dy?: number; blur?: number; alpha?: number; color?: string } | undefined;
  if (!s || typeof s !== 'object') return undefined;
  const blur = Number(s.blur ?? 6);
  const col = parseColor(s.color ?? '#000000');
  return { dx: Number(s.dx ?? 0), dy: Number(s.dy ?? 3), blur, alpha: Number(s.alpha ?? col[3] ?? 0.5), color: col };
}

function radiiOf(n: GfxNode, w: number, h: number): [number, number, number, number] {
  const lim = Math.min(w, h) / 2;
  if (n.bool('pill')) return [lim, lim, lim, lim];
  const r = n.props.r ?? n.props.radius;
  if (typeof r === 'number') return [Math.min(r, lim), Math.min(r, lim), Math.min(r, lim), Math.min(r, lim)];
  if (typeof r === 'string' && !Number.isNaN(Number(r))) { const v = Math.min(Number(r), lim); return [v, v, v, v]; }
  if (Array.isArray(r)) {
    const a = r.map((x) => Math.max(0, Math.min(Number(x) || 0, lim)));
    if (a.length === 1) return [a[0], a[0], a[0], a[0]];
    if (a.length === 2) return [a[0], a[1], a[0], a[1]];
    if (a.length >= 4) return [a[0], a[1], a[2], a[3]];
  }
  return [0, 0, 0, 0];
}

function sizeOf(n: GfxNode): [number, number] {
  switch (n.type) {
    case 'circle': { const r = n.num('r', 10); return [r * 2, r * 2]; }
    case 'planet': case 'radar': { const r = n.num('r', 50); return [r * 2, r * 2]; }
    default: return [n.num('w', 0), n.num('h', 0)];
  }
}

const centered = new Set(['circle', 'ellipse', 'arc', 'planet', 'radar', 'emitter']);

function localMatrix(n: GfxNode): Mat {
  const [w, h] = sizeOf(n);
  const ax = n.num('anchorX', 0), ay = n.num('anchorY', 0);
  let px = n.num('pivotX', 0) + (centered.has(n.type) ? 0 : ax * w), py = n.num('pivotY', 0) + (centered.has(n.type) ? 0 : ay * h);
  if (n.str('anchor') === 'center' && !centered.has(n.type)) { px += w / 2; py += h / 2; }
  const sx = n.num('scaleX', n.num('scale', 1)), sy = n.num('scaleY', n.num('scale', 1));
  const m = trs(n.num('x', 0), n.num('y', 0), n.num('rotation', 0), sx, sy, px, py);
  const kx = n.num('skewX', 0), ky = n.num('skewY', 0);
  if (kx === 0 && ky === 0) return m;
  // skew about the pivot (glass panels tilted into a curve): applied in local space, before the transform
  const tx = Math.tan((kx * Math.PI) / 180), ty = Math.tan((ky * Math.PI) / 180);
  return mul(m, mul([1, 0, 0, 1, px, py], mul([1, ty, tx, 1, 0, 0], [1, 0, 0, 1, -px, -py])));
}

function blendOf(n: GfxNode, inherit: Blend): Blend {
  const b = n.str('blend');
  return b === 'add' || b === 'screen' || b === 'multiply' || b === 'normal' ? b : inherit;
}

const stripe = (n: number): number => (n > 0 ? n : 0);

interface Ctx { opacity: number; blend: Blend }

export interface BuildResult { items: Item[]; hit: GfxNode[]; glowing: boolean }

export function buildScene(scene: Scene, env: BuildEnv): BuildResult {
  const items: Item[] = [];
  const hit: GfxNode[] = [];
  let glowing = false;
  const t = scene.time;

  const visit = (n: GfxNode, parent: Mat, ctx: Ctx): void => {
    const m = mul(parent, localMatrix(n));
    n.world = m;
    n.inv = invert(m);
    const opacity = ctx.opacity * Math.max(0, Math.min(1, n.num('opacity', 1)));
    n.worldOpacity = opacity;
    if (opacity <= 0.001 && n.type !== 'group' && n.type !== 'layer') {
      if (n.interactive) hit.push(n);
      return;
    }
    const blend = blendOf(n, ctx.blend);
    const glow = n.num('glow', 0);
    if (glow > 0) glowing = true;
    const base = { m, opacity, glow, blend } as Common;
    if (n.interactive) hit.push(n);
    const sh = shadowOf(n);

    switch (n.type) {
      case 'group': case 'layer': {
        const clip = n.props.clip as number[] | undefined;
        const blur = n.num('blur', 0);
        const isolate = n.type === 'layer' && (blur > 0 || !!sh || n.bool('isolate') || blend !== 'normal' || glow > 0);
        let child: Ctx = { opacity, blend };
        if (isolate) {
          items.push({ k: 'lbegin', m, opacity, glow, blend, blur, shadow: sh, clip: Array.isArray(clip) ? clip : undefined });
          child = { opacity: 1, blend: 'normal' };
        } else if (Array.isArray(clip) && clip.length === 4) {
          const [x, y, w, h] = clip;
          const pts = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)];
          items.push({ k: 'cbegin', rect: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });
        }
        children(n, m, child);
        if (isolate) items.push({ k: 'lend' });
        else if (Array.isArray(clip) && clip.length === 4) items.push({ k: 'cend' });
        return;
      }
      case 'rect': case 'button': {
        const w = n.num('w', 0), h = n.num('h', 0);
        if (w > 0 && h > 0) {
          const sw = stripe(n.num('strokeWidth', 0));
          const pad = 2 + sw / 2 + (sh ? sh.blur * 2 + Math.hypot(sh.dx, sh.dy) : 0);
          items.push({
            ...base, k: 'shape', type: 0, cx: w / 2, cy: h / 2, hw: w / 2 + pad, hh: h / 2 + pad, P: [w, h, 0, 0], R: radiiOf(n, w, h),
            fill: paintOf(n.props.fill ?? (n.type === 'button' ? '#ff9900' : undefined), [0, 0, w, h]),
            stroke: n.props.stroke ? parseColor(n.props.stroke) : TRANSPARENT, sw, shadow: sh,
          });
        }
        if (n.type === 'button' && n.props.text !== undefined) {
          const size = n.num('size', Math.max(10, h * 0.5));
          const al = n.str('align', 'center');
          const tx = al === 'left' ? n.num('padX', h * 0.5) : al === 'right' ? w - n.num('padX', h * 0.5) : w / 2;
          items.push({
            ...base, glow: n.num('textGlow', 0), blend: 'normal', k: 'text', m: mul(m, [1, 0, 0, 1, tx, h / 2]), text: n.str('text'), font: n.str('font', env.defaultFont), size,
            weight: n.str('weight', '700'), italic: false, align: al, baseline: 'middle', letterSpacing: n.num('letterSpacing', 0), maxWidth: Math.max(0, w - 12),
            color: parseColor(n.props.color ?? '#000000'), cellW: 0, owner: n,
          });
        }
        return;
      }
      case 'circle': case 'ellipse': case 'arc': {
        let type = 1, P: [number, number, number, number], ext: number;
        if (n.type === 'circle') { const r = n.num('r', 10); P = [r, 0, 0, 0]; ext = r; }
        else if (n.type === 'ellipse') { type = 2; const rx = n.num('rx', 10), ry = n.num('ry', rx); P = [rx, ry, 0, 0]; ext = Math.max(rx, ry); }
        else { type = 3; const r0 = n.num('r0', 0), r1 = n.num('r1', n.num('r', 20)); P = [Math.min(r0, r1), Math.max(r0, r1), n.num('a0', 0), n.num('a1', 360)]; ext = Math.max(r0, r1); }
        const sw = stripe(n.num('strokeWidth', 0));
        const pad = 2 + sw / 2 + (sh ? sh.blur * 2 + Math.hypot(sh.dx, sh.dy) : 0);
        items.push({
          ...base, k: 'shape', type, cx: 0, cy: 0, hw: ext + pad, hh: (n.type === 'ellipse' ? P[1] : ext) + pad, P, R: [0, 0, 0, 0],
          fill: paintOf(n.props.fill, [-ext, -ext, ext, ext]), stroke: n.props.stroke ? parseColor(n.props.stroke) : TRANSPARENT, sw, shadow: sh,
        });
        return;
      }
      case 'elbow': {
        const w = n.num('w', 100), h = n.num('h', 100);
        const corner = n.str('corner', 'tl');
        const fx = corner.includes('r') ? -1 : 1, fy = corner.includes('b') ? -1 : 1;
        const mm = fx === 1 && fy === 1 ? m : mul(m, [fx, 0, 0, fy, fx < 0 ? w : 0, fy < 0 ? h : 0]);
        const pad = 2 + (sh ? sh.blur * 2 + Math.hypot(sh.dx, sh.dy) : 0);
        items.push({
          ...base, m: mm, k: 'shape', type: 6, cx: w / 2, cy: h / 2, hw: w / 2 + pad, hh: h / 2 + pad,
          P: [w, h, n.num('ro', Math.min(w, h) / 2), n.num('ri', Math.min(w, h) / 6)], R: [n.num('bar', h / 3), n.num('side', w / 3), 0, 0],
          fill: paintOf(n.props.fill, [0, 0, w, h]), stroke: TRANSPARENT, sw: 0, shadow: sh,
        });
        return;
      }
      case 'line': {
        const x1 = n.num('x1', 0), y1 = n.num('y1', 0), x2 = n.num('x2', 0), y2 = n.num('y2', 0);
        const lw = n.num('strokeWidth', 2);
        segment(items, base, x1, y1, x2, y2, lw, parseColor(n.props.stroke ?? n.props.fill ?? '#ffffff'), n.str('cap', 'round') === 'butt' ? 1 : 0, sh);
        return;
      }
      case 'polyline': case 'polygon': case 'path': {
        const polys = n.type === 'path' ? flattenPath(n.str('d')) : [{ pts: (n.props.points as number[]) ?? [], closed: n.type === 'polygon' || n.bool('closed') }];
        const lw = n.num('strokeWidth', n.type === 'polyline' ? 2 : 0);
        const strokeCol = parseColor(n.props.stroke ?? (n.type === 'polyline' ? (n.props.fill ?? '#ffffff') : TRANSPARENT));
        const fillV = n.type === 'polyline' ? undefined : n.props.fill;
        polys.forEach((pl, pi) => {
          const p = pl.pts.map(Number);
          if (p.length < 4) return;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
          if (fillV !== undefined && fillV !== 'none' && p.length >= 6 && (pl.closed || n.type === 'polygon' || n.type === 'path')) {
            const key = `${n.type}:${pi}:${p.length}:${p[0]}:${p[1]}:${p[p.length - 1]}:${hash(p)}`;
            let c = n.sim.mesh as { key: string; verts: Float32Array; idx: Uint32Array }[] | undefined;
            if (!c) n.sim.mesh = c = [];
            if (!c[pi] || c[pi].key !== key) c[pi] = { key, verts: new Float32Array(p), idx: Uint32Array.from(triangulate(p)) };
            items.push({ ...base, k: 'mesh', key, verts: c[pi].verts, idx: c[pi].idx, fill: paintOf(fillV, [x0, y0, x1, y1]), owner: n });
          }
          if (lw > 0 && strokeCol[3] > 0) {
            const nseg = p.length / 2 - 1;
            for (let i = 0; i < nseg; i++) segment(items, base, p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], lw, strokeCol, 0, undefined);
            if (pl.closed) segment(items, base, p[p.length - 2], p[p.length - 1], p[0], p[1], lw, strokeCol, 0, undefined);
          }
        });
        return;
      }
      case 'text': {
        items.push({
          ...base, k: 'text', text: n.str('text'), font: n.str('font', env.defaultFont), size: n.num('size', 16), weight: n.str('weight', '400'),
          italic: n.str('style') === 'italic', align: n.str('align', 'left'), baseline: n.str('baseline', 'top'), letterSpacing: n.num('letterSpacing', 0),
          maxWidth: n.num('maxWidth', 0), color: parseColor(n.props.fill ?? n.props.color ?? '#ffffff'), cellW: 0, owner: n, shadow: sh,
        });
        return;
      }
      case 'image': {
        const w = n.num('w', 0), h = n.num('h', 0);
        items.push({ ...base, k: 'image', src: n.str('src'), w, h, tint: parseColor(n.props.tint ?? '#ffffff') });
        return;
      }
      case 'planet': {
        const r = n.num('r', 60);
        const k = 1.4, size = 2 * r * k;
        const pm = mul(m, [1, 0, 0, 1, -size / 2, -size / 2]);
        const rgb = (v: unknown, d: string): number[] => parseColor(v ?? d).slice(0, 3);
        items.push({
          ...base, m: pm, k: 'custom', shader: 'planet', w: size, h: size, pad: 0,
          glow: n.num('glow', 0.5),
          u: {
            uR: 1 / (2 * k), uSeed: n.num('seed', 1), uSpin: n.num('spin', 0) * Math.PI / 180 + (n.bool('rotate', true) ? t * n.num('spinSpeed', 0.05) : 0), uLight: n.num('light', 150),
            uOcean: rgb(n.props.ocean, '#1c4f9c'), uLand: rgb(n.props.land, '#4f8a3c'), uIce: rgb(n.props.ice, '#eef6ff'), uCloud: rgb(n.props.cloud, '#ffffff'),
            uAtmo: rgb(n.props.atmosphere, '#6fb4ff'), uAtmoPow: n.num('atmo', 1), uClouds: n.num('clouds', 0.45), uNight: rgb(n.props.night, '#ffcf70'), uSea: n.num('sea', 0.52),
          },
        });
        return;
      }
      case 'radar': {
        const r = n.num('r', 100);
        const pm = mul(m, [1, 0, 0, 1, -r, -r]);
        const contacts = parseContacts(n.props.contacts);
        const flat: number[] = [];
        contacts.slice(0, 16).forEach((c) => flat.push(c.a, c.r, c.t, c.seed));
        while (flat.length < 64) flat.push(0);
        items.push({
          ...base, m: pm, k: 'custom', shader: 'radar', w: 2 * r, h: 2 * r, pad: 0, glow: n.num('glow', 0.6),
          u: {
            uSweep: ((n.num('sweep', 0) * Math.PI) / 180) % (2 * Math.PI), uTrail: (n.num('trail', 100) * Math.PI) / 180, uRings: n.num('rings', 4),
            uCol: parseColor(n.props.color ?? '#33ff88').slice(0, 3), uBg: parseColor(n.props.bg ?? '#02100a'), uN: Math.min(contacts.length, 16), uC: flat,
          },
        });
        return;
      }
      case 'shader': {
        const w = n.num('w', 100), h = n.num('h', 100);
        const name = n.str('shader');
        if (!env.hasShader(name)) return;
        const u: Record<string, number | number[]> = {};
        const raw = (n.props.u ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'number') u[k] = v;
          else if (Array.isArray(v)) u[k] = v.map(Number);
          else if (typeof v === 'string') {
            const nv = Number(v);
            u[k] = !Number.isNaN(nv) && v.trim() !== '' ? nv : parseColor(v).slice(0, 4);
          }
        }
        items.push({ ...base, k: 'custom', shader: name, w, h, pad: 0, u });
        return;
      }
      case 'starfield': {
        const w = n.num('w', 400), h = n.num('h', 300);
        const speedProp = n.num('speed', 0.02);
        const phase = (n.sim.phase as number | undefined) ?? 0;
        const last = (n.sim.lastT as number | undefined) ?? t;
        n.sim.phase = phase + (t - last) * 1; // time integrates so speed changes never jump the field
        n.sim.lastT = t;
        const look = n.props.look as number[] | undefined;
        items.push({
          ...base, k: 'stars', node: n, w, h, time: n.sim.phase as number, speed: speedProp, fov: n.num('fov', 1), streak: n.num('streak', 0),
          look: [look?.[0] ?? n.num('lookX', 0), look?.[1] ?? n.num('lookY', 0)], size: n.num('size', 2.2), count: Math.min(4000, n.num('count', 300)), seed: n.num('seed', 1),
        });
        return;
      }
      case 'emitter': {
        let em = n.sim.em as Emitter | undefined;
        if (!em) n.sim.em = em = new Emitter(Math.min(4000, n.num('max', 1500)));
        const last = (n.sim.lastT as number | undefined) ?? t;
        const local = n.str('space', 'world') === 'local';
        em.update(t - last, n, local ? [1, 0, 0, 1, 0, 0] : m);
        n.sim.lastT = t;
        const keep = n.sim.burstId as string | undefined;
        void keep;
        items.push({ ...base, k: 'particles', em, style: particleStyle(n), local, m: local ? m : [1, 0, 0, 1, 0, 0], blend: blendOf(n, 'add') });
        return;
      }
      case 'graph': {
        graph(items, base, n, env, t);
        return;
      }
      case 'pixelcanvas': {
        const pc = env.canvases.get(n.id);
        if (!pc) return;
        const sc = n.num('scale', 1);
        const mm = mul(m, [sc, 0, 0, sc, 0, 0]);
        items.push({ ...base, m: mm, k: 'pcanvas', node: n, pc, w: pc.w, h: pc.h });
        const cellH = 2, cellW = 1;
        for (const tx of pc.texts) {
          items.push({
            ...base, m: mul(mm, [1, 0, 0, 1, tx.cx * cellW, tx.cy * cellH]), opacity: opacity * tx.alpha, k: 'text', text: tx.text, font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
            size: cellH * 0.86, weight: tx.bold ? '700' : '400', italic: false, align: 'left', baseline: 'top', letterSpacing: 0, maxWidth: 0, color: parseColor(tx.color), cellW, owner: n,
          });
        }
        n.sim.w = pc.w * sc; n.sim.h = pc.h * sc;
        return;
      }
      default:
        return;
    }
  };

  const children = (n: GfxNode, m: Mat, ctx: Ctx): void => {
    const kids = n.children.some((c) => c.props.z !== undefined) ? [...n.children].sort((a, b) => a.num('z') - b.num('z')) : n.children;
    for (const c of kids) {
      if (c.props.visible === false || c.props.visible === 0 || c.props.visible === 'false') continue;
      visit(c, m, ctx);
    }
  };

  children(scene.root, IDENT_M, { opacity: 1, blend: 'normal' });
  return { items, hit, glowing };
}

const IDENT_M: Mat = [1, 0, 0, 1, 0, 0];

function hash(a: number[]): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 8) | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function segment(items: Item[], base: Common, x1: number, y1: number, x2: number, y2: number, lw: number, col: RGBA, cap: number, sh?: ShadowSpec): void {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const pad = 2 + (sh ? sh.blur * 2 + Math.hypot(sh.dx, sh.dy) : 0);
  items.push({
    ...base, k: 'shape', type: 4, cx, cy, hw: Math.abs(x2 - x1) / 2 + lw / 2 + pad, hh: Math.abs(y2 - y1) / 2 + lw / 2 + pad,
    P: [x1 - cx, y1 - cy, x2 - cx, y2 - cy], R: [lw / 2, cap, 0, 0], fill: solid(col), stroke: TRANSPARENT, sw: 0, shadow: sh,
  });
}

export interface Contact { a: number; r: number; t: number; seed: number }

/** contacts: an array of {a|bearing, r|range, t|type, id} or the gtf string "id:bearing:range:type;..." (range 0..100). */
export function parseContacts(v: unknown): Contact[] {
  const out: Contact[] = [];
  const typeCode = (t: unknown): number => {
    const s = String(t ?? 'U').toUpperCase();
    return s === 'F' || s === '1' ? 1 : s === 'H' || s === '2' ? 2 : s === 'N' || s === '3' ? 3 : 0;
  };
  if (typeof v === 'string') {
    for (const part of v.split(';')) {
      const f = part.split(':');
      if (f.length < 3) continue;
      const bearing = Number(f[1]), range = Number(f[2]);
      if (Number.isNaN(bearing) || Number.isNaN(range)) continue;
      out.push({ a: (bearing * Math.PI) / 180, r: Math.min(1, Math.max(0, range / 100)) * 0.92, t: typeCode(f[3]), seed: (Number(f[0]) * 0.37) % 1 });
    }
  } else if (Array.isArray(v)) {
    v.forEach((c, i) => {
      const o = c as Record<string, unknown>;
      const bearing = Number(o.a ?? o.bearing ?? 0), range = Number(o.r ?? o.range ?? 0);
      out.push({ a: (bearing * Math.PI) / 180, r: Math.min(1, Math.max(0, range / 100)) * 0.92, t: typeCode(o.t ?? o.type), seed: ((i + 1) * 0.37) % 1 });
    });
  }
  return out;
}

function graph(items: Item[], base: Common, n: GfxNode, env: BuildEnv, t: number): void {
  const w = n.num('w', 200), h = n.num('h', 60);
  let vals = n.props.values as number[] | undefined;
  const src = n.str('source');
  if (src) {
    const hist = ((n.sim.hist as number[] | undefined) ?? (n.sim.hist = [])) as number[];
    const iv = n.num('interval', 0.25);
    const lastT = (n.sim.histT as number | undefined) ?? -1e9;
    if (t - lastT >= iv) {
      n.sim.histT = t;
      const raw = env.getVar(src);
      const v = Number(raw);
      hist.push(Number.isNaN(v) ? 0 : v);
      const cap = Math.max(2, n.num('samples', 60));
      while (hist.length > cap) hist.shift();
    }
    vals = hist;
  }
  if (!vals || vals.length < 2) return;
  const lo = n.props.min !== undefined ? n.num('min') : Math.min(...vals), hi0 = n.props.max !== undefined ? n.num('max') : Math.max(...vals);
  const hi = hi0 === lo ? lo + 1 : hi0;
  const pts: number[] = [];
  vals.forEach((v, i) => pts.push((i / (vals!.length - 1)) * w, h - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * h));
  const col = parseColor(n.props.stroke ?? '#66aaff');
  if (n.props.fill) {
    const poly = [...pts, w, h, 0, h];
    const key = `graph:${n.id}:${t}`; // rebuilt every frame: values move
    items.push({ ...base, k: 'mesh', key, verts: new Float32Array(poly), idx: Uint32Array.from(triangulate(poly)), fill: paintOf(n.props.fill, [0, 0, w, h]), owner: n });
  }
  const lw = n.num('strokeWidth', 2);
  for (let i = 0; i < vals.length - 1; i++) segment(items, base, pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], lw, col, 0);
}

// ---------------------------------------------------------------- hit testing
function textBox(n: GfxNode): [number, number, number, number] {
  const size = n.num('size', 16);
  const w = (n.sim.tw as number | undefined) ?? n.str('text').length * size * 0.45;
  const al = n.str('align', 'left');
  const x0 = al === 'center' ? -w / 2 : al === 'right' ? -w : 0;
  return [x0, 0, x0 + w, size * 1.2];
}

/** Does the local point hit the object? */
export function hitLocal(n: GfxNode, x: number, y: number): boolean {
  switch (n.type) {
    case 'rect': case 'button': case 'image': case 'shader': case 'starfield': case 'graph': case 'elbow': {
      const w = n.num('w', 0), h = n.num('h', 0);
      if (!(x >= 0 && y >= 0 && x <= w && y <= h)) return false;
      if (n.type === 'rect' || n.type === 'button') {
        const r = radiiOf(n, w, h);
        const left = x < w / 2, top = y < h / 2;
        const rr = left ? (top ? r[0] : r[3]) : top ? r[1] : r[2];
        if (rr <= 0) return true;
        const cx = left ? rr : w - rr, cy = top ? rr : h - rr;
        const inCorner = (left ? x < rr : x > w - rr) && (top ? y < rr : y > h - rr);
        return !inCorner || Math.hypot(x - cx, y - cy) <= rr;
      }
      if (n.type === 'elbow') {
        const bar = n.num('bar', h / 3), side = n.num('side', w / 3);
        const corner = n.str('corner', 'tl');
        const fx = corner.includes('r') ? w - x : x, fy = corner.includes('b') ? h - y : y;
        return fx <= side || fy <= bar;
      }
      return true;
    }
    case 'circle': case 'planet': case 'radar': return Math.hypot(x, y) <= n.num('r', 10);
    case 'ellipse': { const rx = n.num('rx', 10), ry = n.num('ry', rx); return (x / rx) ** 2 + (y / ry) ** 2 <= 1; }
    case 'arc': {
      const d = Math.hypot(x, y), r0 = n.num('r0', 0), r1 = n.num('r1', 20);
      if (d < Math.min(r0, r1) || d > Math.max(r0, r1)) return false;
      const a0 = n.num('a0', 0), a1 = n.num('a1', 360);
      if (Math.abs(a1 - a0) >= 360) return true;
      let ang = (Math.atan2(x, -y) * 180) / Math.PI;
      ang = (((ang - a0) % 360) + 360) % 360;
      return ang <= (((a1 - a0) % 360) + 360) % 360;
    }
    case 'line': {
      return distToSegment(x, y, n.num('x1'), n.num('y1'), n.num('x2'), n.num('y2')) <= Math.max(n.num('strokeWidth', 2) / 2, 4);
    }
    case 'polygon': return pointInPolygon((n.props.points as number[]) ?? [], x, y);
    case 'text': { const b = textBox(n); return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }
    case 'pixelcanvas': return x >= 0 && y >= 0 && x <= n.num('w') && y <= n.num('h');
    case 'group': case 'layer': return false;
    default: {
      const w = n.num('w', 0), h = n.num('h', 0);
      return w > 0 && h > 0 && x >= 0 && y >= 0 && x <= w && y <= h;
    }
  }
}

/** The topmost interactive object at a scene position. */
export function pick(hit: GfxNode[], x: number, y: number): GfxNode | null {
  for (let i = hit.length - 1; i >= 0; i--) {
    const n = hit[i];
    if (!n.inv) continue;
    const [lx, ly] = apply(n.inv, x, y);
    if (hitLocal(n, lx, ly)) return n;
  }
  return null;
}
