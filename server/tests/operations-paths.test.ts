import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertBackupLayout, copyDirectory } from '../scripts/filesystem.js'

test('backup rejects equal, nested and aliased paths before opening SQLite or creating a destination', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-backup-paths-'))
  try {
    const databasePath = path.join(root, 'campus.sqlite')
    const original = Buffer.from('Fixture: this must never be opened as SQLite')
    fs.writeFileSync(databasePath, original)
    const uploads = path.join(root, 'uploads'); fs.mkdirSync(uploads)
    fs.writeFileSync(path.join(uploads, 'sentinel.txt'), 'unchanged')
    const alias = path.join(root, 'upload-alias')
    fs.symlinkSync(uploads, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const cases = [
      { uploadDir: uploads, backupDir: uploads },
      { uploadDir: uploads, backupDir: path.join(uploads, 'backups') },
      { uploadDir: path.join(root, 'backups', 'uploads'), backupDir: path.join(root, 'backups') },
      { uploadDir: uploads, backupDir: path.join(alias, 'not-created', 'backups') },
      { uploadDir: root, backupDir: path.join(root, 'outside-uploads') }
    ]
    for (const entry of cases) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/backup.ts'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_ENV: 'test', MAIL_ENABLED: 'false', SETUP_TOKEN: '', DATABASE_PATH: databasePath,
          UPLOAD_DIR: entry.uploadDir, BACKUP_DIR: entry.backupDir }
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /备份与数据路径不能/)
      assert.deepEqual(fs.readFileSync(databasePath), original)
      assert.equal(fs.existsSync(`${databasePath}.lock`), false)
      assert.deepEqual(fs.readdirSync(uploads), ['sentinel.txt'])
      assert.equal(fs.existsSync(path.join(root, 'backups')), false)
    }
    assert.throws(() => assertBackupLayout({ databasePath, uploadDir: path.join(root, 'separate-uploads'), backupDir: root }), /备份与数据路径不能/)
    const aliasFile = path.join(root, 'database-hardlink.sqlite'); fs.linkSync(databasePath, aliasFile)
    assert.throws(() => assertBackupLayout({ databasePath, uploadDir: path.join(root, 'separate-uploads'), backupDir: aliasFile }), /同一文件/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('copyDirectory rejects self-copy through an alias before mkdir and accepts separate trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-copy-paths-'))
  try {
    const source = path.join(root, 'source'); fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'fixture.txt'), 'original')
    const alias = path.join(root, 'alias')
    fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => copyDirectory(source, path.join(alias, 'nested')), /备份与数据路径不能/)
    assert.deepEqual(fs.readdirSync(source), ['fixture.txt'])
    const target = path.join(root, 'target')
    copyDirectory(source, target)
    assert.equal(fs.readFileSync(path.join(target, 'fixture.txt'), 'utf8'), 'original')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('restore rejects an aliased upload source before opening or replacing destination data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-restore-paths-'))
  try {
    const databasePath = path.join(root, 'campus.sqlite')
    const original = Buffer.from('Fixture database must not be opened')
    fs.writeFileSync(databasePath, original)
    const uploads = path.join(root, 'uploads'); fs.mkdirSync(uploads)
    fs.writeFileSync(path.join(uploads, 'sentinel.txt'), 'original')
    const alias = path.join(root, 'source-alias')
    fs.symlinkSync(uploads, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const backupDir = path.join(root, 'backups')
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/restore.ts', alias], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, NODE_ENV: 'test', MAIL_ENABLED: 'false', SETUP_TOKEN: '', DATABASE_PATH: databasePath,
        UPLOAD_DIR: uploads, BACKUP_DIR: backupDir }
    })
    assert.notEqual(result.status, 0); assert.match(result.stderr, /备份与数据路径不能/)
    assert.deepEqual(fs.readFileSync(databasePath), original)
    assert.equal(fs.existsSync(`${databasePath}.lock`), false)
    assert.equal(fs.existsSync(backupDir), false)
    assert.equal(fs.readFileSync(path.join(uploads, 'sentinel.txt'), 'utf8'), 'original')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
