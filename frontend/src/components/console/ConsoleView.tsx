import { useRef, useState } from 'react';
import { OutputPane } from '../output/OutputPane';
import { CONSOLE_ID, useUi } from '../../state/stores';

/**
 * The Console: the client's own screen, like a Home tab. It shows the start-up output (banner, library and startup.tf loading lines and their
 * errors), whatever scripts print with no world, and has a command line that runs TinyFugue commands with no world. It is the screen while no
 * world is open and always the first tab.
 */
export function ConsoleView() {
  const engine = useUi((s) => s.engine);
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const at = useRef(-1);

  const submit = (): void => {
    const line = text;
    if (!line.trim()) return;
    history.current = [line, ...history.current.filter((h) => h !== line)].slice(0, 100);
    at.current = -1;
    setText('');
    void engine?.consoleInput(line).catch((e: unknown) => useUi.getState().toast('error', String(e instanceof Error ? e.message : e)));
  };

  return (
    <main className="console" aria-label="Console" data-testid="console">
      <div className="console-bar">
        <span className="console-title">Console</span>
        <span className="console-actions">
          <button type="button" className="primary" onClick={() => useUi.getState().openDialog('worlds')}>
            Worlds
          </button>
          <button type="button" onClick={() => useUi.getState().openDialog('quick')}>
            Quick connect
          </button>
        </span>
      </div>
      <div className="console-out">
        <OutputPane sessionId={CONSOLE_ID} />
      </div>
      <form
        className="console-in"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          type="text"
          aria-label="Console command line"
          placeholder="A TinyFugue command, for example /help or /connect world"
          value={text}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.current.length) {
              e.preventDefault();
              at.current = Math.min(at.current + 1, history.current.length - 1);
              setText(history.current[at.current] ?? '');
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              at.current = Math.max(at.current - 1, -1);
              setText(at.current < 0 ? '' : (history.current[at.current] ?? ''));
            }
          }}
        />
      </form>
    </main>
  );
}
