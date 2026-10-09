import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'

const database = new AppDatabase(loadConfig())
try {
  database.migrate()
  console.log(`数据库迁移完成：${database.config.databasePath}`)
} finally {
  database.close()
}
