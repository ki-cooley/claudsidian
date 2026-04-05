import { Editor, MarkdownView, Notice, Plugin } from 'obsidian'

import { ApplyView } from './ApplyView'
import { ChatView } from './ChatView'
import { ChatProps } from './components/chat-view/Chat'
import { InstallerUpdateRequiredModal } from './components/modals/InstallerUpdateRequiredModal'
import { APPLY_VIEW_TYPE, CHAT_VIEW_TYPE } from './constants'
import { McpManager } from './core/mcp/mcpManager'
import { RAGEngine } from './core/rag/ragEngine'
import { DatabaseManager } from './database/DatabaseManager'
import { PGLiteAbortedException } from './database/exception'
import { migrateToJsonDatabase } from './database/json/migrateToJsonDatabase'
import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './settings/schema/setting.types'
import { parseSmartComposerSettings } from './settings/schema/settings'
import { SmartComposerSettingTab } from './settings/SettingTab'
import { getMentionableBlockData } from './utils/obsidian'
import { webSocketClient } from './core/backend/instance'
import { VaultRpcHandler } from './core/backend/VaultRpcHandler'
import { ConflictManager } from './core/backend/ConflictManager'
import { initEditHistory } from './core/backend/EditHistory'
import type { RpcRequestMessage } from './core/backend/protocol'
import { StreamStateManager } from './core/backend/StreamStateManager'
import { PendingSessionStore } from './core/backend/PendingSessionStore'
import { getClientId } from './core/backend/client-id'
import type { SessionReplayMessage } from './core/backend/protocol'

export default class SmartComposerPlugin extends Plugin {
  settings: SmartComposerSettings
  initialChatProps?: ChatProps // TODO: change this to use view state like ApplyView
  settingsChangeListeners: ((newSettings: SmartComposerSettings) => void)[] = []
  mcpManager: McpManager | null = null
  dbManager: DatabaseManager | null = null
  ragEngine: RAGEngine | null = null
  vaultRpcHandler: VaultRpcHandler | null = null
  conflictManager: ConflictManager | null = null
  streamStateManager: StreamStateManager = new StreamStateManager()
  pendingSessionStore: PendingSessionStore
  clientId: string | null = null
  private dbManagerInitPromise: Promise<DatabaseManager> | null = null
  private ragEngineInitPromise: Promise<RAGEngine> | null = null
  private timeoutIds: ReturnType<typeof setTimeout>[] = [] // Use ReturnType instead of number

