// Harness entry: builds the fake App, constructs the plugin with seeded settings, opens its view into #sidebar,
// and exposes window.__claudsidian for the driver. Query flags: ?profile=, ?platform=, ?signedout=1, ?cooking=1,
// ?session=<id>, ?theme=dark, ?polling=fast, ?debug=1.
import './harness.css';
import '../../src/styles/index.css';
import ClaudsidianPlugin from '../../src/main';
import { App, Platform, type PluginManifest } from './obsidian-shim';
import { params, profileName } from './shim/platform';
import { buildEditorPane } from './editor-pane';
import { installFinder } from './finder';
import { seedSettings } from './seed';

declare global {
  interface Window {
    __claudsidian?: Record<string, unknown>;
    __harness?: Record<string, unknown>;
  }
}

const MANIFEST: PluginManifest = {
  id: 'claudsidian',
  name: 'Claudsidian',
  version: '2.0.0',
  minAppVersion: '1.5.0',
  description: 'Browser harness build',
  author: 'harness',
  isDesktopOnly: false,
};

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`harness page is missing #${id}`);
  return el;
}

function setupTabs(): void {
  const body = document.body;
  for (const tab of Array.from(document.querySelectorAll<HTMLElement>('#harness-tabs [data-pane]'))) {
    tab.addEventListener('click', () => showPane(tab.dataset.pane ?? 'claude'));
  }
  body.addEventListener('harness-reveal', () => showPane('claude'));
}

function showPane(pane: string): void {
  document.body.dataset.pane = pane;
  for (const tab of Array.from(document.querySelectorAll<HTMLElement>('#harness-tabs [data-pane]'))) {
    tab.classList.toggle('is-active', tab.dataset.pane === pane);
    tab.setAttribute('aria-selected', String(tab.dataset.pane === pane));
  }
}

async function boot(): Promise<void> {
  const body = document.body;
  body.classList.add(`profile-${profileName}`, Platform.isMobile ? 'is-mobile' : 'is-desktop', Platform.isPhone ? 'is-phone' : 'is-tablet-or-desktop');
  body.classList.add(params.get('theme') === 'dark' ? 'theme-dark' : 'theme-light');
  setupTabs();
  showPane('claude');

  const sidebarEl = byId('sidebar');
  const editorEl = byId('editor');
  const app = new App(
    { sidebarEl, editorEl, ribbonEl: byId('ribbon'), statusBarEl: byId('statusbar'), settingsEl: byId('settings') },
    Platform.isMobile,
  );
  const pane = buildEditorPane(app, editorEl);
  installFinder();

  const settings = seedSettings(params);
  app.pluginData.set(MANIFEST.id, settings);

  const plugin = new ClaudsidianPlugin(app as never, MANIFEST as never);
  await plugin.load();
  app.workspace.markLayoutReady();

  // The plugin's activateView mounts the view through getRightLeaf + setViewState; fall back to a plain open.
  let leaf: unknown = null;
  const activate = (plugin as unknown as { activateView?: () => Promise<unknown> }).activateView;
  if (typeof activate === 'function') leaf = await activate.call(plugin);
  if (!leaf) {
    const l = app.workspace.getRightLeaf(false)!;
    await l.setViewState({ type: 'claudsidian-chat', active: true });
    leaf = l;
  }
  const view = (leaf as { view?: unknown } | null)?.view ?? null;

  const settingsButton = document.getElementById('harness-open-settings');
  settingsButton?.addEventListener('click', () => app.setting.openTabById(MANIFEST.id));

  window.__claudsidian = {
    app,
    plugin,
    view,
    leaf,
    store: (plugin as unknown as { store?: unknown }).store,
    editor: pane,
    commands: app.commands,
    runCommand: (id: string) => app.commands.executeCommandById(id.includes(':') ? id : `claudsidian:${id}`),
    settings: () => (plugin as unknown as { settings: unknown }).settings,
    showPane,
  };
  body.dataset.harnessReady = '1';
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('[harness] boot failed', err);
  document.body.dataset.harnessError = message;
  const el = document.getElementById('harness-error');
  if (el) {
    el.textContent = `Harness failed to start: ${message}`;
    el.style.display = 'block';
  }
});
