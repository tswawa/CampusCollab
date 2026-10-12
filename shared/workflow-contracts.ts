import type { CreateTaskPayload } from './contracts.js'

export type WorkflowParticipantStatus =
  | 'applied'
  | 'upcoming'
  | 'in_progress'
  | 'review'
  | 'changes_requested'
  | 'completed'
  | 'withdrawn'
  | 'rejected'
  | 'incomplete'
  | 'cancelled'
export interface WorkflowConfig {
  templateId: string
  templateVersion: number
  mode: 'individual' | 'group'
  plannedMinutes: number | null
  submissionDeadline: string | null
  personalSubmissionRequired: boolean
  status: 'open' | 'closed'
  version: number
}
export interface WorkflowReview {
  id: string
  revisionId: string | null
  decision:
    | 'approved'
    | 'changes_requested'
    | 'rejected'
    | 'incomplete'
    | 'withdrawn'
    | 'cancelled'
    | 'minutes_corrected'
    | 'reopened'
  feedback: string
  missingItems: string[]
  confirmedMinutes: number | null
  actorId: string
  createdAt: string
}
export interface ProofRevision {
  id: string
  participantId: string | null
  revision: number
  scope: 'personal' | 'common'
  description: string
  note: string
  fileIds: string[]
  images: string[]
  reportedMinutes: number | null
  submittedBy: string
  submittedAt: string
  sourceRevisionId: string | null
  changedFields: string[]
  reviews: WorkflowReview[]
}
export interface WorkflowParticipant {
  id: string
  taskId: string
  userId: string | null
  externalId: string | null
  source: string
  name: string
  department: string
  className: string
  status: WorkflowParticipantStatus
  version: number
  latestRevisionId: string | null
  confirmedRevisionId: string | null
  commonRevisionId: string | null
  reportedMinutes: number | null
  confirmedMinutes: number | null
  feedback: string
  missingItems: string[]
  joinedAt: string
  revisions: ProofRevision[]
  reviews: WorkflowReview[]
}
export interface WorkflowSnapshot {
  id: string
  taskId: string
  version: number
  supersedesId: string | null
  reason: string
  createdAt: string
  createdBy: string
  task: { title: string; ownerId: string; originalOwnerId: string; startAt: string; endAt: string }
  config: WorkflowConfig
  template: Record<string, unknown>
  participants: WorkflowParticipant[]
  commonRevisions: ProofRevision[]
  totals: { participants: number; completed: number; confirmedMinutes: number; byStatus: Record<string, number> }
}
export interface TaskWorkflow {
  taskId: string
  config: WorkflowConfig
  participants: WorkflowParticipant[]
  commonRevisions: ProofRevision[]
  snapshots: Array<Pick<WorkflowSnapshot, 'id' | 'version' | 'supersedesId' | 'reason' | 'createdAt' | 'createdBy'>>
  canManage: boolean
}
export interface RosterImportRow {
  externalId: string
  name: string
  department?: string
  className?: string
}
export interface BindingCandidate {
  id: string
  account: string
  name: string
  externalId: string | null
}
export interface ReusableEvidencePage {
  items: Array<{ taskId: string; taskTitle: string; participantName: string; revision: ProofRevision }>
  hasMore: boolean
}
export interface RosterImportInput {
  source: string
  rows: RosterImportRow[]
}
export interface RosterImportPreview {
  hash: string
  source: string
  valid: boolean
  added: number
  unchanged: number
  rows: Array<{
    row: number
    externalId: string
    name: string
    action: 'add' | 'unchanged' | 'error'
    errors: string[]
    warnings: string[]
  }>
}
export interface SubmitRevisionInput {
  participantId: string
  version: number
  description: string
  note: string
  fileIds: string[]
  reportedMinutes?: number | null
  sourceRevisionId?: string
}
export interface ReviewRevisionInput {
  participantId: string
  version: number
  revisionId: string
  decision: 'approved' | 'changes_requested'
  feedback: string
  missingItems?: string[]
  confirmedMinutes?: number | null
  commonRevisionId?: string
}
export interface BatchReviewResult {
  results: Array<{
    participantId: string
    ok: boolean
    code?: string
    message?: string
    participant?: WorkflowParticipant
  }>
}
export interface ConfigureWorkflowInput {
  version: number
  templateId: string
  templateVersion: number
  mode: 'individual' | 'group'
  plannedMinutes: number | null
  submissionDeadline: string | null
  personalSubmissionRequired: boolean
}
export interface CopyTaskInput {
  task: CreateTaskPayload
}

// Endpoints return the existing ApiSuccess<T> / ApiFailure envelopes.
// GET    /api/tasks/:id/workflow -> TaskWorkflow (students see only themselves)
// PUT    /api/tasks/:id/workflow/config -> TaskWorkflow; ConfigureWorkflowInput
// POST   /api/tasks/:id/workflow/import/preview -> RosterImportPreview; RosterImportInput
// POST   /api/tasks/:id/workflow/import -> TaskWorkflow; RosterImportInput & { hash, idempotencyKey }
// POST   /api/tasks/:id/workflow/bind -> TaskWorkflow; { participantId, userId, version }
// POST   /api/tasks/:id/workflow/submit -> TaskWorkflow; SubmitRevisionInput
// POST   /api/tasks/:id/workflow/common -> TaskWorkflow; { version: config.version, description, note, fileIds }
// POST   /api/tasks/:id/workflow/review -> TaskWorkflow; ReviewRevisionInput
// POST   /api/tasks/:id/workflow/batch-review -> BatchReviewResult; { items: ReviewRevisionInput[] }
// POST   /api/tasks/:id/workflow/outcome -> TaskWorkflow; { participantId, version, status: withdrawn|rejected|incomplete|cancelled, reason }
// POST   /api/tasks/:id/workflow/minutes -> TaskWorkflow; { participantId, version, confirmedMinutes, reason }
// POST   /api/tasks/:id/workflow/group-confirm -> TaskWorkflow; { participantId, version, commonRevisionId, confirmedMinutes, feedback }
// POST   /api/tasks/:id/workflow/closeout -> WorkflowSnapshot; { version: config.version, reason }
// POST   /api/tasks/:id/workflow/reopen -> TaskWorkflow; { version: config.version, reason }
// POST   /api/tasks/:id/workflow/reopen-participant -> TaskWorkflow; { participantId, version, reason } (manager; preserves previous review/snapshot)
// GET    /api/tasks/:id/workflow/snapshots/:snapshotId -> WorkflowSnapshot (owner/admin only)
// POST   /api/tasks/:id/workflow/handover -> TaskWorkflow; { ownerId, version: task.version, reason } (admin only)
// POST   /api/tasks/:id/copy -> CampusTask; CopyTaskInput (copy requirements, no members/materials)
