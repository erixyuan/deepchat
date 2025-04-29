<template>
  <div class="w-full h-full flex flex-col items-center justify-center bg-background p-4">
    <div class="w-full max-w-md space-y-6">
      <!-- 标题和Logo -->
      <div class="flex flex-col items-center space-y-2">
        <img src="@/assets/logo.png" class="w-16 h-16" alt="DeepChat Logo" />
        <h1 class="text-2xl font-bold">{{ t('login.welcome') }}</h1>
        <p class="text-muted-foreground text-sm text-center">
          {{ t('login.description') }}
        </p>
      </div>

      <!-- 登录方式Tabs -->
      <div class="border-b border-border">
        <div class="flex">
          <button
            v-for="tab in loginTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="pb-2 px-4 transition-all"
            :class="{
              'border-b-2 border-primary font-medium text-primary': activeTab === tab.id,
              'text-muted-foreground': activeTab !== tab.id
            }"
          >
            {{ t(tab.title) }}
          </button>
        </div>
      </div>

      <!-- 社交账号登录 -->
      <div v-if="activeTab === 'social'" class="space-y-4">
        <Button 
          variant="outline" 
          class="w-full flex items-center justify-center gap-2 h-10"
          @click="handleSocialLogin('google')"
        >
          <Icon icon="logos:google-icon" class="w-5 h-5" />
          {{ t('login.withGoogle') }}
        </Button>
        
        <Button 
          variant="outline" 
          class="w-full flex items-center justify-center gap-2 h-10"
          @click="handleSocialLogin('github')"
        >
          <Icon icon="mdi:github" class="w-5 h-5" />
          {{ t('login.withGithub') }}
        </Button>
        
        <Button 
          variant="outline" 
          class="w-full flex items-center justify-center gap-2 h-10"
          @click="handleSocialLogin('wechat')"
        >
          <Icon icon="ri:wechat-fill" class="w-5 h-5 text-green-600" />
          {{ t('login.withWechat') }}
        </Button>
      </div>

      <!-- 密码登录 -->
      <div v-if="activeTab === 'password'" class="space-y-4">
        <div class="space-y-2">
          <Label for="account">{{ t('login.accountLabel') }}</Label>
          <Input 
            id="account" 
            v-model="passwordForm.account" 
            type="text" 
            :placeholder="t('login.accountPlaceholder')"
          />
        </div>
        
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="password">{{ t('login.passwordLabel') }}</Label>
            <a href="#" class="text-xs text-primary hover:underline">
              {{ t('login.forgotPassword') }}
            </a>
          </div>
          <Input 
            id="password" 
            v-model="passwordForm.password" 
            type="password" 
            :placeholder="t('login.passwordPlaceholder')"
          />
        </div>
        
        <Button 
          type="submit" 
          class="w-full"
          :disabled="isLoading || !passwordForm.account || !passwordForm.password"
          @click="handlePasswordLogin"
        >
          <span v-if="isLoading" class="mr-2">
            <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
          </span>
          {{ t('login.loginButton') }}
        </Button>
      </div>

      <!-- 验证码登录 -->
      <div v-if="activeTab === 'code'" class="space-y-4">
        <div class="space-y-2">
          <Label for="phone">{{ t('login.phoneLabel') }}</Label>
          <Input 
            id="phone" 
            v-model="codeForm.phone" 
            type="text" 
            :placeholder="t('login.phonePlaceholder')"
          />
        </div>
        
        <div class="space-y-2">
          <Label for="code">{{ t('login.codeLabel') }}</Label>
          <div class="flex gap-2">
            <Input 
              id="code" 
              v-model="codeForm.code" 
              type="text" 
              :placeholder="t('login.codePlaceholder')"
              class="flex-1"
            />
            <Button 
              variant="outline" 
              class="w-32 whitespace-nowrap"
              :disabled="isCodeSending || !codeForm.phone || codeCountdown > 0"
              @click="handleSendCode"
            >
              <span v-if="isCodeSending" class="mr-2">
                <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
              </span>
              <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
              <span v-else>{{ t('login.sendCode') }}</span>
            </Button>
          </div>
        </div>
        
        <Button 
          type="submit" 
          class="w-full"
          :disabled="isLoading || !codeForm.phone || !codeForm.code"
          @click="handleCodeLogin"
        >
          <span v-if="isLoading" class="mr-2">
            <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
          </span>
          {{ t('login.loginButton') }}
        </Button>
      </div>

      <!-- 底部文字 -->
      <div class="text-center text-sm text-muted-foreground">
        {{ t('login.termsText') }}
        <a href="#" class="text-primary hover:underline">{{ t('login.termsLink') }}</a>
        {{ t('login.andText') }}
        <a href="#" class="text-primary hover:underline">{{ t('login.privacyLink') }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const userStore = useUserStore()

// 登录方式选项卡
const loginTabs = [
  { id: 'social', title: 'login.tabSocial' },
  { id: 'password', title: 'login.tabPassword' },
  { id: 'code', title: 'login.tabCode' }
]
const activeTab = ref('social')

// 表单状态
const passwordForm = ref({
  account: '',
  password: ''
})

const codeForm = ref({
  phone: '',
  code: ''
})

// 加载状态
const isLoading = ref(false)
const isCodeSending = ref(false)
const codeCountdown = ref(0)

// 初始检查登录状态
onMounted(async () => {
  const isLoggedIn = await authStore.checkIsLogin()
  if (isLoggedIn) {
    router.push({ name: 'chat' })
  }
})

// 社交账号登录
const handleSocialLogin = async (provider: 'google' | 'github' | 'wechat') => {
  const apiBaseUrl = await userStore.getApiBaseUrl()
  let authUrl = ''
  switch (provider) {
    case 'google':
      authUrl = `${apiBaseUrl}/oauth2/google`
      break
    case 'github':
      authUrl = `${apiBaseUrl}/oauth2/github`
      break
    case 'wechat':
      authUrl = `${apiBaseUrl}/oauth2/wechat/qrlogin`
      break
  }

  // 打开外部浏览器进行OAuth登录
  window.electron.ipcRenderer.send('open-external-url', authUrl)
}

// 密码登录
const handlePasswordLogin = async () => {
  if (isLoading.value) return
  
  try {
    isLoading.value = true
    const apiBaseUrl = userStore.getApiBaseUrl()
    
    // 模拟API请求
    console.log('密码登录：', {
      account: passwordForm.value.account,
      password: passwordForm.value.password,
      apiBaseUrl
    })

    // TODO: 实现实际的登录API调用
    // 以下为模拟代码，实际开发时应替换为真实的API调用
    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log('登录成功，获取token和用户信息')

    // 实际应用中，登录成功后会通过DeepLink方式回调并传递token
    // 这里仅作为测试，可以直接导航回聊天页面
    router.push({ name: 'chat' })
    
  } catch (error) {
    console.error('登录失败：', error)
    // 这里可以添加错误提示
  } finally {
    isLoading.value = false
  }
}

// 发送验证码
const handleSendCode = async () => {
  if (isCodeSending.value || !codeForm.value.phone) return
  
  try {
    isCodeSending.value = true
    const apiBaseUrl = userStore.getApiBaseUrl()
    
    // 模拟API请求
    console.log('发送验证码：', {
      phone: codeForm.value.phone,
      apiBaseUrl
    })

    // TODO: 实现实际的发送验证码API调用
    // 以下为模拟代码
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 开始倒计时
    codeCountdown.value = 60
    const timer = setInterval(() => {
      codeCountdown.value--
      if (codeCountdown.value <= 0) {
        clearInterval(timer)
      }
    }, 1000)
    
  } catch (error) {
    console.error('发送验证码失败：', error)
    // 这里可以添加错误提示
  } finally {
    isCodeSending.value = false
  }
}

// 验证码登录
const handleCodeLogin = async () => {
  if (isLoading.value) return
  
  try {
    isLoading.value = true
    const apiBaseUrl = userStore.getApiBaseUrl()
    
    // 模拟API请求
    console.log('验证码登录：', {
      phone: codeForm.value.phone,
      code: codeForm.value.code,
      apiBaseUrl
    })

    // TODO: 实现实际的登录API调用
    // 以下为模拟代码
    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log('登录成功，获取token和用户信息')

    // 登录成功后导航回聊天页面
    router.push({ name: 'chat' })
    
  } catch (error) {
    console.error('登录失败：', error)
    // 这里可以添加错误提示
  } finally {
    isLoading.value = false
  }
}
</script>
