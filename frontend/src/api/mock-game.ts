import { compressEscapes, expandEscapes, AmbiguousEscapeError } from '../lib/editor/escapes';
import type {
  EditAttrFlagResult,
  EditAttrInfoResult,
  EditAttrResult,
  EditCatalogItem,
  EditCatalogResult,
  EditCode,
  EditControlsResult,
  EditDetails,
  EditDetailsResult,
  EditNearbyResult,
  EditObjectResult,
  EditPlace,
  EditResolveResult,
  EditResult,
  EditSearchResult,
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
  // ---- object details (all optional)
  parent?: string;
  zone?: string;
  /** things/players */
  home?: string;
  /** exits: where it leads (`location` is its source room) */
  destination?: string;
  pennies?: number;
  created?: string;
  modified?: string;
  /** flag names; when absent, none */
  flagNames?: string[];
  powers?: string[];
  /** lock type -> expression */
  locks?: Record<string, string>;
}

export const MOCK_FLAGS: EditCatalogItem[] = [
  { name: 'ABODE', letter: 'A', desc: 'Anyone may set their home here.' },
  { name: 'DARK', letter: 'D', desc: 'Not shown in room contents; its exits are not listed.' },
  { name: 'ENTER_OK', letter: 'e', desc: 'Others may enter this object.' },
  { name: 'HALT', letter: 'h', desc: 'Stops all queued commands of the object.' },
  { name: 'INHERIT', letter: 'I', desc: 'The object acts with the powers of its owner.' },
  { name: 'JUMP_OK', letter: 'J', desc: 'Anyone may teleport to this room.' },
  { name: 'LINK_OK', letter: 'L', desc: 'Anyone may link exits to this room.' },
  { name: 'NO_COMMAND', letter: 'n', desc: 'The object does not run $-commands.' },
  { name: 'OPAQUE', letter: 'O', desc: 'Contents cannot be seen from outside.' },
  { name: 'ROYALTY', letter: 'Z', desc: 'May see and examine everything. Wizard only.' },
  { name: 'SAFE', letter: 's', desc: 'Protects the object from @destroy.' },
  { name: 'STICKY', letter: 'S', desc: 'Goes home when dropped; exits to it are not shown as dropto.' },
  { name: 'TRANSPARENT', letter: 't', desc: 'Contents can be seen through the object.' },
  { name: 'VISUAL', letter: 'V', desc: 'Anyone may examine the object.' },
  { name: 'WIZARD', letter: 'W', desc: 'Full administrative power. Wizard only.' },
];
export const MOCK_POWERS: EditCatalogItem[] = [
  { name: 'BOOT', letter: '', desc: 'May disconnect other players.' },
  { name: 'CAN_SPOOF', letter: '', desc: 'May fake the source of emits.' },
  { name: 'LONG_FINGERS', letter: '', desc: 'May use commands on distant objects.' },
  { name: 'NO_QUOTA', letter: '', desc: 'Has no object quota.' },
  { name: 'PLAYER_CREATE', letter: '', desc: 'May create new players.' },
  { name: 'SEARCH', letter: '', desc: 'May search the whole database.' },
  { name: 'SEE_ALL', letter: '', desc: 'May examine everything.' },
  { name: 'TPORT_ANYTHING', letter: '', desc: 'May teleport any object anywhere.' },
];
const WIZARD_ONLY_FLAGS = ['WIZARD', 'ROYALTY'];
const ATTR_FLAGS = ['no_command', 'no_inherit', 'no_clone', 'visual', 'safe', 'locked', 'mortal_dark'];

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

