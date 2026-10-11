/**
 * Root: the view's top-level router. Signed out shows the sign-in card; signed in shows the sessions list
 * (which owns the new-session sheet) until a session is selected, then the chat screen.
 */
import { useSignal, type Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { SessionStoreApi } from '../../core/store-api';
import type { PluginFacade } from '../facade';
import { ChatScreen, SessionsScreen, SignedOutCard } from './screens';

export interface RootProps {
  store: SessionStoreApi;
  facade: PluginFacade;
  onRename: (id: string) => void;
  onArchive: (id: string) => void;
  /** The "New session" command's toggle, shared with the plugin (plugin.ui.showNewSession); the sessions screen reads it. */
  showNewSession?: Signal<boolean>;
}

export function Root(p: RootProps): JSX.Element {
  const { store, facade } = p;
  const signedIn = useSignal(facade.auth.isSignedIn());
  useEffect(() => {
    signedIn.value = facade.auth.isSignedIn();
    return facade.auth.onChange((state) => {
      signedIn.value = state !== null;
    });
  }, [facade, signedIn]);

  if (!signedIn.value) {
    return (
      <div class="claudsidian-root">
        <SignedOutCard facade={facade} />
      </div>
    );
  }

  const selected = store.selectedId.value;
  if (selected === null) {
    return (
      <div class="claudsidian-root">
        <SessionsScreen
          store={store}
          facade={facade}
          onOpen={(id) => void store.open(id)}
          onRename={p.onRename}
          onArchive={p.onArchive}
          showNewSession={p.showNewSession}
        />
      </div>
    );
  }

  return (
    <div class="claudsidian-root">
      <ChatScreen
        store={store}
        facade={facade}
        sessionId={selected}
        onBack={() => store.close()}
        onRename={() => p.onRename(selected)}
        onArchive={() => p.onArchive(selected)}
      />
    </div>
  );
}
