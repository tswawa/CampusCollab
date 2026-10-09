<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useTaskStore } from '@/mobile/stores/tasks'
import { dateOffset } from '@/mobile/utils/date'
import { useLoad, usePagination } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'
import TaskCard from '@/mobile/components/TaskCard.vue'

const router = useRouter()
const auth = useAuthStore()
const catalog = useCatalogStore()
const taskStore = useTaskStore()
const user = computed(() => auth.currentUser!)

// 基础筛选状态（默认常驻显示）
const keyword = ref('')
const selectedCategory = ref('')
const onlyAvailable = ref(false)
const sortType = ref<'time' | 'quota'>('time')

// 高级筛选抽屉状态
const showDrawer = ref(false)
const filterCampus = ref('')
const filterTime = ref('all')
const filterAudience = ref('all')

const taskCategories = computed(() => [{ id: '', name: msg("全部") }, ...catalog.activeTaskCategories])
const campusOptions = computed(() => [{ id: '', name: msg("全部校区") }, ...catalog.activeCampuses])
const timeOptions = computed(() => [
  { label: msg("全部时间"), value: 'all' },
  { label: msg("今天"), value: 'today' },
  { label: msg("明天"), value: 'tomorrow' },
  { label: msg("未来7天"), value: 'week' }
])
const audienceOptions = computed(() => [
  { label: msg("全部范围"), value: 'all' },
  { label: msg("全校学生"), value: 'school' },
  { label: msg("本学院"), value: 'department' },
  { label: msg("本年级"), value: 'grade' },
  { label: msg("本班级"), value: 'class' }
])

const hasAdvancedFilter = computed(
  () =>
    filterCampus.value !== '' ||
    filterTime.value !== 'all' ||
    filterAudience.value !== 'all'
)

function resetAdvanced() {
  filterCampus.value = ''
  filterTime.value = 'all'
  filterAudience.value = 'all'
}

const filters = [keyword, selectedCategory, onlyAvailable, sortType, filterCampus, filterTime, filterAudience]
const { page, pageSize } = usePagination(filters)
const { loading, error, ready, reload } = useLoad((signal) => taskStore.fetchTasks({
  keyword: keyword.value.trim(), categoryId: selectedCategory.value || undefined,
  campusId: filterCampus.value || undefined, available: onlyAvailable.value || undefined,
  sort: sortType.value, audienceScope: filterAudience.value === 'all' ? undefined : filterAudience.value,
  dateFrom: filterTime.value === 'all' ? undefined : dateOffset(filterTime.value === 'tomorrow' ? 1 : 0),
  dateTo: filterTime.value === 'all' ? undefined : dateOffset(filterTime.value === 'week' ? 6 : filterTime.value === 'tomorrow' ? 1 : 0),
  page: page.value, pageSize
}, signal), [...filters, page])
const filteredTasks = computed(() => taskStore.tasks)
</script>

<template>
  <div class="task-hall-page">
    <!-- 顶部常驻区域：搜索、分类及简洁筛选 -->
    <section class="hall-search-header">
      <van-search v-model="keyword" :placeholder="msg('搜索任务、地点或发布老师')" clearable />

      <!-- 分类标签（默认全部） -->
      <div class="category-tabs-bar">
        <button
          v-for="cat in taskCategories"
          :key="cat.id"
          class="category-pill-btn"
          :class="{ 'is-active': selectedCategory === cat.id }"
          @click="selectedCategory = cat.id"
        >
          {{ cat.name }}
        </button>
      </div>

      <!-- 简洁筛选工具栏 -->
      <div class="concise-filter-bar">
        <div class="filter-left-actions">
          <button
            class="quick-filter-toggle"
            :class="{ 'is-active': onlyAvailable }"
            @click="onlyAvailable = !onlyAvailable"
          >
            <van-icon :name="onlyAvailable ? 'checked' : 'circle'" />{{ msg("仅看可接取") }}</button>
          <button
            class="quick-filter-toggle"
            @click="sortType = sortType === 'time' ? 'quota' : 'time'"
          >
            <van-icon name="sort" />
            {{ sortType === 'time' ? msg("时间优先") : msg("名额优先") }}
          </button>
        </div>

        <button
          class="advanced-filter-btn"
          :class="{ 'has-filter': hasAdvancedFilter }"
          @click="showDrawer = true"
        >
          <van-icon name="filter-o" />
          <span>{{ msg("高级条件") }}</span>
          <span v-if="hasAdvancedFilter" style="font-weight: bold; color: var(--brand)">●</span>
        </button>
      </div>
    </section>

    <!-- 列表展示 -->
    <main class="page-wrap" style="padding-top: 12px">
      <LoadState :loading="loading" :error="error" @retry="reload" />
      <template v-if="ready && !error">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; color: var(--muted); font-size: 14px">
        <span>{{ msg("共 {p0} 个任务", { p0: taskStore.taskPage.total }) }}</span>
        <span v-if="hasAdvancedFilter" style="color: var(--brand); cursor: pointer" @click="resetAdvanced">{{ msg("重置高级条件") }}</span>
      </div>

      <TaskCard
        v-for="task in filteredTasks"
        :key="task.id"
        :task="task"
        :user="user"
        @open="id => router.push(`/tasks/${id}`)"
      />

      <div v-if="filteredTasks.length === 0" class="campus-empty surface-card">
        <van-icon name="search" />
        <h4>{{ msg("未找到符合条件的任务") }}</h4>
        <van-button
          size="small"
          type="primary"
          style="margin-top: 14px; border-radius: 6px"
          @click="() => { keyword = ''; selectedCategory = ''; onlyAvailable = false; resetAdvanced(); }"
        >{{ msg("清空所有条件") }}</van-button>
      </div>
      <PaginationBar v-model:page="page" :page-size="pageSize" :total="taskStore.taskPage.total" :loading="loading" />
      </template>
    </main>

    <!-- 高级筛选底部抽屉 -->
    <van-popup
      v-model:show="showDrawer"
      position="bottom"
      round
      safe-area-inset-bottom
      :style="{ maxHeight: '75%' }"
    >
      <div class="filter-drawer-content">
        <div class="drawer-header">
          <h3>{{ msg("高级筛选条件") }}</h3>
          <button class="text-link" @click="resetAdvanced">{{ msg("重置") }}</button>
        </div>

        <div class="filter-group-title">{{ msg("校区范围") }}</div>
        <div class="filter-options-grid">
          <button
            v-for="item in campusOptions"
            :key="item.id"
            class="filter-option-btn"
            :class="{ 'is-selected': filterCampus === item.id }"
            @click="filterCampus = item.id"
          >
            {{ item.name }}
          </button>
        </div>

        <div class="filter-group-title">{{ msg("日期范围") }}</div>
        <div class="filter-options-grid">
          <button
            v-for="item in timeOptions"
            :key="item.value"
            class="filter-option-btn"
            :class="{ 'is-selected': filterTime === item.value }"
            @click="filterTime = item.value"
          >
            {{ item.label }}
          </button>
        </div>

        <div class="filter-group-title">{{ msg("面向范围") }}</div>
        <div class="filter-options-grid">
          <button
            v-for="item in audienceOptions"
            :key="item.value"
            class="filter-option-btn"
            :class="{ 'is-selected': filterAudience === item.value }"
            @click="filterAudience = item.value"
          >
            {{ item.label }}
          </button>
        </div>

        <div class="drawer-bottom-actions">
          <van-button block @click="showDrawer = false">{{ msg("取消") }}</van-button>
          <van-button type="primary" block @click="showDrawer = false">{{ msg("确定") }}</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
