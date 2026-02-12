import { SettingMigration } from '../setting.types'

/**
 * Migration from version 12 to version 13
 * - Add externalResourceDir setting (vault-relative path to PDFs/cookbooks)
 */
export const migrateFrom12To13: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 13

  if (!('externalResourceDir' in newData)) {
    newData.externalResourceDir = ''
  }

  return newData
}
