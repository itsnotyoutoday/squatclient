import type { KeyboardEvent } from 'react';

/** Arrow-key navigation inside a tablist: Left/Right (and Home/End) move focus to a sibling tab and activate it. */
export function tabListKeys(e: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  if (tabs.length === 0) return;
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  let n = i;
  if (e.key === 'ArrowLeft') n = i <= 0 ? tabs.length - 1 : i - 1;
  else if (e.key === 'ArrowRight') n = i >= tabs.length - 1 ? 0 : i + 1;
  else if (e.key === 'Home') n = 0;
  else n = tabs.length - 1;
  e.preventDefault();
  tabs[n].focus();
  tabs[n].click();
}
