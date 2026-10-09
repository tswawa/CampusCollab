import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { CampusUser } from '../../shared/contracts.js'
import { createId, nowIso, type AppDatabase } from '../db/database.js'
import { getUserById } from '../db/models.js'
import { assertCondition } from '../errors.js'
import { audit } from '../modules/accounts.service.js'

export interface RetentionPreview {
  taskId: string; title: string; taskVersion: number; lastSnapshotAt: string | null; eligibleAt: string | null
  eligible: boolean; previewHash: string
  counts: { participants: number; revisions: number; snapshots: number; files: number; fileBytes: number; notices: number }
  blockers: Array<{ code: string; count: number }>
}

function requireAdmin(db: AppDatabase, actor: CampusUser) {
  const current = getUserById(db, actor.id)
  assertCondition(current?.role === 'admin' && current.approval === 'approved' && current.version === actor.version,
    403, 'FORBIDDEN', '只有当前有效的管理员可以管理保存周期')
}

function checkedFilePath(db: AppDatabase, storedName: string): string {
  const root = path.resolve(db.config.uploadDir)
  const parts = storedName.split(/[\\/]/)
  const resolved = path.resolve(root, ...parts)
  assertCondition(storedName.length > 0 && !path.win32.isAbsolute(storedName) && !path.posix.isAbsolute(storedName) &&
    !/[:\x00-\x1F]/.test(storedName) && parts.every(part => part.length > 0 && part !== '.' && part !== '..') && resolved.startsWith(root + path.sep),
    409, 'RETENTION_FILE_PATH_INVALID', '材料文件路径不在授权上传目录内')
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : undefined
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index])
    let stat: fs.Stats
    try { stat = fs.lstatSync(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
    assertCondition(!stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()),
      409, 'RETENTION_FILE_PATH_INVALID', '材料路径包含链接或不是普通文件')
    assertCondition(Boolean(realRoot) && fs.realpathSync(current).startsWith(realRoot! + path.sep),
      409, 'RETENTION_FILE_PATH_INVALID', '材料文件路径越过上传目录')
  }
  return resolved
}

function taskData(db: AppDatabase, taskId: string) {
  const task = db.get('SELECT * FROM tasks WHERE id=?', taskId)
  assertCondition(task, 404, 'TASK_NOT_FOUND', '任务不存在')
  const workflow = db.get('SELECT * FROM workflow_tasks WHERE task_id=?', taskId)
  const snapshots = db.all('SELECT * FROM workflow_snapshots WHERE task_id=? ORDER BY version DESC,id', taskId)
  const revisions = db.all('SELECT * FROM workflow_revisions WHERE task_id=? ORDER BY id', taskId)
  const participants = db.all('SELECT * FROM workflow_participants WHERE task_id=? ORDER BY id', taskId)
  const members = db.all('SELECT * FROM task_members WHERE task_id=? ORDER BY user_id', taskId)
  const proofs = db.all('SELECT * FROM proofs WHERE task_id=? ORDER BY id', taskId)
  const relatedFiles = db.all(`SELECT DISTINCT f.* FROM files f WHERE f.task_id=? OR EXISTS
    (SELECT 1 FROM workflow_revision_files rf JOIN workflow_revisions r ON r.id=rf.revision_id WHERE rf.file_id=f.id AND r.task_id=?)
    OR EXISTS (SELECT 1 FROM proof_files pf JOIN proofs p ON p.id=pf.proof_id WHERE pf.file_id=f.id AND p.task_id=?) ORDER BY f.id`, taskId, taskId, taskId)
  // Purging a consumer removes its references, never the source task's files.
  // Keep borrowed metadata in the preview hash, but out of deletion counts/jobs.
  const files = relatedFiles.filter(file => file.task_id === taskId)
  const referencedFiles = relatedFiles.filter(file => file.task_id !== taskId)
  const notices = db.all("SELECT * FROM notices WHERE target_kind='task' AND target_id=? ORDER BY id", taskId)
  const reviews = db.all('SELECT r.* FROM workflow_reviews r JOIN workflow_participants p ON p.id=r.participant_id WHERE p.task_id=? ORDER BY r.id', taskId)
  const refs = db.all('SELECT rf.* FROM workflow_revision_files rf JOIN workflow_revisions r ON r.id=rf.revision_id WHERE r.task_id=? ORDER BY rf.revision_id,rf.file_id', taskId)
  return { task, workflow, snapshots, revisions, participants, members, proofs, files, referencedFiles, notices, reviews, refs }
}

