/**
 * Client ID — persistent workspace identifier stored in the vault.
 *
 * Shared across devices via Obsidian Sync so any device can resume
 * sessions created by another device with the same vault.
 *
 * Uses app.vault.adapter (filesystem API) since Obsidian doesn't
 * index dotfiles via the vault API.
 */

import type { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

const CLIENT_ID_PATH = '.claude/client-id'

let cachedClientId: string | null = null

export async function getClientId(app: App): Promise<string> {
  if (cachedClientId) return cachedClientId

  const adapter = app.vault.adapter

  try {
    if (await adapter.exists(CLIENT_ID_PATH)) {
      const content = await adapter.read(CLIENT_ID_PATH)
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
    if (!(await adapter.exists('.claude'))) {
      await adapter.mkdir('.claude')
    }
    await adapter.write(CLIENT_ID_PATH, id)
  } catch (err) {
    console.error('[ClientId] Failed to persist client ID:', err)
  }

  cachedClientId = id
  return id
}
