import { describe, expect, it } from 'vitest';
import { OBJECT_EDITOR, hasModule } from '../src/lib/modules';
import { pickEditorSession } from '../src/lib/editor/view';
import type { SessionInfo } from '../src/api/types';

const sess = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  name: id,
  host: 'h',
  port: 1,
  tls: false,
  state: 'connected',
  startedAt: 0,
  firstSeq: 0,
  lastSeq: 0,
  unread: 0,
  attached: 1,
  remoteEcho: false,
  via: 'direct',
  ...over,
});

describe('game modules', () => {
  it('the Object Editor module is for the MU* family only', () => {
    expect(hasModule(OBJECT_EDITOR, sess('a', { gameType: 'cobramush', gameFamily: 'mush' }))).toBe(true);
    expect(hasModule(OBJECT_EDITOR, sess('a', { gameType: 'other' }))).toBe(false);
    expect(hasModule(OBJECT_EDITOR, sess('a'))).toBe(false); // not detected yet
    expect(hasModule(OBJECT_EDITOR, undefined)).toBe(false);
  });

  it('the editor works on a MU* world, never on another kind of game', () => {
    const sessions = {
      mud: sess('mud', { gameType: 'other' }),
      pm: sess('pm', { gameType: 'pennmush', gameFamily: 'mush' }),
    };
    expect(pickEditorSession({ fg: 'mud', order: ['mud', 'pm'], sessions })).toBe('pm');
    expect(pickEditorSession({ fg: 'mud', order: ['mud'], sessions: { mud: sessions.mud } })).toBeNull();
    expect(
      pickEditorSession({ fg: 'pm', order: ['pm'], sessions: { pm: { ...sessions.pm, state: 'ended' } } }),
    ).toBeNull();
  });
});
