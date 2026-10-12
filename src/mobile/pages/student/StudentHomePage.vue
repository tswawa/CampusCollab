<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useLoad } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import CampusHeader from '@/mobile/components/CampusHeader.vue'
import TaskCard from '@/mobile/components/TaskCard.vue'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)

const { loading, error, ready, reload } = useLoad(signal => taskStore.fetchDashboard(signal))
const stats = computed(() => taskStore.dashboard?.stats ?? {})
const currentActiveTask = computed(() =>
  taskStore.dashboard?.activeTask ? { task: taskStore.dashboard.activeTask } : undefined
)
const recentTasks = computed(() => taskStore.dashboard?.recentTasks ?? [])
</script>

<template>
  <div class="student-home-page">
    <CampusHeader />

    <main class="page-wrap" style="padding-top: 12px">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
        <!-- 搜索入口 -->
        <div
          class="search-entry"
          style="
            min-height: 48px;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 16px;
            border: 1px solid var(--line);
            border-radius: 8px;
            background: #ffffff;
            color: var(--muted);
            cursor: pointer;
            margin-bottom: 14px;
          "
          @click="router.push('/student/tasks')"
        >
          <van-icon name="search" size="18" color="#64748B" />
          <span style="font-size: 14px; color: #64748b">{{ msg('搜索任务、地点或发布老师') }}</span>
        </div>

        <!-- 个人协作概览卡片 -->
        <section style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px">
          <div
            class="surface-card"
            style="padding: 12px 8px; text-align: center; cursor: pointer"
            @click="router.push('/student/mine')"
          >
            <div style="font-size: 20px; font-weight: 700; color: var(--brand)">
              {{ stats.active }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('进行中/待开始') }}</div>
          </div>
          <div
            class="surface-card"
            style="padding: 12px 8px; text-align: center; cursor: pointer"
            @click="router.push('/student/mine')"
          >
            <div style="font-size: 20px; font-weight: 700; color: var(--review)">
              {{ stats.review }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('待老师验收') }}</div>
          </div>
          <div
            class="surface-card"
            style="padding: 12px 8px; text-align: center; cursor: pointer"
            @click="router.push('/student/mine')"
          >
            <div style="font-size: 20px; font-weight: 700; color: var(--completed)">
              {{ stats.completed }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('已完成协作') }}</div>
          </div>
        </section>

        <!-- 当前需要执行的任务提醒 -->
        <section v-if="currentActiveTask" style="margin-bottom: 20px">
          <div class="section-heading">
            <h2>{{ msg('待处理协作') }}</h2>
          </div>
          <div
            class="surface-card"
            style="
              padding: 14px 16px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              cursor: pointer;
              background: #ffffff;
              border-left: 4px solid var(--brand);
            "
            @click="router.push(`/tasks/${currentActiveTask.task.id}`)"
          >
            <div style="min-width: 0; flex: 1">
              <strong style="display: block; font-size: 15px; color: var(--text); margin-bottom: 4px">
                {{ currentActiveTask.task.title }}
              </strong>
              <span style="display: block; font-size: 14px; color: var(--muted)">
                {{ currentActiveTask.task.date }} · {{ currentActiveTask.task.startTime }} ·
                {{ currentActiveTask.task.place }}
              </span>
            </div>
            <van-icon name="arrow" color="#94A3B8" />
          </div>
        </section>

        <!-- 校内协作任务列表 -->
        <section>
          <div class="section-heading">
            <h2>{{ msg('校内协作任务') }}</h2>
            <button class="text-link" @click="router.push('/student/tasks')">
              {{ msg('查看大厅') }}<van-icon name="arrow" size="12" style="margin-left: 2px" />
            </button>
          </div>

          <TaskCard
            v-for="task in recentTasks"
            :key="task.id"
            :task="task"
            :user="user"
            @open="id => router.push(`/tasks/${id}`)"
          />

          <div v-if="recentTasks.length === 0" class="campus-empty surface-card">
            <van-icon name="orders-o" />
            <h4>{{ msg('暂无校内任务') }}</h4>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
