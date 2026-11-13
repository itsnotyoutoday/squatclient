import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockEngine } from '../src/api/mock';
import {
  closeObject,
  dirtyAttrs,
  getBuffer,
  getObject,
  getWorkspace,
  newAttribute,
  openTarget,
  resolveConflict,
  revert,
  save,
  saveAll,
  selectAttr,
  setText,
  toggleMode,
  searchAll,
  isReadOnlyAttr,
  moveObject,
  refresh,
} from '../src/state/editorStore';
import { setupEditor } from './editor.helpers';

let engine: MockEngine;
let sid: string;
beforeEach(async () => {
  ({ engine, sid } = await setupEditor());
});
afterEach(() => engine.dispose());

describe('opening', () => {
  it('opens an object by dbref, loads attributes and selects the first', async () => {
    const r = await openTarget(sid, '#12');
    expect(r).toEqual({ ok: true, dbref: '#12' });
    const o = getObject(sid, '#12')!;
    expect(o.name).toBe('Command Console');
    expect(o.controls).toBe(true);
    expect(o.attrs.length).toBeGreaterThan(100);
    expect(o.activeAttr).toBe(o.attrs[0].name);
    expect(o.buffers[o.activeAttr!].loading).toBe(false);
    expect(getWorkspace(sid).activeObject).toBe('#12');
  });

  it('opens a named attribute and resolves me / names', async () => {
    await openTarget(sid, '#12', 'CMD_ENGAGE');
    expect(getObject(sid, '#12')!.activeAttr).toBe('CMD_ENGAGE');
    expect(getBuffer(sid, '#12', 'CMD_ENGAGE')!.original).toContain('$+engage');
    expect(await openTarget(sid, 'me')).toEqual({ ok: true, dbref: '#45' });
    expect(await openTarget(sid, 'Nav')).toEqual({ ok: true, dbref: '#13' });
    expect(getWorkspace(sid).objects.map((o) => o.dbref)).toEqual(['#12', '#45', '#13']);
  });

  it('reuses an existing tab', async () => {
    await openTarget(sid, '#12');
    await openTarget(sid, '#13');
    await openTarget(sid, '#12', 'POWER');
    expect(getWorkspace(sid).objects).toHaveLength(2);
    expect(getWorkspace(sid).activeObject).toBe('#12');
    expect(getObject(sid, '#12')!.activeAttr).toBe('POWER');
  });

  it('reports failures without opening a tab', async () => {
    const a = await openTarget(sid, '#999');
    expect(a).toMatchObject({ ok: false });
    expect((a as { error: string }).error).toMatch(/No such object/);
    const b = await openTarget(sid, 'Console');
    expect((b as { error: string }).error).toMatch(/More than one/);
    expect(getWorkspace(sid).objects).toHaveLength(0);
  });

  it('keeps a tab with an error and Retry for an object it cannot read', async () => {
    const r = await openTarget(sid, '#15');
    expect(r.ok).toBe(true);
    const o = getObject(sid, '#15')!;
    expect(o.error).toMatch(/not allowed/);
    expect(o.errorCode).toBe('permission');
  });

  it('never touches the terminal: nothing is sent as input', async () => {
    await openTarget(sid, '#12', 'DESCRIBE');
    setText(sid, '#12', 'DESCRIBE', 'x');
    await save(sid, '#12', 'DESCRIBE');
    expect(engine.sent).toEqual([]);
    const lines = await engine.scrollback(sid, { limit: 100 });
    expect(lines.some((l) => l.spans.some((s) => /SQUATCAP|DESCRIBE/.test(s.s)))).toBe(false);
  });
});

