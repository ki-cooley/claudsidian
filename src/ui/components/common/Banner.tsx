/** The store's banner (offline, auth, error, info) as one line with an optional one-tap action. */
import type { JSX } from 'preact';
import type { Banner as BannerModel } from '../../../core/store-api';
import { Button } from './Button';
import { Icon } from './Icon';

const ICONS: Record<BannerModel['kind'], string> = {
  offline: 'wifi-off',
  auth: 'key-round',
  error: 'alert-triangle',
  info: 'info',
};

export function Banner(p: { banner: BannerModel | null }): JSX.Element | null {
  const banner = p.banner;
  if (!banner) return null;
  const alert = banner.kind === 'error' || banner.kind === 'auth';
  return (
    <div class={`claudsidian-banner is-${banner.kind}`} role={alert ? 'alert' : 'status'}>
      <Icon name={ICONS[banner.kind]} size="small" />
      <span class="claudsidian-banner-text">{banner.text}</span>
      {banner.action ? <Button label={banner.action.label} size="small" onClick={() => banner.action?.run()} /> : null}
    </div>
  );
}
