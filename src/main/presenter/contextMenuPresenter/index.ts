/**
 * 上下文菜单管理器
 * 负责创建和管理应用程序中的右键菜单
 */
import { IContextMenuPresenter } from '@shared/presenter'
import { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { WebContents } from 'electron/main'
import contextMenu from 'electron-context-menu'
import { eventBus } from '@/eventbus'

/**
 * 上下文菜单管理器类
 * 实现了IContextMenuPresenter接口，提供右键菜单的注册、移除和管理功能
 */
export class ContextMenuPresenter implements IContextMenuPresenter {
  /**
   * 存储所有已注册菜单的清理函数
   * 键为选择器，值为清理函数
   */
  private disposeFunctions: Map<string, () => void> = new Map()

  /**
   * 构造函数
   * 初始化时注册默认的上下文菜单
   */
  constructor() {
    // 注册默认的上下文菜单
    this.registerDefaultContextMenu()
  }

  /**
   * 注册默认上下文菜单
   * 为整个应用程序提供基础的复制粘贴功能
   */
  private registerDefaultContextMenu(): void {
    // 默认菜单配置，全局生效，只保留复制粘贴
    const dispose = contextMenu({
      // 完全禁用所有默认菜单项
      labels: {
        copy: '复制',
        paste: '粘贴',
        cut: '',
        save: '',
        saveImageAs: '',
        copyLink: '',
        copyImage: '',
        copyImageAddress: '',
        inspect: '',
        searchWithGoogle: '',
        lookUpSelection: '',
        selectAll: '',
        saveImageAs: ''
      },

      // 替换默认菜单，只保留我们需要的项目
      menu: (actions, props, browserWindow, dictionarySuggestions) => {
        const menu: MenuItemConstructorOptions[] = []

        // 仅在有文本选择时添加复制选项
        if (props.selectionText.trim().length > 0) {
          menu.push({
            label: '复制',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.copy()
              } else if ('copy' in browserWindow) {
                browserWindow.copy()
              }
            }
          })
        }

        // 在可编辑区域始终显示粘贴选项
        if (props.isEditable) {
          menu.push({
            label: '粘贴',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.paste()
              } else if ('paste' in browserWindow) {
                browserWindow.paste()
              }
            }
          })
        }

        return menu
      }
    })

    // 保存清理函数，以便后续可以移除
    this.disposeFunctions.set('default', dispose)
  }

  /**
   * 为特定选择器注册上下文菜单
   * @param selector - CSS选择器，用于定位应用菜单的元素
   * @param menuItems - 菜单项配置数组，每项包含标签和动作
   */
  registerContextMenu(selector: string, menuItems: { label: string; action: string }[]): void {
    // 如果已存在相同选择器的菜单，先移除
    if (this.disposeFunctions.has(selector)) {
      this.disposeFunctions.get(selector)?.()
      this.disposeFunctions.delete(selector)
    }

    const dispose = contextMenu({
      selector,

      // 完全禁用所有默认标签
      labels: {
        copy: '复制',
        paste: '粘贴',
        cut: '',
        save: '',
        saveImageAs: '',
        copyLink: '',
        copyImage: '',
        copyImageAddress: '',
        inspect: '',
        searchWithGoogle: '',
        lookUpSelection: '',
        selectAll: '',
        saveImageAs: ''
      },

      // 完全自定义菜单
      menu: (actions, props, browserWindow, dictionarySuggestions) => {
        const menu: MenuItemConstructorOptions[] = []

        // 添加自定义复制选项
        const hasCopyItem = menuItems.some((item) => item.action === 'copy')
        if (hasCopyItem && props.selectionText.trim().length > 0) {
          menu.push({
            label: '复制',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.copy()
              } else if ('copy' in browserWindow) {
                browserWindow.copy()
              }

              // 触发事件
              eventBus.emit('context-menu-action', {
                action: 'copy',
                data: props.selectionText,
                selector
              })

              // 同时发送到渲染进程
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.send('context-menu-action', {
                  action: 'copy',
                  data: props.selectionText,
                  selector
                })
              }
            }
          })
        } else if (props.selectionText.trim().length > 0) {
          // 如果没有自定义复制项但有选中文本，添加默认复制
          menu.push({
            label: '复制',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.copy()
              } else if ('copy' in browserWindow) {
                browserWindow.copy()
              }
            }
          })
        }

        // 添加自定义粘贴选项
        const hasPasteItem = menuItems.some((item) => item.action === 'paste')
        if (hasPasteItem && props.isEditable) {
          menu.push({
            label: '粘贴',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.paste()
              } else if ('paste' in browserWindow) {
                browserWindow.paste()
              }

              // 触发事件
              eventBus.emit('context-menu-action', {
                action: 'paste',
                data: '',
                selector
              })

              // 同时发送到渲染进程
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.send('context-menu-action', {
                  action: 'paste',
                  data: '',
                  selector
                })
              }
            }
          })
        } else if (props.isEditable) {
          // 如果没有自定义粘贴项但在可编辑区域，添加默认粘贴
          menu.push({
            label: '粘贴',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.paste()
              } else if ('paste' in browserWindow) {
                browserWindow.paste()
              }
            }
          })
        }

        return menu
      }
    })

    // 保存清理函数
    this.disposeFunctions.set(selector, dispose)
  }

  /**
   * 移除特定选择器的上下文菜单
   * @param selector - 要移除菜单的CSS选择器
   */
  removeContextMenu(selector: string): void {
    if (this.disposeFunctions.has(selector)) {
      // 调用清理函数
      this.disposeFunctions.get(selector)?.()
      // 从Map中删除
      this.disposeFunctions.delete(selector)
    }
  }

  /**
   * 清理所有注册的上下文菜单
   * 通常在应用关闭时调用
   */
  dispose(): void {
    // 调用所有清理函数
    this.disposeFunctions.forEach((dispose) => dispose())
    // 清空Map
    this.disposeFunctions.clear()
  }
}
