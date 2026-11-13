import { useEffect, useRef, useState } from 'react';
import { getBuffer, useSessions, useSettings } from '../../state/stores';
import { lineText } from '../../lib/runs';

/** Screen-reader mirror: new lines of the foreground session, batched, in a polite live region. */
export function LiveRegion() {
  const enabled = useSettings((s) => s.settings.screenReader);
  const fg = useSessions((s) => s.fg);
  const version = useSessions((s) => (fg ? s.versions[fg] : 0));
  const [text, setText] = useState('');
  const lastSeq = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled || !fg) return;
    const buf = getBuffer(fg);
    if (sessionRef.current !== fg) {
      sessionRef.current = fg;
      lastSeq.current = buf.last; // do not read the backlog aloud
      return;
    }
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const b = getBuffer(fg);
      const fresh = b.lines.filter((l) => l.seq > lastSeq.current && l.kind !== 'echo');
      lastSeq.current = b.last;
      if (fresh.length)
        setText(
          fresh
            .slice(-50)
            .map((l) => lineText(l.spans))
            .filter(Boolean)
            .join('\n'),
        );
    }, 400);
  }, [enabled, fg, version]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!enabled) return null;
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-region">
      {text}
    </div>
  );
}
