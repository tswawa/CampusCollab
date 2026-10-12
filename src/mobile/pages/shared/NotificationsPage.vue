<script setup lang="ts">
import { locale, msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useLoad, useMutation, usePagination } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'
import { useRouter } from 'vue-router'
import { formatTimestamp } from '@/mobile/utils/date'
import type { AppNotice } from '@/mobile/types'

const auth = useAuthStore()
const router = useRouter()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)
const notices = computed(() => taskStore.notices)
const { page, pageSize } = usePagination()
const { loading, error, ready, reload } = useLoad(
  signal => taskStore.fetchNotices({ page: page.value, pageSize }, signal),
  [page, locale]
)
const { busy, run } = useMutation()
function read(id?: string) {
  void run(() => (id ? taskStore.markNoticeRead(id) : taskStore.markAllNoticesRead()), undefined, msg('已标为已读'))
}
async function openNotice(notice: AppNotice) {
  if (busy.value) return
  if (!notice.read) await run(() => taskStore.markNoticeRead(notice.id))
  if (notice.target?.kind === 'accounts' && auth.role === 'admin') await router.push('/admin/accounts')
  else if (notice.target?.kind === 'task') await router.push(`/tasks/${encodeURIComponent(notice.target.id)}/workflow`)
}
</script>

<template>
  <div class="notifications-page page-wrap">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <template v-if="ready && !error">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px">
        <span style="font-size: 14px; color: var(--muted)">{{
          msg('共 {p0} 条通知 · {p1} 条未读', { p0: taskStore.noticePage.total, p1: taskStore.unreadCount })
        }}</span>
        <button v-if="notices.length > 0" class="text-link" :disabled="busy" @click="read()">
          {{ msg('全部标为已读') }}
        </button>
      </div>

      <div v-if="notices.length > 0" style="display: flex; flex-direction: column; gap: 10px">
        <article
          v-for="notice in notices"
          :key="notice.id"
          class="surface-card"
          style="padding: 14px 16px; cursor: pointer; transition: background 0.12s ease"
          :style="!notice.read ? { borderLeft: '4px solid var(--brand)', background: '#F8FAFC' } : {}"
          :aria-disabled="busy"
          role="button"
          tabindex="0"
          @click="openNotice(notice)"
          @keydown.enter.prevent="openNotice(notice)"
          @keydown.space.prevent="openNotice(notice)"
        >
          <div
            style="
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 10px;
              margin-bottom: 4px;
            "
          >
            <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text)">
              {{ notice.title }}
            </h3>
            <span
              v-if="!notice.read"
              style="width: 8px; height: 8px; border-radius: 50%; background: var(--brand); flex: 0 0 8px"
            />
          </div>
          <p style="margin: 0 0 8px; font-size: 14px; color: #475569; line-height: 1.6">
            {{ notice.content }}
          </p>
          <div style="font-size: 14px; color: var(--subtle)">
            {{ formatTimestamp(notice.createdAt) }}
          </div>
        </article>
      </div>

      <div v-else class="campus-empty surface-card">
        <van-icon name="bell" />
        <h4>{{ msg('暂无通知') }}</h4>
      </div>
      <PaginationBar
        v-model:page="page"
        :page-size="pageSize"
        :total="taskStore.noticePage.total"
        :loading="loading || busy"
      />
    </template>
  </div>
</template>