describe('permissions', () => {
  it('an object you do not control is read-only and never sends a save', async () => {
    await openTarget(sid, '#14', 'LOG');
    const o = getObject(sid, '#14')!;
    expect(o.controls).toBe(false);
    expect(isReadOnlyAttr(o, 'LOG')).toBe(true);
    setText(sid, '#14', 'LOG', 'changed');
    expect(await save(sid, '#14', 'LOG')).toBe('readonly');
    expect(engine.game.calls.some((c) => c.method === 'saveAttr')).toBe(false);
  });

  it('unknown control leaves it editable', async () => {
    await openTarget(sid, '#16', 'NOTE');
    expect(getObject(sid, '#16')!.controls).toBe('unknown');
    setText(sid, '#16', 'NOTE', 'mine now');
    expect(await save(sid, '#16', 'NOTE')).toBe('saved');
  });

  it('attribute flags that prove protection make it read-only', async () => {
    await openTarget(sid, '#12', 'LOCKED_ATTR');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const o = getObject(sid, '#12')!;
    expect(o.attrs.find((a) => a.name === 'LOCKED_ATTR')!.writable).toBe(false);
    expect(isReadOnlyAttr(o, 'LOCKED_ATTR')).toBe(true);
    expect(isReadOnlyAttr(o, 'POWER')).toBe(false);
  });

  it('an unreadable attribute shows a load error', async () => {
    await openTarget(sid, '#14', 'SECRET');
    expect(getBuffer(sid, '#14', 'SECRET')!.loadError).toMatch(/not allowed/);
  });
});

