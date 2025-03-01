<template>
  <div class="message-item" :class="{ 'user-message': isUser, 'ai-message': !isUser }">
    <div class="message-content" :data-message-id="messageId">
      {{ content }}
    </div>
    <!-- 可以选择移除此按钮，因为右键菜单已经有了复制功能 -->
    <!-- <div class="message-actions">
      <button @click="handleCopy">复制</button>
    </div> -->
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useContextMenu } from '@/composables/usePresenter'

const props = defineProps<{
  messageId: string
  content: string
  isUser: boolean
}>()

const emit = defineEmits(['copy'])
const { contextMenu, onContextMenuAction } = useContextMenu()

const handleCopy = () => {
  navigator.clipboard.writeText(props.content)
  emit('copy')
}

onMounted(async () => {
  // 为特定消息内容元素注册右键菜单
  await contextMenu.register(
    `[data-message-id="${props.messageId}"]`, 
    [
      { label: '复制', action: 'copy' }
    ]
  )
  
  // 监听右键菜单动作
  onContextMenuAction((action, data, selector) => {
    if (selector === `[data-message-id="${props.messageId}"]`) {
      if (action === 'copy') {
        navigator.clipboard.writeText(props.content)
        emit('copy')
      }
    }
  })
})

onUnmounted(async () => {
  // 组件卸载时清理右键菜单
  await contextMenu.remove(`[data-message-id="${props.messageId}"]`)
})
</script> 