import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
const N = 32768
const r = 8
const p = 3
const keyLength = 64
const maxmem = 128 * 1024 * 1024
const dummySalt = Buffer.from('7a4b8f5f3f2f777dc23e4d6f252dcd71', 'hex')
let dummyHash: Promise<Buffer> | undefined

// 只收录能通过 validatePassword 的常见泄露密码；纯数字或纯字母的密码已被长度和字符类规则拒绝。
const commonPasswords = new Set([
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'passw0rd1',
  'p@ssw0rd',
  'p@ssword',
  'p@ssword1',
  'pass1234',
  'pass@123',
  'p@ss1234',
  'qwerty123',
  'qwerty12345',
  'qwer1234',
  '1234qwer',
  'q1w2e3r4',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1qaz2wsx',
  '1qaz2wsx3edc',
  '1qaz@wsx',
  '1qaz!qaz',
  'qazwsx123',
  '123qweasd',
  '123qwe!@#',
  'qwe123456',
  'asd123456',
  'asdf1234',
  'zxc123456',
  'zxcv1234',
  'zxcvbnm123',
  'a1234567',
  'a12345678',
  'a123456789',
  'aa123456',
  'aa12345678',
  'aa123456789',
  'abc12345',
  'abc123456',
  'abcd1234',
  'abcd123456',
  'abc@1234',
  '1234abcd',
  'a1b2c3d4',
  '12345678a',
  '123456789a',
  '123456aa',
  '123456abc',
  '123456qq',
  'qq123456',
  'woaini1314',
  'woaini520',
  '5201314a',
  'iloveyou1',
  'welcome1',
  'welcome123',
  'letmein1',
  'trustno1',
  'changeme1',
  'changeme123',
  'admin123',
  'admin1234',
  'admin888',
  'admin@123',
  'root@123',
  'test1234',
  'test@123',
  'student123',
  'student@123',
  'teacher123',
  'teacher@123',
  'campus123',
  'campus@123',
  'school123',
  'school@123'
])

export function isCommonPassword(password: string, account?: string): boolean {
  const normalizedPassword = password.toLowerCase()
  const normalizedAccount = account?.trim().toLowerCase() ?? ''
  return (
    commonPasswords.has(normalizedPassword) ||
    (normalizedAccount.length >= 4 && normalizedPassword.includes(normalizedAccount))
  )
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N, r, p, maxmem }, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

export function validatePassword(password: string): string {
  if (password.length < 8 || password.length > 128) return '密码长度须为 8—128 位'
  const groups = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(rule => rule.test(password)).length
  return groups >= 2 ? '' : '密码须包含字母、数字或符号中的至少两类'
}

export async function hashPassword(password: string): Promise<string> {
  const error = validatePassword(password)
  if (error) throw new Error(error)
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  if (!encoded) {
    dummyHash ??= derive('constant-time-dummy-password', dummySalt)
    const expected = await dummyHash
    const actual = await derive(password.slice(0, 128), dummySalt)
    timingSafeEqual(expected, actual)
    return false
  }
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[4], 'base64url')
  const expected = Buffer.from(parts[5], 'base64url')
  if (salt.length !== 16 || expected.length !== keyLength) return false
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password.slice(0, 128),
      salt,
      expected.length,
      {
        N: Number(parts[1]),
        r: Number(parts[2]),
        p: Number(parts[3]),
        maxmem
      },
      (error, derived) => (error ? reject(error) : resolve(derived))
    )
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
