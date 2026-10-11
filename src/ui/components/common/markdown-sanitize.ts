/**
 * Post-render scrub for markdown that came from the session (Claude's reply, tool output). Obsidian's
 * renderer strips scripts and handlers but keeps elements that load on sight, and sanitising is not
 * the same as not loading: a remote image or a frame fetches the moment the transcript renders, on
 * every poll, with no tap. So before rendered nodes reach the transcript this removes everything
 * that fetches or embeds by itself (frames, media, vault embeds, stylesheets), turns remote images
 * into tap-to-load placeholders, and unwraps links whose scheme a tap would hand to another handler
 * (obsidian://, other plugins' URIs). Everything else is kept.
 */

/** Elements that load or embed on their own. `[src]` catches input[type=image] and frame variants. */
const REMOVE_SELECTOR = 'iframe, object, embed, video, audio, source, track, picture, link, style, image, use, .internal-embed, [src]:not(img)';
/** Image schemes a placeholder may load on tap. */
const LOADABLE_IMAGE_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:']);
/** Vault resource schemes: Obsidian serves vault files from these on desktop and iOS. */
const VAULT_IMAGE_SCHEMES = new Set(['app:', 'capacitor:']);
const LINK_SCHEMES = new Set(['http:', 'https:']);

export interface ScrubOptions {
  /** image srcs the viewer already tapped to load; rendered as images again on a re-render */
  loaded?: ReadonlySet<string>;
  onLoadImage?: (src: string) => void;
}

export function schemeOf(url: string): string | null {
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(url);
  const scheme = m?.[1];
  return scheme ? `${scheme.toLowerCase()}:` : null;
}

function hostOf(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return '';
  }
}

function placeholderFor(img: HTMLImageElement, src: string, opts: ScrubOptions): HTMLElement {
  const doc = img.ownerDocument;
  const scheme = schemeOf(src);
  const alt = img.getAttribute('alt')?.trim() ?? '';
  const host = hostOf(src);
  const where = host ? host : scheme === 'data:' || scheme === 'blob:' ? 'inline data' : '';
  const label = `Image${alt ? `: ${alt}` : ''}${where ? ` (${where})` : ''}`;
  if (!scheme || !LOADABLE_IMAGE_SCHEMES.has(scheme)) {
    const span = doc.createElement('span');
    span.className = 'claudsidian-md-image is-blocked';
    span.textContent = label;
    return span;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'claudsidian-md-image';
  button.textContent = `${label}, tap to load`;
  button.title = src;
  button.addEventListener('click', () => {
    const loaded = doc.createElement('img');
    loaded.src = src;
    if (alt) loaded.alt = alt;
    button.replaceWith(loaded);
    opts.onLoadImage?.(src);
  });
  return button;
}

/** Scrub `root` in place. Safe to call on a detached element before it is inserted. */
export function scrubRenderedMarkdown(root: ParentNode, opts: ScrubOptions = {}): void {
  for (const el of Array.from(root.querySelectorAll(REMOVE_SELECTOR))) el.remove();

  for (const img of Array.from(root.querySelectorAll('img'))) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    const src = img.getAttribute('src') ?? '';
    const scheme = schemeOf(src);
    if (!scheme || VAULT_IMAGE_SCHEMES.has(scheme) || opts.loaded?.has(src)) continue;
    img.replaceWith(placeholderFor(img, src, opts));
  }

  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const scheme = schemeOf(a.getAttribute('href') ?? '');
    if (!scheme || LINK_SCHEMES.has(scheme)) continue;
    const span = a.ownerDocument.createElement('span');
    span.className = 'claudsidian-md-link-dropped';
    span.append(...Array.from(a.childNodes));
    a.replaceWith(span);
  }

  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    if (/url\s*\(/i.test(el.getAttribute('style') ?? '')) el.removeAttribute('style');
  }
}
