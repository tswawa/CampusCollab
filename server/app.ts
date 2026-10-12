import fs from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { loadConfig } from './config.js'
import { AppDatabase } from './db/database.js'
import { AppError } from './errors.js'
import { registerAdminAccountRoutes } from './modules/admin-accounts.js'
import { registerAdminCatalogRoutes } from './modules/admin-catalog.js'
import { registerAuthRoutes } from './modules/auth.js'
import { cleanupExpiredTemporaryFiles } from './modules/file-cleanup.js'
import { registerFileAndSettingRoutes } from './modules/files-settings.js'
import { registerPublicRoutes } from './modules/public.js'
import { registerNoticeDashboardRoutes } from './modules/notices-dashboard.js'
import { registerTaskRoutes } from './modules/tasks.js'
import { registerCompletionExportRoutes } from './modules/completion-export.js'
import { resolveRequestLocale, localizeApiPayload } from './i18n/index.js'
import { registerMailRoutes } from './mail/routes.js'
import { startMailDispatcher } from './mail/index.js'
import { registerRetentionRoutes } from './retention/routes.js'
import { SessionService } from './security/session.js'
import { registerInstallationRoutes } from './installation/routes.js'
import { isInstallationConfigured } from './installation/state.js'

export interface BuildAppOptions {
  config?: Partial<AppConfig>
  logger?: boolean
}

export interface BuiltApp {
  app: FastifyInstance
  db: AppDatabase
  config: AppConfig
}

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = loadConfig(options.config)
  const db = new AppDatabase(config)
  try {
    db.migrate()
  } catch (error) {
    db.close()
    throw error
  }
  const sessions = new SessionService(db, config)
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.nodeEnv === 'test' ? 'silent' : 'info',
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.x-csrf-token',
                'res.headers.set-cookie',
                'body.password',
                'body.admin.password',
                'body.setupToken',
                'req.body.admin.password',
                'req.body.setupToken',
                'setupToken',
                'password',
                'password_hash',
                'token',
                'csrfToken'
              ],
              censor: '[REDACTED]'
            }
          },
    trustProxy: config.trustProxy,
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: 12 * 1024 * 1024
  })

  app.addHook('onRequest', async (request, reply) => {
    for (const match of request.url.split('?')[0].matchAll(/%([0-9a-f]{2})/gi)) {
      const character = String.fromCharCode(Number.parseInt(match[1], 16))
      if (/[A-Za-z0-9._~-]/.test(character)) {
        return reply.code(400).send({ ok: false, message: '请求地址格式不正确', code: 'URL_ENCODING_INVALID' })
      }
    }
  })

  await app.register(cookie)
  await app.register(helmet, {
    contentSecurityPolicy: config.serveClient
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"]
          }
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    strictTransportSecurity: config.secureCookie ? undefined : false
  })
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    keyGenerator: request => `${request.ip}:${request.routeOptions.url ?? request.url.split('?')[0]}`
  })
  await app.register(multipart, {
    limits: { files: 1, fields: 4, fileSize: 10 * 1024 * 1024, parts: 5 }
  })

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ ok: false, message: error.message, code: error.code, params: error.params })
    }
    const typed = error as Error & { validation?: unknown; statusCode?: number; code?: string }
    if (typed.validation) {
      return reply.code(400).send({ ok: false, message: '请求数据格式不正确', code: 'VALIDATION_ERROR' })
    }
    if (typed.statusCode === 413 || typed.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ ok: false, message: '上传内容超过大小限制', code: 'PAYLOAD_TOO_LARGE' })
    }
    if (typed.statusCode === 429) {
      return reply.code(429).send({ ok: false, message: '操作过于频繁，请稍后再试', code: 'RATE_LIMITED' })
    }
    request.log.error({ err: error }, 'request failed')
    return reply.code(500).send({ ok: false, message: '服务器暂时无法处理请求', code: 'INTERNAL_ERROR' })
  })

  app.addHook('preValidation', async request => {
    if (request.routeOptions.url?.startsWith('/api/') && mutationMethods.has(request.method)) {
      sessions.verifyMutation(request)
      if (request.routeOptions.url !== '/api/installation' && !isInstallationConfigured(db)) {
        throw new AppError(409, 'INSTALLATION_REQUIRED', '请先由部署管理员完成机构初始化')
      }
    }
  })
  app.addHook('onSend', async (request, reply, payload) => {
    const isApiRoute = (request.routeOptions.url ?? request.url.split('?')[0]).startsWith('/api/')
    if (isApiRoute && !reply.hasHeader('cache-control')) reply.header('Cache-Control', 'private, no-store')
    if (
      isApiRoute &&
      String(reply.getHeader('content-type')).includes('application/json') &&
      typeof payload === 'string'
    ) {
      const locale = resolveRequestLocale(request, db, sessions)
      reply.header('Content-Language', locale).header('Vary', 'Cookie')
      return localizeApiPayload(payload, locale)
    }
    return payload
  })

  registerPublicRoutes(app, db, sessions)
  registerInstallationRoutes(app, db, sessions)
  registerAuthRoutes(app, db, sessions)
  registerAdminAccountRoutes(app, db, sessions)
  registerAdminCatalogRoutes(app, db, sessions)
  registerTaskRoutes(app, db, sessions)
  registerNoticeDashboardRoutes(app, db, sessions)
  registerFileAndSettingRoutes(app, db, sessions)
  registerCompletionExportRoutes(app, db, sessions)
  registerMailRoutes(app, db, sessions)
  registerRetentionRoutes(app, db, sessions)

  if (config.serveClient && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      prefix: '/',
      wildcard: false,
      decorateReply: true
    })
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404)
      return { ok: false, message: '接口不存在', code: 'API_NOT_FOUND' }
    }
    if (config.serveClient && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
      reply.header('Cache-Control', 'no-cache')
      return reply.sendFile('index.html')
    }
    reply.code(404)
    return { ok: false, message: '页面不存在', code: 'PAGE_NOT_FOUND' }
  })

  const stopMail = startMailDispatcher(db)
  let cleanupTimeout: ReturnType<typeof setTimeout> | undefined
  let cleanupInterval: ReturnType<typeof setInterval> | undefined
  if (config.nodeEnv !== 'test') {
    const cleanup = () => {
      try {
        cleanupExpiredTemporaryFiles(db)
      } catch (error) {
        app.log.error({ err: error }, 'temporary file cleanup failed')
      }
    }
    app.addHook('onReady', async () => {
      cleanupTimeout = setTimeout(() => {
        cleanup()
        cleanupInterval = setInterval(cleanup, 60 * 60 * 1000)
        cleanupInterval.unref()
      }, 60 * 1000)
      cleanupTimeout.unref()
    })
  }
  app.addHook('onClose', async () => {
    if (cleanupTimeout) clearTimeout(cleanupTimeout)
    if (cleanupInterval) clearInterval(cleanupInterval)
    await stopMail()
    db.close()
  })
  return { app, db, config }
}
