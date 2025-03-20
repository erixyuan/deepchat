import {
  IMessageManager,
  MESSAGE_METADATA,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  ISQLitePresenter,
  SQLITE_MESSAGE
} from '@shared/presenter'
import { Message } from '@shared/chat'
import { eventBus } from '@/eventbus'
import { CONVERSATION_EVENTS } from '@/events'

/**
 * 消息管理器类
 * 负责处理与消息相关的所有操作，包括创建、编辑、删除和查询消息
 * 实现了IMessageManager接口
 */
export class MessageManager implements IMessageManager {
  /**
   * SQLite数据库操作接口
   * 用于消息的持久化存储和检索
   */
  private sqlitePresenter: ISQLitePresenter

  /**
   * 构造函数
   * @param sqlitePresenter SQLite数据库操作接口实例
   */
  constructor(sqlitePresenter: ISQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  /**
   * 将SQLite消息对象转换为前端使用的Message对象
   * @param sqliteMessage 数据库中的消息对象
   * @returns 转换后的Message对象
   */
  private convertToMessage(sqliteMessage: SQLITE_MESSAGE): Message {
    // 尝试解析元数据JSON字符串
    let metadata: MESSAGE_METADATA | null = null
    try {
      metadata = JSON.parse(sqliteMessage.metadata)
    } catch (e) {
      console.error('Failed to parse metadata', e)
    }
    // 构建并返回Message对象
    return {
      id: sqliteMessage.id,
      conversationId: sqliteMessage.conversation_id,
      parentId: sqliteMessage.parent_id,
      role: sqliteMessage.role as MESSAGE_ROLE,
      content: JSON.parse(sqliteMessage.content),
      timestamp: sqliteMessage.created_at,
      status: sqliteMessage.status as MESSAGE_STATUS,
      usage: {
        tokens_per_second: metadata?.tokensPerSecond ?? 0,
        total_tokens: metadata?.totalTokens ?? 0,
        generation_time: metadata?.generationTime ?? 0,
        first_token_time: metadata?.firstTokenTime ?? 0,
        input_tokens: metadata?.inputTokens ?? 0,
        output_tokens: metadata?.outputTokens ?? 0,
        reasoning_start_time: metadata?.reasoningStartTime ?? 0,
        reasoning_end_time: metadata?.reasoningEndTime ?? 0
      },
      avatar: '',
      name: '',
      model_name: metadata?.model ?? '',
      model_id: metadata?.model ?? '',
      model_provider: metadata?.provider ?? '',
      error: '',
      is_variant: sqliteMessage.is_variant,
      variants: sqliteMessage.variants?.map((variant) => this.convertToMessage(variant)) || []
    }
  }

  /**
   * 发送新消息
   * @param conversationId 对话ID
   * @param content 消息内容
   * @param role 消息角色（用户或助手）
   * @param parentId 父消息ID
   * @param isVariant 是否为变体消息
   * @param metadata 消息元数据
   * @param searchResults 可选的搜索结果
   * @returns 创建的消息对象
   */
  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA,
    searchResults?: string
  ): Promise<Message> {
    // 获取当前对话中最大的序号，用于确定新消息的顺序
    const maxOrderSeq = await this.sqlitePresenter.getMaxOrderSeq(conversationId)
    // 插入新消息到数据库
    const msgId = await this.sqlitePresenter.insertMessage(
      conversationId,
      content,
      role,
      parentId,
      JSON.stringify(metadata),
      maxOrderSeq + 1, // 新消息序号为当前最大序号+1
      0, // 默认不是上下文边界
      'pending', // 初始状态为待处理
      0, // 默认不是引用消息
      isVariant ? 1 : 0 // 是否为变体消息
    )

    // 如果提供了搜索结果，添加为消息附件
    if (searchResults) {
      await this.sqlitePresenter.addMessageAttachment(msgId, 'search_results', searchResults)
    }
    // 获取并返回创建的消息
    const message = await this.getMessage(msgId)
    if (!message) {
      throw new Error('Failed to create message')
    }
    return message
  }

  /**
   * 编辑现有消息
   * @param messageId 要编辑的消息ID
   * @param content 新的消息内容
   * @returns 更新后的消息对象
   */
  async editMessage(messageId: string, content: string): Promise<Message> {
    // 更新数据库中的消息内容
    await this.sqlitePresenter.updateMessage(messageId, { content })
    // 获取更新后的消息
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    const msg = this.convertToMessage(message)
    // 触发消息编辑事件
    eventBus.emit(CONVERSATION_EVENTS.MESSAGE_EDITED, messageId)
    // 如果有父消息，也触发父消息的编辑事件
    if (msg.parentId) {
      eventBus.emit(CONVERSATION_EVENTS.MESSAGE_EDITED, msg.parentId)
    }
    return msg
  }

