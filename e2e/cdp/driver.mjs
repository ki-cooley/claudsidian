// Driver factory: Playwright's Chromium by default, raw CDP against a running Chrome with --browser chrome.
// Both expose the same methods (see driver-base.mjs); scenarios never know which one they got.
import { CdpDriver } from './cdp-driver.mjs';
import { PlaywrightDriver } from './playwright-driver.mjs';

export { PROFILES, resolveProfiles } from './profiles.mjs';
export { DriverError } from './driver-base.mjs';

export async function createDriver({ browser = 'playwright', headed = false, outDir, timeoutMs, log, endpoint } = {}) {
  if (browser === 'chrome') return CdpDriver.launch({ outDir, timeoutMs, log, endpoint });
  if (browser === 'playwright') return PlaywrightDriver.launch({ headed, outDir, timeoutMs, log });
  throw new Error(`unknown browser ${browser}; use playwright or chrome`);
}
