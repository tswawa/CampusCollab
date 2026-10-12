<script setup lang="ts">
import { msg, formatNumber } from '@/mobile/i18n'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import StatusTag from '@/mobile/components/StatusTag.vue'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useLoad } from '@/mobile/api/ui'
import { formatDate } from '@/mobile/utils/date'
import LoadState from '@/mobile/components/LoadState.vue'

const router = useRouter()
const taskStore = useTaskStore()
const { loading, error, ready, reload } = useLoad(signal => taskStore.fetchDashboard(signal))
const stats = computed(() => taskStore.dashboard?.stats ?? {})
const metrics = computed(() => [
  {
    label: msg('待审核账号'),
    value: stats.value.pendingAccounts ?? 0,
    icon: 'todo-list-o',
    tone: 'orange',
    destination: '/admin/accounts',
    query: { approval: 'pending' }
  },
  {
    label: msg('待审核材料'),
    value: stats.value.pendingProofs ?? 0,
    icon: 'certificate',
    tone: 'purple',
    destination: '/admin/tasks',
    query: { status: 'review' }
  },
  {
    label: msg('任务'),
    value: stats.value.tasks ?? 0,
    icon: 'orders-o',
    tone: 'green',
    destination: '/admin/tasks',
    query: {}
  },
  {
    label: msg('平台账号'),
    value: stats.value.users ?? 0,
    icon: 'friends-o',
    tone: 'blue',
    destination: '/admin/accounts',
    query: {}
  }
])
const pendingTeachers = computed(() => taskStore.dashboard?.pendingTeachers ?? [])
const recentTasks = computed(() => taskStore.dashboard?.recentTasks ?? [])
</script>

<template>
  <div class="admin-module-page admin-overview-page">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <template v-if="ready && !error">
      <section v-if="stats.tasks === 0" class="admin-table-card" style="margin-bottom: 20px">
        <div class="admin-card-heading">
          <h2>{{ msg('开始使用') }}</h2>
        </div>
        <ol style="margin: 0; padding: 0 20px 16px 40px">
          <li>
            <RouterLink to="/admin/organization" class="admin-inline-link">{{
              msg('检查组织架构：预置的学院、年级和班级是示例数据，请改成本校的实际数据')
            }}</RouterLink>
          </li>
          <li>
            <RouterLink to="/admin/settings" class="admin-inline-link">{{ msg('设置注册方式与机构信息') }}</RouterLink>
          </li>
          <li>
            <RouterLink to="/admin/accounts" class="admin-inline-link">{{
              msg('邀请教师注册，或在账号管理中创建账号')
            }}</RouterLink>
          </li>
        </ol>
      </section>
      <section class="admin-dashboard-stat-grid" :aria-label="msg('系统概览')">
        <button
          v-for="metric in metrics"
          :key="metric.label"
          type="button"
          class="admin-dashboard-stat"
          @click="router.push({ path: metric.destination, query: metric.query })"
        >
          <div>
            <span>{{ metric.label }}</span
            ><strong>{{ formatNumber(metric.value) }}</strong>
          </div>
          <span class="admin-dashboard-icon" :class="'is-' + metric.tone"
            ><van-icon :name="metric.icon" aria-hidden="true" /></span
          ><van-icon name="arrow" class="admin-metric-arrow" aria-hidden="true" />
        </button>
      </section>
      <section class="admin-dashboard-columns">
        <div class="admin-dashboard-primary">
          <section class="admin-table-card admin-dashboard-panel">
            <div class="admin-card-heading admin-card-heading-row">
              <h2>{{ msg('最近任务') }}</h2>
              <button type="button" class="admin-inline-link" @click="router.push('/admin/tasks')">
                {{ msg('查看全部') }}<van-icon name="arrow" aria-hidden="true" />
              </button>
            </div>
            <div class="admin-overview-task-labels" aria-hidden="true">
              <span>{{ msg('任务') }}</span
              ><span>{{ msg('状态') }}</span>
            </div>
            <button
              v-for="task in recentTasks"
              :key="task.id"
              type="button"
              class="admin-dashboard-task"
              @click="router.push('/tasks/' + task.id + '/workflow')"
            >
              <div class="admin-task-symbol" aria-hidden="true"><van-icon name="orders-o" /></div>
              <div class="admin-row-main">
                <strong>{{ task.title }}</strong
                ><span>{{ task.teacherName }} · {{ formatDate(task.date) }} · {{ task.place }}</span>
              </div>
              <span v-if="task.workflowStatus === 'closed'" class="admin-status-pill is-closed">{{
                msg('已结项')
              }}</span
              ><StatusTag v-else :status="task.status" /><van-icon
                name="arrow"
                class="admin-task-arrow"
                aria-hidden="true"
              />
            </button>
            <div v-if="!recentTasks.length" class="admin-table-empty admin-overview-empty">
              <van-icon name="orders-o" aria-hidden="true" />
              <h3>{{ msg('暂无近期任务') }}</h3>
            </div>
          </section>
        </div>
        <aside class="admin-dashboard-secondary">
          <section class="admin-table-card admin-dashboard-panel">
            <div class="admin-card-heading admin-card-heading-row">
              <h2>{{ msg('待审核负责人') }}</h2>
              <button
                type="button"
                class="admin-inline-link"
                @click="router.push({ path: '/admin/accounts', query: { approval: 'pending', role: 'teacher' } })"
              >
                {{ msg('审核') }}<van-icon name="arrow" aria-hidden="true" />
              </button>
            </div>
            <button
              v-for="teacher in pendingTeachers"
              :key="teacher.id"
              type="button"
              class="admin-dashboard-teacher"
              @click="
                router.push({
                  path: '/admin/accounts',
                  query: { approval: 'pending', role: 'teacher', keyword: teacher.account }
                })
              "
            >
              <span class="admin-list-avatar" aria-hidden="true">{{ Array.from(teacher.name)[0] }}</span
              ><span class="admin-row-main"
                ><strong>{{ teacher.name }}</strong
                ><span>{{ teacher.department }}</span></span
              ><van-icon name="arrow" aria-hidden="true" />
            </button>
            <div v-if="!pendingTeachers.length" class="admin-table-empty compact admin-pending-empty">
              <van-icon name="passed" aria-hidden="true" />
              <p>{{ msg('暂无待审核申请') }}</p>
            </div>
          </section>
        </aside>
      </section>
    </template>
  </div>
</template>
