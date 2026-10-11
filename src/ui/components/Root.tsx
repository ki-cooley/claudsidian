import type { JSX } from 'preact';

declare const __CLAUDSIDIAN_VERSION__: string;

export interface RootProps {
  version?: string;
}

/** Placeholder root; replaced by the real router (sessions list / chat) in the UI tasks. */
export function Root(props: RootProps): JSX.Element {
  const version = props.version ?? (typeof __CLAUDSIDIAN_VERSION__ === 'string' ? __CLAUDSIDIAN_VERSION__ : 'dev');
  return (
    <div class="claudsidian-root">
      <div class="claudsidian-empty">Claudsidian {version}: skeleton loaded.</div>
    </div>
  );
}
