/**
 * 导入IPresenter接口类型和Vue的toRaw函数
 * IPresenter定义了所有可用的Presenter服务接口
 * toRaw用于将Vue的响应式对象转换为原始对象
 */
import { type IPresenter } from '@shared/presenter'
import { toRaw } from 'vue'

/**
 * 创建一个代理对象，用于处理对特定Presenter的方法调用
 *
 * @param presenterName - 要使用的Presenter名称（如contextMenuPresenter、llamaCppPresenter等）
 * @returns 返回一个代理对象，可以直接调用该Presenter的所有方法
 */
function createProxy(presenterName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_, functionName) {
      // 当访问代理对象的任何方法时，返回一个函数来处理实际调用
      return (...payloads: []) => {
        // 将所有参数转换为原始对象，避免传递Vue响应式对象
        const rawPayloads = payloads.map((e) => toRaw(e))
        // 通过Electron的IPC通道调用主进程中的对应Presenter方法
        return window.electron.ipcRenderer
          .invoke('presenter:call', presenterName, functionName, ...rawPayloads)
          .catch((e: Error) => {
            // 错误处理：记录错误并返回null
            console.warn('error on presenter invoke', functionName, e)
            return null
          })
      }
    }
  })
}

/**
 * 创建一个顶层代理对象，用于访问所有可用的Presenter
 * 这个代理对象实现了IPresenter接口，提供类型安全的访问
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentersProxy: IPresenter = new Proxy({} as any, {
  get(_, presenterName) {
    // 当访问特定Presenter时，为其创建一个专用代理
    return createProxy(presenterName as string)
  }
})

/**
 * 提供对特定Presenter的访问的组合式函数
 *
 * 使用示例:
 * ```
 * // 在Vue组件中
 * import { usePresenter } from '@/composables/usePresenter'
 *
 * // 获取特定Presenter的实例
 * const contextMenuPresenter = usePresenter('contextMenuPresenter')
 *
 * // 调用Presenter的方法
 * contextMenuPresenter.registerContextMenu('.my-element', [
 *   { label: '复制', action: 'copy' }
 * ])
 * ```
 *
 * @param name - 要使用的Presenter名称
 * @returns 返回对应的Presenter实例，可以直接调用其方法
 * 使用示例:
 * ```
 * const contextMenuPresenter = usePresenter('contextMenuPresenter')
 * contextMenuPresenter.registerContextMenu('.my-element', [
 *   { label: '复制', action: 'copy' }
 * ])
 * ```
 */
export function usePresenter<T extends keyof IPresenter>(name: T): IPresenter[T] {
  return presentersProxy[name]
}
