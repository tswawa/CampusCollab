<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { locale, msg, formatNumber, type MessageKey } from '@/mobile/i18n'
import { ApiError, request, requestBlob } from '@/mobile/api'
import { useLoad, useMutation } from '@/mobile/api/ui'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { formatDate, formatTimestamp, instantToLocalInput, zonedLocalToInstant } from '@/mobile/utils/date'
import { completionExportFilename } from '@/mobile/utils/task'
import { mapRosterRows, parseRosterCsv } from '@/mobile/utils/roster'
import { reviewInBatches } from '@/mobile/utils/review-batches'
import LoadState from '@/mobile/components/LoadState.vue'
import type { CampusTask, CampusUser, PageData } from '@/mobile/types'
import EvidenceEditor from '@/mobile/components/EvidenceEditor.vue'
import { evidenceTemplates } from '../../../../shared/templates'
import type {
  BatchReviewResult,
  BindingCandidate,
  ConfigureWorkflowInput,
  ProofRevision,
  ReviewRevisionInput,
  RosterImportInput,
  RosterImportPreview,
  TaskWorkflow,
  WorkflowParticipant,
  WorkflowParticipantStatus,
  WorkflowReview,
  WorkflowSnapshot
} from '../../../../shared/workflow-contracts'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const tasks = useTaskStore()
const taskId = computed(() => String(route.params.id))
const task = computed(() => tasks.taskById(taskId.value))
const workflow = ref<TaskWorkflow>()
const base = computed(() => `/tasks/${encodeURIComponent(taskId.value)}/workflow`)
const accessDenied = ref(false)
let accessEpoch = 0
const { busy, error: mutationError, run, cancel: cancelMutation } = useMutation(checkDeniedMutation)
const config = reactive<ConfigureWorkflowInput>({
  version: 0,
  templateId: 'generic-practice',
  templateVersion: 1,
  mode: 'individual',
  plannedMinutes: null,
  submissionDeadline: null,
  personalSubmissionRequired: true
})
const submissionDeadlineLocal = ref('')
let initialized = ''
let loadedConfig = ''
const configDraft = () =>
  JSON.stringify([
    config.templateId,
    config.templateVersion,
    config.mode,
    config.plannedMinutes,
    config.personalSubmissionRequired,
    submissionDeadlineLocal.value
  ])
function acceptConfig(value: TaskWorkflow['config']) {
  Object.assign(config, value)
  submissionDeadlineLocal.value = instantToLocalInput(value.submissionDeadline, auth.timezone)
  loadedConfig = configDraft()
}
const { loading, error, reload } = useLoad(
  async signal => {
    const epoch = accessEpoch
    try {
      const [result, taskResult] = await Promise.all([
        request<TaskWorkflow>(base.value, { signal }),
        request<CampusTask>(`/tasks/${encodeURIComponent(taskId.value)}`, { signal })
      ])
      if (epoch !== accessEpoch) return
      tasks.cacheTask(taskResult.data)
      workflow.value = result.data
      accessDenied.value = false
      if (initialized !== taskId.value || configDraft() === loadedConfig) {
        acceptConfig(result.data.config)
        initialized = taskId.value
      }
      if (requirementsFrozen.value) {
        const { templateId, templateVersion, mode, personalSubmissionRequired } = result.data.config
        Object.assign(config, { templateId, templateVersion, mode, personalSubmissionRequired })
      }
      selected.value = selected.value.filter(id =>
        result.data.participants.some(person => person.id === id && person.status === 'review')
      )
    } catch (cause) {
      clearDeniedAccess(cause)
      throw cause
    }
  },
  [taskId]
)
const canManage = computed(() => workflow.value?.canManage ?? false)
const open = computed(() => workflow.value?.config.status === 'open')
const participants = computed(() => workflow.value?.participants ?? [])
const requirementsFrozen = computed(() =>
  Boolean(workflow.value?.commonRevisions.length || participants.value.some(person => person.revisions.length))
)
const template = computed(() => {
  const selected = evidenceTemplates.find(
    t => t.id === workflow.value?.config.templateId && t.version === workflow.value?.config.templateVersion
  )
  if (!selected) return undefined
  return {
    ...selected,
    items: selected.items.map(item =>
      item.kind === 'image' && task.value?.proofTypes.includes('image')
        ? { ...item, required: true, minFiles: Math.max(1, item.minFiles ?? 0) }
        : item
    )
  }
})
const terminal = new Set<WorkflowParticipantStatus>(['completed', 'withdrawn', 'rejected', 'incomplete', 'cancelled'])
const pendingCount = computed(() => participants.value.filter(p => !terminal.has(p.status)).length)
const confirmed = computed(() => participants.value.filter(p => p.status === 'completed').length)
const incomplete = computed(
  () => participants.value.filter(p => ['incomplete', 'withdrawn', 'rejected', 'cancelled'].includes(p.status)).length
)
const confirmedMinutes = computed(() => participants.value.reduce((sum, p) => sum + (p.confirmedMinutes ?? 0), 0))
const reviewCount = computed(() => participants.value.filter(p => p.status === 'review').length)

const finishedPercent = computed(() =>
  participants.value.length ? Math.round(((confirmed.value + incomplete.value) / participants.value.length) * 100) : 0
)
const latestSnapshot = computed(() => workflow.value?.snapshots[0])
const personInitial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '·'
const latestRevision = (person: WorkflowParticipant) =>
  person.revisions.find(revision => revision.id === person.latestRevisionId)
const participantActionLabel = (person: WorkflowParticipant) =>
  msg(
    canManage.value && open.value && person.status === 'review'
      ? '审核材料'
      : canManage.value && open.value && person.status === 'changes_requested'
        ? '处理补正'
        : '查看记录'
  )
