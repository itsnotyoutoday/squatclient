/** Sends lines one after another, optionally paced so a big block does not flood the game. */
export interface BlockProgress {
  sent: number;
  total: number;
}

export interface BlockSend {
  /** Stop after the line currently in flight; resolves `done` with the number of lines NOT sent. */
  cancel(): void;
  /** Resolves when every line was handed over or the send was cancelled/failed. */
  done: Promise<{ sent: number; total: number; cancelled: boolean }>;
}

/**
 * `send` is called once per line, in order. With delayMs 0 every line goes out synchronously, in one
 * tick. With delayMs > 0 the first line goes out at once and each further line `delayMs` later;
 * `onProgress` fires after every line. A throwing `send` stops the block.
 */
export function sendBlock(
  lines: readonly string[],
  delayMs: number,
  send: (line: string) => void,
  onProgress?: (p: BlockProgress) => void,
): BlockSend {
  const total = lines.length;
  let sent = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (r: { sent: number; total: number; cancelled: boolean }) => void = () => undefined;
  const done = new Promise<{ sent: number; total: number; cancelled: boolean }>((res) => (finish = res));

  const step = (): void => {
    timer = undefined;
    if (cancelled) return;
    try {
      send(lines[sent]);
    } catch {
      cancelled = true;
      finish({ sent, total, cancelled: true });
      return;
    }
    sent++;
    onProgress?.({ sent, total });
    if (sent >= total) finish({ sent, total, cancelled: false });
    else if (delayMs > 0) timer = setTimeout(step, delayMs);
    else step();
  };

  if (total === 0) finish({ sent: 0, total: 0, cancelled: false });
  else step();

  return {
    done,
    cancel() {
      if (cancelled || sent >= total) return;
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      finish({ sent, total, cancelled: true });
    },
  };
}
