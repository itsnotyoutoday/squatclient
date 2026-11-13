import { beforeEach, describe, expect, it } from 'vitest';
import { currentView, lastTopicId, resetHelp, useHelp } from '../src/help/store';

const topic = (id: string) => ({ kind: 'topic' as const, id });

beforeEach(resetHelp);

describe('help history', () => {
  it('goes back and forward and truncates forward history on a new visit', () => {
    const h = useHelp.getState();
    h.go(topic('keys'));
    h.go(topic('about'));
    expect(lastTopicId(useHelp.getState())).toBe('about');
    useHelp.getState().back();
    expect(lastTopicId(useHelp.getState())).toBe('keys');
    useHelp.getState().forward();
    expect(lastTopicId(useHelp.getState())).toBe('about');
    useHelp.getState().back();
    useHelp.getState().back();
    expect(lastTopicId(useHelp.getState())).toBe('home');
    useHelp.getState().back(); // already at the start
    expect(useHelp.getState().pos).toBe(0);
    useHelp.getState().go(topic('lua'));
    expect(useHelp.getState().stack.map((v) => (v.kind === 'topic' ? v.id : '?'))).toEqual(['home', 'lua']);
    useHelp.getState().forward();
    expect(lastTopicId(useHelp.getState())).toBe('lua');
  });

  it('does not push duplicates', () => {
    useHelp.getState().go(topic('keys'));
    useHelp.getState().go(topic('keys'));
    expect(useHelp.getState().stack).toHaveLength(2);
  });

  it('keeps one search entry while typing and drops it when cleared', () => {
    useHelp.getState().go(topic('keys'));
    useHelp.getState().setSearch('a');
    useHelp.getState().setSearch('ab');
    expect(useHelp.getState().stack).toHaveLength(3);
    expect(currentView(useHelp.getState())).toEqual({ kind: 'search', query: 'ab' });
    useHelp.getState().setSearch('');
    expect(currentView(useHelp.getState())).toEqual(topic('keys'));
    expect(useHelp.getState().stack).toHaveLength(2);
  });

  it('a result opened from a search can go back to the results', () => {
    useHelp.getState().setSearch('def');
    useHelp.getState().go(topic('scripting/macros-def'));
    useHelp.getState().back();
    expect(currentView(useHelp.getState())).toEqual({ kind: 'search', query: 'def' });
  });

  it('hands over a pending request once', () => {
    useHelp.getState().request('def');
    expect(useHelp.getState().takePending()).toBe('def');
    expect(useHelp.getState().takePending()).toBeNull();
  });
});
