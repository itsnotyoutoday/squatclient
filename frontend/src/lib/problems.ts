import { redact } from './redact';

/** A bounded in-memory log of recent client problems, shown in Help > Diagnostics. Never persisted. */
export interface Problem {
  /** ms since epoch of the first occurrence */
  ts: number;
  source: 'error' | 'rejection' | 'toast' | 'engine' | 'render';
  /** already redacted */
  message: string;
  /** repeats of the same message in a row */
  count: number;
}

export const MAX_PROBLEMS = 200;
const REPEAT_WINDOW_MS = 5000;
const MAX_LEN = 400;

let log: Problem[] = [];

export function recordProblem(source: Problem['source'], message: unknown, now: number = Date.now()): void {
  let text: string;
  if (message instanceof Error)
    text = message.stack
      ? `${message.message} @ ${message.stack.split('\n')[1]?.trim() ?? ''}`
      : message.message;
  else if (typeof message === 'string') text = message;
  else {
    try {
      text = JSON.stringify(message) ?? String(message);
    } catch {
      text = String(message);
    }
  }
  const clean = redact(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_LEN);
  const last = log[log.length - 1];
  if (last && last.message === clean && now - last.ts < REPEAT_WINDOW_MS) {
    last.count++;
    return;
  }
  log.push({ ts: now, source, message: clean, count: 1 });
  if (log.length > MAX_PROBLEMS) log = log.slice(log.length - MAX_PROBLEMS);
}

export function getProblems(): readonly Problem[] {
  return log;
}

export function clearProblems(): void {
  log = [];
}

let installed = false;

/** Listen for uncaught errors and unhandled promise rejections (once). */
export function installProblemCapture(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (e: ErrorEvent) => {
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '';
    recordProblem('error', `${e.message || 'error'}${where}`);
  });
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
    recordProblem('rejection', e.reason),
  );
}
