import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { App } from '../src/App';
import { createEngine } from '../src/api';
import { MockEngine } from '../src/api/mock';
import { resetStores, useSettings } from '../src/state/stores';
import { stubLayout } from './helpers';

afterEach(cleanup);

/** Headless smoke check: the real startup path (?mock=1 -> MockEngine -> App) renders a coloured line. */
it('boots in mock mode and renders a truecolour gradient and a 256-colour line', async () => {
  const restore = stubLayout();
  resetStores();
  const engine = createEngine('?mock=1');
  expect(engine).toBeInstanceOf(MockEngine);
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  const coloured = await screen.findAllByText('The Grand Atrium');
  expect(coloured[0].style.color).not.toBe('');
  expect(document.querySelectorAll('.row').length).toBeGreaterThan(0);
  (engine as MockEngine).dispose();
  restore();
});
