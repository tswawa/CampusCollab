import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { cleanupExpiredTemporaryFiles } from '../modules/file-cleanup.js'

const db = new AppDatabase(loadConfig())
try {
  db.migrate()
  const { deleted, failed } = cleanupExpiredTemporaryFiles(db)
  console.log(`已清理 ${deleted} 个过期临时文件；待重试 ${failed} 个`)
} finally {
  db.close()
}
