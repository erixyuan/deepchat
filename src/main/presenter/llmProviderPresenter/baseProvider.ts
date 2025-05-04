import {
  LLM_PROVIDER,
  MODEL_META,
  LLMResponse,
  MCPToolDefinition,
  LLMCoreStreamEvent,
  ModelConfig,
  ChatMessage
} from '@shared/presenter'
import { ConfigPresenter } from '../configPresenter'
import { DevicePresenter } from '../devicePresenter'
import { jsonrepair } from 'jsonrepair'

/**
 * 基础LLM提供商抽象类
 *
 * 该类定义了所有LLM提供商必须实现的接口和共享功能，包括：
 * - 模型管理（获取、添加、删除、更新模型）
 * - 统一的消息格式
 * - 工具调用处理
 * - 对话生成和流式处理
 *
 * 所有特定的LLM提供商（如OpenAI、Anthropic、Gemini、Ollama等）都必须继承此类
 * 并实现其抽象方法。
 */
export abstract class BaseLLMProvider {
  // 最大工具调用次数限制
  protected static readonly MAX_TOOL_CALLS = 20

  protected provider: LLM_PROVIDER
  protected models: MODEL_META[] = []
  protected customModels: MODEL_META[] = []
  protected isInitialized: boolean = false
  protected configPresenter: ConfigPresenter

