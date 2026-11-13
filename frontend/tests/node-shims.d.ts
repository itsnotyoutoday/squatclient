// Tests read a stylesheet from disk (jsdom/vitest replaces imported CSS with nothing).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
