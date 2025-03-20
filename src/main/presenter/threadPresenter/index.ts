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

/**
 * 默认对话设置
 * 包含系统提示词、温度、上下文长度、最大令牌数、提供商ID、模型ID和工件设置
 */
const DEFAULT_SETTINGS: CONVERSATION_SETTINGS = {
  systemPrompt: '',
  temperature: 0.7,
  contextLength: 1000,
  maxTokens: 2000,
  providerId: 'openai',
  modelId: 'gpt-4',
  artifacts: 0
}

/**
 * 生成消息状态接口
 * 用于跟踪消息生成过程中的各种状态和时间点
 */
interface GeneratingMessageState {
  message: AssistantMessage            // 正在生成的助手消息
  conversationId: string               // 所属对话ID
  startTime: number                    // 开始生成时间
  firstTokenTime: number | null        // 第一个令牌生成时间
  promptTokens: number                 // 提示词令牌数
  reasoningStartTime: number | null    // 推理开始时间
  reasoningEndTime: number | null      // 推理结束时间
  lastReasoningTime: number | null     // 最后推理时间
  isSearching?: boolean                // 是否正在搜索
  isCancelled?: boolean                // 是否已取消
}

/**
 * 搜索提示模板
 * 用于指导AI如何处理和引用搜索结果
 */
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

/**
 * 支持工件的搜索提示模板
 * 在基本搜索提示的基础上，增加了对工件(artifacts)的支持说明
 */
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

/**
 * 格式化搜索结果的函数
 * 将搜索结果数组转换为格式化的字符串，每个结果包含标题、URL和内容
 * @param results 搜索结果数组
 * @returns 格式化后的搜索结果字符串
 */
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

/**
 * 生成带搜索结果的提示词
 * 将用户查询和搜索结果合并到搜索提示模板中
 * @param query 用户查询
 * @param results 搜索结果数组
 * @returns 完整的搜索提示词
 */
export function generateSearchPrompt(query: string, results: SearchResult[]): string {
  if (results.length > 0) {
    return SEARCH_PROMPT_TEMPLATE.replace('{{SEARCH_RESULTS}}', formatSearchResults(results))
      .replace('{{USER_QUERY}}', query)
      .replace('{{CUR_DATE}}', new Date().toLocaleDateString())
  } else {
    return query
  }
}

/**
 * 生成支持工件的搜索提示词
 * 将用户查询和搜索结果合并到支持工件的搜索提示模板中
 * @param query 用户查询
 * @param results 搜索结果数组
 * @returns 完整的支持工件的搜索提示词
 */
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

/**
 * 线程演示器类
 * 实现IThreadPresenter接口，管理对话、消息和生成过程
 */
export class ThreadPresenter implements IThreadPresenter {
  private activeConversationId: string | null = null                // 当前活动对话ID
  private sqlitePresenter: ISQLitePresenter                         // SQLite数据库演示器
  private messageManager: MessageManager                            // 消息管理器
  private llmProviderPresenter: ILlmProviderPresenter               // LLM提供商演示器
  private configPresenter: IConfigPresenter                         // 配置演示器
  private searchManager: SearchManager                              // 搜索管理器
  private generatingMessages: Map<string, GeneratingMessageState> = new Map()  // 正在生成的消息映射
  public searchAssistantModel: MODEL_META | null = null             // 搜索助手模型
  public searchAssistantProviderId: string | null = null            // 搜索助手提供商ID
  private searchingMessages: Set<string> = new Set()                // 正在搜索的消息集合

