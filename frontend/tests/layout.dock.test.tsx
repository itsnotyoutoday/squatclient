import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dock } from '../src/layout/components';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 230 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 100 });
  // jsdom has no PointerEvent: a mouse event under that name carries the coordinates
  (window as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {};
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterEach(cleanup);

const grip = (): HTMLElement => document.querySelector('.lay-grip') as HTMLElement;
const dock = (): HTMLElement => document.querySelector('.lay-dock') as HTMLElement;
const drag = (from: number, to: number): void => {
  fireEvent.pointerDown(grip(), { clientX: from, clientY: from, pointerId: 1 });
  fireEvent.pointerMove(grip(), { clientX: to, clientY: to, pointerId: 1 });
  fireEvent.pointerUp(grip(), { pointerId: 1 });
};

describe('<Dock resizable>', () => {
  it('has no grip unless asked', () => {
    render(<Dock width={200}>x</Dock>);
    expect(grip()).toBeNull();
  });
  it('a right dock grows when its edge is dragged left, within the limits, and remembers the size', () => {
    render(
      <Dock side="right" width={230} resizable min={150} max={300}>
        x
      </Dock>,
    );
    expect(dock().style.width).toBe('230px');
    drag(500, 450);
    expect(dock().style.width).toBe('280px');
    drag(500, 100); // would be 630: capped
    expect(dock().style.width).toBe('300px');
    expect(localStorage.getItem('squat.dock.right')).toBe('300');
    cleanup();
    render(
      <Dock side="right" width={230} resizable>
        x
      </Dock>,
    );
    expect(dock().style.width).toBe('300px'); // remembered
    fireEvent.doubleClick(grip());
    expect(dock().style.width).toBe('230px');
    expect(localStorage.getItem('squat.dock.right')).toBeNull();
  });
  it('a bottom dock is sized by height', () => {
    render(
      <Dock side="bottom" height={100} resizable>
        x
      </Dock>,
    );
    drag(500, 450);
    expect(dock().style.height).toBe('150px');
  });
});
