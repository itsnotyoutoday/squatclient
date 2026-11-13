import { describe, expect, it } from 'vitest';
import { ALIASES, TOPICS, getTopic } from '../src/help/data';
import { normalizeKey, resolveQuery } from '../src/help/lookup';
import { search } from '../src/help/search';
import { renderMarkdown, renderTopic, sanitize } from '../src/help/render';
import { displayBinding } from '../src/help/keys';
import { parseHelpCommand } from '../src/help/command';
import { DEFAULT_KEYMAP } from '../src/lib/keymap';

describe('help topic lookup', () => {
  const id = (q: string): string | undefined => {
    const r = resolveQuery(q);
    return r.kind === 'topic' ? r.id : undefined;
  };

  it('resolves TF-style command names, with or without a slash', () => {
    expect(id('def')).toBe('scripting/macros-def');
    expect(id('/def')).toBe('scripting/macros-def');
    expect(id('  /DEF ')).toBe('scripting/macros-def');
    expect(id('echo')).toBe('scripting/commands');
    expect(id('/set')).toBe('scripting/variables');
    expect(id('strlen')).toBe('scripting/functions');
    expect(id('if')).toBe('scripting/control-flow');
  });

  it('resolves section and topic names', () => {
    expect(id('expressions')).toBe('scripting/expressions');
    expect(id('triggers')).toBe('scripting/macros-def');
    expect(id('lua')).toBe('lua');
    expect(id('keys')).toBe('keys');
    expect(id('squatter')).toBe('squatter');
    expect(id('Keyboard shortcuts')).toBe('keys');
    expect(id('squatter/routing')).toBe('squatter/routing');
    expect(id('scripting')).toBe('scripting');
    expect(id('about')).toBe('about');
  });

  it('opens home for an empty query and honours help: prefixes and anchors', () => {
    expect(id('')).toBe('home');
    expect(id('help:keys')).toBe('keys');
    const r = resolveQuery('help:squatter#suspend-and-detach');
    expect(r).toMatchObject({ kind: 'topic', id: 'squatter', anchor: 'suspend-and-detach' });
  });

  it('remembers the looked-up term so the page can highlight it', () => {
    expect(resolveQuery('/def')).toMatchObject({ id: 'scripting/macros-def', term: '/def' });
    expect(resolveQuery('keys')).toMatchObject({ id: 'keys', term: undefined });
  });

  it('turns unknown words into a search', () => {
    expect(resolveQuery('how do I gag spam')).toEqual({ kind: 'search', query: 'how do I gag spam' });
  });

  it('has only normalised alias keys that point at real topics', () => {
    for (const [k, v] of Object.entries(ALIASES)) {
      expect(normalizeKey(k)).toBe(k);
      expect(getTopic(v), `${k} -> ${v}`).toBeDefined();
    }
  });
});

describe('/help command parsing', () => {
  it('recognises the variants', () => {
    expect(parseHelpCommand('/help')).toBe('');
    expect(parseHelpCommand('/help def')).toBe('def');
    expect(parseHelpCommand('  /HELP   /def  ')).toBe('/def');
    expect(parseHelpCommand('/help two words')).toBe('two words');
  });
  it('ignores everything else', () => {
    expect(parseHelpCommand('/helpme')).toBeNull();
    expect(parseHelpCommand('help')).toBeNull();
    expect(parseHelpCommand('say /help')).toBeNull();
    expect(parseHelpCommand('/hel')).toBeNull();
  });
});

