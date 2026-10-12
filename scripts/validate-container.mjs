// Opt-in, isolated Docker verification. Never mounts a host database or reads .env.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

const image = process.argv[2] || 'campus-task-local:validation'
const token = randomUUID().slice(0, 8)
const volume = `campus-validation-${token}`
const container = `${volume}-app`
const origin = 'http://127.0.0.1:4290'
const environment = ['-e', `APP_ORIGIN=${origin}`, '-e', 'ALLOW_INSECURE_COOKIE=true', '-e', 'MAIL_ENABLED=false']
const institution = {
  locale: 'en',
  name: 'Fictional Container Campus',
  platformName: 'Container Collaboration',
  timezone: 'Europe/London',
  admin: { account: 'CONTAINERADMIN', name: 'Fictional container administrator', password: 'Container@Example123' }
}
const adminEnvironment = Object.entries({
  ADMIN_LOCALE: institution.locale,
  SCHOOL_NAME: institution.name,
  PLATFORM_NAME: institution.platformName,
  SCHOOL_TIMEZONE: institution.timezone,
  ADMIN_ACCOUNT: institution.admin.account,
  ADMIN_NAME: institution.admin.name,
  ADMIN_PASSWORD: institution.admin.password
}).flatMap(([key, value]) => ['-e', `${key}=${value}`])
function docker(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 60000 })
  assert.equal(result.status, 0, `${args.slice(0, 3).join(' ')}: ${result.stderr || result.error || result.stdout}`)
  return result.stdout.trim()
}
const run = (args, input, extraEnvironment = []) =>
  docker(['run', '--rm', '-i', '-v', `${volume}:/app/data`, ...environment, ...extraEnvironment, image, ...args], input)
