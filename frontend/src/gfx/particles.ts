import { parseColor, type RGBA } from './color';
import type { GfxNode } from './scene';
import { apply, type Mat } from './geom';

function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CPU particle simulation; the renderer draws the particles as soft dots in one batch. */
export class Emitter {
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; age: Float32Array; life: Float32Array; seed: Float32Array;
  count = 0;
  private acc = 0;
  private rnd = rng(12345);
  lastT = -1;
  burstDone = 0;
  constructor(public cap = 1500) {
    const f = (): Float32Array => new Float32Array(cap);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.age = f(); this.life = f(); this.seed = f();
  }

  private spawn(n: GfxNode, m: Mat): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const space = n.str('space', 'world');
    const spread = (n.num('spread', 30) * Math.PI) / 180;
    const base = (n.num('angle', 0) * Math.PI) / 180;
    const a = base + (this.rnd() - 0.5) * spread;
    const sp = n.num('speedMin', n.num('speed', 40)) + this.rnd() * (n.num('speedMax', n.num('speed', 40)) - n.num('speedMin', n.num('speed', 40)));
    let dx = Math.sin(a) * sp, dy = -Math.cos(a) * sp;
    const jitter = n.num('radius', 0);
    let px = (this.rnd() - 0.5) * 2 * jitter, py = (this.rnd() - 0.5) * 2 * jitter;
    if (space === 'world') {
      [px, py] = apply(m, px, py);
      const ddx = m[0] * dx + m[2] * dy, ddy = m[1] * dx + m[3] * dy; // directions follow the node's rotation
      dx = ddx; dy = ddy;
    }
    this.x[i] = px; this.y[i] = py; this.vx[i] = dx; this.vy[i] = dy; this.age[i] = 0;
    this.life[i] = n.num('lifeMin', n.num('life', 1)) + this.rnd() * (n.num('lifeMax', n.num('life', 1)) - n.num('lifeMin', n.num('life', 1)));
    this.seed[i] = this.rnd();
  }

  update(dt: number, n: GfxNode, m: Mat): void {
    dt = Math.min(dt, 0.1);
    const gx = n.num('gravityX', 0), gy = n.num('gravityY', 0), drag = n.num('drag', 0);
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        const l = --this.count;
        this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.seed[i] = this.seed[l];
        i--;
        continue;
      }
      this.vx[i] = (this.vx[i] + gx * dt) * damp;
      this.vy[i] = (this.vy[i] + gy * dt) * damp;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
    if (n.bool('active', true)) {
      this.acc += n.num('rate', 20) * dt;
      while (this.acc >= 1) { this.acc -= 1; this.spawn(n, m); }
    }
    const burst = n.num('burst', 0);
    if (burst > 0 && n.sim.burstId !== burst + ':' + n.num('burstId', 0)) {
      n.sim.burstId = burst + ':' + n.num('burstId', 0);
      for (let k = 0; k < burst; k++) this.spawn(n, m);
    }
  }
}

export interface ParticleStyle { c0: RGBA; c1: RGBA; s0: number; s1: number; falloff: number }

export function particleStyle(n: GfxNode): ParticleStyle {
  return {
    c0: parseColor(n.props.colorStart ?? n.props.fill ?? '#ffffff'), c1: parseColor(n.props.colorEnd ?? n.props.colorStart ?? n.props.fill ?? '#ffffff00'),
    s0: n.num('sizeStart', 6), s1: n.num('sizeEnd', 1), falloff: n.num('falloff', 2),
  };
}
