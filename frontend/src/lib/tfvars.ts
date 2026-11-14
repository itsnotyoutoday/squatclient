/**
 * TinyFugue variables that shape the output window: wrap, wrapsize, wrapspace, wrappunct, visual.
 * The engine reports changes ("tfvar" event); they become CSS on the document so every output pane follows.
 * wrap=off keeps long lines on one line (the pane scrolls sideways); wrapsize=N limits lines to N columns;
 * wrapspace=N indents the continuation lines by N columns.
 */
export interface TfVars {
  wrap: boolean;
  wrapsize: number;
  wrapspace: number;
  visual: boolean;
}

export const tfVars: TfVars = { wrap: true, wrapsize: 0, wrapspace: 4, visual: false };

const truthy = (v: string): boolean => !/^(0|off|no|false)$/i.test(v.trim());

export function applyTfVar(name: string, value: string, root: HTMLElement = document.documentElement): void {
  switch (name) {
    case 'wrap':
      tfVars.wrap = truthy(value);
      break;
    case 'wrapsize':
      tfVars.wrapsize = Math.max(0, parseInt(value, 10) || 0);
      break;
    case 'wrapspace':
      tfVars.wrapspace = Math.max(0, parseInt(value, 10) || 0);
      break;
    case 'visual':
      tfVars.visual = truthy(value);
      return;
    default:
      return;
  }
  root.dataset.tfWrap = tfVars.wrap ? 'on' : 'off';
  root.style.setProperty('--tf-wrapsize', tfVars.wrapsize > 0 ? `${tfVars.wrapsize}ch` : 'none');
  root.style.setProperty('--tf-wrapspace', `${tfVars.wrapspace}ch`);
}
