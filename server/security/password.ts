import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
const N = 32768
const r = 8
const p = 3
const keyLength = 64
const maxmem = 128 * 1024 * 1024
const dummySalt = Buffer.from('7a4b8f5f3f2f777dc23e4d6f252dcd71', 'hex')
let dummyHash: Promise<Buffer> | undefined

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
  const groups = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((rule) => rule.test(password)).length
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
    scryptCallback(password.slice(0, 128), salt, expected.length, {
      N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), maxmem
    }, (error, derived) => error ? reject(error) : resolve(derived))
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
