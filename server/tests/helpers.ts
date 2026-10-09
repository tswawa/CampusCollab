import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import type { SessionData } from '../../shared/contracts.js'
import { buildApp, type BuiltApp } from '../app.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'

export const testOrigin = 'http://test.local'

export interface TestContext extends BuiltApp {
  root: string
}

export async function createTestApp(): Promise<TestContext> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-api-'))
  const built = await buildApp({
    logger: false,
    config: {
      nodeEnv: 'test',
      databasePath: path.join(root, 'campus.sqlite'),
      uploadDir: path.join(root, 'uploads'),
      backupDir: path.join(root, 'backups'),
      appOrigins: [testOrigin],
      secureCookie: false,
      serveClient: false,
      mail: { enabled: false, host: '', port: 587, secure: false, user: '', password: '', from: '', pollIntervalMs: 15000 }
    }
  })
  // Most suites exercise an existing deployment. Installation has its own fresh-DB fixtures.
  built.db.run("UPDATE installation_state SET configured_at=?,source='fixture' WHERE id=1 AND configured_at IS NULL", new Date().toISOString())
  return { ...built, root }
}

export async function closeTestApp(context: TestContext) {
  await context.app.close()
  fs.rmSync(context.root, { recursive: true, force: true })
}

export function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie']
  const line = Array.isArray(header) ? header[0] : header
  if (!line) throw new Error('响应未设置会话 Cookie')
  return line.split(';', 1)[0]
}

export function dataOf<T>(response: LightMyRequestResponse): T {
  const payload = response.json() as { ok: boolean; data?: T; message?: string }
  if (!payload.ok) throw new Error(payload.message || '请求失败')
  return payload.data as T
}

export async function anonymousSession(context: TestContext) {
  const response = await context.app.inject({ method: 'GET', url: '/api/auth/session' })
  const data = dataOf<{ user: unknown; csrfToken: string }>(response)
  return { cookie: cookieFrom(response), csrf: data.csrfToken }
}

export async function login(context: TestContext, account: string, password: string) {
  const anonymous = await anonymousSession(context)
  const response = await context.app.inject({
    method: 'POST', url: '/api/auth/login',
    headers: { origin: testOrigin, cookie: anonymous.cookie, 'x-csrf-token': anonymous.csrf },
    payload: { account, password }
  })
  const data = dataOf<SessionData>(response)
  if (!data.user) throw new Error('登录响应缺少用户')
  return { response, cookie: cookieFrom(response), csrf: data.csrfToken, user: data.user }
}

export async function createAdmin(context: TestContext, account = 'ADMIN001', password = 'Admin@123') {
  return createAdminManagedUser(context.db, {
    role: 'admin', account, name: '测试管理员', departmentId: 'dept-admin', password, approval: 'approved'
  })
}