describe('saving', () => {
  it('saves, verifies and clears dirty', async () => {
    await openTarget(sid, '#12', 'POWER');
    setText(sid, '#12', 'POWER', '250');
    expect(getBuffer(sid, '#12', 'POWER')!.dirty).toBe(true);
    expect(await save(sid, '#12', 'POWER')).toBe('saved');
    const b = getBuffer(sid, '#12', 'POWER')!;
    expect(b).toMatchObject({ dirty: false, original: '250', saving: false });
    expect(b.notice?.kind).toBe('saved');
    expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('250');
  });

  it('sends the COLLAPSED form of expanded code, never the formatting newlines', async () => {
    await openTarget(sid, '#12', 'FN_CHECKPOWER');
    setText(sid, '#12', 'FN_CHECKPOWER', 'gte(\n  get(%!/POWER),\n  mul(%0,20)\n)');
    expect(getBuffer(sid, '#12', 'FN_CHECKPOWER')!.dirty).toBe(true);
    await save(sid, '#12', 'FN_CHECKPOWER');
    const sent = engine.game.calls.filter((c) => c.method === 'saveAttr').at(-1)!;
    expect(sent.args[2]).toBe('gte(get(%!/POWER),mul(%0,20))');
    expect(engine.game.objects.get('#12')!.attrs.FN_CHECKPOWER.value).toBe('gte(get(%!/POWER),mul(%0,20))');
  });

  it('expanding without other edits does not make the buffer dirty', async () => {
    await openTarget(sid, '#12', 'FN_CHECKPOWER');
    setText(sid, '#12', 'FN_CHECKPOWER', 'gte(\n  get(%!/POWER),\n  mul(%0,10)\n)');
    setText(sid, '#12', 'FN_CHECKPOWER', 'gte(get(%!/POWER),mul(%0,10))');
    expect(getBuffer(sid, '#12', 'FN_CHECKPOWER')!.dirty).toBe(false);
  });

  it('line-break view: newlines are %r and the toggle is lossless', async () => {
    await openTarget(sid, '#12', 'DESCRIBE');
    const b0 = getBuffer(sid, '#12', 'DESCRIBE')!;
    expect(b0.mode).toBe('code');
    toggleMode(sid, '#12', 'DESCRIBE');
    const b1 = getBuffer(sid, '#12', 'DESCRIBE')!;
    expect(b1.mode).toBe('lines');
    expect(b1.text).toBe('A bank of glowing panels.\nThe central display reads READY.');
    expect(b1.dirty).toBe(false);
    setText(sid, '#12', 'DESCRIBE', 'one\ntwo');
    expect(await save(sid, '#12', 'DESCRIBE')).toBe('saved');
    expect(engine.game.objects.get('#12')!.attrs.DESCRIBE.value).toBe('one%rtwo');
    toggleMode(sid, '#12', 'DESCRIBE');
    expect(getBuffer(sid, '#12', 'DESCRIBE')!.text).toBe('one%rtwo');
    expect(getBuffer(sid, '#12', 'DESCRIBE')!.dirty).toBe(false);
  });

  it('values the game stored with real newlines open in line-break view', async () => {
    engine.game.externalSet('#12', 'REAL', 'first\nsecond');
    await openTarget(sid, '#12', 'REAL');
    const b = getBuffer(sid, '#12', 'REAL')!;
    expect(b.mode).toBe('lines');
    expect(b.dirty).toBe(false);
  });

  it('a rejected save keeps the text, shows the exact reply and stays savable', async () => {
    await openTarget(sid, '#12', 'DATA_GEN_002');
    engine.game.objects.get('#12')!.attrs.DATA_GEN_002.readonly = true;
    setText(sid, '#12', 'DATA_GEN_002', 'precious work');
    expect(await save(sid, '#12', 'DATA_GEN_002')).toBe('rejected');
    const b = getBuffer(sid, '#12', 'DATA_GEN_002')!;
    expect(b.dirty).toBe(true);
    expect(b.text).toBe('precious work');
    expect(b.lastError).toBe('Permission denied.');
    expect(b.saving).toBe(false);
    engine.game.objects.get('#12')!.attrs.DATA_GEN_002.readonly = false;
    expect(await save(sid, '#12', 'DATA_GEN_002')).toBe('saved');
    expect(getBuffer(sid, '#12', 'DATA_GEN_002')!.lastError).toBeUndefined();
  });

  it('random rejections never lose text', async () => {
    await openTarget(sid, '#12', 'POWER');
    engine.game.rejectRate = 1;
    setText(sid, '#12', 'POWER', '777');
    for (let i = 0; i < 3; i++) expect(await save(sid, '#12', 'POWER')).toBe('rejected');
    expect(getBuffer(sid, '#12', 'POWER')!.text).toBe('777');
    expect(getBuffer(sid, '#12', 'POWER')!.dirty).toBe(true);
  });

  it('a mismatch warns, keeps the text dirty and adopts what the game stored', async () => {
    await openTarget(sid, '#12', 'POWER');
    engine.game.alterOnSave = (v) => v.toUpperCase();
    setText(sid, '#12', 'POWER', 'abc');
    expect(await save(sid, '#12', 'POWER')).toBe('mismatch');
    const b = getBuffer(sid, '#12', 'POWER')!;
    expect(b.dirty).toBe(true);
    expect(b.original).toBe('ABC');
    expect(b.lastCode).toBe('mismatch');
    expect(b.notice?.kind).toBe('mismatch');
  });

  it('timeouts and other failures keep the text', async () => {
    await openTarget(sid, '#12', 'POWER');
    engine.game.failNext.push({
      method: 'saveAttr',
      result: { code: 'timeout', error: 'engine: capture timed out' },
    });
    setText(sid, '#12', 'POWER', '5');
    expect(await save(sid, '#12', 'POWER')).toBe('error');
    expect(getBuffer(sid, '#12', 'POWER')!.dirty).toBe(true);
  });

  it('refuses a lone % before a newline without sending', async () => {
    await openTarget(sid, '#12', 'DESCRIBE');
    toggleMode(sid, '#12', 'DESCRIBE');
    setText(sid, '#12', 'DESCRIBE', '100%\nx');
    expect(await save(sid, '#12', 'DESCRIBE')).toBe('error');
    expect(getBuffer(sid, '#12', 'DESCRIBE')!.lastCode).toBe('unsafe_value');
    expect(engine.game.calls.some((c) => c.method === 'saveAttr')).toBe(false);
  });

  it('ignores a second save while one is running', async () => {
    await openTarget(sid, '#12', 'POWER');
    engine.game.latencyMs = 5;
    setText(sid, '#12', 'POWER', '9');
    const [a, b] = await Promise.all([save(sid, '#12', 'POWER'), save(sid, '#12', 'POWER')]);
    expect([a, b].sort()).toEqual(['nothing', 'saved']);
  });

  it('creates a new attribute with the first save', async () => {
    await openTarget(sid, '#12');
    expect(newAttribute(sid, '#12', 'bad name')).toMatchObject({ ok: false });
    expect(newAttribute(sid, '#12', 'my_new')).toEqual({ ok: true, attr: 'MY_NEW' });
    expect(getObject(sid, '#12')!.attrs.find((a) => a.name === 'MY_NEW')!.isNew).toBe(true);
    setText(sid, '#12', 'MY_NEW', 'hello');
    expect(await save(sid, '#12', 'MY_NEW')).toBe('saved');
    expect(engine.game.objects.get('#12')!.attrs.MY_NEW.value).toBe('hello');
    expect(getObject(sid, '#12')!.attrs.find((a) => a.name === 'MY_NEW')!.isNew).toBe(false);
  });

  it('saveAll saves every dirty attribute of the object', async () => {
    await openTarget(sid, '#12', 'POWER');
    await selectAttr(sid, '#12', 'DO_ENGAGE');
    setText(sid, '#12', 'POWER', '1');
    setText(sid, '#12', 'DO_ENGAGE', '@pemit %#=hi');
    expect(dirtyAttrs(getObject(sid, '#12')!).sort()).toEqual(['DO_ENGAGE', 'POWER']);
    expect(await saveAll(sid, '#12')).toEqual({ DO_ENGAGE: 'saved', POWER: 'saved' });
    expect(dirtyAttrs(getObject(sid, '#12')!)).toEqual([]);
  });
});

