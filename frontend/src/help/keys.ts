/** Human-readable name of a keymap binding: "C-a" -> "Ctrl-A", "M-Left" -> "Alt-Left", "S-Enter" -> "Shift-Enter". */
export function displayBinding(binding: string): string {
  const mods: string[] = [];
  let rest = binding;
  for (;;) {
    const m = /^([CMSD])-(.+)$/.exec(rest);
    if (!m) break;
    mods.push({ C: 'Ctrl', M: 'Alt', S: 'Shift', D: 'Cmd' }[m[1]] as string);
    rest = m[2];
  }
  const key = rest.length === 1 ? rest.toUpperCase() : rest;
  return [...mods, key].join('-');
}
