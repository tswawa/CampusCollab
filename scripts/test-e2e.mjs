import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Each spec starts its own compiled application and temporary database. Tests must
// not share accounts, task lists or an IP login-rate bucket across scenarios.
const files = fs.readdirSync('tests/e2e').filter(name => name.endsWith('.spec.ts')).sort()
let runs = 0
for (const file of files) {
  const freshSetup = file === 'fresh-setup.spec.ts'
  for (const locale of freshSetup ? ['en', 'zh-CN'] : ['']) {
    const output = `${file.replace('.spec.ts', '')}${locale ? `-${locale}` : ''}`
    const result = spawnSync(process.execPath, [path.resolve('node_modules/@playwright/test/cli.js'), 'test', `tests/e2e/${file}`, '--output', `test-results/${output}`], {
      stdio: 'inherit',
      env: { ...process.env, E2E_FRESH_SETUP: freshSetup ? '1' : '0', E2E_SETUP_LOCALE: locale }
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
    runs += 1
  }
}
console.log(`PASS: ${files.length} browser specifications in ${runs} isolated runs, including both installation editions and unchanged production rate limits.`)
