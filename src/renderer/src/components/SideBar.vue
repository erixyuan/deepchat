<template>
  <div class="flex p-2 flex-col items-center border-r bg-background">
    <!-- Navigation Items -->
    <nav class="flex flex-1 flex-col gap-2">
      <!-- Chat Section -->
      <Button
        variant="ghost"
        size="icon"
        class="rounded-lg w-9 h-9"
        :class="{ 'bg-accent': modelValue === 'chat' }"
        @click="$emit('update:modelValue', 'chat')"
      >
        <Icon
          icon="lucide:message-circle"
          :class="['h-5 w-5', modelValue === 'chat' ? ' text-primary' : 'text-muted-foreground']"
        />
        <span class="sr-only">Chat</span>
      </Button>

      <!-- Settings Section -->

      <Button
        variant="ghost"
        size="icon"
        class="rounded-lg w-9 h-9"
        :class="{ 'bg-accent': modelValue === 'settings' }"
        @click="$emit('update:modelValue', 'settings')"
      >
        <Icon
          icon="lucide:bolt"
          :class="[
            'h-5 w-5',
            modelValue === 'settings' ? ' text-primary' : 'text-muted-foreground'
          ]"
        />
        <span class="sr-only">Settings</span>
      </Button>
      <!-- Debug Section -->
      <!-- <Button
        variant="ghost"
        size="icon"
        class="rounded-lg w-9 h-9"
        :class="{ 'bg-accent': modelValue === 'debug' }"
        @click="$emit('update:modelValue', 'debug')"
      >
        <Icon
          icon="lucide:bug"
          :class="['h-5 w-5', modelValue === 'debug' ? ' text-primary' : 'text-muted-foreground']"
        />
        <span class="sr-only">Debug</span>
      </Button> -->
    </nav>

    <!-- Setting section -->
    <div class="mt-auto relative flex flex-col items-center">
      <!-- 明亮/黑暗模式切花 -->
      <Button
        variant="ghost"
        size="icon"
        class="w-9 h-9 rounded-lg text-muted-foreground"
        @click="themeStore.toggleDark()"
      >
        <Icon :icon="themeStore.isDark ? 'lucide:sun' : 'lucide:moon'" class="w-4 h-4" />
      </Button>
      <!-- 登陆/个人资料入口 -->
      <Button
        variant="ghost"
        size="icon"
        class="rounded-lg w-9 h-9 text-muted-foreground relative"
        :class="{ 'bg-accent': modelValue === 'login' }"
        @click="handleProfileClick"
      >
        <template v-if="userStore.isLoggedIn && safeAvatarUrl && !avatarLoadError">
          <img 
            :src="safeAvatarUrl" 
            alt="用户头像" 
            class="h-5 w-5 rounded-full object-cover"
            @load="handleAvatarLoaded"
            @error="handleAvatarError"
          />
        </template>
        <!-- <Icon v-else icon="lucide:user" class="h-5 w-5" /> -->
        <Icon
          v-else
          icon="lucide:user"
          :class="[
            'h-5 w-5',
            modelValue === 'login' ? ' text-primary' : 'text-muted-foreground'
          ]"
        />
        <span
          v-if="upgrade.hasUpdate"
          class="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full animate-pulse"
        ></span>
        <span class="sr-only">User Profile</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { onMounted, watch, ref, computed } from 'vue'
import { useUpgradeStore } from '@/stores/upgrade'
import { useThemeStore } from '@/stores/theme'
import { useUserStore } from '@/stores/user'
import { usePresenter } from '@/composables/usePresenter'
import { useRouter } from 'vue-router'

defineProps<{
  modelValue: string
}>()

const router = useRouter()
const themeStore = useThemeStore()
const userStore = useUserStore()
const configPresenter = usePresenter('configPresenter')
const isAvatarLoaded = ref(false)
const avatarLoadError = ref(false)

// 确保用户头像URL是绝对URL，避免相对路径问题
const safeAvatarUrl = computed(() => {
  const url = userStore.avatarUrl
  if (!url) return ''
  
  // 如果已经是完整URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  
  // 否则构建完整URL
  return `https:${url.startsWith('//') ? url : `//${url}`}`
})

const emits = defineEmits<{
  'update:modelValue': [value: string]
}>()

const upgrade = useUpgradeStore()

// 确保用户信息已加载
const reloadUserInfo = async () => {
  // 清空当前用户信息，模拟未登录状态（仅用于测试）
  userStore.clearUserInfo()
  console.log('已清除用户信息，模拟未登录状态')
  
  const savedUserInfo = await configPresenter.getUserInfo()
  if (savedUserInfo) {
    userStore.updateUserInfo(savedUserInfo)
    console.log('已重新加载用户信息', savedUserInfo)
  } else {
    console.log('无保存的用户信息')
  }
}

// 处理头像加载完成
const handleAvatarLoaded = () => {
  console.log('头像加载成功')
  isAvatarLoaded.value = true
  avatarLoadError.value = false
}

// 处理头像加载错误
const handleAvatarError = () => {
  console.error('头像加载失败', safeAvatarUrl.value)
  avatarLoadError.value = true
}

const handleProfileClick = async () => {
  // 检查并记录登录状态
  console.log('头像按钮点击，当前登录状态:', {
    isLoggedIn: userStore.isLoggedIn,
    userInfo: userStore.userInfo
  })

  // 如果用户未登录，跳转到登录页面
  if (!userStore.isLoggedIn) {
    console.log('用户未登录，跳转到登录页面')
    // 使用Vue Router的方式跳转
    router.push({ name: 'login' })
    return
  }

  // 以下是原有的更新检查逻辑
  if (!upgrade.hasUpdate) {
    await upgrade.checkUpdate()
  } else {
    if (upgrade.isReadyToInstall) {
      upgrade.openUpdateDialog()
    }
  }

  emits('update:modelValue', 'login')
}

// 监听更新状态变化，当有新更新时自动显示更新弹窗
watch(
  () => upgrade.isReadyToInstall,
  (newVal, oldVal) => {
    if (newVal && !oldVal) {
      upgrade.openUpdateDialog()
    }
  }
)

onMounted(() => {
  upgrade.checkUpdate()
  // 重新加载用户信息确保显示头像
  reloadUserInfo().then(() => {
    console.log('用户信息状态:', {
      isLoggedIn: userStore.isLoggedIn,
      avatarUrl: userStore.avatarUrl,
      safeAvatarUrl: safeAvatarUrl.value,
      userInfo: userStore.userInfo
    })
  })
})
</script>