const node = code => run(['node', '--input-type=module'], code)
async function assertConfiguredInstallation() {
  const response = await fetch(`${origin}/api/installation`, { headers: { 'accept-language': 'zh-CN' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-language'), institution.locale)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.data, { status: 'configured', locale: institution.locale, setupAvailable: false })
  const schoolResponse = await fetch(`${origin}/api/school`, { headers: { 'accept-language': 'zh-CN' } })
  assert.equal(schoolResponse.status, 200)
  const school = (await schoolResponse.json()).data
  for (const key of ['name', 'platformName', 'timezone']) assert.equal(school[key], institution[key])
  assert.equal(school.defaultLocale, institution.locale)
  assert.equal(school.requireClass, false)
}
async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Isolated application did not become healthy')
}
docker(['volume', 'create', '--label', 'campus.validation=true', volume])
let createdContainer = false
try {
  run(['npm', 'run', 'db:migrate'])
  node(`
    import assert from 'node:assert/strict';
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync('/app/data/campus.sqlite');
    try {
      assert.equal(db.prepare('SELECT name FROM schema_migrations WHERE version=6').get()?.name,'006_installation.sql');
      assert.equal(db.prepare('SELECT configured_at FROM installation_state WHERE id=1').get()?.configured_at,null);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
    } finally {db.close()}
  `)
  // Complete the same trusted initialization transaction used by real deployments before adding fictional business data.
  run(['npm', 'run', 'admin:init'], undefined, adminEnvironment)
  node(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {AppDatabase} from './dist-server/server/db/database.js';
    import {loadConfig} from './dist-server/server/config.js';
    import {createAdminManagedUser} from './dist-server/server/modules/accounts.service.js';
    import {seedWorkflowDemo} from './dist-server/server/demo/workflow-seed.js';
    if (fs.existsSync('node_modules/tsx')) throw new Error('Runtime includes tsx');
    const db=new AppDatabase(loadConfig({nodeEnv:'test'}));db.migrate();
    try {
      const installation=db.get('SELECT configured_at,source FROM installation_state WHERE id=1');
      assert.ok(installation.configured_at);assert.equal(installation.source,'cli');
      assert.equal(db.get('SELECT COUNT(*) n FROM users').n,1);
      assert.equal(db.get("SELECT COUNT(*) n FROM audit_logs WHERE action='installation.configure'").n,1);
      const admin=db.get('SELECT role,account,locale FROM users');
      assert.equal(admin.role,'admin');assert.equal(admin.account,${JSON.stringify(institution.admin.account)});assert.equal(admin.locale,null);
      // A stored legacy preference must not override the institution's language.
      db.run("UPDATE users SET locale='zh-CN' WHERE role='admin'");
      const owner=await createAdminManagedUser(db,{role:'teacher',account:'CONTAINERDEMO',name:'Fictional container coordinator',departmentId:'dept-cs',password:'Container@Example123',approval:'approved'});
      const demo=seedWorkflowDemo(db,owner);if(demo.snapshot.totals.confirmedMinutes!==525)throw new Error('Demo mismatch');
      fs.mkdirSync(db.config.uploadDir,{recursive:true});fs.writeFileSync(db.config.uploadDir+'/marker.txt','original');
    }finally{db.close()}
  `)
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--label',
    'campus.validation=true',
    '-p',
    '127.0.0.1:4290:3000',
    '-v',
    `${volume}:/app/data`,
    ...environment,
    image
  ])
  createdContainer = true
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Container health endpoint failed')
  await assertConfiguredInstallation()
  const anonymousResponse = await fetch(`${origin}/api/auth/session`, { headers: { 'accept-language': 'zh-CN' } })
  assert.equal(anonymousResponse.status, 200)
  assert.equal(anonymousResponse.headers.get('content-language'), institution.locale)
  const anonymous = (await anonymousResponse.json()).data
  assert.equal(anonymous.user, null)
  assert.equal(anonymous.locale, institution.locale)
  assert.equal(anonymous.timezone, institution.timezone)
  const cookie = anonymousResponse.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ')
  assert.ok(cookie, 'Anonymous session did not issue a cookie')
  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      origin,
      cookie,
      'x-csrf-token': anonymous.csrfToken,
      'content-type': 'application/json',
      'accept-language': 'zh-CN'
    },
    body: JSON.stringify({ account: institution.admin.account, password: institution.admin.password })
  })
  assert.equal(loginResponse.status, 200)
  assert.equal(loginResponse.headers.get('content-language'), institution.locale)
  const login = (await loginResponse.json()).data
  assert.equal(login.user.role, 'admin')
  assert.equal(login.user.account, institution.admin.account)
  assert.equal(login.user.locale, institution.locale)
  assert.equal(login.locale, institution.locale)
  assert.equal(login.timezone, institution.timezone)
  assert.equal((await fetch(`${origin}/login`)).status, 200)
  assert.match(await (await fetch(`${origin}/LICENSE.txt`)).text(), /GNU AFFERO GENERAL PUBLIC LICENSE/)
  const source = unzipSync(new Uint8Array(await (await fetch(`${origin}/source.zip`)).arrayBuffer()))
  assert.ok(source['server/db/migrations/005_retention.sql'])
  assert.ok(source['server/db/migrations/006_installation.sql'])
  assert.ok(source['server/installation/service.ts'])
  assert.ok(source['SOURCE-MANIFEST.json'])
  assert.ok(
    !Object.keys(source).some(
      name =>
        /(^|\/)(data|uploads|backups|node_modules|\.git|\.narrafork)(\/|$)/.test(name) ||
        /(^|\/)\.env(?!\.example$)/.test(name)
    )
  )
  const manifest = JSON.parse(strFromU8(source['SOURCE-MANIFEST.json']))
  assert.ok(manifest.files.length > 250)
  // A second instance using the same volume must remain excluded while idle.
  const concurrent = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${volume}:/app/data`, ...environment, image, 'npm', 'run', 'db:migrate'],
    { encoding: 'utf8', timeout: 60000 }
  )
  assert.notEqual(concurrent.status, 0)
  assert.match(`${concurrent.stdout}${concurrent.stderr}`, /数据库正在使用/)
  // Strong kill must release kernel ownership without a graceful close hook.
  docker(['kill', '--signal', 'KILL', container])
  docker(['start', container])
  await waitForHealth()
  await assertConfiguredInstallation()
  docker(['stop', '--time', '10', container])
  run(['npm', 'run', 'db:backup'])
  const backup = node(
    `import fs from 'node:fs';const names=fs.readdirSync('/app/data/backups').filter(n=>n.startsWith('backup-'));if(names.length!==1)throw new Error('Ambiguous backup');console.log('/app/data/backups/'+names[0]);`
  )
  assert.match(backup, /^\/app\/data\/backups\/backup-[0-9_-]+$/)
  node(
    `import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/app/data/campus.sqlite');db.exec("UPDATE tasks SET title='mutated'");db.close();fs.writeFileSync('/app/data/uploads/marker.txt','mutated');`
  )
  run(['npm', 'run', 'db:restore', '--', backup])
  node(
    `import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/app/data/campus.sqlite');try{if(db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='mutated'").get().n)throw new Error('Database not restored');if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key failure');if(db.prepare('SELECT COUNT(*) n FROM sessions').get().n)throw new Error('Sessions survived restore');if(fs.readFileSync('/app/data/uploads/marker.txt','utf8')!=='original')throw new Error('Uploads not restored');}finally{db.close()}`
  )
  node(`
    import assert from 'node:assert/strict';
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync('/app/data/campus.sqlite');
    try {
      const installation=db.prepare('SELECT configured_at,source FROM installation_state WHERE id=1').get();
      assert.ok(installation.configured_at);assert.equal(installation.source,'cli');
      assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n,1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='installation.configure'").get().n,1);
      assert.equal(db.prepare('SELECT default_locale FROM school_settings WHERE id=1').get().default_locale,${JSON.stringify(institution.locale)});
      assert.throws(()=>db.exec('UPDATE installation_state SET configured_at=NULL WHERE id=1'),/already configured/);
    } finally {db.close()}
  `)
  run(['npm', 'run', 'files:cleanup'])
  run(['npm', 'run', 'mail:send'])
  const templateFixture = fs.readFileSync('docs/templates/hfut-2018.anonymous.json', 'utf8')
  node(`import fs from 'node:fs';fs.writeFileSync('/app/data/template-input.json',${JSON.stringify(templateFixture)});`)
  run(['npm', 'run', 'template:preview', '--', '/app/data/template-input.json', '/app/data/template-preview'])
  node(
    `import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('/app/data/template-preview/preview.json','utf8'));if(p.currentInstitutionalAcceptance!=='unverified'||!fs.statSync('/app/data/template-preview/preview.xlsx').size)throw new Error('Template preview failed');`
  )
  docker(['start', container])
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break
    } catch {}
    if (attempt === 39) throw new Error('Restored application did not restart')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  await assertConfiguredInstallation()
  console.log(
    'PASS: Linux runtime without tsx, migrations, trusted institution/admin initialization, institution-wide locale, fictional workflow, HTTP/source, concurrent-instance refusal, SIGKILL recovery, backup/restore, cleanup, disabled mail, template preview and graceful restart.'
  )
} finally {
  if (createdContainer) docker(['rm', '-f', container])
  const label = docker(['volume', 'inspect', '--format', '{{ index .Labels "campus.validation" }}', volume])
  assert.equal(label, 'true', 'Refusing to remove an unowned volume')
  docker(['volume', 'rm', volume])
}
