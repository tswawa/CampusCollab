import type { InstallationStatus } from '../../shared/contracts.js'
import type { AppDatabase } from '../db/database.js'
import { getSchool } from '../db/models.js'

export function hasInstallationBusinessData(db: AppDatabase): boolean {
  return Boolean(db.get(`SELECT 1 WHERE EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM tasks)
    OR EXISTS (SELECT 1 FROM files) OR EXISTS (SELECT 1 FROM notices) OR EXISTS (SELECT 1 FROM audit_logs)
    OR EXISTS (SELECT 1 FROM retention_file_deletions) OR EXISTS (SELECT 1 FROM school_settings WHERE version > 1)`))
}

export function isInstallationConfigured(db: AppDatabase): boolean {
  return Boolean(db.get('SELECT configured_at FROM installation_state WHERE id=1')?.configured_at)
}

export function installationStatus(db: AppDatabase, credentialAvailable = false): InstallationStatus {
  const locale = getSchool(db).defaultLocale
  if (isInstallationConfigured(db)) return { status: 'configured', locale, setupAvailable: false }
  if (!db.get('SELECT id FROM installation_state WHERE id=1') || hasInstallationBusinessData(db)) {
    return { status: 'blocked', locale, setupAvailable: false }
  }
  return { status: 'required', locale, setupAvailable: credentialAvailable }
}
