import { useUi } from '../../state/stores';
import { Dialog } from './Dialog';

const KEYS: [string, string][] = [
  ['Enter / Shift+Enter', 'Send line / insert newline'],
  ['Ctrl-A / Ctrl-E', 'Start / end of line'],
  ['Ctrl-B / Ctrl-F', 'Back / forward one character'],
  ['Alt-B / Alt-F', 'Back / forward one word'],
  ['Ctrl-W / Alt-D', 'Kill word backward / forward'],
  ['Ctrl-K / Ctrl-U', 'Kill to end / kill whole line'],
  ['Ctrl-Y', 'Yank (paste last kill)'],
  ['Ctrl-D / Ctrl-T', 'Delete character / transpose'],
  ['Up / Down, Ctrl-P / Ctrl-N', 'History (prefix search on what you typed)'],
  ['Escape', 'Clear input'],
  ['PageUp / PageDown', 'Scroll output (pauses live output)'],
  ['End (output focused) / button', 'Jump to live output'],
  ['Alt-1 .. Alt-9', 'Switch to session N'],
  ['Ctrl-Tab / Ctrl-Shift-Tab', 'Next / previous session'],
  ['Cmd-F, Ctrl-Shift-F', 'Search scrollback (Ctrl-F when output is focused)'],
  ['Ctrl-O', 'Open world manager'],
  ['Ctrl-,', 'Settings'],
];

export function HelpDialog() {
  return (
    <Dialog title="Keyboard shortcuts and about" onClose={() => useUi.getState().openDialog(null)} wide>
      <table className="keys">
        <tbody>
          {KEYS.map(([k, d]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        SquatClient: a graphical TinyFugue-style MU* client. Commands starting with / are handled by the
        engine, not the UI.
      </p>
    </Dialog>
  );
}
