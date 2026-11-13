const REASONS: Record<string, string> = {
  remote_closed: 'The server closed the connection',
  reset: 'The connection was reset by the server',
  timeout: 'The connection timed out',
  tls_error: 'A TLS/security error occurred',
  connect_failed: 'Could not connect to the server',
  client_quit: 'You disconnected',
  squatter_stopped: 'The squatter relay stopped',
};

export function humanizeReason(reason: string | undefined): string {
  if (!reason) return 'The connection ended';
  return REASONS[reason] ?? reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function formatTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
