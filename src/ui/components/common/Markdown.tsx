/**
 * Markdown through the facade's renderer (Obsidian's MarkdownRenderer in production) into a ref
 * div. Renders are throttled to ten per second while the source keeps changing, with the newest
 * source always rendered last, so a streaming reply does not thrash the sanitiser.
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { PluginFacade } from '../../facade';

export interface MarkdownProps {
  source: string;
  facade: PluginFacade;
  sourcePath?: string;
  class?: string;
}

const MIN_INTERVAL_MS = 100;

export function Markdown(p: MarkdownProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(p.source);
  const lastRenderAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const { facade, sourcePath } = p;

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
        .then(() => {
          if (mine !== generation.current || !ref.current) return;
          ref.current.replaceChildren(...Array.from(scratch.childNodes));
        })
        .catch(() => {
          if (mine === generation.current && ref.current) ref.current.textContent = source;
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
    },
    [],
  );

  return <div class={['claudsidian-markdown', 'markdown-rendered', p.class ?? ''].filter(Boolean).join(' ')} ref={ref} />;
}
