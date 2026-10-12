import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// 浏览器验收同时运行编译后的前端和后端；测试夹具不进入生产构建。
const { buildApp } = (await import(
  pathToFileURL(path.resolve('dist-server/server/app.js')).href
)) as typeof import('../app.js')
const { createAdminManagedUser } = (await import(
  pathToFileURL(path.resolve('dist-server/server/modules/accounts.service.js')).href
)) as typeof import('../modules/accounts.service.js')
const { installFromTrustedHost } = (await import(
  pathToFileURL(path.resolve('dist-server/server/installation/service.js')).href
)) as typeof import('../installation/service.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-browser-e2e-'))
const origin = 'http://127.0.0.1:4190'
const freshSetup = process.env.E2E_FRESH_SETUP === '1'
const built = await buildApp({
  logger: false,
  config: {
    nodeEnv: 'production',
    host: '127.0.0.1',
    port: 4190,
    appOrigins: [origin],
    secureCookie: false,
    databasePath: path.join(root, 'campus.sqlite'),
    uploadDir: path.join(root, 'uploads'),
    backupDir: path.join(root, 'backups'),
    serveClient: true,
    clientDist: path.resolve('dist'),
    // Fictional credential confined to this new temporary database, never a deployment secret.
    setupToken: freshSetup ? 'E2E-FICTIONAL-SETUP-TOKEN-0123456789' : '',
    mail: {
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      from: '',
      pollIntervalMs: 15000
    }
  }
})
const password = 'E2E@Browser123'
if (!freshSetup) {
  await installFromTrustedHost(built.db, {
    locale: 'zh-CN',
    name: '端到端示例大学',
    platformName: '校园任务协作',
    timezone: 'Asia/Shanghai',
    admin: { account: 'E2EADMIN', name: '端到端管理员', password }
  })
  await createAdminManagedUser(built.db, {
    role: 'teacher',
    account: 'E2ETEACHER',
    name: '端到端教师',
    departmentId: 'dept-cs',
    password,
    approval: 'approved'
  })
  await createAdminManagedUser(built.db, {
    role: 'student',
    account: 'E2ESTUDENT',
    name: '端到端学生',
    departmentId: 'dept-cs',
    gradeId: 'grade-2024',
    classId: 'class-24se1',
    password,
    approval: 'approved'
  })
}

const shutdown = async () => {
  try {
    await built.app.close()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(0)
  }
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
await built.app.listen({ host: '127.0.0.1', port: 4190 })
console.log(`E2E_READY ${origin}`)
