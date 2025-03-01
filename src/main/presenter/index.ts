/**
 * Presenter主模块
 * 作为主进程中各功能模块的集中管理器，协调不同模块间的交互
 * 并通过IPC机制暴露功能给渲染进程调用
 */

import { ipcMain, IpcMainInvokeEvent, app } from 'electron'
// import { LlamaCppPresenter } from './llamaCppPresenter'
import { WindowPresenter } from './windowPresenter'
import { SQLitePresenter } from './sqlitePresenter'
import { ShortcutPresenter } from './shortcutPresenter'
import { IPresenter, MODEL_META } from '@shared/presenter'
// 导入事件总线，用于主进程内部模块间通信
import { eventBus } from '@/eventbus'
import path from 'path'
import { LLMProviderPresenter } from './llmProviderPresenter'
import { ConfigPresenter } from './configPresenter'
import { ThreadPresenter } from './threadPresenter'
import { DevicePresenter } from './devicePresenter'
import { UpgradePresenter } from './upgradePresenter'
import { ContextMenuPresenter } from './contextMenuPresenter'

/**
 * Presenter类 - 实现IPresenter接口
 * 作为主进程中各功能模块的统一入口和管理中心
 */
export class Presenter implements IPresenter {
  // 窗口管理模块
  windowPresenter: WindowPresenter
  // SQLite数据库操作模块
  sqlitePresenter: SQLitePresenter
  // LLM提供者管理模块
  llmproviderPresenter: LLMProviderPresenter
  // 配置管理模块
  configPresenter: ConfigPresenter
  // 对话线程管理模块
  threadPresenter: ThreadPresenter
  // 设备信息模块
  devicePresenter: DevicePresenter
  // 应用升级模块
  upgradePresenter: UpgradePresenter
  // 快捷键管理模块
  shortcutPresenter: ShortcutPresenter
  // 上下文菜单模块
  contextMenuPresenter: ContextMenuPresenter
  // llamaCpp模型管理模块(已注释)
  // llamaCppPresenter: LlamaCppPresenter

  /**
   * 构造函数 - 初始化所有功能模块
   */
  constructor() {
    // 初始化配置模块(需要最先初始化，因为其他模块依赖它)
    this.configPresenter = new ConfigPresenter()
    // 初始化窗口管理模块，并传入配置模块
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    // 初始化LLM提供者模块
    this.llmproviderPresenter = new LLMProviderPresenter()
    // 初始化设备信息模块
    this.devicePresenter = new DevicePresenter()
    // 初始化SQLite数据库模块，设置数据库存储路径
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    const dbPath = path.join(dbDir, 'chat.db')
    this.sqlitePresenter = new SQLitePresenter(dbPath)
    // 初始化对话线程模块，依赖SQLite和LLM提供者模块
    this.threadPresenter = new ThreadPresenter(this.sqlitePresenter, this.llmproviderPresenter)
    // 初始化升级模块
    this.upgradePresenter = new UpgradePresenter()
    // 初始化快捷键模块
    this.shortcutPresenter = new ShortcutPresenter(this.windowPresenter, this.configPresenter)
    // 初始化上下文菜单模块
    this.contextMenuPresenter = new ContextMenuPresenter()
    // 初始化LlamaCpp模块(已注释)
    // this.llamaCppPresenter = new LlamaCppPresenter()

    // 设置事件总线监听器
    this.setupEventBus()
  }

