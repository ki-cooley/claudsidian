// Shim: Obsidian's Events and Component base classes (subscription bookkeeping and load/unload).

export interface EventRef {
  name: string;
  fn: (...args: unknown[]) => unknown;
  owner: Events;
}

export class Events {
  private handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();

  on(name: string, fn: (...args: unknown[]) => unknown, _ctx?: unknown): EventRef {
    const list = this.handlers.get(name) ?? [];
    list.push(fn);
    this.handlers.set(name, list);
    return { name, fn, owner: this };
  }

  off(name: string, fn: (...args: unknown[]) => unknown): void {
    this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== fn));
  }

  offref(ref: EventRef): void {
    ref.owner.off(ref.name, ref.fn);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const h of [...(this.handlers.get(name) ?? [])]) h(...args);
  }

  tryTrigger(ref: EventRef, args: unknown[]): void {
    try {
      ref.fn(...args);
    } catch (err) {
      console.error(err);
    }
  }
}

export class Component {
  _loaded = false;
  private unloaders: (() => void)[] = [];
  private children: Component[] = [];

  load(): void | Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const c of this.children) c.load();
  }

  onload(): void {}

  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of this.children) c.unload();
    for (const u of this.unloaders.splice(0)) {
      try {
        u();
      } catch (err) {
        console.error(err);
      }
    }
    this.onunload();
  }

  onunload(): void {}

  addChild<T extends Component>(c: T): T {
    this.children.push(c);
    if (this._loaded) c.load();
    return c;
  }

  removeChild<T extends Component>(c: T): T {
    this.children = this.children.filter((x) => x !== c);
    c.unload();
    return c;
  }

  register(cb: () => unknown): void {
    this.unloaders.push(() => void cb());
  }

  registerEvent(ref: EventRef): void {
    this.unloaders.push(() => ref.owner.off(ref.name, ref.fn));
  }

  registerDomEvent(el: EventTarget, type: string, cb: (ev: Event) => unknown, options?: boolean | AddEventListenerOptions): void {
    el.addEventListener(type, cb as EventListener, options);
    this.unloaders.push(() => el.removeEventListener(type, cb as EventListener, options));
  }

  registerInterval(id: number): number {
    this.unloaders.push(() => clearInterval(id));
    return id;
  }
}