  async onload() {
    await this.loadSettings()

    // Initialize backend components
    this.conflictManager = new ConflictManager(this.app)
    this.vaultRpcHandler = new VaultRpcHandler(this.app)
    this.pendingSessionStore = new PendingSessionStore(this.app)
    initEditHistory(this.app, 5) // Store up to 5 versions per file for revert

    // Load client ID and pending sessions
    void this.initSessionPersistence()

    // Wire RPC handler to respond to backend requests
    // Note: tool_start/tool_end events are sent by the backend server itself,
    // so we don't need to emit them here. We just handle the RPC request.
    webSocketClient.on('rpc_request', async (msg: unknown) => {
      const rpcMsg = msg as RpcRequestMessage

      try {
        // Look up the activity ID tracked by BackendProvider's onToolStart.
        // This links the edit snapshot to the correct ActivityEvent for Undo.
        const activityId = webSocketClient.consumeActivityId(rpcMsg.method, rpcMsg.params) || rpcMsg.id
        const result = await this.vaultRpcHandler!.handleRpc(
          rpcMsg.method,
          rpcMsg.params,
          activityId,
        )

        webSocketClient.sendRpcResponse(rpcMsg.id, result)
      } catch (error) {
        console.error('[Claudsidian] RPC handler error:', error)

        webSocketClient.sendRpcResponse(rpcMsg.id, undefined, {
          code: 'RPC_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })

    // Ensure .claude/memory.md exists for persistent memory
    void this.initMemoryFile()

    // Auto-connect to backend if configured
    void this.connectBackend()

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this))
    this.registerView(APPLY_VIEW_TYPE, (leaf) => new ApplyView(leaf))

    // This creates an icon in the left ribbon.
    this.addRibbonIcon('wand-sparkles', 'Open Claudsidian chat', () =>
      this.openChatView(),
    )

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: 'open-new-chat',
      name: 'Open chat',
      callback: () => this.openChatView(true),
    })

    this.addCommand({
      id: 'add-selection-to-chat',
      name: 'Add selection to chat',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addSelectionToChat(editor, view)
      },
    })

    this.addCommand({
      id: 'rebuild-vault-index',
      name: 'Rebuild entire vault index',
      callback: async () => {
        const notice = new Notice('Rebuilding vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: true },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Rebuilding vault index complete')
        } catch (error) {
          console.error(error)
          notice.setMessage('Rebuilding vault index failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    this.addCommand({
      id: 'update-vault-index',
      name: 'Update index for modified files',
      callback: async () => {
        const notice = new Notice('Updating vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: false },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Vault index updated')
        } catch (error) {
          console.error(error)
          notice.setMessage('Vault index update failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SmartComposerSettingTab(this.app, this))

    void this.migrateToJsonStorage()
  }

  onunload() {
    // clear all timers
    this.timeoutIds.forEach((id) => clearTimeout(id))
    this.timeoutIds = []

    // Backend cleanup
    webSocketClient.disconnect()
    this.vaultRpcHandler = null
    this.conflictManager = null

    // RagEngine cleanup
    this.ragEngine?.cleanup()
    this.ragEngine = null

    // Promise cleanup
    this.dbManagerInitPromise = null
    this.ragEngineInitPromise = null

    // DatabaseManager cleanup
    this.dbManager?.cleanup()
    this.dbManager = null

    // StreamStateManager cleanup
    this.streamStateManager.cleanup()

    // McpManager cleanup
    this.mcpManager?.cleanup()
    this.mcpManager = null
  }

  async loadSettings() {
    const rawData = await this.loadData()
    this.settings = parseSmartComposerSettings(rawData)
    await this.saveData(this.settings)
  }

  async setSettings(newSettings: SmartComposerSettings) {
    const validationResult = smartComposerSettingsSchema.safeParse(newSettings)

    if (!validationResult.success) {
      new Notice(`Invalid settings:
${validationResult.error.issues.map((v) => v.message).join('\n')}`)
      return
    }

    this.settings = newSettings
    await this.saveData(newSettings)
    this.ragEngine?.setSettings(newSettings)
    this.settingsChangeListeners.forEach((listener) => listener(newSettings))
  }

  addSettingsChangeListener(
    listener: (newSettings: SmartComposerSettings) => void,
  ) {
    this.settingsChangeListeners.push(listener)
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter(
        (l) => l !== listener,
      )
    }
  }

  async openChatView(openNewChat = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const editor = view?.editor
    if (!view || !editor) {
      this.activateChatView(undefined, openNewChat)
      return
    }
    const selectedBlockData = await getMentionableBlockData(editor, view)
    this.activateChatView(
      {
        selectedBlock: selectedBlockData ?? undefined,
      },
      openNewChat,
    )
  }

  async activateChatView(chatProps?: ChatProps, openNewChat = false) {
    // chatProps is consumed in ChatView.tsx
    this.initialChatProps = chatProps

    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]

    await (leaf ?? this.app.workspace.getRightLeaf(false))?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    })

    if (openNewChat && leaf && leaf.view instanceof ChatView) {
      leaf.view.openNewChat(chatProps?.selectedBlock)
    }

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0],
    )
  }

  async addSelectionToChat(editor: Editor, view: MarkdownView) {
    const data = await getMentionableBlockData(editor, view)
    if (!data) return

    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      await this.activateChatView({
        selectedBlock: data,
      })
      return
    }

    // bring leaf to foreground (uncollapse sidebar if it's collapsed)
    await this.app.workspace.revealLeaf(leaves[0])

