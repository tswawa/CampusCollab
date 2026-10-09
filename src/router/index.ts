import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useSystemStore } from '@/mobile/stores/system'
import type { UserRole } from '@/mobile/types'
import { bootstrap } from '@/mobile/api/bootstrap'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/mobile/pages/setup/SetupPage.vue'),
      meta: { public: true }
    },
    {
      path: '/',
      name: 'welcome',
      component: () => import('@/mobile/pages/auth/WelcomePage.vue'),
      meta: { public: true }
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/mobile/pages/auth/LoginPage.vue'),
      meta: { public: true }
    },
    {
      path: '/register',
      name: 'register-role',
      component: () => import('@/mobile/pages/auth/RegisterRolePage.vue'),
      meta: { public: true }
    },
    {
      path: '/register/:role(student|teacher)',
      name: 'register',
      component: () => import('@/mobile/pages/auth/RegisterPage.vue'),
      meta: { public: true }
    },
    {
      path: '/register-success',
      name: 'register-success',
      component: () => import('@/mobile/pages/auth/RegisterSuccessPage.vue'),
      meta: { public: true }
    },
    {
      path: '/admin',
      component: () => import('@/mobile/pages/admin/AdminLayout.vue'),
      redirect: '/admin/home',
      meta: { requiresAuth: true, roles: ['admin'] },
      children: [
        {
          path: 'governance', name: 'admin-governance',
          redirect: '/admin/settings/data'
        },
        {
          path: 'settings/notifications', name: 'admin-notification-settings',
          component: () => import('@/mobile/pages/admin/AdminGovernancePage.vue'),
          props: { section: 'notifications' },
          meta: { requiresAuth: true, roles: ['admin'], title: '通知设置' }
        },
        {
          path: 'settings/data', name: 'admin-data-settings',
          component: () => import('@/mobile/pages/admin/AdminGovernancePage.vue'),
          props: { section: 'data' },
          meta: { requiresAuth: true, roles: ['admin'], title: '数据管理' }
        },
        {
          path: 'home',
          name: 'admin-home',
          component: () => import('@/mobile/pages/admin/AdminHomePage.vue'),
          meta: { requiresAuth: true, roles: ['admin'], title: '后台概览' }
        },
        {
          path: 'accounts',
          name: 'admin-accounts',
          component: () => import('@/mobile/pages/admin/AdminAccountsPage.vue'),
          meta: { requiresAuth: true, roles: ['admin'], title: '账号管理' }
        },
        {
          path: 'organization',
          name: 'admin-organization',
          component: () => import('@/mobile/pages/admin/AdminOrganizationPage.vue'),
          meta: { requiresAuth: true, roles: ['admin'], title: '组织架构' }
        },
        {
          path: 'tasks',
          name: 'admin-tasks',
          component: () => import('@/mobile/pages/admin/AdminTasksPage.vue'),
          meta: { requiresAuth: true, roles: ['admin'], title: '任务管理' }
        },
        {
          path: 'settings',
          name: 'admin-settings',
          component: () => import('@/mobile/pages/admin/AdminSettingsPage.vue'),
          meta: { requiresAuth: true, roles: ['admin'], title: '系统设置' }
        }
      ]
    },
    {
      path: '/mobile',
      component: () => import('@/mobile/components/MobileLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '/student/home',
          name: 'student-home',
          component: () => import('@/mobile/pages/student/StudentHomePage.vue'),
          meta: { requiresAuth: true, roles: ['student'], immersive: true }
        },
        {
          path: '/student/tasks',
          name: 'student-tasks',
          component: () => import('@/mobile/pages/student/TaskHallPage.vue'),
          meta: { requiresAuth: true, roles: ['student'], title: '任务大厅' }
        },
        {
          path: '/student/mine',
          name: 'student-mine',
          component: () => import('@/mobile/pages/student/MyTasksPage.vue'),
          meta: { requiresAuth: true, roles: ['student'], title: '我的任务' }
        },
        {
          path: '/student/tasks/:id/submit',
          name: 'student-submit-proof',
          component: () => import('@/mobile/pages/student/SubmitProofPage.vue'),
          meta: {
            requiresAuth: true,
            roles: ['student'],
            title: '提交完成凭证',
            back: true,
            hideNav: true
          }
        },
        {
          path: '/teacher/home',
          name: 'teacher-home',
          component: () => import('@/mobile/pages/teacher/TeacherHomePage.vue'),
          meta: { requiresAuth: true, roles: ['teacher'], immersive: true }
        },
        {
          path: '/teacher/tasks',
          name: 'teacher-tasks',
          component: () => import('@/mobile/pages/teacher/TeacherTasksPage.vue'),
          meta: { requiresAuth: true, roles: ['teacher'], title: '任务管理' }
        },
        {
          path: '/teacher/create',
          name: 'teacher-create',
          component: () => import('@/mobile/pages/teacher/CreateTaskPage.vue'),
          meta: {
            requiresAuth: true,
            roles: ['teacher'],
            title: '发布任务',
            back: true,
            hideNav: true
          }
        },
        {
          path: '/teacher/review',
          name: 'teacher-review',
          component: () => import('@/mobile/pages/teacher/ReviewCenterPage.vue'),
          meta: {
            requiresAuth: true,
            roles: ['teacher'],
            title: '验收中心',
            back: true,
            hideNav: true
          }
        },
        {
          path: '/tasks/:id/workflow',
          name: 'task-workflow',
          component: () => import('@/mobile/pages/coordinator/WorkflowPage.vue'),
          meta: { requiresAuth: true, title: '名单与结项', back: true, hideNav: true }
        },
        {
          path: '/tasks/:id',
          name: 'task-detail',
          component: () => import('@/mobile/pages/shared/TaskDetailPage.vue'),
          meta: { requiresAuth: true, title: '任务详情', back: true, hideNav: true }
        },
        {
          path: '/notifications',
          name: 'notifications',
          component: () => import('@/mobile/pages/shared/NotificationsPage.vue'),
          meta: { requiresAuth: true, title: '消息通知', back: true, hideNav: true }
        },
        {
          path: '/profile',
          name: 'profile',
          component: () => import('@/mobile/pages/shared/ProfilePage.vue'),
          meta: { requiresAuth: true, title: '我的' }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ],
  scrollBehavior: to => to.hash ? { el: to.hash, top: 88 } : { top: 0 }
})

function roleHome(role?: UserRole) {
  if (role === 'admin') return '/admin/home'
  return role === 'teacher' ? '/teacher/home' : '/student/home'
}

router.beforeEach(async (to) => {
  if (!await bootstrap()) return true
  const auth = useAuthStore()
  const installation = useSystemStore().installation
  if (installation?.status === 'required' && to.name !== 'setup') return '/setup'
  if (installation?.status === 'blocked' && to.name !== 'setup' && to.name !== 'login' && !auth.isLoggedIn) return '/setup'
  if (installation?.status === 'configured' && to.name === 'setup') return auth.isLoggedIn ? roleHome(auth.role) : '/login'
  if (to.meta.public) {
    if (to.name === 'welcome' && auth.isLoggedIn) return roleHome(auth.role)
    return true
  }
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (auth.role === 'admin' && !to.path.startsWith('/admin') && !['notifications', 'profile', 'task-workflow'].includes(String(to.name))) {
    if (to.name === 'task-detail') return { path: '/admin/tasks', query: { task: String(to.params.id) } }
    return '/admin/home'
  }
  const roles = to.meta.roles as UserRole[] | undefined
  if (roles && auth.role && !roles.includes(auth.role)) return roleHome(auth.role)
  return true
})

export default router
