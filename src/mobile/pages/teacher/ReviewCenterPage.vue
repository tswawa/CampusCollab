<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useLoad, useMutation, usePagination } from '@/mobile/api/ui'
import { useEvidencePreview } from '@/mobile/composables/useEvidencePreview'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'

const route = useRoute()
const auth = useAuthStore()
const taskStore = useTaskStore()
const viewImages = useEvidencePreview()
const user = computed(() => auth.currentUser!)

const taskIdFilter = computed(() => (typeof route.query.task === 'string' ? route.query.task : ''))

const { page, pageSize } = usePagination([taskIdFilter])
const { loading, error, ready, reload } = useLoad((signal) => taskStore.fetchReviews({ taskId: taskIdFilter.value || undefined, page: page.value, pageSize }, signal), [taskIdFilter, page])
const pendingSubmissions = computed(() => taskStore.reviews.items)
const { busy, run } = useMutation()

const feedbackMap = ref<Record<string, string>>({})
const minutesMap = ref<Record<string, number | ''>>({})

// 教师底部只用退回 / 通过，完成后只提示已退回或已通过
function handleApprove(taskId: string, userId: string) {
  const fb = feedbackMap.value[`${taskId}-${userId}`] ?? ''
  const minutes = minutesMap.value[`${taskId}-${userId}`]
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) { showToast(msg('分钟数必须为非负整数')); return }
  const member = pendingSubmissions.value.find((sub) => sub.task.id === taskId && sub.member.userId === userId)?.member
  if (member) void run(() => taskStore.reviewSubmission(taskId, userId, true, fb, member.version, minutes), () => { delete feedbackMap.value[`${taskId}-${userId}`] }, msg("已通过"))
}

function handleReject(taskId: string, userId: string) {
  const key = `${taskId}-${userId}`
  const fb = (feedbackMap.value[key] ?? '').trim()
  if (!fb) {
    showToast(msg("请填写退回原因或需修改内容"))
    return
  }
  const member = pendingSubmissions.value.find((sub) => sub.task.id === taskId && sub.member.userId === userId)?.member
  if (member) void run(() => taskStore.reviewSubmission(taskId, userId, false, fb, member.version), () => { delete feedbackMap.value[key] }, msg("已退回"))
}
</script>

<template>
  <div class="review-center-page">
    <main class="page-wrap">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
      <div v-if="pendingSubmissions.length > 0" style="margin-bottom: 12px; color: var(--muted); font-size: 14px">{{ msg("共 {p0} 份待验收凭证", { p0: taskStore.reviews.total }) }}</div>

      <article
        v-for="sub in pendingSubmissions"
        :key="`${sub.task.id}-${sub.member.userId}`"
        class="review-item-card"
      >
        <div class="review-item-header">
          <div>
            <h3>{{ sub.task.title }}</h3>
            <p>{{ sub.member.name }} · {{ sub.member.account }} · {{ sub.member.className }}</p>
          </div>
          <span class="unified-status-tag" style="color: var(--review); background: #EDE9FE">
            <span class="status-indicator-dot" style="background: var(--review)" />{{ msg("待验收") }}</span>
        </div>

        <div class="review-proof-text">
          <div style="font-weight: 600; margin-bottom: 2px">{{ msg("完成情况说明：") }}</div>
          <div>{{ sub.proof.description }}</div>
          <div v-if="sub.proof.note" style="margin-top: 4px; color: var(--muted)">{{ msg("备注：{p0}", { p0: sub.proof.note }) }}
          </div>
          <div style="margin-top: 4px; font-size: 14px; color: var(--muted)">{{ msg("提交时间：{p0}", { p0: sub.proof.submittedAt }) }}
          </div>
        </div>

        <!-- 凭证图片预览 -->
        <div v-if="sub.proof.images?.length" class="review-images-row">
          <img
            v-for="(img, idx) in sub.proof.images"
            :key="idx"
            :src="img"
            :alt="msg('凭证照片 {p0}', { p0: idx + 1 })"
            @click="viewImages(sub.proof.images, idx)"
          />
        </div>

        <!-- 审核反馈输入 -->
        <label class="workflow-field"><span>{{ msg('负责人确认分钟数') }} *</span><input v-model.number="minutesMap[`${sub.task.id}-${sub.member.userId}`]" type="number" min="0" step="1" :disabled="busy" /></label>
        <van-field
          v-model="feedbackMap[`${sub.task.id}-${sub.member.userId}`]"
          type="textarea"
          :placeholder="msg('退回时必填具体修改意见；通过时可选填')"
          rows="2"
          autosize
          style="border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font-size: 14px"
        />

        <!-- 仅退回 / 通过，完成后只提示已退回或已通过 -->
        <div class="review-card-actions">
          <van-button
            :disabled="busy"
            :loading="busy"
            plain
            type="danger"
            @click="handleReject(sub.task.id, sub.member.userId)"
          >{{ msg("退回") }}</van-button>
          <van-button
            :disabled="busy"
            :loading="busy"
            type="primary"
            @click="handleApprove(sub.task.id, sub.member.userId)"
          >{{ msg("通过") }}</van-button>
        </div>
      </article>

      <div v-if="pendingSubmissions.length === 0" class="campus-empty surface-card">
        <van-icon name="passed" color="#059669" />
        <h4>{{ msg("暂无待验收凭证") }}</h4>
      </div>
      <PaginationBar v-model:page="page" :page-size="pageSize" :total="taskStore.reviews.total" :loading="loading || busy" />
      </template>
    </main>
  </div>
</template>
