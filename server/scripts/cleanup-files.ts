import fs from 'node:fs'
import path from 'node:path'
import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { fileIsReferenced } from '../modules/workflow.service.js'

const db = new AppDatabase(loadConfig())
try {
  db.migrate()
  const expired = db.all<{ id: string; stored_name: string } & Record<string, unknown>>(
    "SELECT id, stored_name FROM files WHERE status = 'temporary' AND expires_at IS NOT NULL AND expires_at <= ?", Date.now()
  ).filter((file) => {
    if (fileIsReferenced(db, file.id)) return false
    const absolute = path.resolve(db.config.uploadDir, file.stored_name)
    if (!absolute.startsWith(path.resolve(db.config.uploadDir) + path.sep)) return false
    if (!fs.existsSync(absolute)) return true
    const stat = fs.lstatSync(absolute)
    return stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(absolute).startsWith(fs.realpathSync(db.config.uploadDir) + path.sep)
  })
  let deleted = 0
  expired.forEach((file) => {
    const absolute = path.resolve(db.config.uploadDir, file.stored_name)
    if (!absolute.startsWith(path.resolve(db.config.uploadDir) + path.sep)) return
    try {
      try { fs.unlinkSync(absolute) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (fs.existsSync(absolute)) throw new Error('Temporary file still exists after removal')
      db.run('DELETE FROM files WHERE id = ?', file.id)
      deleted += 1
    } catch { /* Keep the record so the operator can retry a failed deletion. */ }
  })
  console.log(`已清理 ${deleted} 个过期临时文件；待重试 ${expired.length - deleted} 个`)
} finally { db.close() }
