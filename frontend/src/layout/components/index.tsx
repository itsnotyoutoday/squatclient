import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { OutputPane } from '../../components/output/OutputPane';
import { InputLine } from '../../components/input/InputLine';
import { EndedBanner } from '../../components/tabs/EndedBanner';
import { SearchBar } from '../../components/search/SearchBar';
import { canType } from '../../lib/tfcontrol';
import { useUi } from '../../state/stores';
import { useLayoutEnv } from '../context';
import { useBinding, useChat, useItems, useSend, useSession } from '../hooks';
import { toNumber, toText } from '../paths';
import { useLayoutData } from '../store';
import { readVitals } from '../vitals';

/**
 * The built-in vocabulary of layouts (docs/LAYOUTS.md). A layout is a React component that arranges
 * these. Data comes from bindings: a string such as "gmcp:Char.Vitals.hp", "msdp:HEALTH" or "var:hp"
 * (or a plain value); every widget subscribes to its own bindings, so a changing value redraws only
 * the widget that shows it.
 */

type Kids = { children?: ReactNode };
const px = (v: number | string | undefined): string | undefined => (typeof v === 'number' ? `${v}px` : v);

// ---------------------------------------------------------------- core (the shell's parts)

/** The layout's root: the area between the tab bar and the status bar. */
export function App({ children }: Kids) {
  const session = useSession();
  return (
    <main className="workspace lay-app" aria-label={`Session ${session?.name ?? ''}`}>
      {children}
    </main>
  );
}

/** The game's output (with its search bar). A layout must contain exactly one. */
export function Mush() {
  const env = useLayoutEnv();
  const searchOpen = useUi((s) => s.searchOpen);
  useLayoutEffect(() => env.register('mush'), [env]);
  return (
    <div className="lay-mush">
      {searchOpen && <SearchBar sessionId={env.sessionId} />}
      <OutputPane key={env.sessionId} sessionId={env.sessionId} />
    </div>
  );
}

/** The input line (or the banner of an ended session). A layout must contain exactly one. */
export function InputBar() {
  const env = useLayoutEnv();
  const s = useSession();
  useLayoutEffect(() => env.register('input'), [env]);
  if (!s) return null;
  if (s.state === 'ended') return <EndedBanner session={s} />;
  return (
    <InputLine
      sessionId={env.sessionId}
      remoteEcho={s.remoteEcho}
      disabled={s.state === 'connecting' || !canType(s)}
      disabledReason={
        canType(s)
          ? undefined
          : 'TinyFugue has the keyboard. Use the control in the status bar to type from here.'
      }
    />
  );
}

// ---------------------------------------------------------------- structure

interface FlexProps extends Kids {
  gap?: number;
  /** flex-grow; 0 keeps the natural size (default 1 for the output side, set it as needed). */
  grow?: number;
  width?: number | string;
  height?: number | string;
  className?: string;
}

function flexStyle(p: FlexProps): CSSProperties {
  return { gap: p.gap, flexGrow: p.grow, width: px(p.width), height: px(p.height) };
}

/** Children side by side. */
export function Row(p: FlexProps) {
  return (
    <div className={`lay-row ${p.className ?? ''}`} style={flexStyle(p)}>
      {p.children}
    </div>
  );
}

/** Children stacked. */
export function Column(p: FlexProps) {
  return (
    <div className={`lay-col ${p.className ?? ''}`} style={flexStyle(p)}>
      {p.children}
    </div>
  );
}

/** A plain container with optional padding and border. */
export function Box(p: FlexProps & { padding?: number; border?: boolean }) {
  return (
    <div
      className={`lay-box ${p.border ? 'lay-bordered' : ''} ${p.className ?? ''}`}
      style={{ ...flexStyle(p), padding: p.padding }}
    >
      {p.children}
    </div>
  );
}

/** A titled box; with `collapsible` the title toggles the body. */
export function Panel(p: Kids & { title?: string; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className="lay-panel">
      {p.title &&
        (p.collapsible ? (
          <button
            type="button"
            className="lay-panel-title"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {p.title}
          </button>
        ) : (
          <h3 className="lay-panel-title">{p.title}</h3>
        ))}
      {open && <div className="lay-panel-body">{p.children}</div>}
    </section>
  );
}

