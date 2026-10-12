<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import CampusHeader from '@/mobile/components/CampusHeader.vue'
import TaskCard from '@/mobile/components/TaskCard.vue'
import { useLoad } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)

const { loading, error, ready, reload } = useLoad(signal => taskStore.fetchDashboard(signal))
const stats = computed(() => taskStore.dashboard?.stats ?? {})
const recentTasks = computed(() => taskStore.dashboard?.recentTasks ?? [])
const tasksWithPendingReview = computed(() =>
  recentTasks.value.filter(task => task.members.some(member => member.status === 'review'))
)
const totalPendingReviewCount = computed(() => stats.value.review ?? 0)
</script>

<template>
  <div class="teacher-home-page">
    <CampusHeader />

    <main class="page-wrap" style="padding-top: 12px">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
        <!-- 快速发布任务入口 -->
        <div
          class="surface-card"
          style="
            padding: 14px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            margin-bottom: 14px;
            background: #ffffff;
            border-left: 4px solid var(--brand);
          "
          @click="router.push('/teacher/create')"
        >
          <div style="display: flex; align-items: center; gap: 10px">
            <div
              style="
                width: 36px;
                height: 36px;
                border-radius: 8px;
                background: var(--brand-soft);
                color: var(--brand);
                display: grid;
                place-items: center;
                font-size: 18px;
              "
            >
              +
            </div>
            <div>
              <strong style="display: block; font-size: 15px; color: var(--text)">{{ msg('发布任务') }}</strong>
            </div>
          </div>
          <van-icon name="arrow" color="#94A3B8" />
        </div>

        <!-- 任务数据统计网格 -->
        <section style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px">
          <div
            class="surface-card"
            style="padding: 10px 4px; text-align: center; cursor: pointer"
            :style="stats.review > 0 ? { borderColor: 'var(--review)', background: '#FAF5FF' } : {}"
            @click="router.push('/teacher/review')"
          >
            <div style="font-size: 19px; font-weight: 700; color: var(--review)">
              {{ stats.review }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('待验收') }}</div>
          </div>

          <div
            class="surface-card"
            style="padding: 10px 4px; text-align: center; cursor: pointer"
            @click="router.push('/teacher/tasks')"
          >
            <div style="font-size: 19px; font-weight: 700; color: var(--recruiting)">
              {{ stats.recruiting }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('招募中') }}</div>
          </div>

          <div
            class="surface-card"
            style="padding: 10px 4px; text-align: center; cursor: pointer"
            @click="router.push('/teacher/tasks')"
          >
            <div style="font-size: 19px; font-weight: 700; color: var(--in-progress)">
              {{ stats.in_progress }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('进行中') }}</div>
          </div>

          <div
            class="surface-card"
            style="padding: 10px 4px; text-align: center; cursor: pointer"
            @click="router.push('/teacher/tasks')"
          >
            <div style="font-size: 19px; font-weight: 700; color: var(--completed)">
              {{ stats.completed }}
            </div>
            <div style="font-size: 14px; color: var(--muted); margin-top: 2px">{{ msg('已完成') }}</div>
          </div>
        </section>

        <!-- 突出待验收模块 -->
        <section v-if="tasksWithPendingReview.length > 0" style="margin-bottom: 20px">
          <div class="section-heading">
            <h2 style="color: var(--review)">{{ msg('待处理完成凭证 ({p0})', { p0: totalPendingReviewCount }) }}</h2>
            <button class="text-link" @click="router.push('/teacher/review')">{{ msg('进入验收中心') }}</button>
          </div>

          <TaskCard
            v-for="t in tasksWithPendingReview"
            :key="t.id"
            :task="t"
            :user="user"
            teacher-view
            @open="id => router.push(`/tasks/${id}`)"
          />
        </section>

        <!-- 发布的任务进度 -->
        <section>
          <div class="section-heading">
            <h2>{{ msg('我发布的任务') }}</h2>
            <button class="text-link" @click="router.push('/teacher/tasks')">{{ msg('查看全部') }}</button>
          </div>

          <TaskCard
            v-for="t in recentTasks"
            :key="t.id"
            :task="t"
            :user="user"
            teacher-view
            @open="id => router.push(`/tasks/${id}`)"
          />

          <div v-if="recentTasks.length === 0" class="campus-empty surface-card">
            <van-icon name="records" />
            <h4>{{ msg('暂未发布任务') }}</h4>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
