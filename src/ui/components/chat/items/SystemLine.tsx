/** A muted line for session events (started, compacted, retrying) and local command output. */
import type { JSX } from 'preact';
import type { SystemItem } from '../../../../core/types';

export function SystemLine(p: { item: SystemItem }): JSX.Element {
  const { item } = p;
  if (item.subtype === 'local_command' && item.text.includes('\n')) {
    return (
      <div class="claudsidian-system is-output" data-subtype={item.subtype}>
        <pre class="claudsidian-code">{item.text}</pre>
      </div>
    );
  }
  return (
    <div class={`claudsidian-system is-${item.subtype}`} data-subtype={item.subtype}>
      {item.text}
    </div>
  );
}
