// Shared pieces of the two drivers: expression building for the in-page finder, waiting, and the method list both
// implement (click, type, fill, press, waitFor, eval, text, exists, count, screenshot, setProfile, goto, close).

export const DEFAULT_TIMEOUT_MS = 10_000;

export class DriverError extends Error {}

/** Source for an in-page call of window.__harness.<name>(...args). */
export function harnessCall(name, ...args) {
  return `window.__harness && window.__harness.${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
}

/** Source for calling `fn` in the page with JSON args; the result must be JSON-serialisable. */
export function fnCall(fn, args = []) {
  const src = typeof fn === 'function' ? fn.toString() : String(fn);
  return `(async () => { const __fn = (${src}); return await __fn(${args.map((a) => JSON.stringify(a)).join(', ')}); })()`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BaseDriver {
  constructor(opts = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.outDir = opts.outDir;
    this.log = opts.log ?? (() => {});
  }

  /**
   * Wait for a selector to exist (string), for a page function returning a truthy JSON value, or for
   * `{fn, args}` (the same with JSON arguments). Resolves with the truthy value.
   */
  async waitFor(target, ms = this.timeoutMs, label) {
    const started = Date.now();
    let last;
    const call = typeof target === 'object' && target !== null ? target : { fn: target, args: [] };
    while (Date.now() - started < ms) {
      if (typeof target === 'string') {
        if (await this.exists(target)) return true;
      } else {
        last = await this.eval(call.fn, ...(call.args ?? []));
        if (last) return last;
      }
      await sleep(80);
    }
    const what = label ?? (typeof target === 'string' ? `selector ${target}` : 'condition');
    throw new DriverError(`timed out after ${ms} ms waiting for ${what}${last !== undefined ? ` (last value ${JSON.stringify(last)})` : ''}`);
  }

  /** Wait until the page's visible text contains `text`. */
  async waitForText(text, ms = this.timeoutMs) {
    await this.waitFor(`text*=${text}`, ms, `text "${text}"`);
    return true;
  }

  async exists(selector) {
    return Boolean(await this.evalExpression(`!!(${harnessCall('find', selector)})`));
  }

  async count(selector) {
    return Number(await this.evalExpression(`${harnessCall('findAll', selector)}.length`)) || 0;
  }

  async text(selector) {
    return this.evalExpression(harnessCall('textOf', selector));
  }

  async bodyText() {
    return this.evalExpression(harnessCall('bodyText'));
  }

  async rect(selector) {
    const r = await this.evalExpression(harnessCall('rectOf', selector));
    if (!r) throw new DriverError(`no visible element for ${selector}`);
    return r;
  }

  /** Run a page function with JSON arguments. */
  async eval(fn, ...args) {
    return this.evalExpression(fnCall(fn, args));
  }

  /** Wait for the harness page to finish booting (or fail). */
  async waitForHarness(ms = 15_000) {
    const state = await this.waitFor(() => {
      const b = document.body;
      if (!b) return null;
      if (b.dataset.harnessError) return { error: b.dataset.harnessError };
      if (b.dataset.harnessReady === '1') return { ready: true };
      return null;
    }, ms, 'harness boot');
    if (state.error) throw new DriverError(`harness boot failed: ${state.error}`);
  }
}
