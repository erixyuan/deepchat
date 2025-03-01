/**
 * Electron主进程入口文件
 * 负责应用程序初始化、窗口创建和生命周期管理
 */

// 导入Electron核心模块
import { app, BrowserWindow } from 'electron'
// 导入Electron工具库
import { electronApp, optimizer } from '@electron-toolkit/utils'
// 导入自定义presenter模块
import { presenter } from './presenter'

// ===== 命令行参数配置 =====

// 允许自动播放媒体，无需用户手势
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 允许WebRTC使用更多CPU资源
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100')
// 增加JavaScript的内存限制，提高性能
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096')
// 忽略证书错误，便于开发环境调试
app.commandLine.appendSwitch('ignore-certificate-errors')

// Windows平台特定配置
if (process.platform == 'win32') {
  // 使用进程内GPU加速，提高渲染性能
  app.commandLine.appendSwitch('in-process-gpu')
  // 禁用窗口动画，减少资源消耗
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}
// macOS平台特定配置
if (process.platform === 'darwin') {
  // 禁用特定功能，解决macOS上的屏幕捕获兼容性问题
  app.commandLine.appendSwitch('disable-features', 'DesktopCaptureMacV2,IOSurfaceCapturer')
}

// ===== 应用程序初始化 =====

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  // 设置Windows平台的应用程序用户模型ID
  electronApp.setAppUserModelId('com.wefonk.deepchat')

  // 开发环境中通过F12打开/关闭DevTools，生产环境忽略Ctrl+R刷新
  // 详见: https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 创建主窗口
  presenter.windowPresenter.createMainWindow()
  // 注册全局快捷键
  presenter.shortcutPresenter.registerShortcuts()

  // 注释掉的代码是LlamaWorker相关功能，可能是之前的聊天功能实现
  // const worker = new LlamaWorker(mainWindow)
  // ipcMain.on('new-chat', () => {
  //   worker.startNewChat()
  // })
  // // IPC test
  // ipcMain.on('prompt', (e, prompt: string) => {
  //   worker.prompt(prompt).then(() => {
  //     console.log('finished')
  //   })
  // })

  // macOS平台特性：点击dock图标时重新创建窗口
  app.on('activate', function () {
    // 在macOS上，当点击dock图标且没有其他窗口打开时，
    // 通常会在应用程序中重新创建一个窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      presenter.windowPresenter.createMainWindow()
    } else {
      // 如果已有窗口，则显示窗口
      presenter.windowPresenter.mainWindow?.show()
    }
  })

  // 监听应用程序窗口获得焦点事件，注册快捷键
  app.on('browser-window-focus', () => {
    presenter.shortcutPresenter.registerShortcuts()
  })

  // 监听应用程序窗口失去焦点事件，注销快捷键，防止与系统快捷键冲突
  app.on('browser-window-blur', () => {
    presenter.shortcutPresenter.unregisterShortcuts()
  })
})

// ===== 应用程序生命周期事件处理 =====

// 当所有窗口关闭时退出应用，macOS除外
// 在macOS上，应用程序及其菜单栏通常会保持活动状态，
// 直到用户使用Cmd + Q显式退出
app.on('window-all-closed', () => {
  // 清理资源
  presenter.destroy()
  // 非macOS平台退出应用
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用程序即将退出前的清理工作
app.on('before-quit', () => {
  presenter.destroy()
})

// 在此文件中，您可以包含应用程序主进程的其他特定代码
// 也可以将它们放在单独的文件中，并在此处导入
