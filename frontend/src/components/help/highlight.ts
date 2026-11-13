/** Wrap case-insensitive occurrences of `terms` inside text nodes of `root` with <mark class="hit">. Returns the marks. */
export function highlightTerms(root: HTMLElement, terms: string[]): HTMLElement[] {
  const needles = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (needles.length === 0) return [];
  const re = new RegExp(needles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('button,mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.data;
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    let frag: DocumentFragment | null = null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      frag ??= document.createDocumentFragment();
      frag.append(text.slice(last, m.index));
      const mark = document.createElement('mark');
      mark.className = 'hit';
      mark.textContent = m[0];
      frag.append(mark);
      marks.push(mark);
      last = m.index + m[0].length;
    }
    if (frag) {
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }
  return marks;
}
