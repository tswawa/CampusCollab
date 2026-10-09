<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { knownMessage } from '@/mobile/i18n'
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import BottomNav from '@/mobile/components/BottomNav.vue'
import LoadState from '@/mobile/components/LoadState.vue'
import { useSystemStore } from '@/mobile/stores/system'
import { useLoad } from '@/mobile/api/ui'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const tasks = useTaskStore()
const system = useSystemStore()
const { loading: noticeLoading, error: noticeError, reload: reloadNotices } = useLoad(async (signal) => {
  if (route.name !== 'notifications') await tasks.fetchNotices({ page: 1, pageSize: 20 }, signal)
}, [() => route.name])

const immersive = computed(() => Boolean(route.meta.immersive))
const hideNav = computed(() => Boolean(route.meta.hideNav))
const title = computed(() => knownMessage(String(route.meta.title ?? '高校任务协作平台')))
const unread = computed(() => (auth.currentUser ? tasks.unreadCount : 0))
const taskWorkspace = computed(() => route.name === 'task-workflow')
const homePath = computed(() => auth.role === 'admin' ? '/admin/home' : auth.role === 'teacher' ? '/teacher/home' : '/student/home')
const taskListPath = computed(() => auth.role === 'admin' ? '/admin/tasks' : auth.role === 'teacher' ? '/teacher/tasks' : '/student/mine')
const roleLabel = computed(() => auth.role === 'admin' ? msg('管理员') : auth.role === 'teacher' ? msg('负责人') : msg('参与者'))
const userInitial = computed(() => Array.from(auth.currentUser?.name ?? '')[0] || '·')
const workspaceNav = computed(() => [
  { to: homePath.value, label: auth.role === 'admin' ? msg('后台概览') : msg('首页'), icon: 'wap-home-o' },
  { to: taskListPath.value, label: auth.role === 'student' ? msg('我的任务') : msg('任务管理'), icon: 'orders-o' },
  { to: `/tasks/${encodeURIComponent(String(route.params.id))}/workflow`, label: msg('名单工作台'), icon: 'todo-list-o', current: true },
  ...(auth.role === 'teacher' ? [{ to: '/teacher/review', label: msg('验收中心'), icon: 'passed' }] : []),
  ...(auth.role === 'admin' ? [{ to: '/admin/settings', label: msg('系统设置'), icon: 'setting-o' }] : [])
])

function goBack() {
  if (taskWorkspace.value) {
    void router.push(taskListPath.value)
    return
  }
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace(
      auth.role === 'admin'
        ? '/admin/home'
        : auth.role === 'teacher'
          ? '/teacher/home'
          : '/student/home'
    )
  }
}
</script>

<template>
  <div class="mobile-shell" :class="{ 'workflow-shell task-workspace-shell': taskWorkspace }">
    <aside v-if="taskWorkspace" class="task-workspace-sidebar">
      <RouterLink :to="homePath" class="task-workspace-brand">
        <span class="task-workspace-brand-mark" aria-hidden="true"><van-icon name="todo-list-o" size="22" /></span>
        <span class="task-workspace-brand-copy"><strong>{{ msg('高校任务协作平台') }}</strong><span>{{ system.school.name }}</span></span>
      </RouterLink>
      <nav class="task-workspace-nav" :aria-label="msg('工作区导航')">
        <RouterLink v-for="item in workspaceNav" :key="item.to" :to="item.to" :class="{ 'is-current': item.current }" :aria-current="item.current ? 'page' : undefined">
          <van-icon :name="item.icon" size="19" aria-hidden="true" />
          <span>{{ item.label }}</span>
          <span v-if="item.current" class="task-workspace-nav-marker" aria-hidden="true"></span>
        </RouterLink>
      </nav>
      <RouterLink to="/profile" class="task-workspace-sidebar-profile"><van-icon name="user-o" size="18" aria-hidden="true" /><span>{{ msg('个人中心') }}</span><van-icon name="arrow" size="12" aria-hidden="true" /></RouterLink>
    </aside>

    <header v-if="taskWorkspace" class="task-workspace-toolbar">
      <div class="task-workspace-toolbar-context">
        <button type="button" class="task-workspace-icon-button" :aria-label="msg('返回')" @click="goBack"><van-icon name="arrow-left" size="19" aria-hidden="true" /></button>
        <span class="task-workspace-toolbar-divider" aria-hidden="true"></span>
        <span class="task-workspace-toolbar-title">{{ title }}</span>
      </div>
      <div class="task-workspace-toolbar-actions">
        <button type="button" class="task-workspace-icon-button" :aria-label="msg('查看消息')" @click="router.push('/notifications')">
          <van-badge :content="unread || undefined" :max="9"><van-icon name="bell" size="20" aria-hidden="true" /></van-badge>
        </button>
        <RouterLink to="/profile" class="task-workspace-identity" :aria-label="`${auth.currentUser?.name ?? ''} · ${roleLabel}`">
          <span class="task-workspace-avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="task-workspace-identity-copy"><strong>{{ auth.currentUser?.name }}</strong><span>{{ roleLabel }}</span></span>
        </RouterLink>
      </div>
    </header>

    <van-nav-bar
      v-if="!immersive && !taskWorkspace"
      class="app-navbar"
      :title="title"
      :left-arrow="Boolean(route.meta.back)"
      fixed
      placeholder
      safe-area-inset-top
      @click-left="goBack"
    >
      <template #right>
        <button
          class="navbar-action"
          :aria-label="msg('查看消息')"
          @click="router.push('/notifications')"
        >
          <van-badge :content="unread || undefined" :max="9">
            <van-icon name="bell" size="20" />
          </van-badge>
        </button>
      </template>
    </van-nav-bar>

    <main id="main-content" tabindex="-1" :class="['mobile-content', { 'with-tabbar': !hideNav, immersive, 'task-workspace-main': taskWorkspace }]">
      <LoadState v-if="noticeError" :loading="noticeLoading" :error="noticeError" @retry="reloadNotices" />
      <RouterView v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <BottomNav v-if="!hideNav" />
  </div>
</template>
