import { prepareBlock, splitLines } from '../softcode';

export interface UploadOptions {
  /** setting softcodeJoin */
  join: boolean;
  /** setting stripBlankLines */
  stripBlank: boolean;
  /** Text put in front of every command (e.g. `@force me=`); usually empty. */
  prefix: string;
  /** Text appended to every command; usually empty. */
  suffix: string;
}

export interface PreparedUpload {
  /** The commands, in order, exactly as they will be sent. */
  lines: string[];
  /** Lines in the file. */
  sourceLines: number;
  /** Blank / `@@` comment lines dropped (only with stripBlank). */
  stripped: number;
  /** Continuation lines merged into the previous command (only with join). */
  joined: number;
}

const isBlankOrComment = (l: string): boolean => {
  const t = l.trim();
  return t === '' || t.startsWith('@@');
};

/** Turn a file's text into the commands that will be sent, with the same rules as editor mode. */
export function prepareUpload(text: string, o: UploadOptions): PreparedUpload {
  const src = splitLines(text);
  // a file that ends with a newline has a final empty "line" that is not a real line
  const sourceLines = src.length > 0 && src[src.length - 1] === '' ? src.length - 1 : src.length;
  const base = prepareBlock(text, { join: o.join, stripBlank: o.stripBlank });
  while (base.length > 0 && base[base.length - 1] === '') base.pop(); // the newline that ends the file
  const lines = o.prefix || o.suffix ? base.map((l) => (l === '' ? l : o.prefix + l + o.suffix)) : base;
  const stripped = o.stripBlank ? src.slice(0, sourceLines).filter(isBlankOrComment).length : 0;
  const kept = sourceLines - stripped;
  const joined = o.join && base.length > 0 ? Math.max(0, kept - base.length) : 0;
  return { lines, sourceLines, stripped, joined };
}