  /**
   * 删除消息
   * @param messageId 要删除的消息ID
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.sqlitePresenter.deleteMessage(messageId)
  }

  /**
   * 重试消息（创建变体）
   * @param messageId 要重试的消息ID
   * @param metadata 新的元数据
   * @returns 创建的变体消息对象
   */
  async retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<Message> {
    // 获取原始消息
    const originalMessage = await this.getMessage(messageId)
    if (!originalMessage) {
      throw new Error(`Message ${messageId} not found`)
    }

    // 创建一个新的变体消息
    const variantMessage = await this.sendMessage(
      originalMessage.conversationId,
      JSON.stringify([]), // 初始内容为空数组
      originalMessage.role as MESSAGE_ROLE,
      originalMessage.parentId || '',
      true, // 标记为变体消息
      metadata
    )

    return variantMessage
  }

  /**
   * 获取单个消息
   * @param messageId 消息ID
   * @returns 消息对象
   */
  async getMessage(messageId: string): Promise<Message> {
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    return this.convertToMessage(message)
  }

  /**
   * 获取消息的所有变体
   * @param messageId 消息ID
   * @returns 变体消息数组
   */
  async getMessageVariants(messageId: string): Promise<Message[]> {
    const variants = await this.sqlitePresenter.getMessageVariants(messageId)
    return variants.map((variant) => this.convertToMessage(variant))
  }

  /**
   * 根据父消息ID获取主消息
   * @param conversationId 对话ID
   * @param parentId 父消息ID
   * @returns 主消息对象，如果不存在则返回null
   */
  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const message = await this.sqlitePresenter.getMainMessageByParentId(conversationId, parentId)
    if (!message) {
      return null
    }
    return this.convertToMessage(message)
  }

  /**
   * 获取对话消息线程（分页）
   * @param conversationId 对话ID
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 包含总数和消息列表的对象
   */
  async getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    // 查询对话中的所有消息
    const sqliteMessages = await this.sqlitePresenter.queryMessages(conversationId)
    const start = (page - 1) * pageSize
    const end = start + pageSize

    // 处理消息的排序和变体关系
    const messages = sqliteMessages
      .sort((a, b) => {
        // 首先按创建时间排序
        const timeCompare = a.created_at - b.created_at
        if (timeCompare !== 0) return timeCompare
        // 如果创建时间相同，按序号排序
        return a.order_seq - b.order_seq
      })
      .map((msg) => this.convertToMessage(msg))

    return {
      total: messages.length,
      list: messages.slice(start, end) // 返回请求的分页数据
    }
  }

  /**
   * 更新消息状态
   * @param messageId 消息ID
   * @param status 新状态
   */
  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, { status })
  }

  /**
   * 更新消息元数据
   * @param messageId 消息ID
   * @param metadata 要更新的元数据（部分）
   */
  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    // 获取当前消息
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      return
    }
    // 合并现有元数据和新元数据
    const updatedMetadata = {
      ...JSON.parse(message.metadata),
      ...metadata
    }
    // 更新数据库中的元数据
    await this.sqlitePresenter.updateMessage(messageId, {
      metadata: JSON.stringify(updatedMetadata)
    })
  }

  /**
   * 将消息标记为上下文边界
   * @param messageId 消息ID
   * @param isEdge 是否为边界
   */
  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, {
      isContextEdge: isEdge ? 1 : 0
    })
  }

  /**
   * 获取对话的上下文消息
   * @param conversationId 对话ID
   * @param messageCount 要获取的消息数量
   * @returns 消息数组
   */
  async getContextMessages(conversationId: string, messageCount: number): Promise<Message[]> {
    // 查询对话中的所有消息
    const sqliteMessages = await this.sqlitePresenter.queryMessages(conversationId)

    // 按创建时间和序号倒序排序
    const messages = sqliteMessages
      .sort((a, b) => {
        // 首先按创建时间倒序排序
        const timeCompare = b.created_at - a.created_at
        if (timeCompare !== 0) return timeCompare
        // 如果创建时间相同，按序号倒序排序
        return b.order_seq - a.order_seq
      })
      .slice(0, messageCount) // 只取需要的消息数量
      .sort((a, b) => {
        // 再次按正序排序以保持对话顺序
        const timeCompare = a.created_at - b.created_at
        if (timeCompare !== 0) return timeCompare
        return a.order_seq - b.order_seq
      })
      .map((msg) => this.convertToMessage(msg))

    return messages
  }

  /**
   * 获取对话中最后一条用户消息
   * @param conversationId 对话ID
   * @returns 最后一条用户消息，如果不存在则返回null
   */
  async getLastUserMessage(conversationId: string): Promise<Message | null> {
    const sqliteMessage = await this.sqlitePresenter.getLastUserMessage(conversationId)
    if (!sqliteMessage) {
      return null
    }
    return this.convertToMessage(sqliteMessage)
  }

  /**
   * 清除对话中的所有消息
   * @param conversationId 对话ID
   */
  async clearAllMessages(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteAllMessagesInConversation(conversationId)
  }
}
