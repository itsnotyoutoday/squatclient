import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MockEngine } from '../src/api/mock';
import type { EngineEventName, EngineEvents } from '../src/api/types';
import { resetLayoutData, useLayoutData } from '../src/layout/store';
import { resetStores, useSessions, useSettings } from '../src/state/stores';
import { clearHistories } from '../src/state/history';
import { stubLayout } from './helpers';
import evenniaSession from './fixtures/evennia-session.jsonl?raw';

let restore: () => void;
let engine: MockEngine;
beforeEach(() => {
  restore = stubLayout();
  resetStores();
  resetLayoutData();
  clearHistories();
});
afterEach(() => {
  cleanup();
  engine?.dispose();
  restore();
});

async function boot(layout?: string): Promise<{ engine: MockEngine; sid: string }> {
  engine = new MockEngine({ scenario: 'demo' });
  render(<App engine={engine} />);
  await waitFor(() => expect(useSettings.getState().loaded).toBe(true));
  await waitFor(() => expect(useSessions.getState().fg).toBeTruthy());
  if (layout) act(() => useSettings.setState({ settings: { ...useSettings.getState().settings, layout } }));
  return { engine, sid: useSessions.getState().fg as string };
}

function push<E extends EngineEventName>(e: MockEngine, name: E, payload: EngineEvents[E]): void {
  act(() => (e as unknown as { emit: (n: E, p: EngineEvents[E]) => void }).emit(name, payload));
}

describe('layouts', () => {
  it('the classic layout is the app as it was: output and input line, no panels', async () => {
    await boot();
    expect(screen.getByLabelText('Command input')).toBeInTheDocument();
    expect(document.querySelector('.lay-dock')).toBeNull();
  });

  it('engine GMCP events fill the store; a sidebar layout shows panels only once the data exists', async () => {
    const { engine: e, sid } = await boot('sidebar');
    // nothing reported yet: the dock is empty and hidden by CSS (:empty)
    const dock = document.querySelector('.lay-dock-right') as HTMLElement;
    expect(dock).not.toBeNull();
    expect((dock.querySelector('.lay-dock-inner') ?? dock).childElementCount).toBe(0);
    push(e, 'gmcp', {
      session: sid,
      package: 'Char.Vitals',
      data: { hp: 80, maxhp: 100, mp: 20, maxmp: 50 },
    });
    const hp = await screen.findByRole('progressbar', { name: 'HP' });
    expect(hp).toHaveAttribute('aria-valuenow', '80');
    expect(hp).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByRole('progressbar', { name: 'MP' })).toHaveAttribute('aria-valuenow', '20');
    // an update redraws the gauge
    push(e, 'gmcp', { session: sid, package: 'Char.Vitals', data: { hp: 35 } });
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'HP' })).toHaveAttribute('aria-valuenow', '35'),
    );
    expect(screen.getByRole('progressbar', { name: 'MP' })).toHaveAttribute('aria-valuenow', '20'); // merged, not replaced
  });

  it("understands other games' names: Aardwolf style and MSDP", async () => {
    const { engine: e, sid } = await boot('sidebar');
    push(e, 'gmcp', { session: sid, package: 'char.vitals', data: { hp: 900, mana: 400, moves: 300 } });
    push(e, 'gmcp', {
      session: sid,
      package: 'char.maxstats',
      data: { maxhp: 1000, maxmana: 500, maxmoves: 600 },
    });
    expect(await screen.findByRole('progressbar', { name: 'HP' })).toHaveAttribute('aria-valuenow', '900');
    expect(screen.getByRole('progressbar', { name: 'MV' })).toHaveAttribute('aria-valuemax', '600');
    act(() => useLayoutData.getState().drop(sid));
    push(e, 'msdp', { session: sid, vars: { HEALTH: '70', HEALTH_MAX: '90' } });
    expect(await screen.findByRole('progressbar', { name: 'HP' })).toHaveAttribute('aria-valuenow', '70');
  });

  it('the room panel shows name, description and clickable exits that send the direction', async () => {
    const { engine: e, sid } = await boot('sidebar');
    push(e, 'gmcp', {
      session: sid,
      package: 'Room.Info',
      data: {
        name: 'Plaza',
        area: 'Town',
        desc: 'A busy square.',
        exits: { north: 7, south: 2 },
        players: ['Ann'],
      },
    });
    expect(await screen.findByRole('heading', { name: 'Plaza' })).toBeInTheDocument();
    expect(screen.getByText('A busy square.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'north' }));
    expect(engine.sent.some((s) => s.text === 'north')).toBe(true);
  });

  it('inventory and chat panels follow Char.Items.* and Comm.Channel.Text', async () => {
    const { engine: e, sid } = await boot('sidebar');
    push(e, 'gmcp', {
      session: sid,
      package: 'Char.Items.List',
      data: { location: 'inv', items: [{ id: 1, name: 'lamp' }] },
    });
    push(e, 'gmcp', {
      session: sid,
      package: 'Comm.Channel.Text',
      data: { channel: 'say', talker: 'Bob', text: 'hello all' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'lamp' }));
    expect(engine.sent.some((s) => s.text === 'look lamp')).toBe(true);
    expect(await screen.findByText('hello all')).toBeInTheDocument();
    push(e, 'gmcp', { session: sid, package: 'Char.Items.Remove', data: { location: 'inv', item: 1 } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'lamp' })).toBeNull());
  });

  it('a layout that fails the shell check is replaced by the classic one with a notice', async () => {
    const { LayoutHost } = await import('../src/layout/host');
    const { App: LApp, Mush } = await import('../src/layout/components');
    const { sid } = await boot();
    const session = useSessions.getState().sessions[sid];
    const Bad = () => (
      <LApp>
        <Mush />
      </LApp>
    ); // no input bar
    const { container } = render(<LayoutHost session={session} layoutId="bad" Custom={Bad} />);
    expect(await within(container).findByRole('alert')).toHaveTextContent(
      /exactly one <Mush \/> and one <InputBar \/>/,
    );
  });

  it('an unknown layout id and a layout that throws both fall back to classic', async () => {
    const { LayoutHost } = await import('../src/layout/host');
    const { sid } = await boot();
    const session = useSessions.getState().sessions[sid];
    const a = render(<LayoutHost session={session} layoutId="nope" />);
    expect(await within(a.container).findByRole('alert')).toHaveTextContent(/no layout named "nope"/);
    const Boom = () => {
      throw new Error('kaput');
    };
    const b = render(<LayoutHost session={session} layoutId="boom" Custom={Boom} />);
    expect(await within(b.container).findByRole('alert')).toHaveTextContent(/kaput/);
  });
});

// the real recorded Evennia session drives the demo layout
describe('the Evennia demo layout', () => {
  it('draws the character, vitals, room, inventory, chat and buttons from real game data', async () => {
    const { engine: e, sid } = await boot('evennia-demo');
    for (const l of evenniaSession.trim().split('\n')) {
      const ev = JSON.parse(l) as { kind: string; package?: string; data?: unknown };
      if (ev.kind === 'gmcp' && ev.package)
        push(e, 'gmcp', { session: sid, package: ev.package, data: ev.data });
    }
    expect(await screen.findByText('Wanderer')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'HP' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'XP' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Limbo' })).toBeInTheDocument();
    expect(screen.getByText('anyone here?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Heal' }));
    expect(engine.sent.some((s) => s.text === 'heal')).toBe(true);
  });
});
