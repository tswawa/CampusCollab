import path from 'node:path'
export const projectRoot = path.resolve(process.env.PROJECT_ROOT || process.cwd())

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function booleanValue(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  appOrigins: string[]
  databasePath: string
  uploadDir: string
  backupDir: string
  sessionTtlSeconds: number
  preSessionTtlSeconds: number
  timezone: string
  secureCookie: boolean
  trustProxy: boolean
  serveClient: boolean
  clientDist: string
  setupToken: string
  mail: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; from: string; pollIntervalMs: number }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  // Earlier Node 24 releases can silently fail to remove non-ASCII Windows paths.
  // Reject them before opening databases or running maintenance, not after a loss.
  const [major, minor, patch] = process.versions.node.split('.').map(Number)
  if (![major, minor, patch].every(Number.isInteger) || major !== 24 || minor! < 13 || (minor === 13 && patch! < 1)) {
    throw new Error('Node.js >=24.13.1 <25 is required. Upgrade Node before starting CampusCollab or running maintenance.')
  }
  const nodeEnv = (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
    ? process.env.NODE_ENV
    : 'development') as AppConfig['nodeEnv']
  const allowInsecure = booleanValue(process.env.ALLOW_INSECURE_COOKIE)
  const defaultOrigins = nodeEnv === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : []
  const appOrigins = process.env.APP_ORIGIN
    ? process.env.APP_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean)
    : defaultOrigins
  if (nodeEnv === 'production' && appOrigins.length === 0) {
    throw new Error('生产环境必须配置 APP_ORIGIN')
  }
  if (nodeEnv === 'production' && !allowInsecure && appOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS；本机验收可显式设置 ALLOW_INSECURE_COOKIE=true')
  }
  const config: AppConfig = {
    nodeEnv,
    host: process.env.API_HOST || '127.0.0.1',
    port: positiveInteger(process.env.API_PORT, 3000),
    appOrigins,
    databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH || 'data/campus.sqlite'),
    uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR || 'data/uploads'),
    backupDir: path.resolve(projectRoot, process.env.BACKUP_DIR || 'data/backups'),
    sessionTtlSeconds: positiveInteger(process.env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 7),
    preSessionTtlSeconds: positiveInteger(process.env.PRESESSION_TTL_SECONDS, 60 * 30),
    timezone: process.env.SCHOOL_TIMEZONE || 'Asia/Shanghai',
    secureCookie: nodeEnv === 'production' && !allowInsecure,
    trustProxy: booleanValue(process.env.TRUST_PROXY),
    serveClient: nodeEnv === 'production' || booleanValue(process.env.SERVE_CLIENT),
    clientDist: path.resolve(projectRoot, process.env.CLIENT_DIST || 'dist'),
    setupToken: process.env.SETUP_TOKEN || '',
    mail: {
      enabled: booleanValue(process.env.MAIL_ENABLED), host: process.env.SMTP_HOST || '',
      port: process.env.SMTP_PORT === undefined ? (booleanValue(process.env.SMTP_SECURE) ? 465 : 587) : Number(process.env.SMTP_PORT),
      secure: booleanValue(process.env.SMTP_SECURE), user: process.env.SMTP_USER || '', password: process.env.SMTP_PASSWORD || '',
      from: process.env.MAIL_FROM || '', pollIntervalMs: positiveInteger(process.env.MAIL_POLL_INTERVAL_MS, 15000)
    }
  }
  const merged = { ...config, ...overrides }
  if (merged.setupToken && (merged.setupToken.length < 32 || merged.setupToken.length > 256 || /\s/.test(merged.setupToken))) {
    throw new Error('SETUP_TOKEN must contain 32–256 non-whitespace characters')
  }
  if (merged.mail.enabled && (!merged.mail.host || !merged.mail.from || !Number.isInteger(merged.mail.port) || merged.mail.port < 1 || merged.mail.port > 65535 ||
    Boolean(merged.mail.user) !== Boolean(merged.mail.password))) throw new Error('Enabled email requires a valid SMTP host, port, sender and matching credentials')
  return merged
}
