/** Shown instead of the sessions list when there is no account: one line of why, one button to sign in. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { PluginFacade } from '../../facade';
import { Button } from './primitives';

export function SignedOutCard(p: { facade: PluginFacade }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      await p.facade.signIn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="claudsidian-signed-out">
      <h3 class="claudsidian-signed-out-title">Sign in to Claude</h3>
      <p class="claudsidian-signed-out-text">
        Claudsidian talks to your Claude Code sessions through Remote Control. Sign in with the claude.ai account that
        runs them; the token stays in this vault's plugin data.
      </p>
      <Button primary label="Sign in" disabled={busy} onClick={() => void signIn()} />
    </div>
  );
}
