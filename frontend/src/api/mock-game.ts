import { compressEscapes, expandEscapes, AmbiguousEscapeError } from '../lib/editor/escapes';
import type {
  EditAttrInfoResult,
  EditAttrResult,
  EditCode,
  EditControlsResult,
  EditObjectResult,
  EditResolveResult,
  EditResult,
  Tri,
} from './types';

/**
 * A fake MUSH for the editor workspace: objects with many attributes (some with %r multi-line values),
 * attributes you cannot write, objects you do not control, slow responses, random rejections and a
 * concurrent-change mode for conflict testing. It speaks the Edit* API of docs/EDIT.md and never touches
 * the terminal output, exactly like the real engine path.
 */

export interface MockAttr {
  /** raw stored text (literal %r) */
  value: string;
  /** attribute flag names (`locked`, `safe`, `visual`...) */
  flags?: string[];
  /** the game refuses writes (independent of the flags) */
  readonly?: boolean;
  /** reads fail with a permission error */
  hidden?: boolean;
}

export interface MockObject {
  dbref: string;
  name: string;
  type: string;
  owner: string;
  flags: string;
  location: string;
  /** what controls(me, obj) answers: 'unknown' = the game cannot say */
  controls: Tri;
  attrs: Record<string, MockAttr>;
  /** answering takes this many extra ms */
  slowMs?: number;
  /** the object cannot be examined at all */
  invisible?: boolean;
}

export interface MockCall {
  method: string;
  args: unknown[];
}

const err = <R extends object>(code: EditCode, error: string, rest: R): R & EditResult => ({
  ...rest,
  ok: false,
  code,
  error,
});

const ok = <R extends object>(rest: R): R & EditResult => ({ ...rest, ok: true });

const FN_TEXT = ['if(gt(%0,0),', '  [u(me/FN_HELPER,%0)],', '  [iter(lnum(5),mul(##,2))]', ')'].join('\n');

export function defaultObjects(manyAttrs = 120): MockObject[] {
  const consoleAttrs: Record<string, MockAttr> = {
    DESCRIBE: { value: 'A bank of glowing panels.%rThe central display reads READY.' },
    CMD_ENGAGE: {
      value:
        '$+engage *:@switch u(#12/FN_CHECKPOWER,%0)=1,{@pemit %#=Engaging %0.;@trigger me/DO_ENGAGE=%0},{@pemit %#=Insufficient power.}',
    },
    FN_CHECKPOWER: { value: 'gte(get(%!/POWER),mul(%0,10))' },
    FN_HELPER: { value: FN_TEXT.replace(/\n\s*/g, '') },
    DO_ENGAGE: { value: '@pemit %#=[ansi(hg,Engaged.)]%r[name(%#)] pushes the button.' },
    POWER: { value: '100' },
    NOTES: { value: 'Remember to ask the Captain about #14/LOG.%rAlso see get(#13/DESCRIBE).' },
    SEE_ALSO: { value: '[u(#13/FN_ROUTE,%0)] [xget(#14,LOG)] [v(POWER)] [u(FN_HELPER,1)]' },
    LOCKED_ATTR: { value: 'Set by a wizard.', flags: ['locked', 'wizard'], readonly: true },
    SAFE_ATTR: { value: 'protected', flags: ['safe'] },
    RACE: { value: 'tick 1' },
  };
  for (let i = 1; i <= manyAttrs; i++) {
    const n = String(i).padStart(3, '0');
    consoleAttrs[`${i % 3 === 0 ? 'FN' : i % 3 === 1 ? 'CMD' : 'DATA'}_GEN_${n}`] = {
      value: i % 7 === 0 ? `line a ${i}%rline b ${i}%tindented` : `add(${i},mul(2,%0))`,
    };
  }
  return [
    {
      dbref: '#10',
      name: 'Lobby',
      type: 'ROOM',
      owner: '#1',
      flags: 'R',
      location: '',
      controls: 'false',
      attrs: { DESCRIBE: { value: 'The lobby.' } },
    },
    {
      dbref: '#1',
      name: 'Wizard',
      type: 'PLAYER',
      owner: '#1',
      flags: 'WP',
      location: '#10',
      controls: 'false',
      attrs: {},
    },
    {
      dbref: '#45',
      name: 'Nveid',
      type: 'PLAYER',
      owner: '#45',
      flags: 'P',
      location: '#10',
      controls: 'true',
      attrs: { PREFS: { value: 'none' } },
    },
    {
      dbref: '#12',
      name: 'Command Console',
      type: 'THING',
      owner: '#45',
      flags: 'D',
      location: '#10',
      controls: 'true',
      attrs: consoleAttrs,
    },
    {
      dbref: '#13',
      name: 'Nav Console',
      type: 'THING',
      owner: '#45',
      flags: 'D',
      location: '#10',
      controls: 'true',
      attrs: {
        DESCRIBE: { value: 'A star chart glows.' },
        FN_ROUTE: { value: 'cat(%0,->,[rand(10)])' },
        FN_SLOW: { value: 'slow to load', flags: [] },
        PROTECTED: { value: 'wizard only', flags: ['wizard', 'locked'], readonly: true },
      },
      slowMs: 0,
    },
    {
      dbref: '#14',
      name: "Captain's Log",
      type: 'THING',
      owner: '#7',
      flags: '',
      location: '#10',
      controls: 'false',
      attrs: { LOG: { value: 'Stardate 1.%rAll quiet.' }, SECRET: { value: 'hidden', hidden: true } },
    },
    {
      dbref: '#16',
      name: 'Mystery Box',
      type: 'THING',
      owner: '#9',
      flags: '',
      location: '#10',
      controls: 'unknown',
      attrs: { NOTE: { value: 'maybe yours' } },
    },
    {
      dbref: '#15',
      name: 'Sealed Vault',
      type: 'THING',
      owner: '#1',
      flags: 'W',
      location: '#10',
      controls: 'false',
      attrs: {},
      invisible: true,
    },
  ];
}