    const chatView = leaves[0].view
    chatView.addSelectionToChat(data)
    chatView.focusMessage()
  }

  async getDbManager(): Promise<DatabaseManager> {
    if (this.dbManager) {
      return this.dbManager
    }

    if (!this.dbManagerInitPromise) {
      this.dbManagerInitPromise = (async () => {
        try {
          this.dbManager = await DatabaseManager.create(this.app)
          return this.dbManager
        } catch (error) {
          this.dbManagerInitPromise = null
          if (error instanceof PGLiteAbortedException) {
            new InstallerUpdateRequiredModal(this.app).open()
          }
          throw error
        }
      })()
    }

    // if initialization is running, wait for it to complete instead of creating a new initialization promise
    return this.dbManagerInitPromise
  }

  async getRAGEngine(): Promise<RAGEngine> {
    if (this.ragEngine) {
      return this.ragEngine
    }

    if (!this.ragEngineInitPromise) {
      this.ragEngineInitPromise = (async () => {
        try {
          const dbManager = await this.getDbManager()
          this.ragEngine = new RAGEngine(
            this.app,
            this.settings,
            dbManager.getVectorManager(),
          )
          return this.ragEngine
        } catch (error) {
          this.ragEngineInitPromise = null
          throw error
        }
      })()
    }

    return this.ragEngineInitPromise
  }

  async getMcpManager(): Promise<McpManager> {
    if (this.mcpManager) {
      return this.mcpManager
    }

    try {
      this.mcpManager = new McpManager({
        settings: this.settings,
        registerSettingsListener: (
          listener: (settings: SmartComposerSettings) => void,
        ) => this.addSettingsChangeListener(listener),
      })
      await this.mcpManager.initialize()
      return this.mcpManager
    } catch (error) {
      this.mcpManager = null
      throw error
    }
  }

  private registerTimeout(callback: () => void, timeout: number): void {
    const timeoutId = setTimeout(callback, timeout)
    this.timeoutIds.push(timeoutId)
  }

  private async migrateToJsonStorage() {
    try {
      const dbManager = await this.getDbManager()
      await migrateToJsonDatabase(this.app, dbManager, async () => {
        await this.reloadChatView()
        console.log('Migration to JSON storage completed successfully')
      })
    } catch (error) {
      console.error('Failed to migrate to JSON storage:', error)
      new Notice(
        'Failed to migrate to JSON storage. Please check the console for details.',
      )
    }
  }

  private async reloadChatView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      return
    }
    new Notice('Reloading Claudsidian due to migration', 1000)
    leaves[0].detach()
    await this.activateChatView()
  }

  /**
   * Initialize client ID and pending session store.
   * After backend connects, resume any pending sessions.
   */
  private async initSessionPersistence() {
    try {
      this.clientId = await getClientId(this.app)
      await this.pendingSessionStore.load()
      console.log(`[Claudsidian] Client ID: ${this.clientId}, pending sessions: ${this.pendingSessionStore.getAll().length}`)
    } catch (err) {
      console.error('[Claudsidian] Failed to init session persistence:', err)
    }
  }

  /**
   * Resume pending sessions after backend connects.
   * Called from connectBackend after successful connection.
   */
  private async resumePendingSessions() {
    if (!this.clientId) return

    const pending = this.pendingSessionStore.getAll()
    if (pending.length === 0) return

    console.log(`[Claudsidian] Resuming ${pending.length} pending sessions`)

    // Listen for session_replay events
    const replayHandler = async (msg: unknown) => {
      const replay = msg as SessionReplayMessage
      console.log(`[Claudsidian] Session replay: ${replay.sessionId} (${replay.events.length} events, complete: ${replay.isComplete})`)

      if (replay.isComplete) {
        // Session finished — remove from pending
        await this.pendingSessionStore.remove(replay.sessionId)
      }

      // Emit a custom event that Chat.tsx can listen for
      webSocketClient.emit('session_recovered', replay)
    }

    webSocketClient.on('session_replay', replayHandler)

    // Resume each pending session
    for (const session of pending) {
      webSocketClient.resumeSession(session.sessionId, this.clientId, {
        onComplete: async () => {
          await this.pendingSessionStore.remove(session.sessionId)
        },
      })
    }
  }

  private async initMemoryFile() {
    try {
      const adapter = this.app.vault.adapter
      // Use adapter (filesystem) API since Obsidian doesn't index dotfiles
      if (!(await adapter.exists('.claude'))) {
        await adapter.mkdir('.claude')
      }
      if (!(await adapter.exists('.claude/memory.md'))) {
        await adapter.write(
          '.claude/memory.md',
          `## User Preferences\n\n## Projects\n\n## Key Decisions\n\n## Conventions\n`,
        )
        console.log('[Claudsidian] Created .claude/memory.md')
      }
    } catch (error) {
      // Non-critical — memory will be created when agent first writes to it
      console.debug('[Claudsidian] Could not initialize memory file:', error)
    }
  }

  async connectBackend() {
    const backendProvider = this.settings.providers.find(
      (p) => p.type === 'backend',
    )

    if (!backendProvider || backendProvider.type !== 'backend') {
      return
    }

    if (!backendProvider.backendUrl || !backendProvider.authToken) {
      console.warn(
        '[SmartComposer] Backend provider missing URL or auth token',
      )
      return
    }

    try {
      console.log('[SmartComposer] Connecting to backend...')
      await webSocketClient.connect(
        backendProvider.backendUrl,
        backendProvider.authToken,
      )
      new Notice('Connected to backend')

      // Resume any pending sessions from before Obsidian was closed
      void this.resumePendingSessions()
    } catch (error) {
      console.error('[SmartComposer] Failed to connect to backend:', error)
      new Notice(
        'Failed to connect to backend. Check console for details.',
      )
    }
  }
}
