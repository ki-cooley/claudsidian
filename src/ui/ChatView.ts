import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import type ClaudsidianPlugin from '../main';
import { Root } from './components/Root';

export const VIEW_TYPE_CHAT = 'claudsidian-chat';

export class ChatView extends ItemView {
  readonly plugin: ClaudsidianPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudsidianPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return 'Claudsidian';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('claudsidian-view');
    render(h(Root, { version: undefined }), this.contentEl);
  }

  async onClose(): Promise<void> {
    render(null, this.contentEl);
    this.contentEl.empty();
  }
}