export class MockGame {
  objects = new Map<string, MockObject>();
  /** the connected character, `me`, and the room, `here` */
  me = '#45';
  here = '#10';
  /** milliseconds every call takes (0 = resolve immediately) */
  latencyMs = 0;
  /** probability that a save is rejected with "Permission denied." (0..1) */
  rejectRate = 0;
  rng: () => number = Math.random;
  /** results returned (once each, first match wins) instead of running the call */
  failNext: { method?: string; result: Partial<EditResult> & { code: EditCode } }[] = [];
  /** alter every saved value like a server that rewrites input (produces a mismatch) */
  alterOnSave?: (value: string) => string;
  /** every Edit* call, for assertions */
  calls: MockCall[] = [];
  /** attribute fetch counters (RACE returns a fresh value on every fetch: a concurrent change) */
  private raceTick = 0;

  constructor(manyAttrs = 120) {
    for (const o of defaultObjects(manyAttrs)) this.objects.set(o.dbref, o);
  }

  /** Change a value behind the editor's back (another player, a trigger). */
  externalSet(dbref: string, attr: string, value: string): void {
    const o = this.objects.get(dbref);
    if (!o) throw new Error(`no such object ${dbref}`);
    o.attrs[attr.toUpperCase()] = { ...(o.attrs[attr.toUpperCase()] ?? {}), value };
  }

