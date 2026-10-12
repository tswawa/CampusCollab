import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { CreateTaskPayload } from '../../shared/contracts.js'
import { createEventNotice } from '../i18n/notices.js'
import { drainMailQueue, type OutgoingMail } from '../mail/index.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { createTask } from '../modules/tasks.service.js'
import { handoverWorkflow } from '../modules/workflow.service.js'
import { closeTestApp, createAdmin, createTestApp } from './helpers.js'

interface FactoryControl {
  gate: Promise<void>
  entered(): void
  createTransport(): { sendMail(message: OutgoingMail): Promise<{ accepted: string[] }>; close(): void }
}
const fixtureGlobal = globalThis as typeof globalThis & { __campusMailFactory?: FactoryControl }
const payload: CreateTaskPayload = {
  title: 'Fictional mail race task',
  categoryId: 'category-event',
  campusId: 'campus-main',
  place: 'Fixture room',
  description: 'Synthetic evidence notification fixture.',
  checklist: [],
  date: '2099-01-02',
  startTime: '10:00',
  endTime: '12:00',
  signupDeadline: '2099-01-01 12:00',
  duration: '2 hours',
  capacity: 2,
  audienceScope: 'school',
  requirements: [],
  proofTypes: ['text'],
  claimMode: 'direct',
  contacts: []
}

test('actual SMTP module factory awaits are followed by recipient and permission rechecks', async t => {
  let importSequence = 0
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'nodemailer') return { url: `campus-mail-fixture:${++importSequence}`, shortCircuit: true }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.startsWith('campus-mail-fixture:'))
        return {
          format: 'module',
          shortCircuit: true,
          source: `const control = globalThis.__campusMailFactory;
          control.entered(); await control.gate;
          export default { createTransport() { return control.createTransport(); } };`
        }
      return nextLoad(url, context)
    }
  })
  try {
    for (const scenario of ['email', 'disabled', 'handover', 'unchanged'] as const) {
      await t.test(scenario, async () => {
        const context = await createTestApp()
        let release!: () => void
        let entered!: () => void
        const gate = new Promise<void>(resolve => {
          release = resolve
        })
        const started = new Promise<void>(resolve => {
          entered = resolve
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        let pending: ReturnType<typeof drainMailQueue> | undefined
        const sent: OutgoingMail[] = []
        let factories = 0
        let closed = 0
        fixtureGlobal.__campusMailFactory = {
          gate,
          entered,
          createTransport: () => {
            factories += 1
            return {
              sendMail: async message => {
                sent.push(message)
                return { accepted: [message.to] }
              },
              close: () => {
                closed += 1
              }
            }
          }
        }
        try {
          const admin = await createAdmin(context)
          context.db.run('UPDATE school_settings SET require_department=0,require_grade=0,require_class=0')
          const teacher = await createAdminManagedUser(context.db, {
            role: 'teacher',
            account: 'MAILRACE1',
            name: 'Fictional coordinator',
            password: 'Example@123',
            approval: 'approved',
            email: 'before@example.invalid'
          })
          const successor = await createAdminManagedUser(context.db, {
            role: 'teacher',
            account: 'MAILRACE2',
            name: 'Fictional successor',
            password: 'Example@123',
            approval: 'approved'
          })
          const task = createTask(context.db, teacher, payload)
          // The application started with mail disabled, so no dispatcher exists.
          // Every nodemailer import is intercepted by the gated local module.
          context.config.mail = {
            enabled: true,
            host: 'smtp.example.invalid',
            port: 587,
            secure: false,
            user: '',
            password: '',
            from: 'campus@example.invalid',
            pollIntervalMs: 15000
          }
          const noticeId = createEventNotice(
            context.db,
            teacher.id,
            'task.updated',
            { taskTitle: task.title },
            { kind: 'task', id: task.id }
          )
          pending = drainMailQueue(context.db)
          await Promise.race([
            started,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Gated SMTP import was not reached')), 5000)
            })
          ])
          clearTimeout(timer)
          assert.equal(factories, 0)
          assert.equal(sent.length, 0)
          if (scenario === 'email')
            context.db.run("UPDATE users SET email='after@example.invalid' WHERE id=?", teacher.id)
          if (scenario === 'disabled') context.db.run("UPDATE users SET approval='disabled' WHERE id=?", teacher.id)
          if (scenario === 'handover')
            handoverWorkflow(context.db, admin, task.id, {
              ownerId: successor.id,
              version: task.version,
              reason: 'Fictional ownership transfer'
            })
          release()
          const result = await pending
          const delivery = context.db.get(
            'SELECT status,last_error_code FROM mail_deliveries WHERE notice_id=?',
            noticeId
          )!
          assert.equal(factories, 1)
          assert.equal(closed, 1)
          if (scenario === 'unchanged') {
            assert.equal(sent.length, 1)
            assert.equal(sent[0].to, 'before@example.invalid')
            assert.equal(result.accepted, 1)
            assert.equal(delivery.status, 'accepted')
          } else {
            assert.equal(sent.length, 0)
            assert.equal(result.failed, 1)
            assert.equal(delivery.status, 'failed')
            assert.equal(
              delivery.last_error_code,
              {
                email: 'MAIL_RECIPIENT_CHANGED',
                disabled: 'MAIL_RECIPIENT_UNAVAILABLE',
                handover: 'MAIL_TARGET_FORBIDDEN'
              }[scenario]
            )
          }
        } finally {
          if (timer) clearTimeout(timer)
          release()
          await pending?.catch(() => undefined)
          context.config.mail.enabled = false
          await closeTestApp(context)
          delete fixtureGlobal.__campusMailFactory
        }
      })
    }
    assert.equal(importSequence, 4, 'Every scenario must run through the real factory import boundary')
  } finally {
    hook.deregister()
    delete fixtureGlobal.__campusMailFactory
  }
})