describe('conflicts', () => {
  async function conflicted(): Promise<void> {
    await openTarget(sid, '#12', 'POWER');
    setText(sid, '#12', 'POWER', 'mine');
    engine.game.externalSet('#12', 'POWER', 'theirs');
    expect(await save(sid, '#12', 'POWER')).toBe('conflict');
  }

  it('detects a concurrent change before saving and sends nothing', async () => {
    await conflicted();
    const b = getBuffer(sid, '#12', 'POWER')!;
    expect(b.conflict).toEqual({ theirs: 'theirs', theirsExists: true });
    expect(b.dirty).toBe(true);
    expect(engine.game.calls.some((c) => c.method === 'saveAttr')).toBe(false);
  });

  it('overwrite saves my text', async () => {
    await conflicted();
    expect(await resolveConflict(sid, '#12', 'POWER', 'overwrite')).toBe('saved');
    expect(engine.game.objects.get('#12')!.attrs.POWER.value).toBe('mine');
    expect(getBuffer(sid, '#12', 'POWER')!.conflict).toBeUndefined();
  });

  it('reload theirs discards my text', async () => {
    await conflicted();
    await resolveConflict(sid, '#12', 'POWER', 'reload');
    const b = getBuffer(sid, '#12', 'POWER')!;
    expect(b).toMatchObject({ text: 'theirs', original: 'theirs', dirty: false });
    expect(b.notice?.kind).toBe('reloaded');
  });

  it('keep editing keeps my text and the next save does not ask again', async () => {
    await conflicted();
    await resolveConflict(sid, '#12', 'POWER', 'keep');
    const b = getBuffer(sid, '#12', 'POWER')!;
    expect(b).toMatchObject({ text: 'mine', original: 'theirs', dirty: true });
    expect(await save(sid, '#12', 'POWER')).toBe('saved');
  });

  it('the RACE attribute changes on every read (concurrent-change mode)', async () => {
    await openTarget(sid, '#12', 'RACE');
    setText(sid, '#12', 'RACE', 'x');
    expect(await save(sid, '#12', 'RACE')).toBe('conflict');
  });

  it('notices an attribute deleted or created meanwhile', async () => {
    await openTarget(sid, '#12');
    newAttribute(sid, '#12', 'RACE_NEW');
    setText(sid, '#12', 'RACE_NEW', 'mine');
    engine.game.externalSet('#12', 'RACE_NEW', 'theirs');
    expect(await save(sid, '#12', 'RACE_NEW')).toBe('conflict');
  });
});