  /**
   * 设置事件总线，监听和处理各类事件
   * 主要用于主进程内部通信和向渲染进程推送消息
   */
  setupEventBus() {
    // 监听主窗口准备就绪事件，触发初始化
    eventBus.on('main-window-ready-to-show', () => {
      this.init()
    })

    // 监听提供者设置变更事件
    eventBus.on('provider-setting-changed', () => {
      // 获取最新提供者配置并更新
      const providers = this.configPresenter.getProviders()
      this.llmproviderPresenter.setProviders(providers)
      // 通知渲染进程提供者设置已变更
      this.windowPresenter.mainWindow?.webContents.send('provider-setting-changed')
    })

    // 监听流式响应事件，转发到渲染进程
    eventBus.on('stream-response', (msg) => {
      // console.log('stream-response', msg.eventId, msg)
      this.windowPresenter.mainWindow?.webContents.send('stream-response', msg)
    })

    // 监听流式响应结束事件，转发到渲染进程
    eventBus.on('stream-end', (msg) => {
      console.log('stream-end', msg.eventId)
      this.windowPresenter.mainWindow?.webContents.send('stream-end', msg)
    })

    // 监听流式响应错误事件，转发到渲染进程
    eventBus.on('stream-error', (msg) => {
      this.windowPresenter.mainWindow?.webContents.send('stream-error', msg)
    })

    // 监听会话激活事件，转发到渲染进程
    eventBus.on('conversation-activated', (msg) => {
      this.windowPresenter.mainWindow?.webContents.send('conversation-activated', msg)
    })

    // 监听活动会话清除事件，转发到渲染进程
    eventBus.on('active-conversation-cleared', (msg) => {
      this.windowPresenter.mainWindow?.webContents.send('active-conversation-cleared', msg)
    })

    // 监听提供者模型更新事件
    eventBus.on('provider-models-updated', (msg: { providerId: string; models: MODEL_META[] }) => {
      // 当模型列表更新时，分离并保存自定义模型
      const customModels = msg.models.filter((model) => model.isCustom)
      this.configPresenter.setCustomModels(msg.providerId, customModels)
      // 保存非自定义模型
      const providerModels = msg.models.filter((model) => !model.isCustom)
      this.configPresenter.setProviderModels(msg.providerId, providerModels)
      // 转发事件到渲染进程
      this.windowPresenter.mainWindow?.webContents.send('provider-models-updated')
    })

    // 监听更新状态变更事件，转发到渲染进程
    eventBus.on('update-status-changed', (msg) => {
      console.log('update-status-changed', msg)
      this.windowPresenter.mainWindow?.webContents.send('update-status-changed', msg)
    })

    // 监听消息编辑事件，转发到渲染进程
    eventBus.on('message-edited', (msgId: string) => {
      this.windowPresenter.mainWindow?.webContents.send('message-edited', msgId)
    })
  }

  /**
   * 初始化方法，在主窗口就绪后调用
   */
  init() {
    if (this.windowPresenter.mainWindow) {
      // 设置主窗口到LlamaCpp模块(已注释)
      // this.llamaCppPresenter.setMainwindow(this.windowPresenter.mainWindow)
    }
    // 从配置中获取并设置LLM提供者数据
    const providers = this.configPresenter.getProviders()
    this.llmproviderPresenter.setProviders(providers)

    // 同步所有提供者的自定义模型
    this.syncCustomModels()
  }

  /**
   * 同步所有提供者的自定义模型
   * 从配置中读取自定义模型并添加到对应的提供者
   */
  private async syncCustomModels() {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      if (provider.enable) {
        // 获取该提供者的自定义模型
        const customModels = this.configPresenter.getCustomModels(provider.id)
        // 为每个自定义模型调用添加方法
        for (const model of customModels) {
          await this.llmproviderPresenter.addCustomModel(provider.id, {
            id: model.id,
            name: model.name,
            enabled: model.enabled,
            contextLength: model.contextLength,
            maxTokens: model.maxTokens
          })
        }
      }
    }
  }

  /**
   * 资源释放方法，在应用退出时调用
   * 关闭数据库连接和其他需要清理的资源
   */
  destroy() {
    this.sqlitePresenter.close()
    this.shortcutPresenter.destroy()
    this.contextMenuPresenter.dispose()
  }
}

// 创建Presenter单例
export const presenter = new Presenter()

/**
 * 注册IPC调用处理器
 * 使渲染进程能够通过IPC调用主进程中presenter的方法
 */
ipcMain.handle(
  'presenter:call',
  (_event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
    try {
      // 获取对应的presenter模块
      const calledPresenter = presenter[name]
      if (!calledPresenter) {
        console.warn('calling wrong presenter', name)
        return
      }
      // 检查要调用的方法是否存在
      if (!calledPresenter[method]) {
        console.warn('calling wrong presenter method', name, method)
        return
      }
      // 调用指定模块的指定方法并返回结果
      return calledPresenter[method](...payloads)
    } catch (e) {
      console.warn('error on presenter handle', e)
      return null
    }
  }
)
