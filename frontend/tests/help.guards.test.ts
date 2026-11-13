import { describe, expect, it } from 'vitest';
import { TOPICS, getTopic } from '../src/help/data';
import { checkTopics } from '../src/help/build/guards.mjs';

const topic = (body: string, extra: Partial<{ id: string; title: string }> = {}) => ({
  id: 'x',
  title: 'X',
  body,
  headings: [{ id: 'sec' }],
  ...extra,
});

describe('help content guards (self-contained user guide)', () => {
  it('passes for every shipped topic, authored and imported', () => {
    expect(checkTopics(TOPICS)).toEqual([]);
  });

  it('has the expected new pages and a clickable compatibility page title', () => {
    for (const id of ['glossary', 'troubleshooting', 'whats-new']) expect(getTopic(id), id).toBeDefined();
    expect(getTopic('compat')?.title).toBe('TinyFugue Script Compatibility');
    // the scripting intro links to it
    expect(getTopic('scripting')?.body).toContain('(help:compat)');
    expect(getTopic('scripting/reference-overview')?.body).toContain(
      '[TinyFugue Script Compatibility](help:compat)',
    );
  });

  it('rejects references to files, folders and documents outside the help', () => {
    for (const bad of [
      'see docs/TF-COMPAT.md',
      'in pkg/tf there',
      'internal/engine',
      'frontend/src',
      'open main.go',
      'edit App.tsx',
      'edit store.ts',
      'read TF-COMPAT.md',
      'read TF-LANGUAGE.md',
      'read LUA-API.md',
      'see STRUCTURE.md',
      'see PROTOCOL.md',
      'see EDIT.md',
      'see EDITOR.md',
      'see the README',
      'it is not bug-for-bug compatible',
      'this is Not Implemented',
      'a clean-room rewrite',
      'checked against the oracle',
    ]) {
      expect(checkTopics([topic(bad)]), bad).not.toEqual([]);
    }
  });

  it('allows ordinary words, Cmd/Ctrl and web addresses', () => {
    expect(
      checkTopics([
        topic('Press Cmd/Ctrl-Enter. See <https://github.com/a/b/docs/x.md> or [x](https://e.com/pkg/y.go).'),
      ]),
    ).toEqual([]);
  });

  it('rejects help links to missing topics or sections, and other link kinds', () => {
    const a = topic('[ok](help:x#sec) [self](#sec)');
    expect(checkTopics([a])).toEqual([]);
    expect(checkTopics([topic('[no](help:nope)')])).toHaveLength(1);
    expect(checkTopics([topic('[no](help:x#nope)')])).toHaveLength(1);
    expect(checkTopics([topic('[no](#nope)')])).toHaveLength(1);
    expect(checkTopics([topic('[f](file:///etc/passwd)')])).toHaveLength(1);
  });

  it('rejects a topic without a title', () => {
    expect(checkTopics([topic('fine', { title: '' })])).toHaveLength(1);
    expect(checkTopics([topic('fine', { title: '  ' })])).toHaveLength(1);
  });
});
