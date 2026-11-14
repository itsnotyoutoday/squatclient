/** A texture atlas of text runs and small images, rasterised with Canvas2D (real web fonts, proper shaping). */
export interface AtlasEntry { u0: number; v0: number; u1: number; v1: number; w: number; h: number; baseline: number; cap: number; advance: number }

export interface TextKey {
  text: string; font: string; weight: string; italic: boolean; px: number; letterSpacing: number; maxWidth: number; cellW: number;
}

export class Atlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private entries = new Map<string, AtlasEntry>();
  private x = 0; private y = 0; private rowH = 0;
  /** rows dirty since the last upload: [y0, y1) */
  dirtyY0 = Infinity; dirtyY1 = 0;
  generation = 0;
  full = false;

  constructor(readonly size = 2048) {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D;
  }

  clear(): void {
    this.entries.clear();
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.x = 0; this.y = 0; this.rowH = 0;
    this.dirtyY0 = 0; this.dirtyY1 = this.size;
    this.generation++;
    this.full = false;
  }

  private alloc(w: number, h: number): { x: number; y: number } | null {
    if (w > this.size || h > this.size) return null;
    if (this.x + w > this.size) { this.x = 0; this.y += this.rowH + 1; this.rowH = 0; }
    if (this.y + h > this.size) { this.full = true; return null; }
    const p = { x: this.x, y: this.y };
    this.x += w + 1;
    this.rowH = Math.max(this.rowH, h);
    this.dirtyY0 = Math.min(this.dirtyY0, p.y);
    this.dirtyY1 = Math.max(this.dirtyY1, p.y + h);
    return p;
  }

  private entry(x: number, y: number, w: number, h: number, extra: Partial<AtlasEntry>): AtlasEntry {
    const s = this.size;
    return { u0: (x + 0.5) / s, v0: (y + 0.5) / s, u1: (x + w - 0.5) / s, v1: (y + h - 0.5) / s, w, h, baseline: 0, cap: 0, advance: 0, ...extra };
  }

  text(k: TextKey): AtlasEntry | null {
    const key = `${k.font}|${k.weight}|${k.italic ? 'i' : ''}|${k.px}|${k.letterSpacing}|${k.maxWidth}|${k.cellW}|${k.text}`;
    const hit = this.entries.get(key);
    if (hit) return hit;
    const ctx = this.ctx;
    const font = `${k.italic ? 'italic ' : ''}${k.weight} ${k.px}px ${k.font}`;
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('Hx');
    const asc = Math.ceil(m.fontBoundingBoxAscent ?? k.px * 0.95);
    const desc = Math.ceil(m.fontBoundingBoxDescent ?? k.px * 0.3);
    const cap = ctx.measureText('H').actualBoundingBoxAscent || k.px * 0.7;
    const chars = [...k.text];
    const ls = k.letterSpacing * (k.px / Math.max(1, k.px));
    let advance: number;
    if (k.cellW > 0) advance = chars.length * k.cellW;
    else if (ls !== 0) advance = chars.reduce((a, c) => a + ctx.measureText(c).width + ls, 0) - ls;
    else advance = ctx.measureText(k.text).width;
    let scaleX = 1;
    if (k.maxWidth > 0 && advance > k.maxWidth) { scaleX = k.maxWidth / advance; advance = k.maxWidth; }
    const pad = 2;
    const w = Math.max(1, Math.ceil(advance) + pad * 2), h = asc + desc + pad * 2;
    const at = this.alloc(w, h);
    if (!at) return null;
    ctx.save();
    ctx.beginPath(); ctx.rect(at.x, at.y, w, h); ctx.clip();
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.translate(at.x + pad, at.y + pad + asc);
    ctx.scale(scaleX, 1);
    if (k.cellW > 0) {
      ctx.textAlign = 'center';
      chars.forEach((c, i) => ctx.fillText(c, (i + 0.5) * (k.cellW / scaleX), 0));
    } else if (ls !== 0) {
      let x = 0;
      for (const c of chars) { ctx.fillText(c, x, 0); x += ctx.measureText(c).width + ls; }
    } else ctx.fillText(k.text, 0, 0);
    ctx.restore();
    const e = this.entry(at.x, at.y, w, h, { baseline: pad + asc, cap, advance });
    this.entries.set(key, e);
    return e;
  }

  image(key: string, img: CanvasImageSource, w: number, h: number): AtlasEntry | null {
    const hit = this.entries.get(key);
    if (hit) return hit;
    const at = this.alloc(w + 2, h + 2);
    if (!at) return null;
    this.ctx.drawImage(img, at.x + 1, at.y + 1, w, h);
    const e = this.entry(at.x + 1, at.y + 1, w, h, {});
    this.entries.set(key, e);
    return e;
  }
}
