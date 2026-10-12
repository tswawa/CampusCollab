<script setup lang="ts">
import { msg, knownMessage } from '@/mobile/i18n'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useSystemStore } from '@/mobile/stores/system'
import { errorMessage, isCancelled } from '@/mobile/api'
import { showToast } from 'vant'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const system = useSystemStore()
const mobileMenuOpen = ref(false)
const sidebar = ref<HTMLElement>()
const navigationMedia = window.matchMedia('(max-width: 1100px)')
const compactNavigation = ref(navigationMedia.matches)
function updateNavigation(event: MediaQueryListEvent) {
  compactNavigation.value = event.matches
  if (!event.matches) mobileMenuOpen.value = false
}
navigationMedia.addEventListener('change', updateNavigation)
onBeforeUnmount(() => navigationMedia.removeEventListener('change', updateNavigation))
const navGroups = computed(() => [
  {
    label: msg('运行管理'),
    items: [
      { label: msg('系统概览'), icon: 'apps-o', to: '/admin/home' },
      { label: msg('账号管理'), icon: 'friends-o', to: '/admin/accounts' },
      { label: msg('任务管理'), icon: 'orders-o', to: '/admin/tasks' }
    ]
  },
  {
    label: msg('机构配置'),
    items: [
      { label: msg('组织架构'), icon: 'cluster-o', to: '/admin/organization' },
      { label: msg('系统设置'), icon: 'setting-o', to: '/admin/settings' }
    ]
  }
])
const pageTitle = computed(() => knownMessage(String(route.meta.title ?? '管理后台')))
const administrator = computed(() => auth.currentUser)
const administratorInitial = computed(() => Array.from(administrator.value?.name ?? '')[0] ?? '·')
const institutionInitial = computed(() => Array.from(system.school.name.trim())[0]?.toLocaleUpperCase() ?? '·')
const logoFailed = ref(false)
watch(
  () => system.school.logo,
  () => {
    logoFailed.value = false
  }
)
let previousFocus: HTMLElement | null = null
watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false
  }
)
watch(mobileMenuOpen, async open => {
  if (open) {
    previousFocus = document.activeElement as HTMLElement
    await nextTick()
    sidebar.value?.querySelector<HTMLButtonElement>('.admin-navigation-close')?.focus()
  } else {
    await nextTick()
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus()
  }
})
function navigationKeys(event: KeyboardEvent) {
  if (!compactNavigation.value || !mobileMenuOpen.value) return
  if (event.key === 'Escape') {
    mobileMenuOpen.value = false
    return
  }
  if (event.key !== 'Tab') return
  const controls = Array.from(
    sidebar.value?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? []
  ).filter(element => element.getClientRects().length)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
const busy = ref(false)
async function logout() {
  if (busy.value) return
  busy.value = true
  try {
    await auth.logout()
    await router.replace('/login')
  } catch (error) {
    if (!isCancelled(error)) showToast(errorMessage(error))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="admin-backoffice-shell admin-console">
    <aside
      id="admin-navigation"
      ref="sidebar"
      class="admin-sidebar"
      :class="{ 'is-open': mobileMenuOpen }"
      :inert="compactNavigation && !mobileMenuOpen"
      :role="compactNavigation && mobileMenuOpen ? 'dialog' : undefined"
      :aria-modal="compactNavigation && mobileMenuOpen ? true : undefined"
      :aria-label="msg('管理员后台导航')"
      @keydown="navigationKeys"
    >
      <div class="admin-brand-block">
        <RouterLink
          to="/admin/home"
          class="admin-brand-link"
          :aria-label="msg('返回管理概览')"
          @click="mobileMenuOpen = false"
          ><img
            v-if="system.school.logo && !logoFailed"
            :src="system.school.logo"
            :alt="system.school.name"
            @error="logoFailed = true"
          /><span v-else class="admin-brand-fallback" aria-hidden="true">{{ institutionInitial }}</span
          ><span class="admin-brand-copy"
            ><strong>{{ system.school.name }}</strong></span
          ></RouterLink
        >
        <button
          type="button"
          class="admin-navigation-close"
          :aria-label="msg('关闭后台导航')"
          @click="mobileMenuOpen = false"
        >
          <van-icon name="cross" aria-hidden="true" />
        </button>
      </div>
      <nav class="admin-sidebar-nav" :aria-label="msg('管理员后台导航')">
        <div v-for="group in navGroups" :key="group.label" class="admin-navigation-group">
          <p>{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="admin-nav-link"
            :class="{ 'router-link-active': route.path.startsWith(item.to + '/') }"
            @click="mobileMenuOpen = false"
            ><van-icon :name="item.icon" aria-hidden="true" /><span>{{ item.label }}</span
            ><span
              v-if="route.path === item.to || route.path.startsWith(item.to + '/')"
              class="admin-nav-current"
              aria-hidden="true"
          /></RouterLink>
        </div>
      </nav>
      <div class="admin-sidebar-footer">
        <div class="admin-account-summary">
          <div class="admin-account-avatar" aria-hidden="true">{{ administratorInitial }}</div>
          <div>
            <strong>{{ administrator?.name }}</strong
            ><span>{{ administrator?.account }}</span>
          </div>
        </div>
        <button type="button" class="admin-logout-button" :disabled="busy" @click="logout">
          <van-icon name="revoke" aria-hidden="true" />{{ msg('退出后台') }}
        </button>
      </div>
    </aside>
    <button
      v-if="mobileMenuOpen && compactNavigation"
      type="button"
      class="admin-sidebar-mask"
      tabindex="-1"
      :aria-label="msg('关闭后台导航')"
      @click="mobileMenuOpen = false"
    />
    <section class="admin-workspace" :inert="mobileMenuOpen && compactNavigation">
      <header class="admin-topbar">
        <div class="admin-topbar-location">
          <button
            type="button"
            class="admin-menu-toggle"
            :aria-label="msg('打开后台导航')"
            aria-controls="admin-navigation"
            :aria-expanded="mobileMenuOpen"
            @click="mobileMenuOpen = true"
          >
            <van-icon name="wap-nav" aria-hidden="true" /></button
          ><span class="admin-topbar-institution">{{ system.school.name }}</span
          ><van-icon name="arrow" class="admin-breadcrumb-divider" aria-hidden="true" /><span
            class="admin-topbar-page"
            >{{ pageTitle }}</span
          >
        </div>
        <div class="admin-topbar-account">
          <button
            type="button"
            class="navbar-action"
            :aria-label="msg('查看消息通知')"
            @click="router.push('/notifications')"
          >
            <van-icon name="bell" size="20" aria-hidden="true" /></button
          ><span class="admin-topbar-avatar" aria-hidden="true">{{ administratorInitial }}</span
          ><span class="admin-current-account"
            ><strong>{{ administrator?.name }}</strong
            ><span>{{ msg('管理员') }}</span></span
          >
        </div>
      </header>
      <main id="main-content" tabindex="-1" class="admin-main-content">
        <header class="admin-page-heading">
          <h1>{{ pageTitle }}</h1>
        </header>
        <RouterView />
      </main>
    </section>
  </div>
</template>
