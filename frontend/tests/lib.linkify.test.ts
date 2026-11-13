import { describe, expect, it } from 'vitest';
import { linkSegments, safeUrl } from '../src/lib/linkify';

describe('safeUrl', () => {
  it('accepts http and https only', () => {
    expect(safeUrl('http://a.example')).toBe('http://a.example');
    expect(safeUrl('https://a.example/p?q=1#f')).toBe('https://a.example/p?q=1#f');
  });
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>',
    'file:///etc/passwd',
    'ftp://a.example',
    'vbscript:x',
    '//evil.example',
    'https://',
    '',
    ' javascript:alert(1)',
  ])('rejects %j', (u) => {
    expect(safeUrl(u)).toBeNull();
  });
});

describe('linkSegments', () => {
  const join = (t: string): string =>
    linkSegments(t)
      .map((s) => s.text)
      .join('');
  it('round-trips text', () => {
    for (const t of [
      '',
      'plain',
      'a https://x.example/y, b',
      '(https://x.example/a_(b))',
      'javascript:alert(1) https://ok.example',
    ])
      expect(join(t)).toBe(t);
  });
  it('strips trailing punctuation', () => {
    const s = linkSegments('go to https://x.example/a. Then https://y.example/b)!');
    expect(s.filter((x) => x.url).map((x) => x.url)).toEqual(['https://x.example/a', 'https://y.example/b']);
  });
  it('keeps balanced parentheses', () => {
    expect(linkSegments('https://en.example/wiki/A_(b)').find((x) => x.url)?.url).toBe(
      'https://en.example/wiki/A_(b)',
    );
  });
  it('never links javascript: or other schemes', () => {
    expect(linkSegments('javascript:alert(1) and ftp://x and data:text/html,hi').some((s) => s.url)).toBe(
      false,
    );
    expect(linkSegments('xhttps://not.a.link.example').some((s) => s.url && !s.url.startsWith('http'))).toBe(
      false,
    );
  });
});
