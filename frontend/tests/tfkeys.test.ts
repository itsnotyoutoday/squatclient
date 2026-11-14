import { describe, expect, it } from 'vitest';
import { byteOffset, indexOfByte, isTfBound, setTfBindings, tfKeySeq } from '../src/lib/tfkeys';
import { applyTfVar, tfVars } from '../src/lib/tfvars';

const key = (
  k: string,
  o: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> & { code?: string } = {},
) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...o,
});

describe('TinyFugue key sequences', () => {
  it('names control, alt and function keys the way /bind does', () => {
    expect(tfKeySeq(key('a', { ctrlKey: true }))).toBe('^A');
    expect(tfKeySeq(key('[', { ctrlKey: true }))).toBe('^[');
    expect(tfKeySeq(key('x', { altKey: true }))).toBe('^[x');
    expect(tfKeySeq(key('∫', { altKey: true, code: 'KeyB' }))).toBe('^[b');
    expect(tfKeySeq(key('F1'))).toBe('^[[11~');
    expect(tfKeySeq(key('F5', { altKey: true }))).toBe('^[^[[15~');
    expect(tfKeySeq(key('ArrowUp'))).toBe('^[[A');
    expect(tfKeySeq(key('a'))).toBeNull();
    expect(tfKeySeq(key('a', { metaKey: true }))).toBeNull();
  });

  it('forwards only bound keys', () => {
    setTfBindings(['^A', '^[x']);
    expect(isTfBound('^A')).toBe(true);
    expect(isTfBound('^B')).toBe(false);
    setTfBindings([]);
    expect(isTfBound('^A')).toBe(false);
  });

  it('converts between string indexes and the engine byte offsets', () => {
    expect(byteOffset('héllo', 2)).toBe(3);
    expect(indexOfByte('héllo', 3)).toBe(2);
    expect(indexOfByte('héllo', 99)).toBe(5);
  });
});

describe('TinyFugue wrap variables', () => {
  it('drive the output window through CSS on the document', () => {
    const root = document.createElement('div');
    applyTfVar('wrap', 'off', root);
    expect(root.dataset.tfWrap).toBe('off');
    applyTfVar('wrap', '1', root);
    applyTfVar('wrapsize', '72', root);
    applyTfVar('wrapspace', '2', root);
    expect(root.dataset.tfWrap).toBe('on');
    expect(root.style.getPropertyValue('--tf-wrapsize')).toBe('72ch');
    expect(root.style.getPropertyValue('--tf-wrapspace')).toBe('2ch');
    applyTfVar('wrapsize', '0', root);
    expect(root.style.getPropertyValue('--tf-wrapsize')).toBe('none');
    expect(tfVars.wrapspace).toBe(2);
  });
});
