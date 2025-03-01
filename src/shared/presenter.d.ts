/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow } from 'electron'

export type SQLITE_MESSAGE = {
  id: string
  conversation_id: string
  parent_id?: string
  role: MESSAGE_ROLE
  content: string
  created_at: number
  order_seq: number
  token_count: number
  status: MESSAGE_STATUS
  metadata: string // JSON string of MESSAGE_METADATA
  is_context_edge: number // 0 or 1
  is_variant: number
  variants?: SQLITE_MESSAGE[]
}

export interface IWindowPresenter {
  createMainWindow(): BrowserWindow
  getWindow(windowName: string): BrowserWindow | undefined
  mainWindow: BrowserWindow | undefined
  minimize(): void
  maximize(): void
  close(): void
  hide(): void
  show(): void
  isMaximized(): boolean
}

export interface ILlamaCppPresenter {
  init(): void
  prompt(text: string): Promise<string>
  startNewChat(): void
  destroy(): Promise<void>
}

export interface ISQLitePresenter {
  close(): void
  createConversation(title: string, settings?: Partial<CONVERSATION_SETTINGS>): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  getConversation(conversationId: string): Promise<CONVERSATION>
  updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void>
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  insertMessage(
    conversationId: string,
    content: string,
    role: string,
    parentId: string,
    metadata: string,
    orderSeq: number,
    tokenCount: number,
    status: string,
    isContextEdge: number,
    isVariant: number
  ): Promise<string>
  queryMessages(conversationId: string): Promise<Array<SQLITE_MESSAGE>>
  deleteAllMessages(): Promise<void>
  runTransaction(operations: () => void): Promise<void>

  // 新增的消息管理方法
  getMessage(messageId: string): Promise<SQLITE_MESSAGE | null>
  getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]>
  updateMessage(
    messageId: string,
    data: {
      content?: string
      status?: string
      metadata?: string
      isContextEdge?: number
      tokenCount?: number
    }
  ): Promise<void>
  deleteMessage(messageId: string): Promise<void>
  getMaxOrderSeq(conversationId: string): Promise<number>
  addMessageAttachment(
    messageId: string,
    attachmentType: string,
    attachmentData: string
  ): Promise<void>
  getMessageAttachments(messageId: string, type: string): Promise<{ content: string }[]>
  getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<SQLITE_MESSAGE | null>
  deleteAllMessagesInConversation(conversationId: string): Promise<void>
}

export interface IPresenter {
  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  threadPresenter: IThreadPresenter
  devicePresenter: IDevicePresenter
  upgradePresenter: IUpgradePresenter
  contextMenuPresenter: IContextMenuPresenter
  // llamaCppPresenter: ILlamaCppPresenter
}

export interface IConfigPresenter {
  getSetting<T>(key: string): T | undefined
  setSetting<T>(key: string, value: T): void
  getProviders(): LLM_PROVIDER[]
  setProviders(providers: LLM_PROVIDER[]): void
  getProviderById(id: string): LLM_PROVIDER | undefined
  setProviderById(id: string, provider: LLM_PROVIDER): void
  getProviderModels(providerId: string): MODEL_META[]
  setProviderModels(providerId: string, models: MODEL_META[]): void
  getEnabledProviders(): LLM_PROVIDER[]
  getAllEnabledModels(): Promise<{ providerId: string; models: MODEL_META[] }[]>
  // 自定义模型管理
  getCustomModels(providerId: string): MODEL_META[]
  setCustomModels(providerId: string, models: MODEL_META[]): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  // 关闭行为设置
  getCloseToQuit(): boolean
  setCloseToQuit(value: boolean): void
}

export type MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled: boolean
  isCustom: boolean
  contextLength: number
  maxTokens: number
  description?: string
}

export type LLM_PROVIDER = {
  id: string
  name: string
  apiType: string
  apiKey: string
  baseUrl: string
  enable: boolean
  custom?: boolean
}

export type LLM_PROVIDER_BASE = {
  websites?: {
    official: string
    apiKey: string
    docs: string
    models: string
  }
} & LLM_PROVIDER

