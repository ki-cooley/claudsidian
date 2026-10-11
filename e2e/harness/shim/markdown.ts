// Shim: MarkdownRenderer via marked, sanitised by copying only text nodes and basic tags into the target.
import { marked } from 'marked';
import { Component } from './events';

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'input', 'sup', 'sub', 'kbd',
]);

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^(https?:|mailto:|obsidian:)/i.test(trimmed)) return trimmed;
  return null;
}

/** Copy `source` into `target`, keeping only allowed tags and safe attributes. */
function copySanitised(source: Node, target: Node): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      copySanitised(el, target); // unwrap unknown tags, keep their text
      continue;
    }
    const out = document.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(el.getAttribute('href'));
      if (href) {
        out.setAttribute('href', href);
        out.setAttribute('target', '_blank');
        out.setAttribute('rel', 'noopener');
        out.classList.add('external-link');
      }
    }
    if (tag === 'code' && el.className.startsWith('language-')) out.className = el.className;
    if (tag === 'input') {
      out.setAttribute('type', 'checkbox');
      out.setAttribute('disabled', '');
      if (el.hasAttribute('checked')) out.setAttribute('checked', '');
    }
    if (tag === 'th' || tag === 'td') {
      const align = el.getAttribute('align');
      if (align) out.setAttribute('align', align);
    }
    copySanitised(el, out);
    target.appendChild(out);
  }
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  copySanitised(doc.body, frag);
  return frag;
}

export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  if (typeof html === 'string') return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return html.textContent ?? '';
}

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}

export class MarkdownRenderer extends MarkdownRenderChild {
  static async render(_app: unknown, markdown: string, el: HTMLElement, _sourcePath: string, _component: Component): Promise<void> {
    const html = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
    el.replaceChildren(sanitizeHTMLToDom(html));
  }

  /** Deprecated in Obsidian; kept for callers that still use it. */
  static async renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    return MarkdownRenderer.render(undefined, markdown, el, sourcePath, component);
  }
}

export class MarkdownPreviewView extends MarkdownRenderer {}
