<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useLoad, usePagination } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'
import TaskCard from '@/mobile/components/TaskCard.vue'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)

const activeTab = ref('all')
const tabs = computed(() => [
  { name: msg('全部'), value: 'all' },
  { name: msg('进行中'), value: 'in_progress' },
  { name: msg('待确认'), value: 'applied' },
  { name: msg('待开始'), value: 'upcoming' },
  { name: msg('待验收'), value: 'review' },
  { name: msg('需修改'), value: 'changes_requested' },
  { name: msg('已完成'), value: 'completed' },
  { name: msg('已撤销'), value: 'cancelled' }
])
const { page, pageSize } = usePagination([activeTab])
const { loading, error, ready, reload } = useLoad(
  signal =>
    taskStore.fetchTasks(
      { mine: true, status: activeTab.value === 'all' ? undefined : activeTab.value, page: page.value, pageSize },
      signal
    ),
  [activeTab, page]
)
const myTasks = computed(() => taskStore.tasks)
</script>

<template>
  <div class="my-tasks-page">
    <van-tabs v-model:active="activeTab" color="var(--brand)" line-width="28px" shrink swipeable>
      <van-tab v-for="tab in tabs" :key="tab.value" :title="tab.name" :name="tab.value" />
    </van-tabs>

    <main class="page-wrap" style="padding-top: 12px">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
        <TaskCard
          v-for="task in myTasks"
          :key="task.id"
          :task="task"
          :user="user"
          @open="id => router.push(`/tasks/${id}`)"
        />

        <div v-if="myTasks.length === 0" class="campus-empty surface-card">
          <van-icon name="todo-list-o" />
          <h4>
            {{ msg('暂无{p0}任务', { p0: activeTab === 'all' ? '' : tabs.find(t => t.value === activeTab)?.name }) }}
          </h4>
          <van-button
            type="primary"
            size="small"
            style="margin-top: 14px; border-radius: 6px"
            @click="router.push('/student/tasks')"
            >{{ msg('浏览任务大厅') }}</van-button
          >
        </div>
        <PaginationBar v-model:page="page" :page-size="pageSize" :total="taskStore.taskPage.total" :loading="loading" />
      </template>
    </main>
  </div>
</template>
