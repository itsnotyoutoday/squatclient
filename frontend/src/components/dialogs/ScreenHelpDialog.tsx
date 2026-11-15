import { useScreenHelp } from '../../cmcp/pane';
import { Dialog } from './Dialog';

/** All console screens and which console provides each: the discovery list behind the screen menu's "More screens...". */
export function ScreenHelpHost() {
  const rows = useScreenHelp((s) => s.rows);
  if (!rows) return null;
  return (
    <Dialog title="Console screens" onClose={() => useScreenHelp.getState().close()} footer={<button type="button" className="primary" onClick={() => useScreenHelp.getState().close()}>Close</button>}>
      <p className="hint">The menu lists what this console can show. Other screens need another console: type <code>man &lt;console&gt;</code>.</p>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.title}</td>
              <td>{r.available ? 'this console' : `man ${r.console}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
