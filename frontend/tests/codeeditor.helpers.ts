/** jsdom lacks the layout APIs CodeMirror measures with; stub the few it needs. */
export function installDomShims(): void {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const rects = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => rects;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
}

/** Dispatch a keydown the way a browser would on the editor's content element. */
export function pressKey(
  el: Element,
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  code = '',
): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}