/** The game's own words out of an `engine: ...: text` error. */
const gameOf = (e: string): string => e.replace(/^engine: [^:]*: /, '').replace(/^engine: /, '');

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
      flagNames: ['ABODE'],
      attrs: { DESCRIBE: { value: 'The lobby.%rBenches line the walls.' } },
    },
    {
      dbref: '#1',
      name: 'Wizard',
      type: 'PLAYER',
      owner: '#1',
      flags: 'WP',
      location: '#10',
      home: '#10',
      pennies: 9000,
      flagNames: ['WIZARD'],
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
      home: '#10',
      pennies: 120,
      flagNames: [],
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
      home: '#10',
      parent: '#13',
      zone: '#14',
      pennies: 12,
      created: 'Mon Jan 02 03:04:05 2023',
      modified: 'Tue Feb 03 04:05:06 2024',
      flagNames: ['DARK', 'VISUAL'],
      powers: [],
      locks: { Basic: '=#45', Use: '#45|flag^WIZARD' },
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
      home: '#10',
      pennies: 3,
      flagNames: ['DARK'],
      locks: {},
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
      home: '#10',
      pennies: 1,
      flagNames: [],
      locks: { Basic: '#7' },
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
      home: '#10',
      flagNames: [],
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
    ...mockPlaces(),
  ];
}

function room(
  dbref: string,
  name: string,
  owner: string,
  controls: Tri,
  desc = '',
  flagNames: string[] = [],
): MockObject {
  return {
    dbref,
    name,
    type: 'ROOM',
    owner,
    flags: 'R',
    location: '',
    controls,
    flagNames,
    locks: {},
    attrs: desc ? { DESCRIBE: { value: desc } } : {},
  };
}
function exit(
  dbref: string,
  name: string,
  from: string,
  to: string,
  owner = '#45',
  controls: Tri = 'true',
): MockObject {
  return {
    dbref,
    name,
    type: 'EXIT',
    owner,
    flags: 'E',
    location: from,
    destination: to,
    controls,
    flagNames: [],
    locks: {},
    attrs: {},
  };
}

