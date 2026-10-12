import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Keep a separate rollback-journal database locked for the whole process lifetime.
// Kernel locks survive PID namespaces and are released after a crash. Never unlink
// its directory/file: another process could still hold the old inode's lock.
export function acquireDatabaseLease(databasePath: string): () => void {
  if (databasePath === ':memory:') return () => {}
  const absolute = path.resolve(databasePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  let databaseExists = false
  try {
    fs.lstatSync(absolute)
    databaseExists = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const canonical = databaseExists
    ? fs.realpathSync(absolute)
    : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute))
  if (fs.existsSync(canonical) && fs.statSync(canonical).nlink > 1) {
    throw new Error('数据库路径不能使用硬链接；请使用同一个规范数据库路径')
  }
  const directory = `${canonical}.lock`
  // mkdir competes atomically with the old implementation's open(..., 'wx').
  // A legacy JSON file is never declared stale from this namespace's PID view.
  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const entry = fs.lstatSync(directory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(
      '检测到旧版或无效的 .lock 文件；请停止所有使用此数据库的服务和运维命令，确认后归档旧锁文件再升级，不能按 PID 自动删除'
    )
  }
  const filename = path.join(directory, 'lease.sqlite')
  try {
    const file = fs.lstatSync(filename)
    if (!file.isFile() || file.isSymbolicLink() || file.nlink > 1)
      throw new Error('数据库互斥锁路径无效，请检查 .lock/lease.sqlite')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let guard: DatabaseSync | undefined
  try {
    guard = new DatabaseSync(filename)
    guard.exec(`PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; PRAGMA locking_mode = EXCLUSIVE;
      BEGIN EXCLUSIVE;
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1));
      INSERT OR IGNORE INTO lease(id) VALUES(1);
      COMMIT; BEGIN EXCLUSIVE;`)
  } catch (error) {
    guard?.close()
    if ([5, 6].includes(Number((error as { errcode?: number }).errcode)) || /(?:locked|busy)/i.test(String(error))) {
      throw new Error('数据库正在使用，请先停止服务或其他运维命令再操作')
    }
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    // close releases the transaction/kernel lock even if no graceful signal ran.
    guard!.close()
  }
}
