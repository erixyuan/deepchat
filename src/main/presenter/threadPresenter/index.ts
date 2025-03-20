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
  ILlmProviderPresenter
} from '../../../shared/presenter'
import { MessageManager } from './messageManager'
import { eventBus } from '@/eventbus'
import {
  AssistantMessage,
  Message,
  AssistantMessageBlock,
  SearchEngineTemplate,
  UserMessage,
  MessageFile
} from '@shared/chat'
import { approximateTokenSize } from 'tokenx'
import { getModelConfig } from '../llmProviderPresenter/modelConfigs'
import { SearchManager } from './searchManager'
import { getFileContext } from './fileContext'
import { ContentEnricher } from './contentEnricher'
import { CONVERSATION_EVENTS, STREAM_EVENTS } from '@/events'
import { ChatMessage } from '../llmProviderPresenter/baseProvider'
import { ARTIFACTS_PROMPT } from '@/lib/artifactsPrompt'

const DEFAULT_SETTINGS: CONVERSATION_SETTINGS = {
  systemPrompt: '',
  temperature: 0.7,
  contextLength: 1000,
  maxTokens: 2000,
  providerId: 'openai',
  modelId: 'gpt-4',
  artifacts: 0
}

interface GeneratingMessageState {
  message: AssistantMessage
  conversationId: string
  startTime: number
  firstTokenTime: number | null
  promptTokens: number
  reasoningStartTime: number | null
  reasoningEndTime: number | null
  lastReasoningTime: number | null
  isSearching?: boolean
  isCancelled?: boolean
}
const SEARCH_PROMPT_TEMPLATE = `
# The following content is based on the search results from the user's message:
{{SEARCH_RESULTS}}
In the search results I provided, each result is in the format [webpage X begin]...[webpage X end], where X represents the numerical index of each article. Please reference the context at the end of sentences where appropriate. Use the citation number [X] format to reference the corresponding parts in your answer. If a sentence is derived from multiple contexts, list all relevant citation numbers, such as [3][5]. Be careful not to concentrate the citation numbers at the end of the response, but rather list them in the corresponding parts of the answer.
When answering, please pay attention to the following points:

- Today is {{CUR_DATE}}
- The language of the answer should be consistent with the language of the user's message, unless the user explicitly indicates a different language for the response.
- Not all content from the search results is closely related to the user's question; you need to discern and filter the search results based on the question.
- For listing questions (e.g., listing all flight information), try to limit the answer to no more than 10 points and inform the user that they can check the search sources for complete information. Prioritize providing the most complete and relevant items; unless necessary, do not proactively inform the user that the search results did not provide certain content.
- For creative questions (e.g., writing an essay), be sure to cite the corresponding reference numbers in the body of the paragraphs, such as [3][5], and not just at the end of the article. You need to interpret and summarize the user's topic requirements, choose an appropriate format, fully utilize the search results, and extract important information to generate answers that meet the user's requirements, are deeply thoughtful, creative, and professional. Your creative length should be as long as possible, and for each point, infer the user's intent, provide as many angles of response as possible, and ensure that the information is rich and the discussion is detailed.
- If the answer is long, try to structure it and summarize it in paragraphs. If you need to answer in points, try to limit it to no more than 5 points and merge related content.
- For objective questions, if the answer to the question is very brief, you can appropriately add one or two sentences of related information to enrich the content.
- You need to choose an appropriate and aesthetically pleasing answer format based on the user's requirements and the content of the answer to ensure strong readability.
- Your answer should synthesize multiple relevant web pages and not repeat citations from a single web page.
- Use markdown to format paragraphs, lists, tables, and citations as much as possible.
- Use markdown code blocks to write code, including syntax-highlighted languages.
- Enclose all mathematical expressions in LaTeX. Always use double dollar signs $$, for example, $$x^4 = x - 3$$.
- Do not include any URLs, only include citations with numbers, such as [1].
- Do not include references (URLs, sources) at the end.
- Use footnote citations at the end of applicable sentences (e.g., [1][2]).
- Write more than 100 words (2 paragraphs).
- Avoid directly quoting citations in the answer.

# The user's message is:
{{USER_QUERY}}
  `

