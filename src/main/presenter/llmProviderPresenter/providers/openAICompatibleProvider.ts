import { LLM_PROVIDER, LLMResponse, LLMResponseStream, MODEL_META } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import OpenAI from 'openai'
import { ChatCompletionMessage } from 'openai/resources'

// 定义ChatMessage接口用于统一消息格式
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' // 消息角色：系统、用户或助手
  content: string // 消息内容
}

export class OpenAICompatibleProvider extends BaseLLMProvider {
  protected openai: OpenAI // OpenAI API客户端实例
  private isNoModelsApi: boolean = false // 标记当前提供商是否不支持模型列表API
  // 添加不支持 OpenAI 标准接口的供应商黑名单
  private static readonly NO_MODELS_API_LIST = ['doubao'] // 不支持OpenAI标准模型API的提供商列表

  /**
   * 构造函数
   * @param provider LLM提供商配置信息
   */
  constructor(provider: LLM_PROVIDER) {
    super(provider)
    // 初始化OpenAI客户端，使用提供商的API密钥和基础URL
    this.openai = new OpenAI({
      apiKey: this.provider.apiKey,
      baseURL: this.provider.baseUrl
    })
    // 检查当前提供商是否在不支持模型API的列表中
    if (OpenAICompatibleProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init() // 初始化提供商
  }

  /**
   * 实现BaseLLMProvider中的抽象方法，获取提供商支持的模型列表
   * @param options 可选的超时设置
   * @returns 模型元数据数组的Promise
   */
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // 检查供应商是否在黑名单中
    if (this.isNoModelsApi) {
      console.log(`Provider ${this.provider.name} does not support OpenAI models API`)
      return this.models // 返回已有的模型列表
    }
    return this.fetchOpenAIModels(options) // 获取OpenAI兼容的模型列表
  }

  /**
   * 从OpenAI兼容API获取模型列表
   * @param options 可选的超时设置
   * @returns 模型元数据数组的Promise
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.openai.models.list(options)
    // 将API返回的模型数据转换为应用需要的MODEL_META格式
    return response.data.map((model) => ({
      id: model.id, // 模型ID
      name: model.id, // 模型名称，使用ID作为名称
      group: 'default', // 模型分组
      providerId: this.provider.id, // 提供商ID
      isCustom: false, // 是否自定义模型
      contextLength: 4096, // 上下文长度
      maxTokens: 2048 // 最大输出token数
    }))
  }

  /**
   * 辅助方法：格式化消息，保持消息格式一致
   * @param messages 需要格式化的消息数组
   * @returns 格式化后的消息数组
   */
  protected formatMessages(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ): ChatMessage[] {
    return messages // 当前实现直接返回原始消息，不做额外处理
  }

  /**
   * 使用OpenAI兼容API进行非流式聊天完成
   * @param messages 聊天消息列表
   * @param modelId 模型ID
   * @param temperature 温度参数，控制随机性
   * @param maxTokens 最大生成token数
   * @returns LLM响应的Promise
   */
  protected async openAICompletion(
    messages: ChatMessage[],
    modelId?: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // 检查提供商是否已初始化
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    // 检查是否提供了模型ID
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    // 调用OpenAI API进行聊天完成
    const completion = await this.openai.chat.completions.create({
      messages: messages,
      model: modelId,
      stream: false, // 非流式请求
      temperature: temperature, // 温度参数
      max_tokens: maxTokens // 最大token数
    })
    const message = completion.choices[0].message as ChatCompletionMessage & {
      reasoning_content?: string // 扩展类型，支持reasoning_content字段
    }
    const resultResp: LLMResponse = {
      content: ''
    }

    // 处理带<think>标签的内容（用于分离思考过程和最终回答）
    if (message.content) {
      const content = message.content.trimStart()

      // 先检查是否只包含结束标签</think>而没有开始标签<think>
      if (content.includes('</think>') && !content.includes('<think>')) {
        // 找到最后一个</think>标签的位置
        const lastThinkEndIndex = content.lastIndexOf('</think>')

        // 处理成正常格式：<think>前半部分</think>后半部分
        const beforeLastEnd = content.substring(0, lastThinkEndIndex)
        const afterLastEnd = content.substring(lastThinkEndIndex + 8) // 8是</think>的长度

        // 将整个前半部分内容视为推理内容
        resultResp.reasoning_content = beforeLastEnd.trim()
        resultResp.content = afterLastEnd.trim()
      }
      // 处理标准的<think>...</think>标签
      else if (content.includes('<think>')) {
        const thinkStart = content.indexOf('<think>')
        const thinkEnd = content.indexOf('</think>')

        if (thinkEnd > thinkStart) {
          // 提取推理内容（<think>标签之间的内容）
          resultResp.reasoning_content = content.substring(thinkStart + 7, thinkEnd).trim()

          // 合并<think>标签前后的普通内容作为最终输出
          const beforeThink = content.substring(0, thinkStart).trim()
          const afterThink = content.substring(thinkEnd + 8).trim()
          resultResp.content = [beforeThink, afterThink].filter(Boolean).join('\n')
        } else {
          // 如果没有找到配对的结束标签，将所有内容作为普通内容
          resultResp.content = message.content
        }
      } else {
        // 没有think标签，所有内容作为普通内容
        resultResp.content = message.content
      }
    }

    return resultResp
  }

