<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="auth-shell">
    <header class="auth-header-bar">
      <button class="auth-back-btn" :aria-label="msg('返回')" @click="router.back()">
        <van-icon name="arrow-left" size="18" />
      </button>
      <h1 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text)">{{ msg('选择注册身份') }}</h1>
      <span style="width: 44px" />
    </header>

    <main class="auth-page-content">
      <div style="display: flex; flex-direction: column; gap: 14px">
        <article
          class="surface-card"
          style="
            padding: 18px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 14px;
            transition: border-color 0.12s ease;
          "
          role="button"
          tabindex="0"
          @click="router.push('/register/student')"
          @keydown.enter.prevent="router.push('/register/student')"
          @keydown.space.prevent="router.push('/register/student')"
        >
          <div
            style="
              width: 44px;
              height: 44px;
              border-radius: 10px;
              background: var(--brand-soft);
              color: var(--brand);
              display: grid;
              place-items: center;
              font-size: 22px;
            "
          >
            🎓
          </div>
          <div style="flex: 1">
            <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text)">{{ msg('在籍学生') }}</h2>
          </div>
          <van-icon name="arrow" color="#94A3B8" />
        </article>

        <article
          class="surface-card"
          style="
            padding: 18px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 14px;
            transition: border-color 0.12s ease;
          "
          role="button"
          tabindex="0"
          @click="router.push('/register/teacher')"
          @keydown.enter.prevent="router.push('/register/teacher')"
          @keydown.space.prevent="router.push('/register/teacher')"
        >
          <div
            style="
              width: 44px;
              height: 44px;
              border-radius: 10px;
              background: #ecfdf5;
              color: var(--completed);
              display: grid;
              place-items: center;
              font-size: 22px;
            "
          >
            👩‍🏫
          </div>
          <div style="flex: 1">
            <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text)">
              {{ msg('指导教师 / 教职工') }}
            </h2>
          </div>
          <van-icon name="arrow" color="#94A3B8" />
        </article>
      </div>

      <div style="text-align: center; margin-top: 32px; font-size: 14px; color: var(--muted)">
        <button class="text-link" @click="router.push('/login')">{{ msg('直接登录') }}</button>
      </div>
    </main>
  </div>
</template>
