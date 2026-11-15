import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PackConsentHost } from '../src/components/dialogs/PackConsentDialog';
import { collectPrompts, usePackPrompts } from '../src/cmcp/prompts';
import { MockEngine } from '../src/api/mock';
import { useUi } from '../src/state/stores';

describe('the pack consent question', () => {
  it('asks once per pack, sends the answer to the engine, and keeps asking for the next one', async () => {
    const engine = new MockEngine();
    useUi.setState({ engine });
    usePackPrompts.setState({ prompts: [] });
    render(<PackConsentHost />);
    expect(screen.queryByText('Game interface')).toBeNull();
    const note = { kind: 'pack-consent' as const, text: 'game.example', params: { trust: 'unsigned' }, pack: { id: 'fspace-std', kind: 'layout', version: '1.0.0', sha256: 'ab' } };
    act(() => {
      collectPrompts('s1', [note]);
      collectPrompts('s1', [note]); // announced twice: still one question
      collectPrompts('s1', [{ ...note, pack: { ...note.pack, id: 'fspace-klingon' } }]);
    });
    expect(usePackPrompts.getState().prompts).toHaveLength(2);
    expect(screen.getByText('fspace-std')).toBeTruthy();
    expect(screen.getByText(/not signed/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Allow'));
    await vi.waitFor(() => expect(engine.cmcpCalls.at(-1)).toMatchObject({ fn: 'cmcpPackConsent', session: 's1', args: ['fspace-std', true] }));
    expect(screen.getByText('fspace-klingon')).toBeTruthy();
    fireEvent.click(screen.getByText('Not now'));
    await vi.waitFor(() => expect(engine.cmcpCalls.at(-1)?.args).toEqual(['fspace-klingon', false]));
    expect(usePackPrompts.getState().prompts).toHaveLength(0);
  });
});
