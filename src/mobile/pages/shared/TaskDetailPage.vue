<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import type { ContactItem } from '@/mobile/types'
import { useLoad, useMutation } from '@/mobile/api/ui'
import { useEvidencePreview } from '@/mobile/composables/useEvidencePreview'
import LoadState from '@/mobile/components/LoadState.vue'
import {
  audienceLabel,
  contactTypeMeta,
  fullTaskTime,
  getOccupiedCount,
  getRemainingSeats,
  memberOf,
  proofTypeLabels
} from '@/mobile/utils/task'
import StatusTag from '@/mobile/components/StatusTag.vue'

const route = useRoute()
const viewProofImages = useEvidencePreview()
const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()

const user = computed(() => auth.currentUser!)
const task = computed(() => taskStore.taskById(String(route.params.id)))
const member = computed(() => (task.value ? memberOf(task.value, user.value.id) : undefined))

const { loading, error, ready, reload } = useLoad(
  signal => taskStore.fetchTask(String(route.params.id), signal),
  [() => route.params.id]
)
const { busy, error: saveError, run } = useMutation()
const canView = computed(() => ready.value && !error.value && Boolean(task.value))
const editVersion = ref(0)

const occupied = computed(() => (task.value ? getOccupiedCount(task.value) : 0))
const remaining = computed(() => (task.value ? getRemainingSeats(task.value) : 0))

// 教师端“更多”菜单
const showTeacherMenu = ref(false)
const teacherMenuActions = computed(() => [{ name: msg('编辑任务') }, { name: msg('撤销任务'), color: '#E11D48' }])

// 编辑弹窗状态
const showEditModal = ref(false)
const editForm = ref({
  place: '',
  duration: '',
  description: ''
})

function openEdit() {
  if (!task.value) return
  editForm.value = {
    place: task.value.location,
    duration: task.value.duration,
    description: task.value.description
  }
  editVersion.value = task.value.version
  showEditModal.value = true
}

async function refreshEditVersion() {
  const id = task.value?.id
  if (id)
    await run(async () => {
      editVersion.value = (await taskStore.fetchTask(id)).version
    })
}
async function saveEdit() {
  if (!task.value) return
  if (!editForm.value.place.trim() || !editForm.value.description.trim()) {
    showToast(msg('地点和描述不能为空'))
    return
  }
  const id = task.value.id
  await run(
    () =>
      taskStore.updateTask(id, {
        place: editForm.value.place.trim(),
        duration: editForm.value.duration.trim(),
        description: editForm.value.description.trim(),
        version: editVersion.value
      }),
    () => {
      showEditModal.value = false
    },
    msg('任务已更新')
  )
}

