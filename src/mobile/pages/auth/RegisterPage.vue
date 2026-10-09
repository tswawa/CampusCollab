<script setup lang="ts">
import { locale, msg } from '@/mobile/i18n'
import { computed, reactive, ref, watch } from 'vue'
import { showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useSystemStore } from '@/mobile/stores/system'
import type { RegistrationPayload, UserRole } from '@/mobile/types'
import { useLoad } from '@/mobile/api/ui'
import { errorMessage, isCancelled } from '@/mobile/api'
import LoadState from '@/mobile/components/LoadState.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const catalog = useCatalogStore()
const system = useSystemStore()
const role = computed<UserRole>(() => (route.params.role === 'teacher' ? 'teacher' : 'student'))
const isStudent = computed(() => role.value === 'student')
const agreement = ref(false)
const submitting = ref(false)
const formError = ref('')

const form = reactive({
  name: '',
  account: '',
  department: '',
  className: '',
  grade: '',
  email: '',
  externalId: '',
  isExternal: false,
  password: '',
  confirmPassword: ''
})

const departments = computed(() => catalog.activeDepartments)
const grades = computed(() => catalog.activeGrades)
const classOptions = computed(() => catalog.classesFor(form.department, form.grade))
const { loading, error: loadError, reload } = useLoad((signal) => catalog.fetchCatalog(signal))
const accountLabel = computed(() => (isStudent.value ? msg("学号") : msg("教工号")))
const passwordStrong = computed(
  () =>
    form.password.length >= 8 &&
    [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((rule) => rule.test(form.password)).length >= 2
)

watch(
  [departments, grades, classOptions],
  () => {
    if (!departments.value.some((item) => item.id === form.department)) form.department = ''
    if (!grades.value.some((item) => item.id === form.grade)) form.grade = ''
    if (!classOptions.value.some((item) => item.id === form.className)) form.className = ''
  }
)

function validate() {
  if (!system.school.registrationEnabled) return msg('机构已关闭注册')
  if (!form.name.trim() || form.name.trim().length > 100) return msg("请输入真实姓名")
  if (form.account.trim().length < 4 || form.account.trim().length > 254 || /\s/.test(form.account.trim())) return msg('账号应为4—254位用户名或邮箱')
  if (!form.isExternal && system.school.requireDepartment && !form.department) return msg("请选择所属学院")
  if (!form.isExternal && isStudent.value && system.school.requireGrade && !form.grade) return msg("请选择入学年级")
  if (!form.isExternal && isStudent.value && system.school.requireClass && !form.className) return msg("请选择行政班级")
  if (!passwordStrong.value) return msg("密码至少 8 位，包含字母、数字或符号两类")
  if (form.password !== form.confirmPassword) return msg("两次输入的密码不一致")
  if (!agreement.value) return msg("请确认登记资料真实")
  return ''
}

async function submit() {
  if (submitting.value) return
  formError.value = ''
  const error = validate()
  if (error) {
    formError.value = error
    showToast(error)
    return
  }
  submitting.value = true
  const payload: RegistrationPayload = isStudent.value
    ? {
        role: 'student',
        name: form.name.trim(),
        account: form.account.trim(),
        departmentId: form.department || undefined,
        classId: form.className || undefined,
        gradeId: form.grade || undefined,
        password: form.password
      }
    : {
        role: 'teacher',
        name: form.name.trim(),
        account: form.account.trim(),
        departmentId: form.department || undefined,
        password: form.password
      }
  try {
    await auth.register({ ...payload, locale: locale.value, email: form.email.trim() || undefined, externalId: form.externalId.trim() || undefined, isExternal: form.isExternal })
    await router.replace({ path: '/register-success', query: { role: role.value, pending: form.isExternal || role.value === 'teacher' ? '1' : undefined } })
  } catch (error) { if (!isCancelled(error)) { formError.value = errorMessage(error); showToast(formError.value) } }
  finally { submitting.value = false }
}
</script>

<template>
  <div class="auth-shell">
    <header class="auth-header-bar">
      <button class="auth-back-btn" :aria-label="msg('返回')" @click="router.back()">
        <van-icon name="arrow-left" size="18" />
      </button>
      <span style="font-size: 16px; font-weight: 700; color: var(--text)">
        {{ isStudent ? msg("在籍学生注册") : msg("教师教工登记") }}
      </span>
      <span style="width: 44px" />
    </header>

    <main id="main-content" tabindex="-1" class="auth-page-content">
      <p v-if="formError" role="alert" class="workflow-error">{{ formError }}</p>
      <LoadState :loading="loading" :error="loadError" @retry="reload" />
      <div style="margin-bottom: 20px">
        <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 800; color: var(--text)">
          {{ system.school.name }}
        </h1>
      </div>

      <!-- 身份信息表单 -->
      <div style="font-size: 14px; font-weight: 700; color: #475569; margin: 0 2px 6px">{{ msg("基本信息") }}</div>
      <van-form class="surface-card" style="overflow: hidden; margin-bottom: 16px">
        <van-field
          v-model="form.name"
          :label="msg('真实姓名')"
          :placeholder="msg('请输入本人真实姓名')"
          maxlength="100"
          clearable
        />
        <van-field
          v-model="form.account"
          :label="accountLabel"
          :placeholder="msg('请输入{p0}', { p0: accountLabel })"
          maxlength="254"
          clearable
        />

        <div style="padding: 12px 16px; border-top: 1px solid var(--line)">
          <label for="registration-department" style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("所属学院") }} {{ !system.school.requireDepartment || form.isExternal ? msg('选填') : '*' }}</label>
          <select
            id="registration-department"
            v-model="form.department"
            style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff"
          >
            <option value="">{{ msg("请选择学院") }}</option>
            <option v-for="item in departments" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </div>

        <template v-if="isStudent">
          <div style="padding: 12px 16px; border-top: 1px solid var(--line)">
            <label for="registration-grade" style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("年级") }} {{ !system.school.requireGrade || form.isExternal ? msg('选填') : '*' }}</label>
            <select
              id="registration-grade"
              v-model="form.grade"
              style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff"
            >
              <option value="">{{ msg("请选择入学年级") }}</option>
              <option v-for="item in grades" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </div>

          <div style="padding: 12px 16px; border-top: 1px solid var(--line)">
            <label for="registration-class" style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("行政班级") }} {{ !system.school.requireClass || form.isExternal ? msg('选填') : '*' }}</label>
            <select
              id="registration-class"
              v-model="form.className"
              :disabled="!form.department || !form.grade"
              style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff"
            >
              <option value="" disabled>{{ !form.department ? msg("请先选择学院") : !form.grade ? msg("请先选择年级") : msg("请选择班级") }}</option>
              <option v-for="item in classOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </div>
        </template>
      </van-form>

      <!-- 密码设置 -->
      <section class="surface-card" style="padding: 16px; margin-bottom: 16px">
        <van-checkbox v-if="system.school.allowExternalParticipants && isStudent" v-model="form.isExternal">{{ msg('校外参与者') }}</van-checkbox>
        <van-field v-model="form.email" :label="msg('电子邮箱（选填）')" type="email" autocomplete="email" />
        <van-field v-model="form.externalId" :label="msg('外部编号（选填）')" maxlength="100" />
      </section>
      <div style="font-size: 14px; font-weight: 700; color: #475569; margin: 0 2px 6px">{{ msg("登录密码") }}</div>
      <van-form class="surface-card" style="overflow: hidden; margin-bottom: 12px">
        <van-field
          v-model="form.password"
          :label="msg('设置密码')"
          type="password"
          :placeholder="msg('至少 8 位，包含字母/数字/符号两类')"
          autocomplete="new-password"
          clearable
        />
        <van-field
          v-model="form.confirmPassword"
          :label="msg('确认密码')"
          type="password"
          :placeholder="msg('请再次输入密码')"
          autocomplete="new-password"
          clearable
        />
      </van-form>

      <div style="margin: 14px 4px 18px">
        <van-checkbox v-model="agreement" shape="square" icon-size="16px">
          <span style="font-size: 14px; color: var(--text)">{{ msg("我确认登记资料真实") }}</span>
        </van-checkbox>
        <p v-if="!isStudent || form.isExternal" style="margin: 12px 0 0; font-size: 14px; color: var(--muted)">{{ msg("账号需管理员审核通过后方可登录。") }}</p>
      </div>

      <van-button
        type="primary"
        block
        class="auth-submit-btn"
        :loading="submitting"
        :disabled="!system.school.registrationEnabled"
        @click="submit"
      >
        {{ isStudent ? msg("注册账号") : msg("提交教师登记申请") }}
      </van-button>
    </main>
  </div>
</template>