describe('help search', () => {
  it('ranks title matches above body mentions', () => {
    expect(search('expressions')[0].topic).toBe('scripting/expressions');
    expect(search('keyboard shortcuts')[0].topic).toBe('keys');
    expect(search('squatters routing')[0].topic).toBe('squatter/routing');
  });
  it('finds function names and Lua API names', () => {
    expect(search('strlen')[0].topic).toBe('scripting/functions');
    expect(search('squat.on')[0].topic).toMatch(/^lua\//);
  });
  it('ranks headings above body text', () => {
    const entries: Parameters<typeof search>[1] = [
      ['a', '', 'b', 'the word zebra appears in a body'],
      ['b', 'z', 'h', 'zebra'],
      ['c', '', 'k', 'zebra'],
    ];
    expect(search('zebra', entries).map((r) => r.topic)).toEqual(['b', 'c', 'a']);
  });
  it('requires every word to occur in a topic and returns nothing for gibberish', () => {
    expect(search('zzzxqv')).toEqual([]);
    expect(search('squatterd zzzxqv')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });
  it('returns an anchor and a snippet around the match', () => {
    const r = search('fingerprint').find((x) => x.topic === 'squatter');
    expect(r?.snippet.toLowerCase()).toContain('fingerprint');
  });
});

describe('help content', () => {
  it('has every expected top-level topic', () => {
    for (const id of [
      'home',
      'getting-started',
      'connecting',
      'squatter',
      'using',
      'keys',
      'settings',
      'commands',
      'scripting',
      'lua',
      'compat',
      'about',
    ]) {
      expect(getTopic(id), id).toBeDefined();
    }
    expect(TOPICS.filter((t) => t.parent === 'scripting').length).toBeGreaterThanOrEqual(10);
    expect(getTopic('squatter/routing')?.parent).toBe('squatter');
  });

  it('every internal link resolves to an existing topic and anchor', () => {
    const bad: string[] = [];
    for (const t of TOPICS) {
      const hrefs = [...t.body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
      for (const href of hrefs) {
        if (/^https?:/.test(href)) continue;
        let id = t.id;
        let anchor: string | undefined;
        if (href.startsWith('#')) anchor = href.slice(1);
        else if (href.startsWith('help:')) {
          const [i, a] = href.slice(5).split('#');
          id = i;
          anchor = a;
        } else {
          bad.push(`${t.id}: unsupported link ${href}`);
          continue;
        }
        const target = getTopic(id);
        if (!target) bad.push(`${t.id}: ${href} -> no topic ${id}`);
        else if (anchor && !target.headings.some((h) => h.id === anchor))
          bad.push(`${t.id}: ${href} -> no anchor ${anchor}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('renders heading ids in the same order as the generated heading list', () => {
    for (const t of TOPICS) {
      const div = document.createElement('div');
      div.innerHTML = renderTopic(t);
      const ids = [...div.querySelectorAll('[id^="help-a-"]')].map((e) => e.id.replace('help-a-', ''));
      expect(ids, t.id).toEqual(t.headings.map((h) => h.id));
    }
  });

  it('credits Ken Keys and TinyFugue near the top of the scripting page', () => {
    const top = getTopic('scripting')?.body.slice(0, 900) ?? '';
    expect(top).toMatch(/original implementation/);
    expect(top).toMatch(/inspired by/);
    expect(top).toMatch(/closely compatible with TinyFugue/);
    expect(top).toMatch(/Ken Keys/);
    expect(top).toContain('tinyfugue.sourceforge.net');
    expect(top).toMatch(/TinyFugue community/);
  });

  it('credits TinyFugue, the licence, dependencies and repositories on the About page', () => {
    const about = getTopic('about')?.body ?? '';
    for (const s of [
      'Ken Keys',
      'tinyfugue.sourceforge.net',
      'GPL-3.0-or-later',
      'Wails',
      'React',
      'gopher-lua',
      'coder/websocket',
      'go-keyring',
      'github.com/itsnotyoutoday/squatclient',
      'github.com/itsnotyoutoday/squatClientDaemon',
    ]) {
      expect(about, s).toContain(s);
    }
  });

  it('lists every default key binding on the keyboard page', () => {
    const body = getTopic('keys')?.body ?? '';
    const missing = Object.keys(DEFAULT_KEYMAP).filter((k) => {
      const name = displayBinding(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`(^|[\\s|,])${name}(?=[\\s,|])`).test(body);
    });
    expect(missing.map(displayBinding)).toEqual([]);
  });

  it('explains squatter routing with the key points', () => {
    const r = getTopic('squatter/routing')?.body ?? '';
    for (const s of [
      'Connect via',
      'Direct',
      'one hop',
      'squatterd pair',
      'ssh -N -L 10327:127.0.0.1:10327',
      '/suspend',
      'no game passwords',
    ]) {
      expect(r.toLowerCase(), s).toContain(s.toLowerCase());
    }
  });
});

describe('help sanitisation', () => {
  it('strips script tags, event handlers and javascript: links', () => {
    const html = renderMarkdown(
      [
        '<script>alert(1)</script>',
        '',
        '[bad](javascript:alert(1))',
        '',
        '<a href="javascript:alert(2)" onclick="alert(3)">raw</a>',
        '',
        '<img src="x" onerror="alert(4)">',
        '',
        '<iframe src="https://evil.example"></iframe>',
        '',
        '[data](data:text/html,<b>x</b>)',
      ].join('\n'),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).not.toMatch(/<iframe|<img/i);
    expect(html).not.toMatch(/data:text/i);
  });
  it('keeps http, https and help links', () => {
    const html = sanitize(renderMarkdown('[a](https://example.com) [b](help:keys) [c](#x)'));
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="help:keys"');
    expect(html).toContain('href="#x"');
  });
  it('escapes code block text and adds copy and insert buttons', () => {
    const html = renderMarkdown('```\n<b>&x</b>\n```');
    expect(html).toContain('&lt;b&gt;&amp;x&lt;/b&gt;');
    expect(html).toContain('data-act="copy"');
    expect(html).toContain('data-act="insert"');
  });
});