const SEARCH_PROMPT_ARTIFACTS_TEMPLATE = `
# The following content is based on the search results from the user's message:
{{SEARCH_RESULTS}}
In the search results I provided, each result is in the format [webpage X begin]...[webpage X end], where X represents the numerical index of each article. Please reference the context at the end of sentences where appropriate. Use the citation number [X] format to reference the corresponding parts in your answer. If a sentence is derived from multiple contexts, list all relevant citation numbers, such as [3][5]. Be careful not to concentrate the citation numbers at the end of the response, but rather list them in the corresponding parts of the answer.
When answering, please pay attention to the following points:

- Today is {{CUR_DATE}}
- The language of the answer should be consistent with the language of the user's message, unless the user explicitly indicates a different language for the response.
- Not all content from the search results is closely related to the user's question; you need to discern and filter the search results based on the question.
- For listing questions (e.g., listing all flight information), try to limit the answer to no more than 10 points and inform the user that they can check the search sources for complete information. Prioritize providing the most complete and relevant items; unless necessary, do not proactively inform the user that the search results did not provide certain content.
- For creative questions (e.g., writing an essay), be sure to cite the corresponding reference numbers in the body of the paragraphs, such as [3][5], and not just at the end of the article. You need to interpret and summarize the user's topic requirements, choose an appropriate format, fully utilize the search results, and extract important information to generate answers that meet the user's requirements, are deeply thoughtful, creative, and professional. Your creative length should be as long as possible, and for each point, infer the user's intent, provide as many angles of response as possible, and ensure that the information is rich and the discussion is detailed.
- If the answer is long, try to structure it and summarize it in paragraphs. If you need to answer in points, try to limit it to no more than 5 points and merge related content.
- For objective questions, if the answer to the question is very brief, you can appropriately add one or two sentences of related information to enrich the content.
- You need to choose an appropriate and aesthetically pleasing answer format based on the user's requirements and the content of the answer to ensure strong readability.
- Your answer should synthesize multiple relevant web pages and not repeat citations from a single web page.
- Use markdown to format paragraphs, lists, tables, and citations as much as possible.
- Use markdown code blocks to write code, including syntax-highlighted languages.
- Enclose all mathematical expressions in LaTeX. Always use double dollar signs $$, for example, $$x^4 = x - 3$$.
- Do not include any URLs, only include citations with numbers, such as [1].
- Do not include references (URLs, sources) at the end.
- Use footnote citations at the end of applicable sentences (e.g., [1][2]).
- Write more than 100 words (2 paragraphs).
- Avoid directly quoting citations in the answer.

# Artifacts Support - MANDATORY FOR CERTAIN CONTENT TYPES
You MUST use artifacts for specific types of content. This is not optional. Creating artifacts is required for the following content types:

## REQUIRED ARTIFACT USE CASES (YOU MUST USE ARTIFACTS FOR THESE):
1. Reports and documents:
   - Annual reports, financial analyses, market research
   - Academic papers, essays, articles
   - Business plans, proposals, executive summaries
   - Any document longer than 300 words
   - Example requests: "Write a report on...", "Create an analysis of...", "Draft a document about..."

2. Complete code implementations:
   - Full code files or scripts (>15 lines)
   - Complete functions or classes
   - Configuration files
   - Example requests: "Write a program that...", "Create a script for...", "Implement a class that..."

3. Structured content:
   - Tables with multiple rows/columns
   - Diagrams, flowcharts, mind maps
   - HTML pages or templates
   - Example requests: "Create a diagram showing...", "Make a table of...", "Design an HTML page for..."

## HOW TO CREATE ARTIFACTS:
1. Identify if the user's request matches ANY of the required artifact use cases above
2. Place the ENTIRE content within the artifact - do not split content between artifacts and your main response
3. Use the appropriate artifact type:
   - markdown: For reports, documents, articles, essays
   - code: For programming code, scripts, configuration files
   - HTML: For web pages
   - SVG: For vector graphics
   - mermaid: For diagrams and charts
4. Give each artifact a clear, descriptive title
5. Include complete content without truncation
6. Still include citations [X] when referencing search results within artifacts

## IMPORTANT RULES:
- If the user asks for a report, document, essay, analysis, or any substantial written content, YOU MUST use a markdown artifact
- In your main response, briefly introduce the artifact but put ALL the substantial content in the artifact
- DO NOT fragment content between artifacts and your main response
- For code solutions, put the COMPLETE implementation in the artifact
- For documents or reports, the ENTIRE document should be in the artifact

DO NOT use artifacts for:
- Simple explanations or answers (less than 300 words)
- Short code snippets (<15 lines)
- Brief answers that work better as part of the conversation flow

# The user's message is:
{{USER_QUERY}}
`

// 格式化搜索结果的函数
export function formatSearchResults(results: SearchResult[]): string {
  return results
    .map(
      (result, index) => `[webpage ${index + 1} begin]
title: ${result.title}
URL: ${result.url}
content：${result.content || ''}
[webpage ${index + 1} end]`
    )
    .join('\n\n')
}
// 生成带搜索结果的提示词
export function generateSearchPrompt(query: string, results: SearchResult[]): string {
  if (results.length > 0) {
    return SEARCH_PROMPT_TEMPLATE.replace('{{SEARCH_RESULTS}}', formatSearchResults(results))
      .replace('{{USER_QUERY}}', query)
      .replace('{{CUR_DATE}}', new Date().toLocaleDateString())
  } else {
    return query
  }
}