function missingItemLabel(value: string): string {
  const item = template.value?.items.find(item => item.id === value || (value === 'fileIds' && item.kind === 'image'))
  if (item) return item.label[locale.value]
  const labels: Record<string, MessageKey> = {
    description: '完成说明',
    note: '补充备注',
    fileIds: '附件',
    images: '附件',
    files: '附件',
    reportedMinutes: '自报分钟数'
  }
  return labels[value] ? msg(labels[value]!) : value
}
const statuses: Record<WorkflowParticipantStatus, MessageKey> = {
  applied: '待确认',
  upcoming: '未提交',
  in_progress: '未提交',
  review: '待审核',
  changes_requested: '待补正',
  completed: '已确认',
  withdrawn: '已退出',
  rejected: '已拒绝',
  incomplete: '未完成',
  cancelled: '已撤销'
}
const statusLabel = (status: WorkflowParticipantStatus) => msg(statuses[status])
const filters = ['all', 'not_submitted', 'review', 'changes_requested', 'completed', 'incomplete'] as const
const filterNames: Record<(typeof filters)[number], MessageKey> = {
  all: '全部',
  not_submitted: '未提交',
  review: '待审核',
  changes_requested: '待补正',
  completed: '已确认',
  incomplete: '未完成'
}
const statusFilter = ref<(typeof filters)[number]>('all')
const search = ref('')
function clearRosterFilters() {
  search.value = ''
  statusFilter.value = 'all'
}
const selected = ref<string[]>([])
function countForFilter(value: (typeof filters)[number]): number {
  if (value === 'all') return participants.value.length
  if (value === 'not_submitted')
    return participants.value.filter(p => ['applied', 'upcoming', 'in_progress'].includes(p.status)).length
  if (value === 'incomplete') return incomplete.value
  return participants.value.filter(p => p.status === value).length
}
const visibleParticipants = computed(() =>
  participants.value.filter(p => {
    const matchesStatus =
      statusFilter.value === 'all' ||
      (statusFilter.value === 'not_submitted'
        ? ['applied', 'upcoming', 'in_progress'].includes(p.status)
        : statusFilter.value === 'incomplete'
          ? ['incomplete', 'withdrawn', 'rejected', 'cancelled'].includes(p.status)
          : p.status === statusFilter.value)
    return (
      matchesStatus && `${p.name} ${p.externalId ?? ''}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
    )
  })
)

async function saveConfig() {
  const { version, plannedMinutes } = config
  const { templateId, templateVersion, mode, personalSubmissionRequired } = requirementsFrozen.value
    ? workflow.value!.config
    : config
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/config`, {
        method: 'PUT',
        body: {
          version,
          templateId,
          templateVersion,
          mode,
          plannedMinutes: plannedMinutes === null || String(plannedMinutes) === '' ? null : Number(plannedMinutes),
          submissionDeadline: zonedLocalToInstant(submissionDeadlineLocal.value, auth.timezone),
          personalSubmissionRequired
        }
      }),
    result => {
      workflow.value = result.data
      acceptConfig(result.data.config)
    },
    msg('已保存')
  )
}
async function refreshVersions() {
  await reload()
  if (workflow.value && !error.value) {
    config.version = workflow.value.config.version
    if (active.value) {
      draft.version = active.value.version
      draft.revisionId = active.value.latestRevisionId ?? ''
    }
  }
}

const csv = ref('')
const importSource = ref('')
const csvRows = ref<string[][]>([])
const importError = ref('')
const importIssueKeys: Record<string, MessageKey> = {
  EXTERNAL_ID_REQUIRED: '编号不能为空或超过100字',
  NAME_REQUIRED: '姓名不能为空或超过100字',
  FIELD_TOO_LONG: '字段过长',
  DUPLICATE_EXTERNAL_ID: '同一来源中编号重复',
  SAME_NAME_DISTINCT_IDENTITIES: '同名人员将保留为独立记录',
  EXISTING_ID_CONFLICT: '已有编号与导入资料冲突'
}
const importIssue = (code: string) => (importIssueKeys[code] ? msg(importIssueKeys[code]!) : msg('冲突或失败'))
const mapping = reactive({ externalId: 0, name: 1, department: -1, className: -1 })
const preview = ref<RosterImportPreview>()
const previewInput = ref<RosterImportInput>()
let importKey = ''
watch([csv, importSource, () => JSON.stringify(mapping)], () => {
  preview.value = undefined
  previewInput.value = undefined
  importKey = ''
})
function readColumns() {
  try {
    csvRows.value = parseRosterCsv(csv.value)
    importError.value = ''
    preview.value = undefined
  } catch {
    csvRows.value = []
    importError.value = msg('CSV 格式错误或引号未闭合')
  }
}
async function readCsvFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    importError.value = msg('CSV 文件不能超过 2MB')
    return
  }
  csv.value = await file.text()
  readColumns()
}
async function previewImport() {
  readColumns()
  if (importError.value) return
  let rows
  try {
    rows = mapRosterRows(csvRows.value, mapping)
  } catch {
    importError.value = msg('请选择编号列和姓名列')
    return
  }
  const payload = { source: importSource.value.trim(), rows }
  await run(
    () => request<RosterImportPreview>(`${base.value}/import/preview`, { method: 'POST', body: payload }),
    result => {
      preview.value = result.data
      previewInput.value = payload
      importKey = crypto.randomUUID()
    }
  )
}
async function commitImport() {
  if (!preview.value?.valid || !previewInput.value) return
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/import`, {
        method: 'POST',
        body: { ...previewInput.value, hash: preview.value!.hash, idempotencyKey: importKey }
      }),
    result => {
      workflow.value = result.data
      preview.value = undefined
    },
    msg('已保存')
  )
}

const batchFeedback = ref('')
const batchMissing = ref('')
const batchMinutes = ref<number | ''>('')
const batchResult = ref<BatchReviewResult>()
function toggleAllPending() {
  selected.value = visibleParticipants.value.filter(p => p.status === 'review' && p.latestRevisionId).map(p => p.id)
}
const validMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
async function batchReview(decision: 'approved' | 'changes_requested') {
  if (busy.value) return
  const records = participants.value.filter(
    p => selected.value.includes(p.id) && p.status === 'review' && p.latestRevisionId
  )
  if (!records.length || (decision === 'approved' && !validMinutes(batchMinutes.value))) {
    showToast(msg('请选择待审核成员并填写分钟数'))
    return
  }
  if (decision === 'changes_requested' && !batchFeedback.value.trim()) {
    showToast(msg('请填写退回修改意见'))
    return
  }
  const items: ReviewRevisionInput[] = records.map(p => ({
    participantId: p.id,
    version: p.version,
    revisionId: p.latestRevisionId!,
    decision,
    feedback: batchFeedback.value.trim(),
    missingItems: batchMissing.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    ...(decision === 'approved' ? { confirmedMinutes: batchMinutes.value as number } : {})
  }))
  batchResult.value = { results: [] }
  let applied = 0
  await run(signal =>
    reviewInBatches(
      items,
      async (batch, batchSignal) =>
        (
          await request<BatchReviewResult>(`${base.value}/batch-review`, {
            method: 'POST',
            body: { items: batch },
            signal: batchSignal
          })
        ).data,
      result => {
        batchResult.value = result
        const completed = new Set(result.results.filter(item => item.ok).map(item => item.participantId))
        selected.value = records.filter(person => !completed.has(person.id)).map(person => person.id)
        if (workflow.value) {
          const updates = new Map(
            result.results
              .slice(applied)
              .filter(receipt => receipt.ok && receipt.participant)
              .map(receipt => [receipt.participantId, receipt.participant!])
          )
          workflow.value.participants = workflow.value.participants.map(person => updates.get(person.id) ?? person)
        }
        applied = result.results.length
      },
      signal
    )
  )
}

const activeId = ref('')
const active = computed(() => participants.value.find(p => p.id === activeId.value))
const showParticipant = ref(false)
const draft = reactive({
  version: 0,
  revisionId: '',
  description: '',
  note: '',
  files: [] as Array<{ id: string; url: string }>,
  reportedMinutes: '' as number | '',
  feedback: '',
  missing: '',
  confirmedMinutes: '' as number | '',
  commonRevisionId: '',
  sourceRevisionId: '',
  outcome: 'incomplete',
  reason: '',
  userId: ''
})
const evidenceEditor = ref<InstanceType<typeof EvidenceEditor>>()
const reusableEvidence = ref<
  Array<{ taskId: string; taskTitle: string; participantName: string; revision: ProofRevision }>
>([])
const reusablePage = ref(1)
const reusableHasMore = ref(true)
const reusableOptions = computed(() => {
  const current = (active.value?.revisions ?? []).map(revision => ({
    taskId: taskId.value,
    taskTitle: task.value?.title ?? '',
    participantName: active.value?.name ?? '',
    revision
  }))
  return [
    ...current,
    ...reusableEvidence.value.filter(item => !current.some(existing => existing.revision.id === item.revision.id))
  ]
})
watch(activeId, () => {
  reusableEvidence.value = []
  reusablePage.value = 1
  reusableHasMore.value = true
})
async function loadReusableEvidence() {
  await run(
    () =>
      request<{ items: typeof reusableEvidence.value; hasMore: boolean }>(`${base.value}/reusable-evidence`, {
        query: { participantId: activeId.value, page: reusablePage.value }
      }),
    result => {
      reusableEvidence.value.push(...result.data.items)
      reusablePage.value++
      reusableHasMore.value = result.data.hasMore
    }
  )
}
const bindingAccount = ref('')
const bindingCandidate = ref<BindingCandidate | null>()
const bindingChecked = ref(false)
watch([activeId, bindingAccount], () => {
  bindingCandidate.value = undefined
  bindingChecked.value = false
})
async function findBindingCandidate() {
  await run(
    () =>
      request<BindingCandidate | null>(`${base.value}/binding-candidate`, {
        method: 'POST',
        body: { participantId: activeId.value, account: bindingAccount.value.trim() }
      }),
    result => {
      bindingCandidate.value = result.data
      bindingChecked.value = true
    }
  )
}
async function bindAccount() {
  const candidate = bindingCandidate.value
  if (!candidate) return
  try {
    await showConfirmDialog({
      title: msg('确认关联 {p0}（{p1}）？', { p0: candidate.name, p1: candidate.account }),
      message: msg('必须核实编号所属人，不按姓名自动绑定。')
    })
  } catch {
    return
  }
  await participantAction('bind', { userId: candidate.id }, true)
}
let previousFocus: HTMLElement | null = null
watch(showParticipant, async shown => {
  if (shown) {
    previousFocus = document.activeElement as HTMLElement | null
    await nextTick()
    document.querySelector<HTMLElement>('.participant-panel button')?.focus()
  } else {
    await nextTick()
    previousFocus?.focus()
  }
})
function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape' && !busy.value) {
    showParticipant.value = false
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary'
    )
  ).filter(el => el.getClientRects().length)
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
function inspect(p: WorkflowParticipant) {
  activeId.value = p.id
  const revision = p.revisions.find(r => r.id === p.latestRevisionId)
  Object.assign(draft, {
    version: p.version,
    revisionId: p.latestRevisionId ?? '',
    description: revision?.description ?? '',
    note: revision?.note ?? '',
    files: (revision?.fileIds ?? []).map((id, index) => ({ id, url: revision?.images[index] ?? '' })),
    reportedMinutes: p.reportedMinutes ?? '',
    feedback: p.feedback,
    missing: p.missingItems.join('\n'),
    confirmedMinutes: p.confirmedMinutes ?? '',
    commonRevisionId: workflow.value?.commonRevisions.slice(-1)[0]?.id ?? '',
    sourceRevisionId: '',
    outcome: canManage.value ? 'incomplete' : 'withdrawn',
    reason: '',
    userId: ''
  })
  showParticipant.value = true
}
const canSubmit = computed(
  () =>
    open.value &&
    active.value &&
    ['upcoming', 'in_progress', 'changes_requested'].includes(active.value.status) &&
    (canManage.value || active.value.userId === auth.currentUserId)
)
const revisionLabels: Record<string, MessageKey> = {
  description: '说明变化',
  note: '备注变化',
  fileIds: '附件变化',
  files: '附件变化',
  reportedMinutes: '时长变化'
}
const changedLabels = (revision: ProofRevision) =>
  revision.changedFields.map(field => (revisionLabels[field] ? msg(revisionLabels[field]!) : field)).join(', ')
const reviewLabel = (review: WorkflowReview) =>
  review.decision === 'approved'
    ? msg('已批准')
    : review.decision === 'minutes_corrected'
      ? msg('已更正时长')
      : review.decision === 'reopened'
        ? msg('发起更正')
        : statusLabel(review.decision)
function previousRevision(revision: ProofRevision) {
  return active.value?.revisions.find(item => item.revision === revision.revision - 1)
}
function reuseRevision() {
  const previous = reusableOptions.value.find(item => item.revision.id === draft.sourceRevisionId)?.revision
  if (!previous) return
  draft.description = previous.description
  draft.note = previous.note
  draft.files = previous.fileIds.map((id, index) => ({ id, url: previous.images[index] ?? '' }))
  draft.reportedMinutes = ''
}
async function participantAction(action: string, body: Record<string, unknown>, close = false) {
  if (!active.value) return
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/${action}`, {
        method: 'POST',
        body: { participantId: activeId.value, version: draft.version, ...body }
      }),
    result => {
      workflow.value = result.data
      draft.version = result.data.participants.find(p => p.id === activeId.value)?.version ?? draft.version
      if (close) showParticipant.value = false
    },
    msg('已保存')
  )
}
async function submitRevision() {
  if (!canSubmit.value || evidenceEditor.value?.uploading) return
  if (draft.reportedMinutes !== '' && !validMinutes(draft.reportedMinutes)) {
    showToast(msg('分钟数必须为非负整数'))
    return
  }
  await participantAction(
    'submit',
    {
      description: draft.description.trim(),
      note: draft.note.trim(),
      fileIds: draft.files.map(f => f.id),
      reportedMinutes: draft.reportedMinutes === '' ? null : draft.reportedMinutes,
      sourceRevisionId: draft.sourceRevisionId || undefined
    },
    true
  )
}
async function review(decision: 'approved' | 'changes_requested') {
  if (decision === 'approved' && !validMinutes(draft.confirmedMinutes)) {
    showToast(msg('分钟数必须为非负整数'))
    return
  }
  if (decision === 'changes_requested' && !draft.feedback.trim()) {
    showToast(msg('请填写退回修改意见'))
    return
  }
  await participantAction(
    'review',
    {
      revisionId: draft.revisionId,
      decision,
      feedback: draft.feedback.trim(),
      missingItems: draft.missing
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean),
      ...(decision === 'approved' ? { confirmedMinutes: draft.confirmedMinutes } : {})
    },
    true
  )
}
async function groupConfirm() {
  if (!validMinutes(draft.confirmedMinutes)) {
    showToast(msg('分钟数必须为非负整数'))
    return
  }
  await participantAction(
    'group-confirm',
    { commonRevisionId: draft.commonRevisionId, confirmedMinutes: draft.confirmedMinutes, feedback: draft.feedback },
    true
  )
}
async function outcome() {
  if (!draft.reason.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  await participantAction('outcome', { status: draft.outcome, reason: draft.reason.trim() }, true)
}
async function correctMinutes() {
  if (!validMinutes(draft.confirmedMinutes) || !draft.reason.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  await participantAction('minutes', { confirmedMinutes: draft.confirmedMinutes, reason: draft.reason.trim() }, true)
}

const common = reactive({ description: '', note: '', files: [] as Array<{ id: string; url: string }> })
const commonEditor = ref<InstanceType<typeof EvidenceEditor>>()
async function reopenParticipant() {
  if (!draft.reason.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  await participantAction('reopen-participant', { reason: draft.reason.trim() }, true)
}
async function submitCommon() {
  if (commonEditor.value?.uploading) return
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/common`, {
        method: 'POST',
        body: {
          version: workflow.value!.config.version,
          description: common.description,
          note: common.note,
          fileIds: common.files.map(f => f.id)
        }
      }),
    result => {
      workflow.value = result.data
    },
    msg('已保存')
  )
}
const closeoutReason = ref('')
const snapshot = ref<WorkflowSnapshot>()
const snapshotDetails = ref<HTMLDetailsElement>()
const snapshotExpanded = ref(false)
async function closeout() {
  if (!workflow.value || !closeoutReason.value.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  try {
    await showConfirmDialog({
      title: msg('确认结项'),
      message: msg('结项范围包括全部 {p0} 人。', { p0: participants.value.length })
    })
  } catch {
    return
  }
  await run(
    () =>
      request<WorkflowSnapshot>(`${base.value}/closeout`, {
        method: 'POST',
        body: { version: workflow.value!.config.version, reason: closeoutReason.value.trim() }
      }),
    result => {
      snapshot.value = result.data
      snapshotExpanded.value = false
    },
    msg('已结项')
  )
}
async function reopen() {
  if (!closeoutReason.value.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/reopen`, {
        method: 'POST',
        body: { version: workflow.value!.config.version, reason: closeoutReason.value.trim() }
      }),
    result => {
      workflow.value = result.data
    },
    msg('已保存')
  )
}
async function inspectSnapshot(id: string) {
  await run(
    () => request<WorkflowSnapshot>(`${base.value}/snapshots/${encodeURIComponent(id)}`),
    result => {
      snapshot.value = result.data
      snapshotExpanded.value = true
      void nextTick(() => {
        snapshotDetails.value?.scrollIntoView({
          block: 'nearest',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        })
        snapshotDetails.value?.querySelector('summary')?.focus({ preventScroll: true })
      })
    }
  )
}
async function download(id: string, format: 'csv' | 'xlsx' | 'zip') {
  const resultSnapshot = workflow.value?.snapshots.find(item => item.id === id)
  if (!task.value || !resultSnapshot) return
  const filename = completionExportFilename(task.value.title, resultSnapshot.version, format, locale.value)
  await run(
    signal =>
      requestBlob(`${base.value}/snapshots/${encodeURIComponent(id)}/export`, {
        query: { format },
        signal,
        timeout: 60000
      }),
    blob => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  )
}
const ownerId = ref('')
const handoverReason = ref('')
const ownerSearch = ref('')
const ownerCandidates = ref<CampusUser[]>([])
async function findOwners() {
  await run(
    () =>
      request<PageData<CampusUser>>('/admin/accounts', {
        query: { role: 'teacher', approval: 'approved', keyword: ownerSearch.value.trim(), pageSize: 20, page: 1 }
      }),
    result => {
      ownerCandidates.value = result.data.items.filter(user => user.id !== task.value?.teacherId)
      ownerId.value = ''
    }
  )
}
async function handover() {
  if (!handoverReason.value.trim()) {
    showToast(msg('请填写原因'))
    return
  }
  try {
    await showConfirmDialog({ title: msg('确认交接'), message: msg('交接保留历史归属并撤回旧负责人管理权限。') })
  } catch {
    return
  }
  await run(
    () =>
      request<TaskWorkflow>(`${base.value}/handover`, {
        method: 'POST',
        body: { ownerId: ownerId.value.trim(), version: task.value!.version, reason: handoverReason.value.trim() }
      }),
    result => {
      workflow.value = result.data
    },
    msg('已保存')
  )
}
async function copyAnnouncement() {
  if (!task.value) return
  try {
    await navigator.clipboard.writeText(
      `${task.value.title}\n${task.value.date} ${task.value.startTime}–${task.value.endTime} (${auth.timezone})\n${task.value.place}\n${window.location.origin}/tasks/${encodeURIComponent(taskId.value)}`
    )
    showToast(msg('已复制'))
  } catch {
    showToast(msg('复制失败'))
  }
}
function clearDeniedAccess(cause: unknown) {
  if (!(cause instanceof ApiError) || cause.status !== 403 || cause.code !== 'TASK_FORBIDDEN') return
  cancelMutation()
  accessEpoch++
  accessDenied.value = true
  workflow.value = undefined
  tasks.forgetTask(taskId.value)
  showParticipant.value = false
  activeId.value = ''
  selected.value = []
  search.value = ''
  statusFilter.value = 'all'
  csv.value = ''
  csvRows.value = []
  importSource.value = ''
  importError.value = ''
  preview.value = undefined
  previewInput.value = undefined
  batchResult.value = undefined
  batchFeedback.value = ''
  batchMissing.value = ''
  batchMinutes.value = ''
  reusableEvidence.value = []
  bindingCandidate.value = undefined
  bindingAccount.value = ''
  bindingChecked.value = false
  Object.assign(draft, {
    version: 0,
    revisionId: '',
    description: '',
    note: '',
    files: [],
    feedback: '',
    missing: '',
    reason: '',
    reportedMinutes: '',
    confirmedMinutes: '',
    sourceRevisionId: '',
    commonRevisionId: '',
    userId: ''
  })
  Object.assign(common, { description: '', note: '', files: [] })
  snapshot.value = undefined
  closeoutReason.value = ''
  ownerCandidates.value = []
  ownerId.value = ''
  ownerSearch.value = ''
  handoverReason.value = ''
  Object.assign(config, {
    version: 0,
    templateId: 'generic-practice',
    templateVersion: 1,
    mode: 'individual',
    plannedMinutes: null,
    submissionDeadline: null,
    personalSubmissionRequired: true
  })
  initialized = ''
  loadedConfig = ''
  submissionDeadlineLocal.value = ''
}
function checkDeniedMutation(cause: unknown) {
  // An action can be forbidden while the task remains readable. Verify read access before erasing drafts.
  if (cause instanceof ApiError && cause.status === 403 && cause.code === 'TASK_FORBIDDEN') void reload()
}
</script>

<template>
  <div class="workflow-page workflow-workspace page-wrap">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <p v-if="mutationError" role="alert" class="workflow-error">
      {{ mutationError }}
      <button v-if="!accessDenied" type="button" :disabled="busy || loading" @click="refreshVersions">
        {{ msg('刷新并保留草稿') }}
      </button>
    </p>
    <van-button
      v-if="accessDenied"
      @click="
        router.push(
          auth.role === 'admin' ? '/admin/tasks' : auth.role === 'teacher' ? '/teacher/tasks' : '/student/mine'
        )
      "
      >{{ msg('返回') }}</van-button
    >
    <template v-if="workflow && task">
      <header class="workspace-heading">
        <div class="workspace-title-block">
          <div class="workspace-eyebrow">
            <span class="workspace-state" :class="{ 'is-closed': !open }"
              ><i aria-hidden="true" />{{ msg(open ? '开放中' : '已结项') }}</span
            >
          </div>
          <h1>{{ task.title }}</h1>
          <div class="workspace-metadata">
            <span
              ><van-icon name="calendar-o" aria-hidden="true" />{{ formatDate(task.date) }} · {{ task.startTime }}–{{
                task.endTime
              }}</span
            >
            <span><van-icon name="location-o" aria-hidden="true" />{{ task.place }}</span>
            <span class="workspace-zone">{{ auth.timezone }}</span>
          </div>
        </div>
        <div class="workspace-header-actions">
          <a v-if="canManage && workflow.snapshots.length" class="workspace-primary-link" href="#workflow-results"
            ><van-icon name="down" aria-hidden="true" />{{ msg('查看结果包') }}</a
          >
          <button type="button" class="workspace-quiet-button" @click="router.push('/tasks/' + taskId)">
            {{ msg('任务详情') }}
          </button>
          <details class="workspace-more">
            <summary :aria-label="msg('更多操作')"><van-icon name="ellipsis" aria-hidden="true" /></summary>
            <div class="workspace-more-menu">
              <button type="button" @click="copyAnnouncement">{{ msg('复制公告与链接') }}</button>
              <button
                v-if="canManage && auth.role === 'teacher'"
                type="button"
                @click="router.push({ path: '/teacher/create', query: { copy: taskId } })"
              >
                {{ msg('复制任务') }}
              </button>
            </div>
          </details>
        </div>
      </header>

      <section class="workspace-metrics" :aria-label="msg('名单进度')">
        <div class="workspace-metric">
          <span class="metric-label">{{ msg('名单总人数') }}</span
          ><strong>{{ formatNumber(participants.length) }}</strong
          ><van-icon name="friends-o" aria-hidden="true" />
        </div>
        <div class="workspace-metric">
          <span class="metric-label">{{ msg('待审核材料') }}</span
          ><strong :class="{ 'metric-pending': reviewCount > 0 }">{{ formatNumber(reviewCount) }}</strong
          ><van-icon name="todo-list-o" aria-hidden="true" />
        </div>
        <div class="workspace-metric">
          <span class="metric-label">{{ msg('已确认人数') }}</span
          ><strong class="metric-confirmed">{{ formatNumber(confirmed) }}</strong
          ><van-icon name="passed" aria-hidden="true" />
        </div>
        <div class="workspace-metric">
          <span class="metric-label">{{ msg('确认分钟') }}</span
          ><strong
            >{{ formatNumber(confirmedMinutes) }}<small>{{ msg('分钟') }}</small></strong
          ><van-icon name="clock-o" aria-hidden="true" />
        </div>
      </section>

      <section class="workspace-roster surface-card" aria-labelledby="roster-heading">
        <div class="roster-heading-row">
          <div>
            <h2 id="roster-heading">
              {{ canManage ? msg('名单工作台') : msg('材料与版本')
              }}<span class="section-count">{{ formatNumber(participants.length) }}</span>
            </h2>
          </div>
          <label class="roster-search"
            ><span class="workspace-sr-only">{{ msg('搜索姓名或编号') }}</span
            ><van-icon name="search" aria-hidden="true" /><input
              v-model="search"
              type="search"
              :placeholder="msg('搜索姓名或编号')"
          /></label>
        </div>
        <div class="roster-controls">
          <div class="roster-status-tabs" role="group" :aria-label="msg('状态筛选')">
            <button
              v-for="value in filters"
              :key="value"
              type="button"
              :class="{ 'is-active': statusFilter === value }"
              :aria-pressed="statusFilter === value"
              @click="statusFilter = value"
            >
              {{ msg(filterNames[value]) }}<span>{{ formatNumber(countForFilter(value)) }}</span>
            </button>
          </div>
          <button
            v-if="canManage && open"
            class="roster-select-pending"
            type="button"
            :disabled="busy || !reviewCount"
            @click="toggleAllPending"
          >
            {{ msg('全选当前待审') }}
          </button>
        </div>
        <details v-if="canManage && open" class="roster-import workflow-section">
          <summary>{{ msg('导入名单') }}</summary>
          <label class="workflow-field"
            ><span>{{ msg('名单来源') }}</span
            ><input v-model="importSource" :disabled="busy" :placeholder="msg('例如：活动报名 2026')" /></label
          ><label class="workflow-field"
            ><span>{{ msg('选择 CSV 文件') }}</span
            ><input type="file" accept=".csv,text/csv" :disabled="busy" @change="readCsvFile" /></label
          ><label class="workflow-field"
            ><span>{{ msg('也可粘贴 CSV') }}</span
            ><textarea
              v-model="csv"
              rows="5"
              :disabled="busy"
              placeholder="externalId,name&#10;0001,Alex Morgan&#10;0002,Alex Morgan"
            /></label
          ><button type="button" :disabled="busy" @click="readColumns">{{ msg('读取列') }}</button>
          <div v-if="csvRows.length" class="workflow-form-grid">
            <label
              v-for="(label, key) in {
                externalId: '外部编号列',
                name: '姓名列',
                department: '部门列',
                className: '分组列'
              } as const"
              :key="key"
              class="workflow-field"
              ><span>{{ msg(label) }}</span
              ><select v-model.number="mapping[key]" :disabled="busy">
                <option :value="-1">{{ msg('不导入此列') }}</option>
                <option v-for="(column, index) in csvRows[0]" :key="index" :value="index">
                  {{ column || index + 1 }}
                </option>
              </select></label
            >
          </div>
          <p v-if="importError" role="alert">{{ importError }}</p>
          <van-button :loading="busy" :disabled="!csv || !importSource.trim()" @click="previewImport">{{
            msg('预览导入')
          }}</van-button>
          <div v-if="preview">
            <p>{{ msg('新增 {p0} · 不变 {p1}', { p0: preview.added, p1: preview.unchanged }) }}</p>
            <div class="workflow-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ msg('行号') }}</th>
                    <th>ID</th>
                    <th>{{ msg('姓名') }}</th>
                    <th>{{ msg('状态') }}</th>
                    <th>{{ msg('缺项') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in preview.rows" :key="row.row">
                    <td>{{ row.row }}</td>
                    <td>{{ row.externalId }}</td>
                    <td>{{ row.name }}</td>
                    <td>
                      {{
                        msg(row.action === 'add' ? '新增记录' : row.action === 'unchanged' ? '保持不变' : '冲突或失败')
                      }}
                    </td>
                    <td>{{ [...row.errors, ...row.warnings].map(importIssue).join(' · ') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <van-button type="primary" :loading="busy" :disabled="!preview.valid" @click="commitImport">{{
              msg('确认导入')
            }}</van-button>
          </div>
        </details>
        <div class="roster-table-wrap">
          <table class="roster-table" :class="{ 'has-selection': canManage && open }" role="table">
            <caption class="workspace-sr-only">
              {{
                msg('名单工作台')
              }}
            </caption>
            <thead>
              <tr role="row">
                <th v-if="canManage && open" class="roster-select-cell" scope="col">
                  <span class="workspace-sr-only">{{ msg('请选择参与者') }}</span>
                </th>
                <th scope="col">{{ msg('人员') }}</th>
                <th scope="col">{{ msg('状态') }}</th>
                <th class="roster-evidence-cell" scope="col">{{ msg('材料版本') }}</th>
                <th class="roster-time-cell" scope="col">{{ msg('确认时长') }}</th>
                <th class="roster-action-cell" scope="col">{{ msg('操作') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in visibleParticipants" :key="p.id" class="roster-row" role="row">
                <td v-if="canManage && open" class="roster-select-cell">
                  <label class="roster-check"
                    ><input
                      v-model="selected"
                      type="checkbox"
                      :value="p.id"
                      :disabled="p.status !== 'review' || busy"
                      :aria-label="msg('选择参与者 {p0}', { p0: p.name })"
                  /></label>
                </td>
                <td class="roster-person-cell">
                  <div class="roster-person">
                    <span class="roster-avatar" aria-hidden="true">{{ personInitial(p.name) }}</span>
                    <div class="roster-identity">
                      <strong>{{ p.name }}</strong
                      ><span class="roster-person-meta"
                        ><span>{{ p.externalId ?? '—' }}</span></span
                      ><span v-if="p.department || p.className" class="roster-organization">{{
                        [p.department, p.className].filter(Boolean).join(' · ')
                      }}</span>
                    </div>
                  </div>
                </td>
                <td class="roster-status-cell">
                  <span class="roster-status" :class="'workflow-status-' + p.status"
                    ><i aria-hidden="true" />{{ statusLabel(p.status) }}</span
                  ><span v-if="p.missingItems.length" class="roster-missing"
                    >{{ msg('缺项') }}: {{ p.missingItems.map(missingItemLabel).join(' · ') }}</span
                  >
                </td>
                <td class="roster-evidence-cell">
                  <span v-if="latestRevision(p)" class="roster-version">{{
                    msg('版本 {p0}', { p0: latestRevision(p)!.revision })
                  }}</span
                  ><span v-else-if="!p.commonRevisionId" class="roster-empty-value">{{ msg('尚无材料') }}</span
                  ><span v-if="p.commonRevisionId" class="roster-common-note">{{ msg('公共材料已关联') }}</span>
                </td>
                <td class="roster-time-cell">
                  <span class="roster-cell-label">{{ msg('确认时长') }}</span
                  ><strong :class="{ 'roster-empty-value': p.confirmedMinutes === null }">{{
                    p.confirmedMinutes === null ? '—' : formatNumber(p.confirmedMinutes)
                  }}</strong
                  ><span v-if="p.confirmedMinutes !== null" class="roster-unit">{{ msg('分钟') }}</span>
                </td>
                <td class="roster-action-cell">
                  <button type="button" class="roster-record-button" @click="inspect(p)">
                    {{ participantActionLabel(p) }}<van-icon name="arrow" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!visibleParticipants.length" class="roster-empty">
            <van-icon name="friends-o" aria-hidden="true" />
            <h3>{{ participants.length ? msg('没有匹配的参与者') : msg('暂无名单') }}</h3>
            <button v-if="participants.length" type="button" @click="clearRosterFilters">
              {{ msg('清除筛选') }}
            </button>
          </div>
        </div>
        <div class="roster-footer">
          <span>{{ msg('显示 {p0} / {p1} 人', { p0: visibleParticipants.length, p1: participants.length }) }}</span>
          <div class="roster-completion">
            <span>{{ msg('已处理 {p0}%', { p0: finishedPercent }) }}</span
            ><span class="roster-progress-track" aria-hidden="true"
              ><span :style="{ width: finishedPercent + '%' }"
            /></span>
          </div>
        </div>
        <details v-if="canManage && open && participants.length" class="workflow-batch">
          <summary>{{ msg('批量确认') }} · {{ msg('所选 {p0} 人', { p0: selected.length }) }}</summary>
          <div class="workflow-form-grid">
            <label class="workflow-field"
              ><span>{{ msg('负责人确认分钟数') }}</span
              ><input v-model.number="batchMinutes" type="number" min="0" step="1" :disabled="busy" /></label
            ><label class="workflow-field"
              ><span>{{ msg('补正意见') }}</span
              ><textarea v-model="batchFeedback" rows="2" :disabled="busy" /></label
            ><label class="workflow-field"
              ><span>{{ msg('具体缺项（每行一项）') }}</span
              ><textarea v-model="batchMissing" rows="2" :disabled="busy" />
            </label>
          </div>
          <div class="workflow-actions">
            <van-button type="primary" :loading="busy" :disabled="!selected.length" @click="batchReview('approved')">{{
              msg('批量确认')
            }}</van-button
            ><van-button :loading="busy" :disabled="!selected.length" @click="batchReview('changes_requested')">{{
              msg('批量补正')
            }}</van-button>
          </div>
        </details>
        <section v-if="batchResult" class="workflow-batch-results" aria-live="polite">
          <h3>{{ msg('批量处理结果') }}</h3>
          <ul>
            <li
              v-for="result in batchResult.results"
              :key="result.participantId"
              :data-participant-id="result.participantId"
            >
              {{ participants.find(p => p.id === result.participantId)?.name ?? result.participantId }}:
              {{ result.ok ? msg('成功') : result.message || msg('冲突或失败') }}
            </li>
          </ul>
        </section>
      </section>

      <div class="workspace-secondary">
        <section
          v-if="canManage"
          id="workflow-results"
          class="workspace-results surface-card"
          aria-labelledby="results-heading"
        >
          <div class="workspace-section-heading">
            <div class="section-icon"><van-icon name="certificate" aria-hidden="true" /></div>
            <div>
              <h2 id="results-heading">{{ msg('结项与结果包') }}</h2>
            </div>
            <span v-if="!open" class="workspace-state is-closed">{{ msg('已结项') }}</span>
          </div>
          <div v-if="open" class="closeout-controls">
            <p v-if="pendingCount" class="closeout-pending">
              <van-icon name="info-o" aria-hidden="true" />{{
                msg('还有 {p0} 人待处理，处理后可结项。', { p0: pendingCount })
              }}
            </p>
            <div class="closeout-form">
              <label class="workflow-field"
                ><span>{{ msg('结项原因或说明') }}</span
                ><textarea v-model="closeoutReason" rows="2" :disabled="busy" /></label
              ><van-button
                type="primary"
                :loading="busy"
                :disabled="pendingCount > 0 || !participants.length"
                @click="closeout"
                >{{ msg('确认结项') }}</van-button
              >
            </div>
          </div>
          <div v-if="workflow.snapshots.length" class="result-downloads">
            <div class="result-toolbar">
              <h3>{{ msg('导出与历史版本') }}</h3>
              <span class="result-locale">{{ msg('机构语言') }} · {{ locale === 'en' ? 'English' : '简体中文' }}</span>
            </div>
            <article v-for="item in workflow.snapshots" :key="item.id" class="snapshot-card">
              <div class="snapshot-identity">
                <span class="snapshot-file-icon"><van-icon name="description" aria-hidden="true" /></span>
                <div>
                  <h3>
                    {{ msg('结果版本 {p0}', { p0: item.version })
                    }}<span v-if="item.id === latestSnapshot?.id" class="snapshot-latest">{{ msg('最新结果') }}</span>
                  </h3>
                  <p>{{ formatTimestamp(item.createdAt) }}</p>
                </div>
              </div>
              <div class="snapshot-download-actions">
                <button
                  type="button"
                  class="snapshot-download-primary"
                  :disabled="busy"
                  @click="download(item.id, 'zip')"
                >
                  <van-icon name="down" aria-hidden="true" />{{ msg('下载结果包 ZIP') }}</button
                ><button type="button" :disabled="busy" @click="download(item.id, 'xlsx')">
                  {{ msg('下载 XLSX') }}</button
                ><button type="button" :disabled="busy" @click="download(item.id, 'csv')">{{ msg('下载 CSV') }}</button
                ><button type="button" :disabled="busy" @click="inspectSnapshot(item.id)">
                  {{ msg('查看快照核对') }}
                </button>
              </div>
              <details class="snapshot-note">
                <summary>{{ msg('结项原因或说明') }}</summary>
                <p>{{ item.reason }}</p>
                <p v-if="item.supersedesId">
                  {{
                    msg('替代版本：{p0}', {
                      p0: workflow.snapshots.find(previous => previous.id === item.supersedesId)?.version ?? '—'
                    })
                  }}
                </p>
              </details>
            </article>
          </div>
          <details
            v-if="snapshot"
            ref="snapshotDetails"
            class="snapshot-totals"
            :open="snapshotExpanded"
            @toggle="snapshotExpanded = ($event.target as HTMLDetailsElement).open"
          >
            <summary>{{ msg('查看快照核对') }} · {{ msg('结果版本 {p0}', { p0: snapshot.version }) }}</summary>
            <p>
              {{
                msg('参与者 {p0} · 已确认 {p1} · 未完成 {p2}', {
                  p0: snapshot.totals.participants,
                  p1: snapshot.totals.completed,
                  p2: snapshot.totals.participants - snapshot.totals.completed
                })
              }}
            </p>
            <p>{{ msg('确认合计 {p0} 分钟', { p0: snapshot.totals.confirmedMinutes }) }}</p>
            <div class="workflow-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{{ msg('人员') }}</th>
                    <th>ID</th>
                    <th>{{ msg('状态') }}</th>
                    <th>{{ msg('确认时长') }}</th>
                    <th>{{ msg('已确认材料版本') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in snapshot.participants" :key="p.id">
                    <td>{{ p.name }}</td>
                    <td>{{ p.externalId ?? '—' }}</td>
                    <td>{{ statusLabel(p.status) }}</td>
                    <td>
                      {{ p.confirmedMinutes === null ? '—' : `${formatNumber(p.confirmedMinutes)} ${msg('分钟')}` }}
                    </td>
                    <td>
                      {{
                        p.confirmedRevisionId
                          ? msg('版本 {p0}', {
                              p0: p.revisions.find(revision => revision.id === p.confirmedRevisionId)?.revision ?? '—'
                            })
                          : p.commonRevisionId
                            ? msg('公共材料')
                            : '—'
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <details v-if="!open" class="closeout-correction">
            <summary>{{ msg('结项更正') }}</summary>
            <label class="workflow-field"
              ><span>{{ msg('结项原因或说明') }}</span
              ><textarea v-model="closeoutReason" rows="2" :disabled="busy" /></label
            ><van-button :loading="busy" @click="reopen">{{ msg('重新打开并更正') }}</van-button>
          </details>
        </section>
        <div class="workspace-reference-panels">
          <details class="surface-card workflow-section workspace-requirements">
            <summary>{{ msg('任务要求与模板') }}</summary>
            <div class="requirements-content">
              <h3>
                {{ template?.name[locale] }}
                <span>{{ msg('模板版本 {p0}', { p0: workflow.config.templateVersion }) }}</span>
              </h3>
              <ul class="requirements-list">
                <li v-for="item in template?.items" :key="item.id">
                  <van-icon :name="item.required ? 'passed' : 'info-o'" aria-hidden="true" /><span>{{
                    item.label[locale]
                  }}</span
                  ><span class="requirement-mark">{{ msg(item.required ? '必填' : '选填') }}</span>
                </li>
              </ul>
              <dl class="requirements-meta">
                <div>
                  <dt>{{ msg('任务模式') }}</dt>
                  <dd>{{ msg(workflow.config.mode === 'group' ? '集体活动' : '个人任务') }}</dd>
                </div>
                <div>
                  <dt>{{ msg('计划时长（分钟）') }}</dt>
                  <dd>
                    {{ workflow.config.plannedMinutes === null ? '—' : formatNumber(workflow.config.plannedMinutes) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ msg('材料截止时间') }}</dt>
                  <dd>
                    {{ workflow.config.submissionDeadline ? formatTimestamp(workflow.config.submissionDeadline) : '—' }}
                  </dd>
                </div>
              </dl>
            </div>
            <details v-if="canManage && open" class="workflow-config-editor">
              <summary>{{ msg('更新要求') }}</summary>
              <div class="workflow-form-grid">
                <label class="workflow-field"
                  ><span>{{ msg('模板与要求') }}</span
                  ><select v-model="config.templateId" :disabled="busy || requirementsFrozen">
                    <option v-for="item in evidenceTemplates" :key="item.id" :value="item.id">
                      {{ item.name[locale] }} · v{{ item.version }}
                    </option>
                  </select></label
                >
                <label class="workflow-field"
                  ><span>{{ msg('任务模式') }}</span
                  ><select v-model="config.mode" :disabled="busy || requirementsFrozen">
                    <option value="individual">{{ msg('个人任务') }}</option>
                    <option value="group">{{ msg('集体活动') }}</option>
                  </select></label
                >
                <label class="workflow-field"
                  ><span>{{ msg('计划时长（分钟）') }}</span
                  ><input v-model.number="config.plannedMinutes" type="number" min="0" step="1" :disabled="busy"
                /></label>
                <label class="workflow-field"
                  ><span>{{ msg('材料截止时间') }} ({{ auth.timezone }})</span
                  ><input v-model="submissionDeadlineLocal" type="datetime-local" :disabled="busy"
                /></label>
                <label
                  ><input
                    v-model="config.personalSubmissionRequired"
                    type="checkbox"
                    :disabled="busy || requirementsFrozen"
                  />
                  {{ msg('要求个人补充') }}</label
                >
              </div>
              <van-button :loading="busy" @click="saveConfig">{{ msg('更新要求') }}</van-button>
            </details>
          </details>
          <details
            v-if="workflow.config.mode === 'group' && (canManage || workflow.commonRevisions.length)"
            class="surface-card workflow-section workflow-common-materials"
          >
            <summary>{{ msg('公共材料') }}</summary>
            <article v-for="revision in workflow.commonRevisions" :key="revision.id" class="common-revision">
              <h3>
                {{ msg('版本 {p0}', { p0: revision.revision }) }}
                <span v-if="participants.some(person => person.commonRevisionId === revision.id)">{{
                  msg('已确认')
                }}</span>
              </h3>
              <p>{{ revision.description }}</p>
              <p v-if="revision.note">{{ revision.note }}</p>
              <p>{{ formatTimestamp(revision.submittedAt) }}</p>
              <div class="evidence-files">
                <a v-for="(url, index) in revision.images" :key="url" :href="url" target="_blank" rel="noopener"
                  ><img :src="url" :alt="msg('凭证图片 {p0}', { p0: index + 1 })"
                /></a>
              </div>
            </article>
            <div v-if="canManage && open">
              <h3>{{ msg('新公共材料版本') }}</h3>
              <EvidenceEditor
                ref="commonEditor"
                v-model:description="common.description"
                v-model:note="common.note"
                v-model:files="common.files"
                :task-id="taskId"
                :disabled="busy"
              /><van-button type="primary" :loading="busy" :disabled="commonEditor?.uploading" @click="submitCommon">{{
                msg('提交新版本')
              }}</van-button>
            </div>
          </details>
          <details v-if="auth.role === 'admin'" class="surface-card workflow-section">
            <summary>{{ msg('负责人交接') }}</summary>
            <label class="workflow-field"
              ><span>{{ msg('搜索负责人账号或姓名') }}</span
              ><input v-model="ownerSearch" :disabled="busy" /></label
            ><button type="button" :disabled="busy" @click="findOwners">{{ msg('查询账号') }}</button
            ><label class="workflow-field"
              ><span>{{ msg('请选择新的负责人') }}</span
              ><select v-model="ownerId" :disabled="busy">
                <option value="">{{ msg('请选择') }}</option>
                <option v-for="person in ownerCandidates" :key="person.id" :value="person.id">
                  {{ person.name }} ({{ person.account }})
                </option>
              </select></label
            ><label class="workflow-field"
              ><span>{{ msg('原因') }}</span
              ><textarea v-model="handoverReason" rows="2" :disabled="busy" /></label
            ><van-button :loading="busy" :disabled="!ownerId.trim()" @click="handover">{{
              msg('确认交接')
            }}</van-button>
          </details>
        </div>
      </div>
      <van-popup
        v-model:show="showParticipant"
        position="right"
        :close-on-click-overlay="!busy"
        :style="{ width: 'min(96vw, 760px)', height: '100%' }"
      >
        <section
          v-if="active"
          class="participant-panel"
          :key="active.id"
          role="dialog"
          @keydown="trapFocus"
          aria-modal="true"
          aria-labelledby="participant-heading"
        >
          <header class="workflow-heading">
            <div>
              <h2 id="participant-heading">{{ active.name }}</h2>
              <p>{{ active.externalId ?? active.id }} · {{ statusLabel(active.status) }}</p>
            </div>
            <button type="button" :disabled="busy" @click="showParticipant = false">{{ msg('关闭') }}</button>
          </header>
          <p v-if="mutationError" class="workflow-error" role="alert">
            {{ mutationError }}
            <button type="button" :disabled="busy || loading" @click="refreshVersions">
              {{ msg('刷新并保留草稿') }}
            </button>
          </p>
          <p v-if="active.feedback">{{ msg('验收反馈：{p0}', { p0: active.feedback }) }}</p>
          <ul v-if="active.missingItems.length">
            <li v-for="item in active.missingItems" :key="item">{{ missingItemLabel(item) }}</li>
          </ul>
          <h3>{{ msg('材料与版本') }}</h3>
          <p v-if="!active.revisions.length">{{ msg('尚无提交版本') }}</p>
          <details
            v-for="revision in [...active.revisions].reverse()"
            :key="revision.id"
            :open="revision.id === active.latestRevisionId"
            class="revision-card"
          >
            <summary>
              {{ msg('版本 {p0}', { p0: revision.revision }) }} · {{ formatTimestamp(revision.submittedAt) }}
              <strong v-if="revision.id === active.confirmedRevisionId">{{ msg('已确认') }}</strong>
            </summary>
            <p>{{ msg('修改字段：{p0}', { p0: changedLabels(revision) || '—' }) }}</p>
            <div class="revision-comparison">
              <section v-if="previousRevision(revision)">
                <h4>{{ msg('上一版本') }}</h4>
                <p>{{ previousRevision(revision)?.description }}</p>
                <p>{{ previousRevision(revision)?.note }}</p>
              </section>
              <section>
                <h4>{{ msg('当前版本') }}</h4>
                <p>{{ revision.description }}</p>
                <p>{{ revision.note }}</p>
              </section>
            </div>
            <p>
              {{ msg('自报分钟数') }}:
              {{ revision.reportedMinutes === null ? '—' : formatNumber(revision.reportedMinutes) }}
            </p>
            <div class="evidence-files">
              <a v-for="(url, index) in revision.images" :key="url" :href="url" target="_blank" rel="noopener"
                ><img :src="url" :alt="msg('凭证图片 {p0}', { p0: index + 1 })"
              /></a>
            </div>
            <ul>
              <li v-for="reviewItem in revision.reviews" :key="reviewItem.id">
                {{ reviewLabel(reviewItem) }} · {{ formatTimestamp(reviewItem.createdAt) }} · {{ reviewItem.feedback }}
                <span v-if="reviewItem.missingItems.length">{{
                  reviewItem.missingItems.map(missingItemLabel).join(' · ')
                }}</span>
              </li>
            </ul>
          </details>
          <details v-if="canSubmit" class="workflow-section" :open="!canManage">
            <summary>{{ msg('新增提交版本') }}</summary>
            <button type="button" :disabled="busy || !reusableHasMore" @click="loadReusableEvidence">
              {{
                msg(reusablePage === 1 ? '加载可复用材料' : reusableHasMore ? '更多历史材料' : '没有更多可用材料')
              }}</button
            ><label v-if="reusableOptions.length" class="workflow-field"
              ><span>{{ msg('引用已有材料版本') }}</span
              ><select v-model="draft.sourceRevisionId" :disabled="busy" @change="reuseRevision">
                <option value="">{{ msg('不引用') }}</option>
                <option v-for="item in reusableOptions" :key="item.revision.id" :value="item.revision.id">
                  {{ item.taskTitle }} · {{ item.participantName }} ·
                  {{ msg('版本 {p0}', { p0: item.revision.revision }) }}
                </option>
              </select></label
            ><EvidenceEditor
              ref="evidenceEditor"
              v-model:description="draft.description"
              v-model:note="draft.note"
              v-model:files="draft.files"
              :task-id="taskId"
              :disabled="busy"
            /><label class="workflow-field"
              ><span>{{ msg('自报分钟数') }}</span
              ><input v-model.number="draft.reportedMinutes" type="number" min="0" step="1" :disabled="busy" /></label
            ><van-button type="primary" :loading="busy" :disabled="evidenceEditor?.uploading" @click="submitRevision">{{
              msg('提交新版本')
            }}</van-button>
          </details>
          <section v-if="canManage && open" class="workflow-section">
            <h3>{{ msg('验收中心') }}</h3>
            <label class="workflow-field"
              ><span>{{ msg('负责人确认分钟数') }} *</span
              ><input v-model.number="draft.confirmedMinutes" type="number" min="0" step="1" :disabled="busy" /></label
            ><label class="workflow-field"
              ><span>{{ msg('补正意见') }}</span
              ><textarea v-model="draft.feedback" rows="2" :disabled="busy" /></label
            ><label class="workflow-field"
              ><span>{{ msg('具体缺项（每行一项）') }}</span
              ><textarea v-model="draft.missing" rows="2" :disabled="busy" />
            </label>
            <div v-if="active.status === 'review'" class="workflow-actions">
              <van-button type="primary" :loading="busy" @click="review('approved')">{{ msg('确认通过') }}</van-button
              ><van-button :loading="busy" @click="review('changes_requested')">{{ msg('退回补正') }}</van-button>
            </div>
            <template v-if="workflow.config.mode === 'group' && !terminal.has(active.status)"
              ><label class="workflow-field"
                ><span>{{ msg('选择公共材料版本') }}</span
                ><select v-model="draft.commonRevisionId" :disabled="busy">
                  <option v-for="revision in workflow.commonRevisions" :key="revision.id" :value="revision.id">
                    {{ msg('版本 {p0}', { p0: revision.revision }) }} · {{ revision.description.slice(0, 80) }}
                  </option>
                </select></label
              ><van-button :loading="busy" :disabled="!draft.commonRevisionId" @click="groupConfirm">{{
                msg('确认实际参与')
              }}</van-button></template
            >
          </section>
          <details v-if="canManage && open && !active.userId" class="workflow-section">
            <summary>{{ msg('关联登录账号') }}</summary>
            <label class="workflow-field"
              ><span>{{ msg('精确登录账号') }}</span
              ><input v-model="bindingAccount" :disabled="busy" /></label
            ><button type="button" :disabled="busy || !bindingAccount.trim()" @click="findBindingCandidate">
              {{ msg('查询账号') }}
            </button>
            <p v-if="bindingChecked && !bindingCandidate" role="status">{{ msg('未找到已启用的参与者账号') }}</p>
            <section v-if="bindingCandidate">
              <p>
                <strong>{{ bindingCandidate.name }}</strong> · {{ bindingCandidate.account }} ·
                {{ bindingCandidate.externalId ?? '—' }}
              </p>
              <p>{{ msg('核对姓名和外部编号后再关联。') }}</p>
              <van-button :loading="busy" @click="bindAccount">{{ msg('核对后关联') }}</van-button>
            </section>
          </details>
          <details v-if="open" class="workflow-section">
            <summary>{{ active.status === 'completed' ? msg('更正确认时长') : msg('异常结束') }}</summary>
            <label v-if="active.status !== 'completed'" class="workflow-field"
              ><span>{{ msg('状态') }}</span
              ><select v-model="draft.outcome" :disabled="busy">
                <option value="withdrawn">{{ msg('已退出') }}</option>
                <template v-if="canManage"
                  ><option value="incomplete">{{ msg('未完成') }}</option>
                  <option value="rejected">{{ msg('已拒绝') }}</option>
                  <option value="cancelled">{{ msg('已撤销') }}</option></template
                >
              </select></label
            ><label class="workflow-field"
              ><span>{{ msg('原因') }} *</span><textarea v-model="draft.reason" :disabled="busy" rows="2" /></label
            ><van-button v-if="active.status === 'completed' && canManage" :loading="busy" @click="correctMinutes">{{
              msg('更正确认时长')
            }}</van-button
            ><van-button v-else-if="!terminal.has(active.status)" :loading="busy" @click="outcome">{{
              msg('记录结果')
            }}</van-button>
          </details>
          <section v-if="canManage && open && terminal.has(active.status)" class="workflow-section">
            <label class="workflow-field"
              ><span>{{ msg('原因') }} *</span><textarea v-model="draft.reason" rows="2" :disabled="busy" /></label
            ><van-button :loading="busy" @click="reopenParticipant">{{ msg('发起更正') }}</van-button>
          </section>
          <section v-if="active.reviews.length">
            <h3>{{ msg('审核记录') }}</h3>
            <ol>
              <li v-for="item in active.reviews" :key="item.id">
                {{ reviewLabel(item) }} · {{ formatTimestamp(item.createdAt) }} · {{ item.feedback }}
                <span v-if="item.confirmedMinutes !== null"
                  >{{ formatNumber(item.confirmedMinutes) }} {{ msg('分钟') }}</span
                >
              </li>
            </ol>
          </section>
        </section>
      </van-popup>
    </template>
  </div>
</template>
