import { Plugin, type WorkspaceLeaf } from 'obsidian';
import { type ClaudsidianSettings, migrateSettings } from './settings';
import { ChatView, VIEW_TYPE_CHAT } from './ui/ChatView';
import { setDebugLogging } from './util/log';

export default class ClaudsidianPlugin extends Plugin {
  settings: ClaudsidianSettings = migrateSettings(null);

  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(this.settings.debugLog);

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon('bot', 'Open Claudsidian', () => void this.activateView());
    this.addCommand({ id: 'open', name: 'Open Claudsidian', callback: () => void this.activateView() });
  }

  onunload(): void {
    // Views are detached by Obsidian; nothing else to tear down in the skeleton.
  }

  async loadSettings(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Open (or reveal) the chat view: right sidebar on desktop, full-screen leaf on mobile. */
  async activateView(): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    await workspace.revealLeaf(leaf);
    return leaf;
  }
}
