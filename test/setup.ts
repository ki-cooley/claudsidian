// Global test setup: Obsidian's DOM helpers on the jsdom prototypes, and WebCrypto (jsdom lacks crypto.subtle).
import { webcrypto } from 'node:crypto';
import { installDomHelpers } from './mocks/dom-helpers';

installDomHelpers();

const g = globalThis as unknown as { crypto?: Crypto };
if (!g.crypto || !g.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
}
