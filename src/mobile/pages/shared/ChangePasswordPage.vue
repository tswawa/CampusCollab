<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { bootstrap } from '@/mobile/api/bootstrap'
import { errorMessage, isCancelled } from '@/mobile/api'
import { roleHome } from '@/router'

const router = useRouter()
const auth = useAuthStore()
const required = computed(() => auth.currentUser?.mustChangePassword === true)
const title = computed(() => (required.value ? msg('设置新密码') : msg('修改密码')))
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const formError = ref('')

function validate() {
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value)
    return msg('请填写当前密码、新密码和确认新密码')
  if (newPassword.value.length < 8 || newPassword.value.length > 128) return msg('密码长度须为 8—128 位')
  if (newPassword.value !== confirmPassword.value) return msg('两次输入的密码不一致')
  return ''
}

async function submit() {
  if (submitting.value) return
  formError.value = validate()
  if (formError.value) {
    showToast(formError.value)
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    showToast({ message: msg('密码已更新'), icon: 'success' })
    await bootstrap(true)
    await router.replace(roleHome(auth.role))
  } catch (error) {
    if (!isCancelled(error)) {
      formError.value = errorMessage(error)
      showToast(formError.value)
    }
  } finally {
    submitting.value = false
  }
}

async function logout() {
  if (submitting.value) return
  submitting.value = true
  try {
    await auth.logout()
    await router.replace('/login')
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
      <button v-if="!required" class="auth-back-btn" :aria-label="msg('返回')" @click="router.back()">
        <van-icon name="arrow-left" size="18" />
      </button>
      <span v-else style="width: 44px" />
      <span style="font-size: 16px; font-weight: 700; color: var(--text)">{{ title }}</span>
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
            background: #ffffff;
            border: 1px solid var(--line);
            box-shadow: var(--shadow-sm);
            display: grid;
            place-items: center;
          "
        >
          <van-icon name="lock" size="30" color="var(--brand)" />
        </div>
        <h1 style="margin: 0 0 6px; font-size: 20px; font-weight: 800; color: var(--text)">{{ title }}</h1>
        <p v-if="required" style="margin: 0; font-size: 14px; color: var(--muted); line-height: 1.6">
          {{ msg('管理员为你设置了初始密码。为了账号安全，请先设置一个只有你知道的新密码。') }}
        </p>
      </div>

      <van-form class="auth-form-block" @submit="submit">
        <van-field
          v-model="currentPassword"
          :label="msg('当前密码')"
          type="password"
          :placeholder="msg('请输入密码')"
          :disabled="submitting"
          clearable
          autocomplete="current-password"
        />
        <van-field
          v-model="newPassword"
          :label="msg('新密码')"
          type="password"
          :placeholder="msg('至少 8 位，包含字母/数字/符号两类')"
          :disabled="submitting"
          clearable
          autocomplete="new-password"
        />
        <p style="margin: 0; padding: 0 16px 12px; font-size: 12px; color: var(--muted)">
          {{ msg('密码长度须为 8—128 位，包含字母、数字或符号中的至少两类') }}
        </p>
        <van-field
          v-model="confirmPassword"
          :label="msg('确认新密码')"
          type="password"
          :placeholder="msg('请再次输入密码')"
          :disabled="submitting"
          clearable
          autocomplete="new-password"
        />
      </van-form>

      <van-button type="primary" block class="auth-submit-btn" :loading="submitting" @click="submit">{{
        msg('更新密码')
      }}</van-button>

      <div v-if="required" class="auth-footer-links" style="justify-content: center; margin-top: 24px">
        <button class="text-link" :disabled="submitting" @click="logout">{{ msg('退出登录') }}</button>
      </div>
    </main>
  </div>
</template>
