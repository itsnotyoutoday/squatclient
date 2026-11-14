import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useSend, useSetVar } from '../hooks';
import { toNumber, toText } from '../paths';
import { useLayoutData } from '../store';
import { Button, Column, GaugeBar, List, Panel, Row, Separator, Table, Text } from './index';

/**
 * Windows and panels that Lua opens with squat.ui.window{...} / squat.ui.panel{...}. Lua only produces data
 * (the variable "ui.windows": id -> spec); this draws it. A spec is { id, title, kind, x, y, w, h, dock, body },
 * body a tree of nodes { type, children, ...props }. Nothing in a spec is code: buttons send text, which goes
 * through the normal input pipeline (so a Lua alias can answer it).
 */

type Node = { type?: unknown; children?: unknown; [k: string]: unknown };
interface Spec {
  id: string;
  title?: string;
  kind?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  dock?: string;
  body?: Node;
}

const MAX_DEPTH = 12;
const MAX_NODES = 600;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const kids = (n: Node): Node[] => (Array.isArray(n.children) ? (n.children as Node[]) : []);
const fill = (tpl: string, value: string): string => tpl.replace(/\{value\}/g, value);

function UiInput({ n }: { n: Node }) {
  const send = useSend();
  const [v, setV] = useState('');
  const tpl = str(n.send);
  return (
    <input
      className="lay-ui-input"
      value={v}
      placeholder={str(n.placeholder)}
      aria-label={str(n.label) ?? str(n.placeholder) ?? 'Input'}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && tpl) {
          send(fill(tpl, v));
          if (n.clear !== false) setV('');
        }
      }}
    />
  );
}

function UiTabs({ n, count }: { n: Node; count: { n: number } }) {
  const tabs = kids(n);
  const [i, setI] = useState(0);
  const cur = tabs[Math.min(i, Math.max(0, tabs.length - 1))];
  return (
    <div className="lay-ui-tabs">
      <div role="tablist" className="lay-chat-tabs">
        {tabs.map((t, k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === i}
            className={k === i ? 'on' : ''}
            onClick={() => setI(k)}
          >
            {str(t.title) ?? `Tab ${k + 1}`}
          </button>
        ))}
      </div>
      {cur && render(cur, 1, count, 'tab')}
    </div>
  );
}

function render(n: Node, depth: number, count: { n: number }, key?: string | number): ReactNode {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH || ++count.n > MAX_NODES) return null;
  const sub = (list: Node[]): ReactNode[] => list.map((c, i) => render(c, depth + 1, count, i));
  switch (n.type) {
    case 'column':
      return (
        <Column key={key} gap={num(n.gap)}>
          {sub(kids(n))}
        </Column>
      );
    case 'row':
      return (
        <Row key={key} gap={num(n.gap)}>
          {sub(kids(n))}
        </Row>
      );
    case 'grid':
      return (
        <div
          key={key}
          className="lay-ui-grid"
          style={{
            gridTemplateColumns: `repeat(${Math.min(12, Math.max(1, num(n.columns) ?? 2))}, 1fr)`,
            gap: num(n.gap) ?? 6,
          }}
        >
          {sub(kids(n))}
        </div>
      );
    case 'panel':
      return (
        <Panel
          key={key}
          title={str(n.title)}
          collapsible={n.collapsible === true}
          defaultOpen={n.open !== false}
        >
          {sub(kids(n))}
        </Panel>
      );
    case 'tabs':
      return <UiTabs key={key} n={n} count={count} />;
    case 'separator':
      return <Separator key={key} />;
    case 'heading':
      return (
        <h4 key={key} className="lay-ui-heading">
          {toText(n.value)}
        </h4>
      );
    case 'text':
      if (str(n.bind)) return <Text key={key} value={n.bind} label={str(n.label)} />;
      return (
        <div
          key={key}
          className={`lay-ui-text${n.dim ? ' dim' : ''}${n.bold ? ' bold' : ''}${n.mono ? ' mono' : ''}`}
        >
          {toText(n.value)}
        </div>
      );
    case 'code':
      return (
        <pre key={key} className="lay-ui-code">
          {toText(n.value)}
        </pre>
      );
    case 'badge':
      return (
        <span key={key} className={`lay-ui-badge ${str(n.tone) ?? ''}`}>
          {toText(n.value)}
        </span>
      );
    case 'button':
      return (
        <Button key={key} send={str(n.send)} title={str(n.tip)} disabled={n.disabled === true}>
          {toText(n.text ?? n.value)}
        </Button>
      );
    case 'table':
      return (
        <Table
          key={key}
          value={Array.isArray(n.rows) ? n.rows : []}
          columns={Array.isArray(n.columns) ? (n.columns as { key: string; title?: string }[]) : undefined}
          empty={str(n.empty)}
        />
      );
    case 'list':
      return (
        <List
          key={key}
          title={str(n.title)}
          value={Array.isArray(n.items) ? n.items : []}
          text={str(n.text)}
          send={str(n.send)}
          empty={str(n.empty)}
        />
      );
    case 'gauge': {
      const value = toNumber(n.value);
      const max = toNumber(n.max);
      if (value === undefined || max === undefined) return null;
      return (
        <GaugeBar
          key={key}
          label={str(n.label)}
          value={value}
          max={max}
          color={str(n.color)}
          format={str(n.format)}
        />
      );
    }
    case 'input':
      return <UiInput key={key} n={n} />;
    default:
      return null;
  }
}

