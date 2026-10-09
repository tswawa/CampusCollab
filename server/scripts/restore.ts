import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import { loadConfig, projectRoot } from '../config.js'
import { acquireDatabaseLease } from '../db/lease.js'
import { assertBackupLayout, assertSeparatePaths, canonicalPath, containsPath, copyDirectory } from './filesystem.js'

const config = loadConfig()
const argument = process.argv[2] || process.env.BACKUP_SOURCE
if (!argument) throw new Error('请传入备份目录：npm run db:restore -- <备份目录>')
const source = path.resolve(argument)
const manifestPath = path.join(source, 'manifest.json')
const sourceDatabase = path.join(source, 'campus.sqlite')
const sourceUploads = path.join(source, 'uploads')
assertBackupLayout(config)
assertSeparatePaths(source, config.databasePath)
assertSeparatePaths(source, config.uploadDir)
assertSeparatePaths(sourceDatabase, config.databasePath)
if (containsPath(canonicalPath(source), canonicalPath(config.backupDir))) {
  throw new Error('备份源、目标数据库、上传目录及安全副本目录不能相互覆盖')
}
if (!fs.existsSync(manifestPath) || !fs.existsSync(sourceDatabase)) throw new Error('备份目录缺少 manifest.json 或 campus.sqlite')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { format?: string }
if (manifest.format !== 'campus-backup-v1') throw new Error('不支持的备份格式')
const release = acquireDatabaseLease(config.databasePath)
const token = randomUUID()
const stagedDatabase = `${config.databasePath}.restore-${token}`
const stagedUploads = `${config.uploadDir}.restore-${token}`
let safetyCopy = ''
try {
  const verification = new DatabaseSync(sourceDatabase, { readOnly: true })
  try {
    const integrity = verification.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    if (!Object.values(integrity).includes('ok') || verification.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('备份数据库完整性或关联检查失败')
    }
    for (const table of ['schema_migrations', 'users', 'tasks', 'files', 'sessions', 'school_settings']) {
      if (!verification.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
        throw new Error(`备份数据库缺少表：${table}`)
      }
    }
    const knownMigrations = fs.readdirSync(path.join(projectRoot, 'server/db/migrations')).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()
    const appliedMigrations = verification.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string }>
    if (!appliedMigrations.length || appliedMigrations.some((migration, index) =>
      knownMigrations[index] !== migration.name || Number(migration.name.split('_', 1)[0]) !== migration.version)) {
      throw new Error('备份数据库版本与当前程序不兼容')
    }
    const storedFiles = verification.prepare('SELECT stored_name FROM files').all() as { stored_name: string }[]
    for (const file of storedFiles) {
      const filename = path.resolve(sourceUploads, file.stored_name)
      if (!containsPath(canonicalPath(sourceUploads), canonicalPath(filename)) || !fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) {
        throw new Error('备份缺少附件或含非法附件路径，未覆盖现有数据')
      }
    }
  } finally { verification.close() }

  // 先完整准备恢复副本，任何预检/复制失败都不会更改目标数据。
  fs.copyFileSync(sourceDatabase, stagedDatabase)
  const prepared = new DatabaseSync(stagedDatabase)
  try { prepared.exec('DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE);') } finally { prepared.close() }
  if (fs.existsSync(sourceUploads)) copyDirectory(sourceUploads, stagedUploads)
  else fs.mkdirSync(stagedUploads, { recursive: true })

  const hadDatabase = fs.existsSync(config.databasePath)
  const hadUploads = fs.existsSync(config.uploadDir)
  safetyCopy = path.join(config.backupDir, `before-restore-${token}`)
  fs.mkdirSync(safetyCopy, { recursive: true })
  if (hadDatabase) {
    const current = new DatabaseSync(config.databasePath)
    try {
      current.exec('PRAGMA busy_timeout = 1000; PRAGMA wal_checkpoint(TRUNCATE);')
      await backup(current, path.join(safetyCopy, 'campus.sqlite'))
    } finally { current.close() }
  }
  if (hadUploads) copyDirectory(config.uploadDir, path.join(safetyCopy, 'uploads'))
  fs.writeFileSync(path.join(safetyCopy, 'manifest.json'), JSON.stringify({
    format: 'campus-backup-v1', createdAt: new Date().toISOString(), database: 'campus.sqlite', uploads: 'uploads'
  }, null, 2))

  try {
    fs.rmSync(config.uploadDir, { recursive: true, force: true })
    copyDirectory(stagedUploads, config.uploadDir)
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${config.databasePath}${suffix}`, { force: true })
    fs.copyFileSync(stagedDatabase, config.databasePath)
  } catch (error) {
    // 恢复失败时回滚本次改写，安全副本始终保留。
    if (hadDatabase) fs.copyFileSync(path.join(safetyCopy, 'campus.sqlite'), config.databasePath)
    else fs.rmSync(config.databasePath, { force: true })
    fs.rmSync(config.uploadDir, { recursive: true, force: true })
    if (hadUploads) copyDirectory(path.join(safetyCopy, 'uploads'), config.uploadDir)
    throw error
  }
  console.log(`恢复完成，全部会话已失效：${source}`)
  console.log(`恢复前安全副本：${safetyCopy}`)
} finally {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${stagedDatabase}${suffix}`, { force: true })
  fs.rmSync(stagedUploads, { recursive: true, force: true })
  release()
}
