/**
 * Obsidian augments HTMLElement.prototype with helpers (createEl, createDiv, empty, addClass, ...).
 * Plugin code uses them freely, so jsdom tests and the browser harness install the same subset here.
 */
export interface DomElementInfo {
  cls?: string | string[];
  text?: string | DocumentFragment;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
}

type AnyEl = HTMLElement & Record<string, unknown>;

export function installDomHelpers(target: typeof globalThis = globalThis): void {
  const proto = (target as unknown as { HTMLElement: { prototype: AnyEl } }).HTMLElement?.prototype;
  const nodeProto = (target as unknown as { Node: { prototype: AnyEl } }).Node?.prototype;
  if (!proto || proto.__claudsidianHelpers) return;
  const doc = (target as unknown as { document: Document }).document;

  function applyInfo(el: HTMLElement, info?: DomElementInfo | string): void {
    if (!info) return;
    if (typeof info === 'string') {
      el.className = info;
      return;
    }
    if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
    if (info.text !== undefined) {
      if (typeof info.text === 'string') el.textContent = info.text;
      else el.appendChild(info.text);
    }
    if (info.attr) for (const [k, v] of Object.entries(info.attr)) if (v !== null) el.setAttribute(k, String(v));
    if (info.title) el.title = info.title;
    if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
    if (info.type) (el as HTMLInputElement).type = info.type;
    if (info.placeholder) (el as HTMLInputElement).placeholder = info.placeholder;
    if (info.href) (el as HTMLAnchorElement).href = info.href;
  }

  const create = function (this: Node, tag: string, info?: DomElementInfo | string): HTMLElement {
    const el = doc.createElement(tag);
    applyInfo(el, info);
    const parent = typeof info === 'object' && info?.parent ? info.parent : this;
    if (typeof info === 'object' && info?.prepend) parent.insertBefore(el, parent.firstChild);
    else parent.appendChild(el);
    return el;
  };

  const helpers: Record<string, unknown> = {
    createEl: create,
    createDiv(this: Node, info?: DomElementInfo | string) {
      return create.call(this, 'div', info);
    },
    createSpan(this: Node, info?: DomElementInfo | string) {
      return create.call(this, 'span', info);
    },
    empty(this: HTMLElement) {
      while (this.firstChild) this.removeChild(this.firstChild);
    },
    detach(this: HTMLElement) {
      this.remove();
    },
    addClass(this: HTMLElement, ...cls: string[]) {
      this.classList.add(...cls.flatMap((c) => c.split(' ').filter(Boolean)));
    },
    addClasses(this: HTMLElement, cls: string[]) {
      this.classList.add(...cls);
    },
    removeClass(this: HTMLElement, ...cls: string[]) {
      this.classList.remove(...cls.flatMap((c) => c.split(' ').filter(Boolean)));
    },
    toggleClass(this: HTMLElement, cls: string | string[], on: boolean) {
      for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, on);
    },
    hasClass(this: HTMLElement, cls: string) {
      return this.classList.contains(cls);
    },
    setText(this: HTMLElement, text: string | DocumentFragment) {
      if (typeof text === 'string') this.textContent = text;
      else {
        this.textContent = '';
        this.appendChild(text);
      }
    },
    appendText(this: HTMLElement, text: string) {
      this.appendChild(doc.createTextNode(text));
    },
    setAttr(this: HTMLElement, k: string, v: string | number | boolean | null) {
      if (v === null) this.removeAttribute(k);
      else this.setAttribute(k, String(v));
    },
    getAttr(this: HTMLElement, k: string) {
      return this.getAttribute(k);
    },
    hide(this: HTMLElement) {
      this.style.display = 'none';
      return this;
    },
    show(this: HTMLElement) {
      this.style.display = '';
      return this;
    },
    toggle(this: HTMLElement, show: boolean) {
      this.style.display = show ? '' : 'none';
      return this;
    },
    isShown(this: HTMLElement) {
      return this.style.display !== 'none';
    },
    onClickEvent(this: HTMLElement, cb: (ev: MouseEvent) => unknown) {
      this.addEventListener('click', cb as EventListener);
    },
    on(this: HTMLElement, type: string, selector: string, cb: (ev: Event, target: HTMLElement) => unknown) {
      this.addEventListener(type, (ev) => {
        const t = (ev.target as HTMLElement | null)?.closest(selector) as HTMLElement | null;
        if (t) cb(ev, t);
      });
    },
    setCssProps(this: HTMLElement, props: Record<string, string>) {
      for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
    },
  };
  for (const [k, v] of Object.entries(helpers)) {
    if (!(k in proto)) Object.defineProperty(proto, k, { value: v, configurable: true, writable: true });
  }
  if (nodeProto) {
    for (const k of ['createEl', 'createDiv', 'createSpan', 'empty']) {
      if (!(k in nodeProto)) Object.defineProperty(nodeProto, k, { value: helpers[k], configurable: true, writable: true });
    }
  }
  if (doc && !('createEl' in (doc as unknown as Record<string, unknown>))) {
    Object.defineProperty(doc, 'createEl', { value: create, configurable: true, writable: true });
  }
  proto.__claudsidianHelpers = true;
}
