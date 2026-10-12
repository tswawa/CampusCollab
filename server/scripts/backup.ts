import fs from 'node:fs'
import path from 'node:path'
import { backup } from 'node:sqlite'
import { AppDatabase, nowIso } from '../db/database.js'
import { loadConfig } from '../config.js'
import { assertBackupLayout, copyDirectory } from './filesystem.js'

const config = loadConfig()
assertBackupLayout(config)
if (!fs.existsSync(config.databasePath)) throw new Error('Cannot back up a database that does not exist')
const db = new AppDatabase(config)
try {
  // A pre-upgrade backup must never apply the new application's migrations.
  if (!db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"))
    throw new Error('Database has no recognized migration history')
  fs.mkdirSync(config.backupDir, { recursive: true })
  const label = nowIso().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const destination = path.join(config.backupDir, `backup-${label}`)
  fs.mkdirSync(destination, { recursive: false })
  const databaseCopy = path.join(destination, 'campus.sqlite')
  await backup(db.raw, databaseCopy)
  const uploadsCopy = path.join(destination, 'uploads')
  if (fs.existsSync(config.uploadDir)) copyDirectory(config.uploadDir, uploadsCopy)
  const versions = db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
  fs.writeFileSync(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        format: 'campus-backup-v1',
        createdAt: nowIso(),
        database: 'campus.sqlite',
        uploads: 'uploads',
        migrations: versions
      },
      null,
      2
    )
  )
  console.log(`备份完成：${destination}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  db.close()
}
