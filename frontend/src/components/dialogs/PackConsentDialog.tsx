import { usePackPrompts } from '../../cmcp/prompts';
import { useUi } from '../../state/stores';
import { Dialog } from './Dialog';

/** "This game wants to use its interface 'x' 1.0.0 from host. Allow?" (cmcp spec 8.8). Asked once per game and pack; the built-in
 * screens stay until the answer. Declining keeps them. */
export function PackConsentHost() {
  const prompt = usePackPrompts((s) => s.prompts[0]);
  const engine = useUi((s) => s.engine);
  if (!prompt) return null;
  const answer = (allow: boolean): void => {
    usePackPrompts.getState().remove(prompt.session, prompt.id);
    void engine?.cmcpPackConsent(prompt.session, prompt.id, allow).catch(() => undefined);
  };
  return (
    <Dialog
      title="Game interface"
      onClose={() => answer(false)}
      footer={
        <>
          <button type="button" onClick={() => answer(false)}>
            Not now
          </button>
          <button type="button" className="primary" onClick={() => answer(true)} autoFocus>
            Allow
          </button>
        </>
      }
    >
      <p>
        This game wants to use its own interface <strong>{prompt.id}</strong> {prompt.version} from <strong>{prompt.host || 'the game'}</strong>.
      </p>
      <p className="hint">
        {prompt.signed ? 'It carries a signature that checks out, from a signer you have not trusted before.' : 'It is not signed.'} It is a screen description (no
        code); the built-in screens are used until you allow it, and you are asked once for this game and pack.
      </p>
    </Dialog>
  );
}
