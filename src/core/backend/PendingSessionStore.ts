/**
 * PendingSessionStore
 *
 * Persists pending session IDs to the vault so they survive Obsidian restarts.
 * On plugin load, pending sessions are read and resumed from the server.
 */

import type { App } from 'obsidian'

interface PendingSession {
  sessionId: string
  conversationId: string
  createdAt: number
}

interface PendingSessionData {
  sessions: PendingSession[]
}

const STORE_PATH = '.smartcomposer/pending-sessions.json'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours (matches server TTL)

export class PendingSessionStore {
  private sessions: PendingSession[] = []

  constructor(private app: App) {}

  async load(): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(STORE_PATH)
      if (file) {
        const content = await this.app.vault.read(file as any)
        const data: PendingSessionData = JSON.parse(content)
        // Filter out expired sessions
        const now = Date.now()
        this.sessions = (data.sessions || []).filter(
          (s) => now - s.createdAt < MAX_AGE_MS,
        )
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
      this.sessions = []
    }
  }

  async add(sessionId: string, conversationId: string): Promise<void> {
    // Don't add duplicates
    if (this.sessions.some((s) => s.sessionId === sessionId)) return

    this.sessions.push({ sessionId, conversationId, createdAt: Date.now() })
    await this.save()
  }

  async remove(sessionId: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId)
    await this.save()
  }

  getAll(): PendingSession[] {
    return [...this.sessions]
  }

  getByConversation(conversationId: string): PendingSession | undefined {
    return this.sessions.find((s) => s.conversationId === conversationId)
  }

  private async save(): Promise<void> {
    const data: PendingSessionData = { sessions: this.sessions }
    const content = JSON.stringify(data, null, 2)

    try {
      const file = this.app.vault.getAbstractFileByPath(STORE_PATH)
      if (file) {
        await this.app.vault.modify(file as any, content)
      } else {
        // Ensure directory exists
        const dir = STORE_PATH.split('/').slice(0, -1).join('/')
        if (dir) {
          const dirExists = this.app.vault.getAbstractFileByPath(dir)
          if (!dirExists) {
            await this.app.vault.createFolder(dir)
          }
        }
        await this.app.vault.create(STORE_PATH, content)
      }
    } catch (err) {
      console.error('[PendingSessionStore] Failed to save:', err)
    }
  }
}