/**
 * A side area. It disappears entirely when everything inside it renders nothing (for instance when it
 * only holds <When> blocks whose data has not arrived), so a panel shows only when there is something
 * to show.
 */
export function Dock(
  p: Kids & {
    side?: 'left' | 'right' | 'top' | 'bottom' | 'float';
    width?: number | string;
    height?: number | string;
    x?: number;
    y?: number;
    /** Let the user drag the inner edge to change the size (double-click the edge to reset). */
    resizable?: boolean;
    /** Limits for a resizable dock, in px. */
    min?: number;
    max?: number;
    /** Names the dock so its size is remembered (default: its side). */
    id?: string;
  },
) {
  const side = p.side ?? 'right';
  const vertical = side === 'left' || side === 'right'; // these are sized by width
  const canResize = Boolean(p.resizable) && side !== 'float';
  const key = `squat.dock.${p.id ?? side}`;
  const initial = vertical ? p.width : p.height;
  const [size, setSize] = useState<number | undefined>(() => {
    if (!canResize) return undefined;
    try {
      const v = Number(localStorage.getItem(key));
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      /* storage unavailable */
    }
    return typeof initial === 'number' ? initial : undefined;
  });
  const ref = useRef<HTMLElement>(null);
  const min = p.min ?? 120;
  const max = p.max ?? 800;
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, Math.round(v))), [min, max]);
  const save = (v: number | undefined): void => {
    try {
      if (v === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, String(v));
    } catch {
      /* storage unavailable */
    }
  };
  const drag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = vertical ? e.clientX : e.clientY;
    const from = vertical ? el.offsetWidth : el.offsetHeight;
    // right/bottom docks grow when the edge moves left/up
    const dir = side === 'right' || side === 'bottom' ? -1 : 1;
    let last = from;
    const move = (m: PointerEvent): void => {
      last = clamp(from + dir * ((vertical ? m.clientX : m.clientY) - start));
      setSize(last);
    };
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      save(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const reset = (): void => {
    setSize(typeof initial === 'number' ? initial : undefined);
    save(undefined);
  };

  const style: CSSProperties = canResize
    ? vertical
      ? { width: size !== undefined ? `${size}px` : px(p.width), height: px(p.height) }
      : { height: size !== undefined ? `${size}px` : px(p.height), width: px(p.width) }
    : { width: px(p.width), height: px(p.height) };
  if (side === 'float')
    Object.assign(style, { position: 'absolute', left: p.x ?? 12, top: p.y ?? 12, zIndex: 20 });
  if (!canResize)
    return (
      <aside className={`lay-dock lay-dock-${side}`} style={style}>
        {p.children}
      </aside>
    );
  return (
    <aside
      ref={ref}
      className={`lay-dock lay-dock-${side} lay-dock-resizable`}
      style={{ ...style, padding: 0, overflow: 'hidden' }}
    >
      <div
        className={`lay-grip lay-grip-${side}`}
        role="separator"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label="Resize"
        title="Drag to resize, double-click to reset"
        onPointerDown={drag}
        onDoubleClick={reset}
      />
      <div className="lay-dock-inner">{p.children}</div>
    </aside>
  );
}

export function Spacer(p: { size?: number }) {
  return <div className="lay-spacer" style={p.size ? { flex: `0 0 ${p.size}px` } : undefined} />;
}

export function Separator() {
  return <hr className="lay-sep" />;
}

// ---------------------------------------------------------------- conditions

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Renders its children once the data exists: `<When gmcp="Char.Vitals">`, `msdp="HEALTH"`, `var="hp"`,
 * or `has="gmcp:Room.Info"`. With `not`, the other way round. `fallback` shows while it does not hold.
 */
export function When(
  p: Kids & { gmcp?: string; msdp?: string; var?: string; has?: string; not?: boolean; fallback?: ReactNode },
) {
  const spec =
    p.has ?? (p.gmcp ? `gmcp:${p.gmcp}` : p.msdp ? `msdp:${p.msdp}` : p.var ? `var:${p.var}` : undefined);
  const v = useBinding(spec);
  const ok = spec === undefined ? true : present(v);
  return <>{ok !== !!p.not ? p.children : (p.fallback ?? null)}</>;
}