// Add a function to generate search prompt with artifacts support
export function generateSearchPromptWithArtifacts(query: string, results: SearchResult[]): string {
  if (results.length > 0) {
    return SEARCH_PROMPT_ARTIFACTS_TEMPLATE.replace(
      '{{SEARCH_RESULTS}}',
      formatSearchResults(results)
    )
      .replace('{{USER_QUERY}}', query)
      .replace('{{CUR_DATE}}', new Date().toLocaleDateString())
  } else {
    return query
  }
}

export class ThreadPresenter implements IThreadPresenter {
  private activeConversationId: string | null = null
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private searchManager: SearchManager
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()
  public searchAssistantModel: MODEL_META | null = null
  public searchAssistantProviderId: string | null = null
  private searchingMessages: Set<string> = new Set()

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
    this.initializeUnfinishedMessages()

    eventBus.on(STREAM_EVENTS.RESPONSE, async (msg) => {
      const { eventId, content, reasoning_content } = msg
      const state = this.generatingMessages.get(eventId)
      if (state) {
        // 记录第一个token的时间
        if (state.firstTokenTime === null && (content || reasoning_content)) {
          state.firstTokenTime = Date.now()
          await this.messageManager.updateMessageMetadata(eventId, {
            firstTokenTime: Date.now() - state.startTime
          })
        }

        // 处理reasoning_content的时间戳
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
        if (content) {
          if (lastBlock && lastBlock.type === 'content') {
            lastBlock.content += content
          } else {
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
        if (reasoning_content) {
          if (lastBlock && lastBlock.type === 'reasoning_content') {
            lastBlock.content += reasoning_content
          } else {
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
      }
    })
    eventBus.on(STREAM_EVENTS.END, async (msg) => {
      const { eventId } = msg
      const state = this.generatingMessages.get(eventId)
      if (state) {
        state.message.content.forEach((block) => {
          block.status = 'success'
        })

        // 计算completion tokens
        let completionTokens = 0
        for (const block of state.message.content) {
          if (block.type === 'content' || block.type === 'reasoning_content') {
            completionTokens += approximateTokenSize(block.content)
          }
        }

        // 检查是否有内容块
        const hasContentBlock = state.message.content.some(
          (block) => block.type === 'content' || block.type === 'reasoning_content'
        )

        // 如果没有内容块，添加错误信息
        if (!hasContentBlock) {
          state.message.content.push({
            type: 'error',
            content: 'common.error.noModelResponse',
            status: 'error',
            timestamp: Date.now()
          })
        }

        const totalTokens = state.promptTokens + completionTokens
        const generationTime = Date.now() - (state.firstTokenTime ?? state.startTime)
        const tokensPerSecond = completionTokens / (generationTime / 1000)

        // 如果有reasoning_content，记录结束时间
        const metadata: Partial<MESSAGE_METADATA> = {
          totalTokens,
          inputTokens: state.promptTokens,
          outputTokens: completionTokens,
          generationTime,
          firstTokenTime: state.firstTokenTime ? state.firstTokenTime - state.startTime : 0,
          tokensPerSecond
        }

        if (state.reasoningStartTime !== null && state.lastReasoningTime !== null) {
          metadata.reasoningStartTime = state.reasoningStartTime - state.startTime
          metadata.reasoningEndTime = state.lastReasoningTime - state.startTime
        }

        // 更新消息的usage信息
        await this.messageManager.updateMessageMetadata(eventId, metadata)

        await this.messageManager.updateMessageStatus(eventId, 'sent')
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        this.generatingMessages.delete(eventId)
      }
    })
    eventBus.on(STREAM_EVENTS.ERROR, async (msg) => {
      const { eventId, error } = msg
      const state = this.generatingMessages.get(eventId)
      if (state) {
        await this.handleMessageError(eventId, String(error))
        this.generatingMessages.delete(eventId)
      }
    })
  }
  setSearchAssistantModel(model: MODEL_META, providerId: string) {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
  }
  async getSearchEngines(): Promise<SearchEngineTemplate[]> {
    return this.searchManager.getEngines()
  }
  async getActiveSearchEngine(): Promise<SearchEngineTemplate> {
    return this.searchManager.getActiveEngine()
  }
  async setActiveSearchEngine(engineId: string): Promise<void> {
    await this.searchManager.setActiveEngine(engineId)
  }

  /**
   * 测试当前选择的搜索引擎
   * @param query 测试搜索的关键词，默认为"天气"
   * @returns 测试是否成功打开窗口
   */
  async testSearchEngine(query: string = '天气'): Promise<boolean> {
    return await this.searchManager.testSearch(query)
  }

  /**
   * 设置搜索引擎
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
   * 处理消息错误状态的公共函数
   * @param messageId 消息ID
   * @param errorMessage 错误信息
   */
  private async handleMessageError(
    messageId: string,
    errorMessage: string = 'common.error.requestFailed'
  ): Promise<void> {
    const message = await this.messageManager.getMessage(messageId)
    if (!message) {
      return
    }

    let content: AssistantMessageBlock[] = []
    try {
      content = JSON.parse(message.content)
    } catch (e) {
      content = []
    }

    // 将所有loading状态的block改为error
    content.forEach((block: AssistantMessageBlock) => {
      if (block.status === 'loading') {
        block.status = 'error'
      }
    })

    // 添加错误信息block
    content.push({
      type: 'error',
      content: errorMessage,
      status: 'error',
      timestamp: Date.now()
    })

    // 更新消息状态和内容
    await this.messageManager.updateMessageStatus(messageId, 'error')
    await this.messageManager.editMessage(messageId, JSON.stringify(content))
  }

  /**
   * 初始化未完成的消息
   */
  private async initializeUnfinishedMessages(): Promise<void> {
    try {
      // 获取所有对话
      const { list: conversations } = await this.getConversationList(1, 1000)

      for (const conversation of conversations) {
        // 获取每个对话的消息
        const { list: messages } = await this.getMessages(conversation.id, 1, 1000)

        // 找出所有pending状态的assistant消息
        const pendingMessages = messages.filter(
          (msg) => msg.role === 'assistant' && msg.status === 'pending'
        )

        // 处理每个未完成的消息
        for (const message of pendingMessages) {
          await this.handleMessageError(message.id, 'common.error.sessionInterrupted')
        }
      }
    } catch (error) {
      console.error('初始化未完成消息失败:', error)
    }
  }

  /**
   * 删除指定ID的对话
   * @param conversationId 要删除的对话ID
   * @returns Promise<void> 操作完成的Promise
   * @description 此方法执行以下操作:
   * 1. 通过sqlitePresenter删除数据库中的对话记录
   * 2. 如果被删除的对话是当前活动对话，将activeConversationId重置为null
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = null
    }
  }

  /**
   * 重命名指定ID的对话
   * @param conversationId 要重命名的对话ID
   * @param title 新的对话标题
   * @returns Promise<CONVERSATION> 返回更新后的对话信息
   * @description 调用sqlitePresenter的renameConversation方法更新对话标题并返回更新后的对话完整信息
   */
  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.renameConversation(conversationId, title)
  }

  /**
   * 获取指定ID的对话详情
   * @param conversationId 要获取的对话ID
   * @returns Promise<CONVERSATION> 返回包含对话详细信息的Promise
   * @description 通过sqlitePresenter从数据库中查询并返回指定ID的对话完整信息
   */
  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  /**
   * 创建新对话
   * @param title 对话标题
   * @param settings 对话设置参数（可选）
   * @returns Promise<string> 返回新创建的对话ID
   * @description 此方法执行以下操作:
   * 1. 尝试获取最近的对话，如果存在且无消息，则直接返回该对话ID
   * 2. 合并默认设置与用户传入的设置
   * 3. 应用模型特定的默认参数（如maxTokens、contextLength等）
   * 4. 创建新对话并设置为活动对话
   */
  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    const latestConversation = await this.getLatestConversation()

    if (latestConversation) {
      const { list: messages } = await this.getMessages(latestConversation.id, 1, 1)
      if (messages.length === 0) {
        await this.setActiveConversation(latestConversation.id)
        return latestConversation.id
      }
    }
    let defaultSettings = DEFAULT_SETTINGS
    if (latestConversation?.settings) {
      defaultSettings = { ...latestConversation.settings }
      defaultSettings.systemPrompt = ''
    }
    Object.keys(settings).forEach((key) => {
      if (settings[key] === undefined || settings[key] === null || settings[key] === '') {
        delete settings[key]
      }
    })
    const mergedSettings = { ...defaultSettings, ...settings }
    const defaultModelsSettings = getModelConfig(mergedSettings.modelId)
    if (defaultModelsSettings) {
      mergedSettings.maxTokens = defaultModelsSettings.maxTokens
      mergedSettings.contextLength = defaultModelsSettings.contextLength
      mergedSettings.temperature = defaultModelsSettings.temperature
    }
    if (settings.artifacts) {
      mergedSettings.artifacts = settings.artifacts
    }
    const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)
    await this.setActiveConversation(conversationId)
    return conversationId
  }