export interface ILlmProviderPresenter {
  setProviders(provider: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
  getModelList(providerId: string): Promise<MODEL_META[]>
  updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void>
  addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META>
  removeCustomModel(providerId: string, modelId: string): Promise<boolean>
  updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean>
  getCustomModels(providerId: string): Promise<MODEL_META[]>
  startStreamCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<void>
  generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
  startStreamSummary(
    providerId: string,
    text: string,
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<void>
  startStreamText(
    providerId: string,
    prompt: string,
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<void>
  stopStream(eventId: string): Promise<void>
  check(providerId: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string>
}
export type CONVERSATION_SETTINGS = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: 0 | 1
}

export type CONVERSATION = {
  id: string
  title: string
  settings: CONVERSATION_SETTINGS
  createdAt: number
  updatedAt: number
  is_new?: number
  artifacts?: number
}

export interface IThreadPresenter {
  // 基本对话操作
  createConversation(title: string, settings?: Partial<CONVERSATION_SETTINGS>): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  getConversation(conversationId: string): Promise<CONVERSATION>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  updateConversationTitle(conversationId: string, title: string): Promise<void>
  updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void>

  // 对话列表和激活状态
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  setActiveConversation(conversationId: string): Promise<void>
  getActiveConversation(): Promise<CONVERSATION | null>

  getSearchResults(messageId: string): Promise<SearchResult[]>
  clearAllMessages(conversationId: string): Promise<void>

  // 消息操作
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  sendMessage(conversationId: string, content: string, role: MESSAGE_ROLE): Promise<MESSAGE | null>
  startStreamCompletion(conversationId: string, queryMsgId?: string): Promise<void>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, modelId?: string): Promise<MESSAGE>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>

  // 上下文控制
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  summaryTitles(modelId?: string): Promise<string>
  clearActiveThread(): Promise<void>
  stopMessageGeneration(messageId: string): Promise<void>
  getSearchEngines(): SearchEngineTemplate[]
  getActiveSearchEngine(): SearchEngineTemplate
  setActiveSearchEngine(engineName: string): void
  // 搜索助手模型设置
  setSearchAssistantModel(model: MODEL_META, providerId: string): void
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<Message | null>
  destroy(): void
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function'

export type MESSAGE_METADATA = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  generationTime: number
  firstTokenTime: number
  tokensPerSecond: number
  model?: string
  provider?: string
  reasoningStartTime?: number
  reasoningEndTime?: number
}

export interface IMessageManager {
  // 基本消息操作
  sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA
  ): Promise<MESSAGE>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<MESSAGE>

  // 消息查询
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{
    total: number
    list: MESSAGE[]
  }>
  getContextMessages(conversationId: string, contextLength: number): Promise<MESSAGE[]>

  // 消息状态管理
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // 上下文管理
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
}

export interface IDevicePresenter {
  getDeviceInfo(): Promise<DeviceInfo>
  getCPUUsage(): Promise<number>
  getMemoryUsage(): Promise<MemoryInfo>
  getDiskSpace(): Promise<DiskInfo>
  resetData(): Promise<void>
}

export type DeviceInfo = {
  platform: string
  arch: string
  cpuModel: string
  totalMemory: number
  osVersion: string
}

export type MemoryInfo = {
  total: number
  free: number
  used: number
}

export type DiskInfo = {
  total: number
  free: number
  used: number
}

export type LLMResponse = {
  content: string
  reasoning_content?: string
}
export type LLMResponseStream = {
  content?: string
  reasoning_content?: string
}
export interface IUpgradePresenter {
  checkUpdate(): Promise<void>
  startDownloadUpdate(): void
  restartToUpdate(): void
  restartApp(): void
  getUpdateStatus(): {
    status: UpdateStatus | null
    progress: UpdateProgress | null
    error: string | null
    updateInfo: {
      version: string
      releaseDate: string
      releaseNotes: any
    } | null
  }
}
// 更新状态类型
export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

export interface SearchResult {
  title: string
  url: string
  rank: number
  content?: string
  icon?: string
  description?: string
}

export interface ISearchPresenter {
  init(): void
  search(query: string, engine: 'google' | 'baidu'): Promise<SearchResult[]>
}

export interface IContextMenuPresenter {
  registerContextMenu(
    selector: string, 
    menuItems: { label: string, action: string }[]
  ): void;
  removeContextMenu(selector: string): void;
}
