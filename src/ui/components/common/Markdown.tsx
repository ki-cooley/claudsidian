/**
 * Markdown through the facade's renderer (Obsidian's MarkdownRenderer in production) into a ref
 * div. Renders are throttled to ten per second while the source keeps changing, with the newest
 * source always rendered last, so a streaming reply does not thrash the sanitiser.
 *
 * The rendered nodes are scrubbed (markdown-sanitize.ts) before they enter the transcript: the
 * source is session output and untrusted, and the renderer's sanitiser still leaves elements that
 * load on sight. Remote images become tap-to-load placeholders; a tapped one stays loaded across
 * re-renders of the same block.
 *
 * Render children: when the facade resolves renderMarkdown with a handle (an object with unload(),
 * or a function), the previous render's handle is unloaded as soon as the next render lands, and
 * the last one on unmount, so a long chat does not accumulate dead render children on the view.
 * The facade interface still types the result as void; see MarkdownRenderHandle.
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { PluginFacade } from '../../facade';
import { scrubRenderedMarkdown } from './markdown-sanitize';

export interface MarkdownProps {
  source: string;
  facade: PluginFacade;
  sourcePath?: string;
  class?: string;
}

/**
 * What a facade may resolve from renderMarkdown to let the block dispose of the render children
 * it created (in Obsidian: a throwaway Component passed to MarkdownRenderer.render, unloaded here).
 * Additive change pending on PluginFacade: `renderMarkdown(...): Promise<void | MarkdownRenderHandle>`.
 */
export interface MarkdownRenderHandle {
  unload(): void;
}

const MIN_INTERVAL_MS = 100;

function handleOf(value: unknown): MarkdownRenderHandle | null {
  if (typeof value === 'function') return { unload: value as () => void };
  if (value && typeof value === 'object' && typeof (value as { unload?: unknown }).unload === 'function') {
    return value as MarkdownRenderHandle;
  }
  return null;
}

export function Markdown(p: MarkdownProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(p.source);
  const lastRenderAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const current = useRef<MarkdownRenderHandle | null>(null);
  const loadedImages = useRef(new Set<string>());
  const { facade, sourcePath } = p;

  const swapHandle = (next: MarkdownRenderHandle | null): void => {
    const previous = current.current;
    current.current = next;
    previous?.unload();
  };

  useEffect(() => {
    latest.current = p.source;
    const run = (): void => {
      timer.current = null;
      lastRenderAt.current = Date.now();
      const host = ref.current;
      if (!host) return;
      const mine = ++generation.current;
      const source = latest.current;
      const scratch = document.createElement('div');
      facade
        .renderMarkdown(source, scratch, sourcePath)
        .then((result) => {
          const handle = handleOf(result as unknown);
          if (mine !== generation.current || !ref.current) {
            handle?.unload();
            return;
          }
          scrubRenderedMarkdown(scratch, {
            loaded: loadedImages.current,
            onLoadImage: (src) => loadedImages.current.add(src),
          });
          ref.current.replaceChildren(...Array.from(scratch.childNodes));
          swapHandle(handle);
        })
        .catch(() => {
          if (mine === generation.current && ref.current) {
            ref.current.textContent = source;
            swapHandle(null);
          }
        });
    };
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRenderAt.current);
    if (wait <= 0) run();
    else if (timer.current === null) timer.current = setTimeout(run, wait);
  }, [p.source, facade, sourcePath]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      generation.current += 1;
      swapHandle(null);
    },
    [],
  );

  return <div class={['claudsidian-markdown', 'markdown-rendered', p.class ?? ''].filter(Boolean).join(' ')} ref={ref} />;
}
