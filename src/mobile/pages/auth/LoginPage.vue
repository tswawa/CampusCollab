<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useSystemStore } from '@/mobile/stores/system'
import { bootstrap } from '@/mobile/api/bootstrap'
import { errorMessage, isCancelled } from '@/mobile/api'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const system = useSystemStore()
const institutionInitial = computed(() => Array.from(system.school.name.trim())[0]?.toLocaleUpperCase() ?? '·')
const logoFailed = ref(false)
watch(
  () => system.school.logo,
  () => {
    logoFailed.value = false
  }
)

const account = ref('')
const password = ref('')
const submitting = ref(false)
const formError = ref('')

async function login() {
  if (submitting.value) return
  formError.value = ''
  if (!account.value.trim() || !password.value) {
    formError.value = msg('请输入账号和密码')
    showToast(formError.value)
    return
  }
  submitting.value = true
  try {
    await auth.login(account.value, password.value)
    await bootstrap(true)
    showToast({ message: msg('登录成功'), icon: 'success' })
    const requested = route.query.redirect
    const redirect =
      typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
        ? requested
        : auth.role === 'admin'
          ? '/admin/home'
          : auth.role === 'teacher'
            ? '/teacher/home'
            : '/student/home'
    await router.replace(redirect)
  } catch (error) {
    if (!isCancelled(error)) {
      formError.value = errorMessage(error)
      showToast(formError.value)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-shell">
    <header class="auth-header-bar">
      <button class="auth-back-btn" :aria-label="msg('返回')" @click="router.push('/')">
        <van-icon name="arrow-left" size="18" />
      </button>
      <span style="font-size: 16px; font-weight: 700; color: var(--text)">{{ msg('校园账号登录') }}</span>
      <span style="width: 44px" />
    </header>

    <main id="main-content" tabindex="-1" class="auth-page-content">
      <p v-if="formError" role="alert" class="workflow-error">{{ formError }}</p>
      <div style="text-align: center; margin-bottom: 28px; margin-top: 12px">
        <div
          style="
            width: 60px;
            height: 60px;
            margin: 0 auto 14px;
            border-radius: 12px;
            overflow: hidden;
            background: #ffffff;
            border: 1px solid var(--line);
            box-shadow: var(--shadow-sm);
            display: grid;
            place-items: center;
          "
        >
          <img
            v-if="system.school.logo && !logoFailed"
            :src="system.school.logo"
            :alt="system.school.name"
            @error="logoFailed = true"
            style="width: 100%; height: 100%; object-fit: contain"
          />
          <span v-else class="institution-logo-fallback" aria-hidden="true">{{ institutionInitial }}</span>
        </div>
        <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 800; color: var(--text)">
          {{ system.school.name }}
        </h1>
        <p style="margin: 0; font-size: 14px; color: var(--muted)">
          {{ system.school.platformName }}
        </p>
      </div>

      <!-- 登录输入框：无需手动切角色，角色由账号自动查找决定 -->
      <van-form class="auth-form-block" @submit="login">
        <van-field
          v-model="account"
          :label="msg('登录账号')"
          :placeholder="msg('请输入学号、工号或管理员账号')"
          clearable
          autocomplete="username"
        />
        <van-field
          v-model="password"
          :label="msg('登录密码')"
          type="password"
          :placeholder="msg('请输入密码')"
          clearable
          autocomplete="current-password"
        />
      </van-form>

      <van-button type="primary" block class="auth-submit-btn" :loading="submitting" @click="login">{{
        msg('登 录')
      }}</van-button>

      <div class="auth-footer-links" style="justify-content: center; margin-top: 24px">
        <button class="text-link" @click="router.push('/register')">{{ msg('注册账号') }}</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.institution-logo-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: #eaf1f7;
  color: #315c7c;
  font-size: 30px;
  font-weight: 650;
  line-height: 1;
}
</style>
