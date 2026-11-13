import type { Line } from '../api/types';

/**
 * Per-session line buffer: seq-ordered, de-duplicated by seq, capped (oldest dropped).
 * Mutable on purpose (100k+ lines); `version` changes on every mutation so views can re-render.
 */
export class LineBuffer {
  lines: Line[] = [];
  version = 0;
  /** True once scrollback() returned nothing older than lines[0]. */
  exhausted = false;
  /** Number of lines dropped from the front because of the cap (for scroll anchoring). */
  droppedFront = 0;
  private localCounter = 0;

  constructor(public cap = 20000) {}

  get first(): number {
    return this.lines.length ? this.lines[0].seq : 0;
  }
  get last(): number {
    return this.lines.length ? this.lines[this.lines.length - 1].seq : 0;
  }

  setCap(cap: number): void {
    this.cap = Math.max(100, cap);
    this.trim();
  }

  /** Merge lines in (live or history). Returns the number of lines actually added. */
  merge(incoming: readonly Line[]): number {
    if (incoming.length === 0) return 0;
    const last = this.last;
    let added = 0;
    if (incoming[0].seq > last && isAscending(incoming)) {
      for (const l of incoming) this.lines.push(l);
      added = incoming.length;
    } else {
      const bySeq = new Map<number, Line>();
      for (const l of this.lines) bySeq.set(l.seq, l);
      const before = bySeq.size;
      for (const l of incoming) if (!bySeq.has(l.seq)) bySeq.set(l.seq, l);
      added = bySeq.size - before;
      if (added === 0) return 0;
      this.lines = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    }
    this.trim();
    this.version++;
    return added;
  }

  /** Add a client-side (local) system line right after the newest line, with a fractional seq. */
  addLocal(session: string, text: string, ts = Date.now()): Line {
    const seq = Math.floor(this.last) + 0.001 * ++this.localCounter;
    const line: Line = { session, seq, ts, kind: 'system', spans: [{ s: text }] };
    this.lines.push(line);
    this.trim();
    this.version++;
    return line;
  }

  private trim(): void {
    const max = Math.ceil(this.cap * 1.05); // small hysteresis: avoid trimming on every line
    if (this.lines.length <= max) return;
    const drop = this.lines.length - this.cap;
    this.lines.splice(0, drop);
    this.droppedFront += drop;
    this.exhausted = false;
  }

  clear(): void {
    this.lines = [];
    this.version++;
  }
}

function isAscending(ls: readonly Line[]): boolean {
  for (let i = 1; i < ls.length; i++) if (ls[i].seq <= ls[i - 1].seq) return false;
  return true;
}
