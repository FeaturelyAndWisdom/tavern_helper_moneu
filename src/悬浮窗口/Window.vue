<template>
  <div class="flex flex-col h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden">
    <!-- 窗口标题栏 -->
    <div
      class="window-header flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700 cursor-move select-none"
    >
      <div class="flex items-center gap-2">
        <i class="fas fa-window-maximize text-blue-400"></i>
        <span class="font-semibold">悬浮窗口</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-600 transition-colors"
          @click="minimized = !minimized"
        >
          <i :class="minimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" class="text-xs"></i>
        </button>
      </div>
    </div>

    <!-- 窗口内容区 -->
    <div v-show="!minimized" class="flex-1 overflow-auto p-4">
      <!-- 自定义内容区域 -->
      <div class="space-y-4">
        <div class="bg-slate-700/50 rounded-lg p-4">
          <h3 class="text-sm font-medium text-slate-300 mb-2">快捷操作</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="action in actions"
              :key="action.name"
              class="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors"
              @click="handleAction(action)"
            >
              <i :class="action.icon" class="mr-1"></i>
              {{ action.name }}
            </button>
          </div>
        </div>

        <div class="bg-slate-700/50 rounded-lg p-4">
          <h3 class="text-sm font-medium text-slate-300 mb-2">信息面板</h3>
          <div class="text-sm text-slate-400 space-y-1">
            <p>当前聊天: {{ chatId ?? '无' }}</p>
            <p>消息数量: {{ messageCount }}</p>
          </div>
        </div>

        <div class="bg-slate-700/50 rounded-lg p-4">
          <h3 class="text-sm font-medium text-slate-300 mb-2">输入区域</h3>
          <textarea
            v-model="inputText"
            class="w-full h-20 bg-slate-800 border border-slate-600 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-blue-500"
            placeholder="在此输入内容..."
          ></textarea>
          <button
            class="mt-2 w-full px-3 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm transition-colors"
            @click="handleSubmit"
          >
            <i class="fas fa-paper-plane mr-1"></i>
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const minimized = ref(false);
const inputText = ref('');
const chatId = ref<string | null>(null);
const messageCount = ref(0);

const actions = [
  { name: '刷新', icon: 'fas fa-sync-alt', action: 'refresh' },
  { name: '清空', icon: 'fas fa-trash', action: 'clear' },
  { name: '保存', icon: 'fas fa-save', action: 'save' },
  { name: '设置', icon: 'fas fa-cog', action: 'settings' },
];

onMounted(() => {
  updateInfo();
  eventOn(tavern_events.CHAT_CHANGED, updateInfo);
  eventOn(tavern_events.MESSAGE_RECEIVED, updateInfo);
});

function updateInfo() {
  chatId.value = SillyTavern.getCurrentChatId();
  messageCount.value = getLastMessageId() + 1;
}

function handleAction(action: (typeof actions)[number]) {
  switch (action.action) {
    case 'refresh':
      updateInfo();
      toastr.info('已刷新信息');
      break;
    case 'clear':
      inputText.value = '';
      toastr.info('已清空输入');
      break;
    case 'save':
      toastr.success('保存成功');
      break;
    case 'settings':
      toastr.info('设置功能待实现');
      break;
  }
}

function handleSubmit() {
  if (!inputText.value.trim()) {
    toastr.warning('请输入内容');
    return;
  }
  toastr.success(`已发送: ${inputText.value}`);
  inputText.value = '';
}
</script>

<style scoped></style>