/** Rooms and exits of the fake world: a small graph plus filler rooms to search through. */
function mockPlaces(): MockObject[] {
  const out: MockObject[] = [
    room('#11', 'Garden', '#45', 'true', 'A quiet garden with a fountain.%rBirds sing.', [
      'ABODE',
      'JUMP_OK',
    ]),
    room('#17', 'Observatory', '#45', 'true', 'A dome with a big telescope.'),
    room('#18', 'Wizard Sanctum', '#1', 'false', 'Only for wizards.'),
    room('#19', 'Engine Room', '#9', 'false', 'Humming machinery.'),
    exit('#20', 'North;N', '#10', '#11'),
    exit('#21', 'Back;B', '#11', '#10'),
    exit('#22', 'Up;U', '#10', '#17'),
    exit('#23', 'Down;D', '#17', '#10'),
    exit('#24', 'Sanctum;S', '#10', '#18', '#1', 'false'),
    exit('#25', 'Engines;E', '#10', '#19', '#9', 'false'),
  ];
  for (let i = 1; i <= 24; i++) {
    out.push(room(`#${100 + i}`, `Guest Room ${i}`, '#45', 'true', `Guest room number ${i}.`));
  }
  return out;
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
  /** the connected character is a wizard (wizard-only flags and powers work) */
  wizard = false;
  /** the game refuses global room searches (only your own rooms and things nearby) */
  restrictSearch = false;
  /** the game cannot list its flags/powers (the UI lets the user type a name) */
  catalogKnown = true;
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
        (x) =>
          !x.invisible &&
          x.name
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(q)),
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

  // ------------------------------------------------------------------ object details (docs/EDIT.md section 11)

  private stamp(o: MockObject): void {
    o.modified = new Date().toUTCString();
  }

  private detailsOf(o: MockObject): EditDetails {
    const type = o.type.toLowerCase();
    const names = o.flagNames ?? [];
    const typeLetter = { room: 'R', exit: 'E', player: 'P', thing: '' }[type] ?? '';
    const letters = names.map((n) => MOCK_FLAGS.find((f) => f.name === n)?.letter ?? '').join('');
    const here = [...this.objects.values()];
    return {
      dbref: o.dbref,
      name: o.name,
      type,
      owner: o.owner,
      parent: o.parent ?? '',
      zone: o.zone ?? '',
      location: o.location,
      home: o.home ?? '',
      destination: o.destination ?? '',
      pennies: type === 'thing' || type === 'player' ? (o.pennies ?? 0) : null,
      created: o.created ?? '',
      modified: o.modified ?? '',
      flags: [...names],
      flagLetters: typeLetter + letters,
      powers: [...(o.powers ?? [])],
      locks: Object.entries(o.locks ?? {}).map(([type, expr]) => ({ type, expr })),
      contents: here
        .filter((x) => x.location === o.dbref && x.type !== 'EXIT' && x.type !== 'ROOM' && !x.invisible)
        .map((x) => ({ dbref: x.dbref, name: x.name })),
      exits: here
        .filter((x) => x.type === 'EXIT' && x.location === o.dbref)
        .map((x) => ({ dbref: x.dbref, name: x.name.split(';')[0] })),
      attrCount: Object.keys(o.attrs).length,
      names: Object.fromEntries(
        [o.owner, o.parent, o.zone, o.location, o.home, o.destination]
          .filter((r): r is string => !!r)
          .flatMap((r) => {
            const x = this.objects.get(r);
            return x ? [[r, x.name.split(';')[0]]] : [];
          }),
      ),
    };
  }

  private emptyDetails(dbref: string): EditDetails {
    return {
      dbref,
      name: '',
      type: '',
      owner: '',
      parent: '',
      zone: '',
      location: '',
      home: '',
      destination: '',
      pennies: null,
      created: '',
      modified: '',
      flags: [],
      flagLetters: '',
      powers: [],
      locks: [],
      contents: [],
      exits: [],
      attrCount: -1,
      names: {},
    };
  }

  async details(dbref: string): Promise<EditDetailsResult> {
    const o0 = this.find(dbref);
    await this.enter('details', [dbref], o0?.slowMs);
    const f = this.forced('details');
    if (f) return err(f.code, f.error ?? 'error', { reply: '', details: this.emptyDetails(dbref) });
    const o = this.find(dbref);
    if (!o)
      return err('no_such_object', 'engine: no such object: #-1 NO MATCH', {
        reply: '',
        details: this.emptyDetails(dbref),
      });
    if (o.invisible)
      return err('permission', 'engine: permission denied: #-1 PERMISSION DENIED', {
        reply: '',
        details: this.emptyDetails(dbref),
      });
    return ok({ reply: '', details: this.detailsOf(o) });
  }

  private catalog(items: EditCatalogItem[]): EditCatalogResult {
    return ok({ known: this.catalogKnown, items: this.catalogKnown ? items.map((i) => ({ ...i })) : [] });
  }
  async listFlags(): Promise<EditCatalogResult> {
    await this.enter('listFlags', []);
    const f = this.forced('listFlags');
    if (f) return err(f.code, f.error ?? 'error', { known: false, items: [] });
    return this.catalog(MOCK_FLAGS);
  }
  async listPowers(): Promise<EditCatalogResult> {
    await this.enter('listPowers', []);
    const f = this.forced('listPowers');
    if (f) return err(f.code, f.error ?? 'error', { known: false, items: [] });
    return this.catalog(MOCK_POWERS);
  }

  /** One mutation: logs, applies failure injection and the permission rules, then runs `fn`. */
  private async mutate(
    method: string,
    dbref: string,
    args: unknown[],
    fn: (o: MockObject) => { reply: string } | { refuse: string; code?: EditCode },
  ): Promise<EditDetailsResult> {
    const o0 = this.find(dbref);
    await this.enter(method, args, o0?.slowMs);
    const empty = { reply: '', details: this.emptyDetails(dbref) };
    const f = this.forced(method);
    if (f)
      return {
        ...empty,
        ...(o0 ? { details: this.detailsOf(o0) } : {}),
        ok: false,
        code: f.code,
        error: f.error ?? 'error',
        reply: f.error ? gameOf(f.error) : '',
      };
    const o = this.find(dbref);
    if (!o)
      return err('no_such_object', "engine: no such object: I don't see that here.", {
        ...empty,
        reply: "I don't see that here.",
      });
    const refuse = (reply: string, code: EditCode = 'permission'): EditDetailsResult => ({
      ok: false,
      code,
      error: `engine: ${code === 'permission' ? 'permission denied' : 'the game rejected the change'}: ${reply}`,
      reply,
      details: this.detailsOf(o),
    });
    if (o.invisible) return refuse('Permission denied.');
    if ((o.controls === 'false' && !this.wizard) || this.rng() < this.rejectRate)
      return refuse('Permission denied.');
    const r = fn(o);
    if ('refuse' in r) return refuse(r.refuse, r.code ?? 'rejected');
    this.stamp(o);
    return ok({ reply: r.reply, details: this.detailsOf(o) });
  }

  setFlag(dbref: string, flag: string, on: boolean): Promise<EditDetailsResult> {
    return this.mutate('setFlag', dbref, [dbref, flag, on], (o) => {
      const name = flag.toUpperCase();
      const known = MOCK_FLAGS.find((x) => x.name === name || x.letter === flag);
      if (!known) return { refuse: "I don't recognize that flag.", code: 'rejected' };
      if (WIZARD_ONLY_FLAGS.includes(known.name) && !this.wizard)
        return { refuse: 'Permission denied.', code: 'permission' };
      const set = new Set(o.flagNames ?? []);
      if (on) set.add(known.name);
      else set.delete(known.name);
      o.flagNames = [...set];
      return { reply: on ? 'Flag set.' : 'Flag reset.' };
    });
  }

  setPower(dbref: string, power: string, on: boolean): Promise<EditDetailsResult> {
    return this.mutate('setPower', dbref, [dbref, power, on], (o) => {
      if (!this.wizard) return { refuse: 'Permission denied.', code: 'permission' };
      const name = power.toUpperCase();
      if (!MOCK_POWERS.some((p) => p.name === name))
        return { refuse: "I don't recognize that power.", code: 'rejected' };
      const set = new Set(o.powers ?? []);
      if (on) set.add(name);
      else set.delete(name);
      o.powers = [...set];
      return { reply: on ? 'Power granted.' : 'Power removed.' };
    });
  }

  async setAttrFlag(dbref: string, attr: string, flag: string, on: boolean): Promise<EditAttrFlagResult> {
    const o0 = this.find(dbref);
    await this.enter('setAttrFlag', [dbref, attr, flag, on], o0?.slowMs);
    const base = { reply: '', known: false, flags: '', flagNames: '' };
    const f = this.forced('setAttrFlag');
    if (f)
      return {
        ...base,
        ok: false,
        code: f.code,
        error: f.error ?? 'error',
        reply: f.error ? gameOf(f.error) : '',
      };
    const o = this.find(dbref);
    const a = o?.attrs[attr.toUpperCase()];
    if (!o || !a)
      return err('no_such_object', 'engine: no such object: No such attribute.', {
        ...base,
        reply: 'No such attribute.',
      });
    const name = flag.toLowerCase();
    const reject = (reply: string, code: EditCode): EditAttrFlagResult => ({
      ...base,
      ok: false,
      code,
      error: `engine: ${code === 'permission' ? 'permission denied' : 'the game rejected the change'}: ${reply}`,
      reply,
      known: true,
      flags: (a.flags ?? []).map((n) => n[0].toUpperCase()).join(''),
      flagNames: (a.flags ?? []).join(' '),
    });
    if ((o.controls === 'false' && !this.wizard) || a.readonly || this.rng() < this.rejectRate)
      return reject('Permission denied.', 'permission');
    if (!ATTR_FLAGS.includes(name)) return reject('Unknown attribute flag.', 'rejected');
    if (name === 'locked' && !this.wizard && on === false) return reject('Permission denied.', 'permission');
    const set = new Set(a.flags ?? []);
    if (on) set.add(name);
    else set.delete(name);
    a.flags = [...set];
    return ok({
      reply: on ? 'Attribute flag set.' : 'Attribute flag reset.',
      known: true,
      flags: a.flags.map((n) => n[0].toUpperCase()).join(''),
      flagNames: a.flags.join(' '),
    });
  }

  rename(dbref: string, name: string): Promise<EditDetailsResult> {
    return this.mutate('rename', dbref, [dbref, name], (o) => {
      if (!name.trim() || /[[\](){},;%\\=^|]/.test(name))
        return { refuse: 'That is not a good name.', code: 'rejected' };
      if (
        o.type === 'PLAYER' &&
        [...this.objects.values()].some(
          (x) => x.type === 'PLAYER' && x !== o && x.name.toLowerCase() === name.toLowerCase(),
        )
      )
        return { refuse: 'That name is already in use.', code: 'rejected' };
      o.name = name;
      return { reply: 'Name set.' };
    });
  }

  chown(dbref: string, owner: string): Promise<EditDetailsResult> {
    return this.mutate('chown', dbref, [dbref, owner], (o) => {
      const target = /^#-?\d+$/.test(owner)
        ? this.find(owner)
        : [...this.objects.values()].find(
            (x) => x.type === 'PLAYER' && x.name.toLowerCase() === owner.toLowerCase().replace(/^\*/, ''),
          );
      if (!target || target.type !== 'PLAYER')
        return { refuse: "I can't find that player.", code: 'rejected' };
      if (!this.wizard && target.dbref !== this.me)
        return { refuse: 'Permission denied.', code: 'permission' };
      o.owner = target.dbref;
      return { reply: `Owner changed to ${target.name}.` };
    });
  }

  setParent(dbref: string, parent: string): Promise<EditDetailsResult> {
    return this.mutate('setParent', dbref, [dbref, parent], (o) => {
      if (parent === '' || parent.toLowerCase() === 'none') {
        o.parent = '';
        return { reply: 'Parent cleared.' };
      }
      const p = this.find(parent);
      if (!p || p.invisible) return { refuse: "I don't see that here.", code: 'rejected' };
      if (p.dbref === o.dbref)
        return { refuse: "You can't make an object its own parent.", code: 'rejected' };
      if (p.controls === 'false' && !this.wizard) return { refuse: 'Permission denied.', code: 'permission' };
      o.parent = p.dbref;
      return { reply: 'Parent changed.' };
    });
  }

  setZone(dbref: string, zone: string): Promise<EditDetailsResult> {
    return this.mutate('setZone', dbref, [dbref, zone], (o) => {
      if (zone === '' || zone.toLowerCase() === 'none') {
        o.zone = '';
        return { reply: 'Zone cleared.' };
      }
      const z = this.find(zone);
      if (!z || z.invisible) return { refuse: "I don't see that here.", code: 'rejected' };
      o.zone = z.dbref;
      return { reply: 'Zone changed.' };
    });
  }

  setLock(dbref: string, lockType: string, expr: string): Promise<EditDetailsResult> {
    return this.mutate('setLock', dbref, [dbref, lockType, expr], (o) => {
      const locks = { ...(o.locks ?? {}) };
      const key = Object.keys(locks).find((k) => k.toLowerCase() === lockType.toLowerCase()) ?? lockType;
      if (expr === '' || expr.toLowerCase() === 'none') {
        delete locks[key];
        o.locks = locks;
        return { reply: 'Unlocked.' };
      }
      if (/&\s*$|^\s*[|&]|\(\s*\)/.test(expr))
        return { refuse: "I don't understand that key.", code: 'rejected' };
      locks[key] = expr;
      o.locks = locks;
      return { reply: 'Locked.' };
    });
  }

  setHome(dbref: string, room: string): Promise<EditDetailsResult> {
    return this.mutate('setHome', dbref, [dbref, room], (o) => {
      const r = this.find(room);
      if (!r || r.type !== 'ROOM') return { refuse: "That's not a room!", code: 'rejected' };
      o.home = r.dbref;
      return { reply: 'Home set.' };
    });
  }

  setDestination(dbref: string, room: string): Promise<EditDetailsResult> {
    return this.mutate('setDestination', dbref, [dbref, room], (o) => {
      if (o.type !== 'EXIT') return { refuse: 'Only exits have a destination.', code: 'rejected' };
      const r = this.find(room);
      if (!r || r.type !== 'ROOM') return { refuse: "That's not a room!", code: 'rejected' };
      o.destination = r.dbref;
      return { reply: 'Linked.' };
    });
  }

  move(dbref: string, dest: string): Promise<EditDetailsResult> {
    return this.mutate('move', dbref, [dbref, dest], (o) => {
      const d = this.find(dest);
      if (!d || d.invisible) return { refuse: "I can't find that.", code: 'rejected' };
      if (o.type === 'ROOM') return { refuse: "You can't move a room.", code: 'rejected' };
      if (d.dbref === o.dbref) return { refuse: "You can't move an object into itself.", code: 'rejected' };
      if (d.dbref === '#18' && !this.wizard) return { refuse: 'Permission denied.', code: 'permission' };
      if (
        d.type !== 'ROOM' &&
        o.type !== 'EXIT' &&
        d.type === 'THING' &&
        !(d.flagNames ?? []).includes('ENTER_OK')
      )
        return { refuse: "You can't enter that.", code: 'rejected' };
      o.location = d.dbref;
      return { reply: o.type === 'EXIT' ? 'Moved.' : 'Teleported.' };
    });
  }

  private place(o: MockObject): EditPlace {
    return { dbref: o.dbref, name: o.name.split(';')[0], type: o.type.toLowerCase(), owner: o.owner };
  }

  async searchRooms(query: string): Promise<EditSearchResult> {
    await this.enter('searchRooms', [query]);
    const f = this.forced('searchRooms');
    if (f) return err(f.code, f.error ?? 'error', { items: [], restricted: false, truncated: false });
    const q = query.trim().toLowerCase();
    const all = [...this.objects.values()].filter((o) => !o.invisible);
    let items: MockObject[];
    if (/^#-?\d+$/.test(q)) items = all.filter((o) => o.dbref === q);
    else {
      const rooms = all.filter(
        (o) =>
          o.type === 'ROOM' &&
          o.name.toLowerCase().includes(q) &&
          (!this.restrictSearch || o.owner === this.me),
      );
      const near = all.filter(
        (o) =>
          o.type !== 'EXIT' && o.type !== 'ROOM' && o.location === this.here && o.name.toLowerCase() === q,
      );
      items = [...rooms, ...near.filter((n) => !rooms.includes(n))];
    }
    const cap = 50;
    return ok({
      items: items.slice(0, cap).map((o) => this.place(o)),
      restricted: this.restrictSearch && !/^#-?\d+$/.test(q),
      truncated: items.length > cap,
    });
  }

  async nearby(dbref: string): Promise<EditNearbyResult> {
    await this.enter('nearby', [dbref]);
    const empty = { room: { dbref: '', name: '', type: '', owner: '' }, desc: '', exits: [], contents: [] };
    const f = this.forced('nearby');
    if (f) return err(f.code, f.error ?? 'error', empty);
    const o = this.find(dbref);
    if (!o || o.invisible) return err('no_such_object', 'engine: no such object: #-1 NO MATCH', empty);
    const room = o.type === 'ROOM' ? o : this.find(o.location);
    if (!room) return err('no_such_object', 'engine: no such object: the object has no location', empty);
    const desc = (room.attrs.DESCRIBE?.value ?? '').replace(/%r/g, ' ').slice(0, 240);
    const all = [...this.objects.values()];
    return ok({
      room: this.place(room),
      desc,
      exits: all
        .filter((x) => x.type === 'EXIT' && x.location === room.dbref)
        .map((x) => {
          const d = x.destination ? this.find(x.destination) : undefined;
          return {
            dbref: x.dbref,
            name: x.name.split(';')[0],
            destDbref: d?.dbref ?? '',
            destName: d?.name ?? '',
          };
        }),
      contents: all
        .filter((x) => x.location === room.dbref && x.type !== 'EXIT' && x.type !== 'ROOM' && !x.invisible)
        .map((x) => this.place(x)),
    });
  }
}
