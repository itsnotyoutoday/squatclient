/** Small in-house line diff (LCS) for the conflict dialog and Compare. */

export type DiffOp = { kind: 'eq' | 'del' | 'add'; text: string };

/** Split into lines; the empty string is zero lines. */
export const toLines = (s: string): string[] => (s === '' ? [] : s.split(/\r\n|\r|\n/));

/** Line diff of `a` -> `b`: `del` lines only in a, `add` lines only in b. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const A = a.slice(lo, ea);
  const B = b.slice(lo, eb);
  const n = A.length;
  const m = B.length;
  const ops: DiffOp[] = a.slice(0, lo).map((text) => ({ kind: 'eq', text }));
  if (n * m > 4_000_000) {
    // pathological size: treat the middle as one replaced block
    for (const text of A) ops.push({ kind: 'del', text });
    for (const text of B) ops.push({ kind: 'add', text });
  } else {
    // lcs[i][j] = LCS length of A[i..] and B[j..]
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        ops.push({ kind: 'eq', text: A[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) ops.push({ kind: 'del', text: A[i++] });
      else ops.push({ kind: 'add', text: B[j++] });
    }
    while (i < n) ops.push({ kind: 'del', text: A[i++] });
    while (j < m) ops.push({ kind: 'add', text: B[j++] });
  }
  for (const text of a.slice(ea)) ops.push({ kind: 'eq', text });
  return ops;
}

export interface SideRow {
  kind: 'same' | 'changed' | 'left' | 'right';
  left?: { n: number; text: string };
  right?: { n: number; text: string };
}

/** Side-by-side rows: adjacent del/add runs are paired into `changed` rows. */
export function sideBySide(a: string, b: string): SideRow[] {
  const ops = diffLines(toLines(a), toLines(b));
  const rows: SideRow[] = [];
  let ln = 0;
  let rn = 0;
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op.kind === 'eq') {
      rows.push({ kind: 'same', left: { n: ++ln, text: op.text }, right: { n: ++rn, text: op.text } });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i].kind !== 'eq') {
      (ops[i].kind === 'del' ? dels : adds).push(ops[i].text);
      i++;
    }
    const k = Math.max(dels.length, adds.length);
    for (let x = 0; x < k; x++) {
      const l = x < dels.length ? { n: ++ln, text: dels[x] } : undefined;
      const r = x < adds.length ? { n: ++rn, text: adds[x] } : undefined;
      rows.push({ kind: l && r ? 'changed' : l ? 'left' : 'right', left: l, right: r });
    }
  }
  return rows;
}

export const countChanges = (rows: SideRow[]): number => rows.filter((r) => r.kind !== 'same').length;