  /**
   * 构造函数
   * 初始化线程演示器并设置事件监听器
   * @param sqlitePresenter SQLite数据库演示器
   * @param llmProviderPresenter LLM提供商演示器
   * @param configPresenter 配置演示器
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
    this.initializeUnfinishedMessages()

    // 监听响应事件，更新消息内容和元数据
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
            // 如果最后一个块是内容块，则追加内容
            lastBlock.content += content
          } else {
            // 否则将上一个块标记为成功，并创建新的内容块
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
            // 如果最后一个块是推理内容块，则追加内容
            lastBlock.content += reasoning_content
          } else {
            // 否则将上一个块标记为成功，并创建新的推理内容块
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

    // 监听流结束事件，完成消息生成
    eventBus.on(STREAM_EVENTS.END, async (msg) => {
      const { eventId } = msg
      const state = this.generatingMessages.get(eventId)
      if (state) {
        // 将所有内容块标记为成功
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

        // 计算总token数和生成时间相关指标
        const totalTokens = state.promptTokens + completionTokens
        const generationTime = Date.now() - (state.firstTokenTime ?? state.startTime)
        const tokensPerSecond = completionTokens / (generationTime / 1000)

        // 准备元数据对象
        const metadata: Partial<MESSAGE_METADATA> = {
          totalTokens,
          inputTokens: state.promptTokens,
          outputTokens: completionTokens,
          generationTime,
          firstTokenTime: state.firstTokenTime ? state.firstTokenTime - state.startTime : 0,
          tokensPerSecond
        }

        // 如果有reasoning_content，记录推理时间
        if (state.reasoningStartTime !== null && state.lastReasoningTime !== null) {
          metadata.reasoningStartTime = state.reasoningStartTime - state.startTime
          metadata.reasoningEndTime = state.lastReasoningTime - state.startTime
        }

        // 更新消息的元数据和状态
        await this.messageManager.updateMessageMetadata(eventId, metadata)
        await this.messageManager.updateMessageStatus(eventId, 'sent')
        await this.messageManager.editMessage(eventId, JSON.stringify(state.message.content))
        
        // 清理生成状态
        this.generatingMessages.delete(eventId)
      }
    })

    // 监听错误事件，处理生成过程中的错误
    eventBus.on(STREAM_EVENTS.ERROR, async (msg) => {
      const { eventId, error } = msg
      const state = this.generatingMessages.get(eventId)
      if (state) {
        await this.handleMessageError(eventId, String(error))
        this.generatingMessages.delete(eventId)
      }
    })
  }

  /**
   * 设置搜索助手模型
   * 用于指定搜索查询优化时使用的模型
   * @param model 模型元数据
   * @param providerId 提供商ID
   */
  setSearchAssistantModel(model: MODEL_META, providerId: string) {
    this.searchAssistantModel = model
    this.searchAssistantProviderId = providerId
  }

  /**
   * 获取所有搜索引擎
   * @returns 搜索引擎模板数组
   */
  async getSearchEngines(): Promise<SearchEngineTemplate[]> {
    return this.searchManager.getEngines()
  }

  /**
   * 获取当前活动的搜索引擎
   * @returns 活动的搜索引擎模板
   */
  async getActiveSearchEngine(): Promise<SearchEngineTemplate> {
    return this.searchManager.getActiveEngine()
  }

  /**
   * 设置活动的搜索引擎
   * @param engineId 搜索引擎ID
   */
  async setActiveSearchEngine(engineId: string): Promise<void> {
    await this.searchManager.setActiveEngine(engineId)
  }

