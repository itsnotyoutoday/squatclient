/**
 * `/upload` is a UI feature, recognised before text reaches the engine (like `/help`).
 * Returns the argument ("" for a bare `/upload`, which opens the file picker) or null when the line
 * is not an upload command. Surrounding quotes around the path are removed; `~/` is expanded by
 * the app, not here.
 */
export function parseUploadCommand(line: string): string | null {
  const m = /^\s*\/upload(?:\s+([\s\S]*?))?\s*$/i.exec(line);
  if (!m) return null;
  let arg = (m[1] ?? '').trim();
  if (arg.length >= 2 && (arg[0] === '"' || arg[0] === "'") && arg.endsWith(arg[0])) arg = arg.slice(1, -1);
  return arg;
}
