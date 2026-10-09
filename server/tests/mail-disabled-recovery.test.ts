import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../app.js'
import { nowIso } from '../db/database.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { createTask } from '../modules/tasks.service.js'
import { closeoutWorkflow, importRoster, previewRosterImport, reviewWorkflowRevision, submitWorkflowRevision } from '../modules/workflow.service.js'
import { previewTaskRetention } from '../retention/service.js'
import { createEventNotice } from '../i18n/notices.js'
import { createAdmin, createTestApp, closeTestApp } from './helpers.js'

test('disabled startup recovers an interrupted delivery without sending pending mail or blocking retention', async t => {
  const ctx = await createTestApp()
  let app = ctx.app
  let smtpImports = 0
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'nodemailer') { smtpImports++; throw new Error('Disabled fixture must not create a mail transport') }
    return next(specifier, context)
  } })
  try {
    const admin = await createAdmin(ctx)
    const teacher = await createAdminManagedUser(ctx.db, { role:'teacher', account:'RECOVERYTEACH', name:'Fictional teacher',
      departmentId:'dept-cs', password:'Fixture@123', approval:'approved' })
    const task = createTask(ctx.db, teacher, { title:'Fictional interrupted notification', categoryId:'category-event', campusId:'campus-main',
      description:'Only synthetic data for disabled mail recovery.', checklist:[], date:'2098-10-10', startTime:'10:00', endTime:'12:00',
      signupDeadline:'2098-10-09 10:00', place:'Fictional room', duration:'60 minutes', capacity:1,
      audienceScope:'school', requirements:[], proofTypes:['text'], claimMode:'direct', contacts:[] })
    const input={source:'recovery-fixture',rows:[{externalId:'0001',name:'Fictional participant'}]}
    let workflow=importRoster(ctx.db,teacher,task.id,{...input,hash:previewRosterImport(ctx.db,teacher,task.id,input).hash,idempotencyKey:'recovery-roster'})
    let person=workflow.participants[0]!
    workflow=submitWorkflowRevision(ctx.db,teacher,task.id,{participantId:person.id,version:person.version,description:'Fictional work completed.',note:'',fileIds:[]})
    person=workflow.participants[0]!
    workflow=reviewWorkflowRevision(ctx.db,teacher,task.id,{participantId:person.id,version:person.version,revisionId:person.latestRevisionId!,decision:'approved',feedback:'',confirmedMinutes:30})
    closeoutWorkflow(ctx.db,teacher,task.id,{version:workflow.config.version,reason:'Fictional closeout'})
    ctx.db.run('UPDATE school_settings SET retention_days=1 WHERE id=1')
    const future=Date.now()+3*86400000
    t.mock.method(Date,'now',()=>future)
    assert.equal(previewTaskRetention(ctx.db,admin,task.id).eligible,true)
    for(const status of ['sending','pending'] as const) {
      const notice=createEventNotice(ctx.db,admin.id,'task.updated',{taskTitle:task.title},{kind:'task',id:task.id})
      ctx.db.run(`INSERT INTO mail_deliveries(id,notice_id,user_id,recipient_email,status,attempt_count,created_at,updated_at)
        VALUES(?,?,?,'fictional@example.invalid',?,?,?,?)`,status,notice,admin.id,status,status==='sending'?1:0,nowIso(),nowIso())
    }
    ctx.db.run("INSERT INTO mail_delivery_attempts(delivery_id,attempt,status,started_at) VALUES('sending',1,'sending',?)",nowIso())
    assert.ok(previewTaskRetention(ctx.db,admin,task.id).blockers.some(item=>item.code==='RETENTION_MAIL_IN_FLIGHT'))
    await app.close()
    const reopened=await buildApp({logger:false,config:ctx.config})
    app=reopened.app
    await new Promise<void>(resolve=>setTimeout(resolve,20))
    assert.equal(reopened.config.mail.enabled,false)
    assert.deepEqual({...reopened.db.get("SELECT status,last_error_code,attempt_count FROM mail_deliveries WHERE id='sending'")},
      {status:'failed',last_error_code:'MAIL_OUTCOME_UNKNOWN',attempt_count:1})
    assert.deepEqual({...reopened.db.get("SELECT status,error_code FROM mail_delivery_attempts WHERE delivery_id='sending'")},
      {status:'failed',error_code:'MAIL_OUTCOME_UNKNOWN'})
    assert.deepEqual({...reopened.db.get("SELECT status,attempt_count FROM mail_deliveries WHERE id='pending'")},{status:'pending',attempt_count:0})
    assert.equal(previewTaskRetention(reopened.db,admin,task.id).eligible,true)
    assert.equal(smtpImports,0)

    // Offline maintenance must repair the same durable state without enabling delivery.
    reopened.db.run("UPDATE mail_deliveries SET status='sending',last_error_code=NULL WHERE id='sending'")
    reopened.db.run("UPDATE mail_delivery_attempts SET status='sending',error_code=NULL,finished_at=NULL WHERE delivery_id='sending'")
    await app.close()
    const cli=spawnSync(process.execPath,['--import','tsx','server/scripts/send-mail.ts'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,
      NODE_ENV:'test',PROJECT_ROOT:process.cwd(),DATABASE_PATH:ctx.config.databasePath,UPLOAD_DIR:ctx.config.uploadDir,BACKUP_DIR:ctx.config.backupDir,
      MAIL_ENABLED:'false',SETUP_TOKEN:'',APP_ORIGIN:'http://test.local'}})
    assert.equal(cli.status,0,cli.stderr)
    assert.deepEqual(JSON.parse(cli.stdout),{enabled:false,processed:0,accepted:0,failed:0})
    // Inspect before another buildApp can perform its own recovery.
    const cliState=new DatabaseSync(ctx.config.databasePath,{readOnly:true})
    try {
      assert.equal(cliState.prepare("SELECT status FROM mail_deliveries WHERE id='sending'").get()?.status,'failed')
      assert.equal(cliState.prepare("SELECT last_error_code FROM mail_deliveries WHERE id='sending'").get()?.last_error_code,'MAIL_OUTCOME_UNKNOWN')
      assert.equal(cliState.prepare("SELECT status FROM mail_deliveries WHERE id='pending'").get()?.status,'pending')
    } finally { cliState.close() }
    const again=await buildApp({logger:false,config:ctx.config})
    app=again.app
    assert.equal(again.db.get("SELECT status FROM mail_deliveries WHERE id='sending'")?.status,'failed')
    assert.equal(again.db.get("SELECT last_error_code FROM mail_deliveries WHERE id='sending'")?.last_error_code,'MAIL_OUTCOME_UNKNOWN')
    assert.equal(again.db.get("SELECT attempt_count FROM mail_deliveries WHERE id='sending'")?.attempt_count,1)
    assert.equal(again.db.get("SELECT status FROM mail_deliveries WHERE id='pending'")?.status,'pending')
    assert.equal(previewTaskRetention(again.db,admin,task.id).eligible,true)
    assert.deepEqual(again.db.all('PRAGMA foreign_key_check'),[])
  } finally {
    hook.deregister()
    await app.close()
    await closeTestApp(ctx)
  }
})