// ---------------------------------------------------------------- widgets

const NAMED_COLORS: Record<string, string> = {
  red: 'var(--ansi-1)',
  green: 'var(--ansi-2)',
  yellow: 'var(--ansi-3)',
  blue: 'var(--ansi-4)',
  magenta: 'var(--ansi-5)',
  cyan: 'var(--ansi-6)',
  accent: 'var(--ui-accent)',
  ok: 'var(--ui-ok)',
  warn: 'var(--ui-warn)',
  danger: 'var(--ui-danger)',
};

function gaugeColor(color: string | undefined, pct: number): string {
  if (!color || color === 'auto')
    return pct > 50 ? 'var(--ui-ok)' : pct > 25 ? 'var(--ui-warn)' : 'var(--ui-danger)';
  return NAMED_COLORS[color] ?? color;
}

export function GaugeBar(p: { label?: string; value: number; max: number; color?: string; format?: string }) {
  const pct = p.max > 0 ? Math.max(0, Math.min(100, (p.value / p.max) * 100)) : 0;
  const fmt = p.format ?? '{value}/{max}';
  const text = fmt
    .replace('{value}', String(Math.round(p.value)))
    .replace('{max}', String(Math.round(p.max)))
    .replace('{percent}', `${Math.round(pct)}%`);
  return (
    <div
      className="lay-gauge"
      role="progressbar"
      aria-label={p.label}
      aria-valuemin={0}
      aria-valuemax={p.max}
      aria-valuenow={p.value}
      aria-valuetext={`${p.label ? `${p.label}: ` : ''}${text}`}
    >
      {p.label && <span className="lay-gauge-label">{p.label}</span>}
      <span className="lay-gauge-track">
        <span className="lay-gauge-fill" style={{ width: `${pct}%`, background: gaugeColor(p.color, pct) }} />
        <span className="lay-gauge-text">{text}</span>
      </span>
    </div>
  );
}

/** A bar: `<Gauge label="HP" value="gmcp:Char.Vitals.hp" max="gmcp:Char.Vitals.maxhp" color="red" />`. Shows nothing until both numbers exist. */
export function Gauge(p: { value: unknown; max: unknown; label?: string; color?: string; format?: string }) {
  const value = toNumber(useBinding(p.value));
  const max = toNumber(useBinding(p.max));
  if (value === undefined || max === undefined) return null;
  return <GaugeBar label={p.label} value={value} max={max} color={p.color} format={p.format} />;
}

/**
 * The usual bars (HP, MP, movement, ...) for whatever the game reports, whatever it calls them: Iron
 * Realms/Evennia style, Aardwolf, MSDP's standard names, or a `vitals` script variable. Shows nothing until
 * the game reports one. `only` limits it to some ids ("hp", "mp", "mv", "ep", "wp").
 */
export function Vitals(p: { only?: string[]; color?: string }) {
  const { sessionId, scope } = useLayoutEnv();
  // one string key: the component redraws only when a displayed number changes
  const key = useLayoutData((s) => JSON.stringify(readVitals(s.sessions[sessionId], s.vars[scope])));
  const list = useMemo(() => JSON.parse(key) as ReturnType<typeof readVitals>, [key]);
  const shown = p.only ? list.filter((v) => p.only?.includes(v.id)) : list;
  if (shown.length === 0) return null;
  return (
    <div className="lay-vitals">
      {shown.map((v) => (
        <GaugeBar key={v.id} label={v.label} value={v.value} max={v.max} color={p.color} />
      ))}
    </div>
  );
}

/** Text from a binding (or its children): `<Text label="Class" value="gmcp:Char.Status.class" />`. */
export function Text(p: { value?: unknown; label?: string; empty?: string } & Kids) {
  const v = useBinding(p.value);
  const text = p.value === undefined ? undefined : toText(v);
  if (p.value !== undefined && !text && p.empty === undefined) return null;
  return (
    <div className="lay-text">
      {p.label && <span className="lay-text-label">{p.label}: </span>}
      {p.value === undefined ? p.children : text || p.empty}
    </div>
  );
}

