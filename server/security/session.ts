import '@fastify/cookie'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CampusUser, UserRole } from '../../shared/contracts.js'
import type { AppConfig } from '../config.js'
import type { AppDatabase } from '../db/database.js'
import { nowIso } from '../db/database.js'
import { getUserById } from '../db/models.js'
import { AppError } from '../errors.js'

const cookieName = 'campus_session'

const tokenHash = (token: string) => createHash('sha256').update(token).digest('base64url')
const randomToken = () => randomBytes(32).toString('base64url')

export interface SessionContext {
  tokenHash: string
  csrfToken: string
  user: CampusUser | null
  expiresAt: number
}

export class SessionService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig
  ) {}

  private setCookie(reply: FastifyReply, token: string, ttlSeconds: number) {
    reply.setCookie(cookieName, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookie,
      maxAge: ttlSeconds
    })
  }

  private create(reply: FastifyReply, userId: string | null): SessionContext {
    const token = randomToken()
    const csrfToken = randomToken()
    const ttl = userId ? this.config.sessionTtlSeconds : this.config.preSessionTtlSeconds
    const expiresAt = Date.now() + ttl * 1000
    const hash = tokenHash(token)
    const timestamp = nowIso()
    this.db.run(
      `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
      hash,
      userId,
      csrfToken,
      expiresAt,
      timestamp,
      timestamp
    )
    this.setCookie(reply, token, ttl)
    return { tokenHash: hash, csrfToken, user: userId ? (getUserById(this.db, userId) ?? null) : null, expiresAt }
  }

  resolve(request: FastifyRequest): SessionContext | null {
    const token = request.cookies[cookieName]
    if (!token || token.length > 128) return null
    const hash = tokenHash(token)
    const row = this.db.get('SELECT * FROM sessions WHERE token_hash = ?', hash)
    if (!row) return null
    if (Number(row.expires_at) <= Date.now()) {
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', hash)
      return null
    }
    const user = row.user_id ? (getUserById(this.db, String(row.user_id)) ?? null) : null
    if (row.user_id && (!user || user.approval !== 'approved')) {
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', hash)
      return null
    }
    return { tokenHash: hash, csrfToken: String(row.csrf_token), user, expiresAt: Number(row.expires_at) }
  }

  ensure(request: FastifyRequest, reply: FastifyReply): SessionContext {
    const current = this.resolve(request)
    if (current) return current
    return this.create(reply, null)
  }

  login(request: FastifyRequest, reply: FastifyReply, userId: string): SessionContext {
    const current = this.resolve(request)
    if (current) this.db.run('DELETE FROM sessions WHERE token_hash = ?', current.tokenHash)
    return this.create(reply, userId)
  }

  logout(request: FastifyRequest, reply: FastifyReply) {
    const current = this.resolve(request)
    if (current) this.db.run('DELETE FROM sessions WHERE token_hash = ?', current.tokenHash)
    reply.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: this.config.secureCookie })
  }

  requireUser(request: FastifyRequest, roles?: UserRole[], options?: { allowPasswordChange?: boolean }): CampusUser {
    const session = this.resolve(request)
    if (!session?.user) throw new AppError(401, 'AUTH_REQUIRED', '请先登录')
    if (roles && !roles.includes(session.user.role)) throw new AppError(403, 'FORBIDDEN', '没有操作权限')
    if (session.user.mustChangePassword && options?.allowPasswordChange !== true) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码')
    }
    return session.user
  }

  verifyMutation(request: FastifyRequest) {
    const origin = request.headers.origin
    if (!origin || !this.config.appOrigins.includes(origin)) {
      throw new AppError(403, 'ORIGIN_REJECTED', '请求来源无效')
    }
    const session = this.resolve(request)
    if (!session) throw new AppError(403, 'CSRF_SESSION_REQUIRED', '会话已失效，请刷新页面')
    const supplied = request.headers['x-csrf-token']
    if (typeof supplied !== 'string') throw new AppError(403, 'CSRF_INVALID', '安全校验失败，请刷新页面')
    const expectedBuffer = Buffer.from(session.csrfToken)
    const suppliedBuffer = Buffer.from(supplied)
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new AppError(403, 'CSRF_INVALID', '安全校验失败，请刷新页面')
    }
  }

  invalidateUser(userId: string) {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId)
  }

  invalidateUserExcept(userId: string, keepTokenHash: string) {
    this.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, keepTokenHash)
  }

  invalidateAll() {
    this.db.run('DELETE FROM sessions')
  }

  cleanupExpired() {
    this.db.run('DELETE FROM sessions WHERE expires_at <= ?', Date.now())
  }
}
