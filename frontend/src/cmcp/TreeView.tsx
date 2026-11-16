import type { CmcpNode, CmcpTree } from './types';
import { cell, entries } from './widgets';

// A CMCP layout drawn with ordinary page elements (text, tables, buttons, bars), like the rest of the app: no scene, no frame. It is how SquatClient
// shows the contexts that are not ship consoles (a place such as the concourse, a ship room, a dock pane). The widgets it knows are the plain ones;
// the console-only widgets (schematics, viewscreens, scopes) are skipped, and the `textport` is never drawn here: the game text is the output pane.

type Send = (path: string, event: string, value?: unknown) => void;
const str = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));

const columnsOf = (v: unknown): { key: string; title: string }[] =>
  Array.isArray(v)
    ? (v as Record<string, unknown>[]).map((c) => ({ key: str(c.key), title: str(c.title ?? c.key) }))
    : [];

function Table({ n, send, readonly }: { n: CmcpNode; send: Send; readonly: boolean }) {
  const pr = n.props;
  let cols = columnsOf(pr.columns);
  if (cols.length === 0) cols = [{ key: 'name', title: 'Name' }];
  const rows = entries(pr.rows ?? pr.contacts);
  if (!Array.isArray(pr.rows) && !cols.some((c) => c.key === 'name' || c.key === 'cid' || c.key === '_key'))
    cols = [{ key: '_key', title: '' }, ...cols];
  const selected = pr.selected === undefined || pr.selected === null ? null : String(pr.selected);
  const selectable = pr.selectable === true && !!n.events?.includes('select') && !readonly && n.enabled;
  return (
    <table className="cmcp-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>{c.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => {
          const o = (v ?? {}) as Record<string, unknown>;
          const value = typeof o.cid === 'number' ? o.cid : k;
          const sel = selected !== null && (selected === k || selected === String(o.cid));
          return (
            <tr
              key={k}
              className={`${sel ? 'sel' : ''}${selectable ? ' pick' : ''}`}
              aria-selected={selectable ? sel : undefined}
              tabIndex={selectable ? 0 : undefined}
              onClick={selectable ? () => send(n.path, 'select', value) : undefined}
              onKeyDown={
                selectable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        send(n.path, 'select', value);
                      }
                    }
                  : undefined
              }
            >
              {cols.map((c) => (
                <td key={c.key}>{c.key === '_key' ? k : cell(o[c.key])}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Bar({ n }: { n: CmcpNode }) {
  const pr = n.props;
  const max = typeof pr.max === 'number' && pr.max > 0 ? pr.max : 100;
  const f = typeof pr.value === 'number' ? Math.max(0, Math.min(1, pr.value / max)) : null;
  const text =
    pr.text !== undefined && pr.text !== null
      ? str(pr.text)
      : typeof pr.value === 'number'
        ? `${cell(pr.value)}${typeof pr.max === 'number' ? ' / ' + cell(pr.max) : ''}`
        : '-';
  return (
    <div className="cmcp-bar">
      <span className="cmcp-bar-label">{str(pr.label)}</span>
      <span
        className="cmcp-bar-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={typeof pr.value === 'number' ? pr.value : undefined}
        aria-label={str(pr.label) || undefined}
      >
        <span
          className={`cmcp-bar-fill tone-${str(pr.tone) || 'accent'}`}
          style={{ width: `${(f ?? 0) * 100}%` }}
        />
      </span>
      <span className="cmcp-bar-text">{text}</span>
    </div>
  );
}

function Node({ n, send, readonly }: { n: CmcpNode; send: Send; readonly: boolean }) {
  switch (n.widget) {
    case 'textport': // the game text is the output pane; it is never drawn twice
    case 'schematic':
    case 'viewscreen':
    case 'scope':
    case 'joystick':
    case 'lights':
      return null;
    case 'table':
    case 'list':
    case 'contact-picker':
      return <Table n={n} send={send} readonly={readonly} />;
    case 'bar':
      return <Bar n={n} />;
    case 'button': {
      const on = n.enabled && !readonly;
      return (
        <button
          type="button"
          className={`cmcp-btn tone-${str(n.props.tone) || 'accent'}`}
          disabled={!on}
          onClick={() => send(n.path, 'click')}
        >
          {str(n.props.text)}
        </button>
      );
    }
  }
  const text = str(n.props.text);
  const kids = n.children ?? [];
  if (!text && kids.length === 0) return null;
  const style = str(n.props.style);
  const row = n.layout?.dir === 'row';
  const wrap = (c: CmcpNode): React.ReactNode => (
    <div
      key={c.path}
      className="cmcp-cell"
      style={c.layout?.weight ? { flex: `${c.layout.weight} 1 0`, minWidth: 0 } : undefined}
    >
      <Node n={c} send={send} readonly={readonly} />
    </div>
  );
  return (
    <div className={`cmcp-box ${row ? 'row' : 'col'}`} style={{ gap: n.layout?.gap ?? 6 }}>
      {text && <p className={`cmcp-text ${style}`}>{text}</p>}
      {kids.map(wrap)}
    </div>
  );
}

/** The screen's own colours and fonts (the game's theme, resolved by the engine) as CSS variables, so a pane looks like the game and not
 * like the app's chrome. A token the theme does not set falls back to the app's own colour in the stylesheet. */
const TOKEN_VARS: [string, string][] = [
  ['color.text', '--cmcp-text'],
  ['color.dim', '--cmcp-dim'],
  ['color.accent', '--cmcp-accent'],
  ['color.accent2', '--cmcp-accent2'],
  ['color.ok', '--cmcp-ok'],
  ['color.warn', '--cmcp-warn'],
  ['color.alert', '--cmcp-alert'],
  ['color.panel', '--cmcp-panel'],
];
function themeVars(tree: CmcpTree): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const [token, name] of TOKEN_VARS) {
    const v = tree.tokens?.[token];
    if (typeof v === 'string' && v) out[name] = v;
  }
  // only the headings take the theme's display font: the body is the window's own game font, so columns a game aligns with spaces line up
  const title = tree.tokens?.['font.title'];
  if (typeof title === 'string' && title) out['--cmcp-font-title'] = `"${title}", var(--font, monospace)`;
  return out as React.CSSProperties;
}

/** One CMCP layout as page elements. `send` carries a widget event (a click on a button, a chosen table row) to the engine. */
export function TreeView({ tree, readonly, send }: { tree: CmcpTree; readonly?: boolean; send: Send }) {
  return (
    <div className="cmcp-tree" style={themeVars(tree)}>
      <Node n={tree.root} send={send} readonly={!!readonly} />
    </div>
  );
}
