import { nanoid } from 'nanoid'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import {
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  IConfigPresenter
} from '@shared/presenter'
import { ServerManager } from './serverManager'
import { McpClient, Tool } from './mcpClient'

/**
 * 工具管理器类
 * 负责管理MCP工具的调用、权限检查和工具定义获取
 */
export class ToolManager {
  /** 配置管理器实例 */
  private configPresenter: IConfigPresenter
  /** 服务器管理器实例 */
  private serverManager: ServerManager

  /**
   * 构造函数
   * @param configPresenter 配置管理器实例
   * @param serverManager 服务器管理器实例
   */
  constructor(configPresenter: IConfigPresenter, serverManager: ServerManager) {
    this.configPresenter = configPresenter
    this.serverManager = serverManager
  }

  /**
   * 获取所有正在运行的MCP客户端
   * @returns 返回正在运行的MCP客户端数组
   */
  public async getRunningClients(): Promise<McpClient[]> {
    return this.serverManager.getRunningClients()
  }

  /**
   * 获取所有工具定义
   * 从所有运行中的MCP客户端获取工具列表，并转换为标准格式
   * @returns 返回工具定义数组
   */
  public async getAllToolDefinitions(): Promise<MCPToolDefinition[]> {
    // 获取运行中的客户端
    const clients = await this.serverManager.getRunningClients()

    if (!clients) {
      console.error('未找到正在运行的MCP客户端')
      return []
    }

    try {
      // 获取所有客户端的工具列表
      const tools: Tool[] = []
      for (const client of clients) {
        const clientTools = await client.listTools()
        if (clientTools) {
          tools.push(...clientTools)
        }
      }
      if (!tools) {
        return []
      }

      // 将工具转换为MCPToolDefinition标准格式
      const results: MCPToolDefinition[] = []
      for (const tool of tools) {
        const properties = tool.inputSchema.properties || {}
        const toolProperties = { ...properties }
        // 确保每个属性都有描述
        for (const key in toolProperties) {
          if (!toolProperties[key].description) {
            toolProperties[key].description = 'Params of ' + key
          }
        }
        // 构建标准格式的工具定义
        results.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: toolProperties,
              required: Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : []
            }
          }
        })
      }
      return results
    } catch (error) {
      console.error('获取工具定义失败:', error)
      return []
    }
  }

  /**
   * 检查工具调用权限
   * 根据工具名称和自动授权列表判断是否有权限执行
   * @param toolName 工具名称
   * @param autoApprove 自动授权的操作列表
   * @returns 是否有权限执行
   */
  private checkToolPermission(toolName: string, autoApprove: string[]): boolean {
    // 如果有 'all' 权限，则允许所有操作
    if (autoApprove.includes('all')) {
      return true
    }

    // 根据操作类型检查特定权限
    switch (toolName) {
      case 'get_file_content':
      case 'list_directory':
      case 'read_file':
        // 读取操作需要 'read' 权限
        return autoApprove.includes('read')
      case 'write_file':
        // 写入操作需要 'write' 权限
        return autoApprove.includes('write')
      default:
        // 未知操作默认不授权
        return false
    }
  }

  /**
   * 调用工具
   * 处理工具调用请求，包括权限检查、参数解析和结果返回
   * @param toolCall 工具调用请求
   * @returns 工具调用响应
   */
  async callTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    console.log('callTool', toolCall)
    try {
      // 获取默认服务器名称和配置
      const defaultServerName = await this.serverManager.getDefaultServerName()
      if (!defaultServerName) {
        throw new Error('No default MCP server configured')
      }

      // 获取服务器配置
      const servers = await this.configPresenter.getMcpServers()
      const serverConfig = servers[defaultServerName]
      const autoApprove = serverConfig.autoApprove || []

      // 解析工具调用参数
      const { name, arguments: argsString } = toolCall.function
      let args = {}
      try {
        args = JSON.parse(argsString)
      } catch (error) {
        console.warn('Error parsing tool call arguments:', error)
      }

      // 检查权限
      const hasPermission = this.checkToolPermission(name, autoApprove)

      // 如果没有权限，则拒绝操作
      if (!hasPermission) {
        return {
          toolCallId: toolCall.id,
          content: `Error: Operation not permitted. The '${name}' operation requires appropriate permissions.`
        }
      }

      // 获取正在运行的客户端
      const clients = await this.serverManager.getRunningClients()

      if (!clients) {
        return {
          toolCallId: toolCall.id,
          content: `Error: MCP服务未运行，请先启动服务`
        }
      }
      
      // 查找能处理该工具的客户端
      let client: McpClient | null = null
      for (const c of clients) {
        const clientTools = await c.listTools()
        if (clientTools) {
          for (const tool of clientTools) {
            if (tool.name === name) {
              client = c
              break
            }
          }
        }
      }
      
      // 如果没有找到能处理该工具的客户端，返回错误
      if (!client) {
        return {
          toolCallId: toolCall.id,
          content: `Error: 未找到工具 ${name}`
        }
      }
      
      // 调用 MCP 工具
      const result = await client.callTool(name, args)

      // 构建工具调用响应
      const response: MCPToolResponse = {
        toolCallId: toolCall.id,
        content: result
      }

      // 触发工具调用结果事件，通知其他组件
      eventBus.emit(MCP_EVENTS.TOOL_CALL_RESULT, response)

      return response
    } catch (error: unknown) {
      // 错误处理
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Tool call error:', error)
      return {
        toolCallId: toolCall.id,
        content: `Error: ${errorMessage}`
      }
    }
  }

  /**
   * 创建工具调用对象
   * 生成一个新的工具调用请求
   * @param toolName 工具名称
   * @param args 工具参数
   * @returns 工具调用请求对象
   */
  createToolCall(toolName: string, args: Record<string, string>): MCPToolCall {
    return {
      id: nanoid(), // 生成唯一ID
      type: 'function',
      function: {
        name: `${toolName}`,
        arguments: JSON.stringify(args) // 将参数序列化为JSON字符串
      }
    }
  }
}