export function previewTaskRetention(db: AppDatabase, actor: CampusUser, taskId: string): RetentionPreview {
  requireAdmin(db, actor)
  const data = taskData(db, taskId)
  const retentionDays = Number(db.get('SELECT retention_days FROM school_settings WHERE id=1')?.retention_days ?? 365)
  const blockers: RetentionPreview['blockers'] = []
  const add = (code: string, count: number) => { if (count > 0) blockers.push({ code, count }) }
  add('RETENTION_TASK_OPEN', data.workflow?.status === 'closed' ? 0 : 1)
  add('RETENTION_SNAPSHOT_MISSING', data.snapshots.length ? 0 : 1)
  const lastSnapshotAt = data.snapshots[0] ? String(data.snapshots[0].created_at) : null
  const deadline = lastSnapshotAt ? Date.parse(lastSnapshotAt) + retentionDays * 86400000 : NaN
  const eligibleAt = Number.isFinite(deadline) ? new Date(deadline).toISOString() : null
  add('RETENTION_NOT_DUE', !Number.isFinite(deadline) || Date.now() < deadline ? 1 : 0)
  const externalReferences = db.all(`SELECT r.id FROM workflow_revisions r JOIN workflow_revisions source ON source.id=r.source_revision_id
    WHERE source.task_id=? AND r.task_id<>?`, taskId, taskId)
  add('RETENTION_CROSS_TASK_REFERENCE', externalReferences.length)
  const externalParticipantReferences = db.all(`SELECT p.id FROM workflow_participants p WHERE p.task_id<>? AND
    (p.latest_revision_id IN (SELECT id FROM workflow_revisions WHERE task_id=?) OR
     p.confirmed_revision_id IN (SELECT id FROM workflow_revisions WHERE task_id=?) OR
     p.common_revision_id IN (SELECT id FROM workflow_revisions WHERE task_id=?))`, taskId, taskId, taskId, taskId)
  add('RETENTION_CROSS_TASK_REFERENCE', externalParticipantReferences.length)
  const externalReviews = db.all(`SELECT rv.id FROM workflow_reviews rv JOIN workflow_revisions r ON r.id=rv.revision_id
    JOIN workflow_participants p ON p.id=rv.participant_id WHERE r.task_id=? AND p.task_id<>?`, taskId, taskId)
  add('RETENTION_CROSS_TASK_REFERENCE', externalReviews.length)
  const externalSnapshots = db.all(`SELECT s.id FROM workflow_snapshots s JOIN workflow_snapshots old ON old.id=s.supersedes_id WHERE old.task_id=? AND s.task_id<>?`, taskId, taskId)
  add('RETENTION_CROSS_TASK_REFERENCE', externalSnapshots.length)
  let shared = 0; let unsafe = 0
  for (const file of data.files) {
    const id = String(file.id)
    if (file.task_id !== taskId || file.purpose !== 'proof' || db.get(`SELECT 1 FROM workflow_revision_files rf
      JOIN workflow_revisions r ON r.id=rf.revision_id WHERE rf.file_id=? AND r.task_id<>? LIMIT 1`, id, taskId) ||
      db.get('SELECT 1 FROM proof_files pf JOIN proofs p ON p.id=pf.proof_id WHERE pf.file_id=? AND p.task_id<>? LIMIT 1', id, taskId) ||
      db.get('SELECT 1 FROM school_settings WHERE logo_file_id=?', id)) shared += 1
    try { checkedFilePath(db, String(file.stored_name)) } catch { unsafe += 1 }
  }
  add('RETENTION_SHARED_FILE', shared)
  add('RETENTION_FILE_PATH_INVALID', unsafe)
  const sending = db.all(`SELECT d.id FROM mail_deliveries d JOIN notices n ON n.id=d.notice_id
    WHERE n.target_kind='task' AND n.target_id=? AND d.status='sending' ORDER BY d.id`, taskId)
  add('RETENTION_MAIL_IN_FLIGHT', sending.length)
  const legacyNotices = db.all(`SELECT n.id FROM notices n WHERE n.event_type IS NULL AND
    (n.user_id=? OR n.user_id IN (SELECT user_id FROM task_members WHERE task_id=?) OR
     n.user_id IN (SELECT user_id FROM workflow_participants WHERE task_id=?)) ORDER BY n.id`, String(data.task.teacher_id), taskId, taskId)
  add('RETENTION_LEGACY_NOTICES', legacyNotices.length)
  const previewHash = createHash('sha256').update(JSON.stringify({ retentionDays, data, externalReferences, externalParticipantReferences, externalReviews, externalSnapshots, sending, legacyNotices })).digest('hex')
  return { taskId, title: String(data.task.title), taskVersion: Number(data.task.version), lastSnapshotAt, eligibleAt,
    eligible: blockers.length === 0, blockers, previewHash,
    counts: { participants: data.participants.length, revisions: data.revisions.length, snapshots: data.snapshots.length,
      files: data.files.length, fileBytes: data.files.reduce((total, file) => total + Number(file.size_bytes), 0), notices: data.notices.length } }
}

