/** A failure in the stream (assistant error, aborted request, rejected control request). */
import type { JSX } from 'preact';
import type { ErrorItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

export function ErrorLine(p: { item: ErrorItem }): JSX.Element {
  return (
    <div class="claudsidian-error" role="alert">
      <Icon name="alert-triangle" size="small" />
      <span>{p.item.text}</span>
    </div>
  );
}