/** A click-to-send button: `<Button send="look">Look</Button>`. */
export function Button(p: Kids & { send?: string; title?: string; disabled?: boolean }) {
  const send = useSend();
  return (
    <button
      type="button"
      className="lay-button"
      title={p.title}
      disabled={p.disabled}
      onClick={() => p.send && send(p.send)}
    >
      {p.children}
    </button>
  );
}

const fill = (tpl: string, item: Record<string, unknown>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => toText(item[k]));

function asRows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v))
    return v.map((x) => (x !== null && typeof x === 'object' ? (x as Record<string, unknown>) : { name: x }));
  if (v !== null && typeof v === 'object')
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => ({ name: k, value: x }));
  return [];
}

/** A list: `<List value="gmcp:Group.members" text="name" send="tell {name} hi" />`. `value` may also be "items:inv". */
export function List(p: {
  value: unknown;
  text?: string;
  send?: string;
  empty?: string;
  limit?: number;
  title?: string;
}) {
  const raw = useBinding(typeof p.value === 'string' && p.value.startsWith('items:') ? undefined : p.value);
  const items = useItems(
    typeof p.value === 'string' && p.value.startsWith('items:') ? p.value.slice(6) : 'inv',
  );
  const rows =
    typeof p.value === 'string' && p.value.startsWith('items:')
      ? (items as unknown as Record<string, unknown>[])
      : asRows(raw);
  const send = useSend();
  const shown = p.limit ? rows.slice(0, p.limit) : rows;
  if (rows.length === 0 && p.empty === undefined) return null;
  return (
    <div className="lay-list">
      {p.title && <h4 className="lay-list-title">{p.title}</h4>}
      {rows.length === 0 ? (
        <div className="lay-empty">{p.empty}</div>
      ) : (
        <ul>
          {shown.map((r, i) => {
            const label = toText(r[p.text ?? 'name']);
            return (
              <li key={toText(r.id) || i}>
                {p.send ? (
                  <button type="button" className="lay-link" onClick={() => send(fill(p.send as string, r))}>
                    {label}
                  </button>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A table of objects: `<Table value="gmcp:Group.members" columns={[{key:'name',title:'Name'},{key:'hp',title:'HP'}]} />`. */
export function Table(p: { value: unknown; columns?: { key: string; title?: string }[]; empty?: string }) {
  const rows = asRows(useBinding(p.value));
  if (rows.length === 0) return p.empty === undefined ? null : <div className="lay-empty">{p.empty}</div>;
  const cols = p.columns ?? Object.keys(rows[0]).map((key) => ({ key, title: key }));
  return (
    <table className="lay-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>{c.title ?? c.key}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={toText(r.id) || i}>
            {cols.map((c) => (
              <td key={c.key}>{toText(r[c.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Channel chat from Comm.Channel.*: one tab per channel that has spoken (and "all"). */
export function Chat(p: { channels?: string[]; max?: number; height?: number | string }) {
  const all = useChat();
  const channels = useMemo(() => {
    const seen = [...new Set(all.map((m) => m.channel))];
    return p.channels ? seen.filter((c) => p.channels?.includes(c)) : seen;
  }, [all, p.channels]);
  const [tab, setTab] = useState('all');
  const shown = all
    .filter((m) => (tab === 'all' ? !p.channels || p.channels.includes(m.channel) : m.channel === tab))
    .slice(-(p.max ?? 100));
  if (all.length === 0) return null;
  return (
    <div className="lay-chat" style={{ height: px(p.height) }}>
      <div role="tablist" className="lay-chat-tabs" aria-label="Channels">
        {['all', ...channels].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={tab === c}
            className={tab === c ? 'on' : ''}
            onClick={() => setTab(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="lay-chat-log" role="log" aria-live="polite">
        {shown.map((m) => (
          <div key={m.id} className="lay-chat-msg">
            {tab === 'all' && <span className="lay-chat-chan">[{m.channel}] </span>}
            {m.talker && <span className="lay-chat-talker">{m.talker}: </span>}
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rooms

export interface RoomView {
  name: string;
  area: string;
  desc: string;
  /** The exits' names (a game that names two exits the same lists both). */
  exits: string[];
  /** The exits with what to type to take each one, and where it leads when the game says. */
  exitInfo: ExitInfo[];
  players: string[];
}

export interface ExitInfo {
  name: string;
  /** What to send to take it (the name, unless the game sends something more exact, e.g. "north-2"). */
  cmd: string;
  to?: string;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The current room from GMCP Room.Info or MSDP (a ROOM table, or the flat ROOM_NAME / ROOM_EXITS). */
export function useRoom(): RoomView | undefined {
  const info = useBinding('gmcp:Room.Info');
  const room = useBinding('msdp:ROOM');
  const flatName = useBinding('msdp:ROOM_NAME');
  const flatExits = useBinding('msdp:ROOM_EXITS');
  const flatArea = useBinding('msdp:AREA_NAME');
  return useMemo(() => {
    // exits arrive as {name: destination}, ["name", ...] or [{name, cmd, to}, ...]
    const exitList = (e: unknown): ExitInfo[] =>
      isRec(e)
        ? Object.entries(e).map(([name, v]) => ({
            name,
            cmd: name,
            to: typeof v === 'string' && Number.isNaN(Number(v)) ? v : undefined,
          }))
        : Array.isArray(e)
          ? e.map((x) => {
              if (!isRec(x)) return { name: toText(x), cmd: toText(x) };
              const name = toText(x.name ?? x.dir ?? x.cmd);
              return { name, cmd: toText(x.cmd) || name, to: toText(x.to ?? x.destination) || undefined };
            })
          : [];
    const exitNames = (e: unknown): string[] => exitList(e).map((x) => x.name);
    if (isRec(info)) {
      return {
        name: toText(info.name),
        area: toText(info.area ?? info.zone),
        desc: toText(info.desc ?? info.description),
        exits: exitNames(info.exits),
        exitInfo: exitList(info.exits),
        players: Array.isArray(info.players)
          ? info.players.map((x) => (isRec(x) ? toText(x.name) : toText(x)))
          : [],
      };
    }
    if (isRec(room)) {
      return {
        name: toText(room.NAME),
        area: toText(room.AREA),
        desc: '',
        exits: exitNames(room.EXITS),
        exitInfo: exitList(room.EXITS),
        players: [],
      };
    }
    if (present(flatName))
      return {
        name: toText(flatName),
        area: toText(flatArea),
        desc: '',
        exits: exitNames(flatExits),
        exitInfo: exitList(flatExits),
        players: [],
      };
    return undefined;
  }, [info, room, flatName, flatExits, flatArea]);
}

/** Exit buttons for the current room; clicking walks there. */
export function Exits() {
  const room = useRoom();
  const send = useSend();
  if (!room || room.exits.length === 0) return null;
  return (
    <div className="lay-exits" role="group" aria-label="Exits">
      {room.exitInfo.map((e, i) => (
        <button
          key={`${e.cmd}:${i}`}
          type="button"
          className="lay-button"
          title={e.to ? `${e.name} to ${e.to}` : undefined}
          onClick={() => send(e.cmd)}
        >
          {e.to ? `${e.name} → ${e.to}` : e.name}
        </button>
      ))}
    </div>
  );
}

/** The room: name, area, description, exits and players. */
export function RoomInfo(p: { desc?: boolean; exits?: boolean; players?: boolean }) {
  const room = useRoom();
  if (!room || !room.name) return null;
  return (
    <div className="lay-room">
      <h3 className="lay-room-name">{room.name}</h3>
      {room.area && <div className="lay-room-area">{room.area}</div>}
      {p.desc !== false && room.desc && <p className="lay-room-desc">{room.desc}</p>}
      {p.players !== false && room.players.length > 0 && (
        <div className="lay-room-players">Here: {room.players.join(', ')}</div>
      )}
      {p.exits !== false && <Exits />}
    </div>
  );
}
