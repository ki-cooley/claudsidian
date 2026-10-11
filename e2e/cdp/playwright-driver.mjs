// Driver over Playwright's Chromium (default). Real pointer and keyboard input; element handles come from the
// in-page finder so selectors mean the same thing as in the CDP driver.
import path from 'node:path';
import { BaseDriver, DriverError, harnessCall } from './driver-base.mjs';
import { PROFILES } from './profiles.mjs';

export class PlaywrightDriver extends BaseDriver {
  static async launch(opts = {}) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: !opts.headed });
    return new PlaywrightDriver(browser, opts);
  }

  constructor(browser, opts) {
    super(opts);
    this.browser = browser;
    this.context = null;
    this.page = null;
    this.profile = null;
    this.consoleErrors = [];
  }

  async setProfile(name) {
    const p = PROFILES[name];
    if (!p) throw new DriverError(`unknown profile ${name}`);
    if (this.context) await this.context.close();
    this.context = await this.browser.newContext({
      viewport: { width: p.width, height: p.height },
      deviceScaleFactor: p.scale,
      isMobile: p.mobile,
      hasTouch: p.touch,
      colorScheme: 'light',
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
    this.consoleErrors = [];
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text());
    });
    this.page.on('pageerror', (err) => this.consoleErrors.push(String(err)));
    this.profile = name;
  }

  async goto(url) {
    if (!this.page) throw new DriverError('setProfile first');
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async evalExpression(expression) {
    return this.page.evaluate(expression);
  }

  async handle(selector) {
    const h = await this.page.evaluateHandle(harnessCall('find', selector));
    const el = h.asElement();
    if (!el) {
      await h.dispose();
      throw new DriverError(`no visible element for ${selector}`);
    }
    return el;
  }

  async click(selector) {
    await this.waitFor(selector);
    const el = await this.handle(selector);
    try {
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 3000 });
    } catch (err) {
      this.log(`click fallback for ${selector}: ${err.message.split('\n')[0]}`);
      await el.evaluate((node) => node.click());
    } finally {
      await el.dispose();
    }
  }

  async focus(selector) {
    await this.waitFor(selector);
    const el = await this.handle(selector);
    await el.focus();
    await el.dispose();
  }

  /** Type with real key events (fires keydown/input per character). */
  async type(selector, text) {
    await this.focus(selector);
    await this.page.keyboard.type(text, { delay: 5 });
  }

  /** Set a field's value in one go. */
  async fill(selector, text) {
    await this.waitFor(selector);
    const el = await this.handle(selector);
    try {
      await el.fill(text);
    } finally {
      await el.dispose();
    }
  }

  async press(key) {
    await this.page.keyboard.press(key);
  }

  async screenshot(name) {
    const file = path.join(this.outDir, `${name}.png`);
    await this.page.screenshot({ path: file, fullPage: false });
    return file;
  }

  async close() {
    try {
      await this.context?.close();
    } finally {
      await this.browser.close();
    }
  }
}
