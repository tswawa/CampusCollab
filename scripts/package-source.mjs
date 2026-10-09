import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zip } from 'fflate'

const root = process.cwd()
const entries = Object.create(null)
const directories = ['src', 'server', 'shared', 'scripts', 'tests', 'public', 'docs', 'LICENSES', '.github']
const files = ['package.json', 'package-lock.json', 'index.html', 'env.d.ts', 'vite.config.ts', 'playwright.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.server.json', 'tsconfig.test.json',
  'Dockerfile', '.dockerignore', '.gitignore', 'compose.yaml', '.node-version', '.env.example', 'LICENSE', 'NOTICE',
  'README.md', 'README.zh-CN.md', 'PLAN.md', 'PLAN.en.md', 'CONTRIBUTING.md', 'SECURITY.md']
const denied = new Set(['node_modules', '.git', 'data', 'uploads', 'backups', '.local', '.narrafork', 'dist', 'dist-server'])
const localRecords = new Set(['docs/reviews', 'docs/PROJECT_CLEANUP.md', 'docs/implementation-progress.md', 'docs/planning-validation.md'])
async function add(relative) {
  const normalized = relative.split(path.sep).join('/')
  if (localRecords.has(normalized)) return
  if (normalized.startsWith('docs/screenshots/') && !/^docs\/screenshots\/showcase-(zh|en)-(roster|review|group|export|student|admin)\.png$/.test(normalized)) return
  const absolute = path.join(root, relative)
  let stat
  try { stat = await fs.lstat(absolute) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (stat.isSymbolicLink()) throw new Error(`Source package refuses symbolic link: ${relative}`)
  const basename = path.basename(relative)
  if (denied.has(basename) || (basename.startsWith('.env') && basename !== '.env.example') || /\.(sqlite|db|log|pem|key|setup-token)$/i.test(basename)) return
  if (stat.isDirectory()) {
    for (const child of (await fs.readdir(absolute)).sort()) await add(path.join(relative, child))
  } else if (stat.isFile()) entries[relative.split(path.sep).join('/')] = new Uint8Array(await fs.readFile(absolute))
}
for (const target of [...directories, ...files]) await add(target)
const manifest = { format: 'campus-source-v1', generatedAt: new Date().toISOString(), files: Object.entries(entries).map(([name, data]) => ({
  path: name, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length
})) }
entries['SOURCE-MANIFEST.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
const archive = await new Promise((resolve, reject) => zip(entries, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes)))
await fs.mkdir(path.join(root, 'dist'), { recursive: true })
await fs.writeFile(path.join(root, 'dist/source.zip'), archive)
await fs.copyFile(path.join(root, 'LICENSE'), path.join(root, 'dist/LICENSE.txt'))
await fs.copyFile(path.join(root, 'NOTICE'), path.join(root, 'dist/NOTICE.txt'))
console.log(`Packaged corresponding source: ${manifest.files.length} files`)
