import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  UserMessageContent,
  AssistantMessageBlock,
  AssistantMessage,
  UserMessage,
  Message
} from '@shared/chat'
import type { CONVERSATION, CONVERSATION_SETTINGS } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { CONVERSATION_EVENTS } from '@/events'
// import DeepSeekLogo from '@/assets/llm-icons/deepseek-color.svg'
// import BaiduLogo from '@/assets/llm-icons/baidu-color.svg'
// import GoogleLogo from '@/assets/llm-icons/google-color.svg'

/**
 * 聊天状态管理Store
 * 管理整个聊天界面的状态，包括对话线程、消息、配置等
 */
export const useChatStore = defineStore('chat', () => {
  // 获取线程Presenter实例，用于与主进程通信
  const threadP = usePresenter('threadPresenter')

  // ==================== 基础状态定义 ====================

  /**
   * 当前激活的对话线程ID
   * 标识用户当前正在查看/交互的对话
   */
  const activeThreadId = ref<string | null>(null)

  /**
   * 所有对话线程，按日期分组
   * 每组包含日期(dt)和该日期的对话线程列表(dtThreads)
   */
  const threads = ref<
    {
      dt: string
      dtThreads: CONVERSATION[]
    }[]
  >([])

  /**
   * 当前对话的消息列表
   * 包含用户消息和AI助手消息
   */
  const messages = ref<AssistantMessage[] | UserMessage[]>([])

  /**
   * 加载状态标志
   * 用于控制加载指示器的显示/隐藏
   */
  const isLoading = ref(false)

  /**
   * 正在生成回复的线程ID集合
   * 用于跟踪哪些对话正在等待AI响应
   */
  const generatingThreadIds = ref(new Set<string>())

  /**
   * 每页加载的消息/线程数量
   */
  const pageSize = ref(20)

  /**
   * 是否还有更多数据可加载
   */
  const hasMore = ref(true)

  /**
   * 侧边栏是否打开
   */
  const isSidebarOpen = ref(false)

  /**
   * 消息生成缓存
   * 存储正在生成中的消息，用于实时更新UI
   * key: 消息ID, value: 消息对象和线程ID
   */
  const generatingMessagesCache = ref<
    Map<
      string,
      {
        message: AssistantMessage | UserMessage
        threadId: string
      }
    >
  >(new Map())

  /**
   * 对话配置状态
   * 存储当前对话的各项设置参数
   */
  const chatConfig = ref<CONVERSATION_SETTINGS>({
    systemPrompt: '', // 系统提示词
    temperature: 0.7, // 温度参数(多样性)
    contextLength: 32000, // 上下文长度
    maxTokens: 8000, // 最大token数
    providerId: '', // 服务提供商ID
    modelId: '', // 模型ID
    artifacts: 0 // 是否启用artifacts特殊格式
  })

  // ==================== 计算属性 ====================

  /**
   * 当前激活的对话线程对象
   * 基于activeThreadId从所有线程中查找对应的线程
   */
  const activeThread = computed(() => {
    return threads.value.flatMap((t) => t.dtThreads).find((t) => t.id === activeThreadId.value)
  })

  // ==================== 线程相关方法 ====================

  /**
   * 加载对话线程列表
   * 从数据库获取对话线程并按日期分组
   *
   * @param page 页码，从1开始
   */
  const loadThreads = async (page: number) => {
    if (isLoading.value || (!hasMore.value && page !== 1)) {
      return
    }
    try {
      isLoading.value = true
      const result = await threadP.getConversationList(page, pageSize.value)

      // 按日期分组处理会话列表
      const groupedThreads: Map<string, CONVERSATION[]> = new Map()

      result.list.forEach((conv) => {
        const date = new Date(conv.createdAt).toISOString().split('T')[0]
        if (!groupedThreads.has(date)) {
          groupedThreads.set(date, [])
        }
        groupedThreads.get(date)?.push({
          ...conv
        })
      })

      // 转换为组件所需的数据结构
      const newThreads = Array.from(groupedThreads.entries()).map(([dt, dtThreads]) => ({
        dt,
        dtThreads
      }))

      // 判断是否还有更多数据
      hasMore.value = result.list.length === pageSize.value

      if (page === 1) {
        threads.value = newThreads
      } else {
        // 合并现有数据和新数据，需要处理同一天的数据
        newThreads.forEach((newThread) => {
          const existingThread = threads.value.find((t) => t.dt === newThread.dt)
          if (existingThread) {
            existingThread.dtThreads.push(...newThread.dtThreads)
          } else {
            threads.value.push(newThread)
          }
        })
        // 按日期排序
        threads.value.sort((a, b) => new Date(b.dt).getTime() - new Date(a.dt).getTime())
      }
    } catch (error) {
      console.error('加载会话列表失败:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 创建新的对话线程
   *
   * @param title 对话标题
   * @param settings 对话设置参数
   * @returns 新创建的对话线程ID
   */
  const createThread = async (title: string, settings: Partial<CONVERSATION_SETTINGS>) => {
    try {
      const threadId = await threadP.createConversation(title, settings)
      await loadThreads(1)
      return threadId
    } catch (error) {
      console.error('创建会话失败:', error)
      throw error
    }
  }

  /**
   * 设置当前激活的对话线程
   * 切换到指定的对话线程
   *
   * @param threadId 要激活的对话线程ID
   */
  const setActiveThread = async (threadId: string) => {
    try {
      await threadP.setActiveConversation(threadId)
      activeThreadId.value = threadId
      // 不需要在这里加载消息和配置，因为会在conversation-activated事件触发时加载
    } catch (error) {
      console.error('设置活动会话失败:', error)
      throw error
    }
  }

  /**
   * 清除当前激活的对话线程
   * 重置激活状态
   */
  const clearActiveThread = async () => {
    if (!activeThreadId.value) return
    await threadP.clearActiveThread()
    activeThreadId.value = null
  }

  /**
   * 重命名对话线程
   *
   * @param threadId 对话线程ID
   * @param title 新标题
   */
  const renameThread = async (threadId: string, title: string) => {
    await threadP.renameConversation(threadId, title)
    loadThreads(1)
  }

  // ==================== 消息相关方法 ====================

  /**
   * 使用额外信息丰富消息对象
   * 主要处理搜索结果等额外数据
   *
   * @param message 原始消息对象
   * @returns 丰富后的消息对象
   */
  const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
    if (
      Array.isArray((message as AssistantMessage).content) &&
      (message as AssistantMessage).content.some((block) => block.extra)
    ) {
      const attachments = await threadP.getMessageExtraInfo(message.id, 'search_result')
      // 更新消息中的 extra 信息
      ;(message as AssistantMessage).content = (message as AssistantMessage).content.map(
        (block) => {
          if (block.type === 'search' && block.extra) {
            return {
              ...block,
              extra: {
                ...block.extra,
                pages: attachments.map((attachment) => ({
                  title: attachment.title,
                  url: attachment.url,
                  content: attachment.content,
                  description: attachment.description,
                  icon: attachment.icon
                }))
              }
            }
          }
          return block
        }
      )
      // 处理变体消息的 extra 信息
      const assistantMessage = message as AssistantMessage
      if (assistantMessage.variants && assistantMessage.variants.length > 0) {
        assistantMessage.variants = await Promise.all(
          assistantMessage.variants.map((variant) => enrichMessageWithExtra(variant))
        )
      }
    }

    return message
  }

  /**
   * 加载当前对话的消息列表
   * 从数据库获取消息，并与缓存中的消息合并
   */
  const loadMessages = async () => {
    if (!activeThreadId.value) return

    try {
      const result = await threadP.getMessages(activeThreadId.value, 1, 100)
      // 合并数据库消息和缓存中的消息
      const mergedMessages = [...result.list]

      // 查找当前会话的缓存消息
      for (const [, cached] of generatingMessagesCache.value) {
        if (cached.threadId === activeThreadId.value) {
          const message = cached.message
          if (message.is_variant && message.parentId) {
            // 如果是变体消息，找到父消息并添加到其 variants 数组中
            const parentMsg = mergedMessages.find((m) => m.parentId === message.parentId)
            if (parentMsg) {
              if (!parentMsg.variants) {
                parentMsg.variants = []
              }
              const existingVariantIndex = parentMsg.variants.findIndex((v) => v.id === message.id)
              if (existingVariantIndex !== -1) {
                parentMsg.variants[existingVariantIndex] = await enrichMessageWithExtra(message)
              } else {
                parentMsg.variants.push(await enrichMessageWithExtra(message))
              }
            }
          } else {
            // 如果是非变体消息，直接更新或添加到消息列表
            const existingIndex = mergedMessages.findIndex((m) => m.id === message.id)
            if (existingIndex !== -1) {
              mergedMessages[existingIndex] = await enrichMessageWithExtra(message)
            } else {
              mergedMessages.push(await enrichMessageWithExtra(message))
            }
          }
        }
      }

      // 处理所有消息的 extra 信息
      messages.value = await Promise.all(mergedMessages.map((msg) => enrichMessageWithExtra(msg)))
    } catch (error) {
      console.error('加载消息失败:', error)
      throw error
    }
  }

  /**
   * 发送消息
   * 将用户消息发送到主进程并启动流式生成
   *
   * @param content 用户消息内容或助手消息块数组
   */
  const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
    if (!activeThreadId.value || !content) return

    try {
      generatingThreadIds.value.add(activeThreadId.value)
      const aiResponseMessage = await threadP.sendMessage(
        activeThreadId.value,
        JSON.stringify(content),
        'user'
      )

      // 将消息添加到缓存
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value
      })

      await loadMessages()
      await threadP.startStreamCompletion(activeThreadId.value)
    } catch (error) {
      console.error('发送消息失败:', error)
      throw error
    }
  }

  /**
   * 重试消息生成
   * 重新生成指定消息的回复
   *
   * @param messageId 要重试的消息ID
   */
  const retryMessage = async (messageId: string) => {
    if (!activeThreadId.value) return
    try {
      const aiResponseMessage = await threadP.retryMessage(messageId, chatConfig.value.modelId)
      // 将消息添加到缓存
      generatingMessagesCache.value.set(aiResponseMessage.id, {
        message: aiResponseMessage,
        threadId: activeThreadId.value
      })
      await loadMessages()
      await threadP.startStreamCompletion(activeThreadId.value, messageId)
    } catch (error) {
      console.error('重试消息失败:', error)
      throw error
    }
  }

  /**
   * 删除消息
   * 从数据库中删除指定消息
   *
   * @param messageId 要删除的消息ID
   */
  const deleteMessage = async (messageId: string) => {
    if (!activeThreadId.value) return
    try {
      await threadP.deleteMessage(messageId)
      loadMessages()
    } catch (error) {
      console.error('删除消息失败:', error)
    }
  }

  /**
   * 取消正在生成的消息
   * 停止流式生成过程
   *
   * @param threadId 对话线程ID
   */
  const cancelGenerating = async (threadId: string) => {
    if (!threadId) return
    try {
      // 找到当前正在生成的消息
      const generatingMessage = Array.from(generatingMessagesCache.value.entries()).find(
        ([, cached]) => cached.threadId === threadId
      )

      if (generatingMessage) {
        const [messageId] = generatingMessage
        await threadP.stopMessageGeneration(messageId)
        // 从缓存中移除消息
        generatingMessagesCache.value.delete(messageId)
        generatingThreadIds.value.delete(threadId)
        // 获取更新后的消息
        const updatedMessage = await threadP.getMessage(messageId)
        // 更新消息列表中的对应消息
        const messageIndex = messages.value.findIndex((msg) => msg.id === messageId)
        if (messageIndex !== -1) {
          messages.value[messageIndex] = updatedMessage
        }
      }
    } catch (error) {
      console.error('取消生成失败:', error)
    }
  }

  /**
   * 清空所有消息
   * 删除指定对话线程中的所有消息
   *
   * @param threadId 对话线程ID
   */
  const clearAllMessages = async (threadId: string) => {
    if (!threadId) return
    try {
      await threadP.clearAllMessages(threadId)
      // 清空本地消息列表
      if (threadId === activeThreadId.value) {
        messages.value = []
      }
      // 清空生成缓存中的相关消息
      for (const [messageId, cached] of generatingMessagesCache.value.entries()) {
        if (cached.threadId === threadId) {
          generatingMessagesCache.value.delete(messageId)
        }
      }
      generatingThreadIds.value.delete(threadId)
    } catch (error) {
      console.error('清空消息失败:', error)
      throw error
    }
  }

  // ==================== 流式响应处理 ====================

  /**
   * 处理流式响应
   * 更新缓存中的消息内容
   *
   * @param msg 流式响应消息对象
   */
  const handleStreamResponse = (msg: {
    eventId: string
    content?: string
    reasoning_content?: string
  }) => {
    // 从缓存中查找消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      const curMsg = cached.message as AssistantMessage
      if (curMsg.content) {
        // 处理普通内容
        if (msg.content) {
          const lastContentBlock = curMsg.content[curMsg.content.length - 1]
          if (lastContentBlock && lastContentBlock.type === 'content') {
            lastContentBlock.content += msg.content
          } else {
            if (lastContentBlock) {
              lastContentBlock.status = 'success'
            }
            curMsg.content.push({
              type: 'content',
              content: msg.content,
              status: 'loading',
              timestamp: Date.now()
            })
          }
        }

        // 处理推理内容
        if (msg.reasoning_content) {
          const lastReasoningBlock = curMsg.content[curMsg.content.length - 1]
          if (lastReasoningBlock && lastReasoningBlock.type === 'reasoning_content') {
            lastReasoningBlock.content += msg.reasoning_content
          } else {
            if (lastReasoningBlock) {
              lastReasoningBlock.status = 'success'
            }
            curMsg.content.push({
              type: 'reasoning_content',
              content: msg.reasoning_content,
              status: 'loading',
              timestamp: Date.now()
            })
          }
        }
      }

      // 如果是当前激活的会话，更新显示
      if (cached.threadId === activeThreadId.value) {
        const msgIndex = messages.value.findIndex((m) => m.id === msg.eventId)
        if (msgIndex !== -1) {
          messages.value[msgIndex] = curMsg
        }
      }
    }
  }

  /**
   * 处理流式响应结束
   * 更新消息状态并进行必要的后处理
   *
   * @param msg 流式响应结束消息对象
   */
  const handleStreamEnd = async (msg: { eventId: string }) => {
    // 从缓存中移除消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      // 获取最新的消息并处理 extra 信息
      const updatedMessage = await threadP.getMessage(msg.eventId)
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)

      // 如果是变体消息，需要更新主消息
      if (enrichedMessage.is_variant && enrichedMessage.parentId) {
        // 获取主消息
        const mainMessage = await threadP.getMainMessageByParentId(
          cached.threadId,
          enrichedMessage.parentId
        )

        if (mainMessage) {
          const enrichedMainMessage = await enrichMessageWithExtra(mainMessage)
          // 如果是当前激活的会话，更新显示
          if (cached.threadId === activeThreadId.value) {
            const mainMsgIndex = messages.value.findIndex((m) => m.id === mainMessage.id)
            if (mainMsgIndex !== -1) {
              messages.value[mainMsgIndex] = enrichedMainMessage
            }
          }
        }
      } else {
        // 如果是当前激活的会话，更新显示
        if (cached.threadId === activeThreadId.value) {
          const msgIndex = messages.value.findIndex((m) => m.id === msg.eventId)
          if (msgIndex !== -1) {
            messages.value[msgIndex] = enrichedMessage
          }
        }
      }

      // 检查是否需要更新标题（仅在对话刚开始时）
      if (cached.threadId === activeThreadId.value) {
        const thread = await threadP.getConversation(cached.threadId)
        const { list: messages } = await threadP.getMessages(cached.threadId, 1, 10)
        // 只有当对话刚开始（只有一问一答两条消息）时才生成标题
        if (messages.length === 2 && thread && thread.is_new === 1) {
          try {
            console.info('自动生成标题 start', messages.length, thread)
            await threadP.summaryTitles().then(async (title) => {
              if (title) {
                console.info('自动生成标题', title)
                await threadP.renameConversation(cached.threadId, title)
                // 重新加载会话列表以更新标题
                await loadThreads(1)
              }
            })
          } catch (error) {
            console.error('自动生成标题失败:', error)
          }
        }
      }
      loadThreads(1)
    }
  }

  /**
   * 处理流式响应错误
   * 更新消息状态为错误状态
   *
   * @param msg 流式响应错误消息对象
   */
  const handleStreamError = async (msg: { eventId: string }) => {
    // 从缓存中获取消息
    const cached = generatingMessagesCache.value.get(msg.eventId)
    if (cached) {
      if (cached.threadId === activeThreadId.value) {
        try {
          const updatedMessage = await threadP.getMessage(msg.eventId)
          const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

          if (enrichedMessage.is_variant && enrichedMessage.parentId) {
            // 处理变体消息的错误状态
            const parentMsgIndex = messages.value.findIndex(
              (m) => m.id === enrichedMessage.parentId
            )
            if (parentMsgIndex !== -1) {
              const parentMsg = messages.value[parentMsgIndex] as AssistantMessage
              if (!parentMsg.variants) {
                parentMsg.variants = []
              }
              const variantIndex = parentMsg.variants.findIndex((v) => v.id === enrichedMessage.id)
              if (variantIndex !== -1) {
                parentMsg.variants[variantIndex] = enrichedMessage
              } else {
                parentMsg.variants.push(enrichedMessage)
              }
              messages.value[parentMsgIndex] = { ...parentMsg }
            }
          } else {
            // 非变体消息的原有错误处理逻辑
            const messageIndex = messages.value.findIndex((m) => m.id === msg.eventId)
            if (messageIndex !== -1) {
              messages.value[messageIndex] = enrichedMessage
            }
          }
        } catch (error) {
          console.error('加载错误消息失败:', error)
        }
      }
      generatingMessagesCache.value.delete(msg.eventId)
      generatingThreadIds.value.delete(cached.threadId)
    }
  }

  /**
   * 处理消息编辑事件
   * 更新缓存和当前显示的消息
   *
   * @param msgId 被编辑的消息ID
   */
  const handleMessageEdited = async (msgId: string) => {
    // 首先检查是否在生成缓存中
    const cached = generatingMessagesCache.value.get(msgId)
    if (cached) {
      // 如果在缓存中，获取最新的消息
      const updatedMessage = await threadP.getMessage(msgId)
      // 处理 extra 信息
      const enrichedMessage = await enrichMessageWithExtra(updatedMessage)

      // 更新缓存
      cached.message = enrichedMessage

      // 如果是当前会话的消息，也更新显示
      if (cached.threadId === activeThreadId.value) {
        const msgIndex = messages.value.findIndex((m) => m.id === msgId)
        if (msgIndex !== -1) {
          messages.value[msgIndex] = enrichedMessage
        }
      }
    } else if (activeThreadId.value) {
      // 如果不在缓存中但是当前会话的消息，直接更新显示
      const msgIndex = messages.value.findIndex((m) => m.id === msgId)
      if (msgIndex !== -1) {
        const updatedMessage = await threadP.getMessage(msgId)
        // 处理 extra 信息
        const enrichedMessage = await enrichMessageWithExtra(updatedMessage)
        messages.value[msgIndex] = enrichedMessage
      }
    }
  }

  // ==================== 配置相关方法 ====================

  /**
   * 加载对话配置
   * 从数据库获取当前对话的配置信息
   */
  const loadChatConfig = async () => {
    if (!activeThreadId.value) return
    try {
      const conversation = await threadP.getConversation(activeThreadId.value)
      const threadToUpdate = threads.value
        .flatMap((thread) => thread.dtThreads)
        .find((t) => t.id === activeThreadId.value)
      if (threadToUpdate) {
        Object.assign(threadToUpdate, conversation)
      }
      if (conversation) {
        chatConfig.value = { ...conversation.settings }
      }
    } catch (error) {
      console.error('加载对话配置失败:', error)
      throw error
    }
  }

  /**
   * 保存对话配置
   * 将当前配置保存到数据库
   */
  const saveChatConfig = async () => {
    if (!activeThreadId.value) return
    try {
      await threadP.updateConversationSettings(activeThreadId.value, chatConfig.value)
    } catch (error) {
      console.error('保存对话配置失败:', error)
      throw error
    }
  }

  /**
   * 更新对话配置
   * 合并新配置并保存
   *
   * @param newConfig 新的配置项
   */
  const updateChatConfig = async (newConfig: Partial<CONVERSATION_SETTINGS>) => {
    chatConfig.value = { ...chatConfig.value, ...newConfig }
    await saveChatConfig()
    await loadChatConfig() // 加载对话配置以确保一致性
  }

  // ==================== 事件监听器 ====================

  /**
   * 监听会话激活事件
   * 当主进程通知渲染进程会话被激活时触发
   */
  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
    activeThreadId.value = msg.conversationId
    loadMessages()
    loadChatConfig() // 加载对话配置
  })

  /**
   * 监听消息编辑事件
   * 当消息被编辑时更新UI
   */
  window.electron.ipcRenderer.on(CONVERSATION_EVENTS.MESSAGE_EDITED, (_, msgId: string) => {
    handleMessageEdited(msgId)
  })

  // 返回store的状态和方法
  return {
    // 状态
    isSidebarOpen,
    activeThreadId,
    threads,
    messages,
    isLoading,
    hasMore,
    generatingMessagesCache,
    generatingThreadIds,
    // 计算属性
    activeThread,
    // 线程相关方法
    loadThreads,
    createThread,
    setActiveThread,
    renameThread,
    clearActiveThread,
    // 消息相关方法
    loadMessages,
    sendMessage,
    retryMessage,
    deleteMessage,
    clearAllMessages,
    // 流式响应处理方法
    handleStreamResponse,
    handleStreamEnd,
    handleStreamError,
    handleMessageEdited,
    // 配置相关方法
    chatConfig,
    loadChatConfig,
    saveChatConfig,
    updateChatConfig,
    // 其他方法
    cancelGenerating
  }
})
