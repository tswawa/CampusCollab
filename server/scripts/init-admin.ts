import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { AppDatabase } from '../db/database.js'
import { loadConfig } from '../config.js'
import { installFromTrustedHost } from '../installation/service.js'
import { isInstallationConfigured } from '../installation/state.js'
import { productNames } from '../../shared/brand.js'

async function prompt(label: string, fallback = ''): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    const value = (await terminal.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim()
    return value || fallback
  } finally {
    terminal.close()
  }
}

async function secretPrompt(label: string): Promise<string> {
  if (!stdin.isTTY || !('setRawMode' in stdin)) return prompt(label)
  stdout.write(`${label}: `)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const onData = (chunk: string) => {
      if (chunk === '\u0003') {
        cleanup()
        reject(new Error('已取消'))
      } else if (chunk === '\r' || chunk === '\n') {
        cleanup()
        stdout.write('\n')
        resolve(value)
      } else if (chunk === '\u007f' || chunk === '\b') {
        if (value) {
          value = value.slice(0, -1)
          stdout.write('\b \b')
        }
      } else if (/^[\x20-\x7E]+$/.test(chunk)) {
        value += chunk
        stdout.write('*'.repeat(chunk.length))
      }
    }
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    stdin.on('data', onData)
  })
}

const config = loadConfig()
const db = new AppDatabase(config)
try {
  db.migrate()
  if (isInstallationConfigured(db))
    throw new Error('Institution is already configured; use the administration console / 机构已初始化，请使用管理终端')
  const locale = process.env.ADMIN_LOCALE || (await prompt('机构语言 / Institution language (zh-CN/en)', 'zh-CN'))
  if (locale !== 'zh-CN' && locale !== 'en') throw new Error('Choose zh-CN or en / 请选择 zh-CN 或 en')
  const schoolName = process.env.SCHOOL_NAME || (await prompt('机构名称 / Institution name'))
  const platformName = process.env.PLATFORM_NAME || (await prompt('平台名称 / Platform name', productNames[locale]))
  const timezone = process.env.SCHOOL_TIMEZONE || (await prompt('IANA 时区 / Timezone', config.timezone))
  const account = (process.env.ADMIN_ACCOUNT || (await prompt('管理员账号', 'ADMIN001'))).trim()
  const name = (
    process.env.ADMIN_NAME ||
    (await prompt('管理员姓名 / Administrator name', locale === 'en' ? 'Administrator' : '校园管理员'))
  ).trim()
  const password = process.env.ADMIN_PASSWORD || (await secretPrompt('管理员密码'))
  await installFromTrustedHost(db, {
    locale,
    name: schoolName,
    platformName,
    timezone,
    admin: { account, name, password }
  })
  console.log(`管理员创建成功：${account}`)
} finally {
  db.close()
}