function Body({ spec }: { spec: Spec }) {
  const count = { n: 0 };
  return <div className="lay-ui-body">{spec.body ? render(spec.body, 0, count) : null}</div>;
}

function useSpecs(): Spec[] {
  const raw = useLayoutData((s) => s.lua['ui.windows']);
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([id, v]) => ({ ...(v as Spec), id }));
}

/** Docked panels Lua opened with squat.ui.panel{dock = "right"}: put this inside the Dock that should hold them. */
export function LuaPanels(p: { dock?: string }) {
  const dock = p.dock ?? 'right';
  const specs = useSpecs().filter((s) => s.kind === 'panel' && (s.dock ?? 'right') === dock);
  if (specs.length === 0) return null;
  return (
    <>
      {specs.map((s) => (
        <Panel key={s.id} title={s.title} collapsible>
          <Body spec={s} />
        </Panel>
      ))}
    </>
  );
}

interface Place {
  x: number;
  y: number;
  w?: number;
  z: number;
}

/** Floating windows Lua opened with squat.ui.window{...}: drag by the title bar, close with the ×. */
export function LuaWindows() {
  const specs = useSpecs().filter((s) => s.kind !== 'panel');
  const setVar = useSetVar();
  const all = useLayoutData((s) => s.lua['ui.windows']);
  const [place, setPlace] = useState<Record<string, Place>>({});
  const top = useRef(10);
  if (specs.length === 0) return null;

  const placeOf = (s: Spec, i: number): Place =>
    place[s.id] ?? { x: s.x ?? 90 + i * 28, y: s.y ?? 50 + i * 28, w: s.w, z: 10 };
  const raise = (id: string, base: Place): void =>
    setPlace((m) => ({ ...m, [id]: { ...base, z: ++top.current } }));
  const close = (id: string): void => {
    const rest = { ...(all as Record<string, unknown>) };
    delete rest[id];
    setVar('ui.windows', Object.keys(rest).length ? rest : null);
  };
  const drag = (e: ReactPointerEvent<HTMLDivElement>, s: Spec, base: Place): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX - base.x;
    const sy = e.clientY - base.y;
    const move = (m: PointerEvent): void =>
      setPlace((o) => ({
        ...o,
        [s.id]: { ...base, x: Math.max(0, m.clientX - sx), y: Math.max(0, m.clientY - sy), z: top.current },
      }));
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    raise(s.id, base);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div className="lay-ui-layer">
      {specs.map((s, i) => {
        const pl = placeOf(s, i);
        const style: CSSProperties = { left: pl.x, top: pl.y, width: pl.w ?? s.w, height: s.h, zIndex: pl.z };
        return (
          <section
            key={s.id}
            className="lay-ui-window"
            style={style}
            role="dialog"
            aria-label={s.title ?? s.id}
            onPointerDown={() => raise(s.id, pl)}
          >
            <div className="lay-ui-titlebar" onPointerDown={(e) => drag(e, s, pl)}>
              <span>{s.title ?? s.id}</span>
              <button type="button" aria-label="Close" onClick={() => close(s.id)}>
                ×
              </button>
            </div>
            <Body spec={s} />
          </section>
        );
      })}
    </div>
  );
}
