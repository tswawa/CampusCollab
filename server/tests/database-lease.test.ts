import assert from 'node:assert/strict'
import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { acquireDatabaseLease } from '../db/lease.js'

async function hold(databasePath: string, mode = 'kernel'): Promise<ChildProcess> {
  const child = fork(path.resolve('server/tests/fixtures/lease-holder.ts'), [databasePath, mode], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  let stderr = ''
  child.stderr!.on('data', chunk => {
    stderr += String(chunk)
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('Lease fixture did not become ready'))
    }, 10000)
    const onExit = () => finish(new Error(`Lease fixture exited before ready: ${stderr}`))
    const onError = (error: Error) => finish(error)
    const onMessage = (message: unknown) => {
      if (message === 'ready') finish()
    }
    function finish(error?: Error) {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
      child.off('message', onMessage)
      if (error) reject(error)
      else resolve()
    }
    child.once('exit', onExit)
    child.once('error', onError)
    child.on('message', onMessage)
  })
  return child
}

async function end(child: ChildProcess, crash: boolean) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (crash) child.kill('SIGKILL')
  else child.send('release')
  await exited
}

test('kernel lease rejects independent processes and aliases, then recovers after an actual child crash', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-kernel-lease-'))
  const storage = path.join(root, 'storage')
  fs.mkdirSync(storage)
  const databasePath = path.join(storage, 'campus.sqlite')
  fs.writeFileSync(databasePath, '')
  const alias = path.join(root, 'alias')
  fs.symlinkSync(storage, alias, process.platform === 'win32' ? 'junction' : 'dir')
  let child: ChildProcess | undefined
  try {
    child = await hold(databasePath)
    assert.throws(() => acquireDatabaseLease(databasePath), /数据库正在使用/)
    assert.throws(() => acquireDatabaseLease(path.join(alias, 'campus.sqlite')), /数据库正在使用/)
    const guard = path.join(`${databasePath}.lock`, 'lease.sqlite')
    const original = fs.statSync(guard)
    await end(child, true)
    assert.equal(fs.existsSync(guard), true, 'A crash must not unlink the persistent lock inode')
    child = await hold(path.join(alias, 'campus.sqlite'))
    assert.throws(() => acquireDatabaseLease(databasePath), /数据库正在使用/)
    await end(child, false)
    const reopened = acquireDatabaseLease(databasePath)
    try {
      assert.throws(() => acquireDatabaseLease(databasePath), /数据库正在使用/)
    } finally {
      reopened()
      reopened()
    }
    assert.equal(fs.statSync(guard).ino, original.ino, 'Release/recovery must retain the same guard file')
    assert.equal(fs.lstatSync(`${databasePath}.lock`).isDirectory(), true)
  } finally {
    if (child) await end(child, true)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('legacy PID locks are never removed automatically, even for a live holder or a reused PID', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-legacy-lease-'))
  const databasePath = path.join(root, 'campus.sqlite')
  fs.writeFileSync(databasePath, '')
  let child: ChildProcess | undefined
  try {
    child = await hold(databasePath, 'legacy')
    const activeContents = fs.readFileSync(`${databasePath}.lock`, 'utf8')
    assert.throws(() => acquireDatabaseLease(databasePath), /停止所有.*归档旧锁/)
    assert.equal(fs.readFileSync(`${databasePath}.lock`, 'utf8'), activeContents)
    await end(child, false)
    for (const pid of [process.pid, 2147483647]) {
      const contents = JSON.stringify({ pid, token: 'old-generation', createdAt: '2000-01-01' })
      fs.writeFileSync(`${databasePath}.lock`, contents)
      assert.throws(() => acquireDatabaseLease(databasePath), /停止所有.*归档旧锁/)
      assert.equal(fs.readFileSync(`${databasePath}.lock`, 'utf8'), contents)
      // Only this fixture's known stopped legacy marker is archived by the operator.
      fs.renameSync(`${databasePath}.lock`, path.join(root, `archived-${pid}.json`))
    }
    const release = acquireDatabaseLease(databasePath)
    try {
      const old = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import fs from 'node:fs';fs.openSync(process.argv[1], 'wx')",
          `${databasePath}.lock`
        ],
        { encoding: 'utf8' }
      )
      assert.notEqual(old.status, 0, 'The old PID implementation cannot claim the new lock directory')
    } finally {
      release()
    }
  } finally {
    if (child) await end(child, true)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
