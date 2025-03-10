import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Artifact 状态接口
 * 定义了应用中 Artifact 的数据结构
 */
export interface ArtifactState {
  id: string // Artifact 的唯一标识符
  type: string // 内容类型，如 'application/vnd.ant.code', 'text/markdown' 等
  title: string // Artifact 的显示标题
  content: string // Artifact 的实际内容
  status: 'loading' | 'loaded' | 'error' // Artifact 的加载状态：加载中/已加载/错误
}

/**
 * Artifact 状态管理 Store
 * 使用 Pinia 实现，负责管理应用中 Artifact 的全局状态
 */
export const useArtifactStore = defineStore('artifact', () => {
  // 响应式状态定义
  const currentArtifact = ref<ArtifactState | null>(null) // 当前正在查看的 Artifact
  const isOpen = ref(false) // Artifact 对话框是否打开
  const currentMessageId = ref<string | null>(null) // 当前 Artifact 所属的消息 ID
  const currentThreadId = ref<string | null>(null) // 当前 Artifact 所属的对话线程 ID

  /**
   * 显示 Artifact
   * 设置当前 Artifact 并打开查看界面
   *
   * @param artifact - 要显示的 Artifact 对象
   * @param messageId - Artifact 所属的消息 ID
   * @param threadId - Artifact 所属的对话线程 ID
   */
  const showArtifact = (artifact: ArtifactState, messageId: string, threadId: string) => {
    currentArtifact.value = artifact // 设置当前 Artifact
    currentMessageId.value = messageId // 记录所属消息 ID
    currentThreadId.value = threadId // 记录所属线程 ID
    isOpen.value = true // 打开查看界面
  }

  /**
   * 隐藏 Artifact
   * 清除当前 Artifact 并关闭查看界面
   */
  const hideArtifact = () => {
    currentArtifact.value = null // 清除当前 Artifact
    currentMessageId.value = null // 清除消息 ID
    currentThreadId.value = null // 清除线程 ID
    isOpen.value = false // 关闭查看界面
  }

  /**
   * 验证 Artifact 上下文
   * 检查当前 Artifact 是否属于指定的消息和线程
   *
   * @param messageId - 要验证的消息 ID
   * @param threadId - 要验证的线程 ID
   * @returns 如果当前 Artifact 属于指定消息和线程，则返回 true
   */
  const validateContext = (messageId: string, threadId: string) => {
    return currentMessageId.value === messageId && currentThreadId.value === threadId
  }

  // 返回 store 的状态和方法
  return {
    currentArtifact, // 当前 Artifact
    currentMessageId, // 当前消息 ID
    currentThreadId, // 当前线程 ID
    isOpen, // 是否显示 Artifact
    showArtifact, // 显示 Artifact 方法
    hideArtifact, // 隐藏 Artifact 方法
    validateContext // 验证上下文方法
  }
})
