import { MockEngine } from '../src/api/mock';
import { resetStores, useSessions, useUi } from '../src/state/stores';
import { resetEditor } from '../src/state/editorStore';

/** A MockEngine with one connected session, registered in the stores. */
export async function setupEditor(): Promise<{ engine: MockEngine; sid: string }> {
  resetStores();
  resetEditor();
  const engine = new MockEngine({ scenario: 'empty' });
  useUi.getState().setEngine(engine);
  const info = await engine.connect({ worldId: 'w-moon' });
  useSessions.getState().upsert({ ...info, state: 'connected' });
  return { engine, sid: info.id };
}
