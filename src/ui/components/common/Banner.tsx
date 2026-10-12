/**
 * The store's banner (offline, auth, error, info) as one line with an optional one-tap action and a
 * dismiss control. Dismissing hides that banner (same kind and text) until the store publishes a
 * different one or clears it; the store itself is not touched.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Banner as BannerModel } from '../../../core/store-api';
import { Button } from './Button';
import { Icon } from './Icon';

const ICONS: Record<BannerModel['kind'], string> = {
  offline: 'wifi-off',
  auth: 'key-round',
  error: 'alert-triangle',
  info: 'info',
};

export function bannerKey(banner: BannerModel): string {
  return `${banner.kind}\u0000${banner.text}`;
}

export interface BannerProps {
  banner: BannerModel | null;
  /** false hides the dismiss control (default true) */
  dismissible?: boolean;
  onDismiss?: (banner: BannerModel) => void;
}

export function Banner(p: BannerProps): JSX.Element | null {
  const banner = p.banner;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = banner ? bannerKey(banner) : null;

  useEffect(() => {
    // A cleared banner resets the dismissal so the same text can come back later (offline again).
    if (key === null) setDismissed(null);
  }, [key]);

  if (!banner || key === dismissed) return null;
  const alert = banner.kind === 'error' || banner.kind === 'auth';
  const dismiss = (): void => {
    setDismissed(key);
    p.onDismiss?.(banner);
  };
  return (
    <div class={`claudsidian-banner is-${banner.kind}`} role={alert ? 'alert' : 'status'}>
      <Icon name={ICONS[banner.kind]} size="small" />
      <span class="claudsidian-banner-text">{banner.text}</span>
      {banner.action ? <Button label={banner.action.label} size="small" onClick={() => banner.action?.run()} /> : null}
      {p.dismissible === false ? null : <Button icon="x" ariaLabel="Dismiss" kind="ghost" size="small" class="claudsidian-banner-dismiss" onClick={dismiss} />}
    </div>
  );
}
