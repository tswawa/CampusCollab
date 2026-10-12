import fs from 'node:fs'
import path from 'node:path'

// Resolve aliases even when the final directory does not exist yet. This only
// reads the filesystem; callers run it before mkdir, SQLite open, or any copy.
export function canonicalPath(filename: string): string {
  let existing = path.resolve(filename)
  const missing: string[] = []
  for (;;) {
    try {
      fs.lstatSync(existing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      missing.push(path.basename(existing))
      existing = parent
      continue
    }
    // An existing but dangling/inaccessible alias must fail, not be treated as
    // a missing directory whose unresolved spelling happens to look separate.
    return path.join(fs.realpathSync(existing), ...missing.reverse())
  }
}

export function containsPath(directory: string, target: string): boolean {
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function assertSeparatePaths(first: string, second: string) {
  const left = canonicalPath(first)
  const right = canonicalPath(second)
  if (containsPath(left, right) || containsPath(right, left)) {
    throw new Error('备份与数据路径不能相同或相互包含（包括符号链接与路径别名）')
  }
  if (fs.existsSync(left) && fs.existsSync(right)) {
    const a = fs.statSync(left)
    const b = fs.statSync(right)
    if (a.dev === b.dev && a.ino === b.ino) throw new Error('备份与数据路径不能指向同一文件')
  }
}

export function assertBackupLayout(config: { databasePath: string; uploadDir: string; backupDir: string }) {
  assertSeparatePaths(config.uploadDir, config.backupDir)
  assertSeparatePaths(config.databasePath, config.uploadDir)
  assertSeparatePaths(config.databasePath, config.backupDir)
}

export function copyDirectory(source: string, destination: string) {
  assertSeparatePaths(source, destination)
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`备份目录不允许符号链接：${from}`)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
