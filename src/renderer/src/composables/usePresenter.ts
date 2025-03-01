import { type IPresenter } from '@shared/presenter'
import { toRaw } from 'vue'
function createProxy(presenterName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_, functionName) {
      return (...payloads: []) => {
        const rawPayloads = payloads.map((e) => toRaw(e))
        return window.electron.ipcRenderer
          .invoke('presenter:call', presenterName, functionName, ...rawPayloads)
          .catch((e: Error) => {
            console.warn('error on presenter invoke', functionName, e)
            return null
          })
      }
    }
  })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentersProxy: IPresenter = new Proxy({} as any, {
  get(_, presenterName) {
    return createProxy(presenterName as string)
  }
})

export function usePresenter<T extends keyof IPresenter>(name: T): IPresenter[T] {
  return presentersProxy[name]
}

// 将重复的 usePresenter 函数重命名为 useContextMenu
export function useContextMenu() {
  async function call<T>(name: string, method: string, ...payloads: unknown[]): Promise<T> {
    return await window.electron.ipcRenderer.invoke('presenter:call', name, method, ...payloads)
  }

  // 已有的 presenter 函数
  // ...

  // 添加新的 contextMenu 函数
  const contextMenu = {
    register: (selector: string, menuItems: { label: string; action: string }[]) =>
      call('contextMenuPresenter', 'registerContextMenu', selector, menuItems),
    remove: (selector: string) => call('contextMenuPresenter', 'removeContextMenu', selector)
  }

  // 监听上下文菜单操作
  const onContextMenuAction = (callback: (action: string, data: any, selector: string) => void) => {
    window.electron.ipcRenderer.on('context-menu-action', (event, data) => {
      callback(data.action, data.data, data.selector)
    })
  }

  return {
    // 已有的返回值
    // ...

    // 添加新的返回值
    contextMenu,
    onContextMenuAction
  }
}
