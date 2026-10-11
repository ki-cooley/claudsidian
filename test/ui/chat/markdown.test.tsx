// Markdown: rendered session output is scrubbed before it enters the transcript (nothing loads on
// sight, remote images are tap-to-load, non-http links are unwrapped), and each render's children
// are unloaded when the next render lands and on unmount.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown, type MarkdownRenderHandle } from '../../../src/ui/components/common/Markdown';
import { scrubRenderedMarkdown } from '../../../src/ui/components/common/markdown-sanitize';
import { FakeFacade } from '../../helpers/fake-facade';
import { maybe, mount, q, qa, tick, type Mounted } from './harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

/** A facade whose renderer produces the HTML Obsidian would (DOMPurify keeps img, iframe, embeds). */
function htmlFacade(html: (markdown: string) => string, onRender?: () => MarkdownRenderHandle): FakeFacade {
  const facade = new FakeFacade();
  const render = async (markdown: string, el: HTMLElement): Promise<unknown> => {
    el.innerHTML = html(markdown);
    return onRender?.();
  };
  facade.renderMarkdown = render as unknown as FakeFacade['renderMarkdown'];
  return facade;
}

function mountMarkdown(facade: FakeFacade, source: string) {
  const m = mount(Markdown, { source, facade });
  mounted.push(m as Mounted<unknown>);
  return m;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Markdown scrubbing', () => {
  it('does not load a remote image until it is tapped, and keeps it loaded across re-renders', async () => {
    const facade = htmlFacade(() => '<p>see <img src="https://attacker.example/p.png?q=secret" alt="chart"></p>');
    const m = mountMarkdown(facade, 'see ![chart](https://attacker.example/p.png?q=secret)');
    await tick();
    expect(maybe(m.root, 'img')).toBeNull();
    const placeholder = q<HTMLButtonElement>(m.root, 'button.claudsidian-md-image');
    expect(placeholder.textContent).toContain('attacker.example');
    expect(placeholder.textContent).toContain('chart');
    placeholder.click();
    const img = q<HTMLImageElement>(m.root, 'img');
    expect(img.getAttribute('src')).toBe('https://attacker.example/p.png?q=secret');
    expect(img.alt).toBe('chart');

    await sleep(120);
    m.rerender({ source: 'see ![chart](https://attacker.example/p.png?q=secret) now', facade });
    await tick();
    expect(q<HTMLImageElement>(m.root, 'img').getAttribute('src')).toBe('https://attacker.example/p.png?q=secret');
    expect(maybe(m.root, 'button.claudsidian-md-image')).toBeNull();
  });

  it('removes iframes, media and vault embeds outright', async () => {
    const facade = htmlFacade(
      () =>
        '<p>before</p><iframe src="https://attacker.example" sandbox></iframe><video src="https://a/v.mp4"></video>' +
        '<audio><source src="https://a/s.mp3"></audio><object data="x"></object><embed src="https://a/e">' +
        '<span class="internal-embed" src="Private/journal">Private/journal</span><p style="background: url(https://a/bg.png)">after</p>',
    );
    const m = mountMarkdown(facade, 'x');
    await tick();
    expect(qa(m.root, 'iframe, video, audio, source, object, embed, .internal-embed')).toHaveLength(0);
    expect(m.root.textContent).toContain('before');
    expect(m.root.textContent).toContain('after');
    expect(m.root.textContent).not.toContain('Private/journal');
    expect(qa(m.root, '[style]')).toHaveLength(0);
  });

  it('unwraps obsidian:// and other non-http links but keeps https and vault-internal links', async () => {
    const facade = htmlFacade(
      () =>
        '<p><a href="obsidian://open?vault=yes-chef&file=x">open</a> ' +
        '<a href="https://example.com/doc">doc</a> ' +
        '<a class="internal-link" data-href="recipes/tare" href="recipes/tare" target="_blank" rel="noopener">tare</a> ' +
        '<a href="javascript:alert(1)">js</a> <a href="#tag">#tag</a></p>',
    );
    const m = mountMarkdown(facade, 'x');
    await tick();
    const hrefs = qa<HTMLAnchorElement>(m.root, 'a').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/doc', 'recipes/tare', '#tag']);
    const dropped = qa(m.root, '.claudsidian-md-link-dropped').map((el) => el.textContent);
    expect(dropped).toEqual(['open', 'js']);
  });

  it('scrubRenderedMarkdown leaves a vault image and plain markup alone', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>Title</h2><p><strong>bold</strong> <code>x</code></p><img src="app://obsidian.md/vault/photo.png" alt="p"><ul><li>one</li></ul>';
    scrubRenderedMarkdown(root);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('app://obsidian.md/vault/photo.png');
    expect(root.querySelectorAll('h2, strong, code, ul li')).toHaveLength(4);
  });
});

describe('Markdown render children', () => {
  it('unloads the previous render handle when the next render lands, and the last on unmount', async () => {
    const handles: { unload: ReturnType<typeof vi.fn> }[] = [];
    const facade = htmlFacade(
      (md) => `<p>${md}</p>`,
      () => {
        const h = { unload: vi.fn() };
        handles.push(h);
        return h;
      },
    );
    const m = mountMarkdown(facade, 'one');
    await tick();
    expect(handles).toHaveLength(1);
    expect(handles[0]?.unload).not.toHaveBeenCalled();

    await sleep(120);
    m.rerender({ source: 'two', facade });
    await tick();
    expect(handles).toHaveLength(2);
    expect(handles[0]?.unload).toHaveBeenCalledTimes(1);
    expect(handles[1]?.unload).not.toHaveBeenCalled();
    expect(m.root.textContent).toContain('two');

    m.unmount();
    mounted = [];
    expect(handles[1]?.unload).toHaveBeenCalledTimes(1);
  });
});
