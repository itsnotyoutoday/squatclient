import { describe, expect, it, vi } from 'vitest';
import { parseUploadCommand } from '../src/lib/upload/command';
import { decodeTextBytes, MAX_UPLOAD_BYTES } from '../src/lib/upload/decode';
import { prepareUpload } from '../src/lib/upload/prepare';
import { sendBlock } from '../src/lib/blocksender';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseUploadCommand', () => {
  it.each([
    ['/upload', ''],
    ['  /upload  ', ''],
    ['/UPLOAD', ''],
    ['/upload ~/code/a.mush', '~/code/a.mush'],
    ['/upload   /tmp/with space/a b.txt  ', '/tmp/with space/a b.txt'],
    ['/upload "/tmp/quoted name.txt"', '/tmp/quoted name.txt'],
    ["/upload '~/x.txt'", '~/x.txt'],
    ['/upload "unterminated', '"unterminated'],
  ])('%j -> %j', (line, want) => expect(parseUploadCommand(line)).toBe(want));

  it.each(['upload', '/uploads', '/uploadx file', 'say /upload', '/up', '', '/ upload'])(
    '%j is not an upload command',
    (line) => expect(parseUploadCommand(line)).toBeNull(),
  );
});

describe('prepareUpload', () => {
  const base = { join: true, stripBlank: true, prefix: '', suffix: '' };
  const text = '@@ header\n&F me=a\n  b\n\n  c\nsay hi\n';

  it('joins continuation lines and drops blank/@@ lines, with counts', () => {
    const p = prepareUpload(text, base);
    expect(p.lines).toEqual(['&F me=abc', 'say hi']);
    expect(p.sourceLines).toBe(6);
    expect(p.stripped).toBe(2); // the @@ line and the blank line
    expect(p.joined).toBe(2);
  });

  it('keeps lines as they are with both rules off (no trailing empty command from the final newline)', () => {
    const p = prepareUpload('a\n  b\n\nc\n', { ...base, join: false, stripBlank: false });
    expect(p.lines).toEqual(['a', '  b'.trimEnd(), '', 'c']);
    expect(p.stripped).toBe(0);
    expect(p.joined).toBe(0);
  });

  it('applies prefix and suffix to every command', () => {
    const p = prepareUpload('one\ntwo\n', { ...base, prefix: '@force me=', suffix: ' ;x' });
    expect(p.lines).toEqual(['@force me=one ;x', '@force me=two ;x']);
  });

  it('an empty or comment-only file has no commands', () => {
    expect(prepareUpload('', base).lines).toEqual([]);
    expect(prepareUpload('@@ only\n\n', base).lines).toEqual([]);
  });

  it('handles CRLF and 100k lines quickly', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => `think ${i}`).join('\r\n');
    const t = Date.now();
    const p = prepareUpload(big, base);
    expect(p.lines).toHaveLength(100_000);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('decodeTextBytes (dropped files)', () => {
  it('plain UTF-8, BOM stripped, CRLF and CR normalised', () => {
    expect(decodeTextBytes('a.txt', enc('café\r\nb\rc\n'))).toMatchObject({
      ok: true,
      text: 'café\nb\nc\n',
      encoding: 'utf-8',
      name: 'a.txt',
    });
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('hi')]);
    expect(decodeTextBytes('b.txt', bom)).toMatchObject({ ok: true, text: 'hi', size: 5 });
  });

  it('falls back to Latin-1', () => {
    const r = decodeTextBytes('l.txt', bytes(0x63, 0x61, 0x66, 0xe9, 0x0a));
    expect(r).toMatchObject({ ok: true, text: 'café\n', encoding: 'latin1' });
  });

  it('rejects binary: NUL bytes, control characters, mostly invalid UTF-8', () => {
    expect(decodeTextBytes('x', bytes(0x61, 0, 0x62))).toMatchObject({ ok: false });
    expect(decodeTextBytes('x', bytes(0xff, 0xfe, 0x61, 0)).error).toMatch(/binary/);
    expect(
      decodeTextBytes(
        'x',
        Uint8Array.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 0x61 : 1)),
      ).ok,
    ).toBe(false);
    expect(
      decodeTextBytes(
        'x',
        Uint8Array.from({ length: 500 }, (_, i) => (i % 5 === 4 ? 0x61 : 0x80 + (i % 5))),
      ).ok,
    ).toBe(false);
  });

  it('rejects files over the cap', () => {
    const r = decodeTextBytes('huge.txt', new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x61));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/);
    expect(decodeTextBytes('edge.txt', new Uint8Array(MAX_UPLOAD_BYTES).fill(0x61)).ok).toBe(true);
  });
});

describe('sendBlock pause / resume / batch', () => {
  it('pause stops the pacing, resume continues, cancel reports what was sent', async () => {
    vi.useFakeTimers();
    try {
      const out: string[] = [];
      const b = sendBlock(['a', 'b', 'c', 'd'], 100, (l) => out.push(l));
      expect(out).toEqual(['a']);
      b.pause();
      expect(b.paused).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(out).toEqual(['a']);
      b.resume();
      expect(b.paused).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(out).toEqual(['a', 'b']);
      b.cancel();
      await vi.advanceTimersByTimeAsync(1000);
      expect(out).toEqual(['a', 'b']);
      expect(await b.done).toEqual({ sent: 2, total: 4, cancelled: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('delay 0 without batch is one synchronous tick and never overflows the stack', async () => {
    const lines = Array.from({ length: 200_000 }, (_, i) => String(i));
    let n = 0;
    const b = sendBlock(lines, 0, () => n++);
    expect(n).toBe(200_000);
    expect(await b.done).toMatchObject({ sent: 200_000, cancelled: false });
  });

  it('batch yields to the event loop between chunks', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const b = sendBlock(Array.from({ length: 450 }, String), 0, () => n++, undefined, { batch: 200 });
      expect(n).toBe(200);
      await vi.advanceTimersByTimeAsync(1);
      expect(n).toBeGreaterThan(200); // yielded, then continued
      await vi.advanceTimersByTimeAsync(10);
      expect(n).toBe(450);
      expect((await b.done).cancelled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a throwing send stops the block; pause on a finished block is a no-op', async () => {
    const b = sendBlock(['a', 'b'], 0, () => {
      throw new Error('x');
    });
    expect(await b.done).toEqual({ sent: 0, total: 2, cancelled: true });
    b.pause();
    expect(b.paused).toBe(false);
  });
});