// 撤销任务：破坏操作保留极短确认
async function handleRevokeTask() {
  if (!task.value || busy.value) return
  const current = task.value
  try {
    await showConfirmDialog({
      title: msg('确认撤销该任务？'),
      message: msg('撤销后任务将终止，已接单学生将收到撤销通知。'),
      confirmButtonText: msg('确认撤销'),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  await run(() => taskStore.cancelTask(current.id, current.version), undefined, msg('已撤销'))
}

function onTeacherMenuSelect(action: { name: string }) {
  showTeacherMenu.value = false
  if (action.name === msg('编辑任务')) {
    openEdit()
  } else if (action.name === msg('撤销任务')) {
    handleRevokeTask()
  }
}

// 联系老师底部菜单
const showContactSheet = ref(false)
const configuredContacts = computed<ContactItem[]>(() => task.value?.contacts ?? [])

async function handleContactAction(item: ContactItem) {
  if (item.type === 'phone') {
    window.location.href = `tel:${item.value}`
    return
  }
  if (item.type === 'email') {
    window.location.href = `mailto:${item.value}`
    return
  }
  if (item.type === 'chat') {
    showToast(msg('本平台未开放聊天，请使用老师提供的其他联系方式'))
    return
  }
  try {
    await navigator.clipboard.writeText(item.value)
    showToast(msg('已复制'))
  } catch {
    showToast(msg('复制失败'))
  }
}

// 学生接单（大幅简化，就地接单，不弹长篇二次确认）
function handleClaim() {
  if (!task.value) return
  const id = task.value.id
  void run(
    () => taskStore.claimTask(id),
    res => showToast(res.message)
  )
}

// 学生开始任务
function handleStart() {
  if (!task.value) return
  const id = task.value.id
  void run(() => taskStore.startTask(id), undefined, msg('任务已开始'))
}

// 学生取消接单（极短确认）
async function handleCancelClaim() {
  if (!task.value || busy.value) return
  const id = task.value.id
  try {
    await showConfirmDialog({
      title: member.value?.status === 'applied' ? msg('撤回申请？') : msg('取消接单？'),
      message:
        member.value?.status === 'applied'
          ? msg('撤回后将不再等待老师确认。')
          : msg('取消后名额将重新开放给其他同学。'),
      confirmButtonText: msg('确认取消'),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  await run(() => taskStore.cancelClaim(id), undefined, msg('已撤回'))
}

// 教师端待验收学生列表
const reviewMembers = computed(() => task.value?.members.filter(m => m.status === 'review' && m.proof) ?? [])

// 教师端验收反馈草稿
const reviewFeedbacks = ref<Record<string, string>>({})
const reviewMinutes = ref<Record<string, number | ''>>({})

// 教师端：只用退回 / 通过，完成后只提示已退回或已通过
function handleTeacherApprove(userId: string) {
  if (!task.value) return
  const fb = reviewFeedbacks.value[userId] ?? ''
  const minutes = reviewMinutes.value[userId]
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) {
    showToast(msg('分钟数必须为非负整数'))
    return
  }
  const id = task.value.id
  const target = task.value.members.find(item => item.userId === userId)
  if (target)
    void run(
      () => taskStore.reviewSubmission(id, userId, true, fb, target.version, minutes),
      () => {
        delete reviewFeedbacks.value[userId]
      },
      msg('已通过')
    )
}

function handleTeacherReject(userId: string) {
  if (!task.value) return
  const fb = (reviewFeedbacks.value[userId] ?? '').trim()
  if (!fb) {
    showToast(msg('请填写退回修改意见'))
    return
  }
  const id = task.value.id
  const target = task.value.members.find(item => item.userId === userId)
  if (target)
    void run(
      () => taskStore.reviewSubmission(id, userId, false, fb, target.version),
      () => {
        delete reviewFeedbacks.value[userId]
      },
      msg('已退回')
    )
}

function approveApplication(userId: string, version: number) {
  const id = task.value?.id
  if (id) void run(() => taskStore.approveApplication(id, userId, version), undefined, msg('已通过申请'))
}
</script>

<template>
  <div>
    <div v-if="task && (user.role === 'teacher' || member)" class="workflow-entry">
      <van-button type="primary" block @click="router.push(`/tasks/${task.id}/workflow`)">{{
        user.role === 'teacher' ? msg('名单与结项') : msg('材料与版本')
      }}</van-button>
    </div>
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <div v-if="task && canView" class="task-detail-container">
      <!-- 头部信息 -->
      <section class="detail-main-header">
        <p v-if="task.workflowStatus === 'closed'">
          <strong>{{ msg('已结项') }}</strong>
        </p>
        <div class="detail-tags-row">
          <div style="display: flex; align-items: center; gap: 8px">
            <span class="card-category-pill">{{ task.category }}</span>
            <StatusTag :status="member ? member.status : task.status" />
          </div>

          <!-- 教师端更多菜单按钮 -->
          <button
            v-if="user.role !== 'student' && task.status !== 'cancelled'"
            class="text-link"
            style="font-size: 14px; font-weight: 600"
            :disabled="busy"
            @click="showTeacherMenu = true"
          >
            {{ msg('更多操作 ▾') }}
          </button>
        </div>

        <h1>{{ task.title }}</h1>
        <p>{{ task.description }}</p>

        <!-- 联系老师入口：只在实际配置了联系方式时显示，绝无硬编码兜底 -->
        <div v-if="configuredContacts.length > 0" class="contact-teacher-box">
          <div class="contact-box-left">
            <strong>{{ msg('发布指导：{p0}', { p0: task.teacherName }) }}</strong>
            <span>{{ task.department }}</span>
          </div>
          <button class="contact-action-btn" @click="showContactSheet = true">
            <van-icon name="chat-o" />{{ msg('联系老师') }}
          </button>
        </div>
      </section>

      <!-- 教师端突出展示：待验收审核板块 -->
      <section
        v-if="user.role === 'teacher' && reviewMembers.length > 0"
        class="detail-card-section"
        style="border-left: 4px solid var(--review)"
      >
        <div class="detail-section-title" style="display: flex; align-items: center; justify-content: space-between">
          <span style="color: var(--review)">{{ msg('待验收凭证 ({p0} 人)', { p0: reviewMembers.length }) }}</span>
        </div>

        <div
          v-for="m in reviewMembers"
          :key="m.userId"
          style="padding: 12px 0; border-bottom: 1px solid var(--line-light)"
        >
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
            <strong>{{ m.name }} · {{ m.account }}</strong>
            <span style="font-size: 14px; color: var(--muted)">{{ m.className }}</span>
          </div>

          <div class="review-proof-text">
            <div style="font-weight: 600; margin-bottom: 2px">{{ msg('完成说明：') }}</div>
            <div>{{ m.proof?.description }}</div>
            <div v-if="m.proof?.note" style="margin-top: 4px; color: var(--muted)">
              {{ msg('备注：{p0}', { p0: m.proof.note }) }}
            </div>
            <div style="margin-top: 4px; font-size: 14px; color: var(--subtle)">
              {{ msg('提交时间：{p0}', { p0: m.proof?.submittedAt }) }}
            </div>
          </div>

          <!-- 凭证图片预览 -->
          <div v-if="m.proof?.images?.length" class="review-images-row">
            <img
              v-for="(img, idx) in m.proof.images"
              :key="idx"
              :src="img"
              :alt="msg('凭证 {p0}', { p0: idx + 1 })"
              @click="viewProofImages(m.proof!.images, idx)"
            />
          </div>

          <!-- 验收意见输入 -->
          <van-field
            v-model="reviewFeedbacks[m.userId]"
            type="textarea"
            :placeholder="msg('修改意见（退回必填）')"
            rows="2"
            autosize
            style="
              border: 1px solid var(--line);
              border-radius: 6px;
              padding: 8px 10px;
              font-size: 14px;
              margin-bottom: 10px;
            "
          />

          <!-- 教师端验收底部：只用退回 / 通过 -->
          <label class="workflow-field"
            ><span>{{ msg('负责人确认分钟数') }} *</span
            ><input v-model.number="reviewMinutes[m.userId]" type="number" min="0" step="1" :disabled="busy"
          /></label>
          <div class="review-bottom-actions">
            <van-button
              plain
              type="danger"
              :loading="busy"
              :disabled="busy || task.status === 'cancelled'"
              @click="handleTeacherReject(m.userId)"
              >{{ msg('退回') }}</van-button
            >
            <van-button
              type="primary"
              :loading="busy"
              :disabled="busy || task.status === 'cancelled'"
              @click="handleTeacherApprove(m.userId)"
              >{{ msg('通过') }}</van-button
            >
          </div>
        </div>
      </section>

      <!-- 任务核心信息 -->
      <section class="detail-card-section">
        <h2 class="detail-section-title">{{ msg('任务详情') }}</h2>
        <div class="detail-data-list">
          <div class="detail-data-item">
            <van-icon name="clock-o" />
            <span class="label">{{ msg('任务时间') }}</span>
            <span class="value">{{ fullTaskTime(task) }}</span>
          </div>
          <div class="detail-data-item">
            <van-icon name="location-o" />
            <span class="label">{{ msg('校内地点') }}</span>
            <span class="value">{{ task.place }}</span>
          </div>
          <div class="detail-data-item">
            <van-icon name="underway-o" />
            <span class="label">{{ msg('预计耗时') }}</span>
            <span class="value">{{ task.duration }}</span>
          </div>
          <div class="detail-data-item">
            <van-icon name="friends-o" />
            <span class="label">{{ msg('招募人数') }}</span>
            <span class="value">{{
              msg('需 {p0} 人（已接 {p1} 人，剩余 {p2} 人）', { p0: task.capacity, p1: occupied, p2: remaining })
            }}</span>
          </div>
          <div class="detail-data-item">
            <van-icon name="cluster-o" />
            <span class="label">{{ msg('面向范围') }}</span>
            <span class="value">{{ audienceLabel(task) }}</span>
          </div>
          <div class="detail-data-item">
            <van-icon name="notes-o" />
            <span class="label">{{ msg('接单截止') }}</span>
            <span class="value">{{ task.signupDeadline }}</span>
          </div>
        </div>
      </section>

      <!-- 工作清单 -->
      <section class="detail-card-section">
        <h2 class="detail-section-title">{{ msg('工作清单与要求') }}</h2>
        <ul class="detail-checklist">
          <li v-for="(item, idx) in task.checklist" :key="idx">
            <span class="checklist-number">{{ idx + 1 }}</span>
            <span>{{ item }}</span>
          </li>
          <li v-if="task.checklist.length === 0">
            <span class="checklist-number">1</span>
            <span>{{ msg('未填写工作清单') }}</span>
          </li>
        </ul>

        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-light)">
          <div style="font-size: 14px; color: var(--muted); margin-bottom: 6px">{{ msg('条件要求与凭证：') }}</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px">
            <span v-for="r in task.requirements" :key="r" class="card-category-pill">{{ r }}</span>
            <span
              v-for="p in task.proofTypes"
              :key="p"
              class="card-category-pill"
              style="background: var(--brand-soft); color: var(--brand)"
              >{{ msg('需要{p0}', { p0: proofTypeLabels[p] }) }}
            </span>
          </div>
        </div>
      </section>

      <!-- 学生端：我的履约进度 -->
      <section v-if="user.role === 'student' && member" class="detail-card-section">
        <h2 class="detail-section-title">{{ msg('我的协作进度') }}</h2>
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px">
          <div style="display: flex; justify-content: space-between; color: #475569">
            <span>{{ msg('接取时间') }}</span>
            <span>{{ member.claimedAt }}</span>
          </div>
          <div v-if="member.startedAt" style="display: flex; justify-content: space-between; color: #475569">
            <span>{{ msg('开始执行') }}</span>
            <span>{{ member.startedAt }}</span>
          </div>
          <div v-if="member.proof" style="display: flex; justify-content: space-between; color: #475569">
            <span>{{ msg('提交凭证') }}</span>
            <span>{{ member.proof.submittedAt }}</span>
          </div>
          <div
            v-if="member.feedback"
            style="padding: 8px 10px; background: #fff1f2; color: #e11d48; border-radius: 6px; margin-top: 4px"
          >
            {{ msg('老师反馈：{p0}', { p0: member.feedback }) }}
          </div>
        </div>
      </section>

      <!-- 教师端：所有接单学生列表 -->
      <section v-if="user.role === 'teacher'" class="detail-card-section">
        <h2 class="detail-section-title">
          {{ msg('参与学生（已录取 {p0}/{p1}）', { p0: task.occupiedCount, p1: task.capacity }) }}
        </h2>
        <div v-if="task.members.length > 0" style="display: flex; flex-direction: column; gap: 8px">
          <div
            v-for="m in task.members"
            :key="m.userId"
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px solid var(--line-light);
            "
          >
            <div>
              <strong style="font-size: 14px">{{ m.name }}</strong>
              <span style="font-size: 14px; color: var(--muted); margin-left: 6px">{{ m.className }}</span>
            </div>
            <StatusTag :status="m.status" />
            <van-button
              v-if="m.status === 'applied' && task.status !== 'cancelled'"
              size="small"
              type="primary"
              :loading="busy"
              :disabled="busy || task.remainingSeats <= 0"
              @click="approveApplication(m.userId, m.version)"
              >{{ msg('通过申请') }}</van-button
            >
          </div>
        </div>
        <div v-else style="padding: 16px 0; text-align: center; color: var(--muted); font-size: 14px">
          {{ msg('暂无学生接单') }}
        </div>
      </section>

      <!-- 学生底部固定主操作栏 -->
      <footer v-if="user.role === 'student'" class="fixed-bottom-bar">
        <!-- 未接单 -->
        <template v-if="!member">
          <van-button v-if="task.canClaim" type="primary" block :loading="busy" :disabled="busy" @click="handleClaim">
            {{ task.claimMode === 'application' ? msg('申请接取任务') : msg('立即接取任务') }}
          </van-button>
          <van-button v-else-if="task.status === 'recruiting' && remaining <= 0" disabled block>{{
            msg('名额已满')
          }}</van-button>
          <van-button v-else disabled block>
            {{ task.status === 'cancelled' ? msg('任务已撤销') : msg('当前不可接取') }}
          </van-button>
        </template>

        <!-- 已接单状态分支 -->
        <template v-else-if="task.status === 'cancelled'">
          <van-button disabled block>{{ msg('任务已撤销') }}</van-button>
        </template>
        <template v-else-if="member.status === 'applied'">
          <van-button :loading="busy" :disabled="busy" block @click="handleCancelClaim">{{
            msg('撤回申请')
          }}</van-button>
        </template>
        <template v-else-if="member.status === 'upcoming'">
          <van-button plain :loading="busy" :disabled="busy" style="flex: 0 0 100px" @click="handleCancelClaim">{{
            msg('取消接单')
          }}</van-button>
          <van-button type="primary" :loading="busy" :disabled="busy" style="flex: 1" @click="handleStart">{{
            msg('开始任务')
          }}</van-button>
        </template>

        <template v-else-if="member.status === 'in_progress'">
          <van-button type="primary" block @click="router.push(`/student/tasks/${task.id}/submit`)">{{
            msg('提交完成凭证')
          }}</van-button>
        </template>

        <template v-else-if="member.status === 'changes_requested'">
          <van-button type="danger" block @click="router.push(`/student/tasks/${task.id}/submit`)">{{
            msg('按意见修改并重新提交')
          }}</van-button>
        </template>

        <template v-else-if="member.status === 'review'">
          <van-button disabled block>{{ msg('已提交，等待老师验收') }}</van-button>
        </template>

        <template v-else-if="member.status === 'completed'">
          <van-button disabled block icon="passed">{{ msg('该任务已完成') }}</van-button>
        </template>
      </footer>

      <!-- 教师端顶部“更多操作”ActionSheet -->
      <van-action-sheet
        v-model:show="showTeacherMenu"
        :actions="teacherMenuActions"
        :cancel-text="msg('取消')"
        close-on-click-action
        @select="onTeacherMenuSelect"
      />

      <!-- 联系老师简洁底部抽屉 -->
      <van-popup v-model:show="showContactSheet" position="bottom" round safe-area-inset-bottom>
        <div class="contact-sheet-list">
          <h3 class="contact-sheet-title">{{ msg('联系指导老师 · {p0}', { p0: task.teacherName }) }}</h3>
          <div v-for="(c, idx) in configuredContacts" :key="idx" class="contact-sheet-item">
            <div class="contact-info-col">
              <strong>{{ c.label }}</strong>
              <span>{{ c.value }}</span>
            </div>
            <van-button class="contact-operate-btn" type="primary" plain @click="handleContactAction(c)">
              {{ contactTypeMeta[c.type]?.action || msg('操作') }}
            </van-button>
          </div>
        </div>
      </van-popup>

      <!-- 教师端编辑任务弹窗 -->
      <van-popup
        :close-on-click-overlay="!busy"
        v-model:show="showEditModal"
        position="bottom"
        round
        safe-area-inset-bottom
        :style="{ maxHeight: '80%' }"
      >
        <div style="padding: 18px 20px 24px">
          <h3 style="margin: 0 0 16px; font-size: 17px; font-weight: 700">{{ msg('编辑任务信息') }}</h3>
          <p v-if="saveError" role="alert">
            {{ saveError }}
            <van-button size="small" :disabled="busy" @click="refreshEditVersion">{{
              msg('刷新并保留草稿')
            }}</van-button>
          </p>
          <van-field
            v-model="editForm.place"
            :disabled="busy"
            :label="msg('具体地点')"
            :placeholder="msg('例如：实训楼 B302（不含校区）')"
            required
          />
          <van-field
            :disabled="busy"
            v-model="editForm.duration"
            :label="msg('预计耗时')"
            :placeholder="msg('例如：约 2 小时')"
            required
          />
          <van-field
            v-model="editForm.description"
            :disabled="busy"
            :label="msg('任务说明')"
            type="textarea"
            :placeholder="msg('说明任务内容')"
            rows="3"
            autosize
            required
          />
          <div style="display: flex; gap: 10px; margin-top: 20px">
            <van-button :disabled="busy" block @click="showEditModal = false">{{ msg('取消') }}</van-button>
            <van-button type="primary" :loading="busy" :disabled="busy" block @click="saveEdit">{{
              msg('保存更新')
            }}</van-button>
          </div>
        </div>
      </van-popup>
    </div>

    <div v-else-if="ready && !error" class="campus-empty surface-card" style="margin: 24px 16px">
      <van-icon name="warning-o" />
      <h4>{{ msg('无法查看该任务') }}</h4>
      <p>{{ msg('任务可能已不存在或未面向你所在的院系班级开放。') }}</p>
    </div>
  </div>
</template>
