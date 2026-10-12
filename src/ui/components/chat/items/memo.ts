/**
 * memoProps: a function component wrapped so it renders again only when a non-function prop
 * changes (shallow, or a custom comparison). Function props are handed down through stable
 * proxies that call the latest prop, so a parent may pass fresh closures on every render
 * (ChatScreen does) without defeating the memo, and the child never calls a stale callback:
 * Preact updates `this.props` even when shouldComponentUpdate declines the render.
 */
import { Component, h, type ComponentClass, type ComponentChild, type FunctionComponent } from 'preact';

type AnyFn = (...args: unknown[]) => unknown;

/** Equal when every non-function prop is `===`; functions are assumed proxied. */
export function shallowEqualIgnoringFunctions<P extends object>(a: P, b: P): boolean {
  const ka = Object.keys(a) as (keyof P)[];
  const kb = Object.keys(b) as (keyof P)[];
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'function' && typeof vb === 'function') continue;
    if (va !== vb) return false;
  }
  return true;
}

export function memoProps<P extends object>(Comp: FunctionComponent<P>, isEqual: (a: P, b: P) => boolean = shallowEqualIgnoringFunctions): ComponentClass<P> {
  class Memo extends Component<P> {
    static displayName = `memo(${Comp.displayName ?? Comp.name ?? 'Component'})`;
    private readonly proxies = new Map<string, AnyFn>();

    shouldComponentUpdate(next: Readonly<P>): boolean {
      return !isEqual(this.props, next);
    }

    render(props: Readonly<P>): ComponentChild {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        const value = (props as Record<string, unknown>)[key];
        if (typeof value === 'function' && key !== 'children') {
          let proxy = this.proxies.get(key);
          if (!proxy) {
            proxy = (...args: unknown[]): unknown => {
              const latest = (this.props as Record<string, unknown>)[key];
              return typeof latest === 'function' ? (latest as AnyFn)(...args) : undefined;
            };
            this.proxies.set(key, proxy);
          }
          out[key] = proxy;
        } else {
          out[key] = value;
        }
      }
      return h(Comp, out as P);
    }
  }
  return Memo;
}
