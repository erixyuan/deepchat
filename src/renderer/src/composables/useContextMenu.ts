import { ref, onMounted, onUnmounted } from 'vue'
import { usePresenter } from './usePresenter'

/**
 * 定义菜单项接口
 * 每个菜单项包含标签和对应的动作标识符
 */
interface ContextMenuItem {
  label: string // 菜单项显示的文本
  action: string // 菜单项对应的动作标识符
}

/**
 * 定义右键菜单行为选项接口
 * 控制右键菜单的行为和显示方式
 */
interface ContextMenuOptions {
  autoSelectText?: boolean // 是否自动选中文本，默认为true
  preventDefault?: boolean // 是否阻止默认右键菜单，默认为true
  stopPropagation?: boolean // 是否阻止事件冒泡，默认为true
  beforeShow?: (event: MouseEvent) => void // 显示菜单前的回调函数
}

/**
 * 右键菜单钩子函数
 * 提供注册和管理自定义右键菜单的功能
 * @returns 包含注册和管理右键菜单的方法集合
 */
export function useContextMenu() {
  // 使用usePresenter获取contextMenuPresenter
  // 这样可以直接调用主进程中的ContextMenuPresenter提供的方法
  const contextMenuPresenter = usePresenter('contextMenuPresenter')

  // 存储所有注册的事件处理函数，键为选择器
  const handlersMap = new Map<string, (event: MouseEvent) => void>()
  // 存储所有注册的菜单项配置，键为选择器
  const menuItemsMap = new Map<string, ContextMenuItem[]>()
  // 存储所有注册的选项配置，键为选择器
  const optionsMap = new Map<string, ContextMenuOptions>()

  /**
   * 注册原生右键菜单
   * 为指定选择器的元素注册自定义右键菜单
   * @param selector - CSS选择器，用于定位需要应用菜单的元素
   * @param menuItems - 菜单项配置数组
   * @param options - 右键菜单行为选项
   * @returns 返回一个函数，调用该函数可以移除注册的右键菜单
   */
  const registerNative = (
    selector: string,
    menuItems: ContextMenuItem[],
    options: ContextMenuOptions = {}
  ) => {
    // 保存菜单项和选项到映射中
    menuItemsMap.set(selector, menuItems)
    optionsMap.set(selector, {
      autoSelectText: true, // 默认自动选中文本
      preventDefault: true, // 默认阻止默认行为
      stopPropagation: true, // 默认阻止事件冒泡
      ...options
    })

    /**
     * 创建右键菜单事件处理函数
     * @param event - 鼠标事件对象
     */
    const handler = (event: MouseEvent) => {
      const opts = optionsMap.get(selector)!

      // 根据选项处理事件传播
      if (opts.preventDefault) event.preventDefault()
      if (opts.stopPropagation) event.stopPropagation()

      // 执行菜单显示前的回调函数
      if (opts.beforeShow) opts.beforeShow(event)

      // 自动选中文本（如果配置为true且当前没有已选中的文本）
      if (opts.autoSelectText && window.getSelection()?.toString().trim().length === 0) {
        const target = event.currentTarget as HTMLElement
        // 检查目标元素是否是可编辑元素（输入框、文本域等）
        const isEditable =
          target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          !!target.closest('input, textarea, [contenteditable="true"]')

        // 只对非可编辑元素执行文本选中操作
        if (!isEditable) {
          const range = document.createRange()
          range.selectNodeContents(target)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }

      // 通过IPC调用主进程显示菜单
      window.electron.ipcRenderer.invoke(
        'presenter:call',
        'contextMenuPresenter',
        'registerContextMenu',
        selector,
        menuItems
      )
    }

    // 保存处理函数以便后续清理
    handlersMap.set(selector, handler)

    // 查找匹配选择器的所有元素并绑定右键菜单事件
    const elements = document.querySelectorAll(selector)
    elements.forEach((el) => {
      el.addEventListener('contextmenu', handler as EventListener)
    })

    // 返回清理函数
    return () => removeNative(selector)
  }

  /**
   * 移除原生右键菜单
   * 移除指定选择器的自定义右键菜单
   * @param selector - 要移除菜单的CSS选择器
   */
  const removeNative = (selector: string) => {
    const handler = handlersMap.get(selector)
    if (!handler) return

    // 解绑所有匹配元素的右键菜单事件
    const elements = document.querySelectorAll(selector)
    elements.forEach((el) => {
      el.removeEventListener('contextmenu', handler as EventListener)
    })

    // 清理所有相关映射
    handlersMap.delete(selector)
    menuItemsMap.delete(selector)
    optionsMap.delete(selector)

    // 通知主进程移除菜单
    window.electron.ipcRenderer.invoke(
      'presenter:call',
      'contextMenuPresenter',
      'removeContextMenu',
      selector
    )
  }

  /**
   * 兼容旧API的注册方法
   * 通过IPC直接调用主进程注册菜单
   * @param selector - CSS选择器，用于定位应用菜单的元素
   * @param menuItems - 菜单项配置数组，每项包含标签和动作
   * @returns Promise，包含注册结果
   */
  const register = async (selector: string, menuItems: { label: string; action: string }[]) => {
    // 通过Electron的IPC通道调用主进程中的contextMenuPresenter的registerContextMenu方法
    // 使用usePresenter的底层实现方式直接调用
    return await window.electron.ipcRenderer.invoke(
      'presenter:call',
      'contextMenuPresenter',
      'registerContextMenu',
      selector,
      menuItems
    )
  }

  /**
   * 兼容旧API的移除方法
   * 通过IPC直接调用主进程移除菜单
   * @param selector - 要移除菜单的CSS选择器
   * @returns Promise，包含移除结果
   */
  const remove = async (selector: string) => {
    return await window.electron.ipcRenderer.invoke(
      'presenter:call',
      'contextMenuPresenter',
      'removeContextMenu',
      selector
    )
  }

  /**
   * 监听菜单动作
   * 设置菜单项被点击时的回调函数
   * @param callback - 处理菜单动作的回调函数
   */
  const onAction = (callback: (action: string, data: any, selector: string) => void) => {
    window.electron.ipcRenderer.on('context-menu-action', (event, data) => {
      callback(data.action, data.data, data.selector)
    })
  }

  // 组件卸载时自动清理所有绑定的右键菜单
  onUnmounted(() => {
    handlersMap.forEach((handler, selector) => {
      removeNative(selector)
    })
  })

  // 兼容旧API的对象
  const contextMenu = {
    register,
    remove,
    onAction
  }

  // 返回所有可用方法
  return {
    // 新API - 推荐使用
    registerNative, // 注册原生右键菜单
    removeNative, // 移除原生右键菜单
    onContextMenuAction: onAction, // 监听菜单动作

    // 兼容旧API - 向后兼容
    contextMenu
  }
}
