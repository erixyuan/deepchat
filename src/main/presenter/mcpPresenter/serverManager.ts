import { IConfigPresenter } from '@shared/presenter'
import { McpClient } from './mcpClient'
import axios from 'axios'
import { proxyConfig } from '@/presenter/proxyConfig'

const NPM_REGISTRY_LIST = [
  'https://registry.npmjs.org/',
  'https://r.cnpmjs.org/',
  'https://registry.npmmirror.com/'
]

export class ServerManager {
  private clients: Map<string, McpClient> = new Map()
  private configPresenter: IConfigPresenter
  private npmRegistry: string | null = null

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
  }

  // 测试npm registry速度并返回最佳选择
  async testNpmRegistrySpeed(): Promise<string> {
    const timeout = 5000
    const testPackage = 'tiny-runtime-injector'

    // 获取代理配置
    const proxyUrl = proxyConfig.getProxyUrl()
    const proxyOptions = proxyUrl
      ? { proxy: { host: new URL(proxyUrl).hostname, port: parseInt(new URL(proxyUrl).port) } }
      : {}

    const results = await Promise.all(
      NPM_REGISTRY_LIST.map(async (registry) => {
        const start = Date.now()
        let success = false
        let isTimeout = false
        let time = 0

        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeout)

          const response = await axios.get(`${registry}${testPackage}`, {
            ...proxyOptions,
            signal: controller.signal
          })

          clearTimeout(timeoutId)
          success = response.status >= 200 && response.status < 300
          time = Date.now() - start
        } catch (error) {
          time = Date.now() - start
          isTimeout = (error instanceof Error && error.name === 'AbortError') || time >= timeout
        }

        return {
          registry,
          success,
          time,
          isTimeout
        }
      })
    )

    // 过滤出成功的请求，并按响应时间排序
    const successfulResults = results
      .filter((result) => result.success)
      .sort((a, b) => a.time - b.time)
    console.log('npm registry check results', successfulResults)

    // 如果所有请求都失败，返回默认的registry
    if (successfulResults.length === 0) {
      console.log('所有npm registry测试失败，使用默认registry')
      return NPM_REGISTRY_LIST[0]
    }

    // 返回响应最快的registry
    this.npmRegistry = successfulResults[0].registry
    return this.npmRegistry
  }

  // 获取npm registry
  getNpmRegistry(): string | null {
    return this.npmRegistry
  }

  // 获取默认服务器名称
  async getDefaultServerName(): Promise<string | null> {
    const defaultServer = await this.configPresenter.getMcpDefaultServer()
    const servers = await this.configPresenter.getMcpServers()

    if (!defaultServer || !servers[defaultServer]) {
      return null
    }

    return defaultServer
  }

  // 获取默认客户端（不自动启动服务）
  async getDefaultClient(): Promise<McpClient | null> {
    const defaultServerName = await this.getDefaultServerName()

    if (!defaultServerName) {
      return null
    }

    // 返回已存在的客户端实例，无论是否运行
    return this.getClient(defaultServerName) || null
  }

  // 获取正在运行的客户端
  async getRunningClients(): Promise<McpClient[]> {
    const clients: McpClient[] = []
    for (const [name, client] of this.clients.entries()) {
      if (this.isServerRunning(name)) {
        clients.push(client)
      }
    }
    return clients
  }

  async startServer(name: string): Promise<void> {
    // 如果服务器已经在运行，则不需要再次启动
    if (this.clients.has(name) && this.isServerRunning(name)) {
      console.info(`MCP服务器 ${name} 已经在运行中`)
      return
    }

    const servers = await this.configPresenter.getMcpServers()
    const serverConfig = servers[name]

    if (!serverConfig) {
      throw new Error(`MCP server ${name} not found`)
    }

    try {
      console.info(`正在启动MCP服务器 ${name}...`)

      // 创建并保存客户端实例，传入npm registry
      const client = new McpClient(
        name,
        serverConfig as unknown as Record<string, unknown>,
        this.npmRegistry
      )
      this.clients.set(name, client)

      // 连接到服务器，这将启动服务
      await client.connect()

      console.info(`MCP服务器 ${name} 启动成功`)
    } catch (error) {
      console.error(`启动MCP服务器 ${name} 失败:`, error)

      // 移除客户端引用
      this.clients.delete(name)

      throw error
    }
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name)

    if (!client) {
      return
    }

    try {
      // 断开连接，这将停止服务
      await client.disconnect()

      // 从客户端列表中移除
      this.clients.delete(name)

      console.info(`MCP服务器 ${name} 已停止`)
    } catch (error) {
      console.error(`停止MCP服务器 ${name} 失败:`, error)
      throw error
    }
  }

  isServerRunning(name: string): boolean {
    const client = this.clients.get(name)
    if (!client) {
      return false
    }
    return client.isServerRunning()
  }

  /**
   * 获取客户端实例
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name)
  }
}