describe('buffers and tabs', () => {
  it('switching attributes keeps unsaved text', async () => {
    await openTarget(sid, '#12', 'POWER');
    setText(sid, '#12', 'POWER', 'draft');
    await selectAttr(sid, '#12', 'DESCRIBE');
    await selectAttr(sid, '#12', 'POWER');
    expect(getBuffer(sid, '#12', 'POWER')).toMatchObject({ text: 'draft', dirty: true });
  });

  it('revert restores the stored text', async () => {
    await openTarget(sid, '#12', 'POWER');
    setText(sid, '#12', 'POWER', 'draft');
    revert(sid, '#12', 'POWER');
    expect(getBuffer(sid, '#12', 'POWER')).toMatchObject({ text: '100', dirty: false });
  });

  it('closing a dirty tab needs confirmation; discard closes it', async () => {
    await openTarget(sid, '#12', 'POWER');
    await openTarget(sid, '#13');
    setText(sid, '#12', 'POWER', 'draft');
    expect(closeObject(sid, '#12')).toEqual({ closed: false, dirty: ['POWER'] });
    expect(closeObject(sid, '#12', true).closed).toBe(true);
    expect(getWorkspace(sid).objects.map((o) => o.dbref)).toEqual(['#13']);
    expect(getWorkspace(sid).activeObject).toBe('#13');
    expect(closeObject(sid, '#13').closed).toBe(true);
    expect(getWorkspace(sid).activeObject).toBeNull();
  });

  it('reorders tabs', async () => {
    await openTarget(sid, '#12');
    await openTarget(sid, '#13');
    await openTarget(sid, '#45');
    moveObject(sid, 2, 0);
    expect(getWorkspace(sid).objects.map((o) => o.dbref)).toEqual(['#45', '#12', '#13']);
  });

  it('refresh reloads clean buffers and leaves dirty ones', async () => {
    await openTarget(sid, '#12', 'POWER');
    await selectAttr(sid, '#12', 'NOTES');
    setText(sid, '#12', 'NOTES', 'draft');
    engine.game.externalSet('#12', 'POWER', '5');
    engine.game.externalSet('#12', 'NEWONE', 'x');
    await refresh(sid, '#12');
    expect(getBuffer(sid, '#12', 'POWER')!.text).toBe('5');
    expect(getBuffer(sid, '#12', 'NOTES')!.text).toBe('draft');
    expect(getObject(sid, '#12')!.attrs.some((a) => a.name === 'NEWONE')).toBe(true);
  });
});

describe('search across attributes', () => {
  it('fetches lazily, caches and lists hits', async () => {
    await openTarget(sid, '#13');
    await searchAll(sid, '#13', 'star');
    const s = getObject(sid, '#13')!.search!;
    expect(s.running).toBe(false);
    expect(s.hits.map((h) => h.attr)).toEqual(['DESCRIBE']);
    const fetches = engine.game.calls.filter((c) => c.method === 'fetchAttr').length;
    await searchAll(sid, '#13', 'rand');
    expect(engine.game.calls.filter((c) => c.method === 'fetchAttr').length).toBe(fetches); // cached
    expect(getObject(sid, '#13')!.search!.hits.map((h) => h.attr)).toEqual(['FN_ROUTE']);
  });

  it('shows %r values line by line', async () => {
    await openTarget(sid, '#12');
    await searchAll(sid, '#12', 'READY');
    expect(getObject(sid, '#12')!.search!.hits[0]).toMatchObject({ attr: 'DESCRIBE', line: 2 });
  });
});
