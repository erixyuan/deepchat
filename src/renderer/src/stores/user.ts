import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import type { UserInfo } from '@shared/presenter'

export const useUserStore = defineStore('user', () => {
  const configPresenter = usePresenter('configPresenter')
  
  // 状态
  const userInfo = ref<UserInfo | null>(null)
  const apiBaseUrl = ref<string>('https://deepchat.blanplan.com')
  
  // 计算属性
  const isLoggedIn = computed(() => !!userInfo.value)
  const avatarUrl = computed(() => userInfo.value?.avatarUrl || '')
  const nickname = computed(() => userInfo.value?.nickname || '')
  const username = computed(() => userInfo.value?.username || '')
  
  // 初始化 - 从configPresenter加载用户信息
  const initUser = () => {
    const savedUserInfo = configPresenter.getUserInfo()
    if (savedUserInfo) {
      userInfo.value = savedUserInfo
      console.log('已从配置中恢复用户信息')
    }
    
    const savedApiBaseUrl = configPresenter.getApiBaseUrl()
    if (savedApiBaseUrl) {
      apiBaseUrl.value = savedApiBaseUrl
      console.log('已从配置中恢复API基础URL')
    }
  }
  
  // 更新用户信息
  const updateUserInfo = (newUserInfo: UserInfo) => {
    userInfo.value = newUserInfo
    configPresenter.setUserInfo(newUserInfo)
    console.log('已更新用户信息')
  }
  
  // 清除用户信息（登出时使用）
  const clearUserInfo = () => {
    userInfo.value = null
    configPresenter.setUserInfo(null)
    console.log('已清除用户信息')
  }
  
  // 设置API基础URL
  const setApiBaseUrl = (url: string) => {
    apiBaseUrl.value = url
    configPresenter.setApiBaseUrl(url)
    console.log('已设置API基础URL:', url)
  }
  
  // 获取API基础URL
  const getApiBaseUrl = (): string => {
    return apiBaseUrl.value
  }
  
  // 初始化
  initUser()
  
  return {
    userInfo,
    apiBaseUrl,
    isLoggedIn,
    avatarUrl,
    nickname,
    username,
    updateUserInfo,
    clearUserInfo,
    setApiBaseUrl,
    getApiBaseUrl
  }
}) 