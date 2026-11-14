import { easeFn, type EaseFn } from './ease';
import { isColorLike, mixColor, parseColor, toHex } from './color';

/** Interpolates two property values: numbers, colors, equal-length number arrays; anything else switches at the end. */
export function lerpValue(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (typeof a === 'string' && typeof b === 'string' && isColorLike(a) && isColorLike(b)) return toHex(mixColor(parseColor(a), parseColor(b), t));
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => lerpValue(v, b[i], t));
  if (typeof a === 'number' && Array.isArray(b)) return b.map((v) => lerpValue(a, v, t));
  return t >= 1 ? b : a;
}

export interface Track { prop: string; from?: unknown; to: unknown }

export interface TweenSpec {
  id?: string;
  tracks: Track[];
  dur: number;
  delay: number;
  ease: string;
  /** repeat count after the first run; -1 = forever */
  loop: number;
  yoyo: boolean;
  after?: string;
}

/** A running tween over one target. Time is in seconds on the scene clock. */
export class Tween {
  readonly id: string;
  readonly spec: TweenSpec;
  readonly target: { get(p: string): unknown; set(p: string, v: unknown): void; alive(): boolean };
  private ease: EaseFn;
  private from = new Map<string, unknown>();
  started = false;
  done = false;
  t0 = 0;
  /** a waiting tween (after=...) starts when this id has finished */
  waiting: boolean;

  constructor(id: string, spec: TweenSpec, target: Tween['target'], now: number) {
    this.id = id;
    this.spec = spec;
    this.target = target;
    this.ease = easeFn(spec.ease);
    this.t0 = now + spec.delay;
    this.waiting = !!spec.after;
  }

  release(now: number): void {
    this.waiting = false;
    this.t0 = now + this.spec.delay;
  }

  /** Advances to `now`; returns true while it still changes something. */
  step(now: number): boolean {
    if (this.done || this.waiting) return false;
    if (now < this.t0) return false;
    if (!this.started) {
      this.started = true;
      for (const tr of this.spec.tracks) this.from.set(tr.prop, tr.from !== undefined ? tr.from : this.target.get(tr.prop));
    }
    const { dur, loop, yoyo } = this.spec;
    let u = dur <= 0 ? 1 : (now - this.t0) / dur;
    let cycle = Math.floor(u);
    let finished = false;
    if (loop >= 0 && cycle > loop) { cycle = loop; u = cycle + 1; finished = true; }
    let f = finished ? 1 : u - cycle;
    if (finished && !yoyo) f = 1;
    if (yoyo && cycle % 2 === 1) f = 1 - f;
    if (finished && yoyo) f = (cycle % 2 === 1) ? 0 : 1;
    const e = this.ease(Math.min(1, Math.max(0, f)));
    for (const tr of this.spec.tracks) {
      const fr = this.from.get(tr.prop);
      this.target.set(tr.prop, f >= 1 ? tr.to : f <= 0 ? fr : lerpValue(fr, tr.to, e));
    }
    if (finished) this.done = true;
    return true;
  }
}
