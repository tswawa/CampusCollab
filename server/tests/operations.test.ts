import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase, nowIso } from '../db/database.js'
import { loadConfig } from '../config.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'

function runScript(script: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, `${script} 失败：${result.stderr || result.stdout}`)
  return result.stdout
}

test('pre-upgrade backup preserves an old database without applying newer migrations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-old-backup-'))
  const databasePath = path.join(root, 'legacy.sqlite')
  const backupDir = path.join(root, 'backups')
  try {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(fs.readFileSync(path.resolve('server/db/migrations/001_initial.sql'), 'utf8'))
    legacy
      .prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)')
      .run('001_initial.sql', nowIso())
    legacy.close()
    runScript('server/scripts/backup.ts', {
      NODE_ENV: 'test',
      DATABASE_PATH: databasePath,
      UPLOAD_DIR: path.join(root, 'uploads'),
      BACKUP_DIR: backupDir
    })
    const names = fs.readdirSync(backupDir)
    assert.equal(names.length, 1)
    for (const file of [databasePath, path.join(backupDir, names[0]!, 'campus.sqlite')]) {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations').get()!.count, 1)
        assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='workflow_tasks'").get(), undefined)
      } finally {
        db.close()
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('停服备份恢复同时覆盖数据库和上传目录，并使全部会话失效', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-ops-'))
  const databasePath = path.join(root, 'campus.sqlite')
  const uploadDir = path.join(root, 'uploads')
  const backupDir = path.join(root, 'backups')
  const env = { NODE_ENV: 'test', DATABASE_PATH: databasePath, UPLOAD_DIR: uploadDir, BACKUP_DIR: backupDir }
  try {
    const db = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath, uploadDir, backupDir }))
    db.migrate()
    const admin = await createAdminManagedUser(db, {
      role: 'admin',
      account: 'OPSADMIN',
      name: '运维管理员',
      departmentId: 'dept-admin',
      password: 'Admin@123',
      approval: 'approved'
    })
    db.run(
      `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at, created_at, updated_at)
      VALUES ('ops-session', ?, 'ops-csrf', ?, ?, ?)`,
      admin.id,
      Date.now() + 60_000,
      nowIso(),
      nowIso()
    )
    db.close()
    fs.mkdirSync(uploadDir, { recursive: true })
    fs.writeFileSync(path.join(uploadDir, 'marker.txt'), 'original')

    runScript('server/scripts/backup.ts', env)
    const backups = fs.readdirSync(backupDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    assert.equal(backups.length, 1)
    const backupPath = path.join(backupDir, backups[0].name)
    assert.ok(fs.existsSync(path.join(backupPath, 'manifest.json')))
    assert.ok(fs.existsSync(path.join(backupPath, 'campus.sqlite')))
    assert.equal(fs.readFileSync(path.join(backupPath, 'uploads', 'marker.txt'), 'utf8'), 'original')

    const mutated = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath, uploadDir, backupDir }))
    mutated.run("UPDATE school_settings SET name = '被修改大学' WHERE id = 1")
    mutated.run('DELETE FROM sessions')
    mutated.run('DELETE FROM users')
    const concurrentRestore = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'server/scripts/restore.ts', backupPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: 'utf8'
      }
    )
    assert.notEqual(concurrentRestore.status, 0)
    assert.match(concurrentRestore.stderr, /数据库正在使用/)
    const concurrentBackup = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/backup.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf8'
    })
    assert.notEqual(concurrentBackup.status, 0)
    assert.match(concurrentBackup.stderr, /数据库正在使用/)
    assert.equal(mutated.get('SELECT name FROM school_settings WHERE id = 1')?.name, '被修改大学')
    mutated.close()
    fs.writeFileSync(path.join(uploadDir, 'marker.txt'), 'mutated')

    runScript('server/scripts/restore.ts', env, [backupPath])
    const restored = new AppDatabase(loadConfig({ nodeEnv: 'test', databasePath, uploadDir, backupDir }))
    assert.equal(restored.get('SELECT name FROM school_settings WHERE id = 1')?.name, 'XX大学')
    assert.equal(restored.get('SELECT COUNT(*) count FROM users')?.count, 1)
    assert.equal(restored.get('SELECT COUNT(*) count FROM sessions')?.count, 0)
    restored.close()
    assert.equal(fs.readFileSync(path.join(uploadDir, 'marker.txt'), 'utf8'), 'original')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
