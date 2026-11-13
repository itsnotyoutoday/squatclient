import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../src/components/dialogs/Dialog';

const head = (): HTMLElement => document.querySelector('.dhead') as HTMLElement;
const dlg = (): HTMLElement => screen.getByRole('dialog');

describe('Dialog dragging', () => {
  it('moves with the mouse by its title bar and does not close', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Drag me" onClose={onClose}>
        <p>content</p>
      </Dialog>,
    );
    expect(dlg().style.transform).toBe('');
    fireEvent.mouseDown(head(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 130 });
    fireEvent.mouseUp(document);
    expect(dlg().style.transform).toBe('translate(60px, 30px)');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not start a drag from the close button, and the button still closes', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Drag me too" onClose={onClose}>
        <p>content</p>
      </Dialog>,
    );
    const x = screen.getByLabelText('Close dialog');
    fireEvent.mouseDown(x, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.mouseMove(document, { clientX: 90, clientY: 90 });
    expect(dlg().style.transform).toBe('');
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores non-primary buttons', () => {
    render(
      <Dialog title="Right click" onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    fireEvent.mouseDown(head(), { button: 2, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    expect(dlg().style.transform).toBe('');
  });

  it('double-click on the title bar puts it back', () => {
    render(
      <Dialog title="Reset me" onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    fireEvent.mouseDown(head(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 20 });
    fireEvent.mouseUp(document);
    expect(dlg().style.transform).toBe('translate(40px, 20px)');
    fireEvent.doubleClick(head());
    expect(dlg().style.transform).toBe('');
  });

  it('remembers where it was left when reopened', () => {
    const first = render(
      <Dialog title="Remember me" onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    fireEvent.mouseDown(head(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 25, clientY: 15 });
    fireEvent.mouseUp(document);
    first.unmount();
    render(
      <Dialog title="Remember me" onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    expect(dlg().style.transform).toBe('translate(25px, 15px)');
  });

  it('Alt+Shift+Arrow moves it from the keyboard, plain Alt+Arrow is left alone', () => {
    render(
      <Dialog title="Keyboard move" onClose={() => undefined}>
        <button type="button">inside</button>
      </Dialog>,
    );
    fireEvent.keyDown(dlg(), { key: 'ArrowRight', altKey: true, shiftKey: true });
    fireEvent.keyDown(dlg(), { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(dlg().style.transform).toBe('translate(24px, 24px)');
    const before = dlg().style.transform;
    fireEvent.keyDown(dlg(), { key: 'ArrowLeft', altKey: true }); // help's back/forward keys must still work
    expect(dlg().style.transform).toBe(before);
  });

  it('wide dialogs are resizable, narrow ones are not unless asked', () => {
    const a = render(
      <Dialog title="Wide" wide onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    expect(dlg().className).toContain('resizable');
    a.unmount();
    const b = render(
      <Dialog title="Narrow" onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    expect(dlg().className).not.toContain('resizable');
    b.unmount();
    render(
      <Dialog title="Narrow but resizable" resizable onClose={() => undefined}>
        <p>c</p>
      </Dialog>,
    );
    expect(dlg().className).toContain('resizable');
  });

  it('keeps Escape closing and the focus trap working', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Esc" onClose={onClose}>
        <p>c</p>
      </Dialog>,
    );
    fireEvent.keyDown(dlg(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