  /**
   * 使用OpenAI兼容API进行流式聊天完成
   * @param messages 聊天消息列表
   * @param modelId 模型ID
   * @param temperature 温度参数，控制随机性
   * @param maxTokens 最大生成token数
   * @returns 异步生成器，生成LLM响应流
   */
  protected async *openAIStreamCompletion(
    messages: ChatMessage[],
    modelId?: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    // 检查提供商是否已初始化
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    // 检查是否提供了模型ID
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    // 调用OpenAI API进行流式聊天完成
    const stream = await this.openai.chat.completions.create({
      messages: messages,
      model: modelId,
      stream: true, // 流式请求
      temperature: temperature, // 温度参数
      max_tokens: maxTokens // 最大token数
    })

    // 流式处理相关变量初始化
    let hasCheckedFirstChunk = false // 是否已检查第一个数据块
    let hasReasoningContent = false // 是否包含推理内容
    let buffer = '' // 内容缓冲区
    let isInThinkTag = false // 是否在think标签内
    let initialBuffer = '' // 初始缓冲区，用于累积开头内容
    const WINDOW_SIZE = 10 // 滑动窗口大小，用于检测标签

    /**
     * 辅助函数：清理标签并返回清理后的位置
     * @param text 待处理文本
     * @param tag 标签文本
     * @returns 清理后的位置和是否找到标签
     */
    const cleanTag = (text: string, tag: string): { cleanedPosition: number; found: boolean } => {
      const tagIndex = text.indexOf(tag)
      if (tagIndex === -1) return { cleanedPosition: 0, found: false }

      // 查找标签结束位置（跳过可能的空白字符）
      let endPosition = tagIndex + tag.length
      while (endPosition < text.length && /\s/.test(text[endPosition])) {
        endPosition++
      }
      return { cleanedPosition: endPosition, found: true }
    }

    console.log('处理流式响应中的每个数据块')
    // 处理流式响应中的每个数据块
    for await (const chunk of stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delta = chunk.choices[0]?.delta as any

      // 处理原生reasoning_content格式（某些提供商直接提供推理内容）
      if (delta?.reasoning_content) {
        yield {
          reasoning_content: delta.reasoning_content
        }
        continue
      }

      const content = delta?.content || ''
      if (!content) continue // 跳过空内容
      // 第一次检查数据块中是否包含<think>标签
      if (!hasCheckedFirstChunk) {
        initialBuffer += content
        // 如果积累的内容包含了完整的<think>或者已经可以确定不是以<think>开头
        if (
          initialBuffer.includes('<think>') ||
          initialBuffer.includes('</think>')
          // (initialBuffer.length >= 6 && !'<think>'.startsWith(initialBuffer.trimStart()))
        ) {
          hasCheckedFirstChunk = true
          const trimmedContent = initialBuffer.trimStart()
          hasReasoningContent =
            trimmedContent.includes('<think>') || trimmedContent.includes('</think>')
          console.log('hasReasoningContent ', hasReasoningContent)
          // 如果不包含<think>，直接输出累积的内容
          if (!hasReasoningContent) {
            yield {
              content: initialBuffer
            }
            initialBuffer = ''
          } else {
            // 如果包含<think>，将内容转移到主buffer继续处理
            buffer = initialBuffer
            initialBuffer = ''
            // 立即处理buffer中的think标签
            if (buffer.includes('<think>') || buffer.includes('</think>')) {
              isInThinkTag = true
              const thinkStart = buffer.indexOf('<think>')
              if (thinkStart > 0) {
                yield {
                  content: buffer.substring(0, thinkStart)
                }
              }
              const { cleanedPosition } = cleanTag(buffer, '<think>')
              buffer = buffer.substring(cleanedPosition)
            }
          }
          continue
        } else {
          // 继续累积内容，等待更多数据
          continue
        }
      }

      // 如果不包含推理内容，直接返回普通内容
      if (!hasReasoningContent) {
        yield {
          content: content
        }
        continue
      }

      // 处理包含推理内容的情况（带<think>标签）
      console.log('处理包含推理内容的情况（带<think>活着</think>标签）', isInThinkTag)
      if (!isInThinkTag && buffer.includes('<think>')) {
        // 发现<think>标签，进入标签内处理模式
        console.log('发现<think>标签，进入标签内处理模式')
        isInThinkTag = true
        const thinkStart = buffer.indexOf('<think>')
        if (thinkStart > 0) {
          // 输出标签前的普通内容
          yield {
            content: buffer.substring(0, thinkStart)
          }
        }
        // 清理标签并更新buffer
        const { cleanedPosition } = cleanTag(buffer, '<think>')
        buffer = buffer.substring(cleanedPosition)
      } else if (isInThinkTag) {
        // 在<think>标签内处理内容
        buffer += content
        const { found: hasEndTag, cleanedPosition } = cleanTag(buffer, '</think>')
        if (hasEndTag) {
          // 找到结束标签，处理推理内容
          const thinkEnd = buffer.indexOf('</think>')
          if (thinkEnd > 0) {
            yield {
              reasoning_content: buffer.substring(0, thinkEnd)
            }
          }
          // 提取结束标签后的内容
          buffer = buffer.substring(cleanedPosition)
          isInThinkTag = false
          hasReasoningContent = false

          // 输出剩余的普通内容
          if (buffer) {
            yield {
              content: buffer
            }
            buffer = ''
          }
        } else {
          // 保持滑动窗口大小的buffer，用于检测结束标签
          if (buffer.length > WINDOW_SIZE) {
            const contentToYield = buffer.slice(0, -WINDOW_SIZE)
            yield {
              reasoning_content: contentToYield
            }
            buffer = buffer.slice(-WINDOW_SIZE)
          }
        }
      } else {
        // 不在任何标签中，处理普通内容
        buffer += content
        yield {
          content: buffer
        }
        buffer = ''
      }
    }

    // 处理剩余的缓冲区内容
    if (initialBuffer) {
      yield {
        content: initialBuffer
      }
    }
    if (buffer) {
      console.log('buffer ', buffer)
      // 检查是否只包含结束标签</think>而没有开始标签<think>
      if (!isInThinkTag && buffer.includes('</think>')) {
        const lastThinkEndIndex = buffer.lastIndexOf('</think>')

        // 处理成正常格式：前半部分作为推理内容，后半部分作为普通内容
        const beforeLastEnd = buffer.substring(0, lastThinkEndIndex)
        const afterLastEnd = buffer.substring(lastThinkEndIndex + 8) // 8是</think>的长度

        if (beforeLastEnd.trim()) {
          yield {
            reasoning_content: beforeLastEnd.trim()
          }
        }

        if (afterLastEnd.trim()) {
          yield {
            content: afterLastEnd.trim()
          }
        }
      } else if (isInThinkTag) {
        // 如果还在think标签内，作为推理内容输出
        yield {
          reasoning_content: buffer
        }
      } else {
        // 否则作为普通内容输出
        yield {
          content: buffer
        }
      }
    }
  }