  private async enter(method: string, args: unknown[], extraMs = 0): Promise<void> {
    this.calls.push({ method, args });
    const ms = this.latencyMs + extraMs;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private forced(method: string): (Partial<EditResult> & { code: EditCode }) | undefined {
    const i = this.failNext.findIndex((f) => !f.method || f.method === method);
    return i < 0 ? undefined : this.failNext.splice(i, 1)[0].result;
  }

  private find(dbref: string): MockObject | undefined {
    return this.objects.get(dbref);
  }

  async resolve(target: string): Promise<EditResolveResult> {
    await this.enter('resolve', [target]);
    const f = this.forced('resolve');
    if (f) return err(f.code, f.error ?? 'error', { dbref: '', name: '' });
    const t = target.trim();
    let o: MockObject | undefined;
    if (/^#-?\d+$/.test(t)) o = this.find(t);
    else if (t.toLowerCase() === 'me') o = this.find(this.me);
    else if (t.toLowerCase() === 'here') o = this.find(this.here);
    else {
      const q = t.toLowerCase().replace(/^\*/, '');
      const hits = [...this.objects.values()].filter(
        (x) => !x.invisible && x.name.toLowerCase().startsWith(q),
      );
      const exact = hits.filter((x) => x.name.toLowerCase() === q);
      const pick = exact.length === 1 ? exact : hits;
      if (pick.length > 1)
        return err('ambiguous', `engine: more than one object matches: ${target}`, { dbref: '', name: '' });
      o = pick[0];
    }
    if (!o) return err('no_such_object', `engine: no such object: ${target}`, { dbref: '', name: '' });
    return ok({ dbref: o.dbref, name: o.name });
  }

  async fetchObject(dbref: string): Promise<EditObjectResult> {
    const empty = { dbref, name: '', type: '', owner: '', flags: '', location: '', attrs: [] };
    const o0 = this.find(dbref);
    await this.enter('fetchObject', [dbref], o0?.slowMs);
    const f = this.forced('fetchObject');
    if (f) return err(f.code, f.error ?? 'error', empty);
    const o = this.find(dbref);
    if (!o) return err('no_such_object', 'engine: no such object: #-1 NO MATCH', empty);
    if (o.invisible) return err('permission', 'engine: permission denied: #-1 PERMISSION DENIED', empty);
    return ok({
      dbref: o.dbref,
      name: o.name,
      type: o.type,
      owner: o.owner,
      flags: o.flags,
      location: o.location,
      attrs: Object.keys(o.attrs)
        .sort()
        .map((name) => ({ name })),
    });
  }

  async fetchAttr(dbref: string, attr: string): Promise<EditAttrResult> {
    const empty = { dbref, name: attr, exists: false, value: '', editable: '' };
    const o0 = this.find(dbref);
    await this.enter('fetchAttr', [dbref, attr], o0?.slowMs);
    const f = this.forced('fetchAttr');
    if (f) return err(f.code, f.error ?? 'error', empty);
    const o = this.find(dbref);
    if (!o) return err('no_such_object', 'engine: no such object: #-1 NO MATCH', empty);
    const name = attr.toUpperCase();
    if (dbref === '#12' && name === 'RACE') o.attrs.RACE = { value: `tick ${++this.raceTick}` };
    const a = o.attrs[name];
    if (!a) return ok(empty);
    if (a.hidden) return err('permission', 'engine: permission denied: #-1 PERMISSION DENIED', empty);
    return ok({ dbref, name, exists: true, value: a.value, editable: expandEscapes(a.value) });
  }

  async saveAttr(dbref: string, attr: string, value: string): Promise<EditResult> {
    await this.enter('saveAttr', [dbref, attr, value]);
    const f = this.forced('saveAttr');
    if (f) return { ok: false, ...f };
    const o = this.find(dbref);
    if (!o) return err('no_such_object', "engine: no such object: I don't see that here.", {});
    let packed: string;
    try {
      packed = compressEscapes(value);
    } catch (e) {
      if (e instanceof AmbiguousEscapeError) return err('unsafe_value', `engine: ${e.message}`, {});
      throw e;
    }
    const name = attr.toUpperCase();
    const a = o.attrs[name];
    const denied = o.controls === 'false' || a?.readonly || this.rng() < this.rejectRate;
    if (denied) return err('rejected', 'engine: the game rejected the attribute: Permission denied.', {});
    const stored = this.alterOnSave ? this.alterOnSave(packed) : packed;
    if (stored === '') delete o.attrs[name];
    else o.attrs[name] = { ...(a ?? {}), value: stored };
    if (stored !== packed) {
      return err(
        'mismatch',
        `engine: the game stored a different value: sent "${packed}", game has "${stored}"`,
        {},
      );
    }
    return ok({});
  }

  async controls(dbref: string): Promise<EditControlsResult> {
    await this.enter('controls', [dbref]);
    const f = this.forced('controls');
    if (f) return err(f.code, f.error ?? 'error', { controls: 'unknown' as Tri });
    const o = this.find(dbref);
    return ok({ controls: o ? o.controls : ('unknown' as Tri) });
  }

  async attrInfo(dbref: string, attr: string): Promise<EditAttrInfoResult> {
    await this.enter('attrInfo', [dbref, attr]);
    const f = this.forced('attrInfo');
    if (f)
      return err(f.code, f.error ?? 'error', {
        known: false,
        flags: '',
        flagNames: '',
        owner: '',
        writable: 'unknown' as Tri,
      });
    const o = this.find(dbref);
    const a = o?.attrs[attr.toUpperCase()];
    if (!o || !a)
      return ok({ known: false, flags: '', flagNames: '', owner: '', writable: 'unknown' as Tri });
    const names = a.flags ?? [];
    return ok({
      known: true,
      flags: names.map((n) => n[0].toUpperCase()).join(''),
      flagNames: names.join(' '),
      owner: o.owner,
      writable: (names.includes('locked') || names.includes('safe') ? 'false' : 'unknown') as Tri,
    });
  }
}
