import { ref } from 'vue'
import { defineStore } from 'pinia'
import { DEEPLINK_EVENTS } from '@/events'
import router from '@/router'
import { usePresenter } from '@/composables/usePresenter'
import { useUserStore } from '@/stores/user'

export const useAuthStore = defineStore('auth', () => {
  const configPresenter = usePresenter('configPresenter')
  
  // 状态
  const token = ref<string | null>(null)
  const isAuthenticated = ref(false)

  // 保存令牌
  const setToken = (newToken: string) => {
    token.value = newToken
    isAuthenticated.value = true
    // 使用configPresenter存储token而不是localStorage
    configPresenter.setAuthToken(newToken)
    console.log('已保存认证令牌')
  }

  // 清除令牌（登出时使用）
  const clearToken = () => {
    token.value = null
    isAuthenticated.value = false
    // 使用configPresenter清除token
    configPresenter.setAuthToken(null)
    // 同时清除用户信息
    const userStore = useUserStore()
    userStore.clearUserInfo()
    console.log('已清除认证令牌和用户信息')
  }

  // 初始化 - 从configPresenter加载现有token
  const initAuth = () => {
    const savedToken = configPresenter.getAuthToken()
    if (savedToken) {
      token.value = savedToken
      isAuthenticated.value = true
      console.log('已从配置中恢复认证令牌')
    }
  }

  // 处理登录成功的DeepLink事件
  window.electron.ipcRenderer.on(DEEPLINK_EVENTS.LOGIN_SUCCESS, async (_, data) => {
    console.log('收到登录成功事件:', data)
    if (data && data.token) {
      setToken(data.token)
      
      // 加载用户信息（主进程已经获取并保存了用户信息，这里只是从配置中加载）
      const userStore = useUserStore()
      const userInfo = configPresenter.getUserInfo()
      if (userInfo) {
        userStore.updateUserInfo(userInfo)
      }
      
      // 可以根据需要导航到特定页面
      // 例如，如果当前在登录页面，则导航到主页
      const currentRoute = router.currentRoute.value
      if (currentRoute.name === 'login') {
        await router.push({ name: 'chat' })
      }
    }
  })

  // 初始化
  initAuth()

  return {
    token,
    isAuthenticated,
    setToken,
    clearToken
  }
}) 