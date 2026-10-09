import { Temporal } from '@js-temporal/polyfill'
import type { CampusUser } from '../../shared/contracts.js'
import type { WorkflowSnapshot } from '../../shared/workflow-contracts.js'
import type { AppDatabase } from '../db/database.js'
import { nowIso } from '../db/database.js'
import { getSchool } from '../db/models.js'
import { assertCondition } from '../errors.js'
import { createTask } from '../modules/tasks.service.js'
import { closeoutWorkflow, confirmGroupParticipant, getTaskWorkflow, getWorkflowSnapshot, importRoster, previewRosterImport, reviewWorkflowRevision, setParticipantOutcome, submitCommonRevision, submitWorkflowRevision } from '../modules/workflow.service.js'

/** Fictional, repeatable fixture; creates eight roster identities and no login accounts. */
export function seedWorkflowDemo(db: AppDatabase, teacher: CampusUser): { taskId: string; snapshot: WorkflowSnapshot; reused: boolean } {
  assertCondition(db.config.nodeEnv !== 'production', 403, 'DEMO_PRODUCTION_FORBIDDEN', '生产环境不能写入虚构演示')
  const previous = db.get("SELECT entity_id FROM audit_logs WHERE actor_user_id=? AND action='workflow.demo_seeded' ORDER BY id DESC LIMIT 1", teacher.id)
  if (previous) {
    const snapshot = db.get('SELECT id FROM workflow_snapshots WHERE task_id=? ORDER BY version DESC LIMIT 1', String(previous.entity_id))
    if (snapshot) return { taskId: String(previous.entity_id), snapshot: getWorkflowSnapshot(db, teacher, String(previous.entity_id), String(snapshot.id)), reused: true }
  }
  const local = (zh: string, en: string) => getSchool(db).defaultLocale === 'en' ? en : zh; const names = getSchool(db).defaultLocale === 'en' ? ['Alex Morgan', 'Jamie Lee', 'Sam Taylor', 'Jo Lin', 'Ari Park', 'Riley Chen', 'Taylor Kim', 'Casey Wu'] : ['沈思远', '顾清', '许晨', '苏桐', '陆知遥', '叶涵', '宋嘉宁', '江予安']; const today = Temporal.Now.zonedDateTimeISO(db.config.timezone)
  const task = createTask(db, teacher, {
    title: local('校园花园维护', 'Campus garden maintenance'), categoryId: 'category-event', campusId: 'campus-main',
    description: local('清理花坛、养护植物并整理园艺工具。由各组负责人核对参与记录和工作时长。', 'Maintain planted beds, care for plants and organize tools. Team coordinators review participation records and time.'),
    checklist: [local('完成分配区域的养护', 'Maintain the assigned area'), local('归还并清点工具', 'Return and check tools')],
    date: today.add({ days: 3 }).toPlainDate().toString(), startTime: '10:00', endTime: '12:00',
    signupDeadline: `${today.add({ days: 2 }).toPlainDate().toString()} 10:00`, place: local('校园花园', 'Campus garden'), duration: local('120 分钟', '120 minutes'), capacity: 8,
    audienceScope: 'school', requirements: [], proofTypes: ['text'], claimMode: 'direct', contacts: [],
    workflow: { templateId: 'community-garden', templateVersion: 1, mode: 'group', plannedMinutes: 120, submissionDeadline: null, personalSubmissionRequired: true }
  })
  const input = { source: local('志愿服务名单', 'Volunteer roster'), rows: Array.from({ length: 8 }, (_, index) => ({ externalId: String(index + 1).padStart(4, '0'), name: names[index], department: local('园艺社', 'Gardening society') })) }
  let workflow = importRoster(db, teacher, task.id, { ...input, hash: previewRosterImport(db, teacher, task.id, input).hash, idempotencyKey: 'fictional-demo-roster-v1' })
  workflow = submitCommonRevision(db, teacher, task.id, { version: workflow.config.version, description: local('完成花坛养护、工具清点与场地清洁。', 'Completed bed maintenance, tool inventory and site cleanup.'), note: local('各组已提交岗位记录。', 'Each team submitted its work log.'), fileIds: [] })
  const commonId = workflow.commonRevisions[0].id
  for (const participant of workflow.participants.filter(person => person.externalId !== null && ['0001','0002','0003','0004','0005','0006'].includes(person.externalId))) {
    submitWorkflowRevision(db, teacher, task.id, { participantId: participant.id, version: participant.version, description: local(`${participant.name}完成分配区域的杂草清理和浇灌，参与90分钟。`, `${participant.name} weeded and watered the assigned area for 90 minutes.`), note: local('负责人代录', 'Recorded by the coordinator'), fileIds: [], reportedMinutes: 90 })
    let current = getTaskWorkflow(db, teacher, task.id).participants.find(p => p.id === participant.id)!
    if (participant.externalId === '0006') {
      reviewWorkflowRevision(db, teacher, task.id, { participantId: current.id, version: current.version, revisionId: current.latestRevisionId!, decision: 'changes_requested', feedback: local('请补充实际离场时间。', 'Please add your departure time.'), missingItems: ['description'] })
      current = getTaskWorkflow(db, teacher, task.id).participants.find(p => p.id === participant.id)!
      submitWorkflowRevision(db, teacher, task.id, { participantId: current.id, version: current.version, description: local(`${participant.name}于11:15离场，实际参与75分钟。`, `${participant.name} left at 11:15 after participating for 75 minutes.`), note: local('已补充离场时间', 'Departure time added'), fileIds: [], reportedMinutes: 75 })
      current = getTaskWorkflow(db, teacher, task.id).participants.find(p => p.id === participant.id)!
    }
    confirmGroupParticipant(db, teacher, task.id, { participantId: current.id, version: current.version, commonRevisionId: commonId, confirmedMinutes: participant.externalId === '0006' ? 75 : 90, feedback: local('已核对参与记录。', 'Participation record checked.') })
  }
  for (const [externalId, status, reason] of [['0007', 'incomplete', local('未到场', 'Did not attend')], ['0008', 'withdrawn', local('提前退出', 'Withdrew before attendance')]] as const) {
    const person = getTaskWorkflow(db, teacher, task.id).participants.find(p => p.externalId === externalId)!
    setParticipantOutcome(db, teacher, task.id, { participantId: person.id, version: person.version, status, reason })
  }
  workflow = getTaskWorkflow(db, teacher, task.id)
  const snapshot = closeoutWorkflow(db, teacher, task.id, { version: workflow.config.version, reason: local('8人报名，6人完成，共525分钟；1人未到场，1人提前退出。', '8 participants: 6 completed, totaling 525 minutes; 1 absent and 1 withdrawn.') })
  assertCondition(snapshot.totals.participants === 8 && snapshot.totals.completed === 6 && snapshot.totals.confirmedMinutes === 525, 500, 'DEMO_TOTALS_INVALID', '演示汇总校验失败')
  db.run('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?)', teacher.id, 'workflow.demo_seeded', 'task', task.id, JSON.stringify({ seed: 'fictional-garden-v1', snapshotId: snapshot.id }), nowIso())
  return { taskId: task.id, snapshot, reused: false }
}
