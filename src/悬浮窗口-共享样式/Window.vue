<template>
  <div class="floating-window">
    <!-- 窗口标题栏 -->
    <div class="floating-window__header">
      <div class="floating-window__header-left">
        <i class="fas fa-window-maximize"></i>
        <span>悬浮窗口</span>
      </div>
      <div class="floating-window__header-right">
        <button class="floating-window__btn-icon" @click="minimized = !minimized">
          <i :class="minimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <!-- 窗口内容区 -->
    <div v-show="!minimized" class="floating-window__content">
      <!-- 快捷操作 -->
      <div class="floating-window__section">
        <h3 class="floating-window__section-title">快捷操作</h3>
        <div class="floating-window__actions">
          <button
            v-for="action in actions"
            :key="action.name"
            class="menu_button"
            @click="handleAction(action)"
          >
            <i :class="action.icon"></i>
            {{ action.name }}
          </button>
        </div>
      </div>

      <!-- 信息面板 -->
      <div class="floating-window__section">
        <h3 class="floating-window__section-title">信息面板</h3>
        <div class="floating-window__info">
          <p>当前聊天: {{ chatId ?? '无' }}</p>
          <p>消息数量: {{ messageCount }}</p>
        </div>
      </div>

      <!-- 输入区域 -->
      <div class="floating-window__section">
        <h3 class="floating-window__section-title">输入区域</h3>
        <textarea
          v-model="inputText"
          class="text_pole floating-window__textarea"
          placeholder="在此输入内容..."
        ></textarea>
        <button class="menu_button floating-window__submit" @click="handleSubmit">
          <i class="fas fa-paper-plane"></i>
          发送
        </button>
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
