/**
 * WebGL2 renderer for a scene: SDF shapes in one instanced pass (crisp anti-aliased vector shapes), meshes for
 * polygon fills, atlas text, custom fragment shaders, a GPU starfield, CPU particles drawn as soft dots, offscreen
 * layers (blur, drop shadow, group opacity), and a bloom post pass fed by an emissive second attachment.
 */
import type { Blend, BuildResult, CanvasItem, CustomItem, ImageItem, Item, LayerBegin, MeshItem, StarsItem, TextItem } from './build';
import { Atlas } from './atlas';
import { BUILTIN, type ShaderDef } from './builtin';
import { parseColor } from './color';
import { mul, type Mat } from './geom';
import type { GfxNode, Scene } from './scene';
import {
  BLUR_FS, COMPOSITE_FS, CUSTOM_MAIN, CUSTOM_PRELUDE, CUSTOM_VS, DATA_PER_ROW, DATA_TEXELS, DOWN_FS, FS_VS, MESH_FS, MESH_VS, SHAPE_FS, SHAPE_VS,
  STAR_FS, STAR_VS, TEX_FS, TEX_VS, UP_FS,
} from './shaders';

const LAYER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity, uGlow, uMode;
uniform vec2 uOffset;
uniform vec4 uTint;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec4 c;
  if (uMode > 0.5) { float a = texture(uTex, vUv - uOffset).a * uTint.a; c = vec4(uTint.rgb * a, a); }
  else c = texture(uTex, vUv);
  c *= uOpacity;
  o0 = c;
  o1 = vec4(c.rgb * uGlow, c.a * min(uGlow, 1.0));
}`;

const FLOATS = DATA_TEXELS * 4;
const MAX_INSTANCES = DATA_PER_ROW * 128;

type Cmd =
  | { t: 'batch'; first: number; count: number; blend: Blend }
  | { t: 'mesh'; it: MeshItem }
  | { t: 'custom'; it: CustomItem }
  | { t: 'stars'; it: StarsItem }
  | { t: 'tex'; it: CanvasItem }
  | { t: 'lbegin'; it: LayerBegin }
  | { t: 'lend'; it: LayerBegin }
  | { t: 'scissor'; rect: [number, number, number, number] | null };

export interface FrameStats { instances: number; draws: number; layers: number; atlasResets: number }

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }

export class GfxRenderer {
  readonly gl: WebGL2RenderingContext;
  private progs = new Map<string, Prog>();
  private custom = new Map<string, { def: ShaderDef; failed?: boolean }>();
  private vaoEmpty: WebGLVertexArrayObject;
  private dataTex: WebGLTexture;
  private inst = new Float32Array(FLOATS * 1024);
  private n = 0;
  private cmds: Cmd[] = [];
  private atlas = new Atlas(2048);
  private atlasTex: WebGLTexture;
  private atlasGen = -1;
  private w = 0; private h = 0;
  private samples = 0;
  private fboMS: WebGLFramebuffer | null = null;
  private rbo: WebGLRenderbuffer[] = [];
  private fboRes: WebGLFramebuffer | null = null;
  private texColor: WebGLTexture | null = null;
  private texEmis: WebGLTexture | null = null;
  private bloomTex: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }[] = [];
  private layerPool: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private layerDepth = 0;
  private tmpBlur: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
  private meshVbo: WebGLBuffer; private meshIbo: WebGLBuffer; private meshVao: WebGLVertexArrayObject;
  private starCache = new Map<GfxNode, { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; key: string; n: number }>();
  private pcTex = new Map<GfxNode, { tex: WebGLTexture; version: number; w: number; h: number }>();
  /** device pixels per logical unit and offset, set per frame */
  private view = { s: 1, sx: 1, sy: 1, ox: 0, oy: 0, dw: 1, dh: 1 };
  private proj = new Float32Array(9);
  private stats: FrameStats = { instances: 0, draws: 0, layers: 0, atlasResets: 0 };
  private maxLayers = 0;
  lost = false;
  /** images (name or url -> element) for image objects */
  images = new Map<string, CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; complete?: boolean; width?: number; height?: number }>();
  onShaderError?: (name: string, log: string) => void;

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor(readonly canvas: HTMLCanvasElement, opts: { alpha?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: opts.alpha ?? false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    this.vaoEmpty = gl.createVertexArray()!;
    this.dataTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, DATA_PER_ROW * DATA_TEXELS, 128, 0, gl.RGBA, gl.FLOAT, null);
    this.nearest(gl.TEXTURE_2D);
    this.atlasTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.linear(gl.TEXTURE_2D);
    this.meshVbo = gl.createBuffer()!; this.meshIbo = gl.createBuffer()!; this.meshVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo);
    gl.bindVertexArray(null);
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  // ------------------------------------------------------------------ helpers
  private nearest(t: number): void { const gl = this.gl; gl.texParameteri(t, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(t, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(t, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(t, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  private linear(t: number): void { const gl = this.gl; gl.texParameteri(t, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(t, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(t, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(t, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }

  private compile(type: number, src: string, name: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? '';
      gl.deleteShader(s);
      throw new Error(`shader ${name}: ${log}`);
    }
    return s;
  }

  private program(key: string, vs: string, fs: string, attribs: string[] = []): Prog {
    const hit = this.progs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs, key + ' (vertex)'));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs, key + ' (fragment)'));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program ${key}: ${gl.getProgramInfoLog(p)}`);
    const pr: Prog = { p, u: new Map() };
    this.progs.set(key, pr);
    return pr;
  }

  private u(pr: Prog, name: string): WebGLUniformLocation | null {
    let l = pr.u.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(pr.p, name); pr.u.set(name, l); }
    return l;
  }

  private use(pr: Prog): void { this.gl.useProgram(pr.p); }

  /** Registers a user shader: `vec4 shade(vec2 uv, vec2 px)` plus uniform declarations name -> type. */
  defineShader(name: string, def: ShaderDef): void {
    this.custom.set(name, { def });
    const old = this.progs.get('custom:' + name);
    if (old) { this.gl.deleteProgram(old.p); this.progs.delete('custom:' + name); }
  }

  hasShader(name: string): boolean { return this.custom.has(name) || name in BUILTIN; }

  private customProgram(name: string): Prog | null {
    const key = 'custom:' + name;
    const hit = this.progs.get(key);
    if (hit) return hit;
    const reg = this.custom.get(name);
    const def = reg?.def ?? BUILTIN[name];
    if (!def || reg?.failed) return null;
    const decl = Object.entries(def.uniforms).map(([k, t]) => {
      const m = /^(\w+)\[(\d+)\]$/.exec(t);
      if (m) return `uniform ${m[1] === 'color' ? 'vec4' : m[1]} ${k}[${m[2]}];`;
      return `uniform ${t === 'color' ? 'vec4' : t} ${k};`;
    }).join('\n');
    try {
      return this.program(key, CUSTOM_VS, `${CUSTOM_PRELUDE}\n${decl}\n${def.glsl}\n${CUSTOM_MAIN}`);
    } catch (e) {
      if (reg) reg.failed = true; else this.custom.set(name, { def, failed: true });
      this.onShaderError?.(name, (e as Error).message);
      return null;
    }
  }

  // ------------------------------------------------------------------ sizing and targets
  private tex2d(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.linear(gl.TEXTURE_2D);
    return t;
  }

  private fbo(tex: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl;
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    tex.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    return f;
  }

  private freeTargets(): void {
    const gl = this.gl;
    for (const f of [this.fboMS, this.fboRes]) if (f) gl.deleteFramebuffer(f);
    this.rbo.forEach((r) => gl.deleteRenderbuffer(r));
    for (const t of [this.texColor, this.texEmis]) if (t) gl.deleteTexture(t);
    this.bloomTex.forEach((b) => { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); });
    this.layerPool.forEach((b) => { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); });
    this.tmpBlur.forEach((b) => { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); });
    this.fboMS = this.fboRes = null; this.rbo = []; this.texColor = this.texEmis = null; this.bloomTex = []; this.layerPool = []; this.tmpBlur = [];
  }

  /** Sets the drawing buffer size in device pixels and (re)creates the render targets. */
  resize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    this.w = w; this.h = h;
    this.freeTargets();
    this.texColor = this.tex2d(w, h);
    this.texEmis = this.tex2d(w, h);
    this.fboRes = this.fbo([this.texColor, this.texEmis]);
    if (this.samples > 0) {
      this.rbo = [0, 1].map(() => {
        const r = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, r);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
        return r;
      });
      this.fboMS = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMS);
      this.rbo.forEach((r, i) => gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, r));
    } else this.fboMS = this.fboRes;
    // bloom pyramid
    let bw = w, bh = h;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      const tex = this.tex2d(bw, bh);
      this.bloomTex.push({ tex, fbo: this.fbo([tex]), w: bw, h: bh });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private layerTarget(i: number): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
    while (this.layerPool.length <= i) {
      const tex = this.tex2d(this.w, this.h);
      this.layerPool.push({ tex, fbo: this.fbo([tex]) });
    }
    return this.layerPool[i];
  }

  // ------------------------------------------------------------------ packing
  private ensure(count: number): void {
    if ((count + 1) * FLOATS > this.inst.length) {
      const bigger = new Float32Array(Math.min(MAX_INSTANCES, count * 2 + 256) * FLOATS);
      bigger.set(this.inst);
      this.inst = bigger;
    }
  }

  private begin(blend: Blend): number {
    const last = this.cmds[this.cmds.length - 1];
    if (last && last.t === 'batch' && last.blend === blend) { return this.n; }
    this.cmds.push({ t: 'batch', first: this.n, count: 0, blend });
    return this.n;
  }

  private commit(): void {
    const last = this.cmds[this.cmds.length - 1] as Extract<Cmd, { t: 'batch' }>;
    last.count++;
  }

  private shapeInst(it: {
    m: Mat; type: number; cx: number; cy: number; hw: number; hh: number; P: number[]; R: number[]; opacity: number; glow: number; blend: Blend;
    c0: number[]; c1?: number[]; c2?: number[]; fk?: number[]; g?: number[]; stroke?: number[]; sw?: number; shadow?: { dx: number; dy: number; blur: number; alpha: number; color: number[] };
  }): void {
    if (this.n >= MAX_INSTANCES - 1) return;
    this.ensure(this.n + 1);
    this.begin(it.blend);
    const a = this.inst, o = this.n * FLOATS;
    a[o] = it.m[0]; a[o + 1] = it.m[1]; a[o + 2] = it.m[2]; a[o + 3] = it.m[3];
    a[o + 4] = it.m[4]; a[o + 5] = it.m[5]; a[o + 6] = it.cx; a[o + 7] = it.cy;
    a[o + 8] = it.hw; a[o + 9] = it.hh; a[o + 10] = it.type; a[o + 11] = it.opacity;
    for (let i = 0; i < 4; i++) { a[o + 12 + i] = it.P[i]; a[o + 16 + i] = it.R[i]; }
    const c1 = it.c1 ?? it.c0, c2 = it.c2 ?? c1;
    for (let i = 0; i < 4; i++) { a[o + 20 + i] = it.c0[i]; a[o + 24 + i] = c1[i]; a[o + 28 + i] = c2[i]; }
    const fk = it.fk ?? [0, 0, 1, 1];
    for (let i = 0; i < 4; i++) a[o + 32 + i] = fk[i];
    const g = it.g ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) a[o + 36 + i] = g[i];
    const st = it.stroke ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) a[o + 40 + i] = st[i];
    a[o + 44] = it.sw ?? 0; a[o + 45] = it.glow; a[o + 46] = 0; a[o + 47] = it.shadow ? it.shadow.blur : 0;
    if (it.shadow) {
      a[o + 48] = it.shadow.dx; a[o + 49] = it.shadow.dy; a[o + 50] = it.shadow.alpha; a[o + 51] = 0;
      for (let i = 0; i < 4; i++) a[o + 52 + i] = it.shadow.color[i];
    } else for (let i = 48; i < 56; i++) a[o + i] = 0;
    this.n++;
    this.commit();
  }

  private pxScale(m: Mat): number { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * this.view.s; }

  private textInst(it: TextItem): void {
    const r = this.pxScale(it.m);
    const px = Math.max(4, Math.round(it.size * r));
    const rs = px / it.size; // device px per local unit
    const e = this.atlas.text({ text: it.text, font: it.font, weight: it.weight, italic: it.italic, px, letterSpacing: it.letterSpacing * rs, maxWidth: it.maxWidth * rs, cellW: it.cellW * rs });
    if (!e) return;
    const wl = e.w / rs, hl = e.h / rs;
    const adv = e.advance / rs;
    it.owner.sim.tw = adv;
    const x0 = (it.align === 'center' ? -adv / 2 : it.align === 'right' ? -adv : 0) - 2 / rs; // the raster box has 2px of padding
    const base = e.baseline / rs; // baseline offset from the top of the raster box
    const capL = e.cap / rs;
    const by = it.baseline === 'top' ? capL : it.baseline === 'middle' ? capL / 2 : 0; // where the baseline sits relative to y
    const y0 = by - base;
    const col = it.color;
    this.shapeInst({
      m: it.m, type: 7, cx: x0 + wl / 2, cy: y0 + hl / 2, hw: wl / 2, hh: hl / 2, P: [e.u0, e.v0, e.u1, e.v1], R: [0, 0, wl, hl], opacity: it.opacity, glow: it.glow, blend: it.blend,
      c0: [col[0], col[1], col[2], col[3]], shadow: it.shadow ? { ...it.shadow, color: it.shadow.color } : undefined,
    });
  }

  private imageInst(it: ImageItem): void {
    const img = this.images.get(it.src);
    if (!img) return;
    const nw = (img as { naturalWidth?: number }).naturalWidth ?? (img as { width?: number }).width ?? 0;
    const nh = (img as { naturalHeight?: number }).naturalHeight ?? (img as { height?: number }).height ?? 0;
    if (!nw || !nh || (img as { complete?: boolean }).complete === false) return;
    const w = it.w || nw, h = it.h || nh;
    const px = Math.min(512, Math.max(8, Math.round(Math.max(w, h) * this.pxScale(it.m))));
    const k = px / Math.max(nw, nh);
    const e = this.atlas.image(`img:${it.src}:${px}`, img, Math.max(1, Math.round(nw * k)), Math.max(1, Math.round(nh * k)));
    if (!e) return;
    this.shapeInst({
      m: it.m, type: 7, cx: w / 2, cy: h / 2, hw: w / 2, hh: h / 2, P: [e.u0, e.v0, e.u1, e.v1], R: [1, 0, w, h], opacity: it.opacity, glow: it.glow, blend: it.blend,
      c0: [it.tint[0], it.tint[1], it.tint[2], it.tint[3]],
    });
  }

  // ------------------------------------------------------------------ frame
  /** Draws a scene. `time` is in seconds. */
  render(scene: Scene, built: BuildResult, time: number, logical?: { w: number; h: number }, calm = 0): FrameStats {
    const gl = this.gl;
    const cfg = scene.cfg;
    if (this.lost || this.w === 0) return this.stats;
    this.stats = { instances: 0, draws: 0, layers: 0, atlasResets: 0 };
    this.n = 0; this.cmds = []; this.layerDepth = 0; this.maxLayers = 0;
    // view mapping
    const lw = logical?.w ?? (cfg.w > 0 ? cfg.w : this.w), lh = logical?.h ?? (cfg.h > 0 ? cfg.h : this.h);
    const sx0 = this.w / lw, sy0 = this.h / lh;
    let sx = sx0, sy = sy0, ox = 0, oy = 0;
    if (cfg.fit === 'contain') { sx = sy = Math.min(sx0, sy0); ox = (this.w - lw * sx) / 2; oy = (this.h - lh * sy) / 2; }
    else if (cfg.fit === 'cover') { sx = sy = Math.max(sx0, sy0); ox = (this.w - lw * sx) / 2; oy = (this.h - lh * sy) / 2; }
    else if (cfg.fit === 'none') { sx = sy = this.w / (logical?.w ?? this.w); }
    this.view = { s: Math.sqrt(sx * sy), sx, sy, ox, oy, dw: this.w, dh: this.h };
    this.proj.set([2 * sx / this.w, 0, 0, 0, -2 * sy / this.h, 0, 2 * ox / this.w - 1, 1 - 2 * oy / this.h, 1]);
    if (this.atlas.full) { this.atlas.clear(); this.stats.atlasResets++; }

    // pack the item list into instance data and commands
    this.packItems(built.items);
    this.uploadData();
    this.uploadAtlas();

    // clear targets
    const bg = parseColor(cfg.bg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMS);
    gl.viewport(0, 0, this.w, this.h);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearBufferfv(gl.COLOR, 0, [bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    this.execute(time, this.fboMS!);

    // resolve
    if (this.samples > 0) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboMS);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboRes);
      gl.disable(gl.SCISSOR_TEST);
      for (let i = 0; i < 2; i++) {
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
        gl.drawBuffers(i === 0 ? [gl.COLOR_ATTACHMENT0, gl.NONE] : [gl.NONE, gl.COLOR_ATTACHMENT1]);
        gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
    }
    const bloom = built.glowing && cfg.bloom.strength > 0;
    if (bloom) this.bloomPass(cfg.bloom.radius);
    // composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    const pr = this.program('composite', FS_VS, COMPOSITE_FS);
    this.use(pr);
    gl.bindVertexArray(this.vaoEmpty);
    this.bindTex(0, this.texColor!); gl.uniform1i(this.u(pr, 'uColor'), 0);
    this.bindTex(1, bloom ? this.bloomTex[0].tex : this.texColor!); gl.uniform1i(this.u(pr, 'uBloom'), 1);
    gl.uniform1f(this.u(pr, 'uStrength'), cfg.bloom.strength * (1 - 0.9 * calm));
    gl.uniform1f(this.u(pr, 'uCalm'), calm);
    gl.uniform1f(this.u(pr, 'uHasBloom'), bloom ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.draws++;
    this.stats.instances = this.n;
    return this.stats;
  }

  private bindTex(unit: number, t: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }

  private packItems(items: Item[]): void {
    const layers: LayerBegin[] = [];
    for (const it of items) {
      switch (it.k) {
        case 'shape': {
          const f = it.fill;
          this.shapeInst({
            m: it.m, type: it.type, cx: it.cx, cy: it.cy, hw: it.hw, hh: it.hh, P: it.P, R: it.R, opacity: it.opacity, glow: it.glow, blend: it.blend,
            c0: f.c[0], c1: f.c[1], c2: f.c[2], fk: [f.kind, f.o[0], f.o[1], f.o[2]], g: f.g, stroke: it.stroke, sw: it.sw, shadow: it.shadow,
          });
          break;
        }
        case 'text': this.textInst(it); break;
        case 'image': this.imageInst(it); break;
        case 'particles': {
          const e = it.em, st = it.style;
          for (let i = 0; i < e.count; i++) {
            const k = e.age[i] / e.life[i];
            const c = [st.c0[0] + (st.c1[0] - st.c0[0]) * k, st.c0[1] + (st.c1[1] - st.c0[1]) * k, st.c0[2] + (st.c1[2] - st.c0[2]) * k, st.c0[3] + (st.c1[3] - st.c0[3]) * k];
            const sz = st.s0 + (st.s1 - st.s0) * k;
            this.shapeInst({
              m: [it.m[0], it.m[1], it.m[2], it.m[3], it.m[4] + it.m[0] * e.x[i] + it.m[2] * e.y[i], it.m[5] + it.m[1] * e.x[i] + it.m[3] * e.y[i]], type: 5, cx: 0, cy: 0, hw: sz, hh: sz,
              P: [sz, st.falloff, 0, 0], R: [0, 0, 0, 0], opacity: it.opacity, glow: it.glow, blend: it.blend, c0: c,
            });
          }
          break;
        }
        case 'mesh': this.cmds.push({ t: 'mesh', it }); break;
        case 'custom': this.cmds.push({ t: 'custom', it }); break;
        case 'stars': this.cmds.push({ t: 'stars', it }); break;
        case 'pcanvas': this.cmds.push({ t: 'tex', it }); break;
        case 'lbegin': layers.push(it); this.cmds.push({ t: 'lbegin', it }); break;
        case 'lend': { const b = layers.pop(); if (b) this.cmds.push({ t: 'lend', it: b }); break; }
        case 'cbegin': {
          const v = this.view;
          const [x0, y0, x1, y1] = it.rect;
          const dx0 = Math.floor(x0 * v.sx + v.ox), dx1 = Math.ceil(x1 * v.sx + v.ox);
          const dy0 = Math.floor(this.h - (y1 * v.sy + v.oy)), dy1 = Math.ceil(this.h - (y0 * v.sy + v.oy));
          this.cmds.push({ t: 'scissor', rect: [dx0, dy0, Math.max(0, dx1 - dx0), Math.max(0, dy1 - dy0)] });
          break;
        }
        case 'cend': this.cmds.push({ t: 'scissor', rect: null }); break;
      }
    }
  }

  private uploadData(): void {
    if (this.n === 0) return;
    const gl = this.gl;
    const rows = Math.ceil(this.n / DATA_PER_ROW);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_PER_ROW * DATA_TEXELS, rows, gl.RGBA, gl.FLOAT, this.inst, 0);
  }

  private uploadAtlas(): void {
    const gl = this.gl;
    const a = this.atlas;
    if (a.dirtyY1 <= a.dirtyY0 && this.atlasGen === a.generation) return;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // the 2D canvas is small enough to upload whole; only dirty rows are copied when possible
    const y0 = Math.max(0, Math.floor(a.dirtyY0)), y1 = Math.min(a.size, Math.ceil(a.dirtyY1));
    if (this.atlasGen !== a.generation || y1 - y0 > a.size / 2) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas as TexImageSource);
    } else {
      // copy the dirty band through a temporary canvas region
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas as TexImageSource);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.atlasGen = a.generation;
    a.dirtyY0 = Infinity; a.dirtyY1 = 0;
  }

  private setBlend(b: Blend): void {
    const gl = this.gl;
    switch (b) {
      case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
      case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private model(m: Mat): Float32Array { return new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]); }

  private execute(time: number, rootFbo: WebGLFramebuffer): void {
    const gl = this.gl;
    const fboStack: WebGLFramebuffer[] = [rootFbo];
    const targetBuffers = (f: WebGLFramebuffer): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.drawBuffers(f === this.fboMS || f === this.fboRes ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0, gl.NONE]);
    };
    for (const c of this.cmds) {
      switch (c.t) {
        case 'batch': {
          if (c.count === 0) break;
          const pr = this.program('shape', SHAPE_VS, SHAPE_FS);
          this.use(pr);
          gl.bindVertexArray(this.vaoEmpty);
          gl.uniformMatrix3fv(this.u(pr, 'uProj'), false, this.proj);
          this.bindTex(0, this.dataTex); gl.uniform1i(this.u(pr, 'uData'), 0);
          this.bindTex(1, this.atlasTex); gl.uniform1i(this.u(pr, 'uAtlas'), 1);
          this.setBlend(c.blend);
          gl.uniform1i(this.u(pr, 'uBase'), c.first);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.count);
          this.stats.draws++;
          break;
        }
        case 'mesh': this.drawMesh(c.it); break;
        case 'custom': this.drawCustom(c.it, time); break;
        case 'stars': this.drawStars(c.it, time); break;
        case 'tex': this.drawCanvas(c.it); break;
        case 'scissor':
          if (c.rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(c.rect[0], c.rect[1], c.rect[2], c.rect[3]); } else gl.disable(gl.SCISSOR_TEST);
          break;
        case 'lbegin': {
          const tgt = this.layerTarget(this.layerDepth++);
          this.maxLayers = Math.max(this.maxLayers, this.layerDepth);
          fboStack.push(tgt.fbo);
          targetBuffers(tgt.fbo);
          gl.disable(gl.SCISSOR_TEST);
          gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
          break;
        }
        case 'lend': {
          const tgt = this.layerTarget(--this.layerDepth);
          fboStack.pop();
          const parent = fboStack[fboStack.length - 1];
          this.compositeLayer(tgt.tex, c.it, parent, targetBuffers);
          this.stats.layers++;
          break;
        }
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  private compositeLayer(tex: WebGLTexture, it: LayerBegin, parent: WebGLFramebuffer, targetBuffers: (f: WebGLFramebuffer) => void): void {
    const gl = this.gl;
    let src = tex;
    const sigma = it.blur * this.view.s;
    const needBlur = sigma > 0.2 || (it.shadow && it.shadow.blur > 0);
    let blurred = tex;
    if (needBlur) {
      blurred = this.blurTexture(tex, Math.max(sigma, it.shadow ? it.shadow.blur * this.view.s : 0));
      if (sigma > 0.2) src = this.blurTexture(tex, sigma);
    }
    targetBuffers(parent);
    gl.disable(gl.SCISSOR_TEST);
    this.setBlend(it.blend);
    const pr = this.program('layer', FS_VS, LAYER_FS);
    this.use(pr);
    gl.bindVertexArray(this.vaoEmpty);
    gl.uniform1i(this.u(pr, 'uTex'), 0);
    if (it.shadow) {
      this.bindTex(0, blurred);
      const v = this.view;
      gl.uniform1f(this.u(pr, 'uMode'), 1);
      gl.uniform2f(this.u(pr, 'uOffset'), (it.shadow.dx * v.sx) / this.w, -(it.shadow.dy * v.sy) / this.h);
      gl.uniform4f(this.u(pr, 'uTint'), it.shadow.color[0], it.shadow.color[1], it.shadow.color[2], it.shadow.alpha);
      gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
      gl.uniform1f(this.u(pr, 'uGlow'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.bindTex(0, src);
    gl.uniform1f(this.u(pr, 'uMode'), 0);
    gl.uniform2f(this.u(pr, 'uOffset'), 0, 0);
    gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
    gl.uniform1f(this.u(pr, 'uGlow'), it.glow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.draws += 2;
  }

  /** Separable gaussian blur of a full-size texture into scratch targets; returns the result texture. */
  private blurTexture(src: WebGLTexture, sigmaPx: number): WebGLTexture {
    const gl = this.gl;
    while (this.tmpBlur.length < 2) {
      const tex = this.tex2d(this.w, this.h);
      this.tmpBlur.push({ tex, fbo: this.fbo([tex]) });
    }
    const pr = this.program('blur', FS_VS, BLUR_FS);
    this.use(pr);
    gl.bindVertexArray(this.vaoEmpty);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.uniform1i(this.u(pr, 'uTex'), 0);
    gl.uniform1f(this.u(pr, 'uSigma'), Math.min(sigmaPx, 24));
    const k = Math.max(1, sigmaPx / 24); // very wide blurs step further instead of taking more taps
    for (let pass = 0; pass < 2; pass++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tmpBlur[pass].fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      this.bindTex(0, pass === 0 ? src : this.tmpBlur[0].tex);
      gl.uniform2f(this.u(pr, 'uDir'), pass === 0 ? k / this.w : 0, pass === 0 ? 0 : k / this.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.enable(gl.BLEND);
    return this.tmpBlur[1].tex;
  }

  private bloomPass(radius: number): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(this.vaoEmpty);
    const down = this.program('down', FS_VS, DOWN_FS);
    const up = this.program('up', FS_VS, UP_FS);
    gl.disable(gl.BLEND);
    this.use(down);
    gl.uniform1i(this.u(down, 'uTex'), 0);
    let prev: WebGLTexture = this.texEmis!;
    let pw = this.w, ph = this.h;
    for (const lv of this.bloomTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, lv.w, lv.h);
      this.bindTex(0, prev);
      gl.uniform2f(this.u(down, 'uTexel'), 1 / pw, 1 / ph);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      prev = lv.tex; pw = lv.w; ph = lv.h;
    }
    this.use(up);
    gl.uniform1i(this.u(up, 'uTex'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const r = Math.max(0.2, Math.min(radius, 3));
    for (let i = this.bloomTex.length - 2; i >= 0; i--) {
      const lv = this.bloomTex[i], from = this.bloomTex[i + 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fbo);
      gl.viewport(0, 0, lv.w, lv.h);
      this.bindTex(0, from.tex);
      gl.uniform2f(this.u(up, 'uTexel'), 1 / from.w, 1 / from.h);
      gl.uniform1f(this.u(up, 'uWeight'), Math.min(1.6, 0.55 + 0.45 * r));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.viewport(0, 0, this.w, this.h);
  }

  private drawMesh(it: MeshItem): void {
    const gl = this.gl;
    if (it.idx.length < 3) return;
    const pr = this.program('mesh', MESH_VS, MESH_FS, ['aPos']);
    this.use(pr);
    gl.bindVertexArray(this.meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
    gl.bufferData(gl.ARRAY_BUFFER, it.verts, gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, it.idx, gl.STREAM_DRAW);
    gl.uniformMatrix3fv(this.u(pr, 'uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.u(pr, 'uModel'), false, this.model(it.m));
    const f = it.fill;
    gl.uniform4fv(this.u(pr, 'uC0'), f.c[0]); gl.uniform4fv(this.u(pr, 'uC1'), f.c[1]); gl.uniform4fv(this.u(pr, 'uC2'), f.c[2]);
    gl.uniform4f(this.u(pr, 'uK'), f.kind, f.o[0], f.o[1], f.o[2]);
    gl.uniform4fv(this.u(pr, 'uG'), f.g);
    gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
    gl.uniform1f(this.u(pr, 'uGlow'), it.glow);
    this.setBlend(it.blend);
    gl.drawElements(gl.TRIANGLES, it.idx.length, gl.UNSIGNED_INT, 0);
    this.stats.draws++;
  }

  private drawCustom(it: CustomItem, time: number): void {
    const gl = this.gl;
    const pr = this.customProgram(it.shader);
    if (!pr) return;
    const def = this.custom.get(it.shader)?.def ?? BUILTIN[it.shader];
    this.use(pr);
    gl.bindVertexArray(this.vaoEmpty);
    gl.uniformMatrix3fv(this.u(pr, 'uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.u(pr, 'uModel'), false, this.model(it.m));
    gl.uniform2f(this.u(pr, 'uSize'), it.w, it.h);
    gl.uniform1f(this.u(pr, 'uPad'), it.pad);
    gl.uniform1f(this.u(pr, 'uTime'), time);
    gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
    gl.uniform1f(this.u(pr, 'uGlow'), it.glow);
    for (const [name, type] of Object.entries(def.uniforms)) {
      const loc = this.u(pr, name);
      if (!loc) continue;
      const v = it.u[name];
      const arr = Array.isArray(v) ? v : [v ?? 0];
      if (type.endsWith(']')) gl.uniform4fv(loc, new Float32Array(arr as number[]));
      else if (type === 'float') gl.uniform1f(loc, arr[0] ?? 0);
      else if (type === 'vec2') gl.uniform2f(loc, arr[0] ?? 0, arr[1] ?? 0);
      else if (type === 'vec3') gl.uniform3f(loc, arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0);
      else gl.uniform4f(loc, arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 1);
    }
    this.setBlend(it.blend);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.draws++;
  }

  private drawStars(it: StarsItem, time: number): void {
    const gl = this.gl;
    const pr = this.program('stars', STAR_VS, STAR_FS, ['aStar']);
    const key = `${it.count}:${it.seed}`;
    let c = this.starCache.get(it.node);
    if (!c || c.key !== key) {
      if (c) { gl.deleteBuffer(c.vbo); gl.deleteVertexArray(c.vao); }
      const data = new Float32Array(it.count * 4);
      let a = Math.floor(it.seed * 977 + 13) | 0;
      const rnd = (): number => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (let i = 0; i < it.count; i++) { data[4 * i] = rnd() * 2 - 1; data[4 * i + 1] = rnd() * 2 - 1; data[4 * i + 2] = rnd(); data[4 * i + 3] = rnd() * 100; }
      const vbo = gl.createBuffer()!;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      c = { vbo, vao, key, n: it.count };
      this.starCache.set(it.node, c);
    }
    this.use(pr);
    gl.bindVertexArray(c.vao);
    gl.uniformMatrix3fv(this.u(pr, 'uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.u(pr, 'uModel'), false, this.model(it.m));
    gl.uniform2f(this.u(pr, 'uSize'), it.w, it.h);
    gl.uniform1f(this.u(pr, 'uTime'), it.time);
    gl.uniform1f(this.u(pr, 'uSpeed'), it.speed);
    gl.uniform1f(this.u(pr, 'uFov'), Math.max(0.2, it.fov));
    gl.uniform1f(this.u(pr, 'uStreak'), it.streak);
    gl.uniform1f(this.u(pr, 'uSize0'), it.size);
    gl.uniform2f(this.u(pr, 'uLook'), it.look[0], it.look[1]);
    gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
    gl.uniform1f(this.u(pr, 'uGlow'), it.glow);
    void time;
    this.setBlend(it.blend);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, it.count);
    this.stats.draws++;
  }

  private drawCanvas(it: CanvasItem): void {
    const gl = this.gl;
    let e = this.pcTex.get(it.node);
    if (!e || e.w !== it.pc.w || e.h !== it.pc.h) {
      if (e) gl.deleteTexture(e.tex);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, it.pc.w, it.pc.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.nearest(gl.TEXTURE_2D);
      e = { tex, version: -1, w: it.pc.w, h: it.pc.h };
      this.pcTex.set(it.node, e);
    }
    if (e.version !== it.pc.version) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      const src = it.pc.data, pm = new Uint8Array(src.length);
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3] / 255;
        pm[i] = src[i] * a; pm[i + 1] = src[i + 1] * a; pm[i + 2] = src[i + 2] * a; pm[i + 3] = src[i + 3];
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, it.pc.w, it.pc.h, gl.RGBA, gl.UNSIGNED_BYTE, pm);
      e.version = it.pc.version;
    }
    const pr = this.program('tex', TEX_VS, TEX_FS);
    this.use(pr);
    gl.bindVertexArray(this.vaoEmpty);
    gl.uniformMatrix3fv(this.u(pr, 'uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.u(pr, 'uModel'), false, this.model(it.m));
    gl.uniform2f(this.u(pr, 'uSize'), it.w, it.h);
    this.bindTex(0, e.tex); gl.uniform1i(this.u(pr, 'uTex'), 0);
    gl.uniform1f(this.u(pr, 'uOpacity'), it.opacity);
    gl.uniform1f(this.u(pr, 'uGlow'), it.glow);
    gl.uniform1f(this.u(pr, 'uFlipY'), 0);
    this.setBlend(it.blend);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.draws++;
  }

  /** Called when a node is removed: frees its GPU resources. */
  forget(n: GfxNode): void {
    const gl = this.gl;
    const s = this.starCache.get(n);
    if (s) { gl.deleteBuffer(s.vbo); gl.deleteVertexArray(s.vao); this.starCache.delete(n); }
    const p = this.pcTex.get(n);
    if (p) { gl.deleteTexture(p.tex); this.pcTex.delete(n); }
  }

  /** Text rasters depend on web fonts: call when one finished loading. */
  invalidateText(): void { this.atlas.clear(); }

  /** Device px per logical unit and offset: the runtime maps pointer positions with it. */
  get mapping(): { sx: number; sy: number; ox: number; oy: number } { return this.view; }

  dispose(): void {
    this.freeTargets();
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

export { mul };
