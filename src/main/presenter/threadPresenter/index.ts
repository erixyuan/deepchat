/**
 * ThreadPresenter 类实现
 *
 * 该文件实现了应用程序的会话和消息管理核心功能，是聊天应用的主要控制器。
 * 负责处理用户与AI助手之间的对话、消息生成、搜索等功能。
 * 遵循Electron项目中的主进程-渲染进程通信架构。
 */

import {
  IThreadPresenter,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  MESSAGE_METADATA,
  SearchResult,
  MODEL_META,
  ISQLitePresenter,
  IConfigPresenter,
  ILlmProviderPresenter,
  MCPToolResponse,
  ChatMessage,
  ChatMessageContent,
  LLMAgentEventData
} from '../../../shared/presenter'
import { presenter } from '@/presenter'
import { MessageManager } from './messageManager'
import { eventBus } from '@/eventbus'
import {
  AssistantMessage,
  Message,
  AssistantMessageBlock,
  SearchEngineTemplate,
  UserMessage,
  MessageFile,
  UserMessageContent,
  UserMessageTextBlock,
  UserMessageMentionBlock
} from '@shared/chat'
import { approximateTokenSize } from 'tokenx'
import { generateSearchPrompt, SearchManager } from './searchManager'
import { getFileContext } from './fileContext'
import { ContentEnricher } from './contentEnricher'
import { CONVERSATION_EVENTS, STREAM_EVENTS } from '@/events'
import { DEFAULT_SETTINGS } from './const'

/**
 * 正在生成消息的状态接口
 * 用于跟踪AI消息生成的各个阶段和状态信息
 */
interface GeneratingMessageState {
  message: AssistantMessage        // 正在生成的助手消息对象
  conversationId: string           // 所属会话ID
  startTime: number                // 开始生成的时间戳
  firstTokenTime: number | null    // 生成第一个token的时间戳
  promptTokens: number             // prompt使用的token数量
  reasoningStartTime: number | null // 推理开始时间
  reasoningEndTime: number | null  // 推理结束时间
  lastReasoningTime: number | null // 最后推理时间
  isSearching?: boolean            // 是否正在搜索
  isCancelled?: boolean            // 是否已取消
  totalUsage?: {                   // token使用统计
    prompt_tokens: number          // 提示token数
    completion_tokens: number      // 完成token数
    total_tokens: number           // 总token数
  }
}

/**
 * 线程表示层类 - 实现对话和消息管理的核心功能
 *
 * 该类负责处理以下主要功能：
 * 1. 会话管理（创建、获取、删除、更新会话）
 * 2. 消息管理（发送、编辑、重试消息）
 * 3. AI生成流程控制（开始生成、继续生成、取消生成）
 * 4. 搜索功能（网络搜索、引擎管理）
 * 5. 消息上下文管理（获取历史消息、上下文消息）
 *
 * 实现了IThreadPresenter接口，作为应用程序中会话和消息的主要控制器
 */
export class ThreadPresenter implements IThreadPresenter {
  /** 当前活动会话ID */
  private activeConversationId: string | null = null
  /** SQLite数据库访问接口 */
  private sqlitePresenter: ISQLitePresenter
  /** 消息管理器，用于处理消息的CRUD操作 */
  private messageManager: MessageManager
  /** LLM提供商接口，用于与AI模型交互 */
  private llmProviderPresenter: ILlmProviderPresenter
  /** 配置管理接口，用于获取应用设置 */
  private configPresenter: IConfigPresenter
  /** 搜索管理器，用于处理网络搜索功能 */
  private searchManager: SearchManager
  /** 正在生成的消息映射表，键为消息ID */
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  /** 搜索助手使用的模型元数据 */
  public searchAssistantModel: MODEL_META | null = null
  /** 搜索助手使用的提供商ID */
  public searchAssistantProviderId: string | null = null
  /** 正在搜索的消息ID集合 */
  private searchingMessages: Set<string> = new Set()

  /**
   * 构造函数
   *
   * @param sqlitePresenter SQLite数据库访问接口
   * @param llmProviderPresenter LLM提供商接口
   * @param configPresenter 配置管理接口
   */
  constructor(
    sqlitePresenter: ISQLitePresenter,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter
  ) {
    this.sqlitePresenter = sqlitePresenter
    this.messageManager = new MessageManager(sqlitePresenter)
    this.llmProviderPresenter = llmProviderPresenter
    this.searchManager = new SearchManager()
    this.configPresenter = configPresenter

    // 初始化时处理所有未完成的消息
    this.messageManager.initializeUnfinishedMessages()
  }