  /**
   * 测试当前选择的搜索引擎
   * 尝试使用指定查询打开搜索引擎窗口
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
   * 更新消息内容和状态以反映错误
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

    // 解析消息内容
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
   * 在应用启动时处理所有处于pending状态的消息
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
   * 重命名对话
   * @param conversationId 对话ID
   * @param title 新标题
   * @returns 更新后的对话
   */
  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.renameConversation(conversationId, title)
  }

  /**
   * 创建新对话
   * 如果最新对话没有消息，则直接使用它
   * @param title 对话标题
   * @param settings 对话设置
   * @returns 新创建的对话ID
   */
  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    const latestConversation = await this.getLatestConversation()

    // 如果最新对话没有消息，直接使用它
    if (latestConversation) {
      const { list: messages } = await this.getMessages(latestConversation.id, 1, 1)
      if (messages.length === 0) {
        await this.setActiveConversation(latestConversation.id)
        return latestConversation.id
      }
    }

    // 准备对话设置
    let defaultSettings = DEFAULT_SETTINGS
    if (latestConversation?.settings) {
      // 从最新对话继承设置，但清空系统提示词
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
    
    // 应用模型默认配置
    const defaultModelsSettings = getModelConfig(mergedSettings.modelId)
    if (defaultModelsSettings) {
      mergedSettings.maxTokens = defaultModelsSettings.maxTokens
      mergedSettings.contextLength = defaultModelsSettings.contextLength
      mergedSettings.temperature = defaultModelsSettings.temperature
    }
    
    // 保留工件设置
    if (settings.artifacts) {
      mergedSettings.artifacts = settings.artifacts
    }
    
    // 创建对话并设为活动
    const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)
    await this.setActiveConversation(conversationId)
    return conversationId
  }

  /**
   * 删除对话
   * 如果删除的是当前活动对话，则清空活动对话ID
   * @param conversationId 对话ID
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = null
    }
  }

  /**
   * 获取对话
   * @param conversationId 对话ID
   * @returns 对话对象
   */
  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  /**
   * 更新对话标题
   * @param conversationId 对话ID
   * @param title 新标题
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
  }

  /**
   * 更新对话设置
   * 如果模型ID变化，会应用新模型的默认配置
   * @param conversationId 对话ID
   * @param settings 新设置
   */
  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings, ...settings }
    console.log('updateConversationSettings', mergedSettings)
    
    // 检查是否有模型ID的变化，如果有则应用新模型的默认配置
    if (settings.modelId && settings.modelId !== conversation.settings.modelId) {
      // 获取模型配置
      const modelConfig = getModelConfig(mergedSettings.modelId)
      console.log('check model default config', modelConfig)
      if (modelConfig) {
        // 使用模型推荐值
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
  }

  /**
   * 获取对话列表
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 对话列表和总数
   */
  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

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
   * 获取当前活动的对话
   * @returns 当前活动的对话对象或null
   */
  async getActiveConversation(): Promise<CONVERSATION | null> {
    if (!this.activeConversationId) {
      return null
    }
    return this.getConversation(this.activeConversationId)
  }

  /**
   * 获取对话的消息列表
   * @param conversationId 对话ID
   * @param page 页码
   * @param pageSize 每页大小
   * @returns 消息列表和总数
   */
  async getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return await this.messageManager.getMessageThread(conversationId, page, pageSize)
  }

  /**
   * 获取对话的上下文消息
   * @param conversationId 对话ID
   * @returns 上下文消息列表
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
   * 清除对话的上下文消息
   * @param conversationId 对话ID
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
   * @param conversationId 对话ID
   * @param content 消息内容
   * @param role 消息角色
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

  /**
   * 生成AI响应
   * @param conversationId 对话ID
   * @param userMessageId 用户消息ID
   * @returns 生成的AI响应消息
   */
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

  /**
   * 获取指定消息
   * @param messageId 消息ID
   * @returns 消息对象
   */
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

  /**
   * 重写用户搜索查询
   * @param query 用户搜索查询
   * @param contextMessages 上下文消息
   * @param conversationId 对话ID
   * @param searchEngine 搜索引擎名称 
   * @returns 重写后的搜索查询
   */
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

  /**
   * 开始流式搜索
   * @param conversationId 对话ID
   * @param messageId 消息ID
   * @param query 搜索查询
   * @returns 搜索结果
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

  /**
   * 获取最后一条用户消息
   * @param conversationId 对话ID
   * @returns 最后一条用户消息或null
   */
  private async getLastUserMessage(conversationId: string): Promise<Message | null> {
    return await this.messageManager.getLastUserMessage(conversationId)
  }

  /**
   * 从数据库获取搜索结果
   * @param messageId 消息ID
   * @returns 搜索结果列表
   */
  async getSearchResults(messageId: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    return results.map((result) => JSON.parse(result.content) as SearchResult) ?? []
  }

  /**
   * 开始流式生成
   * @param conversationId 对话ID
   * @param queryMsgId 查询消息ID
   * @description 开始AI响应的流式生成过程，包括准备对话上下文、处理用户消息内容、
   * 执行搜索（如果需要）、构建提示词、调用LLM提供商生成回复，并处理流式响应。
   * 整个过程会更新消息状态，跟踪生成时间，并在完成后计算相关指标。
   * 如果用户取消生成，会立即停止并清理相关状态。
   * 该方法是AI生成过程的核心入口点，协调了多个子流程的执行，包括上下文准备、
   * 内容处理、搜索集成、提示词构建和流式响应处理等关键步骤。
   */
  async startStreamCompletion(conversationId: string, queryMsgId?: string) {
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

      // 4. 准备提示内容
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
   * 查找特定会话的生成状态
   * @param conversationId 会话ID
   * @returns 生成状态对象或null
   * @description 从当前正在生成的消息集合中查找指定会话ID的生成状态
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
   * @param conversationId 会话ID
   * @param queryMsgId 可选的查询消息ID
   * @returns 包含会话、用户消息和上下文消息的对象
   * @description 根据会话ID和可选的查询消息ID，获取会话信息、用户消息和相关的上下文消息
   * 如果提供了queryMsgId，则获取该消息的父消息作为用户消息
   * 否则获取会话中最新的用户消息
   * 同时应用最新的配置设置（如网络搜索和深度思考功能）
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
    const webSearchEnabled = this.configPresenter.getSetting('input_webSearch')
    const thinkEnabled = this.configPresenter.getSetting('input_deepThinking')
    userMessage.content.search = webSearchEnabled
    userMessage.content.think = thinkEnabled
    return { conversation, userMessage, contextMessages }
  }

  /**
   * 处理用户消息内容
   * @param userMessage 用户消息对象
   * @returns 处理后的用户内容、URL结果和图片文件
   * @description 从用户消息中提取文本内容、处理附件文件、提取并丰富URL内容，
   * 并识别图片文件。返回处理后的用户内容文本、URL搜索结果和图片文件列表。
   */
  private async processUserMessageContent(userMessage: UserMessage): Promise<{
    userContent: string
    urlResults: SearchResult[]
    imageFiles: MessageFile[] // 图片文件列表
  }> {
    // 处理文本内容
    const userContent = `
      ${userMessage.content.text}
      ${getFileContext(userMessage.content.files.filter((file) => !file.mime?.startsWith('image/')))}
    `

    // 从用户消息中提取并丰富URL内容
    const urlResults = await ContentEnricher.extractAndEnrichUrls(userMessage.content.text)

    // 提取图片文件
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
   * @param conversation 会话对象
   * @param userContent 用户内容
   * @param contextMessages 上下文消息
   * @param searchResults 搜索结果
   * @param urlResults URL结果
   * @param userMessage 用户消息
   * @param imageFiles 图片文件
   * @returns 最终的提示内容和提示token数量
   * @description 根据各种输入准备完整的提示内容，包括系统提示、搜索结果、
   * 用户消息内容、URL内容和上下文消息。计算token使用情况，并根据上下文长度
   * 限制选择合适的上下文消息。最后格式化并合并消息，返回最终的提示内容和token数量。
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

    // 合并连续的相同角色消息
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
   * @param contextMessages 所有上下文消息
   * @param userMessage 当前用户消息
   * @param remainingContextLength 剩余可用的上下文长度
   * @returns 选择的上下文消息数组
   * @description 根据剩余的上下文长度限制，从历史消息中选择合适的消息作为上下文。
   * 优先选择最近的消息，并确保总token数不超过剩余上下文长度。
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
   * @param contextMessages 上下文消息
   * @param systemPrompt 系统提示
   * @param artifacts 工件设置
   * @param searchPrompt 搜索提示
   * @param userContent 用户内容
   * @param enrichedUserMessage 丰富的用户消息
   * @param imageFiles 图片文件
   * @returns 格式化后的聊天消息数组
   * @description 将各种输入组合成格式化的聊天消息数组，包括系统提示、上下文消息、
   * 当前用户消息（可能包含搜索结果和URL内容）以及图片文件。
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
   * 添加图片文件到消息
   * @param finalContent 最终文本内容
   * @param imageFiles 图片文件数组
   * @returns 包含图片和文本的聊天消息
   * @description 创建一个包含图片URL和文本内容的多模态聊天消息
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

  /**
   * 添加上下文消息
   * @param formattedMessages 已格式化的消息数组
   * @param contextMessages 上下文消息
   * @returns 添加上下文后的消息数组
   * @description 将历史上下文消息添加到格式化消息数组中，处理不同角色消息的内容格式
   */
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
   * @param messages 消息数组
   * @returns 合并后的消息数组
   * @description 将连续的相同角色消息合并为一条消息，以优化token使用和提高对话连贯性
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
   * @param state 生成状态对象
   * @param promptTokens 提示token数量
   * @returns Promise<void>
   * @description 更新消息的生成状态，包括开始时间和token使用情况，
   * 并将这些信息保存到消息的元数据中
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

  /**
   * 编辑消息内容
   * @param messageId 消息ID
   * @param content 新的消息内容
   * @returns 更新后的消息对象
   * @description 更新指定消息的内容
   */
  async editMessage(messageId: string, content: string): Promise<Message> {
    return await this.messageManager.editMessage(messageId, content)
  }

  /**
   * 删除消息
   * @param messageId 消息ID
   * @returns Promise<void>
   * @description 从数据库中删除指定的消息
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.messageManager.deleteMessage(messageId)
  }

  /**
   * 重试消息生成
   * @param messageId 消息ID
   * @returns 新创建的助手消息
   * @description 重新生成指定的助手消息，创建新的消息实例并初始化生成状态
   */
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

  /**
   * 获取消息变体
   * @param messageId 消息ID
   * @returns 消息变体数组
   * @description 获取指定消息的所有变体版本
   */
  async getMessageVariants(messageId: string): Promise<Message[]> {
    return await this.messageManager.getMessageVariants(messageId)
  }

  /**
   * 更新消息状态
   * @param messageId 消息ID
   * @param status 新状态
   * @returns Promise<void>
   * @description 更新指定消息的状态（如成功、错误等）
   */
  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.messageManager.updateMessageStatus(messageId, status)
  }

  /**
   * 更新消息元数据
   * @param messageId 消息ID
   * @param metadata 元数据对象
   * @returns Promise<void>
   * @description 更新指定消息的元数据信息（如token使用、生成时间等）
   */
  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    await this.messageManager.updateMessageMetadata(messageId, metadata)
  }

  /**
   * 标记消息为上下文边界
   * @param messageId 消息ID
   * @param isEdge 是否为边界
   * @returns Promise<void>
   * @description 将消息标记为上下文边界，用于控制上下文窗口的范围
   */
  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.messageManager.markMessageAsContextEdge(messageId, isEdge)
  }

  /**
   * 获取当前活动会话ID
   * @returns 活动会话ID或null
   * @description 返回当前正在使用的会话ID
   */
  async getActiveConversationId(): Promise<string | null> {
    return this.activeConversationId
  }

  /**
   * 获取最新的会话
   * @returns 最新会话或null
   * @description 获取数据库中最新创建的会话
   */
  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
  }

  /**
   * 获取生成消息状态
   * @param messageId 消息ID
   * @returns 生成状态或null
   * @description 获取指定消息的生成状态信息
   */
  getGeneratingMessageState(messageId: string): GeneratingMessageState | null {
    return this.generatingMessages.get(messageId) || null
  }

  /**
   * 获取会话中正在生成的消息
   * @param conversationId 会话ID
   * @returns 助手消息数组
   * @description 获取指定会话中所有正在生成的助手消息
   */
  getConversationGeneratingMessages(conversationId: string): AssistantMessage[] {
    return Array.from(this.generatingMessages.values())
      .filter((state) => state.conversationId === conversationId)
      .map((state) => state.message)
  }

  /**
   * 停止消息生成
   * @param messageId 消息ID
   * @returns Promise<void>
   * @description 停止指定消息的生成过程，包括搜索和LLM生成，
   * 更新消息状态为取消，并清理相关资源
   */
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

  /**
   * 停止会话中所有消息的生成
   * @param conversationId 会话ID
   * @returns Promise<void>
   * @description 停止指定会话中所有正在生成的消息
   */
  async stopConversationGeneration(conversationId: string): Promise<void> {
    const messageIds = Array.from(this.generatingMessages.entries())
      .filter(([, state]) => state.conversationId === conversationId)
      .map(([messageId]) => messageId)

    await Promise.all(messageIds.map((messageId) => this.stopMessageGeneration(messageId)))
  }

  /**
   * 生成会话标题摘要
   * @param providerId 可选的提供商ID
   * @param modelId 可选的模型ID
   * @returns 生成的标题
   * @description 使用LLM为当前会话生成一个标题摘要，基于会话内容
   * 如果未提供providerId和modelId，则使用默认的搜索助手模型或会话设置
   */
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
    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    console.log('-------------> cleanedTitle \n', cleanedTitle)
    return cleanedTitle
  }

  /**
   * 清除当前活动线程
   * @returns Promise<void>
   * @description 清除当前活动线程，设置活动会话ID为null，并触发会话取消事件
   */
  async clearActiveThread(): Promise<void> {
    this.activeConversationId = null
    eventBus.emit(CONVERSATION_EVENTS.DEACTIVATED)
  }

  /**
   * 清除所有消息
   * @param conversationId 会话ID
   * @returns Promise<void>
   * @description 清除指定会话中的所有消息，并停止所有正在生成的消息
   */
  async clearAllMessages(conversationId: string): Promise<void> {
    await this.messageManager.clearAllMessages(conversationId)
    // 如果是当前活动会话，需要更新生成状态
    if (conversationId === this.activeConversationId) {
      // 停止所有正在生成的消息
      await this.stopConversationGeneration(conversationId)
    }
  }

  /**
   * 获取消息附加信息
   * @param messageId 消息ID
   * @param type 附加信息类型
   * @returns Promise<Record<string, unknown>[]>  
   */
  async getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]> {
    const attachments = await this.sqlitePresenter.getMessageAttachments(messageId, type)
    return attachments.map((attachment) => JSON.parse(attachment.content))
  }

  /**
   * 获取主消息
   * @param conversationId 会话ID
   * @param parentId 父消息ID
   * @returns Promise<Message | null> 
   */
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

  /**
   * 销毁
   */
  destroy() {
    this.searchManager.destroy()
  }
}
