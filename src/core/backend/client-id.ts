/**
 * Client ID — persistent workspace identifier stored in the vault.
 *
 * Shared across devices via Obsidian Sync so any device can resume
 * sessions created by another device with the same vault.
 */

import type { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

const CLIENT_ID_PATH = '.claude/client-id'

let cachedClientId: string | null = null

export async function getClientId(app: App): Promise<string> {
  if (cachedClientId) return cachedClientId

  try {
    const file = app.vault.getAbstractFileByPath(CLIENT_ID_PATH)
    if (file) {
      const content = await app.vault.read(file as any)
      const id = content.trim()
      if (id) {
        cachedClientId = id
        return id
      }
    }
  } catch {
    // File doesn't exist — will create below
  }

  // Generate and persist a new client ID
  const id = uuidv4()
  try {
    const dir = CLIENT_ID_PATH.split('/').slice(0, -1).join('/')
    if (dir) {
      const dirExists = app.vault.getAbstractFileByPath(dir)
      if (!dirExists) {
        await app.vault.createFolder(dir)
      }
    }

    const existing = app.vault.getAbstractFileByPath(CLIENT_ID_PATH)
    if (existing) {
      await app.vault.modify(existing as any, id)
    } else {
      await app.vault.create(CLIENT_ID_PATH, id)
    }
  } catch (err) {
    console.error('[ClientId] Failed to persist client ID:', err)
  }

  cachedClientId = id
  return id
}
