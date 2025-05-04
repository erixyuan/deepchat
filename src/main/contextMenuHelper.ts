import { BrowserWindow, Menu, MenuItemConstructorOptions, WebContents, dialog, net } from 'electron'
import path from 'path'
import sharp from 'sharp'

interface ContextMenuOptions {
  window: BrowserWindow
  shouldShowMenu?: (event: Electron.Event, params: Electron.ContextMenuParams) => boolean
  labels?: Record<string, string>
  prepend?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[]
  append?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[]
  menu?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[] | Menu
}

/**
 * 简化版的上下文菜单实现
 * 只包含基础功能，确保正确处理生命周期和监听器注销
 */
export default function contextMenu(options: ContextMenuOptions): () => void {
  const disposables: (() => void)[] = []
  let isDisposed = false

  console.log('contextMenu: 初始化上下文菜单', options.window.id)

  // 确保 window 参数存在
  if (!options.window) {
    console.error('contextMenu: Window 参数缺失')
    throw new Error('Window is required')
  }

  // 获取 WebContents 实例
  const getWebContents = (win: BrowserWindow): WebContents => win.webContents

  // 处理上下文菜单事件
  const handleContextMenu = (event: Electron.Event, params: Electron.ContextMenuParams) => {
    console.log('contextMenu: 触发上下文菜单事件', params.x, params.y, params.mediaType)

    if (isDisposed) {
      console.log('contextMenu: 已销毁，忽略事件')
      return
    }

    // 检查是否应该显示菜单
    if (
      typeof options.shouldShowMenu === 'function' &&
      options.shouldShowMenu(event, params) === false
    ) {
      console.log('contextMenu: shouldShowMenu 返回 false，不显示菜单')
      return
    }

    // 准备默认菜单项 - 提供一些基础菜单项
    let menuItems: MenuItemConstructorOptions[] = []

    // 处理图片右键菜单
    if (params.mediaType === 'image') {
      // 图片复制选项
      menuItems.push({
        id: 'copyImage',
        label: options.labels?.copyImage || '复制图片',
        click: () => {
          const webContents = getWebContents(options.window)
          webContents.copyImageAt(params.x, params.y)
          console.log('contextMenu: 复制图片', params.srcURL)
        }
      })

      // 图片另存为选项
      menuItems.push({
        id: 'saveImage',
        label: options.labels?.saveImage || '图片另存为...',
        click: async () => {
          try {
            // 获取文件名和URL
            const url = params.srcURL || ''
            let fileName = 'image.png'
            let imageBuffer: Buffer | null = null

            // 检查是否为base64格式
            const isBase64 = url.startsWith('data:image/')
            if (!isBase64) {
              // 普通URL使用路径中的文件名
              fileName = path.basename(url || 'image.png')
            } else {
              // base64URL使用默认文件名
              // 尝试从MIME类型识别扩展名
              const mimeMatch = url.match(/^data:image\/([a-zA-Z0-9]+);base64,/)
              if (mimeMatch && mimeMatch[1]) {
                const ext = mimeMatch[1].toLowerCase()
                fileName = `image.${ext === 'jpeg' ? 'jpg' : ext}`
              }
            }

            // 打开保存对话框
            const { canceled, filePath } = await dialog.showSaveDialog({
              defaultPath: fileName,
              filters: [
                { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            })

            if (canceled || !filePath) {
              return
            }

            console.log('contextMenu: 开始保存图片到', filePath)

            // 获取图片数据
            if (isBase64) {
              // 处理base64数据
              const base64Data = url.split(',')[1]
              if (!base64Data) {
                throw new Error('无效的base64图片数据')
              }
              imageBuffer = Buffer.from(base64Data, 'base64')
            } else {
              // 处理普通URL
              const response = await net.fetch(url)
              if (!response.ok) {
                throw new Error(`下载图片失败: ${response.status}`)
              }
              imageBuffer = Buffer.from(await response.arrayBuffer())
            }

            if (!imageBuffer) {
              throw new Error('无法获取图片数据')
            }

            // 使用sharp处理图片并保存
            const fileExt = path.extname(filePath).toLowerCase().substring(1)

            // 根据目标文件扩展名处理图片格式
            const sharpInstance = sharp(imageBuffer)

            if (fileExt === 'jpg' || fileExt === 'jpeg') {
              await sharpInstance.jpeg({ quality: 90 }).toFile(filePath)
            } else if (fileExt === 'png') {
              await sharpInstance.png().toFile(filePath)
            } else if (fileExt === 'webp') {
              await sharpInstance.webp().toFile(filePath)
            } else if (fileExt === 'gif') {
              await sharpInstance.gif().toFile(filePath)
            } else {
              // 默认保存为原始格式
              await sharpInstance.toFile(filePath)
            }

            console.log('contextMenu: 保存图片成功', filePath)
          } catch (error) {
            console.error('contextMenu: 保存图片失败', error)
          }
        }
      })

      // 添加分隔符
      menuItems.push({ type: 'separator' })
    }

    // 根据 labels 设置添加基础菜单项
    if (params.isEditable) {
      const editFlags = params.editFlags
      // 添加基础编辑菜单
      if (editFlags.canCut && params.selectionText) {
        menuItems.push({
          id: 'cut',
          label: options.labels?.cut || '剪切',
          role: 'cut',
          enabled: true
        })
      }

      if (editFlags.canCopy && params.selectionText) {
        menuItems.push({
          id: 'copy',
          label: options.labels?.copy || '复制',
          role: 'copy',
          enabled: true
        })
      }

      if (editFlags.canPaste) {
        menuItems.push({
          id: 'paste',
          label: options.labels?.paste || '粘贴',
          role: 'paste',
          enabled: true
        })
      }
    } else if (params.selectionText) {
      // 非输入框内的文本选择
      menuItems.push({
        id: 'copy',
        label: options.labels?.copy || '复制',
        role: 'copy',
        enabled: true
      })
    }

    // 允许用户在菜单前添加项目
    if (typeof options.prepend === 'function') {
      const prependItems = options.prepend(menuItems, params, options.window)
      menuItems = prependItems.concat(menuItems)
    }

    // 允许用户在菜单后添加项目
    if (typeof options.append === 'function') {
      const appendItems = options.append(menuItems, params, options.window)
      menuItems = menuItems.concat(appendItems)
    }

    // 允许用户完全自定义菜单
    if (typeof options.menu === 'function') {
      const customMenu = options.menu(menuItems, params, options.window)

      if (Array.isArray(customMenu)) {
        menuItems = customMenu
      } else {
        // 如果是一个 Menu 实例，直接显示
        customMenu.popup({ window: options.window })
        return
      }
    }

    // 清理分隔符（避免连续的分隔符或开头/结尾的分隔符）
    menuItems = removeUnusedMenuItems(menuItems)

    // 创建并显示菜单
    if (menuItems.length > 0) {
      try {
        const menu = Menu.buildFromTemplate(menuItems)
        console.log('contextMenu: 显示菜单')
        menu.popup({
          window: options.window,
          x: params.x,
          y: params.y
        })
      } catch (error) {
        console.error('contextMenu: 创建或显示菜单失败', error)
      }
    } else {
      console.warn('contextMenu: 没有可用的菜单项，不显示菜单')
    }
  }

  // 清理连续分隔符
  const removeUnusedMenuItems = (
    menuTemplate: MenuItemConstructorOptions[]
  ): MenuItemConstructorOptions[] => {
    let notDeletedPreviousElement: MenuItemConstructorOptions | undefined

    return (
      menuTemplate
        // 过滤掉不可见或未定义的菜单项
        .filter((menuItem): menuItem is MenuItemConstructorOptions => {
          return (
            menuItem !== undefined && typeof menuItem === 'object' && menuItem.visible !== false
          )
        })
        // 过滤掉不必要的分隔符
        .filter((menuItem, index, array) => {
          const toDelete =
            menuItem.type === 'separator' &&
            (!notDeletedPreviousElement ||
              index === array.length - 1 ||
              array[index + 1].type === 'separator')

          notDeletedPreviousElement = toDelete ? notDeletedPreviousElement : menuItem
          return !toDelete
        })
    )
  }

  // 初始化上下文菜单
  const initialize = (win: BrowserWindow) => {
    if (isDisposed) {
      console.log('contextMenu: 已销毁，不初始化')
      return
    }

    try {
      const webContents = getWebContents(win)

      // 添加上下文菜单事件监听器
      webContents.on('context-menu', handleContextMenu)

      // 当 WebContents 被销毁时清理
      const cleanup = () => {
        console.log('contextMenu: WebContents 已销毁，清理事件监听器')
        webContents.removeListener('context-menu', handleContextMenu)
      }

      webContents.once('destroyed', cleanup)

      // 添加到待清理列表
      disposables.push(() => {
        webContents.removeListener('context-menu', handleContextMenu)
        webContents.removeListener('destroyed', cleanup)
      })
    } catch (error) {
      console.error('contextMenu: 初始化失败', error)
    }
  }

  // 注册窗口
  initialize(options.window)

  // 返回清理函数
  return () => {
    if (isDisposed) {
      console.log('contextMenu: 已经销毁，跳过清理')
      return
    }

    console.log('contextMenu: 开始清理')
    // 清理所有监听器
    for (const dispose of disposables) {
      dispose()
    }

    disposables.length = 0
    isDisposed = true
    console.log('contextMenu: 清理完成')
  }
}