  protected defaultHeaders: Record<string, string> = {
    'HTTP-Referer': 'https://deepchatai.cn',
    'X-Title': 'DeepChat'
  }

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    this.provider = provider
    this.configPresenter = configPresenter
    this.defaultHeaders = DevicePresenter.getDefaultHeaders()
  }

  /**
   * 获取最大工具调用次数
   * @returns 配置的最大工具调用次数
   */
  public static getMaxToolCalls(): number {
    return BaseLLMProvider.MAX_TOOL_CALLS
  }

  /**
   * 初始化提供商
   * 包括获取模型列表、配置代理等
   */
  protected async init() {
    if (this.provider.enable) {
      try {
        await this.fetchModels()
        // 检查是否需要自动启用所有模型
        await this.autoEnableModelsIfNeeded()
        this.isInitialized = true
        console.info('Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('Provider initialization failed:', this.provider.name, error)
      }
    }
  }

  /**
   * 检查并自动启用模型
   * 如果没有任何已启用的模型，则自动启用所有模型
   */
  protected async autoEnableModelsIfNeeded() {
    if (!this.models || this.models.length === 0) return
    const providerId = this.provider.id

    // 检查是否有自定义模型
    const customModels = this.configPresenter.getCustomModels(providerId)
    if (customModels && customModels.length > 0) return

    // 检查是否有任何模型的状态被手动修改过
    const hasManuallyModifiedModels = this.models.some((model) =>
      this.configPresenter.getModelStatus(providerId, model.id)
    )
    if (hasManuallyModifiedModels) return

    // 检查是否有任何已启用的模型
    const hasEnabledModels = this.models.some((model) =>
      this.configPresenter.getModelStatus(providerId, model.id)
    )

    // 如果没有任何已启用的模型，则自动启用所有模型
    // 这部分后续应该改为启用推荐模型
    if (!hasEnabledModels) {
      console.info(`Auto enabling all models for provider: ${this.provider.name}`)
      this.models.forEach((model) => {
        this.configPresenter.enableModel(providerId, model.id)
      })
    }
  }

  /**
   * 获取提供商的模型列表
   * @returns 模型列表
   */
  public async fetchModels(): Promise<MODEL_META[]> {
    try {
      const models = await this.fetchProviderModels()
      console.log('Fetched models:', models?.length)
      this.models = models
      this.configPresenter.setProviderModels(this.provider.id, models)
      return models
    } catch (e) {
      console.error('Failed to fetch models:', e)
      if (!this.models) {
        this.models = []
      }
      return []
    }
  }

  /**
   * 获取特定提供商的模型
   * 此方法由具体的提供商子类实现
   * @returns 提供商支持的模型列表
   */
  protected abstract fetchProviderModels(): Promise<MODEL_META[]>

  /**
   * 获取所有模型（包括自定义模型）
   * @returns 模型列表
   */
  public getModels(): MODEL_META[] {
    return [...this.models, ...this.customModels]
  }

  /**
   * 添加自定义模型
   * @param model 模型基本信息
   * @returns 添加后的完整模型信息
   */
  public addCustomModel(model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>): MODEL_META {
    const newModel: MODEL_META = {
      ...model,
      providerId: this.provider.id,
      isCustom: true,
      group: 'default'
    }

    // 检查是否已存在相同ID的自定义模型
    const existingIndex = this.customModels.findIndex((m) => m.id === newModel.id)
    if (existingIndex !== -1) {
      this.customModels[existingIndex] = newModel
    } else {
      this.customModels.push(newModel)
    }

    return newModel
  }

  /**
   * 删除自定义模型
   * @param modelId 要删除的模型ID
   * @returns 是否删除成功
   */
  public removeCustomModel(modelId: string): boolean {
    const index = this.customModels.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      this.customModels.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 更新自定义模型
   * @param modelId 要更新的模型ID
   * @param updates 要更新的字段
   * @returns 是否更新成功
   */
  public updateCustomModel(modelId: string, updates: Partial<MODEL_META>): boolean {
    const model = this.customModels.find((m) => m.id === modelId)
    if (model) {
      // 应用更新
      Object.assign(model, updates)
      return true
    }
    return false
  }

  /**
   * 获取所有自定义模型
   * @returns 自定义模型列表
   */
  public getCustomModels(): MODEL_META[] {
    return this.customModels
  }

  /**
   * 获取工具调用的提示词
   * 用于不支持原生工具调用的模型
   * @param tools 工具定义列表
   * @returns 格式化的提示词
   */
  protected getFunctionCallWrapPrompt(tools: MCPToolDefinition[]): string {
    return `你具备调用外部工具的能力来协助解决用户的问题,可用的工具列表定义在 <tool_list> 标签中，格式为 JSON 数组：
<tool_list>
${JSON.stringify(tools)}
</tool_list>\n
当你判断调用工具是**解决用户问题的唯一或最佳方式**时，**必须**严格遵循以下格式进行回复。你的回复中**仅**包含 <function_call> 标签及其内容，不要包含任何其他文字、解释或评论。

如果需要连续调用多个工具，请为每个工具生成一个独立的 <function_call> 标签，按顺序排列。

工具调用的格式如下：
<function_call>
{
  "function_call": {
    "name": "工具名称",
    "arguments": { // 参数对象，必须是有效的 JSON 格式
      "参数1": "值1",
      "参数2": "值2"
      // ... 其他参数
    }
  }
}
</function_call>

**重要约束:**
1.  **必要性**: 仅在无法直接回答用户问题，且工具能提供必要信息或执行必要操作时才使用工具。
2.  **准确性**: \`name\` 字段必须**精确匹配** <tool_list> 中提供的某个工具的名称。\`arguments\` 字段必须是一个有效的 JSON 对象，包含该工具所需的**所有**参数及其基于用户请求的**准确**值。
3.  **格式**: 如果决定调用工具，你的回复**必须且只能**包含一个或多个 <function_call> 标签，不允许任何前缀、后缀或解释性文本。而在函数调用之外的内容中不要包含任何 <function_call> 标签，以防异常。
4.  **直接回答**: 如果你可以直接、完整地回答用户的问题，请**不要**使用工具，直接生成回答内容。
5.  **避免猜测**: 如果不确定信息，且有合适的工具可以获取该信息，请使用工具而不是猜测。

例如，假设你需要调用名为 "getWeather" 的工具，并提供 "location" 和 "date" 参数，你应该这样回复（注意，回复中只有标签）：
<function_call>
{
  "function_call": {
    "name": "getWeather",
    "arguments": { "location": "北京", "date": "2025-03-20" }
  }
}
</function_call>
`
  }

  /**
   * 解析函数调用标签
   * 从响应文本中提取function_call标签并解析为工具调用
   * @param response 包含工具调用标签的响应文本
   * @returns 解析后的工具调用列表
   */
  protected parseFunctionCalls(
    response: string
  ): { id: string; type: string; function: { name: string; arguments: string } }[] {
    try {
      // 使用正则表达式匹配所有的function_call标签对
      const functionCallMatches = response.match(/<function_call>(.*?)<\/function_call>/gs)

      // 如果没有匹配到任何函数调用，返回空数组
      if (!functionCallMatches) {
        return []
      }

      // 解析每个匹配到的函数调用并组成数组
      const toolCalls = functionCallMatches
        .map((match) => {
          const content = match.replace(/<function_call>|<\/function_call>/g, '').trim()
          try {
            // 尝试解析多种可能的格式
            let parsedCall
            try {
              // 首先尝试直接解析JSON
              parsedCall = JSON.parse(content)
            } catch (initialParseError) {
              try {
                // 如果直接解析失败，尝试使用jsonrepair修复
                parsedCall = JSON.parse(jsonrepair(content))
              } catch (repairError) {
                // 记录错误日志但不中断处理
                console.error('Failed to parse with jsonrepair:', repairError)
                return null
              }
            }

            // 支持不同格式：
            // 1. { "function_call": { "name": "...", "arguments": {...} } }
            // 2. { "name": "...", "arguments": {...} }
            // 3. { "function": { "name": "...", "arguments": {...} } }
            // 4. { "function_call": { "name": "...", "arguments": "..." } }
            let functionName, functionArgs

            if (parsedCall.function_call) {
              // 格式1,4
              functionName = parsedCall.function_call.name
              functionArgs = parsedCall.function_call.arguments
            } else if (parsedCall.name && parsedCall.arguments !== undefined) {
              // 格式2
              functionName = parsedCall.name
              functionArgs = parsedCall.arguments
            } else if (parsedCall.function && parsedCall.function.name) {
              // 格式3
              functionName = parsedCall.function.name
              functionArgs = parsedCall.function.arguments
            } else {
              // 当没有明确匹配时，尝试从对象中推断
              const keys = Object.keys(parsedCall)
              // 如果对象只有一个键，可能是嵌套的自定义格式
              if (keys.length === 1) {
                const firstKey = keys[0]
                const innerObject = parsedCall[firstKey]

                if (innerObject && typeof innerObject === 'object') {
                  // 可能是一个嵌套对象，查找name和arguments字段
                  if (innerObject.name && innerObject.arguments !== undefined) {
                    functionName = innerObject.name
                    functionArgs = innerObject.arguments
                  }
                }
              }

              // 如果仍未找到格式，记录错误
              if (!functionName || functionArgs === undefined) {
                console.error('Unknown function call format:', parsedCall)
                return null
              }
            }

            // 确保arguments是字符串形式的JSON
            if (typeof functionArgs !== 'string') {
              functionArgs = JSON.stringify(functionArgs)
            }

            return {
              id: functionName,
              type: 'function',
              function: {
                name: functionName,
                arguments: functionArgs
              }
            }
          } catch (parseError) {
            console.error('Error parsing function call JSON:', parseError, match, content)
            return null
          }
        })
        .filter((call) => call !== null)

      return toolCalls
    } catch (error) {
      console.error('Error parsing function calls:', error)
      return []
    }
  }

  /**
   * 代理更新回调
   * 当代理配置变更时调用此方法更新提供商的代理设置
   */
  public abstract onProxyResolved(): void

  /**
   * 验证提供商API是否可用
   * @returns 验证结果和错误信息
   */
  public abstract check(): Promise<{ isOk: boolean; errorMsg: string | null }>

  /**
   * 生成对话标题
   *
   * @param messages 对话历史消息
   * @param modelId 模型ID
   * @returns 对话标题
   */
  public abstract summaryTitles(messages: ChatMessage[], modelId: string): Promise<string>

  /**
   * 同步获取完整的LLM响应
   *
   * 该方法发送单一请求获取完整的响应内容，适用于后台处理或需要完整结果的场景。
   * 特点：
   * 1. 一次性返回完整的响应结果
   * 2. 包含完整的token使用统计
   * 3. 解析并处理<think>标签，提取reasoning_content
   * 4. 不进行工具调用（工具调用仅在stream版本中处理）
   *
   * @param messages 对话历史消息
   * @param modelId 模型ID
   * @param temperature 温度参数（影响创造性，值越高创造性越强）
   * @param maxTokens 最大生成token数
   * @returns 包含content, reasoning_content和totalUsage的响应对象
   */
  abstract completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse>

  /**
   * 总结文本内容
   *
   * @param text 需要总结的文本
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大生成token数
   * @returns 总结后的响应
   */
  abstract summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse>

  /**
   * 根据提示生成文本
   *
   * @param prompt 文本提示
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大生成token数
   * @returns 生成的文本响应
   */
  abstract generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse>

  /**
   * [新] 核心流式处理方法
   * 此方法由具体的提供商子类实现，负责单次API调用和事件标准化。
   * @param messages 对话消息
   * @param modelId 模型ID
   * @param temperature 温度参数
   * @param maxTokens 最大Token数
   * @param tools 可选的 MCP 工具定义
   * @returns 标准化流事件的异步生成器 (LLMCoreStreamEvent)
   */
  abstract coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent>
}
