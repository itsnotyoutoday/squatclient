/** Sends lines one after another, optionally paced so a big block does not flood the game. */
export interface BlockProgress {
  sent: number;
  total: number;
}

export interface BlockResult {
  sent: number;
  total: number;
  cancelled: boolean;
}

export interface BlockSend {
  /** Stop after the line currently in flight; resolves `done` with the number of lines NOT sent. */
  cancel(): void;
  /** Stop sending until `resume()`; the lines already sent stay sent. */
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Resolves when every line was handed over or the send was cancelled/failed. */
  done: Promise<BlockResult>;
}

export interface BlockOptions {
  /**
   * With delayMs 0: hand over at most this many lines per tick, then yield to the event loop
   * (so a huge file keeps the UI responsive). Default: all lines in one synchronous tick.
   */
  batch?: number;
}

/**
 * `send` is called once per line, in order. With delayMs 0 every line goes out synchronously, in one
 * tick (or in `batch`-sized ticks). With delayMs > 0 the first line goes out at once and each further
 * line `delayMs` later; `onProgress` fires after every line. A throwing `send` stops the block.
 */
export function sendBlock(
  lines: readonly string[],
  delayMs: number,
  send: (line: string) => void,
  onProgress?: (p: BlockProgress) => void,
  opts: BlockOptions = {},
): BlockSend {
  const total = lines.length;
  let sent = 0;
  let cancelled = false;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (r: BlockResult) => void = () => undefined;
  const done = new Promise<BlockResult>((res) => (finish = res));
  const batch = opts.batch && opts.batch > 0 ? opts.batch : Infinity;

  const step = (): void => {
    timer = undefined;
    let inTick = 0;
    while (!cancelled && !paused && sent < total) {
      try {
        send(lines[sent]);
      } catch {
        cancelled = true;
        finish({ sent, total, cancelled: true });
        return;
      }
      sent++;
      inTick++;
      onProgress?.({ sent, total });
      if (sent >= total) {
        finish({ sent, total, cancelled: false });
        return;
      }
      if (delayMs > 0) {
        timer = setTimeout(step, delayMs);
        return;
      }
      if (inTick >= batch) {
        timer = setTimeout(step, 0);
        return;
      }
    }
  };

  if (total === 0) finish({ sent: 0, total: 0, cancelled: false });
  else step();

  return {
    done,
    get paused() {
      return paused;
    },
    cancel() {
      if (cancelled || sent >= total) return;
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      finish({ sent, total, cancelled: true });
    },
    pause() {
      if (cancelled || paused || sent >= total) return;
      paused = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    resume() {
      if (cancelled || !paused) return;
      paused = false;
      if (timer === undefined) timer = setTimeout(step, Math.max(0, delayMs));
    },
  };
}