  /**
   * 更新对话标题
   * @param conversationId 要更新的对话ID
   * @param title 新的对话标题
   * @returns Promise<void> 操作完成的Promise
   * @description 调用sqlitePresenter更新数据库中指定对话的标题
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
  }

  /**
   * 更新对话设置
   * @param conversationId 要更新的对话ID
   * @param settings 要更新的设置部分属性
   * @returns Promise<void> 操作完成的Promise
   * @description 此方法执行以下操作:
   * 1. 获取当前对话的完整信息
   * 2. 将传入的设置与现有设置合并
   * 3. 检查是否有模型ID变更，如有则可能更新相关的模型配置
   * 4. 将合并后的设置保存到数据库
   */
  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings, ...settings }
    console.log('updateConversationSettings', mergedSettings)
    // 检查是否有 modelId 的变化
    if (settings.modelId && settings.modelId !== conversation.settings.modelId) {
      // 获取模型配置
      const modelConfig = getModelConfig(mergedSettings.modelId)
      console.log('check model default config', modelConfig)
      if (modelConfig) {
        // 如果当前设置小于推荐值，则使用推荐值
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
  }

  /**
   * 获取对话列表
   * @param page 页码（从1开始）
   * @param pageSize 每页显示的对话数量
   * @returns Promise<{total: number; list: CONVERSATION[]}> 返回包含总数和对话列表的对象
   * @description 通过sqlitePresenter获取分页的对话列表，支持分页查询
   */
  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  /**
   * 设置当前活动对话
   * @param conversationId 要设置为活动的对话ID
   * @returns Promise<void> 操作完成的Promise
   * @description 此方法执行以下操作:
   * 1. 确认传入的对话ID存在
   * 2. 设置为当前活动对话
   * 3. 通过事件总线发送对话激活事件通知
   * 4. 如果对话不存在则抛出错误
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
   * 获取当前活动对话
   * @returns Promise<CONVERSATION | null> 返回当前活动对话信息，如果没有则返回null
   * @description 获取当前设置为活动的对话信息，如果activeConversationId为null则返回null
   */
  async getActiveConversation(): Promise<CONVERSATION | null> {
    if (!this.activeConversationId) {
      return null
    }
    return this.getConversation(this.activeConversationId)
  }

  /**
   * 获取指定对话的消息列表
   * @param conversationId 对话ID
   * @param page 页码（从1开始）
   * @param pageSize 每页显示的消息数量
   * @returns Promise<{total: number; list: Message[]}> 返回包含总数和消息列表的对象
   * @description 通过messageManager获取指定对话的分页消息列表
   */
  async getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return await this.messageManager.getMessageThread(conversationId, page, pageSize)
  }

  /**
   * 获取上下文消息列表
   * @param conversationId 对话ID
   * @returns Promise<Message[]> 返回上下文消息列表
   * @description 获取用于生成AI回复的上下文消息，会根据对话设置的上下文长度限制返回适当数量的消息
   */
  async getContextMessages(conversationId: string): Promise<Message[]> {
    const conversation = await this.getConversation(conversationId)
    // 计算需要获取的消息数量（假设每条消息平均300字）
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    return await this.messageManager.getContextMessages(conversationId, messageCount)
  }

  /**
   * 清除对话上下文
   * @param conversationId 对话ID
   * @returns Promise<void> 操作完成的Promise
   * @description 清除指定对话的所有消息历史，保留对话本身但删除所有消息
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
   *
   * @param conversationId
   * @param content
   * @param role
   * @returns 如果是user的消息，返回ai生成的message，否则返回空
   */
  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE
  ): Promise<AssistantMessage | null> {
    const conversation = await this.getConversation(conversationId)
    const { providerId, modelId } = conversation.settings
    console.log('sendMessage', conversation)
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

  private async generateAIResponse(conversationId: string, userMessageId: string) {
    try {
      const triggerMessage = await this.messageManager.getMessage(userMessageId)
      if (!triggerMessage) {
        throw new Error('找不到触发消息')
      }

      await this.messageManager.updateMessageStatus(userMessageId, 'sent')

      const conversation = await this.getConversation(conversationId)
      const { providerId, modelId } = conversation.settings
      const assistantMessage = (await this.messageManager.sendMessage(
        conversationId,
        JSON.stringify([]),
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
      await this.messageManager.updateMessageStatus(userMessageId, 'error')
      console.error('生成 AI 响应失败:', error)
      throw error
    }
  }

  async getMessage(messageId: string): Promise<Message> {
    return await this.messageManager.getMessage(messageId)
  }

  /**
   * 获取指定消息之前的历史消息
   * @param messageId 消息ID
   * @param limit 限制返回的消息数量
   * @returns 历史消息列表，按时间正序排列
   */
  private async getMessageHistory(messageId: string, limit: number = 100): Promise<Message[]> {
    const message = await this.messageManager.getMessage(messageId)
    if (!message) {
      throw new Error('找不到指定的消息')
    }

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

  private async rewriteUserSearchQuery(
    query: string,
    contextMessages: string,
    conversationId: string,
    searchEngine: string
  ): Promise<string> {
    const rewritePrompt = `
    你是一个搜索优化专家。基于以下内容，生成一个优化的搜索查询：

    当前时间：${new Date().toISOString()}
    搜索引擎：${searchEngine}

    请遵循以下规则重写搜索查询：
    1. 根据用户的问题和上下文，重写应该进行搜索的关键词
    2. 如果需要使用时间，则根据当前时间给出需要查询的具体时间日期信息
    3. 编程相关查询：
        - 加上编程语言或框架名称
        - 指定错误代码或具体版本号
    4. 保持查询简洁，通常不超过5-6个关键词
    5. 默认保留用户的问题的语言，如果用户的问题是中文，则返回中文，如果用户的问题是英文，则返回英文，其他语言也一样

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
    // console.log('rewriteUserSearchQuery', query, contextMessages, conversation.id)
    const { providerId, modelId } = conversation.settings
    try {
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
      console.log('rewriteUserSearchQuery', rewrittenQuery)
      return rewrittenQuery.trim() || query
    } catch (error) {
      console.error('重写搜索查询失败:', error)
      return query
    }
  }

  /**
   * 检查消息是否已被取消
   * @param messageId 消息ID
   * @returns 是否已被取消
   */
  private isMessageCancelled(messageId: string): boolean {
    const state = this.generatingMessages.get(messageId)
    return !state || state.isCancelled === true
  }

  /**
   * 如果消息已被取消，则抛出错误
   * @param messageId 消息ID
   */
  private throwIfCancelled(messageId: string): void {
    if (this.isMessageCancelled(messageId)) {
      throw new Error('common.error.userCanceledGeneration')
    }
  }

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

    // 添加搜索加载状态
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

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      const formattedContext = contextMessages
        .map((msg) => {
          if (msg.role === 'user') {
            return `user: ${msg.content.text}${getFileContext(msg.content.files)}`
          } else if (msg.role === 'ai') {
            return `assistant: ${msg.content.blocks.map((block) => block.content).join('')}`
          } else {
            return JSON.stringify(msg.content)
          }
        })
        .join('\n')

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      searchBlock.status = 'optimizing'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 重写搜索查询
      const optimizedQuery = await this.rewriteUserSearchQuery(
        query,
        formattedContext,
        conversationId,
        this.searchManager.getActiveEngine().name
      )

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      // 更新搜索状态为阅读中
      searchBlock.status = 'reading'
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 开始搜索
      const results = await this.searchManager.search(conversationId, optimizedQuery)

      // 检查是否已被取消
      this.throwIfCancelled(messageId)

      searchBlock.status = 'loading'
      searchBlock.extra = {
        total: results.length
      }
      await this.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      // 保存搜索结果
      for (const result of results) {
        // 检查是否已被取消
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

      // 检查是否已被取消
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

  private async getLastUserMessage(conversationId: string): Promise<Message | null> {
    return await this.messageManager.getLastUserMessage(conversationId)
  }

  // 从数据库获取搜索结果
  async getSearchResults(messageId: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    return results.map((result) => JSON.parse(result.content) as SearchResult) ?? []
  }

  /**
   * 启动流式生成完成
   * 这是整个流式生成过程的主入口，协调各个环节并启动大模型的流式响应
   *
   * @param conversationId 会话ID，标识当前对话上下文
   * @param queryMsgId 可选的查询消息ID，用于重新生成特定消息的响应
   * @returns 无返回值，异步执行
   */
  async startStreamCompletion(conversationId: string, queryMsgId?: string) {
    // 查找与会话关联的生成状态
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

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 2. 处理用户消息内容
      const { userContent, urlResults, imageFiles } =
        await this.processUserMessageContent(userMessage)

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 3. 处理搜索（如果需要）
      let searchResults: SearchResult[] | null = null
      if (userMessage.content.search) {
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

      // 4. 准备提示内容 - 构建完整的提示，包括系统提示、上下文、搜索结果等
      const { finalContent, promptTokens } = this.preparePromptContent(
        conversation,
        userContent,
        contextMessages,
        searchResults,
        urlResults,
        userMessage,
        imageFiles
      )

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 5. 更新生成状态
      await this.updateGenerationState(state, promptTokens)

      // 检查是否已被取消
      this.throwIfCancelled(state.message.id)

      // 6. 启动流式生成
      const { providerId, modelId, temperature, maxTokens } = conversation.settings
      await this.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        state.message.id,
        temperature,
        maxTokens
      )
    } catch (error) {
      // 检查是否是取消错误
      if (String(error).includes('userCanceledGeneration')) {
        console.log('消息生成已被用户取消')
        return
      }

      console.error('流式生成过程中出错:', error)
      await this.handleMessageError(state.message.id, String(error))
      throw error
    }
  }

  /**
   * 查找指定会话的生成状态
   * @param conversationId 会话ID
   * @returns 找到的生成状态，如果未找到则返回null
   */
  private findGeneratingState(conversationId: string): GeneratingMessageState | null {
    return (
      Array.from(this.generatingMessages.values()).find(
        (state) => state.conversationId === conversationId
      ) || null
    )
  }

  /**
   * 准备会话上下文
   * 获取会话信息、用户消息和历史上下文消息
   *
   * @param conversationId 会话ID
   * @param queryMsgId 可选的查询消息ID，用于重新生成特定消息
   * @returns 包含会话、用户消息和上下文消息的对象
   */
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
      // 处理指定消息ID的情况（重新生成某条消息）
      const queryMessage = await this.getMessage(queryMsgId)
      if (!queryMessage || !queryMessage.parentId) {
        throw new Error('找不到指定的消息')
      }
      userMessage = await this.getMessage(queryMessage.parentId)
      if (!userMessage) {
        throw new Error('找不到触发消息')
      }
      // 获取消息历史，限制长度为会话配置的上下文长度
      contextMessages = await this.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )
    } else {
      // 获取最新的用户消息和上下文消息
      userMessage = await this.getLastUserMessage(conversationId)
      if (!userMessage) {
        throw new Error('找不到用户消息')
      }
      contextMessages = await this.getContextMessages(conversationId)
    }
    // 任何情况都使用最新配置
    const webSearchEnabled = this.configPresenter.getSetting('input_webSearch')
    const thinkEnabled = this.configPresenter.getSetting('input_deepThinking')
    userMessage.content.search = webSearchEnabled
    userMessage.content.think = thinkEnabled
    return { conversation, userMessage, contextMessages }
  }

  /**
   * 处理用户消息内容
   * 提取文本内容、URL和图片文件
   *
   * @param userMessage 用户消息对象
   * @returns 包含处理后的用户内容、URL结果和图片文件的对象
   */
  private async processUserMessageContent(userMessage: UserMessage): Promise<{
    userContent: string
    urlResults: SearchResult[]
    imageFiles: MessageFile[] // 图片文件列表
  }> {
    // 处理文本内容，包括图片文件的上下文
    const userContent = `
      ${userMessage.content.text}
      ${getFileContext(userMessage.content.files.filter((file) => !file.mime?.startsWith('image/')))}
    `

    // 从用户消息中提取并丰富URL内容
    const urlResults = await ContentEnricher.extractAndEnrichUrls(userMessage.content.text)

    // 提取图片文件（通过MIME类型或文件扩展名识别）
    const imageFiles =
      userMessage.content.files?.filter((file) => {
        // 根据文件类型、MIME类型或扩展名过滤图片文件
        const isImage =
          file.mime?.startsWith('image/') ||
          /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name || '')
        return isImage
      }) || []

    return { userContent, urlResults, imageFiles }
  }

  /**
   * 准备提示内容
   * 构建完整的提示，包括系统提示、上下文、用户消息和搜索结果等
   *
   * @param conversation 会话对象
   * @param userContent 用户内容
   * @param contextMessages 上下文消息
   * @param searchResults 搜索结果（可选）
   * @param urlResults URL结果
   * @param userMessage 用户消息对象
   * @param imageFiles 图片文件列表
   * @returns 包含最终内容和提示token数量的对象
   */
  private preparePromptContent(
    conversation: CONVERSATION,
    userContent: string,
    contextMessages: Message[],
    searchResults: SearchResult[] | null,
    urlResults: SearchResult[],
    userMessage: Message,
    imageFiles: MessageFile[]
  ): {
    finalContent: ChatMessage[]
    promptTokens: number
  } {
    const { systemPrompt, contextLength, artifacts } = conversation.settings

    // 计算搜索提示词和丰富用户消息
    const searchPrompt = searchResults
      ? artifacts === 1
        ? generateSearchPromptWithArtifacts(userContent, searchResults)
        : generateSearchPrompt(userContent, searchResults)
      : ''
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
      imageFiles
    )

    // 合并连续的相同角色消息（优化token使用）
    const mergedMessages = this.mergeConsecutiveMessages(formattedMessages)

    // 计算prompt tokens
    let promptTokens = 0
    for (const msg of mergedMessages) {
      if (typeof msg.content === 'string') {
        promptTokens += approximateTokenSize(msg.content)
      } else {
        promptTokens +=
          approximateTokenSize(msg.content.map((item) => item.text).join('')) +
          imageFiles.reduce((acc, file) => acc + file.token, 0)
      }
    }

    return { finalContent: mergedMessages, promptTokens }
  }

  /**
   * 选择上下文消息
   * 在token限制内选择合适的上下文消息
   *
   * @param contextMessages 所有上下文消息
   * @param userMessage 当前用户消息
   * @param remainingContextLength 剩余可用的上下文长度
   * @returns 选择后的上下文消息数组
   */
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
          ? `${msg.content.text}${getFileContext(msg.content.files)}`
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

  /**
   * 格式化消息用于完成
   * 将消息转换为LLM API所需的格式
   *
   * @param contextMessages 上下文消息
   * @param systemPrompt 系统提示
   * @param artifacts artifacts设置（是否启用特殊格式生成）
   * @param searchPrompt 搜索提示
   * @param userContent 用户内容
   * @param enrichedUserMessage 丰富后的用户消息
   * @param imageFiles 图片文件列表
   * @returns 格式化后的消息数组
   */
  private formatMessagesForCompletion(
    contextMessages: Message[],
    systemPrompt: string,
    artifacts: number,
    searchPrompt: string,
    userContent: string,
    enrichedUserMessage: string,
    imageFiles: MessageFile[]
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
    formattedMessages.push(...this.addContextMessages(formattedMessages, contextMessages))

    // 添加当前用户消息
    let finalContent = searchPrompt || userContent

    if (enrichedUserMessage) {
      finalContent += enrichedUserMessage
    }

    if (artifacts === 1) {
      formattedMessages.push({
        role: 'user',
        content: ARTIFACTS_PROMPT
      })
    }

    if (imageFiles.length > 0) {
      formattedMessages.push(this.addImageFiles(finalContent, imageFiles))
    } else {
      formattedMessages.push({
        role: 'user',
        content: finalContent.trim()
      })
    }

    return formattedMessages
  }

  /**
   * 添加图片文件到消息中
   * 将图片文件转换为API支持的格式
   *
   * @param finalContent 最终文本内容
   * @param imageFiles 图片文件列表
   * @returns 包含图片和文本的消息对象
   */
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
    contextMessages: Message[]
  ): ChatMessage[] {
    const resultMessages = [...formattedMessages]
    contextMessages.forEach((msg) => {
      const content =
        msg.role === 'user'
          ? `${msg.content.text}${getFileContext(msg.content.files)}`
          : msg.content
              .filter((block) => block.type === 'content')
              .map((block) => block.content)
              .join('\n')

      if (msg.role === 'assistant' && !content) {
        return // 如果是assistant且content为空，则不加入
      }

      resultMessages.push({
        role: msg.role as 'user' | 'assistant',
        content
      })
    })
    return resultMessages
  }

  /**
   * 合并连续的相同角色消息
   * 优化token使用，减少API请求中的消息数量
   *
   * @param messages 消息数组
   * @returns 合并后的消息数组
   */
  private mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
    const mergedMessages: ChatMessage[] = []

    for (let i = 0; i < messages.length; i++) {
      const currentMessage = messages[i]
      if (
        mergedMessages.length > 0 &&
        mergedMessages[mergedMessages.length - 1].role === currentMessage.role
      ) {
        mergedMessages[mergedMessages.length - 1].content += `\n${currentMessage.content}`
      } else {
        mergedMessages.push({ ...currentMessage })
      }
    }

    return mergedMessages
  }

  /**
   * 更新生成状态
   * 记录token数量等信息，为流式生成做准备
   *
   * @param state 当前生成状态
   * @param promptTokens 提示token数量
   */
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
      message: assistantMessage,
      conversationId: message.conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    return assistantMessage
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
            length: `${msg.content.text}${getFileContext(msg.content.files)}`.length,
            formattedMessage: {
              role: 'user' as const,
              content: `${msg.content.text}${getFileContext(msg.content.files)}`
            }
          }
        } else {
          const content = msg.content
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
    const cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
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
}
