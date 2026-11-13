import { describe, expect, it } from 'vitest';
import { getTopic } from '../src/help/data';
import { resolveQuery } from '../src/help/lookup';

describe('editor help', () => {
  it('has the editing topic, reachable as /help edit and /help /edit', () => {
    expect(getTopic('editing')).toBeDefined();
    for (const q of ['edit', '/edit', 'editor view', 'Editing objects and attributes']) {
      const r = resolveQuery(q);
      expect(r.kind === 'topic' ? r.id : r.kind, q).toBe('editing');
    }
  });
  it('documents entry points, permissions, saving and keys', () => {
    const body = getTopic('editing')!.body;
    for (const s of [
      '/edit #12/CMD_ENGAGE',
      'Cmd-E',
      'Overwrite',
      'Reload theirs',
      'Keep editing',
      'read-only',
      'Cmd-P',
      'F12',
      'Cmd-Shift-F',
    ]) {
      expect(body, s).toContain(s);
    }
  });
  it('is linked from the keys and commands pages', () => {
    expect(getTopic('keys')!.body).toContain('help:editing');
    expect(getTopic('keys')!.headings.some((h) => h.id === 'the-editor-view')).toBe(true);
    expect(getTopic('commands')!.body).toContain('`/edit`');
  });
});