  /**
   * 处理LLM代理错误事件
   * 当AI模型生成过程中出现错误时调用
   *
   * @param msg LLM事件数据，包含错误信息
   */
  async handleLLMAgentError(msg: LLMAgentEventData) {
    const { eventId, error } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      await this.messageManager.handleMessageError(eventId, String(error))
      this.generatingMessages.delete(eventId)
    }
    eventBus.emit(STREAM_EVENTS.ERROR, msg)
  }

  /**
   * 处理LLM代理结束事件
   * 当AI模型完成生成或用户停止生成时调用
   * 负责计算token使用量，更新消息状态和元数据
   *
   * @param msg LLM事件数据，包含生成结束的相关信息
   */
  async handleLLMAgentEnd(msg: LLMAgentEventData) {
    const { eventId, userStop } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      // 将所有内容块标记为成功状态
      state.message.content.forEach((block) => {
        block.status = 'success'
      })

      // 计算completion tokens
      let completionTokens = 0
      if (state.totalUsage) {
        completionTokens = state.totalUsage.completion_tokens
      } else {
        // 如果没有直接提供，则自行计算
        for (const block of state.message.content) {
          if (
            block.type === 'content' ||
            block.type === 'reasoning_content' ||
            block.type === 'tool_call'
          ) {
            completionTokens += approximateTokenSize(block.content)
          }
        }
      }

      // 检查是否有内容块
      const hasContentBlock = state.message.content.some(
        (block) =>
          block.type === 'content' ||
          block.type === 'reasoning_content' ||
          block.type === 'tool_call' ||
          block.type === 'image'
      )

      // 如果没有内容块且非用户停止，添加错误信息
      if (!hasContentBlock && !userStop) {
        state.message.content.push({
          type: 'error',
          content: 'common.error.noModelResponse',
          status: 'error',
          timestamp: Date.now()
        })
      }

      // 计算性能指标
      const totalTokens = state.promptTokens + completionTokens
      const generationTime = Date.now() - (state.firstTokenTime ?? state.startTime)
      const tokensPerSecond = completionTokens / (generationTime / 1000)

      // 准备元数据
      const metadata: Partial<MESSAGE_METADATA> = {
        totalTokens,
        inputTokens: state.promptTokens,
        outputTokens: completionTokens,
        generationTime,
        firstTokenTime: state.firstTokenTime ? state.firstTokenTime - state.startTime : 0,
        tokensPerSecond
      }

      // 如果有推理内容，记录推理时间
      if (state.reasoningStartTime !== null && state.lastReasoningTime !== null) {
        metadata.reasoningStartTime = state.reasoningStartTime - state.startTime
        metadata.reasoningEndTime = state.lastReasoningTime - state.startTime
      }

      // 更新消息的使用信息并标记为已发送
      await this.messageManager.updateMessageMetadata(eventId, metadata)
      await this.messageManager.updateMessageStatus(eventId, 'sent')
      await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))

      // 清理生成状态
      this.generatingMessages.delete(eventId)

      // 更新会话的最后修改时间
      this.sqlitePresenter
        .updateConversation(state.conversationId, {
          updatedAt: Date.now()
        })
        .then(() => {
          console.log('updated conv time', state.conversationId)
        })
    }
    // 发送结束事件
    eventBus.emit(STREAM_EVENTS.END, msg)
  }

  /**
   * 处理LLM代理响应事件
   * 当AI模型生成内容时调用，处理各种类型的响应（文本、推理、工具调用、图像等）
   *
   * @param msg LLM事件数据，包含生成的内容和相关信息
   */
  async handleLLMAgentResponse(msg: LLMAgentEventData) {
    const {
      eventId,
      content,
      reasoning_content,
      tool_call_id,
      tool_call_name,
      tool_call_params,
      tool_call_response,
      maximum_tool_calls_reached,
      tool_call_server_name,
      tool_call_server_icons,
      tool_call_server_description,
      tool_call_response_raw,
      tool_call,
      totalUsage,
      image_data
    } = msg
    const state = this.generatingMessages.get(eventId)
    if (state) {
      // 记录第一个token的时间
      if (state.firstTokenTime === null && (content || reasoning_content)) {
        state.firstTokenTime = Date.now()
        await this.messageManager.updateMessageMetadata(eventId, {
          firstTokenTime: Date.now() - state.startTime
        })
      }
      // 更新token使用情况
      if (totalUsage) {
        state.totalUsage = totalUsage
        state.promptTokens = totalUsage.prompt_tokens
      }

      // 处理工具调用达到最大次数的情况
      if (maximum_tool_calls_reached) {
        const lastBlock = state.message.content[state.message.content.length - 1]
        if (lastBlock) {
          lastBlock.status = 'success'
        }
        // 添加工具调用达到上限的行动块
        state.message.content.push({
          type: 'action',
          content: 'common.error.maximumToolCallsReached',
          status: 'success',
          timestamp: Date.now(),
          action_type: 'maximum_tool_calls_reached',
          tool_call: {
            id: tool_call_id,
            name: tool_call_name,
            params: tool_call_params,
            server_name: tool_call_server_name,
            server_icons: tool_call_server_icons,
            server_description: tool_call_server_description
          },
          extra: {
            needContinue: true // 指示需要继续生成
          }
        })
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        return
      }

      // 处理推理内容的时间戳
      if (reasoning_content) {
        if (state.reasoningStartTime === null) {
          state.reasoningStartTime = Date.now()
          await this.messageManager.updateMessageMetadata(eventId, {
            reasoningStartTime: Date.now() - state.startTime
          })
        }
        state.lastReasoningTime = Date.now()
      }

      const lastBlock = state.message.content[state.message.content.length - 1]

      // 检查tool_call_response_raw中是否包含搜索结果
      if (tool_call_response_raw && tool_call === 'end') {
        try {
          // 检查返回的内容中是否有deepchat-webpage类型的资源
          const hasSearchResults = tool_call_response_raw.content?.some(
            (item: { type: string; resource?: { mimeType: string } }) =>
              item?.type === 'resource' &&
              item?.resource?.mimeType === 'application/deepchat-webpage'
          )

          if (hasSearchResults) {
            // 解析搜索结果 - 从工具调用响应中提取网页资源
            const searchResults = tool_call_response_raw.content
              .filter(
                (item: {
                  type: string
                  resource?: { mimeType: string; text: string; uri?: string }
                }) =>
                  item.type === 'resource' &&
                  item.resource?.mimeType === 'application/deepchat-webpage'
              )
              .map((item: { resource: { text: string; uri?: string } }) => {
                try {
                  // 解析每个网页资源的内容
                  const blobContent = JSON.parse(item.resource.text) as {
                    title?: string
                    url?: string
                    content?: string
                    icon?: string
                  }
                  return {
                    title: blobContent.title || '',
                    url: blobContent.url || item.resource.uri || '',
                    content: blobContent.content || '',
                    description: blobContent.content || '',
                    icon: blobContent.icon || ''
                  }
                } catch (e) {
                  console.error('解析搜索结果失败:', e)
                  return null
                }
              })
              .filter(Boolean) // 过滤掉解析失败的结果

            if (searchResults.length > 0) {
              // 检查消息中是否已经存在搜索块
              const existingSearchBlock =
                state.message.content.length > 0 && state.message.content[0].type === 'search'
                  ? state.message.content[0]
                  : null

              if (existingSearchBlock) {
                // 更新现有搜索块的状态和结果数量
                existingSearchBlock.status = 'success'
                existingSearchBlock.timestamp = Date.now()
                if (existingSearchBlock.extra) {
                  // 累加搜索结果数量
                  existingSearchBlock.extra.total =
                    (existingSearchBlock.extra.total || 0) + searchResults.length
                } else {
                  existingSearchBlock.extra = {
                    total: searchResults.length
                  }
                }
              } else {
                // 创建新的搜索块并添加到消息内容的开头
                const searchBlock: AssistantMessageBlock = {
                  type: 'search',
                  content: '',
                  status: 'success',
                  timestamp: Date.now(),
                  extra: {
                    total: searchResults.length
                  }
                }
                state.message.content.unshift(searchBlock)
              }

              // 保存搜索结果到消息附件
              for (const result of searchResults) {
                await this.sqlitePresenter.addMessageAttachment(
                  eventId,
                  'search_result',
                  JSON.stringify(result)
                )
              }

              // 更新消息内容
              await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
            }
          }
        } catch (error) {
          console.error('处理搜索结果时出错:', error)
        }
      }

      // 处理工具调用
      if (tool_call) {
        if (tool_call === 'start') {
          // 创建新的工具调用块，标记开始工具调用
          if (lastBlock) {
            lastBlock.status = 'success'
          }

          state.message.content.push({
            type: 'tool_call',
            content: '',
            status: 'loading',
            timestamp: Date.now(),
            tool_call: {
              id: tool_call_id,
              name: tool_call_name,
              params: tool_call_params || '',
              server_name: tool_call_server_name,
              server_icons: tool_call_server_icons,
              server_description: tool_call_server_description
            }
          })
        } else if (tool_call === 'end' || tool_call === 'error') {
          // 查找对应的工具调用块
          const toolCallBlock = state.message.content.find(
            (block) =>
              block.type === 'tool_call' &&
              ((tool_call_id && block.tool_call?.id === tool_call_id) ||
                block.tool_call?.name === tool_call_name) &&
              block.status === 'loading'
          )

          if (toolCallBlock && toolCallBlock.type === 'tool_call') {
            if (tool_call === 'error') {
              // 处理工具调用失败
              toolCallBlock.status = 'error'
              if (toolCallBlock.tool_call) {
                if (typeof tool_call_response === 'string') {
                  toolCallBlock.tool_call.response = tool_call_response || '执行失败'
                } else {
                  toolCallBlock.tool_call.response = JSON.stringify(tool_call_response)
                }
              }
            } else {
              // 处理工具调用成功
              toolCallBlock.status = 'success'
              if (toolCallBlock.tool_call) {
                if (typeof tool_call_response === 'string') {
                  toolCallBlock.tool_call.response = tool_call_response
                } else {
                  toolCallBlock.tool_call.response = JSON.stringify(tool_call_response)
                }
              }
            }
          }
        }
      } else if (image_data) {
        // 处理图像数据 - 创建新的图像块
        if (lastBlock) {
          lastBlock.status = 'success'
        }
        state.message.content.push({
          type: 'image',
          content: 'image',
          status: 'success',
          timestamp: Date.now(),
          image_data: image_data
        })
      } else if (content) {
        // 处理普通文本内容
        if (lastBlock && lastBlock.type === 'content') {
          // 如果上一个块是文本，则追加内容
          lastBlock.content += content
        } else {
          // 否则创建新的文本块
          if (lastBlock) {
            lastBlock.status = 'success'
          }
          state.message.content.push({
            type: 'content',
            content: content,
            status: 'loading',
            timestamp: Date.now()
          })
        }
      }

      // 处理推理内容
      if (reasoning_content) {
        if (lastBlock && lastBlock.type === 'reasoning_content') {
          // 如果上一个块是推理内容，则追加
          lastBlock.content += reasoning_content
        } else {
          // 否则创建新的推理内容块
          if (lastBlock) {
            lastBlock.status = 'success'
          }
          state.message.content.push({
            type: 'reasoning_content',
            content: reasoning_content,
            status: 'loading',
            timestamp: Date.now()
          })
        }
      }

      // 更新消息内容
      await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
    }
    // 发送响应事件
    eventBus.emit(STREAM_EVENTS.RESPONSE, msg)
  }

  /**
   * 设置搜索助手使用的模型和提供商
   *
   * @param model 模型元数据
   * @param providerId 提供商ID
   */
  setSearchAssistantModel(model: MODEL_META, providerId: string) {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
  }

  /**
   * 获取所有可用的搜索引擎
   *
   * @returns 搜索引擎模板列表
   */
  async getSearchEngines(): Promise<SearchEngineTemplate[]> {
    return this.searchManager.getEngines()
  }

  /**
   * 获取当前活动的搜索引擎
   *
   * @returns 当前活动的搜索引擎模板
   */
  async getActiveSearchEngine(): Promise<SearchEngineTemplate> {
    return this.searchManager.getActiveEngine()
  }

  /**
   * 设置活动搜索引擎
   *
   * @param engineId 搜索引擎ID
   */
  async setActiveSearchEngine(engineId: string): Promise<void> {
    await this.searchManager.setActiveEngine(engineId)
  }

  /**
   * 测试当前选择的搜索引擎
   * 打开搜索窗口并执行测试查询
   *
   * @param query 测试搜索的关键词，默认为"天气"
   * @returns 测试是否成功打开窗口
   */
  async testSearchEngine(query: string = '天气'): Promise<boolean> {
    return await this.searchManager.testSearch(query)
  }

  /**
   * 设置搜索引擎
   *
   * @param engineId 搜索引擎ID
   * @returns 是否设置成功
   */
  async setSearchEngine(engineId: string): Promise<boolean> {
    try {
      return await this.searchManager.setActiveEngine(engineId)
    } catch (error) {
      console.error('设置搜索引擎失败:', error)
      return false
    }
  }

  /**
   * 重命名会话
   *
   * @param conversationId 会话ID
   * @param title 新标题
   * @returns 更新后的会话对象
   */
  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.renameConversation(conversationId, title)
  }

  /**
   * 创建新会话
   * 如果存在空会话，则重用该会话
   *
   * @param title 会话标题
   * @param settings 会话设置
   * @returns 会话ID
   */
  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    console.log('createConversation', title, settings)
    // 检查是否有最新的空会话可以重用
    const latestConversation = await this.getLatestConversation()

    if (latestConversation) {
      const { list: messages } = await this.getMessages(latestConversation.id, 1, 1)
      if (messages.length === 0) {
        // 如果最新会话没有消息，直接使用该会话
        await this.setActiveConversation(latestConversation.id)
        return latestConversation.id
      }
    }

    // 准备会话设置
    let defaultSettings = DEFAULT_SETTINGS
    if (latestConversation?.settings) {
      // 从最近会话继承设置，但不继承系统提示
      defaultSettings = { ...latestConversation.settings }
      defaultSettings.systemPrompt = ''
    }

    // 清理无效设置
    Object.keys(settings).forEach((key) => {
      if (settings[key] === undefined || settings[key] === null || settings[key] === '') {
        delete settings[key]
      }
    })

    // 合并设置
    const mergedSettings = { ...defaultSettings, ...settings }

    // 应用模型默认设置
    const defaultModelsSettings = this.configPresenter.getModelConfig(mergedSettings.modelId)
    if (defaultModelsSettings) {
      mergedSettings.maxTokens = defaultModelsSettings.maxTokens
      mergedSettings.contextLength = defaultModelsSettings.contextLength
      mergedSettings.temperature = defaultModelsSettings.temperature
    }

    // 应用特定设置覆盖
    if (settings.artifacts) {
      mergedSettings.artifacts = settings.artifacts
    }
    if (settings.maxTokens) {
      mergedSettings.maxTokens = settings.maxTokens
    }
    if (settings.temperature) {
      mergedSettings.temperature = settings.temperature
    }
    if (settings.contextLength) {
      mergedSettings.contextLength = settings.contextLength
    }
    if (settings.systemPrompt) {
      mergedSettings.systemPrompt = settings.systemPrompt
    }

    // 创建会话并设为活动
    const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)
    await this.setActiveConversation(conversationId)
    return conversationId
  }

  /**
   * 删除会话
   *
   * @param conversationId 会话ID
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
    // 如果删除的是当前活动会话，清除活动会话引用
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = null
    }
  }

  /**
   * 获取会话详情
   *
   * @param conversationId 会话ID
   * @returns 会话对象
   */
  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  /**
   * 切换会话置顶状态
   *
   * @param conversationId 会话ID
   * @param pinned 是否置顶
   */
  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { is_pinned: pinned ? 1 : 0 })
  }

  /**
   * 更新会话标题
   *
   * @param conversationId 会话ID
   * @param title 新标题
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
  }

  /**
   * 更新会话设置
   * 当模型变更时，会自动应用新模型的默认设置
   *
   * @param conversationId 会话ID
   * @param settings 要更新的设置
   */
  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings }

    // 合并新设置
    for (const key in settings) {
      if (settings[key] !== undefined) {
        mergedSettings[key] = settings[key]
      }
    }
    console.log('updateConversationSettings', mergedSettings)

    // 检查是否有模型ID的变化
    if (settings.modelId && settings.modelId !== conversation.settings.modelId) {
      // 获取新模型的配置
      const modelConfig = this.configPresenter.getModelConfig(
        mergedSettings.modelId,
        mergedSettings.providerId
      )
      console.log('check model default config', modelConfig)
      if (modelConfig) {
        // 应用模型的默认设置
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    // 保存更新后的设置
    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
  }

  /**
   * 获取会话列表
   *
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 会话总数和会话列表
   */
  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  /**
   * 设置活动会话
   *
   * @param conversationId 会话ID
   * @throws 如果会话不存在则抛出错误
   */
  async setActiveConversation(conversationId: string): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    if (conversation) {
      this.activeConversationId = conversationId
      eventBus.emit(CONVERSATION_EVENTS.ACTIVATED, { conversationId })
    } else {
      throw new Error(`Conversation ${conversationId} not found`)
    }
  }

  /**
   * 获取当前活动会话
   *
   * @returns 活动会话对象，如果没有则返回null
   */
  async getActiveConversation(): Promise<CONVERSATION | null> {
    if (!this.activeConversationId) {
      return null
    }
    return this.getConversation(this.activeConversationId)
  }

  /**
   * 获取会话中的消息
   *
   * @param conversationId 会话ID
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 消息总数和消息列表
   */
  async getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return await this.messageManager.getMessageThread(conversationId, page, pageSize)
  }

  /**
   * 获取会话上下文消息
   * 根据会话的上下文长度设置，获取适当数量的历史消息
   * 确保消息列表以用户消息开始
   *
   * @param conversationId 会话ID
   * @returns 上下文消息列表
   */
  async getContextMessages(conversationId: string): Promise<Message[]> {
    const conversation = await this.getConversation(conversationId)
    // 计算需要获取的消息数量（假设每条消息平均300字）
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    const messages = await this.messageManager.getContextMessages(conversationId, messageCount)

    // 确保消息列表以用户消息开始
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift()
    }

    // 格式化用户消息内容
    return messages.map((msg) => {
      if (msg.role === 'user') {
        const newMsg = { ...msg }
        const msgContent = newMsg.content as UserMessageContent
        if (msgContent.content) {
          ;(newMsg.content as UserMessageContent).text = this.formatUserMessageContent(
            msgContent.content
          )
        }
        return newMsg
      } else {
        return msg
      }
    })
  }

  /**
   * 格式化用户消息内容
   * 将复杂的消息块结构转换为纯文本
   *
   * @param msgContentBlock 消息内容块数组
   * @returns 格式化后的纯文本内容
   */
  private formatUserMessageContent(
    msgContentBlock: (UserMessageTextBlock | UserMessageMentionBlock)[]
  ) {
    return msgContentBlock
      .map((block) => {
        if (block.type === 'mention') {
          // 处理@提及类型的内容
          if (block.category === 'resources') {
            return `@${block.content}`
          } else if (block.category === 'tools') {
            return `@${block.id}`
          } else if (block.category === 'files') {
            return `@${block.id}`
          }
          return `@${block.id}`
        } else if (block.type === 'text') {
          // 处理文本类型的内容
          return block.content
        }
        return ''
      })
      .join('')
  }

  /**
   * 清除会话上下文
   * 删除会话中的所有消息
   *
   * @param conversationId 会话ID
   */
  async clearContext(conversationId: string): Promise<void> {
    await this.sqlitePresenter.runTransaction(async () => {
      const conversation = await this.getConversation(conversationId)
      if (conversation) {
        await this.sqlitePresenter.deleteAllMessages()
      }
    })
  }

  /**
   * 发送消息
   * 如果是用户消息，会自动生成AI响应
   *
   * @param conversationId 会话ID
   * @param content 消息内容
   * @param role 消息角色
   * @returns 如果是用户消息，返回AI生成的消息；否则返回null
   */
  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE
  ): Promise<AssistantMessage | null> {
    const conversation = await this.getConversation(conversationId)
    const { providerId, modelId } = conversation.settings
    console.log('sendMessage', conversation)

    // 创建消息
    const message = await this.messageManager.sendMessage(
      conversationId,
      content,
      role,
      '',
      false,
      {
        totalTokens: 0,
        generationTime: 0,
        firstTokenTime: 0,
        tokensPerSecond: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: modelId,
        provider: providerId
      }
    )

    // 如果是用户消息，生成AI响应
    if (role === 'user') {
      const assistantMessage = await this.generateAIResponse(conversationId, message.id)
      this.generatingMessages.set(assistantMessage.id, {
        message: assistantMessage,
        conversationId,
        startTime: Date.now(),
        firstTokenTime: null,
        promptTokens: 0,
        reasoningStartTime: null,
        reasoningEndTime: null,
        lastReasoningTime: null
      })

      // 检查是否是新会话的第一条消息
      const { list: messages } = await this.getMessages(conversationId, 1, 2)
      if (messages.length === 1) {
        // 更新会话的 is_new 标志位
        await this.sqlitePresenter.updateConversation(conversationId, {
          is_new: 0,
          updatedAt: Date.now()
        })
      } else {
        await this.sqlitePresenter.updateConversation(conversationId, {
          updatedAt: Date.now()
        })
      }

      return assistantMessage
    }

    return null
  }

  /**
   * 为用户消息生成AI响应
   *
   * @param conversationId 会话ID
   * @param userMessageId 用户消息ID
   * @returns 生成的助手消息
   * @throws 如果生成失败，抛出错误
   */
  private async generateAIResponse(conversationId: string, userMessageId: string) {
    try {
      // 获取触发消息
      const triggerMessage = await this.messageManager.getMessage(userMessageId)
      if (!triggerMessage) {
        throw new Error('找不到触发消息')
      }

      // 更新用户消息状态为已发送
      await this.messageManager.updateMessageStatus(userMessageId, 'sent')

      // 创建助手消息
      const conversation = await this.getConversation(conversationId)
      const { providerId, modelId } = conversation.settings
      const assistantMessage = (await this.messageManager.sendMessage(
        conversationId,
        JSON.stringify([]), // 初始为空内容
        'assistant',
        userMessageId,
        false,
        {
          totalTokens: 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: modelId,
          provider: providerId
        }
      )) as AssistantMessage

      // 初始化生成状态
      this.generatingMessages.set(assistantMessage.id, {
        message: assistantMessage,
        conversationId,
        startTime: Date.now(),
        firstTokenTime: null,
        promptTokens: 0,
        reasoningStartTime: null,
        reasoningEndTime: null,
        lastReasoningTime: null
      })

      return assistantMessage
    } catch (error) {
      // 更新用户消息状态为错误
      await this.messageManager.updateMessageStatus(userMessageId, 'error')
      console.error('生成 AI 响应失败:', error)
      throw error
    }
  }

  /**
   * 获取指定消息
   *
   * @param messageId 消息ID
   * @returns 消息对象
   */
  async getMessage(messageId: string): Promise<Message> {
    return await this.messageManager.getMessage(messageId)
  }

  /**
   * 获取指定消息之前的历史消息
   *
   * @param messageId 消息ID
   * @param limit 限制返回的消息数量
   * @returns 历史消息列表，按时间正序排列
   */
  private async getMessageHistory(messageId: string, limit: number = 100): Promise<Message[]> {
    const message = await this.messageManager.getMessage(messageId)
    if (!message) {
      throw new Error('找不到指定的消息')
    }

    // 获取会话的消息列表
    const { list: messages } = await this.messageManager.getMessageThread(
      message.conversationId,
      1,
      limit * 2
    )

    // 找到目标消息在列表中的位置
    const targetIndex = messages.findIndex((msg) => msg.id === messageId)
    if (targetIndex === -1) {
      return [message]
    }

    // 返回目标消息之前的消息（包括目标消息）
    return messages.slice(Math.max(0, targetIndex - limit + 1), targetIndex + 1)
  }

  /**
   * 根据用户查询和上下文重写搜索关键词
   * 使用LLM优化搜索查询
   *
   * @param query 原始查询
   * @param contextMessages 上下文消息
   * @param conversationId 会话ID
   * @param searchEngine 搜索引擎名称
   * @returns 优化后的搜索关键词
   */
  private async rewriteUserSearchQuery(
    query: string,
    contextMessages: string,
    conversationId: string,
    searchEngine: string
  ): Promise<string> {
    // 构建重写提示
    const rewritePrompt = `
    你非常擅长于使用搜索引擎去获取最新的数据,你的目标是在充分理解用户的问题后，进行全面的网络搜索搜集必要的信息，首先你要提取并优化搜索的查询内容

    现在时间：${new Date().toISOString()}
    正在使用的搜索引擎：${searchEngine}

    请遵循以下规则重写搜索查询：
    1. 根据用户的问题和上下文，重写应该进行搜索的关键词
    2. 如果需要使用时间，则根据当前时间给出需要查询的具体时间日期信息
    3. 生成的查询关键词要选择合适的语言，考虑用户的问题类型使用最适合的语言进行搜索，例如某些问题应该保持用户的问题语言，而有一些则更适合翻译成英语或其他语言
    4. 保持查询简洁，通常不超过3个关键词, 最多不要超过5个关键词，参考当前搜索引擎的查询习惯重写关键字

    直接返回优化后的搜索词，不要有任何额外说明。
    如下是之前对话的上下文：
    <context_messages>
    ${contextMessages}
    </context_messages>
    如下是用户的问题：
    <user_question>
    ${query}
    </user_question>
    `

    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      return query
    }

    console.log('rewriteUserSearchQuery', query, contextMessages, conversation.id)
    const { providerId, modelId } = conversation.settings

    try {
      // 使用LLM生成优化的搜索查询
      const rewrittenQuery = await this.llmProviderPresenter.generateCompletion(
        this.searchAssistantProviderId || providerId,
        [
          {
            role: 'user',
            content: rewritePrompt
          }
        ],
        this.searchAssistantModel?.id || modelId
      )
      return rewrittenQuery.trim() || query
    } catch (error) {
      console.error('重写搜索查询失败:', error)
      return query // 失败时返回原始查询
    }
  }

  /**
   * 检查消息是否已被取消
   *
   * @param messageId 消息ID
   * @returns 是否已被取消
   */
  private isMessageCancelled(messageId: string): boolean {
    const state = this.generatingMessages.get(messageId)
    return !state || state.isCancelled === true
  }

  /**
   * 如果消息已被取消，则抛出错误
   * 用于中断生成流程
   *
   * @param messageId 消息ID
   * @throws 如果消息已被取消，抛出用户取消错误
   */
  private throwIfCancelled(messageId: string): void {
    if (this.isMessageCancelled(messageId)) {
      throw new Error('common.error.userCanceledGeneration')
    }
  }

  /**
   * 启动流式搜索过程
   * 包含：初始化搜索块、优化查询关键词、执行搜索、保存结果
   *
   * @param conversationId 会话ID
   * @param messageId 消息ID
   * @param query 搜索查询
   * @returns 搜索结果数组
   * @throws 如果搜索过程中出错或被取消，抛出错误
   */
  private async startStreamSearch(
    conversationId: string,
    messageId: string,
    query: string
  ): Promise<SearchResult[]> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      throw new Error('找不到生成状态')
    }

    // 检查是否已被取消
    this.throwIfCancelled(messageId)

    // 添加搜索加载状态块
    const searchBlock: AssistantMessageBlock = {
      type: 'search',
      content: '',
      status: 'loading',
      timestamp: Date.now(),
      extra: {
        total: 0
      }
    }
    state.message.content.unshift(searchBlock)
    await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

    // 标记消息为搜索状态
    state.isSearching = true
    this.searchingMessages.add(messageId)

    try {
      // 获取历史消息用于上下文
      const contextMessages = await this.getContextMessages(conversationId)

      // 再次检查是否已被取消
      this.throwIfCancelled(messageId)

      // 格式化上下文消息以传递给搜索查询重写
      const formattedContext = contextMessages
        .map((msg) => {
          if (msg.role === 'user') {
            const content = msg.content as UserMessageContent
            return `user: ${content.text}${getFileContext(content.files)}`
          } else if (msg.role === 'assistant') {
            let finanContent = 'assistant: '
            const content = msg.content as AssistantMessageBlock[]
            content.forEach((block) => {
              if (block.type === 'content') {
                finanContent += block.content + '\n'
              }
              if (block.type === 'search') {
                finanContent += `search-result: ${JSON.stringify(block.extra)}`
              }
              if (block.type === 'tool_call') {
                finanContent += `tool_call: ${JSON.stringify(block.tool_call)}`
              }
              if (block.type === 'image') {
                finanContent += `image: ${block.image_data?.data}`
              }
            })
            return finanContent
          } else {
            return JSON.stringify(msg.content)
          }
        })
        .join('\n')

      // 再次检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为优化中
      searchBlock.status = 'optimizing'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
      console.log('optimizing')

      // 重写搜索查询以优化搜索效果
      const optimizedQuery = await this.rewriteUserSearchQuery(
        query,
        formattedContext,
        conversationId,
        this.searchManager.getActiveEngine().name
      ).catch((err) => {
        console.error('重写搜索查询失败:', err)
        return query // 失败时使用原始查询
      })

      // 再次检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为阅读中
      searchBlock.status = 'reading'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 执行搜索
      const results = await this.searchManager.search(conversationId, optimizedQuery)

      // 再次检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态和结果总数
      searchBlock.status = 'loading'
      searchBlock.extra = {
        total: results.length
      }
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 保存搜索结果到消息附件
      for (const result of results) {
        // 每保存一条结果前检查是否已被取消
        this.throwIfCancelled(messageId)

        await this.sqlitePresenter.addMessageAttachment(
          messageId,
          'search_result',
          JSON.stringify({
            title: result.title,
            url: result.url,
            content: result.content || '',
            description: result.description || '',
            icon: result.icon || ''
          })
        )
      }

      // 最后再次检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为成功
      searchBlock.status = 'success'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 标记消息搜索完成
      state.isSearching = false
      this.searchingMessages.delete(messageId)

      return results
    } catch (error) {
      // 标记消息搜索完成
      state.isSearching = false
      this.searchingMessages.delete(messageId)

      // 更新搜索状态为错误
      searchBlock.status = 'error'
      searchBlock.content = String(error)
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      if (String(error).includes('userCanceledGeneration')) {
        // 如果是取消操作导致的错误，确保搜索窗口关闭
        this.searchManager.stopSearch(state.conversationId)
      }

      return []
    }
  }

  /**
   * 获取会话的最后一条用户消息
   *
   * @param conversationId 会话ID
   * @returns 最后一条用户消息，如果没有则返回null
   */
  private async getLastUserMessage(conversationId: string): Promise<Message | null> {
    return await this.messageManager.getLastUserMessage(conversationId)
  }

  /**
   * 从数据库获取消息的搜索结果
   *
   * @param messageId 消息ID
   * @returns 搜索结果数组
   */
  async getSearchResults(messageId: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    return results.map((result) => JSON.parse(result.content) as SearchResult) ?? []
  }

  /**
   * 启动流式生成过程
   * 处理流程：获取上下文、处理用户内容、执行搜索、准备提示、生成回复
   *
   * @param conversationId 会话ID
   * @param queryMsgId 可选，指定查询消息ID
   */
  async startStreamCompletion(conversationId: string, queryMsgId?: string) {
    debugger
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('未找到状态，conversationId:', conversationId)
      return
    }
    try {
      // 设置消息未取消
      state.isCancelled = false

      // 1. 获取上下文信息
      const { conversation, userMessage, contextMessages } = await this.prepareConversationContext(
        conversationId,
        queryMsgId
      )

      const { providerId, modelId, temperature, maxTokens } = conversation.settings
      const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
      const { vision } = modelConfig || {}

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 2. 处理用户消息内容
      // 3. 处理搜索（如果需要）
      let searchResults: SearchResult[] | null = null
      if ((userMessage.content as UserMessageContent).search) {
        try {
          searchResults = await this.startStreamSearch(
            conversationId,
            state.message.id,
            userContent
          )
          // 检查是否已被取消
          this.throwIfCancelled(state.message.id)
        } catch (error) {
          // 如果是用户取消导致的错误，不继续后续步骤
          if (String(error).includes('userCanceledGeneration')) {
            return
          }
          // 其他错误继续处理（搜索失败不应影响生成）
          console.error('搜索过程中出错:', error)
        }
      }

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 4. 准备提示内容
      const { finalContent, promptTokens } = this.preparePromptContent(
        conversation,
        userContent,
        contextMessages,
        searchResults,
        urlResults,
        userMessage,
        vision,
        vision ? imageFiles : []
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 5. 更新生成状态
      await this.updateGenerationState(state, promptTokens)

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 6. 启动流式生成

      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        state.message.id,
        temperature,
        maxTokens
      )
      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      // 检查是否是取消错误
      if (String(error).includes('userCanceledGeneration')) {
        console.log('消息生成已被用户取消')
        return
      }

      console.error('流式生成过程中出错:', error)
      await this.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }
  async continueStreamCompletion(conversationId: string, queryMsgId: string) {
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('未找到状态，conversationId:', conversationId)
      return
    }

    try {
      // 设置消息未取消
      state.isCancelled = false

      // 1. 获取需要继续的消息
      const queryMessage = await this.messageManager.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('找不到指定的消息')
      }

      // 2. 解析最后一个 action block
      const content = queryMessage.content as AssistantMessageBlock[]
      const lastActionBlock = content.filter((block) => block.type === 'action').pop()

      if (!lastActionBlock || lastActionBlock.type !== 'action') {
        throw new Error('找不到最后的 action block')
      }

      // 3. 检查是否是 maximum_tool_calls_reached
      let toolCallResponse: { content: string; rawData: MCPToolResponse } | null = null
      const toolCall = lastActionBlock.tool_call

      if (lastActionBlock.action_type === 'maximum_tool_calls_reached' && toolCall) {
        // 设置 needContinue 为 0（false）
        if (lastActionBlock.extra) {
          lastActionBlock.extra = {
            ...lastActionBlock.extra,
            needContinue: false
          }
        }
        await this.messageManager.editMessage(queryMsgId, JSON.stringify(content))

        // 4. 检查工具调用参数
        if (!toolCall.id || !toolCall.name || !toolCall.params) {
          throw new Error('工具调用参数不完整')
        }

        // 5. 调用工具获取结果
        toolCallResponse = await presenter.mcpPresenter.callTool({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.params
          },
          server: {
            name: toolCall.server_name || '',
            icons: toolCall.server_icons || '',
            description: toolCall.server_description || ''
          }
        })
      }

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 6. 获取上下文信息
      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        state.message.id
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 7. 准备提示内容
      const { finalContent, promptTokens } = this.preparePromptContent(
        conversation,
        'continue',
        contextMessages,
        null, // 不进行搜索
        [], // 没有 URL 结果
        userMessage,
        false,
        [] // 没有图片文件
      )

      // 8. 更新生成状态
      await this.updateGenerationState(state, promptTokens)

      // 9. 如果有工具调用结果，发送工具调用结果事件
      if (toolCallResponse && toolCall) {
        // console.log('toolCallResponse', toolCallResponse)
        eventBus.emit(STREAM_EVENTS.RESPONSE, {
          eventId: state.message.id,
          content: '',
          tool_call: 'start',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolCallResponse.content,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description
        })

        eventBus.emit(STREAM_EVENTS.RESPONSE, {
          eventId: state.message.id,
          content: '',
          tool_call: 'end',
          tool_call_id: toolCall.id,
          tool_call_response: toolCallResponse.content,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description,
          tool_call_response_raw: toolCallResponse.rawData
        })
      }

      // 10. 启动流式生成
      const { providerId, modelId, temperature, maxTokens } = conversation.settings
      const stream = this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        state.message.id,
        temperature,
        maxTokens
      )
      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      // 检查是否是取消错误
      if (String(error).includes('userCanceledGeneration')) {
        console.log('消息生成已被用户取消')
        return
      }

      console.error('继续生成过程中出错:', error)
      await this.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }

  // 查找特定会话的生成状态
  private findGeneratingState(conversationId: string): GeneratingMessageState | null {
    return (
      Array.from(this.generatingMessages.values()).find(
        (state) => state.conversationId === conversationId
      ) || null
    )
  }

  // 准备会话上下文
  private async prepareConversationContext(
    conversationId: string,
    queryMsgId?: string
  ): Promise<{
    conversation: CONVERSATION
    userMessage: Message
    contextMessages: Message[]
  }> {
    const conversation = await this.getConversation(conversationId)
    let contextMessages: Message[] = []
    let userMessage: Message | null = null
    if (queryMsgId) {
      // 处理指定消息ID的情况
      const queryMessage = await this.getMessage(queryMsgId)
      if (!queryMessage || !queryMessage.parentId) {
        throw new Error('找不到指定的消息')
      }
      userMessage = await this.getMessage(queryMessage.parentId)
      if (!userMessage) {
        throw new Error('找不到触发消息')
      }
      contextMessages = await this.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )
    } else {
      // 获取最新的用户消息
      userMessage = await this.getLastUserMessage(conversationId)
      if (!userMessage) {
        throw new Error('找不到用户消息')
      }
      contextMessages = await this.getContextMessages(conversationId)
    }
    // 任何情况都使用最新配置
    const webSearchEnabled = this.configPresenter.getSetting('input_webSearch') as boolean
    const thinkEnabled = this.configPresenter.getSetting('input_deepThinking') as boolean
    ;(userMessage.content as UserMessageContent).search = webSearchEnabled
    ;(userMessage.content as UserMessageContent).think = thinkEnabled
    return { conversation, userMessage, contextMessages }
  }

  // 处理用户消息内容
  private async processUserMessageContent(userMessage: UserMessage): Promise<{
    userContent: string
    urlResults: SearchResult[]
    imageFiles: MessageFile[] // 图片文件列表
  }> {
    // 处理文本内容
    const userContent = `
      ${userMessage.content.text}
      ${getFileContext(userMessage.content.files)}
    `

    // 从用户消息中提取并丰富URL内容
    const urlResults = await ContentEnricher.extractAndEnrichUrls(userMessage.content.text)

    // 提取图片文件

    const imageFiles =
      userMessage.content.files?.filter((file) => {
        // 根据文件类型、MIME类型或扩展名过滤图片文件
        const isImage =
          file.mimeType.startsWith('data:image') ||
          /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name || '')
        return isImage
      }) || []

    return { userContent, urlResults, imageFiles }
  }

  // 准备提示内容
  private preparePromptContent(
    conversation: CONVERSATION,
    userContent: string,
    contextMessages: Message[],
    searchResults: SearchResult[] | null,
    urlResults: SearchResult[],
    userMessage: Message,
    vision: boolean,
    imageFiles: MessageFile[]
  ): {
    finalContent: ChatMessage[]
    promptTokens: number
  } {
    const { systemPrompt, contextLength, artifacts } = conversation.settings

    const searchPrompt = searchResults ? generateSearchPrompt(userContent, searchResults) : ''
    const enrichedUserMessage =
      urlResults.length > 0
        ? '\n\n' + ContentEnricher.enrichUserMessageWithUrlContent(userContent, urlResults)
        : ''

    // 计算token数量
    const searchPromptTokens = searchPrompt ? approximateTokenSize(searchPrompt ?? '') : 0
    const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt ?? '') : 0
    const userMessageTokens = approximateTokenSize(userContent + enrichedUserMessage)

    // 计算剩余可用的上下文长度
    const reservedTokens = searchPromptTokens + systemPromptTokens + userMessageTokens
    const remainingContextLength = contextLength - reservedTokens

    // 选择合适的上下文消息
    const selectedContextMessages = this.selectContextMessages(
      contextMessages,
      userMessage,
      remainingContextLength
    )

    // 格式化消息
    const formattedMessages = this.formatMessagesForCompletion(
      selectedContextMessages,
      systemPrompt,
      artifacts,
      searchPrompt,
      userContent,
      enrichedUserMessage,
      imageFiles,
      vision
    )

    // 合并连续的相同角色消息
    const mergedMessages = this.mergeConsecutiveMessages(formattedMessages)

    // 计算prompt tokens
    let promptTokens = 0
    for (const msg of mergedMessages) {
      if (typeof msg.content === 'string') {
        promptTokens += approximateTokenSize(msg.content)
      } else {
        promptTokens +=
          approximateTokenSize(msg.content?.map((item) => item.text).join('') || '') +
          imageFiles.reduce((acc, file) => acc + file.token, 0)
      }
    }
    // console.log('preparePromptContent', mergedMessages, promptTokens)

    return { finalContent: mergedMessages, promptTokens }
  }

  // 选择上下文消息
  private selectContextMessages(
    contextMessages: Message[],
    userMessage: Message,
    remainingContextLength: number
  ): Message[] {
    if (remainingContextLength <= 0) {
      return []
    }

    const messages = contextMessages.filter((msg) => msg.id !== userMessage?.id).reverse()

    let currentLength = 0
    const selectedMessages: Message[] = []

    for (const msg of messages) {
      const msgTokens = approximateTokenSize(
        msg.role === 'user'
          ? `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
          : JSON.stringify(msg.content)
      )

      if (currentLength + msgTokens <= remainingContextLength) {
        selectedMessages.unshift(msg)
        currentLength += msgTokens
      } else {
        break
      }
    }

    return selectedMessages
  }

  // 格式化消息用于完成
  private formatMessagesForCompletion(
    contextMessages: Message[],
    systemPrompt: string,
    artifacts: number,
    searchPrompt: string,
    userContent: string,
    enrichedUserMessage: string,
    imageFiles: MessageFile[],
    vision: boolean
  ): ChatMessage[] {
    const formattedMessages: ChatMessage[] = []

    // 添加系统提示
    if (systemPrompt) {
      // formattedMessages.push(...this.addSystemPrompt(formattedMessages, systemPrompt, artifacts))
      formattedMessages.push({
        role: 'system',
        content: systemPrompt
      })
      // console.log('-------------> system prompt \n', systemPrompt, artifacts, formattedMessages)
    }

    // 添加上下文消息
    formattedMessages.push(...this.addContextMessages(formattedMessages, contextMessages, vision))

    // 添加当前用户消息
    let finalContent = searchPrompt || userContent

    if (enrichedUserMessage) {
      finalContent += enrichedUserMessage
    }

    if (artifacts === 1) {
      // formattedMessages.push({
      //   role: 'user',
      //   content: ARTIFACTS_PROMPT
      // })
      console.log('artifacts目前由mcp提供，此处为兼容性保留')
    }
    // 没有 vision 就不用塞进去了
    if (vision && imageFiles.length > 0) {
      formattedMessages.push(this.addImageFiles(finalContent, imageFiles))
    } else {
      formattedMessages.push({
        role: 'user',
        content: finalContent.trim()
      })
    }

    return formattedMessages
  }

  private addImageFiles(finalContent: string, imageFiles: MessageFile[]): ChatMessage {
    return {
      role: 'user',
      content: [
        ...imageFiles.map((file) => ({
          type: 'image_url' as const,
          image_url: { url: file.content, detail: 'auto' as const }
        })),
        { type: 'text' as const, text: finalContent.trim() }
      ]
    }
  }

  // 添加上下文消息
  private addContextMessages(
    formattedMessages: ChatMessage[],
    contextMessages: Message[],
    vision: boolean
  ): ChatMessage[] {
    const resultMessages = [...formattedMessages]

    contextMessages.forEach((msg) => {
      if (msg.role === 'user') {
        // 处理用户消息
        const userContent = `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
        resultMessages.push({
          role: 'user',
          content: userContent
        })
      } else if (msg.role === 'assistant') {
        // 处理助手消息
        const assistantBlocks = msg.content as AssistantMessageBlock[]

        // 提取文本内容块
        const textContent = assistantBlocks
          .filter((block) => block.type === 'content' || block.type === 'tool_call')
          .map((block) => block.content)
          .join('\n')
        // 查找图像块
        const imageBlocks = assistantBlocks.filter(
          (block) => block.type === 'image' && block.image_data
        )

        // 如果没有任何内容，则跳过此消息
        if (!textContent && imageBlocks.length === 0) {
          return
        }

        // 如果有图像，则使用复合内容格式
        if (vision && imageBlocks.length > 0) {
          const content: ChatMessageContent[] = []

          // 添加图像内容
          imageBlocks.forEach((block) => {
            if (block.image_data) {
              content.push({
                type: 'image_url',
                image_url: {
                  url: block.image_data.data,
                  detail: 'auto'
                }
              })
            }
          })

          // 添加文本内容
          if (textContent) {
            content.push({
              type: 'text',
              text: textContent
            })
          }

          resultMessages.push({
            role: 'assistant',
            content: content
          })
        } else {
          // 仅有文本内容
          resultMessages.push({
            role: 'assistant',
            content: textContent
          })
        }
      }
    })

    return resultMessages
  }

  // 合并连续的相同角色消息
  private mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
    const mergedMessages: ChatMessage[] = []

    for (let i = 0; i < messages.length; i++) {
      const currentMessage = messages[i]
      if (
        mergedMessages.length > 0 &&
        mergedMessages[mergedMessages.length - 1].role === currentMessage.role
      ) {
        mergedMessages[mergedMessages.length - 1].content = this.mergeMessageContent(
          currentMessage.content || '',
          mergedMessages[mergedMessages.length - 1].content || ''
        )
      } else {
        mergedMessages.push({ ...currentMessage })
      }
    }

    return mergedMessages
  }

  private mergeMessageContent(
    currentMessageContent: string | ChatMessageContent[],
    previousMessageContent: string | ChatMessageContent[]
  ) {
    let mergedContent: ChatMessageContent[] | string
    if (Array.isArray(currentMessageContent)) {
      if (Array.isArray(previousMessageContent)) {
        mergedContent = [
          ...(previousMessageContent.filter(
            (item) => item.type !== 'text'
          ) as ChatMessageContent[]),
          {
            type: 'text',
            text: `${previousMessageContent
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')}\n${currentMessageContent
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')}`
          },
          ...(currentMessageContent.filter((item) => item.type !== 'text') as ChatMessageContent[])
        ] as ChatMessageContent[]
      } else {
        mergedContent = [
          {
            type: 'text',
            text: `${previousMessageContent}\n${currentMessageContent
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')}`
          },
          ...(currentMessageContent.filter((item) => item.type !== 'text') as ChatMessageContent[])
        ]
      }
    } else {
      if (Array.isArray(previousMessageContent)) {
        mergedContent = [
          ...(previousMessageContent.filter(
            (item) => item.type !== 'text'
          ) as ChatMessageContent[]),
          {
            type: 'text',
            text: `${previousMessageContent
              .filter((item) => item.type == 'text')
              .map((item) => item.text)
              .join(`\n`)}\n${currentMessageContent}`
          }
        ] as ChatMessageContent[]
      } else {
        mergedContent = `${previousMessageContent}\n${currentMessageContent}`
      }
    }
    return mergedContent
  }

  // 更新生成状态
  private async updateGenerationState(
    state: GeneratingMessageState,
    promptTokens: number
  ): Promise<void> {
    // 更新生成状态
    this.generatingMessages.set(state.message.id, {
      ...state,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens
    })

    // 更新消息的usage信息
    await this.messageManager.updateMessageMetadata(state.message.id, {
      totalTokens: promptTokens,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0
    })
  }

  async editMessage(messageId: string, content: string): Promise<Message> {
    return await this.messageManager.editMessage(messageId, content)
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.messageManager.deleteMessage(messageId)
  }

  async retryMessage(messageId: string): Promise<AssistantMessage> {
    const message = await this.messageManager.getMessage(messageId)
    if (message.role !== 'assistant') {
      throw new Error('只能重试助手消息')
    }

    const userMessage = await this.messageManager.getMessage(message.parentId || '')
    if (!userMessage) {
      throw new Error('找不到对应的用户消息')
    }
    const conversation = await this.getConversation(message.conversationId)
    const { providerId, modelId } = conversation.settings
    const assistantMessage = await this.messageManager.retryMessage(messageId, {
      totalTokens: 0,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: modelId,
      provider: providerId
    })

    // 初始化生成状态
    this.generatingMessages.set(assistantMessage.id, {
      message: assistantMessage as AssistantMessage,
      conversationId: message.conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    return assistantMessage as AssistantMessage
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    return await this.messageManager.getMessageVariants(messageId)
  }

  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.messageManager.updateMessageStatus(messageId, status)
  }

  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    await this.messageManager.updateMessageMetadata(messageId, metadata)
  }

  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.messageManager.markMessageAsContextEdge(messageId, isEdge)
  }

  async getActiveConversationId(): Promise<string | null> {
    return this.activeConversationId
  }

  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
  }

  getGeneratingMessageState(messageId: string): GeneratingMessageState | null {
    return this.generatingMessages.get(messageId) || null
  }

  getConversationGeneratingMessages(conversationId: string): AssistantMessage[] {
    return Array.from(this.generatingMessages.values())
      .filter((state) => state.conversationId === conversationId)
      .map((state) => state.message)
  }

  async stopMessageGeneration(messageId: string): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (state) {
      // 设置统一的取消标志
      state.isCancelled = true

      // 标记消息不再处于搜索状态
      if (state.isSearching) {
        this.searchingMessages.delete(messageId)

        // 停止搜索窗口
        await this.searchManager.stopSearch(state.conversationId)
      }

      // 添加用户取消的消息块
      state.message.content.forEach((block) => {
        if (
          block.status === 'loading' ||
          block.status === 'reading' ||
          block.status === 'optimizing'
        ) {
          block.status = 'success'
        }
      })
      state.message.content.push({
        type: 'error',
        content: 'common.error.userCanceledGeneration',
        status: 'cancel',
        timestamp: Date.now()
      })

      // 更新消息状态和内容
      await this.messageManager.updateMessageStatus(messageId, 'error')
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 停止流式生成
      await this.llmProviderPresenter.stopStream(messageId)

      // 清理生成状态
      this.generatingMessages.delete(messageId)
    }
  }

  async stopConversationGeneration(conversationId: string): Promise<void> {
    const messageIds = Array.from(this.generatingMessages.entries())
      .filter(([, state]) => state.conversationId === conversationId)
      .map(([messageId]) => messageId)

    await Promise.all(messageIds.map((messageId) => this.stopMessageGeneration(messageId)))
  }

  async summaryTitles(providerId?: string, modelId?: string): Promise<string> {
    const conversation = await this.getActiveConversation()
    if (!conversation) {
      throw new Error('找不到当前对话')
    }
    let summaryProviderId = providerId
    if (!modelId || !providerId) {
      modelId = this.searchAssistantModel?.id
      summaryProviderId = this.searchAssistantProviderId || conversation.settings.providerId
    }

    const messages = await this.getContextMessages(conversation.id)
    const messagesWithLength = messages
      .map((msg) => {
        if (msg.role === 'user') {
          return {
            message: msg,
            length:
              `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
                .length,
            formattedMessage: {
              role: 'user' as const,
              content: `${(msg.content as UserMessageContent).text}${getFileContext((msg.content as UserMessageContent).files)}`
            }
          }
        } else {
          const content = (msg.content as AssistantMessageBlock[])
            .filter((block) => block.type === 'content')
            .map((block) => block.content)
            .join('\n')
          return {
            message: msg,
            length: content.length,
            formattedMessage: {
              role: 'assistant' as const,
              content: content
            }
          }
        }
      })
      .filter((item) => item.formattedMessage.content.length > 0)
    const title = await this.llmProviderPresenter.summaryTitles(
      messagesWithLength.map((item) => item.formattedMessage),
      summaryProviderId || conversation.settings.providerId,
      modelId || conversation.settings.modelId
    )
    console.log('-------------> title \n', title)
    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    console.log('-------------> cleanedTitle \n', cleanedTitle)
    return cleanedTitle
  }
  async clearActiveThread(): Promise<void> {
    this.activeConversationId = null
    eventBus.emit(CONVERSATION_EVENTS.DEACTIVATED)
  }

  async clearAllMessages(conversationId: string): Promise<void> {
    await this.messageManager.clearAllMessages(conversationId)
    // 如果是当前活动会话，需要更新生成状态
    if (conversationId === this.activeConversationId) {
      // 停止所有正在生成的消息
      await this.stopConversationGeneration(conversationId)
    }
  }

  async getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]> {
    const attachments = await this.sqlitePresenter.getMessageAttachments(messageId, type)
    return attachments.map((attachment) => JSON.parse(attachment.content))
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const message = await this.messageManager.getMainMessageByParentId(conversationId, parentId)
    if (!message) {
      return null
    }
    return message
  }

  destroy() {
    this.searchManager.destroy()
  }

  /**
   * 创建会话的分支
   * @param targetConversationId 源会话ID
   * @param targetMessageId 目标消息ID（截止到该消息的所有消息将被复制）
   * @param newTitle 新会话标题
   * @param settings 新会话设置
   * @returns 新创建的会话ID
   */
  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string> {
    try {
      // 1. 获取源会话信息
      const sourceConversation = await this.sqlitePresenter.getConversation(targetConversationId)
      if (!sourceConversation) {
        throw new Error('源会话不存在')
      }

      // 2. 创建新会话
      const newConversationId = await this.sqlitePresenter.createConversation(newTitle)

      // 更新会话设置
      if (settings || sourceConversation.settings) {
        await this.updateConversationSettings(
          newConversationId,
          settings || sourceConversation.settings
        )
      }

      // 更新is_new标志
      await this.sqlitePresenter.updateConversation(newConversationId, { is_new: 0 })

      // 3. 获取源会话中的消息历史
      const message = await this.messageManager.getMessage(targetMessageId)
      if (!message) {
        throw new Error('目标消息不存在')
      }

      // 获取目标消息之前的所有消息（包括目标消息）
      const messageHistory = await this.getMessageHistory(targetMessageId, 100)

      // 4. 直接操作数据库复制消息到新会话
      for (const msg of messageHistory) {
        // 只复制已发送成功的消息
        if (msg.status !== 'sent') {
          continue
        }

        // 获取消息序号
        const orderSeq = (await this.sqlitePresenter.getMaxOrderSeq(newConversationId)) + 1

        // 解析元数据
        const metadata: MESSAGE_METADATA = {
          totalTokens: msg.usage?.total_tokens || 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          inputTokens: msg.usage?.input_tokens || 0,
          outputTokens: msg.usage?.output_tokens || 0,
          ...(msg.model_id ? { model: msg.model_id } : {}),
          ...(msg.model_provider ? { provider: msg.model_provider } : {})
        }

        // 计算token数量
        const tokenCount = msg.usage?.total_tokens || 0

        // 内容处理（确保是字符串）
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

        // 直接插入消息记录
        await this.sqlitePresenter.insertMessage(
          newConversationId, // 新会话ID
          content, // 内容
          msg.role, // 角色
          '', // 无父消息ID
          JSON.stringify(metadata), // 元数据
          orderSeq, // 序号
          tokenCount, // token数
          'sent', // 状态固定为sent
          0, // 不是上下文边界
          0 // 不是变体
        )
      }

      // 5. 触发会话创建事件

      return newConversationId
    } catch (error) {
      console.error('分支会话失败:', error)
      throw error
    }
  }
}
