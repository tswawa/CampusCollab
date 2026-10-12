<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import TaskCard from '@/mobile/components/TaskCard.vue'
import { useLoad, usePagination } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)

const keyword = ref('')
const activeTab = ref('all')

const tabs = computed(() => [
  { name: msg('全部'), value: 'all' },
  { name: msg('待验收'), value: 'review' },
  { name: msg('招募中'), value: 'recruiting' },
  { name: msg('进行中'), value: 'in_progress' },
  { name: msg('已完成'), value: 'completed' }
])

const { page, pageSize } = usePagination([keyword, activeTab])
const { loading, error, ready, reload } = useLoad(
  signal =>
    taskStore.fetchTasks(
      {
        mine: true,
        keyword: keyword.value.trim(),
        status: activeTab.value === 'all' ? undefined : activeTab.value,
        page: page.value,
        pageSize
      },
      signal
    ),
  [keyword, activeTab, page]
)
const filteredTasks = computed(() => taskStore.tasks)
</script>

<template>
  <div class="teacher-tasks-page">
    <!-- 顶部搜索与发任务 -->
    <section class="hall-search-header">
      <van-search v-model="keyword" :placeholder="msg('搜索已发布的任务或地点')" clearable />

      <van-tabs v-model:active="activeTab" color="var(--brand)" line-width="28px" shrink swipeable>
        <van-tab v-for="tab in tabs" :key="tab.value" :title="tab.name" :name="tab.value" />
      </van-tabs>
    </section>

    <main class="page-wrap" style="padding-top: 12px">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px">
          <span style="font-size: 14px; color: var(--muted)">{{
            msg('共 {p0} 个任务', { p0: taskStore.taskPage.total })
          }}</span>
          <van-button
            type="primary"
            size="small"
            icon="plus"
            style="border-radius: 6px; height: 36px; padding: 0 12px; font-weight: 600"
            @click="router.push('/teacher/create')"
            >{{ msg('发布任务') }}</van-button
          >
        </div>

        <TaskCard
          v-for="task in filteredTasks"
          :key="task.id"
          :task="task"
          :user="user"
          teacher-view
          @open="id => router.push(`/tasks/${id}`)"
        />

        <div v-if="filteredTasks.length === 0" class="campus-empty surface-card">
          <van-icon name="records" />
          <h4>{{ msg('暂无对应状态的任务') }}</h4>
        </div>
        <PaginationBar v-model:page="page" :page-size="pageSize" :total="taskStore.taskPage.total" :loading="loading" />
      </template>
    </main>
  </div>
</template>
