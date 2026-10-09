<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useMutation } from '@/mobile/api/ui'
import type { CampusTask, CampusUser, MemberStatus, TaskStatus } from '@/mobile/types'
import {
  fullTaskTime,
  getOccupiedCount,
  getRemainingSeats,
  hasOpenSeat,
  memberOf
} from '@/mobile/utils/task'
import { useTaskStore } from '@/mobile/stores/tasks'
import StatusTag from '@/mobile/components/StatusTag.vue'

const props = withDefaults(
  defineProps<{
    task: CampusTask
    user?: CampusUser
    teacherView?: boolean
    compact?: boolean
  }>(),
  { teacherView: false, compact: true }
)

const emit = defineEmits<{ open: [id: string] }>()
const router = useRouter()
const taskStore = useTaskStore()
const { busy, run } = useMutation()

const member = computed(() => (props.user ? memberOf(props.task, props.user.id) : undefined))
const occupied = computed(() => getOccupiedCount(props.task))
const remaining = computed(() => getRemainingSeats(props.task))

// 计算真实状态：如果是成员则看成员状态，否则看任务真实状态
const currentStatus = computed<TaskStatus | MemberStatus>(() => {
  if (props.task.status === 'cancelled') return 'cancelled'
  if (member.value) return member.value.status
  return props.task.status
})

// 教师端待验收人数
const pendingReviewCount = computed(
  () => props.task.members.filter((m) => m.status === 'review').length
)

// 主操作按钮配置
interface ActionConfig {
  text: string
  type: 'primary' | 'success' | 'warning' | 'danger' | 'default'
  disabled: boolean
  onClick: () => void
}

const primaryAction = computed<ActionConfig>(() => {
  // 教师视图
  if (props.teacherView || props.user?.role === 'teacher') {
    if (pendingReviewCount.value > 0) {
      return {
        text: msg("去验收 ({p0})", { p0: pendingReviewCount.value }),
        type: 'warning',
        disabled: false,
        onClick: () => router.push(`/teacher/review?task=${props.task.id}`)
      }
    }
    return {
      text: msg("查看详情"),
      type: 'default',
      disabled: false,
      onClick: () => emit('open', props.task.id)
    }
  }

  if (props.task.workflowStatus === 'closed') return { text: msg('已结项'), type: 'default', disabled: true, onClick: () => {} }
  if (props.task.status === 'cancelled') return { text: msg("已撤销"), type: 'default', disabled: true, onClick: () => {} }

  // 学生视图：已接单
  if (member.value) {
    if (member.value.status === 'upcoming') {
      return {
        text: msg("开始任务"),
        type: 'primary',
        disabled: false,
        onClick: () => {
          if (!props.user) return
          void run(() => taskStore.startTask(props.task.id), (res) => showToast(res.message))
        }
      }
    }
    if (member.value.status === 'in_progress') {
      return {
        text: msg("提交凭证"),
        type: 'primary',
        disabled: false,
        onClick: () => router.push(`/student/tasks/${props.task.id}/submit`)
      }
    }
    if (member.value.status === 'changes_requested') {
      return {
        text: msg("重新提交"),
        type: 'danger',
        disabled: false,
        onClick: () => router.push(`/student/tasks/${props.task.id}/submit`)
      }
    }
    if (member.value.status === 'review') {
      return {
        text: msg("待老师验收"),
        type: 'default',
        disabled: true,
        onClick: () => {}
      }
    }
    if (member.value.status === 'completed') {
      return {
        text: msg("已完成"),
        type: 'default',
        disabled: true,
        onClick: () => {}
      }
    }
    if (member.value.status === 'applied') {
      return {
        text: msg("待审核"),
        type: 'default',
        disabled: true,
        onClick: () => {}
      }
    }
  }

  // 学生视图：未接单，只有“招募中”且有名额可接取
  if (props.task.canClaim || props.task.remainingSeats <= 0) {
    if (props.task.canClaim) {
      return {
        text: props.task.claimMode === 'application' ? msg("申请接取") : msg("立即接取"),
        type: 'primary',
        disabled: false,
        onClick: () => {
          if (!props.user) return
          void run(() => taskStore.claimTask(props.task.id), (res) => showToast(res.message))
        }
      }
    }
    return {
      text: msg("名额已满"),
      type: 'default',
      disabled: true,
      onClick: () => {}
    }
  }

  return {
    text: msg("已截止"),
    type: 'default',
    disabled: true,
    onClick: () => {}
  }
})

function handleCardClick() {
  emit('open', props.task.id)
}
</script>

<template>
  <article
    class="campus-task-card"
    role="button"
    tabindex="0"
    @click="handleCardClick"
    @keydown.enter.self.prevent="handleCardClick"
    @keydown.space.self.prevent="handleCardClick"
  >
    <div class="card-top-row">
      <span class="card-category-pill">{{ task.category }}</span>
      <StatusTag :status="currentStatus" />
      <span v-if="task.workflowStatus === 'closed'" class="unified-status-tag">{{ msg('已结项') }}</span>
    </div>

    <h3 class="card-title">{{ task.title }}</h3>

    <p v-if="!compact && task.description" class="card-desc">
      {{ task.description }}
    </p>

    <!-- 关键元数据清晰呈现 -->
    <div class="card-meta-list">
      <div class="meta-row">
        <van-icon name="clock-o" />
        <span>{{ fullTaskTime(task) }}</span>
      </div>
      <div class="meta-row">
        <van-icon name="location-o" />
        <span>{{ task.place }}</span>
      </div>
      <div class="meta-row">
        <van-icon name="manager-o" />
        <span>{{ task.teacherName }} · {{ task.department }}</span>
      </div>
      <div class="meta-row">
        <van-icon name="underway-o" />
        <span>{{ msg("预计耗时：{p0}", { p0: task.duration }) }}</span>
      </div>
    </div>

    <!-- 底部：名额与一个主操作 -->
    <footer class="card-bottom-row">
      <div class="quota-group">
        <span>{{ msg("剩余名额") }}</span>
        <strong class="quota-highlight" :class="{ 'is-full': remaining <= 0 }">
          {{ remaining > 0 ? msg("{p0} 人", { p0: remaining }) : msg("已满") }}
        </strong>
        <span>{{ msg("/ 共 {p0} 人", { p0: task.capacity }) }}</span>
      </div>

      <div class="card-action-wrap" @click.stop>
        <van-button
          class="card-action-btn"
          :type="primaryAction.type"
          :disabled="primaryAction.disabled || busy"
          :loading="busy"
          @click="primaryAction.onClick"
        >
          {{ primaryAction.text }}
        </van-button>
      </div>
    </footer>
  </article>
</template>