export function retentionOverview(db: AppDatabase, actor: CampusUser, page = 1) {
  requireAdmin(db, actor)
  const pageSize = 100
  return {
    page, pageSize, total: Number(db.get("SELECT COUNT(*) n FROM workflow_tasks WHERE status='closed'")?.n ?? 0),
    retentionDays: Number(db.get('SELECT retention_days FROM school_settings WHERE id=1')?.retention_days ?? 365),
    automaticDeletion: false, backupDeletionAutomatic: false,
    items: db.all("SELECT task_id FROM workflow_tasks WHERE status='closed' ORDER BY updated_at,task_id LIMIT ? OFFSET ?", pageSize, (page - 1) * pageSize).map(row => previewTaskRetention(db, actor, String(row.task_id))),
    pendingFileDeletions: Number(db.get('SELECT COUNT(*) n FROM retention_file_deletions WHERE deleted_at IS NULL')?.n ?? 0)
  }
}

export function retryFileDeletions(db: AppDatabase, actor: CampusUser, taskId?: string) {
  requireAdmin(db, actor)
  const rows = db.all(`SELECT * FROM retention_file_deletions WHERE deleted_at IS NULL ${taskId ? 'AND task_id=?' : ''} ORDER BY created_at,id LIMIT 1000`, ...(taskId ? [taskId] : []))
  let deleted = 0; let failed = 0
  for (const row of rows) {
    let code: string | null = null
    try {
      // Recheck both scope and references after commit and on every retry.
      assertCondition(!db.get('SELECT 1 FROM files WHERE id=? OR stored_name=?', String(row.file_id), String(row.stored_name)),
        409, 'RETENTION_FILE_REUSED', '文件标识或存储名称已重新使用，不能删除')
      const resolved = checkedFilePath(db, String(row.stored_name))
      try { fs.unlinkSync(resolved) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      let removed = false
      try { fs.lstatSync(resolved) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') removed = true
        else throw error
      }
      assertCondition(removed, 409, 'RETENTION_FILE_DELETE_FAILED', '材料文件尚未从磁盘删除')
      deleted += 1
    } catch (error) {
      const source = (error as { code?: string })?.code
      code = source === 'RETENTION_FILE_PATH_INVALID' || source === 'RETENTION_FILE_REUSED' ? source : 'RETENTION_FILE_DELETE_FAILED'
      failed += 1
    }
    db.run('UPDATE retention_file_deletions SET attempts=attempts+1,last_error_code=?,deleted_at=? WHERE id=?', code, code ? null : nowIso(), String(row.id))
  }
  if (!taskId && rows.length) audit(db, actor.id, 'retention.files_retry', 'system', 'retention-files', { processed: rows.length, deleted, failed })
  return { processed: rows.length, deleted, failed, pending: Number(db.get('SELECT COUNT(*) n FROM retention_file_deletions WHERE deleted_at IS NULL')?.n ?? 0) }
}

function deleteReferencesFirst(db: AppDatabase, table: 'workflow_snapshots' | 'workflow_revisions', reference: 'supersedes_id' | 'source_revision_id', taskId: string) {
  while (db.get(`SELECT 1 FROM ${table} WHERE task_id=? LIMIT 1`, taskId)) {
    const removed = db.run(`DELETE FROM ${table} WHERE task_id=? AND NOT EXISTS (SELECT 1 FROM ${table} child WHERE child.${reference}=${table}.id)`, taskId)
    assertCondition(Number(removed.changes) > 0, 409, 'RETENTION_REFERENCE_CYCLE', '材料或快照存在引用循环，不能清除')
  }
}

export function purgeTaskRetention(db: AppDatabase, actor: CampusUser, taskId: string,
  input: { version: number; previewHash: string; confirmation: string }) {
  const preview = db.transaction(() => {
    requireAdmin(db, actor)
    assertCondition(input.confirmation === taskId, 400, 'RETENTION_CONFIRMATION_REQUIRED', '请输入完整任务 ID 确认清除')
    const fresh = previewTaskRetention(db, actor, taskId)
    assertCondition(input.version === fresh.taskVersion && input.previewHash === fresh.previewHash, 409, 'RETENTION_PREVIEW_STALE', '预览后数据或保存设置已变化，请重新预览')
    assertCondition(fresh.eligible, 409, 'RETENTION_BLOCKED', '任务尚未到期或仍存在阻止清除的引用')
    assertCondition(!db.get('SELECT 1 FROM retention_context'), 409, 'RETENTION_CONTEXT_BUSY', '另一个受控清除事务尚未结束')
    const files = taskData(db, taskId).files
    db.run('INSERT INTO retention_context(id,task_id) VALUES(1,?)', taskId)
    try {
      for (const file of files) db.run(`INSERT INTO retention_file_deletions(id,task_id,file_id,stored_name,size_bytes,created_at) VALUES(?,?,?,?,?,?)`,
        createId('deletion'), taskId, String(file.id), String(file.stored_name), Number(file.size_bytes), nowIso())
      db.run("DELETE FROM notices WHERE target_kind='task' AND target_id=?", taskId)
      deleteReferencesFirst(db, 'workflow_snapshots', 'supersedes_id', taskId)
      db.run('DELETE FROM workflow_reviews WHERE participant_id IN (SELECT id FROM workflow_participants WHERE task_id=?)', taskId)
      db.run('DELETE FROM workflow_revision_files WHERE revision_id IN (SELECT id FROM workflow_revisions WHERE task_id=?)', taskId)
      deleteReferencesFirst(db, 'workflow_revisions', 'source_revision_id', taskId)
      db.run('DELETE FROM workflow_imports WHERE task_id=?', taskId)
      db.run('DELETE FROM workflow_participants WHERE task_id=?', taskId)
      db.run('DELETE FROM workflow_tasks WHERE task_id=?', taskId)
      db.run('DELETE FROM proof_files WHERE proof_id IN (SELECT id FROM proofs WHERE task_id=?)', taskId)
      db.run('DELETE FROM proofs WHERE task_id=?', taskId)
      db.run('DELETE FROM task_members WHERE task_id=?', taskId)
      for (const file of files) db.run('DELETE FROM files WHERE id=?', String(file.id))
      db.run('DELETE FROM tasks WHERE id=?', taskId)
      db.run("DELETE FROM audit_logs WHERE entity_type='task' AND entity_id=?", taskId)
      audit(db, actor.id, 'retention.purge', 'task', taskId, { counts: fresh.counts, policy: 'delete-task-records-v1', backupsAutomaticallyDeleted: false })
    } finally { db.run('DELETE FROM retention_context WHERE id=1 AND task_id=?', taskId) }
    return fresh
  })
  return { taskId, purged: true, counts: preview.counts, files: retryFileDeletions(db, actor, taskId), backupsAutomaticallyDeleted: false }
}
