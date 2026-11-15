import { useEffect, useRef, useState } from 'react';
import { useUi } from '../state/stores';
import { viewFit } from '../gfx/port';
import { useOverlays, type Overlay } from './overlays';

function Field({ session, o, k }: { session: string; o: Overlay; k: { sx: number; sy: number; ox: number; oy: number } }) {
  const engine = useUi((s) => s.engine);
  const [text, setText] = useState(o.value);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(o.value), [o.value]);
  const submit = (): void => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < o.min || n > o.max || (o.kind === 'int' && !Number.isInteger(n))) { setBad(true); return; }
    setBad(false);
    void engine?.cmcpEvent(session, o.path, o.event, o.build(n)).catch(() => setBad(true));
  };
  return (
    <input
      className="cmcp-field"
      aria-label={o.label}
      inputMode="decimal"
      aria-invalid={bad}
      value={text}
      style={{ left: o.x * k.sx + k.ox, top: o.y * k.sy + k.oy, width: o.w * k.sx, height: o.h * k.sy }}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing must not trigger the scene's Alt+key shortcuts or the window's keys
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** The overlay inputs of one session's CMCP scene. Rendered inside the scene box; positions follow the scene's fit. */
export function CmcpOverlays({ session, fit }: { session: string; fit: 'contain' | 'cover' | 'stretch' | 'none' }) {
  const entry = useOverlays((s) => s.by[session]);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  if (!entry || entry.items.length === 0 || box.w <= 0) return <div ref={ref} />;
  const k = viewFit({ w: entry.w, h: entry.h, fit }, box.w, box.h);
  return (
    <div ref={ref}>
      {entry.items.map((o) => <Field key={o.id} session={session} o={o} k={k} />)}
    </div>
  );
}
