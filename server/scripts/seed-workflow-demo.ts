import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { seedWorkflowDemo } from '../demo/workflow-seed.js'
import { getUserById, normalizeAccount } from '../db/models.js'

const config = loadConfig()
if (config.nodeEnv === 'production') throw new Error('Fictional demo is disabled in production / 生产环境禁止写入演示')
const teacherAccount = process.env.DEMO_TEACHER_ACCOUNT
if (!teacherAccount)
  throw new Error('Set DEMO_TEACHER_ACCOUNT to an existing approved coordinator account / 请指定已审核教师账号')
const db = new AppDatabase(config)
try {
  db.migrate()
  const row = db.get(
    "SELECT id FROM users WHERE account_normalized=? AND role='teacher' AND approval='approved'",
    normalizeAccount(teacherAccount)
  )
  const teacher = row ? getUserById(db, String(row.id)) : undefined
  if (!teacher) throw new Error('Approved coordinator account not found / 找不到已审核教师账号')
  const result = seedWorkflowDemo(db, teacher)
  console.log(
    JSON.stringify(
      { taskId: result.taskId, snapshotId: result.snapshot.id, reused: result.reused, totals: result.snapshot.totals },
      null,
      2
    )
  )
} finally {
  db.close()
}
