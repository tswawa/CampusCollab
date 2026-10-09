import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { installFromTrustedHost } from '../installation/service.js'
import { productNames } from '../../shared/brand.js'

const config = loadConfig()
if (config.nodeEnv === 'production') throw new Error('生产环境禁止写入演示账号')
const db = new AppDatabase(config)
try {
  db.migrate()
  if (Number(db.get('SELECT COUNT(*) count FROM users')?.count ?? 0) > 0) {
    throw new Error('数据库已有账号，拒绝覆盖；请使用独立开发或测试数据库')
  }
  const password = process.env.DEMO_PASSWORD
  if (!password) throw new Error('请显式设置 DEMO_PASSWORD；演示脚本不会提供固定默认密码')
  await installFromTrustedHost(db, { locale: 'zh-CN', name: '演示学校', platformName: productNames['zh-CN'], timezone: config.timezone,
    admin: { account: 'ADMIN001', name: '校园管理员', password } })
  await createAdminManagedUser(db, {
    role: 'teacher', account: 'T202401', name: '王建平', departmentId: 'dept-cs',
    password, approval: 'approved'
  })
  await createAdminManagedUser(db, {
    role: 'student', account: '32401058', name: '张明', departmentId: 'dept-cs', gradeId: 'grade-2024',
    classId: 'class-24se1', password, approval: 'approved'
  })
  await createAdminManagedUser(db, {
    role: 'teacher', account: 'T202699', name: '陈晓雯', departmentId: 'dept-ie',
    password, approval: 'pending'
  })
  console.log(`演示账号已写入非生产数据库：${config.databasePath}`)
  console.log(`统一演示密码：${password}`)
} finally { db.close() }
