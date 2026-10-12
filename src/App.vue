<template>
  <div
    class="app-viewport"
    :class="{
      'app-viewport--task-workspace': taskWorkspace,
      'app-viewport--admin-console': adminConsole,
      'app-viewport--setup': route.name === 'setup'
    }"
  >
    <a href="#main-content" class="skip-link">{{ msg('跳至主要内容') }}</a>
    <div v-if="!bootState.ready" class="auth-shell" style="padding: 36px 20px">
      <h2>{{ msg('正在连接校园任务通') }}</h2>
      <LoadState :loading="bootState.loading" :error="bootState.error" @retry="retry" />
    </div>
    <template v-else>
      <LoadState v-if="bootState.error" :error="bootState.error" @retry="retry" />
      <RouterView
        v-if="route.meta.public || auth.isLoggedIn"
        :key="`${auth.currentUserId}:${auth.role ?? 'anonymous'}`"
      />
      <footer class="source-footer">
        <a href="/source.zip" download>{{ msg('源代码') }}</a
        ><a href="/LICENSE.txt" target="_blank" rel="noopener">{{ msg('许可证') }}</a
        ><a href="/NOTICE.txt" target="_blank" rel="noopener">{{ msg('来源与许可声明') }}</a>
      </footer>
    </template>
  </div>
</template>
<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, watch, watchEffect } from 'vue'
import { knownMessage, locale } from '@/mobile/i18n'
import { useSystemStore } from '@/mobile/stores/system'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { bootState, bootstrap } from '@/mobile/api/bootstrap'
import LoadState from '@/mobile/components/LoadState.vue'
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const system = useSystemStore()
const taskWorkspace = computed(() => route.name === 'task-workflow' && bootState.ready && auth.isLoggedIn)
const adminConsole = computed(() => route.path.startsWith('/admin') && bootState.ready && auth.isLoggedIn)
watchEffect(() => {
  locale.value
  const page = knownMessage(String(route.meta.title ?? ''))
  document.title = [page, msg('校园任务通'), system.school.name].filter(Boolean).join(' · ')
})
async function retry() {
  if (await bootstrap(true)) {
    await router.replace(route.fullPath)
    if (!route.meta.public && !auth.isLoggedIn)
      await router.replace({ path: '/login', query: { redirect: route.fullPath } })
    window.dispatchEvent(new Event('campus:refresh'))
  }
}
watch([() => auth.isLoggedIn, () => auth.role, () => auth.sessionReady], () => {
  if (!route.meta.requiresAuth || !auth.sessionReady) return
  if (!auth.isLoggedIn) {
    void router.replace({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  const roles = route.meta.roles as string[] | undefined
  if (roles && auth.role && !roles.includes(auth.role)) void router.replace('/')
})
</script>
<style src="./mobile/styles/workspace-shell.css"></style>
<style src="./mobile/styles/admin-console.css"></style>
