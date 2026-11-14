import { beforeEach, describe, expect, it } from 'vitest';
import { resolveGmcp, parseBinding, toNumber } from '../src/layout/paths';
import { resetLayoutData, useLayoutData } from '../src/layout/store';
import evenniaSession from './fixtures/evennia-session.jsonl?raw';

const S = 's1';
const ingest = (pkg: string, data: unknown): void => useLayoutData.getState().ingestGmcp(S, pkg, data);
const gmcp = (path: string): unknown => resolveGmcp(useLayoutData.getState().sessions[S]?.gmcp, path);

beforeEach(resetLayoutData);

describe('GMCP paths', () => {
  it('finds values by package + key, whatever the case of the package', () => {
    ingest('Char.Vitals', { hp: 80, maxhp: 100 });
    expect(gmcp('Char.Vitals.hp')).toBe(80);
    expect(gmcp('char.vitals.maxhp')).toBe(100);
    expect(gmcp('CHAR.VITALS')).toEqual({ hp: 80, maxhp: 100 });
    expect(gmcp('Char.Vitals.nope')).toBeUndefined();
    expect(gmcp('Room.Info.name')).toBeUndefined();
  });
  it('prefers the longest package name and walks into objects and arrays', () => {
    ingest('Room.Info', { name: 'Hall', exits: { n: 4 } });
    ingest('Room', { info: 'shadowed' });
    ingest('Group', { members: [{ name: 'a' }, { name: 'b' }] });
    expect(gmcp('Room.Info.exits.n')).toBe(4);
    expect(gmcp('Group.members.1.name')).toBe('b');
  });
  it('turns numbers and numeric strings into numbers', () => {
    expect(toNumber('4500')).toBe(4500);
    expect(toNumber(12)).toBe(12);
    expect(toNumber('x')).toBeUndefined();
    expect(toNumber('')).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
  });
  it('parses bindings', () => {
    expect(parseBinding('gmcp:Char.Vitals.hp')).toEqual({ kind: 'gmcp', path: 'Char.Vitals.hp' });
    expect(parseBinding('msdp:HEALTH')).toEqual({ kind: 'msdp', path: 'HEALTH' });
    expect(parseBinding('var:hp')).toEqual({ kind: 'var', path: 'hp' });
    expect(parseBinding(5)).toEqual({ kind: 'literal', value: 5 });
    expect(parseBinding('plain text')).toEqual({ kind: 'literal', value: 'plain text' });
  });
});

describe('the data store', () => {
  it('merges partial Char.Status / Char.Vitals updates and replaces other packages', () => {
    ingest('Char.Status', { level: 5, guild: 'Mages' });
    ingest('Char.Status', { level: 6 });
    expect(gmcp('Char.Status')).toEqual({ level: 6, guild: 'Mages' });
    ingest('Room.Info', { name: 'A', desc: 'x' });
    ingest('Room.Info', { name: 'B' });
    expect(gmcp('Room.Info')).toEqual({ name: 'B' });
  });
  it('keeps the first spelling of a package name', () => {
    ingest('char.vitals', { hp: 1 });
    ingest('Char.Vitals', { hp: 2 });
    const e = useLayoutData.getState().sessions[S].gmcp['char.vitals'];
    expect(e.name).toBe('char.vitals');
    expect(e.data).toEqual({ hp: 2 });
  });
  it('maintains the item lists from Char.Items.*', () => {
    ingest('Char.Items.List', {
      location: 'inv',
      items: [
        { id: 1, name: 'sword' },
        { id: 2, name: 'shield' },
      ],
    });
    ingest('Char.Items.Add', { location: 'inv', item: { id: 3, name: 'apple' } });
    ingest('Char.Items.Update', { location: 'inv', item: { id: 1, name: 'rusty sword' } });
    ingest('Char.Items.Remove', { location: 'inv', item: 2 });
    ingest('Char.Items.List', { location: 'room', items: [{ id: 9, name: 'door' }] });
    const it = useLayoutData.getState().sessions[S].items;
    expect(it.inv.map((x) => x.name)).toEqual(['rusty sword', 'apple']);
    expect(it.room.map((x) => x.name)).toEqual(['door']);
  });
  it('collects channel chat from Comm.Channel.Text and Aardwolf comm.channel', () => {
    ingest('Comm.Channel.Text', { channel: 'say', talker: 'Bob', text: 'hi' });
    ingest('comm.channel', { chan: 'gossip', player: 'Al', msg: 'hello' });
    ingest('Comm.Channel.Text', { channel: 'say' }); // no text: ignored
    const chat = useLayoutData.getState().sessions[S].chat;
    expect(chat.map((m) => `${m.channel}/${m.talker}/${m.text}`)).toEqual(['say/Bob/hi', 'gossip/Al/hello']);
  });
  it('keeps only the newest 500 chat messages', () => {
    for (let i = 0; i < 520; i++) ingest('Comm.Channel.Text', { channel: 'c', talker: 't', text: String(i) });
    const chat = useLayoutData.getState().sessions[S].chat;
    expect(chat).toHaveLength(500);
    expect(chat[0].text).toBe('20');
  });
  it('replaces everything on a snapshot, and merges MSDP changes', () => {
    ingest('Char.Vitals', { hp: 1 });
    useLayoutData.getState().ingestMsdp(S, { HEALTH: 5 });
    useLayoutData.getState().ingestMsdp(S, { MANA: 7 });
    expect(useLayoutData.getState().sessions[S].msdp).toEqual({ HEALTH: 5, MANA: 7 });
    useLayoutData.getState().ingestSnapshot(S, { 'Room.Info': { name: 'Z' } }, { LEVEL: 3 });
    expect(gmcp('Char.Vitals')).toBeUndefined();
    expect(gmcp('Room.Info.name')).toBe('Z');
    expect(useLayoutData.getState().sessions[S].msdp).toEqual({ LEVEL: 3 });
  });
  it('keeps script variables per scope', () => {
    const st = useLayoutData.getState();
    st.setVar('w1', 'hp', 10);
    st.setVars('w1', { mp: 3 });
    st.setVar('w2', 'hp', 99);
    expect(useLayoutData.getState().vars).toEqual({ w1: { hp: 10, mp: 3 }, w2: { hp: 99 } });
    useLayoutData.getState().setVar('w1', 'hp', undefined);
    expect(useLayoutData.getState().vars.w1).toEqual({ mp: 3 });
  });
});

// the real thing: what an Evennia game with the GMCP bridge sent (tests/fixtures/evennia-session.jsonl)
describe('a recorded Evennia session', () => {
  it('builds the state a layout needs', () => {
    const lines = evenniaSession.trim().split('\n');
    for (const l of lines) {
      const e = JSON.parse(l) as { kind: string; package?: string; data?: unknown };
      if (e.kind === 'gmcp' && e.package) ingest(e.package, e.data);
    }
    const hp = toNumber(gmcp('Char.Vitals.hp'));
    expect(hp).toBeGreaterThan(0);
    expect(toNumber(gmcp('Char.Vitals.maxhp'))).toBe(100);
    expect(gmcp('Char.Status.class')).toBe('Wanderer');
    expect(typeof gmcp('Room.Info.name')).toBe('string');
    expect(useLayoutData.getState().sessions[S].chat.some((m) => m.text === 'anyone here?')).toBe(true);
    expect(useLayoutData.getState().sessions[S].items.inv?.length).toBeGreaterThanOrEqual(0);
  });
});
