// Transcript scrolling: pinned at the bottom through late content growth, its own scroll events never
// unpin, the open hold re-pins non-user scrolls, Jump to latest only when far up or on new rows, and
// the composer's scroll-to-bottom event jumps.
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transcript, type TranscriptProps } from '../../../src/ui/components/chat/Transcript';
import { SCROLL_TO_BOTTOM_EVENT } from '../../../src/ui/components/chat/use-scroll-pin';
import { FakeFacade } from '../../helpers/fake-facade';
import { items, transcriptWith } from '../../helpers/fake-store';
import { maybe, mount, q, text, tick, type Mounted } from './harness';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(private readonly cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.targets.push(el);
  }
  unobserve(): void {}
  disconnect(): void {}
  static fire(): void {
    for (const ro of FakeResizeObserver.instances) ro.cb([], ro as unknown as ResizeObserver);
  }
}

/** jsdom has no layout: give the scroll container a fake geometry whose scrollTop clamps like a browser's. */
function fakeScroll(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  const dims = { scrollHeight, clientHeight, top: 0 };
  Object.defineProperty(el, 'scrollHeight', { get: () => dims.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => dims.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => dims.top,
    set: (v: number) => {
      dims.top = Math.max(0, Math.min(v, dims.scrollHeight - dims.clientHeight));
    },
    configurable: true,
  });
  return dims;
}

let mounted: Mounted<unknown>[] = [];
const realRO = globalThis.ResizeObserver;
beforeEach(() => {
  FakeResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = realRO;
});

const LONG = [items.user('hi'), items.assistant('one'), items.assistant('two'), items.assistant('three'), items.result()];

function Rooted(p: TranscriptProps) {
  return h('div', { class: 'claudsidian-root' }, h(Transcript, p));
}

function setup(overrides: Partial<TranscriptProps> = {}) {
  const facade = new FakeFacade();
  const props: TranscriptProps = {
    state: transcriptWith(LONG),
    facade,
    cooking: false,
    showThinking: true,
    showCosts: false,
    showSubagents: false,
    onAllow: vi.fn(),
    onDeny: vi.fn(),
    onAnswer: vi.fn(),
    ...overrides,
  };
  const m = mount(Rooted, props);
  mounted.push(m as Mounted<unknown>);
  const el = q(m.root, '.claudsidian-transcript');
  const dims = fakeScroll(el, 1000, 300);
  const scroll = (top: number): void => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  };
  const userTouch = (): void => {
    el.dispatchEvent(new Event('wheel'));
  };
  return { ...m, props, el, dims, scroll, userTouch };
}

describe('Transcript scroll pin', () => {
  it('observes the content element and re-pins to the bottom when it grows after open', async () => {
    const { root, el, dims } = setup();
    await tick();
    const inner = q(root, '.claudsidian-transcript-inner');
    expect(FakeResizeObserver.instances.some((ro) => ro.targets.includes(inner))).toBe(true);
    FakeResizeObserver.fire();
    expect(el.scrollTop).toBe(700);
    // async markdown lands: the content is taller now
    dims.scrollHeight = 1600;
    FakeResizeObserver.fire();
    expect(el.scrollTop).toBe(1300);
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
  });

  it('ignores the scroll event its own scroll caused, even when content grew under it', async () => {
    const { root, el, dims } = setup();
    await tick();
    FakeResizeObserver.fire();
    dims.scrollHeight = 1600;
    // the browser delivers the scroll event for the earlier programmatic scroll after the growth
    el.dispatchEvent(new Event('scroll'));
    await tick();
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
    FakeResizeObserver.fire();
    expect(el.scrollTop).toBe(1300);
  });

  it('re-pins a scroll that is not the reader during the open hold, and unpins after a real wheel', async () => {
    const { root, el, dims, scroll, userTouch } = setup();
    await tick();
    FakeResizeObserver.fire();
    scroll(0);
    await tick();
    expect(el.scrollTop).toBe(700);
    expect(maybe(root, '.claudsidian-jump')).toBeNull();

    userTouch();
    scroll(0);
    await tick();
    expect(el.scrollTop).toBe(0);
    // far more than a viewport up: the jump control shows in its gutter, not over the text
    const jump = q<HTMLButtonElement>(root, '.claudsidian-jump');
    expect(text(jump)).toBe('Jump to latest');
    expect(jump.parentElement?.classList.contains('claudsidian-jump-gutter')).toBe(true);
    expect(jump.closest('.claudsidian-transcript')).toBeNull();
    // growth while scrolled up does not drag the reader down
    dims.scrollHeight = 1600;
    FakeResizeObserver.fire();
    expect(el.scrollTop).toBe(0);
  });

  it('shows the jump control only past one viewport, and hides it the moment it is used', async () => {
    const { root, el, scroll, userTouch } = setup();
    await tick();
    FakeResizeObserver.fire();
    userTouch();
    scroll(500);
    await tick();
    // 200 px above the bottom: unpinned (over the 40 px band) but less than a viewport: no control yet
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
    scroll(300);
    await tick();
    expect(maybe(root, '.claudsidian-jump')).not.toBeNull();
    q<HTMLButtonElement>(root, '.claudsidian-jump').click();
    await tick();
    expect(el.scrollTop).toBe(700);
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
  });

  it('says New messages when rows arrive while the reader is scrolled up', async () => {
    const { root, props, rerender, scroll, userTouch } = setup();
    await tick();
    FakeResizeObserver.fire();
    userTouch();
    scroll(600);
    await tick();
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
    rerender({ ...props, state: transcriptWith([...LONG, items.user('more'), items.assistant('reply')]) });
    await tick();
    const jump = q(root, '.claudsidian-jump');
    expect(text(jump)).toBe('New messages');
    expect(jump.classList.contains('has-new')).toBe(true);
  });

  it('jumps to the bottom when the root receives claudsidian:scroll-to-bottom', async () => {
    const { root, el, scroll, userTouch } = setup();
    await tick();
    FakeResizeObserver.fire();
    userTouch();
    scroll(0);
    await tick();
    expect(maybe(root, '.claudsidian-jump')).not.toBeNull();
    q(root, '.claudsidian-root').dispatchEvent(new CustomEvent(SCROLL_TO_BOTTOM_EVENT));
    await tick();
    expect(el.scrollTop).toBe(700);
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
  });

  it('re-arms the pin when the history lands on an empty transcript', async () => {
    const { el, props, rerender, scroll, userTouch, root } = setup({ state: transcriptWith([]) });
    await tick();
    userTouch();
    scroll(0);
    await tick();
    rerender({ ...props, state: transcriptWith(LONG) });
    await tick();
    expect(el.scrollTop).toBe(700);
    expect(maybe(root, '.claudsidian-jump')).toBeNull();
    // the hold is fresh again: a stray scroll goes back to the bottom
    scroll(100);
    await tick();
    expect(el.scrollTop).toBe(700);
  });

  it('names the log without an aria-label (Obsidian would show it as a tooltip)', async () => {
    const { root } = setup();
    await tick();
    const log = q(root, '[role="log"]');
    expect(log.hasAttribute('aria-label')).toBe(false);
    expect(log.getAttribute('aria-labelledby')).toBe('claudsidian-transcript-name');
  });
});
