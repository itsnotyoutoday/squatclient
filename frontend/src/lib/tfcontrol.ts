import type { SessionInfo, TFInfo, TFInput, TFPreset } from '../api/types';

/** True when this client may type into the session (always, except when TinyFugue keeps the keyboard). */
export function canType(s: Pick<SessionInfo, 'tf'> | undefined): boolean {
  return !s?.tf || s.tf.input !== 'tf';
}

const INPUT_LABEL: Record<TFInput, string> = { tf: 'TinyFugue', remote: 'You', both: 'Both' };
const INPUT_SHORT: Record<TFInput, string> = { tf: 'TF', remote: 'You', both: 'Both' };

/** Who holds the keyboard, in words: "TinyFugue", "You" (this client) or "Both". */
export function inputLabel(tf: TFInfo): string {
  return INPUT_LABEL[tf.input] ?? tf.input;
}

/** The same, short enough for a tab. */
export function inputShort(tf: TFInfo): string {
  return INPUT_SHORT[tf.input] ?? tf.input;
}

/** Who runs triggers and macros: "TinyFugue" or "This app". */
export function automationLabel(tf: TFInfo): string {
  return tf.automation === 'client' ? 'This app' : 'TinyFugue';
}

/** True when this client is doing something on the connection (typing or running triggers). */
export function clientActive(tf: TFInfo): boolean {
  return tf.input !== 'tf' || tf.automation === 'client';
}

/** What the controls say in words (status bar tooltip, screen readers). */
export function describeControl(tf: TFInfo): string {
  const typing =
    tf.input === 'tf'
      ? 'TinyFugue has the keyboard; this client only watches'
      : tf.input === 'remote'
        ? 'this client has the keyboard; TinyFugue’s own keyboard is off'
        : 'you and TinyFugue can both type';
  const auto =
    tf.automation === 'client' ? 'this client runs triggers' : 'TinyFugue runs triggers';
  return `${typing}; ${auto}`;
}

/** The preset the current state equals, if any. */
export function currentPreset(tf: TFInfo): TFPreset | undefined {
  if (tf.input === 'tf' && tf.automation === 'tf') return 'viewer';
  if (tf.input === 'both' && tf.automation === 'tf') return 'copilot';
  if (tf.input === 'remote' && tf.automation === 'tf') return 'takeover';
  if (tf.input === 'remote' && tf.automation === 'client') return 'full';
  return undefined;
}

export const PRESETS: { id: TFPreset; label: string; hint: string }[] = [
  { id: 'viewer', label: 'Watch only', hint: 'TinyFugue keeps the keyboard and runs triggers' },
  { id: 'copilot', label: 'Type too', hint: 'Both of you can type; TinyFugue runs triggers' },
  { id: 'takeover', label: 'Take the keyboard', hint: 'Only this client types; TinyFugue still runs triggers' },
  { id: 'full', label: 'Take over fully', hint: 'Only this client types and runs triggers' },
];