  /**
   * 检查提供商API连接是否正常
   * @returns 包含检查结果和错误信息的Promise
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // 如果支持模型API，尝试获取模型列表
      if (!this.isNoModelsApi) {
        const models = await this.fetchOpenAIModels({
          timeout: 3000 // 设置3秒超时
        })
        this.models = models
        // 避免在这里触发事件，而是通过ConfigPresenter来管理模型更新
      }
      return {
        isOk: true,
        errorMsg: null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // 捕获并返回API错误
      return {
        isOk: false,
        errorMsg: error?.message
      }
    }
  }

  /**
   * 根据聊天内容生成会话标题
   * @param messages 聊天消息列表
   * @param modelId 模型ID
   * @returns 生成的标题Promise
   */
  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    // 构建系统提示，要求模型生成简短标题
    const systemPrompt = `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols`
    const fullMessage: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      { role: 'user', content: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }
    ]
    // 调用API生成标题
    const response = await this.openAICompletion(fullMessage, modelId, 0.5)
    return response.content
  }

  /**
   * 非流式聊天完成方法
   * @param messages 聊天消息列表
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应的Promise
   */
  async completions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  /**
   * 生成内容摘要
   * @param text 需要摘要的文本
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应的Promise
   */
  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  /**
   * 根据提示生成文本
   * @param prompt 提示文本
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应的Promise
   */
  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  /**
   * 生成回复建议
   * @param context 上下文
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns 建议数组的Promise
   */
  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const response = await this.openAICompletion(
      [
        {
          role: 'user',
          content: `基于以下上下文，给出3个可能的回复建议，每个建议一行：\n${context}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
    // 将回复按行分割并过滤空行
    return response.content.split('\n').filter((line) => line.trim().length > 0)
  }

  /**
   * 流式聊天完成方法
   * @param messages 聊天消息列表
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应流的异步生成器
   */
  async *streamCompletions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(messages, modelId, temperature, maxTokens)
  }

  /**
   * 流式生成摘要
   * @param text 需要摘要的文本
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应流的异步生成器
   */
  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  /**
   * 流式生成文本
   * @param prompt 提示文本
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @returns LLM响应流的异步生成器
   */
  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }
}
